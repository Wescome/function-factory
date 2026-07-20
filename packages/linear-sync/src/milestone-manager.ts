/**
 * @factory/linear-sync — milestone-manager
 *
 * D1 CRUD for `workgraph_milestone_bindings`.
 * On each P1 atom-projection call, resolves (or creates) the Linear milestone
 * that corresponds to a WorkGraph version string.
 *
 * Schema: workers/ff-pipeline/d1-factory-artifacts.sql
 */

import type { LinearClient } from './linear-client.js'

export interface MilestoneBinding {
  work_graph_version: string
  work_graph_id: string
  linear_milestone_id: string
  linear_milestone_name: string
  repo_id: string
  created_at: string
  updated_at: string
}

// ── Reads ──────────────────────────────────────────────────────────────────

export async function getMilestoneBinding(
  db: D1Database,
  workGraphVersion: string,
): Promise<MilestoneBinding | null> {
  const result = await db
    .prepare('SELECT * FROM workgraph_milestone_bindings WHERE work_graph_version = ?')
    .bind(workGraphVersion)
    .first<MilestoneBinding>()
  return result ?? null
}

export async function getMilestoneBindingsByRepo(
  db: D1Database,
  repoId: string,
): Promise<MilestoneBinding[]> {
  const result = await db
    .prepare('SELECT * FROM workgraph_milestone_bindings WHERE repo_id = ?')
    .bind(repoId)
    .all<MilestoneBinding>()
  return result.results
}

// ── Writes ─────────────────────────────────────────────────────────────────

export async function upsertMilestoneBinding(
  db: D1Database,
  binding: Omit<MilestoneBinding, 'created_at' | 'updated_at'>,
): Promise<void> {
  const now = new Date().toISOString()
  await db
    .prepare(`
      INSERT INTO workgraph_milestone_bindings
        (work_graph_version, work_graph_id, linear_milestone_id, linear_milestone_name, repo_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (work_graph_version) DO UPDATE SET
        linear_milestone_id   = excluded.linear_milestone_id,
        linear_milestone_name = excluded.linear_milestone_name,
        updated_at            = excluded.updated_at
    `)
    .bind(
      binding.work_graph_version,
      binding.work_graph_id,
      binding.linear_milestone_id,
      binding.linear_milestone_name,
      binding.repo_id,
      now,
      now,
    )
    .run()
}

// ── Resolve or create ──────────────────────────────────────────────────────

/**
 * Returns the Linear milestone ID for a given WorkGraph version.
 * Creates a new milestone (via Linear API) and persists the binding if none exists.
 */
export async function resolveOrCreateMilestone(
  db: D1Database,
  client: LinearClient,
  opts: {
    workGraphVersion: string
    workGraphId: string
    repoId: string
    projectId: string
    milestoneName?: string
  },
): Promise<string> {
  const existing = await getMilestoneBinding(db, opts.workGraphVersion)
  if (existing) return existing.linear_milestone_id

  const name = opts.milestoneName ?? `WorkGraph ${opts.workGraphVersion}`
  const milestone = await client.projectMilestoneCreate({
    projectId: opts.projectId,
    name,
  })

  await upsertMilestoneBinding(db, {
    work_graph_version: opts.workGraphVersion,
    work_graph_id: opts.workGraphId,
    linear_milestone_id: milestone.id,
    linear_milestone_name: milestone.name,
    repo_id: opts.repoId,
  })

  return milestone.id
}
