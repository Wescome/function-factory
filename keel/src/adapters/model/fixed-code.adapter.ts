import type { ModelPort, GeneratedAction } from "../../domain/index";

/** Replay ModelPort for the improvement loop's deterministic pass: always
 *  returns the SAME crystallized code, regardless of attempt/evidence. Replay
 *  must never touch the model — only the oracle re-verifies. If a "fix" ever
 *  needed to vary output across attempts, it wouldn't be a crystallized
 *  procedure anymore. */
export class FixedCodeModelAdapter implements ModelPort {
  constructor(private readonly code: string, private readonly connectors: readonly string[]) {}
  async generate(): Promise<GeneratedAction> {
    return { code: this.code, connectors: [...this.connectors] };
  }
}
