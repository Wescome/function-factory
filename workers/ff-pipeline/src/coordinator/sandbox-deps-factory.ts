/**
 * T12: buildSandboxDeps() — real @cloudflare/sandbox wiring.
 *
 * Creates SandboxDeps backed by the actual @cloudflare/sandbox SDK.
 * Uses `getSandbox()` to obtain a sandbox instance from the DurableObject
 * namespace binding, then delegates to the SDK's exec, writeFile,
 * createBackup, restoreBackup, and gitCheckout methods.
 *
 * The factory is a standalone function (not a class method) so it can be
 * tested in isolation with mocked @cloudflare/sandbox — the Sandbox DO
 * cannot be instantiated in vitest.
 */

import type { SandboxDeps } from './sandbox-role.js'

/**
 * Build real SandboxDeps wired to @cloudflare/sandbox.
 *
 * Uses dynamic `import('@cloudflare/sandbox')` so the module is only loaded
 * at call time, not at module parse time. This prevents import failures in
 * environments where @cloudflare/containers (a transitive dep) is not fully
 * available (e.g., vitest without the Cloudflare runtime).
 *
 * @param sandboxBinding - The DurableObjectNamespace binding for the Sandbox DO
 *                         (env.SANDBOX from wrangler config)
 * @param workGraphId    - Current WorkGraph ID, used to derive the sandbox name
 * @returns SandboxDeps conforming to the interface in sandbox-role.ts
 */
export function buildSandboxDeps(
  sandboxBinding: unknown,
  workGraphId: string,
): SandboxDeps {
  const sandboxName = `synth-${workGraphId}`

  // Helper: lazily obtain a sandbox instance via dynamic import.
  // getSandbox returns a typed DO stub backed by the DurableObject namespace.
  const sb = async () => {
    const { getSandbox } = await import('@cloudflare/sandbox')
    return getSandbox(sandboxBinding as any, sandboxName)
  }

  return {
    execInSandbox: async (taskJson: string): Promise<string> => {
      const sandbox = await sb()
      // Write the task payload into the sandbox filesystem
      await sandbox.writeFile('/factory/task.json', taskJson)
      // Execute run-session.js, piping the task file as stdin
      const result = await sandbox.exec(
        'node /factory/run-session.js < /factory/task.json',
      )
      if (!result.success) {
        throw new Error(`Sandbox exec failed: ${result.stderr}`)
      }
      return result.stdout
    },

    prepareWorkspace: async (config: {
      repoUrl: string
      ref: string
      branch: string
    }): Promise<void> => {
      const sandbox = await sb()
      // Use the SDK's gitCheckout for efficient shallow clone
      await sandbox.gitCheckout(config.repoUrl, {
        branch: config.branch,
        targetDir: '/workspace',
        depth: 1,
      })
      // Install dependencies with frozen lockfile for reproducibility
      await sandbox.exec('cd /workspace && pnpm install --frozen-lockfile')
    },

    createBackup: async (dir: string): Promise<string> => {
      const sandbox = await sb()
      const backup = await sandbox.createBackup({ dir, ttl: 86400 })
      return backup.id
    },

    restoreBackup: async (handle: string): Promise<void> => {
      const sandbox = await sb()
      await sandbox.restoreBackup({ id: handle, dir: '/workspace' })
    },
  }
}
