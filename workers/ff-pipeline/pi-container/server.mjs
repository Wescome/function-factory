/**
 * pi-container/server.mjs
 *
 * HTTP server that wraps pi in RPC mode for NLAH harness stage execution.
 *
 * POST /execute  — accepts WorkerInput JSON, runs pi, returns ContainerExecuteResponse
 * GET  /health   — liveness probe
 *
 * Protocol:
 *   1. Spawn `pi --mode rpc` in a fresh temp workdir.
 *   2. Wait for initial {type:"state",state:"idle"} (pi ready).
 *   3. Send {type:"message",text:<prompt>} to stdin.
 *   4. Wait for next {type:"state",state:"idle"} (pi done).
 *   5. Read each declaredOutput file from workdir.
 *   6. Return {artifacts, artifactContents, message}.
 *
 * Cannot use Node readline — it splits on U+2028/U+2029 which breaks JSONL.
 * Uses a manual byte-buffer reader instead (LF-only delimiter per pi docs).
 *
 * Environment vars required at runtime:
 *   ANTHROPIC_API_KEY — or whichever key pi is configured to use
 */

import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = Number(process.env.PORT ?? 8080)
const PI_BIN = join(dirname(fileURLToPath(import.meta.url)), 'node_modules', '.bin', 'pi')

// Idle timeout for the initial pi startup (ms)
const STARTUP_TIMEOUT_MS = 30_000
// Idle timeout while pi is executing a stage (ms) — generous for complex tasks
const EXECUTE_TIMEOUT_MS = 300_000

// ── JSONL byte-buffer reader ──────────────────────────────────────────────────
// Node readline cannot be used: it splits on U+2028/U+2029 in addition to \n,
// which corrupts pi's JSONL framing. This reader splits on 0x0a only.

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

  /** Register a handler; returns an unsubscribe function. */
  on(fn) {
    this._handlers.push(fn)
    return () => { this._handlers = this._handlers.filter((h) => h !== fn) }
  }
}

// ── Wait for pi state:idle ────────────────────────────────────────────────────

function waitForIdle(reader, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off()
      reject(new Error(`pi timed out after ${timeoutMs}ms waiting for state:idle`))
    }, timeoutMs)
    const off = reader.on((msg) => {
      if (msg.type === 'state' && msg.state === 'idle') {
        clearTimeout(timer)
        off()
        resolve()
      }
    })
  })
}

// ── Prompt builder ────────────────────────────────────────────────────────────

function buildPrompt(input) {
  const { stageName, roleName, rolePrompt, context = {}, declaredOutputs = [] } = input
  const { taskText = '', inputArtifacts = {} } = context

  const parts = []

  parts.push(
    `You are ${roleName}${rolePrompt ? `: ${rolePrompt}` : '.'}`,
  )

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

  const workDir = await mkdtemp(join(tmpdir(), `pi-${input.stageName ?? 'stage'}-`))

  // Write input artifacts to workdir so pi can read them as local files if needed
  const inputArtifacts = input.context?.inputArtifacts ?? {}
  for (const [name, content] of Object.entries(inputArtifacts)) {
    await writeFile(join(workDir, name), content, 'utf8')
  }

  const pi = spawn(PI_BIN, ['--mode', 'rpc'], {
    cwd: workDir,
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  const reader = new JsonlReader(pi.stdout)
  const stderrChunks = []
  pi.stderr.on('data', (c) => stderrChunks.push(c))

  try {
    await waitForIdle(reader, STARTUP_TIMEOUT_MS)

    const prompt = buildPrompt(input)
    pi.stdin.write(JSON.stringify({ type: 'message', text: prompt }) + '\n')

    await waitForIdle(reader, EXECUTE_TIMEOUT_MS)

    const declaredOutputs = input.declaredOutputs ?? []
    const artifactContents = {}
    const artifacts = []

    for (const name of declaredOutputs) {
      try {
        const content = await readFile(join(workDir, name), 'utf8')
        if (content.trim().length > 0) {
          artifactContents[name] = content
          artifacts.push(name)
        }
      } catch {
        // File absent — gate on Worker side will handle missing artifact
      }
    }

    pi.kill('SIGTERM')

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      artifacts,
      artifactContents,
      message: `${input.stageName ?? 'stage'} complete`,
    }))
  } catch (err) {
    pi.kill('SIGTERM')
    const stderr = Buffer.concat(stderrChunks).toString('utf8').slice(0, 2000)
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
      res.writeHead(200)
      res.end('ok')
    } else {
      res.writeHead(404)
      res.end('not found')
    }
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: String(err) }))
    }
  }
})

server.listen(PORT, () => {
  console.log(`pi-container listening on :${PORT}`)
})
