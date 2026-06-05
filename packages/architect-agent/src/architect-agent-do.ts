// Architect Agent Durable Object
// SPEC-ARCHITECT-AGENT-DO-001
// Singleton — do-key: architect-agent:factory

import type {
  FactoryState,
  CRPItem,
  PatchRecord,
  PipelineConfig,
  RepoSummary,
  CRPFailureClass,
} from './types.js'

export type Env = {
  ARANGO_URL: string
  ARANGO_DB: string
  ARANGO_TOKEN: string
  WEOPS_GATEWAY_URL: string
  HARNESS_BRIDGE_URL: string
  COMPILER_URL: string
  ANOMALY_SCAN_INTERVAL_MS: string
  PATCH_PROPAGATION_TIMEOUT_MS: string
  CRP_RESOLUTION_TIMEOUT_MS: string
}

const DEFAULT_ANOMALY_INTERVAL = 15 * 60 * 1000  // 15 min
const DEFAULT_PATCH_TIMEOUT    = 30 * 60 * 1000  // 30 min
const DEFAULT_CRP_TIMEOUT      = 10 * 60 * 1000  // 10 min

export class ArchitectAgentDO implements DurableObject {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const method = request.method

    if (method === 'POST' && url.pathname === '/crp') return this.handleCRP(request)
    if (method === 'POST' && url.pathname === '/patch') return this.handlePatch(request)
    if (method === 'POST' && url.pathname === '/register-repo') return this.handleRegisterRepo(request)
    if (method === 'POST' && url.pathname === '/deregister-repo') return this.handleDeregisterRepo(request)
    if (method === 'POST' && url.pathname === '/pipeline-config-auth') return this.handlePipelineConfigAuth(request)
    if (method === 'POST' && url.pathname === '/override') return this.handleOverride(request)
    if (method === 'GET'  && url.pathname === '/health') return this.handleHealth()
    if (method === 'GET'  && url.pathname === '/pipeline-config') return this.handleGetPipelineConfig()

