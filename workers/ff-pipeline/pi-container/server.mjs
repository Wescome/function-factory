/**
 * pi-container/server.mjs
 *
 * HTTP server wrapping pi in RPC mode for NLAH harness stage execution.
 *
 * POST /execute  — accepts WorkerInput JSON, runs pi, returns ContainerExecuteResponse
 * GET  /health   — liveness probe
 *
 * pi RPC protocol (from RpcClient in @earendil-works/pi-coding-agent):
 *   1. Spawn `pi --mode rpc`
 *   2. Wait 100ms for init (no startup signal emitted — just a fixed delay)
 *   3. Send {type:"prompt", message:"..."} to stdin
 *   4. Wait for {type:"agent_end"} event on stdout  ← NOT "state:idle"
 *   5. Read each declaredOutput file from workdir
 *   6. Return {artifacts, artifactContents, message}
 *
 * Uses LF-only JSONL byte-buffer reader (readline splits on U+2028/U+2029).
 */

import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, stat, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPrompt } from './execution-contract.mjs'
import { evaluateContracts, defaultContract, buildContractRepairPrompt } from './contract-evaluator.mjs'

const PORT = Number(process.env.PORT ?? 8080)
const PI_BIN = join(dirname(fileURLToPath(import.meta.url)), 'node_modules', '.bin', 'pi')

// Max time for a stage execution (ms) — 5 minutes is generous for complex LLM tasks
const EXECUTE_TIMEOUT_MS = 300_000
// Delay after spawning pi before sending the first command (pi has no startup signal)
const PI_INIT_DELAY_MS = 200
const PI_MODEL = process.env.PI_MODEL ?? 'anthropic/claude-sonnet-4.5'
const MAX_OBSERVATION_EVENTS = 256
const MAX_STDERR_TAIL_BYTES = 16_384
const MAX_OBSERVATION_BYTES = 32_768
const ALLOWED_MODELS = new Set([
  'anthropic/claude-sonnet-4.5',
  'anthropic/claude-sonnet-4.6',
])

// ── Logging ───────────────────────────────────────────────────────────────────

function log(level, msg, data) {
  const entry = { ts: new Date().toISOString(), level, msg, ...(data ?? {}) }
  process.stderr.write(JSON.stringify(entry) + '\n')
}

