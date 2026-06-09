> **ARCHIVED — 2026-05-16**
> **Status:** Reference only. Standalone Python runtime proposal superseded by Trellis
> absorption. The NLAH control-plane concept was explicitly absorbed into Trellis
> (see `project_trellis_naming.md`; memory: "FF absorbed NLAH → Trellis. NLAH repo subsumed.").
>
> **Architect review verdict (2026-05-16):** RETRACT as standalone implementation spec.
> Three real deltas extracted and absorbed into the Trellis substrate:
> 1. Harness YAML DSL → `IS-HARNESS-DSL-v1` + `packages/schemas/src/harness.ts`
> 2. Named failure taxonomy per harness → `FF-REFACTORING-PLAN.md §145` gap closure
> 3. Deterministic-runtime-first discipline → process rule in `LESSONS.md`
>
> **Do not implement as a standalone Python repo.** No new runtime. No second compute
> substrate. Cloudflare-only constraint holds. ADR-004 honored.
> See `specs/intent-specifications/IS-HARNESS-DSL-v1.md` for the ratified work.

---

# NLAH Coding Swarm Runtime — Implementation Specification

## 1. Mission

Build `Wescome/NLAH` as a Python package that implements a **Natural-Language Agent Harness runtime** for multi-agent coding swarms.

The system must externalize harness control logic as executable artifacts instead of burying it in controller code. The NLAH paper defines this exact problem: harness behavior is often scattered across controller code, framework defaults, tool adapters, verifier scripts, and runtime assumptions; NLAH makes contracts, roles, stages, adapters, state semantics, and failure taxonomies explicit.

The repo must implement:

```text
NLAH DSL
→ typed semantic model
→ harness compiler
→ executable WorkGraph
→ artifact-gated runtime
→ trace ledger
→ coding-swarm role execution
```

## 2. Repository Structure

Create this exact structure:

```text
NLAH/
├── README.md
├── pyproject.toml
├── LICENSE
├── .gitignore
├── nlah/
│   ├── __init__.py
│   ├── schema.py
│   ├── compiler.py
│   ├── runtime.py
│   ├── gates.py
│   ├── artifacts.py
│   ├── trace.py
│   ├── adapters.py
│   ├── cli.py
│   ├── harnesses/
│   │   └── coding_swarm.mvp.yaml
│   └── roles/
│       ├── cartographer.md
│       ├── patch_worker.md
│       ├── verifier.md
│       └── release_agent.md
├── docs/
│   ├── architecture.md
│   ├── dsl.md
│   └── coding_swarm.md
└── tests/
    ├── test_schema.py
    ├── test_compiler.py
    ├── test_gates.py
    ├── test_artifacts.py
    └── test_trace.py
```

## 3. Core Design Principle

Do **not** build a chat loop first.

Build the control substrate first:

```text
harness parsing
→ validation
→ stage transition execution
→ artifact enforcement
→ gate evaluation
→ trace emission
```

A stage cannot complete because an agent "said" it completed. It completes only when declared artifacts exist and declared gates pass.

The NLAH paper's canonical workspace model uses durable, path-addressable files such as `TASK.md`, `state/task_history.jsonl`, child workspaces, and final artifacts as runtime state carriers.

## 4. Runtime Semantics

### 4.1 State Model

```python
RuntimeState = {
    "run_id": str,
    "current_state": str,
    "task_path": Path,
    "repo_path": Path,
    "harness_path": Path,
    "state_root": Path,
    "artifact_root": Path,
    "stage_history": list[TraceEvent],
    "artifacts": dict[str, ArtifactStatus],
    "last_error": Optional[str],
}
```

### 4.2 Category-Theoretic Mapping

Implement implicitly through code structure:

```text
Objects = runtime states
Morphisms = stages
Composition = valid stage sequencing
Identity = no-op / hold state
Trace = functor from execution to task_history.jsonl
```

A stage has:

```text
from_state
to_state
role
inputs
outputs
gate
failure behavior
```

## 5. `schema.py`

Implement typed models using `pydantic`.

Required models:

