// mappers/knowledge-search.mapper.ts - Maps Knowledge Module search output to WGSP data part

import type { KnowledgeSearchDataPart, KnowledgeSearchHit } from "../stream/data-parts";

/** Input shape matching Go SearchOutput JSON */
export interface KnowledgeSearchInput {
  query_id: string;
  query: string;
  total_found: number;
  results: Array<{
    chunk_id: string;
    corpus_id: string;
    document: string;
    score: number;
    text: string;
    metadata?: Record<string, unknown> | null;
  }>;
}

/**
 * Transforms a Knowledge Module SearchOutput into a WGSP KnowledgeSearchDataPart.
 * Pure function with no side effects.
 */
export function to_knowledge_search_data_part(input: KnowledgeSearchInput): KnowledgeSearchDataPart {
  const results: KnowledgeSearchHit[] = input.results.map((r) => ({
    chunk_id: r.chunk_id,
    corpus_id: r.corpus_id,
    document: r.document,
    score: r.score,
    text: r.text,
    metadata: r.metadata ?? null,
  }));

  return {
    query_id: input.query_id,
    query: input.query,
    total_found: input.total_found,
    results,
    timestamp: new Date().toISOString(),
  };
}
