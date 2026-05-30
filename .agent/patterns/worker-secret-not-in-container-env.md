# Pattern: CF Worker Secrets Not in Container Process Environment

## Problem
Code running inside a Cloudflare Container calls `os.Getenv("SECRET_NAME")` (Go)
or `process.env.SECRET_NAME` (Node) and gets an empty string, even though the
secret is correctly set via `wrangler secret put` on the Worker. The feature
silently behaves as if unconfigured — no error, just wrong/empty behavior.

## Root Cause
`wrangler secret put` makes a secret available to the **Worker JavaScript
process** via `env.SECRET_NAME`. It does NOT automatically propagate to
Container processes. The Container runs as a separate Linux process started by
the Durable Object's `Container` base class. That process only sees env vars
explicitly passed at start time.

## Solution
Pass secrets explicitly via `container.start({ env: {...} })` in the
Durable Object constructor. The `container.start()` call (via the `envVars`
property on the `Container` class) injects the specified vars into the
Container process environment.

```typescript
// src/index.ts — GasCitySupervisor constructor
constructor(ctx: DurableObjectState<{}>, env: Env) {
  super(ctx, env);
  this.envVars = {
    // Worker env → Container process env
    FF_OPERATOR_CONTROL_TOKEN: env.OPERATOR_CONTROL_TOKEN,
    GAS_CITY_HMAC_SECRET:      env.GAS_CITY_HMAC_SECRET,
    AWS_ACCESS_KEY_ID:         env.DOLT_R2_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY:     env.DOLT_R2_SECRET_ACCESS_KEY,
    AWS_REGION:                "auto",
    DOLT_AWS_ENDPOINT:         "https://<account>.r2.cloudflarestorage.com",
  };
}
```

Also update the `Env` interface to declare the new secrets:
```typescript
interface Env {
  SUPERVISOR: DurableObjectNamespace;
  OPERATOR_CONTROL_TOKEN: string;   // → Container as FF_OPERATOR_CONTROL_TOKEN
  GAS_CITY_HMAC_SECRET: string;    // → Container as GAS_CITY_HMAC_SECRET
  DOLT_R2_ACCESS_KEY_ID: string;   // → Container as AWS_ACCESS_KEY_ID
  DOLT_R2_SECRET_ACCESS_KEY: string;
}
```

## Diagnostic
```bash
# Symptom in Go: token auth fails silently
# os.Getenv("FF_OPERATOR_CONTROL_TOKEN") == ""
# Symptom in script: empty HMAC, unsigned webhook, curl to empty URL
```

## Known Instances
- **2026-05-29** — Gas City Container `gc supervisor run` authenticated outbound
  calls to `ff-pipeline /__pi-container/execute` using `FF_OPERATOR_CONTROL_TOKEN`
  which was always empty. Container received no auth token. Fixed by adding the
  secret to `envVars` in the `GasCitySupervisor` constructor.
- **2026-05-30** — R2 credentials (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`)
  for Dolt remote push/pull were set as Worker secrets but not passed to the
  Container. Fix: added to `envVars`.

## Corollary: envVars are set once at Container construction
`envVars` is read at `container.start()` time — when the DO is first created for
a given `idFromName` key. Rotating secrets via `wrangler secret put` after the
Container is warm does NOT update the Container's environment. The Container
must be restarted (by changing the `idFromName` key) to pick up new values.

## See Also
- `.agent/patterns/token-rotation-kills-container.md` — rotating secrets evicts running Containers
