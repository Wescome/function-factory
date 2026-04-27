// gdk-ts/src/client.ts — KernelClient: HTTP client to the AOMA Kernel
// Per SDD-GDK §3.1: All requests carry Authorization, X-Assembly-ID,
// X-Idempotency-Key, X-Work-Order-ID headers.
// Per CONSOLE-10: All requests use retry with exponential backoff + circuit breaker.
// Per CONSOLE-11: All requests create OpenTelemetry spans when observability enabled.

import type { ExecutionStatus } from "./types.js";
import type {
  CircuitBreakerConfig,
  RetryConfig,
  ResilienceEventHandlers,
  CircuitState,
} from "./resilience.js";
import { ResilienceWrapper } from "./resilience.js";
import { getObservability, type GDKContext } from "./observability.js";

/** Request to create a work order. */
export interface CreateWorkOrderRequest {
  assemblyId: string;
  purposeId: string;
  workType: string;
  autonomyTier: string;
  intentClass?: string;
  context?: Record<string, unknown>;
  reversible?: boolean;
  reversibleSecs?: number;
  idempotencyKey: string;
  parentId?: string;
}

/** PDP evaluate request. */
export interface PDPDecideRequest {
  subject: { subjectId: string };
  action: { actionId: string };
  resource: { resourceType: string };
  context: {
    workOrderId: string;
    assemblyId: string;
    autonomyTier: string;
  };
}

/** PDP evaluate response. */
export interface PDPDecideResponse {
  policyDecisionId: string;
  decision: "PERMIT" | "DENY";
  evaluatedAt: string;
  reasons?: Array<{ code?: string; summary?: string }>;
}

/** Configuration options for KernelClient. */
export interface KernelClientOptions {
  endpoint: string;
  authToken: string;
  assemblyId?: string;
  circuitBreaker?: CircuitBreakerConfig;
  retry?: RetryConfig;
  eventHandlers?: ResilienceEventHandlers;
}

/**
 * KernelClient handles HTTP communication with the AOMA Kernel.
 * All endpoints carry the 4 required headers per SDD-GDK §3.1.
 * All requests use retry with exponential backoff and circuit breaker per CONSOLE-10.
 * OpenTelemetry spans are created for each kernel request when observability
 * is enabled (CONSOLE-11).
 */
export class KernelClient {
  private readonly endpoint: string;
  private readonly authToken: string;
  private assemblyId: string;
  private readonly resilience: ResilienceWrapper;
  private observability = getObservability();

  /** Overridable for testing — MockGovernance replaces this. */
  fetchFn: typeof fetch;

  /**
   * Event handlers for resilience events.
   * @deprecated Use eventHandlers in constructor options instead
   */
  onRetry?: (attempt: number, delayMs: number) => void;
  onCircuitOpen?: () => void;
  onCircuitClose?: () => void;

  constructor(
    endpointOrOptions: string | KernelClientOptions,
    authToken?: string,
    assemblyId?: string
  ) {
    // Support both old and new constructor signatures
    if (typeof endpointOrOptions === 'string') {
      // Legacy constructor: (endpoint, authToken, assemblyId)
      this.endpoint = endpointOrOptions.replace(/\/$/, "");
      this.authToken = authToken!;
      this.assemblyId = assemblyId ?? "";
      this.resilience = new ResilienceWrapper();
    } else {
      // New constructor with options object
      const opts = endpointOrOptions;
      this.endpoint = opts.endpoint.replace(/\/$/, "");
      this.authToken = opts.authToken;
      this.assemblyId = opts.assemblyId ?? "";
      this.resilience = new ResilienceWrapper(
        opts.circuitBreaker,
        opts.retry,
        opts.eventHandlers
      );
      // Also set legacy handlers for backward compatibility
      this.onRetry = opts.eventHandlers?.onRetry;
      this.onCircuitOpen = opts.eventHandlers?.onCircuitOpen;
      this.onCircuitClose = opts.eventHandlers?.onCircuitClose;
    }
    this.fetchFn = globalThis.fetch.bind(globalThis);
  }

  setAssemblyId(id: string): void {
    this.assemblyId = id;
  }

  /** Current circuit breaker state. */
  get circuitState(): CircuitState {
    return this.resilience.circuitState;
  }

