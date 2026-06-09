import {
  buildRunTranscript,
  deriveLearningObservations,
  learningRunTranscriptKey,
  type RunTranscript,
  type TerminalPipelineResult,
} from "@factory/learning"
import type { ArangoClient } from "@factory/db-client"
import type { PipelineEnv, PipelineResult } from "./types"

const DEFAULT_LEARNING_WRITE_TIMEOUT_MS = 500

interface CaptureLearningTranscriptInput {
  env: PipelineEnv
  db: ArangoClient
  runId: string
  terminalResult: PipelineResult
  trellisExecutionPacketId?: string
  trellisExecutionPacketHash?: string
}

function isEnabled(value: string | undefined): boolean {
  return value === "true"
}

function learningWriteTimeoutMs(env: PipelineEnv): number {
  const parsed = Number(env.LEARNING_WRITE_TIMEOUT_MS)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LEARNING_WRITE_TIMEOUT_MS
  return parsed
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`learning write timed out after ${timeoutMs}ms`))
    }, timeoutMs)
  })

  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

async function upsertDocument(
  db: ArangoClient,
  collection: string,
  key: string,
  doc: Record<string, unknown>,
): Promise<void> {
  await db.query(
    `INSERT INTO documents (collection, key, json) VALUES (?, ?, ?) ON CONFLICT(collection, key) DO UPDATE SET json=json_patch(json, excluded.json)`,
    [collection, key, JSON.stringify({ ...doc, _key: key })],
  )
}

function transcriptRecord(transcript: RunTranscript): Record<string, unknown> {
  return transcript as unknown as Record<string, unknown>
}

export async function captureLearningTranscript(
  input: CaptureLearningTranscriptInput,
): Promise<PipelineResult> {
  if (!isEnabled(input.env.LEARNING_ENABLED)) {
    return input.terminalResult
  }

  try {
    const createdAt = new Date().toISOString()
    const transcript = buildRunTranscript({
      runId: input.runId,
      terminalResult: input.terminalResult as TerminalPipelineResult,
      createdAt,
      ...(input.trellisExecutionPacketId ? { trellisExecutionPacketId: input.trellisExecutionPacketId } : {}),
      ...(input.trellisExecutionPacketHash ? { trellisExecutionPacketHash: input.trellisExecutionPacketHash } : {}),
    })
    const timeoutMs = learningWriteTimeoutMs(input.env)
    const transcriptKey = learningRunTranscriptKey(input.runId)

    await withTimeout(
      upsertDocument(
        input.db,
        "learning_run_transcripts",
        transcriptKey,
        transcriptRecord(transcript),
      ),
      timeoutMs,
    )

    if (isEnabled(input.env.LEARNING_OBSERVATIONS_ENABLED)) {
      const observations = deriveLearningObservations(transcript)
      await withTimeout(
        Promise.all(observations.map((observation) => upsertDocument(
          input.db,
          "learning_observations",
          observation._key ?? observation.observation_id,
          observation as unknown as Record<string, unknown>,
        ))).then(() => undefined),
        timeoutMs,
      )
    }
  } catch (error) {
    console.warn(`[learning] transcript capture skipped: ${error instanceof Error ? error.message : String(error)}`)
  }

  return input.terminalResult
}
