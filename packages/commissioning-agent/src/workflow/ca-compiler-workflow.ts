/**
 * ca-compiler-workflow.ts
 *
 * Mastra workflow that runs the CA compiler pass sequence:
 *   Step 1  fetch-elucidation-artifact  → ElucidationContent
 *   Step 2  synthesize-pressure         → PressureArtifact     → ArtifactGraphDO
 *   Step 3  map-capability              → CapabilityArtifact   → ArtifactGraphDO
 *   Step 4  propose-function            → FunctionProposal     → ArtifactGraphDO
 *   Step 5  compile-prd                 → IntentSpecification  → ArtifactGraphDO
 *   Step 6  human-approval-gate         (suspend if required)
 *   Step 7  emit-to-mediation           → POST MediationAgentDO /commission
 *
 * SPEC-FF-CA-REWRITE-001 §Mastra Workflow
 * CA-INV-002: every pass has schema-validated input and output
 * CA-INV-003: pass N blocks on pass N-1 artifact written to ArtifactGraphDO
 * CA-INV-005: all LLM calls go through buildPlannerAgent
 * CA-INV-007: human approval suspension uses workflow.suspend()
 */

import { createWorkflow, createStep } from '@mastra/core/workflows'
import { z } from 'zod'
import { buildPlannerAgent, type PlannerAgentEnv } from '@factory/gears'

import { CommissioningSignalSchema } from '../schemas.js'
import type { CommissioningSignal } from '../schemas.js'
import type { Env } from '../env.js'

import {
  fetchElucidationStep,
  type ArtifactGraphNodeReader,
} from './steps/fetch-elucidation.js'
import { synthesizePressureStep } from './steps/synthesize-pressure.js'
import { mapCapabilityStep } from './steps/map-capability.js'
import { proposeFunctionStep } from './steps/propose-function.js'
import { compilePrdStep } from './steps/compile-prd.js'
import { emitToMediationStep } from './steps/emit-to-mediation.js'
import type { FactoryArtifactGraphDO } from '@factory/factory-graph'

// ── Exported types ─────────────────────────────────────────────────────────────

export type CaWorkflowInput = CommissioningSignal
export type CaWorkflowOutput = { isNodeId: string; suspended: boolean }

// ── Output schema ───────────────────────────────────────────────────────────────

const CaWorkflowOutputSchema = z.object({
  isNodeId: z.string().min(1),
  suspended: z.boolean(),
})

// ── RequestContext schema ───────────────────────────────────────────────────────
//
// The workflow steps need access to the Cloudflare Worker Env (DO namespace
// bindings, D1 database). Since Env is a runtime-only object containing
// non-serializable Cloudflare bindings, it is passed via requestContext —
// which Mastra skips during JSON serialization for non-serializable values.
//
// Usage in the DO:
//   import { RequestContext } from '@mastra/core'
//   const rc = new RequestContext([['env', env]])
//   await run.start({ inputData: signal, requestContext: rc })

const CaRequestContextSchema = z.object({
  env: z.custom<Env>(),
})
type CaRequestContext = z.infer<typeof CaRequestContextSchema>

// ── Step 1 — fetch-elucidation ─────────────────────────────────────────────────

const fetchElucidationMastraStep = createStep({
  id: 'fetch-elucidation',
  description: 'Retrieve ElucidationContent from ArtifactGraphDO via DO RPC',
  inputSchema: CommissioningSignalSchema,
  outputSchema: z.object({
    id: z.string().min(1),
    data: z.record(z.string(), z.unknown()),
  }),
  requestContextSchema: CaRequestContextSchema,
  execute: async ({ inputData: signal, requestContext }) => {
    const env = requestContext.get('env') as Env

    const artifactGraphStub = env.ARTIFACT_GRAPH.get(
      env.ARTIFACT_GRAPH.idFromName('factory-artifact-graph'),
    ) as unknown as DurableObjectStub<FactoryArtifactGraphDO>

    return fetchElucidationStep(
      { elucidationArtifactId: signal.elucidationArtifactId },
      artifactGraphStub,
    )
  },
})

