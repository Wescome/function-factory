/**
 * @module generate-pr
 *
 * Generates GitHub PRs from synthesis atom results.
 *
 * This is the final step in the feedback loop: when synthesis passes
 * with confidence >= 0.8, the feedback loop generates a `synthesis:pr-candidate`
 * signal. This module reads the atom results and creates a branch + PR
 * via the GitHub REST API.
 *
 * GitHub API calls use GitHub App installation tokens and the Git Data API.
 */

import { applyEdits, type Edit } from '@factory/diff-engine'
import { getInstallationToken } from '../github-app-auth'

// ── Types ────────────────────────────────────────────────────────────

export interface FileChangeV2 {
  path: string
  action: 'create' | 'modify' | 'delete'
  /** Full file content — used for action='create', or legacy action='modify' */
  content?: string
  /** Search/replace edits — used for action='modify' (v2 format) */
  edits?: Edit[]
}

export interface PRGenerationInput {
  runId?: string
  workGraphId?: string
  signalTitle: string
  proposalId: string
  executableSpecificationId: string
  atomResults: Record<string, {
    atomId: string
    verdict: { decision: string }
    codeArtifact: {
      files: Array<FileChangeV2>
      summary: string
    } | null
  }>
  sourceRefs: string[]
  confidence: number
  /** When the originating signal was created — used for conflict detection */
  signalCreatedAt?: string
  /** Summary of the codebase state the Factory saw when generating this proposal */
  specContentSummary?: string
  issueContract?: IssueContractArtifact | null
}

export interface IssueContractArtifact {
  targetRepo?: string
  [key: string]: unknown
}

export interface PRGenerationEnv {
  GITHUB_APP_ID: string
  GITHUB_APP_PRIVATE_KEY: string
  GITHUB_TARGET_REPO?: string
}

export interface PRGenerationResult {
  success: boolean
  prUrl?: string
  prNumber?: number
  branchName?: string
  error?: string
  filesWritten: number
  /** Files that were expected to exist (modify action) but were not found */
  filesNotFound?: string[]
  /** Conflict warnings surfaced during PR creation */
  warnings?: string[]
}

// ── Helpers ─────────────────────────────────────────────────────────

const MAX_BRANCH_LENGTH = 50

export function buildBranchName(runId: string, shortHash = '00000000', suffix?: number): string {
  const sanitized = runId
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'unknown'

  const prefix = 'factory/fn-'
  const suffixText = suffix ? `-${suffix}` : ''
  const maxSlugLength = MAX_BRANCH_LENGTH - prefix.length - 1 - shortHash.length - suffixText.length
  const slug = sanitized.slice(0, maxSlugLength)

  return `${prefix}${slug}-${shortHash}${suffixText}`
}

/**
 * Build the markdown body for the PR description.
 * Includes lineage, atom summaries, and confidence score.
 */
export function buildPRBody(input: PRGenerationInput): string {
  const sections: string[] = []

  // Header
  sections.push(`## Factory-Generated PR`)
  sections.push('')
  sections.push(`**ExecutableSpecification:** \`${input.executableSpecificationId}\``)
  sections.push(`**Proposal:** \`${input.proposalId}\``)
  sections.push(`**Confidence:** ${input.confidence}`)
  sections.push('')

  // Lineage
  sections.push(`### Lineage`)
  sections.push('')
  if (input.sourceRefs.length > 0) {
    for (const ref of input.sourceRefs) {
      sections.push(`- \`${ref}\``)
    }
  } else {
    sections.push('_No lineage refs_')
  }
  sections.push('')

  // Atom summaries
  sections.push(`### Atom Results`)
  sections.push('')
  const entries = Object.entries(input.atomResults ?? {})
  if (entries.length === 0) {
    sections.push('_No atom results_')
  } else {
    for (const [atomId, atomResult] of entries) {
      const verdict = atomResult.verdict.decision
      const summary = atomResult.codeArtifact?.summary ?? 'No code artifact'
      const fileCount = atomResult.codeArtifact?.files?.length ?? 0
      sections.push(`- **${atomId}** (${verdict}): ${summary} — ${fileCount} file(s)`)
    }
  }
  sections.push('')

  // Conflict detection
  sections.push(`### Conflict Detection`)
  sections.push('')
  if (input.signalCreatedAt) {
    sections.push(`- **Signal created at:** \`${input.signalCreatedAt}\``)
  }
  if (input.specContentSummary) {
    sections.push(`- **Codebase state seen by Factory:** ${input.specContentSummary}`)
  }
  sections.push(`- **PR created at:** \`${new Date().toISOString()}\``)
  sections.push('')
  sections.push('> **Warning:** The Factory generates code from a codebase snapshot. ' +
    'If the repo has diverged since the signal was created, file conflicts may exist. ' +
    'Review carefully before merging.')
  sections.push('')

  // Compile Gate
  sections.push(`### Compile Gate`)
  sections.push('')
  sections.push('> Factory-generated PRs must pass CI typecheck before merging.')
  sections.push('> If CI fails, this PR should be closed — the failure will feed back as a `synthesis:compile-failed` signal.')
  sections.push('')

  // Footer
  sections.push('---')
  sections.push('_Generated by the Function Factory feedback loop._')

  return sections.join('\n')
}

