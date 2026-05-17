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
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = Number(process.env.PORT ?? 8080)
const PI_BIN = join(dirname(fileURLToPath(import.meta.url)), 'node_modules', '.bin', 'pi')

// Max time for a stage execution (ms) — 5 minutes is generous for complex LLM tasks
const EXECUTE_TIMEOUT_MS = 300_000
// Delay after spawning pi before sending the first command (pi has no startup signal)
const PI_INIT_DELAY_MS = 200
const PI_MODEL = process.env.PI_MODEL ?? 'anthropic/claude-sonnet-4'

// ── Logging ───────────────────────────────────────────────────────────────────

function log(level, msg, data) {
  const entry = { ts: new Date().toISOString(), level, msg, ...(data ?? {}) }
  process.stderr.write(JSON.stringify(entry) + '\n')
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

// ── Prompt builder ────────────────────────────────────────────────────────────

function buildPrompt(input) {
  const { stageName, roleName, rolePrompt, context = {}, declaredOutputs = [] } = input
  const { taskText = '', inputArtifacts = {} } = context

  const parts = []
  parts.push(`You are ${roleName}${rolePrompt ? `: ${rolePrompt}` : '.'}`)
  parts.push(`## Task\n\n${taskText}`)

  const inputNames = Object.keys(inputArtifacts)
  if (inputNames.length > 0) {
    parts.push('## Input Artifacts\n')
    for (const [name, content] of Object.entries(inputArtifacts)) {
      parts.push(`### ${name}\n\n${content}`)
    }
  }

  if (declaredOutputs.length > 0) {
    parts.push(
      '## Required Outputs\n\n' +
      'Write each of the following files to your current working directory using the artifact name as the filename:\n\n' +
      declaredOutputs.map((n) => `- \`${n}\``).join('\n') +
      '\n\nDo not finish until every required file has been written.',
    )
  }

  return parts.join('\n\n')
}

// ── /execute handler ──────────────────────────────────────────────────────────

async function handleExecute(req, res) {
  let raw = ''
  for await (const chunk of req) raw += chunk
  const input = JSON.parse(raw)

  const { stageName = 'stage', runId = 'unknown', roleName = 'Agent' } = input
  const t0 = Date.now()
  log('info', 'execute.start', { stageName, runId, roleName, declaredOutputs: input.declaredOutputs ?? [] })

  const workDir = await mkdtemp(join(tmpdir(), `pi-${stageName}-`))
  log('info', 'execute.workdir', { stageName, workDir })

  const inputArtifacts = input.context?.inputArtifacts ?? {}
  for (const [name, content] of Object.entries(inputArtifacts)) {
    await writeFile(join(workDir, name), content, 'utf8')
    log('info', 'execute.input_artifact_written', { stageName, name, bytes: content.length })
  }

  const pi = spawn(PI_BIN, ['--mode', 'rpc', '--model', PI_MODEL], {
    cwd: workDir,
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  log('info', 'pi.spawned', { stageName, pid: pi.pid, model: PI_MODEL })

  const reader = new JsonlReader(pi.stdout)
  const stderrChunks = []
  pi.stderr.on('data', (c) => stderrChunks.push(c))

  // Log every pi stdout event for observability
  reader.on((msg) => {
    const type = msg.type
    if (type === 'agent_end' || type === 'agent_start' || type === 'turn_start' || type === 'turn_end') {
      log('info', `pi.event.${type}`, { stageName })
    } else if (type === 'response') {
      log('info', 'pi.response', { stageName, command: msg.command, success: msg.success, error: msg.error })
    } else if (type === 'extension_error') {
      log('warn', 'pi.extension_error', { stageName, ...msg })
    }
    // tool_call, message_start etc. not logged to avoid noise
  })

  pi.on('exit', (code, signal) => {
    log('info', 'pi.exit', { stageName, code, signal })
  })

  try {
    // pi emits no startup signal — wait a brief delay for the process to initialize
    await new Promise((resolve) => setTimeout(resolve, PI_INIT_DELAY_MS))

    if (pi.exitCode !== null) {
      const stderr = Buffer.concat(stderrChunks).toString('utf8').slice(0, 4000)
      throw new Error(`pi exited immediately (code ${pi.exitCode}): ${stderr}`)
    }

    const prompt = buildPrompt(input)
    log('info', 'pi.prompt_send', { stageName, promptBytes: prompt.length })

    // Register agent_end listener BEFORE writing to stdin to avoid race
    const agentEndPromise = waitForAgentEnd(reader, EXECUTE_TIMEOUT_MS)
    pi.stdin.write(JSON.stringify({ type: 'prompt', message: prompt }) + '\n')

    await agentEndPromise
    log('info', 'pi.agent_end_received', { stageName, elapsedMs: Date.now() - t0 })

    const declaredOutputs = input.declaredOutputs ?? []
    const artifactContents = {}
    const artifacts = []

    for (const name of declaredOutputs) {
      try {
        const content = await readFile(join(workDir, name), 'utf8')
        if (content.trim().length > 0) {
          artifactContents[name] = content
          artifacts.push(name)
          log('info', 'execute.artifact_read', { stageName, name, bytes: content.length })
        } else {
          log('warn', 'execute.artifact_empty', { stageName, name })
        }
      } catch (e) {
        log('warn', 'execute.artifact_missing', { stageName, name, error: e.message })
      }
    }

    pi.kill('SIGTERM')

    log('info', 'execute.complete', { stageName, artifacts, elapsedMs: Date.now() - t0 })
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ artifacts, artifactContents, message: `${stageName} complete` }))
  } catch (err) {
    pi.kill('SIGTERM')
    const stderr = Buffer.concat(stderrChunks).toString('utf8').slice(0, 4000)
    log('error', 'execute.failed', { stageName, error: err.message, stderr, elapsedMs: Date.now() - t0 })
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: err.message, stderr }))
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
