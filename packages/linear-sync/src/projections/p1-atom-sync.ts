/**
 * @factory/linear-sync — P1: Atom Projection
 *
 * POST /sync/atoms (creation path)
 *
 * For each AtomDirective in the request:
 *   1. Check idempotency (linear_bindings by atomId)
 *   2. Resolve or create WorkGraph milestone
 *   3. Create Linear issue (issueCreate)
 *   4. Create dependency relation links (issueRelationCreate)
 *   5. Persist binding in D1 (linear_bindings upsert)
 *   6. Write IssueBindingEvent node to ArtifactGraphDO
 *
 * Superseded atoms (version change): apply factory:superseded label + cancel state.
 */

import type { Env } from '../env.js'
import type { LinearClient } from '../linear-client.js'
import { getBinding, upsertBinding } from '../binding-store.js'
import { resolveOrCreateMilestone } from '../milestone-manager.js'
import { logSyncError } from '../error-log.js'

// ── Request/Response types ─────────────────────────────────────────────────

export interface AtomDirectiveRef {
  atomId: string
  instruction: string
  permittedTools: string[]
  dependsOn: string[]  // atomIds this atom depends on
}

export interface AtomSyncRequest {
  runId: string
  repoId: string
  workGraphId: string
  workGraphVersion: string
  policyBeadId: string
  projectId: string
  milestoneId?: string  // optional — resolved via milestone-manager if absent
  atoms: AtomDirectiveRef[]
  elucidationArtifactId?: string  // ELC-* traceability node
}

export interface AtomSyncResult {
  created: string[]    // atomIds that got new issues
  skipped: string[]    // atomIds that already had bindings
  errors: string[]     // atomIds that failed
}

// ── Handler ────────────────────────────────────────────────────────────────

export async function handleAtomSync(
  req: AtomSyncRequest,
  env: Env,
  client: LinearClient,
  labelCache: Map<string, string>,   // label name → Linear label UUID
  stateCache: Map<string, string>,   // state name → Linear state UUID
): Promise<AtomSyncResult> {
  const result: AtomSyncResult = { created: [], skipped: [], errors: [] }

  // Resolve milestone for this WorkGraph version
  let milestoneId = req.milestoneId
  if (!milestoneId) {
    try {
      milestoneId = await resolveOrCreateMilestone(
        env.FACTORY_ARTIFACTS_DB,
        client,
        {
          workGraphVersion: req.workGraphVersion,
          workGraphId: req.workGraphId,
          repoId: req.repoId,
          projectId: req.projectId,
        },
      )
    } catch (err) {
      await logSyncError(env.FACTORY_OPS_DB, {
        errorType: 'milestone_resolution_failed',
        errorDetail: String(err),
        endpoint: '/sync/atoms',
      })
      // Non-fatal: continue without milestone
    }
  }

  // Build atomId → Linear internal ID map for dependency linking
  const atomIdToInternalId = new Map<string, string>()

  // First pass: create issues for atoms that don't yet have bindings
  for (const atom of req.atoms) {
    const existing = await getBinding(env.FACTORY_ARTIFACTS_DB, atom.atomId)
    if (existing) {
      atomIdToInternalId.set(atom.atomId, existing.linear_issue_internal_id)
      result.skipped.push(atom.atomId)
      continue
    }

    try {
      const description = buildAtomDescription(atom, req)
      const issue = await client.issueCreate({
        teamId: env.LINEAR_TEAM_ID,
        title: atom.instruction,
        description,
        projectId: req.projectId,
        ...(milestoneId !== undefined ? { projectMilestoneId: milestoneId } : {}),
      })

      atomIdToInternalId.set(atom.atomId, issue.id)

      await upsertBinding(env.FACTORY_ARTIFACTS_DB, {
        factoryArtifactId: atom.atomId,
        linearIssueId: issue.identifier,
        linearIssueInternalId: issue.id,
        bindingType: 'atom',
        workGraphVersion: req.workGraphVersion,
      })

      // Write IssueBindingEvent to ArtifactGraphDO
      await writeIssueBindingEvent(env, {
        atomId: atom.atomId,
        runId: req.runId,
        linearIssueId: issue.identifier,
        linearIssueInternalId: issue.id,
        workGraphVersion: req.workGraphVersion,
      })

      result.created.push(atom.atomId)
    } catch (err) {
      await logSyncError(env.FACTORY_OPS_DB, {
        factoryArtifactId: atom.atomId,
        errorType: 'issue_create_failed',
        errorDetail: String(err),
        endpoint: '/sync/atoms',
      })
      result.errors.push(atom.atomId)
    }
  }

  // Second pass: create dependency relation links
  for (const atom of req.atoms) {
    if (atom.dependsOn.length === 0) continue
    const issueId = atomIdToInternalId.get(atom.atomId)
    if (!issueId) continue

    for (const depAtomId of atom.dependsOn) {
      const depIssueId = atomIdToInternalId.get(depAtomId)
      if (!depIssueId) continue

      try {
        await client.issueRelationCreate({
          issueId,
          relatedIssueId: depIssueId,
          type: 'blocks',
        })
      } catch (err) {
        // Non-fatal: log but don't fail the atom sync
        await logSyncError(env.FACTORY_OPS_DB, {
          factoryArtifactId: atom.atomId,
          errorType: 'relation_create_failed',
          errorDetail: String(err),
          endpoint: '/sync/atoms',
        })
      }
    }
  }

  // Mark superseded atoms from prior versions
  await supersedePriorVersionAtoms(req, env, client, labelCache, stateCache)

  return result
}

