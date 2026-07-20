/**
 * gateway-model.adapter.ts — the REAL ModelPort, via Cloudflare AI Gateway.
 *
 * Generates a connectors-only code action for a Specification by prompting an
 * LLM through AI Gateway (OpenAI-compatible chat/completions contract; response
 * parsing also tolerates the Anthropic messages shape). This is the one
 * genuinely untrusted component — everything around it (connectors-only
 * execution, independent verification, append-only lineage, fail-closed
 * degradation) exists to govern exactly this.
 *
 * The fetch is injectable so the adapter's prompt-building and response-parsing
 * are unit-tested without a live call; production passes the global fetch.
 */
import type { ModelPort, GeneratedAction, SpecificationContent, VerdictContent, SkillRecord, ErrorClass } from "../../domain/index";
import { selectSkills, type SkillSelection } from "../../domain/index";

export interface ConnectorDoc {
  readonly name: string;
  readonly description: string;
}

export interface GatewayModelConfig {
  /** Full base URL of the gateway provider path, e.g.
   *  https://gateway.ai.cloudflare.com/v1/<acct>/<gw>/openai */
  readonly url: string;
  readonly model: string;
  readonly apiKey: string;
  readonly connectorDocs?: readonly ConnectorDoc[];
  /** Injectable for tests; defaults to global fetch. */
  readonly fetchImpl?: typeof fetch;
  readonly maxTokens?: number;
  readonly timeoutMs?: number; // request timeout; defaults to 30000ms
  /** Extra request params merged in ONLY on amend turns (evidence present) —
   *  e.g. to cap reasoning on reasoning models that blow up their
   *  chain-of-thought on retries. Provider-specific, so injectable, not
   *  hardcoded (e.g. { reasoning_effort: "low" }). */
  readonly amendParams?: Record<string, unknown>;
  /** Sampling temperature on amend turns. A retry at 0 is greedy and can
   *  reproduce the same wrong code byte-for-byte regardless of the evidence
   *  appended; retries must be able to vary. Cold start stays deterministic
   *  (temperature 0). Defaults to 0.7. */
  readonly amendTemperature?: number;
  /** Metamorphic task: the action is a bare compute(value) body, no connectors.
   *  Set by composition from suiteIsMetamorphic(oracleRef). */
  readonly metamorphic?: boolean;
  /** BRIEF-KEEL-SKILL-001: the active skill rows for THIS run's connectors +
   *  intent, fetched ONCE by composition (`store.activeFor(...)`) before
   *  constructing this adapter — never re-fetched per attempt. `selectSkills`
   *  still runs fresh on every `generate()` call (cold-start vs amend need
   *  different selections), but purely over this already-fetched, frozen
   *  row set — no live store read from here. Absent/empty = no skills,
   *  `connectorDocs` alone (BUILTIN + whatever composition already merged in). */
  readonly skillRows?: readonly SkillRecord[];
}

// Built-in docs for the skeleton connectors, so a live model knows the API.
export const BUILTIN_CONNECTOR_DOCS: readonly ConnectorDoc[] = [
  { name: "echo", description: "echo.emit(args: object) => returns args unchanged. Use to produce a result value." },
  { name: "gate", description: "gate.commit(args: object) => returns args. An approval-gated commit; the run pauses for human approval before its effect runs." },
  // Deliberately shape-ambiguous: the doc does NOT reveal the response shape, so
  // the model must discover it at runtime (the stale-assumption setup, E-C).
  { name: "billing", description: "billing.getTier(customerId: string) => the customer's current plan tier." },
  // Deliberately the raw API shape — the model must discover the rate is
  // nested under rates[to], not a bare number (the fx use case's real unknown).
  { name: "fx", description: "fx.rate({from, to}) => latest reference FX rate; from/to are ISO-4217 codes." },
  { name: "geo", description: "geo.lookup({city}) => geocoding result for a city name." },
  // IMPROVE-SPIKE test case: KEEL-authored interface doc documenting the response
  // shape (not the oracle's expected value — INV-FOREIGN-DESC-NOT-INGESTED holds).
  { name: "weather", description: "weather.current({latitude, longitude}) => current weather at coords. Returns { current: { temperature_2m: number } } — the temperature is nested under current.temperature_2m, not top-level." },
  { name: "store", description: "store.select({key}) => existing records for key (read; use before writing with append). store.ensure({key, value}) => idempotent upsert, not approval-gated. store.append({key, value}) => always appends a new record. APPROVAL-GATED (consequential, non-idempotent)." },
];

