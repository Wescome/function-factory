/**
 * cf-artifact-manager.ts — Cloudflare R2-backed `ArtifactManager` implementation.
 *
 * NLAH's reference implementation (`FsArtifactManager` in
 * /Users/wes/nlah/src/artifacts.ts) reads and writes artifacts on a local
 * filesystem rooted at a per-run directory. CF Workers have no filesystem, so
 * the dispatcher path needs an R2-backed equivalent that:
 *
 *   1. Stores every artifact under a per-run key prefix in `WORKSPACE_BUCKET`.
 *   2. Resolves a logical artifact `name` to its full R2 key by concatenating
 *      the prefix and the name. The dispatcher hands us the prefix
 *      (`runs/{runId}/artifacts/`) at construction time.
 *   3. Implements the full `ArtifactManager` surface so it can be swapped
 *      in wherever `FsArtifactManager` is used, including the gate registry
 *      (gates pass an `ArtifactManager` through to `validateContract`).
 *
 * Field shapes match the upstream types EXACTLY:
 *   - `ArtifactStatus`         → `{ name, path, exists, sizeBytes? }`
 *   - `ArtifactContractResult` → `{ passed, message }`
 *
 * `path` in `ArtifactStatus` is the fully-qualified R2 key (mirrors how
 * `FsArtifactManager` reports an absolute filesystem path). This keeps the
 * status record comparable across substrates: gates and traces can log
 * `status.path` without caring whether storage is FS or R2.
 *
 * Specification: IS-HARNESS-DSL-v1 §4 (Artifact substrate); ADR-009 §4 Phase 3.
 */

import type {
  ArtifactManager,
  ArtifactStatus,
  ArtifactContractResult,
  ArtifactStorageHandle,
} from "@factory/nlah"

export class CfArtifactManager implements ArtifactManager {
  constructor(
    private readonly bucket: R2Bucket,
    /**
     * Per-run key prefix. The dispatcher constructs this as
     * `runs/{runId}/artifacts/` so every run's artifacts are namespaced
     * and listable as a unit. The trailing slash is required for
     * `bucket.list({ prefix })` to return only this run's objects.
     */
    private readonly prefix: string,
    /**
     * Binding name for `getStorageHandle()`. Defaults to `WORKSPACE_BUCKET`
     * because that is the binding the harness path uses; held as a
     * parameter so test wiring can supply a different name without forcing
     * the production binding shape.
     */
    private readonly bucketBinding: string = "WORKSPACE_BUCKET",
  ) {}

  getStorageHandle(): ArtifactStorageHandle {
    return {
      kind: "r2",
      bucketBinding: this.bucketBinding,
      prefix: this.prefix,
    }
  }

  resolve(name: string): string {
    return `${this.prefix}${name}`
  }

  async exists(name: string): Promise<boolean> {
    // `head` returns null when the object is absent. We DO NOT treat
    // zero-byte objects as non-existent here (unlike FsArtifactManager,
    // which gates on `size > 0`) because R2 callers may legitimately store
    // a zero-byte placeholder. Emptiness is enforced by `validateContract`.
    const obj = await this.bucket.head(this.resolve(name))
    return obj !== null
  }

  async readText(name: string): Promise<string> {
    const key = this.resolve(name)
    const obj = await this.bucket.get(key)
    if (!obj) {
      throw new Error(`artifact not found: ${name} (${key})`)
    }
    return obj.text()
  }

  async writeText(name: string, content: string): Promise<string> {
    const key = this.resolve(name)
    await this.bucket.put(key, content, {
      httpMetadata: { contentType: "text/plain; charset=utf-8" },
    })
    return key
  }

  async status(name: string): Promise<ArtifactStatus> {
    const key = this.resolve(name)
    const obj = await this.bucket.head(key)
    if (!obj) {
      return { name, path: key, exists: false }
    }
    return { name, path: key, exists: true, sizeBytes: obj.size }
  }

  async validateContract(name: string): Promise<ArtifactContractResult> {
    // Substrate-level contract: artifact must exist and be non-empty. The
    // richer per-artifact contracts (`markdown.required_sections`,
    // `json.required_fields`, etc.) require access to a `HarnessSpec` which
    // the CF dispatcher does not thread through. Those checks are evaluated
    // by gate functions (which receive the spec via state) rather than by
    // the artifact manager itself.
    const s = await this.status(name)
    if (!s.exists) {
      return { passed: false, message: `${name} not found at ${s.path}` }
    }
    if ((s.sizeBytes ?? 0) === 0) {
      return { passed: false, message: `${name} is empty (${s.path})` }
    }
    return { passed: true, message: `${name} present (${s.sizeBytes} bytes)` }
  }

  async allStatuses(): Promise<Record<string, ArtifactStatus>> {
    // Single `list` call. R2 `list` paginates at 1000 keys per request; the
    // harness path produces well under that per run (artifact counts are
    // bounded by the harness spec). If a run ever exceeds 1000 artifacts
    // the cursor pagination would need to be honored here — left as a
    // future change rather than speculative complexity now.
    const listed = await this.bucket.list({ prefix: this.prefix })
    const result: Record<string, ArtifactStatus> = {}
    for (const obj of listed.objects) {
      const name = obj.key.slice(this.prefix.length)
      result[name] = {
        name,
        path: obj.key,
        exists: true,
        sizeBytes: obj.size,
      }
    }
    return result
  }
}
