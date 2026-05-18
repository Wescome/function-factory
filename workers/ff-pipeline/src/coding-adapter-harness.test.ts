import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '../../..')

describe('coding-adapter harness production worker routing', () => {
  it('routes non-preseed coding-adapter roles through pi-author autonomous filesystem execution', () => {
    const text = readFileSync(join(repoRoot, 'harnesses/coding-adapter.harness.yaml'), 'utf8')
    const workerLines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith('worker: '))

    expect(workerLines).toEqual([
      'worker: preseed',
      'worker: pi-author',
      'worker: pi-author',
      'worker: pi-author',
      'worker: pi-author',
      'worker: pi-author',
    ])
    expect(text).not.toContain('worker: pi\n')
  })

  it('requires verifier to apply patches with git and avoid unavailable python tooling', () => {
    const text = readFileSync(join(repoRoot, 'harnesses/coding-adapter.harness.yaml'), 'utf8')

    expect(text).toContain('git apply')
    expect(text).toContain('Do not use python')
    expect(text).toContain('declared Node test command')
  })

  it('builds the pi authoring container with git for real patch verification', () => {
    const text = readFileSync(join(repoRoot, 'workers/ff-pipeline/pi-container/Dockerfile'), 'utf8')

    expect(text).toContain('apt-get install')
    expect(text).toContain('git')
  })
})
