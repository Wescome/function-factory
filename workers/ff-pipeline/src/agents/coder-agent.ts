/**
 * CoderAgent — real agent with tools that produces CodeArtifacts.
 *
 * Phase A: converts callModel wrapper to gdk-agent agentLoop session.
 * Uses arango_query tool to look up existing code patterns, invariants,
 * and similar implementations before producing file changes.
 *
 * The sandbox execution path (executionRole) is Phase C and is NOT touched.
 */

import { agentLoop } from '@weops/gdk-agent'
import type { AgentTool } from '@weops/gdk-agent'
import type { Model, AssistantMessage, Message, UserMessage } from '@weops/gdk-ai'
import type { ArangoClient } from '@factory/arango-client'
import type { CodeArtifact, Plan, CritiqueReport } from '../coordinator/state'
import type { FileContext } from '@factory/file-context'
import { resolveAgentModel } from './resolve-model'
import { processAgentOutput, extractAssistantText, buildTelemetryEntry, CODE_ARTIFACT_SCHEMA } from './output-reliability'

export interface CoderInput {
  workGraph: Record<string, unknown>
  plan: Plan
  specContent?: string
  repairNotes?: string
  previousCode?: CodeArtifact
  critiqueIssues?: CritiqueReport['issues']
  fileContexts?: FileContext[]
}

export interface CoderAgentOpts {
  db: ArangoClient
  apiKey: string
  dryRun?: boolean
  /** Override model for testing (e.g. faux provider) */
  model?: Model<any>
  /** ADR-008: Hot-reloadable alias overrides for CodeArtifact schema */
  aliasOverrides?: Record<string, string[]>
  /** Pre-fetched Factory knowledge graph context (injected into user message) */
  contextPrompt?: string
}

const SYSTEM_PROMPT = `You are the CodeProducer in the Function Factory synthesis pipeline.

Your purpose: produce a CodeArtifact — a set of file changes that implement the Plan against the WorkGraph specification. This is a TypeScript monorepo. All code targets TypeScript unless the atom spec explicitly states otherwise.

Process this request in order:
1. Read the atom spec and plan — understand what code to produce
2. Study the file contexts — ground every reference in the provided Factory Knowledge Graph context
3. Plan edits — for existing files, produce targeted search/replace edits; for new files, produce full content
4. Produce the CodeArtifact JSON

If this is a repair cycle (repairNotes provided), focus on fixing the specific issues noted.
Reuse existing patterns from the codebase. Follow the plan's atom ordering.

FILE MODIFICATION RULES:
- For NEW files (action: "create"): provide full "content" string.
- For EXISTING files (action: "modify"): use "edits" — an array of search/replace pairs.
  Each edit has: "search" (exact substring from the current file, min 10 chars), "replace" (what it becomes).
  Edits are applied sequentially. Include enough context in "search" to be unique in the file.
- For DELETIONS (action: "delete"): just the path.

Your response is a JSON object:
{
  "files": [
    { "path": "src/new-file.ts", "content": "full file content", "action": "create" },
    { "path": "src/existing.ts", "edits": [{"search": "old code here...", "replace": "new code here..."}], "action": "modify" },
    { "path": "src/removed.ts", "action": "delete" }
  ],
  "summary": "What was implemented and why",
  "testsIncluded": true
}`

// Required fields now defined in CODE_ARTIFACT_SCHEMA (output-reliability.ts)


export class CoderAgent {
  private db: ArangoClient
  private apiKey: string
  private dryRun: boolean
  private modelOverride?: Model<any>
  private aliasOverrides?: Record<string, string[]>
  private contextPrompt?: string

  constructor(opts: CoderAgentOpts) {
    this.db = opts.db
    this.apiKey = opts.apiKey
    this.dryRun = opts.dryRun ?? false
    this.modelOverride = opts.model
    this.aliasOverrides = opts.aliasOverrides
    this.contextPrompt = opts.contextPrompt
  }

