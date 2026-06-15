/**
 * @factory/commissioning-agent — DomainSkillRegistry
 *
 * Resolves skill refs for each vertical + phase combination.
 *
 * Skill ref prefixes:
 *   bundled:{name}   — T1, build-time import from src/skills/bundled/{name}.md
 *   workspace:{name} — T3, discovered from .agents/skills/{name}/SKILL.md in Think workspace
 *   spec:{path}      — T2, injected via POST /workspace/write before /signal
 *
 * Load order: base → phase-specific → additionals
 * Unknown vertical falls through to 'generic' (CA-INV-004)
 */

import type { Phase, Vertical } from './schemas.js'

type DomainSkillEntry = {
  /** Loaded for ALL phases */
  base: string[]
  /** Per-phase additive skills */
  phases: Partial<Record<Phase, string[]>>
}

export const DOMAIN_SKILL_REGISTRY: Record<string, DomainSkillEntry> = {
  'gtm-engineering': {
    base: ['bundled:factory-authoring-core'],
    phases: {
      'pattern-appraisal': ['bundled:gtm-signal-pattern-library'],
      deliberation: ['bundled:gtm-candidate-evaluation'],
      'workgraph-authoring': [
        'workspace:pressure-authoring',
        'workspace:capability-authoring',
        'workspace:function-proposal',
        'workspace:prd-authoring',
        'workspace:grill-me',
        'bundled:gtm-acceptance-criteria',
      ],
      'hypothesis-formation': ['bundled:gtm-fault-attribution'],
      'amendment-proposal': ['workspace:prd-authoring'],
    },
  },

  'healthcare-operations': {
    base: ['bundled:factory-authoring-core'],
    phases: {
      'pattern-appraisal': ['bundled:healthcare-signal-pattern-library'],
      deliberation: ['bundled:healthcare-candidate-evaluation'],
      'workgraph-authoring': [
        'workspace:pressure-authoring',
        'workspace:capability-authoring',
        'workspace:function-proposal',
        'workspace:prd-authoring',
        'workspace:grill-me',
        'bundled:healthcare-acceptance-criteria',
      ],
      'hypothesis-formation': ['bundled:healthcare-fault-attribution'],
      'amendment-proposal': ['workspace:prd-authoring'],
    },
  },

  'comeflow-commerce': {
    base: ['bundled:factory-authoring-core'],
    phases: {
      'pattern-appraisal': ['bundled:commerce-signal-pattern-library'],
      deliberation: ['bundled:commerce-candidate-evaluation'],
      'workgraph-authoring': [
        'workspace:pressure-authoring',
        'workspace:capability-authoring',
        'workspace:function-proposal',
        'workspace:prd-authoring',
        'workspace:grill-me',
      ],
      'hypothesis-formation': ['bundled:commerce-fault-attribution'],
      'amendment-proposal': ['workspace:prd-authoring'],
    },
  },

  'fintech-compliance': {
    base: ['bundled:factory-authoring-core'],
    phases: {
      'pattern-appraisal': ['bundled:fintech-signal-pattern-library'],
      deliberation: ['bundled:fintech-candidate-evaluation'],
      'workgraph-authoring': [
        'workspace:pressure-authoring',
        'workspace:capability-authoring',
        'workspace:function-proposal',
        'workspace:prd-authoring',
        'workspace:grill-me',
        'bundled:fintech-acceptance-criteria',
      ],
      'hypothesis-formation': ['bundled:fintech-fault-attribution'],
      'amendment-proposal': ['workspace:prd-authoring'],
    },
  },

  generic: {
    base: ['bundled:factory-authoring-core'],
    phases: {
      'pattern-appraisal': [],
      deliberation: [],
      'workgraph-authoring': [
        'workspace:pressure-authoring',
        'workspace:capability-authoring',
        'workspace:function-proposal',
        'workspace:prd-authoring',
        'workspace:grill-me',
      ],
      'hypothesis-formation': [],
      'amendment-proposal': ['workspace:prd-authoring'],
    },
  },
}

/**
 * Resolve the full ordered skill ref list for a given vertical + phase.
 * Unknown verticals fall through to 'generic' (CA-INV-004).
 * Deduplication via Set preserves first-occurrence order.
 */
export function resolveSkillRefs(
  vertical: Vertical | string,
  phase: Phase,
  additionals: string[],
): string[] {
  const entry = DOMAIN_SKILL_REGISTRY[vertical] ?? DOMAIN_SKILL_REGISTRY['generic']
  if (!entry) {
    // Should never happen — 'generic' is always present
    return [...new Set(additionals)]
  }

  const combined = [
    ...entry.base,
    ...(entry.phases[phase] ?? []),
    ...additionals,
  ]

  // Deduplicate preserving insertion order
  return [...new Set(combined)]
}

/**
 * Resolve only the bundled refs (those with 'bundled:' prefix).
 * Used by the skill loader to eagerly import .md content at DO startup.
 */
export function bundledRefsFor(vertical: Vertical | string, phase: Phase): string[] {
  return resolveSkillRefs(vertical, phase, []).filter((r) => r.startsWith('bundled:'))
}
