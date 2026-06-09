# Architecture Pattern Index

Read this before designing anything that touches Cloudflare Containers, Durable Objects, Gas City, or bead stores.

## Patterns

| Pattern | Problem Class | Status |
|---------|--------------|--------|
| [event-driven-default](event-driven-default.md) | Every integration must be event-driven unless explicitly documented otherwise | **Standing principle** |
| [container-cold-boot-timeout](container-cold-boot-timeout.md) | CF Container takes 30–90s to cold start; HTTP callers time out | Active |
| [token-rotation-kills-container](token-rotation-kills-container.md) | `wrangler secret put` restarts Worker and evicts running Container | Active |
| [ephemeral-container-store](ephemeral-container-store.md) | Container filesystem wiped on restart; bead store / DB data lost | Active |
| [worker-secret-not-in-container-env](worker-secret-not-in-container-env.md) | CF Worker secrets not in Container process env; `os.Getenv` returns "" | SOLVED — pass via `envVars` in constructor |
| [container-tool-version-mismatch](container-tool-version-mismatch.md) | Go binary generates config for tool version X; Dockerfile pins older version Y → silent startup failure | Active — check `deps.env` in upstream repo |
| [container-missing-system-deps](container-missing-system-deps.md) | Embedded shell scripts call tools (`git`, `bd`, `bun`) not in Container image | Active — track required binaries against `deps.env` |
| [gc-bd-provider-dolt-conflict](gc-bd-provider-dolt-conflict.md) | External Dolt start in entrypoint conflicts with Gas City `bd` provider's managed Dolt | SOLVED — remove manual Dolt start |
| [city-health-check-insufficient](city-health-check-insufficient.md) | HTTP 200 on `/v0/cities` ≠ city running; pre-warm declares ready too early | SOLVED — probe formula endpoint after 200 |
| [phantom-session-provider](phantom-session-provider.md) | Gas City session lifecycle forces Sandbox cold boot per formula step | SOLVED — use `provider = "noop"` |
| [harness-terminator-no-provider](harness-terminator-no-provider.md) | Release/terminator step routed to remote provider → fidelity `fail_closed` | SOLVED — terminator shortcut in `maybeDispatchHarness` |

## How to use

**Event-driven is the default.** Read `event-driven-default.md` first for any new integration design.

When starting work that touches any of these domains, grep for relevant patterns first:

```
ls .agent/patterns/
```

If a pattern applies, reference it in the spec or ADR. If the work discovers a new recurring problem class, write the pattern before closing the session.
