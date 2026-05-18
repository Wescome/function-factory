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
import { mkdtemp, readFile, writeFile, stat, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPrompt } from './execution-contract.mjs'
import { evaluateContracts, defaultContract, buildContractRepairPrompt } from './contract-evaluator.mjs'
import { contractMaterializeCommand } from './contract-materializer.mjs'
import { hasSeedWorkspace, prepareSeedWorkspace, workspacePromptSection } from './workspace-seed.mjs'
import { workspaceDerivedArtifactCommand } from './workspace-derived-artifacts.mjs'
import {
  TOOL_PROBE_FILE,
  assessToolCapabilityProbe,
  buildToolCapabilityProbePrompt,
  getToolCallStreamEventType,
  isToolExecutionEvent,
  requiresFilesystemAuthoring,
  summarizeAssistantMessage,
} from './tool-capability-probe.mjs'

const PORT = Number(process.env.PORT ?? 8080)
const PI_BIN = join(dirname(fileURLToPath(import.meta.url)), 'node_modules', '.bin', 'pi')

// Max time for a stage execution (ms) — 5 minutes is generous for complex LLM tasks
const EXECUTE_TIMEOUT_MS = 300_000
// Delay after spawning pi before sending the first command (pi has no startup signal)
const PI_INIT_DELAY_MS = 200
const PI_MODEL = process.env.PI_MODEL ?? 'openrouter/openai/gpt-5.4'
const DEFAULT_FILESYSTEM_MODEL_CANDIDATES = [
  'openrouter/openai/gpt-5.4',
  'openrouter/anthropic/claude-sonnet-4.6',
  'openrouter/google/gemini-3.1-pro-preview',
  'openrouter/x-ai/grok-4.20',
]
const MAX_OBSERVATION_EVENTS = 256
const MAX_STDERR_TAIL_BYTES = 16_384
const MAX_OBSERVATION_BYTES = 32_768
const VALID_EXECUTION_SURFACES = new Set(['rpc'])

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

