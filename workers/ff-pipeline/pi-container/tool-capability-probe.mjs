export const TOOL_PROBE_FILE = '.pi-tool-use-probe'
export const TOOL_PROBE_EXPECTED_CONTENT = 'tool-use-ok\n'

const TOOL_EXECUTION_EVENT_TYPES = new Set([
  'tool_execution_start',
  'tool_execution_update',
  'tool_execution_end',
])

export function isToolExecutionEvent(msg) {
  return TOOL_EXECUTION_EVENT_TYPES.has(msg?.type)
}

export function requiresFilesystemAuthoring(evaluation, declaredOutputs) {
  if (!Array.isArray(declaredOutputs) || declaredOutputs.length === 0) return false
  return Array.isArray(evaluation?.missing) && evaluation.missing.length > 0
}

export function buildToolCapabilityProbePrompt() {
  return [
    'This is a filesystem tool capability probe before the real task.',
    `Use your filesystem tools or shell command tool to create local file \`./${TOOL_PROBE_FILE}\`.`,
    `The file content must be exactly: ${JSON.stringify(TOOL_PROBE_EXPECTED_CONTENT)}.`,
    'Do not create any declared task artifacts during this probe.',
    'After the file exists, finish with a short confirmation.',
  ].join('\n')
}

export function assessToolCapabilityProbe({ toolExecutionEventCount, fileContent, fileError }) {
  if (toolExecutionEventCount <= 0) {
    return {
      passed: false,
      reason: 'no tool_execution_* events observed during filesystem probe',
    }
  }
  if (fileError) {
    return {
      passed: false,
      reason: `probe file not readable: ${fileError}`,
    }
  }
  if (fileContent !== TOOL_PROBE_EXPECTED_CONTENT) {
    return {
      passed: false,
      reason: `probe file content mismatch: expected ${JSON.stringify(TOOL_PROBE_EXPECTED_CONTENT)}`,
    }
  }
  return { passed: true, reason: 'filesystem tool probe passed' }
}
