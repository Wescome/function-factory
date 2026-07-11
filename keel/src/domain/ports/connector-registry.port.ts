/**
 * connector-registry.port.ts — ConnectorRegistryPort (driven).
 * Resolves connector names (from a Specification) to bound capabilities. D5:
 * the resolved set IS the action-space ceiling for the run.
 */
export interface ConnectorRef {
  readonly name: string;
  /** D8: whether a call to this connector aborts the action for approval. */
  readonly requiresApproval: boolean;
}

export interface ConnectorRegistryPort {
  resolve(names: readonly string[]): readonly ConnectorRef[];
}
