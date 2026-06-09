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
  const errorNum = json.errorNum as number | undefined
  if (json.error && errorNum !== 1207 && errorNum !== 1210) {
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
    'specs_functions', 'intent_specifications', 'executable_specifications',
    'specs_invariants', 'verification_reports', 'specs_critic_reviews',
    'verification_status', 'trust_scores', 'invariant_health',
    'memory_episodic', 'memory_semantic', 'memory_working', 'memory_personal',
    'function_runs', 'execution_artifacts',
    'mentorscript_rules', 'consultation_requests',
    'version_controlled_resolutions', 'merge_readiness_packs',
    'merge_readiness_evidence', 'trellis_execution_packets',
    'lifecycle_transitions', 'hot_config',
    'config_aliases', 'config_routing', 'config_model_capabilities',
    'orl_telemetry', 'intent_anchors', 'compilation_drift_ledger',
    'completion_ledgers',
    'learning_run_transcripts', 'learning_observations',
    'learning_template_candidates', 'learning_template_usage',
    'learning_routing_observations', 'learning_consolidation_reports',
    'learning_mutation_journal', 'learning_routing_proposals',
    'learning_template_promotion_requests',
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

  const persistentIndexes = [
    { collection: 'learning_run_transcripts', fields: ['run_id'] },
    { collection: 'learning_run_transcripts', fields: ['final_verdict.status'] },
    { collection: 'learning_run_transcripts', fields: ['created_at'] },
    { collection: 'learning_run_transcripts', fields: ['source_refs[*]'] },
    { collection: 'learning_observations', fields: ['run_id'] },
    { collection: 'learning_observations', fields: ['kind'] },
    { collection: 'learning_observations', fields: ['created_at'] },
    { collection: 'learning_observations', fields: ['source_refs[*]'] },
    { collection: 'learning_template_candidates', fields: ['state'] },
    { collection: 'learning_template_candidates', fields: ['template_candidate_id'] },
    { collection: 'learning_template_candidates', fields: ['created_at'] },
    { collection: 'learning_template_candidates', fields: ['source_refs[*]'] },
    { collection: 'learning_template_usage', fields: ['template_candidate_id'] },
    { collection: 'learning_template_usage', fields: ['run_id'] },
    { collection: 'learning_template_usage', fields: ['created_at'] },
    { collection: 'learning_routing_observations', fields: ['task_kind'] },
    { collection: 'learning_routing_observations', fields: ['model'] },
    { collection: 'learning_routing_observations', fields: ['created_at'] },
    { collection: 'learning_routing_observations', fields: ['source_refs[*]'] },
    { collection: 'learning_routing_proposals', fields: ['state'] },
    { collection: 'learning_routing_proposals', fields: ['created_at'] },
    { collection: 'learning_routing_proposals', fields: ['reviewer'] },
    { collection: 'learning_template_promotion_requests', fields: ['state'] },
    { collection: 'learning_template_promotion_requests', fields: ['requested_at'] },
    { collection: 'learning_template_promotion_requests', fields: ['reviewer'] },
  ]

  console.log('\nCreating learning indexes...')
  for (const index of persistentIndexes) {
    try {
      await dbApi(`/_api/index?collection=${index.collection}`, {
        type: 'persistent',
        fields: index.fields,
      })
      console.log(`  + ${index.collection}(${index.fields.join(',')})`)
    } catch (e: any) {
      if (e.message.includes('1210') || e.message.includes('already exists')) {
        console.log(`  = ${index.collection}(${index.fields.join(',')}) (exists)`)
      } else {
        console.log(`  ! ${index.collection}(${index.fields.join(',')}): ${e.message}`)
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
          'specs_functions', 'intent_specifications', 'executable_specifications',
          'specs_invariants', 'verification_reports', 'specs_critic_reviews',
        ],
        to: [
          'specs_signals', 'specs_pressures', 'specs_capabilities',
          'specs_functions', 'intent_specifications', 'executable_specifications',
          'specs_invariants', 'verification_reports', 'specs_critic_reviews',
        ],
      }],
    },
    {
      name: 'assurance_graph',
      edgeDefinitions: [{
        collection: 'assurance_edges',
        from: ['specs_functions', 'specs_invariants'],
        to: ['specs_functions', 'specs_invariants', 'verification_reports'],
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
