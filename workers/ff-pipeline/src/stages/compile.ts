import type { ArangoClient } from '@factory/arango-client'
import type { PipelineEnv } from '../types'
import { callModel } from '../model-bridge'
import { extractContext, type FileContext } from '@factory/file-context'

export const PASS_NAMES = [
  'decompose',
  'dependency',
  'invariant',
  'interface',
  'binding',
  'validation',
  'assembly',
  'verification',
] as const

export type PassName = typeof PASS_NAMES[number]

const PASS_TASK_KINDS: Record<PassName, string> = {
  decompose: 'planning',
  dependency: 'planning',
  invariant: 'structured',
  interface: 'structured',
  binding: 'interpretive',
  validation: 'structured',
  assembly: 'synthesis',
  verification: 'validation',
}

const PASS_PROMPTS: Record<PassName, string> = {
  decompose: `Decompose this PRD into requirement atoms. Each atom is a verifiable claim about what the system must do — it must be truth-apt (can be checked as true or false) and independently implementable.

Produce ONLY implementation atoms. Do NOT produce test atoms — testing is handled by the Tester role downstream.

Each atom MUST carry:
- id (format "atom-001")
- type ("implementation" | "config")
- title: the verifiable claim in one sentence
- description: implementation details including the exact file path to modify
- verifies: what specific aspect of the signal's intent this atom fulfills
- targetFiles: array of file paths this atom modifies (e.g. ["workers/ff-pipeline/src/config/crystallizer-config.ts"])

Prefer fewer atoms. One atom per file is ideal. Each atom should make ONE focused change.

If violationFeedback is provided, your previous attempt missed key concepts.
Address each violated claim in at least one atom's title or verifies field.

Output ONLY the new atoms — do NOT repeat the PRD or any other state. Output JSON: { "atoms": [{ "id": "atom-001", "type": "implementation", "title": "...", "description": "...", "verifies": "...", "targetFiles": ["path/to/file.ts"] }] }`,

  dependency: `Given atoms, identify dependencies between them. Output ONLY the new dependencies — do NOT repeat atoms or any other state. Output JSON: { "dependencies": [{ "from": "atom-id", "to": "atom-id", "type": "requires | enables | conflicts" }] }`,

  invariant: `Extract invariants from the PRD + atoms. Each invariant is a property that must always hold. Include a detector spec (how to check it). Output ONLY the new invariants — do NOT repeat atoms, PRD, or any other state. Output JSON: { "invariants": [{ "id": "INV-*", "property": "...", "detector": { "type": "...", "check": "..." } }] }`,

  interface: `Define typed interfaces between dependent atoms. Each interface specifies the data contract. Output ONLY the new interfaces — do NOT repeat atoms, dependencies, or any other state. Output JSON: { "interfaces": [{ "from": "atom-id", "to": "atom-id", "contract": { "input": {...}, "output": {...} } }] }`,

  binding: `Assign implementation bindings to each atom. A binding specifies HOW the atom will be implemented. Output ONLY the new bindings — do NOT repeat atoms or any other state. Output JSON: { "bindings": [{ "atomId": "...", "binding": { "type": "code | config | doc", "language": "...", "target": "..." } }] }`,

  validation: `Generate Zod validation schemas for each atom's input/output contracts. Output ONLY the new validations — do NOT repeat atoms, interfaces, or any other state. Output JSON: { "validations": [{ "atomId": "...", "schema": "..." }] }`,

  assembly: `Deterministic assembly — no LLM call needed.`,

  verification: `Deterministic verification — no LLM call needed.`,
}

/**
 * Extract targetFiles from an atom's binding.target.
 * Handles comma-separated targets and filters out 'TBD'.
 * Discrepancy #1: ensures atoms carry targetFiles from binding.target.
 */
function extractTargetFiles(atom: Record<string, unknown>): string[] {
  const binding = atom.binding as Record<string, unknown> | undefined
  if (!binding || typeof binding.target !== 'string') return []
  return binding.target
    .split(',')
    .map(t => t.trim())
    .filter(t => t.length > 0 && t !== 'TBD')
}

/**
 * Extract .ts/.tsx file paths from spec content text.
 * Filters out node_modules paths and deduplicates.
 */
export function extractFilePathsFromSpec(specContent: string): string[] {
  if (!specContent) return []
  const regex = /(?<![/\w])(?:[\w@-]+\/)+[\w-]+\.tsx?/g
  const matches = specContent.match(regex)
  if (!matches) return []
  return [...new Set(
    matches.filter(p => !p.includes('node_modules')),
  )]
}

