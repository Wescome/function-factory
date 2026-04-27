/**
 * T12: Tests for buildSandboxDeps() — real @cloudflare/sandbox wiring.
 *
 * Verifies that the SandboxDeps factory:
 * 1. execInSandbox calls sandbox.writeFile + sandbox.exec
 * 2. prepareWorkspace calls gitCheckout + exec (pnpm install)
 * 3. createBackup returns a backup ID
 * 4. restoreBackup calls sandbox.restoreBackup
 * 5. All with mocked @cloudflare/sandbox (dynamic import mock)
 *
 * The factory uses dynamic `import('@cloudflare/sandbox')` so it can be
 * loaded even when the package isn't fully wired into the wrangler env.
 * Tests mock the module via vi.mock().
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SandboxDeps } from './sandbox-role.js'

// ────────────────────────────────────────────────────────────
// Mock @cloudflare/sandbox
// ────────────────────────────────────────────────────────────

// vi.hoisted() runs before vi.mock hoisting — safe for factory references
const { mockSandbox, mockGetSandbox } = vi.hoisted(() => {
  const mockSandbox = {
    exec: vi.fn(),
    writeFile: vi.fn(),
    createBackup: vi.fn(),
    restoreBackup: vi.fn(),
    gitCheckout: vi.fn(),
  }
  const mockGetSandbox = vi.fn().mockReturnValue(mockSandbox)
  return { mockSandbox, mockGetSandbox }
})

// Mock the module — factory references hoisted mocks
vi.mock('@cloudflare/sandbox', () => ({
  getSandbox: mockGetSandbox,
}))

// ────────────────────────────────────────────────────────────
// Import the factory under test
// ────────────────────────────────────────────────────────────
import { buildSandboxDeps } from './sandbox-deps-factory.js'

// ────────────────────────────────────────────────────────────
// Fake env / binding
// ────────────────────────────────────────────────────────────

const fakeSandboxBinding = {} as unknown // DurableObjectNamespace stub

function makeDeps(): SandboxDeps {
  return buildSandboxDeps(fakeSandboxBinding, 'WG-test-001')
}

// ────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────

describe('T12: buildSandboxDeps() — real @cloudflare/sandbox wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Default mock return values
    mockSandbox.exec.mockResolvedValue({
      success: true,
      exitCode: 0,
      stdout: '{"ok":true}',
      stderr: '',
      command: 'node /factory/run-session.js',
      duration: 1500,
      timestamp: new Date().toISOString(),
    })
    mockSandbox.writeFile.mockResolvedValue({ success: true })
    mockSandbox.createBackup.mockResolvedValue({
      id: 'backup-abc-123',
      dir: '/workspace',
    })
    mockSandbox.restoreBackup.mockResolvedValue({
      success: true,
      dir: '/workspace',
      id: 'backup-abc-123',
    })
    mockSandbox.gitCheckout.mockResolvedValue({
      success: true,
      dir: '/workspace',
      branch: 'main',
      commitHash: 'abc123',
    })
  })

  // ── 1. execInSandbox ──────────────────────────────────────

  describe('execInSandbox', () => {
    it('calls getSandbox with the binding and a sandbox name derived from workGraphId', async () => {
      const deps = makeDeps()
      const taskJson = JSON.stringify({ role: 'coder', workGraphId: 'WG-test-001' })

      await deps.execInSandbox(taskJson)

      expect(mockGetSandbox).toHaveBeenCalledWith(
        fakeSandboxBinding,
        'synth-WG-test-001',
      )
    })

    it('writes task JSON to /factory/task.json via sandbox.writeFile', async () => {
      const deps = makeDeps()
      const taskJson = JSON.stringify({ role: 'coder', data: 'test' })

      await deps.execInSandbox(taskJson)

      expect(mockSandbox.writeFile).toHaveBeenCalledWith(
        '/factory/task.json',
        taskJson,
      )
    })

    it('executes run-session.js via sandbox.exec', async () => {
      const deps = makeDeps()
      const taskJson = JSON.stringify({ role: 'coder' })

      await deps.execInSandbox(taskJson)

      expect(mockSandbox.exec).toHaveBeenCalledWith(
        'node /factory/run-session.js < /factory/task.json',
      )
    })

    it('returns stdout from sandbox.exec on success', async () => {
      const expectedOutput = '{"ok":true,"role":"coder","filesChanged":[]}'
      mockSandbox.exec.mockResolvedValue({
        success: true,
        exitCode: 0,
        stdout: expectedOutput,
        stderr: '',
        command: 'node /factory/run-session.js',
        duration: 2000,
        timestamp: new Date().toISOString(),
      })

      const deps = makeDeps()
      const result = await deps.execInSandbox('{}')

      expect(result).toBe(expectedOutput)
    })

    it('throws with stderr when sandbox.exec fails (success: false)', async () => {
      mockSandbox.exec.mockResolvedValue({
        success: false,
        exitCode: 1,
        stdout: '',
        stderr: 'OOM killed',
        command: 'node /factory/run-session.js',
        duration: 500,
        timestamp: new Date().toISOString(),
      })

      const deps = makeDeps()

      await expect(deps.execInSandbox('{}')).rejects.toThrow(/Sandbox exec failed/)
      await expect(deps.execInSandbox('{}')).rejects.toThrow(/OOM killed/)
    })

    it('calls writeFile before exec (order matters)', async () => {
      const callOrder: string[] = []
      mockSandbox.writeFile.mockImplementation(async () => {
        callOrder.push('writeFile')
        return { success: true }
      })
      mockSandbox.exec.mockImplementation(async () => {
        callOrder.push('exec')
        return {
          success: true,
          exitCode: 0,
          stdout: '{}',
          stderr: '',
          command: '',
          duration: 0,
          timestamp: new Date().toISOString(),
        }
      })

      const deps = makeDeps()
      await deps.execInSandbox('{}')

      expect(callOrder).toEqual(['writeFile', 'exec'])
    })
  })

  // ── 2. prepareWorkspace ───────────────────────────────────

  describe('prepareWorkspace', () => {
    it('calls getSandbox with the binding and sandbox name', async () => {
      const deps = makeDeps()

      await deps.prepareWorkspace({
        repoUrl: 'https://github.com/org/repo.git',
        ref: 'abc123',
        branch: 'main',
      })

      expect(mockGetSandbox).toHaveBeenCalledWith(
        fakeSandboxBinding,
        'synth-WG-test-001',
      )
    })

    it('calls gitCheckout with repoUrl, branch, and depth 1', async () => {
      const deps = makeDeps()

      await deps.prepareWorkspace({
        repoUrl: 'https://github.com/org/repo.git',
        ref: 'abc123',
        branch: 'feature-x',
      })

      expect(mockSandbox.gitCheckout).toHaveBeenCalledWith(
        'https://github.com/org/repo.git',
        expect.objectContaining({
          branch: 'feature-x',
          targetDir: '/workspace',
          depth: 1,
        }),
      )
    })

    it('runs pnpm install --frozen-lockfile after git clone', async () => {
      const deps = makeDeps()

      await deps.prepareWorkspace({
        repoUrl: 'https://github.com/org/repo.git',
        ref: 'abc123',
        branch: 'main',
      })

      expect(mockSandbox.exec).toHaveBeenCalledWith(
        'cd /workspace && pnpm install --frozen-lockfile',
      )
    })

    it('calls gitCheckout before pnpm install (order matters)', async () => {
      const callOrder: string[] = []
      mockSandbox.gitCheckout.mockImplementation(async () => {
        callOrder.push('gitCheckout')
        return { success: true, dir: '/workspace', branch: 'main', commitHash: 'abc' }
      })
      mockSandbox.exec.mockImplementation(async () => {
        callOrder.push('exec')
        return {
          success: true, exitCode: 0, stdout: '', stderr: '',
          command: '', duration: 0, timestamp: new Date().toISOString(),
        }
      })

      const deps = makeDeps()
      await deps.prepareWorkspace({
        repoUrl: 'https://github.com/org/repo.git',
        ref: 'abc123',
        branch: 'main',
      })

      expect(callOrder).toEqual(['gitCheckout', 'exec'])
    })
  })

  // ── 3. createBackup ───────────────────────────────────────

  describe('createBackup', () => {
    it('calls getSandbox with the binding and sandbox name', async () => {
      const deps = makeDeps()

      await deps.createBackup('/workspace')

      expect(mockGetSandbox).toHaveBeenCalledWith(
        fakeSandboxBinding,
        'synth-WG-test-001',
      )
    })

    it('calls sandbox.createBackup with dir and ttl', async () => {
      const deps = makeDeps()

      await deps.createBackup('/workspace')

      expect(mockSandbox.createBackup).toHaveBeenCalledWith({
        dir: '/workspace',
        ttl: 86400,
      })
    })

    it('returns the backup ID string', async () => {
      mockSandbox.createBackup.mockResolvedValue({
        id: 'backup-xyz-789',
        dir: '/workspace',
      })

      const deps = makeDeps()
      const backupId = await deps.createBackup('/workspace')

      expect(backupId).toBe('backup-xyz-789')
    })

    it('passes the dir argument through to createBackup', async () => {
      const deps = makeDeps()

      await deps.createBackup('/home/custom')

      expect(mockSandbox.createBackup).toHaveBeenCalledWith({
        dir: '/home/custom',
        ttl: 86400,
      })
    })
  })

  // ── 4. restoreBackup ──────────────────────────────────────

  describe('restoreBackup', () => {
    it('calls getSandbox with the binding and sandbox name', async () => {
      const deps = makeDeps()

      await deps.restoreBackup('backup-abc-123')

      expect(mockGetSandbox).toHaveBeenCalledWith(
        fakeSandboxBinding,
        'synth-WG-test-001',
      )
    })

    it('calls sandbox.restoreBackup with the backup handle as id and /workspace as dir', async () => {
      const deps = makeDeps()

      await deps.restoreBackup('backup-abc-123')

      expect(mockSandbox.restoreBackup).toHaveBeenCalledWith({
        id: 'backup-abc-123',
        dir: '/workspace',
      })
    })

    it('does not throw when restoreBackup succeeds', async () => {
      const deps = makeDeps()

      await expect(deps.restoreBackup('backup-abc-123')).resolves.toBeUndefined()
    })

    it('propagates errors from sandbox.restoreBackup', async () => {
      mockSandbox.restoreBackup.mockRejectedValue(new Error('Backup expired'))

      const deps = makeDeps()

      await expect(deps.restoreBackup('backup-abc-123')).rejects.toThrow('Backup expired')
    })
  })

  // ── 5. All deps use the same sandbox name pattern ─────────

  describe('sandbox naming', () => {
    it('all deps produce sandbox name "synth-{workGraphId}"', async () => {
      const deps = buildSandboxDeps(fakeSandboxBinding, 'WG-custom-42')

      // Call each method
      await deps.execInSandbox('{}')
      await deps.prepareWorkspace({ repoUrl: '', ref: '', branch: '' })
      await deps.createBackup('/workspace')
      await deps.restoreBackup('x')

      // Every getSandbox call should use the same naming pattern
      const calls = mockGetSandbox.mock.calls
      expect(calls.length).toBe(4)
      for (const call of calls) {
        expect(call[0]).toBe(fakeSandboxBinding)
        expect(call[1]).toBe('synth-WG-custom-42')
      }
    })
  })

  // ── 6. Integration: factory returns SandboxDeps shape ─────

  describe('factory shape', () => {
    it('returns an object conforming to SandboxDeps interface', () => {
      const deps = makeDeps()

      expect(typeof deps.execInSandbox).toBe('function')
      expect(typeof deps.prepareWorkspace).toBe('function')
      expect(typeof deps.createBackup).toBe('function')
      expect(typeof deps.restoreBackup).toBe('function')
    })
  })
})
