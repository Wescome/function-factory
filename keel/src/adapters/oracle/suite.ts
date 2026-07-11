/**
 * suite.ts — Oracle suites (adapter-side infrastructure, not domain-frozen).
 *
 * A Specification carries an `oracleRef` (frozen) that names a suite. The suite
 * maps each AcceptanceCriterion id to an executable assertion over the recorded
 * ExecutionTrace. This is the "frozen oracle suite the Verifier runs" — it lives
 * outside the domain (like a test file the Verifier loads), so adding/changing
 * suites never touches the frozen contracts.
 */
import type { ExecutionTraceContent } from "../../domain/index";

export interface OracleAssertion {
  readonly criterionId: string;              // matches AcceptanceCriterion.id
  readonly kind: "example" | "property";
  /** A boolean JS expression over `trace` (the ExecutionTraceContent). Compiled
   *  and run inside the sandbox, independent of the generating model. */
  readonly expr?: string;
  /** Optional expression naming the OBSERVED operand this check read (e.g.
   *  "trace.result.check"). Fed back on amend so the model sees what it produced.
   *  INV-ORACLE-BLIND: this is the observed value, NEVER the expected answer. */
  readonly observe?: string;
  /** Metamorphic: verify a RELATION over multiple oracle-chosen inputs, instead
   *  of one trace. `probes` are hidden from the model. `relation` is a JS bool
   *  over (input, output) that MUST reference `input` (the ANCHOR LAW: comparing
   *  to a model-controlled output field alone is gameable). */
  readonly metamorphic?: { readonly probes: readonly number[]; readonly relation: string };
}

export interface OracleSuite {
  readonly ref: string;
  readonly assertions: readonly OracleAssertion[];
}

