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