// ── Step 2 — synthesize-pressure ──────────────────────────────────────────────

const synthesizePressureMastraStep = createStep({
  id: 'synthesize-pressure',
  description: 'Run Pressure Synthesizer pass and persist PRS-* to ArtifactGraphDO',
  inputSchema: z.object({
    id: z.string().min(1),
    data: z.record(z.string(), z.unknown()),
  }),
  outputSchema: z.object({
    id: z.string().regex(/^PRS-/),
    kind: z.literal('pressure'),
    title: z.string().min(1),
    description: z.string().min(1),
    priority: z.enum(['critical', 'high', 'medium', 'low']),
    category: z.string().min(1),
    sourceSignalId: z.string().min(1),
    evidence: z.array(z.string()),
    orgId: z.string().min(1),
    sessionId: z.string().min(1),
  }),
  requestContextSchema: CaRequestContextSchema,
  execute: async ({ inputData: elucidation, getInitData, requestContext }) => {
    const env = requestContext.get('env') as Env
    const signal = getInitData<CommissioningSignal>()

    const plannerEnv: PlannerAgentEnv = {
      DB: env.DB,
      CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID,
      CF_API_TOKEN: await env.CF_API_TOKEN.get(),
    }
    const plannerAgent = buildPlannerAgent('planner', plannerEnv)

    const artifactGraphStub = env.ARTIFACT_GRAPH.get(
      env.ARTIFACT_GRAPH.idFromName('factory-artifact-graph'),
    ) as unknown as DurableObjectStub<FactoryArtifactGraphDO>

    const pressure = await synthesizePressureStep(elucidation, signal, plannerAgent)

    // Persist to ArtifactGraphDO (CA-INV-003: write before next pass)
    const reader = artifactGraphStub as unknown as ArtifactGraphNodeReader & {
      upsertNode(id: string, type: string, data: Record<string, unknown>): Promise<unknown>
      upsertEdge(source: string, target: string, rel: string): Promise<unknown>
    }
    await reader.upsertNode(pressure.id, 'pressure', {
      ...pressure,
      orgId: signal.orgId,
      sessionId: signal.sessionId,
    })
    await reader.upsertEdge(pressure.id, signal.dispositionEventId, 'produced_at')

    return pressure
  },
})

// ── Step 3 — map-capability ────────────────────────────────────────────────────

const mapCapabilityMastraStep = createStep({
  id: 'map-capability',
  description: 'Run Capability Mapper pass and persist BC-* to ArtifactGraphDO',
  inputSchema: z.object({
    id: z.string().regex(/^PRS-/),
    kind: z.literal('pressure'),
    title: z.string().min(1),
    description: z.string().min(1),
    priority: z.enum(['critical', 'high', 'medium', 'low']),
    category: z.string().min(1),
    sourceSignalId: z.string().min(1),
    evidence: z.array(z.string()),
    orgId: z.string().min(1),
    sessionId: z.string().min(1),
  }),
  outputSchema: z.object({
    id: z.string().regex(/^BC-/),
    kind: z.literal('capability'),
    title: z.string().min(1),
    description: z.string().min(1),
    gapAnalysis: z.string().min(1),
    sourcePressureId: z.string().min(1),
    orgId: z.string().min(1),
    sessionId: z.string().min(1),
  }),
  requestContextSchema: CaRequestContextSchema,
  execute: async ({ inputData: pressure, requestContext }) => {
    const env = requestContext.get('env') as Env

    const plannerEnv: PlannerAgentEnv = {
      DB: env.DB,
      CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID,
      CF_API_TOKEN: await env.CF_API_TOKEN.get(),
    }
    const plannerAgent = buildPlannerAgent('planner', plannerEnv)

    const artifactGraphStub = env.ARTIFACT_GRAPH.get(
      env.ARTIFACT_GRAPH.idFromName('factory-artifact-graph'),
    ) as unknown as DurableObjectStub<FactoryArtifactGraphDO>

    const capability = await mapCapabilityStep(pressure, plannerAgent)

    const writer = artifactGraphStub as unknown as {
      upsertNode(id: string, type: string, data: Record<string, unknown>): Promise<unknown>
      upsertEdge(source: string, target: string, rel: string): Promise<unknown>
    }
    await writer.upsertNode(capability.id, 'capability', capability as unknown as Record<string, unknown>)
    await writer.upsertEdge(capability.id, pressure.id, 'governs')

    return capability
  },
})

