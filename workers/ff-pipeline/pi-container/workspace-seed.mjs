import { mkdir, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

const SEED_ARTIFACT_NAME = 'SeedWorkspace'
const execFileAsync = promisify(execFile)

export function hasSeedWorkspace(input) {
  return typeof input?.context?.inputArtifacts?.[SEED_ARTIFACT_NAME] === 'string'
}

export async function prepareSeedWorkspace(workDir, seedContent) {
  const seed = parseSeedWorkspace(seedContent)
  const workspaceDir = join(workDir, 'workspace')
  await mkdir(workspaceDir, { recursive: true })

  for (const file of seed.files) {
    const target = join(workspaceDir, file.path)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, file.content, 'utf8')
  }

  await mkdir(join(workspaceDir, '.factory'), { recursive: true })
  await writeFile(
    join(workspaceDir, '.factory', 'seed-workspace.json'),
    JSON.stringify(seed, null, 2),
    'utf8',
  )
  await writeFile(
    join(workspaceDir, 'AGENTS.md'),
    [
      '# Seeded Coding Adapter Workspace',
      '',
      'Work only inside this directory.',
      'Produce unified diffs relative to this workspace root.',
      'Do not edit files outside ./workspace.',
      '',
    ].join('\n'),
    'utf8',
  )
  await initializeSeedWorkspaceGit(workspaceDir)

  return { seed, workspaceDir }
}

async function initializeSeedWorkspaceGit(workspaceDir) {
  await execFileAsync('git', ['-C', workspaceDir, 'init', '--quiet'])
  await execFileAsync('git', ['-C', workspaceDir, 'config', 'user.email', 'factory@example.invalid'])
  await execFileAsync('git', ['-C', workspaceDir, 'config', 'user.name', 'Function Factory'])
  await execFileAsync('git', ['-C', workspaceDir, 'add', '-A'])
  await execFileAsync('git', ['-C', workspaceDir, 'commit', '--quiet', '--no-gpg-sign', '-m', 'seed workspace'])
}

export function workspacePromptSection(prepared) {
  const lines = [
    '## Seeded Workspace',
    '',
    'A repository fixture has been prepared at `./workspace` in the current working directory.',
    'Inspect and operate on files relative to `./workspace`.',
    'The runtime provides POSIX shell, Node.js, npm, and git. Python is not installed.',
  ]
  if (prepared.seed.issue) {
    lines.push('', `Issue: ${prepared.seed.issue}`)
  }
  if (prepared.seed.acceptance?.length > 0) {
    lines.push('', 'Acceptance:')
    for (const item of prepared.seed.acceptance) lines.push(`- ${item}`)
  }
  if (prepared.seed.testCommand) {
    lines.push('', `Test command: \`${prepared.seed.testCommand}\``)
  }
  lines.push(
    '',
    'For patch outputs, edit files from inside `./workspace`, then write the unified diff to the required root artifact such as `./CandidatePatch`.',
    'Use paths like `a/src/file.ts` and `b/src/file.ts` in diff headers.',
    'The seeded workspace is a git repo with a clean baseline, so `cd workspace && git add -A && git diff --cached > ../CandidatePatch` is the preferred patch artifact path.',
    'For verification outputs, copy `./workspace` to a temporary directory, run `git apply ../CandidatePatch` from that copy, then run the declared test command.',
  )
  return lines.join('\n')
}

export function parseSeedWorkspace(content) {
  let parsed
  try {
    parsed = JSON.parse(content)
  } catch (err) {
    throw new Error(`invalid SeedWorkspace JSON: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('SeedWorkspace must be a JSON object')
  }
  if (parsed.schemaVersion !== '1.0') {
    throw new Error('SeedWorkspace schemaVersion must be 1.0')
  }
  if (!Array.isArray(parsed.files)) {
    throw new Error('SeedWorkspace files must be an array')
  }
  const files = []
  for (const file of parsed.files) {
    if (!file || typeof file !== 'object' || Array.isArray(file)) {
      throw new Error('SeedWorkspace file entries must be objects')
    }
    if (typeof file.path !== 'string' || typeof file.content !== 'string') {
      throw new Error('SeedWorkspace file entries require string path and content')
    }
    assertSafeRelativePath(file.path)
    files.push({ path: file.path, content: file.content })
  }
  return {
    schemaVersion: '1.0',
    ...(typeof parsed.issue === 'string' ? { issue: parsed.issue } : {}),
    ...(Array.isArray(parsed.acceptance)
      ? { acceptance: parsed.acceptance.filter((item) => typeof item === 'string') }
      : {}),
    ...(typeof parsed.testCommand === 'string' ? { testCommand: parsed.testCommand } : {}),
    files,
  }
}

function assertSafeRelativePath(path) {
  if (
    path.length === 0 ||
    path.startsWith('/') ||
    path.includes('\0') ||
    path.split('/').some((part) => part === '..')
  ) {
    throw new Error(`unsafe seed workspace path: ${path}`)
  }
}
