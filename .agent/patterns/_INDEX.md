# Architecture Pattern Index

Read this before designing anything that touches Cloudflare Containers, Durable Objects, Gas City, or bead stores.

## Patterns

| Pattern | Problem Class | Status |
|---------|--------------|--------|
| [event-driven-default](event-driven-default.md) | Every integration must be event-driven unless explicitly documented otherwise | **Standing principle** |
| [container-cold-boot-timeout](container-cold-boot-timeout.md) | CF Container takes 30–90s to cold start; HTTP callers time out | Active — caused by sync coupling |
| [token-rotation-kills-container](token-rotation-kills-container.md) | `wrangler secret put` restarts Worker and evicts running Container | Active |
| [ephemeral-container-store](ephemeral-container-store.md) | Container filesystem wiped on restart; bead store / DB data lost | Active |
| [phantom-session-provider](phantom-session-provider.md) | Gas City session lifecycle forces Sandbox cold boot per formula step | SOLVED — use `provider = "noop"` |
| [harness-terminator-no-provider](harness-terminator-no-provider.md) | Release/terminator step routed to remote provider → fidelity `fail_closed` | Active — use `supervisor-local` no-op provider (E2) |

## How to use

**Event-driven is the default.** Read `event-driven-default.md` first for any new integration design.

When starting work that touches any of these domains, grep for relevant patterns first:

```
ls .agent/patterns/
```

If a pattern applies, reference it in the spec or ADR. If the work discovers a new recurring problem class, write the pattern before closing the session.
