/**
 * cf-workers.ts — Cloudflare Container-backed `WorkerAdapter` implementations
 * for the Function Factory harness dispatcher.
 *
 * Per ADR-002: "Workers do NOT run agents. Containers execute." Each NLAH
 * `WorkerAdapter` registered here wraps a CF Container service binding and
 * dispatches a single `POST /execute` request, hands the Container an R2
 * artifact storage handle, and collects the names of the artifacts the
 * Container produced.
 *
 * The Container is responsible for:
 *   - Executing the role's instructions against the supplied StageContext.
 *   - Writing each declared output to the working directory.
 *   - Returning a JSON body `{ artifacts: string[], artifactContents: Record<string,string>,
 *     message?: string }` — the adapter writes contents to R2 via ArtifactManager.writeText().
 *
 * Artifacts flow back in the response body so R2 bindings stay on the Worker
 * side where CF puts them. Container is stateless; Worker holds persistence.
 *
 * The adapter is intentionally thin. Failure modes:
 *   - Non-2xx Container response  → throw (dispatcher records `workerThrew`).
 *   - Missing Container binding   → throw at registry-construction time when
 *     the dispatcher resolves an unbound worker name.
 *
 * Spec: IS-HARNESS-DSL-v1 §5 (CF Container WorkerAdapter implementations) and
 * §3.1 step 4 (pre-hydrated StageContext — no filesystem reads).
 */

import {
  WorkerRegistry,
  type ArtifactManager,
  type FileReader,
  type StageContext,
  type WorkerAdapter,
  type WorkerInput,
  type WorkerOutput,
} from "@factory/nlah"
import type { ContainerBinding, HarnessBridgeEnv } from "./harness-env"
import type { OutputContract } from "./contract-compiler"

/**
 * The wire shape the Container returns from `POST /execute`.
 * `artifactContents` carries the file contents so the Worker can write them
 * to R2 via ArtifactManager.writeText() — Containers cannot use Worker bindings.
 */
interface ContainerExecuteResponse {
  artifacts: string[]
  artifactContents: Record<string, string>
  message?: string
  observation?: ContainerExecutionObservation
  error?: ContainerExecutionError
  sessionArchive?: { data: string; bytes: number }
}

interface RoutedPiModel {
  id: string
  provider: string
  model: string
  routeKind: string
  resolvedVia: string
  fallback?: {
    id: string
    provider: string
    model: string
  }
}

interface RoutedWorkerInput extends WorkerInput {
  runId?: string
  model?: RoutedPiModel
  execution?: {
    surface: "rpc" | "sdk"
    requiredCapabilities: string[]
    resolvedVia: string
  }
  outputContracts?: OutputContract[]
  maxRepairRounds?: number
}

interface ContractFinding {
  artifact: string
  status: "pass" | "fail"
  kind: "exact_line" | "json" | "markdown" | "text"
  failureCode?: string
  detail?: string
  bytes?: number
}

interface ContainerExecutionObservation {
  runId?: string
  stageName?: string
  roleName?: string
  model?: RoutedPiModel | null
  pid?: number | null
  elapsedMs?: number
  events?: Array<Record<string, unknown>>
  artifacts?: Array<Record<string, unknown>>
  stderrTail?: string
  truncated?: boolean
  contractEvaluation?: {
    finalAttempt: string
    repairsUsed: number
    maxRepairRounds: number
    findings: ContractFinding[]
    failedArtifacts: string[]
  }
}

interface ContainerExecutionError {
  code?: string
  message?: string
  stderrTail?: string
}

async function persistObservation(
  stageName: string,
  observation: ContainerExecutionObservation | undefined,
  artifacts: ArtifactManager,
): Promise<string | undefined> {
  if (!observation) return undefined
  const key = `__observability/${stageName}.container-observation.json`
  try {
    const storageKey = await artifacts.writeText(key, JSON.stringify(observation, null, 2))
    console.log(`[pi] diagnostic.written kind=observation key=${storageKey}`)
    return storageKey
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[pi] diagnostic.write_failed kind=observation logicalKey=${key} error=${message}`)
    return undefined
  }
}

async function persistContractEvaluation(
  stageName: string,
  observation: ContainerExecutionObservation | undefined,
  artifacts: ArtifactManager,
): Promise<string | undefined> {
  if (!observation?.contractEvaluation) return undefined
  const key = `__observability/${stageName}.contract-evaluation.json`
  const payload = {
    schemaVersion: "1.0",
    runId: observation.runId,
    stageName: observation.stageName,
    roleName: observation.roleName,
    model: observation.model,
    ...observation.contractEvaluation,
    outcome: observation.contractEvaluation.failedArtifacts.length === 0 ? "pass" : "fail",
  }
  try {
    const storageKey = await artifacts.writeText(key, JSON.stringify(payload, null, 2))
    console.log(`[pi] diagnostic.written kind=contract-evaluation key=${storageKey}`)
    return storageKey
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[pi] diagnostic.write_failed kind=contract-evaluation logicalKey=${key} error=${message}`)
    return undefined
  }
}

