/**
 * Real use case: FX rates, deterministic against RECORDED real Frankfurter data.
 * (1) fetchRate navigates the real nested shape + validates codes; (2) the oracle's
 * anchored A2 accepts faithfully-reported fetches, rejects computed/fabricated/
 * unfetched ones. Full live-model loop = agent's run; a live-data spike ran separately.
 */
import { describe, it, expect } from "vitest";
import { fetchRate } from "../src/adapters/fx/fx-call";
import { CallRecorder } from "../src/adapters/codemode/call-recorder";

const RECORDED: Record<string, unknown> = {
  "USD-EUR": { amount: 1.0, base: "USD", date: "2026-07-10", rates: { EUR: 0.87489 } },
  "EUR-GBP": { amount: 1.0, base: "EUR", date: "2026-07-10", rates: { GBP: 0.85155 } },
  "USD-GBP": { amount: 1.0, base: "USD", date: "2026-07-10", rates: { GBP: 0.74501 } },
};
const mockFetch = (async (url: string) => {
  const u = new URL(url); const key = `${u.searchParams.get("base")}-${u.searchParams.get("symbols")}`;
  return { ok: true, status: 200, json: async () => RECORDED[key] } as Response;
}) as unknown as typeof fetch;
const deps = (rec?: CallRecorder) => ({ fetchImpl: mockFetch, recorder: rec });

const A1 = (r: { usd_eur: number; eur_gbp: number; usd_gbp: number }) =>
  typeof r.usd_eur === "number" && typeof r.eur_gbp === "number" && typeof r.usd_gbp === "number" &&
  r.usd_eur > 0 && r.eur_gbp > 0 && r.usd_gbp > 0;
// A2 ANCHORED: each returned rate must match its E-A-recorded fetch (anchor law).
type Trace = { result: Record<string, number>; calls: { connector: string; method: string; args: { from: string; to: string }; response: { rates: Record<string, number> } }[] };
const A2anchored = (t: Trace) =>
  ([["USD","EUR","usd_eur"],["EUR","GBP","eur_gbp"],["USD","GBP","usd_gbp"]] as const).every(([from,to,field]) => {
    const call = t.calls.find((c) => c.connector === "fx" && c.args.from === from && c.args.to === to);
    if (!call) return false;
    const rec = call.response.rates[to]!;
    const got = t.result[field]!;
    return typeof rec === "number" && typeof got === "number" && Math.abs(got - rec) / rec < 1e-6;
  });
const fxCall = (from: string, to: string, rate: number) => ({ connector: "fx", method: "rate", args: { from, to }, response: { rates: { [to]: rate } } });

describe("fx connector navigates the real API shape", () => {
  it("returns the raw nested shape; rate is under .rates[to] (model must unwrap)", async () => {
    const r = await fetchRate("USD", "EUR", deps());
    expect(r.rates.EUR).toBe(0.87489);
  });
  it("validates ISO codes — rejects bad input before any fetch", async () => {
    await expect(fetchRate("usd", "EUR", deps())).rejects.toThrow("invalid currency");
    await expect(fetchRate("USD", "'; DROP", deps())).rejects.toThrow("invalid currency");
  });
  it("records call I/O (E-A)", async () => {
    const rec = new CallRecorder();
    await fetchRate("USD", "EUR", deps(rec));
    expect(rec.drain()[0]!.connector).toBe("fx");
  });
});

describe("fx oracle — A2 anchored on recorded fetches (anchor law)", () => {
  const calls = [fxCall("USD","EUR",0.87489), fxCall("EUR","GBP",0.85155), fxCall("USD","GBP",0.74501)];
  it("faithfully reported fetched rates PASS", () => {
    const t = { result: { usd_eur: 0.87489, eur_gbp: 0.85155, usd_gbp: 0.74501 }, calls };
    expect(A1(t.result)).toBe(true);
    expect(A2anchored(t)).toBe(true);
  });
  it("COMPUTED usd_gbp (usd_eur*eur_gbp) instead of the fetched value -> A2 FAILS (the gamed case)", () => {
    const computed = 0.87489 * 0.85155; // 0.7450125795, ~3e-6 off the fetched 0.74501
    const t = { result: { usd_eur: 0.87489, eur_gbp: 0.85155, usd_gbp: computed }, calls };
    expect(A2anchored(t)).toBe(false); // anchored on the recorded fetch, not the other outputs
  });
  it("COMPUTE-WITHOUT-FETCHING the third rate -> A2 FAILS (no recorded USD/GBP call)", () => {
    const t = { result: { usd_eur: 0.87489, eur_gbp: 0.85155, usd_gbp: 0.74501 },
      calls: [fxCall("USD","EUR",0.87489), fxCall("EUR","GBP",0.85155)] }; // no USD->GBP
    expect(A2anchored(t)).toBe(false);
  });
  it("FABRICATED usd_gbp -> A2 fails", () => {
    const t = { result: { usd_eur: 0.87489, eur_gbp: 0.85155, usd_gbp: 0.5 }, calls };
    expect(A2anchored(t)).toBe(false);
  });
  it("UNWRAP miss (raw objects) -> A1 fails", () => {
    // @ts-expect-error deliberately wrong shape
    expect(A1({ usd_eur: { rates: { EUR: 0.87 } }, eur_gbp: {}, usd_gbp: {} })).toBe(false);
  });
});
