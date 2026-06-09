/**
 * cf-gates.ts — Cloudflare/R2-compatible gate overrides.
 *
 * NLAH's default gate registry is filesystem-friendly. Most gates already
 * work with CfArtifactManager because they call `readText`; `patch_applies_cleanly`
 * is the exception because upstream shells out to `git apply --check` against
 * local paths. In the Worker dispatcher path we only have R2 objects, so this
 * module overrides that gate with a conservative unified-diff syntax check.
 */

import { gateRegistry as defaultGateRegistry, type GateFn } from "@factory/nlah"
import { validatePatchAgainstSeedWorkspace } from "./coding-adapter-workspace"

export function buildCfGateRegistry(base: Record<string, GateFn>): Record<string, GateFn> {
  return {
    ...base,
    patch_applies_cleanly: cfPatchAppliesCleanly,
    ...cfGateEntries,
  }
}

export function installCfGateRegistryForCompile(
  registry: Record<string, GateFn> = defaultGateRegistry,
): void {
  for (const [name, gate] of Object.entries(cfGateEntries)) {
    if (!registry[name]) registry[name] = gate
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

export const cfJsonFieldEquals: GateFn = async (state, artifacts, args) => {
  const parsedArgs = parseJsonFieldGateArgs(args, "json_field_equals")
  const json = await readJsonArtifact(artifacts, parsedArgs.artifact, "json_field_equals")
  const actual = json[parsedArgs.field]
  const expected = resolveExpectedValue(state, parsedArgs)
  const passed = actual === expected

  return passed
    ? {
        gate: "json_field_equals",
        passed: true,
        message: `${parsedArgs.artifact}.${parsedArgs.field} equals ${formatJsonValue(expected)}`,
      }
    : {
        gate: "json_field_equals",
        passed: false,
        failureClass: "gate_abort",
        message:
          `${parsedArgs.artifact}.${parsedArgs.field} expected ${formatJsonValue(expected)} ` +
          `but found ${formatJsonValue(actual)}`,
      }
}

export const cfJsonFieldType: GateFn = async (_state, artifacts, args) => {
  const parsedArgs = parseJsonFieldGateArgs(args, "json_field_type")
  const expectedType = parseExpectedJsonType(parsedArgs.type)
  const json = await readJsonArtifact(artifacts, parsedArgs.artifact, "json_field_type")
  const actual = json[parsedArgs.field]
  const passed = jsonValueMatchesType(actual, expectedType)

  return passed
    ? {
        gate: "json_field_type",
        passed: true,
        message: `${parsedArgs.artifact}.${parsedArgs.field} is ${expectedType}`,
      }
    : {
        gate: "json_field_type",
        passed: false,
        failureClass: "gate_abort",
        message:
          `${parsedArgs.artifact}.${parsedArgs.field} expected type ${expectedType} ` +
          `but found ${jsonValueType(actual)}`,
      }
}

const cfGateEntries: Record<string, GateFn> = {
  json_field_equals: cfJsonFieldEquals,
  json_field_type: cfJsonFieldType,
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

type JsonFieldGateArgs = {
  artifact: string
  field: string
  type?: unknown
  value?: unknown
  valueFrom?: unknown
}

type JsonObject = Record<string, unknown>

function parseJsonFieldGateArgs(args: unknown, gateName: string): JsonFieldGateArgs {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new Error(`${gateName} gate requires object args`)
  }
  const candidate = args as Record<string, unknown>
  if (typeof candidate.artifact !== "string" || candidate.artifact.length === 0) {
    throw new Error(`${gateName} gate requires args.artifact`)
  }
  if (typeof candidate.field !== "string" || candidate.field.length === 0) {
    throw new Error(`${gateName} gate requires args.field`)
  }
  return {
    artifact: candidate.artifact,
    field: candidate.field,
    ...(Object.prototype.hasOwnProperty.call(candidate, "type") ? { type: candidate.type } : {}),
    ...(Object.prototype.hasOwnProperty.call(candidate, "value") ? { value: candidate.value } : {}),
    ...(Object.prototype.hasOwnProperty.call(candidate, "valueFrom") ? { valueFrom: candidate.valueFrom } : {}),
  }
}

async function readJsonArtifact(
  artifacts: Parameters<GateFn>[1],
  artifactName: string,
  gateName: string,
): Promise<JsonObject> {
  const raw = await artifacts.readText(artifactName)
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${gateName} gate could not parse ${artifactName} as JSON: ${message}`)
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${gateName} gate requires ${artifactName} to contain a JSON object`)
  }
  return parsed as JsonObject
}

function resolveExpectedValue(state: Parameters<GateFn>[0], args: JsonFieldGateArgs): unknown {
  if (args.valueFrom !== undefined) {
    if (args.valueFrom === "runId") return (state as { runId?: unknown }).runId
    if (args.valueFrom === "currentState") return (state as { currentState?: unknown }).currentState
    throw new Error(`json_field_equals gate unsupported valueFrom: ${String(args.valueFrom)}`)
  }
  if (Object.prototype.hasOwnProperty.call(args, "value")) return args.value
  throw new Error("json_field_equals gate requires args.value or args.valueFrom")
}

function parseExpectedJsonType(value: unknown): "string" | "number" | "boolean" | "object" | "array" | "null" {
  if (
    value === "string" ||
    value === "number" ||
    value === "boolean" ||
    value === "object" ||
    value === "array" ||
    value === "null"
  ) {
    return value
  }
  throw new Error("json_field_type gate requires args.type to be string, number, boolean, object, array, or null")
}

function jsonValueMatchesType(value: unknown, expectedType: ReturnType<typeof parseExpectedJsonType>): boolean {
  if (expectedType === "array") return Array.isArray(value)
  if (expectedType === "null") return value === null
  if (expectedType === "object") return Boolean(value && typeof value === "object" && !Array.isArray(value))
  return typeof value === expectedType
}

function jsonValueType(value: unknown): string {
  if (Array.isArray(value)) return "array"
  if (value === null) return "null"
  return typeof value
}

function formatJsonValue(value: unknown): string {
  return JSON.stringify(value)
}
