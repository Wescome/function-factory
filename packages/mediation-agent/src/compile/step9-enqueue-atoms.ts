/**
 * Step 9 — Enqueue Atoms
 *
 * Sends one CF Queue message per atom to ATOM_EXECUTION_QUEUE.
 * ThinkExecutor picks these up and calls executeAtom().
 *
 * One message per atom — not a single batch.
 *
 * SPEC-FF-ILAYER-EXEC-001 §3.2 step 9
 */

import type { AtomDirective } from '@factory/schemas'

export interface AtomQueueMessage {
  runId: string
  atomId: string
  atomDirective: AtomDirective
}

export async function enqueueAtoms(
  queue: Queue,
  runId: string,
  directives: Map<string, AtomDirective>,
): Promise<void> {
  // Enqueue each atom as an independent message.
  // Promise.all fires all sends concurrently to minimize latency.
  await Promise.all(
    [...directives.entries()].map(([atomId, atomDirective]) => {
      const msg: AtomQueueMessage = { runId, atomId, atomDirective }
      return queue.send(msg)
    }),
  )
}
