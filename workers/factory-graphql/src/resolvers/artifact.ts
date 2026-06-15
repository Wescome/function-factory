import type { GqlContext } from '../context.js'
import type { ArtifactRow, LineageEdgeRow } from '../data-sources/d1.js'

const Query = {
  artifact: (
    _: unknown,
    args: { id: string },
    ctx: GqlContext,
  ): Promise<ArtifactRow | null> => {
    return ctx.d1.getArtifact(args.id)
  },

  lineage: async (
    _: unknown,
    args: { artifactId: string; depth?: number | null },
    ctx: GqlContext,
  ): Promise<{ rootId: string; depth: number; edges: LineageEdgeRow[] }> => {
    const depth = args.depth ?? 3
    if (depth > 5) throw new Error('depth > 5 not allowed')
    const edges = await ctx.d1.getLineageEdges(args.artifactId, depth)
    return {
      rootId: args.artifactId,
      depth,
      edges,
    }
  },
}

// ── FactoryArtifact field resolvers ───────────────────────────────────────────

const FactoryArtifact = {
  id: (row: ArtifactRow): string => row.id,
  sessionId: (row: ArtifactRow): string => row.session_id,
  kind: (row: ArtifactRow): string => row.kind,
  contentRef: (row: ArtifactRow): string | null => row.content_ref ?? null,
  contentHash: (row: ArtifactRow): string | null => row.content_hash ?? null,
  createdAt: (row: ArtifactRow): string => row.created_at,
  metadata: (row: ArtifactRow): unknown => {
    if (row.metadata === null || row.metadata === undefined) return null
    try {
      return JSON.parse(row.metadata) as unknown
    } catch {
      return null
    }
  },
}

// ── LineageEdge field resolvers ───────────────────────────────────────────────

const LineageEdge = {
  sourceId: (row: LineageEdgeRow): string => row.source_id,
  targetId: (row: LineageEdgeRow): string => row.target_id,
  rel: (row: LineageEdgeRow): string => row.rel,
  props: (row: LineageEdgeRow): unknown => {
    if (row.props === null || row.props === undefined) return null
    try {
      return JSON.parse(row.props) as unknown
    } catch {
      return null
    }
  },
}

export const artifactResolvers = { Query, FactoryArtifact, LineageEdge }
