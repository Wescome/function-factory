import type { RouteTarget } from '@factory/task-routing'

export interface ProviderEnv {
  OFOX_API_KEY?: string
}

export async function callProvider(
  target: RouteTarget,
  system: string,
  user: string,
  env: ProviderEnv,
): Promise<string> {
  const key = env.OFOX_API_KEY
  if (!key) throw new Error('OFOX_API_KEY not set')

  // Timeout covers the ENTIRE request lifecycle: connection + body read.
  // LLM responses stream tokens over 10-90s; 120s covers worst case.
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 120_000)

  try {
    const res = await fetch('https://api.ofox.ai/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
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
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(`ofox [${target.provider}/${target.model}] timed out after 120s`)
    }
    throw err
  } finally {
    clearTimeout(timeout)
  }
}

function stripCodeFences(text: string): string {
  const trimmed = text.trim()
  const match = /^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/s.exec(trimmed)
  return match ? match[1]! : trimmed
}
