import type { ArtifactNode, ArtifactEdge, LineageChain, PathResult, PathStep, RelType } from './types.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function toNode(row: Record<string, unknown>): ArtifactNode {
  return {
    id: row['id'] as string,
    type: row['type'] as string,
    data: JSON.parse(row['data'] as string) as Record<string, unknown>,
    ns: row['ns'] as string,
    created: row['created'] as number,
    updated: row['updated'] as number,
  };
}

function toEdge(row: Record<string, unknown>): ArtifactEdge {
  return {
    id: row['id'] as string,
    source: row['source'] as string,
    target: row['target'] as string,
    rel: row['rel'] as string,
    props: JSON.parse((row['props'] ?? row['properties'] ?? '{}') as string) as Record<string, unknown>,
    created: row['created'] as number,
  };
}

// ── Node CRUD ──────────────────────────────────────────────────────────────

export function upsertNode(
  sql: SqlStorage,
  id: string,
  type: string,
  ns: string,
  data: Record<string, unknown>
): ArtifactNode {
  const now = Date.now();
  const rows = [...sql.exec(
    `INSERT INTO nodes (id, type, ns, data, created, updated)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated = excluded.updated
     RETURNING *`,
    id, type, ns, JSON.stringify(data), now, now
  )];
  return toNode(rows[0] as Record<string, unknown>);
}

export function getNode(sql: SqlStorage, id: string): ArtifactNode | null {
  const rows = [...sql.exec('SELECT * FROM nodes WHERE id = ?', id)];
  return rows.length > 0 ? toNode(rows[0] as Record<string, unknown>) : null;
}

export function getNodesByType(
  sql: SqlStorage,
  ns: string,
  type: string,
  limit = 100,
  offset = 0
): ArtifactNode[] {
  return [...sql.exec(
    'SELECT * FROM nodes WHERE ns = ? AND type = ? ORDER BY created DESC LIMIT ? OFFSET ?',
    ns, type, limit, offset
  )].map(r => toNode(r as Record<string, unknown>));
}

// ── Edge CRUD ──────────────────────────────────────────────────────────────

export function upsertEdge(
  sql: SqlStorage,
  source: string,
  target: string,
  rel: RelType,
  props: Record<string, unknown> = {}
): ArtifactEdge {
  const id = `${source}::${rel}::${target}`;
  const now = Date.now();
  const rows = [...sql.exec(
    `INSERT INTO edges (id, source, target, rel, props, created)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(source, target, rel) DO UPDATE SET props = excluded.props
     RETURNING *`,
    id, source, target, rel, JSON.stringify(props), now
  )];
  return toEdge(rows[0] as Record<string, unknown>);
}

export function getEdgesFrom(sql: SqlStorage, source: string, rel?: RelType): ArtifactEdge[] {
  if (rel) {
    return [...sql.exec('SELECT * FROM edges WHERE source = ? AND rel = ?', source, rel)].map(r => toEdge(r as Record<string, unknown>));
  }
  return [...sql.exec('SELECT * FROM edges WHERE source = ?', source)].map(r => toEdge(r as Record<string, unknown>));
}

export function getEdgesTo(sql: SqlStorage, target: string, rel?: RelType): ArtifactEdge[] {
  if (rel) {
    return [...sql.exec('SELECT * FROM edges WHERE target = ? AND rel = ?', target, rel)].map(r => toEdge(r as Record<string, unknown>));
  }
  return [...sql.exec('SELECT * FROM edges WHERE target = ?', target)].map(r => toEdge(r as Record<string, unknown>));
}

// ── Generic traversal contract 1: Recursive lineage walk ──────────────────

/**
 * Walk any recursive edge type from a starting node back to roots.
 * Most common use: version_of lineage (Specification → predecessors).
 * Works for any rel where direction is child → parent.
 *
 * Returns nodes ordered start → deepest ancestor.
 */
