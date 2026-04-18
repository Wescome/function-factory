/**
 * Pre-tool-call hook.
 *
 * Runs BEFORE every tool invocation by the conductor. Loads the matching
 * schema from .agent/protocols/tool_schemas/, validates the call,
 * enforces blocked_targets and blocked_patterns, and returns a decision:
 *   - { allowed: true }
 *   - { allowed: false, reason }
 *   - { allowed: "approval_needed", reason }
 *
 * Exports a single default function. The conductor imports and awaits it
 * before every tool call.
 */

import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"

const SCHEMAS_DIR = ".agent/protocols/tool_schemas"
const PERMISSIONS_PATH = ".agent/protocols/permissions.md"

type Decision =
  | { allowed: true }
  | { allowed: false; reason: string }
  | { allowed: "approval_needed"; reason: string }

export interface ToolCall {
  tool: string
  operation: string
  args: Record<string, unknown>
}

export default async function preToolCall(call: ToolCall): Promise<Decision> {
  const schemaPath = join(SCHEMAS_DIR, `${call.tool}.schema.json`)
  if (!existsSync(schemaPath)) {
    return { allowed: false, reason: `no schema for tool '${call.tool}'` }
  }

  const schema = JSON.parse(readFileSync(schemaPath, "utf-8"))
  const op = schema.operations?.[call.operation]
  if (!op) {
    return {
      allowed: false,
      reason: `operation '${call.operation}' not declared in ${call.tool} schema`,
    }
  }

  // Blocked targets (git: force push to main, etc.)
  if (op.blocked_targets && Array.isArray(op.blocked_targets)) {
    const target =
      (call.args.branch as string | undefined) ||
      (call.args.target as string | undefined) ||
      (call.args.remote as string | undefined) ||
      ""
    if (op.blocked_targets.includes(target) || op.blocked_targets.includes("*")) {
      return {
        allowed: false,
        reason: `BLOCKED: ${call.operation} to '${target}' is permanently forbidden by ${call.tool} schema`,
      }
    }
  }

  // Blocked patterns (shell: rm -rf /, etc.)
  if (op.blocked_patterns && Array.isArray(op.blocked_patterns)) {
    const command = (call.args.command as string | undefined) || ""
    for (const pattern of op.blocked_patterns) {
      if (command.includes(pattern)) {
        return {
          allowed: false,
          reason: `BLOCKED: command contains forbidden pattern '${pattern}'`,
        }
      }
    }
  }

  // Blocked flags
  if (op.blocked_flags && Array.isArray(op.blocked_flags)) {
    const command = (call.args.command as string | undefined) || ""
    for (const flag of op.blocked_flags) {
      if (command.includes(flag)) {
        return {
          allowed: false,
          reason: `BLOCKED: command contains forbidden flag '${flag}'`,
        }
      }
    }
  }

  // Approval gate
  if (op.requires_approval === true) {
    return {
      allowed: "approval_needed",
      reason: `${call.tool}.${call.operation} requires architect approval`,
    }
  }

  // Global permissions.md "never allowed" pattern scan (coarse)
  const perms = readFileSync(PERMISSIONS_PATH, "utf-8")
  const neverSection = perms.split("## Never allowed")[1]?.split("##")[0] ?? ""
  const actionDesc =
    `${call.tool} ${call.operation} ${JSON.stringify(call.args)}`.toLowerCase()
  for (const line of neverSection.split("\n")) {
    if (!line.startsWith("- ")) continue
    const rule = line.slice(2).toLowerCase()
    const keywords = rule.split(/\s+/).filter((w) => w.length > 3)
    let hits = 0
    for (const k of keywords) {
      if (actionDesc.includes(k)) hits++
      if (hits >= 2) {
        return {
          allowed: false,
          reason: `BLOCKED by permissions.md rule: "${line.slice(2)}"`,
        }
      }
    }
  }

  return { allowed: true }
}
