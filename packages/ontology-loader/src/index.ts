/**
 * @module ontology-loader
 *
 * Loads the Function Factory OWL ontology (factory-ontology.ttl) and SHACL
 * constraints (factory-shapes.ttl) into ArangoDB as queryable documents.
 *
 * No RDF/Turtle parser — the ontology is manually translated to TypeScript
 * constants. This is a one-time translation that makes the ontology queryable
 * by agents at runtime.
 *
 * Collections populated:
 *   ontology_classes     — OWL classes with hierarchy (rdfs:subClassOf)
 *   ontology_properties  — OWL properties with domain/range
 *   ontology_constraints — SHACL shapes as queryable documents
 *   ontology_instances   — Named instances (roles, tools, infrastructure)
 *
 * Query helpers:
 *   getConstraintsForClass — "What constraints apply to X?"
 *   getRoleSpec            — "What tools should role Y have?"
 *   getLifecycleState      — "What state is Function FN-XXX in?"
 *   getPendingCRPs         — "Are there pending CRPs?"
 *   getPersistenceTarget   — "What collection does class X persist to?"
 */

import type { ArangoClient } from '@factory/arango-client'

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export interface OntologyClass {
  _key: string
  uri: string
  label: string
  superClass?: string
  domain: string
  comment: string
  persistsIn?: string
  enumValues?: string[]
}

export interface OntologyProperty {
  _key: string
  uri: string
  label: string
  propertyType: 'object' | 'datatype'
  domain?: string
  range?: string
  superProperty?: string
  comment: string
}

export interface OntologyConstraint {
  _key: string
  constraintId: string
  name: string
  shapeName: string
  targetClasses: string[]
  severity: 'violation' | 'warning' | 'info'
  message: string
  requiredProperties?: string[]
  optionalProperties?: string[]
  minCount?: number
  sparqlCheck?: boolean
  confidenceThreshold?: number
  secretPatterns?: string[]
  lifecycleRules?: { from: string; to: string; requires?: string }[]
  additionalChecks?: Record<string, unknown>[]
}

export interface OntologyInstance {
  _key: string
  uri: string
  type: string
  label?: string
  comment?: string
  // Agent role specific
  tools?: string[]
  permissions?: string[]
  memoryAccess?: string[]
  runsIn?: string
}

export interface SeedResult {
  classes: number
  properties: number
  constraints: number
  instances: number
}

// ════════════��══════════════════════════════════════════════════════
// RE-EXPORT DATA
// ═══════════════════════════════════════════════════════════════════

export { ONTOLOGY_CLASSES } from './classes.js'
export { ONTOLOGY_PROPERTIES } from './properties.js'
export { ONTOLOGY_CONSTRAINTS } from './constraints.js'
export { ONTOLOGY_INSTANCES } from './instances.js'
export { buildOntologyTool } from './ontology-tool.js'

// Import for use in seed/query functions
import { ONTOLOGY_CLASSES } from './classes.js'
import { ONTOLOGY_PROPERTIES } from './properties.js'
import { ONTOLOGY_CONSTRAINTS } from './constraints.js'
import { ONTOLOGY_INSTANCES } from './instances.js'

// ═══════════════════════��═══════════════════════════���═══════════════
// SEED FUNCTION
// ══════���════════════════════════════════════════════════════════════

/**
 * Seed all ontology data into ArangoDB collections.
 *
 * Upserts each document — safe to call multiple times.
 * Returns counts of successfully seeded documents per collection.
 */
export async function seedOntology(db: ArangoClient): Promise<SeedResult> {
  let classes = 0
  let properties = 0
  let constraints = 0
  let instances = 0

  for (const cls of ONTOLOGY_CLASSES) {
    try {
      await db.save('ontology_classes', cls as unknown as Record<string, unknown>)
      classes++
    } catch {
      // Ignore duplicate/conflict errors — upsert semantics
    }
  }

  for (const prop of ONTOLOGY_PROPERTIES) {
    try {
      await db.save('ontology_properties', prop as unknown as Record<string, unknown>)
      properties++
    } catch {
      // Ignore duplicate/conflict errors
    }
  }

  for (const constraint of ONTOLOGY_CONSTRAINTS) {
    try {
      await db.save('ontology_constraints', constraint as unknown as Record<string, unknown>)
      constraints++
    } catch {
      // Ignore duplicate/conflict errors
    }
  }

  for (const instance of ONTOLOGY_INSTANCES) {
    try {
      await db.save('ontology_instances', instance as unknown as Record<string, unknown>)
      instances++
    } catch {
      // Ignore duplicate/conflict errors
    }
  }

  return { classes, properties, constraints, instances }
}

// ════════════════════���══════════════════════════════════════════════
// QUERY HELPERS
// ════════════════════════��════════════════════════════════���═════════

/**
 * What constraints apply to a given artifact type?
 *
 * Queries ontology_constraints for any constraint whose targetClasses
 * includes the given class name.
 */
export async function getConstraintsForClass(
  db: ArangoClient,
  className: string,
): Promise<OntologyConstraint[]> {
  return db.query<OntologyConstraint>(
    `FOR c IN ontology_constraints
       FILTER @className IN c.targetClasses
       RETURN c`,
    { className },
  )
}

/**
 * What tools should a role have?
 *
 * Returns the full instance document for a given role key.
 */
export async function getRoleSpec(
  db: ArangoClient,
  roleKey: string,
): Promise<OntologyInstance | null> {
  return db.queryOne<OntologyInstance>(
    `FOR i IN ontology_instances
       FILTER i._key == @key
       RETURN i`,
    { key: roleKey },
  )
}

/**
 * What's the lifecycle state of a function?
 *
 * Queries specs_functions for the lifecycleState field.
 */
export async function getLifecycleState(
  db: ArangoClient,
  functionKey: string,
): Promise<string | null> {
  const result = await db.queryOne<{ lifecycleState: string }>(
    `FOR f IN specs_functions
       FILTER f._key == @key
       RETURN { lifecycleState: f.lifecycleState }`,
    { key: functionKey },
  )
  return result?.lifecycleState ?? null
}

/**
 * Are there pending CRPs?
 *
 * Queries consultation_requests for status == "pending".
 */
export async function getPendingCRPs(
  db: ArangoClient,
): Promise<{ _key: string; context: string; confidence: number }[]> {
  return db.query<{ _key: string; context: string; confidence: number }>(
    `FOR c IN consultation_requests
       FILTER c.status == "pending"
       RETURN { _key: c._key, context: c.context, confidence: c.confidence }`,
  )
}

/**
 * What collection does a class persist to?
 *
 * Queries ontology_classes for the persistsIn field.
 */
export async function getPersistenceTarget(
  db: ArangoClient,
  className: string,
): Promise<string | null> {
  const result = await db.queryOne<{ persistsIn: string }>(
    `FOR c IN ontology_classes
       FILTER c._key == @className
       RETURN { persistsIn: c.persistsIn }`,
    { className },
  )
  return result?.persistsIn ?? null
}
