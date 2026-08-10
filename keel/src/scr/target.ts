/**
 * PLAYBOOK-KEEL-SCR-PORT-1: lifted from SCR (target.ts), byte-identical
 * except stripped `.ts` import extensions.
 */
import type { Hunk } from './events';

export interface TargetObservation {
  /** Where the target ref is right now. */
  sha: string;
  /** What arrived between `sinceSha` and `sha`. Empty when nothing moved. */
  incomingHunks: Hunk[];
}

/**
 * INV-11 LAND-IS-FENCED.
 *
 * The series does not own the target ref. Other teams land, hotfixes ship,
 * merge queues drain. This port is how the series finds out — and it is
 * consulted immediately before composing, so that no prefix is ever written
 * against a base the series has not observed.
 */
export interface TargetProbe {
  observe(sinceSha: string): TargetObservation;
}

/** No external actor. The target only moves when this series moves it. */
export class StaticTarget implements TargetProbe {
  observe(sinceSha: string): TargetObservation {
    return { sha: sinceSha, incomingHunks: [] };
  }
}

/**
 * Test double: an external actor with a hand. `push` simulates someone else
 * landing on the target ref.
 */
export class ScriptedTarget implements TargetProbe {
  #sha: string;
  #pending: Hunk[] = [];

  constructor(sha: string) {
    this.#sha = sha;
  }

  push(sha: string, hunks: Hunk[]): void {
    this.#sha = sha;
    this.#pending.push(...hunks);
  }

  /** Called by the composer so its own commits do not look like foreign ones. */
  adopt(sha: string): void {
    this.#sha = sha;
    this.#pending = [];
  }

  observe(sinceSha: string): TargetObservation {
    if (this.#sha === sinceSha) return { sha: sinceSha, incomingHunks: [] };
    return { sha: this.#sha, incomingHunks: [...this.#pending] };
  }
}
