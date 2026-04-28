# ADR-006: Workers AI Stream Adapter for gdk-agent

## Status

Proposed — requires architect review

## Date

2026-04-28

## Lineage

ADR-005 (vertical slicing), ADR-004 (CF platform primitives), live run evidence (v5.1 full Workers AI run: Stages 1-5 pass, agents fail with 400 on HTTP call to Workers AI binding)

---

## 1. Decision

Create a custom `StreamFn` adapter that wraps the Cloudflare Workers AI `env.AI.run()` binding for use with gdk-agent's `agentLoop`. This allows all 6 synthesis agents to use Workers AI at zero cost, eliminating the dependency on external LLM providers (ofox.ai) for the inner synthesis loop.

---

## 2. Context: The Binding vs HTTP Gap

### How pipeline stages call Workers AI (works)

Pipeline stages (Stages 1-5) call Workers AI via `callProvider()` in `providers.ts`:

```typescript
const result = await env.AI.run(target.model, {
  messages: [...],
  response_format: { type: 'json_object' },
  max_tokens: 2048,
})
return result.response
```

This uses the `AI` binding — a Cloudflare-internal API available only inside the Worker runtime. No HTTP, no auth headers, no external network. Fast, free.

### How agents call LLMs (broken for Workers AI)

Agents use `agentLoop()` from gdk-agent, which calls `streamSimple()` from gdk-ai. The streaming provider is selected by the Model's `api` field (e.g., `openai-completions`). The provider makes an HTTP POST to `model.baseUrl`:

```
agentLoop → streamSimple → openai-completions provider → fetch(model.baseUrl + '/chat/completions')
```

When `model.baseUrl` is `https://api.ofox.ai/v1`, this works — ofox.ai is an HTTP API. When we tried to point it at Workers AI (`https://api.cloudflare.com/client/v4/ai/run`), it returned 400 — Workers AI requires the `AI` binding, not an HTTP endpoint.

### The gap

gdk-agent's `agentLoop` accepts an optional `streamFn` parameter (5th argument):

```typescript
function agentLoop(
  prompts: AgentMessage[],
  context: AgentContext,
  config: AgentLoopConfig,
  signal?: AbortSignal,
  streamFn?: StreamFn,  // <-- custom stream function
): EventStream<AgentEvent, AgentMessage[]>
```

When provided, `streamFn` replaces `streamSimple` as the LLM call mechanism. This is the extension point.

---

## 3. Design: Workers AI Stream Adapter

### StreamFn contract

From gdk-agent types:

```typescript
type StreamFn = (
  model: Model<any>,
  context: Context,
  options?: SimpleStreamOptions,
) => AssistantMessageEventStream | Promise<AssistantMessageEventStream>
```

The adapter must:
1. Accept the same arguments as `streamSimple`
2. Call `env.AI.run()` with the messages and tools from `context`
3. Parse the response into an `AssistantMessage`
4. Wrap it in an `AssistantMessageEventStream` that emits the correct events

### Implementation

Create `workers/ff-pipeline/src/agents/workers-ai-stream.ts`:

```typescript
import {
  type AssistantMessage,
  type Context,
  type SimpleStreamOptions,
  type Model,
  type TextContent,
  type ToolCall,
  AssistantMessageEventStream,
} from '@weops/gdk-ai'

type AIBinding = {
  run(model: string, input: Record<string, unknown>): Promise<{
    response: string | Record<string, unknown>
  }>
}

export function createWorkersAIStreamFn(ai: AIBinding): StreamFn {
  return (model, context, options) => {
    const stream = new AssistantMessageEventStream()

    queueMicrotask(async () => {
      try {
        // Build messages array from context
        const messages: { role: string; content: string }[] = []
        if (context.systemPrompt) {
          messages.push({
            role: 'system',
            content: context.systemPrompt + '\n\nRespond ONLY with valid JSON.',
          })
        }
        for (const msg of context.messages) {
          if (msg.role === 'user') {
            const content = typeof msg.content === 'string'
              ? msg.content
              : msg.content.filter(c => c.type === 'text').map(c => c.text).join('\n')
            messages.push({ role: 'user', content })
          } else if (msg.role === 'assistant') {
            const text = msg.content.filter(c => c.type === 'text').map(c => c.text).join('')
            messages.push({ role: 'assistant', content: text })
          } else if (msg.role === 'toolResult') {
            const text = msg.content.filter(c => c.type === 'text').map(c => c.text).join('')
            messages.push({ role: 'user', content: `Tool result for ${msg.toolName}: ${text}` })
          }
        }

        // Build tools array for Workers AI function calling
        const tools = context.tools?.map(t => ({
          type: 'function' as const,
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        }))

        // Call Workers AI binding
        const result = await ai.run(model.id, {
          messages,
          ...(tools && tools.length > 0 ? { tools } : {}),
          max_tokens: options?.maxTokens ?? 2048,
          response_format: { type: 'json_object' },
        } as Record<string, unknown>)

        const resp = result.response
        const raw = typeof resp === 'string' ? resp : JSON.stringify(resp)

        // Parse response — check for tool calls
        let content: AssistantMessage['content'] = []
        let stopReason: AssistantMessage['stopReason'] = 'stop'

        // Workers AI may return tool_calls in the response
        const parsed = typeof resp === 'object' && resp !== null ? resp as Record<string, unknown> : null
        if (parsed?.tool_calls && Array.isArray(parsed.tool_calls)) {
          for (const tc of parsed.tool_calls) {
            content.push({
              type: 'toolCall',
              id: tc.id ?? `call-${Date.now()}`,
              name: tc.function?.name ?? 'unknown',
              arguments: typeof tc.function?.arguments === 'string'
                ? JSON.parse(tc.function.arguments)
                : tc.function?.arguments ?? {},
            } as ToolCall)
          }
          stopReason = 'toolUse'
        } else {
          content.push({ type: 'text', text: raw } as TextContent)
        }

        const message: AssistantMessage = {
          role: 'assistant',
          content,
          api: 'workers-ai' as any,
          provider: 'cloudflare',
          model: model.id,
          usage: {
            input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason,
          timestamp: Date.now(),
        }

        stream.push({ type: 'start', partial: message })
        stream.push({ type: 'done', reason: stopReason, message })
        stream.end(message)
      } catch (error) {
        const errorMessage: AssistantMessage = {
          role: 'assistant',
          content: [],
          api: 'workers-ai' as any,
          provider: 'cloudflare',
          model: model.id,
          usage: {
            input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: 'error',
          errorMessage: error instanceof Error ? error.message : String(error),
          timestamp: Date.now(),
        }
        stream.push({ type: 'error', reason: 'error', error: errorMessage })
        stream.end(errorMessage)
      }
    })

    return stream
  }
}
```

