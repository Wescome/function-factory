/**
 * Governed Agent Session Runner
 *
 * Wraps @weops/gdk-agent's agentLoop with AOMA governance, work order lifecycle,
 * and evidence tracking. This is the TypeScript equivalent of CodingAgent v2's RunSession.
 *
 * Per SDD-GDK §9.5: GDK does NOT replicate kernel enforcement logic.
 * It constructs requests; the kernel enforces.
 * 
 * OpenTelemetry spans are created for the session lifecycle when observability
 * is enabled (CONSOLE-11).
 */

import { agentLoop, type AgentContext, type AgentEvent, type AgentMessage, type AgentTool } from "@weops/gdk-agent";
import type { Model, Usage } from "@weops/gdk-ai";
import { createGovernedAgentConfig, Tier, type GovernedService, type GovernedAgentOptions } from "./agent-governance.js";
import type { ServiceConfig } from "./types.js";
import { getObservability, createGDKContext, createToolContext, type GDKContext } from "./observability.js";

// ============================================================================
// Types
// ============================================================================

/** Model configuration for provider-agnostic LLM calls via @weops/gdk-ai */
export interface ModelConfig {
  provider: string;
  modelId: string;
  apiKey: string;
  baseUrl?: string;
  reasoning?: boolean;
}

/** Configuration for a governed agent session */
export interface GovernedSessionConfig {
  // Identity
  assemblyId: string;
  purposeId: string;
  actorId: string;

  // Model (provider-agnostic via @weops/gdk-ai)
  model: ModelConfig;
  apiKey: string;
  fallbackModel?: ModelConfig;

  // Governance
  governedService: GovernedService;
  autonomyTier?: Tier;
  workType?: "OPERATION" | "PROJECT" | "INCIDENT";

  // Tools
  tools: AgentTool<any>[];
  sideEffectMap?: Record<string, string>;

  // Limits
  maxTurns?: number; // default: 50
  maxTokens?: number; // default: 100000

  // System prompt
  systemPrompt: string;

  // Workspace
  workDir: string;
}

/** Session execution result */
export interface SessionResult {
  sessionId: string;
  workOrderId: string;
  status: "completed" | "failed" | "aborted" | "turn_limit";
  turns: number;
  metrics: SessionMetrics;
}

/** Session metrics for evidence and billing */
export interface SessionMetrics {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  gatesEvaluated: number;
  gatesDenied: number;
  gatesEscalated: number;
  evidenceRecords: number;
  durationMs: number;
}

/** Internal session state */
interface SessionState {
  sessionId: string;
  workOrderId: string;
  startTime: number;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  gatesEvaluated: number;
  gatesDenied: number;
  gatesEscalated: number;
  evidenceRecords: number;
  aborted: boolean;
  completed: boolean;
}

// ============================================================================
// GovernedAgentSession
// ============================================================================

/**
 * GovernedAgentSession wraps @weops/gdk-agent's agentLoop with AOMA governance.
 *
 * Lifecycle:
 *   1. Create work order via GovernedService
 *   2. Build AgentLoopConfig with governance hooks from CONSOLE-1
 *   3. Call agentLoop(prompt, context, config)
 *   4. Stream events to output
 *   5. Track metrics (tokens, turns, gates evaluated/denied)
 *   6. On end: mark work order complete, return SessionResult
 *   7. On error/abort: mark work order failed, return partial result
 * 
 * OpenTelemetry spans:
 *   - [gdk.session] — root span for entire session
 *   - [gdk.turn] — per agent turn
 *   - [gdk.governance.evaluate] — PDP evaluation
 *   - [gdk.tool.execute] — tool execution
 *   - [gdk.evidence.commit] — evidence write
 *   - [gdk.workorder.lifecycle] — WO create/close
 */
export class GovernedAgentSession {
  private config: GovernedSessionConfig;
  private state: SessionState | null = null;
  private abortController: AbortController | null = null;
  private outputWriter: WritableStreamDefaultWriter<string> | null = null;
  private observability = getObservability();
  private sessionSpan: unknown = null;
  private currentTurnSpan: unknown = null;

  constructor(config: GovernedSessionConfig) {
    this.validateConfig(config);
    this.config = config;
  }