// ── Helpers ────────────────────────────────────────────────────────────────

function buildAtomDescription(atom: AtomDirectiveRef, req: AtomSyncRequest): string {
  const lines: string[] = [
    `**Atom ID:** \`${atom.atomId}\``,
    `**WorkGraph:** \`${req.workGraphId}\` v\`${req.workGraphVersion}\``,
    `**Run:** \`${req.runId}\``,
  ]
  if (req.elucidationArtifactId) {
    lines.push(`**Elucidation:** \`${req.elucidationArtifactId}\``)
  }
  if (atom.permittedTools.length > 0) {
    lines.push(`**Permitted tools:** ${atom.permittedTools.join(', ')}`)
  }
  if (atom.dependsOn.length > 0) {
    lines.push(`**Depends on:** ${atom.dependsOn.join(', ')}`)
  }
  return lines.join('\n')
}

async function supersedePriorVersionAtoms(
  req: AtomSyncRequest,
  env: Env,
  client: LinearClient,
  labelCache: Map<string, string>,
  stateCache: Map<string, string>,
): Promise<void> {
  // Fetch all atoms bound to this WorkGraph (any version except current)
  const allBindings = await env.FACTORY_ARTIFACTS_DB
    .prepare(`
      SELECT * FROM linear_bindings
      WHERE binding_type = 'atom'
        AND work_graph_version != ?
        AND factory_artifact_id NOT IN (${req.atoms.map(() => '?').join(',')})
    `)
    .bind(req.workGraphVersion, ...req.atoms.map((a) => a.atomId))
    .all<{ factory_artifact_id: string; linear_issue_internal_id: string }>()

  const supersededLabelId = labelCache.get('factory:superseded')
  const cancelledStateId = stateCache.get('Cancelled')

  for (const binding of allBindings.results) {
    try {
      const updateInput: { stateId?: string; labelIds?: string[] } = {}
      if (cancelledStateId) updateInput.stateId = cancelledStateId
      if (supersededLabelId) updateInput.labelIds = [supersededLabelId]

      if (Object.keys(updateInput).length > 0) {
        await client.issueUpdate(binding.linear_issue_internal_id, updateInput)
      }
    } catch {
      // Non-fatal — superseding is best-effort
    }
  }
}

interface IssueBindingEventInput {
  atomId: string
  runId: string
  linearIssueId: string
  linearIssueInternalId: string
  workGraphVersion: string
}

async function writeIssueBindingEvent(
  env: Env,
  input: IssueBindingEventInput,
): Promise<void> {
  try {
    const stub = env.ARTIFACT_GRAPH.get(env.ARTIFACT_GRAPH.idFromName('factory'))
    await stub.fetch('http://internal/append', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodeType: 'IssueBindingEvent',
        data: {
          atomId: input.atomId,
          runId: input.runId,
          linearIssueId: input.linearIssueId,
          linearIssueInternalId: input.linearIssueInternalId,
          workGraphVersion: input.workGraphVersion,
          producedAt: new Date().toISOString(),
        },
      }),
    })
  } catch (err) {
    // Non-fatal — ArtifactGraphDO write failure should not block the sync
    console.warn('[p1-atom-sync] Failed to write IssueBindingEvent:', err)
  }
}