async function parseContainerResponse(response: Response): Promise<ContainerExecuteResponse | null> {
  try {
    return (await response.clone().json()) as ContainerExecuteResponse
  } catch {
    return null
  }
}

/**
 * Base class for Container-dispatching WorkerAdapters. Concrete subclasses
 * (Pi, Aider, Claude Code) differ only by which env binding they target, so
 * the dispatch logic itself lives here. The constructor accepts the binding
 * directly (rather than `env`) so test wiring can inject a fake fetcher
 * without constructing a full `HarnessBridgeEnv`.
 *
 * `endpoint` is a configuration knob — every Container exposes the same
 * `POST /execute` route per spec §5, but allowing override keeps the adapter
 * useful for Container variants (e.g. `pi-swarm`) that might run a
 * different handler path on the same binding.
 */
abstract class ContainerWorkerAdapter implements WorkerAdapter {
  abstract readonly name: string

  constructor(
    protected readonly container: ContainerBinding,
    // CF Containers require HTTP for internal connections — HTTPS not supported.
    protected readonly endpoint: string = "http://pi-worker/execute",
  ) {}

  async execute(input: WorkerInput, artifacts: ArtifactManager): Promise<WorkerOutput> {
    const t0 = Date.now()
    console.log(`[${this.name}] dispatch.start stage=${input.stageName} endpoint=${this.endpoint}`)

    // `state` is intentionally omitted — Containers do not read the
    // synthesized RuntimeState view (gates run Worker-side, not
    // Container-side). Including only what the Container consumes keeps the
    // contract tight and the payload small.
    const routedInput = input as RoutedWorkerInput
    const body = {
      ...(routedInput.runId === undefined ? {} : { runId: routedInput.runId }),
      stageName: input.stageName,
      roleName: input.roleName,
      ...(input.rolePrompt === undefined ? {} : { rolePrompt: input.rolePrompt }),
      ...(routedInput.model === undefined ? {} : { model: routedInput.model }),
      ...(routedInput.execution === undefined ? {} : { execution: routedInput.execution }),
      context: input.context,
      declaredInputs: input.declaredInputs,
      declaredOutputs: input.declaredOutputs,
      ...(routedInput.outputContracts ? { outputContracts: routedInput.outputContracts } : {}),
      ...(routedInput.maxRepairRounds !== undefined ? { maxRepairRounds: routedInput.maxRepairRounds } : {}),
    }

    let response: Response
    try {
      response = await this.container.fetch(
        new Request(this.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      )
    } catch (fetchErr) {
      const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr)
      console.error(`[${this.name}] dispatch.fetch_error stage=${input.stageName} error=${msg} elapsedMs=${Date.now() - t0}`)
      throw fetchErr
    }

    console.log(`[${this.name}] dispatch.response stage=${input.stageName} status=${response.status} elapsedMs=${Date.now() - t0}`)

    if (!response.ok) {
      // Throwing surfaces this through the dispatcher's try/catch as
      // `workerThrew` on the StageCompletePayload (see harness-dispatcher.ts).
      const parsed = await parseContainerResponse(response)
      const observationKey = await persistObservation(input.stageName, parsed?.observation, artifacts)
      const contractEvaluationKey = await persistContractEvaluation(input.stageName, parsed?.observation, artifacts)
      const text = parsed
        ? JSON.stringify({
            error: parsed.error ?? { message: "container dispatch failed" },
            ...(observationKey ? { observationKey } : {}),
            ...(contractEvaluationKey ? { contractEvaluationKey } : {}),
          })
        : await response.text().catch(() => "<unreadable body>")
      console.error(`[${this.name}] dispatch.non2xx stage=${input.stageName} status=${response.status} body=${text.slice(0, 500)}`)
      const error = parsed?.error
      const message = error?.message ?? text
      throw new Error(
        `${this.name}: container dispatch failed (${response.status}): ${message}` +
          `${observationKey ? ` observation=${observationKey}` : ""}` +
          `${contractEvaluationKey ? ` contractEvaluation=${contractEvaluationKey}` : ""}` +
          `${error?.stderrTail ? ` stderrTail=${error.stderrTail.slice(0, 1000)}` : ""}`,
      )
    }

    const parsed = (await response.json()) as ContainerExecuteResponse
    if (!parsed || !Array.isArray(parsed.artifacts)) {
      throw new Error(
        `${this.name}: container response missing artifacts[]: ${JSON.stringify(parsed)}`,
      )
    }

    console.log(`[${this.name}] dispatch.complete stage=${input.stageName} artifacts=${JSON.stringify(parsed.artifacts)} elapsedMs=${Date.now() - t0}`)

    const observationKey = await persistObservation(input.stageName, parsed.observation, artifacts)
    await persistContractEvaluation(input.stageName, parsed.observation, artifacts)

    // Write pi session archive to R2 if the container captured one.
    // Stored as base64 text — ArtifactManager.writeText is the only binary-safe
    // path without adding a binary method to the interface. Caller decodes with Buffer.from(data,'base64').
    if (parsed.sessionArchive?.data) {
      const archiveKey = `__observability/${input.stageName}.pi-session.tar.gz.b64`
      await artifacts.writeText(archiveKey, parsed.sessionArchive.data)
      console.log(`[${this.name}] session_archive.written stage=${input.stageName} bytes=${parsed.sessionArchive.bytes}`)
    }

    // Write artifact contents to R2 via ArtifactManager — bindings live on
    // the Worker side; the Container returns contents in the response body.
    const contents = parsed.artifactContents ?? {}
    for (const [name, content] of Object.entries(contents)) {
      await artifacts.writeText(name, content)
      console.log(`[${this.name}] artifact.written name=${name} bytes=${content.length}`)
    }

    return {
      createdArtifacts: parsed.artifacts,
      ...(parsed.message || observationKey
        ? { message: [parsed.message, observationKey ? `observation=${observationKey}` : undefined].filter(Boolean).join(" ") }
        : {}),
    }
  }
}

