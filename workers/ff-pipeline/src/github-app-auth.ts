const GITHUB_API = 'https://api.github.com'

interface InstallationResponse {
  id: number
}

interface InstallationTokenResponse {
  token: string
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function base64UrlEncode(bytes: Uint8Array): string {
  return bytesToBase64(bytes)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function jsonBase64Url(value: unknown): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)))
}

function pemToDer(privateKeyPem: string): Uint8Array {
  const normalized = privateKeyPem.replace(/\\n/g, '\n').trim()
  const base64 = normalized
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '')

  return base64ToBytes(base64)
}

async function createJwt(appId: string, privateKeyPem: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const payload = {
    iss: appId,
    iat: now - 60,
    exp: now + 600,
  }

  const encodedHeader = jsonBase64Url(header)
  const encodedPayload = jsonBase64Url(payload)
  const signingInput = `${encodedHeader}.${encodedPayload}`

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(privateKeyPem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const signature = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    new TextEncoder().encode(signingInput),
  )

  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`
}

function appHeaders(jwt: string): Record<string, string> {
  return {
    'Authorization': `Bearer ${jwt}`,
    'Accept': 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'ff-pipeline',
  }
}

async function exchangeInstallationToken(
  appId: string,
  privateKeyPem: string,
  owner: string,
  repo: string,
): Promise<string> {
  const jwt = await createJwt(appId, privateKeyPem)

  const installationRes = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/installation`,
    { method: 'GET', headers: appHeaders(jwt) },
  )

  if (!installationRes.ok) {
    const body = await installationRes.text()
    throw new Error(`Failed to get GitHub App installation (${installationRes.status}): ${body}`)
  }

  const installation = await installationRes.json() as InstallationResponse

  const tokenRes = await fetch(
    `${GITHUB_API}/app/installations/${installation.id}/access_tokens`,
    { method: 'POST', headers: appHeaders(jwt) },
  )

  if (!tokenRes.ok) {
    const body = await tokenRes.text()
    throw new Error(`Failed to create GitHub App installation token (${tokenRes.status}): ${body}`)
  }

  const token = await tokenRes.json() as InstallationTokenResponse
  return token.token
}

export async function getInstallationToken(
  appId: string,
  privateKeyPem: string,
  owner: string,
  repo: string,
): Promise<string> {
  try {
    return await exchangeInstallationToken(appId, privateKeyPem, owner, repo)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (!message.includes('(401)')) throw err
    return exchangeInstallationToken(appId, privateKeyPem, owner, repo)
  }
}
