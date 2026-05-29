# IS-GC-CONTAINER-KEEPALIVE
# Migrate GasCitySupervisor to Container base class with dispatch-scoped keepalive

## Problem
`GasCitySupervisor` extends `DurableObject` directly. No `sleepAfter`. The DO is
evicted after ~30s of inactivity, killing the Container and wiping all in-flight
formula beads mid-execution.

## Solution
Extend `Container` base class. Use `sleepAfter = "30m"` for baseline inactivity
tracking. Override `onActivityExpired()` to check a `keepalive_active` flag in DO
storage — if a formula is in-flight, renew instead of stop. ff-pipeline sets/clears
the flag via two new endpoints as fire-and-forget side effects of dispatch and
RELEASE webhook.

This is event-driven: the Container sleeps reactively on inactivity, not on a timer.

---

## Change 1: `/Users/wes/eai/examples/factory/weops-gascity/stage/supervisor/src/index.ts`

### Import
Replace `DurableObject` import with `Container`:
```typescript
import { Container } from "@cloudflare/containers";
// Remove: import { DurableObject } from "cloudflare:workers"  (if present standalone)
```

### Class declaration
```typescript
export class GasCitySupervisor extends Container<Env> {
```

### Class properties (add at top of class body)
```typescript
defaultPort = 9443
sleepAfter = "30m"
enableInternet = true
```

### Constructor (add)
```typescript
constructor(ctx: DurableObject["ctx"], env: Env) {
  super(ctx, env)
  this.envVars = { FF_OPERATOR_CONTROL_TOKEN: env.OPERATOR_CONTROL_TOKEN }
}
```

### onActivityExpired (add)
```typescript
override async onActivityExpired(): Promise<void> {
  const active = await this.ctx.storage.get<boolean>("keepalive_active")
  if (active) {
    this.renewActivityTimeout()
  } else {
    await super.onActivityExpired()
  }
}
```

### onStop (replace existing)
```typescript
override onStop(): void {
  this.ctx.storage.delete("keepalive_active").catch(() => {})
}
```

### fetch (replace entire method)
```typescript
override async fetch(request: Request): Promise<Response> {
  const url = new URL(request.url)

  // Keepalive control — DO-level, not proxied to Container
  if (url.pathname === "/v0/keepalive/start" && request.method === "POST") {
    await this.ctx.storage.put("keepalive_active", true)
    this.renewActivityTimeout()
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    })
  }
  if (url.pathname === "/v0/keepalive/stop" && request.method === "POST") {
    await this.ctx.storage.delete("keepalive_active")
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    })
  }

  // Inject CSRF header required by Gas City
  const headers = new Headers(request.headers)
  headers.set("X-GC-Request", "true")

  // Rewrite to http://localhost:9443 for containerFetch
  url.protocol = "http:"
  url.hostname = "localhost"
  url.port = "9443"

  const hasBody = request.method !== "GET" && request.method !== "HEAD"
  try {
    return await this.containerFetch(
      new Request(url.toString(), {
        method: request.method,
        headers,
        body: hasBody ? request.body : undefined,
      }),
      9443
    )
  } catch (e) {
    return new Response(
      JSON.stringify({ error: "container_not_ready", detail: String(e) }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    )
  }
}
```

### Unchanged
- Outer Worker `fetch()` (auth gate + singleton DO routing)
- `Env` interface
- `wrangler.jsonc` — no changes needed

---

## Change 2: `workers/ff-pipeline/src/compilers/formula-compiler.ts`

Inside `dispatchCall3AndFinalize`, BEFORE the `return { outcome: "dispatched", ... }`
statement (around line 905):

```typescript
// Best-effort keepalive start — never blocks or fails the dispatch
deps.httpFetch(gasCityUrl(env, "/v0/keepalive/start"), {
  method: "POST",
  headers: gasCityAuthHeaders(env),
  signal: AbortSignal.timeout(5_000),
}).catch(() => {})
```

---

## Change 3: `workers/ff-pipeline/src/gascity/webhook-receiver.ts`

On the successful RELEASE path, before returning the 200 response:

```typescript
// Best-effort keepalive stop — fire and forget
fetch(`${env.GAS_CITY_BASE_URL}/v0/keepalive/stop`, {
  method: "POST",
  headers: { Authorization: `Bearer ${env.GAS_CITY_BEARER_TOKEN}` },
  signal: AbortSignal.timeout(5_000),
}).catch(() => {})
```

`GAS_CITY_BASE_URL` and `GAS_CITY_BEARER_TOKEN` are already in `PipelineEnv`.

---

## Commit messages
- eai repo: `feat(supervisor): migrate to Container base class with dispatch-scoped keepalive`
- ff-pipeline repo: `feat(ff-pipeline): wire keepalive start/stop around formula dispatch`

## References
- `.agent/patterns/event-driven-default.md`
- `.agent/patterns/do-idle-kill.md` (to be written after this is shipped)
- `@cloudflare/containers` v0.3.5 — `Container` class API at `node_modules/@cloudflare/containers/dist/lib/container.d.ts`
