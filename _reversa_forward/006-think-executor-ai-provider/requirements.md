---
# 006-think-executor-ai-provider

## JTBD
When ThinkExecutor builds a ConductingAgent, I want the Mastra Agent to resolve its
model (kimi-k2.6, claude-opus-4-6, etc.) through a wired provider — so atoms actually
execute instead of throwing at agent.generate() due to a missing LLM connection.

## Source
Gaps identified during multi-bead smoke test investigation 2026-06-14:
- GAP-AI-01 (CRITICAL): Mastra's cloudflare-workers-ai provider reads CLOUDFLARE_ACCOUNT_ID
  via process.env, which is not populated in a CF Workers DO context. Agent.generate()
  throws immediately — no LLM call is ever made.
- GAP-AI-02 (MODERATE): ConductorEnv has no CF credential fields. The DO never has
  access to account_id or api_key to configure the provider.
- GAP-AI-03 (LOW): successCondition {type: "always"} is invalid — evaluateCondition
  throws on unknown type. Smoke directives use this, masking whether failures are
  from LLM calls or from condition-check failures.

## Root cause
Mastra v1.42.0's built-in cloudflare-workers-ai provider interprets the URL template
  "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/v1"
by reading process.env.CLOUDFLARE_ACCOUNT_ID — which doesn't exist in CF Workers.
Env vars in Workers arrive as DO constructor bindings, not process.env.

Fix: MastraModelConfig accepts OpenAICompatibleConfig — { id, url, apiKey, headers }.
Cloudflare's AI REST endpoint is OpenAI-compatible. Pass url and apiKey explicitly from
env bindings instead of relying on Mastra's process.env lookup.

No new packages needed. @ai-sdk/cloudflare is NOT required.

## Fix Specs

### Fix 1 — Add CF credential fields to ConductorEnv

packages/gears/src/agents/conducting-agent.ts:

  export interface ConductorEnv {
    DB: D1Database
    LOADER: WorkerLoader
    SANDBOX?: unknown
    CF_API_TOKEN: string          // used to auth against CF AI REST API
    CLOUDFLARE_ACCOUNT_ID: string // used to build the CF AI REST URL
  }

### Fix 2 — Build OpenAICompatibleConfig for cloudflare/* models

packages/gears/src/agents/conducting-agent.ts → buildConductingAgent():

  const { modelId } = MODEL_BY_ROLE[directive.role]

  const model = modelId.startsWith('cloudflare/')
    ? {
        id: modelId as `${string}/${string}`,
        url: `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/v1`,
        apiKey: env.CF_API_TOKEN,
      }
    : modelId  // Mastra string resolution for openai/*, anthropic/*, google/* etc.

  Agent({ ..., model })

  The "cloudflare/" prefix in MODEL_BY_ROLE is the Mastra provider prefix. It is kept
  in the id field of OpenAICompatibleConfig so Mastra can still correlate the model
  for observability/tracing. It does not affect the actual API call — the url field
  overrides the provider registry URL entirely.

### Fix 3 — Add CF credentials to ThinkExecutor Env and wrangler.jsonc

packages/gears/src/agents/think-executor.ts:
  Env extends ConductorEnv — CF_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are inherited.
  No explicit redeclaration needed. No code change to think-executor.ts.

workers/ff-pipeline/wrangler.jsonc:
  Add CLOUDFLARE_ACCOUNT_ID as a plain var (not sensitive):
    "vars": {
      ...
      "CLOUDFLARE_ACCOUNT_ID": "cb56a846c70a38987f31cf6e2b85cb57"
    }
  CF_API_TOKEN is already referenced in the secrets comment (line 157). Verify it is
  set as a wrangler secret: wrangler secret list | grep CF_API_TOKEN

### Fix 4 — Add successCondition type "always"

packages/schemas/src/atom-directive.ts:
  Add to SuccessCondition union:
    z.object({ type: z.literal('always') })

packages/gears/src/agents/think-executor.ts → evaluateCondition():
  Add case before default:
    case 'always': return true

  Use for: smoke atoms, warmup atoms, side-effect-only operations.
  Distinct from exit-code (which also returns true) — "always" signals intent.

## Files
- packages/gears/src/agents/conducting-agent.ts (Fix 1, Fix 2)
- packages/gears/src/agents/think-executor.ts (Fix 4 — evaluateCondition)
- packages/schemas/src/atom-directive.ts (Fix 4 — schema)
- workers/ff-pipeline/wrangler.jsonc (Fix 3 — CLOUDFLARE_ACCOUNT_ID var)
- Secret: CF_API_TOKEN (already in use by worker — verify set, no code change)

## Gates
- pnpm --filter @factory/gears typecheck
- pnpm --filter @factory/schemas typecheck
- pnpm typecheck (full monorepo)
- wrangler secret list | grep CF_API_TOKEN  (must be set before deploy)
- wrangler deploy + multi-bead smoke with role:coder + successCondition:{type:"always"}
  → bead_audit: verdict "done" for both beads

## Open questions
- Is CF_API_TOKEN already set as a secret on ff-pipeline? Check: wrangler secret list
- Does the Koales CF account have @cf/moonshotai/kimi-k2.6 enabled for Workers AI?
  Check: wrangler ai models 2>/dev/null | grep kimi
- Non-cloudflare roles (openai/gpt-5.5, anthropic/claude-opus-4-6): Mastra resolves
  these via process.env.OPENAI_API_KEY / ANTHROPIC_API_KEY. Same process.env gap applies.
  Out of scope for this fix — tracked separately as GAP-AI-04.
---
