/**
 * Skeleton builder — seeds the Gas City workspace from a GitHub tarball snapshot
 * BEFORE the agent runs, so a baseline git commit exists and `git add -A && git
 * diff --cached` captures every agent-written file.
 *
 * Root cause this fixes: Gas City containers start with an empty `/workspace`.
 * The agent writes new TypeScript files, but `git diff HEAD` produces nothing
 * because the files are untracked, yielding a 440-byte empty CandidatePatch.
 *
 * Flow:
 *   1. buildSkeleton() fetches the repo tarball, uploads to R2, writes a manifest.
 *   2. The pipeline emits a signed download URL into the formula vars.
 *   3. The coding formula's `init` step curls the URL, untars into the rig root,
 *      and creates a baseline `git commit` before the agent fires.
 *
 * SPEC-FF-SEEDWORKSPACE-001
 */

export interface SkeletonEnv {
  GITHUB_TOKEN: string
  WORKSPACE_BUCKET: R2Bucket
  GAS_CITY_HMAC_SECRET_V1: string
}

export interface SkeletonManifest {
  _key: string
  functionId: string
  r2Key: string
  skeletonSha: string
  producedAt: string
  expiresAt: string
}

/** Minimal ArangoDB client surface used here (matches @factory/arango-client). */
interface SkeletonDb {
  ensureCollection(name: string): Promise<void>
  save(collection: string, doc: Record<string, unknown>): Promise<unknown>
}

const GITHUB_OWNER_REPO = 'Wescome/function-factory'
const SKELETON_TTL_MS = 24 * 60 * 60 * 1000 // 24h
const TWO_HOUR_WINDOW_MS = 2 * 3600 * 1000

/**
 * Fetch the repo tarball, upload it to R2, and record a manifest in ArangoDB.
 * Returns the R2 key and the (12-char) HEAD commit SHA used for the snapshot.
 */
export async function buildSkeleton(
  env: SkeletonEnv,
  db: SkeletonDb,
  functionId: string,
): Promise<{ r2Key: string; skeletonSha: string }> {
  const isoTimestamp = new Date().toISOString()
  // R2 keys must not contain colons from the ISO timestamp.
  const safeTimestamp = isoTimestamp.replace(/:/g, '-')
  const r2Key = `skeletons/${functionId}/${safeTimestamp}.tar.gz`

  const authHeaders = {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'ff-pipeline-skeleton-builder',
  }

  // GitHub's tarball endpoint redirects to the actual archive URL; `fetch()` in
  // CF Workers follows redirects by default.
  const tarballResp = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER_REPO}/tarball/main`,
    { headers: authHeaders },
  )
  if (!tarballResp.ok || !tarballResp.body) {
    throw new Error(
      `skeleton tarball fetch failed: ${tarballResp.status} ${tarballResp.statusText}`,
    )
  }

  // Prefer the commit SHA from the tarball response header; fall back to the
  // commits API. Always take the first 12 chars.
  let headSha = tarballResp.headers.get('x-github-commit-sha') ?? ''
  if (!headSha) {
    const commitResp = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER_REPO}/commits/main`,
      { headers: authHeaders },
    )
    if (commitResp.ok) {
      const commit = (await commitResp.json()) as { sha?: string }
      headSha = commit.sha ?? ''
    }
  }
  const skeletonSha = headSha ? headSha.slice(0, 12) : 'unknown'

  const tarballBytes = await tarballResp.arrayBuffer()
  await env.WORKSPACE_BUCKET.put(r2Key, tarballBytes, {
    httpMetadata: { contentType: 'application/gzip' },
  })

  const producedAtMs = Date.parse(isoTimestamp)
  const manifest: SkeletonManifest = {
    _key: `${functionId}-${safeTimestamp}`,
    functionId,
    r2Key,
    skeletonSha,
    producedAt: isoTimestamp,
    expiresAt: new Date(producedAtMs + SKELETON_TTL_MS).toISOString(),
  }
  await db.ensureCollection('skeleton_manifests')
  await db.save('skeleton_manifests', manifest as unknown as Record<string, unknown>)

  return { r2Key, skeletonSha }
}

/**
 * HMAC-SHA256 token over `"${r2Key}|${hourWindow}"`, where hourWindow is the
 * current 2-hour epoch window. Returns a lowercase hex string.
 */
export async function generateSkeletonToken(
  secret: string,
  r2Key: string,
): Promise<string> {
  const hourWindow = Math.floor(Date.now() / TWO_HOUR_WINDOW_MS)
  return hmacSha256Hex(secret, `${r2Key}|${hourWindow}`)
}

/** Build the signed `/skeleton-download` URL the formula `init` step curls. */
export async function getSkeletonDownloadUrl(
  baseUrl: string,
  r2Key: string,
  secret: string,
): Promise<string> {
  const token = await generateSkeletonToken(secret, r2Key)
  return `${baseUrl}/skeleton-download?key=${encodeURIComponent(r2Key)}&token=${token}`
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(message),
  )
  return bytesToHex(new Uint8Array(signature))
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = ''
  for (const b of bytes) hex += b.toString(16).padStart(2, '0')
  return hex
}
