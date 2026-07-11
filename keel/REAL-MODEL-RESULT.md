# KEEL — Real Model (AI Gateway) Result (post-v1, step: real generation)

**Status: LIVE-CONFIRMED in production.** A real model generated correct
connectors-only code on the first attempt and the loop accepted it. 32/32 tests
green (28 scripted + 4 gateway-adapter unit). Off by default — enabled only when
`AI_GATEWAY_URL` + `AI_API_KEY` are set, so local/CI stays deterministic.

## Live run (production)

- Model: `@cf/moonshotai/kimi-k2.6` via Workers AI's OpenAI-compatible route
  (no external provider key — a scoped Cloudflare token). The adapter's
  OpenAI-compat contract worked against Workers AI unchanged.
- Task (natural language): "Use the echo connector to return an object whose
  value field equals 42." Suite `multi@v1` (A1 example + A2 property).
- **Generated Action code:** `return await echo.emit({ value: 42 });` — minimal,
  correct, connectors-only, exactly on target.
- **Result: ACCEPT on attempt 1**, both criteria pass, no Amendment needed.
  Full chain: Specification -> Action(model-generated) -> ExecutionTrace
  (result {value:42}, completed) -> Verdict(pass).
- Latency: admit -> ACCEPT ~4s (real inference; vs ~35ms scripted).
- A read-only `GET /debug/nodes?name=X` route was added (now in canonical
  worker.ts) to inspect full node content — the model's code — over HTTP.

Attempt-1 ACCEPT on a simple task proves the wiring end-to-end. The harder,
more telling live run is a task the model gets *wrong* first — that's where
AMEND-with-evidence and ESCALATE earn their keep against a real model.

## What was built

`src/adapters/model/gateway-model.adapter.ts` — a second `ModelPort` behind the
frozen port. It prompts an LLM through Cloudflare AI Gateway (OpenAI-compatible
`/chat/completions`; parses OpenAI *or* Anthropic response shapes), instructing
it to write **connectors-only** code that satisfies the spec's acceptance, and
on an amend it appends the failing verdict's per-criterion evidence so the model
corrects. Fetch is injectable — unit-tested without a live call.

Design choices that matter:
- **Env-gated selection** (`src/composition/orchestrator.ts`): reserved smoke
  intents always use the scripted model; any other intent uses the gateway model
  iff configured. So enabling the real model in prod does not disturb the
  deterministic smokes or CI.
- **Fails loud, never fabricates.** A gateway error (401/etc.) yields a throwing
  Action, which executes to nothing and the oracle fails it -> amend/escalate.
  The system never invents code to paper over a model outage.
- **The model is the one untrusted component**, and the whole harness exists to
  govern it: connectors-only execution bounds what its code can do, the
  independent oracle judges the result, the loop amends with evidence, lineage
  records every attempt, and a model outage degrades closed.

## Tested (test/gateway-model.test.ts, mocked gateway)

| Case | Asserted |
|---|---|
| OpenAI-shaped response | code extracted, fences stripped, connectors = spec's allowed set; prompt contains intent + acceptance + connector docs |
| Anthropic-shaped response | parsed via `content[0].text` |
| Amend | prompt appends the failing per-criterion evidence |
| Gateway error (401) | Action is a throwing stub carrying the status — no fabricated code |

## Live verification (your step)

`AI-GATEWAY-PLAYBOOK.md`: set `AI_GATEWAY_URL` + `AI_MODEL` (vars) and
`AI_API_KEY` (secret), redeploy, then admit a natural-language task and watch the
model generate code that the real oracle judges — ACCEPT (possibly after an
Amendment where the model self-corrects on the oracle's evidence).

## No frozen-shape change (still)

`ModelPort.generate` is unchanged; the adapter is additive alongside the scripted
one. `grep -r cloudflare src/domain` empty. Seven consecutive integrations now
(M2-M5, real oracle, deploy, real model) with the frozen surface unmoved.

## Now unblocked / remaining

- With a real model live, the last deferred item — **emitting `crossRun` to a D1
  index** — indexes real work, not toy runs. That's the natural next step.
