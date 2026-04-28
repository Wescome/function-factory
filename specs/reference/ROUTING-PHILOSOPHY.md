# Model Routing Philosophy — Decision Framework for Governor Agent

**Status:** Active — governs all routing decisions, human or autonomous
**Source:** CEF data from 20+ live runs, 2026-04-27/28
**Audience:** Governor Agent (autonomous), Architect Agent (design), Human (override)

---

## Core Principle

**Quality over speed. Always.** Speed is not a systems requirement during bootstrap. The Factory must produce correct output — fast output that fails verification is waste. Once the self-healing loop is operational and quality is stable, speed optimization becomes a routing parameter. Not before.

---

## The Three-Tier Model Selection Framework

### Tier 1: Structural Quality (Pipeline Stages 1-5)

**What it does:** Converts Signals into WorkGraphs through decomposition, classification, and compilation.

**What matters:** Rich structural output — more atoms, more invariants, more dependencies, better lineage. A richer WorkGraph gives the synthesis agents more to work with.

**Model selection criterion:** Choose the model that produces the most structurally complete Gate 1 output. Measure by:
- Atom count (more = better decomposition)
- Invariant count (more = better constraint extraction)
- Dependency count (more = better relationship modeling)
- Gate 1 pass rate (must be 100%)

**CEF evidence:**

| Model | Atoms | Invariants | Dependencies | Gate 1 |
|-------|-------|-----------|-------------|--------|
| qwen-coder-32b | 16 | 2 | 8 | PASS |
| deepseek-r1-32b | 6 | 3 | 4 | PASS |
| llama-3.3-70b | 10-12 | 6-8 | 10-12 | PASS |

**Decision:** llama-3.3-70b wins for Tier 1. 3-4x more invariants than 32b models. The structural richness matters more than the model size efficiency.

**Governor rule:** If a pipeline stage model's invariant extraction drops below 3 per WorkGraph on average (over 10 runs), generate a Signal to evaluate alternative models.

### Tier 2: Agent Reliability (Stage 6 Synthesis Roles)

**What it does:** Produces BriefingScripts, Plans, Code, Reviews, Tests, Verdicts through multi-turn agent loops with tool calls.

**What matters:** Reliable structured JSON output after tool call round-trips. The agent must:
1. Express tool calls (text-based if native function calling unavailable)
2. Process tool results
3. Produce a final JSON response conforming to the schema

**Model selection criterion:** Choose the model that completes the full agentLoop cycle with valid output. Measure by:
- agentLoop completion rate (must complete, not crash)
- ORL failure mode distribution (lower F-count = better)
- Tool call success rate (tool calls detected and executed)
- Schema validation pass rate after coercion

**CEF evidence:**

| Model | agentLoop completes | Tool calls work | Schema valid | Synthesis verdict |
|-------|-------------------|----------------|-------------|------------------|
| qwen-coder-32b | YES | YES (text-based) | YES (with coercion) | fail (quality) |
| llama-3.3-70b | NO | PARTIAL (null after tool) | N/A | interrupt |
| kimi-k2.6 | NO | N/A | N/A | crash |

**Decision:** qwen-coder-32b wins for Tier 2. Only model that completes the full agentLoop cycle with tool calls. Quality is "fail" not "crash" — the ORL + coercion handles the output.

**Governor rule:** If an agent model's ORL repair rate exceeds 50% (over 10 runs), generate a Signal to evaluate alternative models. If the completion rate drops below 80%, immediately downgrade the model's reliability tier.

### Tier 3: Verification Quality (Production — Future)

**What it does:** Final quality gate. The synthesis output must be semantically correct, not just structurally valid.

**What matters:** The model must understand code, identify bugs, verify against the specification, and render sound verdicts.

**Model selection criterion:** This tier is for production routing via ofox.ai. Choose the model with the highest semantic accuracy on verification tasks. This is where claude-opus, gemini-pro, and deepseek-v4-pro operate.

**Governor rule:** Tier 3 models are activated when:
1. The Factory's self-healing loop is operational
2. The ORL repair rate is below 10%
3. The atom verification pass rate needs to exceed 50%
4. ofox.ai credits are funded

Until then, Tier 2 models handle everything. Quality failures are captured as CEF data points, not production defects.

---

## Routing Decision Table (for Governor Agent)

| Condition | Action | Confidence |
|-----------|--------|-----------|
| Model's Gate 1 pass rate < 95% | Replace for pipeline stages | Auto (>0.9) |
| Model's invariant count avg < 3 | Evaluate 70b+ alternatives | CRP (0.8) |
| Model's agentLoop completion rate < 80% | Downgrade reliability tier | Auto (>0.9) |
| Model's ORL repair rate > 50% | Evaluate alternative for agents | CRP (0.8) |
| Model's ORL F7 (null) rate > 10% | Remove from agent routing | Auto (>0.9) |
| Model's latency p95 > 120s | Move to fallback position | Auto (>0.9) |
| New model available on Workers AI | Create CEF evaluation Signal | CRP (0.7) |
| ofox.ai credits available + quality < threshold | Activate Tier 3 routing | CRP (0.8) |

---

## Anti-Patterns (What the Governor Must NOT Do)

1. **Never optimize for speed before quality is stable.** A 2-minute synthesis that fails is worse than a 5-minute synthesis that passes.

2. **Never patch model-specific behavior in generic code.** If a model needs `response_format: json_object`, that goes in the provider-specific path (ADR-006 adapter), not in the generic ORL or pipeline code.

3. **Never assume a model's capabilities are stable.** Workers AI model updates can change behavior. The Governor must re-evaluate after any model version change.

4. **Never route based on a single run.** CEF data requires at least 3 runs per model per task kind before making routing decisions. Statistical significance matters.

5. **Never combine response_format + tools in the same call** (BL3: Mode Conflict). Choose one mode per call. The adapter handles this.

---

## How This Document Is Used

1. **Human (Wes):** Reviews and approves routing philosophy changes. Overrides any Governor decision.
2. **Governor Agent:** Reads this document from ArangoDB (`agent_designs` or `mentorscript_rules`) at startup. Applies the decision table when generating routing Signals.
3. **Architect Agent:** References this when designing routing fixes. Ensures proposed changes align with the three-tier framework.
4. **Hot Config:** The routing config in `config_routing` collection is the implementation of these decisions. This document is the WHY; the config is the WHAT.

---

## Version History

| Date | Change | Evidence |
|------|--------|---------|
| 2026-04-28 | Initial: qwen-coder-32b for everything | CEF run: 15/15 atoms fail but pipeline completes |
| 2026-04-28 | Split: llama-70b pipeline + qwen-coder agents | CEF: 70b produces 3x more invariants; qwen-coder is only model completing agentLoop |
| 2026-04-28 | Philosophy formalized | 20+ live runs, 4 models tested, ORL + hot-config operational |
