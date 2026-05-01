export interface AtomBinding {
  type: string;
  language: string;
  target: string;
}

export interface Atom {
  id: string;
  type: string;
  title: string;
  description: string;
  binding: AtomBinding;
  implementation: string;
  critical: boolean;
}

export interface SynthesisContext {
  pendingAtoms: Atom[];
  isSynthesizing: boolean;
  lastError?: Error;
}

export type NetworkStatus = 'online' | 'offline';

const synthesisContext: SynthesisContext = {
  pendingAtoms: [],
  isSynthesizing: false,
};

export function getSynthesisContext(): Readonly<SynthesisContext> {
  return Object.freeze({ ...synthesisContext });
}

export function queueAtomForSynthesis(atom: Atom): void {
  if (!atom?.id) {
    throw new Error('Invalid atom: id is required');
  }
  synthesisContext.pendingAtoms.push(atom);
}

/**
 * Resumes atom synthesis after network connection is reestablished.
 * Implements atom-003: Resume Atom Synthesis after Connection Reestablishment.
 *
 * @param networkStatus - The current network status; must be 'online' to proceed.
 * @returns Metadata about the resume operation.
 */
export async function resumeAtomSynthesisAfterReconnection(
  networkStatus: NetworkStatus
): Promise<{ resumed: boolean; processed: number }> {
  if (networkStatus !== 'online') {
    throw new Error('Connection must be online to resume atom synthesis');
  }

  if (synthesisContext.isSynthesizing) {
    console.warn('[atom-003] Synthesis already in progress, skipping duplicate resume');
    return { resumed: false, processed: 0 };
  }

  const pending = synthesisContext.pendingAtoms.length;
  if (pending === 0) {
    return { resumed: true, processed: 0 };
  }

  synthesisContext.isSynthesizing = true;
  synthesisContext.lastError = undefined;
  let processed = 0;

  try {
    while (synthesisContext.pendingAtoms.length > 0) {
      const atom = synthesisContext.pendingAtoms.shift();
      if (!atom) continue;

      try {
        await executeSynthesis(atom);
        processed++;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        synthesisContext.lastError = err;

        if (atom.critical) {
          // Re-queue critical atom to allow retry on next reconnection.
          synthesisContext.pendingAtoms.unshift(atom);
          console.error(`[atom-003] Critical atom ${atom.id} failed, halting synthesis`, err);
          break;
        } else {
          console.error(`[atom-003] Non-critical atom ${atom.id} failed, continuing`, err);
        }
      }
    }
  } finally {
    synthesisContext.isSynthesizing = false;
  }

  return { resumed: true, processed };
}

async function executeSynthesis(_atom: Atom): Promise<void> {
  // Bound synthesis logic placeholder.
  // In a full implementation this invokes the code generation pipeline.
}
