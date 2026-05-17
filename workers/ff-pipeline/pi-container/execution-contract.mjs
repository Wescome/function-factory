import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export function buildPrompt(input) {
  const { roleName, rolePrompt, context = {}, declaredOutputs = [] } = input
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
      '## Required Output Files\n\n' +
      'You must create each required output as a non-empty local file in the current working directory. ' +
      'A final chat response is not an artifact. Do not finish until every file below exists and is non-empty.\n\n' +
      declaredOutputs.map((name) => `- Artifact \`${name}\`: write local file \`./${name}\``).join('\n') +
      '\n\nUse your filesystem tools or shell commands to create the files. ' +
      'The file name must match the artifact name exactly.',
    )
  }

  return parts.join('\n\n')
}

export function buildRepairPrompt(missingOutputs) {
  return [
    'The previous turn ended before all required output files existed.',
    '',
    'Create or repair the following local files in the current working directory now:',
    '',
    ...missingOutputs.map((name) => `- \`./${name}\``),
    '',
    'Each file must be non-empty. Do not summarize the work instead of writing the files.',
    'After the files are written, finish normally.',
  ].join('\n')
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

export function deriveExactLineContent(input, artifactName) {
  const taskText = String(input.context?.taskText ?? '')
  const escaped = artifactName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const patterns = [
    new RegExp(`file\\s+named\\s+${escaped}\\s+containing\\s+exactly\\s+the\\s+line\\s+([^.,;\\n]+)`, 'i'),
    new RegExp(`${escaped}\\s+containing\\s+exactly\\s+the\\s+line\\s+([^.,;\\n]+)`, 'i'),
  ]
  for (const pattern of patterns) {
    const match = taskText.match(pattern)
    const line = match?.[1]?.trim()
    if (line) return line
  }
  return undefined
}

export function buildMaterializeCommands(input, missingOutputs) {
  const commands = []
  for (const name of missingOutputs) {
    if (!/^[A-Za-z0-9._-]+$/.test(name)) continue
    const content = deriveExactLineContent(input, name)
    if (!content) continue
    commands.push({
      artifact: name,
      command: `printf '%s\\n' ${shellQuote(content)} > ${shellQuote(name)}`,
    })
  }
  return commands
}

export async function readDeclaredArtifacts({
  workDir,
  declaredOutputs,
  observation,
  log,
  redact = String,
  attempt,
}) {
  const artifactContents = {}
  const artifacts = []
  const missing = []

  for (const name of declaredOutputs) {
    try {
      const content = await readFile(join(workDir, name), 'utf8')
      if (content.trim().length > 0) {
        artifactContents[name] = content
        artifacts.push(name)
        log?.('info', 'execute.artifact_read', { name, bytes: content.length, attempt })
        observation?.artifacts?.push({ name, status: 'read', bytes: content.length, attempt })
      } else {
        missing.push(name)
        log?.('warn', 'execute.artifact_empty', { name, attempt })
        observation?.artifacts?.push({ name, status: 'empty', attempt })
      }
    } catch (e) {
      missing.push(name)
      const message = e instanceof Error ? e.message : String(e)
      log?.('warn', 'execute.artifact_missing', { name, error: message, attempt })
      observation?.artifacts?.push({ name, status: 'missing', error: redact(message), attempt })
    }
  }

  return { artifacts, artifactContents, missing }
}
