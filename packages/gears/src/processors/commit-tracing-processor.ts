/**
 * @factory/gears — CommitTracingProcessor
 *
 * Mastra outputProcessor that detects `git commit` tool calls and, after the
 * agent generate() resolves, extracts the resulting commit SHA from the
 * workspace .git directory via workspace.readFile() (no exec needed).
 *
 * SHA propagation path:
 *   processOutputStep detects the git-commit shell call and sets a pending
 *   flag.  extractCommitSha() is called after generate() resolves (from
 *   ThinkExecutor) and returns the 40-char SHA or undefined.
 *
 * Workspace file strategy (WorkspaceLike has no exec):
 *   1. readFile('/workspace/.git/HEAD')  → 'ref: refs/heads/<branch>\n'
 *   2. readFile('/workspace/.git/refs/heads/<branch>') → '<sha>\n'
 *   Fallback: read '/workspace/.git/ORIG_HEAD' if detached HEAD.
 *
 * Non-fatal: if the workspace is unavailable or not a git repo, returns
 * undefined and logs a warning without throwing.
 *
 * GAP-014
 */

import { BaseProcessor } from '@mastra/core/processors'
import type { ProcessOutputStepArgs } from '@mastra/core/processors'
import type { AtomDirective } from '@factory/schemas'
import type { WorkspaceLike } from '@cloudflare/think/tools/workspace'

const GIT_COMMIT_RE = /\bgit\s+commit\b/

export class CommitTracingProcessor extends BaseProcessor<'commit-tracing'> {
  readonly id = 'commit-tracing' as const

  /** Set to true when we observe a git commit shell call in processOutputStep. */
  private _gitCommitObserved = false

  constructor(
    private readonly directive: AtomDirective,
    private readonly workspace: WorkspaceLike,
  ) {
    super()
  }

  /**
   * Scan tool calls for `git commit` shell invocations.  Returns messages
   * unchanged — this processor is purely observational at this stage.
   */
  async processOutputStep(args: ProcessOutputStepArgs): Promise<(typeof args)['messages']> {
    const { toolCalls, messages } = args
    if (!toolCalls?.length) return messages

    for (const toolCall of toolCalls) {
      if (toolCall.toolName === 'shell' || toolCall.toolName === 'bash') {
        const command = (toolCall.args as { command?: string })?.command ?? ''
        if (GIT_COMMIT_RE.test(command)) {
          this._gitCommitObserved = true
        }
      }
    }

    return messages
  }

  /**
   * Returns true if at least one git commit was observed in this processor's
   * lifetime.  ThinkExecutor calls this to decide whether to attempt SHA
   * extraction.
   */
  get gitCommitObserved(): boolean {
    return this._gitCommitObserved
  }

  /**
   * Extract the HEAD commit SHA from the workspace after generate() resolves.
   *
   * Reads .git/HEAD to determine the current branch ref, then reads the packed
   * ref file.  Returns a 40-char hex string on success, undefined otherwise.
   * Never throws.
   */
  async extractCommitSha(): Promise<string | undefined> {
    const prefix = '[CommitTracingProcessor] extractCommitSha'
    try {
      const headRaw = await this.workspace.readFile('/workspace/.git/HEAD')
      if (!headRaw) {
        console.warn(`${prefix}: .git/HEAD not found`)
        return undefined
      }

      const head = headRaw.trim()

      // Symbolic ref: "ref: refs/heads/<branch>"
      if (head.startsWith('ref: ')) {
        const refPath = head.slice('ref: '.length).trim() // e.g. refs/heads/main
        const sha = await this._readRefFile(refPath)
        if (sha) return sha

        // Fallback: try packed-refs
        return await this._readPackedRef(refPath)
      }

      // Detached HEAD: the HEAD file itself contains the SHA
      if (/^[0-9a-f]{40}$/i.test(head)) {
        return head.toLowerCase()
      }

      console.warn(`${prefix}: unrecognised HEAD format: ${head.slice(0, 80)}`)
      return undefined
    } catch (err) {
      console.warn(`${prefix}: unexpected error`, err)
      return undefined
    }
  }

  // ── private helpers ────────────────────────────────────────────────────────

  private async _readRefFile(refPath: string): Promise<string | undefined> {
    // refPath is like "refs/heads/main" — file lives at .git/<refPath>
    const filePath = `/workspace/.git/${refPath}`
    const raw = await this.workspace.readFile(filePath)
    if (!raw) return undefined
    const sha = raw.trim()
    if (/^[0-9a-f]{40}$/i.test(sha)) return sha.toLowerCase()
    return undefined
  }

  private async _readPackedRef(refPath: string): Promise<string | undefined> {
    const raw = await this.workspace.readFile('/workspace/.git/packed-refs')
    if (!raw) return undefined
    for (const line of raw.split('\n')) {
      if (line.startsWith('#') || !line.trim()) continue
      const [sha, ref] = line.trim().split(/\s+/, 2)
      if (ref === refPath && sha && /^[0-9a-f]{40}$/i.test(sha)) {
        return sha.toLowerCase()
      }
    }
    return undefined
  }
}
