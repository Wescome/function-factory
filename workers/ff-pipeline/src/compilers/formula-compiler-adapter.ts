import type { ArtifactClient } from "../artifact-client.js"
import type {
  CoherenceVRRow,
  DispatchLogRow,
  FormulaCompilerDeps,
  FormulaCompilerEnv,
  FormArtifact,
  UncertaintyEmission,
} from "./formula-compiler.js"

export function buildFormulaCompilerDeps(
  db: ArtifactClient,
  env: FormulaCompilerEnv & { GAS_CITY?: Fetcher; WORKSPACE_BUCKET?: unknown },
  fallback?: {
    query<T = unknown>(aql: string, vars?: Record<string, unknown>): Promise<T[]>
    get<T = unknown>(collection: string, key: string): Promise<T | null>
    save(collection: string, doc: Record<string, unknown>): Promise<unknown>
    update(collection: string, key: string, patch: Record<string, unknown>): Promise<unknown>
    ensureCollection?(collection: string): Promise<void>
  },
): FormulaCompilerDeps {
  // The CF binding is typed `unknown` upstream (PipelineEnv); narrow it once.
  const workspaceBucket = env.WORKSPACE_BUCKET as R2Bucket | undefined
  return {
    fetchCoherenceVR: async (esId: string) => {
      try {
        const rows = await db.query<CoherenceVRRow>("verification_reports", {
          kind: "coherence",
          status: "passed",
        })
        const matches = rows.filter((row) => {
          const sourceRefs = (row as unknown as { source_refs?: unknown[] }).source_refs
          return Array.isArray(sourceRefs) && sourceRefs.includes(esId)
        })
        return matches[0] ?? null
      } catch (err) {
        if (!shouldFallback(err) || !fallback) throw err
        const rows = await fallback.query<CoherenceVRRow>(
          `FOR vr IN verification_reports
  FILTER vr.kind == "coherence" AND vr.status == "passed"
  FILTER @esId IN vr.source_refs
  SORT vr.created_at DESC
  LIMIT 1
  RETURN vr`,
          { esId },
        )
        return rows[0] ?? null
      }
    },

    getDispatchLogByIdempotencyKey: async (
      idempotencyKey: string,
      factoryAttempt: number,
      excludeKey?: string,
    ) => {
      const rows = await db.query<DispatchLogRow>("dispatch_log", {
        idempotency_key: idempotencyKey,
        factory_attempt: factoryAttempt,
      })
      const filtered = excludeKey
        ? rows.filter((row) => String((row as unknown as { _key?: string })._key ?? "") !== excludeKey)
        : rows
      return filtered[0] ?? null
    },

    getFormulaByKey: async (key: string) => {
      try {
        return await db.get<FormArtifact>("formulas", key)
      } catch (err) {
        if (!shouldFallback(err) || !fallback) throw err
        return await fallback.get<FormArtifact>("formulas", key)
      }
    },

    writeFormAndDispatchLog: async (form: FormArtifact, dispatchLog: DispatchLogRow) => {
      try {
        await db.insert("formulas", form as unknown as Record<string, unknown>)
      } catch (err) {
        if (!shouldFallback(err) || !fallback) throw err
        await fallback.save("formulas", form as unknown as Record<string, unknown>)
      }
      await db.insert("dispatch_log", dispatchLog as unknown as Record<string, unknown>)
    },

    writeDispatchLogOnly: async (dispatchLog: DispatchLogRow) => {
      await db.insert("dispatch_log", dispatchLog as unknown as Record<string, unknown>)
    },

    updateFormulaVersion: async (formKey: string, version: string) => {
      try {
        await db.patch("formulas", formKey, { formula_version: version })
      } catch (err) {
        if (!shouldFallback(err) || !fallback) throw err
        await fallback.update("formulas", formKey, { formula_version: version })
      }
    },

    updateDispatchLog: async (key: string, patch: Partial<DispatchLogRow>) => {
      await db.patch("dispatch_log", key, patch as Record<string, unknown>)
    },

    emitUncertaintyEntry: async (entry: UncertaintyEmission) => {
      try {
        await db.insert("uncertainty_entries", entry as unknown as Record<string, unknown>)
      } catch (err) {
        if (fallback) {
          try {
            if (fallback.ensureCollection) await fallback.ensureCollection("uncertainty_entries")
            await fallback.save("uncertainty_entries", entry as unknown as Record<string, unknown>)
            return
          } catch {}
        }
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
      let rows: Record<string, unknown>[] = []
      try {
        const byId = await db.get<Record<string, unknown>>("intent_specifications", id)
        rows = byId ? [byId] : await db.query<Record<string, unknown>>("intent_specifications", { id })
      } catch (err) {
        if (!shouldFallback(err) || !fallback) throw err
        rows = await fallback.query<Record<string, unknown>>(
          `FOR doc IN intent_specifications
  FILTER doc._key == @id OR doc.id == @id
  LIMIT 1
  RETURN doc`,
          { id },
        )
      }
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
      let rows: Record<string, unknown>[] = []
      try {
        const byId = await db.get<Record<string, unknown>>("executable_specifications", id)
        rows = byId ? [byId] : await db.query<Record<string, unknown>>("executable_specifications", { id })
      } catch (err) {
        if (!shouldFallback(err) || !fallback) throw err
        rows = await fallback.query<Record<string, unknown>>(
          `FOR doc IN executable_specifications
  FILTER doc._key == @id OR doc.id == @id
  LIMIT 1
  RETURN doc`,
          { id },
        )
      }
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

function shouldFallback(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return message.includes("no such table") || message.includes("not_found")
}
