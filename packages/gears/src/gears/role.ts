/**
 * Gear-domain RoleName — lowercase identifiers matching PROFILE_BY_ROLE keys.
 *
 * Note: @factory/schemas exports a capitalized RoleName (Planner, Coder, etc.)
 * for the SDLC layer. This lowercase version is the runtime role used by
 * Gear and AtomDirective to index PROFILE_BY_ROLE.
 *
 * SPEC-FF-GEARS-001 §4, §6
 */

import { z } from 'zod'

export const RoleName = z.enum(['planner', 'coder', 'critic', 'tester', 'verifier'])
export type RoleName = z.infer<typeof RoleName>
