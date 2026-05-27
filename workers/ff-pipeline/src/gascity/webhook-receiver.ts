import { createClientFromEnv } from "@factory/arango-client"
import { GasCityFidelityVerificationReport, Incident } from "@factory/schemas"
import type { PipelineEnv } from "../types.js"
import { ensureGasCityCollections } from "./collection-schema.js"
import { transitionFunctionState } from "./function-lifecycle.js"

type GasCityWebhookOutcome = "approved" | "revise"

interface GasCityCompletionPayload {
  fn_id: string
  is_id: string
  es_id: string
  ep_id: string
  form_id: string
  factory_attempt: number
  bead_id: string
  outcome: GasCityWebhookOutcome
  remediation?: string
}

interface DispatchLogMatch {
  _key: string
  fn_id: string
  is_id: string
  es_id: string
  ep_id: string
  form_id: string
  factory_attempt: number
  outcome: string
  gc_bead_id: string
}

interface GasCityWebhookDb {
  ensureCollection(collection: string, options?: { type?: "document" | "edge" }): Promise<void>
  ensureIndex?(
    collection: string,
    options: {
      type: "hash" | "persistent" | "skiplist"
      fields: string[]
      unique?: boolean
      sparse?: boolean
      name?: string
    },
  ): Promise<void>
  get<T = unknown>(collection: string, key: string): Promise<T | null>
  queryOne<T = unknown>(aql: string, vars?: Record<string, unknown>): Promise<T | null>
  save<T = unknown>(collection: string, doc: Record<string, unknown>): Promise<T>
  update<T = unknown>(collection: string, key: string, patch: Record<string, unknown>): Promise<T>
  saveEdge(collection: string, from: string, to: string, data: Record<string, unknown>): Promise<unknown>
}

export async function handleGasCityWebhook(request: Request, env: PipelineEnv): Promise<Response> {
  const receivedAt = new Date().toISOString()
  const rawBytes = new Uint8Array(await request.arrayBuffer())
  const db = createClientFromEnv(env) as unknown as GasCityWebhookDb
  await ensureGasCityCollections(db)

  const hmac = await verifyGasCityHmac(request, env, rawBytes)
  if (!hmac.ok) {
    await writeWebhookRejection(db, {
      reason: hmac.reason,
      status: hmac.status,
      receivedAt,
      rawBytes,
    })
    return json({ error: hmac.reason }, hmac.status)
  }

  const parsed = parsePayload(rawBytes)
  if (!parsed.ok) {
    await writeWebhookRejection(db, {
      reason: parsed.reason,
      status: 400,
      receivedAt,
      rawBytes,
    })
    return json({ error: parsed.reason }, 400)
  }
  const payload = parsed.payload

  const existing = await db.get<Record<string, unknown>>("completion_events", payload.bead_id)
  if (existing) {
    const vrId = stringValue(existing.fidelity_verdict_id) ?? stringValue(existing.vr_id)
    return json({ duplicate: true, bead_id: payload.bead_id, ...(vrId ? { vr_id: vrId } : {}) }, 200)
  }

  const dispatch = await db.queryOne<DispatchLogMatch>(
    `FOR dl IN dispatch_log
       FILTER dl.gc_bead_id == @beadId
       FILTER dl.outcome == "dispatched"
       LIMIT 1
       RETURN dl`,
    { beadId: payload.bead_id },
  )
  if (!dispatch) {
    await writeWebhookRejection(db, {
      reason: "orphan_bead",
      status: 409,
      receivedAt,
      rawBytes,
      payload,
    })
    return json({ error: "orphan_bead", bead_id: payload.bead_id }, 409)
  }

  const mismatch = dispatchMismatch(payload, dispatch)
  if (mismatch) {
    await writeWebhookRejection(db, {
      reason: "lineage_mismatch",
      status: 409,
      receivedAt,
      rawBytes,
      payload,
      detail: mismatch,
    })
    return json({ error: "lineage_mismatch", mismatch }, 409)
  }

  const vrId = `VR-${(await sha256Hex(`${payload.bead_id}|${payload.factory_attempt}`)).slice(0, 16).toUpperCase()}`
  const lifecycleState = payload.outcome === "approved" ? "accepted" : "rejected"
  const remediation = payload.outcome === "approved"
    ? "none"
    : (payload.remediation?.trim() || "Gas City requested revision.")

  const report = GasCityFidelityVerificationReport.parse({
    id: vrId,
    verification: "fidelity",
    variant: "gascity",
    function_id: payload.fn_id,
    timestamp: receivedAt,
    overall: payload.outcome === "approved" ? "pass" : "fail",
    gc_outcome: payload.outcome,
    bead_id: payload.bead_id,
    form_id: payload.form_id,
    ep_id: payload.ep_id,
    es_id: payload.es_id,
    is_id: payload.is_id,
    factory_attempt: payload.factory_attempt,
    intake_checks: {
      hmac_valid: true,
      payload_wellformed: true,
      lineage_resolved: true,
      dispatch_match: {
        dispatch_log_key: dispatch._key,
        matched_on: "bead_id",
      },
    },
    verdict_authority: "gas-city-verify-stage",
    received_at: receivedAt,
    remediation,
    source_refs: [payload.fn_id, payload.is_id, payload.es_id, payload.ep_id, payload.form_id],
    explicitness: "explicit",
    rationale: "Gas City RELEASE callback was HMAC-valid and matched a dispatched bead.",
  })

  if (payload.outcome === "revise") await db.ensureCollection("specs_signals")

  try {
    await db.save("completion_events", {
      _key: payload.bead_id,
      bead_id: payload.bead_id,
      fn_id: payload.fn_id,
      is_id: payload.is_id,
      es_id: payload.es_id,
      ep_id: payload.ep_id,
      form_id: payload.form_id,
      factory_attempt: payload.factory_attempt,
      outcome: payload.outcome,
      received_at: receivedAt,
      dispatch_log_key: dispatch._key,
      fidelity_verdict_id: vrId,
      raw_sha256: await sha256BytesHex(rawBytes),
      raw_payload: payload as unknown as Record<string, unknown>,
    })
  } catch (err) {
    if (isUniqueConflict(err)) {
      return json({ duplicate: true, bead_id: payload.bead_id, vr_id: vrId }, 200)
    }
    throw err
  }

  await db.save("fidelity_verdicts", {
    _key: vrId,
    ...report,
  })

  await transitionFunctionState(db, {
    functionId: payload.fn_id,
    from: "dispatched",
    to: lifecycleState,
    evidenceKey: vrId,
    trigger: "gascity-webhook",
    timestamp: receivedAt,
  })

  if (payload.outcome === "revise") {
    const maxAmendmentDepth = configuredMaxAmendmentDepth(env)
    if (payload.factory_attempt > maxAmendmentDepth) {
      const incidentId = await writeAmendmentDepthIncident(db, payload, vrId, remediation, receivedAt, maxAmendmentDepth)
      return json({
        accepted: true,
        vr_id: vrId,
        lifecycle_state: lifecycleState,
        outcome: payload.outcome,
        amendment_halted: true,
        incident_id: incidentId,
      }, 202)
    }
    await writeRevisionSignal(db, payload, vrId, remediation, receivedAt)
  }

  return json({
    accepted: true,
    vr_id: vrId,
    lifecycle_state: lifecycleState,
    outcome: payload.outcome,
  }, 202)
}

