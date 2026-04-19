#!/usr/bin/env node
/**
 * CLI entry for @factory/harness-bridge.
 *
 * Usage-
 *   pnpm harness-exec <path-to-workgraph.yaml>
 *                     [--adapter <id>]
 *                     [--execution-logs-dir <path>]
 *
 * Default adapter is `dry-run`. Real adapters (claude-code, cursor,
 * shell-exec) are separate Functions landing in subsequent PRs; the
 * registry below is the single seam through which they plug in.
 *
 * Exit codes- 0 on summary status completed, 1 on summary status
 * failed | partial | adapter_unavailable, 2 on pre-invocation error
 * (workgraph parse failure, file IO error).
 */

import { readFile } from "node:fs/promises"
import { parse as parseYaml } from "yaml"
import { dryRunAdapter } from "./dry-run-adapter.js"
import { harnessExecute } from "./execute.js"
import { emitExecutionLog } from "./emit.js"
import type { HarnessAdapter } from "./types.js"

interface ParsedArgs {
  readonly workgraphPath: string
  readonly adapterId: string
  readonly executionLogsDir: string
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const args = argv.slice(2)
  let workgraphPath: string | null = null
  let adapterId = "dry-run"
  let executionLogsDir = "specs/execution-logs"

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === "--adapter") {
      const next = args[i + 1]
      if (next === undefined) {
        throw new Error("--adapter requires an identifier argument")
      }
      adapterId = next
      i++
    } else if (arg === "--execution-logs-dir") {
      const next = args[i + 1]
      if (next === undefined) {
        throw new Error("--execution-logs-dir requires a path argument")
      }
      executionLogsDir = next
      i++
    } else if (arg !== undefined && !arg.startsWith("--")) {
      if (workgraphPath !== null) {
        throw new Error(`Unexpected positional argument- ${arg}`)
      }
      workgraphPath = arg
    } else {
      throw new Error(`Unknown flag- ${arg}`)
    }
  }

  if (workgraphPath === null) {
    throw new Error(
      "Usage- harness-exec <path-to-workgraph.yaml> [--adapter <id>] [--execution-logs-dir <path>]"
    )
  }

  return { workgraphPath, adapterId, executionLogsDir }
}

function makeDefaultRegistry(): Map<string, HarnessAdapter> {
  const r = new Map<string, HarnessAdapter>()
  r.set(dryRunAdapter.id, dryRunAdapter)
  return r
}

async function main(): Promise<void> {
  let parsed: ParsedArgs
  try {
    parsed = parseArgs(process.argv)
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`)
    process.exit(2)
  }

  try {
    const yamlContent = await readFile(parsed.workgraphPath, "utf8")
    const workgraph = parseYaml(yamlContent)
    const { log } = await harnessExecute({
      workgraph,
      adapterId: parsed.adapterId,
      registry: makeDefaultRegistry(),
    })
    const logPath = await emitExecutionLog(log, parsed.executionLogsDir)
    process.stdout.write(
      `Status- ${log.status.toUpperCase()}\n` +
        `WorkGraph- ${log.workGraphId}\n` +
        `Adapter- ${log.adapterId}\n` +
        `Nodes- ${log.nodes.length}\n` +
        `ExecutionLog- ${logPath}\n`
    )
    process.exit(log.status === "completed" ? 0 : 1)
  } catch (err) {
    process.stderr.write(`harness-exec error- ${(err as Error).message}\n`)
    process.exit(2)
  }
}

void main()
