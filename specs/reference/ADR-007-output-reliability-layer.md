# ADR-007: Output Reliability Layer

## Status

Proposed — requires architect review

## Date

2026-04-27

## Lineage

ADR-006 (Workers AI stream adapter), CEF evidence (4 model runs: qwen-coder-32b, kimi-k2.6, deepseek-r1-32b, llama-3.3-70b), vertical slicing research (ADR-005)

---

## 1. Decision

Create a unified Output Reliability Layer (ORL) that sits between every LLM response and the business logic that consumes it. The ORL replaces the 7 copy-pasted `extractAndParseJSON` functions and ad-hoc per-agent validators with a single, schema-driven pipeline: **Parse -> Validate -> Coerce -> Repair -> Fail**.

This is not optional hardening. It is the architectural response to a model-independent failure class that 4 consecutive CEF runs have proven exists across every Workers AI model we can access.

---

## 2. Research Survey: How Production Systems Solve This

### 2.1 Instructor (jxnl/567-labs)

The most widely adopted library for structured LLM output (3M+ monthly downloads, 11k stars). Core pattern:

1. Define output schema as Pydantic model
2. Derive JSON Schema, include in LLM request
3. Validate response against Pydantic model
4. On validation failure: feed the validation error message back to the LLM as context, retry
5. Configurable max retries via Tenacity

**Key insight:** Instructor does not try to fix the output itself. It sends the *validation error* back to the model and asks it to try again. The model is the repair mechanism, not the code.

**Relevance to Factory:** This is the pattern our Repair stage should follow. Re-prompting with the specific validation error is more effective than heuristic patching.

### 2.2 Outlines / XGrammar / Constrained Decoding

Grammar-guided generation constrains the model's token sampling at decode time. A finite state machine derived from a JSON Schema masks out invalid tokens at each generation step. XGrammar (now the default backend for vLLM, SGLang, TensorRT-LLM as of March 2026) achieves <40 microsecond per-token overhead.

**Key insight:** Constrained decoding is the only approach that provides *guarantees* rather than *probabilities*. If you control the inference engine, you can make malformed output structurally impossible.

**Relevance to Factory:** We do NOT control the inference engine. Workers AI is a black-box binding. Constrained decoding is not available to us. This means we must solve reliability post-generation, not during generation. This is the fundamental constraint that shapes the entire ORL design.

### 2.3 DSPy Assertions

DSPy's assertion mechanism provides two primitives:
- `dspy.Assert` (hard constraint): on failure, backtrack and retry with the assertion failure message injected into a modified prompt
- `dspy.Suggest` (soft constraint): same retry, but continues on persistent failure instead of raising

The retry works by dynamic signature modification: the model receives its previous output, the assertion failure message, and a modified prompt that includes `Past Output` and `Instruction` fields.

**Key insight:** DSPy separates structural assertions (the output must parse) from semantic assertions (the output must be correct). Both use the same retry mechanism but have different failure modes. The Factory needs this same separation.

**Relevance to Factory:** Our Coerce step handles structural normalization. Our Validate step handles semantic correctness. Repair (re-prompt) handles both when they fail.

### 2.4 Guardrails AI

Guardrails wraps LLM calls with a validation loop:
1. Call LLM
2. Validate against schema + custom validators
3. On failure: construct a "re-ask" prompt containing the error and original request
4. Repeat up to `num_reask` times

**Key insight:** Guardrails tracks validation failure patterns and retry statistics. This observability is critical for understanding which schemas and which models produce the most failures.

**Relevance to Factory:** ORL must emit structured telemetry for every parse/validate/coerce/repair event. Without it, we cannot compare model reliability.

### 2.5 OpenAI Structured Outputs (strict mode)

OpenAI's `response_format: { type: "json_schema", json_schema: { strict: true } }` uses server-side constrained decoding. Claims 100% schema adherence in evals. Available for GPT-4o and later.

**Key insight:** Even with strict mode, OpenAI recommends SDK-level validation because the model can return a `refusal` instead of content when safety filters trigger. The validation layer is needed even when the provider claims guarantees.