  private headers(idempotencyKey?: string, workOrderId?: string): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.authToken}`,
      "X-Assembly-ID": this.assemblyId,
    };
    if (idempotencyKey) h["X-Idempotency-Key"] = idempotencyKey;
    if (workOrderId) h["X-Work-Order-ID"] = workOrderId;
    return h;
  }

  /** Execute a fetch with retry and circuit breaker protection. */
  private async executeWithResilience<T>(
    operation: () => Promise<T>,
    _operationName: string
  ): Promise<T> {
    return this.resilience.execute(operation);
  }

  /** POST /v1/workorders — returns work order ID. */
  async createWorkOrder(req: CreateWorkOrderRequest): Promise<string> {
    const ctx = this.buildGDKContext(req.assemblyId, req.purposeId, req.idempotencyKey);
    const span = this.observability.startKernelRequestSpan("[gdk.kernel.request]", ctx, "createWorkOrder");
    
    const startTime = performance.now();
    
    try {
      const result = await this.executeWithResilience(async () => {
        const res = await this.fetchFn(`${this.endpoint}/v1/workorders`, {
          method: "POST",
          headers: this.headers(req.idempotencyKey),
          body: JSON.stringify({
            assembly_id: req.assemblyId,
            purpose_id: req.purposeId,
            work_type: req.workType,
            autonomy_tier: req.autonomyTier,
            intent_class: req.intentClass,
            context: req.context,
            reversible: req.reversible,
            reversible_window_seconds: req.reversibleSecs,
            idempotency_key: req.idempotencyKey,
          }),
        });
        if (!res.ok) {
          span.setAttribute("error", true);
          span.setAttribute("http.status_code", res.status);
          throw new Error(`kernel: createWorkOrder failed (${res.status})`);
        }
        const body = (await res.json()) as { work_order_id: string };
        span.setAttribute("work_order_id", body.work_order_id);
        span.setAttribute("http.status_code", res.status);
        return body.work_order_id;
      }, 'createWorkOrder');
      
      return result;
    } catch (error) {
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      throw error;
    } finally {
      const duration = performance.now() - startTime;
      this.observability.recordKernelDuration(duration, {
        operation: "createWorkOrder",
        assembly_id: req.assemblyId,
      });
      span.end();
    }
  }

  /** POST /v1/workorders/{id}/children — returns child work order ID. */
  async createChildWorkOrder(parentId: string, req: CreateWorkOrderRequest): Promise<string> {
    const ctx = this.buildGDKContext(req.assemblyId, req.purposeId, req.idempotencyKey);
    const span = this.observability.startKernelRequestSpan("[gdk.kernel.request]", ctx, "createChildWorkOrder");
    
    const startTime = performance.now();
    
    try {
      const result = await this.executeWithResilience(async () => {
        const res = await this.fetchFn(`${this.endpoint}/v1/workorders/${parentId}/children`, {
          method: "POST",
          headers: this.headers(req.idempotencyKey, parentId),
          body: JSON.stringify({
            assembly_id: req.assemblyId,
            purpose_id: req.purposeId,
            work_type: req.workType,
            autonomy_tier: req.autonomyTier,
            intent_class: req.intentClass,
            context: req.context,
            idempotency_key: req.idempotencyKey,
          }),
        });
        if (!res.ok) {
          span.setAttribute("error", true);
          span.setAttribute("http.status_code", res.status);
          throw new Error(`kernel: createChildWorkOrder failed (${res.status})`);
        }
        const body = (await res.json()) as { work_order_id: string };
        span.setAttribute("work_order_id", body.work_order_id);
        span.setAttribute("http.status_code", res.status);
        return body.work_order_id;
      }, 'createChildWorkOrder');
      
      return result;
    } catch (error) {
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      throw error;
    } finally {
      const duration = performance.now() - startTime;
      this.observability.recordKernelDuration(duration, {
        operation: "createChildWorkOrder",
        assembly_id: req.assemblyId,
      });
      span.end();
    }
  }

  /** GET /v1/workorders/{id} — returns execution status. */
  async getWorkOrder(workOrderId: string): Promise<ExecutionStatus> {
    // For getWorkOrder, we don't have full context - use minimal context
    const ctx = this.buildMinimalContext(workOrderId);
    const span = this.observability.startKernelRequestSpan("[gdk.kernel.request]", ctx, "getWorkOrder");
    
    const startTime = performance.now();
    
    try {
      const result = await this.executeWithResilience(async () => {
        const res = await this.fetchFn(`${this.endpoint}/v1/workorders/${workOrderId}`, {
          method: "GET",
          headers: this.headers(undefined, workOrderId),
        });
        if (!res.ok) {
          span.setAttribute("error", true);
          span.setAttribute("http.status_code", res.status);
          throw new Error(`kernel: getWorkOrder failed (${res.status})`);
        }
        const body = (await res.json()) as {
          work_order_id: string;
          status: string;
          autonomy_tier: string;
          primary_purpose?: string;
        };
        
        span.setAttribute("http.status_code", res.status);
        span.setAttribute("workorder.status", body.status);
        
        return {
          workOrderId: body.work_order_id,
          status: body.status as ExecutionStatus["status"],
          autonomyTier: body.autonomy_tier as ExecutionStatus["autonomyTier"],
          primaryPurpose: body.primary_purpose,
        };
      }, 'getWorkOrder');
      
      return result;
    } catch (error) {
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      throw error;
    } finally {
      const duration = performance.now() - startTime;
      this.observability.recordKernelDuration(duration, {
        operation: "getWorkOrder",
        work_order_id: workOrderId,
      });
      span.end();
    }
  }

  /** POST /v1/pdp/decide — evaluates policy. */
  async evaluatePolicy(req: PDPDecideRequest): Promise<PDPDecideResponse> {
    const ctx = this.buildGDKContextFromPDP(req);
    const span = this.observability.startGovernanceSpan("[gdk.governance.evaluate]", ctx);
    
    // Record gate evaluation metric
    this.observability.recordGateEvaluated({
      assembly_id: req.context.assemblyId,
      action_id: req.action.actionId,
    });
    
    const startTime = performance.now();
    
    try {
      const result = await this.executeWithResilience(async () => {
        const res = await this.fetchFn(`${this.endpoint}/v1/pdp/decide`, {
          method: "POST",
          headers: this.headers(undefined, req.context.workOrderId),
          body: JSON.stringify({
            subject: { subject_id: req.subject.subjectId },
            action: { action_id: req.action.actionId },
            resource: { resource_type: req.resource.resourceType },
            context: {
              work_order_id: req.context.workOrderId,
              assembly_id: req.context.assemblyId,
              autonomy_tier: req.context.autonomyTier,
            },
          }),
        });
        if (!res.ok) {
          span.setAttribute("error", true);
          span.setAttribute("http.status_code", res.status);
          throw new Error(`kernel: evaluatePolicy failed (${res.status})`);
        }
        const body = (await res.json()) as {
          policy_decision_id: string;
          decision: string;
          evaluated_at: string;
          reasons?: Array<{ code?: string; summary?: string }>;
        };
        
        const decision = body.decision as "PERMIT" | "DENY";
        
        span.setAttribute("http.status_code", res.status);
        span.setAttribute("gdk.governance.decision", decision);
        span.setAttribute("policy_decision_id", body.policy_decision_id);
        
        // Record governance decision metrics
        this.observability.recordGovernanceDecision(
          span,
          decision,
          body.reasons?.[0]?.summary
        );
        
        return {
          policyDecisionId: body.policy_decision_id,
          decision,
          evaluatedAt: body.evaluated_at,
          reasons: body.reasons,
        };
      }, 'evaluatePolicy');
      
      return result;
    } catch (error) {
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      throw error;
    } finally {
      const duration = performance.now() - startTime;
      this.observability.recordKernelDuration(duration, {
        operation: "evaluatePolicy",
        assembly_id: req.context.assemblyId,
      });
      span.end();
    }
  }

  /** GET /v1/evidence/{id} — returns evidence entry. */
  async getEvidence(evidenceId: string): Promise<Record<string, unknown>> {
    const ctx = this.buildMinimalContext("");
    const span = this.observability.startEvidenceSpan("[gdk.evidence.read]", ctx);
    
    const startTime = performance.now();
    
    try {
      const result = await this.executeWithResilience(async () => {
        const res = await this.fetchFn(`${this.endpoint}/v1/evidence/${evidenceId}`, {
          method: "GET",
          headers: this.headers(),
        });
        if (!res.ok) {
          span.setAttribute("error", true);
          span.setAttribute("http.status_code", res.status);
          throw new Error(`kernel: getEvidence failed (${res.status})`);
        }
        
        span.setAttribute("http.status_code", res.status);
        
        return (await res.json()) as Record<string, unknown>;
      }, 'getEvidence');
      
      return result;
    } catch (error) {
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      throw error;
    } finally {
      const duration = performance.now() - startTime;
      this.observability.recordKernelDuration(duration, {
        operation: "getEvidence",
        evidence_id: evidenceId,
      });
      span.end();
    }
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private buildGDKContext(assemblyId: string, purposeId: string, idempotencyKey: string): GDKContext {
    // Extract session/work order info from idempotency key if available
    // Format: {sessionId}_turn{turn}_{toolCallId} or wo_{assemblyId}_{timestamp}
    const parts = idempotencyKey.split("_");
    const sessionId = parts.length >= 2 && parts[0].startsWith("csess") 
      ? parts.slice(0, 2).join("_") 
      : `sess_${Date.now()}`;
    const workOrderId = parts.length >= 2 && parts[0] === "wo"
      ? idempotencyKey 
      : `wo_${assemblyId}_${Date.now()}`;
    
    return {
      assemblyId,
      purposeId,
      actorId: "kernel-client",
      sessionId,
      workOrderId,
      autonomyTier: 0, // Default to AUTONOMOUS
    };
  }

  private buildGDKContextFromPDP(req: PDPDecideRequest): GDKContext {
    return {
      assemblyId: req.context.assemblyId,
      purposeId: "pdp-evaluation",
      actorId: req.subject.subjectId,
      sessionId: `sess_${req.context.workOrderId}`,
      workOrderId: req.context.workOrderId,
      autonomyTier: this.parseAutonomyTier(req.context.autonomyTier),
    };
  }

  private buildMinimalContext(workOrderId: string): GDKContext {
    return {
      assemblyId: this.assemblyId,
      purposeId: "unknown",
      actorId: "kernel-client",
      sessionId: `sess_${Date.now()}`,
      workOrderId: workOrderId || `wo_${Date.now()}`,
      autonomyTier: 0,
    };
  }

  private parseAutonomyTier(tier: string): number {
    switch (tier) {
      case "T0": return 0;
      case "T1": return 1;
      case "T2": return 2;
      case "T99": return 99;
      default: return 0;
    }
  }
}

// Re-export resilience types for convenience
export type { CircuitBreakerConfig, RetryConfig, ResilienceEventHandlers, CircuitState } from './resilience.js';
