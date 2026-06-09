/**
 * Phase 5 sandbox preflight.
 *
 * These tests guard the deploy-time wiring that unit mocks cannot exercise:
 * wrangler bindings, container declaration, queue bridge bindings, and the
 * installed @cloudflare/sandbox backup API shape.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const wranglerConfig = readFileSync(new URL('../../wrangler.jsonc', import.meta.url), 'utf8')
const sandboxDistUrl = new URL('../../node_modules/@cloudflare/sandbox/dist/', import.meta.url)
const sandboxTypesFile = readdirSync(sandboxDistUrl)
  .find((entry) => /^sandbox-.*\.d\.ts$/.test(entry))
if (!sandboxTypesFile) throw new Error('expected @cloudflare/sandbox dist to include sandbox-*.d.ts')
const sandboxTypes = readFileSync(new URL(sandboxTypesFile, sandboxDistUrl), 'utf8')

describe('Phase 5 sandbox preflight', () => {
  it('declares the Sandbox durable object binding and migration', () => {
    expect(wranglerConfig).toMatch(/"name":\s*"SANDBOX"/)
    expect(wranglerConfig).toMatch(/"class_name":\s*"Sandbox"/)
    expect(wranglerConfig).toMatch(/"new_sqlite_classes":\s*\[\s*"Sandbox"\s*\]/)
  })

  it('exports Sandbox from @cloudflare/sandbox through the worker entrypoint', async () => {
    const entrypoint = readFileSync(new URL('../index.ts', import.meta.url), 'utf8')
    expect(entrypoint).toMatch(/export\s+\{\s*Sandbox\s*\}\s+from\s+['"]@cloudflare\/sandbox['"]/)
  })

  it('declares the sandbox container image and workspace backup bucket', () => {
    expect(wranglerConfig).toMatch(/"containers":\s*\[[\s\S]*"Sandbox"[\s\S]*"image":\s*"\.\/Dockerfile"/)
    expect(wranglerConfig).toMatch(/"binding":\s*"WORKSPACE_BUCKET"/)
    expect(wranglerConfig).toMatch(/"bucket_name":\s*"ff-workspaces"/)
  })

  it('binds Worker version metadata for singleton container rollout coordination', () => {
    expect(wranglerConfig).toMatch(/"version_metadata":\s*\{\s*"binding":\s*"CF_VERSION_METADATA"\s*\}/)
  })

  it('declares the Agent Call execution queue bridge bindings', () => {
    for (const binding of ['SYNTHESIS_QUEUE', 'SYNTHESIS_RESULTS', 'ATOM_RESULTS']) {
      expect(wranglerConfig).toContain(`"binding": "${binding}"`)
    }
    for (const queue of ['synthesis-queue', 'synthesis-results', 'atom-results']) {
      expect(wranglerConfig).toContain(`"queue": "${queue}"`)
    }
  })

  it('matches the installed @cloudflare/sandbox backup handle contract', () => {
    expect(sandboxTypes).toMatch(/createBackup\(options:\s*BackupOptions\):\s*Promise<DirectoryBackup>/)
    expect(sandboxTypes).toMatch(/restoreBackup\(backup:\s*DirectoryBackup\):\s*Promise<RestoreBackupResult>/)
    expect(sandboxTypes).toMatch(/interface\s+DirectoryBackup\s*\{[\s\S]*readonly id:\s*string;[\s\S]*readonly dir:\s*string;/)
  })
})