    return new Response('Not found', { status: 404 })
  }

  async alarm(): Promise<void> {
    await this.runAnomalyScan()
    await this.checkPatchPropagation()
    // Re-arm
    await this.state.storage.setAlarm(
      Date.now() + Number(this.env.ANOMALY_SCAN_INTERVAL_MS ?? DEFAULT_ANOMALY_INTERVAL)
    )
  }

  // ── D2: CRP Resolution ──────────────────────────────────────────────────

  private async handleCRP(request: Request): Promise<Response> {
    const body = await request.json() as {
      repoId: string
      amendmentId: string
      coherenceVerdictDetail: string
      hypothesisId: string
      divergenceIds: string[]
    }

    const crpId = `CRP-${body.repoId}-${Date.now()}`
    const item: CRPItem = {
      crpId,
      repoId: body.repoId,
      amendmentId: body.amendmentId,
      coherenceVerdict: body.coherenceVerdictDetail,
      status: 'pending',
      receivedAt: new Date().toISOString(),
    }

    // Add to CRP queue
    const queue = (await this.state.storage.get<CRPItem[]>('crp:queue')) ?? []
    queue.push(item)
    await this.state.storage.put('crp:queue', queue)

    // Attempt synchronous resolution
    const failureClass = await this.classifyCRPFailure(body.coherenceVerdictDetail)
    const resolved = await this.resolveCRP(crpId, failureClass, body)

    return Response.json({ crpId, status: resolved ? 'resolved' : 'in-resolution' })
  }

  private async classifyCRPFailure(verdictDetail: string): Promise<CRPFailureClass> {
    if (verdictDetail.includes('schema') || verdictDetail.includes('unknown type')) return 'SCHEMA_VIOLATION'
    if (verdictDetail.includes('invariant') || verdictDetail.includes('conflict')) return 'INVARIANT_CONFLICT'
    if (verdictDetail.includes('coverage') || verdictDetail.includes('detector')) return 'COVERAGE_GAP'
    if (verdictDetail.includes('lineage') || verdictDetail.includes('edge')) return 'LINEAGE_BREAK'
    return 'UNKNOWN'
  }

  private async resolveCRP(
    crpId: string,
    failureClass: CRPFailureClass,
    context: { repoId: string; amendmentId: string; coherenceVerdictDetail: string }
  ): Promise<boolean> {
    // TODO: implement resolution paths per SPEC §2.2
    // SCHEMA_VIOLATION → emit corrected AMD-* diff
    // INVARIANT_CONFLICT → check cross-repo; open Patch if so
    // COVERAGE_GAP → emit missing DetectorSpec
    // LINEAGE_BREAK → reconstruct missing edge
    // UNKNOWN → escalate to We-layer
    if (failureClass === 'UNKNOWN') {
      await this.escalateToWeLayer('CRPFail', { crpId, ...context })
      return false
    }
    return false // TODO: implement
  }

  // ── D1: Patch Governance ────────────────────────────────────────────────

  private async handlePatch(request: Request): Promise<Response> {
    const body = await request.json() as {
      changedArtifactId: string
      changeDescription: string
      authorizedBy: string
      urgency: 'normal' | 'emergency'
    }

    const patchId = `PATCH-${Date.now()}`

    // TODO: AQL traversal to find affected repos
    // TODO: Coherence Verification per repo
    // TODO: propagate to Commissioning Agents

    const patch: PatchRecord = {
      patchId,
      trigger: body.changedArtifactId,
      affectedRepoIds: [],   // populated after AQL traversal
      appliedToRepoIds: [],
      pendingRepoIds: [],
      status: 'propagating',
      issuedAt: new Date().toISOString(),
    }

    const registry = (await this.state.storage.get<PatchRecord[]>('patches:active')) ?? []
    registry.push(patch)
    await this.state.storage.put('patches:active', registry)

    return Response.json({ patchId, affectedRepoCount: 0, status: 'propagating' })
  }

  // ── D4: Pipeline Config Auth ────────────────────────────────────────────

  private async handlePipelineConfigAuth(request: Request): Promise<Response> {
    const body = await request.json() as {
      proposedConfigId: string
      affectedLiveRepoIds: string[]
      authorizedBy: string
      dispositionEventId: string
    }

    // TODO: fetch PIPELINE-CONFIG-* from ArangoDB
    // TODO: apply to DO hot storage
    // TODO: notify harness-bridge of updated routing

    return Response.json({ status: 'applied', configId: body.proposedConfigId })
  }

  // ── Override ───────────────────────────────────────────────────────────

  private async handleOverride(request: Request): Promise<Response> {
    const body = await request.json() as { action: string; authorizedBy: string }

    // TODO: validate elevated token scope (we-layer:override)

    const factoryState = await this.factoryState()
    factoryState.lifecycleState = body.action === 'force-suspend' ? 'EMERGENCY_SUSPEND' : 'ACTIVE'
    await this.state.storage.put('factory:state', factoryState)

    return Response.json({ status: 'override-applied' })
  }

  // ── Register / Deregister ──────────────────────────────────────────────

  private async handleRegisterRepo(request: Request): Promise<Response> {
    const body = await request.json() as { repoId: string; commissioningAgentUrl: string; mediationAgentDoKey: string }

    const state = await this.factoryState()
    const exists = state.activeRepos.find(r => r.repoId === body.repoId)
    if (!exists) {
      state.activeRepos.push({
        repoId: body.repoId,
        commissioningAgentUrl: body.commissioningAgentUrl,
        mediationAgentDoKey: body.mediationAgentDoKey,
        lastHealthPollAt: new Date().toISOString(),
        healthStatus: 'unknown',
        activeBlockingDivergences: 0,
        pendingCrpCount: 0,
      })
      await this.state.storage.put('factory:state', state)
    }

    return Response.json({ status: 'registered' })
  }

  private async handleDeregisterRepo(request: Request): Promise<Response> {
    const body = await request.json() as { repoId: string }
    const state = await this.factoryState()
    state.activeRepos = state.activeRepos.filter(r => r.repoId !== body.repoId)
    await this.state.storage.put('factory:state', state)
    return Response.json({ status: 'deregistered' })
  }

  // ── Health / Pipeline config ───────────────────────────────────────────

  private async handleHealth(): Promise<Response> {
    const state = await this.factoryState()
    const crpQueue = (await this.state.storage.get<{ items: { status: string }[] }>('crp:queue')) ?? { items: [] }
    const patches = (await this.state.storage.get<PatchRecord[]>('patches:active')) ?? []

    return Response.json({
      factoryLifecycleState: state.lifecycleState,
      activeRepoCount: state.activeRepos.length,
      repoHealthBreakdown: {
        healthy: state.activeRepos.filter(r => r.healthStatus === 'healthy').length,
        degraded: state.activeRepos.filter(r => r.healthStatus === 'degraded').length,
        suspended: state.activeRepos.filter(r => r.healthStatus === 'suspended').length,
        unknown: state.activeRepos.filter(r => r.healthStatus === 'unknown').length,
      },
      openEscalationCount: 0,  // TODO: read from ArangoDB
      activePatchCount: patches.filter(p => p.status === 'propagating').length,
      pendingCrpCount: crpQueue.items?.filter(i => i.status === 'pending').length ?? 0,
      pipelineConfigId: state.pipelineConfig?.configId ?? 'default',
    })
  }

  private async handleGetPipelineConfig(): Promise<Response> {
    const state = await this.factoryState()
    return Response.json(state.pipelineConfig)
  }

  // ── Cross-repo anomaly scan (alarm) ────────────────────────────────────

  private async runAnomalyScan(): Promise<void> {
    // TODO: AQL query for cross-repo failure patterns (SPEC §4)
    // Pattern thresholds:
    //   pass failure rate > 15% across 3+ repos in 1h → D4 trigger
    //   Amendment Coherence failures > 5 in 1h → D2 triage
    //   Patch stalled > 30 min → D1 escalation check
  }

  private async checkPatchPropagation(): Promise<void> {
    // TODO: check active patches for timeout; escalate if stalled
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private async factoryState(): Promise<FactoryState> {
    return (await this.state.storage.get<FactoryState>('factory:state')) ?? {
      activeRepos: [],
      pipelineConfig: defaultPipelineConfig(),
      lifecycleState: 'ACTIVE',
    }
  }

  private async escalateToWeLayer(type: string, evidence: unknown): Promise<void> {
    await fetch(`${this.env.WEOPS_GATEWAY_URL}/escalations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        signalType: 'EscalationEvent',
        sourceAgent: 'ArchitectAgentDO',
        sourceId: 'factory',
        escalationType: type,
        evidence,
        issuedAt: new Date().toISOString(),
      }),
    })
  }
}

function defaultPipelineConfig(): PipelineConfig {
  return {
    configId: 'default',
    passRouting: [],
    gateThresholds: {
      coherenceMinCoverage: 1.0,
      fidelityMaxOpenBlockingDivergences: 0,
      assuranceMaxDetectorStalenessHours: 24,
    },
    verticalSlicePolicy: {
      atomRetryIsolation: true,
      maxAtomRetries: 3,
      parallelSliceThreshold: 4,
      dagDispatchEnabled: false,
    },
    effectiveFrom: new Date().toISOString(),
    reason: 'default',
  }
}
