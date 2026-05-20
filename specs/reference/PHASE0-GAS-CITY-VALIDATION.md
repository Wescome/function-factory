# Phase 0: Gas City Coding Pipeline Validation

**Type:** Codex task spec  
**Status:** Ready to execute  
**Date:** 2026-05-19  
**Lineage:** ADR-010 (Gas City supersedes NLAH), DECISIONS.md (2026-05-19 Gas City entry)

---

## JTBD

When the team has decided Gas City is the Factory's execution substrate, we
want to prove Gas City can run the six-stage coding pipeline as a Formula
before wiring Factory governance into it, so we can validate the Gas City
mechanics in isolation and catch integration assumptions before they become
load-bearing.

---

## Goal

Run the Factory coding pipeline (SEED → CONTRACT → MAP → PATCH → VERIFY →
RELEASE) as a Gas City Formula against a minimal test repo. Produce all seven
pipeline artifacts. Verifier must return `Verdict: PASS`. No Factory
integration — no ArangoDB, no CF Workers, no pi Container.

This is a mechanics proof: Gas City's Formula → Molecule → Session → Gate
loop works for the coding pipeline shape. Nothing more.

---

## Prerequisites

Install Gas City on the local machine:

```bash
brew install gastownhall/gascity/gascity
gc version   # must print v1.0.0 or newer

brew install dolt flock
dolt --version   # must be 1.86.2 or newer

# bd (beads CLI)
# Download from: https://github.com/gastownhall/beads/releases
# Install to /usr/local/bin/bd and chmod +x

brew install tmux jq
```

Also required: `claude` CLI (Claude Code) installed and authenticated.

---

## Deliverables

1. A Gas City city at `~/phase0-city/` that is self-contained and runnable
2. A minimal test repo at `~/phase0-city/rigs/test-repo/` with a deliberate bug
3. A Formula TOML encoding the six pipeline stages
4. Prompt templates for each coding role
5. A gate script that validates all pipeline artifacts
6. A smoke run log proving all six stages completed and Verifier returned `Verdict: PASS`
7. A written summary (`~/phase0-city/RESULTS.md`) recording what worked, what
   failed, and what assumptions need revisiting before Phase 1

---

## Step 1 — Create the test repo

Create a minimal Node.js repo with a deliberate bug. This is the rig Gas City
will work on.

```bash
mkdir -p ~/phase0-city/rigs/test-repo/src
mkdir -p ~/phase0-city/rigs/test-repo/test
cd ~/phase0-city/rigs/test-repo
git init
```

**`~/phase0-city/rigs/test-repo/package.json`:**
```json
{
  "name": "test-repo",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "test": "node --test test/math.test.js"
  }
}
```

**`~/phase0-city/rigs/test-repo/src/math.js`:**
```javascript
// Returns the sum of two numbers
export function add(a, b) {
  return a - b;  // BUG: should be a + b
}

// Returns true if n is even
export function isEven(n) {
  return n % 2 === 0;
}
```

**`~/phase0-city/rigs/test-repo/test/math.test.js`:**
```javascript
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { add, isEven } from '../src/math.js';

describe('math', () => {
  it('add returns sum', () => {
    assert.equal(add(1, 2), 3);
    assert.equal(add(0, 0), 0);
    assert.equal(add(-1, 1), 0);
  });

  it('isEven returns correct boolean', () => {
    assert.equal(isEven(2), true);
    assert.equal(isEven(3), false);
  });
});
```

Commit the repo:
```bash
cd ~/phase0-city/rigs/test-repo
git add -A
git commit -m "initial: add math.js with deliberate bug in add()"
```

Verify the tests fail (they should — `add` uses subtraction):
```bash
npm test   # should FAIL: AssertionError: 2 !== 3
```

---

## Step 2 — Create the Gas City city

```bash
mkdir -p ~/phase0-city
cd ~/phase0-city
gc init .
```

This creates `.gc/`, `city.toml`, and basic scaffolding.

---

## Step 3 — Configure city.toml

Replace the generated `city.toml` with:

**`~/phase0-city/city.toml`:**
```toml
[workspace]
provider = "claude"

[beads]
provider = "bd"

[[rigs]]
name = "test-repo"

[[named_session]]
name = "coder"
template = "coder"
mode = "always"
```

---

## Step 4 — Configure the coder agent

```bash
mkdir -p ~/phase0-city/agents/coder
```

