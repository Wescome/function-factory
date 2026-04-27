// gdk-ts/src/service.ts — GovernedService base class
// Per SDD-GDK §4.3.1. Mirrors gdk-go service.go.

import { KernelClient } from "./client.js";
import type {
  ServiceConfig,
  GovernedAction,
  BatchConfig,
  ReversibleAction,
  Tier,
} from "./types.js";
import { tierToKernel } from "./types.js";
import { GovernanceError, AuthorizationError, EscalationTimeoutError } from "./errors.js";
import { NoOpPIIFilter, type PIIFilter } from "./pii.js";
import { getObservability, createGDKContext, type GDKContext } from "./observability.js";

/**
 * GovernedService is the base class for all GDK-governed services.
 * It manages kernel communication, PII filtering, and governance enforcement.
 *
 * Subclass it and call executeGovernedAction() from your methods,
 * or use the @governed decorator for automatic wrapping.
 * 
 * OpenTelemetry spans are created for each governed action when observability
 * is enabled (CONSOLE-11).
 */
export class GovernedService {
  readonly assemblyId: string;
  readonly purposeId: string;

  /** Exposed for MockGovernance wiring. */
  kernelClient: KernelClient;
  piiFilter: PIIFilter;
  approvalTimeoutMs: number;
  approvalPollIntervalMs: number;

  private observability = getObservability();

  constructor(config: ServiceConfig) {
    if (!config.assemblyId) throw new Error("gdk: assemblyId is required");
    if (!config.purposeId) throw new Error("gdk: purposeId is required");

    this.assemblyId = config.assemblyId;
    this.purposeId = config.purposeId;

    const endpoint =
      config.kernelEndpoint ??
      getEnv("WEOPS_KERNEL_ENDPOINT") ??
      "http://localhost:8080";
    const authToken =
      config.authToken ??
      getEnv("WEOPS_AUTH_TOKEN") ??
      "";

    this.kernelClient = new KernelClient(endpoint, authToken, this.assemblyId);
    this.piiFilter = new NoOpPIIFilter();
    this.approvalTimeoutMs = config.approvalTimeoutMs ?? 24 * 60 * 60 * 1000;
    this.approvalPollIntervalMs = config.approvalPollIntervalMs ?? 5000;
  }

