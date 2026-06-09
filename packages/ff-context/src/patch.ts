import { z } from 'zod';

// ── Types ──────────────────────────────────────────────────────────────────

export const FileDeltaSchema = z.object({
  virtualPath: z.string().min(1),
  kind: z.enum(['added', 'modified', 'deleted']),
  content: z.string().optional(),
});

export const CandidatePatchSchema = z.object({
  executionId: z.string(),
  deltas: z.array(FileDeltaSchema),
  unifiedDiff: z.string(),
  generatedAt: z.string().datetime(),
});

export type FileDelta = z.infer<typeof FileDeltaSchema>;
export type CandidatePatch = z.infer<typeof CandidatePatchSchema>;

// ── Extraction ─────────────────────────────────────────────────────────────

/**
 * Extract the CandidatePatch from a Flue harness after the agent session.
 *
 * seedPaths: the set of paths written by injectSpecIntoHarness() and any
 * other pre-session setup. These are excluded from the delta — only agent
 * writes count.
 *
 * Reads the harness VFS listing via harness.shell('find / -type f').
 * Compares against seedPaths. Any path not in seedPaths is an agent write.
 */
export async function extractCandidatePatch(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  harness: any,
  seedPaths: Set<string>,
  executionId: string,
): Promise<CandidatePatch> {
  // List all files currently in the VFS
  const result = await harness.shell('find / -type f 2>/dev/null');
  const allPaths = result.stdout
    .split('\n')
    .map((p: string) => p.trim())
    .filter((p: string) => p.length > 0);

  const deltas: FileDelta[] = [];

  for (const vPath of allPaths) {
    if (seedPaths.has(vPath)) continue; // pre-staged — not an agent write
    const content = await harness.fs.readFile(vPath);
    deltas.push({ virtualPath: vPath, kind: 'added', content });
  }

  // Detect deletions: seed paths that no longer exist in the VFS
  for (const seedPath of seedPaths) {
    if (!allPaths.includes(seedPath)) {
      deltas.push({ virtualPath: seedPath, kind: 'deleted' });
    }
  }

  return {
    executionId,
    deltas,
    unifiedDiff: serializePatch(deltas),
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Serialize FileDelta[] as a unified diff string.
 * Produces output compatible with `git apply --check`.
 */
export function serializePatch(deltas: FileDelta[]): string {
  return deltas
    .map((d) => {
      const content = d.content ?? '';
      const lineCount = content.split('\n').length;

      if (d.kind === 'deleted') {
        const lines = content.split('\n').map((l) => `-${l}`).join('\n');
        return [
          `diff --git a${d.virtualPath} /dev/null`,
          `--- a${d.virtualPath}`,
          `+++ /dev/null`,
          `@@ -1,${lineCount} +0,0 @@`,
          lines,
        ].join('\n');
      }

      const a = d.kind === 'added' ? '/dev/null' : `a${d.virtualPath}`;
      const b = `b${d.virtualPath}`;
      const lines = content.split('\n').map((l) => `+${l}`).join('\n');
      return [
        `diff --git ${a} ${b}`,
        `--- ${a}`,
        `+++ ${b}`,
        `@@ -0,0 +1,${lineCount} @@`,
        lines,
      ].join('\n');
    })
    .join('\n\n');
}
