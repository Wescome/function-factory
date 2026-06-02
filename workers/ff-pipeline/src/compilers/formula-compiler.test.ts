/**
 * formula-compiler.test.ts — TDD tests for the Gas City Formula Compiler
 * and Dispatch function (IP-1).
 *
 * IS: specs/intent-specifications/IS-GC-EP-FORMULA-DISPATCH.md
 *
 * Validation obligations covered:
 *   V1  — Determinism (byte-identical vars + parameters_json on replay)
 *   V2  — No-LLM (runtime guard; CI static-import scan is the authoritative
 *         check — see note at end of file)
 *   V3  — FORM-* write failure ⇒ zero Gas City calls
 *   V4  — dispatch_log row exists before CALL 1 fires
 *   V5  — Version mismatch ⇒ outcome "version_mismatch" + no CALL 2/3
 *   V6  — CALL 2 returns 409 with matching prior bead ⇒ proceeds to CALL 3
 *   V7  — CALL 3 returns 409 with matching workflow_id ⇒ success-on-replay
 *   V8  — CALL 2 body labels = exactly the 5 lineage labels
 *   V9  — factory_attempt >= 2 ⇒ 6th label amendment-of:{prior_es_id}
 *   V10 — No Coherence VR ⇒ UncertaintyEntry + halt, no writes
 *   V11 — FORM-* key collision with byte-equal vars ⇒ reuse + proceed
 *   V12 — FORM-* key collision with different source_refs[0] ⇒ halt
 *   V13 — Partition recovery (pending row with gc_bead_id, null workflow_id)
 *         ⇒ skip CALL 1+2, fire CALL 3 with stored bead
 *   V14 — Reserved-key collision in EP parameters ⇒ UncertaintyEntry + halt
 */

import { describe, it, expect, beforeEach } from "vitest"
import {
  compileAndDispatchFormula,
  type FormulaCompilerDeps,
  type FormulaCompilerEnv,
  type FormulaCompilerResult,
  type DispatchLogRow,
  type FormArtifact,
} from "./formula-compiler.js"

// ─── Test fixtures ────────────────────────────────────────────────────────

const BASE_ENV: FormulaCompilerEnv = {
  GAS_CITY_BASE_URL: "https://gas-city.test",
  GAS_CITY_CITY_NAME: "factory",
  GAS_CITY_BEARER_TOKEN: "test-bearer-token",
  GAS_CITY_AGENT_NAME: "coder-agent",
  GAS_CITY_RIG: "factory-rig",
  GAS_CITY_RIG_ROOT: "/tmp/rig-root",
  GAS_CITY_WEBHOOK_URL: "https://factory.example/webhooks/gascity",
  FACTORY_MAX_ITERATIONS: "5",
  GAS_CITY_FORMULA_VERSION_FACTORY_CODING_V1: "1.0.0",
  BUILD_GIT_SHA: "deadbeef1234",
}

/**
 * Build a minimal-but-valid EP shape for compiler tests. We construct a
 * plain object that satisfies the fields the compiler reads (it does not
 * re-validate the EP — that's upstream's job).
 */
function makeEP(overrides: {
  id?: string
  functionId?: string
  intentSpecificationId?: string
  executableSpecificationId?: string
  inputExecutableSpecificationHash?: string
  adapterId?: string
  parameters?: Record<string, unknown>
  roles?: Array<{
    roleId: string
    instruction: string
    inputs: string[]
    outputs: string[]
  }>
} = {}): Record<string, unknown> {
  return {
    id: overrides.id ?? "EP-EXAMPLE-001",
    functionId: overrides.functionId ?? "FN-EXAMPLE-001",
    intentSpecificationId: overrides.intentSpecificationId ?? "IS-EXAMPLE-001",
    executableSpecificationId: overrides.executableSpecificationId ?? "ES-EXAMPLE-001",
    instructionTuning: {
      inputExecutableSpecificationHash:
        overrides.inputExecutableSpecificationHash ?? "es-hash-abc123",
    },
    adapter: {
      adapterId: overrides.adapterId ?? "adapter.coding",
      executionRequest: {
        parameters: overrides.parameters ?? {
          repository: "owner/repo",
          branch: "main",
        },
      },
    },
    roles:
      overrides.roles ??
      [
        {
          roleId: "planner",
          instruction: "Plan the work.",
          inputs: ["intent"],
          outputs: ["plan"],
        },
        {
          roleId: "coder",
          instruction: "Implement the plan.",
          inputs: ["plan"],
          outputs: ["diff"],
        },
        {
          roleId: "verifier",
          instruction: "Verify the diff.",
          inputs: ["diff"],
          outputs: ["verdict"],
        },
      ],
  }
}

// ─── Mock factory ─────────────────────────────────────────────────────────

interface CapturedCall {
  url: string
  method: string
  headers: Record<string, string>
  body?: unknown
}

interface MockState {
  // ArangoDB state
  coherenceVR: { exists: boolean; createdAt?: string } | { exists: true; createdAt: string }
  dispatchLogRow: DispatchLogRow | null
  formArtifact: FormArtifact | null
  // Stream-transaction simulation
  txnAbortOnWrite: "form" | "dispatch_log" | null
  // Gas City HTTP behavior
  call1Response: { status: number; body?: unknown; throw?: Error }
  call2Responses: Array<{ status: number; body?: unknown; throw?: Error }>
  call3Responses: Array<{ status: number; body?: unknown; throw?: Error }>
  // Captured side-effects
  calls: CapturedCall[]
  dispatchLogUpdates: Array<{ key: string; patch: Partial<DispatchLogRow> }>
  formArtifactUpdates: Array<{ key: string; patch: Partial<FormArtifact> }>
  uncertaintyEntries: Array<{ reason: string; blocking_for: string[] }>
  uniqueIndexViolation: boolean
  // Deterministic time
  nowIso: string
  // IS-WORKSPACE-SEEDING state.
  // `undefined` → default mock; `null` → fetch returns null (not found).
  intentSpec?: { body: string; acceptanceCriteria: string[] } | null
  executableSpec?: { body: string; acceptanceCriteria: string[] } | null
  rigFiles: Record<string, string>
  seedPuts: Array<{ key: string; json: string }>
  putSeedThrows?: Error
}

