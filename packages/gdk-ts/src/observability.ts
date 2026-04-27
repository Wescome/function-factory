/**
 * OpenTelemetry Observability for GDK
 *
 * Per CONSOLE-11: Every governed action becomes a span.
 * Every gate decision becomes a metric.
 *
 * Zero-dependency when disabled: If OTEL_EXPORTER_OTLP_ENDPOINT is not set,
 * observability is a no-op with zero performance overhead.
 */

import type { Tier } from "./types.js";

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Observability configuration for GDK
 */
export interface ObservabilityConfig {
  /** Whether observability is enabled. Default: true if OTEL_EXPORTER_OTLP_ENDPOINT set */
  enabled?: boolean;
  /** Service name for traces. Default: "gdk-agent" */
  serviceName?: string;
  /** OTLP exporter endpoint. Default: from OTEL_EXPORTER_OTLP_ENDPOINT env var */
  exporterEndpoint?: string;
  /** Sampling rate (0.0-1.0). Default: 1.0 (sample everything) */
  sampleRate?: number;
}

/**
 * Context for creating spans with GDK-specific attributes
 */
export interface GDKContext {
  assemblyId: string;
  purposeId: string;
  actorId: string;
  sessionId: string;
  workOrderId: string;
  autonomyTier: Tier;
}

/**
 * Tool-specific context for tool spans
 */
export interface ToolContext extends GDKContext {
  toolName: string;
  sideEffect: string;
}

// ============================================================================
// No-Op Implementations (Zero overhead when disabled)
// ============================================================================

/** No-op span that satisfies the Span interface with zero overhead */
class NoOpSpan {
  private _ended = false;

  setAttribute(_key: string, _value: unknown): this {
    return this;
  }

  setAttributes(_attrs: Record<string, unknown>): this {
    return this;
  }

  addEvent(_name: string, _attributes?: Record<string, unknown>): this {
    return this;
  }

  recordException(_exception: unknown): this {
    return this;
  }

  end(): void {
    this._ended = true;
  }

  isEnded(): boolean {
    return this._ended;
  }
}

/** No-op tracer that returns no-op spans */
class NoOpTracer {
  startSpan(_name: string, _options?: unknown): NoOpSpan {
    return new NoOpSpan();
  }
}

/** No-op meter that returns no-op instruments */
class NoOpMeter {
  createCounter(_name: string, _options?: unknown): NoOpCounter {
    return new NoOpCounter();
  }

  createHistogram(_name: string, _options?: unknown): NoOpHistogram {
    return new NoOpHistogram();
  }

  createUpDownCounter(_name: string, _options?: unknown): NoOpUpDownCounter {
    return new NoOpUpDownCounter();
  }
}

/** No-op counter */
class NoOpCounter {
  add(_value: number, _attributes?: Record<string, unknown>): void {
    // No-op
  }
}

/** No-op histogram */
class NoOpHistogram {
  record(_value: number, _attributes?: Record<string, unknown>): void {
    // No-op
  }
}

/** No-op up-down counter (for gauges) */
class NoOpUpDownCounter {
  add(_value: number, _attributes?: Record<string, unknown>): void {
    // No-op
  }
}

// ============================================================================
// Lazy-loaded OpenTelemetry (dynamic import for zero-dependency)
// ============================================================================

interface OTelAPI {
  trace: {
    getTracer: (name: string, version?: string) => Tracer;
  };
  metrics: {
    getMeter: (name: string, version?: string) => Meter;
  };
  context: {
    active: () => Context;
    with: <A extends unknown[], F extends (...args: A) => unknown>(
      context: Context,
      fn: F,
      ...args: A
    ) => ReturnType<F>;
  };
}

interface Tracer {
  startSpan: (name: string, options?: SpanOptions, context?: Context) => Span;
}

interface Meter {
  createCounter: (name: string, options?: InstrumentOptions) => Counter;
  createHistogram: (name: string, options?: InstrumentOptions) => Histogram;
  createUpDownCounter: (name: string, options?: InstrumentOptions) => UpDownCounter;
}

interface Span {
  setAttribute(key: string, value: unknown): this;
  setAttributes(attrs: Record<string, unknown>): this;
  addEvent(name: string, attributes?: Record<string, unknown>): this;
  recordException(exception: unknown): this;
  end(endTime?: number): void;
}

