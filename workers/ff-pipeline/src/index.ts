export { FactoryPipeline } from './pipeline'
export { SynthesisCoordinator } from './coordinator'

export { ingestSignal } from './stages/ingest-signal'
export { synthesizePressure } from './stages/synthesize-pressure'
export { mapCapability } from './stages/map-capability'
export { proposeFunction } from './stages/propose-function'
export { semanticReview } from './stages/semantic-review'
export { compilePRD, PASS_NAMES } from './stages/compile'

export { callModel } from './model-bridge'

export type {
  PipelineEnv,
  PipelineParams,
  PipelineResult,
  SignalInput,
  Gate1Report,
  SemanticReviewResult,
} from './types'

export { FactoryPipeline as default } from './pipeline'
