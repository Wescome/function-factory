import { resolveAndCall } from '@factory/task-routing'
import type { TaskKind } from '@factory/task-routing'
import { callProvider } from './providers'
import type { PipelineEnv } from './types'

export async function callModel(
  taskKind: string,
  system: string,
  user: string,
  env: PipelineEnv,
): Promise<string> {
  return resolveAndCall(
    taskKind as TaskKind,
    async (target) => callProvider(target, system, user, env),
  )
}
