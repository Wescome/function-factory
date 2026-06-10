// Runtime stub for @flue/runtime — used until @flue/runtime publishes
// Implements only the surface used by agents.ts and atom-execution.ts
// SPEC-FF-GEARS-001 §6

export function defineAgentProfile(profile) {
  return profile
}

export function createAgent(factory) {
  return factory
}

export function configureProvider(provider, config) {
  // no-op in stub
}