function makeMocks(state: MockState): {
  deps: FormulaCompilerDeps
  state: MockState
} {
  const deps: FormulaCompilerDeps = {
    fetchCoherenceVR: async (esId: string) => {
      if (state.coherenceVR.exists) {
        return {
          _key: "VR-CO-1",
          source_refs: [esId],
          kind: "coherence",
          status: "passed",
          created_at: state.coherenceVR.createdAt ?? state.nowIso,
        }
      }
      return null
    },
    getDispatchLogByIdempotencyKey: async (_key, _attempt, excludeKey) => {
      // Honor `excludeKey` so callers (e.g. CALL 2 409 handler) can avoid
      // matching against the dispatch_log row they just wrote for this
      // invocation. This mirrors the production ArangoDB adapter contract.
      const row = state.dispatchLogRow
      if (row && excludeKey !== undefined && row._key === excludeKey) {
        return null
      }
      return row
    },
    getFormulaByKey: async (_key) => state.formArtifact,
    writeFormAndDispatchLog: async (form, dispatchLog) => {
      if (state.uniqueIndexViolation) {
        throw new Error("ArangoDB unique constraint violation on (idempotency_key, factory_attempt)")
      }
      if (state.txnAbortOnWrite === "form" || state.txnAbortOnWrite === "dispatch_log") {
        throw new Error(`stream transaction aborted: ${state.txnAbortOnWrite} write failed`)
      }
      state.formArtifact = form
      state.dispatchLogRow = dispatchLog
    },
    writeDispatchLogOnly: async (dispatchLog) => {
      state.dispatchLogRow = dispatchLog
    },
    updateFormulaVersion: async (key, version) => {
      state.formArtifactUpdates.push({ key, patch: { formula_version: version } })
      if (state.formArtifact && state.formArtifact._key === key) {
        state.formArtifact = { ...state.formArtifact, formula_version: version }
      }
    },
    updateDispatchLog: async (key, patch) => {
      state.dispatchLogUpdates.push({ key, patch })
      if (state.dispatchLogRow && state.dispatchLogRow._key === key) {
        state.dispatchLogRow = { ...state.dispatchLogRow, ...patch } as DispatchLogRow
      }
    },
    emitUncertaintyEntry: async (entry) => {
      state.uncertaintyEntries.push({
        reason: entry.reason,
        blocking_for: entry.blocking_for,
      })
    },
    httpFetch: async (url, init) => {
      const method = (init?.method ?? "GET").toUpperCase()
      const headers = (init?.headers ?? {}) as Record<string, string>
      let body: unknown = undefined
      if (init?.body && typeof init.body === "string") {
        try {
          body = JSON.parse(init.body)
        } catch {
          body = init.body
        }
      }
      state.calls.push({ url, method, headers, body })

      // CALL 1: GET formula
      if (method === "GET" && url.includes("/formulas/")) {
        const r = state.call1Response
        if (r.throw) throw r.throw
        return new Response(r.body !== undefined ? JSON.stringify(r.body) : "", {
          status: r.status,
          headers: { "Content-Type": "application/json" },
        })
      }
      // CALL 2: POST beads
      if (method === "POST" && url.endsWith("/beads")) {
        const r = state.call2Responses.shift() ?? state.call2Responses[0]
        if (!r) throw new Error("no CALL 2 response stubbed")
        if (r.throw) throw r.throw
        return new Response(r.body !== undefined ? JSON.stringify(r.body) : "", {
          status: r.status,
          headers: { "Content-Type": "application/json" },
        })
      }
      // CALL 3: POST sling
      if (method === "POST" && url.endsWith("/sling")) {
        const r = state.call3Responses.shift() ?? state.call3Responses[0]
        if (!r) throw new Error("no CALL 3 response stubbed")
        if (r.throw) throw r.throw
        return new Response(r.body !== undefined ? JSON.stringify(r.body) : "", {
          status: r.status,
          headers: { "Content-Type": "application/json" },
        })
      }
      throw new Error(`unexpected fetch call: ${method} ${url}`)
    },
    now: () => state.nowIso,
    sleep: async (_ms: number) => {
      // Tests don't wait. Backoff is exercised via call counts.
    },
    // IS-WORKSPACE-SEEDING deps. Default mocks succeed so existing dispatch
    // tests are unaffected (AC-15). Individual tests override via state.
    fetchIntentSpec: async (id: string) =>
      state.intentSpec === null
        ? null
        : (state.intentSpec ?? { body: `IS body for ${id}`, acceptanceCriteria: [] }),
    fetchExecutableSpec: async (id: string) =>
      state.executableSpec === null
        ? null
        : (state.executableSpec ?? {
            body: `ES body for ${id}`,
            acceptanceCriteria: ["criterion-1"],
          }),
    putSeed: async (key: string, json: string) => {
      if (state.putSeedThrows) throw state.putSeedThrows
      state.seedPuts.push({ key, json })
    },
    getRigFile: async (path: string) => state.rigFiles[path] ?? null,
  }
  return { deps, state }
}

function defaultState(): MockState {
  return {
    coherenceVR: { exists: true, createdAt: "2026-05-21T00:00:00.000Z" },
    dispatchLogRow: null,
    formArtifact: null,
    txnAbortOnWrite: null,
    call1Response: { status: 200, body: { version: "1.0.0" } },
    call2Responses: [
      { status: 201, body: { id: "bead-XYZ-001" } },
    ],
    call3Responses: [
      {
        status: 200,
        body: { status: "slung", workflow_id: "wf-001", root_bead_id: "rb-001" },
      },
    ],
    calls: [],
    dispatchLogUpdates: [],
    formArtifactUpdates: [],
    uncertaintyEntries: [],
    uniqueIndexViolation: false,
    nowIso: "2026-05-21T12:00:00.000Z",
    rigFiles: {},
    seedPuts: [],
  }
}

// ─── V-tests ──────────────────────────────────────────────────────────────