/**
 * Adapter that dispatches stage execution to the Pi container.
 *
 * Wired to `env.PI_CONTAINER` by `buildCfWorkerRegistry`. The harness YAML
 * references this adapter as `worker: pi`.
 */
export class PiContainerAdapter extends ContainerWorkerAdapter {
  readonly name = "pi"
}

/**
 * Adapter that dispatches stage execution to the Aider container.
 *
 * Wired to `env.AIDER_CONTAINER`. Referenced from the harness YAML as
 * `worker: aider`.
 */
export class AiderContainerAdapter extends ContainerWorkerAdapter {
  readonly name = "aider"
}

/**
 * Adapter that dispatches stage execution to the Claude Code container.
 *
 * Wired to `env.CLAUDE_CODE_CONTAINER`. Referenced from the harness YAML as
 * `worker: claude-code`.
 */
export class ClaudeCodeContainerAdapter extends ContainerWorkerAdapter {
  readonly name = "claude-code"
}

/**
 * Adapter for artifacts that are intentionally written before harness
 * execution starts. It proves the artifact is present in the run's R2
 * namespace and returns it as the created output for the seed stage.
 */
export class PreseedArtifactAdapter implements WorkerAdapter {
  readonly name = "preseed"

  async execute(input: WorkerInput, artifacts: ArtifactManager): Promise<WorkerOutput> {
    const createdArtifacts: string[] = []
    for (const output of input.declaredOutputs) {
      const status = await artifacts.status(output)
      if (!status.exists || (status.sizeBytes ?? 0) === 0) {
        throw new Error(`preseed artifact missing or empty: ${output}`)
      }
      createdArtifacts.push(output)
    }
    return {
      createdArtifacts,
      message: `preseeded ${createdArtifacts.join(", ")}`,
    }
  }
}

/**
 * Build the CF-side `WorkerRegistry` for the harness dispatcher.
 *
 * Only registers an adapter when its Container binding is present on the
 * env. The bindings are typed as optional on `HarnessBridgeEnv` because not
 * every deployment will have all three containers wired (e.g. dev
 * environments may have Pi only). The dispatcher's `resolveWorkerAdapter`
 * call will throw with `unknown worker: <name>` when a harness asks for an
 * unbound worker, which the dispatcher records as `workerThrew` — that's the
 * intended bound failure mode and matches IS-HARNESS-DSL-v1's
 * `MISSING_WORKER_BINDING` precondition.
 *
 * The `artifacts` parameter is accepted by the public signature to match
 * IS-HARNESS-DSL-v1 §5 and to keep the door open for adapters that want to
 * pre-bind an ArtifactManager at construction. Today's adapters receive the
 * ArtifactManager as the second argument to `execute()` (per the NLAH
 * `WorkerAdapter` interface) and so do not need it at construction; we
 * accept and ignore it rather than dropping it from the signature so callers
 * are not forced to refactor when adapters that DO bind at construction
 * (e.g. swarm adapters that need to enumerate ArtifactManager state across
 * candidates) are added.
 */