async function verifyGasCityHmac(
  request: Request,
  env: PipelineEnv,
  rawBytes: Uint8Array,
): Promise<{ ok: true } | { ok: false; status: number; reason: string }> {
  if (request.headers.get("X-GC-Key-ID") !== "v1") {
    return { ok: false, status: 401, reason: "invalid_key_id" }
  }
  const secret = env.GAS_CITY_HMAC_SECRET_V1
  if (!secret) {
    return { ok: false, status: 503, reason: "hmac_secret_unconfigured" }
  }
  const supplied = request.headers.get("X-GC-Signature") ?? ""
  const match = supplied.match(/^sha256=([a-fA-F0-9]{64})$/)
  if (!match) {
    return { ok: false, status: 401, reason: "invalid_signature" }
  }
  const expected = await hmacSha256Hex(secret, rawBytes)
  return constantTimeEqualHex(match[1]!.toLowerCase(), expected)
    ? { ok: true }
    : { ok: false, status: 401, reason: "invalid_signature" }
}

function parsePayload(rawBytes: Uint8Array): { ok: true; payload: GasCityCompletionPayload } | { ok: false; reason: string } {
  let body: unknown
  try {
    body = JSON.parse(new TextDecoder().decode(rawBytes))
  } catch {
    return { ok: false, reason: "payload_malformed" }
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, reason: "payload_malformed" }
  }
  const record = body as Record<string, unknown>
  const payload = {
    fn_id: stringValue(record.fn_id),
    is_id: stringValue(record.is_id),
    es_id: stringValue(record.es_id),
    ep_id: stringValue(record.ep_id),
    form_id: stringValue(record.form_id),
    factory_attempt: record.factory_attempt,
    bead_id: stringValue(record.bead_id),
    outcome: record.outcome,
    remediation: stringValue(record.remediation),
  }
  if (
    !payload.fn_id ||
    !payload.is_id ||
    !payload.es_id ||
    !payload.ep_id ||
    !payload.form_id ||
    !payload.bead_id ||
    !Number.isInteger(payload.factory_attempt) ||
    (payload.factory_attempt as number) <= 0 ||
    (payload.outcome !== "approved" && payload.outcome !== "revise")
  ) {
    return { ok: false, reason: "payload_malformed" }
  }
  return {
    ok: true,
    payload: {
      fn_id: payload.fn_id,
      is_id: payload.is_id,
      es_id: payload.es_id,
      ep_id: payload.ep_id,
      form_id: payload.form_id,
      factory_attempt: payload.factory_attempt as number,
      bead_id: payload.bead_id,
      outcome: payload.outcome,
      ...(payload.remediation ? { remediation: payload.remediation } : {}),
    },
  }
}

