// kernel/invocation.ts - Tool invocation types
// Mirrors weops-enterprise/pkg/invocation/invocation.go

import type { InvocationStatus } from "./enums";

export interface InvocationRequest {
  readonly invocation_id: string;
  readonly workspace_id: string;
  readonly work_order_id: string;
  readonly tool: string;
  readonly idempotency_key: string;
  readonly input: Record<string, unknown>;
  readonly policy_decision_id: string;
}

export interface InvocationResult {
  readonly invocation_id: string;
  readonly status: InvocationStatus;
  readonly output_ref?: string;
  readonly error?: InvocationError;
  readonly evidence_id?: string;
  readonly duration_ms?: number;
}

export interface InvocationError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

// Tool name must match system.action pattern (lowercase, dot-separated)
export const TOOL_NAME_PATTERN = /^[a-z_]+\.[a-z_]+$/;
