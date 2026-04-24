## 2026-04-24: Stage 6 artifact-ID stem is FUNCTION-SYNTHESIS

**Decision:** The PRS/BC/FP/PRD/WG chain for Stage 6 uses the artifact-ID
stem `FUNCTION-SYNTHESIS`. Full chain: `PRS-META-FUNCTION-SYNTHESIS`,
`BC-META-FUNCTION-SYNTHESIS`, `FP-META-FUNCTION-SYNTHESIS`,
`PRD-META-FUNCTION-SYNTHESIS`, `WG-META-FUNCTION-SYNTHESIS`. The stem
applies to the Stage 6 coordinator and the five-role topology it governs.

**Rationale:** Four candidates were evaluated: `STAGE-6-CODING-SWARM`,
`DARK-FACTORY`, `FUNCTION-SYNTHESIS`, `CODING-AGENT-TOPOLOGY`. Selection
criteria: (1) the stem should name what Stage 6 *produces*, not what it *is*
— the Factory's artifact-ID convention names the capability or output, not
the implementation topology; (2) the stem must be greppable across `specs/`
without false positives against existing chains; (3) the stem should be
stable under future implementation changes — if the five-role topology
evolves to six roles or three, the stem should still hold.
`FUNCTION-SYNTHESIS` satisfies all three: it names the output (a synthesized
Function — code plus tests, config, docs per ConOps §9.4), it has zero
existing matches in `specs/`, and it is topology-agnostic. `DARK-FACTORY`
was the most evocative but names the execution environment rather than the
output. `CODING-AGENT-TOPOLOGY` names the implementation shape, which is
exactly the thing most likely to change. `STAGE-6-CODING-SWARM` embeds a
stage number, creating a rename burden if stage numbering ever shifts.

**Alternatives considered:** See rationale above.
**Status:** Active.

## 2026-04-24: Stage 6 topology is hybrid with pluggable binding modes

**Decision:** Stage 6 (FUNCTION-SYNTHESIS) implements a hybrid topology: the
Factory specifies the five-role contract (Planner/Coder/Critic/Tester/
Verifier per whitepaper §3) as typed state-transform interfaces with strict
read/write/do-not/output contracts and JSON-only footers, and provides
pluggable binding modes that map those roles onto concrete execution
backends. Binding modes include at minimum: (a) delegation to an external
harness (Claude Code, Cursor, or equivalent) where the harness implements
the full topology internally, and (b) in-Factory role execution where each
role is a Factory-managed agent with its own context window. Additional
binding modes (e.g., mixed delegation where some roles run in-Factory and
others delegate) are permitted but not required at v1.

**Rationale:** Whitepaper §9 states "the Factory is harness-agnostic. When a
harness is good (Claude Code and Cursor both qualify), the Factory delegates
Stage 6 to it." This establishes delegation as a first-class mode, not a
fallback. Simultaneously, whitepaper §3 specifies the five-role topology
with enough detail (per-role read access, write access, do-not rules, output
contract) that an in-Factory implementation is architecturally derivable.
The hybrid approach lets the Factory own the contract layer (what each role
must do) while remaining agnostic about the execution layer (who does it).
This is the same separation the Factory applies everywhere else — WorkGraphs
specify, execution realizes. The PRD for FUNCTION-SYNTHESIS must specify the
role contracts as the primary deliverable and the binding-mode interface as
the secondary deliverable; implementation of any specific binding mode is a
downstream Function, not part of the FUNCTION-SYNTHESIS chain itself.

