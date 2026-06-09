# DEVOPS Invariant Detector Status
# Updated: 2026-06-03

This document tracks implementation status of all 15 SPEC-FF-DEVOPS-001-v2 invariant detectors.

## v1 Invariants (retained)

| ID | Invariant | Detector | Status | Action |
|----|-----------|----------|--------|--------|
| INV-1 | No secrets in source | gitleaks in CI on every push | ✅ Implemented | Keep |
| INV-2 | Agent PRs pass identical CI gates | Branch-protection rule requiring CI pass | ⚠ Policy only | **Human action**: add branch-protection rule in GitHub repo settings requiring `factory-pr-check` to pass on labeled PRs |
| INV-3 | DO migrations deploy atomically | Migration failure integration test | ⚠ No detector | **Human action**: write integration test for partial DO migration failure; requires DO test harness |
| INV-4 | pi-coding-agent has read-only GitHub token | Token scoped; negative test (attempt merge → 403) | ⚠ Partial (no negative test) | **Human action**: add negative test using the actual token; requires token available in test context |
| INV-5 | Lineage edges write per-stage | ArangoDB query for null source_refs | ✅ Implemented | Q9 in governor-agent prefetchGovernorContext; surfaces in every 15-min governance cycle |
| INV-6 | Rollbacks require --confirm-secret-change | Rollback script diffs secret hashes | ⚠ No script | **Human action**: create a rollback script that calls `wrangler rollback` and diffs secret hashes before proceeding; secrets-manifest.yaml now provides the inventory |
| INV-7 | OTLP trace export enabled | Exporter freshness alarm < 5 min | ⚠ Partial (no alarm) | **Human action**: create Cloudflare monitoring alert on OTLP exporter freshness; requires CF dashboard access |

## New Invariants (added in v2)

| ID | Invariant | Detector | Status | Commit |
|----|-----------|----------|--------|--------|
| INV-8 | No deploy while ACTIVE_EXECUTION_KEY set | `/__pi-container/fence` + `/__supervisor/fence` endpoints | ✅ Implemented | d2b94af |
| INV-9 | Exit-143 classified rollout_interrupted | `classifyContainerCrash()` in recordMonitorEvent | ✅ Implemented | 26158e5 |
| INV-10 | Idempotent resume via R2 checkpoint | Checkpoint written in restartContainer() before key delete | ✅ Partial | 26158e5 — checkpoint written; resume consumer not yet implemented |
| INV-11 | Singleton rotation on image change | `singleton-rotation-check` CI gate | ⚠ Not implemented | **Human action**: add CI job that diffs image digest vs last deployed CF version; fails if image changed but SUPERVISOR_SINGLETON suffix did not increment |
| INV-12 | Atomic co-deploy | Ordered deploy procedure | ⚠ Procedure only | Documented in SPEC-FF-DEVOPS-001-v2 §11. No automated detector possible without CF deploy orchestration API. |
| INV-13 | Fidelity VR before FN-* PR merge | `fidelity:check` npm script | ✅ Partial | 7bbb704 — script implemented; **human action** needed to wire into `factory-pr-check` CI job in .github/workflows/ci.yml |
| INV-14 | R2 checkpoint durability | C12 pre-flight check + integration test | ⚠ Partial | Checkpoint write implemented (26158e5); C12 pre-flight check not yet implemented |
| INV-15 | Gradual rollout monotonicity | `isContainerRolloutTransient()` retry budget | ✅ Implemented | 26158e5 |

## Summary

- **Fully implemented**: INV-1, INV-5, INV-8, INV-9, INV-15 (5/15)
- **Partially implemented**: INV-10, INV-13, INV-14 (3/15)
- **Human action required** (cannot be done by Factory PRs due to CI/credentials/dashboard constraints): INV-2, INV-3, INV-4, INV-6, INV-7, INV-11 (6/15)
- **Procedure only** (no automated detector possible): INV-12 (1/15)

## Human Actions Backlog

Priority order:

1. **INV-13 CI wiring** (highest impact — fidelity gate): add `fidelity:check` call to `factory-pr-check` job in `.github/workflows/ci.yml` per SPEC-G3 §2.6
2. **INV-11 singleton-rotation-check**: add CI job that checks CF Deployments API for image digest vs SUPERVISOR_SINGLETON suffix
3. **INV-2 branch-protection**: require `factory-pr-check` status check on agent-labeled PRs in GitHub repo settings
4. **INV-6 rollback script**: create `scripts/ops/rollback.sh` that wraps `wrangler rollback` + secret-diff gate using `secrets-manifest.yaml`
5. **INV-7 OTLP freshness alarm**: create Cloudflare monitoring alert on OTLP exporter freshness (< 5 min)
6. **INV-3 DO migration test**: integration test for partial DO migration failure
7. **INV-4 negative token test**: negative test for read-only GitHub token scope
