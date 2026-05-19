# Pi Production Defects To Fix Later

Source refs:
- `ff-dogfood-prompt-persist-mpbyd6wl`
- `ff-dogfood-prompt-verify-mpbytfgq`
- `ff-dogfood-prompt-verify-mpbyvrcs`
- `pi-operational-mpbze86c`

Current production proof:
- `pi-operational-mpbze86c` completed end-to-end on Worker/container version `4f244b28-9643-4ab4-b136-5626446abb24`.
- Stages passed: SEED, CONTRACT, MAP, PATCH, VERIFY, RELEASE.
- R2 prompt artifact persisted at `runs/pi-operational-mpbze86c/artifacts/__observability/CONTRACT.prompt.initial.txt`.
- CONTRACT observation prompt diagnostic hash matched the R2 prompt artifact.
- CONTRACT tool telemetry: `toolCallEventCount=138`, `toolExecutionEventCount=10`, `assistantToolCallCount=5`.

## DEFECT-1: Dogfood CandidatePatch malformed on real source

Run `ff-dogfood-prompt-persist-mpbyd6wl` used real ff-pipeline source and Pi authored a conceptually correct prompt-persistence patch, but `patch_applies_cleanly` failed with a hunk context mismatch in `server.mjs`. Pi can reason over real source, but patch emission quality is not production-ready for blind application.

Required later fix: add a repair path for gate failure `patch_applies_cleanly`, feeding the exact apply error and current file context back to PATCH instead of aborting the whole harness.

Status: open.

## DEFECT-2: Container rollout transient marks run failed

Run `ff-dogfood-prompt-verify-mpbytfgq` failed CONTRACT during container version rollout. The Worker retried `container is not running` three times, but the container needed longer to stabilize after deploy. The run was marked failed even though the new container later started.

Required later fix: distinguish rollout replacement from permanent container failure; extend retry/deadline around version-mismatch restart and do not emit terminal `container_crashed` for expected rollout exits.

Status: partially mitigated by `cb667ca` clearing active execution and resetting the queue on restart. Rollout-kills-active-run behavior remains open.

## DEFECT-3: Prompt metadata can be trimmed from event ring

Run `ff-dogfood-prompt-verify-mpbyvrcs` persisted the prompt artifact, but the `prompt.rendered` event was trimmed from `events[]` because real prompts produce large tool telemetry. Fixed in commit `9f9ce15` by retaining metadata in top-level `promptDiagnostics[]`; verify after latest deploy.

Status: fixed and verified by `pi-operational-mpbze86c`.

## DEFECT-4: Status projection can lag stage dispatch order

During operational smokes, `/run-monitor` sometimes reported `currentStage` as an earlier completed stage while later stage entries were already running. This did not block execution, but it makes operator monitoring confusing.

Required later fix: update run-event projection ordering so `currentStage` is derived from the latest active stage rather than the most recent completed stage projection.

Status: open.
