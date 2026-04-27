// kernel/messages.ts - Canonical message types
// Mirrors weops-enterprise/pkg/messages/messages.go

import type { MessageType } from "./enums";

export interface Message {
  readonly message_id: string;
  readonly type: MessageType;
  readonly timestamp: string;
  readonly correlation_id: string;
  readonly source: string;
  readonly payload: unknown;
}