export class GatewayModelAdapter implements ModelPort {
  constructor(private readonly cfg: GatewayModelConfig) {}

  async generate(spec: SpecificationContent, evidence?: VerdictContent): Promise<GeneratedAction> {
    const f = this.cfg.fetchImpl ?? fetch;
    // BRIEF-KEEL-SKILL-001: selection runs fresh every call (cold-start vs
    // amend need different results) but only over the already-fetched,
    // frozen `skillRows` — no live store read here.
    const divergenceClass = evidence ? extractDivergenceClass(evidence) : undefined;
    const selection = selectSkills(this.cfg.skillRows ?? [], spec.connectors, spec.intent, {
      amend: !!evidence, divergenceClass,
    });
    const body = {
      model: this.cfg.model,
      // deterministic cold start; retries sample so "try a different
      // interpretation" is possible at the decoding level, not just in words.
      temperature: evidence ? (this.cfg.amendTemperature ?? 0.7) : 0,
      max_tokens: this.cfg.maxTokens ?? 2000,
      messages: [
        { role: "system", content: this.systemPrompt(!!this.cfg.metamorphic, selection.procedure) },
        { role: "user", content: this.userPrompt(spec, evidence, !!this.cfg.metamorphic, selection) },
      ],
      // amend turns only: cap reasoning etc. on models that stall on retries
      ...(evidence ? (this.cfg.amendParams ?? {}) : {}),
    };
    const timeoutMs = this.cfg.timeoutMs ?? 30_000;
    let res: Response;
    try {
      res = await f(`${this.cfg.url}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.cfg.apiKey}` },
        body: JSON.stringify(body),
        // Bound the wait: a stalled backend (no error, no truncation, just never
        // resolving) must not hang the fiber forever. On timeout the request
        // aborts and we fail loud like the other backend-failure modes, so the
        // attempt budget engages and the run fails closed to ESCALATE.
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      const why = e instanceof Error && e.name === "TimeoutError"
        ? `request timed out after ${timeoutMs}ms`
        : `request failed: ${e instanceof Error ? e.message : String(e)}`;
      return { code: `throw new Error(${JSON.stringify("model gateway " + why)});`, connectors: [...spec.connectors] };
    }
    if (!res.ok) {
      // Fail loud to the loop: an empty action will execute to nothing and the
      // oracle will fail it -> amend/escalate. Never silently fabricate code.
      const detail = await res.text().catch(() => "");
      return { code: `throw new Error(${JSON.stringify(`model gateway ${res.status}: ${detail.slice(0, 200)}`)});`, connectors: [...spec.connectors] };
    }
    const json = (await res.json()) as unknown;
    const text = extractText(json);
    const code = extractCode(text);
    if (!code) {
      // Empty response is a GENERATION failure, not model-chosen code. Thread
      // the raw-response diagnostics into the trace so the cause (truncation vs
      // all-reasoning-no-content) is visible in lineage, not guessed.
      const diag = diagnostics(json);
      return { code: `throw new Error(${JSON.stringify("empty model response: " + diag)});`, connectors: [...spec.connectors] };
    }
    return { code, connectors: [...spec.connectors], skills: selection.ids.length ? selection.ids : undefined };
  }