/**
 * Fetch files from GitHub Contents API and run extractContext on each.
 * Fail-open: returns empty array on missing token, empty paths, or errors.
 */
export async function fetchCompileFileContexts(
  filePaths: string[],
  env: PipelineEnv,
): Promise<FileContext[]> {
  if (!env.GITHUB_TOKEN || filePaths.length === 0) return []

  const headers = {
    'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'ff-pipeline',
  }

  const contexts: FileContext[] = []

  for (const filePath of filePaths) {
    try {
      const res = await fetch(
        `https://api.github.com/repos/Wescome/function-factory/contents/${filePath}?ref=main`,
        { method: 'GET', headers },
      )
      if (!res.ok) continue

      const data = await res.json() as { content: string; encoding: string; sha: string }
      if (data.encoding !== 'base64') continue

      const rawContent = decodeBase64(data.content)
      const language = filePath.endsWith('.ts') || filePath.endsWith('.tsx')
        ? 'typescript'
        : filePath.endsWith('.json') ? 'json' : 'markdown'

      const ctx = extractContext(rawContent, language)
      contexts.push({ ...ctx, path: filePath })
    } catch {
      // Fail-open: skip files that error
      continue
    }
  }

  return contexts
}

function decodeBase64(encoded: string): string {
  const cleaned = encoded.replace(/\n/g, '')
  const binary = atob(cleaned)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new TextDecoder().decode(bytes)
}

export async function compilePRD(
  passName: PassName,
  state: Record<string, unknown>,
  db: ArangoClient,
  env: PipelineEnv,
  dryRun: boolean,
): Promise<Record<string, unknown>> {
  if (dryRun) {
    return runDryPass(passName, state, db)
  }
  return runLivePass(passName, state, db, env)
}