**Relevance to Factory:** Workers AI's `response_format: { type: "json_object" }` is NOT equivalent to OpenAI strict mode. It requests JSON output but does not constrain decoding. The ORL must not assume any provider gives guarantees.

### 2.6 Anthropic Claude tool_use

Anthropic skipped "loose JSON mode" and went directly to constrained decoding for tool inputs (`strict: true` on tool schemas). Schema validation is enforced server-side.

**Key insight:** Even with provider-level guarantees, the output might not match *business* constraints (e.g., confidence is a float between 0 and 1, decision is one of three enum values). Provider-level structural guarantees do not eliminate the need for application-level semantic validation.

### 2.7 LangChain OutputParsers

LangChain provides `OutputFixingParser` which catches parse errors, sends the error + original output to the LLM with a "fix this" prompt, and retries. Also provides `RetryOutputParser` which includes the original prompt in the retry context.

**Key insight:** Including the original prompt in the retry (not just the error) significantly improves repair success. The model needs to know what it was *trying* to produce, not just what went wrong.

### 2.8 The Emerging Consensus

Across all 7 systems, the pattern is identical:

```
Schema -> Request -> Parse -> Validate -> [Coerce] -> [Repair via re-prompt] -> Fail
```

Every production system implements some subset of this pipeline. The differences are:
- **Where** validation happens (server-side constrained decoding vs client-side post-processing)
- **How** repair works (re-prompt with error vs heuristic patching vs retry without context)
- **What** the schema language is (Pydantic, Zod, JSON Schema, TypeBox)

The Factory must implement the full pipeline client-side because we cannot control Workers AI's decoding.

---

## 3. Failure Taxonomy: What We Have Observed

Four CEF runs across 4 models produced 7 distinct failure classes. These are model-independent -- every model exhibited at least 2.

| ID | Failure | Observed In | Root Cause | Frequency |
|----|---------|-------------|------------|-----------|
| F1 | Prose instead of JSON | llama-3.3-70b (architect) | Model ignores JSON instruction, produces natural language | High |
| F2 | Truncated JSON | llama-3.3-70b (compiler) | Output exceeds max_tokens or model stops mid-object | Medium |
| F3 | Wrong field names | qwen-coder (birthGateScore missing) | Model invents field names instead of following schema | High |
| F4 | Wrong field types | qwen-coder (strategicAdvice as array) | Model returns array where string expected, or vice versa | High |
| F5 | JSON in markdown fences | qwen-coder, deepseek-r1 (compiler) | Model wraps JSON in ```json``` blocks as trained | Very High |
| F6 | Tool calls as text | qwen-coder (agents) | Model lacks native function calling, returns tool call as text JSON | High |
| F7 | Null/undefined response | kimi-k2.6 | Model returns empty or null; binding error | Low |

### Failure class analysis

**Parseable failures (F2, F5):** The JSON is present but wrapped or incomplete. Pure extraction logic handles these. Our existing `extractAndParseJSON` already handles F5 (fence stripping) and partially handles F2 (brace matching).

**Schema failures (F3, F4):** The JSON is valid but doesn't match the expected schema. Validation catches these. Coercion fixes F4 (type mismatches). F3 (wrong field names) requires either field mapping or re-prompt.

**Format failures (F1):** No JSON at all. Only re-prompting can fix this. The model must be told explicitly that its response was not JSON and must retry.

**Structural failures (F6):** Tool calls encoded in text. The Workers AI adapter (ADR-006) already handles this via `detectTextToolCalls`. This is an adapter-layer concern, not an ORL concern.

**Null failures (F7):** No response at all. Guard clause at the top of the pipeline. No parse, no validate -- just immediate retry or fail.

---

## 4. Architecture Design: The Output Reliability Layer

### 4.1 Pipeline

