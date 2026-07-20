# KEEL M3 — Close the Loop Result (Phase 4)

**Status: G4 = GREEN.** AMEND, ESCALATE, and PAUSE all run end-to-end on real
workerd, behind the M1-frozen ports. 17/17 tests pass (12 M1 contract + 2 M2
skeleton + 3 M3 close-loop).

```
npm run gate    # lint:deps && typecheck && test
```

## What G4 proves

Three connectors-only tasks, selected by `spec.intent`, exercise every loop
branch through real adapters:

| Task | Path | Asserted |
|---|---|---|
| `converge` | first attempt fails (value 41) → verdict evidence → **AMEND** → attempt 2 corrects (value 42) → **ACCEPT** | terminal ACCEPT; ≥2 Verdict nodes; an Amendment node present |
| `never` | always fails; budget 2 → **ESCALATE** (budget-exhausted) | terminal ESCALATE; exactly 2 Verdicts (= budget) |
| `approve` | calls approval-gated `gate.commit` → action aborts → **PAUSE**; `approve()` replays → **ACCEPT** | PAUSE with a real executionId; then ACCEPT after approve |

**G4's gate condition — "a first-attempt failure converges via amend" — is the
`converge` case, green.** The other two close the remaining loop exits.

## D8 is now real, not just designed

The PAUSE test exercises codemode's actual abort-and-replay: `gate.commit`
(requiresApproval) aborts the code action mid-run; the run returns PAUSE with the
durable executionId; a separate `approve()` call — reloading the spec and action
**from lineage** (INV-A: the graph is the source of truth) — calls
`exec.approve(executionId)`, codemode replays the action (prior calls as no-ops,
the gated call for real), and the completed trace flows through verify/decide to
ACCEPT. The resume survives a fresh DO invocation because codemode's execution
log is durable — the same durability D7 relies on.

## How the loop was closed

`src/domain/loop/run.ts` factored into reusable pieces (still substrate-free):
- `genExec` — one attempt's generate + execute; returns `paused` or `ready`.
- `verifyDecide` — verify + `decide()`; returns a terminal or an amend target.
- `continueFrom` — the attempt loop; `runLoop` = from attempt 1.
- `resumeApproved` — approve → completed trace → verify/decide → continue.

The Orchestrator persists a `pending_run` row on PAUSE and clears it once
`approve()` reaches a terminal. The scripted model became scenario-aware
(wrong→right once it has verifier evidence) so AMEND actually converges; a
`gate` connector (requiresApproval) drives PAUSE.

## Still deferred (unchanged from M2, by design)

- Model is scripted, not an LLM (Phase 4+ AI Gateway adapter).
- Oracle checks one hardcoded criterion, not compiled acceptance.
- Local workerd via Miniflare; no live-account deploy.
- No frozen-surface change: every edit was in adapters/composition or the
  substrate-free loop use-case. `grep -r cloudflare src/domain` still empty.

## Next: M4 (Phase 5) — lineage + replay

The custody graph exists (nodes + events in DO SQLite). M4 makes it observable:
content-addressed cross-run projection, and replay of any run from any state.
Gate G5: any run replays from any state. Per the roadmap, M4 can run in parallel
with M3 and is not blocked by it.