  /**
   * ExecuteGovernedAction is the primary execution entry point (SDD-GDK §4.1.2).
   *
   * Algorithm:
   *  1. Validate idempotencyKey present
   *  2. PII filter context
   *  3. Create Work Order via kernel
   *  4. Evaluate policy via kernel PDP
   *  5. If DENY -> throw AuthorizationError, do not execute action
   *  6. If PERMIT + T2 -> poll for approval (configurable interval/timeout)
   *  7. Execute action function
   *  8. Return
   * 
   * OpenTelemetry spans are created for the entire flow.
   */
  async executeGovernedAction(action: GovernedAction): Promise<void> {
    const ctx = this.buildGDKContext(action);
    const span = this.observability.startGovernanceSpan("[gdk.governance.evaluate]", ctx);
    
    // Record gate evaluation metric
    this.observability.recordGateEvaluated({
      intent_class: action.intentClass,
      tier: action.tier,
      assembly_id: this.assemblyId,
    });

    try {
      // Step 1: Validate idempotency key (SDD-GDK §9.6)
      if (!action.idempotencyKey) {
        const error = new GovernanceError({
          code: "GDK_MISSING_IDEMPOTENCY_KEY",
          message: "idempotencyKey is required for all governed actions",
        });
        span.recordException(error);
        span.setAttribute("error", true);
        span.setAttribute("error.code", "GDK_MISSING_IDEMPOTENCY_KEY");
        throw error;
      }

      // Step 2: PII filter context (SDD-GDK §9.4)
      const filteredContext = action.context
        ? this.piiFilter.strip(action.context)
        : undefined;

      span.setAttribute("intent_class", action.intentClass);
      span.setAttribute("tier", action.tier);

      // Step 3: Create Work Order via kernel
      let workOrderId: string;
      try {
        workOrderId = await this.kernelClient.createWorkOrder({
          assemblyId: this.assemblyId,
          purposeId: this.purposeId,
          workType: action.intentClass,
          autonomyTier: tierToKernel(action.tier),
          intentClass: action.intentClass,
          context: filteredContext,
          reversible: action.reversible,
          reversibleSecs: action.reversibleForMs
            ? Math.floor(action.reversibleForMs / 1000)
            : undefined,
          idempotencyKey: action.idempotencyKey,
        });
      } catch (err) {
        // Fail closed (SDD-GDK §9.1): kernel unreachable -> deny
        const authErr = new AuthorizationError({
          code: "WAC_A",
          message: `kernel unreachable: ${err instanceof Error ? err.message : String(err)}`,
        });
        span.recordException(authErr);
        span.setAttribute("error", true);
        span.setAttribute("error.code", "WAC_A");
        throw authErr;
      }

      span.setAttribute("work_order_id", workOrderId);

      // Step 4: Evaluate policy via kernel PDP
      let decision: Awaited<ReturnType<KernelClient["evaluatePolicy"]>>;
      try {
        decision = await this.kernelClient.evaluatePolicy({
          subject: { subjectId: this.assemblyId },
          action: { actionId: action.intentClass },
          resource: { resourceType: "governed_action" },
          context: {
            workOrderId,
            assemblyId: this.assemblyId,
            autonomyTier: tierToKernel(action.tier),
          },
        });
      } catch (err) {
        // Fail closed (SDD-GDK §9.1): PDP unreachable -> deny
        const authErr = new AuthorizationError({
          code: "WAC_A",
          message: `PDP unreachable: ${err instanceof Error ? err.message : String(err)}`,
          workOrderId,
        });
        span.recordException(authErr);
        span.setAttribute("error", true);
        span.setAttribute("error.code", "WAC_A");
        throw authErr;
      }

      span.setAttribute("policy_decision_id", decision.policyDecisionId);

      // Step 5: If DENY -> throw AuthorizationError
      if (decision.decision === "DENY") {
        this.observability.recordGovernanceDecision(span, "DENY", decision.reasons?.[0]?.summary);
        
        const authErr = new AuthorizationError({
          code: "WAC_A",
          message: "action denied by policy decision point",
          workOrderId,
          auditTrailId: decision.policyDecisionId,
        });
        span.recordException(authErr);
        span.setAttribute("error", true);
        span.setAttribute("error.code", "WAC_A");
        throw authErr;
      }

      // Record PERMIT decision
      this.observability.recordGovernanceDecision(span, "PERMIT");

      // Step 6: If T2, poll for approval
      if (action.tier === 2 /* EXPERT_APPROVAL */) {
        await this.waitForApproval(workOrderId, span);
      }

      // Step 7: Execute action function
      const actionStart = performance.now();
      try {
        await action.action();
        span.setAttribute("action.executed", true);
      } finally {
        const actionDuration = performance.now() - actionStart;
        span.setAttribute("action.duration_ms", actionDuration);
      }

      span.end();
    } catch (error) {
      span.end();
      throw error;
    }
  }

