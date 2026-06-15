/**
 * @factory/architect-agent — D4: Pipeline Configuration
 *
 * Manages PipelineConfig: pass routing, gate thresholds, vslice policy.
 * Live-repo changes require We-layer authorization (held pending auth).
 * Writes PIPELINE-CONFIG and ELUCIDATION governance artifacts to ArtifactGraphDO.
 */

import type {
  PipelineConfig,
  PipelineConfigRow,
  PassRoutingConfig,
  GateThresholdConfig,
  VsliceConfig,
  RepoRow,
} from '../types.js'
import { writeGovernanceArtifact } from '../artifact-graph.js'
import { getActiveVsliceConfig } from './d3-vertical-slice-policy.js'

const PIPELINE_CONFIG_PREFIX = 'PIPELINE-CONFIG-'
const ELC_PREFIX = 'ELC-'

function generatePipelineConfigId(): string {
  return `${PIPELINE_CONFIG_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`
}

function generateElcId(): string {
  return `${ELC_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`
}

export function rowToPipelineConfig(row: PipelineConfigRow, vslice: VsliceConfig | null): PipelineConfig {
  const passRouting = JSON.parse(row.pass_routing) as PassRoutingConfig[]
  const vslicePolicy: VsliceConfig = vslice ?? {
    configId: 'default',
    atomRetryIsolation: true,
    maxAtomRetries: 3,
    parallelSliceThreshold: 5,
    dagDispatchEnabled: true,
    triggerReason: 'default',
    effectiveFrom: row.effective_from,
  }
  return {
    configId: row.config_id,
    passRouting,
    gateThresholds: {
      coherenceMinCoverage: row.coherence_min_coverage,
      fidelityMaxOpenBlockingDivergences: row.fidelity_max_open_blocking_divs,
      assuranceMaxDetectorStalenessHours: row.assurance_max_detector_staleness,
    },
    verticalSlicePolicy: vslicePolicy,
    effectiveFrom: row.effective_from,
    reason: row.reason,
  }
}

export function getActivePipelineConfig(sql: SqlStorage): PipelineConfig | null {
  const rows = [...sql.exec(
    'SELECT * FROM pipeline_configs WHERE superseded_at IS NULL ORDER BY effective_from DESC LIMIT 1',
  )] as unknown as PipelineConfigRow[]
  if (rows.length === 0 || !rows[0]) return null
  const vslice = getActiveVsliceConfig(sql)
  return rowToPipelineConfig(rows[0], vslice)
}

export interface PipelineConfigUpdateRequest {
  passRouting?: PassRoutingConfig[]
  gateThresholds?: Partial<GateThresholdConfig>
  reason: string
  anomalyEvidenceIds?: string[]
  authorizedBy: string
}

export interface D4PipelineConfigDeps {
  sql: SqlStorage
  artifactGraph: DurableObjectStub
  repos: RepoRow[]
  weopsGatewayUrl: string
  harnessUrl: string
  compilerUrl: string
}

/**
 * Apply a pipeline config update.
 *
 * If repos are registered (live), insert a WEOPS_AUTH_REQUIRED anomaly and
 * hold the change pending We-layer authorization (v1: always holds on live repos).
 *
 * If no repos are registered (pre-production), apply immediately.
 */