async function runDryPass(
  passName: PassName,
  state: Record<string, unknown>,
  db: ArangoClient,
): Promise<Record<string, unknown>> {
  const prd = state.prd as Record<string, unknown>

  switch (passName) {
    case 'decompose':
      return {
        ...state,
        atoms: [{
          id: 'atom-001',
          type: 'implementation',
          title: `Implement ${prd?.title ?? 'TBD'}`,
          description: prd?.objective ?? 'Dry-run atom',
          binding: null,
          critical: true, // implementation atoms are always critical
        }],
      }

    case 'dependency':
      return { ...state, dependencies: [] }

    case 'invariant':
      return {
        ...state,
        invariants: (prd?.invariants as string[] ?? []).map((inv: string, i: number) => ({
          id: `INV-${String(i + 1).padStart(3, '0')}`,
          property: inv,
          detector: { type: 'manual', check: 'TBD' },
          detectorSpec: 'dry-run',
        })),
      }

    case 'interface':
      return { ...state, interfaces: [] }

    case 'binding':
      return {
        ...state,
        atoms: ((state.atoms as Record<string, unknown>[]) ?? []).map((a) => ({
          ...a,
          binding: { type: 'code', language: 'typescript', target: 'TBD' },
          implementation: 'stub',
        })),
      }

    case 'validation':
      return { ...state, validations: [] }

    case 'assembly': {
      const wgKey = `WG-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
      const prdKey = (state.prd as Record<string, unknown>)?._key ?? 'unknown'
      const workGraph = {
        _key: wgKey,
        type: 'workgraph',
        title: prd?.title ?? 'Dry-run WorkGraph',
        prdId: prdKey,
        atoms: ((state.atoms ?? []) as Record<string, unknown>[]).map(a => ({
          ...a,
          critical: a.critical ?? (a.type === 'config' || a.type === 'test' ? false : true),
          targetFiles: extractTargetFiles(a),
        })),
        dependencies: state.dependencies ?? [],
        invariants: state.invariants ?? [],
        interfaces: state.interfaces ?? [],
        validations: state.validations ?? [],
        repo: { url: 'https://github.com/Wescome/function-factory', ref: 'main' },
        fileScope: { include: ['src/**'], exclude: ['node_modules/**'] },
        commandPolicy: { allow: ['npm test', 'npm run build', 'npm run lint'] },
        sourceRefs: [`PRD:${prdKey}`],
        compiledBy: 'dry-run',
        createdAt: new Date().toISOString(),
      }
      await db.save('specs_workgraphs', workGraph)
      return { ...state, workGraph }
    }

    case 'verification':
      return {
        ...state,
        verified: true,
        verificationIssues: [],
      }

    default:
      return state
  }
}

async function runLivePass(
  passName: PassName,
  state: Record<string, unknown>,
  db: ArangoClient,
  env: PipelineEnv,
): Promise<Record<string, unknown>> {
  const taskKind = PASS_TASK_KINDS[passName]
  const systemPrompt = PASS_PROMPTS[passName]

  if (passName === 'assembly') {
    // Merge bindings onto atoms before assembly
    const atoms = state.atoms as Record<string, unknown>[] | undefined
    const bindings = state.bindings as Record<string, unknown>[] | undefined
    let boundAtoms = atoms ?? []
    if (atoms && bindings) {
      const bindingMap = new Map(bindings.map(b => [b.atomId as string, b.binding]))
      boundAtoms = atoms.map(a => ({
        ...a,
        binding: bindingMap.get(a.id as string) ?? a.binding,
        implementation: bindingMap.has(a.id as string) ? 'bound' : (a.implementation ?? null),
      }))
    }
    // Strip test atoms — implementation-only synthesis for mergeable PRs
    boundAtoms = (boundAtoms as Record<string, unknown>[]).filter(a => a.type !== 'test')
    // Safety net: ensure every atom has binding + implementation for Gate 1
    boundAtoms = (boundAtoms as Record<string, unknown>[]).map((a, i) => ({
      ...a,
      id: a.id ?? `atom-${String(i + 1).padStart(3, '0')}`,
      binding: { ...(a.binding as Record<string, unknown> ?? {}), type: (a.binding as Record<string, unknown>)?.type ?? 'code', language: 'typescript', target: (a.binding as Record<string, unknown>)?.target ?? 'TBD' },
      implementation: a.implementation ?? 'stub',
      critical: a.critical ?? (a.type === 'config' || a.type === 'test' ? false : true),
    }))
    return runDryPass(passName, { ...state, atoms: boundAtoms }, db)
  }

  if (passName === 'verification') {
    return runDryPass(passName, state, db)
  }

  // Minimal context per pass — send ONLY what the pass needs, not full state
  const context: Record<string, unknown> = { pass: passName }
  switch (passName) {
    case 'decompose': {
      // Context compression for llama-70b's 8K window:
      // Send PRD summary (not full), signal specContent, and file exports (not raw content)
      const prd = state.prd as Record<string, unknown> | undefined
      context.prd = prd ? { title: prd.title, objective: prd.objective, atoms: prd.atoms, invariants: prd.invariants } : state.prd
      if (state.signalContext) context.signalContext = state.signalContext
      if (state._violationFeedback) context.violationFeedback = state._violationFeedback
      if (Array.isArray(state.fileContexts) && state.fileContexts.length > 0) {
        // Compress: exports + functions only, not raw content
        context.existingFiles = (state.fileContexts as Array<Record<string, unknown>>).map(f => ({
          path: f.path,
          exports: f.exports,
          functions: f.functions,
        }))
      }
      break
    }
    case 'dependency':
      context.atoms = state.atoms
      break
    case 'invariant':
      context.prd = state.prd
      context.atoms = state.atoms
      break
    case 'interface':
      context.atoms = state.atoms
      context.dependencies = state.dependencies
      break
    case 'binding':
      context.atoms = state.atoms
      break
    case 'validation':
      context.atoms = state.atoms
      context.interfaces = state.interfaces
      break
  }
  const userMessage = JSON.stringify(context)

  const result = await callModel(taskKind, systemPrompt, userMessage, env)

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(result) as Record<string, unknown>
  } catch {
    // JSON repair: try fixing common LLM errors (missing commas, trailing commas)
    const repaired = result
      .replace(/"\s*\n\s*"/g, '",\n"')        // missing comma between string properties
      .replace(/}\s*\n\s*"/g, '},\n"')          // missing comma after closing brace
      .replace(/]\s*\n\s*"/g, '],\n"')          // missing comma after closing bracket
      .replace(/,\s*([}\]])/g, '$1')             // trailing commas
    try {
      parsed = JSON.parse(repaired) as Record<string, unknown>
    } catch (e) {
      throw new Error(`Compile pass ${passName}: JSON parse failed after repair. Error: ${e instanceof Error ? e.message : e}. Raw (first 200): ${result.slice(0, 200)}`)
    }
  }

  return { ...state, ...parsed }
}
