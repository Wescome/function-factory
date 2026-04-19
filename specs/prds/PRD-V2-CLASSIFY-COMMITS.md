---
id: PRD-V2-CLASSIFY-COMMITS
sourceCapabilityId: BC-V2-CLASSIFY-COMMITS
sourceFunctionId: FP-V2-CLASSIFY-COMMITS
title: Classify Commits (git triage execution Function)
source_refs:
  - FP-V2-CLASSIFY-COMMITS
  - BC-V2-CLASSIFY-COMMITS
  - PRS-V2-GIT-COMMIT-TRIAGE
explicitness: explicit
rationale: >
  First non-meta PRD authored by the Factory. Specifies the v2 vertical
  Function (git-commit-triage) selected per the 2026-04-19 v2 vertical
  selection DECISIONS entry. Authored to exercise the Factory
  compiler's generality along three dimensions not exercised by the
  four meta-PRDs- non-self-referential content (classifier reads
  arbitrary repo history, not Factory's specs/), adapter-boundary
  crossing (first real shell-exec target), and domain-specific
  invariants (commit-message convention rules that do not derive from
  whitepaper discipline).

  This PRD depends on the CTR- prefix + CommitTriageReport schema
  paired PR landing first. Derived authoritatively from Conventional
  Commits (https://www.conventionalcommits.org/en/v1.0.0/) for the
  taxonomy; whitepaper §3.2 for the execution Function type; ConOps
  §3.4 for deterministic evaluation; the shared ExecutionFunction
  shape recorded in PRD-META-COMPILER-PASS-8.

  Gate 1 on this PRD is the fifth non-failing compile (if it passes),
  the first non-self-referential compile, and the first compile of a
  PRD specifying a Stage 6-executable Function against an external
  runtime target. Because the PRD id does not start with PRD-META-,
  determineMode() auto-selects steady_state and Gate 1 runs 4 checks
  instead of 5 (bootstrap_prefix_check is skipped) — this is the
  first steady_state compile in the Factory's history.
---

# Classify Commits (git triage execution Function)

## Problem

Git repositories accumulate commits whose messages vary in discipline. Conventional Commits (feat/fix/docs/chore/refactor/test/style/perf/ci/build/revert) is a widely-adopted classification convention that enables automated changelog generation, semantic versioning, release tooling, and changelog-driven operations. Without classification, a repository's commit history is inert from an automation perspective — questions like "which commits in this release introduce features" or "which commits are behind a breaking-change marker" require manual reading.

Manual classification is tedious and inconsistent. Even in repositories adopting Conventional Commits, legacy history predates the convention and cannot be retroactively classified without tooling. Third-party classifiers exist but are opinionated, often coupled to a specific taxonomy, and rarely produce first-class audit-grade output.

The Factory can produce this classifier as its first non-meta Function and in doing so prove that the Bootstrap-phase compiler architecture extends beyond self-reference. A working classifier is useful in its own right — the Factory can apply it to its own commit history, to Anthropic repositories it has permission to read, to any v-number future vertical's repository. But the primary architectural value at v2 is the proof that Gate 1's coverage discipline, Pass 8's WorkGraph assembly, and the Stage 6 coding-agent topology all operate correctly on a specification whose subject matter is not the Factory itself.

## Goal

Implement `classify_commits` as a deterministic pure function (from the Factory compiler's perspective — the Function itself executes shell commands, which is IO, but from the specification layer its shape is "pure transformation of validated inputs into a validated output artifact"). The Function takes a git range argument, a repository path, and a classification policy; executes git CLI commands to enumerate commits in the resolved SHA range; classifies each commit against Conventional Commits taxonomy; detects commit-message-convention violations; and emits a CommitTriageReport conforming to the CommitTriageReport Zod schema in `packages/schemas/src/commit-triage.ts`. The report is written to `specs/commit-triage-reports/`.

## Constraints

### Architectural constraints (inherited from the six non-negotiables)

Fail-closed discipline is absolute. An invocation that cannot execute git (binary absent from PATH, permission denied, invalid repository path), cannot resolve the range to concrete SHAs (unreachable ref, ambiguous name), or cannot parse git's output (malformed commit message, encoding issue) produces a CommitTriageReport with `status: uncomputable` and the failure reason recorded in the report's rationale. No silent skip. No partial report.

Lineage preservation is absolute. The emitted CommitTriageReport's source_refs cites the Function ID that produced it and the policy artifact (or the policy identifier, since at v2 the policy is hardcoded to vanilla Conventional Commits). The report's rationale substantively describes the resolved range and the classification outcome. The report's range_from_sha and range_to_sha fields record the pinned SHA boundaries, distinct from range_input which records the original symbolic argument — this dual recording is what makes deterministic replay possible across time (the symbolic argument may resolve differently on re-invocation; the pinned SHAs are stable).

Determinism is absolute modulo the SHA-resolution phase. Given the same resolved SHA range and the same policy, classify_commits produces a CommitTriageReport whose commits array is in deterministic order (chronological by commit timestamp, tie-broken by SHA lexicographic) and whose summary fields are determined by the commits array. Replay against a pinned SHA range produces byte-identical output modulo the id and timestamp fields. The SHA-resolution phase is non-deterministic with respect to symbolic ref arguments — HEAD may resolve differently on successive invocations as new commits land — but this is correctly modeled as "different input after SHA resolution," not as non-determinism.

Narrow-function discipline. classify_commits classifies and reports. It does not open issues, post PR comments, modify commit messages, rewrite history, or interact with any system outside git and the Factory's specs/ output directory. It does not emit FunctionLifecycle transitions — those are control Function concerns, specified in a separate PRD if needed.

### Operational constraints

Shell-exec discipline. The Function invokes git via `child_process.exec` (or equivalent). Non-zero exit codes from git are surfaced as uncomputable status with the exit code and stderr recorded in the rationale. Timeout is enforced at 30 seconds per git invocation; exceeded timeout is an uncomputable condition, not a retry trigger. Git binary resolution happens at Function invocation start; absence is the first uncomputable case checked.

Range-size cap. The resolved SHA range must contain no more than 1000 commits. Ranges exceeding the cap produce `status: uncomputable` with the observed commit count recorded. This prevents pathological inputs (accidental `--root..HEAD` on large repositories) from consuming unbounded resources.

Policy is versioned. The classification policy at v2 is vanilla Conventional Commits v1.0.0 with the 11 canonical types plus "unknown" for un-classifiable messages. Future policies (per-repo overrides, additional types, custom scope rules) are separate Capabilities. The policy version identifier is recorded in every CommitTriageReport's rationale.

### Scope constraints

classify_commits operates on git repositories via git CLI. It does not interact with GitHub, GitLab, Bitbucket, or any git hosting API. Per-hosting integrations are separate Functions.

classify_commits classifies commits. It does not produce changelogs, release notes, version bumps, or any downstream artifact derived from classifications. Those are separate Functions under separate PRDs.

classify_commits targets local repositories (local filesystem path with a .git directory). Remote-only repositories (bare clones, network-fetched history) are out of scope for v2; a future extension may add remote-fetch capability behind a feature-flag-style policy.

Work Order governance, CCI, POE, PII, or any We-layer concept is out of scope per whitepaper §8. The Function's operational domain is entirely I-layer.

## Acceptance criteria

1. Given a repository path with a .git directory, a valid git range resolving to N commits (0 < N ≤ 1000), and the vanilla Conventional Commits policy, classify_commits emits a CommitTriageReport to `specs/commit-triage-reports/` with `commits.length == N`, `summary.total_commits == N`, and status equal to "pass" if no violations or "violations_detected" if any.

2. Every commit in the resolved range appears in the commits array exactly once. Order is chronological by commit timestamp ascending, tie-broken by SHA lexicographic ascending.

3. Each CommitClassification in commits has its `sha` field populated with the commit's full 40-character SHA (or 7+ character short SHA if git is configured to truncate; the schema accepts both), its `message_subject` field populated with the first line of the commit message, and its `classification` field populated with one of the 12 ConventionalCommitType enum values.

4. A commit message whose subject matches the Conventional Commits type-colon regex produces a CommitClassification with the matching classification, the scope populated if captured in parentheses (or null if absent), and breaking_change set to true iff the subject contained `!` before the colon.

5. A commit message whose subject does not match the Conventional Commits format produces a CommitClassification with classification = "unknown", scope = null, breaking_change = false, and violations containing at least the string "subject does not match Conventional Commits format".

6. A commit message containing the literal string "BREAKING CHANGE:" in its body (case-sensitive) produces breaking_change = true regardless of whether `!` appeared in the subject, with a violation entry recorded if the subject form is inconsistent with the body form.

7. A commit classified as feat that has no scope (no parenthesized segment) produces a violation entry "feat commit missing scope". This is a vanilla-Conventional-Commits-policy rule at v2.

8. Given a git binary absent from PATH, classify_commits emits a CommitTriageReport with status = "uncomputable" and rationale containing "git binary not found on PATH".

9. Given a valid git binary but an invalid repository path (no .git directory), classify_commits emits status = "uncomputable" with rationale containing "not a git repository" and the path attempted.

10. Given a valid repository but an unresolvable range argument (e.g., non-existent tag, malformed SHA), classify_commits emits status = "uncomputable" with rationale containing the git error output.

11. Given a resolved range exceeding 1000 commits, classify_commits emits status = "uncomputable" with rationale containing "range exceeds cap of 1000 commits; resolved to N commits" where N is the observed count.

12. Given a git command that exceeds the 30-second timeout, classify_commits emits status = "uncomputable" with rationale naming the timeout.

13. The emitted CommitTriageReport validates against the CommitTriageReport Zod schema. Schema-validation failure is an implementation defect thrown before file write.

14. Given identical resolved SHA ranges (range_from_sha and range_to_sha pinned to the same values), identical repository state at those SHAs, and identical policy, two invocations of classify_commits produce CommitTriageReports whose commits array and summary fields are byte-identical, and whose id and timestamp fields differ. This is the deterministic-replay invariant; symbolic ref resolution is out of scope for this criterion because symbolic refs may intentionally resolve differently.

15. The CommitTriageReport's summary fields are consistent with its commits array — total_commits equals commits.length, counts_by_classification sums to total_commits, commits_with_violations equals the count of commits whose violations array is non-empty.

## Success metrics

Classification accuracy. A hand-labeled corpus of Conventional-Commits-compliant commits is used as ground truth; the Function's classification is compared against the ground truth labels. Target accuracy: 95% on compliant commits, 90% including a mix of compliant and non-compliant. A single accuracy failure below target triggers a policy review.

Deterministic replay parity. Quarterly, a canonical pinned-SHA-range fixture is replayed through the current Function implementation and the CommitTriageReport is compared byte-by-byte (modulo id and timestamp) against the committed original. Any divergence is P0 and triggers immediate review.

Execution latency. Mean wall-clock time from invocation to file emission, measured per 100 commits in the resolved range. Target: below 5 seconds per 100 commits on a standard laptop-class machine.

Uncomputable rate. The fraction of invocations producing status = "uncomputable". Expected to be low (< 1%) on well-formed inputs; a rising rate indicates environmental or input-quality issues upstream.

## Out of scope

Changelog generation. classify_commits classifies; it does not compose changelogs from classifications. A downstream Function under a separate Capability handles that.

Semantic version bump inference. The Function records breaking_change markers but does not infer version bumps from them. Separate Function.

Per-repository classification policy. v2 ships with vanilla Conventional Commits; per-repo overrides (additional types, stricter scope rules, custom enforcement) are future work.

GitHub/GitLab/Bitbucket integration. Classification output may eventually feed PR checks, but the integration layer is outside v2.

Automatic commit-message rewriting. The Function observes and reports; it does not rewrite.

Work Order governance, CCI, POE, PII, or any We-layer concept.

## Downstream artifacts classify_commits will enable

A passing Gate 1 verdict on this PRD enables compilation to a WorkGraph. The WorkGraph specifies classify_commits; a Stage 6 coding-agent topology reads the WorkGraph and produces the classify_commits implementation code. The implementation, when invoked, emits a CommitTriageReport on disk. The CommitTriageReport is the first non-meta Factory-compiled output artifact the Factory will have produced.

The first repository classify_commits will be executed against is the Factory's own repository, for empirical symmetry with the Bootstrap-phase meta-compiles — the first invocation produces a CommitTriageReport for the Factory's commit history, which is a genuinely useful output (audit of the Factory's commit discipline against Conventional Commits) and a recursive but non-circular exercise (the classifier reads commits, not Factory specs/; the classifier's specs were produced by a different Factory pipeline than the one being classified).

Subsequent invocations will target arbitrary repositories as operational need arises.
