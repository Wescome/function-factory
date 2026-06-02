import { describe, expect, it } from 'vitest'
import {
  AUTHORING_MODES,
  PI_DEFAULT_TOOL_NAMES,
  authoringModeForInput,
  executionPolicyObservation,
  shouldSkipPromptAfterPreflight,
  shouldMaterializeContracts,
} from './execution-policy.mjs'

describe('pi execution policy', () => {
  it('materializes simple contracts by default', () => {
    expect(authoringModeForInput({})).toBe(AUTHORING_MODES.contractMaterialized)
    expect(shouldMaterializeContracts({})).toBe(true)
  })

  it('disables deterministic materialization for autonomous filesystem authoring', () => {
    const input = {
      execution: {
        authoringMode: AUTHORING_MODES.autonomousFilesystem,
        requiredCapabilities: ['filesystem_tools'],
      },
    }

    expect(authoringModeForInput(input)).toBe(AUTHORING_MODES.autonomousFilesystem)
    expect(shouldMaterializeContracts(input)).toBe(false)
  })

  it('records expected Pi tool inventory for filesystem-authoring dispatches', () => {
    expect(executionPolicyObservation({
      execution: {
        authoringMode: AUTHORING_MODES.autonomousFilesystem,
        requiredCapabilities: ['filesystem_tools'],
      },
    })).toEqual({
      authoringMode: AUTHORING_MODES.autonomousFilesystem,
      requiredCapabilities: ['filesystem_tools'],
      expectedToolNames: PI_DEFAULT_TOOL_NAMES,
      toolInventorySource: 'pi-default-system-prompt',
    })
  })

  it('does not skip the prompt when no output contracts exist', () => {
    expect(shouldSkipPromptAfterPreflight({
      deterministicCommandCount: 0,
      contractCount: 0,
      missingCount: 0,
    })).toBe(false)
  })

  it('skips the prompt only when deterministic materialization satisfied declared contracts', () => {
    expect(shouldSkipPromptAfterPreflight({
      deterministicCommandCount: 1,
      contractCount: 1,
      missingCount: 0,
    })).toBe(true)
    expect(shouldSkipPromptAfterPreflight({
      deterministicCommandCount: 1,
      contractCount: 2,
      missingCount: 0,
    })).toBe(false)
    expect(shouldSkipPromptAfterPreflight({
      deterministicCommandCount: 1,
      contractCount: 1,
      missingCount: 1,
    })).toBe(false)
  })
})
