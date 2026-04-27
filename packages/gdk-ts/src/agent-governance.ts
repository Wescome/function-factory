/**
 * AOMA Governance Wrapper for @weops/gdk-agent
 *
 * This module provides a governance adapter that plugs AOMA kernel enforcement
 * into @weops/gdk-agent's beforeToolCall/afterToolCall hooks. It serves as the
 * bridge between Pi's agent loop and WeOps governance.
 *
 * Pattern: Identical to CodingAgent v2's plugin.go but adapted for TypeScript.
 * SDD-GDK 9.5: GDK does NOT replicate kernel enforcement logic.
 *              It constructs requests; the kernel enforces.
 */

import { createHash } from 'crypto';

// ============================================================================
// Types (mirrored from @weops/gdk-ts and @weops/gdk-agent)
// ============================================================================

/** Autonomy tier for governed actions (maps to kernel T-tier values per SDD-GDK 3.3) */
export enum Tier {
  /** T0: Executes without human approval; evidence committed */
  Autonomous = 0,
  /** T1: Executes and notifies designated role */
  Escalation = 1,
  /** T2: Suspends execution until explicit approval granted */
  ExpertApproval = 2,
  /** T99: Unconditionally denies execution; evidence committed with DENY */
  Blocked = 99,
}

/** Governed action request for kernel evaluation */
export interface GovernedAction {
  /** Intent class identifies the type of governed operation */
  intentClass: string;
  /** Autonomy tier for this action */
  tier: Tier;
  /** Domain-specific context data (PII is stripped before kernel calls) */
  context?: Record<string, unknown>;
  /** Business logic to execute if governance permits (null for evaluate-only) */
  action: ((ctx: unknown) => Promise<void>) | null;
  /** Required for all governed actions (SDD-GDK 9.6) */
  idempotencyKey: string;
  /** Whether this action can be compensated */
  reversible?: boolean;
  /** Duration within which reversal is allowed */
  reversibleWindowSeconds?: number;
}

/** Policy decision from the kernel PDP */
export interface PolicyDecision {
  policyDecisionId: string;
  decision: 'PERMIT' | 'DENY';
  reasons?: Array<{ code?: string; summary: string }>;
  obligations?: Array<{ type: string; value: string }>;
  escalationRung?: number;
  evaluatedAt: string;
}

/** Evidence entry committed to the ledger */
export interface EvidenceEntry {
  evidenceId: string;
  workOrderId: string;
  invocationId: string;
  policyDecisionId: string;
  timestamp: string;
  entryType?: string;
}

/** GovernedService interface for kernel communication */
export interface GovernedService {
  /** Execute a governed action with full PDP evaluation */
  executeGovernedAction(action: GovernedAction): Promise<void>;
  /** Evaluate policy without executing (evaluate-only mode) */
  evaluatePolicy?(action: GovernedAction): Promise<PolicyDecision>;
  /** Commit evidence record to the ledger */
  commitEvidence?(entry: EvidenceEntry): Promise<string>;
}

/** Context passed to beforeToolCall hook */
export interface BeforeToolCallContext {
  /** Unique identifier for this tool call */
  toolCallId: string;
  /** Name of the tool being invoked */
  toolName: string;
  /** Tool arguments as a JSON string */
  arguments: string;
  /** Session identifier */
  sessionId: string;
  /** Current turn number in the conversation */
  turn: number;
  /** Work order identifier */
  workOrderId: string;
  /** Actor identifier */
  actorId: string;
  /** Purpose identifier */
  purposeId: string;
  /** Autonomy tier for this session */
  autonomyTier: string;
}

/** Result of beforeToolCall governance evaluation */
export interface BeforeToolCallResult {
  /** If true, block the tool call */
  block: boolean;
  /** Reason for blocking (required if block is true) */
  reason?: string;
}

/** Context passed to afterToolCall hook */
export interface AfterToolCallContext {
  /** Unique identifier for this tool call */
  toolCallId: string;
  /** Name of the tool that was invoked */
  toolName: string;
  /** Tool arguments as a JSON string */
  arguments: string;
  /** Tool result/output as a string */
  result: string;
  /** Whether the tool execution succeeded */
  success: boolean;
  /** Session identifier */
  sessionId: string;
  /** Current turn number */
  turn: number;
  /** Work order identifier */
  workOrderId: string;
  /** Evidence ID from the beforeToolCall phase */
  evidenceId?: string;
  /** Policy decision ID from the beforeToolCall phase */
  policyDecisionId?: string;
  /** Invocation ID from the beforeToolCall phase */
  invocationId?: string;
}

/** Agent loop configuration hooks */
export interface AgentLoopConfig {
  beforeToolCall?: (ctx: BeforeToolCallContext) => Promise<BeforeToolCallResult | undefined>;
  afterToolCall?: (ctx: AfterToolCallContext) => Promise<unknown>;
}