// Built-in suites. In production these would load from R2/D1; here they are
// registered in-process. Each assertion is a pure predicate over the trace.
const SUITES: Record<string, OracleSuite> = {
  "echo@v1": {
    ref: "echo@v1",
    assertions: [{ criterionId: "A1", kind: "example", expr: "trace.result && trace.result.value === 42" }],
  },
  "uc@v1": {
    ref: "uc@v1",
    assertions: [{ criterionId: "A1", kind: "example", expr: "trace.result && trace.result.value === 42" }],
  },
  "multi@v1": {
    ref: "multi@v1",
    assertions: [
      { criterionId: "A1", kind: "example", expr: "trace.result && trace.result.value === 42" },
      // a real property: the run had no ambient network egress (the D5 guarantee)
      { criterionId: "A2", kind: "property", expr: "trace.egress === 'connector-only' || trace.egress === 'none'" },
    ],
  },
  "derived@v1": {
    ref: "derived@v1",
    assertions: [
      { criterionId: "A1", kind: "example", expr: "trace.result && trace.result.value === 42" },
      // a DERIVED requirement: check must be value doubled. Underspecified by a
      // natural-language intent, so a real model plausibly misses it first.
      { criterionId: "A2", kind: "example", expr: "trace.result && trace.result.check === trace.result.value * 2", observe: "trace.result.check" },
    ],
  },
  "derived-hard@v1": {
    ref: "derived-hard@v1",
    assertions: [
      { criterionId: "A1", kind: "example", expr: "trace.result && trace.result.value === 42" },
      // Harder derived rule, not guessable from the intent alone.
      { criterionId: "A2", kind: "example", expr: "trace.result && trace.result.check === trace.result.value * 3 - 5", observe: "trace.result.check" },
    ],
  },
  "derived-fair@v1": {
    ref: "derived-fair@v1",
    assertions: [
      { criterionId: "A1", kind: "example", expr: "trace.result && trace.result.value === 42" },
      // Blind in the intent ("internally consistent"), but DERIVABLE: check is
      // value doubled — inferable from observed pairs across attempts, with no
      // free additive constant. This is the convergence target: evidence CAN
      // close it without ever revealing the rule (INV-ORACLE-BLIND intact).
      { criterionId: "A2", kind: "example", expr: "trace.result && trace.result.check === trace.result.value * 2", observe: "trace.result.check" },
    ],
  },
  "derived-blind@v1": {
    ref: "derived-blind@v1",
    assertions: [
      { criterionId: "A1", kind: "example", expr: "trace.result && trace.result.value === 42" },
      // The acceptance statement shown to the model stays VAGUE ("internally
      // consistent"); it does not state this formula. The model must genuinely
      // guess on attempt 1, then use the amend evidence. This is the fixture
      // that surfaced the evidence-thinness finding (D10) live — kept as the
      // regression case.
      { criterionId: "A2", kind: "example", expr: "trace.result && trace.result.check === trace.result.value * 2 + 7", observe: "trace.result.check" },
    ],
  },
  "derived-mr@v1": {
    ref: "derived-mr@v1",
    assertions: [
      // check must be value doubled — verified over hidden probes, anchored on
      // `input`. A hardcoded output passes value=42 but fails 43/91.
      { criterionId: "A1", kind: "example", metamorphic: { probes: [42, 43, 91], relation: "output.check === input * 2" } },
      // and the function must preserve value (shape pin), also anchored on input.
      { criterionId: "A2", kind: "property", metamorphic: { probes: [42, 43, 91], relation: "output.value === input" } },
    ],
  },
  "regress@v1": {
    ref: "regress@v1",
    assertions: [
      { criterionId: "A1", kind: "example", expr: "trace.result && trace.result.value === 42" },
      { criterionId: "A2", kind: "example", expr: "trace.result && trace.result.tag === 'perfect'" }, // never satisfied
    ],
  },
  "tier@v1": {
    ref: "tier@v1",
    assertions: [{ criterionId: "A1", kind: "example", expr: "trace.result && trace.result.tier === 'pro'" }],
  },
  "foreign@v1": {
    ref: "foreign@v1",
    assertions: [
      // Passes for BOTH lookup and lookupPoisoned: projection already stripped
      // the injected field before this ever runs, so the same assertion holds.
      { criterionId: "A1", kind: "example", expr: "trace.result && trace.result.value === 42 && trace.result.ok === true" },
    ],
  },
  "foreign-effectful@v1": {
    ref: "foreign-effectful@v1",
    assertions: [{ criterionId: "A1", kind: "example", expr: "trace.result && trace.result.done === true" }],
  },
  "fx@v1": {
    ref: "fx@v1",
    assertions: [
      // A1 structural: all three rates present, positive numbers
      { criterionId: "A1", kind: "example", expr: "trace.result && typeof trace.result.usd_eur === 'number' && typeof trace.result.eur_gbp === 'number' && typeof trace.result.usd_gbp === 'number' && trace.result.usd_eur > 0 && trace.result.eur_gbp > 0 && trace.result.usd_gbp > 0" },
      // A2 ANCHORED (anchor law + E-A): each returned rate must equal the rate the
      // fx connector ACTUALLY returned, recorded in trace.calls. Anchoring on the
      // recorded API response (not on the other output fields) closes the shortcut
      // "compute one rate from the others" and "fabricate": the model must fetch
      // all three and report them faithfully. tol 1e-6 distinguishes a faithfully
      // reported fetch (diff 0) from a computed value (~3e-6 off).
      { criterionId: "A2", kind: "property", expr: "trace.result && Array.isArray(trace.calls) && [['USD','EUR','usd_eur'],['EUR','GBP','eur_gbp'],['USD','GBP','usd_gbp']].every(function(t){var call=trace.calls.find(function(c){return c.connector==='fx'&&c.args&&c.args.from===t[0]&&c.args.to===t[1];});if(!call||!call.response||!call.response.rates)return false;var rec=call.response.rates[t[1]];var got=trace.result[t[2]];return typeof rec==='number'&&typeof got==='number'&&Math.abs(got-rec)/rec<1e-6;})" },
    ],
  },
  "geo@v1": {
    ref: "geo@v1",
    assertions: [
      { criterionId: "A1", kind: "example", expr: "trace.result && typeof trace.result.latitude === 'number' && typeof trace.result.longitude === 'number' && typeof trace.result.temperature_c === 'number'", observe: "trace.result" },
      // A2 CROSS-STEP ANCHOR: the weather call must have been made with the coords
      // the GEOCODE actually returned (real threading, not invented coords), and
      // the returned temperature must equal what the weather call actually returned.
      { criterionId: "A2", kind: "property", expr: "(function(){ if(!trace.result||!Array.isArray(trace.calls))return false; var g=trace.calls.find(function(c){return c.connector==='geo';}); var w=trace.calls.find(function(c){return c.connector==='weather';}); if(!g||!w||!g.response||!g.response.results||!g.response.results[0]||!w.response||!w.response.current)return false; var gr=g.response.results[0]; if(Math.abs(w.args.latitude-gr.latitude)>1e-4||Math.abs(w.args.longitude-gr.longitude)>1e-4)return false; return trace.result.temperature_c===w.response.current.temperature_2m; })()", observe: "(function(){var w=(trace.calls||[]).find(function(c){return c.connector==='weather';});return w?w.response:null;})()" },
    ],
  },
  "ledger@v1": {
    ref: "ledger@v1",
    assertions: [
      // A1 ANCHORED on the final recorded read-back: exactly ONE record for the key,
      // and its value is the target ("active"). Verifies real post-state, not the
      // model's claim; the write is never re-run.
      { criterionId: "A1", kind: "property", expr: "(function(){ if(!Array.isArray(trace.calls))return false; var lists=trace.calls.filter(function(c){return c.connector==='ledger'&&c.method==='list';}); if(!lists.length)return false; var recs=lists[lists.length-1].response; if(!Array.isArray(recs))return false; return recs.length===1 && recs[0] && recs[0].value==='active'; })()" },
    ],
  },
  "fxrate@v1": {
    ref: "fxrate@v1",
    assertions: [
      { criterionId: "A1", kind: "example", expr: "(function(){ if(!trace.result||!Array.isArray(trace.calls))return false; var c=trace.calls.find(function(x){return x.connector==='fx'&&x.args&&x.args.from==='USD'&&x.args.to==='EUR';}); if(!c||!c.response||!c.response.rates)return false; var rec=c.response.rates.EUR; var got=trace.result.usd_eur; return typeof got==='number'&&typeof rec==='number'&&Math.abs(got-rec)/rec<1e-6; })()" },
      { criterionId: "A2", kind: "example", expr: "(function(){ if(!trace.result||!Array.isArray(trace.calls))return false; var c=trace.calls.find(function(x){return x.connector==='fx'&&x.args&&x.args.from==='USD'&&x.args.to==='GBP';}); if(!c||!c.response||!c.response.rates)return false; var rec=c.response.rates.GBP; var got=trace.result.usd_gbp; return typeof got==='number'&&typeof rec==='number'&&Math.abs(got-rec)/rec<1e-6; })()" },
      { criterionId: "A3", kind: "example", expr: "(function(){ if(!trace.result||!Array.isArray(trace.calls))return false; var c=trace.calls.find(function(x){return x.connector==='fx'&&x.args&&x.args.from==='USD'&&x.args.to==='JPY';}); if(!c||!c.response||!c.response.rates)return false; var rec=c.response.rates.JPY; var got=trace.result.usd_jpy; return typeof got==='number'&&typeof rec==='number'&&Math.abs(got-rec)/rec<1e-6; })()" },
    ],
  },
  "strict@v1": {
    ref: "strict@v1",
    assertions: [
      { criterionId: "A1", kind: "example", expr: "trace.result && trace.result.value === 42" },
      // deliberately demanding: requires a field the default action omits
      { criterionId: "A2", kind: "property", expr: "trace.result && trace.result.strict === true" },
    ],
  },
};

