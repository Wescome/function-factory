import type { SpecificationContent } from "../../domain/index";
import type { BacklogStore, BacklogEntry, BacklogStatus, GateTier } from "../../domain/index";

/** In-memory BacklogStore for tests + single-DO use. D1 adapter is the production form. */
export class InMemoryBacklog implements BacklogStore {
  private readonly entries = new Map<string, BacklogEntry>();
  private seq = 0;

  async enqueue(spec: SpecificationContent, tier: GateTier, leaseExpiresAt: number): Promise<BacklogEntry> {
    const id = `bl-${this.seq++}`;
    const entry: BacklogEntry = { id, spec, tier, leaseExpiresAt, status: "pending" };
    this.entries.set(id, entry);
    return entry;
  }
  async listPending(): Promise<readonly BacklogEntry[]> {
    return [...this.entries.values()].filter((e) => e.status === "pending");
  }
  async dispose(id: string, status: BacklogStatus): Promise<void> {
    const e = this.entries.get(id);
    if (e) this.entries.set(id, { ...e, status });
  }
  async expireStale(now: number): Promise<number> {
    let n = 0;
    for (const [id, e] of this.entries) {
      if (e.status === "pending" && e.leaseExpiresAt <= now) { this.entries.set(id, { ...e, status: "expired" }); n++; }
    }
    return n;
  }
}
