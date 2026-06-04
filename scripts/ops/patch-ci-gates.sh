#!/usr/bin/env bash
# patch-ci-gates.sh — wire INV-11 and INV-13 into .github/workflows/ci.yml
# Usage: bash scripts/ops/patch-ci-gates.sh

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CI="$ROOT/.github/workflows/ci.yml"

[[ -f "$CI" ]] || { echo "ERROR: $CI not found" >&2; exit 1; }

# ── 1. Replace factory-pr-check stub with real fidelity + infra-guard ────────
python3 - <<'PY'
import pathlib, sys

ci = pathlib.Path(".github/workflows/ci.yml")
content = ci.read_text()

OLD = """\
  factory-pr-check:
    name: Factory PR Gate
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request' && contains(github.event.pull_request.labels.*.name, 'factory-generated')
    needs: [typecheck, test, repository-audit]
    steps:
      - name: Factory PR passed CI
        run: echo "Factory-generated PR passed all gates\""""

NEW = """\
  factory-pr-check:
    name: Factory PR Gate
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request' && contains(github.event.pull_request.labels.*.name, 'factory-generated')
    needs: [typecheck, test, repository-audit]
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      - name: Fidelity VR check (INV-13)
        run: pnpm --filter @factory/ff-pipeline fidelity:check
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - name: Guard infra configs from agent mutation
        run: |
          changed=$(git diff --name-only origin/main...HEAD | \\
            grep -E '(wrangler\\.jsonc|CLAUDE\\.md|AGENTS\\.md|\\.github/)' || true)
          [ -z "$changed" ] || { echo "BLOCKED: agent PR modified protected files:"; echo "$changed"; exit 1; }"""

if OLD not in content:
    print("ERROR: factory-pr-check stub not found — already patched?", file=sys.stderr)
    sys.exit(1)

ci.write_text(content.replace(OLD, NEW))
print("✓ factory-pr-check wired (INV-13)")
PY

# ── 2. Append singleton-rotation-check if not already present ────────────────
if grep -q "singleton-rotation-check" "$CI"; then
  echo "✓ singleton-rotation-check already present — skipping"
else
  cat >> "$CI" << 'YAML'

  singleton-rotation-check:
    name: Singleton Rotation Check (INV-11)
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'
    needs: [typecheck]
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - name: Check supervisor singleton suffix incremented on image change
        run: |
          IMAGE_CHANGED=$(git diff --name-only origin/main...HEAD | \
            grep -E '(workers/gascity-supervisor/Dockerfile|workers/gascity-supervisor/gc-linux-amd64)' || true)
          if [ -z "$IMAGE_CHANGED" ]; then
            echo "No container image change — rotation check skipped."
            exit 0
          fi
          echo "Image changed: $IMAGE_CHANGED"
          NEW_SUFFIX=$(grep -oE 'singleton-v[0-9]+' workers/gascity-supervisor/src/index.ts | head -1)
          OLD_SUFFIX=$(git show origin/main:workers/gascity-supervisor/src/index.ts | grep -oE 'singleton-v[0-9]+' | head -1)
          echo "main: $OLD_SUFFIX  branch: $NEW_SUFFIX"
          if [ "$NEW_SUFFIX" = "$OLD_SUFFIX" ]; then
            echo "FAIL: image changed but singleton suffix not rotated."
            echo "Fix: increment SUPERVISOR_SINGLETON in gascity-supervisor/src/index.ts"
            exit 1
          fi
          echo "OK: $OLD_SUFFIX → $NEW_SUFFIX"
YAML
  echo "✓ singleton-rotation-check appended (INV-11)"
fi

# ── 3. Commit ─────────────────────────────────────────────────────────────────
git add "$CI"
git commit -m "ci: wire fidelity:check (INV-13) + singleton-rotation-check (INV-11)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"

echo ""
echo "Done. Run: git push origin factory/fp-motdwvr2-w7un"
