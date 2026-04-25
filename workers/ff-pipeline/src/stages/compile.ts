import type { ArangoClient } from '@factory/arango-client'
import type { PipelineEnv } from '../types'
import { callModel } from '../model-bridge'

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
  decompose: `Decompose this PRD into atoms — minimal, independently implementable units of work. Each atom has an id, type, title, description. Output JSON: { "atoms": [...] }`,

  dependency: `Given atoms, identify dependencies between them. Output JSON: { "dependencies": [{ "from": "atom-id", "to": "atom-id", "type": "requires | enables | conflicts" }] }`,

  invariant: `Extract invariants from the PRD + atoms. Each invariant is a property that must always hold. Include a detector spec (how to check it). Output JSON: { "invariants": [{ "id": "INV-*", "property": "...", "detector": { "type": "...", "check": "..." } }] }`,

  interface: `Define typed interfaces between dependent atoms. Each interface specifies the data contract. Output JSON: { "interfaces": [{ "from": "atom-id", "to": "atom-id", "contract": { "input": {...}, "output": {...} } }] }`,

  binding: `Assign implementation bindings to each atom. A binding specifies HOW the atom will be implemented. Output JSON: { "bindings": [{ "atomId": "...", "binding": { "type": "code | config | doc", "language": "...", "target": "..." } }] }`,

  validation: `Generate Zod validation schemas for each atom's input/output contracts. Output JSON: { "validations": [{ "atomId": "...", "schema": "..." }] }`,

  assembly: `Assemble atoms, dependencies, invariants, interfaces, bindings, and validations into a complete WorkGraph. This is a deterministic assembly — no new content, just structure. Output the full WorkGraph JSON.`,

  verification: `Verify the WorkGraph for completeness and consistency. Check: all atoms bound, all dependencies resolved, all invariants have detectors, all interfaces have both sides. Output JSON: { "verified": true/false, "issues": [...] }`,
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
      const workGraph = {
        _key: wgKey,
        type: 'workgraph',
        title: prd?.title ?? 'Dry-run WorkGraph',
        prdId: (state.prd as Record<string, unknown>)?._key ?? 'unknown',
        atoms: state.atoms ?? [],
        dependencies: state.dependencies ?? [],
        invariants: state.invariants ?? [],
        interfaces: state.interfaces ?? [],
        validations: state.validations ?? [],
        repo: { url: 'https://github.com/Wescome/function-factory', ref: 'main' },
        fileScope: { include: ['src/**'], exclude: ['node_modules/**'] },
        commandPolicy: { allow: ['npm test', 'npm run build', 'npm run lint'] },
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

  if (passName === 'assembly' || passName === 'verification') {
    return runDryPass(passName, state, db)
  }

  const context: Record<string, unknown> = { pass: passName, prd: state.prd }
  if (state.atoms) context.atoms = state.atoms
  if (state.dependencies) context.dependencies = state.dependencies
  if (state.invariants) context.invariants = state.invariants
  if (state.interfaces) context.interfaces = state.interfaces
  if (state.bindings) context.bindings = state.bindings
  const userMessage = JSON.stringify(context)

  const result = await callModel(taskKind, systemPrompt, userMessage, env)
  const parsed = JSON.parse(result) as Record<string, unknown>

  return { ...state, ...parsed }
}