interface SpanOptions {
  kind?: number;
  attributes?: Record<string, unknown>;
  parent?: Span | Context;
  startTime?: number;
}

interface Context {
  getValue(key: symbol): unknown;
  setValue(key: symbol, value: unknown): Context;
  deleteValue(key: symbol): Context;
}

interface InstrumentOptions {
  description?: string;
  unit?: string;
}

interface Counter {
  add(value: number, attributes?: Record<string, unknown>): void;
}

interface Histogram {
  record(value: number, attributes?: Record<string, unknown>): void;
}

interface UpDownCounter {
  add(value: number, attributes?: Record<string, unknown>): void;
}

// ============================================================================
// Observability Manager
// ============================================================================

/**
 * GDKObservability manages OpenTelemetry traces and metrics for GDK.
 *
 * When disabled (no OTEL_EXPORTER_OTLP_ENDPOINT), all operations are no-ops
 * with zero performance overhead.
 */
export class GDKObservability {
  private config: Required<ObservabilityConfig>;
  private otel: OTelAPI | null = null;
  private tracer: Tracer | NoOpTracer = new NoOpTracer();
  private meter: Meter | NoOpMeter = new NoOpMeter();
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  // Metrics instruments
  private gatesEvaluatedCounter: Counter | NoOpCounter = new NoOpCounter();
  private gatesPermittedCounter: Counter | NoOpCounter = new NoOpCounter();
  private gatesDeniedCounter: Counter | NoOpCounter = new NoOpCounter();
  private kernelRequestDurationHistogram: Histogram | NoOpHistogram = new NoOpHistogram();
  private toolExecutionDurationHistogram: Histogram | NoOpHistogram = new NoOpHistogram();
  private sessionTokensCounter: Counter | NoOpCounter = new NoOpCounter();
  private sessionCostCounter: Counter | NoOpCounter = new NoOpCounter();
  private circuitStateGauge: UpDownCounter | NoOpUpDownCounter = new NoOpUpDownCounter();

  constructor(config: ObservabilityConfig = {}) {
    const envEndpoint = getEnv("OTEL_EXPORTER_OTLP_ENDPOINT");
    const envEnabled = envEndpoint ? true : false;

    this.config = {
      enabled: config.enabled ?? envEnabled,
      serviceName: config.serviceName ?? getEnv("OTEL_SERVICE_NAME") ?? "gdk-agent",
      exporterEndpoint: config.exporterEndpoint ?? envEndpoint ?? "",
      sampleRate: config.sampleRate ?? 1.0,
    };

    // If explicitly disabled, stay as no-op
    if (!this.config.enabled) {
      return;
    }

    // Lazy initialization - don't block constructor
    this.initPromise = this.initialize();
  }

  /**
   * Wait for initialization to complete (useful for tests)
   */
  async ready(): Promise<void> {
    if (this.initPromise) {
      await this.initPromise;
    }
  }

  /**
   * Check if observability is actually enabled (after env check)
   */
  isEnabled(): boolean {
    return this.config.enabled && this.initialized;
  }

  /**
   * Initialize OpenTelemetry SDK (lazy-loaded)
   */
  private async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Dynamic import - only loads OTel when enabled
      const { trace, metrics, context } = await import("@opentelemetry/api");
      this.otel = { trace, metrics, context };

      // Initialize tracer and meter
      this.tracer = this.otel.trace.getTracer(this.config.serviceName, "0.1.0");
      this.meter = this.otel.metrics.getMeter(this.config.serviceName, "0.1.0");

      // Initialize metrics instruments
      this.gatesEvaluatedCounter = this.meter.createCounter("gdk.gates.evaluated", {
        description: "Total number of gate evaluations",
      });
      this.gatesPermittedCounter = this.meter.createCounter("gdk.gates.permitted", {
        description: "Number of PERMIT decisions",
      });
      this.gatesDeniedCounter = this.meter.createCounter("gdk.gates.denied", {
        description: "Number of DENY decisions",
      });
      this.kernelRequestDurationHistogram = this.meter.createHistogram("gdk.kernel.request.duration", {
        description: "Kernel HTTP request latency in milliseconds",
        unit: "ms",
      });
      this.toolExecutionDurationHistogram = this.meter.createHistogram("gdk.tool.execution.duration", {
        description: "Tool execution time in milliseconds",
        unit: "ms",
      });
      this.sessionTokensCounter = this.meter.createCounter("gdk.session.tokens", {
        description: "Total input + output tokens",
      });
      this.sessionCostCounter = this.meter.createCounter("gdk.session.cost", {
        description: "Estimated session cost in USD cents",
        unit: "cents",
      });
      this.circuitStateGauge = this.meter.createUpDownCounter("gdk.circuit.state", {
        description: "Circuit breaker state (0=closed, 1=half-open, 2=open)",
      });

