// mappers/knowledge-ontology.mapper.ts - Maps Knowledge Module ontology resolve output to WGSP data part

import type {
  KnowledgeOntologyDataPart,
  CanonicalTermResult,
  TermAliasResult,
  RelatedTermResult,
} from "../stream/data-parts";

/** Input shape matching Go OntologyResolveOutput JSON */
export interface KnowledgeOntologyInput {
  query_id: string;
  input_term: string;
  canonical: {
    code: string;
    scheme: string;
    label: string;
    definition?: string;
  };
  aliases?: Array<{
    code: string;
    scheme: string;
    label: string;
  }>;
  related?: Array<{
    relation: string;
    code: string;
    scheme: string;
    label: string;
  }>;
  confidence: number;
}

/**
 * Transforms a Knowledge Module OntologyResolveOutput into a WGSP KnowledgeOntologyDataPart.
 * Pure function with no side effects.
 */
export function to_knowledge_ontology_data_part(input: KnowledgeOntologyInput): KnowledgeOntologyDataPart {
  const canonical: CanonicalTermResult = {
    code: input.canonical.code,
    scheme: input.canonical.scheme,
    label: input.canonical.label,
    definition: input.canonical.definition ?? null,
  };

  const aliases: TermAliasResult[] = (input.aliases ?? []).map((a) => ({
    code: a.code,
    scheme: a.scheme,
    label: a.label,
  }));

  const related: RelatedTermResult[] = (input.related ?? []).map((r) => ({
    relation: r.relation,
    code: r.code,
    scheme: r.scheme,
    label: r.label,
  }));

  return {
    query_id: input.query_id,
    input_term: input.input_term,
    canonical,
    aliases,
    related,
    confidence: input.confidence,
    timestamp: new Date().toISOString(),
  };
}
