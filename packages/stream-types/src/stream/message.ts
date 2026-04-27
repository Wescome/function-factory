// stream/message.ts - WGSP §6.1 composed message type
// Root type for end-to-end type safety between server and client.

import type { WeOpsDataPart } from "./data-parts";

// ---------------------------------------------------------------------------
// Message metadata attached to every WeOps message
// ---------------------------------------------------------------------------

export interface WeOpsMessageMetadata {
  work_order_id: string;
  trace_id: string | null;
  session_id: string;
  we_gradient_level: number; // 0-5, from We-Gradient Maturity Model
  kernel_version: string;
}

// ---------------------------------------------------------------------------
// Composed message type (WGSP §6.1)
// ---------------------------------------------------------------------------

export interface WeOpsMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
  metadata: WeOpsMessageMetadata;
  parts: WeOpsDataPart[];
}