  private systemPrompt(mr: boolean, procedure?: string): string {
    if (mr) {
      return [
        "You are a code-generating agent. You write the BODY of a function `compute(value)`.",
        "Your code receives a single parameter `value` and must compute and return a result object.",
        "Your code will be run over MULTIPLE different hidden values — so compute from `value`, never hardcode.",
        "Rules:",
        "- Write ONLY the statements that go inside compute(value); it ends with `return {…}`.",
        "- Do NOT wrap your code in a function declaration (no `function task(){…}`, no arrow) — it would never be called.",
        "- Do NOT call any connectors, network, or filesystem. Pure computation from `value` only.",
        "- Output ONLY the code — no prose, no explanation, no markdown fences.",
      ].join("\n");
    }
    if (procedure) {
      // BRIEF-KEEL-SKILL-001: a crystallized procedure exists for this exact
      // intent — steer toward reproducing it (still a real model call, still
      // variance; a FULL bypass is FixedCodeModelAdapter's separate, no-
      // variance replay path, used only to VALIDATE a procedure for
      // promotion, not here).
      return [
        "You are a code-generating agent. A previously-verified procedure exists for this exact task — it is KNOWN to satisfy the acceptance criteria.",
        "Rules:",
        "- Reproduce the given procedure as closely as possible; adapt only what the task's specific values require.",
        "- Use ONLY the listed connectors, called as `await <name>.<method>(argsObject)`.",
        "- Do NOT import anything. Do NOT access the network or filesystem.",
        "- End by `return`ing the result value.",
        "- Output ONLY the code — no prose, no explanation, no markdown fences.",
      ].join("\n");
    }
    return [
      "You are a code-generating agent. You accomplish a task by writing ONE block of JavaScript that calls only the provided connector methods.",
      "Rules:",
      "- Use ONLY the listed connectors, called as `await <name>.<method>(argsObject)`.",
      "- Do NOT import anything. Do NOT access the network or filesystem.",
      "- End by `return`ing the result value.",
      "- Output ONLY the code — no prose, no explanation, no markdown fences.",
    ].join("\n");
  }

  private userPrompt(spec: SpecificationContent, evidence?: VerdictContent, mr = false, selection?: SkillSelection): string {
    const acc = spec.acceptance.map((a) => `  - [${a.id}] (${a.kind}) ${a.statement}`).join("\n");
    // Skill-store connector-doc rows OVERRIDE the base set by connector name;
    // an empty store leaves the base (BUILTIN + whatever composition already
    // merged in, e.g. the foreign connector doc) completely unchanged.
    const baseDocs = this.cfg.connectorDocs ?? BUILTIN_CONNECTOR_DOCS;
    const overrides = new Map((selection?.connectorDocs ?? []).map((d) => [d.name, d]));
    const docs = baseDocs.map((d) => overrides.get(d.name) ?? d);
    for (const [name, d] of overrides) if (!baseDocs.some((b) => b.name === name)) docs.push(d);

    const parts = mr
      ? [
          `Task: ${spec.intent}`,
          `Your code is the body of compute(value); its returned object must satisfy, for EVERY value:\n${acc}`,
          `Write the compute body over \`value\`. No connectors.`,
        ]
      : [
          `Task: ${spec.intent}`,
          `Acceptance criteria (your code's result must satisfy all):\n${acc}`,
          `Available connectors (use only these):\n${docs.filter((d) => spec.connectors.includes(d.name)).map((d) => `  - ${d.description}`).join("\n")}`,
        ];
    if (selection?.procedure) {
      parts.push(`Known-good procedure for this task (adapt as needed, do not deviate unnecessarily):\n\`\`\`\n${selection.procedure}\n\`\`\``);
    }
    if (evidence) {
      const failed = Object.entries(evidence.results).filter(([, v]) => v === "fail").map(([id]) => id);
      const ev = evidence.evidence as { observed?: Record<string, unknown>; calls?: { connector: string; method: string; args: unknown; response?: unknown }[] } | null;
      const observed = ev?.observed ?? {};
      const calls = ev?.calls ?? [];
      const callsNote = calls.length
        ? `\nConnector calls you made and what they ACTUALLY returned (use the real shape):\n` +
          calls.map((c) => `  - ${c.connector}.${c.method}(${JSON.stringify(c.args)}) -> ${JSON.stringify(c.response)}`).join("\n")
        : "";
      const detail = failed.map((id) => {
        const c = spec.acceptance.find((a) => a.id === id);
        const obs = id in observed ? ` — observed at runtime for this check (your result and/or a connector's ACTUAL response): ${JSON.stringify(observed[id])}` : "";
        return `  - [${id}] ${c?.statement ?? "(criterion)"}${obs}`;
      }).join("\n");
      // Shape-aware nudge: if MR probes returned nothing, the failure is a SHAPE
      // bug (uncalled function wrapper / connector call), not a value bug.
      const pairs = Object.values(observed).flat() as { output?: unknown }[];
      const allNull = mr && pairs.length > 0 && pairs.every((p) => p && p.output == null);
      const shapeHint = allNull
        ? " Your code returned NOTHING for the probed inputs (output was null). Return the object directly with `return {…}` — do not wrap it in a function declaration you never call, and do not call connectors."
        : "";
      // Nested-shape imperative: if connectors were called, a null/missing field in
      // the result almost always means the wrong (non-nested) access path. Push the
      // model to read the ACTUAL response structure above. Generic example only —
      // never the real field (keeps the oracle blind).
      const nestedHint = calls.length
        ? " IMPORTANT: if a field in your result is null/undefined, you accessed the WRONG path. Read each connector response's ACTUAL structure shown above and access the correct, possibly NESTED field (e.g. `resp.data.value` rather than `resp.value`). Do not reuse the same field path that just failed; do not invent values."
        : "";
      const nudge = selection?.amendNudge ? ` Skill-derived guidance for this failure: ${selection.amendNudge}` : "";
      parts.push(
        `A previous attempt FAILED verification. These criteria did NOT pass:\n${detail}\n` +
        `Your previous interpretation was wrong — try a materially different one.${shapeHint}${nestedHint}${nudge}${callsNote} ` +
        `Overall outcome: ${evidence.outcome}. Fix the code so every criterion passes. Return only the corrected code.`,
      );
    }
    return parts.join("\n\n");
  }
}

