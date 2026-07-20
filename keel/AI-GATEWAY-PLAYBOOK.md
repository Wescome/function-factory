# KEEL — AI Gateway Model Playbook (live real-model generation)

Turns on the real model in your live deployment and runs one natural-language
task end-to-end: the LLM generates connectors-only code, the real oracle judges
it, the loop amends if wrong. No code changes — this is config + secret + a smoke.

## How the switch works

The Orchestrator picks the model per run:
- **Reserved intents** (`echo 42`, `converge`, `never`, `approve`, `uc-00x`,
  `degraded`, `multi`) always use the deterministic scripted model — so your
  existing smokes and CI stay reproducible even after you enable the gateway.
- **Any other intent** uses the real model **iff** `AI_GATEWAY_URL` and
  `AI_API_KEY` are set on the Worker. If they're not set, it falls back to
  scripted. Local/CI never sets them, so `npm run gate` stays 32/32 on scripted.

## Prereqs

- The v1 deploy is live (`keel-skeleton.koales.workers.dev`).
- An AI Gateway created in the Cloudflare dashboard (AI → AI Gateway → create),
  giving you a gateway id.
- A model endpoint. The adapter speaks the **OpenAI-compatible
  `/chat/completions`** contract and parses OpenAI *or* Anthropic response
  shapes.
  - **RECOMMENDED (validated live): Workers AI, no external key.** Point
    `AI_GATEWAY_URL` at the Workers AI OpenAI-compatible base
    (`https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai/v1`), set
    `AI_API_KEY` to a scoped Cloudflare API token, and `AI_MODEL` to a Workers
    AI model. Confirmed working end-to-end with `@cf/moonshotai/kimi-k2.6`.
  - Alternative: an external provider (OpenAI `gpt-4o-mini`, etc.) via a gateway
    provider path and that provider's key.

## Step 1 — set config + secret

`AI_GATEWAY_URL` is the base the adapter appends `/chat/completions` to.
```
# Workers AI (recommended, no external key):
https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai/v1
# or an external provider via a gateway:
https://gateway.ai.cloudflare.com/v1/<ACCOUNT_ID>/<GATEWAY_ID>/openai
```
Set the two non-secret vars in `wrangler.jsonc` (or via dashboard) and the key
as a secret:
```
# wrangler.jsonc  ->  "vars": { "AI_GATEWAY_URL": "...", "AI_MODEL": "@cf/moonshotai/kimi-k2.6" }
npx wrangler secret put AI_API_KEY      # paste the provider key
npx wrangler deploy
```
(Do NOT put the key in vars or the repo. Only `wrangler secret put`.)

## Step 2 — verify the switch without spending much

Confirm reserved intents STILL run scripted (cheap, deterministic) after enabling:
```
KEEL=https://keel-skeleton.koales.workers.dev
curl -s -X POST "$KEEL/admit?name=post-gw-echo" -H 'content-type: application/json' \
  -d '{"intent":"echo 42","acceptance":[{"id":"A1","statement":"","kind":"example"}],"connectors":["echo"],"capabilityCeiling":"connectors-only","approvalGated":[],"attemptBudget":3,"oracleRef":"echo@v1"}'
for i in $(seq 1 8); do curl -s "$KEEL/result?name=post-gw-echo"; echo; sleep 1; done   # -> ACCEPT (scripted, unchanged)
```

## Step 3 — the live real-model smoke

A natural-language intent (NOT a reserved keyword) whose acceptance the real
oracle can judge. Use the `multi@v1` suite (A1: result.value===42; A2: no ambient
egress) so the model has a concrete target:
```
curl -s -X POST "$KEEL/admit?name=live-model-1" -H 'content-type: application/json' \
  -d '{"intent":"Use the echo connector to return an object whose value field equals 42.","acceptance":[{"id":"A1","statement":"result.value === 42","kind":"example"},{"id":"A2","statement":"no ambient network egress","kind":"property"}],"connectors":["echo"],"capabilityCeiling":"connectors-only","approvalGated":[],"attemptBudget":3,"oracleRef":"multi@v1"}'

for i in $(seq 1 12); do curl -s "$KEEL/result?name=live-model-1"; echo; sleep 1; done
curl -s "$KEEL/timeline?name=live-model-1"; echo
```
**PASS:** reaches `ACCEPT`. The lineage shows a model-generated Action (the code
the LLM wrote), a real ExecutionTrace, and a passing Verdict. If the model's
first code is wrong, you'll see an **Amendment** and a second attempt — that's
the governed loop correcting a real model, which is the whole point.

**Interpreting outcomes (all are informative, none is a crash):**
- `ACCEPT` — the model wrote code that passed independent verification. 
- `ACCEPT` after an Amendment — it self-corrected using the oracle's evidence.
- `ESCALATE` — it couldn't satisfy the criteria within budget, or the oracle
  couldn't verify a criterion. Fail-closed; inspect `timeline` + `wrangler tail`.

