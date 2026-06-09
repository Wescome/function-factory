# Pattern: Token Rotation Kills Running Container

## Problem
`wrangler secret put` on a Worker that backs a Container DO restarts the Worker. This evicts the running Container, wiping ephemeral state (bead store, DB, in-flight sessions) and forcing a cold boot on next request.

## Root Cause
Cloudflare Workers restart on secret changes. A Container-backed DO's Container lifecycle is tied to the DO instance, which is tied to the Worker version. Worker restart = Container eviction.

## Solution
**Don't rotate tokens in first-dispatch.sh before dispatching.** Token rotation is a pre-flight operation, not a per-dispatch operation. Separate concerns:

- **One-time setup** — `wrangler secret put` for all tokens before the first ever dispatch. Never again unless compromised.
- **Per-dispatch** — only call `/dispatch-formula`. No secret changes.

If rotation is necessary (key compromise): rotate, wait for Container to cold-start and become healthy, then dispatch.

## Known Instances
- 2026-05-29: `first-dispatch.sh` rotates all 6 secrets before dispatch. Each `wrangler secret put` on `gascity-supervisor` restarts the Worker and evicts the Container. By the time dispatch fires, the Container is cold and the 25s window expires.

## Applied By
- `.agent/patterns/container-cold-boot-timeout.md` — cold boot is the downstream symptom