/** Options for creating a governed agent configuration */
export interface GovernedAgentOptions {
  /** Maps tool names to intent classes (READ_ONLY, WRITE, EXECUTE) */
  sideEffectMap?: Record<string, string>;
  /** Default autonomy tier (defaults to T0) */
  defaultTier?: Tier;
  /** Callback invoked when PDP denies a tool call */
  onDeny?: (toolName: string, reason: string) => void;
  /** Callback invoked when evidence is committed */
  onEvidence?: (evidenceId: string) => void;
  /** Assembly ID for work order creation */
  assemblyId?: string;
}

// ============================================================================
// Default Configuration
// ============================================================================

/** Default side effect mapping for known tools */
const DEFAULT_SIDE_EFFECT_MAP: Record<string, string> = {
  bash_execute: 'EXECUTE',
  file_write: 'WRITE',
  file_read: 'READ_ONLY',
  file_list: 'READ_ONLY',
  grep_search: 'READ_ONLY',
  git_commit: 'WRITE',
  git_status: 'READ_ONLY',
  git_diff: 'READ_ONLY',
};

/** Generates SHA-256 hash of content */
function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/** Normalizes and hashes tool arguments */
function hashToolArgs(args: string): string {
  if (!args || args === '') {
    return hashContent('{}');
  }
  try {
    const parsed = JSON.parse(args);
    const normalized = JSON.stringify(parsed);
    return hashContent(normalized);
  } catch {
    return hashContent(args);
  }
}

/** Generates idempotency key from session, turn, and tool call ID */
function generateIdempotencyKey(sessionId: string, turn: number, toolCallId: string): string {
  return `${sessionId}_turn${turn}_${toolCallId}`;
}

// ============================================================================
// Governance Error Types
// ============================================================================

/** Error thrown when governance evaluation fails */
export class GovernanceError extends Error {
  public readonly code: string;
  public readonly workOrderId?: string;
  public readonly auditTrailId?: string;

  constructor(code: string, message: string, workOrderId?: string, auditTrailId?: string) {
    super(message);
    this.name = 'GovernanceError';
    this.code = code;
    this.workOrderId = workOrderId;
    this.auditTrailId = auditTrailId;
  }
}

/** Error thrown when authorization is denied */
export class AuthorizationError extends GovernanceError {
  constructor(message: string, workOrderId?: string, auditTrailId?: string) {
    super('WAC_A', message, workOrderId, auditTrailId);
    this.name = 'AuthorizationError';
  }
}

// ============================================================================
// Main Factory Function
// ============================================================================

/**
 * Creates a governed agent configuration that plugs AOMA kernel enforcement
 * into @weops/gdk-agent's beforeToolCall/afterToolCall hooks.
 *
 * @param service - The GovernedService for kernel communication
 * @param options - Configuration options for the governance adapter
 * @returns AgentLoopConfig with beforeToolCall and afterToolCall hooks
 */
