import { getSandbox } from '@cloudflare/sandbox';

/**
 * Gas City tier: CF Container sandbox.
 * Use for Executions that require compilation, test runs, or
 * anything needing a real Linux environment.
 *
 * `env.Sandbox` is the DO binding defined in wrangler.toml.
 * `instanceId` scopes the container to one Factory Execution.
 */
export function gasCity(sandboxBinding: unknown, instanceId: string) {
  return getSandbox(sandboxBinding, instanceId);
}