```python
class HarnessSpec(BaseModel):
    nlahspec: str
    harness: HarnessMetadata
    runtime: RuntimeConfig
    roles: dict[str, RoleSpec]
    artifacts: dict[str, ArtifactSpec]
    stages: dict[str, StageSpec]
    failure_taxonomy: dict[str, str] = {}
```

```python
class HarnessMetadata(BaseModel):
    name: str
    task_family: str
    objective: str
```

```python
class RuntimeConfig(BaseModel):
    max_patch_workers: int = 1
    max_repair_rounds: int = 0
    state_root: str
    artifact_root: str
```

```python
class RoleSpec(BaseModel):
    responsibility: str
```

```python
class ArtifactSpec(BaseModel):
    path: str
    required: bool = True
```

```python
class StageSpec(BaseModel):
    from_: str = Field(alias="from")
    to: str
    role: str
    outputs: list[str] = []
    inputs: list[str] = []
    gate: GateSpec | None = None
```

```python
class GateSpec(BaseModel):
    all: list[Any] = []
    any: list[Any] = []
```

Validation rules:

```text
1. Every stage role must exist in roles.
2. Every output artifact must exist in artifacts.
3. Every input artifact must exist in artifacts.
4. Every artifact path must be relative, not absolute.
5. Runtime state_root and artifact_root must be relative paths.
6. Harness version must equal "0.1" for MVP.
7. Stage graph must have at least one start state.
8. Stage graph must not contain unreachable stages.
```

## 6. `compiler.py`

Purpose:

```text
Parse YAML
Validate schema
Build executable stage graph
Return compiled harness object
```

Implement:

```python
def load_harness(path: Path) -> HarnessSpec:
    ...
```

```python
def compile_harness(spec: HarnessSpec) -> CompiledHarness:
    ...
```

```python
class CompiledHarness(BaseModel):
    spec: HarnessSpec
    stages_by_from_state: dict[str, list[StageSpec]]
    stage_order: list[str]
```

MVP graph behavior:

```text
Linear execution is acceptable for v0.
Branching support can exist in schema but does not need full execution yet.
```

Required compiler checks:

```text
MAP.from = TaskReceived
RELEASE.to = PullRequestReady
No stage may reference a missing role
No stage may emit a missing artifact
No duplicate stage names
No impossible transition chain
```

## 7. `artifacts.py`

Purpose:

```text
Create, read, validate, and resolve declared artifacts.
```

Implement:

```python
class ArtifactManager:
    def __init__(self, run_root: Path, spec: HarnessSpec): ...

    def resolve(self, artifact_name: str) -> Path: ...

    def exists(self, artifact_name: str) -> bool: ...

    def read_text(self, artifact_name: str) -> str: ...

    def write_text(self, artifact_name: str, content: str) -> Path: ...

    def status(self, artifact_name: str) -> ArtifactStatus: ...
```

```python
class ArtifactStatus(BaseModel):
    name: str
    path: str
    exists: bool
    size_bytes: int | None = None
```

MVP required artifact files:

```text
issue_contract.md
repo_map.md
candidate.patch
verifier_report.md
final.patch
pr_summary.md
```

## 8. `gates.py`

Purpose:

```text
Evaluate whether a stage may transition.
```

Implement gate registry:

```python
GateFn = Callable[[RuntimeState, ArtifactManager, Any], GateResult]
```

```python
class GateResult(BaseModel):
    passed: bool
    gate: str
    message: str = ""
```

Required gates:

```python
exists
patch_applies_cleanly
repo_map_names_relevant_files
repo_map_names_test_entrypoints
verifier_accepts_patch
test_results_support_claims
final_patch_matches_verified_candidate
```

MVP gate behavior:

```text
exists:
  Passes if artifact path exists and size > 0.

patch_applies_cleanly:
  Run `git apply --check <patch>` inside target repo.

repo_map_names_relevant_files:
  Passes if repo_map.md contains a "Relevant files" heading and at least one path-like line.

repo_map_names_test_entrypoints:
  Passes if repo_map.md contains "Relevant tests" or "Test entrypoints".

verifier_accepts_patch:
  Passes if verifier_report.md contains "Verdict: PASS".

test_results_support_claims:
  Passes if verifier_report.md contains "Tests run".

final_patch_matches_verified_candidate:
  Passes if final.patch content equals candidate.patch content for MVP.
```