## Step 4 — watch it think

```
npx wrangler tail
```
You'll see the gateway request per attempt. Latency now includes real inference
(seconds, not the ~35ms scripted path) plus the per-load Dynamic Worker cost.

## Report back

1. Did `live-model-1` reach ACCEPT? On attempt 1, or after an Amendment?
2. Paste the generated Action's `code` (from `readRun` / the trace) — is it
   sane connectors-only code?
3. If ESCALATE: the `timeline` + the `tail` output for the failing attempt.
4. Rough end-to-end latency (admit → ACCEPT).

## STOP conditions (report, don't work around)

- Gateway 401/403 on every attempt (the Action will be a throwing stub carrying
  the status) — a key/gateway-config problem, not a code fix.
- The model repeatedly generates code that uses a connector NOT in the spec's
  allowed set — that's a real prompt/governance finding worth a Decision, not a
  patch: the connectors-only ceiling is enforced at execution, so such code
  fails verification anyway, but persistent drift means the prompt needs work.

---

## Step 5 — the amendment smoke (the harness correcting a real model)

The attempt-1 smoke proves the wiring. THIS proves the claim that matters:
AMEND-with-evidence earns its keep against a real LLM. The task underspecifies a
derived requirement, so the model plausibly satisfies the salient part first and
misses the derived one — then the oracle's per-criterion evidence (now naming the
failed criterion + its statement) should let it self-correct.

```
curl -s -X POST "$KEEL/admit?name=amend-live-1" -H 'content-type: application/json' \
  -d '{"intent":"Use the echo connector to return an object with a value field of 42 and a check field.","acceptance":[{"id":"A1","statement":"result.value === 42","kind":"example"},{"id":"A2","statement":"result.check must equal result.value doubled","kind":"example"}],"connectors":["echo"],"capabilityCeiling":"connectors-only","approvalGated":[],"attemptBudget":3,"oracleRef":"derived@v1"}'

for i in $(seq 1 15); do curl -s "$KEEL/result?name=amend-live-1"; echo; sleep 1; done
curl -s "$KEEL/timeline?name=amend-live-1"; echo      # want: ... VerdictEmitted -> AmendmentRequested -> ... -> RunAccepted
curl -s "$KEEL/debug/nodes?name=amend-live-1"; echo   # both Action nodes: the wrong first, the corrected second
```

**The trace to capture (the whole point):**
- `timeline` shows a **VerdictEmitted (fail) → AmendmentRequested → ... → RunAccepted** — the model missed A2, the oracle said so, the model fixed it.
- `debug/nodes` shows **two Action nodes**: attempt 1 (check wrong or absent) and attempt 2 (`check: 84`). The two different codes ARE the harness steering a real model from wrong to right.

**Interpreting the three outcomes — all informative:**
- **ACCEPT after an Amendment** — the claim is proven: the model used the oracle's
  per-criterion evidence to correct itself. This is the trace to report.
- **ACCEPT on attempt 1** — the model one-shot it (it read the acceptance and got
  `check` right immediately). The claim is still unproven against a real model;
  make the derived requirement less guessable (see below) and rerun.
- **ESCALATE** — the model couldn't converge within budget. The most valuable
  finding: it means the amend evidence isn't sufficient for THIS model to fix
  THIS miss. That's a real Decision (enrich the evidence further, or the model is
  too weak), not a patch. Report the two Action codes + the timeline.

To make a first-miss more likely if the model one-shots: raise the bar so the
derived value can't be guessed from the intent — e.g. A2 = "result.check must
equal result.value times 3, minus 5" against an intent that only says "include a
check field". Keep the oracleRef pointing at a suite whose A2 encodes that rule.

## Report back (amendment smoke)

1. Terminal: ACCEPT-after-amend / ACCEPT-attempt-1 / ESCALATE.
2. Both Action codes from `debug/nodes` (attempt 1 and, if amended, attempt 2).
3. The `timeline` (did it show AmendmentRequested?).

---

## Step 6 — DIAGNOSTIC: is the amend-turn variance reasoning-model-specific?

**Context (read once).** Across live runs, cold-start generation (attempt 1) is
fast and reliable; the amend turn (retry-with-evidence) has high latency/failure
variance — sometimes a good self-correction in ~15-20s, sometimes empty,
sometimes a true >30s timeout. The harness already handles all of these safely
(fail-loud → budget → ESCALATE; nothing hangs or false-accepts). This is a
*convergence-rate* question, not a safety one. Leading hypothesis: the amend
prompt's observed-value + "try a materially different interpretation" framing
pushes a reasoning model into a long/stalled chain-of-thought on retries. This
step tests that hypothesis before committing a fix. **Do NOT pick a fix yet.**

**Do this — it's a config swap, no code change:**

1. Redeploy with the timeout fix already in this build (37/37 green locally), if
   not already deployed:
   ```
   npx wrangler deploy
   ```