```
LLM Response (raw)
    |
    v
[Guard] -- F7: null/undefined/empty -> immediate retry or structured error
    |
    v
[Parse] -- F1, F2, F5: extract JSON from any response format
    |        Tier 1: direct JSON.parse
    |        Tier 2: strip markdown fences, parse
    |        Tier 3: find first { and last }, parse
    |        Tier 4: find first [ and last ], parse
    |        Tier 5: (new) regex for JSON-like content in prose
    |
    v
[Validate] -- F3, F4: check against expected schema (TypeBox/JSON Schema)
    |           Returns: { valid: true, data } | { valid: false, errors: ValidationError[] }
    |
    v
[Coerce] -- F4: normalize types (array->string, string->array, number->string, etc.)
    |         Also: field name normalization for known aliases (F3 partial)
    |         Re-validate after coercion
    |
    v
[Repair] -- F1, F3 (persistent): re-prompt LLM with:
    |         1. Original system prompt
    |         2. Original user message
    |         3. The model's invalid response
    |         4. Specific validation errors
    |         5. The expected schema
    |         Up to N attempts (configurable, default 2)
    |
    v
[Fail] -- Structured error with full diagnostic context:
           { stage: 'parse'|'validate'|'coerce'|'repair',
             attempts: number,
             lastError: string,
             rawResponse: string (truncated),
             schema: string }
```

### 4.2 Type Signature

```typescript
import type { TSchema } from '@sinclair/typebox'

/** Result of the ORL pipeline */
type ORLResult<T> =
  | { ok: true; data: T; attempts: number; coerced: boolean }
  | { ok: false; error: ORLError }

type ORLError = {
  stage: 'guard' | 'parse' | 'validate' | 'coerce' | 'repair'
  attempts: number
  errors: string[]
  rawResponse: string  // truncated to 500 chars
  schema?: string      // JSON Schema as string, for diagnostics
}

/** Configuration for the ORL */
type ORLConfig<T extends TSchema> = {
  schema: T                       // TypeBox schema for validation
  coerce?: boolean                // enable type coercion (default: true)
  maxRepairAttempts?: number      // re-prompt attempts (default: 2)
  repairFn?: RepairFn             // how to re-prompt the LLM
  fieldAliases?: Record<string, string>  // known field name mappings
  onEvent?: (event: ORLEvent) => void    // telemetry callback
}

type RepairFn = (
  originalPrompt: { system: string; user: string },
  invalidResponse: string,
  errors: string[],
  schema: unknown,  // JSON Schema object
) => Promise<string>  // new raw response from LLM

/** Telemetry events */
type ORLEvent =
  | { type: 'parse'; success: boolean; tier: number; ms: number }
  | { type: 'validate'; success: boolean; errorCount: number; ms: number }
  | { type: 'coerce'; fieldsCoerced: string[]; ms: number }
  | { type: 'repair'; attempt: number; success: boolean; ms: number }
  | { type: 'fail'; stage: string; ms: number }

/** The main entry point */
function reliableParse<T extends TSchema>(
  raw: string | null | undefined,
  config: ORLConfig<T>,
): Promise<ORLResult<Static<T>>>
```

### 4.3 Parse Stage (replaces 7 duplicated extractAndParseJSON functions)

The existing `extractJSON` in `providers.ts` and the 6 copy-pasted `extractAndParseJSON` functions in agent files all implement the same 3-tier extraction. The ORL consolidates this into a single `extractJSON` with a 5th tier:

```typescript
function extractJSON(text: string): { json: unknown; tier: number } | null {
  const trimmed = text.trim()

  // Tier 1: Direct parse
  try { return { json: JSON.parse(trimmed), tier: 1 } } catch {}

  // Tier 2: Strip markdown fences
  const fenceMatch = /```\w*\s*?\n?([\s\S]*?)(?:\n\s*)?```/.exec(trimmed)
  if (fenceMatch) {
    try { return { json: JSON.parse(fenceMatch[1].trim()), tier: 2 } } catch {}
  }

  // Tier 3: First { to last }
  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try { return { json: JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)), tier: 3 } } catch {}
  }

  // Tier 4: First [ to last ]
  const firstBracket = trimmed.indexOf('[')
  const lastBracket = trimmed.lastIndexOf(']')
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    try { return { json: JSON.parse(trimmed.slice(firstBracket, lastBracket + 1)), tier: 4 } } catch {}
  }

  // Tier 5: Truncation repair — if Tier 3/4 failed due to truncation,
  // try closing open braces/brackets
  if (firstBrace !== -1) {
    const candidate = repairTruncatedJSON(trimmed.slice(firstBrace))
    if (candidate) try { return { json: JSON.parse(candidate), tier: 5 } } catch {}
  }

  return null
}
```

