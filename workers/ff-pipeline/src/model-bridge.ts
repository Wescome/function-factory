import { resolveAndCall } from '@factory/task-routing'
import type { TaskKind, RouteTarget } from '@factory/task-routing'
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

async function callProvider(
  target: RouteTarget,
  system: string,
  user: string,
  env: PipelineEnv,
): Promise<string> {
  const { provider, model } = target

  switch (provider) {
    case 'anthropic':
      return callAnthropic(model, system, user, env)
    case 'openai':
      return callOpenAI(model, system, user, env)
    case 'deepseek':
      return callDeepSeek(model, system, user, env)
    default:
      throw new Error(`Unknown provider: ${provider}`)
  }
}

async function callAnthropic(
  model: string,
  system: string,
  user: string,
  env: PipelineEnv,
): Promise<string> {
  const key = env.ANTHROPIC_API_KEY
  if (!key) throw new Error('ANTHROPIC_API_KEY not set')

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Anthropic ${res.status}: ${body}`)
  }

  const data = await res.json() as { content: { type: string; text: string }[] }
  const textBlock = data.content.find((b) => b.type === 'text')
  if (!textBlock) throw new Error('No text block in Anthropic response')
  return textBlock.text
}

async function callOpenAI(
  model: string,
  system: string,
  user: string,
  env: PipelineEnv,
): Promise<string> {
  const key = env.OPENAI_API_KEY
  if (!key) throw new Error('OPENAI_API_KEY not set')

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`OpenAI ${res.status}: ${body}`)
  }

  const data = await res.json() as { choices: { message: { content: string } }[] }
  const choice = data.choices[0]
  if (!choice) throw new Error('No choices in OpenAI response')
  return choice.message.content
}

async function callDeepSeek(
  model: string,
  system: string,
  user: string,
  env: PipelineEnv,
): Promise<string> {
  const key = env.DEEPSEEK_API_KEY
  if (!key) throw new Error('DEEPSEEK_API_KEY not set')

  const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`DeepSeek ${res.status}: ${body}`)
  }

  const data = await res.json() as { choices: { message: { content: string } }[] }
  const choice = data.choices[0]
  if (!choice) throw new Error('No choices in DeepSeek response')
  return choice.message.content
}
