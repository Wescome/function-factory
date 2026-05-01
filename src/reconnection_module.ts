export type ConnectionState = 'connected' | 'disconnected' | 'reconnecting';

export interface ReconnectionOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  onStateChange?: (state: ConnectionState) => void;
  onReconnected?: () => void;
  onExhausted?: (error: Error) => void;
}

interface InternalConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  onStateChange?: (state: ConnectionState) => void;
  onReconnected?: () => void;
  onExhausted?: (error: Error) => void;
}

export class ReconnectionManager {
  private state: ConnectionState = 'connected';
  private retryCount = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private rejectPending: ((reason?: unknown) => void) | null = null;
  private readonly config: InternalConfig;

  constructor(options: ReconnectionOptions = {}) {
    this.config = {
      maxRetries: options.maxRetries ?? 5,
      baseDelayMs: options.baseDelayMs ?? 1000,
      maxDelayMs: options.maxDelayMs ?? 30000,
      backoffMultiplier: options.backoffMultiplier ?? 2,
      onStateChange: options.onStateChange,
      onReconnected: options.onReconnected,
      onExhausted: options.onExhausted,
    };
  }

  getState(): ConnectionState {
    return this.state;
  }

  private setState(newState: ConnectionState): void {
    if (this.state === newState) return;
    this.state = newState;
    this.config.onStateChange?.(newState);
  }

  /** Initiates automatic reconnection after a disconnection. */
  async handleDisconnect(connectFn: () => Promise<void>): Promise<void> {
    if (this.state === 'reconnecting') return;
    this.retryCount = 0;
    this.setState('disconnected');
    await this.attempt(connectFn);
  }

  /** Manually notify that connection is healthy (resets internal state). */
  markConnected(): void {
    this.retryCount = 0;
    this.cancelPending();
    this.setState('connected');
  }

  private async attempt(connectFn: () => Promise<void>): Promise<void> {
    if (this.retryCount >= this.config.maxRetries) {
      const err = new Error(
        `Network reconnection exhausted after ${this.config.maxRetries} attempts`
      );
      this.setState('disconnected');
      this.config.onExhausted?.(err);
      return;
    }

    this.setState('reconnecting');

    const delay = Math.min(
      this.config.baseDelayMs *
        Math.pow(this.config.backoffMultiplier, this.retryCount),
      this.config.maxDelayMs
    );

    try {
      await this.sleep(delay);
    } catch {
      // Sleep was cancelled via destroy() or markConnected()
      return;
    }

    try {
      await connectFn();
      this.retryCount = 0;
      this.setState('connected');
      this.config.onReconnected?.();
    } catch {
      this.retryCount++;
      await this.attempt(connectFn);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.rejectPending = reject;
      this.timer = setTimeout(() => {
        this.rejectPending = null;
        resolve();
      }, ms);
    });
  }

  private cancelPending(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.rejectPending) {
      this.rejectPending(new Error('Cancelled'));
      this.rejectPending = null;
    }
  }

  /** Aborts any pending reconnection attempts and cleans up resources. */
  destroy(): void {
    this.cancelPending();
    this.setState('disconnected');
  }
}
