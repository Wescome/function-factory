const ARANGO_URL = process.env.ARANGO_URL ?? 'http://localhost:8529'
const ARANGO_USER = process.env.ARANGO_USER ?? 'root'
const ARANGO_PASS = process.env.ARANGO_PASS ?? 'factory-dev'
const DB_NAME = 'function_factory'

const auth = Buffer.from(`${ARANGO_USER}:${ARANGO_PASS}`).toString('base64')

async function api(path: string, body?: unknown, method = body ? 'POST' : 'GET') {
  const res = await fetch(`${ARANGO_URL}${path}`, {
    method,
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json() as Record<string, unknown>
  if (json.error && (json.errorNum as number) !== 1207) {
    throw new Error(`${res.status}: ${JSON.stringify(json)}`)
  }
  return json
}

async function main() {
  // Create database
  console.log('Creating database...')
  try {
    await api('/_api/database', { name: DB_NAME, users: [{ username: ARANGO_USER }] })
    console.log(`  Created: ${DB_NAME}`)
  } catch (e: any) {
    if (e.message.includes('1207')) {
      console.log(`  Exists: ${DB_NAME}`)
    } else {
      throw e
    }
  }

  const dbApi = (path: string, body?: unknown) => api(`/_db/${DB_NAME}${path}`, body)

  // Document collections
  const docCollections = [
    'specs_signals', 'specs_pressures', 'specs_capabilities',
    'specs_functions', 'specs_prds', 'specs_workgraphs',
    'specs_invariants', 'specs_coverage_reports', 'specs_critic_reviews',
    'gate_status', 'trust_scores', 'invariant_health',
    'memory_episodic', 'memory_semantic', 'memory_working', 'memory_personal',
    'function_runs', 'execution_artifacts',
    'mentorscript_rules', 'consultation_requests',
    'version_controlled_resolutions', 'merge_readiness_packs',
  ]

  console.log('\nCreating document collections...')
  for (const name of docCollections) {
    try {
      await dbApi('/_api/collection', { name, type: 2 })
      console.log(`  + ${name}`)
    } catch (e: any) {
      if (e.message.includes('1207')) {
        console.log(`  = ${name} (exists)`)
      } else {
        console.log(`  ! ${name}: ${e.message}`)
      }
    }
  }

  // Edge collections
  const edgeCollections = ['lineage_edges', 'assurance_edges', 'dependency_edges']

  console.log('\nCreating edge collections...')
  for (const name of edgeCollections) {
    try {
      await dbApi('/_api/collection', { name, type: 3 })
      console.log(`  + ${name}`)
    } catch (e: any) {
      if (e.message.includes('1207')) {
        console.log(`  = ${name} (exists)`)
      } else {
        console.log(`  ! ${name}: ${e.message}`)
      }
    }
  }

  // Named graphs
  const graphs = [
    {
      name: 'lineage_graph',
      edgeDefinitions: [{
        collection: 'lineage_edges',
        from: [
          'specs_signals', 'specs_pressures', 'specs_capabilities',
          'specs_functions', 'specs_prds', 'specs_workgraphs',
          'specs_invariants', 'specs_coverage_reports', 'specs_critic_reviews',
        ],
        to: [
          'specs_signals', 'specs_pressures', 'specs_capabilities',
          'specs_functions', 'specs_prds', 'specs_workgraphs',
          'specs_invariants', 'specs_coverage_reports', 'specs_critic_reviews',
        ],
      }],
    },
    {
      name: 'assurance_graph',
      edgeDefinitions: [{
        collection: 'assurance_edges',
        from: ['specs_functions', 'specs_invariants'],
        to: ['specs_functions', 'specs_invariants', 'specs_coverage_reports'],
      }],
    },
    {
      name: 'dependency_graph',
      edgeDefinitions: [{
        collection: 'dependency_edges',
        from: ['specs_functions', 'specs_capabilities'],
        to: ['specs_functions', 'specs_capabilities'],
      }],
    },
  ]

  console.log('\nCreating named graphs...')
  for (const g of graphs) {
    try {
      await dbApi('/_api/gharial', g)
      console.log(`  + ${g.name}`)
    } catch (e: any) {
      if (e.message.includes('1925') || e.message.includes('already exists')) {
        console.log(`  = ${g.name} (exists)`)
      } else {
        console.log(`  ! ${g.name}: ${e.message}`)
      }
    }
  }

  // Verify
  const collections = await dbApi('/_api/collection') as { result: { name: string }[] }
  const userCollections = collections.result
    .filter(c => !c.name.startsWith('_'))
    .map(c => c.name)
    .sort()

  console.log(`\n=== ${DB_NAME} ready ===`)
  console.log(`Collections: ${userCollections.length}`)
  console.log(userCollections.map(c => `  ${c}`).join('\n'))
}

main().catch(err => {
  console.error('Init failed:', err)
  process.exit(1)
})