## 9. `trace.py`

Purpose:

```text
Append runtime events to JSONL.
```

Implement:

```python
class TraceEvent(BaseModel):
    timestamp: str
    run_id: str
    event: str
    stage: str | None = None
    from_state: str | None = None
    to_state: str | None = None
    artifact: str | None = None
    gate: str | None = None
    passed: bool | None = None
    message: str | None = None
```

```python
class TraceLogger:
    def __init__(self, ledger_path: Path, run_id: str): ...

    def emit(self, event: str, **kwargs) -> None: ...
```

Required emitted events:

```text
run_started
stage_started
artifact_created
gate_passed
gate_failed
state_transition
stage_completed
run_completed
run_failed
```

Ledger path:

```text
runs/<run_id>/state/task_history.jsonl
```

## 10. `runtime.py`

Purpose:

```text
Execute compiled harness stages.
```

Implement CLI-compatible runtime:

```python
def run_harness(
    harness_path: Path,
    repo_path: Path,
    task_path: Path,
    run_id: str | None = None,
) -> RuntimeResult:
    ...
```

Execution loop:

```text
1. Load harness.
2. Compile harness.
3. Create run directory.
4. Copy TASK.md into run root.
5. Initialize ArtifactManager.
6. Initialize TraceLogger.
7. Set state = TaskReceived.
8. While not terminal:
   a. Find enabled stage by current state.
   b. Emit stage_started.
   c. Execute role adapter for stage.
   d. Check declared output artifacts.
   e. Evaluate gates.
   f. If gates pass: transition state.
   g. If gates fail: stop as failed for MVP.
9. Emit run_completed or run_failed.
```

Terminal states:

```text
PullRequestReady
Failed
Incomplete
```

MVP role execution may be deterministic stubs:

```text
Cartographer writes repo_map.md
PatchWorker writes candidate.patch
Verifier writes verifier_report.md
ReleaseAgent writes final.patch and pr_summary.md
```

Do not integrate real LLM agents in v0. The goal is runtime correctness.

## 11. `adapters.py`

Purpose:

```text
Encapsulate deterministic actions.
```

Implement:

```python
class ShellAdapter:
    def run(
        self,
        command: list[str],
        cwd: Path,
        timeout_seconds: int = 120,
    ) -> AdapterResult:
        ...
```

```python
class AdapterResult(BaseModel):
    ok: bool
    returncode: int
    stdout: str
    stderr: str
```

Security requirements:

```text
1. No shell=True.
2. Commands must be list[str].
3. Working directory must be inside provided repo path or run path.
4. Timeouts required.
```

## 12. `cli.py`

Expose:

```bash
nlah run \
  --harness nlah/harnesses/coding_swarm.mvp.yaml \
  --repo ./target_repo \
  --task ./TASK.md
```

Also support:

```bash
python -m nlah.cli run ...
```

CLI output:

```text
Run ID: <id>
Status: PASS | FAIL | INCOMPLETE
State: PullRequestReady
Artifacts:
  - final.patch
  - verifier_report.md
  - pr_summary.md
Trace:
  runs/<run_id>/state/task_history.jsonl
```

## 13. MVP Harness File

Create:

```text
nlah/harnesses/coding_swarm.mvp.yaml
```

Content:

```yaml
nlahspec: "0.1"

harness:
  name: CODING_SWARM_MVP
  task_family: repository_issue_resolution
  objective: >
    Resolve a repository-grounded issue by producing a patch,
    independent verification, and a PR-ready summary.

runtime:
  max_patch_workers: 2
  max_repair_rounds: 1
  state_root: runs/current/state
  artifact_root: runs/current/artifacts

roles:
  Cartographer:
    responsibility: >
      Map relevant files, tests, dependencies, and likely blast radius.
      Must not edit files.

  PatchWorker:
    responsibility: >
      Produce one candidate patch from the issue contract and repo map.

  Verifier:
    responsibility: >
      Independently check the patch against the original issue,
      tests, and acceptance contract. Must not repair the patch.

  ReleaseAgent:
    responsibility: >
      Produce final.patch, evidence, and a PR-ready summary.

artifacts:
  IssueContract:
    path: artifacts/issue_contract.md
    required: true

  RepoMap:
    path: artifacts/repo_map.md
    required: true

  CandidatePatch:
    path: artifacts/candidate.patch
    required: true

  VerifierReport:
    path: artifacts/verifier_report.md
    required: true

  FinalPatch:
    path: artifacts/final.patch
    required: true

  PRSummary:
    path: artifacts/pr_summary.md
    required: true

stages:
  CONTRACT:
    from: TaskReceived
    to: IssueContracted
    role: Cartographer
    outputs: [IssueContract]
    gate:
      all:
        - exists: IssueContract

  MAP:
    from: IssueContracted
    to: RepoMapped
    role: Cartographer
    outputs: [RepoMap]
    gate:
      all:
        - exists: RepoMap
        - repo_map_names_relevant_files
        - repo_map_names_test_entrypoints

  PATCH:
    from: RepoMapped
    to: PatchCandidate
    role: PatchWorker
    outputs: [CandidatePatch]
    gate:
      all:
        - exists: CandidatePatch
        - patch_applies_cleanly: CandidatePatch

  VERIFY:
    from: PatchCandidate
    to: VerifiedPatch
    role: Verifier
    outputs: [VerifierReport]
    gate:
      all:
        - exists: VerifierReport
        - verifier_accepts_patch
        - test_results_support_claims

  RELEASE:
    from: VerifiedPatch
    to: PullRequestReady
    role: ReleaseAgent
    outputs: [FinalPatch, PRSummary]
    gate:
      all:
        - exists: FinalPatch
        - exists: PRSummary
        - final_patch_matches_verified_candidate

failure_taxonomy:
  missing_artifact: retry_stage
  patch_does_not_apply: return_to_PATCH
  verifier_rejects: return_to_PATCH
  budget_exceeded: release_incomplete
```

## 14. Role Files

### `roles/cartographer.md`

```text
Role: Cartographer

Responsibility:
Map the repository surface relevant to the task.

Must produce:
- issue_contract.md
- repo_map.md

Must not:
- edit source files
- produce patches
- claim verification

Required repo_map.md sections:
1. Problem summary
2. Relevant files
3. Relevant tests
4. Suspected root cause
5. Blast-radius risks
```

### `roles/patch_worker.md`

```text
Role: PatchWorker

Responsibility:
Produce a candidate patch that addresses the issue contract.

Must produce:
- candidate.patch

Must:
- base changes on repo_map.md
- keep patch minimal
- preserve existing style
- avoid unrelated refactors
```

### `roles/verifier.md`

```text
Role: Verifier

Responsibility:
Independently evaluate candidate.patch.

Must produce:
- verifier_report.md

Required verdict:
Verdict: PASS
Verdict: FAIL
Verdict: INCONCLUSIVE

Must not:
- edit source files
- repair patch
- silently ignore failed checks
```

### `roles/release_agent.md`

```text
Role: ReleaseAgent

Responsibility:
Prepare final release artifacts.

Must produce:
- final.patch
- pr_summary.md

Required pr_summary.md sections:
1. Summary
2. Files changed
3. Tests run
4. Verification evidence
5. Residual risk
```

## 15–19. Tests, Definition of Done, Prohibited Shortcuts, First Commit, Implementation Order

[Full test suite: test_schema.py, test_compiler.py, test_gates.py, test_artifacts.py, test_trace.py]

Definition of Done: `nlah run` produces PASS with all 6 artifacts present and all gates passed.

Prohibited shortcuts:
1. No hardcoded stage names in runtime.py
2. No stages completing without artifacts
3. No natural-language role output treated as proof
4. No skipped trace logging
5. No absolute artifact paths
6. No shell=True
7. No LLM integration before deterministic runtime works
8. No harness logic buried in Python conditionals

## 20. Architectural North Star

This repo is not just a coding-agent wrapper.

It is a **language workbench for executable agent organizations**.

For NLAH:

```text
Strategy = task objective
Structure = roles
Processes = stages
Rewards = gates/verdicts
People = agent role capabilities
```

The implementation must preserve that alignment (Galbraith's Star Model).