**`~/phase0-city/agents/coder/agent.toml`:**
```toml
dir = "test-repo"
provider = "claude"
```

**`~/phase0-city/agents/coder/prompt.template.md`:**
```markdown
You are a coding agent working on the repository in your current directory.

You execute coding pipeline stages sequentially. Each stage has a precise
responsibility and produces a specific artifact. Read each stage instruction
carefully and produce the exact artifact at the exact path specified.

## Artifact directory

All pipeline artifacts go under `artifacts/` in the repo root. Create this
directory if it does not exist.

## Rules

- Never modify files outside the repository root.
- Always write artifacts to `artifacts/` at the exact filenames specified.
- If a step says "read X", find X in `artifacts/` and read it before proceeding.
- Never skip a step. Never guess at content. Read what exists.
- If you cannot complete a step, write a brief error note to
  `artifacts/STAGE_ERROR.md` describing what you could not do and why.
```

---

## Step 5 — Write the Formula

```bash
mkdir -p ~/phase0-city/formulas
```

**`~/phase0-city/formulas/coding-pipeline.toml`:**
```toml
formula = "coding-pipeline"
description = "Factory coding pipeline: SEED → CONTRACT → MAP → PATCH → VERIFY → RELEASE"
convergence = true

[vars]
issue_title = "Fix add() function which subtracts instead of adds"
issue_body  = "The add() function in src/math.js returns `a - b` instead of `a + b`. Fix it so all tests in test/math.test.js pass when run with `npm test`."
test_command = "npm test"

[[steps]]
id = "seed"
title = "SEED: Create seed workspace"
description = """
Create the file `artifacts/seed_workspace.json` with the following JSON structure:

{
  "schemaVersion": "1",
  "issue": {
    "title": "{{.Vars.issue_title}}",
    "body": "{{.Vars.issue_body}}"
  },
  "testCommand": "{{.Vars.test_command}}",
  "files": {
    "src/math.js": "<exact contents of src/math.js>",
    "test/math.test.js": "<exact contents of test/math.test.js>",
    "package.json": "<exact contents of package.json>"
  }
}

Read each file from disk and embed its exact contents. Do not paraphrase.
Write the JSON to `artifacts/seed_workspace.json`.
"""
needs = []

[[steps]]
id = "contract"
title = "CONTRACT: Write issue contract"
description = """
Read `artifacts/seed_workspace.json`.

Write `artifacts/issue_contract.md` with the following sections:

Issue: [one-sentence summary of what is wrong]

Acceptance:
- [bullet list of what must be true when the issue is resolved]
- [include: all tests in test/math.test.js pass when `npm test` is run]
- [include: src/math.js add() returns a + b]

Constraints:
- Do not modify test/math.test.js
- Do not add new dependencies
- Change must be minimal: only fix the bug, nothing else

Write the file to `artifacts/issue_contract.md`.
"""
needs = ["seed"]

[[steps]]
id = "map"
title = "MAP: Write repo map"
description = """
Read `artifacts/seed_workspace.json` and `artifacts/issue_contract.md`.

Write `artifacts/repo_map.md` with the following sections:

## Relevant files
List every file relevant to the issue with a one-line description.
Must include `src/math.js`.

## Files to change
List only the files that need to be modified to resolve the issue.

## Test entrypoints
List the exact command to run tests. Must include:
`node test/math.test.js`

Write the file to `artifacts/repo_map.md`.
"""
needs = ["contract"]

[[steps]]
id = "patch"
title = "PATCH: Produce candidate patch"
description = """
Read `artifacts/seed_workspace.json`, `artifacts/issue_contract.md`,
and `artifacts/repo_map.md`.

Fix the bug described in the issue contract. The fix is in `src/math.js`.

After making the fix, run `npm test` to confirm the tests pass.

Then produce a unified diff of your change using:
  git diff HEAD src/math.js

Write the exact output of that command to `artifacts/candidate.patch`.

The patch must:
- Begin with `diff --git a/src/math.js b/src/math.js`
- Include `--- a/src/math.js` and `+++ b/src/math.js` headers
- Include a `@@ ... @@` hunk header
- Include at least 3 lines of unchanged context above and below the change
"""
needs = ["map"]

[[steps]]
id = "verify"
title = "VERIFY: Independent verification"
description = """
Read `artifacts/seed_workspace.json` and `artifacts/candidate.patch`.

Independently verify the patch WITHOUT relying on any local edits you made.

Steps:
1. Create a temporary directory: `mktemp -d`
2. Copy the original file contents from `artifacts/seed_workspace.json`
   (the "files" field) into the temp directory, recreating the file structure
3. Apply `artifacts/candidate.patch` using: `git apply artifacts/candidate.patch`
   from the repo root (the patch uses repo-relative paths)
4. Run `npm test` from the temp directory (copy package.json too)
   OR run the test against the patched file directly if npm is not available
   in the temp dir

Write `artifacts/verifier_report.md` with:

Verdict: PASS
  (if git apply succeeded AND tests passed)

Verdict: FAIL
  (if git apply failed OR tests failed)

## Tests run
[exact stdout and exit code of the test command]

## Evidence
[description of what you did and what you observed]

The line `Verdict: PASS` or `Verdict: FAIL` must appear exactly as shown
at the top of the file.
"""
needs = ["patch"]

[[steps]]
id = "release"
title = "RELEASE: Finalize and summarize"
description = """
Read `artifacts/verifier_report.md`.

If the verifier report does not contain `Verdict: PASS`, write
`artifacts/RELEASE_BLOCKED.md` explaining that the patch did not verify
and stop. Do not create final.patch or pr_summary.md.

If the verifier report contains `Verdict: PASS`:

1. Copy `artifacts/candidate.patch` to `artifacts/final.patch` exactly.

2. Write `artifacts/pr_summary.md` with:

Summary: [one-paragraph description of the change and why it was made]

Tests: [one-line description of what tests cover the fix and their result]

Evidence: [reference to verifier_report.md verdict and test output]
"""
needs = ["verify"]

[convergence]
gate_condition = "scripts/coding-gate.sh"
gate_timeout = "10m"
gate_timeout_action = "manual"
```

