#!/usr/bin/env bash
# Gas City fidelity validation RELEASE driver.
#
# Implements the runtime side of IS-GC-FIDELITY-VALIDATION FV-19..FV-22.
#
# Invoked by the factory-coding-v1 RELEASE [[step]]. It:
#   1. Reads the fidelity job spec the supervisor/provider wrote for this molecule
#      ($FIDELITY_JOB, default $RIG_ROOT/fidelity-job.json). The job carries the
#      provider response envelope, prior step verdicts, lineage, and loop state.
#   2. Runs the deterministic validator CLI (factory/fidelity/cli.ts).
#   3. Acts on the CLI's decision:
#        - post_release    → POST the signed RELEASE payload to the Factory webhook,
#                            retry once on non-2xx (FV-22), close the bead.
#        - rerun           → emit a Gas City convergence note and re-enter the
#                            molecule (the formula's max_iterations governs the loop).
#        - molecule_failed → POST the signed molecule.failed operational event
#                            (fail-closed; never POST a malformed completion payload).
#
# The validator does the verdict bijection, payload field-order, integer
# factory_attempt, and HMAC. This script only moves bytes — it makes no judgment.
#
# Required env:
#   GC_BEAD_ID               the molecule's bead id (Gas City supplies)
#   GAS_CITY_HMAC_SECRET     the HMAC signing secret (Gas City host env)
#   FF_WEBHOOK_URL           the Factory webhook URL
#   FF_WEBHOOK_HMAC_KEYID    the HMAC key id (default v1)
# Optional env:
#   FIDELITY_JOB             path to the job spec (default $RIG_ROOT/fidelity-job.json)
#   FIDELITY_RUNTIME         the JS runtime to run the CLI (default: bun, fallback node)
#   FIDELITY_CLI             path to cli.ts (default: dir of this script /cli.ts)
#   FIDELITY_CHECKS_CONFIG   path to the per-step-type check table fidelity-checks.toml
#                            (default: $SCRIPT_DIR/../fidelity-checks.toml — the formula
#                            root's config). The CLI reads this to apply per-step-type
#                            fidelity checks; no per-step judgment lives in code.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI="${FIDELITY_CLI:-$SCRIPT_DIR/cli.ts}"
JOB="${FIDELITY_JOB:-${RIG_ROOT:-.}/fidelity-job.json}"
KEYID="${FF_WEBHOOK_HMAC_KEYID:-v1}"
# Make the check-config path explicit and configurable; export it so the CLI's
# main() resolves the same table the driver intends (default: formula-root config).
export FIDELITY_CHECKS_CONFIG="${FIDELITY_CHECKS_CONFIG:-$SCRIPT_DIR/../fidelity-checks.toml}"

runtime() {
  if [ -n "${FIDELITY_RUNTIME:-}" ]; then echo "$FIDELITY_RUNTIME"; return; fi
  if command -v bun >/dev/null 2>&1; then echo "bun"; return; fi
  if command -v node >/dev/null 2>&1; then echo "node"; return; fi
  echo "" # no runtime
}

emit_molecule_failed() {
  # Fail-closed path when the runtime or job is unusable. Build + sign a minimal
  # molecule.failed event so the bead does not silently hang (FV-20).
  local message="$1"
  local body sig code
  body=$(printf '{"event_type":"molecule.failed","fn_id":"%s","bead_id":"%s","severity":"sev2","message":"%s"}' \
    "${FN_ID:-FN-UNKNOWN}" "${GC_BEAD_ID:-bead-unknown}" "$message")
  sig=$(printf '%s' "$body" | openssl dgst -sha256 -hmac "${GAS_CITY_HMAC_SECRET:-}" -hex | awk '{print $NF}')
  code=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "${FF_WEBHOOK_URL:?FF_WEBHOOK_URL required}" \
    -H "Content-Type: application/json" \
    -H "X-GC-Signature: sha256=$sig" \
    -H "X-GC-Key-ID: $KEYID" \
    -d "$body") || true
}

extract_cli_result() {
  local result="$1"
  local rt="$2"
  local expr="$3"
  printf '%s' "$result" | "$rt" -e "const fs=require('fs');let r;try{r=JSON.parse(fs.readFileSync(0,'utf8'));}catch{process.exit(2)}const value=$expr;if(value===undefined||value===null){process.exit(3)}process.stdout.write(String(value))"
}

