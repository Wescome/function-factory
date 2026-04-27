// gdk-ts/src/resilience.ts — Retry and Circuit Breaker for KernelClient
// Per CONSOLE-10: Exponential backoff retry + 3-state circuit breaker

import { CircuitOpenError, RetryExhaustedError } from './errors.js';

// ============================================================================
// Types
// ============================================================================

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerConfig {
  failureThreshold?: number;    // default: 5
  recoveryTimeoutMs?: number;   // default: 30000
  successThreshold?: number;    // default: 1
}

export interface RetryConfig {
  maxRetries?: number;          // default: 3
  baseDelayMs?: number;         // default: 200
  retryableStatuses?: number[]; // default: [502, 503, 504]
}

export interface ResilienceEventHandlers {
  onRetry?: (attempt: number, delayMs: number) => void;
  onCircuitOpen?: () => void;
  onCircuitClose?: () => void;
}

// ============================================================================
// Circuit Breaker
// ============================================================================

/**
 * CircuitBreaker implements the 3-state circuit breaker pattern.
 * 
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: All requests fail-fast with CircuitOpenError (no network call)
 * - HALF-OPEN: Allow 1 probe request, if success → CLOSED, if fail → OPEN
 * 
 * Thresholds:
 * - failure_threshold: 5 consecutive failures → OPEN
 * - recovery_timeout: 30 seconds → HALF-OPEN
 * - success_threshold: 1 success in HALF-OPEN → CLOSED
 */
export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime: number | null = null;
  private nextAttemptTime: number | null = null;
  
  private readonly failureThreshold: number;
  private readonly recoveryTimeoutMs: number;
  private readonly successThreshold: number;
  private readonly onOpen?: () => void;
  private readonly onClose?: () => void;

  constructor(
    config: CircuitBreakerConfig = {},
    handlers: Pick<ResilienceEventHandlers, 'onCircuitOpen' | 'onCircuitClose'> = {}
  ) {
    this.failureThreshold = config.failureThreshold ?? 5;
    this.recoveryTimeoutMs = config.recoveryTimeoutMs ?? 30000;
    this.successThreshold = config.successThreshold ?? 1;
    this.onOpen = handlers.onCircuitOpen;
    this.onClose = handlers.onCircuitClose;
  }

  get currentState(): CircuitState {
    this.checkRecoveryTimeout();
    return this.state;
  }

  get nextAttemptAt(): Date | null {
    return this.nextAttemptTime ? new Date(this.nextAttemptTime) : null;
  }

  /**
   * Execute a function through the circuit breaker.
   * @throws CircuitOpenError if circuit is OPEN
   * @returns Result of the function if successful
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.checkRecoveryTimeout();

    if (this.state === 'open') {
      throw new CircuitOpenError({
        recoveryTimeoutMs: this.recoveryTimeoutMs,
        nextAttemptAt: this.nextAttemptAt ?? new Date(Date.now() + this.recoveryTimeoutMs),
      });
    }

    // In half-open state, we allow the request through as a probe
    const wasHalfOpen = this.state === 'half-open';

    try {
      const result = await fn();
      this.onSuccess(wasHalfOpen);
      return result;
    } catch (error) {
      this.onFailure(wasHalfOpen);
      throw error;
    }
  }

  private checkRecoveryTimeout(): void {
    if (this.state === 'open' && this.nextAttemptTime) {
      if (Date.now() >= this.nextAttemptTime) {
        this.state = 'half-open';
        this.successCount = 0;
      }
    }
  }

  private onSuccess(wasHalfOpen: boolean): void {
    if (wasHalfOpen) {
      this.successCount++;
      if (this.successCount >= this.successThreshold) {
        this.closeCircuit();
      }
    } else {
      // In closed state, reset failure count on success
      this.failureCount = 0;
    }
  }

  private onFailure(wasHalfOpen: boolean): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (wasHalfOpen) {
      // In half-open, any failure immediately opens the circuit
      this.openCircuit();
    } else if (this.failureCount >= this.failureThreshold) {
      // In closed, reach threshold to open
      this.openCircuit();
    }
  }

  private openCircuit(): void {
    this.state = 'open';
    this.nextAttemptTime = Date.now() + this.recoveryTimeoutMs;
    this.onOpen?.();
  }

  private closeCircuit(): void {
    this.state = 'closed';
    this.failureCount = 0;
    this.successCount = 0;
    this.nextAttemptTime = null;
    this.onClose?.();
  }

  /** Reset circuit breaker to initial closed state (useful for testing) */
  reset(): void {
    this.state = 'closed';
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    this.nextAttemptTime = null;
  }
}