Tier 5 is new. It addresses F2 (truncated JSON) by detecting unclosed braces and attempting minimal closure. This is a heuristic -- it works for simple truncation (model hit max_tokens mid-object) but not for complex nested structures. When Tier 5 succeeds, the telemetry marks it so we know how often we're relying on heuristic repair.

### 4.4 Validate Stage

Uses TypeBox + Ajv for schema validation. TypeBox is already in the gdk-ai dependency tree. Ajv compiles schemas to optimized validators (22x faster than Zod for complex schemas per 2026 benchmarks).

```typescript
import Ajv from 'ajv'
import type { TSchema } from '@sinclair/typebox'

const ajv = new Ajv({ allErrors: true, coerceTypes: false })

function validate(data: unknown, schema: TSchema): {
  valid: boolean
  errors: string[]
} {
  const valid = ajv.validate(schema, data)
  if (valid) return { valid: true, errors: [] }
  const errors = (ajv.errors ?? []).map(e =>
    `${e.instancePath || '/'}: ${e.message} (got ${JSON.stringify(e.data)?.slice(0, 100)})`
  )
  return { valid: false, errors }
}
```

### 4.5 Coerce Stage

Extends the existing `coerce.ts` functions with schema-awareness. Instead of each agent manually calling `coerceToString(record.goal)`, the ORL walks the schema and applies coercion based on the expected type:

```typescript
function coerceToSchema(data: Record<string, unknown>, schema: TSchema): {
  coerced: Record<string, unknown>
  fieldsCoerced: string[]
} {
  const fieldsCoerced: string[] = []
  const result = { ...data }

  if (schema.type === 'object' && schema.properties) {
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      if (!(key in result)) continue
      const value = result[key]
      const expectedType = (propSchema as TSchema).type

      if (expectedType === 'string' && typeof value !== 'string') {
        result[key] = coerceToString(value)
        fieldsCoerced.push(key)
      } else if (expectedType === 'array' && !Array.isArray(value)) {
        result[key] = coerceToArray(value)
        fieldsCoerced.push(key)
      } else if (expectedType === 'number' && typeof value !== 'number') {
        result[key] = coerceToNumber(value)
        fieldsCoerced.push(key)
      } else if (expectedType === 'boolean' && typeof value !== 'boolean') {
        result[key] = coerceToBoolean(value)
        fieldsCoerced.push(key)
      }
    }
  }

  // Field alias resolution
  // e.g., model returns "birthGateScore" instead of "gate1Score"
  // Config can specify { birthGateScore: 'gate1Score' }

  return { coerced: result, fieldsCoerced }
}
```

This makes coercion declarative and schema-driven rather than imperatively coded in each agent's validator.

### 4.6 Repair Stage

Follows the Instructor/Guardrails/DSPy pattern: re-prompt the LLM with the validation error as context.

```typescript
const REPAIR_PROMPT = `Your previous response was not valid JSON matching the required schema.

Previous response (first 500 chars):
{PREVIOUS_RESPONSE}

Validation errors:
{ERRORS}

Required JSON schema:
{SCHEMA}

Respond with ONLY a valid JSON object matching the schema above. No markdown fences, no explanation, no preamble.`
```

The `repairFn` in ORLConfig is the mechanism. Each agent provides its own repair function that calls the LLM through whatever provider it uses (Workers AI binding, ofox.ai, etc.). The ORL orchestrates the retry loop but does not own the LLM call.

### 4.7 Fail Stage

When all repair attempts are exhausted, the ORL returns a structured error. This replaces the current pattern of throwing generic errors like `"ArchitectAgent: could not extract JSON from response"`.

