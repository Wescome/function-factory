// Bridge field constants — the four cross-layer reference field names
export const BRIDGE_EXECUTION_ID     = 'artifact_graph_execution_id'    as const;
export const BRIDGE_DIVERGENCE_ID    = 'artifact_graph_divergence_id'   as const;
export const BRIDGE_AMENDMENT_ID     = 'artifact_graph_amendment_id'    as const;
export const BRIDGE_SPECIFICATION_ID = 'artifact_graph_specification_id' as const;

// Helper functions — each returns a copy of content with the bridge field added

export function addExecutionBridge<T extends object>(
  content: T,
  executionNodeId: string
): T & { artifact_graph_execution_id: string } {
  return { ...content, [BRIDGE_EXECUTION_ID]: executionNodeId } as T & { artifact_graph_execution_id: string };
}

export function addDivergenceBridge<T extends object>(
  content: T,
  divergenceId: string | null
): T & { artifact_graph_divergence_id: string | null } {
  return { ...content, [BRIDGE_DIVERGENCE_ID]: divergenceId } as T & { artifact_graph_divergence_id: string | null };
}

export function addAmendmentBridge<T extends object>(
  content: T,
  amendmentNodeId: string
): T & { artifact_graph_amendment_id: string } {
  return { ...content, [BRIDGE_AMENDMENT_ID]: amendmentNodeId } as T & { artifact_graph_amendment_id: string };
}

export function addSpecificationBridge<T extends object>(
  content: T,
  specificationNodeId: string
): T & { artifact_graph_specification_id: string } {
  return { ...content, [BRIDGE_SPECIFICATION_ID]: specificationNodeId } as T & { artifact_graph_specification_id: string };
}