export async function applyPipelineConfigUpdate(
  req: PipelineConfigUpdateRequest,
  deps: D4PipelineConfigDeps,
): Promise<{ configId: string; status: 'applied' | 'pending-weops-auth' }> {
  const { sql, artifactGraph, repos, weopsGatewayUrl } = deps

  const hasLiveRepos = repos.length > 0
  if (hasLiveRepos) {
    // Hold pending We-layer authorization
    const anomalyId = `ANOMALY-WEOPS-AUTH-${Date.now()}`
    const now = new Date().toISOString()
    sql.exec(
      `INSERT INTO anomaly_records (anomaly_id, anomaly_class, domain, evidence, triggered_at, resolved)
       VALUES (?, 'WEOPS_AUTH_REQUIRED', 'D4', ?, ?, 0)`,
      anomalyId,
      JSON.stringify({ reason: req.reason, authorizedBy: req.authorizedBy }),
      now,
    )

    // Notify WeOps gateway
    void fetch(`${weopsGatewayUrl}/escalation/pipeline-config-auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        anomalyId,
        reason: req.reason,
        authorizedBy: req.authorizedBy,
        requestedAt: now,
      }),
    }).catch((err) => {
      console.warn('[ArchitectAgentDO:D4] WeOps gateway notification failed:', err)
    })

    return { configId: anomalyId, status: 'pending-weops-auth' }
  }

  return applyPipelineConfigImmediately(req, deps)
}

export async function applyPipelineConfigImmediately(
  req: PipelineConfigUpdateRequest,
  deps: D4PipelineConfigDeps,
): Promise<{ configId: string; status: 'applied' }> {
  const { sql, artifactGraph, repos, harnessUrl, compilerUrl } = deps

  const configId = generatePipelineConfigId()
  const now = new Date().toISOString()

  const current = getActivePipelineConfig(sql)
  const currentVslice = getActiveVsliceConfig(sql)

  // Merge with current config
  const passRouting: PassRoutingConfig[] =
    req.passRouting ??
    current?.passRouting ??
    buildDefaultPassRouting()

  const gateThresholds: GateThresholdConfig = {
    coherenceMinCoverage: req.gateThresholds?.coherenceMinCoverage ?? current?.gateThresholds.coherenceMinCoverage ?? 1.0,
    fidelityMaxOpenBlockingDivergences:
      req.gateThresholds?.fidelityMaxOpenBlockingDivergences ??
      current?.gateThresholds.fidelityMaxOpenBlockingDivergences ??
      0,
    assuranceMaxDetectorStalenessHours:
      req.gateThresholds?.assuranceMaxDetectorStalenessHours ??
      current?.gateThresholds.assuranceMaxDetectorStalenessHours ??
      24,
  }

  // 1. Retire current config
  sql.exec(
    `UPDATE pipeline_configs SET superseded_at = ? WHERE superseded_at IS NULL`,
    now,
  )

  // 2. Insert new config
  sql.exec(
    `INSERT INTO pipeline_configs
       (config_id, pass_routing, coherence_min_coverage, fidelity_max_open_blocking_divs,
        assurance_max_detector_staleness, effective_from, reason, anomaly_evidence_ids)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    configId,
    JSON.stringify(passRouting),
    gateThresholds.coherenceMinCoverage,
    gateThresholds.fidelityMaxOpenBlockingDivergences,
    gateThresholds.assuranceMaxDetectorStalenessHours,
    now,
    req.reason,
    JSON.stringify(req.anomalyEvidenceIds ?? []),
  )

  // 3. Update factory_state
  sql.exec(
    `UPDATE factory_state SET active_pipeline_cfg = ?, updated_at = ? WHERE factory_id = 'factory'`,
    configId,
    now,
  )

  const newConfig: PipelineConfig = {
    configId,
    passRouting,
    gateThresholds,
    verticalSlicePolicy: currentVslice ?? {
      configId: 'default',
      atomRetryIsolation: true,
      maxAtomRetries: 3,
      parallelSliceThreshold: 5,
      dagDispatchEnabled: true,
      triggerReason: 'default',
      effectiveFrom: now,
    },
    effectiveFrom: now,
    reason: req.reason,
  }

  // 4. Write PIPELINE-CONFIG governance artifact
  void writeGovernanceArtifact(artifactGraph, {
    type: 'PIPELINE-CONFIG',
    id: configId,
    domain: 'D4',
    source: 'architect-agent',
    explicitness: 'stated',
    payload: { ...newConfig },
  })

  // 5. Write ELUCIDATION artifact (DeepSeek Flash model routing — v1 stub)
  const elcId = generateElcId()
  void writeGovernanceArtifact(artifactGraph, {
    type: 'ELUCIDATION',
    id: elcId,
    domain: 'D4',
    source: 'architect-agent',
    explicitness: 'stated',
    payload: {
      pipelineConfigId: configId,
      summary: `Pipeline config updated: ${req.reason}`,
      modelUsed: 'deepseek-flash',
      generatedAt: now,
    },
  })

  // 6. Notify harness and compiler
  void notifyConfigConsumers(newConfig, harnessUrl, compilerUrl, repos)

  return { configId, status: 'applied' }
}

async function notifyConfigConsumers(
  config: PipelineConfig,
  harnessUrl: string,
  compilerUrl: string,
  repos: RepoRow[],
): Promise<void> {
  const body = JSON.stringify({ pipelineConfig: config, updatedAt: new Date().toISOString() })

  await Promise.allSettled([
    fetch(`${harnessUrl}/pipeline-config`, {
      method: 'GET',  // Harness polls GET /pipeline-config on notification
    }),
    fetch(`${compilerUrl}/pipeline-config`, {
      method: 'GET',
    }),
    ...repos.map((repo) =>
      fetch(`${repo.commissioning_agent_url}/pipeline-config-update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      }),
    ),
  ])
}

function buildDefaultPassRouting(): PassRoutingConfig[] {
  return Array.from({ length: 8 }, (_, i) => ({
    passId: `pass-${i + 1}`,
    model: 'gpt-5-5' as const,
    fallback: 'claude-opus' as const,
    maxRetries: 3,
  }))
}