// ============================================================================
// Retry Handler
// ============================================================================

/**
 * RetryHandler implements exponential backoff retry logic.
 * 
 * Configuration:
 * - Max 3 retries
 * - Backoff: 200ms, 400ms, 800ms
 * - Retry on: network errors, 502, 503, 504
 * - Do NOT retry: 400, 401, 403, 404, 409 (client errors are not transient)
 * 
 * Idempotency key ensures retry safety (SDD-GDK 9.6)
 */
export class RetryHandler {
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly retryableStatuses: Set<number>;
  private readonly onRetry?: (attempt: number, delayMs: number) => void;

  constructor(
    config: RetryConfig = {},
    handlers: Pick<ResilienceEventHandlers, 'onRetry'> = {}
  ) {
    this.maxRetries = config.maxRetries ?? 3;
    this.baseDelayMs = config.baseDelayMs ?? 200;
    this.retryableStatuses = new Set(config.retryableStatuses ?? [502, 503, 504]);
    this.onRetry = handlers.onRetry;
  }

  /**
   * Execute a function with retry logic.
   * @throws RetryExhaustedError if all retries fail
   * @returns Result of the function if successful
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: Error | null = null;
    let totalDelayMs = 0;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Check if we should retry
        if (attempt < this.maxRetries && this.shouldRetry(error)) {
          const delayMs = this.calculateDelay(attempt);
          totalDelayMs += delayMs;
          
          this.onRetry?.(attempt + 1, delayMs);
          await this.sleep(delayMs);
        } else {
          // Don't retry - either max retries reached or non-retryable error
          break;
        }
      }
    }

    throw new RetryExhaustedError({
      attempts: this.maxRetries + 1,
      lastError: lastError!,
      totalDelayMs,
    });
  }

  private shouldRetry(error: unknown): boolean {
    // Network errors (no status code) are retryable
    if (!(error instanceof Error)) {
      return true;
    }

    // Check for HTTP status in error message
    const statusMatch = error.message.match(/\((\d{3})\)/);
    if (statusMatch) {
      const status = parseInt(statusMatch[1], 10);
      return this.retryableStatuses.has(status);
    }

    // Check for specific error types that indicate transient failures
    if (error.message.includes('ECONNREFUSED') ||
        error.message.includes('ETIMEDOUT') ||
        error.message.includes('ENOTFOUND') ||
        error.message.includes('network') ||
        error.message.includes('timeout')) {
      return true;
    }

    // Default: don't retry unknown errors
    return false;
  }

  private calculateDelay(attempt: number): number {
    // Exponential backoff: 200ms, 400ms, 800ms
    return this.baseDelayMs * Math.pow(2, attempt);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================================
// Combined Resilience Wrapper
// ============================================================================

/**
 * ResilienceWrapper combines circuit breaker and retry logic.
 * Order: Circuit breaker check → Retry loop → Circuit breaker record result
 */
export class ResilienceWrapper {
  readonly circuitBreaker: CircuitBreaker;
  readonly retryHandler: RetryHandler;

  constructor(
    circuitConfig: CircuitBreakerConfig = {},
    retryConfig: RetryConfig = {},
    handlers: ResilienceEventHandlers = {}
  ) {
    this.circuitBreaker = new CircuitBreaker(circuitConfig, {
      onCircuitOpen: handlers.onCircuitOpen,
      onCircuitClose: handlers.onCircuitClose,
    });
    this.retryHandler = new RetryHandler(retryConfig, {
      onRetry: handlers.onRetry,
    });
  }

  /**
   * Execute a function with both circuit breaker and retry protection.
   * 
   * Flow:
   * 1. Circuit breaker checks if requests are allowed
   * 2. Retry handler executes with exponential backoff
   * 3. Circuit breaker records success/failure
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    return this.circuitBreaker.execute(() => this.retryHandler.execute(fn));
  }

  get circuitState(): CircuitState {
    return this.circuitBreaker.currentState;
  }

  reset(): void {
    this.circuitBreaker.reset();
  }
}