---

## Step 6 — Write the gate script

```bash
mkdir -p ~/phase0-city/scripts
```

**`~/phase0-city/scripts/coding-gate.sh`:**
```bash
#!/usr/bin/env bash
# Phase 0 gate: no Factory API calls.
# Checks artifact existence and Verifier PASS verdict only.
set -euo pipefail

RIG_ROOT="$(git -C . rev-parse --show-toplevel 2>/dev/null || pwd)"
ARTIFACTS="$RIG_ROOT/artifacts"

echo "=== Phase 0 Gate ==="
echo "Checking artifacts in: $ARTIFACTS"

MISSING=()
for f in seed_workspace.json issue_contract.md repo_map.md candidate.patch verifier_report.md final.patch pr_summary.md; do
  if [ ! -f "$ARTIFACTS/$f" ]; then
    MISSING+=("$f")
    echo "MISSING: $f"
  else
    echo "OK: $f"
  fi
done

if [ ${#MISSING[@]} -gt 0 ]; then
  echo "GATE FAIL: ${#MISSING[@]} artifact(s) missing"
  exit 1
fi

# Check verifier verdict
VERDICT=$(grep -m1 "^Verdict:" "$ARTIFACTS/verifier_report.md" 2>/dev/null || echo "")
if [[ "$VERDICT" != "Verdict: PASS" ]]; then
  echo "GATE FAIL: verifier_report.md does not contain 'Verdict: PASS'"
  echo "Found: $VERDICT"
  exit 1
fi

# Check candidate.patch is a valid unified diff
if ! grep -q "^diff --git" "$ARTIFACTS/candidate.patch"; then
  echo "GATE FAIL: candidate.patch does not look like a unified diff"
  exit 1
fi

echo "=== GATE PASS ==="
# Required by Gas City convergence — write the agent verdict
bd meta set convergence.agent_verdict pass 2>/dev/null || true
exit 0
```

```bash
chmod +x ~/phase0-city/scripts/coding-gate.sh
```

---

## Step 7 — Register the rig and start the city

```bash
cd ~/phase0-city
gc rig add ~/phase0-city/rigs/test-repo

gc start
```

Verify the city is running:
```bash
gc status
bd list
```

---

## Step 8 — Run the pipeline

Create a bead for the issue and sling the formula:

```bash
cd ~/phase0-city

BEAD_ID=$(bd create "Fix add() function which subtracts instead of adds" --json | jq -r '.id')
echo "Bead: $BEAD_ID"

gc sling coder --formula coding-pipeline \
  --var issue_title="Fix add() function which subtracts instead of adds" \
  --var issue_body="The add() function in src/math.js returns a - b instead of a + b. Fix it so all tests in test/math.test.js pass when run with npm test." \
  --var test_command="npm test"
```