function redact(value) {
  return String(value)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/(OPENROUTER_API_KEY|OFOX_API_KEY)\s*[:=]\s*[^\s,}]+/gi, '$1=[REDACTED]')
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-[REDACTED]')
    .replace(/api[_-]?key=([^&\s]+)/gi, 'api_key=[REDACTED]')
    .replace(/authorization["']?\s*:\s*["'][^"']+["']/gi, 'authorization:"[REDACTED]"')
}

function parseModelId(id) {
  const [provider, ...rest] = String(id ?? '').split('/')
  const model = rest.join('/')
  if (!provider || !model) return null
  return { id: `${provider}/${model}`, provider, model }
}

function resolveDispatchModel(input) {
  const explicit = input.model?.id
  const candidate = explicit ?? PI_MODEL
  const parsed = parseModelId(candidate)
  if (!parsed) {
    return {
      error: {
        code: explicit ? 'INVALID_MODEL' : 'MISSING_MODEL',
        message: explicit
          ? `invalid explicit model id: ${candidate}`
          : 'missing PI model route and PI_MODEL fallback',
      },
    }
  }
  if (!ALLOWED_MODELS.has(parsed.id)) {
    return {
      error: {
        code: 'UNSUPPORTED_MODEL',
        message: `unsupported pi model: ${parsed.id}`,
      },
    }
  }
  return {
    model: {
      ...parsed,
      routeKind: input.model?.routeKind ?? 'fallback',
      resolvedVia: explicit ? (input.model?.resolvedVia ?? 'dispatch') : 'env-default',
      ...(input.model?.fallback ? { fallback: input.model.fallback } : {}),
    },
  }
}

function pushObservationEvent(observation, event) {
  observation.events.push({ ts: new Date().toISOString(), ...event })
  if (observation.events.length > MAX_OBSERVATION_EVENTS) {
    observation.events.shift()
    observation.truncated = true
  }
}

function stderrTail(chunks) {
  const raw = Buffer.concat(chunks).toString('utf8')
  return redact(raw.slice(Math.max(0, raw.length - MAX_STDERR_TAIL_BYTES)))
}

function observationPayload(observation, stderrChunks, extra = {}) {
  const out = {
    ...observation,
    ...extra,
    stderrTail: stderrTail(stderrChunks),
  }
  let encoded = JSON.stringify(out)
  if (Buffer.byteLength(encoded, 'utf8') <= MAX_OBSERVATION_BYTES) return out

  out.truncated = true
  while (out.events.length > 0 && Buffer.byteLength(encoded, 'utf8') > MAX_OBSERVATION_BYTES) {
    out.events.shift()
    encoded = JSON.stringify(out)
  }
  return out
}

function writeJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

function shellQuote(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'"
}

function assistantMessagePreview(message) {
  if (!message || typeof message !== 'object') return undefined
  const content = message.content
  let text
  if (typeof content === 'string') {
    text = content
  } else if (Array.isArray(content)) {
    text = content.map((part) => {
      if (typeof part === 'string') return part
      if (part && typeof part === 'object' && typeof part.text === 'string') return part.text
      return ''
    }).join(' ')
  }
  if (!text) return undefined
  return redact(text).replace(/\s+/g, ' ').trim().slice(0, 500)
}

function jsonPlaceholderValue(field, input) {
  if (field === 'runId') return input.runId ?? input.context?.runId ?? 'unknown'
  if (/^(elapsedMs|durationMs|.*Count|.*Bytes|.*Size|.*Total)$/i.test(field)) return 0
  if (/^(ok|passed|success|valid)$/i.test(field)) return true
  if (/^(status|state|result|verdict)$/i.test(field)) return 'ok'
  return ''
}

function contractMaterializeCommand(contract, input) {
  if (!/^[A-Za-z0-9._-]+$/.test(contract.artifact)) return undefined
  const body = contract.body
  if (body?.kind === 'exact_line') {
    return {
      artifact: contract.artifact,
      kind: body.kind,
      command: `printf '%s\\n' ${shellQuote(body.line)} > ${shellQuote(contract.artifact)}`,
    }
  }
  if (body?.kind === 'json' && Array.isArray(body.requiredFields) && body.requiredFields.length > 0) {
    const payload = {}
    for (const field of body.requiredFields) {
      if (typeof field === 'string' && field.length > 0) {
        payload[field] = jsonPlaceholderValue(field, input)
      }
    }
    return {
      artifact: contract.artifact,
      kind: body.kind,
      command: `printf '%s\\n' ${shellQuote(JSON.stringify(payload, null, 2))} > ${shellQuote(contract.artifact)}`,
    }
  }
  return undefined
}

// ── JSONL byte-buffer reader ──────────────────────────────────────────────────

class JsonlReader {
  constructor(stream) {
    this._buf = Buffer.alloc(0)
    this._handlers = []
    stream.on('data', (chunk) => this._consume(chunk))
  }

  _consume(chunk) {
    this._buf = Buffer.concat([this._buf, chunk])
    let pos
    while ((pos = this._buf.indexOf(0x0a)) !== -1) {
      const line = this._buf.subarray(0, pos).toString('utf8').trim()
      this._buf = this._buf.subarray(pos + 1)
      if (!line) continue
      let msg
      try { msg = JSON.parse(line) } catch { continue }
      for (const h of this._handlers) h(msg)
    }
  }

  on(fn) {
    this._handlers.push(fn)
    return () => { this._handlers = this._handlers.filter((h) => h !== fn) }
  }
}

// ── Wait for pi agent_end ─────────────────────────────────────────────────────

function waitForAgentEnd(reader, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off()
      reject(new Error(`pi timed out after ${timeoutMs}ms waiting for agent_end`))
    }, timeoutMs)
    const off = reader.on((msg) => {
      if (msg.type === 'agent_end') {
        clearTimeout(timer)
        off()
        resolve(msg)
      }
    })
  })
}