  async produceCode(input: CoderInput): Promise<CodeArtifact> {
    if (this.dryRun) {
      return {
        files: [{ path: 'src/stub.ts', content: '// dry-run stub', action: 'create' }],
        summary: 'Dry-run code output',
        testsIncluded: false,
      }
    }

    const tools: AgentTool[] = []  // No tools — context is pre-fetched
    const model = this.modelOverride ?? resolveAgentModel('coder')

    // Extract only the current atom's spec + relevant interfaces to reduce BL1 context pressure.
    // Sending the FULL workGraph causes models to produce prose instead of JSON (F1 failures).
    const atoms = (input.workGraph.atoms as Record<string, unknown>[]) ?? []
    const currentAtom = atoms.find((a: any) => a.id === input.plan?.atoms?.[0]?.id) ?? atoms[0]
    const relevantContext = {
      atom: currentAtom,
      title: input.workGraph.title,
      invariants: input.workGraph.invariants,
    }

    const userParts: string[] = [
      `Plan:\n${JSON.stringify(input.plan, null, 2)}`,
      `\nWorkGraph atom specification:\n${JSON.stringify(relevantContext, null, 2)}`,
    ]

    if (input.specContent) {
      userParts.push(`\nOriginal specification content:\n${input.specContent}`)
    }

    if (input.repairNotes) {
      userParts.push(`\n--- REPAIR CYCLE ---`)
      userParts.push(`Repair notes from Verifier:\n${input.repairNotes}`)
    }

    if (input.previousCode) {
      userParts.push(`\nPrevious code (to fix, not rewrite from scratch):\n${JSON.stringify(input.previousCode, null, 2)}`)
    }

    if (input.critiqueIssues && input.critiqueIssues.length > 0) {
      userParts.push(`\nCritique issues to address:\n${JSON.stringify(input.critiqueIssues, null, 2)}`)
    }

    if (input.fileContexts && input.fileContexts.length > 0) {
      userParts.push(`\n--- EXISTING FILES (use edits for modifications, NOT full replacement) ---`)
      for (const ctx of input.fileContexts) {
        const badge = ctx.confidence === 'extracted' ? '[AST-verified]'
          : ctx.confidence === 'inferred' ? '[inferred from import]'
          : '[ambiguous]'
        userParts.push(`\n## File: ${ctx.path} ${badge}`)
        if (ctx.structure.exports.length > 0) {
          userParts.push(`Exports: ${ctx.structure.exports.join(', ')}`)
        }
        if (ctx.structure.functions.length > 0) {
          userParts.push(`Functions: ${ctx.structure.functions.map(f => `${f.name}(${f.params})`).join(', ')}`)
        }
        userParts.push('```')
        userParts.push(ctx.targetSlice ?? ctx.rawContent)
        userParts.push('```')
      }
    }

    if (this.contextPrompt) {
      userParts.push(`\n${this.contextPrompt}`)
    }

    userParts.push('\nProduce a CodeArtifact. Start your response with {"files":')

    const userMessage: UserMessage = {
      role: 'user',
      content: userParts.join('\n'),
      timestamp: Date.now(),
    }

    const stream = agentLoop(
      [userMessage],
      { systemPrompt: SYSTEM_PROMPT, messages: [], tools },
      {
        model,
        convertToLlm: (msgs) => msgs as Message[],
        getApiKey: async () => this.apiKey,
        maxTokens: 16384,
        onPayload: (payload: unknown) => ({
          ...(payload as Record<string, unknown>),
          response_format: { type: 'json_object' },
        }),
      },
      AbortSignal.timeout(600_000),
    )

    const messages = await stream.result()

    const lastAssistant = [...messages].reverse().find(
      (m): m is AssistantMessage => m.role === 'assistant',
    )
    if (!lastAssistant) {
      throw new Error('CoderAgent: no assistant response from agent loop')
    }

    // Check for error
    if (lastAssistant.stopReason === 'error' || lastAssistant.stopReason === 'aborted') {
      throw new Error(`CoderAgent: agent loop failed: ${lastAssistant.errorMessage ?? 'unknown error'}`)
    }

    const rawText = extractAssistantText(lastAssistant.content as any)
    if (!rawText) {
      const blockTypes = lastAssistant.content.map(c => c.type).join(',')
      throw new Error(`CoderAgent: empty response (blocks: ${blockTypes || 'none'}, stopReason: ${lastAssistant.stopReason})`)
    }

    const result = await processAgentOutput(rawText, CODE_ARTIFACT_SCHEMA, {
      aliasOverrides: this.aliasOverrides,
    })

    // ORL telemetry — fire-and-forget, never blocks agent response
    try {
      const telemetry = buildTelemetryEntry(result, 'CodeArtifact')
      await this.db.save('orl_telemetry', telemetry).catch(() => {})
    } catch { /* telemetry is best-effort */ }

    if (!result.success) {
      throw new Error(`CoderAgent: ${result.failureMode}: could not produce valid CodeArtifact`)
    }
    return result.data!
  }
}
