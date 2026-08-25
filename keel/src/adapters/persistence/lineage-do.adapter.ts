import type {
  LineageRepositoryPort, ContentHash, NodeInput, AnyNode, DomainEvent, SpecificationContent,
} from "../../domain/index";

// Canonical JSON with sorted keys, so identical content hashes identically.
function canonical(v: unknown): string {
  if (v === undefined) return "null"; // JSON has no undefined; store as null (round-trips safely)
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonical((v as Record<string, unknown>)[k])).join(",") + "}";
}

async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// PLAYBOOK-KEEL-HANDOFF-001 (C2, Track 1): `append`'s own id computation,
// exported so a caller can PRE-COMPUTE a fresh Specification's eventual
// runId before ever calling admit() -- needed to record a HELD child's
// `derived_child` row (primary key `run_id`) at fan-out time, before it is
// actually admitted. Reuses the exact same `canonical`+`sha256hex` this
// file's own `append` uses (never a second, divergence-prone copy) --
// correct only because a fresh admission's `provenance` is always `[]`
// (mirrored here as a literal, not a parameter, so this can never be called
// with a non-fresh provenance and silently mismatch a real `append`).
export async function computeSpecId(content: SpecificationContent): Promise<ContentHash> {
  const body = canonical({ kind: "Specification", content, provenance: [] });
  return (await sha256hex(body)) as ContentHash;
}

type Sql = <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]) => Iterable<T>;

// Append-only. No mutate/delete exists on the port, so the lineage contract's
// rule 3 cannot be violated through this adapter. Content-addressing gives
// natural idempotency (INSERT OR IGNORE). One DO instance == one run (D4), so
// loadRun returns every node in this instance.
export class LineageDoAdapter implements LineageRepositoryPort {
  constructor(private readonly sql: Sql) {
    this.sql`CREATE TABLE IF NOT EXISTS lineage_nodes (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, content TEXT NOT NULL, provenance TEXT NOT NULL
    )`;
    this.sql`CREATE TABLE IF NOT EXISTS lineage_events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, payload TEXT NOT NULL
    )`;
  }

  async append<N extends AnyNode>(input: NodeInput<N>): Promise<N> {
    const body = canonical({ kind: input.kind, content: input.content, provenance: input.provenance });
    const id = (await sha256hex(body)) as ContentHash;
    this.sql`INSERT OR IGNORE INTO lineage_nodes (id, kind, content, provenance)
             VALUES (${id}, ${input.kind}, ${canonical(input.content)}, ${canonical(input.provenance)})`;
    return { id, kind: input.kind, content: input.content, provenance: input.provenance } as unknown as N;
  }

  async emit(event: DomainEvent): Promise<void> {
    this.sql`INSERT INTO lineage_events (type, payload) VALUES (${event.type}, ${JSON.stringify(event)})`;
  }

  async get(id: ContentHash): Promise<AnyNode | null> {
    const rows = [...this.sql<{ id: string; kind: string; content: string; provenance: string }>`
      SELECT id, kind, content, provenance FROM lineage_nodes WHERE id = ${id}`];
    const r = rows[0];
    if (!r) return null;
    return { id: r.id as ContentHash, kind: r.kind, content: JSON.parse(r.content), provenance: JSON.parse(r.provenance) } as AnyNode;
  }

  async loadRun(): Promise<readonly AnyNode[]> {
    const rows = [...this.sql<{ id: string; kind: string; content: string; provenance: string }>`
      SELECT id, kind, content, provenance FROM lineage_nodes`];
    return rows.map((r) => ({ id: r.id as ContentHash, kind: r.kind, content: JSON.parse(r.content), provenance: JSON.parse(r.provenance) } as AnyNode));
  }

  // Read side (CQRS): the ordered event log. Not on the frozen write port —
  // this is a concrete read the QueryPort projection consumes.
  async readEvents(): Promise<readonly DomainEvent[]> {
    const rows = [...this.sql<{ payload: string }>`SELECT payload FROM lineage_events ORDER BY seq`];
    return rows.map((r) => JSON.parse(r.payload) as DomainEvent);
  }
}
