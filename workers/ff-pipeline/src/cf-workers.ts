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
 *   - Reading any declared input artifacts directly from R2 (using
 *     `artifactPrefix` + `r2Bucket`).
 *   - Executing the role's instructions against the supplied StageContext.
 *   - Writing each declared output back to R2 under the same prefix.
 *   - Returning a JSON body `{ artifacts: string[], message?: string }` listing
 *     the artifact names it created.
 *
 * The adapter is intentionally thin. Failure modes:
 *   - Non-2xx Container response  → throw (dispatcher records `workerThrew`).
 *   - Wrong storage handle kind   → throw (Container path requires R2).
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

/**
 * The wire shape the Container is expected to return from `POST /execute`.
 * Kept as a discrete type so the parsing site can validate the shape rather
 * than blindly casting `response.json()` to `WorkerOutput`.
 */
interface ContainerExecuteResponse {
  artifacts: string[]
  message?: string
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
    protected readonly endpoint: string = "https://pi-worker/execute",
  ) {}

  async execute(input: WorkerInput, artifacts: ArtifactManager): Promise<WorkerOutput> {
    // F9 in the spec: read the storage handle via the ArtifactManager
    // interface, never via a cast. CF Containers can only address R2 from
    // inside the runtime, so any non-r2 handle is a wiring bug — fail loudly.
    const handle = artifacts.getStorageHandle()
    if (handle.kind !== "r2") {
      throw new Error(
        `${this.name}: container adapter requires r2 storage handle, got ${handle.kind}`,
      )
    }

    // The Container expects everything it needs to act on the stage in the
    // POST body. `state` is intentionally omitted — Containers do not read
    // the synthesized RuntimeState view (gates run Worker-side, not
    // Container-side). Including only what the Container consumes keeps the
    // contract tight and the payload small.
    const body = {
      stageName: input.stageName,
      roleName: input.roleName,
      ...(input.rolePrompt === undefined ? {} : { rolePrompt: input.rolePrompt }),
      context: input.context,
      declaredInputs: input.declaredInputs,
      declaredOutputs: input.declaredOutputs,
      artifactPrefix: handle.prefix,
      r2Bucket: handle.bucketBinding,
    }

    const response = await this.container.fetch(
      new Request(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    )

    if (!response.ok) {
      // Throwing surfaces this through the dispatcher's try/catch as
      // `workerThrew` on the StageCompletePayload (see harness-dispatcher.ts).
      // We pull the body into the error message so a 4xx misconfiguration
      // is debuggable from the queue-retry-exhausted signal.
      const text = await response.text().catch(() => "<unreadable body>")
      throw new Error(
        `${this.name}: container dispatch failed (${response.status}): ${text}`,
      )
    }

    const parsed = (await response.json()) as ContainerExecuteResponse
    if (!parsed || !Array.isArray(parsed.artifacts)) {
      throw new Error(
        `${this.name}: container response missing artifacts[]: ${JSON.stringify(parsed)}`,
      )
    }

    return {
      createdArtifacts: parsed.artifacts,
      ...(parsed.message ? { message: parsed.message } : {}),
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
  if (env.PI_CONTAINER) {
    registry.register("pi", new PiContainerAdapter(env.PI_CONTAINER))
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
