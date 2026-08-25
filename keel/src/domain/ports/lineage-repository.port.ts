/**
 * lineage-repository.port.ts — LineageRepositoryPort (driven).
 * The ONLY path from the domain to persistence (D4). Append-only by
 * construction: there is no mutate and no delete method, so rule 3 of the
 * lineage contract cannot be violated through this port.
 *
 * INV-A: this port exposes lineage nodes only. It never surfaces the framework
 * fiber ledger (D7) — that is plumbing, queried by no domain code.
 */
import type { ContentHash, NodeInput } from "../lineage/contract";
import type { AnyNode } from "../lineage/nodes";
import type { DomainEvent } from "../lineage/events";

export interface LineageRepositoryPort {
  /**
   * Append a node. The adapter canonicalizes + content-hashes the content,
   * assigns `id`, and returns the full node. Appending an identical content
   * returns the existing node (content-addressing = natural idempotency).
   */
  append<N extends AnyNode>(input: NodeInput<N>): Promise<N>;

  /** Record a domain event (the transition fact). Append-only. */
  emit(event: DomainEvent): Promise<void>;

  get(id: ContentHash): Promise<AnyNode | null>;

  /** All nodes for one run, keyed on its Specification id. Read side (CQRS). */
  loadRun(specification: ContentHash): Promise<readonly AnyNode[]>;
}
