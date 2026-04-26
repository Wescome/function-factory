import type { RouteTarget } from '@factory/task-routing'

export interface ProviderEnv {
  OFOX_API_KEY?: string
  AI?: {
    run(model: string, input: Record<string, unknown>): Promise<{ response: string }>
  }
}

export async function callProvider(
  target: RouteTarget,
  system: string,
  user: string,
  env: ProviderEnv,
): Promise<string> {
  // Workers AI path: bypass ofox.ai entirely
  if (target.provider === 'cloudflare') {
    if (!env.AI) throw new Error('AI binding not available for Workers AI')
    const result = await env.AI.run(target.model, {
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    })
    return result.response
  }

  // Default path: ofox.ai unified gateway
  const key = env.OFOX_API_KEY
  if (!key) throw new Error('OFOX_API_KEY not set')

  const res = await fetch('https://api.ofox.ai/v1/chat/completions', {
    method: 'POST',
    signal: AbortSignal.timeout(120_000),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: `${target.provider}/${target.model}`,
      max_tokens: 4096,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`ofox [${target.provider}/${target.model}] ${res.status}: ${body}`)
  }

  const data = await res.json() as { choices: { message: { content: string } }[] }
  const choice = data.choices[0]
  if (!choice) throw new Error(`No choices from ${target.provider}/${target.model}`)
  return stripCodeFences(choice.message.content)
}

function stripCodeFences(text: string): string {
  const trimmed = text.trim()
  const match = /^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/s.exec(trimmed)
  return match ? match[1]! : trimmed
}
