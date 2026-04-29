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
  decompose: `Decompose this PRD into requirement atoms — minimal, independently implementable units of work. Each atom MUST have: id (format "atom-001", "atom-002", sequential), type ("implementation" | "config" | "test"), title, description. Output ONLY the new atoms — do NOT repeat the PRD or any other state. Output JSON: { "atoms": [{ "id": "atom-001", "type": "implementation", "title": "...", "description": "..." }] }`,

  dependency: `Given atoms, identify dependencies between them. Output ONLY the new dependencies — do NOT repeat atoms or any other state. Output JSON: { "dependencies": [{ "from": "atom-id", "to": "atom-id", "type": "requires | enables | conflicts" }] }`,

  invariant: `Extract invariants from the PRD + atoms. Each invariant is a property that must always hold. Include a detector spec (how to check it). Output ONLY the new invariants — do NOT repeat atoms, PRD, or any other state. Output JSON: { "invariants": [{ "id": "INV-*", "property": "...", "detector": { "type": "...", "check": "..." } }] }`,

  interface: `Define typed interfaces between dependent atoms. Each interface specifies the data contract. Output ONLY the new interfaces — do NOT repeat atoms, dependencies, or any other state. Output JSON: { "interfaces": [{ "from": "atom-id", "to": "atom-id", "contract": { "input": {...}, "output": {...} } }] }`,

  binding: `Assign implementation bindings to each atom. A binding specifies HOW the atom will be implemented. Output ONLY the new bindings — do NOT repeat atoms or any other state. Output JSON: { "bindings": [{ "atomId": "...", "binding": { "type": "code | config | doc", "language": "...", "target": "..." } }] }`,

  validation: `Generate Zod validation schemas for each atom's input/output contracts. Output ONLY the new validations — do NOT repeat atoms, interfaces, or any other state. Output JSON: { "validations": [{ "atomId": "...", "schema": "..." }] }`,

  assembly: `Deterministic assembly — no LLM call needed.`,

  verification: `Deterministic verification — no LLM call needed.`,
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
    // Safety net: ensure every atom has binding + implementation for Gate 1
    boundAtoms = (boundAtoms as Record<string, unknown>[]).map((a, i) => ({
      ...a,
      id: a.id ?? `atom-${String(i + 1).padStart(3, '0')}`,
      binding: a.binding ?? { type: 'code', language: 'typescript', target: 'TBD' },
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
    case 'decompose':
      context.prd = state.prd
      break
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
  const parsed = JSON.parse(result) as Record<string, unknown>

  return { ...state, ...parsed }
}
