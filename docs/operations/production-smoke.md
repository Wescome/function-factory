# Function Factory Production Smoke Test

## Purpose
Verify that the Function Factory production environment is healthy and capable of executing a full pipeline from signal ingestion through synthesis. This procedure does **not** change runtime code.

## Prerequisites
- Access to `ff-pipeline` and `ff-gateway` in the production environment
- Valid authentication tokens / network access
- A text editor or runbook to record IDs and results

## Procedure

### 1. Health Checks
Query the following `ff-pipeline` debug endpoints and confirm healthy responses.

| Endpoint | Expected Healthy Output |
|---|---|
| `GET /version` | Returns current application version string (e.g., `1.2.3`). |
| `GET /debug/health` | Status `200 OK`; body indicates overall system health. |
| `GET /debug/arango` | Status `200 OK`; confirms connectivity to ArangoDB. |
| `GET /debug/ai-test` | Status `200 OK`; confirms AI/LLM backend reachability. |

Record any anomalies. All four must pass before proceeding.

### 2. Start a Dry-Run Pipeline
Submit a smoke-test signal through `ff-gateway` configured for **dry-run** mode.

- Ensure the pipeline configuration specifies `dryRun: true`.
- Capture the returned **`pipelineId`** and **`signalId`**.
- Note the **`workGraphId`** generated after pipeline initiation.

### 3. Approve the Pipeline
Using the administrative interface or API:
- Locate the pipeline by its `pipelineId`.
- Execute the approval action so synthesis may proceed.

### 4. Confirm Synthesis-Passed
Monitor the pipeline until the synthesis stage completes.

- Verify the stage status is **`synthesis-passed`**.
- Record the **`workGraphId`** (if not already captured).
- Record the **Gate 1 result** (pass / fail / pending) as shown in the pipeline state.

### 5. Optional: Real-Mode Docs-Only Smoke
To validate model-backed execution without risking code mutation, run one **real-mode** pipeline restricted to **docs-only** scope:

- Submit a signal with `dryRun: false` and scope limited to documentation changes only.
- This confirms that LLM inference, cost tracking, and artifact generation function in production while guaranteeing no runtime code is modified.
- Record the resulting `pipelineId`, `signalId`, and final verdict separately.

### 6. Final Verdict
Based on the above observations, assign one of the following verdicts:

- **PASS** - All health checks green, dry-run completes end-to-end, optional real-mode docs-only succeeds (if performed).
- **FAIL** - Any health check fails, pipeline stalls, or synthesis does not pass.
- **DEFERRED** - Infrastructure issues block execution; escalate before release.

## Recording Sheet

| Field | Value |
|---|---|
| Pipeline ID | |
| Signal ID | |
| WorkGraph ID | |
| Gate 1 Result | |
| Final Verdict | |
| Operator | |
| Timestamp | |

## Success Criteria
- An operator can follow this document manually without referring to source code.
- Expected healthy outputs are listed for each health endpoint.
- The docs-only real-mode smoke is explained as a way to validate model-backed execution without mutating runtime code.
- No runtime code is changed by executing this procedure.
