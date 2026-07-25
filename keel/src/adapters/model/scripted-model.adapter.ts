import type { ModelPort, GeneratedAction, SpecificationContent, VerdictContent } from "../../domain/index";

// Walking-skeleton / loop-closing ModelPort: deterministic, no LLM. Behavior is
// selected by spec.intent so M3 can exercise every branch of the loop:
//   "echo 42"  -> correct on attempt 1                 (ACCEPT)
//   "converge" -> wrong (41) on attempt 1, correct on amend (evidence present)
//   "never"    -> always wrong (41)                    (ESCALATE at budget)
//   "approve"  -> calls the approval-gated gate.commit (PAUSE, then ACCEPT)
// The real AI Gateway adapter (Phase 4+) replaces this; the point here is the
// LOOP wiring, not the model.
export class ScriptedModelAdapter implements ModelPort {
  async generate(spec: SpecificationContent, evidence?: VerdictContent): Promise<GeneratedAction> {
    switch (spec.intent) {
      case "converge": {
        const value = evidence ? 42 : 41; // corrects itself once it has verifier evidence
        return { code: `const r = await echo.emit({ value: ${value} }); return r;`, connectors: ["echo"] };
      }
      case "degraded": // model generates normally; the EXECUTOR is what fails
      case "never":
        return { code: `const r = await echo.emit({ value: 41 }); return r;`, connectors: ["echo"] };
      case "approve":
      case "uc-002": // schema migration: approval-gated -> PAUSE -> ACCEPT (expand/contract)
        return { code: `const g = await gate.commit({ value: 42 }); return g;`, connectors: ["gate"] };
      case "uc-001": // feature add: verifier catches the race on attempt 1, amend fixes it
        return { code: `const r = await echo.emit({ value: ${evidence ? 42 : 41} }); return r;`, connectors: ["echo"] };
      case "uc-003": // stale-total: verifier rejects symptom-masking each attempt -> ESCALATE
        return { code: `const r = await echo.emit({ value: 41 }); return r;`, connectors: ["echo"] };
      case "fx-correct": {
        // fetch three rates, UNWRAP the nested shape, assemble
        const c = `const a = await fx.rate({ from: "USD", to: "EUR" });
const b = await fx.rate({ from: "EUR", to: "GBP" });
const c = await fx.rate({ from: "USD", to: "GBP" });
return { usd_eur: a.rates.EUR, eur_gbp: b.rates.GBP, usd_gbp: c.rates.GBP };`;
        return { code: c, connectors: ["fx"] };
      }
      case "fx-fabricate": {
        // fabricates usd_gbp -> breaks triangular consistency (A2 must fail)
        const c = `const a = await fx.rate({ from: "USD", to: "EUR" });
const b = await fx.rate({ from: "EUR", to: "GBP" });
return { usd_eur: a.rates.EUR, eur_gbp: b.rates.GBP, usd_gbp: 0.5 };`;
        return { code: c, connectors: ["fx"] };
      }
      case "fx-rawshape": {
        // does NOT unwrap .rates -> returns objects, A1 fails (the discovery miss)
        const c = `const a = await fx.rate({ from: "USD", to: "EUR" });
const b = await fx.rate({ from: "EUR", to: "GBP" });
const c = await fx.rate({ from: "USD", to: "GBP" });
return { usd_eur: a, eur_gbp: b, usd_gbp: c };`;
        return { code: c, connectors: ["fx"] };
      }
      case "store-ensure": {
        // write-idempotent: store.ensure is atomic (the connector itself does
        // the read-before-write check), so the model's job is trivial — a
        // single call. The oracle verifies the CALL's own recorded response,
        // not this return value.
        const c = `const key = "entity-1";
const r = await store.ensure({ key, value: "active" });
return { ok: r.ok };`;
        return { code: c, connectors: ["store"] };
      }
      case "store-append-create": {
        // write-effectful: store.append has no built-in check, so the model
        // must do read-before-write itself — only put if absent; read back to confirm.
        const c = `const key = "entity-1";
let recs = await store.select({ key });
if (recs.length === 0) { await store.append({ key, value: "active" }); }
recs = await store.select({ key });
return { count: recs.length };`;
        return { code: c, connectors: ["store"] };
      }
      case "store-append-duplicate": {
        // BUG: writes without checking -> duplicates if a record already exists.
        // Oracle's read-back catches count!==1.
        const c = `const key = "entity-1";
await store.append({ key, value: "active" });
const recs = await store.select({ key });
return { count: recs.length };`;
        return { code: c, connectors: ["store"] };
      }
      case "geo-correct": {
        // threads geocode coords into weather; unwraps both nested shapes
        const c = `const g = await geo.lookup({ city: "Paris" });
const loc = g.results[0];
const w = await weather.current({ latitude: loc.latitude, longitude: loc.longitude });
return { latitude: loc.latitude, longitude: loc.longitude, temperature_c: w.current.temperature_2m };`;
        return { code: c, connectors: ["geo", "weather"] };
      }
      case "geo-topfail": {
        // assumes geocode returns TOP-LEVEL lat/lon (the discovery miss) -> undefined coords
        const c = `const g = await geo.lookup({ city: "Paris" });
const w = await weather.current({ latitude: g.latitude, longitude: g.longitude });
return { latitude: g.latitude, longitude: g.longitude, temperature_c: w.current.temperature_2m };`;
        return { code: c, connectors: ["geo", "weather"] };
      }
      case "geo-fabricate": {
        // fabricates coords instead of threading geocode output -> A2 fails
        const c = `const g = await geo.lookup({ city: "Paris" });
const w = await weather.current({ latitude: 0, longitude: 0 });
return { latitude: 0, longitude: 0, temperature_c: w.current.temperature_2m };`;
        return { code: c, connectors: ["geo", "weather"] };
      }
      case "amend-blind-sim": {
        // Simulates a real model on a genuinely UNconvergeable blind criterion:
        // it makes reasonable guesses (mirror value, then double it) but cannot
        // derive the hidden additive constant from evidence alone -> the harness
        // correctly ESCALATEs. Proves "correct escalate on unconvergeable".
        const check = evidence ? 84 : 42; // mirror, then double; never value*2+7
        return { code: `return await echo.emit({ value: 42, check: ${check} });`, connectors: ["echo"] };
      }
      case "amend-demo": {
        // Reads the SPECIFIC failed criterion from the oracle evidence (not just
        // its presence): attempt 1 sets check=0 (fails A2); once told A2 failed,
        // it sets check = value*2 = 84 and passes. If the per-criterion evidence
        // were NOT read, it would stay 0 and ESCALATE at budget.
        const check = evidence?.results?.["A2"] === "fail" ? 84 : 0;
        return { code: `return await echo.emit({ value: 42, check: ${check} });`, connectors: ["echo"] };
      }
      case "stale-tier":
        // stale assumption: attempt 1 treats getTier's return AS the tier (it is
        // actually { tier: "pro" }). The amend reads the recorded response shape.
        return evidence
          ? { code: `const b = await billing.getTier("c1"); return { tier: b.tier };`, connectors: ["billing"] }
          : { code: `const b = await billing.getTier("c1"); return { tier: b };`, connectors: ["billing"] };
      case "regress-demo":
        // attempt 1: A1 pass (value 42), A2 fail  -> score 1 (the BEST).
        // later attempts regress: A1 fail (value 0), A2 fail -> score 0.
        return evidence
          ? { code: `return await echo.emit({ value: 0, tag: "bad" });`, connectors: ["echo"] }
          : { code: `return await echo.emit({ value: 42, tag: "good" });`, connectors: ["echo"] };
      case "mr-correct":
        // compute BODY over `value` (the harness wraps as compute(value)):
        return { code: `return { value, check: value * 2 };`, connectors: ["echo"] };
      case "mr-cheat":
        // extensional cheat: hardcodes the value=42 answer; passes one instance,
        // fails the metamorphic probes at 43/91.
        return { code: `return { value: 42, check: 84 };`, connectors: ["echo"] };
      case "foreign-lookup":
        return { code: `return await foreign.lookup({});`, connectors: ["foreign"] };
      case "foreign-poisoned":
        return { code: `return await foreign.lookupPoisoned({});`, connectors: ["foreign"] };
      case "foreign-effectful":
        return { code: `return await foreign.effectfulOp({});`, connectors: ["foreign"] };
      case "foreign-upsert":
        return { code: `return await foreign.upsertRecord({ id: "r1" });`, connectors: ["foreign"] };
      // PLAYBOOK-KEEL-COMPOSE-ANCHOR test support: deterministic `tax` values
      // so derive()'s per-clause children (templateDerive rewrites intent to
      // "<parent.intent> — sub-goal: return a result object with the
      // field(s) described by: <clause statement>") reach an OBSERVED value
      // without a real model — the anchor check runs only AFTER the vacuity
      // gate passes, and vitest never has AI_API_KEY set.
      case "compose-anchor-test — sub-goal: return a result object with the field(s) described by: R1 marker":
      case "compose-anchor-test — sub-goal: return a result object with the field(s) described by: R2 marker":
        return { code: `return { tax: 14 };`, connectors: ["echo"] };
      // PLAYBOOK-KEEL-DERIV-AMEND test support: a deterministic MISMATCH
      // pair — R1 marker gives 14, this gives 14.01, so compose-demo@v1's
      // R3 (outputs['R1'] === outputs['R2']) reliably FAILS every attempt
      // (templateDerive is deterministic, so it fails IDENTICALLY on every
      // re-derivation) — needed to prove deriveAmend() escalates at exactly
      // `budget` attempts, not zero, not unboundedly.
      case "compose-anchor-test — sub-goal: return a result object with the field(s) described by: R2 marker mismatch":
        return { code: `return { tax: 14.01 };`, connectors: ["echo"] };
      // PLAYBOOK-KEEL-SEAM test support: same discipline — deterministic
      // "upstream produced" / "downstream received" values so the seam check
      // runs without a real model. "match" honestly threads S1's value;
      // "mismatch" is the invented value (the Mars-Orbiter shape).
      case "seam-anchor-test — sub-goal: return a result object with the field(s) described by: S1 marker":
      case "compose-anchor-test — sub-goal: return a result object with the field(s) described by: S1 marker":
        return { code: `return { val: 14 };`, connectors: ["echo"] };
      case "seam-anchor-test — sub-goal: return a result object with the field(s) described by: S2 marker match":
        return { code: `return { received: 14 };`, connectors: ["echo"] };
      case "seam-anchor-test — sub-goal: return a result object with the field(s) described by: S2 marker mismatch":
      case "compose-anchor-test — sub-goal: return a result object with the field(s) described by: S2 marker mismatch":
        return { code: `return { received: 99 };`, connectors: ["echo"] };
      // PLAYBOOK-KEEL-SPANNING test support: a real (non-scripted) model, left
      // to guess, may satisfy a spanning clause it was never told about by
      // luck (observed live: asked only for "value is 42", one run also
      // guessed `tag: 'perfect'` unprompted) — not a reliable demonstration
      // that gate presence and oracle satisfaction are decoupled. This fixed
      // code deterministically sets `value` only, never `tag`, so
      // `regress@v1`'s A2 ("tag is perfect") reliably fails at the oracle
      // regardless of gate admission.
      case "spanning-anchor-test — sub-goal: return a result object with the field(s) described by: A1 marker":
      case "spanning-anchor-test — sub-goal: return a result object with the field(s) described by: A9 marker":
      case "spanning-anchor-test — sub-goal: return a result object with the field(s) described by: A2 marker (spanning, never satisfied)":
        return { code: `return { value: 42 };`, connectors: ["echo"] };
      case "foreign-denied":
        return { code: `return await foreignDenied.lookup({});`, connectors: ["foreignDenied"] };
      // PLAYBOOK-KEEL-WORKSPACE-001: clone a tiny public repo (depth 1), glob
      // for its top-level files, read one back — proves state.*/git.* land on
      // the trace in order and readFile carries real content.
      case "workspace-read-test": {
        const c = `const cloned = await git.clone({ url: "https://github.com/octocat/Hello-World", dir: "/repo", depth: 1 });
const files = await state.glob({ pattern: "/repo/*" });
const readme = files.find((f) => /readme/i.test(f.name));
const content = await state.readFile({ path: readme.path });
return { dir: cloned.dir, fileCount: files.length, content };`;
        return { code: c, connectors: ["git", "state"] };
      }
      default:
        return { code: `const r = await echo.emit({ value: 42 }); return r;`, connectors: ["echo"] };
    }
  }
}
