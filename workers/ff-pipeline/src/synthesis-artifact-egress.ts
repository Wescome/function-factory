export type SynthesisFileAction = 'create' | 'modify' | 'delete'

export interface SynthesisCodeFile {
  atomId: string
  path: string
  action: SynthesisFileAction
  content?: string
}

export class SynthesisArtifactEgressError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SynthesisArtifactEgressError'
  }
}

const VALID_ACTIONS = new Set<SynthesisFileAction>(['create', 'modify', 'delete'])

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    throw new SynthesisArtifactEgressError(message)
  }
  return value as Record<string, unknown>
}

function validatePath(path: string): string {
  const trimmed = path.trim()
  if (trimmed.length === 0) {
    throw new SynthesisArtifactEgressError('Synthesized file path is required')
  }
  if (trimmed.startsWith('/') || /^[A-Za-z]:[\\/]/.test(trimmed)) {
    throw new SynthesisArtifactEgressError(`Synthesized file path must be repo-relative: ${trimmed}`)
  }
  if (trimmed.includes('\\')) {
    throw new SynthesisArtifactEgressError(`Synthesized file path must use POSIX separators: ${trimmed}`)
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    throw new SynthesisArtifactEgressError(`Synthesized file path must not be a URL: ${trimmed}`)
  }

  const parts = trimmed.split('/')
  if (parts.includes('..')) {
    throw new SynthesisArtifactEgressError(`Synthesized file path must not contain parent directory traversal: ${trimmed}`)
  }
  if (parts.includes('.git')) {
    throw new SynthesisArtifactEgressError(`Synthesized file path must not target .git: ${trimmed}`)
  }
  if (parts.includes('node_modules')) {
    throw new SynthesisArtifactEgressError(`Synthesized file path must not target node_modules: ${trimmed}`)
  }
  if (parts.some(part => part === '.env' || part.startsWith('.env.'))) {
    throw new SynthesisArtifactEgressError(`Synthesized file path must not target env files: ${trimmed}`)
  }
  if (parts.some(part => /secret/i.test(part))) {
    throw new SynthesisArtifactEgressError(`Synthesized file path must not target secret-like paths: ${trimmed}`)
  }

  return trimmed
}

export function validateSynthesisCodeFile(file: unknown, atomId: string): SynthesisCodeFile {
  const record = asRecord(file, 'Synthesized code file must be an object')

  if (typeof record.path !== 'string') {
    throw new SynthesisArtifactEgressError('Synthesized code file path must be a string')
  }
  const path = validatePath(record.path)

  if (typeof record.action !== 'string' || !VALID_ACTIONS.has(record.action as SynthesisFileAction)) {
    throw new SynthesisArtifactEgressError(`Synthesized code file action is invalid for ${path}`)
  }
  const action = record.action as SynthesisFileAction

  if ((action === 'create' || action === 'modify') && typeof record.content !== 'string') {
    throw new SynthesisArtifactEgressError(`Synthesized code file content is required for ${action}: ${path}`)
  }

  return {
    atomId,
    path,
    action,
    ...(typeof record.content === 'string' ? { content: record.content } : {}),
  }
}

export function extractSynthesisCodeFiles(pipelineResult: unknown): SynthesisCodeFile[] {
  const root = asRecord(pipelineResult, 'Pipeline result must be an object')
  const output = asRecord(root.output, 'Pipeline result output must be an object')
  const atomResults = asRecord(output.atomResults, 'Pipeline result output.atomResults must be an object')

  const files: SynthesisCodeFile[] = []
  const atomIds = Object.keys(atomResults).sort()

  for (const atomId of atomIds) {
    const atomResult = asRecord(atomResults[atomId], `Atom result must be an object: ${atomId}`)
    const codeArtifact = asRecord(atomResult.codeArtifact, `Atom result codeArtifact must be an object: ${atomId}`)
    const rawFiles = codeArtifact.files
    if (!Array.isArray(rawFiles)) {
      throw new SynthesisArtifactEgressError(`Atom result codeArtifact.files must be an array: ${atomId}`)
    }
    for (const file of rawFiles) {
      files.push(validateSynthesisCodeFile(file, atomId))
    }
  }

  return files
}