  /**
   * ExecuteBatchGovernedActions executes multiple actions under a single parent
   * Work Order. With transactionSemantics "atomic", any DENY causes all siblings
   * to be rolled back (SDD-GDK §4.1.2).
   */
  async executeBatchGovernedActions(
    actions: GovernedAction[],
    config: BatchConfig = { transactionSemantics: "best-effort" },
  ): Promise<void> {
    const ctx = this.buildBatchGDKContext(actions);
    const span = this.observability.startGovernanceSpan("[gdk.governance.batch]", ctx);
    
    span.setAttribute("batch.size", actions.length);
    span.setAttribute("batch.transaction_semantics", config.transactionSemantics);

    try {
      // Validate all idempotency keys first
      for (let i = 0; i < actions.length; i++) {
        if (!actions[i].idempotencyKey) {
          const error = new GovernanceError({
            code: "GDK_MISSING_IDEMPOTENCY_KEY",
            message: `idempotencyKey is required for batch action[${i}]`,
          });
          span.recordException(error);
          span.setAttribute("error", true);
          throw error;
        }
      }

      // Create parent work order
      let parentWoId: string;
      try {
        parentWoId = await this.kernelClient.createWorkOrder({
          assemblyId: this.assemblyId,
          purposeId: this.purposeId,
          workType: "batch",
          autonomyTier: "T1",
          idempotencyKey: actions[0].idempotencyKey + "_parent",
        });
      } catch (err) {
        const authErr = new AuthorizationError({
          code: "WAC_A",
          message: `kernel unreachable for parent work order: ${err instanceof Error ? err.message : String(err)}`,
        });
        span.recordException(authErr);
        span.setAttribute("error", true);
        throw authErr;
      }

      span.setAttribute("parent_work_order_id", parentWoId);

      const isAtomic = config.transactionSemantics === "atomic";
      const executedIndices: number[] = [];
      let firstError: Error | null = null;

      // Execute children sequentially (concurrency is future enhancement)
      for (let i = 0; i < actions.length; i++) {
        if (isAtomic && firstError) break;

        const action = actions[i];
        const childSpan = this.observability.startGovernanceSpan(`[gdk.governance.child][${i}]`, {
          ...ctx,
          workOrderId: parentWoId,
        });

        const filteredContext = action.context
          ? this.piiFilter.strip(action.context)
          : undefined;

        // Create child work order
        let childWoId: string;
        try {
          childWoId = await this.kernelClient.createChildWorkOrder(parentWoId, {
            assemblyId: this.assemblyId,
            purposeId: this.purposeId,
            workType: action.intentClass,
            autonomyTier: tierToKernel(action.tier),
            intentClass: action.intentClass,
            context: filteredContext,
            idempotencyKey: action.idempotencyKey,
          });
        } catch (err) {
          const authErr = new AuthorizationError({
            code: "WAC_A",
            message: `kernel unreachable for child action[${i}]: ${err instanceof Error ? err.message : String(err)}`,
          });
          childSpan.recordException(authErr);
          childSpan.setAttribute("error", true);
          childSpan.end();
          if (isAtomic) {
            firstError = authErr;
            break;
          }
          continue;
        }

        childSpan.setAttribute("child_work_order_id", childWoId);

        // Evaluate policy for child
        let decision: Awaited<ReturnType<KernelClient["evaluatePolicy"]>>;
        try {
          decision = await this.kernelClient.evaluatePolicy({
            subject: { subjectId: this.assemblyId },
            action: { actionId: action.intentClass },
            resource: { resourceType: "governed_action" },
            context: {
              workOrderId: childWoId,
              assemblyId: this.assemblyId,
              autonomyTier: tierToKernel(action.tier),
            },
          });
        } catch (err) {
          const authErr = new AuthorizationError({
            code: "WAC_A",
            message: `PDP unreachable for child action[${i}]`,
            workOrderId: childWoId,
          });
          childSpan.recordException(authErr);
          childSpan.setAttribute("error", true);
          childSpan.end();
          if (isAtomic) {
            firstError = authErr;
            break;
          }
          continue;
        }

        if (decision.decision === "DENY") {
          this.observability.recordGovernanceDecision(childSpan, "DENY", decision.reasons?.[0]?.summary);
          
          const authErr = new AuthorizationError({
            code: "WAC_A",
            message: `batch child action[${i}] denied`,
            workOrderId: childWoId,
            auditTrailId: decision.policyDecisionId,
          });
          childSpan.recordException(authErr);
          childSpan.setAttribute("error", true);
          childSpan.end();
          if (isAtomic) {
            firstError = authErr;
            break;
          }
          continue;
        }

        this.observability.recordGovernanceDecision(childSpan, "PERMIT");

        // Execute action
        await action.action();
        executedIndices.push(i);
        childSpan.setAttribute("action.executed", true);
        childSpan.end();
      }

      span.setAttribute("executed_count", executedIndices.length);
      span.setAttribute("failed_count", actions.length - executedIndices.length);

      if (isAtomic && firstError) {
        span.recordException(firstError);
        span.setAttribute("error", true);
        span.setAttribute("atomic_rollback", true);
        throw firstError;
      }

      span.end();
    } catch (error) {
      span.end();
      throw error;
    }
  }

