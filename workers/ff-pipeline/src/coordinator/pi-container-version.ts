export const UNKNOWN_PI_CONTAINER_BUILD_ID = 'unknown'

export interface PiWorkerVersionMetadata {
  id?: string
  tag?: string
  timestamp?: string
}

export interface PiContainerVersionEnv {
  CF_VERSION_METADATA?: PiWorkerVersionMetadata
  PI_CONTAINER_BUILD_ID?: string
}

export function resolveDesiredPiContainerBuildId(env: PiContainerVersionEnv): string {
  const metadataId = env.CF_VERSION_METADATA?.id?.trim()
  if (metadataId) return metadataId

  const explicitBuildId = env.PI_CONTAINER_BUILD_ID?.trim()
  if (explicitBuildId) return explicitBuildId

  return UNKNOWN_PI_CONTAINER_BUILD_ID
}

export function shouldRestartPiContainerForBuild(args: {
  running: boolean
  startedBuildId?: string | null
  desiredBuildId: string
}): boolean {
  if (!args.running) return false
  if (args.desiredBuildId === UNKNOWN_PI_CONTAINER_BUILD_ID) return false
  return args.startedBuildId !== args.desiredBuildId
}

export function isContainerAlreadyRunningError(err: unknown): boolean {
  return err instanceof Error && err.message.includes("already running")
}
