import { resolveAndCall } from '@factory/task-routing'
import type { TaskKind } from '@factory/task-routing'
import { callProvider } from '../providers'
import type { ProviderEnv } from '../providers'

export type { ProviderEnv as ModelBridgeEnv }

export function createModelBridge(env: ProviderEnv) {
  return async function callModel(
    taskKind: string,
    system: string,
    user: string,
  ): Promise<string> {
    return resolveAndCall(
      taskKind as TaskKind,
      async (target) => callProvider(target, system, user, env),
    )
  }
}
