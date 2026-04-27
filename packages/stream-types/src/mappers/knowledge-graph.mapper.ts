// mappers/knowledge-graph.mapper.ts - Maps Knowledge Module graph query output to WGSP data part

import type { KnowledgeGraphDataPart, GraphEntity, GraphRelationship } from "../stream/data-parts";

/** Input shape matching Go GraphQueryOutput JSON */
export interface KnowledgeGraphInput {
  query_id: string;
  query: string;
  mode: "local" | "global";
  entities: Array<{
    entity_id: string;
    entity_type: string;
    label: string;
    description?: string;
    corpus_id: string;
  }>;
  relationships: Array<{
    source_id: string;
    target_id: string;
    relation: string;
    evidence?: string;
  }>;
  community_summaries?: string[];
}

/**
 * Transforms a Knowledge Module GraphQueryOutput into a WGSP KnowledgeGraphDataPart.
 * Pure function with no side effects.
 */
export function to_knowledge_graph_data_part(input: KnowledgeGraphInput): KnowledgeGraphDataPart {
  const entities: GraphEntity[] = input.entities.map((e) => ({
    entity_id: e.entity_id,
    entity_type: e.entity_type,
    label: e.label,
    description: e.description ?? null,
    corpus_id: e.corpus_id,
  }));

  const relationships: GraphRelationship[] = input.relationships.map((r) => ({
    source_id: r.source_id,
    target_id: r.target_id,
    relation: r.relation,
    evidence: r.evidence ?? null,
  }));

  return {
    query_id: input.query_id,
    query: input.query,
    mode: input.mode,
    entities,
    relationships,
    community_summaries: input.community_summaries ?? [],
    timestamp: new Date().toISOString(),
  };
}
