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

## Auto-promoted

*(none yet — will be populated by the dream cycle)*