// ── Step 4 — propose-function ──────────────────────────────────────────────────

const proposeFunctionMastraStep = createStep({
  id: 'propose-function',
  description: 'Run Function Proposer pass and persist FP-* to ArtifactGraphDO',
  inputSchema: z.object({
    id: z.string().regex(/^BC-/),
    kind: z.literal('capability'),
    title: z.string().min(1),
    description: z.string().min(1),
    gapAnalysis: z.string().min(1),
    sourcePressureId: z.string().min(1),
    orgId: z.string().min(1),
    sessionId: z.string().min(1),
  }),
  outputSchema: z.object({
    id: z.string().regex(/^FP-/),
    kind: z.literal('function-proposal'),
    title: z.string().min(1),
    description: z.string().min(1),
    rationale: z.string().min(1),
    successCriteria: z.array(z.string()).min(1),
    sourceCapabilityId: z.string().min(1),
    orgId: z.string().min(1),
    sessionId: z.string().min(1),
  }),
  requestContextSchema: CaRequestContextSchema,
  execute: async ({ inputData: capability, requestContext }) => {
    const env = requestContext.get('env') as Env

    const plannerEnv: PlannerAgentEnv = {
      DB: env.DB,
      CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID,
      CF_API_TOKEN: await env.CF_API_TOKEN.get(),
    }
    const plannerAgent = buildPlannerAgent('planner', plannerEnv)

    const artifactGraphStub = env.ARTIFACT_GRAPH.get(
      env.ARTIFACT_GRAPH.idFromName('factory-artifact-graph'),
    ) as unknown as DurableObjectStub<FactoryArtifactGraphDO>

    const proposal = await proposeFunctionStep(capability, plannerAgent)

    const writer = artifactGraphStub as unknown as {
      upsertNode(id: string, type: string, data: Record<string, unknown>): Promise<unknown>
      upsertEdge(source: string, target: string, rel: string): Promise<unknown>
    }
    await writer.upsertNode(proposal.id, 'function-proposal', proposal as unknown as Record<string, unknown>)
    await writer.upsertEdge(proposal.id, capability.id, 'governs')

    return proposal
  },
})

// ── Step 5 — compile-prd ───────────────────────────────────────────────────────

const compilePrdMastraStep = createStep({
  id: 'compile-prd',
  description: 'Run PRD Author pass and persist IS-* to ArtifactGraphDO',
  inputSchema: z.object({
    id: z.string().regex(/^FP-/),
    kind: z.literal('function-proposal'),
    title: z.string().min(1),
    description: z.string().min(1),
    rationale: z.string().min(1),
    successCriteria: z.array(z.string()).min(1),
    sourceCapabilityId: z.string().min(1),
    orgId: z.string().min(1),
    sessionId: z.string().min(1),
  }),
  // IntentSpecification is complex — output as a record that preserves the IS-* id
  outputSchema: z.object({
    isNodeId: z.string().regex(/^IS-/),
  }),
  requestContextSchema: CaRequestContextSchema,
  execute: async ({ inputData: proposal, getInitData, requestContext }) => {
    const env = requestContext.get('env') as Env
    const signal = getInitData<CommissioningSignal>()

    const plannerEnv: PlannerAgentEnv = {
      DB: env.DB,
      CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID,
      CF_API_TOKEN: await env.CF_API_TOKEN.get(),
    }
    const plannerAgent = buildPlannerAgent('planner', plannerEnv)

    const artifactGraphStub = env.ARTIFACT_GRAPH.get(
      env.ARTIFACT_GRAPH.idFromName('factory-artifact-graph'),
    ) as unknown as DurableObjectStub<FactoryArtifactGraphDO>

    const isNode = await compilePrdStep(proposal, signal, plannerAgent)

    const writer = artifactGraphStub as unknown as {
      upsertNode(id: string, type: string, data: Record<string, unknown>): Promise<unknown>
      upsertEdge(source: string, target: string, rel: string): Promise<unknown>
    }
    await writer.upsertNode(
      isNode.id,
      'intent-specification',
      isNode as unknown as Record<string, unknown>,
    )
    await writer.upsertEdge(isNode.id, proposal.id, 'governs')

    return { isNodeId: isNode.id }
  },
})

