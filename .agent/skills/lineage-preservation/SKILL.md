---
name: lineage-preservation
version: 2026-04-18
triggers:
  - "check lineage"
  - "verify source refs"
  - "explicitness audit"
  - "lineage"
tools: [view, bash]
preconditions: []
constraints:
  - "no artifact is emitted without populated source_refs"
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

## Audit algorithm

Given an artifact at path `specs/<type>/<id>.yaml`:

1. Parse. Confirm `id`, `source_refs`, `explicitness`, `rationale` are
   present at the root.
2. For each field in the artifact body, classify as explicit (directly
   stated in source) or inferred (derived).
3. For every `inferred` field, confirm a `rationale` is present and
   substantive (not empty, not placeholder).
4. For every ID in `source_refs`, confirm the referenced artifact exists
   in `specs/`. Missing upstream artifacts are a lineage break.
5. For every upstream artifact referenced, confirm this artifact is
   reachable from it via the expected pipeline direction (Pressure →
   Capability → FunctionProposal → PRD → WorkGraph). Skipping stages is
   a lineage break.

## Outputs

- **PASS:** lineage is intact. Artifact is ready for emission.
- **BREAK:** lineage has a defect. Report:
  ```
  LINEAGE-BREAK
    artifact: <id>
    defect_type: missing_source_ref | dangling_upstream | stage_skip | missing_explicitness | empty_rationale
    details: <specific field or ID>
    remediation: <what upstream fix is required>
  ```
- **UNCERTAIN:** a source reference is plausible but unverifiable. Log an
  UncertaintyEntry; do not silently accept.

## Anti-patterns

- **Empty source_refs.** Never. If an artifact has no upstream, it should
  not exist in the Factory — something upstream authored it and that
  something must be cited.
- **"TODO" in rationale.** Never. Either the rationale is there or the
  artifact is not ready.
- **Stage-skipping source_refs.** A Function citing a Signal directly
  (skipping Pressure and Capability) is a lineage break. The intermediate
  stages exist for a reason.

## Self-rewrite hook

After every 10 lineage audits OR on any Gate 1 failure attributable to a
missed lineage defect:
1. Read recent audit entries in episodic memory
2. If a defect type keeps slipping through, add it to the audit algorithm
3. Commit: `META: skill-update: lineage-preservation, {one-line reason}`
