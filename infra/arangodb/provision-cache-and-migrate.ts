/**
 * One-time provisioning + lifecycle migration.
 *
 * Run: ARANGO_URL=https://40a1cdbd1797.arangodb.cloud:8529 ARANGO_USER=root ARANGO_PASS=<password> npx tsx infra/arangodb/provision-cache-and-migrate.ts
 */

const ARANGO_URL = process.env.ARANGO_URL ?? 'http://localhost:8529'
const ARANGO_DB = process.env.ARANGO_DB ?? 'function_factory'
const ARANGO_USER = process.env.ARANGO_USER ?? 'root'
const ARANGO_PASS = process.env.ARANGO_PASS ?? 'factory-dev'

const auth = Buffer.from(`${ARANGO_USER}:${ARANGO_PASS}`).toString('base64')

async function arangoFetch(path: string, body?: unknown): Promise<{ status: number; data: unknown }> {
  const url = `${ARANGO_URL}/_db/${ARANGO_DB}/_api/${path}`
  const res = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const data = await res.json()
  return { status: res.status, data }
}

async function main() {
  console.log(`\n=== Provisioning: ${ARANGO_URL}/_db/${ARANGO_DB} ===\n`)

  // 1. Create file_context_cache collection
  console.log('1. Creating file_context_cache collection...')
  const createRes = await arangoFetch('collection', { name: 'file_context_cache', type: 2 })
  if (createRes.status === 200 || createRes.status === 201) {
    console.log('   ✓ Created file_context_cache')
  } else if (createRes.status === 409) {
    console.log('   ✓ file_context_cache already exists')
  } else {
    console.log(`   ✗ Failed: ${JSON.stringify(createRes.data)}`)
  }

  // 2. Lifecycle migration: implemented → produced
  console.log('\n2. Migrating lifecycle: implemented → produced...')
  const migrateProduced = await arangoFetch('cursor', {
    query: `FOR f IN specs_functions FILTER f.lifecycleState == 'implemented' UPDATE f WITH { lifecycleState: 'produced' } IN specs_functions RETURN 1`,
  })
  const producedCount = Array.isArray((migrateProduced.data as any)?.result) ? (migrateProduced.data as any).result.length : 0
  console.log(`   ✓ Migrated ${producedCount} documents`)

  // 3. Lifecycle migration: verified → accepted
  console.log('\n3. Migrating lifecycle: verified → accepted...')
  const migrateAccepted = await arangoFetch('cursor', {
    query: `FOR f IN specs_functions FILTER f.lifecycleState == 'verified' UPDATE f WITH { lifecycleState: 'accepted' } IN specs_functions RETURN 1`,
  })
  const acceptedCount = Array.isArray((migrateAccepted.data as any)?.result) ? (migrateAccepted.data as any).result.length : 0
  console.log(`   ✓ Migrated ${acceptedCount} documents`)

  // 4. Check pending signals
  console.log('\n4. Checking pending signals...')
  const signalsRes = await arangoFetch('cursor', {
    query: `FOR s IN specs_signals FILTER s.status == 'pending' OR s.status == null SORT s.created_at DESC LIMIT 5 RETURN { _key: s._key, title: s.title, subtype: s.subtype, created_at: s.created_at }`,
  })
  const signals = (signalsRes.data as any)?.result ?? []
  if (signals.length > 0) {
    console.log(`   Found ${signals.length} pending signals:`)
    for (const s of signals) {
      console.log(`   - ${s._key}: ${s.title} (${s.subtype ?? 'no subtype'})`)
    }
  } else {
    console.log('   No pending signals found')
  }

  // 5. Check current lifecycle state distribution
  console.log('\n5. Lifecycle state distribution...')
  const lifecycleRes = await arangoFetch('cursor', {
    query: `FOR f IN specs_functions COLLECT state = f.lifecycleState WITH COUNT INTO c RETURN { state, count: c }`,
  })
  const states = (lifecycleRes.data as any)?.result ?? []
  for (const s of states) {
    console.log(`   ${s.state ?? 'null'}: ${s.count}`)
  }

  console.log('\n=== Done ===\n')
}

main().catch(console.error)
