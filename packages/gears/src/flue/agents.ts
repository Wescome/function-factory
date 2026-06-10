/**
 * @factory/gears — Five Dark Factory role AgentProfiles (GD-001: Option A)
 *
 * Static defineAgentProfile exports at package load. Dynamic per-candidate
 * model binding deferred until Architect Agent DO is running.
 *
 * Skills are workspace-discovered from .agents/skills/ at harness init.
 * No SKILL.md import needed here — discovery is automatic.
 * skillRef on AtomDirective carries the declared name to session.skill().
 *
 * NO deriveRole() function — role is taken directly from AtomDirective.role.
 * sandbox is NOT set on a profile — it is set at createAgent() time.
 *
 * SPEC-FF-GEARS-001 §6
 */

import { defineAgentProfile } from '@flue/runtime'
import type { AgentProfile } from '@flue/runtime'

export const plannerProfile: AgentProfile = defineAgentProfile({
  name:         'planner',
  model:        'anthropic/claude-opus-4-6',
  instructions: 'You are the Factory planner. Execute the assigned atom instruction.',
})

export const coderProfile: AgentProfile = defineAgentProfile({
  name:         'coder',
  model:        'anthropic/claude-opus-4-6',
  instructions: 'You are the Factory coder. Execute the assigned atom instruction.',
})

export const criticProfile: AgentProfile = defineAgentProfile({
  name:         'critic',
  model:        'openai/gpt-5.5',
  instructions: 'You are the Factory critic. Execute the assigned atom instruction.',
})

export const testerProfile: AgentProfile = defineAgentProfile({
  name:         'tester',
  model:        'openai/gpt-5.5',
  instructions: 'You are the Factory tester. Execute the assigned atom instruction.',
})

export const verifierProfile: AgentProfile = defineAgentProfile({
  name:         'verifier',
  model:        'openai/gpt-5.5',
  instructions: 'You are the Factory verifier. Execute the assigned atom instruction.',
})

export const PROFILE_BY_ROLE = {
  planner:  plannerProfile,
  coder:    coderProfile,
  critic:   criticProfile,
  tester:   testerProfile,
  verifier: verifierProfile,
} as const

export type RoleName = keyof typeof PROFILE_BY_ROLE