The structured error includes:
- Which stage failed (parse, validate, coerce, repair)
- How many attempts were made
- The specific validation errors
- A truncated copy of the raw response (for debugging, not re-prompting)
- The schema that was expected

This error is machine-readable. The coordinator can use it to decide whether to retry the entire agent, skip to a fallback, or escalate.

---

## 5. Where It Sits in the Stack

```
                    +-------------------+
                    | Agent Business    |
                    | Logic (produce    |
                    | BriefingScript,   |
                    | Plan, Code, etc.) |
                    +--------+----------+
                             |
                    receives typed data
                             |
                    +--------v----------+
                    | Output Reliability|  <-- NEW (this ADR)
                    | Layer (ORL)       |
                    |  Parse            |
                    |  Validate         |
                    |  Coerce           |
                    |  Repair           |
                    |  Fail             |
                    +--------+----------+
                             |
                    receives raw string
                             |
              +--------------+--------------+
              |                             |
    +---------v---------+         +---------v---------+
    | Workers AI Stream |         | gdk-ai streamFn   |
    | Adapter (ADR-006) |         | (HTTP providers)   |
    +-------------------+         +--------------------+
```

The ORL sits at the **consumer boundary** -- the point where raw LLM text becomes typed application data. It is above the stream adapter (ADR-006) and below the agent's business logic.

### Interaction with ADR-006

ADR-006's `parseResponse` function handles F6 (text tool calls) at the adapter layer. This is correct -- tool call detection is a transport-level concern (the adapter must convert text tool calls into structured ToolCall blocks before the agentLoop sees them).

The ORL handles F1-F5 and F7 at the consumer layer. The agent receives an AssistantMessage from the agentLoop, extracts the text content, and passes it through the ORL.

These two layers are complementary:
- ADR-006 adapter: raw binding response -> structured AssistantMessage (handles F6)
- ORL: AssistantMessage text -> typed business object (handles F1-F5, F7)

---

## 6. Implementation Plan

### Phase 1: Extract and Consolidate (1 session)

1. Create `workers/ff-pipeline/src/agents/output-reliability.ts`
2. Implement `extractJSON` (5-tier, replaces 7 copies of `extractAndParseJSON`)
3. Implement `validate` (TypeBox + Ajv)
4. Implement `coerceToSchema` (schema-driven, replaces per-agent manual coercion)
5. Implement `reliableParse` (the full pipeline, without Repair initially)
6. Write tests for each tier, each failure class (F1-F5, F7)

### Phase 2: Schema Definitions (1 session)

1. Define TypeBox schemas for each agent output:
   - `BriefingScriptSchema` (architect)
   - `PlanSchema` (planner)
   - `CodeArtifactSchema` (coder)
   - `CritiqueReportSchema`, `SemanticReviewSchema` (critic)
   - `TestReportSchema` (tester)
   - `VerdictSchema` (verifier)
2. Define TypeBox schemas for pipeline stage outputs (Stages 1-5 compile passes)
3. Wire schemas into agent validators, replacing manual field checks

### Phase 3: Migrate Agents (1 session)

1. Replace each agent's `extractAndParseJSON` + manual validation with `reliableParse`
2. Delete the 7 private `extractAndParseJSON` functions
3. Delete per-agent `validateX` methods (replaced by schema validation)
4. Keep `coerce.ts` as the primitive library; `coerceToSchema` in ORL calls it
5. Update `providers.ts` `extractJSON` to use the shared implementation

### Phase 4: Repair Loop (1 session)

1. Implement `RepairFn` wiring for each agent
2. Each agent's `RepairFn` uses its existing LLM call mechanism (Workers AI binding or ofox.ai)
3. Configure max repair attempts per agent (default 2)
4. Add telemetry callback for repair events
5. Test repair with synthetic F1 (prose) and F3 (wrong field names) responses

### Phase 5: Observability (1 session)

1. Wire `onEvent` callback to the pipeline's telemetry system
2. Track per-model, per-agent, per-failure-class statistics
3. Use this data to compare model reliability across CEF runs
4. Emit ORL metrics in CRP (Compile Run Protocol) for each synthesis

