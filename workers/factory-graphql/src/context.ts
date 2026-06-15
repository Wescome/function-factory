import type { Env } from './env.js'
import type { CoordinatorDataSource } from './data-sources/coordinator.js'
import type { ArtifactGraphDataSource } from './data-sources/artifact-graph.js'
import type { D1DataSource } from './data-sources/d1.js'

export interface GqlContext {
  env: Env
  coordinator: CoordinatorDataSource
  artifactGraph: ArtifactGraphDataSource
  d1: D1DataSource
}
