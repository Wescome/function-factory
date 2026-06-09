import type { SpecContext } from './index.js';
import { SpecUnavailableError } from './index.js';

/**
 * Write spec artifacts into a Flue harness virtual sandbox before any session
 * is opened. This is the I2 enforcement point: spec content is in the VFS
 * before the agent can act.
 *
 * Call pattern (in every Factory workflow):
 *
 *   const harness = await init(agent);
 *   await injectSpecIntoHarness(harness, specContext, executionId);
 *   // Only now open a session:
 *   const session = await harness.session();
 *
 * harness type is intentionally `any` here — Flue's Harness type is not yet
 * exported as a stable public interface. Narrow when Flue stabilizes the API.
 */
export async function injectSpecIntoHarness(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  harness: any,
  specContext: SpecContext | null,
  executionId: string,
): Promise<void> {
  // I4: fail-closed — throw before session() can be called
  if (!specContext || specContext.files.length === 0) {
    throw new SpecUnavailableError(executionId, 'specContext is null or empty');
  }

  for (const file of specContext.files) {
    // harness.fs.writeFile writes into the just-bash virtual sandbox VFS.
    // Path must be absolute; /spec/ prefix is enforced by SpecFileSchema.
    await harness.fs.writeFile(file.virtualPath, file.content);
  }
}
