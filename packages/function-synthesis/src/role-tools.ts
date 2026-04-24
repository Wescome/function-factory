/**
 * Tool schemas per role for the PiAgentBindingMode.
 *
 * Each tool is a typed schema that pi-agent-core can validate.
 * Execute functions are STUBS returning mock data — the interface
 * is correct; real implementations will read/write files on disk.
 *
 * JTBD: When a role agent needs to interact with the workspace,
 * I want typed tool schemas with correct names and descriptions,
 * so the beforeToolCall hook can enforce role contracts precisely.
 *
 * AC 6, 7, 15
 */

import type { ToolSchema } from "./pi-agent-mock.js"
import type { RoleName } from "./types.js"

// ─── Tool Definitions ────────────────────────────────────────────────

const readWorkGraph: ToolSchema = {
  name: "readWorkGraph",
  description: "Read the WorkGraph specification (nodes and edges).",
  inputSchema: { type: "object", properties: {} },
  async execute() {
    return { nodes: [], edges: [], id: "stub-wg" }
  },
}

const readRepoContract: ToolSchema = {
  name: "readRepoContract",
  description: "Read the repository contract (coding standards, conventions).",
  inputSchema: { type: "object", properties: {} },
  async execute() {
    return { contract: "stub-repo-contract", conventions: [] }
  },
}

const readValidationOutcomes: ToolSchema = {
  name: "readValidationOutcomes",
  description: "Read previous validation outcomes from the Tester role.",
  inputSchema: { type: "object", properties: {} },
  async execute() {
    return { outcomes: [] }
  },
}

const readPlan: ToolSchema = {
  name: "readPlan",
  description: "Read the execution plan produced by the Planner role.",
  inputSchema: { type: "object", properties: {} },
  async execute() {
    return { plan: "stub-plan", steps: [] }
  },
}

const readRepoContext: ToolSchema = {
  name: "readRepoContext",
  description: "Read relevant repository context (file tree, dependencies).",
  inputSchema: { type: "object", properties: {} },
  async execute() {
    return { files: [], dependencies: {} }
  },
}

const writeFile: ToolSchema = {
  name: "writeFile",
  description: "Write content to a file path within the output directory.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
      content: { type: "string" },
    },
    required: ["path", "content"],
  },
  async execute(input) {
    return { written: true, path: input["path"] ?? "unknown" }
  },
}

const readFile: ToolSchema = {
  name: "readFile",
  description: "Read the content of a file from the repository.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
    },
    required: ["path"],
  },
  async execute(input) {
    return { content: `stub-content-of-${String(input["path"] ?? "unknown")}` }
  },
}

const readPatches: ToolSchema = {
  name: "readPatches",
  description: "Read patch proposals produced by the Coder role.",
  inputSchema: { type: "object", properties: {} },
  async execute() {
    return { patches: [] }
  },
}

const readSpecEnvelope: ToolSchema = {
  name: "readSpecEnvelope",
  description: "Read the specification envelope (PRD + metadata).",
  inputSchema: { type: "object", properties: {} },
  async execute() {
    return { specEnvelope: "stub-spec-envelope" }
  },
}

const readCritique: ToolSchema = {
  name: "readCritique",
  description: "Read the critique produced by the Critic role.",
  inputSchema: { type: "object", properties: {} },
  async execute() {
    return { critique: "stub-critique", defects: [] }
  },
}

const runTest: ToolSchema = {
  name: "runTest",
  description: "Execute a test command and return results.",
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string" },
    },
    required: ["command"],
  },
  async execute(input) {
    return { passed: true, command: input["command"] ?? "unknown", output: "All tests passed" }
  },
}

const readToolResults: ToolSchema = {
  name: "readToolResults",
  description: "Read previous tool execution results.",
  inputSchema: { type: "object", properties: {} },
  async execute() {
    return { results: [] }
  },
}

const readAll: ToolSchema = {
  name: "readAll",
  description: "Read all artifacts produced during synthesis (plan, patches, critique, validation outcomes).",
  inputSchema: { type: "object", properties: {} },
  async execute() {
    return { plan: null, patches: [], critique: null, validationOutcomes: [] }
  },
}

const writeDecision: ToolSchema = {
  name: "writeDecision",
  description: "Write the verifier decision (pass/patch/resample/interrupt/fail).",
  inputSchema: {
    type: "object",
    properties: {
      decision: { type: "string", enum: ["pass", "patch", "resample", "interrupt", "fail"] },
      rationale: { type: "string" },
    },
    required: ["decision", "rationale"],
  },
  async execute(input) {
    return { recorded: true, decision: input["decision"] ?? "unknown" }
  },
}

// ─── Role → Tool mapping ─────────────────────────────────────────────

const ROLE_TOOLS: Record<RoleName, readonly ToolSchema[]> = {
  Planner: [readWorkGraph, readRepoContract, readValidationOutcomes],
  Coder: [readPlan, readWorkGraph, readRepoContext, writeFile, readFile],
  Critic: [readPlan, readPatches, readWorkGraph, readSpecEnvelope, readRepoContract],
  Tester: [readPlan, readPatches, readCritique, readWorkGraph, runTest, readToolResults],
  Verifier: [readAll, writeDecision],
}

/**
 * Get the allowed tool schemas for a given role.
 */
export function getToolsForRole(role: RoleName): readonly ToolSchema[] {
  return ROLE_TOOLS[role]
}

/**
 * Get the set of allowed tool names for a given role.
 */
export function getAllowedToolNames(role: RoleName): ReadonlySet<string> {
  return new Set(ROLE_TOOLS[role].map((t) => t.name))
}

/**
 * All tool schemas (for reference/testing).
 */
export const ALL_TOOLS: Record<string, ToolSchema> = {
  readWorkGraph,
  readRepoContract,
  readValidationOutcomes,
  readPlan,
  readRepoContext,
  writeFile,
  readFile,
  readPatches,
  readSpecEnvelope,
  readCritique,
  runTest,
  readToolResults,
  readAll,
  writeDecision,
}