**Alternatives considered:** (a) Thin coordinator, delegates exclusively to
external harness. Rejected — makes the Factory dependent on external harness
capabilities matching the five-role contract exactly; if a harness doesn't
natively support the Verifier role's `pass / patch / resample / interrupt /
fail` decision set, the Factory has no recourse. (b) In-Factory
implementation only. Rejected — ignores whitepaper §9's explicit
endorsement of delegation and would require the Factory to manage agent
context windows, token budgets, and tool access for five concurrent roles
before any of the simpler delegation paths have been proven.

**Status:** Active.

## 2026-04-24: Semantic-alignment review via Critic-role involvement at PRD authoring

**Decision:** The semantic-alignment review mechanism — required to catch
PRDs that pass Gate 1 structurally but are conceptually miscast against
whitepaper and ConOps ground truth — is implemented as Critic-role
involvement during PRD authoring, not as a separate gate. Specifically:
before a PRD enters the Stage 5 compiler, the Critic role (as defined in
whitepaper §3's five-role topology) reviews the PRD's conceptual model
against the authoritative source material cited in its `source_refs` chain.
The Critic's output is a typed review artifact with a verdict
(`aligned / miscast / uncertain`) and specific citations to whitepaper or
ConOps sections that support or contradict the PRD's framing.

The Critic-at-authoring mechanism supplements Gate 1; it does not replace
it. Gate 1 remains the structural coverage gate. The Critic review is the
semantic coverage check. A PRD must pass both to proceed to Stage 6
execution.

**Rationale:** The 2026-04-19 Observed entry "Gate 1 PASS does not imply
conceptual correctness" documented the failure mode: PRD-META-HARNESS-
EXECUTE compiled Gate 1 PASS with 30 atoms, 3 contracts, 4 invariants,
all checks green, while its entire conceptual frame was wrong. The root
cause was not a Gate 1 deficiency — Gate 1's four structural checks are
correct and complete for their scope — but the absence of any mechanism
to verify that a PRD's prose aligns with the whitepaper's semantics.

Three options were evaluated: (a) Gate 1.5, an automated compile-time
check; (b) Architect review gate, a human checkpoint; (c) Critic-role
involvement at PRD authoring. Option (c) was selected because it places
the review at the point of maximum leverage (before compile, when the
PRD's conceptual frame is still malleable), it produces a typed artifact
(the review) that enters the lineage graph, and it reuses the Critic role
already specified in whitepaper §3 rather than introducing a new gate or
a new human bottleneck. Option (b) does not scale — the Architect
becomes a serial dependency on every PRD. Option (a) requires a
derivation rule for semantic alignment that does not currently exist and
risks becoming ad-hoc compliance checking (per the 2026-04-19 Observed
entry's own warning: "widening Gate 1 to semantic verification without a
clear derivation rule would turn it into ad-hoc compliance checking").

**Status:** Active.

## 2026-04-24: Bootstrap carve-out — Architect is Critic for PRD-META-FUNCTION-SYNTHESIS

**Decision:** The Critic role cannot review the PRD that instantiates the
Critic role. For the FUNCTION-SYNTHESIS chain specifically
(`PRS-META-FUNCTION-SYNTHESIS` through `PRD-META-FUNCTION-SYNTHESIS`), the
Architect fills the Critic role manually, performing semantic-alignment
review against whitepaper §3 before the PRD enters the Stage 5 compiler.
This carve-out applies exclusively to the FUNCTION-SYNTHESIS chain and
expires when the FUNCTION-SYNTHESIS WorkGraph has been executed and the
Critic role is operational.

**Rationale:** The 2026-04-24 "Semantic-alignment review via Critic-role
involvement" decision establishes the Critic as the semantic-alignment
reviewer for all PRDs. But the Critic role is defined inside Stage 6, and
Stage 6 is the subject of PRD-META-FUNCTION-SYNTHESIS. The Critic cannot
review its own specification — this is a genuine bootstrap circularity,
not a theoretical concern. It is structurally identical to the pattern
that allowed PRD-META-HARNESS-EXECUTE to pass Gate 1 unchallenged: no
reviewer existed for the thing being reviewed. The carve-out resolves the
circularity by substituting the Architect (the only agent with ground-
truth access to whitepaper §3) for the not-yet-existing Critic, for
exactly one chain. All subsequent PRDs — including any amendments to the
FUNCTION-SYNTHESIS chain — are subject to Critic review once operational.

The carve-out is recorded as a separate DECISIONS entry rather than a
footnote in the Critic-role entry because it imposes a concrete
obligation on a specific human (the Architect must review PRD-META-
FUNCTION-SYNTHESIS before compile) and has a concrete expiration
condition (Critic role operational). Burying it in the parent entry
risks the obligation being missed.

**Alternatives considered:** (a) No carve-out — let PRD-META-FUNCTION-
SYNTHESIS proceed without semantic review, relying on Gate 1 alone.
Rejected — this is precisely the failure mode the 2026-04-19 retraction
documented. (b) Defer the Critic-role decision until after Stage 6 is
implemented, then retroactively review. Rejected — retroactive review of
an already-compiled, possibly already-executed PRD has no remediation
path short of retraction and reauthoring, which is more expensive than
upfront review. (c) Use an automated semantic check for this one PRD.
Rejected — no derivation rule for automated semantic alignment exists
yet; the Architect's judgment against §3 is the only available ground
truth.

**Status:** Active. Expires when the FUNCTION-SYNTHESIS Critic role is
operational and has reviewed its first non-FUNCTION-SYNTHESIS PRD.

## 2026-04-24: Adopt crystallization-from-execution and memory-as-tool patterns (GenericAgent-informed)

**Decision:** Adopt two architectural patterns from the GenericAgent
framework (lsdefine/GenericAgent, reviewed 2026-04-24) into the Factory's
operational model:

1. **Crystallization from successful execution.** When a WorkGraph executes
   through all applicable gates and produces a passing Coverage Report, the
   Factory emits a reusable artifact — a template, a macro, or a new
   invariant — derived from the execution path. Crystallized artifacts
   enter `specs/` with full lineage back to the execution that produced
   them. The mechanism is: successful Gate 3 (assurance) passage triggers
   a crystallization check; if the execution path contains a novel pattern
   not already captured by an existing invariant or template, a new
   artifact is proposed (not auto-committed — it enters the Critic review
   flow). This replaces the current implicit assumption that all reusable
   patterns are hand-authored into SKILL.md files before execution.

2. **Memory writes as explicit, auditable tool calls.** Every write to
   `.agent/memory/` (episodic, semantic, personal, working) is performed
   through a typed tool call that the coverage gates can observe, audit,
   and include in lineage graphs. No implicit or side-effect memory writes.
   The tool interface is: `memory_write(layer, key, content, source_refs)`,
   where `source_refs` traces the write back to the Function, gate, or
   execution event that produced it. This makes memory mutations
   first-class artifacts subject to the same lineage-preservation
   discipline as every other Factory object.

**What is NOT adopted from GenericAgent:**

- **Deferred skill authoring.** GenericAgent writes zero skills upfront and
  accretes them only after successful task execution. The Factory's domain
  (formal PRD compilation with typed invariants and fail-closed gates)
  requires preloaded skills because the compiler passes, gate checks, and
  lineage rules are not discoverable from execution alone — they are
  derived from the whitepaper's formal specification. The eight existing
  SKILL.md files are architecturally correct for this domain. What changes
  is that they are no longer the *only* source of reusable patterns;
  crystallization supplements them with execution-derived patterns.

- **Flat tool surface.** GenericAgent exposes 7 atomic tools and derives
  all capability from composition. The Factory's typed artifact pipeline
  (Signals → Pressures → Capabilities → Functions → PRDs → WorkGraphs →
  Invariants → Coverage Reports) is not reducible to a flat tool surface
  without losing the lineage guarantees that are the Factory's distinctive
  claim. The Factory's tool surface remains typed and stage-aware.

- **Single-loop architecture.** GenericAgent's 92-line agent loop is its
  entire control flow. The Factory's multi-stage pipeline with
  interposition points (gates, Critic review, governance) is
  architecturally load-bearing and is not collapsed into a single loop.
  However, the Factory benefits from having a *canonical reference loop*
  — a single document or diagram that traces the irreducible path from
  Signal to deployed Function and back — as a legibility aid. This is
  served by the pipeline sequence in ARCHITECTURE.md §1, which should be
  kept current as the canonical loop reference.

**Rationale:** GenericAgent demonstrates that agent systems compound value
most effectively when successful execution paths are automatically
captured as reusable artifacts ("skills" in GA's terminology, "invariants"
or "templates" in Factory terminology). The Factory's current model relies
entirely on hand-authored SKILL.md files and hand-authored invariant
specs. This works during Bootstrap — the Architect is the primary author
and the artifact count is small — but does not scale to steady-state
operation where the Factory is producing Functions across multiple
verticals. Crystallization closes the gap: hand-authored skills remain
the seed; execution-derived artifacts are the growth mechanism.

The memory-as-tool pattern addresses a different GenericAgent insight:
GA's `update_working_checkpoint` and `start_long_term_update` are
explicit tool calls, not implicit side effects. This means every memory
mutation is observable, auditable, and attributable. The Factory's
`.agent/tools/memory_writer.ts` already exists as a file; this decision
formalizes that every memory write must route through it with typed
`source_refs`, and that coverage gates may inspect memory-write records
as part of their audit surface.

**Source material:** GenericAgent repository (github.com/lsdefine/
GenericAgent), specifically: `agent_loop.py` (crystallization trigger at
task completion), `tools/` (7 atomic tools including `update_working_
checkpoint` and `start_long_term_update`), `skills/` (5 seed skills,
execution-derived growth). Reviewed 2026-04-24 for architectural
applicability to the Factory; patterns adopted selectively per the
"What is NOT adopted" section above.

**Alternatives considered:** (a) Adopt GenericAgent's deferred-skill model
wholesale — write no SKILL.md files, let them accrete from execution.
Rejected — the Factory's formal pipeline (8 compiler passes, 3 fail-
closed gates, typed invariants with detector specs) is not discoverable
from execution; it is derived from a 42KB whitepaper specification.
Preloaded skills are the correct seed for this domain. (b) Adopt nothing
— treat GenericAgent as architecturally irrelevant. Rejected — the
crystallization pattern solves a real scaling problem (hand-authored
skills don't compound) and the memory-as-tool pattern solves a real
auditability problem (implicit memory writes break lineage). (c) Adopt
crystallization only, not memory-as-tool. Rejected — crystallized
artifacts will themselves produce memory writes (new invariants, new
templates, updated LESSONS.md entries); if those writes are implicit,
the crystallization artifacts have lineage but their memory-layer effects
do not, creating a two-tier auditability gap.

**Implementation notes:**

- Crystallization check logic belongs in `packages/runtime/` (Stage 7),
  not in `packages/coverage-gates/` — it triggers *after* Gate 3, not
  *as part of* Gate 3. Gate 3 is fail-closed on assurance; crystallization
  is an additive emit on success.
- The `memory_write` tool interface should be specified as a new entry in
  `.agent/protocols/tool_schemas/` alongside the existing `shell.schema
  .json`, `git.schema.json`, and `compiler.schema.json`.
- Crystallized artifacts use a new prefix (candidate: `CRY-` or `TPL-`)
  requiring a paired update to `packages/schemas/src/lineage.ts` and
  `packages/coverage-gates/src/checks.ts`. Prefix selection is deferred
  to the PRD that specifies the crystallization Function.

**Status:** Active.
