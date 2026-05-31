#!/usr/bin/env bash
# End-to-end driver test for fidelity-release.sh.
#
# Exercises the three decision branches against the real validator CLI, with curl
# and gc stubbed so we can assert what bytes WOULD be POSTed. This is the
# Article IX integration check: the actual shell+runtime path the formula uses.
#
# Run: bash factory/fidelity/fidelity-release.test.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

PASS=0
FAIL=0
check() {
  local label="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "  ok: $label"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $label — expected [$expected] got [$actual]"
    FAIL=$((FAIL + 1))
  fi
}
contains() {
  local label="$1" needle="$2" haystack="$3"
  case "$haystack" in
    *"$needle"*) echo "  ok: $label"; PASS=$((PASS + 1));;
    *) echo "  FAIL: $label — [$needle] not found in output"; FAIL=$((FAIL + 1));;
  esac
}

# Pick the runtime (bun preferred).
if command -v bun >/dev/null 2>&1; then RT=bun; elif command -v node >/dev/null 2>&1; then RT=node; else echo "no JS runtime"; exit 1; fi

# Stub curl + gc on PATH so the driver does not hit the network or the bead store.
mkdir -p "$WORK/bin"
cat > "$WORK/bin/curl" <<EOF
#!/usr/bin/env bash
# Record the POST body + headers, return 202.
for a in "\$@"; do printf '%s\n' "\$a" >> "$WORK/curl.args"; done
echo "202"
EOF
cat > "$WORK/bin/gc" <<EOF
#!/usr/bin/env bash
printf 'gc %s\n' "\$*" >> "$WORK/gc.calls"
EOF
chmod +x "$WORK/bin/curl" "$WORK/bin/gc"
export PATH="$WORK/bin:$PATH"

export GC_BEAD_ID="bead-driver-1"
export FN_ID="FN-GC-FIDELITY-VALIDATION"
export GAS_CITY_HMAC_SECRET="driver-secret"
export FF_WEBHOOK_URL="https://factory/webhooks/gascity"
export FF_WEBHOOK_HMAC_KEYID="v1"
export RIG_ROOT="$WORK"
export FIDELITY_RUNTIME="$RT"
export FIDELITY_CLI="$SCRIPT_DIR/cli.ts"
# The authoritative per-step-type check table (FV-12, Q2: lives in city config).
export FIDELITY_CHECKS_CONFIG="$SCRIPT_DIR/../fidelity-checks.toml"

write_job() { printf '%s' "$1" > "$WORK/fidelity-job.json"; }

echo "[1] approved → post_release, bead closed, signed body POSTed"
write_job '{
  "step_name":"release","is_release_step":true,
  "lineage":{"fn_id":"FN-GC-FIDELITY-VALIDATION","is_id":"IS-X","es_id":"ES-X","ep_id":"EP-X","form_id":"FORM-X","factory_attempt":1,"bead_id":"bead-driver-1"},
  "declared_outputs":["FinalPatch"],
  "prior_step_verdicts":[{"step_index":0,"step_name":"verify","outcome":"approved","remediation":""}],
  "response":{"status":"completed","artifact_manifest":[{"name":"FinalPatch","state":"produced","checksum":"f1"}],"policy_events":[],"completion_claimed_without_manifest":false,"step_outputs":{"final_matches_verified":true}},
  "convergence":{"max_amendment_depth":3},
  "webhook":{"url":"https://factory/webhooks/gascity","hmac_secret":"driver-secret","key_id":"v1"}
}'
: > "$WORK/curl.args"; : > "$WORK/gc.calls"
set +e; bash "$SCRIPT_DIR/fidelity-release.sh"; rc=$?; set -e
check "exit code 0 (post_release)" "0" "$rc"
contains "POST carries approved outcome" '"outcome": "approved"' "$(cat "$WORK/curl.args")"
contains "POST carries bare integer factory_attempt" '"factory_attempt": 1' "$(cat "$WORK/curl.args")"
contains "POST carries X-GC-Key-ID v1" "v1" "$(cat "$WORK/curl.args")"
contains "bead closed" "bd close bead-driver-1" "$(cat "$WORK/gc.calls")"

echo "[2] verifier reject → post_release revise (Abort, no rerun)"
write_job '{
  "step_name":"verify","is_release_step":false,
  "lineage":{"fn_id":"FN-GC-FIDELITY-VALIDATION","is_id":"IS-X","es_id":"ES-X","ep_id":"EP-X","form_id":"FORM-X","factory_attempt":1,"bead_id":"bead-driver-1"},
  "declared_outputs":["VerifierReport"],
  "prior_step_verdicts":[],
  "response":{"status":"completed","artifact_manifest":[{"name":"VerifierReport","state":"produced","checksum":"v"}],"policy_events":[],"completion_claimed_without_manifest":false,"step_outputs":{"verifier_report_present":true,"verifier_accepts":false,"tests_section_present":true}},
  "convergence":{"max_amendment_depth":3},
  "webhook":{"url":"https://factory/webhooks/gascity","hmac_secret":"driver-secret","key_id":"v1"}
}'
: > "$WORK/curl.args"; : > "$WORK/gc.calls"
set +e; bash "$SCRIPT_DIR/fidelity-release.sh"; rc=$?; set -e
check "exit code 0 (post_release)" "0" "$rc"
contains "POST carries revise outcome" '"outcome": "revise"' "$(cat "$WORK/curl.args")"
contains "POST carries remediation" '"remediation"' "$(cat "$WORK/curl.args")"

echo "[3] patch conflict, depth remaining → rerun (no POST, remediation persisted)"
write_job '{
  "step_name":"code","is_release_step":false,
  "lineage":{"fn_id":"FN-GC-FIDELITY-VALIDATION","is_id":"IS-X","es_id":"ES-X","ep_id":"EP-X","form_id":"FORM-X","factory_attempt":1,"bead_id":"bead-driver-1"},
  "declared_outputs":["CandidatePatch"],
  "prior_step_verdicts":[],
  "response":{"status":"completed","artifact_manifest":[{"name":"CandidatePatch","state":"produced","checksum":"p"}],"policy_events":[],"completion_claimed_without_manifest":false,"step_outputs":{"patch_diff":"diff --git a/x b/x\n+y\n","patch_applies_cleanly":false}},
  "convergence":{"max_amendment_depth":3},
  "webhook":{"url":"https://factory/webhooks/gascity","hmac_secret":"driver-secret","key_id":"v1"}
}'
: > "$WORK/curl.args"; : > "$WORK/gc.calls"
set +e; bash "$SCRIPT_DIR/fidelity-release.sh"; rc=$?; set -e
check "exit code 10 (rerun)" "10" "$rc"
check "no POST issued on rerun" "" "$(cat "$WORK/curl.args")"
contains "remediation persisted for attempt 2" "regenerate" "$(cat "$WORK/REMEDIATION-2.md" 2>/dev/null || echo MISSING)"

echo "[4] fail-closed: job spec absent → molecule_failed POSTed, bead blocked"
rm -f "$WORK/fidelity-job.json"
: > "$WORK/curl.args"; : > "$WORK/gc.calls"
set +e; bash "$SCRIPT_DIR/fidelity-release.sh"; rc=$?; set -e
check "exit code 20 (molecule_failed)" "20" "$rc"
contains "molecule.failed event POSTed" "molecule.failed" "$(cat "$WORK/curl.args")"

echo ""
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
