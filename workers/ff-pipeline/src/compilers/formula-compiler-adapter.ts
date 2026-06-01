import type { ArangoClient } from "@factory/arango-client"
import type {
  CoherenceVRRow,
  DispatchLogRow,
  FormulaCompilerDeps,
  FormulaCompilerEnv,
  FormArtifact,
  UncertaintyEmission,
} from "./formula-compiler.js"

export function buildFormulaCompilerDeps(
  db: ArangoClient,
  env: FormulaCompilerEnv & { GAS_CITY?: Fetcher; WORKSPACE_BUCKET?: unknown },
): FormulaCompilerDeps {
  let uncertaintyCollectionEnsured = false
  // The CF binding is typed `unknown` upstream (PipelineEnv); narrow it once.
  const workspaceBucket = env.WORKSPACE_BUCKET as R2Bucket | undefined
  return {
    fetchCoherenceVR: async (esId: string) => {
      const rows = await db.query<CoherenceVRRow>(
        `FOR vr IN verification_reports
  FILTER vr.kind == "coherence" AND vr.status == "passed"
  FILTER @esId IN vr.source_refs
  SORT vr.created_at DESC
  LIMIT 1
  RETURN vr`,
        { esId },
      )
      return rows[0] ?? null
    },

    getDispatchLogByIdempotencyKey: async (
      idempotencyKey: string,
      factoryAttempt: number,
      excludeKey?: string,
    ) => {
      const rows = await db.query<DispatchLogRow>(
        `FOR dl IN dispatch_log
  FILTER dl.idempotency_key == @idempotencyKey
    AND dl.factory_attempt == @factoryAttempt
    AND (@excludeKey == null OR dl._key != @excludeKey)
  SORT dl.started_at DESC
  LIMIT 1
  RETURN dl`,
        {
          idempotencyKey,
          factoryAttempt,
          excludeKey: excludeKey ?? null,
        },
      )
      return rows[0] ?? null
    },

    getFormulaByKey: async (key: string) => {
      return await db.get<FormArtifact>("formulas", key)
    },

    writeFormAndDispatchLog: async (form: FormArtifact, dispatchLog: DispatchLogRow) => {
      await db.save("formulas", form as unknown as Record<string, unknown>)
      await db.save("dispatch_log", dispatchLog as unknown as Record<string, unknown>)
    },

    writeDispatchLogOnly: async (dispatchLog: DispatchLogRow) => {
      await db.save("dispatch_log", dispatchLog as unknown as Record<string, unknown>)
    },

    updateFormulaVersion: async (formKey: string, version: string) => {
      await db.update("formulas", formKey, { formula_version: version })
    },

    updateDispatchLog: async (key: string, patch: Partial<DispatchLogRow>) => {
      await db.update("dispatch_log", key, patch as Record<string, unknown>)
    },

    emitUncertaintyEntry: async (entry: UncertaintyEmission) => {
      try {
        if (!uncertaintyCollectionEnsured) {
          await db.ensureCollection("uncertainty_entries")
          uncertaintyCollectionEnsured = true
        }
        await db.save("uncertainty_entries", entry as unknown as Record<string, unknown>)
      } catch (err) {
        console.warn("[UNCERTAINTY_EMIT_FAILED]", err)
      }
    },

    httpFetch: async (url: string, init?: RequestInit) => {
      // CF error 1042 blocks Worker-to-Worker fetches via the public
      // `*.workers.dev` URL. When the GAS_CITY service binding is present
      // and the request targets the Gas City base URL, route through the
      // binding's Fetcher instead of the public hop. gasCityUrl() still
      // builds full GAS_CITY_BASE_URL-prefixed URLs; the binding accepts
      // the absolute URL and resolves it Worker-internally.
      if (env.GAS_CITY && env.GAS_CITY_BASE_URL && url.startsWith(env.GAS_CITY_BASE_URL)) {
        return env.GAS_CITY.fetch(url, init)
      }
      return globalThis.fetch(url, init)
    },

    now: () => new Date().toISOString(),

    sleep: async (ms: number) => {
      await new Promise<void>((resolve) => setTimeout(resolve, ms))
    },

    // ── IS-WORKSPACE-SEEDING deps ──────────────────────────────────────────
    fetchIntentSpec: async (id: string) => {
      const rows = await db.query<Record<string, unknown>>(
        `FOR doc IN intent_specifications
  FILTER doc._key == @id OR doc.id == @id
  LIMIT 1
  RETURN doc`,
        { id },
      )
      const doc = rows[0]
      if (!doc) return null
      const body =
        (typeof doc.body === "string" ? doc.body : undefined) ??
        (typeof doc.content === "string" ? doc.content : undefined) ??
        JSON.stringify(doc)
      const acceptanceCriteria = Array.isArray(doc.acceptanceCriteria)
        ? (doc.acceptanceCriteria as unknown[]).filter(
            (x): x is string => typeof x === "string",
          )
        : []
      return { body, acceptanceCriteria }
    },

    fetchExecutableSpec: async (id: string) => {
      const rows = await db.query<Record<string, unknown>>(
        `FOR doc IN executable_specifications
  FILTER doc._key == @id OR doc.id == @id
  LIMIT 1
  RETURN doc`,
        { id },
      )
      const doc = rows[0]
      if (!doc) return null
      const body =
        (typeof doc.body === "string" ? doc.body : undefined) ??
        (typeof doc.content === "string" ? doc.content : undefined) ??
        JSON.stringify(doc)
      const acceptanceCriteria = Array.isArray(doc.acceptanceCriteria)
        ? (doc.acceptanceCriteria as unknown[]).filter(
            (x): x is string => typeof x === "string",
          )
        : []
      return { body, acceptanceCriteria }
    },

    putSeed: async (key: string, json: string) => {
      if (!workspaceBucket) {
        throw new Error("WORKSPACE_BUCKET binding is not configured")
      }
      await workspaceBucket.put(key, json)
    },

    getRigFile: async (path: string) => {
      if (!workspaceBucket) {
        throw new Error("WORKSPACE_BUCKET binding is not configured")
      }
      const obj = await workspaceBucket.get(`rigs/${path}`)
      if (!obj) return null
      return await obj.text()
    },
  }
}
