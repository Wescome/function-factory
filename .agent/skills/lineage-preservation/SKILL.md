---
name: lineage-preservation
version: 2026-04-19
triggers:
  - "check lineage"
  - "verify source refs"
  - "explicitness audit"
  - "lineage"
tools: [view, bash]
preconditions: []
constraints:
  - "no non-Signal artifact is emitted without populated source_refs"
  - "every Stage 1 Signal (SIG-*) has a non-empty `source` field; source_refs may be empty by category"
  - "every derived field has an explicitness tag and rationale"
  - "unknown lineage is UNCERTAIN, not empty"
category: factory-core
---

# Lineage Preservation

Every Factory artifact carries lineage. This skill is the final check
before any artifact is written to `specs/`, committed, or emitted as
output. It is also invoked during review of existing artifacts.

## Required fields

Every Factory artifact — without exception — has:

```yaml
id: <ARTIFACT-ID>
source_refs:
  - <list of upstream artifact IDs>
explicitness: explicit | inferred
rationale: "if inferred, why"
```

For artifacts with derived sub-fields (e.g., Pressures derived from
Signals, Capabilities derived from Pressures, Functions derived from
Capability Deltas), every derived sub-field carries its own explicitness
tag and rationale.

### Stage 1 Signal exception

Stage 1 Signals (IDs starting `SIG-`) are the pipeline's origin point
by definition. Their upstream is an **external** artifact — a whitepaper,
a telemetry stream, an incident report, an architect correction — not a
Factory artifact. Signals carry that external origin in the `source`
field, which downstream schemas do not have. For Signals, `source_refs`
is permitted to be empty, and when empty, the `source` field is required
to be non-empty and to name the external origin unambiguously.

This exception applies only to the `SIG-*` prefix. Every other artifact
prefix (PRS-, BC-, FN-, FP-, PRD-, WG-, INV-, VAL-, DEP-, ATOM-, CR-,
TRJ-, PF-, INC-, DET-, DEL-) must carry a non-empty `source_refs`.

## Audit algorithm

Given an artifact at path `specs/<type>/<id>.yaml`:

1. Parse. Confirm `id`, `source_refs`, `explicitness`, `rationale` are
   present at the root.
2. For each field in the artifact body, classify as explicit (directly
   stated in source) or inferred (derived).
3. For every `inferred` field, confirm a `rationale` is present and
   substantive (not empty, not placeholder).
4. **If the artifact ID starts with `SIG-`**- confirm the `source` field
   is non-empty and names the external origin (e.g., a file path, a
   telemetry stream name, an incident ID, an architect correction
   reference). `source_refs` may be empty; if it is populated, each ID
   must resolve per step 5. Skip step 6 for Signals — pipeline-direction
   reachability applies only to downstream artifacts.
5. **Otherwise**- confirm `source_refs` is non-empty. For every ID in
   `source_refs`, confirm the referenced artifact exists in `specs/`.
   Missing upstream artifacts are a lineage break.
6. For every upstream artifact referenced, confirm this artifact is
   reachable from it via the expected pipeline direction (Signal →
   Pressure → Capability → FunctionProposal → PRD → WorkGraph).
   Skipping stages is a lineage break.

## Outputs

- **PASS:** lineage is intact. Artifact is ready for emission.
- **BREAK:** lineage has a defect. Report:
  ```
  LINEAGE-BREAK
    artifact: <id>
    defect_type: missing_source_ref | dangling_upstream | stage_skip |
                 missing_explicitness | empty_rationale |
                 signal_missing_source
    details: <specific field or ID>
    remediation: <what upstream fix is required>
  ```
- **UNCERTAIN:** a source reference is plausible but unverifiable. Log an
  UncertaintyEntry; do not silently accept.

## Anti-patterns

- **Empty source_refs.** Never, except for Stage 1 Signals (`SIG-*` IDs),
  whose origin is cited in the `source` field rather than in
  `source_refs` because the origin is an external artifact, not a
  Factory artifact. For every non-Signal artifact, empty `source_refs`
  is a lineage break. Authors who find themselves wanting to emit a
  non-Signal artifact with empty source_refs should stop — the artifact
  either has upstream that must be cited, or should not exist.
- **Signal with empty `source` and empty `source_refs`.** Never. A
  Signal must carry its external origin somewhere. A Signal with
  neither is an ungrounded artifact that cannot be audited.
- **"TODO" in rationale.** Never. Either the rationale is there or the
  artifact is not ready.
- **Stage-skipping source_refs.** A Function citing a Signal directly
  (skipping Pressure and Capability) is a lineage break. The
  intermediate stages exist for a reason.

## Self-rewrite hook

After every 10 lineage audits OR on any Gate 1 failure attributable to a
missed lineage defect:
1. Read recent audit entries in episodic memory
2. If a defect type keeps slipping through, add it to the audit algorithm
3. Commit: `META: skill-update: lineage-preservation, {one-line reason}`
