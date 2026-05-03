# DESIGN: Crystallizer Next Priorities

**Status:** APPROVED (Architect+SE: 4 conditions, all resolved below)
**Traces to:** DESIGN-CRYSTALLIZER.md, Architect+SE assessment post synthesis #11
**Context:** Crystallizer validated end-to-end (synthesis #11: all anchors pass, correct output).
Three priorities identified by Architect/SE review.

---

## Priority 1: Wire Hot-Config for crystallizer.enabled

### JTBD
When the Crystallizer degrades synthesis quality, I want to disable it via hot-config
without redeploying, so production pipelines are not blocked by a broken crystallizer.

### Current State
`pipeline.ts` line 189: `const crystallizerEnabled = true` — hardcoded. Requires
code change + deploy to toggle.

### Design
Read `crystallizer.enabled` from hot-config on each pipeline run:

```typescript
const hotConfig = await db.queryOne<{ crystallizer?: { enabled?: boolean } }>(
  `FOR c IN hot_config FILTER c._key == 'pipeline' RETURN c`
).catch(() => null)
const crystallizerEnabled = hotConfig?.crystallizer?.enabled ?? false
```

Default: `false` (fail-safe — crystallizer must be explicitly enabled).

Seed in `hot-config.ts`:
```typescript
{ _key: 'pipeline', crystallizer: { enabled: true } }
```

### Files to Modify
- `workers/ff-pipeline/src/pipeline.ts` — replace hardcoded flag with hot-config read
- `workers/ff-pipeline/src/config/hot-config.ts` — seed the pipeline config document

### Effort: 30 minutes

---

## Priority 2: Thread Violation Context into Remediation

### JTBD
When the Crystallizer gate says "remediate," I want the decompose model to know
WHICH anchors failed and WHY, so remediation produces correct output instead of
retrying blind.

### Current State
The compile-verify loop (pipeline.ts lines 247-292) re-runs the pass with identical
inputs on remediation. The model has no information about why it failed.

### Design
On remediation attempt > 0, inject violated anchor claims into the compilation prompt:

```typescript
if (r > 0 && violationFeedback) {
  context.violationFeedback = {
    message: 'Your previous decomposition missed key concepts from the signal.',
    violatedClaims: violationFeedback.map(a => a.claim),
    instruction: 'Ensure your atoms explicitly address these concepts in their title, description, or verifies field.',
  }
}
```

The `compilePRD` function already receives the full `context` object and passes it as
JSON to the LLM. Adding `violationFeedback` to the context makes it visible to the
decompose model without changing the function signature.

The decompose prompt should be updated to acknowledge this field:
```
If violationFeedback is provided, your previous attempt missed key concepts.
Address each violated claim in at least one atom's title or verifies field.
```

### Files to Modify
- `workers/ff-pipeline/src/pipeline.ts` — pass violation data into compState on remediation
- `workers/ff-pipeline/src/stages/compile.ts` — include violationFeedback in decompose context, update prompt

### Effort: 1 hour

---

## Priority 3: Pass-Specific Anchor Generation

### JTBD
When the Crystallizer probes passes beyond decompose (dependency, invariant), I want
anchors appropriate to each pass's output format, so probes don't false-positive on
structural outputs that legitimately lack type names.

### Current State
`PROBED_PASSES = ['decompose']` only. Dependency and invariant are unprobed because
synthesis #7 showed end-state anchors applied to structural outputs = false positives.

### Design
The crystallizer produces a flat set of anchors. A new field `applicable_passes`
determines which anchors fire on which passes:

```typescript
interface IntentAnchor {
  // ... existing fields
  applicable_passes?: string[]  // e.g., ['decompose'] or ['decompose', 'dependency']
}
```

Update the crystallizer prompt to generate pass-aware anchors:

```
For each anchor, specify which compilation passes it applies to:
- "decompose" anchors: check that atoms MENTION the key concepts
- "dependency" anchors: check that dependencies CONNECT the right atoms
- "invariant" anchors: check that invariants PROTECT the key behaviors

Set applicable_passes for each anchor.
```

The probe loop filters anchors by `applicable_passes` before probing:
```typescript
const passAnchors = intentAnchors.filter(a =>
  !a.applicable_passes || a.applicable_passes.includes(passName)
)
```

Expand `PROBED_PASSES` back to `['decompose', 'dependency', 'invariant']` once
pass-specific anchors are implemented.

### Files to Modify
- `workers/ff-pipeline/src/stages/crystallize-intent.ts` — add applicable_passes to prompt + type
- `workers/ff-pipeline/src/pipeline.ts` — filter anchors per pass, expand PROBED_PASSES

### Effort: 2 hours

---

## Implementation Order

1. **Hot-config** (30 min) — operational necessity, no design risk
2. **Violation feedback** (1 hour) — improves remediation from random retry to guided fix
3. **Pass-specific anchors** (2 hours) — expands coverage beyond decompose

All three are independent — no ordering dependency between them.
