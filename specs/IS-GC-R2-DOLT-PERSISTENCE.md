# IS-GC-R2-DOLT-PERSISTENCE
# R2-backed Dolt bead store persistence for Gas City Container

## Problem
The Gas City bead store uses `provider = "file"` — a JSON file on the Container
filesystem at `/data/cities/factory/.beads/`. Every Container restart (from crash,
deploy, or idle sleep) wipes this file. All in-flight formula beads (Plan, Code,
Verify, Release) are lost.

Dolt runs locally at port 3306 but its data is also on the ephemeral filesystem
(`/data/dolt`). Dolt is not currently used by the bead store — the bead store is
pure file-backed (`provider = "file"`).

## Solution
Switch the bead store from `provider = "file"` to `provider = "bd"` (Dolt-backed).
Use Dolt's built-in AWS S3-compatible remote push/pull to persist the bead database
to Cloudflare R2 on every write-cycle, and restore from R2 on Container startup.

**Critical constraint from wrangler.jsonc comment:** Do NOT use R2 POSIX mount.
Dolt uses SQLite-style lock files and mmap that don't work over object-storage FUSE.
Use Dolt's native `dolt push` / `dolt pull` to an S3-compatible endpoint.

## Architecture

```
Container                          Cloudflare R2
/data/dolt/beads.db  <--pull---  r2://dolt-data/factory-beads
                     ---push-->  (on every gc supervisor commit cycle)
```

Dolt's S3-compatible remote URL syntax (using `aws://` scheme with R2 endpoint):
```
aws://[dynamo-table:s3-bucket]/database
```
For R2 (no DynamoDB needed — Dolt can skip the DynamoDB lock table with env var):
```
DOLT_REMOTE_PASSWORD=<R2-secret-key> \
AWS_ACCESS_KEY_ID=<R2-access-key> \
AWS_SECRET_ACCESS_KEY=<R2-secret-key> \
dolt remote add origin aws://[/:dolt-data]/factory-beads \
  --aws-region auto \
  --aws-creds-type env
```

R2 S3 endpoint: `https://<CF_ACCOUNT_ID>.r2.cloudflarestorage.com`
Set via `DOLT_AWS_ENDPOINT` or the Dolt config `remotes.aws_endpoint`.

## Changes required

### 1. Create R2 bucket
```
wrangler r2 bucket create dolt-data
```
✅ Bucket `dolt-data` already created 2026-05-29.

### 2. Create R2 API token
In Cloudflare dashboard → R2 → API tokens → Create token with:
- Object Read & Write on bucket `dolt-data`
- Note the Access Key ID and Secret Access Key

### 3. Set secrets on gascity-supervisor Worker
```
wrangler secret put DOLT_R2_ACCESS_KEY_ID     # R2 Access Key ID
wrangler secret put DOLT_R2_SECRET_ACCESS_KEY # R2 Secret Access Key
```
Also add to `Env` interface in `src/index.ts`:
```typescript
DOLT_R2_ACCESS_KEY_ID: string
DOLT_R2_SECRET_ACCESS_KEY: string
```
Pass to Container via `envVars` in constructor:
```typescript
this.envVars = {
  FF_OPERATOR_CONTROL_TOKEN: env.OPERATOR_CONTROL_TOKEN,
  GAS_CITY_HMAC_SECRET: env.GAS_CITY_HMAC_SECRET,
  AWS_ACCESS_KEY_ID: env.DOLT_R2_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY: env.DOLT_R2_SECRET_ACCESS_KEY,
  AWS_REGION: "auto",
  DOLT_AWS_ENDPOINT: `https://${CF_ACCOUNT_ID}.r2.cloudflarestorage.com`,
}
```
`CF_ACCOUNT_ID` is `cb56a846c70a38987f31cf6e2b85cb57` (from wrangler.jsonc push logs).

### 4. entrypoint.sh — startup restore + shutdown push

On startup, after `mkdir -p /data/dolt`:
```sh
# Restore bead store from R2 if this is a fresh Container
if [ ! -d /data/dolt/factory-beads ]; then
  echo "[startup] Restoring bead store from R2..."
  cd /data/dolt
  dolt clone aws://[/:dolt-data]/factory-beads \
    --aws-region auto 2>/tmp/dolt-clone.log || echo "[startup] No R2 backup yet, starting fresh"
fi
```

For push-on-commit, the simplest approach is a background sync loop:
```sh
# Background Dolt push loop — sync to R2 every 30s while supervisor runs
(
  while true; do
    cd /data/dolt/factory-beads && \
      dolt push origin main --force >/dev/null 2>&1 || true
    sleep 30
  done
) &
```

### 5. city.toml — switch bead provider to `bd`
```toml
[beads]
provider = "bd"
```

`bd` is the Dolt-backed bead store that `gc init` bootstraps. It requires `dolt`
on PATH (already in the image) and a Dolt database at the city path.

### 6. Add `bd init` to entrypoint.sh
After clone/restore, ensure the bead store is initialized:
```sh
cd /data/cities/factory
gc beads init --provider bd 2>/tmp/gc-beads-init.log || true
```

## Files to change

- `/Users/wes/eai/examples/factory/weops-gascity/stage/supervisor/wrangler.jsonc`
  - Uncomment the `r2_buckets` binding: `[{ "binding": "DOLT_DATA", "bucket_name": "dolt-data" }]`
  - Note: the R2 binding is for reference only — Dolt talks to R2 directly via S3 API, not via the Worker binding

- `/Users/wes/eai/examples/factory/weops-gascity/stage/supervisor/src/index.ts`
  - Add R2 credential env vars to `envVars` in constructor
  - Add to `Env` interface

- `/Users/wes/eai/examples/factory/weops-gascity/stage/supervisor/entrypoint.sh`
  - Add startup restore from R2
  - Add background push loop
  - Add `gc beads init` call

- `/Users/wes/eai/examples/factory/weops-gascity/stage/supervisor/factory/city.toml`
  - Change `provider = "file"` → `provider = "bd"`

## Pre-requisites
- IS-GC-PID1-SUPERVISION must be shipped first. R2-backed persistence is only
  meaningful when the Container doesn't restart on every supervisor crash.
- R2 bucket `dolt-data` must exist before deployment.
- R2 API credentials must be set as Worker secrets.

## Commit message
`feat(supervisor): R2-backed Dolt bead store persistence`

## References
- `.agent/patterns/ephemeral-container-store.md`
- `wrangler.jsonc` Phase 2 comment (already documented the constraint)
- Dolt S3 remote docs: `dolt remote add --help` (aws:// scheme, env creds)
- R2 S3 endpoint: `https://cb56a846c70a38987f31cf6e2b85cb57.r2.cloudflarestorage.com`