---

## 7. Risk Analysis

| # | Risk | L | I | Mitigation |
|---|------|---|---|-----------|
| R1 | Ajv bundle size in Workers | Medium | Medium | Ajv is ~120KB minified; Workers has 10MB limit. Profile after integration. Use `ajv/dist/jtd` for smaller build if needed. |
| R2 | Coercion hides real schema violations | Medium | High | Telemetry tracks every coercion. If a field is coerced >50% of the time, the schema or prompt needs fixing, not more coercion. |
| R3 | Repair loop increases latency | Medium | Medium | Repair is 1 additional LLM call. Budget is already 600s timeout. 2 repair attempts add ~10-20s. Acceptable for correctness. |
| R4 | Truncation repair (Tier 5) produces invalid data | Low | High | Tier 5 is marked in telemetry. Validation still runs after Tier 5 extraction. If the truncated JSON is missing required fields, validation catches it and triggers repair. |
| R5 | TypeBox schemas drift from runtime expectations | Medium | Medium | Schemas are the source of truth. Agent interfaces are derived from `Static<typeof Schema>`. TypeScript compiler catches drift at build time. |
| R6 | Repair re-prompt is itself malformed | Low | Medium | Repair prompt is a constant template, not LLM-generated. Only the variable slots (previous response, errors, schema) change. |

---

## 8. What the ORL Does NOT Do

1. **Constrained decoding.** We cannot control Workers AI's inference engine. The ORL is a post-generation layer.
2. **Prompt engineering.** The ORL does not modify the original system/user prompts. Prompt quality is a separate concern (better prompts reduce the ORL's workload, but the ORL must work regardless of prompt quality).
3. **Tool call detection.** That remains in ADR-006's adapter layer (`detectTextToolCalls`).
4. **Model selection.** The ORL is model-agnostic. It processes whatever the model returns. Model selection and routing remain in `task-routing`.
5. **Semantic correctness.** The ORL validates *structure* (is this valid JSON matching the schema?) and *types* (is confidence a number between 0 and 1?). It does NOT validate whether the BriefingScript's advice is architecturally sound. That is the Verifier agent's job.

---

## 9. Success Criteria

| # | Criterion | Evidence |
|---|-----------|----------|
| S1 | Zero copy-pasted `extractAndParseJSON` functions | grep returns 0 hits in agent files |
| S2 | All 7 failure classes handled by ORL | Unit tests for F1-F7 with synthetic responses |
| S3 | CEF run completes without JSON parse crashes | Full pipeline run on Workers AI, agents produce typed output |
| S4 | Telemetry shows parse/validate/coerce/repair rates | ORL events captured in CRP output |
| S5 | Repair loop recovers at least 1 failure per CEF run | Evidence from live run: repair attempt succeeds |
| S6 | No regression in existing tests | All 504 existing tests pass |

---

## 10. Appendix: Current State of Duplication

The following files contain identical or near-identical `extractAndParseJSON` implementations:

| File | Function | Lines |
|------|----------|-------|
| `agents/architect-agent.ts` | `extractAndParseJSON` | 204-224 |
| `agents/planner-agent.ts` | `extractAndParseJSON` | 193-211 |
| `agents/coder-agent.ts` | `extractAndParseJSON` | 198-218 |
| `agents/tester-agent.ts` | `extractAndParseJSON` | 178-198 |
| `agents/verifier-agent.ts` | `extractAndParseJSON` | 207-227 |
| `agents/critic-agent.ts` | `extractAndParseJSON` | 105-125 |
| `providers.ts` | `extractJSON` | 86-139 |

Total: 7 implementations of the same 3-tier extraction logic. The `providers.ts` version is the most complete (4 tiers including array extraction). The agent versions are all 3-tier (missing array extraction) and differ only in the error message string.

Each agent also has its own `validateX` method that manually checks required fields and calls coercion functions. These are all structurally identical: check typeof, check required fields, call coerce functions. The only variation is which fields each agent expects and which coerce functions it calls -- information that should live in a schema, not in imperative code.
