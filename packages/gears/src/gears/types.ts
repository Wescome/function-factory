/**
 * @factory/gears — Gear, GearFormula, GearMolecule Zod schemas
 *
 * These types represent the Gear Registry vocabulary that replaces the
 * retired Gas City Pack/Formula/Molecule vocabulary.
 *
 * SPEC-FF-GEARS-001 §4
 */

import { z } from 'zod'
import {
  RoleModelBinding,
  ToolPolicy,
  SourceRef,
} from '@factory/schemas'
import { RoleName } from './role.js'

/** A single executable unit with a declared role and model binding. */
export const Gear = z.object({
  /** Content-addressed hash ID — GEAR-* prefix. */
  id:           z.string().regex(/^GEAR-/, 'Gear IDs must start with GEAR-'),
  name:         z.string().min(1),
  role:         RoleName,
  modelBinding: RoleModelBinding,
  /** Declared skill name — passed to session.skill() via AtomDirective.skillRef. */
  skillRef:     z.string().min(1),
  toolPolicy:   ToolPolicy,
  beadType:     z.string().min(1),
  source_refs:  z.array(SourceRef).default([]),
})
export type Gear = z.infer<typeof Gear>

/** A named sequence of Gears with dependency edges. */
export const GearFormula = z.object({
  /** FORMULA-* prefix. */
  id:         z.string().regex(/^FORMULA-/, 'GearFormula IDs must start with FORMULA-'),
  name:       z.string().min(1),
  gearIds:    z.array(z.string().min(1)),
  edges:      z.array(z.object({
    from: z.string().min(1),
    to:   z.string().min(1),
    type: z.string().min(1),
  })),
  source_refs: z.array(SourceRef).default([]),
})
export type GearFormula = z.infer<typeof GearFormula>

/** An instantiated bead set from a GearFormula for a specific run. */
export const GearMolecule = z.object({
  /** MOLECULE-* prefix. */
  id:        z.string().regex(/^MOLECULE-/, 'GearMolecule IDs must start with MOLECULE-'),
  formulaId: z.string().min(1),
  runId:     z.string().min(1),
  beadIds:   z.array(z.string().min(1)),
  status:    z.enum(['active', 'done', 'failed']),
  source_refs: z.array(SourceRef).default([]),
})
export type GearMolecule = z.infer<typeof GearMolecule>
