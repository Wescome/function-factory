/**
 * cf-gates.ts — Cloudflare/R2-compatible gate overrides.
 *
 * NLAH's default gate registry is filesystem-friendly. Most gates already
 * work with CfArtifactManager because they call `readText`; `patch_applies_cleanly`
 * is the exception because upstream shells out to `git apply --check` against
 * local paths. In the Worker dispatcher path we only have R2 objects, so this
 * module overrides that gate with a conservative unified-diff syntax check.
 */

import type { GateFn } from "@factory/nlah"
import { validatePatchAgainstSeedWorkspace } from "./coding-adapter-workspace"

export function buildCfGateRegistry(base: Record<string, GateFn>): Record<string, GateFn> {
  return {
    ...base,
    patch_applies_cleanly: cfPatchAppliesCleanly,
  }
}

export const cfPatchAppliesCleanly: GateFn = async (_state, artifacts, args) => {
  const artifactName = typeof args === "string" ? args : "CandidatePatch"
  const content = await artifacts.readText(artifactName)
  const seedWorkspace = await readOptionalSeedWorkspace(artifacts)
  const result = seedWorkspace
    ? validatePatchAgainstSeedWorkspace(seedWorkspace, content)
    : validateUnifiedDiff(content)
  return result.passed
    ? {
        gate: "patch_applies_cleanly",
        passed: true,
        message: seedWorkspace
          ? `${artifactName} applies to SeedWorkspace`
          : `${artifactName} is a syntactically valid unified diff`,
      }
    : { gate: "patch_applies_cleanly", passed: false, message: result.message }
}

async function readOptionalSeedWorkspace(artifacts: Parameters<GateFn>[1]): Promise<string | null> {
  try {
    const status = await artifacts.status("SeedWorkspace")
    if (!status.exists || (status.sizeBytes ?? 0) === 0) return null
    return await artifacts.readText("SeedWorkspace")
  } catch {
    return null
  }
}

export function validateUnifiedDiff(content: string): { passed: true } | { passed: false; message: string } {
  const lines = content.split(/\r?\n/)
  if (!lines.some((line) => /^diff --git a\/\S+ b\/\S+/.test(line))) {
    return { passed: false, message: "patch missing diff --git header" }
  }
  if (!lines.some((line) => /^--- (a\/\S+|\/dev\/null)$/.test(line))) {
    return { passed: false, message: "patch missing old-file marker" }
  }
  if (!lines.some((line) => /^\+\+\+ (b\/\S+|\/dev\/null)$/.test(line))) {
    return { passed: false, message: "patch missing new-file marker" }
  }
  if (!lines.some((line) => /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/.test(line))) {
    return { passed: false, message: "patch missing unified hunk header" }
  }
  if (!lines.some((line) => /^\+(?!\+\+)/.test(line) || /^-(?!--)/.test(line))) {
    return { passed: false, message: "patch missing changed hunk lines" }
  }
  return { passed: true }
}
