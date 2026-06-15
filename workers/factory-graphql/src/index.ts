import { createYoga, createSchema } from 'graphql-yoga'
import { typeDefs } from './schema.js'
import { sessionResolvers } from './resolvers/session.js'
import { artifactResolvers } from './resolvers/artifact.js'
import { beadResolvers } from './resolvers/beads.js'
import { CoordinatorDataSource } from './data-sources/coordinator.js'
import { ArtifactGraphDataSource } from './data-sources/artifact-graph.js'
import { D1DataSource } from './data-sources/d1.js'
import type { Env } from './env.js'
import type { GqlContext } from './context.js'

/**
 * ServerContext — CF Worker bindings passed into yoga.fetch().
 * These are available inside resolver context via the merged type.
 */
type ServerContext = { env: Env; executionCtx: ExecutionContext }

/**
 * Full resolver context = ServerContext merged with GqlContext (data sources).
 * createYoga's `context` factory receives ServerContext and returns GqlContext;
 * yoga merges them, so resolvers see ServerContext & GqlContext.
 *
 * createSchema must be typed with the fully merged type so TS is satisfied.
 */
type MergedContext = ServerContext & GqlContext

const schema = createSchema<MergedContext>({
  typeDefs,
  resolvers: {
    Query: {
      ...sessionResolvers.Query,
      ...artifactResolvers.Query,
      ...beadResolvers.Query,
    },
    FactorySession: sessionResolvers.FactorySession,
    FactoryArtifact: artifactResolvers.FactoryArtifact,
    LineageEdge:     artifactResolvers.LineageEdge,
    ExecutionBead:   beadResolvers.ExecutionBead,
    Amendment:       beadResolvers.Amendment,

    // Subscription stubs — Phase 4 (ADR-0016) wires the real resolvers.
    Subscription: {
      sessionEvents: {
        subscribe: async function* () { yield null },
        resolve: () => null,
      },
      artifactWrites: {
        subscribe: async function* () { yield null },
        resolve: () => null,
      },
      beadUpdates: {
        subscribe: async function* () { yield null },
        resolve: () => null,
      },
    },
  },
})

const yoga = createYoga<ServerContext, GqlContext>({
  schema,
  graphqlEndpoint: '/graphql',
  context: (serverCtx): GqlContext => {
    const env = serverCtx.env
    return {
      env,
      coordinator: new CoordinatorDataSource(env.COORDINATOR_DO),
      artifactGraph: new ArtifactGraphDataSource(env.ARTIFACT_GRAPH),
      d1: new D1DataSource(env.DB, env.FACTORY_OPS_DB),
    }
  },
})

export default {
  async fetch(request: Request, env: Env, executionCtx: ExecutionContext): Promise<Response> {
    return yoga.fetch(request, { env, executionCtx })
  },
}
