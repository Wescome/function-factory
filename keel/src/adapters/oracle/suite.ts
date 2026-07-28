/**
 * suite.ts — Oracle suites (adapter-side infrastructure, not domain-frozen).
 *
 * A Specification carries an `oracleRef` (frozen) that names a suite. The suite
 * maps each AcceptanceCriterion id to an executable assertion over the recorded
 * ExecutionTrace. This is the "frozen oracle suite the Verifier runs" — it lives
 * outside the domain (like a test file the Verifier loads), so adding/changing
 * suites never touches the frozen contracts.
 */
import type { ExecutionTraceContent, AcceptanceCriterion } from "../../domain/index";

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
   *  to a model-controlled output field alone is gameable).
   *
   *  PLAYBOOK-KEEL-FAMILY-001 (R4): `relation` is optional -- when the paired
   *  `AcceptanceCriterion` carries a `family`, the family IS the evaluate
   *  step (compileMetamorphic) and `relation` goes unused; an untyped
   *  criterion (no `family`) still requires `relation` (INV-R4-ADDITIVE, the
   *  pre-R4 path, unchanged). */
  readonly metamorphic?: { readonly probes: readonly number[]; readonly relation?: string };
  /** PLAYBOOK-KEEL-COMPOSE: a PARENT-level cross-cut over DERIVED CHILDREN's
   *  produced values, not one trace. `relation` is a JS bool over `outputs`
   *  (a `Record<servesClause, unknown>` — the anchor law one level up: it must
   *  read the outputs the parent clause actually spans, never just assert the
   *  children agree with each other for no stated reason). `requires` is the
   *  set of `servesClause` ids the relation reads — declared, not parsed out
   *  of the relation string, so the vacuity gate (composeRun) can check
   *  observability BEFORE evaluating anything, the same way `metamorphic`
   *  declares `probes` rather than have the runtime infer them. */
  readonly composes?: { readonly relation: string; readonly requires: readonly string[] };
  /** PLAYBOOK-KEEL-SEAM (INV-DECOMP-5): `geo@v1`'s A2 cross-step anchor
   *  generalized from "two calls in one trace" to "two children across two
   *  runs." `composes` asks whether the children's outputs jointly satisfy a
   *  parent relation; `seams` asks a DIFFERENT question — did the value
   *  threaded from an upstream child survive being read by a downstream one.
   *  A list because one parent may declare several seams. Each `relation` is
   *  a JS bool over two bound operands, `upstream` and `downstream` — each
   *  child's recorded `observed.value` from `join()`, never the downstream
   *  child's unverified claim about what it received. The ANCHOR LAW: the
   *  relation MUST reference `upstream` — reading only `downstream` is
   *  gameable (a child could just claim the right value) and is malformed,
   *  same discipline as `metamorphic`'s `input`-reference requirement, one
   *  level up. */
  readonly seams?: readonly { readonly upstream: string; readonly downstream: string; readonly relation: string }[];
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
  // store.append: the effectful, non-idempotent write — the model must still
  // do read-before-write itself (select, then append-if-absent); verified the
  // same way ledger@v1 always was, just renamed onto store/select.
  "store-append@v1": {
    ref: "store-append@v1",
    assertions: [
      // A1 ANCHORED on the final recorded read-back: exactly ONE record for the key,
      // and its value is the target ("active"). Verifies real post-state, not the
      // model's claim; the write is never re-run.
      { criterionId: "A1", kind: "property", expr: "(function(){ if(!Array.isArray(trace.calls))return false; var sels=trace.calls.filter(function(c){return c.connector==='store'&&c.method==='select';}); if(!sels.length)return false; var recs=sels[sels.length-1].response; if(!Array.isArray(recs))return false; return recs.length===1 && recs[0] && recs[0].value==='active'; })()" },
    ],
  },
  // store.ensure: write-idempotent — the connector's own atomic check-then-
  // write means the CALL'S OWN recorded response already carries the
  // post-state (no separate model-orchestrated read-back needed). Still
  // anchored on the recorded ConnectorCall, never the model's `return`.
  "store-ensure@v1": {
    ref: "store-ensure@v1",
    assertions: [
      { criterionId: "A1", kind: "property", expr: "(function(){ if(!Array.isArray(trace.calls))return false; var e=trace.calls.filter(function(c){return c.connector==='store'&&c.method==='ensure';}); if(!e.length)return false; var r=e[e.length-1].response; return !!r && r.count===1 && r.value==='active'; })()" },
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
  // PLAYBOOK-KEEL-COMPOSE: the whitepaper's invoice case, generalized. R1/R2
  // are each a CHILD's own clause (independently correct, each observing its
  // own computed `tax` — a plausible per-line vs per-subtotal rounding), and
  // R3 is the PARENT'S cross-cut: the two presented tax figures must agree.
  // Two individually-green children can still fail R3 (14.01 vs 14.00) — the
  // whole point. R1/R2 deliberately don't assert what the number IS (any
  // valid decomposition strategy is fine per-child); R3 is where composition
  // — or its absence — becomes visible.
  "compose-demo@v1": {
    ref: "compose-demo@v1",
    assertions: [
      { criterionId: "R1", kind: "example", expr: "trace.result && typeof trace.result.tax === 'number'", observe: "trace.result.tax" },
      { criterionId: "R2", kind: "example", expr: "trace.result && typeof trace.result.tax === 'number'", observe: "trace.result.tax" },
      { criterionId: "R3", kind: "property", composes: { relation: "outputs['R1'] === outputs['R2']", requires: ["R1", "R2"] } },
    ],
  },
  // The vacuity fixture: R2 declares NO `observe` (nor `metamorphic`) — it can
  // pass or fail on its own, but produces nothing a composition can read. R3
  // requires it, so compose must report R3 unverifiable, never pass or fail.
  "compose-vacuous@v1": {
    ref: "compose-vacuous@v1",
    assertions: [
      { criterionId: "R1", kind: "example", expr: "trace.result && typeof trace.result.tax === 'number'", observe: "trace.result.tax" },
      { criterionId: "R2", kind: "example", expr: "trace.result && typeof trace.result.tax === 'number'" }, // no observe — deliberate
      { criterionId: "R3", kind: "property", composes: { relation: "outputs['R1'] === outputs['R2']", requires: ["R1", "R2"] } },
    ],
  },
  // PLAYBOOK-KEEL-COMPOSE-ANCHOR: THE HOLE, as a fixture. `requires` gates
  // R1/R2, but the relation reads `outputs['R4']` — a clause declared
  // NOWHERE, so `outputs.R4` is always `undefined`. Before the anchor check,
  // this ran the relation over that hole and returned a spurious pass/fail;
  // now it must report `error` naming R4, never a judgment.
  "compose-hole@v1": {
    ref: "compose-hole@v1",
    assertions: [
      { criterionId: "R1", kind: "example", expr: "trace.result && typeof trace.result.tax === 'number'", observe: "trace.result.tax" },
      { criterionId: "R2", kind: "example", expr: "trace.result && typeof trace.result.tax === 'number'", observe: "trace.result.tax" },
      { criterionId: "R3", kind: "property", composes: { relation: "outputs['R1'] === outputs['R4']", requires: ["R1", "R2"] } },
    ],
  },
  // A relation that reaches `outputs` by a COMPUTED key (`outputs[k]`) —
  // extraction cannot bound it to `requires`, so it is malformed by
  // construction, regardless of what `k` happens to range over at runtime.
  "compose-dynamic@v1": {
    ref: "compose-dynamic@v1",
    assertions: [
      { criterionId: "R1", kind: "example", expr: "trace.result && typeof trace.result.tax === 'number'", observe: "trace.result.tax" },
      { criterionId: "R2", kind: "example", expr: "trace.result && typeof trace.result.tax === 'number'", observe: "trace.result.tax" },
      { criterionId: "R3", kind: "property", composes: { relation: "['R1','R2'].every(function(k){ return outputs[k] === outputs['R1']; })", requires: ["R1", "R2"] } },
    ],
  },
  // A DEAD declaration: `requires` lists R2, but the relation never reads it.
  // Over-gating only (R2 still has to be observed before this runs), never a
  // soundness hole — reported as a warning, the verdict is still the
  // relation's real pass/fail, never `error`.
  "compose-dead@v1": {
    ref: "compose-dead@v1",
    assertions: [
      { criterionId: "R1", kind: "example", expr: "trace.result && typeof trace.result.tax === 'number'", observe: "trace.result.tax" },
      { criterionId: "R2", kind: "example", expr: "trace.result && typeof trace.result.tax === 'number'", observe: "trace.result.tax" },
      { criterionId: "R3", kind: "property", composes: { relation: "outputs['R1'] > 0", requires: ["R1", "R2"] } },
    ],
  },
  // PLAYBOOK-KEEL-SEAM: the Mars-Orbiter shape. S1 (upstream) records a
  // value; S2 (downstream) records what it "received." Both independently
  // green (each just checks its own field is a number) — the seam is the
  // ONLY thing that can catch S2 having read (or been given) the wrong
  // value. S3 carries the seam declaration; it has no `expr`/`observe` of
  // its own, only `seams` — mirrors `compose-demo@v1`'s R3 carrying only
  // `composes`.
  "seam-demo@v1": {
    ref: "seam-demo@v1",
    assertions: [
      { criterionId: "S1", kind: "example", expr: "trace.result && typeof trace.result.val === 'number'", observe: "trace.result.val" },
      { criterionId: "S2", kind: "example", expr: "trace.result && typeof trace.result.received === 'number'", observe: "trace.result.received" },
      { criterionId: "S3", kind: "property", seams: [{ upstream: "S1", downstream: "S2", relation: "downstream === upstream" }] },
    ],
  },
  // The vacuity fixture: S1 declares NO `observe` — produces nothing a seam
  // can anchor on, regardless of what S2 records.
  "seam-vacuous@v1": {
    ref: "seam-vacuous@v1",
    assertions: [
      { criterionId: "S1", kind: "example", expr: "trace.result && typeof trace.result.val === 'number'" }, // no observe — deliberate
      { criterionId: "S2", kind: "example", expr: "trace.result && typeof trace.result.received === 'number'", observe: "trace.result.received" },
      { criterionId: "S3", kind: "property", seams: [{ upstream: "S1", downstream: "S2", relation: "downstream === upstream" }] },
    ],
  },
  // A relation that reads only `downstream` — never anchored on the
  // upstream's recorded output. Malformed regardless of what either child
  // actually produced.
  "seam-unanchored@v1": {
    ref: "seam-unanchored@v1",
    assertions: [
      { criterionId: "S1", kind: "example", expr: "trace.result && typeof trace.result.val === 'number'", observe: "trace.result.val" },
      { criterionId: "S2", kind: "example", expr: "trace.result && typeof trace.result.received === 'number'", observe: "trace.result.received" },
      { criterionId: "S3", kind: "property", seams: [{ upstream: "S1", downstream: "S2", relation: "downstream === 14" }] },
    ],
  },
  // Both legs, one suite: R1/R2/R3 (cross-cut, exactly compose-demo@v1's
  // shape) plus a seam from R1 (reused as the seam's upstream) to S2 (the
  // downstream) — proves the two checks are independent: a tree can pass one
  // and fail the other in the same run. Deliberately only THREE root clauses
  // (R1, R2, S2) — the real SPEC_LOOP_BOUND.maxFanout is 3
  // (orchestrator.ts), so a 4-clause decomposable root would have its 4th
  // clause sliced away and the coverage gate would escalate before any
  // children were ever admitted (PLAYBOOK-KEEL-COVERAGE) — a fourth,
  // separate S1 upstream clause would trip that, unrelated to what this
  // fixture is testing.
  "seam-and-compose-demo@v1": {
    ref: "seam-and-compose-demo@v1",
    assertions: [
      { criterionId: "R1", kind: "example", expr: "trace.result && typeof trace.result.tax === 'number'", observe: "trace.result.tax" },
      { criterionId: "R2", kind: "example", expr: "trace.result && typeof trace.result.tax === 'number'", observe: "trace.result.tax" },
      { criterionId: "R3", kind: "property", composes: { relation: "outputs['R1'] === outputs['R2']", requires: ["R1", "R2"] } },
      { criterionId: "S2", kind: "example", expr: "trace.result && typeof trace.result.received === 'number'", observe: "trace.result.received" },
      { criterionId: "S4", kind: "property", seams: [{ upstream: "R1", downstream: "S2", relation: "downstream === upstream" }] },
    ],
  },
  // PLAYBOOK-KEEL-WORKSPACE-001: anchored on trace.calls, same discipline as
  // fxrate@v1/geo@v1 -- verifies the RECORDED clone/glob/readFile calls, not
  // just trace.result, so a model that fabricates the result without actually
  // calling git.clone/state.readFile cannot pass.
  "workspace-read@v1": {
    ref: "workspace-read@v1",
    assertions: [
      { criterionId: "A1", kind: "example", expr: "(function(){ var c=trace.calls.find(function(x){return x.connector==='git'&&x.method==='clone';}); return !!c && !!c.response && c.response.dir==='/repo'; })()" },
      { criterionId: "A2", kind: "example", expr: "(function(){ var c=trace.calls.find(function(x){return x.connector==='state'&&x.method==='glob';}); return !!c && Array.isArray(c.response) && c.response.length>0; })()" },
      { criterionId: "A3", kind: "example", expr: "(function(){ var c=trace.calls.find(function(x){return x.connector==='state'&&x.method==='readFile';}); return !!c && typeof c.response==='string' && c.response.length>0 && trace.result && trace.result.content===c.response; })()" },
    ],
  },
  // PLAYBOOK-KEEL-WRITE-ROLLBACK-001 (D.2): attempt 1's created files must be
  // gone by attempt 2 -- passes only after a real revert.
  "wr-clean@v1": {
    ref: "wr-clean@v1",
    assertions: [{ criterionId: "A1", kind: "example", expr: "trace.result && trace.result.phase === 2 && trace.result.aGone === true && trace.result.bGone === true" }],
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

/** PLAYBOOK-KEEL-FAMILY-001 (R4, B.2): a family-tagged criterion's *evaluate*
 *  step -- the SAME slot the opaque `m.relation` fills for an untyped
 *  criterion (B.3: scope gates first, family/relation evaluates last).
 *  `p`/`i`/`rawPairs` are the generated program's own locals (see
 *  `compileMetamorphic`) -- this only emits the JS statement(s) that decide
 *  "pass"/"fail" for probe `p` at index `i`.
 *
 *  Disclosed probe design (the playbook gives the shape, not the codegen):
 *  - equality: `output === expected(input)`.
 *  - invariance / idempotence: a SECOND `compute` call (transformed input /
 *    the first output fed back in), compared structurally (JSON-stable) --
 *    wrapped in its own try/catch, fail-closed like any other thrown probe.
 *  - monotonicity: probes are sorted by `input` first (`monoSorted`/
 *    `monoRank`, injected by `compileMetamorphic` only for this family),
 *    then walked ADJACENT-ON-SORTED -- for a total order this is equivalent
 *    to checking every pair, not just consecutive ones, without going
 *    quadratic (a corrected design: an earlier, unsorted adjacent-in-given-
 *    order walk could miss a violation between two probes that weren't
 *    adjacent in the order they happened to be given, e.g. probes
 *    [3, 1, 2] would never directly compare 2 and 3).
 *  - bounded: `lo`/`hi`/`baseline` are ANDed range checks; `baseline` means
 *    "no worse than" == `output >= baseline` (higher-is-better, undirected
 *    in the brief -- disclosed default).
 *  Fail-closed if a family somehow reaches here without its required
 *  parameter (freezeGate's `isFamilyAdmittable` already rejects this at
 *  spec-admission time; this is a defensive floor, never reached in
 *  practice, never a silent pass). */
function familyEvaluateStep(family: NonNullable<AcceptanceCriterion["family"]>): string {
  switch (family.kind) {
    case "equality":
      return family.expected
        ? `return p.output === ((input) => (${family.expected}))(p.input) ? "pass" : "fail";`
        : `return "fail";`;
    case "invariance":
      return `
        try {
          const transformed = ((input) => (${family.transform}))(p.input);
          const output2 = compute(transformed);
          return JSON.stringify(p.output) === JSON.stringify(output2) ? "pass" : "fail";
        } catch (e) { return "fail"; }
      `;
    case "idempotence":
      return `
        try {
          const output2 = compute(p.output);
          return JSON.stringify(p.output) === JSON.stringify(output2) ? "pass" : "fail";
        } catch (e) { return "fail"; }
      `;
    case "monotonicity":
      return `
        const rank = monoRank.get(i);
        if (rank === 0) return "pass";
        const prev = monoSorted[rank - 1].p;
        if (prev.output === undefined) return "fail";
        return (${family.order === "asc" ? "prev.output <= p.output" : "prev.output >= p.output"}) ? "pass" : "fail";
      `;
    case "bounded": {
      const checks: string[] = [];
      if (family.lo !== undefined) checks.push(`p.output >= (${JSON.stringify(family.lo)})`);
      if (family.hi !== undefined) checks.push(`p.output <= (${JSON.stringify(family.hi)})`);
      if (family.baseline !== undefined) checks.push(`p.output >= (${JSON.stringify(family.baseline)})`);
      return checks.length ? `return (${checks.join(" && ")}) ? "pass" : "fail";` : `return "fail";`;
    }
    default: {
      const _never: never = family;
      return _never;
    }
  }
}

/**
 * Probe program: wrap the model's action code as compute(value), run it over
 * each assertion's hidden probes, and check the relation anchored on `input`.
 *
 * PLAYBOOK-KEEL-RELATION-SCOPE-001 (R1, B.3): `results[criterionId]` is now
 * an ARRAY of per-probe statuses ("pass"|"fail"|"inconclusive"|
 * "not-applicable"), not a single "pass"/"fail" string -- the caller
 * (suite-oracle.adapter.ts) rolls it up with `aggregateVerdict` (L1). This
 * is a UNIFIED refactor, not scope-conditional: an UNSCOPED criterion (no
 * `applicability`/`invalidators` on its `AcceptanceCriterion`) generates
 * the identical per-probe pass/fail array it always implicitly computed,
 * and `aggregateVerdict` over pass/fail-only statuses reduces to exactly
 * the old `.every()` behavior -- Track C/D.7, byte-for-byte for unscoped
 * relations.
 *
 * Per probed input, in order (B.3): a thrown probe fails outright
 * (unchanged from before this playbook); else applicability (ALL must
 * hold) false -> not-applicable; else any invalidator firing ->
 * inconclusive; else evaluate -> pass/fail.
 *
 * PLAYBOOK-KEEL-FAMILY-001 (R4, B.3): "evaluate" is now either the opaque
 * `m.relation` (untyped, unchanged, INV-R4-ADDITIVE) or a family's typed
 * probe (`familyEvaluateStep`) when the criterion carries one -- same slot,
 * scope still gates ahead of it either way.
 */
export function compileMetamorphic(
  actionCode: string,
  pairs: readonly { readonly criterion: AcceptanceCriterion; readonly assertion: OracleAssertion }[],
): string {
  const checks = pairs.map(({ criterion, assertion: a }) => {
    const m = a.metamorphic!;
    const applicability = criterion.applicability ?? [];
    const invalidators = criterion.invalidators ?? [];
    const applicabilityCheck = applicability.length
      ? `if (!((input, output) => (${applicability.map((e) => `(${e})`).join(" && ")}))(p.input, p.output)) return "not-applicable";`
      : "";
    const invalidatorCheck = invalidators.length
      ? `if (((input, output) => (${invalidators.map((e) => `(${e})`).join(" || ")}))(p.input, p.output)) return "inconclusive";`
      : "";
    const evaluateStep = criterion.family
      ? familyEvaluateStep(criterion.family)
      : (m.relation ? `return ((input, output) => (${m.relation}))(p.input, p.output) ? "pass" : "fail";` : `return "fail";`);
    // Monotonicity needs a SORTED-BY-INPUT view (adjacent-on-sorted ==
    // all-pairs for a total order) -- built once per criterion, indexed by
    // each probe's ORIGINAL position so `results`/`observed` stay in the
    // given probe order regardless of sort.
    const monotoneSetup = criterion.family?.kind === "monotonicity"
      ? `
        const monoSorted = rawPairs.map((p, idx) => ({ p, idx })).sort((a, b) => a.p.input - b.p.input);
        const monoRank = new Map(monoSorted.map((e, rank) => [e.idx, rank]));
      `
      : "";
    return `{
      const probes = ${JSON.stringify(m.probes)};
      const rawPairs = probes.map((value) => {
        try { return { input: value, output: compute(value) }; }
        catch (e) { return { input: value, error: String(e) }; }
      });
      ${monotoneSetup}
      const perProbe = rawPairs.map((p, i) => {
        if (p.output === undefined) return "fail";
        ${applicabilityCheck}
        ${invalidatorCheck}
        ${evaluateStep}
      });
      results[${JSON.stringify(a.criterionId)}] = perProbe;
      observed[${JSON.stringify(a.criterionId)}] = rawPairs;
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

/** PLAYBOOK-KEEL-COMPOSE: true if the referenced suite has a cross-cut over
 *  derived children at all — lets the orchestrator know a root has a
 *  composition clause without resolving the whole suite just to check. */
export function suiteComposes(ref: string): boolean {
  const suite = new InMemorySuiteRegistry().resolve(ref);
  return !!suite && suite.assertions.some((a) => !!a.composes);
}

/** Compose program: mirrors `compileMetamorphic` one level up — a relation
 *  over the GATHERED CHILD OUTPUTS (`outputs`, keyed by servesClause) instead
 *  of one trace or one (input, output) pair. A throw becomes "error", never a
 *  silent pass. `observed[criterionId] = outputs` records exactly what was
 *  composed — the values, never an expected answer (INV-ORACLE-BLIND holds
 *  up-leg: the relation itself encodes the expectation; the recorded
 *  `observed` never does). */
export function compileComposition(outputs: Record<string, unknown>, assertion: OracleAssertion): string {
  const c = assertion.composes!;
  return `
    const outputs = ${JSON.stringify(outputs)};
    const results = {};
    const observed = {};
    try {
      results[${JSON.stringify(assertion.criterionId)}] = ((outputs) => (${c.relation}))(outputs) ? "pass" : "fail";
    } catch (e) {
      results[${JSON.stringify(assertion.criterionId)}] = "error";
    }
    observed[${JSON.stringify(assertion.criterionId)}] = outputs;
    return { results, observed };
  `;
}

/** PLAYBOOK-KEEL-COMPOSE-ANCHOR: a targeted scan of the DECLARED access form
 *  (`outputs['X']` / `outputs["X"]`) — not a JS parse, the same "declared,
 *  not inferred" discipline `requires` and metamorphic `probes` already
 *  follow. `clauses` is every literal-keyed clause the relation reads.
 *  `dynamic` is true if the relation reaches `outputs[` through anything
 *  OTHER than an immediate quoted literal (a computed key) — that access
 *  cannot be bounded, so it cannot be shown to stay within `requires`. */
export function relationOperands(relation: string): { readonly clauses: ReadonlySet<string>; readonly dynamic: boolean } {
  const clauses = new Set<string>();
  const totalAccess = [...relation.matchAll(/outputs\[/g)].length;
  const literalAccess = relation.matchAll(/outputs\[\s*(?:'([^']*)'|"([^"]*)")\s*\]/g);
  let literalCount = 0;
  for (const m of literalAccess) {
    literalCount++;
    const id = m[1] ?? m[2];
    if (id !== undefined) clauses.add(id);
  }
  return { clauses, dynamic: literalCount < totalAccess };
}

/** PLAYBOOK-KEEL-COMPOSE-ANCHOR: the composition anchor law, stated as a
 *  checkable property (unlike metamorphic's `input`-reference law, which is
 *  semantic and enforced only as a comment). The threat here isn't a model
 *  gaming its own output — composition operands come from independent runs,
 *  each with its own oracle. The threat is a relation that reads an operand
 *  the vacuity gate never gated, so the check runs over a value that may not
 *  exist. Closing it: `operands(relation) ⊆ requires`. A relation that reads
 *  outside `requires`, or reaches `outputs` by a computed key, is a MALFORMED
 *  assertion — `error`, never a judgment. A declared-but-unread clause in
 *  `requires` (`dead`) only over-gates; it is reported as a warning, never a
 *  failure, so this check can never turn a sound assertion red. */
export function checkComposesAnchor(assertion: OracleAssertion): { readonly ok: true; readonly warnings?: readonly string[] } | { readonly ok: false; readonly reason: string } {
  const c = assertion.composes;
  if (!c) return { ok: true };
  const { clauses, dynamic } = relationOperands(c.relation);
  if (dynamic) {
    return { ok: false, reason: "relation reads outputs by computed key; operands cannot be bounded to requires" };
  }
  const required = new Set(c.requires);
  const extra = [...clauses].filter((x) => !required.has(x)).sort();
  if (extra.length) {
    return { ok: false, reason: `relation reads clause(s) not in requires: ${extra.join(", ")}` };
  }
  const dead = c.requires.filter((x) => !clauses.has(x));
  return dead.length ? { ok: true, warnings: [`requires declares clause(s) never read by the relation: ${dead.join(", ")}`] } : { ok: true };
}

/** PLAYBOOK-KEEL-SEAM: mirrors `compileComposition` one level over — two
 *  NAMED bound operands (`upstream`/`downstream`, each a child's recorded
 *  `observed.value`) instead of a keyed `outputs` map. A throw becomes
 *  "error", never a silent pass. `observed[criterionId] = {upstream,
 *  downstream}` records exactly what was compared — the values, never an
 *  expected answer (INV-ORACLE-BLIND holds for the seam leg too).
 *  `criterionId` is the caller's reporting id for this seam check — `seams`
 *  is a LIST on one `OracleAssertion`, so unlike `compileComposition` (one
 *  relation per assertion, keyed by the assertion's own criterionId) there
 *  is no single id to reuse here; the caller synthesizes one per declared
 *  seam (see `Orchestrator.compose()`). */
export function compileSeam(criterionId: string, upstreamValue: unknown, downstreamValue: unknown, relation: string): string {
  return `
    const upstream = ${JSON.stringify(upstreamValue)};
    const downstream = ${JSON.stringify(downstreamValue)};
    const results = {};
    const observed = {};
    try {
      results[${JSON.stringify(criterionId)}] = ((upstream, downstream) => (${relation}))(upstream, downstream) ? "pass" : "fail";
    } catch (e) {
      results[${JSON.stringify(criterionId)}] = "error";
    }
    observed[${JSON.stringify(criterionId)}] = { upstream, downstream };
    return { results, observed };
  `;
}

/** PLAYBOOK-KEEL-SEAM: the seam's anchor law, checkable — the relation MUST
 *  reference `upstream` (the upstream child's RECORDED output). A relation
 *  that reads only `downstream` never checks the value actually crossed the
 *  seam; it only checks what the downstream child claims, which is exactly
 *  as gameable as a metamorphic relation that never references `input`.
 *  NOTE, scope: unlike `composes`'s `outputs['X']` keyed-map form (where an
 *  UNBOUNDED read of some OTHER clause is the live threat, closed by
 *  `checkComposesAnchor`'s operand-extraction), a seam relation binds exactly
 *  two SCALAR parameters — there is no third clause it could reach by
 *  bracket key, so there is nothing analogous to `relationOperands`'s
 *  computed-key detection to reuse here. Any reference to an identifier
 *  other than `upstream`/`downstream` is simply undefined in the compiled
 *  sandbox and throws at evaluation time — caught by `compileSeam`'s own
 *  try/catch as "error", never a silent pass. This function enforces the one
 *  property that is NOT already covered by that runtime throw: a relation
 *  that reads ONLY `downstream` is syntactically valid (no ReferenceError)
 *  and would otherwise run and produce an unanchored, gameable verdict. */
export function checkSeamAnchor(relation: string): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  if (!/\bupstream\b/.test(relation)) {
    return { ok: false, reason: "relation does not reference upstream — not anchored on the recorded output (the anchor law)" };
  }
  return { ok: true };
}