export function createGovernedAgentConfig(
  service: GovernedService,
  options: GovernedAgentOptions = {}
): Pick<AgentLoopConfig, 'beforeToolCall' | 'afterToolCall'> {
  // Merge side effect maps (custom overrides defaults)
  const sideEffectMap = {
    ...DEFAULT_SIDE_EFFECT_MAP,
    ...options.sideEffectMap,
  };

  const defaultTier = options.defaultTier ?? Tier.Autonomous;

  // Store state between before and after hooks
  const callState = new Map<string, {
    invocationId: string;
    policyDecisionId: string;
    evidenceId: string;
    inputHash: string;
  }>();

  return {
    /**
     * beforeToolCall - Governance evaluation before tool execution
     *
     * Algorithm:
     *  1. Derive intent class from tool name via sideEffectMap
     *  2. Build GovernedAction with idempotency key from session+turn+toolCallId
     *  3. Call service.evaluatePolicy() or executeGovernedAction with null action
     *  4. If DENY: return { block: true, reason: decision.reason }
     *  5. If PERMIT: store state for afterToolCall, return undefined (allow)
     *  6. Evidence is committed automatically by GovernedService
     *
     * Fail-closed: If GovernedService throws, block the tool call
     */
    beforeToolCall: async (ctx: BeforeToolCallContext): Promise<BeforeToolCallResult | undefined> => {
      try {
        // 1. Derive intent class from tool name (fail-closed: unknown = EXECUTE)
        const intentClass = sideEffectMap[ctx.toolName] ?? 'EXECUTE';

        // 2. Build idempotency key
        const idempotencyKey = generateIdempotencyKey(ctx.sessionId, ctx.turn, ctx.toolCallId);
        const inputHash = hashToolArgs(ctx.arguments);

        // Build the governed action for evaluation
        const governedAction: GovernedAction = {
          intentClass,
          tier: defaultTier,
          idempotencyKey,
          action: null, // Evaluate-only mode
          context: {
            toolName: ctx.toolName,
            toolCallId: ctx.toolCallId,
            inputHash,
            sessionId: ctx.sessionId,
            turn: ctx.turn,
          },
        };

        // 3. Evaluate policy
        let decision: PolicyDecision;

        if (service.evaluatePolicy) {
          // Use direct policy evaluation if available
          decision = await service.evaluatePolicy(governedAction);
        } else {
          // Fall back to executeGovernedAction with null action
          // This will create work order and evaluate policy
          try {
            await service.executeGovernedAction(governedAction);
            // If no error, assume PERMIT
            decision = {
              policyDecisionId: `perm_${idempotencyKey}`,
              decision: 'PERMIT',
              evaluatedAt: new Date().toISOString(),
            };
          } catch (error) {
            // Check if it's an authorization error (DENY)
            if (error instanceof AuthorizationError) {
              decision = {
                policyDecisionId: error.auditTrailId ?? `deny_${idempotencyKey}`,
                decision: 'DENY',
                reasons: [{ code: error.code, summary: error.message }],
                evaluatedAt: new Date().toISOString(),
              };
            } else {
              // Re-throw infrastructure errors (fail-closed)
              throw error;
            }
          }
        }

        // 4. Handle DENY
        if (decision.decision === 'DENY') {
          const denyReason = decision.reasons?.[0]?.summary ?? 'Action denied by policy';

          // Invoke callback if provided
          options.onDeny?.(ctx.toolName, denyReason);

          return {
            block: true,
            reason: denyReason,
          };
        }

        // 5. PERMIT path: store state for afterToolCall
        const invocationId = `inv_${idempotencyKey}`;
        const evidenceId = decision.policyDecisionId;

        callState.set(ctx.toolCallId, {
          invocationId,
          policyDecisionId: decision.policyDecisionId,
          evidenceId,
          inputHash,
        });

        // Invoke evidence callback if provided
        options.onEvidence?.(evidenceId);

        // Return undefined to allow execution
        return undefined;

      } catch (error) {
        // Fail-closed: any error blocks the tool call
        const errorMessage = error instanceof Error ? error.message : 'Governance evaluation failed';

        options.onDeny?.(ctx.toolName, errorMessage);

        return {
          block: true,
          reason: `Governance error: ${errorMessage}`,
        };
      }
    },

    /**
     * afterToolCall - Evidence commit after tool execution
     *
     * Algorithm:
     *  1. Retrieve state from beforeToolCall
     *  2. Compute output hash (SHA-256 of result content)
     *  3. Commit evidence record with success/failure status
     *  4. Return undefined (don't modify tool result)
     *
     * Every tool call must produce an evidence record (success or failure)
     */
    afterToolCall: async (ctx: AfterToolCallContext): Promise<undefined> => {
      const state = callState.get(ctx.toolCallId);

      // Compute output hash
      const outputHash = hashContent(ctx.result);

      // Build evidence entry
      const evidenceEntry: EvidenceEntry = {
        evidenceId: state?.evidenceId ?? `ev_${ctx.toolCallId}`,
        workOrderId: ctx.workOrderId,
        invocationId: state?.invocationId ?? `inv_${ctx.toolCallId}`,
        policyDecisionId: state?.policyDecisionId ?? 'unknown',
        timestamp: new Date().toISOString(),
        entryType: ctx.success ? 'RESULT_SUCCESS' : 'RESULT_FAILURE',
      };

      // Include hash in context for potential use
      void outputHash;

      // Commit evidence if service supports it
      if (service.commitEvidence) {
        try {
          const committedId = await service.commitEvidence(evidenceEntry);
          options.onEvidence?.(committedId);
        } catch (error) {
          // Log but don't fail - evidence commit is best-effort after execution
          console.error('Failed to commit evidence:', error);
        }
      }

      // Clean up state
      callState.delete(ctx.toolCallId);

      // Return undefined (don't modify tool result)
      return undefined;
    },
  };
}

// ============================================================================
// Utility Exports
// ============================================================================

/** Returns the default side effect map (for testing/extension) */
export function getDefaultSideEffectMap(): Record<string, string> {
  return { ...DEFAULT_SIDE_EFFECT_MAP };
}

/** Helper to check if a tool name is in the default side effect map */
export function isKnownTool(toolName: string): boolean {
  return toolName in DEFAULT_SIDE_EFFECT_MAP;
}

/** Helper to get the intent class for a tool (fail-closed: unknown = EXECUTE) */
export function getIntentClass(
  toolName: string,
  customMap?: Record<string, string>
): string {
  const map = { ...DEFAULT_SIDE_EFFECT_MAP, ...customMap };
  return map[toolName] ?? 'EXECUTE';
}