2. Point `AI_MODEL` at a **non-reasoning** instruct model on Workers AI (any fast
   general instruct model — NOT a reasoning model). Change only this one var;
   leave the gateway URL, key, prompt, everything else identical.
   ```
   # wrangler.jsonc  ->  "vars": { ..., "AI_MODEL": "<a non-reasoning instruct model>" }
   npx wrangler deploy
   ```

3. Run the blind amend smoke **3 times**, fresh run names each:
   ```
   KEEL=https://keel-skeleton.koales.workers.dev
   for n in 1 2 3; do
     curl -s -X POST "$KEEL/admit?name=diag-nonreason-$n" -H 'content-type: application/json' \
       -d '{"intent":"Use the echo connector to return an object with a value field of 42 and a check field.","acceptance":[{"id":"A1","statement":"result.value === 42","kind":"example"},{"id":"A2","statement":"the check field must be a number internally consistent with value","kind":"example"}],"connectors":["echo"],"capabilityCeiling":"connectors-only","approvalGated":[],"attemptBudget":3,"oracleRef":"derived-blind@v1"}'
     for i in $(seq 1 20); do curl -s "$KEEL/result?name=diag-nonreason-$n"; echo; sleep 2; done
     curl -s "$KEEL/debug/nodes?name=diag-nonreason-$n"; echo "--- run $n end ---"
   done
   ```

4. For each run, record: did the **amend turn** (attempt 2+) complete, and how
   long did it take? (Cold start will be fine regardless — we already know that.)

**Read the result:**
- **Amend-turn variance VANISHES with the non-reasoning model** → cause confirmed:
  reasoning-chain blowup on retries. The fix is model-side/param-side (cap
  reasoning on the amend call), NOT the prompt. Report back and I'll build it.
- **Variance PERSISTS** → it's the amend prompt/payload itself, not the model
  class. The fix is to trim the amend prompt to the minimal gradient. Report back.

Either way this is one env-var swap and ~3 runs. **Do not raise the timeout as a
"fix"** — that masks the variance, it doesn't resolve it. Bring back the three
runs' amend-turn timings and outcomes; that data picks the fix.

---

## Step 7 — the convergence run (finally: ACCEPT-after-amend against a real model)

The diagnostic (Step 6) confirmed kimi-k2.6's amend-turn variance is
reasoning-chain blowup, and separately that a genuinely-blind rule with a free
constant (`value*2+7`) is unconvergeable by evidence that never leaks the answer
— llama couldn't get it either, and it *shouldn't* be gettable. So the clean
convergence trace needs a **fair** task (derivable from observed pairs) and a
model whose amend turn doesn't stall. Two levers, use either or both:

**Lever 1 — fair task (`derived-fair@v1`, check = value doubled, no free constant):**
```
KEEL=https://keel-skeleton.koales.workers.dev
curl -s -X POST "$KEEL/admit?name=converge-1" -H 'content-type: application/json' \
  -d '{"intent":"Use the echo connector to return an object with a value field of 42 and a check field.","acceptance":[{"id":"A1","statement":"result.value === 42","kind":"example"},{"id":"A2","statement":"the check field must be a number internally consistent with value","kind":"example"}],"connectors":["echo"],"capabilityCeiling":"connectors-only","approvalGated":[],"attemptBudget":4,"oracleRef":"derived-fair@v1"}'
for i in $(seq 1 20); do curl -s "$KEEL/result?name=converge-1"; echo; sleep 2; done
curl -s "$KEEL/debug/nodes?name=converge-1"; echo   # want: two+ Action nodes, the last with check=84
```

**Lever 2 — cap kimi's amend-turn reasoning** (if using kimi rather than the fast
instruct model): set `AI_MODEL` back to kimi and add the amend-turn param. The
adapter merges `amendParams` into the request body ONLY on amend turns:
```jsonc
// wrangler.jsonc vars — the exact param kimi honors may differ; try:
"AI_AMEND_PARAMS": "{\"reasoning_effort\":\"low\"}"
```
(If wiring `amendParams` from an env var isn't in the composition yet, the
non-reasoning instruct model from Step 6 already gives reliable amend turns — use
that for the convergence proof and treat the kimi param as a follow-up.)

**PASS — the trace we've been after:** `debug/nodes` shows the model's first
`check` guess (e.g. value, or 0), an AmendmentRequested, then a corrected
`check: 84`, then ACCEPT. That is a real model, wrong first, self-correcting on
the oracle's observed-value evidence — the claim, finally shown.

**Also valid (keep as the boundary fixture):** run the same against
`oracleRef: "derived-blind@v1"` (check = value*2+7). Expect **ESCALATE** — the
rule is unconvergeable without leaking the answer, and the harness correctly
refuses to false-accept. That ESCALATE is a feature, not a failure.

## Report back
1. `converge-1` (fair): ACCEPT-after-amend? Paste the two Action codes.
2. Which lever (fair task / non-reasoning model / kimi+cap) you used.
