/**
 * @factory/gears — Sandbox class
 *
 * Single Sandbox class with all outbound host injectors (GD-005).
 * Per-role gating is NOT here — it is in `toolPolicy` at the application layer.
 *
 * SPEC-FF-GEARS-001 §6
 */

import { Sandbox as BaseSandbox } from '@cloudflare/sandbox'
import type { OutboundHandler } from '@cloudflare/containers'

export interface Env {
  ANTHROPIC_API_KEY: string
  OPENAI_API_KEY:    string
  DEEPSEEK_API_KEY:  string
  GITHUB_TOKEN:      string
}

function inject(req: Request, header: string, value: string): Request {
  const headers = new Headers(req.headers)
  headers.set(header, value)
  return new Request(req, { headers })
}

// GD-005: single class, all injectors. Per-role gating via toolPolicy.
export class Sandbox extends BaseSandbox {
  static override outboundByHost: Record<string, OutboundHandler<Env>> = {
    'api.anthropic.com': (req: Request, env: Env) =>
      fetch(inject(req, 'x-api-key', env.ANTHROPIC_API_KEY)),
    'api.openai.com': (req: Request, env: Env) =>
      fetch(inject(req, 'Authorization', `Bearer ${env.OPENAI_API_KEY}`)),
    'api.deepseek.com': (req: Request, env: Env) =>
      fetch(inject(req, 'Authorization', `Bearer ${env.DEEPSEEK_API_KEY}`)),
    'api.github.com': (req: Request, env: Env) =>
      fetch(inject(req, 'Authorization', `Bearer ${env.GITHUB_TOKEN}`)),
  }
}
