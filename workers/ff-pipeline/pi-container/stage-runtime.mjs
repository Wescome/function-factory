import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const MAX_STAGE_LOG_TAIL_BYTES = 16_384

export function redact(value) {
  return String(value)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/(OPENROUTER_API_KEY|OFOX_API_KEY)\s*[:=]\s*[^\s,}]+/gi, '$1=[REDACTED]')
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-[REDACTED]')
    .replace(/api[_-]?key=([^&\s]+)/gi, 'api_key=[REDACTED]')
    .replace(/authorization["']?\s*:\s*["'][^"']+["']/gi, 'authorization:"[REDACTED]"')
}

export function createStageLogCollector(maxBytes = MAX_STAGE_LOG_TAIL_BYTES) {
  let buffer = ''

  return {
    append(value) {
      buffer += redact(value)
      while (Buffer.byteLength(buffer, 'utf8') > maxBytes && buffer.length > 0) {
        const excess = Buffer.byteLength(buffer, 'utf8') - maxBytes
        buffer = buffer.slice(Math.max(1, excess))
      }
    },
    tail() {
      return buffer
    },
    bytes() {
      return Buffer.byteLength(buffer, 'utf8')
    },
  }
}

export function stageLogKey(runId, stageName) {
  return `${String(runId)}:${String(stageName)}`
}

export function createStageLogStore({ maxEntries = 128 } = {}) {
  const logs = new Map()

  return {
    set(runId, stageName, value) {
      logs.set(stageLogKey(runId, stageName), String(value ?? ''))
      while (logs.size > maxEntries) {
        const oldest = logs.keys().next().value
        if (oldest === undefined) break
        logs.delete(oldest)
      }
    },
    consume(runId, stageName) {
      const key = stageLogKey(runId, stageName)
      const value = logs.get(key) ?? ''
      logs.delete(key)
      return value
    },
    size() {
      return logs.size
    },
  }
}

export function resolvePiSessionDir(workDir) {
  return join(workDir, '.pi-sessions')
}

export function resolvePiHomeDir(workDir) {
  return join(workDir, '.pi-home')
}

export async function writePiAgentAuthConfig(
  homeDir,
  {
    baseUrl = 'https://api.ofox.ai/v1',
    apiKeyEnv = 'OFOX_API_KEY',
  } = {},
) {
  const agentDir = join(homeDir, '.pi', 'agent')
  await mkdir(agentDir, { recursive: true, mode: 0o700 })
  await writeFile(
    join(agentDir, 'auth.json'),
    JSON.stringify({
      openrouter: { type: 'api_key', key: apiKeyEnv },
    }, null, 2),
    { encoding: 'utf8', mode: 0o600 },
  )
  await writeFile(
    join(agentDir, 'models.json'),
    JSON.stringify({
      providers: {
        openrouter: {
          baseUrl,
          api: 'openai-completions',
          apiKey: apiKeyEnv,
          authHeader: true,
        },
      },
    }, null, 2),
    { encoding: 'utf8', mode: 0o600 },
  )
  return {
    agentDir,
    authPath: join(agentDir, 'auth.json'),
    modelsPath: join(agentDir, 'models.json'),
  }
}

export function sessionArchiveCandidates(workDir, sessionDir = resolvePiSessionDir(workDir)) {
  return [
    { dir: sessionDir, kind: 'pi-session' },
    { dir: join(workDir, '.pi', 'sessions'), kind: 'pi-session-legacy' },
    { dir: workDir, kind: 'workspace' },
  ]
}

export async function cleanupWorkDir(workDir) {
  try {
    await rm(workDir, { recursive: true, force: true })
    return { removed: true }
  } catch (err) {
    return {
      removed: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