export function walkLineageBackward(
  sql: SqlStorage,
  startId: string,
  rel: RelType,
  maxDepth = 1000
): LineageChain {
  const rows = [...sql.exec(`
    WITH RECURSIVE lineage(id, depth) AS (
      SELECT ?, 0
      UNION ALL
      SELECT e.target, l.depth + 1
      FROM edges e
      JOIN lineage l ON e.source = l.id
      WHERE e.rel = ? AND l.depth < ?
    )
    SELECT n.*, l.depth
    FROM nodes n
    JOIN lineage l ON n.id = l.id
    ORDER BY l.depth ASC
  `, startId, rel, maxDepth)];
  const nodes = rows.map(r => toNode(r as Record<string, unknown>));
  return { nodes, depth: nodes.length - 1 };
}

/**
 * Walk forward from a root — find all descendants via a given rel type.
 * Most common use: finding all successor Specifications from a root version.
 */
export function walkLineageForward(
  sql: SqlStorage,
  startId: string,
  rel: RelType,
  maxDepth = 1000
): LineageChain {
  const rows = [...sql.exec(`
    WITH RECURSIVE successors(id, depth) AS (
      SELECT ?, 0
      UNION ALL
      SELECT e.source, s.depth + 1
      FROM edges e
      JOIN successors s ON e.target = s.id
      WHERE e.rel = ? AND s.depth < ?
    )
    SELECT n.*, s.depth
    FROM nodes n
    JOIN successors s ON n.id = s.id
    ORDER BY s.depth ASC
  `, startId, rel, maxDepth)];
  const nodes = rows.map(r => toNode(r as Record<string, unknown>));
  return { nodes, depth: nodes.length - 1 };
}

// ── Generic traversal contract 2: Bounded path walk ───────────────────────

/**
 * Walk a fixed-hop path from a starting node through a sequence of
 * (nodeType, rel) steps. Returns all terminal nodes reachable via
 * the specified path pattern.
 */
export function walkBoundedPath(
  sql: SqlStorage,
  startId: string,
  steps: PathStep[]
): PathResult[] {
  if (steps.length === 0) return [];

  // Build the JOIN chain dynamically from the steps array
  const joins: string[] = [];
  const params: unknown[] = [];
  let prevAlias = 'n0';

  steps.forEach((step, i) => {
    const eAlias = `e${i + 1}`;
    const nAlias = `n${i + 1}`;
    joins.push(`JOIN edges ${eAlias} ON ${eAlias}.source = ${prevAlias}.id AND ${eAlias}.rel = ?`);
    params.push(step.rel);
    if (step.targetType) {
      joins.push(`JOIN nodes ${nAlias} ON ${nAlias}.id = ${eAlias}.target AND ${nAlias}.type = ?`);
      params.push(step.targetType);
    } else {
      joins.push(`JOIN nodes ${nAlias} ON ${nAlias}.id = ${eAlias}.target`);
    }
    prevAlias = nAlias;
  });

  // SELECT all nodes and edges in the path
  const nodeSelects = Array.from({ length: steps.length + 1 }, (_, i) =>
    `n${i}.id AS n${i}_id, n${i}.type AS n${i}_type, n${i}.data AS n${i}_data, ` +
    `n${i}.ns AS n${i}_ns, n${i}.created AS n${i}_created, n${i}.updated AS n${i}_updated`
  ).join(', ');

  const edgeSelects = Array.from({ length: steps.length }, (_, i) =>
    `e${i + 1}.id AS e${i + 1}_id, e${i + 1}.source AS e${i + 1}_source, ` +
    `e${i + 1}.target AS e${i + 1}_target, e${i + 1}.rel AS e${i + 1}_rel, ` +
    `e${i + 1}.props AS e${i + 1}_props, e${i + 1}.created AS e${i + 1}_created`
  ).join(', ');

  const query = `
    SELECT ${nodeSelects}, ${edgeSelects}
    FROM nodes n0
    ${joins.join('\n    ')}
    WHERE n0.id = ?
    ORDER BY n${steps.length}.created DESC
  `;
  // Note: startId appears twice — once in joins anchor, once in WHERE
  params.push(startId);

  const rows = [...sql.exec(query, ...params)];

  return rows.map(r => {
    const row = r as Record<string, unknown>;
    const path: ArtifactNode[] = [];
    const edges: ArtifactEdge[] = [];

    for (let i = 0; i <= steps.length; i++) {
      path.push(toNode({
        id: row[`n${i}_id`], type: row[`n${i}_type`], data: row[`n${i}_data`],
        ns: row[`n${i}_ns`], created: row[`n${i}_created`], updated: row[`n${i}_updated`],
      }));
    }
    for (let i = 1; i <= steps.length; i++) {
      edges.push(toEdge({
        id: row[`e${i}_id`], source: row[`e${i}_source`], target: row[`e${i}_target`],
        rel: row[`e${i}_rel`], props: row[`e${i}_props`], created: row[`e${i}_created`],
      }));
    }
    return { path, edges };
  });
}

