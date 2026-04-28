# SE Assessment: LLM Output Reliability

**Frameworks:** Issue Formulation (Armstrong, Ch. 24), Architecture Review (Levis, Ch. 12), Risk Assessment (Haimes, Ch. 3)
**Source:** Sage & Rouse (1999), CEF data from 4 Workers AI model runs, vertical-slicing-research.md
**Ontology extension:** output-reliability-extension.ttl (Domain 8)

---

## 1. Issue Formulation (Armstrong, Ch. 24)

### 1.1 Situation Assessment

**Trigger:** 4 consecutive CEF runs across different Workers AI models show the same pattern: pipeline Stages 1-5 + Gate 1 work perfectly. Synthesis agents fail on LLM output parsing. The failure is NOT model-specific.

**Symptoms vs root cause:**
- Symptom: each run fails with a different parsing error
- Symptom: each fix (extractJSON, coercion, text tool detection) addresses one failure mode
- Symptom: the next run reveals a different failure mode
- **Root cause:** The agent architecture assumes LLM output will conform to the requested schema. This assumption is false for ALL models. The architecture has no systematic response to schema violations.

### 1.2 Value System Design — Objectives Tree

```
Mission: Reliable structured output from any LLM
├── O1: Parse any response format (0.25)
│   ├── O1.1: Handle valid JSON
│   ├── O1.2: Handle JSON in markdown fences
│   ├── O1.3: Handle JSON mixed with prose
│   └── O1.4: Handle null/empty responses
├── O2: Validate against expected schema (0.25)
│   ├── O2.1: Detect missing required fields
│   ├── O2.2: Detect wrong field types
│   ├── O2.3: Detect wrong field names
│   └── O2.4: Detect tool calls in text
├── O3: Repair automatically when possible (0.30)
│   ├── O3.1: Coerce types deterministically (zero cost)
│   ├── O3.2: Map field name aliases (zero cost)
│   ├── O3.3: Re-prompt with schema (one LLM call)
│   └── O3.4: Re-prompt fresh (one LLM call, last resort)
└── O4: Fail gracefully with diagnostics (0.20)
    ├── O4.1: Classify the failure mode
    ├── O4.2: Preserve raw response for debugging
    └── O4.3: Emit structured error to caller
```

**Weight rationale:** O3 (repair) is highest because the Factory's value comes from completing synthesis, not from detecting failures. O1 (parse) and O2 (validate) are enablers for repair. O4 (fail gracefully) is the safety net.

### 1.3 System Synthesis — Alternatives

| # | Alternative | Description |
|---|------------|-------------|
| A | **Status quo + more patches** | Keep adding extractJSON tiers, coercion rules, text tool detection per failure as encountered. Reactive. |
| B | **Unified reliability layer** | Single module between LLM response and agent logic. Parse → Validate → Coerce → Repair → Fail. Proactive. |
| C | **Constrained decoding** | Use grammar-guided generation (Outlines/Guidance pattern) to force valid JSON at the token level. Prevents failures entirely. |
| D | **Schema-aware re-prompt loop** | Like Instructor/Guardrails: validate against Pydantic/TypeBox schema, on failure re-prompt with the schema + error message + original request. Up to N retries. |

### 1.4 Systems Analysis — Interaction Matrix

| | Parse | Validate | Coerce | Repair | Constrained | Workers AI |
|---|---|---|---|---|---|---|
| **A (patches)** | Partial (extractJSON) | Partial (per-agent) | Partial (coerce.ts) | None | N/A | Compatible |
| **B (unified layer)** | Complete (6-tier) | Schema-based | Complete (coerce.ts) | Re-prompt loop | N/A | Compatible |
| **C (constrained)** | Not needed | Not needed | Not needed | Not needed | Requires model support | **NOT compatible** with Workers AI binding |
| **D (re-prompt loop)** | Partial | Schema-based | Optional | Re-prompt with error | N/A | Compatible |

**Key finding:** Option C (constrained decoding) is theoretically ideal but **incompatible with Workers AI**. The `env.AI.run()` binding does not expose grammar/constrained decoding parameters. This eliminates C for the Workers AI path. C remains viable for ofox.ai production path (some providers support it).

### 1.5 Interpretation — Multi-Criteria Comparison

| Criterion (weight) | A: Patches | B: Unified Layer | C: Constrained | D: Re-prompt Loop |
|---|---|---|---|---|
| Completeness (0.25) | 40 | 95 | 100 | 70 |
| Implementation cost (0.15) | 90 | 50 | 20 | 60 |
| Workers AI compat (0.20) | 100 | 100 | 0 | 100 |
| Repair capability (0.25) | 10 | 90 | 100 | 80 |
| Observability (0.15) | 20 | 90 | 50 | 60 |
| **Weighted total** | **48.5** | **87.5** | **55.0** | **73.5** |

