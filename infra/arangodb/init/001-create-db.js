// ArangoDB init script — runs on first container start
// Creates the function_factory database and all collections per FINAL-DEPLOYMENT-ARCHITECTURE §8

const db = require('@arangodb').db;
const dbName = 'function_factory';

if (!db._databases().includes(dbName)) {
  db._createDatabase(dbName);
}

db._useDatabase(dbName);

// ── Spec collections (Factory domain) ──
const docCollections = [
  'specs_signals',
  'specs_pressures',
  'specs_capabilities',
  'specs_functions',
  'specs_prds',
  'specs_workgraphs',
  'specs_invariants',
  'specs_coverage_reports',
  'specs_critic_reviews',

  // Gate + trust state
  'gate_status',
  'trust_scores',
  'invariant_health',

  // Memory tiers
  'memory_episodic',
  'memory_semantic',
  'memory_working',
  'memory_personal',

  // Execution domain (populated in Phase 5)
  'function_runs',
  'execution_artifacts',
];

for (const name of docCollections) {
  if (!db._collection(name)) {
    db._createDocumentCollection(name);
    console.log(`Created document collection: ${name}`);
  }
}

// ── Edge collections (graph domain) ──
const edgeCollections = [
  'lineage_edges',
  'assurance_edges',
  'dependency_edges',
];

for (const name of edgeCollections) {
  if (!db._collection(name)) {
    db._createEdgeCollection(name);
    console.log(`Created edge collection: ${name}`);
  }
}

// ── Named graphs ──
const graphModule = require('@arangodb/general-graph');

const graphs = [
  {
    name: 'lineage_graph',
    edgeDefs: [{
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
    edgeDefs: [{
      collection: 'assurance_edges',
      from: ['specs_functions', 'specs_invariants'],
      to: ['specs_functions', 'specs_invariants', 'specs_coverage_reports'],
    }],
  },
  {
    name: 'dependency_graph',
    edgeDefs: [{
      collection: 'dependency_edges',
      from: ['specs_functions', 'specs_capabilities'],
      to: ['specs_functions', 'specs_capabilities'],
    }],
  },
];

for (const g of graphs) {
  if (!graphModule._list().includes(g.name)) {
    graphModule._create(g.name, g.edgeDefs);
    console.log(`Created graph: ${g.name}`);
  }
}

console.log('Function Factory database initialized.');