// ── Hypothesis filter query ────────────────────────────────────────────────

export interface HypothesisFilterParams {
  ns: string;
  status?: string;
  severity?: string;
  /** Filter by data.surfacedToLinear boolean */
  surfaced?: boolean;
  /** Filter: data.surfacedCycleCount >= this value */
  surfacedCycleCountGte?: number;
}

/**
 * Query Hypothesis nodes using SQLite json_extract() for server-side filtering.
 * All params are optional and ANDed together when provided.
 */
export function queryHypothesisByFilters(
  sql: SqlStorage,
  params: HypothesisFilterParams,
  limit = 200,
  offset = 0
): ArtifactNode[] {
  const conditions: string[] = ['ns = ?', "type = 'Hypothesis'"];
  const bindings: unknown[] = [params.ns];

  if (params.status !== undefined) {
    conditions.push("json_extract(data, '$.status') = ?");
    bindings.push(params.status);
  }
  if (params.severity !== undefined) {
    conditions.push("json_extract(data, '$.severity') = ?");
    bindings.push(params.severity);
  }
  if (params.surfaced !== undefined) {
    // SQLite stores JSON booleans as 1/0 integers via json_extract
    conditions.push("json_extract(data, '$.surfacedToLinear') = ?");
    bindings.push(params.surfaced ? 1 : 0);
  }
  if (params.surfacedCycleCountGte !== undefined) {
    conditions.push("CAST(json_extract(data, '$.surfacedCycleCount') AS INTEGER) >= ?");
    bindings.push(params.surfacedCycleCountGte);
  }

  bindings.push(limit, offset);
  const query = `SELECT * FROM nodes WHERE ${conditions.join(' AND ')} ORDER BY created DESC LIMIT ? OFFSET ?`;
  return [...sql.exec(query, ...bindings)].map(r => toNode(r as Record<string, unknown>));
}

// ── Generic traversal contract 3: Bi-directional lineage collect ──────────

/**
 * Collect all node IDs in a lineage (both predecessors and successors)
 * from any node in the chain. Used for cross-lineage queries.
 */
export function collectLineageIds(
  sql: SqlStorage,
  anyNodeInLineage: string,
  rel: RelType
): string[] {
  return [...sql.exec(`
    WITH RECURSIVE
    predecessors(id) AS (
      SELECT ?
      UNION ALL
      SELECT e.target FROM edges e JOIN predecessors p ON e.source = p.id WHERE e.rel = ?
    ),
    successors(id) AS (
      SELECT ?
      UNION ALL
      SELECT e.source FROM edges e JOIN successors s ON e.target = s.id WHERE e.rel = ?
    )
    SELECT id FROM predecessors
    UNION
    SELECT id FROM successors
  `, anyNodeInLineage, rel, anyNodeInLineage, rel)].map(r => (r as Record<string, unknown>)['id'] as string);
}