      this.initialized = true;
    } catch (error) {
      // If OTel fails to load, degrade gracefully to no-op
      console.warn("GDK Observability: Failed to initialize OpenTelemetry:", error);
      this.config.enabled = false;
    }
  }

  // ============================================================================
  // Span Creation
  // ============================================================================

  /**
   * Create a root session span
   */
  startSessionSpan(name: string, ctx: GDKContext): Span | NoOpSpan {
    const span = this.tracer.startSpan(name, {
      kind: 1, // SpanKind.SERVER
      attributes: this.buildGDKAttributes(ctx),
    });

    span.setAttribute("span.type", "session");
    return span;
  }

  /**
   * Create a turn span (child of session)
   */
  startTurnSpan(name: string, ctx: GDKContext, parentSpan: Span | NoOpSpan): Span | NoOpSpan {
    const span = this.tracer.startSpan(name, {
      kind: 1, // SpanKind.SERVER
      attributes: {
        ...this.buildGDKAttributes(ctx),
        "turn.number": ctx.sessionId.split("_").pop() ?? "0",
      },
    });

    span.setAttribute("span.type", "turn");
    return span;
  }

  /**
   * Create a governance evaluation span
   */
  startGovernanceSpan(name: string, ctx: GDKContext): Span | NoOpSpan {
    const span = this.tracer.startSpan(name, {
      kind: 2, // SpanKind.CLIENT
      attributes: this.buildGDKAttributes(ctx),
    });

    span.setAttribute("span.type", "governance");
    return span;
  }

  /**
   * Create a kernel request span (child of governance)
   */
  startKernelRequestSpan(name: string, ctx: GDKContext, operation: string): Span | NoOpSpan {
    const span = this.tracer.startSpan(name, {
      kind: 2, // SpanKind.CLIENT
      attributes: {
        ...this.buildGDKAttributes(ctx),
        "kernel.operation": operation,
      },
    });

    span.setAttribute("span.type", "kernel");
    return span;
  }

  /**
   * Create a tool execution span
   */
  startToolSpan(name: string, ctx: ToolContext): Span | NoOpSpan {
    const span = this.tracer.startSpan(name, {
      kind: 2, // SpanKind.CLIENT
      attributes: {
        ...this.buildGDKAttributes(ctx),
        "gdk.tool.name": ctx.toolName,
        "gdk.tool.side_effect": ctx.sideEffect,
      },
    });

    span.setAttribute("span.type", "tool");
    return span;
  }

  /**
   * Create an evidence commit span
   */
  startEvidenceSpan(name: string, ctx: GDKContext): Span | NoOpSpan {
    const span = this.tracer.startSpan(name, {
      kind: 2, // SpanKind.CLIENT
      attributes: this.buildGDKAttributes(ctx),
    });

    span.setAttribute("span.type", "evidence");
    return span;
  }

  /**
   * Create a work order lifecycle span
   */
  startWorkOrderSpan(name: string, ctx: GDKContext, operation: "create" | "close"): Span | NoOpSpan {
    const span = this.tracer.startSpan(name, {
      kind: 2, // SpanKind.CLIENT
      attributes: {
        ...this.buildGDKAttributes(ctx),
        "workorder.operation": operation,
      },
    });

    span.setAttribute("span.type", "workorder");
    return span;
  }

  // ============================================================================
  // Metrics Recording
  // ============================================================================

  /**
   * Record a gate evaluation
   */
  recordGateEvaluated(attributes?: Record<string, unknown>): void {
    this.gatesEvaluatedCounter.add(1, attributes);
  }

  /**
   * Record a PERMIT decision
   */
  recordGatePermitted(attributes?: Record<string, unknown>): void {
    this.gatesPermittedCounter.add(1, attributes);
  }

  /**
   * Record a DENY decision
   */
  recordGateDenied(attributes?: Record<string, unknown>): void {
    this.gatesDeniedCounter.add(1, attributes);
  }

  /**
   * Record kernel request duration
   */
  recordKernelDuration(durationMs: number, attributes?: Record<string, unknown>): void {
    this.kernelRequestDurationHistogram.record(durationMs, attributes);
  }

  /**
   * Record tool execution duration
   */
  recordToolDuration(durationMs: number, attributes?: Record<string, unknown>): void {
    this.toolExecutionDurationHistogram.record(durationMs, attributes);
  }

  /**
   * Record token usage
   */
  recordTokens(inputTokens: number, outputTokens: number, attributes?: Record<string, unknown>): void {
    this.sessionTokensCounter.add(inputTokens + outputTokens, attributes);
  }

  /**
   * Record estimated cost (in cents)
   */
  recordCost(costCents: number, attributes?: Record<string, unknown>): void {
    this.sessionCostCounter.add(costCents, attributes);
  }

  /**
   * Record circuit breaker state
   * @param state 0=closed, 1=half-open, 2=open
   */
  recordCircuitState(state: 0 | 1 | 2, attributes?: Record<string, unknown>): void {
    // Use a delta to set the gauge value
    this.circuitStateGauge.add(state, attributes);
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Build standard GDK attributes for spans
   */
  private buildGDKAttributes(ctx: GDKContext): Record<string, unknown> {
    return {
      "gdk.assembly_id": ctx.assemblyId,
      "gdk.purpose_id": ctx.purposeId,
      "gdk.actor_id": ctx.actorId,
      "gdk.session_id": ctx.sessionId,
      "gdk.work_order_id": ctx.workOrderId,
      "gdk.autonomy_tier": ctx.autonomyTier,
    };
  }

  /**
   * Record governance decision on a span
   */
  recordGovernanceDecision(span: Span | NoOpSpan, decision: "PERMIT" | "DENY", reason?: string): void {
    span.setAttribute("gdk.governance.decision", decision);
    if (reason) {
      span.setAttribute("gdk.governance.reason", reason);
    }

    // Also record metrics
    if (decision === "PERMIT") {
      this.recordGatePermitted();
    } else {
      this.recordGateDenied();
    }
  }

  /**
   * Wrap a function with a span
   */
  async withSpan<T>(
    span: Span | NoOpSpan,
    fn: () => Promise<T>,
    onError?: (error: unknown) => void
  ): Promise<T> {
    try {
      const result = await fn();
      span.end();
      return result;
    } catch (error) {
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      span.end();
      onError?.(error);
      throw error;
    }
  }

  /**
   * Wrap a function with timing metric
   */
  async withTiming<T>(
    metricFn: (durationMs: number) => void,
    fn: () => Promise<T>
  ): Promise<T> {
    const start = performance.now();
    try {
      return await fn();
    } finally {
      const duration = performance.now() - start;
      metricFn(duration);
    }
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let globalObservability: GDKObservability | null = null;

/**
 * Get or create the global observability instance
 */
export function getObservability(config?: ObservabilityConfig): GDKObservability {
  if (!globalObservability) {
    globalObservability = new GDKObservability(config);
  }
  return globalObservability;
}

/**
 * Reset the global observability instance (for testing)
 */
export function resetObservability(): void {
  globalObservability = null;
}

/**
 * Configure observability with explicit settings
 */
export function configureObservability(config: ObservabilityConfig): GDKObservability {
  globalObservability = new GDKObservability(config);
  return globalObservability;
}

// ============================================================================
// Utility Functions
// ============================================================================

/** Safe env var access that works in Node, Bun, and browser */
function getEnv(key: string): string | undefined {
  try {
    return (globalThis as Record<string, any>).process?.env?.[key] as string | undefined;
  } catch {
    return undefined;
  }
}

/**
 * Create a GDK context from session state
 */
export function createGDKContext(
  assemblyId: string,
  purposeId: string,
  actorId: string,
  sessionId: string,
  workOrderId: string,
  autonomyTier: Tier
): GDKContext {
  return {
    assemblyId,
    purposeId,
    actorId,
    sessionId,
    workOrderId,
    autonomyTier,
  };
}

/**
 * Create a tool context from GDK context
 */
export function createToolContext(
  ctx: GDKContext,
  toolName: string,
  sideEffect: string
): ToolContext {
  return {
    ...ctx,
    toolName,
    sideEffect,
  };
}
