# Deployment Gate Protocol

**Status:** MANDATORY — no exceptions, no shortcuts, no "the feature flag makes it safe"
**Enforced by:** GUV (Governor). Violation = governance failure.

## The Sequence

```
1. GUV writes spec/design
2. Spawn Architect agent → reviews spec (correctness, feasibility, integration)
3. Spawn SE agent → reviews spec (risks, failure modes, dependencies)
4. Resolve all conditions from steps 2-3 in the spec
5. Spawn Engineer agent → builds code (TDD)
6. GUV verifies tests pass
7. Spawn Critic agent → reviews CODE (quality, spec compliance, edge cases)
8. GUV fixes any MUST issues from Critic
9. ONLY NOW: commit + push + deploy
```

## Rules

- **Steps 2-3 are spec gates.** No Engineer spawns until both Architect and SE approve.
- **Step 7 is the code gate.** No deploy until Critic reviews the Engineer's code.
- **The feature flag is NOT a substitute for code review.** Code that is deployed but "off" can be turned on by anyone. It must be reviewed before it exists in production.
- **GUV does not review his own work.** GUV proposes and orchestrates. Architect, SE, and Critic review. GUV fixes what they find. This is separation of concerns.
- **Do not ask Wes for permission between steps.** The protocol IS the permission. Execute it. Only pause when: (a) a review returns REVISE, (b) an architecture decision is needed that GUV cannot make, or (c) there is a blocker.
- **Do not combine review + build in one agent.** Each agent has one job. Architect reviews. SE reviews. Engineer builds. Critic reviews code. Mixing roles produces shallow work.

## What Each Agent Reviews

| Agent | Reviews | Looks For |
|-------|---------|-----------|
| Architect | Spec/design | Correctness, feasibility, integration gaps, reference fidelity |
| SE | Spec/design | Failure modes, dependencies, operational readiness, risks |
| Engineer | (builds, doesn't review) | Implements spec via TDD |
| Critic | Code (after Engineer) | Quality, spec compliance, edge cases, missing tests, anti-corruption |

## Violation Recovery

If the protocol is violated (e.g., code deployed without Critic review):
1. Acknowledge the violation — don't rationalize it
2. Run the skipped review immediately
3. Fix any issues found
4. Commit + deploy the fixes
5. Do not repeat the violation

## This Protocol Exists Because

GUV repeatedly skipped the Critic review step and deployed unreviewed code. Three times in one session (2026-05-02). The Critic found real bugs each time (unpersisted anchors, violation_signal inversion, hardcoded feature flag). Skipping the Critic means shipping bugs.