describe("formula-compiler: compileAndDispatchFormula (IP-1)", () => {
  // ── Happy path ──────────────────────────────────────────────────────────
  describe("happy path — adapter.coding, factory_attempt=1", () => {
    let state: MockState
    let deps: FormulaCompilerDeps
    let result: FormulaCompilerResult

    beforeEach(async () => {
      state = defaultState()
      const m = makeMocks(state)
      deps = m.deps
      result = await compileAndDispatchFormula({
        ep: makeEP() as Parameters<typeof compileAndDispatchFormula>[0]["ep"],
        factoryAttempt: 1,
        env: BASE_ENV,
        deps,
      })
    })

    it("returns outcome dispatched with workflow id", () => {
      expect(result.outcome).toBe("dispatched")
      expect(result.gc_workflow_id).toBe("wf-001")
      expect(result.gc_bead_id).toBe("bead-XYZ-001")
    })

    it("fires exactly three Gas City calls in order GET-POST-POST", () => {
      // Strip query params from the CALL 1 URL before comparing.
      expect(state.calls.map((c) => `${c.method} ${c.url.split("/").pop()!.split("?")[0]}`)).toEqual([
        "GET factory-coding-v1",
        "POST beads",
        "POST sling",
      ])
    })

    it("uses Bearer auth on every Gas City call", () => {
      for (const call of state.calls) {
        expect(call.headers.Authorization ?? call.headers.authorization).toBe(
          "Bearer test-bearer-token",
        )
      }
    })

    it("writes FORM-* with template_name factory-coding-v1 and source_refs=[EP id]", () => {
      expect(state.formArtifact).not.toBeNull()
      expect(state.formArtifact!.template_name).toBe("factory-coding-v1")
      expect(state.formArtifact!.source_refs).toEqual(["EP-EXAMPLE-001"])
      expect(state.formArtifact!.kind).toBe("FormulaArtifact")
      expect(state.formArtifact!.tier).toBe("procedural")
      expect(state.formArtifact!.explicitness).toBe("explicit")
    })

    it("records compiler module path and git SHA", () => {
      expect(state.formArtifact!.compiler).toBe(
        "workers/ff-pipeline/src/compilers/formula-compiler.ts@deadbeef1234",
      )
    })

    it("updates formula_version from 'pending' to GET response value", () => {
      expect(state.formArtifactUpdates.length).toBe(1)
      expect(state.formArtifactUpdates[0]!.patch.formula_version).toBe("1.0.0")
    })

    it("emits exactly 5 lineage labels in CALL 2 body", () => {
      const call2 = state.calls.find((c) => c.url.endsWith("/beads"))!
      const labels = (call2.body as { labels: string[] }).labels
      expect(labels).toEqual([
        "fn-id:FN-EXAMPLE-001",
        "is-id:IS-EXAMPLE-001",
        "es-id:ES-EXAMPLE-001",
        `form-id:${state.formArtifact!._key}`,
        "factory-attempt:1",
      ])
    })

    it("sends Idempotency-Key on CALL 2 only (lowercase hex sha256)", async () => {
      const call2 = state.calls.find((c) => c.url.endsWith("/beads"))!
      const key = call2.headers["Idempotency-Key"] ?? call2.headers["idempotency-key"]
      expect(key).toBeDefined()
      expect(key).toMatch(/^[0-9a-f]{64}$/)
      const call3 = state.calls.find((c) => c.url.endsWith("/sling"))!
      expect(call3.headers["Idempotency-Key"]).toBeUndefined()
      expect(call3.headers["idempotency-key"]).toBeUndefined()
    })

    it("CALL 3 body includes attached_bead_id, formula, target, rig, scope, vars, force=false", () => {
      const call3 = state.calls.find((c) => c.url.endsWith("/sling"))!
      const b = call3.body as Record<string, unknown>
      expect(b.formula).toBe("factory-coding-v1")
      expect(b.attached_bead_id).toBe("bead-XYZ-001")
      expect(b.bead).toBe("")
      expect(b.target).toBe("coder-agent")
      expect(b.rig).toBe("")  // Phase 1: city bead store; GC findSlingStore("") → CityBeadStore()
      expect(b.scope_kind).toBe("city")
      expect(b.scope_ref).toBe("factory") // BASE_ENV.GAS_CITY_CITY_NAME
      expect(b.force).toBe(false)
      const vars = b.vars as Record<string, string>
      expect(vars.fn_id).toBe("FN-EXAMPLE-001")
      expect(vars.form_id).toBe(state.formArtifact!._key)
      expect(vars.factory_attempt).toBe("1")
      expect(vars.max_iterations).toBe("5")
      expect(vars.ff_webhook_url).toBe(BASE_ENV.GAS_CITY_WEBHOOK_URL)
      expect(vars.ff_webhook_hmac_keyid).toBe("v1")
      expect(vars.rig_root).toBe("/tmp/rig-root")
    })

    it("dispatch_log final update has dispatched outcome with ids and hashes", () => {
      const finalUpdate = state.dispatchLogUpdates.find(
        (u) => u.patch.outcome === "dispatched",
      )
      expect(finalUpdate).toBeDefined()
      expect(finalUpdate!.patch.gc_bead_id).toBe("bead-XYZ-001")
      expect(finalUpdate!.patch.gc_workflow_id).toBe("wf-001")
      expect(finalUpdate!.patch.gc_workflow_root_bead_id).toBe("rb-001")
      expect(finalUpdate!.patch.labels_sent).toHaveLength(5)
      expect(finalUpdate!.patch.sling_request_hash).toMatch(/^[0-9a-f]{64}$/)
      expect(finalUpdate!.patch.completed_at).toBe(state.nowIso)
    })
  })

  // ── V1: Determinism ─────────────────────────────────────────────────────
  describe("V1: determinism", () => {
    it("produces byte-identical vars + parameters_json on two runs with same EP", async () => {
      const ep1 = makeEP({
        parameters: { zeta: "z", alpha: "a", middle: "m" },
      })
      const ep2 = makeEP({
        parameters: { middle: "m", alpha: "a", zeta: "z" },
      })

      const s1 = defaultState()
      const s2 = defaultState()
      const m1 = makeMocks(s1)
      const m2 = makeMocks(s2)

      await compileAndDispatchFormula({
        ep: ep1 as Parameters<typeof compileAndDispatchFormula>[0]["ep"],
        factoryAttempt: 1,
        env: BASE_ENV,
        deps: m1.deps,
      })
      await compileAndDispatchFormula({
        ep: ep2 as Parameters<typeof compileAndDispatchFormula>[0]["ep"],
        factoryAttempt: 1,
        env: BASE_ENV,
        deps: m2.deps,
      })

      expect(s1.formArtifact!.parameters_json).toBe(s2.formArtifact!.parameters_json)
      expect(JSON.stringify(s1.formArtifact!.vars)).toBe(
        JSON.stringify(s2.formArtifact!.vars),
      )
      // _key equality below is testing key-derivation stability, NOT
      // determinism: both runs share `ep.id` and `factory_attempt`, and
      // `_key` is derived solely from those two inputs, so this is
      // trivially true. Kept as a regression guard against accidental
      // changes to the key formula.
      expect(s1.formArtifact!._key).toBe(s2.formArtifact!._key)
    })

    it("produces byte-identical parameters_json with nested objects in different insertion order", async () => {
      // MUST-1: exercise nested object determinism. The previous flat-
      // parameters test passes trivially because JSON.stringify on flat
      // objects honors insertion order — but the load-bearing guarantee
      // is that `stableStringify` recursively sorts nested keys.
      const nested1 = {
        outer_z: "z",
        outer_a: {
          nested_z: "nz",
          nested_a: "na",
          nested_m: { deep_z: 1, deep_a: 2, deep_m: 3 },
        },
        outer_m: ["x", "y", "z"],
      }
      // Same data, every level reordered in reverse-alphabetical order
      const nested2 = {
        outer_m: ["x", "y", "z"],
        outer_a: {
          nested_m: { deep_m: 3, deep_a: 2, deep_z: 1 },
          nested_a: "na",
          nested_z: "nz",
        },
        outer_z: "z",
      }

      const s1 = defaultState()
      const s2 = defaultState()
      const m1 = makeMocks(s1)
      const m2 = makeMocks(s2)

      await compileAndDispatchFormula({
        ep: makeEP({ parameters: nested1 }) as Parameters<
          typeof compileAndDispatchFormula
        >[0]["ep"],
        factoryAttempt: 1,
        env: BASE_ENV,
        deps: m1.deps,
      })
      await compileAndDispatchFormula({
        ep: makeEP({ parameters: nested2 }) as Parameters<
          typeof compileAndDispatchFormula
        >[0]["ep"],
        factoryAttempt: 1,
        env: BASE_ENV,
        deps: m2.deps,
      })

      expect(s1.formArtifact!.parameters_json).toBe(s2.formArtifact!.parameters_json)
      // Also assert the recursive sort happened (deep keys sorted)
      expect(s1.formArtifact!.parameters_json).toContain('"deep_a":2,"deep_m":3,"deep_z":1')
    })

    it("produces byte-identical vars JSON when roles are provided in different order", async () => {
      // MUST-1: vars sorting is load-bearing for sling_request_hash
      // determinism. Two runs that add roles in different insertion
      // order MUST produce byte-identical `JSON.stringify(vars)`.
      const rolesA = [
        {
          roleId: "planner",
          instruction: "Plan the work.",
          inputs: ["intent"],
          outputs: ["plan"],
        },
        {
          roleId: "coder",
          instruction: "Implement the plan.",
          inputs: ["plan"],
          outputs: ["diff"],
        },
        {
          roleId: "verifier",
          instruction: "Verify the diff.",
          inputs: ["diff"],
          outputs: ["verdict"],
        },
      ]
      const rolesB = [
        {
          roleId: "verifier",
          instruction: "Verify the diff.",
          inputs: ["diff"],
          outputs: ["verdict"],
        },
        {
          roleId: "planner",
          instruction: "Plan the work.",
          inputs: ["intent"],
          outputs: ["plan"],
        },
        {
          roleId: "coder",
          instruction: "Implement the plan.",
          inputs: ["plan"],
          outputs: ["diff"],
        },
      ]

      const s1 = defaultState()
      const s2 = defaultState()
      const m1 = makeMocks(s1)
      const m2 = makeMocks(s2)

      await compileAndDispatchFormula({
        ep: makeEP({ roles: rolesA }) as Parameters<
          typeof compileAndDispatchFormula
        >[0]["ep"],
        factoryAttempt: 1,
        env: BASE_ENV,
        deps: m1.deps,
      })
      await compileAndDispatchFormula({
        ep: makeEP({ roles: rolesB }) as Parameters<
          typeof compileAndDispatchFormula
        >[0]["ep"],
        factoryAttempt: 1,
        env: BASE_ENV,
        deps: m2.deps,
      })

      expect(JSON.stringify(s1.formArtifact!.vars)).toBe(
        JSON.stringify(s2.formArtifact!.vars),
      )
      // And the sling_request_hash recorded in the dispatched update
      // must also be byte-identical — vars feed into slingBody.
      const finalize1 = s1.dispatchLogUpdates.find(
        (u) => u.patch.outcome === "dispatched",
      )!
      const finalize2 = s2.dispatchLogUpdates.find(
        (u) => u.patch.outcome === "dispatched",
      )!
      expect(finalize1.patch.sling_request_hash).toBe(
        finalize2.patch.sling_request_hash,
      )
    })

    it("sorts parameters_json keys alphabetically", async () => {
      const state = defaultState()
      const m = makeMocks(state)
      await compileAndDispatchFormula({
        ep: makeEP({
          parameters: { zeta: 1, alpha: 2, middle: 3 },
        }) as Parameters<typeof compileAndDispatchFormula>[0]["ep"],
        factoryAttempt: 1,
        env: BASE_ENV,
        deps: m.deps,
      })
      const p = state.formArtifact!.parameters_json
      expect(p).toBe(JSON.stringify({ alpha: 2, middle: 3, zeta: 1 }))
    })
  })

  // ── V2: No-LLM (runtime guard) ──────────────────────────────────────────
  describe("V2: no-LLM invariant (runtime guard)", () => {
    it("module imports + executable code reference no LLM SDK or provider", async () => {
      // Runtime guard. Reads the module source, strips comments and string
      // literals, then scans the executable code for forbidden tokens. The
      // authoritative check is a CI grep/AST scan on
      // workers/ff-pipeline/src/compilers/formula-compiler.ts; this test is
      // a development-time tripwire so violations surface in the same suite
      // that gates the build.
      const fs = await import("node:fs")
      const path = await import("node:path")
      const here = path.dirname(new URL(import.meta.url).pathname)
      const moduleSource = fs.readFileSync(
        path.join(here, "formula-compiler.ts"),
        "utf8",
      )

      // Strip block comments, line comments, and string literals. Anything
      // left is executable code.
      const codeOnly = moduleSource
        .replace(/\/\*[\s\S]*?\*\//g, "") // block comments
        .replace(/\/\/[^\n]*/g, "") // line comments
        .replace(/"(?:\\.|[^"\\])*"/g, '""') // double-quoted strings
        .replace(/'(?:\\.|[^'\\])*'/g, "''") // single-quoted strings
        .replace(/`(?:\\.|[^`\\])*`/g, "``") // template strings

      const forbidden = [
        // Forbidden import paths
        /\bfrom\s+["']\.\.\/providers\.js?["']/,
        /\bfrom\s+["']\.\.\/providers["']/,
        /\bfrom\s+["']@anthropic-ai\/sdk["']/,
        /\bfrom\s+["']openai["']/,
        /\bfrom\s+["']@weops\/gdk-ai["']/,
        // Forbidden symbol references — only flag function calls, not the
        // word appearing inside string literals (already stripped above).
        /\bcallProvider\s*\(/,
      ]
      for (const re of forbidden) {
        expect(codeOnly).not.toMatch(re)
      }
    })
  })

  // ── V3: FORM-* write failure halts before any Gas City calls ───────────
  describe("V3: FORM-* write failure short-circuits dispatch", () => {
    it("aborts before any Gas City calls when stream transaction fails", async () => {
      const state = defaultState()
      state.txnAbortOnWrite = "form"
      const m = makeMocks(state)
      const result = await compileAndDispatchFormula({
        ep: makeEP() as Parameters<typeof compileAndDispatchFormula>[0]["ep"],
        factoryAttempt: 1,
        env: BASE_ENV,
        deps: m.deps,
      })
      expect(result.outcome).toBe("failed")
      expect(state.calls).toHaveLength(0)
      expect(state.formArtifact).toBeNull()
      expect(state.dispatchLogRow).toBeNull()
    })
  })

  // ── V4: dispatch_log row written before CALL 1 ─────────────────────────
  describe("V4: dispatch_log persisted before CALL 1", () => {
    it("dispatch_log row exists with outcome=pending when CALL 1 fires", async () => {
      const state = defaultState()
      let dispatchLogPresentAtCall1 = false
      let outcomeAtCall1: DispatchLogRow["outcome"] | "<missing>" = "<missing>"
      // Wrap httpFetch to snapshot the dispatch_log state right when CALL 1
      // fires. We assert against this snapshot — later updates flip the
      // outcome to `dispatched` which is the correct end-state.
      const m = makeMocks(state)
      const innerFetch = m.deps.httpFetch
      m.deps.httpFetch = async (url, init) => {
        const method = (init?.method ?? "GET").toUpperCase()
        if (method === "GET" && url.includes("/formulas/")) {
          dispatchLogPresentAtCall1 = state.dispatchLogRow !== null
          if (state.dispatchLogRow) {
            outcomeAtCall1 = state.dispatchLogRow.outcome
          }
        }
        return innerFetch(url, init)
      }
      await compileAndDispatchFormula({
        ep: makeEP() as Parameters<typeof compileAndDispatchFormula>[0]["ep"],
        factoryAttempt: 1,
        env: BASE_ENV,
        deps: m.deps,
      })
      expect(dispatchLogPresentAtCall1).toBe(true)
      expect(outcomeAtCall1).toBe("pending")
    })
  })

  // ── V5: Version mismatch ────────────────────────────────────────────────
  describe("V5: version mismatch halts before CALL 2 + 3", () => {
    it("sets outcome version_mismatch and emits UncertaintyEntry", async () => {
      const state = defaultState()
      state.call1Response = { status: 200, body: { version: "9.9.9" } }
      const m = makeMocks(state)
      const result = await compileAndDispatchFormula({
        ep: makeEP() as Parameters<typeof compileAndDispatchFormula>[0]["ep"],
        factoryAttempt: 1,
        env: BASE_ENV,
        deps: m.deps,
      })
      expect(result.outcome).toBe("version_mismatch")
      expect(state.calls.filter((c) => c.url.endsWith("/beads"))).toHaveLength(0)
      expect(state.calls.filter((c) => c.url.endsWith("/sling"))).toHaveLength(0)
      expect(state.uncertaintyEntries.some((u) => u.reason.includes("version"))).toBe(true)
      expect(
        state.dispatchLogUpdates.some((u) => u.patch.outcome === "version_mismatch"),
      ).toBe(true)
    })
  })

  // ── MUST-3 regression: CALL 2 409 must not match the just-written pending row ─
  describe("MUST-3: CALL 2 409 replay does not match own pending row", () => {
    it("uses seeded prior dispatch_log row on 409; current pending row is filtered via excludeKey", async () => {
      // Scenario: a prior dispatch_log row exists for the same idempotency
      // key with gc_bead_id=bead-OLD (from a prior CALL 2 success the
      // caller never finished tracking). A fresh invocation arrives that
      // does NOT see the prior row in its pre-check (e.g. it was eventually-
      // consistent or migrated in). The fresh invocation writes its own
      // pending row (gc_bead_id=null), CALL 2 returns 409 with id=bead-OLD,
      // and the compiler MUST find the prior row (not its own pending row)
      // via the post-write lookup.
      const state = defaultState()

      // A "rows by key" store keyed by dispatch_log _key — represents the
      // ArangoDB dispatch_log collection.
      const rowsByKey: Record<string, DispatchLogRow> = {}
      const priorRow: DispatchLogRow = {
        _key: "dl-PRIOR",
        es_id: "ES-EXAMPLE-001",
        ep_id: "EP-EXAMPLE-001",
        form_id: "FORM-PRIOR",
        fn_id: "FN-EXAMPLE-001",
        is_id: "IS-EXAMPLE-001",
        factory_attempt: 1,
        idempotency_key: "ANY-COMPUTED-KEY",
        started_at: "2026-05-21T11:00:00.000Z",
        outcome: "in_flight",
        gc_bead_id: "bead-OLD",
        gc_workflow_id: null,
        gc_workflow_root_bead_id: null,
        labels_sent: null,
        sling_request_hash: null,
      }
      rowsByKey[priorRow._key] = priorRow

      const m = makeMocks(state)

      // The pre-check (excludeKey undefined) must NOT match the prior row,
      // to force the fresh-dispatch path. Track invocations: the first
      // call (pre-check) returns null, subsequent calls do the real query
      // honoring excludeKey. Real ArangoDB adapters with a unique
      // (idempotency_key, factory_attempt) index would never have this
      // shape — but for the regression test we exercise the post-write
      // 409 path specifically.
      let preCheckDone = false
      m.deps.getDispatchLogByIdempotencyKey = async (
        _idemKey,
        factoryAttempt,
        excludeKey,
      ) => {
        if (!preCheckDone) {
          preCheckDone = true
          return null
        }
        const candidates = Object.values(rowsByKey).filter(
          (r) =>
            r.factory_attempt === factoryAttempt &&
            (excludeKey === undefined || r._key !== excludeKey) &&
            r.gc_bead_id !== null,
        )
        candidates.sort((a, b) => b.started_at.localeCompare(a.started_at))
        return candidates[0] ?? null
      }

      // Override write to add the pending row to the row store as well as
      // updating state.dispatchLogRow.
      m.deps.writeFormAndDispatchLog = async (form, dispatchLog) => {
        state.formArtifact = form
        rowsByKey[dispatchLog._key] = dispatchLog
        state.dispatchLogRow = dispatchLog
      }

      // CALL 2 returns 409 with id=bead-OLD (the prior bead).
      state.call2Responses = [{ status: 409, body: { id: "bead-OLD" } }]
      // CALL 3 will fire with bead-OLD attached and succeed.
      state.call3Responses = [
        {
          status: 200,
          body: { status: "slung", workflow_id: "wf-NEW", root_bead_id: "rb-NEW" },
        },
      ]

      const result = await compileAndDispatchFormula({
        ep: makeEP() as Parameters<typeof compileAndDispatchFormula>[0]["ep"],
        factoryAttempt: 1,
        env: BASE_ENV,
        deps: m.deps,
      })

      expect(result.outcome).toBe("dispatched")
      expect(result.gc_bead_id).toBe("bead-OLD")
      const call3 = state.calls.find((c) => c.url.endsWith("/sling"))!
      expect((call3.body as { attached_bead_id: string }).attached_bead_id).toBe(
        "bead-OLD",
      )
    })

    it("a 409 cannot match the current pending row (gc_bead_id=null guard)", async () => {
      // Negative regression: even if the adapter is broken and ignores
      // excludeKey, the compiler's `gc_bead_id !== null` guard prevents
      // the 409 handler from matching the just-written pending row
      // (which has gc_bead_id=null). The 409 with bead id MUST be
      // classified as rejected, never as success.
      const state = defaultState()
      const rowsByKey: Record<string, DispatchLogRow> = {}
      const m = makeMocks(state)

      let preCheckDone = false
      m.deps.getDispatchLogByIdempotencyKey = async (
        _idemKey,
        factoryAttempt,
        _excludeKey, // intentionally ignored — simulates broken adapter
      ) => {
        if (!preCheckDone) {
          preCheckDone = true
          return null
        }
        const candidates = Object.values(rowsByKey).filter(
          (r) => r.factory_attempt === factoryAttempt,
        )
        // Return most-recently-started first — the just-written pending row.
        candidates.sort((a, b) => b.started_at.localeCompare(a.started_at))
        return candidates[0] ?? null
      }
      m.deps.writeFormAndDispatchLog = async (form, dispatchLog) => {
        state.formArtifact = form
        rowsByKey[dispatchLog._key] = dispatchLog
        state.dispatchLogRow = dispatchLog
      }
      state.call2Responses = [{ status: 409, body: { id: "bead-NEW" } }]

      const result = await compileAndDispatchFormula({
        ep: makeEP() as Parameters<typeof compileAndDispatchFormula>[0]["ep"],
        factoryAttempt: 1,
        env: BASE_ENV,
        deps: m.deps,
      })
      expect(result.outcome).toBe("rejected")
    })
  })

  // ── V6: CALL 2 returns 409 ─────────────────────────────────────────────
  describe("V6: CALL 2 idempotency 409 with matching prior bead", () => {
    it("proceeds to CALL 3 using the bead id from the existing dispatch_log row", async () => {
      const state = defaultState()
      // A prior dispatch_log row with a non-null gc_bead_id matching the response
      state.dispatchLogRow = {
        _key: "dl-existing",
        es_id: "ES-EXAMPLE-001",
        ep_id: "EP-EXAMPLE-001",
        form_id: "FORM-PRIOR",
        fn_id: "FN-EXAMPLE-001",
        is_id: "IS-EXAMPLE-001",
        factory_attempt: 1,
        idempotency_key: "ignored-prelookup",
        started_at: state.nowIso,
        outcome: "pending",
        gc_bead_id: "bead-XYZ-001",
        gc_workflow_id: null,
        gc_workflow_root_bead_id: null,
        labels_sent: null,
        sling_request_hash: null,
      }
      // But importantly: outcome is "pending" not "dispatched" so idempotency
      // pre-check should NOT return early. We force CALL 2 path by clearing
      // the form artifact and using a fresh-looking lookup.
      // To exercise V6 the cleanest way, we let pre-check skip CALL 1+2 via
      // AC-24 (covered in V13). For V6 specifically we want CALL 2 to be
      // ATTEMPTED and to get a 409.
      // Simulate: pre-check returns null (no prior log), so CALL 2 fires.
      // But after writing FORM-* + dispatch_log, the lookup-by-idempotency-key
      // for the 409-handling code path must find a row with gc_bead_id set.
      // Easiest: have getDispatchLogByIdempotencyKey return null on first call
      // and the matching prior row on second call.
      let lookupCount = 0
      const m = makeMocks(state)
      // null on pre-check, then matching row on 409 lookup
      const priorRow = state.dispatchLogRow
      state.dispatchLogRow = null
      m.deps.getDispatchLogByIdempotencyKey = async () => {
        lookupCount++
        if (lookupCount === 1) return null
        return priorRow
      }
      state.call2Responses = [
        { status: 409, body: { id: "bead-XYZ-001" } },
      ]
      const result = await compileAndDispatchFormula({
        ep: makeEP() as Parameters<typeof compileAndDispatchFormula>[0]["ep"],
        factoryAttempt: 1,
        env: BASE_ENV,
        deps: m.deps,
      })
      expect(result.outcome).toBe("dispatched")
      expect(state.calls.filter((c) => c.url.endsWith("/sling"))).toHaveLength(1)
      expect(result.gc_bead_id).toBe("bead-XYZ-001")
    })
  })

  // ── V7: CALL 3 returns 409 with matching workflow ──────────────────────
  describe("V7: CALL 3 sling 409 with matching workflow_id", () => {
    it("treats as success-on-replay and consults dispatch_log with correct idempotency_key", async () => {
      const state = defaultState()
      const priorRow: DispatchLogRow = {
        _key: "dl-existing",
        es_id: "ES-EXAMPLE-001",
        ep_id: "EP-EXAMPLE-001",
        form_id: "FORM-PRIOR",
        fn_id: "FN-EXAMPLE-001",
        is_id: "IS-EXAMPLE-001",
        factory_attempt: 1,
        idempotency_key: "matches",
        started_at: state.nowIso,
        outcome: "dispatched",
        gc_bead_id: "bead-XYZ-001",
        gc_workflow_id: "wf-PRIOR",
        gc_workflow_root_bead_id: "rb-PRIOR",
        labels_sent: ["fn-id:FN-EXAMPLE-001"],
        sling_request_hash: "deadbeef",
      }
      const lookupArgs: Array<{
        idempotencyKey: string
        factoryAttempt: number
        excludeKey: string | undefined
      }> = []
      let lookupCount = 0
      const m = makeMocks(state)
      m.deps.getDispatchLogByIdempotencyKey = async (
        idempotencyKey,
        factoryAttempt,
        excludeKey,
      ) => {
        lookupArgs.push({ idempotencyKey, factoryAttempt, excludeKey })
        lookupCount++
        if (lookupCount === 1) return null
        return priorRow
      }
      state.call3Responses = [
        { status: 409, body: { workflow_id: "wf-PRIOR" } },
      ]
      const result = await compileAndDispatchFormula({
        ep: makeEP() as Parameters<typeof compileAndDispatchFormula>[0]["ep"],
        factoryAttempt: 1,
        env: BASE_ENV,
        deps: m.deps,
      })
      expect(result.outcome).toBe("dispatched")
      expect(result.gc_workflow_id).toBe("wf-PRIOR")
      // Result should pull root_bead_id from the matched prior row.
      expect(result.gc_workflow_root_bead_id).toBe("rb-PRIOR")

      // MUST-2 assertion: the compiler MUST consult getDispatchLogByIdempotencyKey
      // with the real (idempotency_key, factory_attempt) — not "" and 0.
      // The 409 lookup is the last call to the adapter.
      const lookupOn409 = lookupArgs[lookupArgs.length - 1]!
      expect(lookupOn409.factoryAttempt).toBe(1)
      // The idempotency key is the sha256 of ES|hash|attempt — must be lowercase hex.
      expect(lookupOn409.idempotencyKey).toMatch(/^[0-9a-f]{64}$/)
      // And it must be the same key used as the CALL 2 Idempotency-Key header.
      const call2 = state.calls.find((c) => c.url.endsWith("/beads"))!
      const call2IdemKey =
        call2.headers["Idempotency-Key"] ?? call2.headers["idempotency-key"]
      expect(lookupOn409.idempotencyKey).toBe(call2IdemKey)
      // And it must pass the current dispatch_log key as excludeKey so the
      // lookup doesn't return the just-written pending row.
      expect(typeof lookupOn409.excludeKey).toBe("string")
      expect(lookupOn409.excludeKey).toBe(state.dispatchLogRow!._key)
    })

    it("rejects 409 when no matching prior dispatched row exists", async () => {
      // MUST-2: a 409 with a workflow_id but NO matching prior row in
      // dispatch_log is suspicious — Gas City claims the formula was
      // already run, but we have no record of it. We MUST classify this
      // as `rejected`, not `dispatched`. Otherwise we'd accept any 409
      // with any workflow_id as success.
      const state = defaultState()
      const m = makeMocks(state)
      // Adapter returns null on every lookup (no prior dispatched row).
      m.deps.getDispatchLogByIdempotencyKey = async () => null
      state.call3Responses = [
        { status: 409, body: { workflow_id: "wf-UNKNOWN-FROM-GC" } },
      ]
      const result = await compileAndDispatchFormula({
        ep: makeEP() as Parameters<typeof compileAndDispatchFormula>[0]["ep"],
        factoryAttempt: 1,
        env: BASE_ENV,
        deps: m.deps,
      })
      expect(result.outcome).toBe("rejected")
      expect(
        state.dispatchLogUpdates.some((u) => u.patch.outcome === "rejected"),
      ).toBe(true)
    })

    it("rejects 409 when prior row workflow_id does not match response", async () => {
      // MUST-2: if a prior row exists for this idempotency_key but its
      // workflow_id differs from what Gas City returned, we cannot
      // accept the 409 as replay — something is inconsistent. Halt.
      const state = defaultState()
      const m = makeMocks(state)
      const priorRow: DispatchLogRow = {
        _key: "dl-existing",
        es_id: "ES-EXAMPLE-001",
        ep_id: "EP-EXAMPLE-001",
        form_id: "FORM-PRIOR",
        fn_id: "FN-EXAMPLE-001",
        is_id: "IS-EXAMPLE-001",
        factory_attempt: 1,
        idempotency_key: "matches",
        started_at: state.nowIso,
        outcome: "dispatched",
        gc_bead_id: "bead-XYZ-001",
        gc_workflow_id: "wf-ONE",
        gc_workflow_root_bead_id: "rb-ONE",
        labels_sent: null,
        sling_request_hash: null,
      }
      let lookupCount = 0
      m.deps.getDispatchLogByIdempotencyKey = async () => {
        lookupCount++
        if (lookupCount === 1) return null
        return priorRow
      }
      state.call3Responses = [
        { status: 409, body: { workflow_id: "wf-DIFFERENT" } },
      ]
      const result = await compileAndDispatchFormula({
        ep: makeEP() as Parameters<typeof compileAndDispatchFormula>[0]["ep"],
        factoryAttempt: 1,
        env: BASE_ENV,
        deps: m.deps,
      })
      expect(result.outcome).toBe("rejected")
    })
  })

  // ── V8 already covered above; verify minimal label count ───────────────
  describe("V8: CALL 2 body contains exactly 5 labels on first attempt", () => {
    it("emits the 5 lineage label keys with correct values", async () => {
      const state = defaultState()
      const m = makeMocks(state)
      await compileAndDispatchFormula({
        ep: makeEP() as Parameters<typeof compileAndDispatchFormula>[0]["ep"],
        factoryAttempt: 1,
        env: BASE_ENV,
        deps: m.deps,
      })
      const call2 = state.calls.find((c) => c.url.endsWith("/beads"))!
      const labels = (call2.body as { labels: string[] }).labels
      expect(labels).toHaveLength(5)
      expect(new Set(labels.map((s) => s.split(":")[0]))).toEqual(
        new Set(["fn-id", "is-id", "es-id", "form-id", "factory-attempt"]),
      )
    })
  })

  // ── V9: amendment label ─────────────────────────────────────────────────
  describe("V9: amendment dispatch adds amendment-of: label", () => {
    it("CALL 2 body has 6 labels including amendment-of:{prior_es_id}", async () => {
      const state = defaultState()
      const m = makeMocks(state)
      await compileAndDispatchFormula({
        ep: makeEP() as Parameters<typeof compileAndDispatchFormula>[0]["ep"],
        factoryAttempt: 2,
        priorEsId: "ES-PRIOR-000",
        env: BASE_ENV,
        deps: m.deps,
      })
      const call2 = state.calls.find((c) => c.url.endsWith("/beads"))!
      const labels = (call2.body as { labels: string[] }).labels
      expect(labels).toHaveLength(6)
      expect(labels).toContain("amendment-of:ES-PRIOR-000")
      expect(labels).toContain("factory-attempt:2")
    })
  })

  // ── V10: no Coherence VR ────────────────────────────────────────────────
  describe("V10: missing Coherence VR halts before any write", () => {
    it("emits UncertaintyEntry and writes no FORM-* / dispatch_log", async () => {
      const state = defaultState()
      state.coherenceVR = { exists: false }
      const m = makeMocks(state)
      const result = await compileAndDispatchFormula({
        ep: makeEP() as Parameters<typeof compileAndDispatchFormula>[0]["ep"],
        factoryAttempt: 1,
        env: BASE_ENV,
        deps: m.deps,
      })
      expect(result.outcome).toBe("failed")
      expect(state.formArtifact).toBeNull()
      expect(state.dispatchLogRow).toBeNull()
      expect(state.calls).toHaveLength(0)
      expect(state.uncertaintyEntries).toHaveLength(1)
      expect(state.uncertaintyEntries[0]!.blocking_for).toContain("dispatch")
    })
  })

  // ── V11: FORM-* key collision (replay) ──────────────────────────────────
  describe("V11: FORM-* key collision with byte-equal vars reuses existing", () => {
    it("does not re-write FORM-* and proceeds to dispatch", async () => {
      const state = defaultState()
      // Build an EP and pre-compute what FORM-* should look like by running once.
      // Easier: pre-seed the formArtifact with what the compiler will compute.
      const ep = makeEP() as Parameters<typeof compileAndDispatchFormula>[0]["ep"]
      // First run to compute the canonical FORM-*
      const probe = defaultState()
      const probeMocks = makeMocks(probe)
      await compileAndDispatchFormula({
        ep,
        factoryAttempt: 1,
        env: BASE_ENV,
        deps: probeMocks.deps,
      })
      const canonicalForm = probe.formArtifact!
      // Now run again with the canonical FORM-* already in storage
      state.formArtifact = { ...canonicalForm }
      const m = makeMocks(state)
      let writeAttempted = false
      m.deps.writeFormAndDispatchLog = async (_form, dispatchLog) => {
        // The compiler may decide to still write the dispatch_log alone, or to
        // call a separate path. Either way, we capture the call.
        writeAttempted = true
        state.dispatchLogRow = dispatchLog
      }
      const result = await compileAndDispatchFormula({
        ep,
        factoryAttempt: 1,
        env: BASE_ENV,
        deps: m.deps,
      })
      expect(result.outcome).toBe("dispatched")
      // FORM-* must not have been re-written; only dispatch_log should be persisted
      // (the compiler is allowed to call writeFormAndDispatchLog for the dispatch_log
      // alone OR skip — we only assert the FORM-* on disk equals canonical).
      expect(state.formArtifact!.vars).toEqual(canonicalForm.vars)
      expect(state.formArtifact!.parameters_json).toBe(canonicalForm.parameters_json)
      expect(state.formArtifact!._key).toBe(canonicalForm._key)
      // dispatch_log row should exist when we hit CALL 1
      expect(state.dispatchLogRow).not.toBeNull()
      void writeAttempted // unused
    })
  })

  // ── V12: FORM-* key collision (hard) ────────────────────────────────────
  describe("V12: FORM-* key collision with mismatched source_refs halts", () => {
    it("emits UncertaintyEntry and does not dispatch", async () => {
      const state = defaultState()
      // Pre-seed a FORM-* at the SAME key the compiler will compute, but
      // with a different source_refs[0]. To know the key, derive it offline
      // via probe.
      const ep = makeEP() as Parameters<typeof compileAndDispatchFormula>[0]["ep"]
      const probe = defaultState()
      const probeMocks = makeMocks(probe)
      await compileAndDispatchFormula({
        ep,
        factoryAttempt: 1,
        env: BASE_ENV,
        deps: probeMocks.deps,
      })
      const collidingKey = probe.formArtifact!._key
      state.formArtifact = {
        _key: collidingKey,
        kind: "FormulaArtifact",
        tier: "procedural",
        template_name: "factory-coding-v1",
        formula_version: "1.0.0",
        vars: {},
        parameters_json: "{}",
        source_refs: ["EP-OTHER-EP"], // different source
        explicitness: "explicit",
        compiled_at: state.nowIso,
        compiler: "old-compiler",
      }
      const m = makeMocks(state)
      const result = await compileAndDispatchFormula({
        ep,
        factoryAttempt: 1,
        env: BASE_ENV,
        deps: m.deps,
      })
      expect(result.outcome).toBe("failed")
      expect(state.calls).toHaveLength(0)
      expect(state.uncertaintyEntries.some((u) => u.reason.toLowerCase().includes("collision"))).toBe(
        true,
      )
    })
  })

  // ── V13: partition recovery ─────────────────────────────────────────────
  describe("V13: partition recovery (CALL 2 succeeded, CALL 3 not yet)", () => {
    it("skips FORM-* write + CALL 1 + CALL 2; fires CALL 3 with stored bead id", async () => {
      const state = defaultState()
      const ep = makeEP() as Parameters<typeof compileAndDispatchFormula>[0]["ep"]
      state.dispatchLogRow = {
        _key: "dl-resume",
        es_id: "ES-EXAMPLE-001",
        ep_id: "EP-EXAMPLE-001",
        form_id: "FORM-RESUME",
        fn_id: "FN-EXAMPLE-001",
        is_id: "IS-EXAMPLE-001",
        factory_attempt: 1,
        idempotency_key: "resume-key",
        started_at: state.nowIso,
        outcome: "pending",
        gc_bead_id: "bead-STORED-777",
        gc_workflow_id: null,
        gc_workflow_root_bead_id: null,
        labels_sent: null,
        sling_request_hash: null,
      }
      // Also seed a FORM-* so the compiler has the template name for CALL 3
      state.formArtifact = {
        _key: "FORM-RESUME",
        kind: "FormulaArtifact",
        tier: "procedural",
        template_name: "factory-coding-v1",
        formula_version: "1.0.0",
        vars: {
          fn_id: "FN-EXAMPLE-001",
          is_id: "IS-EXAMPLE-001",
          es_id: "ES-EXAMPLE-001",
          ep_id: "EP-EXAMPLE-001",
          form_id: "FORM-RESUME",
          factory_attempt: "1",
          ff_webhook_url: BASE_ENV.GAS_CITY_WEBHOOK_URL,
          ff_webhook_hmac_keyid: "v1",
          rig_root: BASE_ENV.GAS_CITY_RIG_ROOT,
          max_iterations: "5",
          parameters_json: "{}",
        },
        parameters_json: "{}",
        source_refs: ["EP-EXAMPLE-001"],
        explicitness: "explicit",
        compiled_at: state.nowIso,
        compiler: "test",
      }
      const m = makeMocks(state)
      // Make writeFormAndDispatchLog throw if called — to prove it's skipped
      let formWriteCalled = false
      m.deps.writeFormAndDispatchLog = async () => {
        formWriteCalled = true
      }
      const result = await compileAndDispatchFormula({
        ep,
        factoryAttempt: 1,
        env: BASE_ENV,
        deps: m.deps,
      })
      expect(result.outcome).toBe("dispatched")
      expect(formWriteCalled).toBe(false)
      // No CALL 1, no CALL 2 — only CALL 3
      expect(state.calls.filter((c) => c.url.includes("/formulas/"))).toHaveLength(0)
      expect(state.calls.filter((c) => c.url.endsWith("/beads"))).toHaveLength(0)
      expect(state.calls.filter((c) => c.url.endsWith("/sling"))).toHaveLength(1)
      const call3 = state.calls.find((c) => c.url.endsWith("/sling"))!
      expect((call3.body as { attached_bead_id: string }).attached_bead_id).toBe(
        "bead-STORED-777",
      )
    })
  })

  // ── V14: reserved key collision ─────────────────────────────────────────
  describe("V14: EP parameters contain a reserved key halts", () => {
    it("emits UncertaintyEntry, does not write FORM-*, does not dispatch", async () => {
      const state = defaultState()
      const m = makeMocks(state)
      const result = await compileAndDispatchFormula({
        ep: makeEP({
          parameters: { fn_id: "shadow", repo: "ok" },
        }) as Parameters<typeof compileAndDispatchFormula>[0]["ep"],
        factoryAttempt: 1,
        env: BASE_ENV,
        deps: m.deps,
      })
      expect(result.outcome).toBe("failed")
      expect(state.formArtifact).toBeNull()
      expect(state.dispatchLogRow).toBeNull()
      expect(state.calls).toHaveLength(0)
      expect(state.uncertaintyEntries.some((u) => u.reason.toLowerCase().includes("reserved"))).toBe(
        true,
      )
    })
  })

  // ── Additional behaviors from the IS ─────────────────────────────────────

  describe("AC-1: unregistered adapter halts", () => {
    it("emits UncertaintyEntry and writes nothing", async () => {
      const state = defaultState()
      const m = makeMocks(state)
      const result = await compileAndDispatchFormula({
        ep: makeEP({ adapterId: "adapter.unregistered" }) as Parameters<
          typeof compileAndDispatchFormula
        >[0]["ep"],
        factoryAttempt: 1,
        env: BASE_ENV,
        deps: m.deps,
      })
      expect(result.outcome).toBe("failed")
      expect(state.formArtifact).toBeNull()
      expect(state.uncertaintyEntries.some((u) => u.blocking_for.includes("FORM-* creation"))).toBe(
        true,
      )
    })
  })

  describe("AC-3: role vars include planner/coder/verifier", () => {
    it("includes {roleId}_prompt, {roleId}_inputs (JSON), {roleId}_outputs (JSON)", async () => {
      const state = defaultState()
      const m = makeMocks(state)
      await compileAndDispatchFormula({
        ep: makeEP() as Parameters<typeof compileAndDispatchFormula>[0]["ep"],
        factoryAttempt: 1,
        env: BASE_ENV,
        deps: m.deps,
      })
      const vars = state.formArtifact!.vars
      expect(vars.planner_prompt).toBe("Plan the work.")
      expect(vars.planner_inputs).toBe(JSON.stringify(["intent"]))
      expect(vars.planner_outputs).toBe(JSON.stringify(["plan"]))
      expect(vars.coder_prompt).toBe("Implement the plan.")
      expect(vars.coder_outputs).toBe(JSON.stringify(["CandidatePatch"]))
      expect(vars.verifier_prompt).toBe("Verify the diff.")
      expect(vars.verifier_outputs).toBe(JSON.stringify(["VerifierReport"]))
    })

    it("defaults factory coding Code and Verify outputs to canonical artifacts when EP role outputs are empty", async () => {
      const state = defaultState()
      const m = makeMocks(state)
      await compileAndDispatchFormula({
        ep: makeEP({
          roles: [
            {
              roleId: "planner",
              instruction: "Plan the work.",
              inputs: [],
              outputs: [],
            },
            {
              roleId: "coder",
              instruction: "Implement the plan.",
              inputs: ["Plan"],
              outputs: [],
            },
            {
              roleId: "verifier",
              instruction: "Verify the patch.",
              inputs: ["CandidatePatch"],
              outputs: [],
            },
          ],
        }) as Parameters<typeof compileAndDispatchFormula>[0]["ep"],
        factoryAttempt: 1,
        env: BASE_ENV,
        deps: m.deps,
      })
      const vars = state.formArtifact!.vars
      expect(vars.coder_outputs).toBe(JSON.stringify(["CandidatePatch"]))
      expect(vars.verifier_outputs).toBe(JSON.stringify(["VerifierReport"]))
    })

    it("missing standard roles become empty strings", async () => {
      const state = defaultState()
      const m = makeMocks(state)
      await compileAndDispatchFormula({
        ep: makeEP({
          roles: [
            {
              roleId: "planner",
              instruction: "Only the planner.",
              inputs: [],
              outputs: ["plan"],
            },
          ],
        }) as Parameters<typeof compileAndDispatchFormula>[0]["ep"],
        factoryAttempt: 1,
        env: BASE_ENV,
        deps: m.deps,
      })
      const vars = state.formArtifact!.vars
      expect(vars.coder_prompt).toBe("")
      expect(vars.coder_inputs).toBe("")
      expect(vars.coder_outputs).toBe("")
      expect(vars.verifier_prompt).toBe("")
    })
  })

  describe("AC-9a: CALL 2 timeout sets in_flight (not failed)", () => {
    it("emits in_flight outcome and halts", async () => {
      const state = defaultState()
      state.call2Responses = [
        { status: 0, throw: new Error("timeout") },
        { status: 0, throw: new Error("timeout") },
        { status: 0, throw: new Error("timeout") },
        { status: 0, throw: new Error("timeout") },
      ]
      const m = makeMocks(state)
      const result = await compileAndDispatchFormula({
        ep: makeEP() as Parameters<typeof compileAndDispatchFormula>[0]["ep"],
        factoryAttempt: 1,
        env: BASE_ENV,
        deps: m.deps,
      })
      expect(result.outcome).toBe("in_flight")
    })

    it("CALL 2 aborts via AbortSignal-induced rejection (mid-body-read hang)", async () => {
      // MUST-4: a fetch that resolves headers but hangs on body read MUST
      // be aborted by the signal. Simulate by having the mock reject the
      // fetch promise with an AbortError-shaped error — this is what
      // `AbortSignal.timeout` synthesizes when it fires on a hung body.
      // Verify the compiler treats it as a network-like failure (in_flight
      // after retries), not as a CALL 2 5xx (timeout_call_2).
      const state = defaultState()
      const abortError = new Error("The operation was aborted")
      abortError.name = "AbortError"
      state.call2Responses = [
        { status: 0, throw: abortError },
        { status: 0, throw: abortError },
        { status: 0, throw: abortError },
        { status: 0, throw: abortError },
      ]
      const m = makeMocks(state)
      const result = await compileAndDispatchFormula({
        ep: makeEP() as Parameters<typeof compileAndDispatchFormula>[0]["ep"],
        factoryAttempt: 1,
        env: BASE_ENV,
        deps: m.deps,
      })
      expect(result.outcome).toBe("in_flight")
    })
  })

  describe("MUST-4: per-call timeouts are AbortSignal-based (bounds body read)", () => {
    it("every Gas City fetch carries an AbortSignal in its init", async () => {
      // Capture the `init.signal` from every fetch the compiler issues.
      // Each signal MUST be an AbortSignal — the CF-native mechanism that
      // bounds BOTH header receipt AND body read inside the 30s subrequest
      // limit. The previous Promise.race implementation only bounded the
      // promise that resolves on header receipt, leaving res.json() free
      // to hang forever.
      const state = defaultState()
      const signals: Array<AbortSignal | undefined> = []
      const m = makeMocks(state)
      const inner = m.deps.httpFetch
      m.deps.httpFetch = async (url, init) => {
        const sig = (init as RequestInit | undefined)?.signal as
          | AbortSignal
          | undefined
        signals.push(sig)
        return inner(url, init)
      }
      const result = await compileAndDispatchFormula({
        ep: makeEP() as Parameters<typeof compileAndDispatchFormula>[0]["ep"],
        factoryAttempt: 1,
        env: BASE_ENV,
        deps: m.deps,
      })
      expect(result.outcome).toBe("dispatched")
      // CALL 1 (GET) + CALL 2 (POST beads) + CALL 3 (POST sling) = 3 fetches.
      expect(signals).toHaveLength(3)
      for (const sig of signals) {
        expect(sig).toBeDefined()
        // Duck-type check for AbortSignal: has `aborted` boolean and the
        // tag set by AbortSignal.timeout.
        expect(typeof sig!.aborted).toBe("boolean")
        // It must NOT be already aborted at request time.
        expect(sig!.aborted).toBe(false)
      }
    })
  })

  describe("AC-13: CALL 2 5xx retries up to 3 times then halts", () => {
    it("retries 3 times on 5xx with exponential backoff, then sets timeout_call_2", async () => {
      const state = defaultState()
      state.call2Responses = [
        { status: 503 },
        { status: 503 },
        { status: 503 },
        { status: 503 },
      ]
      let sleepArgs: number[] = []
      const m = makeMocks(state)
      m.deps.sleep = async (ms: number) => {
        sleepArgs.push(ms)
      }
      const result = await compileAndDispatchFormula({
        ep: makeEP() as Parameters<typeof compileAndDispatchFormula>[0]["ep"],
        factoryAttempt: 1,
        env: BASE_ENV,
        deps: m.deps,
      })
      expect(result.outcome).toBe("timeout_call_2")
      // 1 initial + 3 retries = 4 attempts
      expect(state.calls.filter((c) => c.url.endsWith("/beads"))).toHaveLength(4)
      // Backoff: 1s, 2s, 4s between retries
      expect(sleepArgs).toEqual([1000, 2000, 4000])
    })

    it("halts on first 4xx (non-409) with outcome rejected — no retries", async () => {
      const state = defaultState()
      state.call2Responses = [{ status: 400, body: { error: "bad request" } }]
      const m = makeMocks(state)
      const result = await compileAndDispatchFormula({
        ep: makeEP() as Parameters<typeof compileAndDispatchFormula>[0]["ep"],
        factoryAttempt: 1,
        env: BASE_ENV,
        deps: m.deps,
      })
      expect(result.outcome).toBe("rejected")
      expect(state.calls.filter((c) => c.url.endsWith("/beads"))).toHaveLength(1)
    })
  })

  describe("AC-21: parallel dispatch unique-index collision halts", () => {
    it("aborts when the unique constraint fires", async () => {
      const state = defaultState()
      state.uniqueIndexViolation = true
      const m = makeMocks(state)
      const result = await compileAndDispatchFormula({
        ep: makeEP() as Parameters<typeof compileAndDispatchFormula>[0]["ep"],
        factoryAttempt: 1,
        env: BASE_ENV,
        deps: m.deps,
      })
      expect(result.outcome).toBe("failed")
      expect(state.calls).toHaveLength(0)
    })
  })

  describe("AC-6: FORM-* key shape", () => {
    it("is FORM- + 16 uppercase hex chars", async () => {
      const state = defaultState()
      const m = makeMocks(state)
      await compileAndDispatchFormula({
        ep: makeEP() as Parameters<typeof compileAndDispatchFormula>[0]["ep"],
        factoryAttempt: 1,
        env: BASE_ENV,
        deps: m.deps,
      })
      expect(state.formArtifact!._key).toMatch(/^FORM-[0-9A-F]{16}$/)
    })
  })

  describe("AC-2: var map types are all strings", () => {
    it("non-string EP parameter values are JSON-stringified in parameters_json blob", async () => {
      const state = defaultState()
      const m = makeMocks(state)
      await compileAndDispatchFormula({
        ep: makeEP({
          parameters: { n: 42, flag: true, list: [1, 2, 3] },
        }) as Parameters<typeof compileAndDispatchFormula>[0]["ep"],
        factoryAttempt: 1,
        env: BASE_ENV,
        deps: m.deps,
      })
      const vars = state.formArtifact!.vars
      // Every var must be a string
      for (const v of Object.values(vars)) {
        expect(typeof v).toBe("string")
      }
      // parameters_json contains the original structure with sorted keys
      expect(vars.parameters_json).toBe(
        JSON.stringify({ flag: true, list: [1, 2, 3], n: 42 }),
      )
    })
  })

  describe("idempotency pre-check: dispatched row returns early", () => {
    it("does not call Gas City when a dispatched dispatch_log row exists", async () => {
      const state = defaultState()
      state.dispatchLogRow = {
        _key: "dl-prior",
        es_id: "ES-EXAMPLE-001",
        ep_id: "EP-EXAMPLE-001",
        form_id: "FORM-OLD",
        fn_id: "FN-EXAMPLE-001",
        is_id: "IS-EXAMPLE-001",
        factory_attempt: 1,
        idempotency_key: "matches",
        started_at: state.nowIso,
        outcome: "dispatched",
        gc_bead_id: "bead-OLD",
        gc_workflow_id: "wf-OLD",
        gc_workflow_root_bead_id: "rb-OLD",
        labels_sent: ["fn-id:x"],
        sling_request_hash: "h",
      }
      const m = makeMocks(state)
      const result = await compileAndDispatchFormula({
        ep: makeEP() as Parameters<typeof compileAndDispatchFormula>[0]["ep"],
        factoryAttempt: 1,
        env: BASE_ENV,
        deps: m.deps,
      })
      expect(result.outcome).toBe("dispatched")
      expect(result.gc_bead_id).toBe("bead-OLD")
      expect(result.gc_workflow_id).toBe("wf-OLD")
      expect(state.calls).toHaveLength(0)
    })
  })
})

/*
 * V2 IMPLEMENTATION NOTE — runtime guard vs CI scan
 * ─────────────────────────────────────────────────
 * V2 in the IS calls for "static import analysis on module
 * workers/ff-pipeline/src/compilers/formula-compiler.ts" — an AST-based or
 * grep-based scanner in CI.
 *
 * The check above is a runtime-evaluated regex over the module source as
 * read from disk. It catches the same forbidden import patterns and runs
 * inside the test suite. The authoritative CI scan should still be added
 * as a separate pipeline step (grep/AST) for defense in depth — this test
 * is a development-time tripwire so violations surface in the same suite
 * that gates the build.
 */