// ── GitHub API helpers ──────────────────────────────────────────────

function apiHeaders(token: string): Record<string, string> {
  return {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'ff-pipeline',
  }
}

/**
 * Decode a base64 string (from GitHub API) to UTF-8 text.
 * GitHub returns file content as base64 with possible newlines.
 */
function fromBase64(encoded: string): string {
  const cleaned = encoded.replace(/\n/g, '')
  const binary = atob(cleaned)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new TextDecoder().decode(bytes)
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

async function sha256Hex(content: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content))
  return bytesToHex(new Uint8Array(digest))
}

function patchFingerprint(input: PRGenerationInput): string {
  const chunks: string[] = []
  for (const [, atomResult] of Object.entries(input.atomResults ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    if (atomResult.verdict.decision !== 'pass') continue
    for (const file of atomResult.codeArtifact?.files ?? []) {
      chunks.push(file.content ?? '')
      for (const edit of file.edits ?? []) {
        chunks.push(edit.search, edit.replace)
      }
    }
  }
  return chunks.join('\n')
}

function assertOkRepo(value: string | undefined): { owner: string; repo: string } {
  if (!value) {
    throw new Error('Missing target repo: IssueContract.targetRepo and GITHUB_TARGET_REPO are both unset')
  }
  const [owner, repo, extra] = value.split('/')
  if (!owner || !repo || extra !== undefined) {
    throw new Error(`Invalid target repo "${value}"; expected owner/repo`)
  }
  return { owner, repo }
}

function resolveTargetRepo(input: PRGenerationInput, env: PRGenerationEnv): { owner: string; repo: string } {
  return assertOkRepo(input.issueContract?.targetRepo ?? env.GITHUB_TARGET_REPO)
}

function apiUrl(owner: string, repo: string, path: string): string {
  return `https://api.github.com/repos/${owner}/${repo}${path}`
}

// ── Main ────────────────────────────────────────────────────────────

interface GitRefResponse { object: { sha: string } }
interface GitCommitResponse { sha: string; tree: { sha: string } }
interface GitTreeEntry { path: string; mode?: string; type: 'blob' | 'tree' | 'commit'; sha: string; size?: number }
interface GitTreeResponse { tree: GitTreeEntry[]; truncated?: boolean }
interface GitBlobResponse { content: string; encoding: string }
interface GitCreateTreeResponse { sha: string }
interface GitCreateCommitResponse { sha: string }
interface GitPullResponse { html_url: string; number: number }

/**
 * Generate a GitHub PR from synthesis atom results.
 *
 * Steps:
 *   1. Get main branch SHA
 *   2. Create branch from main
 *   3. Write files from passing atoms
 *   4. Create PR
 */
export async function generatePR(
  input: PRGenerationInput,
  env: PRGenerationEnv,
): Promise<PRGenerationResult> {
  const { owner: repoOwner, repo: repoName } = resolveTargetRepo(input, env)
  const runId = input.runId ?? input.workGraphId ?? input.proposalId
  const shortHash = (await sha256Hex(patchFingerprint(input))).slice(0, 8)
  let branchName = buildBranchName(runId, shortHash)
  let filesWritten = 0

  try {
    let githubToken = await getInstallationToken(env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY, repoOwner, repoName)

    const githubFetch = async (path: string, init: RequestInit): Promise<Response> => {
      const runFetch = (token: string) => fetch(
        apiUrl(repoOwner, repoName, path),
        {
          ...init,
          headers: {
            ...apiHeaders(token),
            ...(init.headers as Record<string, string> | undefined),
          },
        },
      )
      let res = await runFetch(githubToken)
      if (res.status === 401) {
        githubToken = await getInstallationToken(env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY, repoOwner, repoName)
        res = await runFetch(githubToken)
      }
      return res
    }

    // ── Step 1: Get main branch SHA ──
    const mainRefRes = await githubFetch('/git/ref/heads/main', { method: 'GET' })

    if (!mainRefRes.ok) {
      const errorBody = await mainRefRes.text()
      return {
        success: false,
        branchName,
        error: `Failed to get main ref (${mainRefRes.status}): ${errorBody}`,
        filesWritten: 0,
      }
    }

    const mainRef = await mainRefRes.json() as GitRefResponse
    const mainSha = mainRef.object.sha

    const mainCommitRes = await githubFetch(`/git/commits/${mainSha}`, { method: 'GET' })
    if (!mainCommitRes.ok) {
      const errorBody = await mainCommitRes.text()
      return {
        success: false,
        branchName,
        error: `Failed to get main commit (${mainCommitRes.status}): ${errorBody}`,
        filesWritten: 0,
      }
    }
    const mainCommit = await mainCommitRes.json() as GitCommitResponse
    const baseTreeSha = mainCommit.tree.sha

    // ── Step 2: Create branch from main ──
    let createBranchError: string | undefined
    for (const suffix of [undefined, 2, 3] as Array<number | undefined>) {
      branchName = buildBranchName(runId, shortHash, suffix)
      const createBranchRes = await githubFetch('/git/refs', {
        method: 'POST',
        body: JSON.stringify({
          ref: `refs/heads/${branchName}`,
          sha: mainSha,
        }),
      })

      if (createBranchRes.ok) {
        createBranchError = undefined
        break
      }

      const errorBody = await createBranchRes.text()
      createBranchError = `Failed to create branch (${createBranchRes.status}): ${errorBody}`
      if (createBranchRes.status !== 422) break
    }

    if (createBranchError) {
      return {
        success: false,
        branchName,
        error: createBranchError,
        filesWritten: 0,
      }
    }

    const treeRes = await githubFetch(`/git/trees/${baseTreeSha}?recursive=1`, { method: 'GET' })
    if (!treeRes.ok) {
      const errorBody = await treeRes.text()
      return {
        success: false,
        branchName,
        error: `Failed to get base tree (${treeRes.status}): ${errorBody}`,
        filesWritten: 0,
      }
    }
    const baseTree = await treeRes.json() as GitTreeResponse
    const baseBlobs = new Map(
      baseTree.tree
        .filter((entry): entry is GitTreeEntry & { type: 'blob' } => entry.type === 'blob')
        .map(entry => [entry.path, entry]),
    )

    // ── Step 3: Write files from passing atoms ──
    // Group files by path across atoms (Architect condition #8: serialize per path)
    const filesByPath = new Map<string, FileChangeV2[]>()
    const filesNotFound: string[] = []
    const warnings: string[] = []
    const treeEntries: Array<{ path: string; mode: '100644'; type: 'blob'; sha: string }> = []

    if (baseTree.truncated) {
      warnings.push('Base tree response was truncated; file existence checks may be incomplete')
    }

    for (const [, atomResult] of Object.entries(input.atomResults ?? {})) {
      if (atomResult.verdict.decision !== 'pass') continue
      if (!atomResult.codeArtifact?.files) continue

      for (const file of atomResult.codeArtifact.files) {
        const existing = filesByPath.get(file.path)
        if (existing) {
          existing.push(file)
        } else {
          filesByPath.set(file.path, [file])
        }
      }
    }

    for (const [filePath, fileChanges] of filesByPath) {
      const primaryAction = fileChanges[fileChanges.length - 1]!.action

      // RESTRICTED ACTION SPACE (SWE-agent pattern): Factory PRs never delete files.
      // Delete actions are always hallucinated — the Factory builds, it doesn't destroy.
      if (primaryAction === 'delete') {
        warnings.push(`BLOCKED: delete action on ${filePath}. Factory PRs do not delete files.`)
        continue
      }

      // create or modify — resolve existing file state from the base tree
      const existingBlob = baseBlobs.get(filePath)
      let existingContent: string | undefined

      if (existingBlob) {
        const blobRes = await githubFetch(`/git/blobs/${existingBlob.sha}`, { method: 'GET' })
        if (!blobRes.ok) {
          const errorBody = await blobRes.text()
          return {
            success: false,
            branchName,
            error: `Failed to get existing blob for ${filePath} (${blobRes.status}): ${errorBody}`,
            filesWritten,
          }
        }
        const fileData = await blobRes.json() as GitBlobResponse
        existingContent = fileData.encoding === 'base64' ? fromBase64(fileData.content) : fileData.content
        // HARD GATE: block create on existing files — prevents overwriting
        if (primaryAction === 'create') {
          warnings.push(`BLOCKED: create action on existing file: ${filePath} (${existingContent?.length ?? 0} chars). Atom must use modify with edits.`)
          continue
        }
      } else if (primaryAction === 'modify') {
        filesNotFound.push(filePath)
        warnings.push(`Modify target not found on branch, treating as create: ${filePath}`)
      }

      // Resolve final content — diff-based edits or legacy full content
      let finalContent: string | undefined

      // Merge edits from all atoms targeting this file
      const allEdits: Edit[] = []
      let hasLegacyContent = false
      let legacyContent = ''

      for (const change of fileChanges) {
        if (change.edits && change.edits.length > 0) {
          allEdits.push(...change.edits)
        } else if (change.content !== undefined) {
          hasLegacyContent = true
          legacyContent = change.content
          warnings.push(`Legacy full-content format used for: ${filePath}`)
        }
      }

      if (allEdits.length > 0 && existingContent !== undefined) {
        // v2 path: apply search/replace edits to existing content
        const result = applyEdits(existingContent, allEdits)
        if (result.success) {
          finalContent = result.content
        } else {
          const failureDetails = result.failedEdits
            .map(f => `${f.reason}: "${f.edit.search.slice(0, 60)}..."`)
            .join('; ')
          warnings.push(`Edit application partial failure on ${filePath}: ${failureDetails}`)
          if (result.appliedEdits > 0) {
            finalContent = result.content
          } else {
            warnings.push(`All edits failed for ${filePath}, skipping file`)
            continue
          }
        }
      } else if (allEdits.length > 0 && existingContent === undefined) {
        warnings.push(`Edits provided but no existing file to patch: ${filePath}`)
        continue
      } else if (hasLegacyContent) {
        // Size guard: block legacy replacement that shrinks file >50%
        if (existingContent !== undefined && legacyContent.length < existingContent.length * 0.5) {
          warnings.push(`BLOCKED: legacy content would shrink ${filePath} from ${existingContent.length} to ${legacyContent.length} chars (>50% reduction)`)
          continue
        }
        finalContent = legacyContent
      } else {
        warnings.push(`No content or edits for ${filePath}, skipping`)
        continue
      }

      const createBlobRes = await githubFetch('/git/blobs', {
        method: 'POST',
        body: JSON.stringify({
          content: finalContent,
          encoding: 'utf-8',
        }),
      })
      if (!createBlobRes.ok) {
        const errorBody = await createBlobRes.text()
        return {
          success: false,
          branchName,
          error: `Failed to create blob for ${filePath} (${createBlobRes.status}): ${errorBody}`,
          filesWritten,
        }
      }
      const blob = await createBlobRes.json() as { sha: string }
      treeEntries.push({ path: filePath, mode: '100644', type: 'blob', sha: blob.sha })
      filesWritten++
    }

    // ── Phantom synthesis guard ──
    // If atoms declared files but none were written, all edits failed — this is a phantom PR.
    // Clean up the orphan branch and return failure.
    if (filesWritten === 0) {
      // Delete the orphan branch (best-effort)
      await githubFetch(`/git/refs/heads/${branchName}`, { method: 'DELETE' }).catch(() => {})

      return {
        success: false,
        error: 'Phantom synthesis: zero files written — all edits failed or no content provided',
        filesWritten: 0,
        branchName,
        ...(warnings.length > 0 && { warnings }),
      }
    }

    const createTreeRes = await githubFetch('/git/trees', {
      method: 'POST',
      body: JSON.stringify({
        base_tree: baseTreeSha,
        tree: treeEntries,
      }),
    })
    if (!createTreeRes.ok) {
      const errorBody = await createTreeRes.text()
      return {
        success: false,
        branchName,
        error: `Failed to create tree (${createTreeRes.status}): ${errorBody}`,
        filesWritten,
      }
    }
    const createdTree = await createTreeRes.json() as GitCreateTreeResponse

    const createCommitRes = await githubFetch('/git/commits', {
      method: 'POST',
      body: JSON.stringify({
        message: `[Factory] ${input.signalTitle}`,
        tree: createdTree.sha,
        parents: [mainSha],
      }),
    })
    if (!createCommitRes.ok) {
      const errorBody = await createCommitRes.text()
      return {
        success: false,
        branchName,
        error: `Failed to create commit (${createCommitRes.status}): ${errorBody}`,
        filesWritten,
      }
    }
    const createdCommit = await createCommitRes.json() as GitCreateCommitResponse

    const updateRefRes = await githubFetch(`/git/refs/heads/${branchName}`, {
      method: 'PATCH',
      body: JSON.stringify({
        sha: createdCommit.sha,
        force: false,
      }),
    })
    if (!updateRefRes.ok) {
      const errorBody = await updateRefRes.text()
      return {
        success: false,
        branchName,
        error: `Failed to update branch ref (${updateRefRes.status}): ${errorBody}`,
        filesWritten,
      }
    }

    // ── Step 4: Create draft PR ──
    // Append file-not-found warnings to PR body if any
    let prBody = buildPRBody(input)
    if (filesNotFound.length > 0) {
      prBody += '\n\n### File Warnings\n\n'
      prBody += '> The following files could not be found at their expected paths:\n\n'
      for (const f of filesNotFound) {
        prBody += `- \`${f}\`\n`
      }
    }

    const createPRRes = await githubFetch('/pulls', {
      method: 'POST',
      body: JSON.stringify({
        title: `[Factory] ${input.signalTitle}`,
        body: prBody,
        head: branchName,
        base: 'main',
        draft: true,
      }),
    })

    if (!createPRRes.ok) {
      const errorBody = await createPRRes.text()
      return {
        success: false,
        branchName,
        error: `Failed to create PR (${createPRRes.status}): ${errorBody}`,
        filesWritten,
      }
    }

    const pr = await createPRRes.json() as GitPullResponse

    // ── Step 5: Label the PR ──
    // Create label if it doesn't exist (409 = already exists, ignore)
    await githubFetch('/labels', {
      method: 'POST',
      body: JSON.stringify({
        name: 'factory-generated',
        color: '7057ff',
        description: 'PR generated by the Function Factory feedback loop',
      }),
    }).catch(() => {}) // Ignore label creation errors (409, network, etc.)

    // Apply label to the PR
    await githubFetch(`/issues/${pr.number}/labels`, {
      method: 'POST',
      body: JSON.stringify({
        labels: ['factory-generated'],
      }),
    }).catch(() => {}) // Label application is best-effort

    return {
      success: true,
      prUrl: pr.html_url,
      prNumber: pr.number,
      branchName,
      filesWritten,
      ...(filesNotFound.length > 0 ? { filesNotFound } : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
    }
  } catch (err) {
    return {
      success: false,
      branchName,
      error: err instanceof Error ? err.message : String(err),
      filesWritten,
    }
  }
}
