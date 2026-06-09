# Pattern: Ephemeral Container Store

## Problem
Data stored on a Container's filesystem (bead store, ArangoDB, Dolt) is wiped when the Container restarts. Any state accumulated during execution — beads, DB records, session artifacts — is lost on idle-kill or redeployment.

## Root Cause
Cloudflare Container filesystems have no persistence layer. There are no managed volumes. Every Container restart begins from the image.

## Instances in this project
- **Gas City bead store** (`/data/cities/factory/.beads/`) — `provider = "file"`. Bead IDs reset on restart (gc-11 every time). In-flight formula executions lose their beads.
- **ArangoDB in ff-arango** — `sleepAfter = "30m"`. All Factory artifacts (EPs, VRs, functions) are wiped after 30 minutes of inactivity.
- **Dolt in gascity-supervisor** — runs on port 3306 inside Container, ephemeral.

## Solutions (in order of preference)

1. **External persistent store** — move state out of the Container entirely. ArangoDB → managed ArangoDB (Oasis or self-hosted). Bead store → external Dolt with R2/S3 remote. This is the production-grade fix.
2. **Accept ephemeral for bootstrap** — for short-lived dogfood runs where the full execution completes within one Container lifetime, ephemeral is fine. Document it explicitly.
3. **DO SQLite** — Cloudflare DOs have built-in SQLite storage (`this.ctx.storage`). Viable for bead store if Gas City is refactored to use it.

## Status (2026-05-29)
Both ff-arango and gascity bead store are ephemeral. Accepted for bootstrap. Must be resolved before multi-hour formula executions or production use.
