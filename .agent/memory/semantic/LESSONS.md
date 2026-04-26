# Distilled Lessons

Lessons promoted from episodic memory or architect-seeded. Treat these as
binding unless superseded by a later entry with explicit rationale.

## Architect-seeded (from whitepaper v4 review)

### On fabrication
- Never invent TLA expansions. If an acronym is not defined in the canonical
  source, search conversation history or ask. Do not guess at plausible
  expansions — the cost of a fabricated definition propagating through
  documents is higher than the cost of asking.
- Before writing any prose that uses architecture-specific vocabulary, verify
  the terms against the whitepaper or the architect's memory. If a term
  cannot be verified, surface the uncertainty explicitly rather than filling
  the gap with a plausible synthesis.

### On scope discipline
- The Factory (this project) is **I-layer**. It produces and maintains
  individual executable Functions. It does not govern commissioned work.
- WeOps is **We-layer**. It governs work against organizational purpose.
- A Function may be executed under a Work Order, but a Function is not a
  Work Order. A WorkGraph is not a Work Order. Conflating the two is the
  single most common mistake in documents that touch both systems.
- Spec coverage (§6 of whitepaper) is an I-layer discipline. Purpose coverage
  is a We-layer discipline. They are not the same check.

### On the six non-negotiables
- All six are required. None can be deferred to a v2. A Factory missing any
  of the six is a categorically different product than the one specified.
- If a PR is trading off a non-negotiable for speed, it is not speed it is
  buying — it is loss of the Factory's distinctive claim.

### On examples in source material
- The source thread uses `password_reset` as an illustrative example. It is
  not the canonical first vertical. Do not propose it as the MVP slice. The
  first application is Factory-builds-Factory; other verticals are downstream
  decisions.

## Build discipline

### On the compiler's eight passes
- Each pass does exactly one thing. No pass is allowed to silently conflate
  responsibilities with its neighbors.
- Every pass preserves source references, separates explicit from inferred,
  emits one semantic claim per object, uses canonical verbs, fails closed on
  ambiguity, and writes an uncertainty ledger. These six properties are
  pass-invariants, not aspirational goals.

### On invariants
- An invariant without a detector is a wish. Gate 1 rejects any PRD that
  declares invariants without detector specs.
- A detector spec has, at minimum, a named evidence source, direct rules,
  warning rules, a regression policy, and incident tags. Partial detector
  specs are also wishes.

## Cloudflare platform constraints (2026-04-25/26)

### On Workflows and Durable Objects
- Workflows ARE DOs internally (1:1 Engine DO). Calling a DO from inside
  step.do() is a DO-to-DO call that deadlocks via I/O gates. This is not
  a bug — it is emergent behavior of the platform architecture.
- The canonical bridge: Workflow enqueues to CF Queue, enters waitForEvent.
  Queue consumer (fresh Worker context) calls DO. DO completes. Consumer
  sends workflow.sendEvent({ type, payload }). Workflow resumes.
- Never call a DO from inside a Workflow step. Not via RPC, not via
  stub.fetch(), not via self-fetch to the Worker's own URL.

### On setTimeout in Durable Objects
- setTimeout does NOT tick during I/O suspension in DOs. The V8 isolate
  freezes while waiting on fetch(). AbortController timers never fire.
- AbortSignal.timeout() IS wall-clock (managed by CF runtime) and works
  for the fetch itself, but does not solve the DO-to-DO deadlock.
- DO Alarms (this.ctx.storage.setAlarm) are the only reliable wall-clock
  timeout in DOs — they fire even during I/O suspension. Use for deadlines.

### On CF Workflows API
- sendEvent takes a single object: { type: string, payload: unknown }.
  NOT two positional args (name, payload). The type error is silent at
  runtime — returns "Provided event type is invalid" with no stack trace.
- waitForEvent returns { payload } where payload is the payload from
  the matching sendEvent call.
- Workers cannot fetch their own public URL from inside step.do() —
  creates a deadlock (step holds Worker, fetch needs Worker).

### On model routing via ofox.ai
- Models wrap JSON in markdown code fences despite "respond ONLY with
  valid JSON" in the prompt. Strip fences at the provider layer.
- Model IDs on ofox.ai use dots not dashes (claude-opus-4.6 not
  claude-opus-4-6), have -preview suffixes (gemini-3.1-pro-preview),
  and use different provider prefixes (z-ai not zhipu, moonshotai not
  moonshot). Verify against /v1/models endpoint.

## Process lessons (2026-04-25/26)

### On architecture discipline
- GUV proposes, Architect reviews, Principal decides. If a "fix" changes
  WHERE code runs, WHO orchestrates, WHAT owns state, or HOW components
  communicate — it is an architecture decision. Present it, don't implement it.
- Event-driven patterns are the default investigation for all inter-component
  communication. RPC is the fallback, not the default.

### On testing discipline
- Never deploy to production as a way to test. Write vitest tests locally.
  Architect reviews before deploy. This session burned $3 and 2+ hours on
  10+ blind deploys before adopting TDD.
- Never read secrets from settings.json or .env files and use them in
  tool calls. Ask the user to run the command themselves via `!` prefix.

## Auto-promoted

*(none yet — will be populated by the dream cycle)*
