# Pattern: Container Cold Boot Timeout

## Problem
Cloudflare Container cold start (image pull + process init + port bind) takes 30–90s. HTTP callers with hard timeouts (e.g. 25s `PER_CALL_TIMEOUT_MS` in formula-compiler.ts) fail with `timeout_call_1` or similar before the Container is ready.

## Root Cause
Containers are ephemeral. Any restart — triggered by idle-kill, secret rotation, new deployment — requires a full cold boot. The caller's timeout window doesn't account for this.

## Solution
Three levers, use in combination:

1. **Increase caller timeout** — raise `PER_CALL_TIMEOUT_MS` in formula-compiler.ts to cover worst-case cold boot (recommend 90s).
2. **Retry on 503** — the formula compiler already retries 503s within the deadline window; this only helps if the deadline is long enough.
3. **Keep container warm** — use `sleepAfter` on the Container class (e.g. `sleepAfter = "30m"`) so idle-kill happens less frequently. Requires extending `Container` base class, not raw `DurableObject`.

## Known Instances
- 2026-05-29: `dispatch-formula` → `timeout_call_1` on `GET /formulas/factory-coding-v1`. Container cold boot exceeded 25s window after token rotation.

## Applied By
- `.agent/patterns/token-rotation-kills-container.md` — token rotation is a common cold boot trigger