/** BRIEF-KEEL-SKILL-001: read the classified connector error (if any) back off
 *  the oracle's evidence blob (suite-oracle.adapter.ts writes `terminalError`
 *  there from the recorded trace) so an amend call can select a divergence-
 *  matched skill, and so a TERMINAL class suppresses a procedure retry
 *  (OD-SKILL-1) even though in practice decide() already ESCALATEs before
 *  another generate() call would happen for one. */
function extractDivergenceClass(evidence: VerdictContent): ErrorClass | undefined {
  const ev = evidence.evidence as { terminalError?: ErrorClass } | null;
  return ev?.terminalError ?? undefined;
}

function extractText(json: unknown): string {
  const j = json as {
    choices?: { message?: { content?: string } }[];   // OpenAI-compatible
    content?: { text?: string }[];                     // Anthropic messages
  };
  const openai = j.choices?.[0]?.message?.content;
  if (typeof openai === "string") return openai;
  const anthropic = j.content?.[0]?.text;
  if (typeof anthropic === "string") return anthropic;
  return "";
}

/** Strip markdown fences if the model wrapped the code; "" if there is none. */
function extractCode(text: string): string {
  const fence = text.match(/```(?:[a-zA-Z]+)?\n([\s\S]*?)```/);
  return (fence?.[1] ?? text).trim();
}

/** Raw-response diagnostics for an empty generation, recorded into the trace so
 *  the cause is attributable in lineage (truncation vs all-reasoning-no-content
 *  vs provider hiccup) rather than inferred after the fact. */
function diagnostics(json: unknown): string {
  const j = json as {
    choices?: { finish_reason?: string; message?: { reasoning_content?: string } }[];
    usage?: { completion_tokens?: number };
  };
  const c = j.choices?.[0];
  const finish = c?.finish_reason ?? "unknown";
  const reasoning = c?.message?.reasoning_content ? "present" : "absent";
  const tokens = j.usage?.completion_tokens ?? "?";
  return `gateway returned no usable code [finish_reason=${finish}; reasoning_content=${reasoning}; completion_tokens=${tokens}]`;
}
