// DO class exports for ff-pipeline worker.
// Flue's _entry.ts spreads this default export into the final worker export,
// so scheduled + queue handlers are preserved alongside Flue's fetch wrapper.

export { Sandbox }               from '@cloudflare/sandbox';
export { CoordinatorDO }         from '@factory/gears';
export { FactoryArtifactGraphDO, FactoryBeadGraphDO } from '@factory/factory-graph';

// Re-export existing ff-pipeline DO classes so they remain registered
// @ts-ignore — bundler resolves; not a workspace package dep
export { SynthesisCoordinator, AtomExecutor, RunCoordinator, PiContainer, FactoryPipeline }
  from '../workers/ff-pipeline/src/index.js';

// Preserve ff-pipeline's scheduled (governor cron) and queue (synthesis/feedback) handlers.
// Flue spreads this default into the worker export; fetch is excluded (Flue owns it).
// @ts-ignore
import ffPipeline from '../workers/ff-pipeline/src/index.js';

export default {
  scheduled: (ffPipeline as { scheduled: unknown }).scheduled,
  queue:     (ffPipeline as { queue:     unknown }).queue,
};
