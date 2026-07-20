import type { ModelPort, GeneratedAction } from "../../domain/index";

/** Replay ModelPort for the improvement loop's deterministic pass: always
 *  returns the SAME crystallized code, regardless of attempt/evidence. Replay
 *  must never touch the model — only the oracle re-verifies. If a "fix" ever
 *  needed to vary output across attempts, it wouldn't be a crystallized
 *  procedure anymore.
 *
 *  BRIEF-KEEL-SKILL-001 / INV-SKILL-FROZEN: `skills`, if given, is returned
 *  back VERBATIM — read from the original Action being replayed, never
 *  re-selected. This adapter never touches `selectSkills` or a skill store;
 *  replay doesn't re-derive what skills produced the code, it just carries
 *  the frozen record forward. */
export class FixedCodeModelAdapter implements ModelPort {
  constructor(
    private readonly code: string,
    private readonly connectors: readonly string[],
    private readonly skills?: readonly string[],
  ) {}
  async generate(): Promise<GeneratedAction> {
    return { code: this.code, connectors: [...this.connectors], skills: this.skills };
  }
}
