---
name: invariant-authoring
version: 2026-04-18
triggers:
  - "write invariant"
  - "author invariant"
  - "detector spec"
  - "declare invariant"
  - "specify invariant"
tools: [view, create_file, str_replace]
preconditions: []
constraints:
  - "invariants without detectors are rejected at Gate 1 — do not emit them"
  - "every detector spec requires named evidence sources, direct rules, regression policy, and incident tags"
  - "detector specs are not optional and cannot be deferred"
category: factory-core
---

# Invariant Authoring

An invariant is a persistent truth that must hold for a Function to be
trustworthy. The Factory accepts no invariant without a complete detector
spec. This skill enforces that.

## Required fields for an Invariant

```yaml
id: INV-XXX
function_id: FN-XXX
scope: entity | workflow | system
statement: "natural-language statement of what must hold"
violation_impact: low | medium | high
source_refs:
  - atom or contract IDs that produced this invariant
explicitness: explicit | inferred
rationale: "why this invariant exists"
detector:
  name: descriptive_detector_name
  evidence_sources:
    - "telemetry.* or audit.* or incident.*"
  direct_rules:
    - "executable rule that defines a direct violation"
  warning_rules:
    - "rule that raises suspicion but not violation"
  regression_policy:
    direct_violation: regressed
    repeated_warning_24h: degraded
  incident_tags:
    - "tag1"
    - "tag2"
```

## Rules

1. **Every invariant has a scope.** Entity-level, workflow-level, or
   system-level. Unscoped invariants fail Gate 1.

2. **Every invariant has at least one direct rule.** The direct rule must
   be a statement that an automated detector can evaluate over a named
   evidence source without human interpretation.

3. **Every direct rule cites a specific evidence source.** A direct rule
   that doesn't name the telemetry/audit/incident stream it reads from is
   incomplete. Reject it.

4. **Regression policy maps every relevant judgment to a status transition.**
   At minimum: what happens on a direct violation, what happens on
   repeated warnings.

5. **Incident tags are populated.** These are the tags that an incident
   must carry for it to link to this invariant via the IncidentLink
   mechanism in §5 of the whitepaper.

6. **Warning rules are optional but encouraged.** A warning rule catches
   suspicious behavior before it escalates to a violation. Invariants with
   only direct rules and no warning rules work but degrade the system's
   early-warning capacity.

## Anti-patterns

- **"The system shall be reliable."** Not an invariant. Untestable. No
  detector possible. Reject.
- **"All requests are authenticated."** Statement is fine, but without a
  named evidence source (e.g., `audit.auth_decisions`) and a direct rule
  (e.g., `count(request without auth_decision) > 0 over 15m`), it is a
  wish. Reject.
- **Invariants that rephrase validations.** Validations prove invariants;
  they are not themselves invariants. If a candidate invariant is actually
  a test case in disguise, promote it to a validation or rework it into a
  statement that a runtime detector could evaluate.

## Self-rewrite hook

After every 5 invariants authored OR on any Gate 1 failure citing an
incomplete detector spec from this skill:
1. Read recent invariant entries in episodic memory
2. If a detector pattern keeps failing (e.g., evidence sources that turn out
   not to exist), update the anti-patterns section
3. Commit: `META: skill-update: invariant-authoring, {one-line reason}`
