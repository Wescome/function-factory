// gdk-ts/src/index.ts — Barrel export for @weops/gdk-ts

// Core types
export { Tier, FidelityLevel, tierToKernel } from "./types.js";
export type {
  GovernedConfig,
  GovernedAction,
  BatchConfig,
  ReversibleAction,
  PISValidationConfig,
  ExecutionStatus,
  ServiceConfig,
} from "./types.js";

// Service
export { GovernedService } from "./service.js";

// Client
export { KernelClient } from "./client.js";

// Decorators
export { governed, audited, reversible } from "./decorators.js";

// Errors
export {
  GovernanceError,
  AuthorizationError,
  FidelityInsufficientError,
  EscalationTimeoutError,
  PolicyViolationError,
} from "./errors.js";

// PII
export type { PIIFilter } from "./pii.js";
export { NoOpPIIFilter } from "./pii.js";

// Agent Governance (CONSOLE-1)
export {
  createGovernedAgentConfig,
  getDefaultSideEffectMap,
  isKnownTool,
  getIntentClass,
  Tier as AgentTier,
} from "./agent-governance.js";
export type {
  GovernedService as GovernedServiceInterface,
  GovernedAction as GovernedActionRequest,
  PolicyDecision,
  EvidenceEntry,
  BeforeToolCallContext,
  AfterToolCallContext,
  BeforeToolCallResult,
  AgentLoopConfig,
  GovernedAgentOptions,
  GovernanceError as GovernanceErrorType,
  AuthorizationError as AuthorizationErrorType,
} from "./agent-governance.js";

// Agent Session (CONSOLE-2)
export {
  GovernedAgentSession,
  createGovernedSession,
  isSuccessfulStatus,
  formatMetrics,
} from "./agent-session.js";
export type {
  ModelConfig,
  GovernedSessionConfig,
  SessionResult,
  SessionMetrics,
} from "./agent-session.js";

// Observability (CONSOLE-11)
export {
  GDKObservability,
  getObservability,
  configureObservability,
  resetObservability,
  createGDKContext,
  createToolContext,
} from "./observability.js";
export type {
  ObservabilityConfig,
  GDKContext,
  ToolContext,
} from "./observability.js";

// Coding Agent Tool (CONSOLE-4)
export { codingAgentTool, codingAgentSchema } from "./tools/coding-agent-tool.js";
export type {
  CodingAgentResult,
  CodingAgentParams,
} from "./tools/coding-agent-tool.js";

// Core Tools (file_read, file_write, bash_execute, grep_search)
export { buildCoreTools, CORE_SIDE_EFFECT_MAP } from "./tools/core-tools.js";

// Slack Integration (CONSOLE-8)
export { SlackNotifier } from "./integrations/slack-notifier.js";
export type { SlackConfig, SlackEvent, SlackEventType } from "./integrations/slack-notifier.js";