**Winner: Option B (Unified Reliability Layer)** — score 87.5, margin of 14 over D.

### 1.6 Decision

**Selected: Option B — Unified Reliability Layer**, incorporating D's re-prompt loop as Stage 5.

The layer is a single module that every agent calls between receiving the LLM response and processing the business logic. It implements the 6-stage pipeline formalized in the ontology extension (output-reliability-extension.ttl).

---

## 2. Architecture Review (Levis, Ch. 12)

### 2.1 Current Architecture — Five Required Models

**Activity Model (IDEF0):**

```
Current: LLM Response → [Agent extractAndParseJSON] → Business Logic
                              ↑ per-agent, inconsistent
```

Each of the 6 agents has its own `extractAndParseJSON()` function. Each has its own coercion logic. There is no shared parsing, validation, or repair. When a new failure mode appears, it must be fixed in 6 places.

**Data Model:** No formal schema validation. Agents check fields imperatively (`if typeof !== 'string'`). No TypeBox/JSON Schema validation at the boundary.

**Rule Model:** Coercion rules are scattered across agent validators and `coerce.ts`. No decision table mapping failure modes to repair strategies.

**Dynamics Model:** No state machine for response processing. The current flow is: parse → throw or continue. No retry, no repair, no fallback path.

**Dictionary:** Failure modes are not named or classified. Errors say "model response is not an object" — they don't say "F1: prose instead of JSON."

### 2.2 Proposed Architecture

**Activity Model (IDEF0):**

```
Proposed:
  LLM Response → [Parse Stage] → [Detect Tool Calls] → [Validate Stage] → [Coerce Stage] → [Repair Stage] → Business Logic
                                                                                                    ↓ (if repair fails)
                                                                                              [Fail Stage] → Structured Error
```

Single module: `output-reliability.ts`. Called by every agent. Replaces the per-agent `extractAndParseJSON` + `validateXxx` + coercion.

**Data Model:** Each agent's expected output is defined as a TypeBox schema (or JSON Schema). The reliability layer validates against this schema. The ontology extension (C18-C20) formalizes the per-role output contracts.

**Rule Model — Decision Table:**

| Failure Mode | Detection | Stage | Repair | Cost |
|---|---|---|---|---|
| F5: Markdown fences | `text.includes('```')` | Parse | FenceExtraction | Zero |
| F1: Prose + JSON | `text.indexOf('{') > 0` | Parse | BraceExtraction | Zero |
| F6: Text tool calls | `JSON has name + arguments + name ∈ tools` | DetectToolCalls | TextToolCallParsing | Zero |
| F4: Wrong types | Schema validation: type mismatch | Coerce | TypeCoercion | Zero |
| F3: Wrong field names | Schema validation: missing + extra fields | Coerce | FieldNameMapping | Zero |
| F2: Truncated JSON | Parse fails + ends mid-string | Repair | ReduceOutputSize re-prompt | 1 LLM call |
| F1: All prose | No JSON extractable | Repair | RePromptWithSchema | 1 LLM call |
| F7: Null response | response === null/undefined | Repair | RePromptFresh | 1 LLM call |

**Dynamics Model — State Machine:**

```
RECEIVED → PARSE_OK? → yes → DETECT_TOOLS? → VALIDATE → VALID? → yes → DONE
                                                          ↓ no
                                                    COERCE → VALID? → yes → DONE
                                                                ↓ no
                                                          REPAIR (attempt 1) → VALID? → yes → DONE
                                                                                  ↓ no
                                                          REPAIR (attempt 2) → VALID? → yes → DONE
                                                                                  ↓ no
                                                                            FAIL → ERROR
```

### 2.3 Architecture Fitness Assessment

| Criterion | Current | Proposed |
|---|---|---|
| Single responsibility | FAIL — 6 copies of parse+validate+coerce | PASS — one module |
| Schema-driven | FAIL — imperative field checks | PASS — TypeBox schema validation |
| Repair capability | FAIL — parse or throw | PASS — 6-stage pipeline with retry |
| Observability | FAIL — generic error messages | PASS — failure mode classification + raw response preserved |
| Model independence | FAIL — patches per model behavior | PASS — handles all 7 failure modes generically |
| Extensibility | FAIL — add code to 6 agents per new mode | PASS — add strategy to pipeline |

---

## 3. Risk Assessment (Haimes, Ch. 3) — TRM Six Questions

### Risk: LLM output unreliability persists across models and providers

