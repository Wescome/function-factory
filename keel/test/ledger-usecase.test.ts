/** Use case #1: effectful write — idempotency + exactly-one, verified by read-back. */
import { describe, it, expect } from "vitest";
import { MapLedgerStore } from "../src/adapters/ledger/store";

// A1 replicated: exactly one record with value "active" in the final recorded read-back
type Call = { connector: string; method: string; response: unknown };
const A1 = (calls: Call[]) => {
  const lists = calls.filter((c) => c.connector === "ledger" && c.method === "list");
  if (!lists.length) return false;
  const recs = lists[lists.length - 1]!.response as { value: unknown }[];
  return Array.isArray(recs) && recs.length === 1 && recs[0]?.value === "active";
};
const listCall = (recs: unknown): Call => ({ connector: "ledger", method: "list", response: recs });

describe("#1 ledger store", () => {
  it("put then list -> one record; put again -> duplicates (append semantics)", async () => {
    const s = new MapLedgerStore();
    await s.put("k", "active");
    expect(await s.list("k")).toHaveLength(1);
    await s.put("k", "active");
    expect(await s.list("k")).toHaveLength(2); // why read-before-write matters
  });
});

describe("#1 read-before-write keeps exactly one (oracle read-back)", () => {
  it("CREATE (absent -> put -> read-back one) -> A1 pass", async () => {
    const s = new MapLedgerStore();
    let recs = await s.list("entity-1");
    if (recs.length === 0) await s.put("entity-1", "active");
    recs = await s.list("entity-1");
    expect(A1([listCall(recs)])).toBe(true);
  });
  it("IDEMPOTENT (already present -> skip put -> still one) -> A1 pass", async () => {
    const s = new MapLedgerStore();
    await s.put("entity-1", "active"); // pre-existing
    let recs = await s.list("entity-1");
    if (recs.length === 0) await s.put("entity-1", "active"); // correctly skipped
    recs = await s.list("entity-1");
    expect(A1([listCall(recs)])).toBe(true);
  });
  it("DUPLICATE (write without checking when one exists) -> two records -> A1 FAILS", async () => {
    const s = new MapLedgerStore();
    await s.put("entity-1", "active"); // pre-existing
    await s.put("entity-1", "active"); // the bug: no read-before-write
    const recs = await s.list("entity-1");
    expect(A1([listCall(recs)])).toBe(false); // count 2, caught by read-back
  });
  it("model CLAIMS done but no read-back recorded -> A1 fails (never trusts the claim)", () => {
    expect(A1([{ connector: "ledger", method: "put", response: { ok: true } }])).toBe(false);
  });
});

// BRIEF-KEEL-EFFECT-SIGNATURE-001 v1.2 §A2.4: store.ensure is safe to
// auto-execute (no D8 PAUSE) ONLY because it's atomic — a read-then-
// conditional-write would race under concurrency and stack, which would make
// skipping the approval gate unsafe. This is the regression guard: a future
// edit to store.ensure that reintroduces a check-then-write gap should fail
// HERE, not silently ship (the oracle only verifies post-state correctness,
// it doesn't itself prove the write was race-free).
describe("#1 store.ensure is atomic (the basis for skipping D8, not a convenience)", () => {
  it("sequential: second ensure for an existing key is a no-op (inserted:false)", async () => {
    const s = new MapLedgerStore();
    const first = await s.ensure("entity-1", "active");
    const second = await s.ensure("entity-1", "active");
    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(false);
    expect(await s.list("entity-1")).toHaveLength(1);
  });
  it("CONCURRENT: two ensures racing on the same key still produce exactly one record", async () => {
    const s = new MapLedgerStore();
    const [a, b] = await Promise.all([s.ensure("entity-1", "active"), s.ensure("entity-1", "active")]);
    // exactly one of the two actually inserted; the other observed it already there
    expect([a.inserted, b.inserted].filter(Boolean)).toHaveLength(1);
    expect(await s.list("entity-1")).toHaveLength(1);
  });
  it("many concurrent ensures on the same key -> still exactly one record (no stacking)", async () => {
    const s = new MapLedgerStore();
    const results = await Promise.all(Array.from({ length: 20 }, () => s.ensure("entity-1", "active")));
    expect(results.filter((r) => r.inserted)).toHaveLength(1);
    expect(await s.list("entity-1")).toHaveLength(1);
  });
});
