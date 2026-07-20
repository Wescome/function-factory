/**
 * checks.ts — S1–S8 as structured, runnable check definitions.
 *
 * REVISION NOTE (D7 resolved): S1 now tests the RESOLVED fiber-primitive
 * Disposition (ARCH-KEEL-000 Part D, D7) directly, not a placeholder. It
 * exercises both halves in one flow against a single admitted run:
 *   (a) idempotent dispatch — admit() twice with the same Specification id;
 *       the second call must report isNew: false (no double-start), and this
 *       is checked ACROSS a confirmed true eviction, so it also proves the
 *       idempotency ledger entry itself survives eviction (durable, not
 *       in-memory).
 *   (b) eviction-recovery — the admitted run's stashed snapshot is recovered
 *       via onFiberRecovered after evictDurableObject()+runDurableObjectAlarm(),
 *       observed by polling result().
 * A red S1 means the Orchestrator's own startFiber/idempotencyKey usage is
 * wrong — the underlying mechanism is independently confirmed (D7), not open.
 *
 * S2/S3/S7 route through Orchestrator.run() (admit + poll, fresh key each
 * time) — mechanically unchanged from the prior pass, just riding the new D7
 * dispatch path underneath. S4/S6/S8 are unaffected by D7 and unchanged.
 */

import { Orchestrator } from "./orchestrator";

export interface CheckResult {
  id: string;
  title: string;
  pass: boolean;
  detail: string;
  onFail: string;
}

type Stub = DurableObjectStub & Orchestrator;

/** Helpers the runner provides. `fresh()` returns a stub. `forceEviction()`
 *  attempts to truly dispose the DO instance and reports whether it could
 *  CONFIRM that happened — an unconfirmed eviction must not be scored as a
 *  pass. VERIFY: the actual disposal mechanism is environment-specific; see
 *  test/spike.test.ts and worker.ts for what each harness can actually do. */
export interface Harness {
  fresh(): Promise<Stub>;
  forceEviction(stub: Stub): Promise<boolean>;
}

