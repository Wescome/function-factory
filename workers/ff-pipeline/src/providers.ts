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
  // Workers AI path: uses env.AI binding for pipeline stages (1-5)
  if (target.provider === 'cloudflare') {
    if (!env.AI) throw new Error('Workers AI binding unavailable — configure ai binding in wrangler.jsonc')
    const result = await env.AI.run(target.model, {
      messages: [
        { role: 'system', content: system + '\n\nIMPORTANT: Respond ONLY with valid JSON. No prose, no markdown, no explanation.' },
        { role: 'user', content: user },
      ],
      max_tokens: 4096,
      response_format: { type: 'json_object' },
    } as Record<string, unknown>)
    const resp = (result as Record<string, unknown>)?.response
    if (resp === undefined || resp === null) {
      throw new Error(`Workers AI ${target.model}: empty response`)
    }
    const raw = typeof resp === 'string' ? resp : JSON.stringify(resp)
    return extractJSON(raw)
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
      response_format: { type: 'json_object' },
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
  return extractJSON(choice.message.content)
}

export function stripCodeFences(text: string): string {
  const trimmed = text.trim()
  // Match the first code fence block anywhere in the string.
  // Supports: ```json, ```typescript, ```ts, bare ```, etc.
  // Opening: ``` + optional language tag + optional whitespace/newline
  // Content: captured (non-greedy)
  // Closing: ``` (with optional preceding newline)
  const match = /```\w*\s*?\n?([\s\S]*?)(?:\n\s*)?```/.exec(trimmed)
  return match ? match[1]!.trim() : trimmed
}

/**
 * Four-tier JSON extraction fallback.
 *
 * 1. Fast path: raw text is already valid JSON -> return it
 * 2. Extract from code fences (```json, ```JSON, bare ```) -> try JSON.parse
 * 3. Find first `{` and last `}` (or `[` and `]`) -> try JSON.parse on that substring
 * 4. Nothing worked -> return trimmed text (let caller's JSON.parse produce a clear error)
 *
 * Deterministic and pure — no side effects, same input always produces same output.
 */
export function extractJSON(text: string): string {
  const trimmed = text.trim()

  // Tier 1: Fast path — already valid JSON
  try {
    JSON.parse(trimmed)
    return trimmed
  } catch {
    // Not valid JSON as-is, continue to tier 2
  }

  // Tier 2: Extract from code fences
  const fenceMatch = /```\w*\s*?\n?([\s\S]*?)(?:\n\s*)?```/.exec(trimmed)
  if (fenceMatch) {
    const fenceContent = fenceMatch[1]!.trim()
    try {
      JSON.parse(fenceContent)
      return fenceContent
    } catch {
      // Fence content isn't valid JSON, continue to tier 3
    }
  }

  // Tier 3: Find first `{` and last `}`, or first `[` and last `]`
  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  const firstBracket = trimmed.indexOf('[')
  const lastBracket = trimmed.lastIndexOf(']')

  // Try object extraction
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const candidate = trimmed.slice(firstBrace, lastBrace + 1)
    try {
      JSON.parse(candidate)
      return candidate
    } catch {
      // Not valid JSON, continue
    }
  }

  // Try array extraction
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    const candidate = trimmed.slice(firstBracket, lastBracket + 1)
    try {
      JSON.parse(candidate)
      return candidate
    } catch {
      // Not valid JSON, continue
    }
  }

  // Tier 4: Nothing worked — return trimmed text
  return trimmed
}
