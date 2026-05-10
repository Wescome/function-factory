#!/usr/bin/env node
/**
 * CLI entry for the Factory compiler.
 *
 * Usage-
 *   pnpm compile <path-to-intent-specification.md> [--mode bootstrap|steady_state]
 *                                  [--verification-reports-dir <path>]
 *
 * Exits 0 on Coherence Verification pass, 1 on Coherence Verification fail, 2 on compile error
 * (parse failure, schema violation, IO error, etc.). The Verification
 * Report is emitted on disk regardless of verdict — a fail exit
 * does not suppress report emission.
 */

import { compile } from "./compile.js"
import type { CompileOptions } from "./compile.js"
import type { FactoryMode } from "./types.js"

interface ParsedArgs {
  readonly intentSpecificationPath: string
  readonly options: CompileOptions
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  // Skip node + script path; walk positional and flag arguments.
  const args = argv.slice(2)
  let intentSpecificationPath: string | null = null
  let mode: FactoryMode | undefined
  let verificationReportsDir: string | undefined

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === "--mode") {
      const next = args[i + 1]
      if (next !== "bootstrap" && next !== "steady_state") {
        throw new Error(
          `--mode requires 'bootstrap' or 'steady_state', got- ${next ?? "(missing)"}`
        )
      }
      mode = next
      i++
    } else if (arg === "--verification-reports-dir") {
      const next = args[i + 1]
      if (next === undefined) {
        throw new Error("--verification-reports-dir requires a path argument")
      }
      verificationReportsDir = next
      i++
    } else if (arg !== undefined && !arg.startsWith("--")) {
      if (intentSpecificationPath !== null) {
        throw new Error(`Unexpected positional argument- ${arg}`)
      }
      intentSpecificationPath = arg
    } else {
      throw new Error(`Unknown flag- ${arg}`)
    }
  }

  if (intentSpecificationPath === null) {
    throw new Error("Usage- compile <path-to-intent-specification.md> [--mode ...] [--verification-reports-dir ...]")
  }

  const options: CompileOptions = {
    ...(mode !== undefined && { mode }),
    ...(verificationReportsDir !== undefined && { verificationReportsDir }),
  }
  return { intentSpecificationPath, options }
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
    const result = await compile(parsed.intentSpecificationPath, parsed.options)
    process.stdout.write(
      `Coherence Verification- ${result.report.overall.toUpperCase()}\n` +
        `IS- ${result.intermediates.intentSpecification.id}\n` +
        `Mode- ${result.mode}\n` +
        `Verification Report- ${result.reportPath}\n` +
        (result.executableSpecificationPath !== null
          ? `Executable Specification- ${result.executableSpecificationPath}\n`
          : "") +
        `Atoms- ${result.intermediates.atoms.length}, ` +
        `Contracts- ${result.intermediates.contracts.length}, ` +
        `Invariants- ${result.intermediates.invariants.length}, ` +
        `Dependencies- ${result.intermediates.dependencies.length}, ` +
        `Validations- ${result.intermediates.validations.length}\n`
    )
    if (result.report.overall === "fail") {
      process.stdout.write(`\nRemediation-\n${result.report.remediation}\n`)
      process.exit(1)
    }
    process.exit(0)
  } catch (err) {
    process.stderr.write(`Compile error- ${(err as Error).message}\n`)
    process.exit(2)
  }
}

void main()