export async function runChecks(h: Harness): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  const rec = (
    id: string, title: string, pass: boolean, detail: string, onFail: string
  ) => out.push({ id, title, pass, detail, onFail });

  // S1 — idempotent dispatch & recovery, across a CONFIRMED true eviction (D7)
  try {
    const stub = await h.fresh();
    const specId = "spec-s1-" + Date.now();

    const first = await stub.admit(specId);                 // dispatch; fire-and-forget
    await new Promise((r) => setTimeout(r, 20));             // let the body start + stash land
    const evicted = await h.forceEviction(stub);             // TRUE eviction + alarm-driven recovery
    const second = await stub.admit(specId);                 // same key, post-eviction: must NOT double-start
    await new Promise((r) => setTimeout(r, 30));              // let recovery + rest of body land
    const result = await stub.result();

    const noDoubleStart = second.isNew === false;
    const recovered = result !== null && result.recoveredFromSnapshot !== null;
    rec("S1", "Idempotent dispatch & recovery (startFiber, D7)",
      first.isNew === true && noDoubleStart && evicted && recovered,
      `firstIsNew=${first.isNew} secondIsNew=${second.isNew} evictionConfirmed=${evicted} ` +
      `recoveredFromSnapshot=${JSON.stringify(result?.recoveredFromSnapshot)}`,
      "D7 assumption false (idempotent dispatch or eviction-recovery not holding) — " +
      "re-open D7 and, transitively, D1/D3. The underlying mechanism is independently " +
      "confirmed (evictDurableObject+runDurableObjectAlarm on agents@0.17.3 directly); " +
      "a red here points at the Orchestrator's OWN startFiber/idempotencyKey usage.");
  } catch (e) { rec("S1", "Idempotent dispatch & recovery (startFiber, D7)", false, `threw: ${err(e)}`, "re-open D7 and, transitively, D1/D3."); }

  // S2 — codemode durable-log replay (no double effect) -----------------------
  try {
    const stub = await h.fresh();
    const r = await stub.run();
    rec("S2", "codemode call accounting",
      r?.realInvocations === 2,
      `realInvocations=${r?.realInvocations} (expect 2)`,
      "EXECUTE semantics differ from assumed; re-open CodeExecutionPort (D5/D6).");
  } catch (e) { rec("S2", "codemode call accounting", false, `threw: ${err(e)}`, "re-open CodeExecutionPort (D5/D6)."); }

  // S3 — determinism / checkpoint visibility (weakened — no native step()) ---
  try {
    const stub = await h.fresh();
    const r = await stub.run();
    rec("S3", "Checkpoint visibility",
      r?.trace?.ok === true,
      `trace.ok=${r?.trace?.ok}`,
      "There is no native step()/determinism-capture primitive on FiberContext — " +
      "any determinism guarantee must be hand-built on top of stash()/snapshot. Tighten executor contract.");
  } catch (e) { rec("S3", "Checkpoint visibility", false, `threw: ${err(e)}`, "tighten executor contract."); }

  // S4 — sandbox capability model --------------------------------------------
  try {
    const stub = await h.fresh();
    const t = await stub.egressProbe();
    const body = (t.result ?? (t.raw as { result?: unknown })?.result) as { blocked?: boolean; ok?: unknown } | undefined;
    const blocked = body?.blocked === true;
    const connectorRan = body?.ok !== undefined;
    rec("S4", "Sandbox capability model",
      t.ok && blocked && connectorRan,
      `ok=${t.ok} rawFetchBlocked=${blocked} connectorRan=${connectorRan}`,
      "Connectors-only guarantee weaker than assumed; re-open D5 ceiling.");
  } catch (e) { rec("S4", "Sandbox capability model", false, `threw: ${err(e)}`, "re-open D5 ceiling."); }

  // S5 — runtime execution oracle (PIVOTAL) -----------------------------------
  try {
    const stub = await h.fresh();
    const t0 = Date.now();
    const v = await stub.oracleProbe();
    const withinBudget = v?.ms !== undefined && v.ms < 1000; // tune budget
    rec("S5", "Runtime execution oracle",
      v?.outcome === "pass" && withinBudget,
      `outcome=${v?.outcome} ms=${v?.ms} (wall=${Date.now() - t0})`,
      "PIVOTAL: oracle goes async/queued, not inline; OraclePort re-shapes; re-open D2. " +
      "NOTE: runOracle's artifact-injection path is itself unverified (ProxyToolInput has no bindings " +
      "field) — a red here may mean the injection mechanism needs fixing before the substrate claim is tested at all.");
  } catch (e) { rec("S5", "Runtime execution oracle", false, `threw: ${err(e)}`, "PIVOTAL: re-open D2; OraclePort async."); }

  // S6 — verifier independence (config introspection) -------------------------
  try {
    const stub = await h.fresh();
    const names: string[] = (await stub.bindingNames()) ?? [];
    const leaks = names.filter((n) => /model|ai|gateway|openai|anthropic|generat/i.test(n));
    rec("S6", "Verifier independence",
      leaks.length === 0,
      leaks.length ? `model bindings reachable: ${leaks.join(",")}` : "no model binding reachable",
      "Topology rethink (low risk — configuration, not substrate).");
  } catch (e) { rec("S6", "Verifier independence", false, `threw: ${err(e)}`, "configuration fix."); }

  // S7 — DO SQLite aggregate store (durable, ordered) --------------------------
  try {
    const stub = await h.fresh();
    await stub.run();
    const ev: { seq: number }[] = (await stub.events()) ?? [];
    const ordered = ev.every((e, i) => i === 0 || e.seq > ev[i - 1].seq);
    rec("S7", "DO SQLite aggregate store",
      ev.length >= 1 && ordered,
      `events=${ev.length} ordered=${ordered}`,
      "Store shape changes; re-open D4.");
  } catch (e) { rec("S7", "DO SQLite aggregate store", false, `threw: ${err(e)}`, "re-open D4."); }

  // S8 — approval pause/resume -------------------------------------------------
  try {
    const stub = await h.fresh();
    const t = await stub.approvalProbe();
    rec("S8", "Approval pause/resume",
      Array.isArray(t.pending) && t.pending.length > 0,
      `pending=${JSON.stringify(t.pending)}`,
      "PAUSE-state design changes; re-open the approval flow.");
  } catch (e) { rec("S8", "Approval pause/resume", false, `threw: ${err(e)}`, "re-open approval flow."); }

  return out;
}

function err(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** The G1 gate: green iff every check passes. */
export function g1(results: CheckResult[]): { green: boolean; reds: string[] } {
  const reds = results.filter((r) => !r.pass).map((r) => r.id);
  return { green: reds.length === 0, reds };
}

