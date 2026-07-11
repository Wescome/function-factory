/**
 * contract.ts — THE LINEAGE CONTRACT (the Shared Kernel).
 *
 * This is the conserved invariant shared across the Loop, Verification, and
 * Lineage contexts (ARCH-KEEL-000 §13.3). It is NOT a fixed vocabulary — it is
 * three rules any artifact must satisfy to participate in lineage:
 *
 *   1. IDENTITY IS CONTENT-DERIVED. A node's id is the content hash of its
 *      canonical content. Two nodes with identical content are the same node.
 *   2. EDGES ARE PROVENANCE. Every edge records how one node derived from
 *      another; there are no non-derivation edges.
 *   3. APPEND-ONLY. Nodes are never mutated or deleted. A correction is a new
 *      node with an AMENDS edge (INV: enforced by LineageRepositoryPort
 *      exposing no mutate/delete — see ports/lineage-repository.port.ts).
 *
 * The domain nouns that specialize this contract (Specification, Verdict, …)
 * live in nodes.ts. Another instantiation could name them differently and still
 * participate, so long as it satisfies the three rules above.
 *
 * INV-A (ARCH-KEEL-000 §8): these lineage nodes are the SOLE domain-facing
 * source of truth. Framework-internal ledgers (the Agents SDK fiber ledger,
 * D7) are plumbing and never surface through this contract.
 */

/** Content-addressed identity. Branded so a raw string can't be passed where a
 *  hash is required. The hashing itself is an adapter concern (the repository
 *  assigns it on append); the domain only ever compares/holds hashes. */
export type ContentHash = string & { readonly __brand: "ContentHash" };

/** Rule 2: every edge is a derivation. */
export type EdgeKind =
  | "PRODUCES"    // Specification -> Action
  | "EXECUTES"    // Action -> ExecutionTrace
  | "VERIFIES"    // ExecutionTrace -> Verdict
  | "AMENDS"      // Verdict -> Action (next attempt) ; correction edge
  | "AUTHORIZES"  // Disposition -> Specification | capability
  | "DEPENDS_ON"  // Specification -> Specification (spec loop, Part C)
  | "LINEAGE";    // generic derivation

export interface ProvenanceEdge {
  readonly rel: EdgeKind;
  /** The node this one derives FROM. The holder of the edge is the "to". */
  readonly to: ContentHash;
}

/**
 * A lineage node. `K` is the domain kind tag, `C` its content shape.
 * Immutable by construction (all readonly); rule 3 is enforced at the port.
 */
export interface LineageNode<K extends string, C> {
  readonly id: ContentHash;
  readonly kind: K;
  readonly content: C;
  readonly provenance: readonly ProvenanceEdge[];
}

/**
 * What a factory hands the repository BEFORE an id exists. The repository
 * canonicalizes + hashes the content, assigns `id`, and returns the full node.
 * This is the only place a node is "created"; domain code never fabricates a
 * ContentHash itself.
 */
export type NodeInput<N> = N extends LineageNode<infer K, infer C>
  ? { readonly kind: K; readonly content: C; readonly provenance: readonly ProvenanceEdge[] }
  : never;
