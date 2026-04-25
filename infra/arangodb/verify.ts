import { readdir, readFile } from 'node:fs/promises'
import { join, extname, basename } from 'node:path'

const ARANGO_URL = process.env.ARANGO_URL ?? 'http://localhost:8529'
const ARANGO_DB = process.env.ARANGO_DB ?? 'function_factory'
const ARANGO_USER = process.env.ARANGO_USER ?? 'root'
const ARANGO_PASS = process.env.ARANGO_PASS ?? 'factory-dev'

const SPECS_ROOT = join(import.meta.dirname, '..', '..', 'specs')
const MEMORY_ROOT = join(import.meta.dirname, '..', '..', '.agent', 'memory')

const auth = Buffer.from(`${ARANGO_USER}:${ARANGO_PASS}`).toString('base64')

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

const MEMORY_TIERS: Record<string, string> = {
  semantic: 'memory_semantic',
  working: 'memory_working',
  personal: 'memory_personal',
}

type Diff = {
  collection: string
  type: 'missing-in-db' | 'missing-on-disk' | 'field-mismatch'
  key: string
  detail?: string
}

async function arangoQuery(query: string, bindVars: Record<string, unknown> = {}): Promise<unknown[]> {
  const res = await fetch(`${ARANGO_URL}/_db/${ARANGO_DB}/_api/cursor`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, bindVars }),
  })
  const json = await res.json() as { result: unknown[], error: boolean, errorMessage?: string }
  if (json.error) throw new Error(json.errorMessage)
  return json.result
}

function parseYamlId(content: string): string | null {
  const match = content.match(/^id:\s*(.+)$/m)
  return match ? match[1].trim() : null
}

