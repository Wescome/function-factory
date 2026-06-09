# Harness Pipeline — SE Root-Cause Diagnosis

**Status:** Pending approval  
**Authored by:** SE agent 2026-05-18  
**Subject:** Why `coding-autonomous-1779114105` (and future runs) get stuck  

---

## Confirmed facts about the stuck run

- `init-harness-1` step returned `{runId}` with ✅ — `startHarnessRun()` completed end-to-end
- `harness-complete-1` waited 4 hours → eventually completed (VERIFY gate fail, not a stuck hang)
- Zero R2 artifacts under `runs/coding-autonomous-1779114105/` initially — no `SeedWorkspace`, no observability files

---

## Root causes — ranked by likelihood

### Bug 1 (CRITICAL) — `buildStageContextForRun` called BEFORE the try block
**File:** `src/harness-dispatcher.ts:324`  
**What happens:** `buildStageContextForRun` is awaited before `try { adapter.execute() } catch { workerThrew }`. Any throw here (e.g. CONTRACT stage can't find `SeedWorkspace` in R2 because preseed was skipped) escapes `dispatchOne` entirely — NOT captured as `workerThrew`. Queue consumer retries 3×, dead-letters. `harness-complete` is never fired. Workflow stuck forever.  
**Fix:** Move `buildStageContextForRun` call inside the `try` block at line 344.  
**Affects:** CONTRACT, MAP, PATCH, VERIFY stages — any stage with declared input artifacts.

### Bug 2 (CRITICAL) — `notifyWorkflowComplete` swallows sendEvent failures
**File:** `src/coordinator/run-coordinator.ts:275-302`  
**What happens:** `sendEvent` failure logs `[INFRA SIGNAL] infra:harness-complete-sendevent-failed` but does NOT retry. Workflow waits 7 days even though the run correctly terminated.  
**Fix:** On `sendEvent` failure, schedule a DO alarm or enqueue a retry message (e.g. to `feedback-signals`) so the event is durably delivered. The RunCoordinator already persists `KEY_RESULT` — a retry just needs to re-call `sendEvent` with the stored result.

### Bug 3 (CRITICAL) — `harness-dlq` queue has no consumer
**File:** `wrangler.jsonc:68`  
**What happens:** `"dead_letter_queue": "harness-dlq"` is declared but no consumer is bound. Messages exhausting 3 retries disappear. Any run hitting Bug 1 or a dispatcher crash is permanently stuck.  
**Fix:** Add `{ "queue": "harness-dlq", "max_batch_size": 10, "max_retries": 1 }` to `queues.consumers` + implement `src/harness-dlq-consumer.ts` + add `/force-complete` to RunCoordinator.

### Bug 4 (LATENT) — `compileOutputContracts` is inside the try block
**File:** `src/harness-dispatcher.ts:347`  
**Status:** Confirmed NOT a hang source — it's inside the try block, captured as `workerThrew`. No action needed.

### Bug 5 (LATENT) — Pi model resolution code does NOT run for non-pi workers
**File:** `src/harness-dispatcher.ts:359-362`  
**Status:** Confirmed safe — gated by `stage.worker === "pi"` ternary. `preseed` worker is unaffected.  
**Caveat:** If `PI_FILESYSTEM_MODEL_CANDIDATES` env var contains a malformed model ID, `parseModelId` throws inside the try block → captured as `workerThrew` → still POSTs `/stage-complete`. Not a hang, but a latent failure for pi stages.

---

## Why `coding-autonomous-1779114105` showed "4 hours" then completed

The run was NOT stuck — it was executing. The harness ran SEED → CONTRACT → MAP → PATCH → VERIFY over 4 hours. The "Duration: 4 hours" at first check was the real elapsed time. It completed with:

```
overall: fail
finalStage: VERIFY
reason: gate failed: test_results_support_claims: VerifierReport must contain "Tests run"
failureClass: gate_abort
```

**Pi DID author a patch autonomously.** The failure is a content quality issue: Pi's VerifierReport is missing the "Tests run" section that the `test_results_support_claims` gate requires.

---

## Priority fix order (SE recommendation)

| Order | Bug | File:Line | Fix | Time |
|-------|-----|-----------|-----|------|
| 1 | `buildStageContextForRun` before try block | `harness-dispatcher.ts:324` | Move inside try | 5 min |
| 2 | `notifyWorkflowComplete` no retry | `run-coordinator.ts:275` | DO alarm retry on failure | 30 min |
| 3 | `harness-dlq` no consumer | `wrangler.jsonc:68` + new files | DLQ consumer + `/force-complete` | 2h |

---

## Separate issue — VERIFY gate failure (current blocker for autonomous Pi)

**Gate:** `test_results_support_claims`  
**Requirement:** VerifierReport must contain a "Tests run" section  
**Root cause:** Pi's VERIFY stage prompt doesn't explicitly require this section, or the VerifierReport contract (`kind: markdown, sections: [Verdict, Tests, Evidence]`) isn't enforcing the exact heading "Tests run"  
**Fix options:**
1. Update VerifierReport contract to require pattern `^Tests run` explicitly
2. Update VERIFY stage prompt to instruct Pi to include a "Tests run" section with test output
3. Both
