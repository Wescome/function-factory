// Mediation Agent Durable Object
// SPEC-MEDIATION-AGENT-DO-001 v2.0
// One instance per repo — do-key: mediation-agent:{repoId}

import type {
  DOEvent,
  RepoState,
  LogMeta,
  CommissionPayload,
  TracePayload,
  DivergencePayload,
  LifecyclePayload,
  VerdictPayload,
  FlushPayload,
  SnapshotPayload,
  AgentLifecycleState,
  DetectorResult,
} from './types.js'

// Env bindings — see SPEC §10
export type Env = {
  ARANGO_URL: string
  ARANGO_DB: string
  ARANGO_TOKEN: string
  COMMISSIONING_AGENT_URL: string
  SANDBOX_OUTPUT_BUCKET: R2Bucket
  STALENESS_THRESHOLD_HOURS: string
  SNAPSHOT_INTERVAL_EVENTS: string
  FLUSH_INTERVAL_MS: string
  FLUSH_BUFFER_THRESHOLD: string
}

const SHARD_SIZE = 100
const DEFAULT_STALENESS_HOURS = 24
const DEFAULT_SNAPSHOT_INTERVAL = 500
const DEFAULT_FLUSH_THRESHOLD = 50

export class MediationAgentDO implements DurableObject {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const method = request.method

    if (method === 'POST' && url.pathname === '/commission') return this.handleCommission(request)
    if (method === 'POST' && url.pathname === '/dispatch') return this.handleDispatch(request)
    if (method === 'POST' && url.pathname === '/trace') return this.handleTrace(request)
    if (method === 'GET'  && url.pathname === '/state') return this.handleState()
    if (method === 'POST' && url.pathname === '/suspend') return this.handleSuspend(request)
    if (method === 'POST' && url.pathname === '/resume') return this.handleResume(request)
    if (method === 'POST' && url.pathname === '/close-divergence') return this.handleCloseDivergence(request)