function parseYamlSourceRefs(content: string): string[] {
  const refs: string[] = []
  const lines = content.split('\n')
  let inSourceRefs = false
  for (const line of lines) {
    if (/^source_refs:/.test(line)) {
      inSourceRefs = true
      const inline = line.replace('source_refs:', '').trim()
      if (inline === '[]') return []
      continue
    }
    if (inSourceRefs) {
      if (line.trim().startsWith('- ')) {
        refs.push(line.trim().slice(2).trim().replace(/^["']|["']$/g, ''))
      } else if (line.trim() && !line.startsWith(' ') && !line.startsWith('\t')) {
        break
      }
    }
  }
  return refs
}

async function verifySpecs(): Promise<Diff[]> {
  const diffs: Diff[] = []

  for (const [dir, collection] of Object.entries(SPEC_DIRS)) {
    const dirPath = join(SPECS_ROOT, dir)
    let diskFiles: string[]
    try {
      diskFiles = await readdir(dirPath)
    } catch {
      continue
    }

    const specFiles = diskFiles.filter(f => extname(f) === '.yaml' || extname(f) === '.md')

    const dbDocs = await arangoQuery(
      `FOR d IN @@col RETURN { _key: d._key, id: d.id, source_refs: d.source_refs }`,
      { '@col': collection }
    ) as { _key: string, id?: string, source_refs?: string[] }[]
    const dbKeys = new Set(dbDocs.map(d => d._key))

    for (const file of specFiles) {
      const content = await readFile(join(dirPath, file), 'utf-8')
      const id = parseYamlId(content) ?? basename(file, extname(file))

      if (!dbKeys.has(id)) {
        diffs.push({ collection, type: 'missing-in-db', key: id })
        continue
      }

      const dbDoc = dbDocs.find(d => d._key === id)!
      const diskRefs = parseYamlSourceRefs(content)
      const rawRefs = dbDoc.source_refs
      const dbRefs = Array.isArray(rawRefs) ? rawRefs as string[] : []

      const diskRefSet = new Set(diskRefs.filter(r => typeof r === 'string'))
      const dbRefSet = new Set(dbRefs.filter(r => typeof r === 'string'))

      const missingInDb = [...diskRefSet].filter(r => !dbRefSet.has(r))
      const extraInDb = [...dbRefSet].filter(r => !diskRefSet.has(r))

      if (missingInDb.length > 0 || extraInDb.length > 0) {
        diffs.push({
          collection,
          type: 'field-mismatch',
          key: id,
          detail: `source_refs: disk has [${missingInDb.join(',')}] not in DB; DB has [${extraInDb.join(',')}] not on disk`,
        })
      }
    }

    const diskIds = new Set(
      await Promise.all(specFiles.map(async (file) => {
        const content = await readFile(join(dirPath, file), 'utf-8')
        return parseYamlId(content) ?? basename(file, extname(file))
      }))
    )

    for (const dbDoc of dbDocs) {
      if (!diskIds.has(dbDoc._key)) {
        diffs.push({ collection, type: 'missing-on-disk', key: dbDoc._key })
      }
    }
  }

  return diffs
}

async function verifyMemory(): Promise<Diff[]> {
  const diffs: Diff[] = []

  for (const [tier, collection] of Object.entries(MEMORY_TIERS)) {
    const tierPath = join(MEMORY_ROOT, tier)
    let diskFiles: string[]
    try {
      diskFiles = (await readdir(tierPath)).filter(f => extname(f) === '.md')
    } catch {
      continue
    }

    const dbDocs = await arangoQuery(
      `FOR d IN @@col RETURN d._key`,
      { '@col': collection }
    ) as string[]
    const dbKeys = new Set(dbDocs)

    for (const file of diskFiles) {
      const key = basename(file, '.md')
      if (!dbKeys.has(key)) {
        diffs.push({ collection, type: 'missing-in-db', key })
      }
    }

    const diskKeys = new Set(diskFiles.map(f => basename(f, '.md')))
    for (const dbKey of dbDocs) {
      if (!diskKeys.has(dbKey)) {
        diffs.push({ collection, type: 'missing-on-disk', key: dbKey })
      }
    }
  }

  return diffs
}

async function verifyLineageEdges(): Promise<{ total: number, danglingFrom: number, danglingTo: number }> {
  const [total] = await arangoQuery('RETURN LENGTH(lineage_edges)') as number[]

  const danglingFromResult = await arangoQuery(`
    FOR e IN lineage_edges
      LET fromDoc = DOCUMENT(e._from)
      FILTER fromDoc == null
      RETURN e._from
  `) as string[]

  const danglingToResult = await arangoQuery(`
    FOR e IN lineage_edges
      LET toDoc = DOCUMENT(e._to)
      FILTER toDoc == null
      RETURN e._to
  `) as string[]

  return {
    total,
    danglingFrom: danglingFromResult.length,
    danglingTo: danglingToResult.length,
  }
}

async function main() {
  console.log('Function Factory — ArangoDB Round-Trip Verification')
  console.log(`Target: ${ARANGO_URL}/_db/${ARANGO_DB}\n`)

  console.log('Verifying specs...')
  const specDiffs = await verifySpecs()

  console.log('Verifying memory...')
  const memDiffs = await verifyMemory()

  console.log('Verifying lineage edges...')
  const edgeStats = await verifyLineageEdges()

  const allDiffs = [...specDiffs, ...memDiffs]

  console.log('\n=== Results ===\n')

  if (allDiffs.length === 0) {
    console.log('PASS — all flat files match ArangoDB documents')
  } else {
    console.log(`DIFFS FOUND: ${allDiffs.length}\n`)
    for (const d of allDiffs) {
      const icon = d.type === 'missing-in-db' ? '⊖ DB'
        : d.type === 'missing-on-disk' ? '⊕ DB'
        : '≠'
      console.log(`  ${icon}  ${d.collection}/${d.key}${d.detail ? ` — ${d.detail}` : ''}`)
    }
  }

  console.log(`\nLineage edges: ${edgeStats.total} total`)
  if (edgeStats.danglingFrom > 0) {
    console.log(`  ⚠ ${edgeStats.danglingFrom} edges with missing _from document`)
  }
  if (edgeStats.danglingTo > 0) {
    console.log(`  ⚠ ${edgeStats.danglingTo} edges with missing _to document`)
  }
  if (edgeStats.danglingFrom === 0 && edgeStats.danglingTo === 0) {
    console.log('  All edges resolve to existing documents')
  }

  const exitCode = allDiffs.length > 0 ? 1 : 0
  console.log(`\n${exitCode === 0 ? 'PASS' : 'FAIL'} — ${allDiffs.length} diffs, ${edgeStats.danglingFrom + edgeStats.danglingTo} dangling edges`)
  process.exit(exitCode)
}

main().catch(err => {
  console.error('Verification failed:', err.message)
  process.exit(2)
})