| # | Question | Answer |
|---|----------|--------|
| 1 | What can go wrong? | Every LLM response can deviate from the expected schema in 7+ ways. New failure modes will emerge as new models are added. The reliability layer itself may have bugs. Re-prompt repair may produce worse output than the original. |
| 2 | What is the likelihood? | **Certain.** CEF data shows 100% failure rate on synthesis agents across 4 models. The only question is WHICH failure mode, not WHETHER one occurs. |
| 3 | What are the consequences? | Without the reliability layer: every synthesis run fails at the agent phase. The Factory cannot produce verified Functions. The entire Phase 2 (atom execution) is blocked. With the layer: most failures are auto-repaired at zero cost. Re-prompt failures cost 1-2 LLM calls per occurrence. |
| 4 | What has been done? | extractJSON (4-tier), coerce.ts, text tool call detection, action normalization, field name coercion, response_format hint, markdown fence stripping. Each is a point fix. |
| 5 | How do these actions affect the risk? | They reduce failure rate from ~100% to ~60-70% (based on which model and which agent). But each fix only covers one failure mode. New modes bypass existing fixes. |
| 6 | What else can be done? | **(a)** Unified reliability layer (Option B) — systematic, not reactive. **(b)** Schema-aware re-prompt as a repair stage — the LLM that produced bad output is the best fixer of its own output. **(c)** Per-model capability profiles — know which models support json_object mode, function calling, grammar constraints. Route accordingly. **(d)** Failure mode telemetry — track which modes occur on which models to inform CEF routing decisions. |

### PMRM Partition (Partitioned Multiobjective Risk Method)

| Outcome Range | Probability | Impact | Action |
|---|---|---|---|
| **Best case:** All responses parse cleanly (StructuredResponse) | 20% | None | Parse stage handles it |
| **Expected case:** Response needs extraction + coercion (SemiStructured/Malformed) | 60% | Zero-cost repair | Stages 1-4 handle it deterministically |
| **Worst case:** Response requires re-prompt or is unrepairable | 20% | 1-2 LLM calls + possible failure | Stage 5 (repair) + Stage 6 (fail) |

**Key insight from PMRM:** The expected case (60%) is handleable at zero cost. The current architecture treats ALL failure modes as the worst case (throw and fail). The reliability layer shifts the majority of responses from "crash" to "auto-repair."

### Risk Register

| # | Risk | L | I | Mitigation |
|---|------|---|---|-----------|
| OR-R1 | New failure mode not covered by pipeline | Medium | Medium | Extensible stage architecture + failure mode telemetry + ontology tracks new modes |
| OR-R2 | Re-prompt repair produces worse output | Low | High | Validate re-prompt output against same schema. If worse, use original. Max 2 attempts. |
| OR-R3 | Re-prompt cost accumulates across atoms | Medium | Medium | Track repair costs in completion ledger. Budget: max 2 re-prompts per atom × N atoms. |
| OR-R4 | Reliability layer adds latency | Low | Low | Stages 1-4 are zero-cost (string ops). Only Stage 5 adds latency (re-prompt). |
| OR-R5 | TypeBox schema doesn't match agent expectations | Medium | Medium | Generate schemas from agent designs (designs.ts outputValidation). Single source of truth. |

---

## 4. Recommendation

### Immediate: Build the Unified Reliability Layer (ADR-007)

1. **Single module** `output-reliability.ts` implementing the 6-stage pipeline
2. **TypeBox schemas** for each agent's output (BriefingScript, Plan, CodeArtifact, CritiqueReport, TestReport, Verdict)
3. **Replace** per-agent `extractAndParseJSON` + `validateXxx` with a single call to the reliability layer
4. **Re-prompt repair** with schema + error for Stages 5 (max 2 attempts)
5. **Failure mode classification** logged to ArangoDB for CEF telemetry

### Per-model capability profiles (Phase 2)

Create a `ModelCapabilities` type in the routing config:

```typescript
interface ModelCapabilities {
  supportsJsonMode: boolean
  supportsFunctionCalling: boolean
  supportsGrammarConstraint: boolean
  maxOutputTokens: number
  reliabilityTier: 'high' | 'medium' | 'low'
}
```

The reliability layer adapts its behavior per model: skip re-prompt for high-reliability models, always re-prompt for low-reliability models, use grammar constraints when available.

### Telemetry (Phase 3)

Track per-model failure mode frequencies in ArangoDB. Feed into CEF routing decisions: if model X has 80% F4 (wrong types) and 0% F1 (prose), route it to tasks where type coercion handles everything. If model Y has 30% F1 (prose), route it away from tasks requiring complex JSON.

---

**Attribution:** Issue formulation from Armstrong (Ch. 24), architecture review from Levis (Ch. 12), risk assessment from Haimes (Ch. 3), all in Sage & Rouse (1999). CEF data from Function Factory live runs 2026-04-28.