    return new Response('Not found', { status: 404 })
  }

  async alarm(): Promise<void> {
    const repoState = await this.reconstructState()

    // Staleness check — I3 enforcement
    const staleness = Number(this.env.STALENESS_THRESHOLD_HOURS ?? DEFAULT_STALENESS_HOURS)
    const lastCommission = new Date(repoState.lastCommissionAt).getTime()
    const staleAt = lastCommission + staleness * 60 * 60 * 1000

    if (Date.now() > staleAt && repoState.lifecycleState === 'ACTIVE') {
      await this.appendEvent({
        type: 'LifecycleEvent',
        payload: {
          state: 'DEGRADED',
          reason: 'staleness-alarm',
          triggeredBy: 'alarm',
        } satisfies LifecyclePayload,
      })
    }

    // Trace flush
    await this.flushToArango(repoState)

    // Re-arm alarm
    await this.state.storage.setAlarm(
      Date.now() + Number(this.env.FLUSH_INTERVAL_MS ?? 60_000)
    )
  }

  // ── Handlers ─────────────────────────────────────────────────────────────

  private async handleCommission(request: Request): Promise<Response> {
    const body = await request.json() as {
      workGraphId: string
      workGraphVersion: string
      arangoLineageRefs: string[]
      stalenessThresholdHours?: number
    }

    // TODO: fetch WorkGraph from ArangoDB using body.arangoLineageRefs
    // TODO: compile AtomDirective[] (SPEC-CONDUCTING-AGENT-001 §1.4)
    // TODO: run Coherence Verification

    // Stub: emit LifecycleEvent + CommissionEvent
    await this.appendEvent({
      type: 'VerdictEvent',
      payload: {
        verdictType: 'coherence',
        value: 'favorable',
        workGraphVersion: body.workGraphVersion,
      } satisfies VerdictPayload,
    })

    await this.appendEvent({
      type: 'CommissionEvent' as const,
      payload: {
        workGraphId: body.workGraphId,
        workGraphVersion: body.workGraphVersion,
        policyBeadId: `BEAD-ARCH-${body.workGraphVersion}`,
        atoms: [],          // populated after compile step
        detectorSpecs: [],  // populated after compile step
        agentsMd: '',       // populated after compile step
        sourceRefs: body.arangoLineageRefs,
        committedBy: 'commissioning-agent',
        stalenessThresholdHours: body.stalenessThresholdHours ?? DEFAULT_STALENESS_HOURS,
      } satisfies CommissionPayload,
    })

    await this.appendEvent({
      type: 'LifecycleEvent',
      payload: {
        state: 'ACTIVE',
        reason: 'commission-success',
        triggeredBy: 'commission',
      } satisfies LifecyclePayload,
    })

    // Arm staleness alarm
    const threshold = (body.stalenessThresholdHours ?? DEFAULT_STALENESS_HOURS) * 60 * 60 * 1000
    await this.state.storage.setAlarm(Date.now() + threshold)

    return Response.json({
      status: 'commissioned',
      policyBeadId: `BEAD-ARCH-${body.workGraphVersion}`,
      workGraphVersion: body.workGraphVersion,
    })
  }

  private async handleDispatch(request: Request): Promise<Response> {
    const repoState = await this.reconstructState()

    // I2 — Retrieval enforcement + I4 — Fail-closed
    if (repoState.lifecycleState !== 'ACTIVE') {
      return Response.json({ status: 'blocked', lifecycleState: repoState.lifecycleState })
    }
    if (repoState.coherenceVerdict.value !== 'favorable') {
      return Response.json({ status: 'blocked', reason: 'coherence-unfavorable' })
    }

    const body = await request.json() as { executionId: string; sessionId: string; requestedAtomRef?: string }

    // TODO: write EngineerRoleBead for this session to ArangoDB
    // TODO: DAG-aware atom selection from repoState.atoms

    const atom = repoState.atoms.find(a => !body.requestedAtomRef || a.atomRef === body.requestedAtomRef)
      ?? repoState.atoms[0]

    if (!atom) {
      return Response.json({ status: 'complete' })
    }

    return Response.json({
      status: 'dispatched',
      atom,
      policyBeadId: repoState.policyBeadId,
    })
  }

  private async handleTrace(request: Request): Promise<Response> {
    const body = await request.json() as TracePayload

    await this.appendEvent({ type: 'TraceEvent', payload: body })

    // Run detectors synchronously
    const repoState = await this.reconstructState()
    const divergences: DivergencePayload[] = []

    for (const spec of repoState.detectorSpecs) {
      let fired = false
      if (spec.pattern && new RegExp(spec.pattern).test(body.rawOutput)) fired = true
      if (spec.exitCode !== undefined) {
        const dr = body.detectorResults.find(r => r.detectorId === spec.detectorId)
        if (dr?.fired) fired = true
      }

      if (fired) {
        const severity = spec.severity === 'critical' ? 'blocking'
          : spec.severity === 'warning' ? 'advisory'
          : 'informational'

        const div: DivergencePayload = {
          divergenceId: `DIV-${body.atomRef}-${Date.now()}`,
          atomRef: body.atomRef,
          detectorId: spec.detectorId,
          severity,
          evidence: String(await this.currentSeq()),
        }

        divergences.push(div)
        await this.appendEvent({ type: 'DivergenceEvent', payload: div })

        if (severity === 'blocking') {
          await this.appendEvent({
            type: 'VerdictEvent',
            payload: {
              verdictType: 'fidelity',
              value: 'unfavorable',
              reason: `Blocking divergence: ${spec.detectorId}`,
              workGraphVersion: repoState.workGraphVersion,
            } satisfies VerdictPayload,
          })
        }
      }
    }

    // Auto-flush check
    const threshold = Number(this.env.FLUSH_BUFFER_THRESHOLD ?? DEFAULT_FLUSH_THRESHOLD)
    const pendingCount = await this.pendingTraceCount()
    if (pendingCount >= threshold) await this.flushToArango(repoState)

    return Response.json({
      status: 'recorded',
      divergencesDetected: divergences.length,
      blockingCount: divergences.filter(d => d.severity === 'blocking').length,
    })
  }

  private async handleState(): Promise<Response> {
    const s = await this.reconstructState()
    const meta = await this.logMeta()

    return Response.json({
      lifecycleState: s.lifecycleState,
      workGraphVersion: s.workGraphVersion,
      policyBeadId: s.policyBeadId,
      coherenceVerdict: s.coherenceVerdict,
      fidelityVerdict: s.fidelityVerdict,
      openDivergences: {
        // TODO: classify from s.openDivergenceIds
        blocking: 0,
        advisory: 0,
        informational: 0,
      },
      eventLogDepth: meta.totalEvents,
      lastFlushAt: '', // TODO: derive from FlushEvent
    })
  }

  private async handleSuspend(request: Request): Promise<Response> {
    await this.appendEvent({
      type: 'LifecycleEvent',
      payload: { state: 'SUSPENDED', reason: 'explicit-suspend', triggeredBy: 'suspend' } satisfies LifecyclePayload,
    })
    return Response.json({ status: 'suspended' })
  }

  private async handleResume(request: Request): Promise<Response> {
    // Resume requires re-commission — handled by Commissioning Agent
    return Response.json({ status: 'awaiting-commission' })
  }

  private async handleCloseDivergence(request: Request): Promise<Response> {
    const body = await request.json() as { divergenceId: string; closedBy: string }
    await this.appendEvent({
      type: 'DivergenceClosedEvent',
      payload: { divergenceId: body.divergenceId, closedBy: body.closedBy, closedAt: new Date().toISOString() },
    })
    return Response.json({ status: 'closed' })
  }

  // ── Event log ─────────────────────────────────────────────────────────────

  private async appendEvent(event: Omit<DOEvent, 'seq' | 'producedAt'>): Promise<void> {
    await this.state.storage.transaction(async txn => {
      const meta = (await txn.get<LogMeta>('log:meta')) ?? { currentShard: 0, totalEvents: 0, lastSnapshotSeq: 0 }
      const seq = meta.totalEvents
      const full: DOEvent = { seq, producedAt: new Date().toISOString(), ...event }

      const shardKey = `log:shard:${meta.currentShard}`
      const shard = (await txn.get<DOEvent[]>(shardKey)) ?? []
      shard.push(full)

      const newShard = shard.length >= SHARD_SIZE ? meta.currentShard + 1 : meta.currentShard
      await txn.put(shardKey, shard)
      await txn.put('log:meta', { ...meta, totalEvents: seq + 1, currentShard: newShard })
    })

    // Write snapshot periodically
    const meta = await this.logMeta()
    const snapshotInterval = Number(this.env.SNAPSHOT_INTERVAL_EVENTS ?? DEFAULT_SNAPSHOT_INTERVAL)
    if (meta.totalEvents % snapshotInterval === 0) await this.writeSnapshot()
  }

  private async reconstructState(): Promise<RepoState> {
    const meta = await this.logMeta()

    // Check for recent snapshot first
    const snapshot = await this.state.storage.get<SnapshotPayload>('snapshot:latest')

    // Read last 200 events (configurable)
    const events = await this.readRecentEvents(200)

    // Start from snapshot if available and recent
    let state: RepoState = snapshot
      ? this.stateFromSnapshot(snapshot)
      : this.emptyState()

    // Apply events after snapshot seq
    for (const event of events) {
      if (snapshot && event.seq <= snapshot.atSeq) continue
      state = this.applyEvent(state, event)
    }

    return state
  }

  private applyEvent(state: RepoState, event: DOEvent): RepoState {
    switch (event.type) {
      case 'CommissionEvent': {
        const p = event.payload as CommissionPayload
        return { ...state, workGraphVersion: p.workGraphVersion, policyBeadId: p.policyBeadId, atoms: p.atoms, detectorSpecs: p.detectorSpecs, agentsMd: p.agentsMd, lastCommissionAt: event.producedAt, stalenessThresholdHours: p.stalenessThresholdHours }
      }
      case 'LifecycleEvent': {
        const p = event.payload as LifecyclePayload
        return { ...state, lifecycleState: p.state }
      }
      case 'VerdictEvent': {
        const p = event.payload as VerdictPayload
        const verdict = p.reason !== undefined ? { value: p.value, reason: p.reason } : { value: p.value }
        if (p.verdictType === 'coherence') return { ...state, coherenceVerdict: verdict }
        return { ...state, fidelityVerdict: verdict }
      }
      case 'DivergenceEvent': {
        const p = event.payload as DivergencePayload
        return { ...state, openDivergenceIds: [...state.openDivergenceIds, p.divergenceId] }
      }
      case 'DivergenceClosedEvent': {
        const p = event.payload as { divergenceId: string }
        return { ...state, openDivergenceIds: state.openDivergenceIds.filter(id => id !== p.divergenceId) }
      }
      case 'FlushEvent': {
        const p = event.payload as FlushPayload
        return { ...state, lastFlushSeq: p.flushedSeqRange[1] }
      }
      default: return state
    }
  }

  private emptyState(): RepoState {
    return {
      lifecycleState: 'UNINITIALIZED',
      workGraphVersion: '',
      policyBeadId: '',
      atoms: [],
      detectorSpecs: [],
      agentsMd: '',
      coherenceVerdict: { value: 'pending' },
      fidelityVerdict: { value: 'pending' },
      openDivergenceIds: [],
      lastCommissionAt: new Date(0).toISOString(),
      stalenessThresholdHours: DEFAULT_STALENESS_HOURS,
      lastFlushSeq: -1,
    }
  }

  private stateFromSnapshot(s: SnapshotPayload): RepoState {
    return {
      ...this.emptyState(),
      lifecycleState: s.lifecycleState as AgentLifecycleState,
      workGraphVersion: s.workGraphVersion,
      openDivergenceIds: s.openDivergenceIds,
      coherenceVerdict: { value: s.coherenceVerdict as 'favorable' | 'unfavorable' | 'pending' },
      fidelityVerdict: { value: s.fidelityVerdict as 'favorable' | 'unfavorable' | 'pending' },
    }
  }

  private async writeSnapshot(): Promise<void> {
    const state = await this.reconstructState()
    const meta = await this.logMeta()
    const snapshot: SnapshotPayload = {
      atSeq: meta.totalEvents - 1,
      lifecycleState: state.lifecycleState,
      workGraphVersion: state.workGraphVersion,
      openDivergenceIds: state.openDivergenceIds,
      coherenceVerdict: state.coherenceVerdict.value,
      fidelityVerdict: state.fidelityVerdict.value,
    }
    await this.state.storage.put('snapshot:latest', snapshot)
    await this.appendEvent({ type: 'SnapshotEvent', payload: snapshot })
  }

  private async readRecentEvents(n: number): Promise<DOEvent[]> {
    const meta = await this.logMeta()
    const events: DOEvent[] = []
    let shard = meta.currentShard

    while (events.length < n && shard >= 0) {
      const chunk = (await this.state.storage.get<DOEvent[]>(`log:shard:${shard}`)) ?? []
      events.unshift(...chunk)
      shard--
    }

    return events.slice(-n)
  }

  private async logMeta(): Promise<LogMeta> {
    return (await this.state.storage.get<LogMeta>('log:meta')) ?? { currentShard: 0, totalEvents: 0, lastSnapshotSeq: 0 }
  }

  private async currentSeq(): Promise<number> {
    const meta = await this.logMeta()
    return meta.totalEvents - 1
  }

  private async pendingTraceCount(): Promise<number> {
    const state = await this.reconstructState()
    const meta = await this.logMeta()
    return meta.totalEvents - state.lastFlushSeq - 1
  }

  // ── ArangoDB flush ────────────────────────────────────────────────────────

  private async flushToArango(_state: RepoState): Promise<void> {
    // TODO: implement Bead flush (SPEC-MEDIATION-AGENT-DO-001 §5.2)
    // CommitBead + BuildOutcomeBead + PatternTrustBead + AuditBead per pending TraceEvent
    // Single ArangoDB multi-document transaction
    // Append FlushEvent on success
  }
}
