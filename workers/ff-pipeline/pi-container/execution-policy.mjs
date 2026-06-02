export const PI_DEFAULT_TOOL_NAMES = ['read', 'bash', 'edit', 'write']

export const AUTHORING_MODES = {
  contractMaterialized: 'contract_materialized_when_possible',
  autonomousFilesystem: 'autonomous_filesystem',
}

export function authoringModeForInput(input) {
  const mode = input?.execution?.authoringMode
  if (mode === AUTHORING_MODES.autonomousFilesystem) return mode
  return AUTHORING_MODES.contractMaterialized
}

export function shouldMaterializeContracts(input) {
  return authoringModeForInput(input) !== AUTHORING_MODES.autonomousFilesystem
}

export function shouldSkipPromptAfterPreflight({
  deterministicCommandCount,
  contractCount,
  missingCount,
}) {
  return contractCount > 0 &&
    deterministicCommandCount === contractCount &&
    missingCount === 0
}

export function executionPolicyObservation(input) {
  const execution = input?.execution ?? {}
  const requiredCapabilities = Array.isArray(execution.requiredCapabilities)
    ? execution.requiredCapabilities.filter((entry) => typeof entry === 'string')
    : []
  return {
    authoringMode: authoringModeForInput(input),
    requiredCapabilities,
    expectedToolNames: requiredCapabilities.includes('filesystem_tools')
      ? PI_DEFAULT_TOOL_NAMES
      : [],
    toolInventorySource: 'pi-default-system-prompt',
  }
}
