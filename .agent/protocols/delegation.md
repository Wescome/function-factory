# Delegation Protocol

Rules for when a coding agent delegates work to a sub-agent or another
Factory stage.

## When delegation is appropriate

- **Cross-pass compilation work.** Pass 2 (atom extraction) may delegate
  to a sub-agent specialized for NL-to-structured-claim extraction; Pass 3
  (contract derivation) may delegate to a type-inference sub-agent. Each
  pass remains responsible for its own output contract; the sub-agent is
  a means, not a scope expansion.
- **Validation authoring.** Generating test scenarios from a spec can be
  delegated to a test-generation sub-agent; the primary agent remains
  responsible for ensuring the generated tests backmap correctly.
- **Coverage Report rendering.** Formatting and emitting the Coverage
  Report YAML can be delegated; the primary agent remains responsible
  for the verdict.

## When delegation is inappropriate

- **Gate decisions.** The primary agent is responsible for the Gate 1 / 2
  / 3 verdict. Delegating the verdict itself is scope violation.
- **Lineage preservation.** Every artifact's `source_refs` must be
  populated by the agent that authored the artifact. Delegating lineage
  to a sub-agent that doesn't have the upstream context produces
  fabricated references.
- **Architect-review flagging.** Whether something needs architect review
  is a primary-agent decision.
- **Tasks crossing the I/We boundary.** Never delegate a Factory task to
  a WeOps-scoped actor and vice versa. They are different systems.

## Contract

When delegating, the primary agent emits a structured delegation request:

```yaml
id: DEL-<timestamp>
delegating_agent: <agent-id>
delegate_to: <sub-agent spec or harness reference>
task: "what the sub-agent must produce"
inputs:
  - <input artifacts or IDs>
expected_output_schema: <schema reference>
source_refs:
  - <upstream artifact IDs, must be propagated>
constraints:
  - <constraints the sub-agent must honor>
approval_required: true | false
```

On delegate return, the primary agent:
1. Validates the output against the expected_output_schema.
2. Verifies source_refs are correctly populated and propagated.
3. Runs the relevant coverage check if the output is a Factory artifact.
4. Logs the delegation event to episodic memory with both the request and
   the response.

## Failure handling

If a delegate fails or returns an invalid output:
1. Primary agent logs the failure with pain_score ≥ 7.
2. If the same delegate pattern fails 3+ times, flag for skill revision
   (the primary agent's skill, not the delegate's — the pattern is
   wrong).
3. Do not silently retry. Either remediate the inputs or surface an
   UncertaintyEntry.

## Anti-patterns

- **Fire-and-forget delegation.** Every delegation has a return contract.
  A delegate that doesn't respond is a failure event, not a completed task.
- **Delegation chains deeper than 2.** A sub-agent should not sub-delegate
  to a sub-sub-agent without explicit architect approval. The lineage
  becomes unreadable.
- **Delegating to unverifiable harnesses.** If the harness cannot produce
  an inspectable trace of what it did, do not delegate high-stakes work
  to it. Observability is a precondition for trust.
