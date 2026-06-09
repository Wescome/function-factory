import { describe, expect, it } from 'vitest'
import {
  UNKNOWN_PI_CONTAINER_BUILD_ID,
  isContainerAlreadyRunningError,
  resolveDesiredPiContainerBuildId,
  shouldRestartPiContainerForBuild,
} from './pi-container-version.js'

describe('pi container version coordination', () => {
  it('prefers Cloudflare Worker version metadata over explicit fallback ids', () => {
    expect(resolveDesiredPiContainerBuildId({
      CF_VERSION_METADATA: { id: 'worker-version-1', tag: 'prod' },
      PI_CONTAINER_BUILD_ID: 'local-build',
    })).toBe('worker-version-1')
  })

  it('falls back to local build id outside Cloudflare runtime', () => {
    expect(resolveDesiredPiContainerBuildId({
      PI_CONTAINER_BUILD_ID: 'local-build',
    })).toBe('local-build')
  })

  it('returns unknown when no runtime build identity exists', () => {
    expect(resolveDesiredPiContainerBuildId({})).toBe(UNKNOWN_PI_CONTAINER_BUILD_ID)
  })

  it('restarts a running container when the persisted build differs', () => {
    expect(shouldRestartPiContainerForBuild({
      running: true,
      startedBuildId: 'old-worker-version',
      desiredBuildId: 'new-worker-version',
    })).toBe(true)
  })

  it('restarts a running legacy container with no persisted build id', () => {
    expect(shouldRestartPiContainerForBuild({
      running: true,
      startedBuildId: null,
      desiredBuildId: 'new-worker-version',
    })).toBe(true)
  })

  it('does not restart stopped containers or unknown desired builds', () => {
    expect(shouldRestartPiContainerForBuild({
      running: false,
      startedBuildId: 'old-worker-version',
      desiredBuildId: 'new-worker-version',
    })).toBe(false)
    expect(shouldRestartPiContainerForBuild({
      running: true,
      startedBuildId: 'old-worker-version',
      desiredBuildId: UNKNOWN_PI_CONTAINER_BUILD_ID,
    })).toBe(false)
  })

  it('recognizes Cloudflare container already-running start races', () => {
    expect(isContainerAlreadyRunningError(
      new Error('start() cannot be called on a container that is already running.'),
    )).toBe(true)
    expect(isContainerAlreadyRunningError(new Error('container not listening'))).toBe(false)
  })
})
