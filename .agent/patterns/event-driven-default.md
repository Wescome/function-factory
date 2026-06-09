# Pattern: Event-Driven by Default

## Principle
Every integration between components is event-driven unless there is an explicit, documented reason it cannot be. Synchronous RPC is the fallback, not the default.

## Why
Synchronous calls couple caller availability to callee availability. In a system with ephemeral Containers, cold boots, and distributed Workers, synchronous coupling produces cascading timeout failures. Event-driven designs decouple availability: the caller emits and returns; the receiver processes when ready.

## Applied to this project

| Integration | Current | Should Be | Why RPC was used |
|-------------|---------|-----------|-----------------|
| `POST /dispatch-formula` → Gas City CALL 1/2/3 | Synchronous (25s timeout per call) | Queue: enqueue dispatch intent, Container processes when ready | Expedient during bootstrap |
| ff-pipeline → Gas City formula execution | Synchronous HTTP | Webhook callback after execution | Gas City already has webhook RELEASE path |
| Gas City → `/__pi-container/execute` | Synchronous HTTP | Acceptable — pi-rpc is a bounded execution, not a service dependency | Single-step, bounded duration |
| Worker → ArangoDB | Synchronous HTTP via ff-arango | Acceptable — read/write, not long-running | DB calls are inherently synchronous |

## The cold-boot timeout is an event-driven failure
`timeout_call_1` in formula dispatch is a symptom of synchronous coupling to an ephemeral Container. If dispatch were event-driven:
1. `POST /dispatch-formula` → writes intent to queue, returns `202 accepted` immediately
2. Gas City Container processes queue when it comes up (whether 5s or 90s)
3. RELEASE webhook signals completion back to ff-pipeline

No timeout. No cold-boot sensitivity. No retry logic needed.

## Rule for new work
Before designing any inter-component call, ask: "Can the caller return immediately and let the receiver process asynchronously?" If yes, it must be event-driven. Document explicitly if synchronous is chosen and why.

## See also
- `.agent/patterns/container-cold-boot-timeout.md` — the direct consequence of sync coupling to cold Containers
- `docs/adr/` — ADR-010 abandoned NLAH in favor of event-driven patterns