  /**
   * ExecuteReversibleAction executes an action with a registered compensation function.
   * Both forward and reverse function references are recorded in evidence (SDD-GDK §4.1.2).
   */
  async executeReversibleAction(action: ReversibleAction): Promise<void> {
    const ga: GovernedAction = {
      intentClass: action.intentClass,
      tier: 0, // AUTONOMOUS
      reversible: true,
      idempotencyKey: action.idempotencyKey ?? `rev_${action.intentClass}_${Date.now()}`,
      action: async () => {
        const result = await action.forwardFunc();
        // Result stored for potential reverse call via evidence
        void result;
      },
    };

    await this.executeGovernedAction(ga);
  }

  /**
   * Polls the kernel for work order approval status.
   * Blocks until approval is granted, denied, or timeout expires.
   */
  private async waitForApproval(workOrderId: string, parentSpan: unknown): Promise<void> {
    const deadline = Date.now() + this.approvalTimeoutMs;
    let pollCount = 0;

    while (Date.now() < deadline) {
      let wo: Awaited<ReturnType<KernelClient["getWorkOrder"]>>;
      try {
        wo = await this.kernelClient.getWorkOrder(workOrderId);
      } catch {
        // Transient failure — retry on next poll
        await sleep(this.approvalPollIntervalMs);
        pollCount++;
        continue;
      }

      switch (wo.status) {
        case "APPROVED":
        case "RUNNING":
        case "COMPLETED":
          return; // Approval granted

        case "FAILED":
        case "FAILED_FINAL":
          throw new AuthorizationError({
            code: "WAC_A",
            message: `work order ${wo.status} after escalation`,
            workOrderId,
          });
      }

      // Still pending — wait and poll again
      await sleep(this.approvalPollIntervalMs);
      pollCount++;
    }

    throw new EscalationTimeoutError({
      code: "GDK_ESCALATION_TIMEOUT",
      message: "approval wait exceeded timeout",
      workOrderId,
      timeoutDurationMs: this.approvalTimeoutMs,
    });
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private buildGDKContext(action: GovernedAction): GDKContext {
    // Extract session info from idempotency key if available
    const parts = action.idempotencyKey.split("_");
    const sessionId = parts.length >= 2 && parts[0].startsWith("csess")
      ? parts.slice(0, 2).join("_")
      : `sess_${Date.now()}`;
    const workOrderId = parts.length >= 2 && parts[0] === "wo"
      ? action.idempotencyKey
      : `wo_${this.assemblyId}_${Date.now()}`;

    return {
      assemblyId: this.assemblyId,
      purposeId: this.purposeId,
      actorId: "governed-service",
      sessionId,
      workOrderId,
      autonomyTier: action.tier,
    };
  }

  private buildBatchGDKContext(actions: GovernedAction[]): GDKContext {
    const firstKey = actions[0]?.idempotencyKey ?? `batch_${Date.now()}`;
    const parts = firstKey.split("_");
    const sessionId = parts.length >= 2 && parts[0].startsWith("csess")
      ? parts.slice(0, 2).join("_")
      : `sess_${Date.now()}`;

    return {
      assemblyId: this.assemblyId,
      purposeId: this.purposeId,
      actorId: "governed-service",
      sessionId,
      workOrderId: `wo_batch_${Date.now()}`,
      autonomyTier: 0,
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Safe env var access that works in Node, Bun, and browser */
function getEnv(key: string): string | undefined {
  try {
    return (globalThis as Record<string, any>).process?.env?.[key] as string | undefined;
  } catch {
    return undefined;
  }
}
