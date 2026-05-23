// CF Worker stub — execa (child_process) cannot run in Cloudflare Workers.
// @factory/nlah barrel-exports adapters.ts which imports execa, but no
// CF Worker code path invokes those adapters at runtime.
// wrangler.jsonc alias redirects all execa imports here at bundle time.
export function execa() { throw new Error("execa is not available in CF Workers") }
export function execaSync() { throw new Error("execa is not available in CF Workers") }
export function execaCommand() { throw new Error("execa is not available in CF Workers") }
export function $ () { throw new Error("execa is not available in CF Workers") }