Watch progress:
```bash
gc session attach coder    # watch the agent work
# Ctrl+b d to detach from tmux
```

After the formula completes, run the gate manually to check:
```bash
cd ~/phase0-city/rigs/test-repo
bash ~/phase0-city/scripts/coding-gate.sh
```

---

## Step 9 — Verify results

Check all seven artifacts exist:
```bash
ls -la ~/phase0-city/rigs/test-repo/artifacts/
```

Check verifier verdict:
```bash
head -3 ~/phase0-city/rigs/test-repo/artifacts/verifier_report.md
# Must show: Verdict: PASS
```

Check the patch is valid:
```bash
head -5 ~/phase0-city/rigs/test-repo/artifacts/candidate.patch
# Must show: diff --git a/src/math.js b/src/math.js
```

Check that tests actually pass with the patch applied:
```bash
cd ~/phase0-city/rigs/test-repo
git stash   # stash any edits from the agent session
git apply artifacts/candidate.patch
npm test    # must PASS
git stash pop   # restore
```

---

## Step 10 — Write RESULTS.md

Write `~/phase0-city/RESULTS.md` with:

```markdown
# Phase 0 Results — [date]

## Outcome
PASS / FAIL / PARTIAL

## Artifacts produced
List each artifact and whether it met its contract.

## Gate result
Output of scripts/coding-gate.sh

## What worked
[observations about Gas City mechanics that worked as expected]

## What didn't work
[any failures, surprises, or manual interventions required]

## Assumptions to revisit before Phase 1
[anything that needs to change before Factory integration]

## Token usage / timing
[approximate tokens used, wall-clock time for the full run]
```

---

## Success Criteria

Phase 0 is complete when ALL of the following are true:

1. `~/phase0-city/rigs/test-repo/artifacts/` contains all seven files:
   `seed_workspace.json`, `issue_contract.md`, `repo_map.md`,
   `candidate.patch`, `verifier_report.md`, `final.patch`, `pr_summary.md`

2. `verifier_report.md` contains exactly `Verdict: PASS` on its first line

3. `candidate.patch` is a valid unified diff that applies cleanly with
   `git apply` on the original (un-edited) test repo

4. Running `npm test` after applying `candidate.patch` exits 0

5. `scripts/coding-gate.sh` exits 0 without manual intervention

6. `RESULTS.md` exists and documents what worked and what needs revisiting

---

## Failure handling

**If the agent produces `Verdict: FAIL`:** Check `verifier_report.md` for
the test output. If the patch was wrong, adjust the PATCH step prompt and
re-run. Do not modify the test file. The bug is in `src/math.js` only.

**If a step produces no artifact:** The agent may have timed out or lost
context. Check `gc session attach coder` for the last message. Re-sling
only the failing step or reset and re-run the full formula.

**If the gate script fails:** Read the exact error output. The most common
causes are missing artifacts (agent skipped a step) or `Verdict: FAIL` in
the verifier report.

**If Gas City startup fails (`gc start`):** Check `gc doctor` for missing
dependencies (tmux, dolt, bd, flock). Install any missing tools.

**Three failures on the same step → STOP.** Document the failure in
RESULTS.md and report to GUV. Do not iterate further on Phase 0 — root
cause the failure before Phase 1 begins.

---

## What Phase 0 does NOT test

- Factory governance (no ArangoDB, no Crystallizer, no VR)
- Factory lineage (no fn-id/is-id/es-id labels)
- Convergence iteration (gate_timeout_action = "manual" for Phase 0)
- Multi-agent sessions (one `coder` session only)
- Health patrol (single run, no long-running city)
- Amendment loop (no Fidelity VR to fail)

All of these are Phase 1–4 concerns. Phase 0 proves only that Gas City's
Formula → Molecule → Session → Gate loop works for the coding pipeline shape.

---

## Output to GUV

When complete, report:
1. The full output of `scripts/coding-gate.sh`
2. The first 10 lines of each artifact
3. The contents of `RESULTS.md`
4. Any Gas City behaviors that differed from ADR-010's assumptions

GUV will review RESULTS.md and decide whether to proceed to Phase 1 or
revisit the Gas City integration architecture.