// ── Step 6 — human-approval-gate ──────────────────────────────────────────────

const humanApprovalGateMastraStep = createStep({
  id: 'human-approval-gate',
  description: 'Suspend workflow if human approval is required',
  inputSchema: z.object({
    isNodeId: z.string().regex(/^IS-/),
  }),
  outputSchema: z.object({
    isNodeId: z.string().regex(/^IS-/),
    suspended: z.boolean(),
  }),
  requestContextSchema: CaRequestContextSchema,
  execute: async ({ inputData, getInitData, suspend }) => {
    const signal = getInitData<CommissioningSignal>()
    const { isNodeId } = inputData

    if (signal.requireHumanApproval) {
      // CA-INV-007: human approval suspension uses workflow.suspend()
      await suspend({
        reason: 'human-approval-required',
        isNodeId,
        sessionId: signal.sessionId,
      })
      // suspend() halts execution — the return below is unreachable until resume
      return { isNodeId, suspended: true }
    }

    return { isNodeId, suspended: false }
  },
})

// ── Step 7 — emit-to-mediation ─────────────────────────────────────────────────

const emitToMediationMastraStep = createStep({
  id: 'emit-to-mediation',
  description: 'POST IntentSpecification to MediationAgentDO /commission',
  inputSchema: z.object({
    isNodeId: z.string().regex(/^IS-/),
    suspended: z.boolean(),
  }),
  outputSchema: CaWorkflowOutputSchema,
  requestContextSchema: CaRequestContextSchema,
  execute: async ({ inputData, getInitData, requestContext }) => {
    const env = requestContext.get('env') as Env
    const signal = getInitData<CommissioningSignal>()
    const { isNodeId, suspended } = inputData

    // Build a minimal IntentSpecification-like object with just the id field
    // that emitToMediationStep needs (it only uses isNode.id).
    const isNodeProxy = { id: isNodeId } as import('@factory/schemas').IntentSpecification

    const mediationStub = env.MEDIATION_AGENT.get(
      env.MEDIATION_AGENT.idFromName('mediation-agent:' + signal.orgId),
    )

    await emitToMediationStep(isNodeProxy, signal, mediationStub)

    return { isNodeId, suspended }
  },
})

// ── Workflow definition ────────────────────────────────────────────────────────

export const caCompilerWorkflow = createWorkflow({
  id: 'ca-compiler-workflow',
  description:
    'CommissioningAgent compiler pass sequence: elucidation → pressure → capability → ' +
    'function-proposal → intent-specification → (approval gate) → mediation',
  inputSchema: CommissioningSignalSchema,
  outputSchema: CaWorkflowOutputSchema,
  requestContextSchema: CaRequestContextSchema,
})
  .then(fetchElucidationMastraStep)
  .then(synthesizePressureMastraStep)
  .then(mapCapabilityMastraStep)
  .then(proposeFunctionMastraStep)
  .then(compilePrdMastraStep)
  .then(humanApprovalGateMastraStep)
  .then(emitToMediationMastraStep)

caCompilerWorkflow.commit()