function parseModelList(value) {
  return String(value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function dedupeModels(models) {
  const seen = new Set()
  const out = []
  for (const model of models) {
    if (!model?.id || seen.has(model.id)) continue
    seen.add(model.id)
    out.push(model)
  }
  return out
}

function normalizeCandidateModel(candidate, fallbackRouteKind = 'fallback') {
  const id = typeof candidate === 'string' ? candidate : candidate?.id
  const parsed = parseModelId(id)
  if (!parsed) return null
  return {
    ...parsed,
    routeKind: typeof candidate?.routeKind === 'string' ? candidate.routeKind : fallbackRouteKind,
    resolvedVia: typeof candidate?.resolvedVia === 'string' ? candidate.resolvedVia : 'dispatch-candidate',
  }
}

function resolveDispatchModels(input) {
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
  const routeKind = input.model?.routeKind ?? 'fallback'
  const dispatchCandidates = Array.isArray(input.model?.candidates)
    ? input.model.candidates
      .map((entry) => normalizeCandidateModel(entry, routeKind))
      .filter(Boolean)
    : []
  const envCandidates = parseModelList(process.env.PI_FILESYSTEM_MODEL_CANDIDATES ?? process.env.PI_MODEL_CANDIDATES)
    .map((id) => normalizeCandidateModel({ id, resolvedVia: 'container-env-candidate' }, routeKind))
    .filter(Boolean)
  const defaultCandidates = DEFAULT_FILESYSTEM_MODEL_CANDIDATES
    .map((id) => normalizeCandidateModel({ id, resolvedVia: 'container-default-candidate' }, routeKind))
    .filter(Boolean)
  const models = dedupeModels([
    {
      ...parsed,
      routeKind,
      resolvedVia: explicit ? (input.model?.resolvedVia ?? 'dispatch') : 'env-default',
      ...(input.model?.fallback ? { fallback: input.model.fallback } : {}),
    },
    ...dispatchCandidates,
    ...envCandidates,
    ...defaultCandidates,
  ])
  return {
    models,
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

class PiExecutionError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'PiExecutionError'
    this.code = code
  }
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

function resolveExecutionSurface(input) {
  const surface = input.execution?.surface ?? process.env.PI_EXECUTION_SURFACE ?? 'rpc'
  return VALID_EXECUTION_SURFACES.has(surface) ? surface : 'rpc'
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

async function runToolCapabilityProbe({ pi, reader, workDir, observation, getToolExecutionEventCount }) {
  const beforeCount = getToolExecutionEventCount()
  const beforeToolCallEventCount = observation.toolCallEventCount ?? 0
  const beforeAssistantToolCallCount = observation.assistantToolCallCount ?? 0
  await rm(join(workDir, TOOL_PROBE_FILE), { force: true })
  pushObservationEvent(observation, { type: 'tool_capability.probe_start', file: TOOL_PROBE_FILE })
  const endPromise = waitForAgentEnd(reader, EXECUTE_TIMEOUT_MS)
  pi.stdin.write(JSON.stringify({ type: 'prompt', message: buildToolCapabilityProbePrompt() }) + '\n')
  await endPromise

  const toolExecutionEventCount = getToolExecutionEventCount() - beforeCount
  const toolCallEventCount = (observation.toolCallEventCount ?? 0) - beforeToolCallEventCount
  const assistantToolCallCount = (observation.assistantToolCallCount ?? 0) - beforeAssistantToolCallCount
  let fileContent
  let fileError
  try {
    fileContent = await readFile(join(workDir, TOOL_PROBE_FILE), 'utf8')
  } catch (err) {
    fileError = err instanceof Error ? err.message : String(err)
  }

  const result = assessToolCapabilityProbe({
    toolExecutionEventCount,
    toolCallEventCount,
    assistantToolCallCount,
    fileContent,
    fileError,
  })
  pushObservationEvent(observation, {
    type: 'tool_capability.probe_result',
    passed: result.passed,
    reason: result.reason,
    toolExecutionEventCount,
    toolCallEventCount,
    assistantToolCallCount,
    fileReadable: fileError === undefined,
  })
  return result
}

async function runMaterializeCommand({ pi, reader, command }) {
  return sendRpcCommand(pi, reader, { type: 'bash', command }, 30_000)
}

function recordPiEvent({ msg, observation, stageName, log, incrementToolExecutionEventCount }) {
  const type = msg.type
  const toolCallEventType = getToolCallStreamEventType(msg)
  if (isToolExecutionEvent(msg)) {
    incrementToolExecutionEventCount()
  }
  if (toolCallEventType) {
    observation.toolCallEventCount = (observation.toolCallEventCount ?? 0) + 1
  }
  if (type === 'agent_end' || type === 'agent_start' || type === 'turn_start' || type === 'turn_end') {
    log('info', `pi.event.${type}`, { stageName })
    pushObservationEvent(observation, { type })
  } else if (toolCallEventType) {
    const toolCall = msg.assistantMessageEvent?.toolCall
    log('info', 'pi.toolcall_stream', { stageName, eventType: toolCallEventType, toolName: toolCall?.name })
    pushObservationEvent(observation, {
      type: 'toolcall_stream',
      eventType: toolCallEventType,
      ...(toolCall?.name ? { toolName: toolCall.name } : {}),
    })
  } else if (type === 'response') {
    log('info', 'pi.response', { stageName, command: msg.command, success: msg.success, error: msg.error })
    pushObservationEvent(observation, { type, command: msg.command, success: msg.success, error: msg.error ? redact(msg.error) : undefined })
  } else if (type === 'tool_execution_start') {
    log('info', 'pi.tool_execution_start', { stageName, toolName: msg.toolName })
    pushObservationEvent(observation, { type, toolName: msg.toolName })
  } else if (type === 'tool_execution_update') {
    log('info', 'pi.tool_execution_update', { stageName, toolName: msg.toolName })
    pushObservationEvent(observation, { type, toolName: msg.toolName })
  } else if (type === 'tool_execution_end') {
    log('info', 'pi.tool_execution_end', { stageName, toolName: msg.toolName, isError: msg.isError })
    pushObservationEvent(observation, { type, toolName: msg.toolName, isError: Boolean(msg.isError) })
  } else if (type === 'message_end') {
    const role = msg.message?.role
    log('info', 'pi.message_end', { stageName, role })
    const assistantSummary = role === 'assistant' ? summarizeAssistantMessage(msg.message) : undefined
    if (assistantSummary) {
      observation.assistantToolCallCount = (observation.assistantToolCallCount ?? 0) + assistantSummary.toolCallCount
    }
    pushObservationEvent(observation, {
      type,
      role,
      ...(role === 'assistant' ? {
        preview: assistantMessagePreview(msg.message),
        assistant: assistantSummary,
      } : {}),
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
    { dir: join(workDir, '.pi', 'sessions'), kind: 'pi-session' },
    { dir: join(process.env.HOME ?? '/root', '.pi', 'sessions'), kind: 'pi-session' },
    { dir: workDir, kind: 'workspace' },
  ]
  let archiveDir = null
  let archiveKind = null
  for (const candidate of candidates) {
    if (await dirHasFiles(candidate.dir)) {
      archiveDir = candidate.dir
      archiveKind = candidate.kind
      break
    }
  }
  if (!archiveDir) return { skipped: true, reason: 'not_found' }

  const chunks = []
  let total = 0
  let overflow = false
  return await new Promise((resolve) => {
    const tar = spawn('tar', ['-czf', '-', '-C', archiveDir, '.'], {
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
        resolve({ skipped: true, reason: 'too_large', bytes: total, sessionDir: archiveDir, archiveKind })
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
        sessionDir: archiveDir,
        archiveKind,
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
  const resolved = resolveDispatchModels(input)
  const modelCandidates = resolved.models ?? []
  let selectedModel = modelCandidates[0]
  let selectedModelIndex = 0
  const executionSurface = resolveExecutionSurface(input)
  const observation = {
    runId,
    stageName,
    roleName,
    model: selectedModel ?? null,
    modelCandidates: modelCandidates.map((model) => ({
      id: model.id,
      provider: model.provider,
      model: model.model,
      resolvedVia: model.resolvedVia,
    })),
    executionSurface,
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

  log('info', 'execute.start', { stageName, runId, roleName, model: selectedModel.id, executionSurface, declaredOutputs: input.declaredOutputs ?? [] })

  const workDir = await mkdtemp(join(tmpdir(), `pi-${stageName}-`))
  log('info', 'execute.workdir', { stageName, workDir })
  pushObservationEvent(observation, { type: 'execute.workdir' })

  const inputArtifacts = input.context?.inputArtifacts ?? {}
  for (const [name, content] of Object.entries(inputArtifacts)) {
    await writeFile(join(workDir, name), content, 'utf8')
    log('info', 'execute.input_artifact_written', { stageName, name, bytes: content.length })
    pushObservationEvent(observation, { type: 'input_artifact_written', name, bytes: content.length })
  }

  let promptInput = input
  if (hasSeedWorkspace(input)) {
    const prepared = await prepareSeedWorkspace(workDir, inputArtifacts.SeedWorkspace)
    const workspaceSection = workspacePromptSection(prepared)
    promptInput = {
      ...input,
      context: {
        ...(input.context ?? {}),
        taskText: `${input.context?.taskText ?? ''}\n\n${workspaceSection}`.trim(),
      },
    }
    log('info', 'execute.seed_workspace_prepared', { stageName, workspaceDir: prepared.workspaceDir, fileCount: prepared.seed.files.length })
    pushObservationEvent(observation, {
      type: 'seed_workspace.prepared',
      fileCount: prepared.seed.files.length,
      hasTestCommand: typeof prepared.seed.testCommand === 'string',
    })
  }

  const stderrChunks = []
  let toolExecutionEventCount = 0
  let pi = null
  let reader = null

  const stopPi = () => {
    if (pi && pi.exitCode === null) {
      pi.kill('SIGTERM')
    }
  }

  const startPi = async (model, modelIndex, reason = 'initial') => {
    selectedModel = model
    selectedModelIndex = modelIndex
    observation.model = model
    pushObservationEvent(observation, {
      type: 'model.attempt_start',
      model: model.id,
      modelIndex,
      resolvedVia: model.resolvedVia,
      reason,
    })
    pi = spawn(PI_BIN, ['--mode', 'rpc', '--model', model.id], {
      cwd: workDir,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    observation.pid = pi.pid ?? null
    log('info', 'pi.spawned', { stageName, pid: pi.pid, model: model.id, modelIndex, resolvedVia: model.resolvedVia })
    pushObservationEvent(observation, { type: 'pi.spawned', pid: pi.pid ?? null, model: model.id, modelIndex })

    reader = new JsonlReader(pi.stdout)
    pi.stderr.on('data', (c) => stderrChunks.push(c))

    // Log every pi stdout event for observability
    reader.on((msg) => {
      recordPiEvent({
        msg,
        observation,
        stageName,
        log,
        incrementToolExecutionEventCount: () => {
          toolExecutionEventCount++
          observation.toolExecutionEventCount = toolExecutionEventCount
        },
      })
    })

    pi.on('exit', (code, signal) => {
      log('info', 'pi.exit', { stageName, code, signal, model: model.id, modelIndex })
      observation.exit = { code, signal, model: model.id, modelIndex }
      pushObservationEvent(observation, { type: 'pi.exit', code, signal, model: model.id, modelIndex })
    })

    // pi emits no startup signal — wait a brief delay for the process to initialize
    await new Promise((resolve) => setTimeout(resolve, PI_INIT_DELAY_MS))

    if (pi.exitCode !== null) {
      const stderr = redact(Buffer.concat(stderrChunks).toString('utf8').slice(0, 4000))
      throw new Error(`pi exited immediately (code ${pi.exitCode}) for ${model.id}: ${stderr}`)
    }
  }

  try {
    await startPi(selectedModel, selectedModelIndex)

    const declaredOutputs = input.declaredOutputs ?? []
    const maxRepairRounds = Number.isFinite(input.maxRepairRounds) ? Math.max(0, input.maxRepairRounds) : 1

    const contracts = Array.isArray(input.outputContracts) && input.outputContracts.length > 0
      ? input.outputContracts
      : declaredOutputs.map(defaultContract)

    // Deterministic shortcuts: materialize simple contracts via pi bash before prompt.
    // This covers smoke-grade exact_line, json.required_fields, text, and markdown contracts
    // without relying on a chat turn to choose a filesystem tool.
    const seedWorkspacePresent = hasSeedWorkspace(input)
    const workspaceDerivedCommands = seedWorkspacePresent
      ? contracts
        .map((contract) => workspaceDerivedArtifactCommand(contract, input))
        .filter(Boolean)
      : []
    for (const item of workspaceDerivedCommands) {
      pushObservationEvent(observation, { type: 'workspace.derived_command', artifact: item.artifact, kind: item.kind })
      try {
        const rsp = await runMaterializeCommand({ pi, reader, command: item.command })
        pushObservationEvent(observation, { type: 'workspace.derived_response', artifact: item.artifact, kind: item.kind, success: rsp.success })
      } catch (err) {
        pushObservationEvent(observation, { type: 'workspace.derived_error', artifact: item.artifact, kind: item.kind, error: err.message })
      }
    }

    const materializeCommands = contracts
      .filter((contract) => !workspaceDerivedCommands.some((item) => item.artifact === contract.artifact))
      .filter((contract) => !seedWorkspacePresent || contract.artifact === 'IssueContract' || contract.artifact === 'RepoMap')
      .map((contract) => contractMaterializeCommand(contract, input))
      .filter(Boolean)
    for (const item of materializeCommands) {
      pushObservationEvent(observation, { type: 'contract.materialize_command', artifact: item.artifact, kind: item.kind })
      try {
        const rsp = await runMaterializeCommand({ pi, reader, command: item.command })
        pushObservationEvent(observation, { type: 'contract.materialize_response', artifact: item.artifact, kind: item.kind, success: rsp.success })
      } catch (err) {
        pushObservationEvent(observation, { type: 'contract.materialize_error', artifact: item.artifact, kind: item.kind, error: err.message })
      }
    }

    let evaluation = await evaluateContracts({ workDir, contracts })
    pushObservationEvent(observation, { type: 'contract.evaluation', attempt: 'pre-prompt', findings: evaluation.findings })

    const deterministicCommandCount = workspaceDerivedCommands.length + materializeCommands.length
    const skipPrompt = deterministicCommandCount === contracts.length && evaluation.missing.length === 0
    if (!skipPrompt) {
      if (requiresFilesystemAuthoring(evaluation, declaredOutputs)) {
        const probe = await runToolCapabilityProbe({
          pi,
          reader,
          workDir,
          observation,
          getToolExecutionEventCount: () => toolExecutionEventCount,
        })
        if (!probe.passed) {
          let activeProbe = probe
          while (!activeProbe.passed && selectedModelIndex + 1 < modelCandidates.length) {
            const failedModel = selectedModel
            const nextIndex = selectedModelIndex + 1
            const nextModel = modelCandidates[nextIndex]
            pushObservationEvent(observation, {
              type: 'model.failover',
              from: failedModel.id,
              to: nextModel.id,
              reason: activeProbe.reason,
            })
            log('warn', 'pi.model_failover', { stageName, from: failedModel.id, to: nextModel.id, reason: activeProbe.reason })
            stopPi()
            try {
              await startPi(nextModel, nextIndex, 'tool-capability-probe-failed')
            } catch (err) {
              const error = err instanceof Error ? err.message : String(err)
              activeProbe = { passed: false, reason: `model route failed to start: ${error}` }
              pushObservationEvent(observation, {
                type: 'model.attempt_start_failed',
                model: nextModel.id,
                modelIndex: nextIndex,
                error: redact(error),
              })
              continue
            }
            activeProbe = await runToolCapabilityProbe({
              pi,
              reader,
              workDir,
              observation,
              getToolExecutionEventCount: () => toolExecutionEventCount,
            })
          }
          if (activeProbe.passed) {
            pushObservationEvent(observation, {
              type: 'model.capability_route_selected',
              model: selectedModel.id,
              modelIndex: selectedModelIndex,
            })
          } else {
            throw new PiExecutionError(
              'PI_TOOL_CAPABILITY_UNAVAILABLE',
              `pi tool capability probe failed before ${stageName}: ${activeProbe.reason}`
            )
          }
        } else {
          pushObservationEvent(observation, {
            type: 'model.capability_route_selected',
            model: selectedModel.id,
            modelIndex: selectedModelIndex,
          })
        }
      }
      const prompt = buildPrompt(promptInput)
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
        log('info', 'execute.session_archive', { stageName, bytes: captured.bytes, sessionDir: captured.sessionDir, archiveKind: captured.archiveKind })
        pushObservationEvent(observation, { type: 'execute.session_archive', bytes: captured.bytes, archiveKind: captured.archiveKind })
      } else {
        log('info', 'execute.session_archive_skipped', { stageName, reason: captured.reason, bytes: captured.bytes })
        pushObservationEvent(observation, { type: 'execute.session_archive_skipped', reason: captured.reason })
      }
    } catch (archiveErr) {
      log('warn', 'execute.session_archive_failed', { stageName, error: String(archiveErr) })
    }

    stopPi()

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
    stopPi()
    const elapsedMs = Date.now() - t0
    const message = err instanceof Error ? err.message : String(err)
    const code = err instanceof PiExecutionError ? err.code : 'PI_EXECUTION_FAILED'
    const observationOut = observationPayload(observation, stderrChunks, { elapsedMs })
    log('error', 'execute.failed', { stageName, error: redact(message), stderrTail: observationOut.stderrTail, elapsedMs })
    writeJson(res, 500, {
      error: { code, message: redact(message), stderrTail: observationOut.stderrTail },
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
