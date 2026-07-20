# ADR-012: Pi-Container Execute Timeout and Workspace Cleanup Rules

> Retroactive ADR — decision implemented in PR #83 (fix commit), 2026-06-09
> Confidence: 🟢 CONFIRMED — workers/ff-pipeline/pi-container/server.mjs

---

## Status

**Accepted** (implemented)

---

## Context

The `pi-container` is a Node.js HTTP server running inside a CF Container (`gascity-supervisor`). It receives `/execute` requests from the Gas City gc binary and spawns the `pi` LLM coding agent. Two problems were found in production:

1. **Timeout misalignment**: `EXECUTE_TIMEOUT_MS` was 300,000ms (5 minutes). Gas City's `defaultExecuteTimeout` for pi-rpc calls is 6 minutes. When a slow LLM task hit the pi-container timeout first, the container returned an error. Gas City would classify this as `StatusFailed` rather than a client-side timeout, masking the real cause.

2. **Stale workspace symlinks**: `/workspace` is a symlink created per execution pointing to a temp work directory. On rapid sequential executions, if a prior `/workspace` symlink survived cleanup (due to error path skipping the unlink), the next execution's `symlink('/workspace')` call would fail with EEXIST. This caused spurious execution failures.

3. **Missing auth.json stub**: The pi agent attempted to read `~/.pi/agent/auth.json` on startup. When absent, it logged a warning on every execution cycle. While non-fatal, it produced noise in logs and created a silent-failure surface if the warning was ever promoted to an error.

---

## Decision

Three changes to `pi-container/server.mjs`:

1. **Raise EXECUTE_TIMEOUT_MS to 480,000ms (8 minutes)**. This gives a clean margin above Gas City's 6-minute client timeout. Gas City fires its client timeout first and classifies the event correctly; pi-container's timeout becomes a backstop rather than the trigger.

2. **Always unlink `/workspace` in both success and error cleanup paths** via `try { unlinkSync('/workspace') } catch {}`. The catch swallows ENOENT (symlink was already cleaned up) without masking other errors.

3. **Bake `auth.json` stub into the Dockerfile** alongside `models.json`. Content: `{"credentials":[]}`. This eliminates the missing-file log noise and future-proofs against any auth.json read being promoted to a hard failure.

---

## Consequences

### Positive
- Gas City timeout classification is now correct: 6-min Gas City timeout fires before 8-min pi-container backstop.
- Workspace symlink races on rapid sequential executions are eliminated.
- auth.json stub prevents a class of silent startup failures.

### Negative / Constraints
- The 8-minute backstop means a truly hung pi process will hold a container request slot for up to 8 minutes before being killed. This is acceptable given Gas City's 6-minute expected max.
- `auth.json` stub content `{"credentials":[]}` is an assumption about the pi agent's accepted schema. If the pi agent schema changes to require non-empty credentials for some codepath, the stub silently provides an empty list.

---

## Evidence

| Artifact | Notes |
|----------|-------|
| `workers/ff-pipeline/pi-container/server.mjs:58` | `EXECUTE_TIMEOUT_MS = 480_000` comment explains margin over Gas City 6min |
| `workers/ff-pipeline/pi-container/server.mjs:989+1008` | `unlinkSync('/workspace')` in both success and error cleanup |
| `workers/ff-pipeline/pi-container/Dockerfile:20-22` | auth.json stub baked alongside models.json |
| PR #83 commit message | "Gas City defaultExecuteTimeout = 6min; avoids StatusFailed misclassification" |