  // --------------------------------------------------------------------------
  // Getters
  // --------------------------------------------------------------------------

  get sessionId(): string {
    return this.state?.sessionId ?? "";
  }

  get workOrderId(): string {
    return this.state?.workOrderId ?? "";
  }

  get metrics(): SessionMetrics {
    if (!this.state) {
      return {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCachedTokens: 0,
        gatesEvaluated: 0,
        gatesDenied: 0,
        gatesEscalated: 0,
        evidenceRecords: 0,
        durationMs: 0,
      };
    }

    return {
      totalInputTokens: this.state.inputTokens,
      totalOutputTokens: this.state.outputTokens,
      totalCachedTokens: this.state.cachedTokens,
      gatesEvaluated: this.state.gatesEvaluated,
      gatesDenied: this.state.gatesDenied,
      gatesEscalated: this.state.gatesEscalated,
      evidenceRecords: this.state.evidenceRecords,
      durationMs: Date.now() - this.state.startTime,
    };
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Run a governed agent session with the given prompt.
   *
   * @param prompt - The user prompt to process
   * @param output - WritableStream for streaming events
   * @returns SessionResult with final status and metrics
   */
  async run(prompt: string, output: WritableStream<string>): Promise<SessionResult> {
    const startTime = performance.now();
    this.abortController = new AbortController();
    this.outputWriter = output.getWriter();

    // Create root session span
    const sessionCtx = this.buildGDKContext("", "");
    this.sessionSpan = this.observability.startSessionSpan("[gdk.session]", sessionCtx);

    try {
      // 1. Create work order via GovernedService
      const workOrderId = await this.createWorkOrder();
      const sessionId = this.generateSessionId();

      this.state = {
        sessionId,
        workOrderId,
        startTime,
        turns: 0,
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        gatesEvaluated: 0,
        gatesDenied: 0,
        gatesEscalated: 0,
        evidenceRecords: 0,
        aborted: false,
        completed: false,
      };

      // Update session span with actual IDs
      const ctx = this.buildGDKContext(sessionId, workOrderId);
      (this.sessionSpan as any).setAttribute("gdk.session_id", sessionId);
      (this.sessionSpan as any).setAttribute("gdk.work_order_id", workOrderId);

      // 2. Build governance-wrapped tool hooks
      const governanceOptions: GovernedAgentOptions = {
        assemblyId: this.config.assemblyId,
        defaultTier: this.config.autonomyTier ?? Tier.Autonomous,
        sideEffectMap: this.config.sideEffectMap,
        onDeny: (_toolName: string, _reason: string) => {
          if (this.state) {
            this.state.gatesDenied++;
          }
        },
        onEvidence: (_evidenceId: string) => {
          if (this.state) {
            this.state.evidenceRecords++;
          }
        },
      };

      const governedHooks = createGovernedAgentConfig(this.config.governedService, governanceOptions);

      // 3. Build agent context
      const context: AgentContext = {
        systemPrompt: this.config.systemPrompt,
        messages: [],
        tools: this.config.tools,
      };

      // 4. Build model configuration for gdk-ai
      const model = this.buildModel(this.config.model);

      // 5. Build agent loop configuration
      const maxTurns = this.config.maxTurns ?? 50;

      const agentConfig = {
        model,
        apiKey: this.config.apiKey,
        convertToLlm: (messages: AgentMessage[]) => this.convertToLlmMessages(messages),
        beforeToolCall: async (ctx: any, signal?: AbortSignal) => {
          // Track gate evaluation
          if (this.state) {
            this.state.gatesEvaluated++;
          }

          // Check for abort
          if (signal?.aborted || this.abortController?.signal.aborted) {
            return { block: true, reason: "Session aborted" };
          }

          // Inject session context for governance
          const enrichedCtx = {
            ...ctx,
            sessionId: this.state?.sessionId ?? "",
            workOrderId: this.state?.workOrderId ?? "",
            actorId: this.config.actorId,
            purposeId: this.config.purposeId,
            autonomyTier: this.config.autonomyTier ?? Tier.Autonomous,
            turn: this.state?.turns ?? 0,
          };

          return governedHooks.beforeToolCall?.(enrichedCtx);
        },
        afterToolCall: async (ctx: any, signal?: AbortSignal) => {
          // Check for abort
          if (signal?.aborted || this.abortController?.signal.aborted) {
            return undefined;
          }

          // Inject session context for governance
          const enrichedCtx = {
            ...ctx,
            sessionId: this.state?.sessionId ?? "",
            workOrderId: this.state?.workOrderId ?? "",
            actorId: this.config.actorId,
            purposeId: this.config.purposeId,
          };

          return governedHooks.afterToolCall?.(enrichedCtx);
        },
        transformContext: async (messages: AgentMessage[], signal?: AbortSignal) => {
          // Check turn limit
          if (this.state && this.state.turns >= maxTurns) {
            this.abortController?.abort("Turn limit reached");
            return messages;
          }

          // Check for abort
          if (signal?.aborted || this.abortController?.signal.aborted) {
            return messages;
          }

          return messages;
        },
      };

      // 6. Create user message from prompt
      const userMessage: AgentMessage = {
        role: "user",
        content: prompt,
        timestamp: Date.now(),
      };

      // 7. Start agent loop
      const stream = agentLoop([userMessage], context, agentConfig, this.abortController.signal);

      // 8. Process events and stream to output
      let finalMessages: AgentMessage[] = [];

      for await (const event of stream) {
        await this.handleEvent(event);

        // Stream event to output
        if (this.outputWriter) {
          await this.outputWriter.write(JSON.stringify(event) + "\n");
        }

        if (event.type === "agent_end") {
          finalMessages = event.messages;
        }
      }

      // 9. Update final state
      if (this.state) {
        this.state.completed = true;
        this.state.turns = this.countTurns(finalMessages);
      }

      // Record final metrics
      this.recordFinalMetrics();

      // 10. Mark work order complete
      await this.closeWorkOrder("COMPLETED");

      (this.sessionSpan as any).setAttribute("session.status", "completed");
      (this.sessionSpan as any).setAttribute("session.turns", this.state?.turns ?? 0);
      (this.sessionSpan as any).end();

      return this.buildResult("completed");
    } catch (error) {
      // Handle abort
      if (this.abortController?.signal.aborted) {
        await this.closeWorkOrder("FAILED");
        (this.sessionSpan as any).setAttribute("session.status", "aborted");
        (this.sessionSpan as any).recordException(error instanceof Error ? error : new Error(String(error)));
        (this.sessionSpan as any).end();
        return this.buildResult("aborted");
      }

      // Handle turn limit
      if (this.state && this.state.turns >= (this.config.maxTurns ?? 50)) {
        await this.closeWorkOrder("COMPLETED");
        (this.sessionSpan as any).setAttribute("session.status", "turn_limit");
        (this.sessionSpan as any).end();
        return this.buildResult("turn_limit");
      }

      // Handle other errors
      await this.closeWorkOrder("FAILED");
      (this.sessionSpan as any).setAttribute("session.status", "failed");
      (this.sessionSpan as any).recordException(error instanceof Error ? error : new Error(String(error)));
      (this.sessionSpan as any).end();
      return this.buildResult("failed");
    } finally {
      await this.outputWriter?.close();
      this.outputWriter = null;
    }
  }

  /**
   * Stop the running session gracefully.
   */
  async stop(): Promise<void> {
    if (this.abortController && !this.abortController.signal.aborted) {
      this.abortController.abort("Session stopped by user");
    }

    if (this.state) {
      this.state.aborted = true;
    }

    // Wait a brief moment for cleanup
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  // --------------------------------------------------------------------------
  // Private Methods
  // --------------------------------------------------------------------------

  private validateConfig(config: GovernedSessionConfig): void {
    if (!config.assemblyId) throw new Error("assemblyId is required");
    if (!config.purposeId) throw new Error("purposeId is required");
    if (!config.actorId) throw new Error("actorId is required");
    if (!config.model) throw new Error("model is required");
    if (!config.systemPrompt) throw new Error("systemPrompt is required");
    if (!config.workDir) throw new Error("workDir is required");
    if (!config.governedService) throw new Error("governedService is required");
  }

  private generateSessionId(): string {
    return `csess_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  private buildGDKContext(sessionId: string, workOrderId: string): GDKContext {
    return {
      assemblyId: this.config.assemblyId,
      purposeId: this.config.purposeId,
      actorId: this.config.actorId,
      sessionId,
      workOrderId,
      autonomyTier: this.config.autonomyTier ?? 0,
    };
  }

  private async createWorkOrder(): Promise<string> {
    // Use the governed service's kernel client to create a work order
    // This is a simplified version - in production, this would use the full
    // GovernedService.executeGovernedAction flow
    const service = this.config.governedService;

    // Access the kernel client through the service (public property per SDD-GDK §4.3.1)
    const kernelClient = (service as any).kernelClient;
    if (!kernelClient) {
      throw new Error("GovernedService does not have a kernelClient");
    }

    const workType = this.config.workType ?? "PROJECT";
    const idempotencyKey = `wo_${this.config.assemblyId}_${Date.now()}`;

    // Create work order lifecycle span
    const ctx = this.buildGDKContext("", "");
    const woSpan = this.observability.startWorkOrderSpan("[gdk.workorder.lifecycle]", ctx, "create");

    try {
      const workOrderId = await kernelClient.createWorkOrder({
        assemblyId: this.config.assemblyId,
        purposeId: this.config.purposeId,
        workType,
        autonomyTier: this.tierToString(this.config.autonomyTier ?? Tier.Autonomous),
        intentClass: "agent_session",
        context: {
          workDir: this.config.workDir,
          actorId: this.config.actorId,
        },
        idempotencyKey,
      });

      woSpan.setAttribute("work_order_id", workOrderId);
      woSpan.setAttribute("workorder.operation", "create");
      woSpan.end();

      return workOrderId;
    } catch (error) {
      woSpan.recordException(error instanceof Error ? error : new Error(String(error)));
      woSpan.setAttribute("error", true);
      woSpan.end();
      throw error;
    }
  }

  private async closeWorkOrder(status: "COMPLETED" | "FAILED" | "CANCELLED"): Promise<void> {
    if (!this.state) return;

    const ctx = this.buildGDKContext(this.state.sessionId, this.state.workOrderId);
    const woSpan = this.observability.startWorkOrderSpan("[gdk.workorder.lifecycle]", ctx, "close");

    woSpan.setAttribute("workorder.operation", "close");
    woSpan.setAttribute("workorder.final_status", status);
    woSpan.end();

    // In a full implementation, this would update the work order status
    // For now, we rely on the kernel's work order lifecycle
    // The work order will be marked based on the session outcome
  }

  private tierToString(tier: Tier): string {
    switch (tier) {
      case Tier.Autonomous:
        return "T0";
      case Tier.Escalation:
        return "T1";
      case Tier.ExpertApproval:
        return "T2";
      case Tier.Blocked:
        return "T99";
      default:
        return "T0";
    }
  }

  private buildModel(config: ModelConfig): Model<any> {
    // Build a Model object compatible with @weops/gdk-ai
    return {
      id: config.modelId,
      name: config.modelId,
      api: "openai-completions" as any, // Default API - can be overridden
      provider: config.provider as any,
      baseUrl: config.baseUrl ?? "",
      reasoning: config.reasoning ?? false,
      input: ["text"],
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
      },
      contextWindow: 128000,
      maxTokens: this.config.maxTokens ?? 100000,
    };
  }

  private convertToLlmMessages(messages: AgentMessage[]): any[] {
    // Convert AgentMessage[] to LLM-compatible Message[]
    // This is a simplified conversion - full implementation would handle
    // all message types from @weops/gdk-ai
    return messages.map((msg) => {
      if (msg.role === "user") {
        return {
          role: "user",
          content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
        };
      }
      if (msg.role === "assistant") {
        return {
          role: "assistant",
          content: msg.content,
        };
      }
      if (msg.role === "toolResult") {
        return {
          role: "tool",
          tool_call_id: (msg as any).toolCallId,
          content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
        };
      }
      return msg;
    });
  }

  private async handleEvent(event: AgentEvent): Promise<void> {
    if (!this.state) return;

    switch (event.type) {
      case "turn_start":
        this.state.turns++;
        
        // Create turn span
        const turnCtx = this.buildGDKContext(this.state.sessionId, this.state.workOrderId);
        this.currentTurnSpan = this.observability.startTurnSpan("[gdk.turn]", turnCtx, this.sessionSpan as any);
        (this.currentTurnSpan as any).setAttribute("turn.number", this.state.turns);
        break;

      case "turn_end":
        // End turn span
        if (this.currentTurnSpan) {
          (this.currentTurnSpan as any).end();
          this.currentTurnSpan = null;
        }
        break;

      case "message_end":
        if (event.message.role === "assistant") {
          const usage = (event.message as any).usage as Usage | undefined;
          if (usage) {
            this.state.inputTokens += usage.input ?? 0;
            this.state.outputTokens += usage.output ?? 0;
            this.state.cachedTokens += (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
            
            // Record token metrics
            this.observability.recordTokens(usage.input ?? 0, usage.output ?? 0, {
              session_id: this.state.sessionId,
              turn: this.state.turns,
            });
          }
        }
        break;

      case "tool_execution_start":
        // Tool span is created by the governance layer
        break;

      case "tool_execution_end":
        // Track tool execution for metrics
        if (event.toolCall) {
          const toolCtx = createToolContext(
            this.buildGDKContext(this.state.sessionId, this.state.workOrderId),
            event.toolCall.name,
            this.config.sideEffectMap?.[event.toolCall.name] ?? "EXECUTE"
          );
          
          // Record tool execution duration if available
          const duration = (event as any).durationMs;
          if (duration) {
            this.observability.recordToolDuration(duration, {
              tool_name: event.toolCall.name,
              session_id: this.state.sessionId,
            });
          }
        }
        break;

      case "agent_end":
        this.state.completed = true;
        break;
    }
  }

  private countTurns(messages: AgentMessage[]): number {
    // Count turns by counting assistant messages
    return messages.filter((m) => m.role === "assistant").length;
  }

  private recordFinalMetrics(): void {
    if (!this.state) return;

    // Record final token count
    this.observability.recordTokens(
      this.state.inputTokens,
      this.state.outputTokens,
      {
        session_id: this.state.sessionId,
        final: true,
      }
    );

    // Record estimated cost (simplified - would use actual model pricing)
    const estimatedCost = this.estimateCost(
      this.state.inputTokens,
      this.state.outputTokens
    );
    this.observability.recordCost(estimatedCost, {
      session_id: this.state.sessionId,
    });
  }

  private estimateCost(inputTokens: number, outputTokens: number): number {
    // Simplified cost estimation in cents
    // Would use actual model pricing in production
    const inputCost = inputTokens * 0.0001; // $0.001 per 1K tokens
    const outputCost = outputTokens * 0.0002; // $0.002 per 1K tokens
    return Math.round((inputCost + outputCost) * 100); // Convert to cents
  }

  private buildResult(status: SessionResult["status"]): SessionResult {
    if (!this.state) {
      throw new Error("Session state is null");
    }

    return {
      sessionId: this.state.sessionId,
      workOrderId: this.state.workOrderId,
      status,
      turns: this.state.turns,
      metrics: this.metrics,
    };
  }
}

// ============================================================================
// Utility Exports
// ============================================================================

/** Create a new governed agent session with the given configuration */
export function createGovernedSession(config: GovernedSessionConfig): GovernedAgentSession {
  return new GovernedAgentSession(config);
}

/** Check if a session status indicates successful completion */
export function isSuccessfulStatus(status: SessionResult["status"]): boolean {
  return status === "completed" || status === "turn_limit";
}

/** Format session metrics for display/logging */
export function formatMetrics(metrics: SessionMetrics): string {
  return [
    `Tokens: ${metrics.totalInputTokens} in / ${metrics.totalOutputTokens} out / ${metrics.totalCachedTokens} cached`,
    `Gates: ${metrics.gatesEvaluated} evaluated / ${metrics.gatesDenied} denied / ${metrics.gatesEscalated} escalated`,
    `Evidence: ${metrics.evidenceRecords} records`,
    `Duration: ${metrics.durationMs}ms`,
  ].join(" | ");
}
