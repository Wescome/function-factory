# Pattern — never hand a raw workerd JSRPC promise to `expect(...).rejects`

**Class:** test harness / Cloudflare Workers (workerd) JSRPC
**Found:** 2026-08-23, `keel/test/scr-land-port3.test.ts` (PORT-3, Track 3)
**Rule:** Never pass a raw Durable Object RPC call directly to `expect(...).rejects`. Wrap it in an async function first.

## Symptom

`npm run gate` exits 1 while every test reports pass. Vitest's own summary is
clean — 79 files passed, 646 tests passed — and the run then dies on N
unhandled promise rejections attributed to test files whose assertions
already caught and asserted on those exact errors.

In KEEL this was 2 unhandled rejections from `port3-atomicity-1` (INV-2) and
`port3-serialize-2` (INV-4), both from `await expect(stub.land(...)).rejects.toThrow()`.
Reproduces in isolation (`npx vitest run test/scr-land-port3.test.ts`), not flaky.

Misreads to avoid: this is **not** a false positive, not a vitest bug, and not
a double-delivery in the DO dispatch layer. V8 is correct to report it — there
really are two rejected promises and only one of them is observed.

## Root cause

`ns.get(ns.idFromName(...)).someMethod(...)` does not return a native Promise.
It returns a workerd **`JsRpcPromise`** — a Proxy that is simultaneously a
thenable *and* a pipelining target, so property access on it mints a new
derived RPC promise for the same in-flight call (that is how RPC pipelining,
`stub.a().b()`, works at all).

Vitest's `.rejects` modifier **introspects its subject before awaiting it** —
it reads properties off the value to decide how to handle it. On a raw
`JsRpcPromise` that introspection mints a second, derived pipelined promise
bound to the same call. When the call rejects:

- the promise vitest actually awaits rejects → observed, assertion passes
- the derived promise vitest never kept a handle to also rejects → **unobserved**

One genuine unhandled rejection per `.rejects` site, per rejecting RPC call.

## Fix

Collapse the subject to a single native Promise *before* `.rejects` touches it,
by wrapping the call in an async function:

```ts
// wrong — .rejects introspects the RPC proxy and mints a second branch
await expect(stub.land("wes", s, [a])).rejects.toThrow();

// right — .rejects only ever sees a plain function returning a native Promise
await expect(async () => { await stub.land("wes", s, [a]); }).rejects.toThrow();
```

`try { await stub.land(...) } catch (e) { ... }` is equally safe and is what
the neighbouring `INV-6` assertion in the same file already does — the `await`
resolves the proxy to one value, nothing else ever reads a property off it.

## Scope

Applies to any RPC-proxy-returning call: Durable Object stubs, service
bindings, `WorkerEntrypoint`/`RpcTarget` methods. Not an issue for plain async
functions, `fetch()`, or anything already awaited — those are native promises
and there is no second branch to mint.

Passing a **function** to `.rejects` is always safe regardless of what it
returns, which is why the rest of the KEEL suite (`geo-usecase`, `fx-usecase`,
`foreign-call`) was unaffected — those sites already pass functions.
