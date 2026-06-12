/** Stub for cloudflare:workers in Node.js test environments. */
export class DurableObject {
  env: unknown
  ctx: unknown
  constructor(ctx: unknown, env: unknown) { this.ctx = ctx; this.env = env }
}
export class WorkflowEntrypoint {
  env: unknown
  constructor() {}
}
export class RpcTarget {}
export class RpcStub {}
export const env: Record<string, unknown> = {}