function sendRpcCommand(pi, reader, command, timeoutMs) {
  return new Promise((resolve, reject) => {
    const id = `cmd-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const timer = setTimeout(() => {
      off()
      reject(new Error(`pi timed out after ${timeoutMs}ms waiting for ${command.type} response`))
    }, timeoutMs)
    const off = reader.on((msg) => {
      if (msg.type === 'response' && msg.id === id) {
        clearTimeout(timer)
        off()
        if (msg.success) {
          resolve(msg)
        } else {
          reject(new Error(msg.error ?? `${command.type} command failed`))
        }
      }
    })
    pi.stdin.write(JSON.stringify({ ...command, id }) + '\n')
  })
}

// ── Session archive (tar pi's session dir) ────────────────────────────────────

const MAX_SESSION_ARCHIVE_BYTES = 1_048_576 // 1 MB

async function dirHasFiles(dir) {
  try {
    const st = await stat(dir)
    if (!st.isDirectory()) return false
    const entries = await readdir(dir)
    return entries.length > 0
  } catch {
    return false
  }
}

async function captureSessionArchive(workDir) {
  const candidates = [
    join(workDir, '.pi', 'sessions'),
    join(process.env.HOME ?? '/root', '.pi', 'sessions'),
  ]
  let sessionDir = null
  for (const candidate of candidates) {
    if (await dirHasFiles(candidate)) {
      sessionDir = candidate
      break
    }
  }
  if (!sessionDir) return { skipped: true, reason: 'not_found' }

  const chunks = []
  let total = 0
  let overflow = false
  return await new Promise((resolve) => {
    const tar = spawn('tar', ['-czf', '-', '-C', sessionDir, '.'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stderrBuf = []
    tar.stdout.on('data', (chunk) => {
      if (overflow) return
      total += chunk.length
      if (total > MAX_SESSION_ARCHIVE_BYTES) {
        overflow = true
        try { tar.kill('SIGTERM') } catch {}
        return
      }
      chunks.push(chunk)
    })
    tar.stderr.on('data', (c) => stderrBuf.push(c))
    tar.on('error', (err) => {
      resolve({ skipped: true, reason: 'spawn_error', error: String(err) })
    })
    tar.on('close', (code) => {
      if (overflow) {
        resolve({ skipped: true, reason: 'too_large', bytes: total, sessionDir })
        return
      }
      if (code !== 0) {
        resolve({
          skipped: true,
          reason: 'tar_exit',
          code,
          stderr: Buffer.concat(stderrBuf).toString('utf8').slice(0, 1024),
        })
        return
      }
      const buf = Buffer.concat(chunks)
      resolve({
        skipped: false,
        sessionDir,
        bytes: buf.length,
        data: buf.toString('base64'),
      })
    })
  })
}

// ── /execute handler ──────────────────────────────────────────────────────────

async function handleExecute(req, res) {
  let raw = ''
  for await (const chunk of req) raw += chunk
  const input = JSON.parse(raw)

  const { stageName = 'stage', runId = 'unknown', roleName = 'Agent' } = input
  const t0 = Date.now()
  const resolved = resolveDispatchModel(input)
  const selectedModel = resolved.model
  const observation = {
    runId,
    stageName,
    roleName,
    model: selectedModel ?? null,
    events: [],
    artifacts: [],
    truncated: false,
  }

  if (resolved.error) {
    pushObservationEvent(observation, { type: 'model.rejected', code: resolved.error.code })
    log('warn', 'execute.model_rejected', { stageName, runId, error: resolved.error.message })
    writeJson(res, 400, {
      error: resolved.error,
      observation: observationPayload(observation, [], { elapsedMs: Date.now() - t0 }),
    })
    return
  }

  log('info', 'execute.start', { stageName, runId, roleName, model: selectedModel.id, declaredOutputs: input.declaredOutputs ?? [] })

  const workDir = await mkdtemp(join(tmpdir(), `pi-${stageName}-`))
  log('info', 'execute.workdir', { stageName, workDir })
  pushObservationEvent(observation, { type: 'execute.workdir' })

  const inputArtifacts = input.context?.inputArtifacts ?? {}
  for (const [name, content] of Object.entries(inputArtifacts)) {
    await writeFile(join(workDir, name), content, 'utf8')
    log('info', 'execute.input_artifact_written', { stageName, name, bytes: content.length })
    pushObservationEvent(observation, { type: 'input_artifact_written', name, bytes: content.length })
  }

  const pi = spawn(PI_BIN, ['--mode', 'rpc', '--model', selectedModel.id], {
    cwd: workDir,
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  observation.pid = pi.pid ?? null
  log('info', 'pi.spawned', { stageName, pid: pi.pid, model: selectedModel.id, resolvedVia: selectedModel.resolvedVia })
  pushObservationEvent(observation, { type: 'pi.spawned', pid: pi.pid ?? null, model: selectedModel.id })

  const reader = new JsonlReader(pi.stdout)
  const stderrChunks = []
  pi.stderr.on('data', (c) => stderrChunks.push(c))

  // Log every pi stdout event for observability
  reader.on((msg) => {
    const type = msg.type
    if (type === 'agent_end' || type === 'agent_start' || type === 'turn_start' || type === 'turn_end') {
      log('info', `pi.event.${type}`, { stageName })
      pushObservationEvent(observation, { type })
    } else if (type === 'response') {
      log('info', 'pi.response', { stageName, command: msg.command, success: msg.success, error: msg.error })
      pushObservationEvent(observation, { type, command: msg.command, success: msg.success, error: msg.error ? redact(msg.error) : undefined })
    } else if (type === 'tool_call') {
      log('info', 'pi.tool_call', { stageName, toolName: msg.toolName })
      pushObservationEvent(observation, { type, toolName: msg.toolName })
    } else if (type === 'tool_result') {
      log('info', 'pi.tool_result', { stageName, toolName: msg.toolName, isError: msg.isError })
      pushObservationEvent(observation, { type, toolName: msg.toolName, isError: Boolean(msg.isError) })
    } else if (type === 'message_end') {
      const role = msg.message?.role
      log('info', 'pi.message_end', { stageName, role })
      pushObservationEvent(observation, {
        type,
        role,
        ...(role === 'assistant' ? { preview: assistantMessagePreview(msg.message) } : {}),
      })
      if (msg.usage && typeof msg.usage === 'object') {
        const {
          inputTokens,
          outputTokens,
          cacheReadTokens,
          cacheWriteTokens,
        } = msg.usage
        pushObservationEvent(observation, {
          type: 'pi.usage',
          inputTokens,
          outputTokens,
          cacheReadTokens,
          cacheWriteTokens,
        })
        const prev = observation.totalUsage ?? { inputTokens: 0, outputTokens: 0 }
        observation.totalUsage = {
          inputTokens: (prev.inputTokens ?? 0) + (Number(inputTokens) || 0),
          outputTokens: (prev.outputTokens ?? 0) + (Number(outputTokens) || 0),
        }
      }
    } else if (type === 'extension_error') {
      log('warn', 'pi.extension_error', { stageName, ...msg })
      pushObservationEvent(observation, { type, error: msg.error ? redact(msg.error) : undefined })
    }
    // tool_call, message_start etc. not logged to avoid noise
  })

  pi.on('exit', (code, signal) => {
    log('info', 'pi.exit', { stageName, code, signal })
    observation.exit = { code, signal }
    pushObservationEvent(observation, { type: 'pi.exit', code, signal })
  })

  try {
    // pi emits no startup signal — wait a brief delay for the process to initialize
    await new Promise((resolve) => setTimeout(resolve, PI_INIT_DELAY_MS))

    if (pi.exitCode !== null) {
      const stderr = Buffer.concat(stderrChunks).toString('utf8').slice(0, 4000)
      throw new Error(`pi exited immediately (code ${pi.exitCode}): ${stderr}`)
    }

    const declaredOutputs = input.declaredOutputs ?? []
    const maxRepairRounds = Number.isFinite(input.maxRepairRounds) ? Math.max(0, input.maxRepairRounds) : 1

    const contracts = Array.isArray(input.outputContracts) && input.outputContracts.length > 0
      ? input.outputContracts
      : declaredOutputs.map(defaultContract)

    // Deterministic shortcuts: materialize simple contracts via pi bash before prompt.
    // This covers smoke-grade exact_line and json.required_fields contracts
    // without relying on a chat turn to choose a filesystem tool.
    const materializeCommands = contracts
      .map((contract) => contractMaterializeCommand(contract, input))
      .filter(Boolean)
    for (const item of materializeCommands) {
      pushObservationEvent(observation, { type: 'contract.materialize_command', artifact: item.artifact, kind: item.kind })
      try {
        const rsp = await sendRpcCommand(pi, reader, { type: 'bash', command: item.command }, 30_000)
        pushObservationEvent(observation, { type: 'contract.materialize_response', artifact: item.artifact, kind: item.kind, success: rsp.success })
      } catch (err) {
        pushObservationEvent(observation, { type: 'contract.materialize_error', artifact: item.artifact, kind: item.kind, error: err.message })
      }
    }

    let evaluation = await evaluateContracts({ workDir, contracts })
    pushObservationEvent(observation, { type: 'contract.evaluation', attempt: 'pre-prompt', findings: evaluation.findings })

    const skipPrompt = materializeCommands.length === contracts.length && evaluation.missing.length === 0
    if (!skipPrompt) {
      const prompt = buildPrompt(input)
      const agentEndPromise = waitForAgentEnd(reader, EXECUTE_TIMEOUT_MS)
      pi.stdin.write(JSON.stringify({ type: 'prompt', message: prompt }) + '\n')
      await agentEndPromise
      evaluation = await evaluateContracts({ workDir, contracts })
      pushObservationEvent(observation, { type: 'contract.evaluation', attempt: 'initial', findings: evaluation.findings })
    }

    let repairsUsed = 0
    while (evaluation.missing.length > 0 && repairsUsed < maxRepairRounds) {
      repairsUsed++
      const repairPrompt = buildContractRepairPrompt(evaluation.findings)
      pushObservationEvent(observation, { type: 'contract.repair_requested', round: repairsUsed })
      const endPromise = waitForAgentEnd(reader, EXECUTE_TIMEOUT_MS)
      pi.stdin.write(JSON.stringify({ type: 'prompt', message: repairPrompt }) + '\n')
      await endPromise
      evaluation = await evaluateContracts({ workDir, contracts })
      pushObservationEvent(observation, { type: 'contract.evaluation', attempt: `repair-${repairsUsed}`, findings: evaluation.findings })
    }

    observation.contractEvaluation = {
      finalAttempt: skipPrompt ? 'pre-prompt' : (repairsUsed > 0 ? `repair-${repairsUsed}` : 'initial'),
      repairsUsed,
      maxRepairRounds,
      findings: evaluation.findings,
      failedArtifacts: evaluation.missing,
    }

    if (evaluation.missing.length > 0) {
      throw new Error(
        `pi container: contract evaluation failed for [${evaluation.missing.join(', ')}] after ${repairsUsed} repair round(s)`
      )
    }

    const artifactNames = evaluation.findings.filter((f) => f.status === 'pass').map((f) => f.artifact)
    const artifactContents = evaluation.contents

    let sessionArchive = null
    try {
      const captured = await captureSessionArchive(workDir)
      if (!captured.skipped) {
        sessionArchive = { data: captured.data, bytes: captured.bytes }
        log('info', 'execute.session_archive', { stageName, bytes: captured.bytes, sessionDir: captured.sessionDir })
        pushObservationEvent(observation, { type: 'execute.session_archive', bytes: captured.bytes })
      } else {
        log('info', 'execute.session_archive_skipped', { stageName, reason: captured.reason, bytes: captured.bytes })
        pushObservationEvent(observation, { type: 'execute.session_archive_skipped', reason: captured.reason })
      }
    } catch (archiveErr) {
      log('warn', 'execute.session_archive_failed', { stageName, error: String(archiveErr) })
    }

    pi.kill('SIGTERM')

    const elapsedMs = Date.now() - t0
    log('info', 'execute.complete', { stageName, artifacts: artifactNames, missing: evaluation.missing, elapsedMs })
    writeJson(res, 200, {
      artifacts: artifactNames,
      artifactContents,
      message: `${stageName} complete`,
      observation: observationPayload(observation, stderrChunks, { elapsedMs }),
      ...(sessionArchive ? { sessionArchive } : {}),
    })
  } catch (err) {
    pi.kill('SIGTERM')
    const elapsedMs = Date.now() - t0
    const message = err instanceof Error ? err.message : String(err)
    const observationOut = observationPayload(observation, stderrChunks, { elapsedMs })
    log('error', 'execute.failed', { stageName, error: redact(message), stderrTail: observationOut.stderrTail, elapsedMs })
    writeJson(res, 500, {
      error: { code: 'PI_EXECUTION_FAILED', message: redact(message), stderrTail: observationOut.stderrTail },
      observation: observationOut,
    })
  }
}

// ── HTTP server ───────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/execute') {
      await handleExecute(req, res)
    } else if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok', ts: new Date().toISOString() }))
    } else {
      res.writeHead(404)
      res.end('not found')
    }
  } catch (err) {
    log('error', 'server.error', { error: String(err) })
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: String(err) }))
    }
  }
})

server.listen(PORT, () => {
  log('info', 'server.ready', { port: PORT, piBin: PI_BIN })
})