function dispatchMismatch(payload: GasCityCompletionPayload, dispatch: DispatchLogMatch): string | null {
  for (const key of ["fn_id", "is_id", "es_id", "ep_id", "form_id", "factory_attempt"] as const) {
    if (payload[key] !== dispatch[key]) return key
  }
  return null
}

async function writeWebhookRejection(
  db: GasCityWebhookDb,
  input: {
    reason: string
    status: number
    receivedAt: string
    rawBytes: Uint8Array
    payload?: GasCityCompletionPayload
    detail?: string
  },
): Promise<void> {
  try {
    await db.ensureCollection("webhook_rejections")
    await db.save("webhook_rejections", {
      reason: input.reason,
      status: input.status,
      received_at: input.receivedAt,
      raw_sha256: await sha256BytesHex(input.rawBytes),
      ...(input.payload ? { payload: input.payload as unknown as Record<string, unknown> } : {}),
      ...(input.detail ? { detail: input.detail } : {}),
    })
  } catch (err) {
    console.warn(`[gascity-webhook] failed to write rejection: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function writeRevisionSignal(
  db: GasCityWebhookDb,
  payload: GasCityCompletionPayload,
  vrId: string,
  remediation: string,
  receivedAt: string,
): Promise<void> {
  const key = `SIG-GC-REVISE-${(await sha256Hex(`${payload.bead_id}|${vrId}`)).slice(0, 12).toUpperCase()}`
  await db.save("specs_signals", {
    _key: key,
    id: key,
    signalType: "internal",
    source: "gascity:webhook",
    subtype: "gascity:revise",
    title: `Gas City requested revision for ${payload.fn_id}`,
    description: remediation,
    evidence: [payload.bead_id, vrId],
    sourceRefs: [payload.fn_id, payload.is_id, payload.es_id, payload.ep_id, payload.form_id, vrId],
    source_refs: [payload.fn_id, payload.is_id, payload.es_id, payload.ep_id, payload.form_id, vrId],
    createdAt: receivedAt,
    raw: {
      bead_id: payload.bead_id,
      outcome: payload.outcome,
      remediation,
      fidelity_verdict_id: vrId,
    },
  })
}

async function writeAmendmentDepthIncident(
  db: GasCityWebhookDb,
  payload: GasCityCompletionPayload,
  vrId: string,
  remediation: string,
  receivedAt: string,
  maxAmendmentDepth: number,
): Promise<string> {
  const key = `INC-GC-AMENDMENT-DEPTH-${(await sha256Hex(`${payload.fn_id}|${payload.factory_attempt}|${vrId}`)).slice(0, 12).toUpperCase()}`
  const incident = Incident.parse({
    id: key,
    invariantIds: [],
    functionIds: [payload.fn_id],
    severity: "sev3",
    status: "open",
    confidence: 1,
    source_refs: [payload.fn_id, payload.is_id, payload.es_id, payload.ep_id, payload.form_id, vrId],
    explicitness: "explicit",
    rationale: "Gas City requested revision after the configured amendment depth was exceeded.",
  })
  await db.ensureCollection("specs_incidents")
  await db.save("specs_incidents", {
    _key: key,
    ...incident,
    incidentType: "gascity_amendment_depth_exceeded",
    title: `Gas City amendment depth exceeded for ${payload.fn_id}`,
    description: remediation,
    openedAt: receivedAt,
    max_amendment_depth: maxAmendmentDepth,
    factory_attempt: payload.factory_attempt,
    bead_id: payload.bead_id,
    fidelity_verdict_id: vrId,
    raw: {
      bead_id: payload.bead_id,
      outcome: payload.outcome,
      remediation,
      factory_attempt: payload.factory_attempt,
      max_amendment_depth: maxAmendmentDepth,
    },
  })
  return key
}

function configuredMaxAmendmentDepth(env: PipelineEnv): number {
  const parsed = Number.parseInt(env.GAS_CITY_MAX_AMENDMENT_DEPTH ?? "", 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 3
}

async function hmacSha256Hex(secret: string, rawBytes: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const signature = await crypto.subtle.sign("HMAC", key, rawBytes)
  return bytesToHex(new Uint8Array(signature))
}

async function sha256Hex(value: string): Promise<string> {
  return sha256BytesHex(new TextEncoder().encode(value))
}

async function sha256BytesHex(value: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", value)
  return bytesToHex(new Uint8Array(digest))
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
}

function constantTimeEqualHex(a: string, b: string): boolean {
  const max = Math.max(a.length, b.length)
  let diff = a.length ^ b.length
  for (let i = 0; i < max; i += 1) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  }
  return diff === 0
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

function isUniqueConflict(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /409|conflict|unique/i.test(message)
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}