export function buildCfWorkerRegistry(
  env: HarnessBridgeEnv,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _artifacts?: ArtifactManager,
): WorkerRegistry {
  const registry = new WorkerRegistry()
  registry.register("preseed", new PreseedArtifactAdapter())
  if (env.PI_CONTAINER) {
    // CF Containers in wrangler 4 are DO-backed: PI_CONTAINER is a namespace.
    // Use a singleton DO ID so all harness stages share one warm container
    // rather than spawning a new process per stage. The DO's fetch() forwards
    // to the container's HTTP server via getTcpPort(8080).fetch().
    const piStub = env.PI_CONTAINER.get(env.PI_CONTAINER.idFromName("pi"))
    registry.register("pi", new PiContainerAdapter(piStub as unknown as ContainerBinding))
  }
  if (env.AIDER_CONTAINER) {
    registry.register("aider", new AiderContainerAdapter(env.AIDER_CONTAINER))
  }
  if (env.CLAUDE_CODE_CONTAINER) {
    registry.register(
      "claude-code",
      new ClaudeCodeContainerAdapter(env.CLAUDE_CODE_CONTAINER),
    )
  }
  return registry
}

/**
 * Build a CF-compatible `StageContext` for a stage about to be dispatched.
 *
 * Differs from NLAH's `buildStageContext` in two ways:
 *
 *   1. No filesystem reads. `taskText` is already in memory (it is round-
 *      tripped through RunCoordinator DO storage by the harness-dispatcher)
 *      and there is no role-instructions file to load — Containers consume
 *      role prompts via their own template registries, not via FS reads from
 *      the Worker.
 *
 *   2. Pre-hydrates `inputArtifacts` with the content of each declared input
 *      from R2 via the supplied ArtifactManager. This matches what
 *      NLAH's reference implementation does, but reads from R2 instead of
 *      a local FS path. The R2 reads happen in the Worker because the
 *      Container's POST body is the only handoff point — the Container does
 *      not get a second chance to ask for context.
 *
 * `outputArtifactPaths` are populated via `artifacts.resolve(name)`. For the
 * CfArtifactManager this returns the R2 key (e.g. `runs/{id}/artifacts/X`);
 * the Container uses this to know exactly where to PUT its output.
 *
 * Throws when any declared input artifact is missing from R2. Containers
 * cannot recover from a missing input — the harness contract is that prior
 * stages produced the inputs this stage declares — so failing here is the
 * right behavior. The dispatcher records this throw as `workerThrew` on the
 * StageCompletePayload, which the RunCoordinator translates into a stage
 * failure with `failureClass: "ContextError"` further upstream.
 */
export async function buildStageContextFromJob(input: {
  taskText: string
  runId: string
  stageName: string
  declaredInputs: string[]
  declaredOutputs: string[]
  artifacts: ArtifactManager
  /**
   * Optional pre-rendered role instructions. When present, surfaced on the
   * `roleText` field of the resulting StageContext (matches the upstream
   * shape). Containers that need richer per-role configuration should
   * resolve it themselves from a binding rather than threading it through
   * StageContext.
   */
  roleText?: string
  /**
   * Optional role policy (reads/writes/must_not). Surfaced verbatim on
   * `rolePolicy` per the upstream `StageContext` shape. Default omitted.
   */
  rolePolicy?: StageContext["rolePolicy"]
}): Promise<StageContext> {
  const inputArtifacts: Record<string, string> = {}
  const outputArtifactPaths: Record<string, string> = {}

  for (const artifactName of input.declaredInputs) {
    const status = await input.artifacts.status(artifactName)
    if (!status.exists || (status.sizeBytes ?? 0) === 0) {
      // Match NLAH's `ContextError` semantics from
      // /Users/wes/nlah/src/context.ts:58 — same message shape so trace
      // consumers that grep on this string keep working.
      throw new Error(`missing or empty input artifact: ${artifactName}`)
    }
    inputArtifacts[artifactName] = await input.artifacts.readText(artifactName)
  }

  for (const artifactName of input.declaredOutputs) {
    outputArtifactPaths[artifactName] = input.artifacts.resolve(artifactName)
  }

  return {
    taskText: input.taskText,
    inputArtifacts,
    outputArtifactPaths,
    ...(input.rolePolicy === undefined ? {} : { rolePolicy: input.rolePolicy }),
    ...(input.roleText === undefined ? {} : { roleText: input.roleText }),
  }
}

/**
 * No-op `FileReader` that always throws. Exported so callers that need to
 * pass a reader through to a code path that ultimately should not read from
 * the filesystem on CF can wire this in and get an explicit failure rather
 * than a silent missing-file shape. Not used by the dispatcher path itself
 * (which never calls `buildStageContext`); offered as a backstop for any
 * future code path that imports a NLAH helper expecting a reader.
 */
export const cfRejectingFileReader: FileReader = async (path: string) => {
  throw new Error(
    `cf-workers: filesystem read attempted on CF Worker substrate (path=${path})`,
  )
}
