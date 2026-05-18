import { join } from 'node:path'

export async function runSdkPrompt({ workDir, selectedModel, prompt, observation, onEvent }) {
  const {
    AuthStorage,
    ModelRegistry,
    SessionManager,
    SettingsManager,
    createAgentSession,
  } = await import('@earendil-works/pi-coding-agent')

  const agentDir = process.env.PI_AGENT_DIR ?? '/root/.pi/agent'
  const authStorage = AuthStorage.create(join(agentDir, 'auth.json'))
  const apiKey = process.env.OPENROUTER_API_KEY
  if (selectedModel.provider === 'openrouter' && apiKey) {
    authStorage.setRuntimeApiKey('openrouter', apiKey)
  }

  const modelRegistry = ModelRegistry.create(authStorage, join(agentDir, 'models.json'))
  const model = modelRegistry.find(selectedModel.provider, selectedModel.model)
  if (!model) {
    throw new Error(`SDK model not found: ${selectedModel.id}`)
  }

  const { session } = await createAgentSession({
    cwd: workDir,
    agentDir,
    authStorage,
    modelRegistry,
    model,
    thinkingLevel: 'off',
    tools: ['read', 'bash', 'edit', 'write'],
    sessionManager: SessionManager.inMemory(workDir),
    settingsManager: SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: true, maxRetries: 1 },
    }),
  })

  const unsubscribe = session.subscribe((event) => onEvent(event))
  try {
    observation.executionSurface = 'sdk'
    await session.prompt(prompt)
  } finally {
    unsubscribe?.()
    session.dispose()
  }
}