fail_malformed_cli_output() {
  emit_molecule_failed "Fidelity validator output was not valid JSON or was missing required fields."
  gc bd close "$GC_BEAD_ID" --status=blocked || true
  exit 20
}

main() {
  local rt
  rt="$(runtime)"
  if [ -z "$rt" ]; then
    emit_molecule_failed "Fidelity validator runtime unavailable in the Gas City container."
    exit 20
  fi
  if [ ! -f "$JOB" ]; then
    emit_molecule_failed "Fidelity job spec absent; provider evidence was not assembled for this molecule."
    exit 20
  fi

  # The CLI prints a single JSON line: { action, ... } AND signals the action via
  # its exit code (0=post_release, 10=rerun, 20=molecule_failed). We must capture
  # stdout without letting the non-zero exit abort the script (set -e), so the
  # substitution is guarded.
  local result
  result="$("$rt" "$CLI" < "$JOB")" || true

  local action
  if ! action="$(extract_cli_result "$result" "$rt" 'r.action')"; then
    fail_malformed_cli_output
  fi

  case "$action" in
    post_release)
      local body url sig
      if ! body="$(extract_cli_result "$result" "$rt" 'r.body')" ||
         ! url="$(extract_cli_result "$result" "$rt" 'r.url')" ||
         ! sig="$(extract_cli_result "$result" "$rt" 'r.headers["X-GC-Signature"]')"; then
        fail_malformed_cli_output
      fi

      local code
      code=$(curl -s -o /tmp/ff-release-resp.txt -w "%{http_code}" \
        -X POST "$url" \
        -H "Content-Type: application/json" \
        -H "X-GC-Signature: $sig" \
        -H "X-GC-Key-ID: $KEYID" \
        -d "$body")
      if [ "$code" != "200" ] && [ "$code" != "202" ]; then
        # FV-22 — retry once with the identical payload + signature.
        sleep "${FIDELITY_RETRY_SLEEP_SECONDS:-5}"
        code=$(curl -s -o /tmp/ff-release-resp.txt -w "%{http_code}" \
          -X POST "$url" \
          -H "Content-Type: application/json" \
          -H "X-GC-Signature: $sig" \
          -H "X-GC-Key-ID: $KEYID" \
          -d "$body")
      fi
      if [ "$code" != "200" ] && [ "$code" != "202" ]; then
        gc bd note "$GC_BEAD_ID" "RELEASE failed: $code $(cat /tmp/ff-release-resp.txt 2>/dev/null)" || true
        gc bd close "$GC_BEAD_ID" --status=blocked || true
        emit_molecule_failed "Factory RELEASE webhook rejected completion payload with status $code."
        exit 20
      fi
      gc bd close "$GC_BEAD_ID"
      exit 0
      ;;
    rerun)
      local next rem
      if ! next="$(extract_cli_result "$result" "$rt" 'r.next_attempt')" ||
         ! rem="$(extract_cli_result "$result" "$rt" 'r.remediation_to_inject')"; then
        fail_malformed_cli_output
      fi
      # Whole-molecule restart (spec Open Question 1 adopted default). Persist the
      # remediation so the next attempt's authoring steps can inject it as context.
      printf '%s' "$rem" > "${RIG_ROOT:-.}/REMEDIATION-${next}.md"
      gc bd note "$GC_BEAD_ID" "Fidelity verdict: revise. Re-running molecule as attempt $next with injected remediation." || true
      exit 10
      ;;
    molecule_failed)
      local body url sig
      if ! body="$(extract_cli_result "$result" "$rt" 'r.body')" ||
         ! sig="$(extract_cli_result "$result" "$rt" 'r.headers["X-GC-Signature"]')"; then
        fail_malformed_cli_output
      fi
      curl -s -o /dev/null -w "%{http_code}" \
        -X POST "$FF_WEBHOOK_URL" \
        -H "Content-Type: application/json" \
        -H "X-GC-Signature: $sig" \
        -H "X-GC-Key-ID: $KEYID" \
        -d "$body" || true
      gc bd close "$GC_BEAD_ID" --status=blocked || true
      exit 20
      ;;
    *)
      emit_molecule_failed "Fidelity validator returned an unrecognized action: $action"
      exit 20
      ;;
  esac
}

main "$@"