### Wiring into agents

Each agent's `agentLoop` call gains a 5th argument — the custom streamFn:

```typescript
// In agent constructor opts:
interface AgentOpts {
  db: ArangoClient
  apiKey: string
  dryRun?: boolean
  model?: Model<any>
  ai?: AIBinding  // Workers AI binding — when present, uses binding instead of HTTP
}

// In the agentLoop call:
const streamFn = this.ai ? createWorkersAIStreamFn(this.ai) : undefined

const stream = agentLoop(
  [userMessage],
  { systemPrompt, messages: [], tools },
  { model, convertToLlm, getApiKey, maxTokens },
  AbortSignal.timeout(600_000),
  streamFn,  // undefined = use default streamSimple (HTTP), or custom Workers AI
)
```

### Coordinator wiring

The coordinator passes `env.AI` (when available) to all agent constructors:

```typescript
const architectAgent = new ArchitectAgent({
  db: this.getDb(),
  apiKey: this.env.OFOX_API_KEY ?? '',
  dryRun,
  ai: this.env.AI,  // Workers AI binding
})
```

When `ai` is present, the agent uses `createWorkersAIStreamFn(ai)`. When absent (e.g., testing, or no AI binding), it falls back to gdk-ai's HTTP streaming with ofox.ai.

---

## 4. CF Platform Mapping

| Component | Primitive | How |
|-----------|-----------|-----|
| Pipeline stages (Stages 1-5) | `env.AI.run()` via `callProvider()` | Direct binding call, no HTTP |
| Agents (agentLoop) | `env.AI.run()` via custom `StreamFn` | Adapter wraps binding as stream |
| Tool execution (arango_query) | `fetch()` to ArangoDB | Standard HTTP, unchanged |
| Result relay | `SYNTHESIS_RESULTS` Queue | Queue binding, unchanged |

---

## 5. Tool Calling via Workers AI

Workers AI supports function calling on compatible models. The adapter maps gdk-agent's tool definitions to Workers AI's `tools` parameter:

```typescript
// gdk-agent tool → Workers AI function
{
  type: 'function',
  function: {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,  // TypeBox schema → JSON Schema
  },
}
```

When Workers AI returns `tool_calls` in the response, the adapter converts them to gdk-ai `ToolCall` content blocks. The agentLoop then executes the tools and loops.

**Model compatibility:** Not all Workers AI models support function calling. `qwen2.5-coder-32b-instruct` does. If a model doesn't support tools, the adapter should fall back to prompt-based tool invocation (include tool descriptions in the system prompt and parse tool calls from the text response).

---

## 6. Risks

| # | Risk | L | I | Mitigation |
|---|------|---|---|-----------|
| R1 | Workers AI doesn't support tool_calls on qwen2.5-coder | Medium | High | Test with actual tool call; fall back to prompt-based tools |
| R2 | AssistantMessageEventStream construction differs from gdk-ai internals | Low | Medium | Match the exact event sequence from faux provider tests |
| R3 | Workers AI response format differs from OpenAI tool_calls schema | Medium | Medium | Normalize in adapter; test with actual responses |
| R4 | Workers AI rate limits under concurrent atom DOs | Low | Medium | Each DO has independent binding; CF scales internally |

---

## 7. Verification Criteria

| # | Criterion | Evidence |
|---|-----------|----------|
| V1 | Agent agentLoop completes with Workers AI stream adapter | Faux test: mock AI.run, verify agentLoop produces final message |
| V2 | Tool call round-trip works | Test: AI.run returns tool_calls, adapter creates ToolCall, agentLoop executes tool, sends result, AI.run returns text |
| V3 | Pipeline stages still work (no regression) | All 504 tests pass |
| V4 | Live synthesis completes end-to-end on Workers AI | POST /pipeline → complete with verdict pass or fail (not interrupt) |
| V5 | Zero external API cost | ofox.ai credit balance unchanged after run |

---

## 8. Implementation Plan

1. Create `workers-ai-stream.ts` with `createWorkersAIStreamFn`
2. Add `ai?: AIBinding` to all agent opts
3. Pass `streamFn` as 5th arg to `agentLoop` when `ai` is present
4. Update coordinator to pass `env.AI` to agents
5. Write tests with mock AI binding
6. Deploy and live test

**Estimated effort:** 1 focused session. No new infrastructure (no queues, no DOs, no migrations).
