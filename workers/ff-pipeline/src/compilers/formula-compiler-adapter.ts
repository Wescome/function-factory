import type { ArangoClient } from "@factory/db-client"
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
  const workspaceBucket = env.WORKSPACE_BUCKET as R2Bucket | undefined

  return {
    fetchCoherenceVR: async (esId: string) => {
      const row = await db.queryOne<{ json: string }>(
        `SELECT json FROM documents
  WHERE collection='verification_reports'
    AND json_extract(json,'$.kind')='coherence'
    AND json_extract(json,'$.status')='passed'
    AND json_extract(json,'$.source_refs') LIKE ?
  ORDER BY json_extract(json,'$.created_at') DESC
  LIMIT 1`,
        [`%${esId}%`],
      )
      return row ? JSON.parse(row.json) as CoherenceVRRow : null
    },

    getDispatchLogByIdempotencyKey: async (
      idempotencyKey: string,
      factoryAttempt: number,
      excludeKey?: string,
    ) => {
      const row = await db.queryOne<{ json: string }>(
        `SELECT json FROM documents
  WHERE collection='dispatch_log'
    AND json_extract(json,'$.idempotency_key')=?
    AND json_extract(json,'$.factory_attempt')=?
    AND (? IS NULL OR key != ?)
  ORDER BY json_extract(json,'$.started_at') DESC
  LIMIT 1`,
        [idempotencyKey, factoryAttempt, excludeKey ?? null, excludeKey ?? null],
      )
      return row ? JSON.parse(row.json) as DispatchLogRow : null
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
      if (env.GAS_CITY && env.GAS_CITY_BASE_URL && url.startsWith(env.GAS_CITY_BASE_URL)) {
        return env.GAS_CITY.fetch(url, init)
      }
      return globalThis.fetch(url, init)
    },

    now: () => new Date().toISOString(),

    sleep: async (ms: number) => {
      await new Promise<void>((resolve) => setTimeout(resolve, ms))
    },

    fetchIntentSpec: async (id: string) => {
      const row = await db.queryOne<{ json: string }>(
        `SELECT json FROM documents
  WHERE collection='intent_specifications' AND (key=? OR json_extract(json,'$.id')=?)
  LIMIT 1`,
        [id, id],
      )
      if (!row) return null
      const doc = JSON.parse(row.json) as Record<string, unknown>
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
      const row = await db.queryOne<{ json: string }>(
        `SELECT json FROM documents
  WHERE collection='executable_specifications' AND (key=? OR json_extract(json,'$.id')=?)
  LIMIT 1`,
        [id, id],
      )
      if (!row) return null
      const doc = JSON.parse(row.json) as Record<string, unknown>
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
