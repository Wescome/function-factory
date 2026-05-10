# Failure Taxonomy Template

**Status:** Draft template; not active policy
**Date:** 2026-05-08
**Source references:** `specs/reference/FF-ONTOLOGY-v0.2.md`,
`.agent/memory/semantic/LESSONS.md`,
`.agent/protocols/permissions.md`

Use this template when extracting a harness skill or charter rule. The goal is
to make failure modes explicit before rewriting operational instructions.

## Failure Taxonomy Record

```yaml
id: FAILURE-<DOMAIN>-<SHORT-NAME>
name: ""
domain: "lineage | verification | permissions | artifact-persistence | lifecycle | harness | runtime"
severity: "low | medium | high | critical"
detected_by:
  - ""
blocked_by:
  - ""
source_refs:
  - ""
description: ""
trigger_conditions:
  - ""
counterexample: ""
expected_agent_behavior:
  - ""
recovery_path:
  - ""
audit_evidence:
  - ""
```

## Starter Categories

| Category | Example failure | Blocking rule |
| --- | --- | --- |
| Lineage | Artifact cites missing or fabricated `source_refs`. | Emit uncertainty or repair lineage before producing downstream artifacts. |
| Verification | Gate report absent or treated as optional. | Fail closed; absence is never a pass. |
| Permissions | Agent edits protected files without approval. | Stop and request explicit confirmation for the named files/actions. |
| Artifact persistence | Generated evidence is overwritten or moved without lineage checks. | Treat evidence as append-only unless an explicit migration decision exists. |
| Lifecycle | Function is promoted without required gate evidence. | Block transition until required gate evidence exists and is fresh. |
| Harness | Task-family procedure duplicates shared charter policy. | Extract shared rule into charter, keep skill-specific procedure local. |
| Runtime | Continuous assurance is assumed from a one-shot check. | Require active Persistence Verification monitoring before `monitored` state. |

## Review Checklist

- Does the failure have a concrete detector?
- Does the blocking rule fail closed?
- Does the recovery path preserve lineage?
- Is the source rule already active somewhere?
- Does the taxonomy entry avoid inventing new policy?
