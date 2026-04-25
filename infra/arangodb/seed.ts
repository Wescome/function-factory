import { readdir, readFile } from 'node:fs/promises'
import { join, extname, basename } from 'node:path'
import YAML from 'yaml'

const ARANGO_URL = process.env.ARANGO_URL ?? 'http://localhost:8529'
const ARANGO_DB = process.env.ARANGO_DB ?? 'function_factory'
const ARANGO_USER = process.env.ARANGO_USER ?? 'root'
const ARANGO_PASS = process.env.ARANGO_PASS ?? 'factory-dev'

const SPECS_ROOT = join(import.meta.dirname, '..', '..', 'specs')

const SPEC_DIRS: Record<string, string> = {
  signals: 'specs_signals',
  pressures: 'specs_pressures',
  capabilities: 'specs_capabilities',
  functions: 'specs_functions',
  prds: 'specs_prds',
  workgraphs: 'specs_workgraphs',
  invariants: 'specs_invariants',
  'coverage-reports': 'specs_coverage_reports',
  'critic-reviews': 'specs_critic_reviews',
}

const auth = Buffer.from(`${ARANGO_USER}:${ARANGO_PASS}`).toString('base64')

async function arangoFetch(path: string, body?: unknown): Promise<unknown> {
  const url = `${ARANGO_URL}/_db/${ARANGO_DB}/_api/${path}`
  const res = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok && res.status !== 409) {
    const text = await res.text()
    throw new Error(`ArangoDB ${res.status}: ${text}`)
  }
  return res.json()
}

async function upsertDoc(collection: string, doc: Record<string, unknown>) {
  const key = doc._key as string
  await arangoFetch('cursor', {
    query: `
      UPSERT { _key: @key }
      INSERT @doc
      UPDATE @doc
      IN @@collection
    `,
    bindVars: { key, doc, '@collection': collection },
  })
}

async function insertEdge(from: string, to: string, type: string) {
  await arangoFetch('cursor', {
    query: `
      UPSERT { _from: @from, _to: @to, type: @type }
      INSERT { _from: @from, _to: @to, type: @type }
      UPDATE {}
      IN lineage_edges
    `,
    bindVars: { from, to, type },
  })
}

function parseYamlFile(content: string): Record<string, unknown> {
  return YAML.parse(content) ?? {}
}

function parsePrdFrontmatter(content: string): Record<string, unknown> {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  const result: Record<string, unknown> = match ? YAML.parse(match[1]) ?? {} : {}
  result.content = content
  return result
}

function resolveCollection(artifactId: string): string | null {
  const prefix = artifactId.split('-')[0]
  const map: Record<string, string> = {
    SIG: 'specs_signals',
    PRS: 'specs_pressures',
    BC: 'specs_capabilities',
    FP: 'specs_functions',
    FN: 'specs_functions',
    PRD: 'specs_prds',
    WG: 'specs_workgraphs',
    INV: 'specs_invariants',
    CR: 'specs_coverage_reports',
    CRV: 'specs_critic_reviews',
    CONTRACT: 'specs_functions',
    ATOM: 'specs_prds',
  }
  return map[prefix] ?? null
}

async function seedSpecs() {
  let totalDocs = 0
  let totalEdges = 0

  for (const [dir, collection] of Object.entries(SPEC_DIRS)) {
    const dirPath = join(SPECS_ROOT, dir)
    let files: string[]
    try {
      files = await readdir(dirPath)
    } catch {
      console.log(`  skip ${dir}/ (not found)`)
      continue
    }

    const specFiles = files.filter(f => extname(f) === '.yaml' || extname(f) === '.md')

    for (const file of specFiles) {
      const content = await readFile(join(dirPath, file), 'utf-8')
      let doc: Record<string, unknown>

      if (extname(file) === '.md') {
        doc = parsePrdFrontmatter(content)
      } else {
        doc = parseYamlFile(content)
      }

      const id = (doc.id as string) ?? basename(file, extname(file))
      doc._key = id

      await upsertDoc(collection, doc)
      totalDocs++

      const sourceRefs = doc.source_refs as string[] | undefined
      if (sourceRefs && Array.isArray(sourceRefs)) {
        for (const ref of sourceRefs) {
          if (typeof ref !== 'string') continue
          const targetCollection = resolveCollection(ref)
          if (targetCollection) {
            const fromId = `${collection}/${id}`
            const toId = `${targetCollection}/${ref}`
            try {
              await insertEdge(fromId, toId, 'derived_from')
              totalEdges++
            } catch {
              // target may not exist yet
            }
          }
        }
      }
    }

    console.log(`  ${collection}: ${specFiles.length} docs`)
  }

  console.log(`\nSeeded ${totalDocs} documents, ${totalEdges} lineage edges`)
}

async function seedMemory() {
  const memoryRoot = join(import.meta.dirname, '..', '..', '.agent', 'memory')

  const tiers: Record<string, string> = {
    episodic: 'memory_episodic',
    semantic: 'memory_semantic',
    working: 'memory_working',
    personal: 'memory_personal',
  }

  for (const [tier, collection] of Object.entries(tiers)) {
    const tierPath = join(memoryRoot, tier)
    let files: string[]
    try {
      files = await readdir(tierPath)
    } catch {
      continue
    }

    const mdFiles = files.filter(f => extname(f) === '.md')
    for (const file of mdFiles) {
      const content = await readFile(join(tierPath, file), 'utf-8')
      const key = basename(file, '.md')
      await upsertDoc(collection, {
        _key: key,
        filename: file,
        content,
        tier,
        seededAt: new Date().toISOString(),
      })
    }
    console.log(`  ${collection}: ${mdFiles.length} entries`)
  }
}

async function verifyGraph() {
  const collections = [
    'specs_signals', 'specs_pressures', 'specs_capabilities',
    'specs_functions', 'specs_prds', 'specs_workgraphs',
    'specs_coverage_reports', 'specs_critic_reviews',
  ]

  console.log('\n=== Verification ===')
  for (const col of collections) {
    const res = await arangoFetch('cursor', {
      query: `RETURN LENGTH(FOR d IN @@col RETURN 1)`,
      bindVars: { '@col': col },
    }) as { result: number[] }
    console.log(`  ${col}: ${res.result[0]} docs`)
  }

  const edgeRes = await arangoFetch('cursor', {
    query: `RETURN LENGTH(FOR e IN lineage_edges RETURN 1)`,
  }) as { result: number[] }
  console.log(`  lineage_edges: ${edgeRes.result[0]} edges`)
}

async function main() {
  console.log('Function Factory — ArangoDB Seed')
  console.log(`Target: ${ARANGO_URL}/_db/${ARANGO_DB}\n`)

  console.log('Seeding specs...')
  await seedSpecs()

  console.log('\nSeeding memory...')
  await seedMemory()

  await verifyGraph()

  console.log('\nDone.')
}

main().catch(err => {
  console.error('Seed failed:', err.message)
  process.exit(1)
})
