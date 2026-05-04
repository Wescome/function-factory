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
import { reformat } from '@factory/transmission-adapters'
import type { FactorySpecification } from '@factory/transmission-adapters'
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

/**
 * Build a FactorySpecification from CoderInput.
 *
 * This is the bridge between the coordinator's internal representation
 * (atoms, plans, workGraphs) and the transmission adapter's substrate-
 * neutral FactorySpecification. The adapter then reformats it into
 * agent-friendly markdown with NO Factory vocabulary.
 */
function buildFactorySpecification(input: CoderInput, contextPrompt?: string): FactorySpecification {
  // Extract the current atom's spec
  const atoms = (input.workGraph.atoms as Record<string, unknown>[]) ?? []
  const currentAtom = atoms.find((a: any) => a.id === input.plan?.atoms?.[0]?.id) ?? atoms[0]

  // Build intent from atom title/description + verifies
  const atomTitle = (currentAtom as any)?.title ?? (currentAtom as any)?.description ?? (input.workGraph as any).title ?? 'Implement task'
  const atomVerifies = (currentAtom as any)?.verifies as string[] | undefined
  const intent = atomVerifies?.length
    ? `${atomTitle}\n\nAcceptance criteria:\n${atomVerifies.map((v: string) => `- ${v}`).join('\n')}`
    : atomTitle

  // Build constraints from invariants
  const rawInvariants = (input.workGraph.invariants as Array<{ id?: string; condition?: string; description?: string }>) ?? []
  const constraints = rawInvariants
    .map(inv => inv.condition ?? inv.description ?? '')
    .filter(Boolean)

  // Build file contexts
  const fileContents = input.fileContexts?.map(ctx => ({
    path: ctx.path,
    exports: ctx.structure.exports.length > 0 ? ctx.structure.exports : undefined,
    functions: ctx.structure.functions.length > 0
      ? ctx.structure.functions.map(f => `${f.name}(${f.params})`)
      : undefined,
    content: ctx.targetSlice ?? ctx.rawContent,
  }))

  // Build target files from atom
  const targetFiles = (currentAtom as any)?.targetFiles as string[] | undefined

  // Build repair context
  const repair = input.repairNotes
    ? {
        notes: input.repairNotes,
        previousFiles: input.previousCode?.files.map(f => f.path),
        issues: input.critiqueIssues?.map(i => `[${i.severity}] ${i.description}${i.file ? ` (${i.file})` : ''}`),
      }
    : undefined

  // Build context (decisions, lessons, mentor rules from contextPrompt if present)
  const decisions: string[] = []
  const lessons: string[] = []
  const mentorRules: string[] = []
  if (contextPrompt) {
    // Parse contextPrompt lines into categories
    for (const line of contextPrompt.split('\n')) {
      const trimmed = line.trim()
      if (trimmed.startsWith('- Decision:') || trimmed.startsWith('Decision:')) {
        decisions.push(trimmed.replace(/^-?\s*Decision:\s*/, ''))
      } else if (trimmed.startsWith('- Lesson:') || trimmed.startsWith('Lesson:')) {
        lessons.push(trimmed.replace(/^-?\s*Lesson:\s*/, ''))
      } else if (trimmed.startsWith('- Rule:') || trimmed.startsWith('Rule:')) {
        mentorRules.push(trimmed.replace(/^-?\s*Rule:\s*/, ''))
      }
    }
  }

  const spec: FactorySpecification = {
    intent,
    approach: (input.plan as any)?.approach as string | undefined,
    targetFiles,
    constraints: constraints.length > 0 ? constraints : undefined,
    context: (fileContents?.length ?? 0) > 0 || decisions.length > 0 || lessons.length > 0 || mentorRules.length > 0
      ? {
          fileContents: fileContents?.length ? fileContents : undefined,
          decisions: decisions.length > 0 ? decisions : undefined,
          lessons: lessons.length > 0 ? lessons : undefined,
          mentorRules: mentorRules.length > 0 ? mentorRules : undefined,
        }
      : undefined,
    repair,
  }

  // Include spec content in the intent if available
  if (input.specContent) {
    spec.intent += `\n\nSpecification:\n${input.specContent}`
  }

  return spec
}

export class CoderAgent {
  private db: ArangoClient
  private apiKey: string
  private dryRun: boolean
  private modelOverride: Model<any> | undefined
  private aliasOverrides: Record<string, string[]> | undefined
  private contextPrompt: string | undefined

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

    // Build FactorySpecification from CoderInput
    const spec = buildFactorySpecification(input, this.contextPrompt)

    // reformat() is the ONLY way Factory internals reach the LLM.
    // The atom JSON NEVER appears in the output.
    const communicable = reformat(spec, 'coding-agent')

    const userMessage: UserMessage = {
      role: 'user',
      content: communicable.body,
      timestamp: Date.now(),
    }

    const stream = agentLoop(
      [userMessage],
      { systemPrompt: communicable.systemPrompt, messages: [], tools },
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
      ...(this.aliasOverrides ? { aliasOverrides: this.aliasOverrides } : {}),
    })

    // ORL telemetry — fire-and-forget, never blocks agent response
    try {
      const telemetry = buildTelemetryEntry(result, 'CodeArtifact')
      await this.db.save('orl_telemetry', telemetry as unknown as Record<string, unknown>).catch(() => {})
    } catch { /* telemetry is best-effort */ }

    if (!result.success) {
      throw new Error(`CoderAgent: ${result.failureMode}: could not produce valid CodeArtifact`)
    }
    return result.data!
  }
}
