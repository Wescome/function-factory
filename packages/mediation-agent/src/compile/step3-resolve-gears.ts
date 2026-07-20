/**
 * Step 3 — Resolve Gear Bindings
 *
 * Looks up each Gear from the KV Gear Registry (KV_KS namespace).
 * Keys are stored as "gear:{gearId}" -> JSON-serialized Gear.
 *
 * Also produces ToolSchemaEntry[] per atom from the Gear's toolPolicy.allowed list.
 * Since full tool schemas are not stored in the Gear Registry in this pass,
 * we synthesize minimal ToolSchemaEntry objects from the tool names.
 * A future step can hydrate these from a dedicated tool schema registry.
 *
 * SPEC-FF-ILAYER-EXEC-001 §3.2 step 3
 */

import { Gear } from '@factory/gears'
import type { ToolSchemaEntry } from '@factory/schemas'
import { CompileError, type WorkGraphAtom, type ResolvedAtomBinding } from '../types.js'

export async function resolveGearBindings(
  kv: KVNamespace,
  atoms: WorkGraphAtom[],
): Promise<ResolvedAtomBinding[]> {
  // Deduplicate gear IDs to avoid redundant KV fetches
  const uniqueGearIds = [...new Set(atoms.map((a) => a.gearId))]

  const gearMap = new Map<string, Gear>()
  await Promise.all(
    uniqueGearIds.map(async (gearId) => {
      const raw = await kv.get(`gear:${gearId}`, 'text')
      if (raw === null) {
        throw new CompileError(
          'missing_gear',
          `Gear '${gearId}' not found in KV Gear Registry (key: gear:${gearId}).`,
        )
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        throw new CompileError(
          'missing_gear',
          `Gear '${gearId}' in KV is not valid JSON.`,
        )
      }
      const result = Gear.safeParse(parsed)
      if (!result.success) {
        throw new CompileError(
          'missing_gear',
          `Gear '${gearId}' failed schema validation: ${result.error.message}`,
        )
      }
      gearMap.set(gearId, result.data)
    }),
  )

  return atoms.map((atom): ResolvedAtomBinding => {
    const gear = gearMap.get(atom.gearId)
    if (gear === undefined) {
      // Should not happen given the loop above, but TypeScript requires the check
      throw new CompileError('missing_gear', `Gear '${atom.gearId}' missing after fetch — this is a bug.`)
    }

    // Synthesize ToolSchemaEntry objects from the allowed tool names.
    // Real schemas would be hydrated from a tool schema registry; here we produce
    // minimal entries that pass CoherenceVerificationReport validation.
    const toolSchemas: ToolSchemaEntry[] = gear.toolPolicy.allowed.map((toolName): ToolSchemaEntry => ({
      name:             toolName,
      description:      `Tool: ${toolName}`,
      parametersSchema: {},
    }))

    return { atom, gear, toolSchemas }
  })
}