export interface OracleSuiteRegistry {
  resolve(ref: string): OracleSuite | null;
}

export class InMemorySuiteRegistry implements OracleSuiteRegistry {
  resolve(ref: string): OracleSuite | null {
    return SUITES[ref] ?? null;
  }
}

/** Compile covered assertions into one sandbox program returning per-criterion
 *  results. Each expr is wrapped so a throw becomes "error", never a false pass. */
export function compileProgram(trace: ExecutionTraceContent, assertions: readonly OracleAssertion[]): string {
  const checks = assertions.map((a) => {
    const obs = a.observe
      ? ` try { observed[${JSON.stringify(a.criterionId)}] = ((trace) => (${a.observe}))(trace); } catch (e) {}`
      : "";
    return `try { results[${JSON.stringify(a.criterionId)}] = ((trace) => (${a.expr ?? 'false'}))(trace) ? "pass" : "fail"; }` +
      ` catch (e) { results[${JSON.stringify(a.criterionId)}] = "error"; }` + obs;
  }).join("\n");
  return `
    const trace = ${JSON.stringify(trace)};
    const results = {};
    const observed = {};
    ${checks}
    return { results, observed };
  `;
}

/** Probe program: wrap the model's action code as compute(value), run it over
 *  each assertion's hidden probes, and check the relation anchored on `input`. */
export function compileMetamorphic(actionCode: string, assertions: readonly OracleAssertion[]): string {
  const checks = assertions.map((a) => {
    const m = a.metamorphic!;
    return `{
      const probes = ${JSON.stringify(m.probes)};
      const pairs = probes.map((value) => {
        try { return { input: value, output: compute(value) }; }
        catch (e) { return { input: value, error: String(e) }; }
      });
      const ok = pairs.every((p) => p.output !== undefined && ((input, output) => (${m.relation}))(p.input, p.output));
      results[${JSON.stringify(a.criterionId)}] = ok ? "pass" : "fail";
      observed[${JSON.stringify(a.criterionId)}] = pairs;
    }`;
  }).join("\n");
  return `
    const compute = (value) => { ${actionCode} };
    const results = {};
    const observed = {};
    ${checks}
    return { results, observed };
  `;
}

/** True if any criterion in the referenced suite is metamorphic (so the
 *  composition knows to wrap the action as a compute body). */
export function suiteIsMetamorphic(ref: string): boolean {
  const suite = new InMemorySuiteRegistry().resolve(ref);
  return !!suite && suite.assertions.some((a) => !!a.metamorphic);
}
