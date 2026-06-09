import { z } from 'zod';

// ── Types ──────────────────────────────────────────────────────────────────

export const SpecFileSchema = z.object({
  /** e.g. '/spec/prds/PRD-FOO-001.md' — must start with /spec/ */
  virtualPath: z.string().startsWith('/spec/'),
  content: z.string(),
  /** ArangoDB _key for lineage write-back */
  arangoKey: z.string().min(1),
  explicitness: z.enum(['stated', 'inferred', 'assumed']),
});

export const SpecContextSchema = z.object({
  files: z.array(SpecFileSchema).min(1),
  fetchedAt: z.string().datetime(),
  executionId: z.string().min(1),
});

export type SpecFile = z.infer<typeof SpecFileSchema>;
export type SpecContext = z.infer<typeof SpecContextSchema>;

// ── Error ──────────────────────────────────────────────────────────────────

export class SpecUnavailableError extends Error {
  constructor(executionId: string, reason: string) {
    super(
      `SpecUnavailableError [${executionId}]: ${reason}. ` +
      `Execution blocked — Invariant I4 (fail-closed coupling).`
    );
    this.name = 'SpecUnavailableError';
  }
}

// ── Fetch ──────────────────────────────────────────────────────────────────

/**
 * Pull spec context from ff-context-server (ArangoDB-backed CF Worker).
 * Returns a validated SpecContext. Throws SpecUnavailableError on any failure.
 *
 * This is the only function that talks to ff-context-server.
 * Do not call ff-context-server from workflow files directly.
 */
export async function fetchSpecContext(
  executionId: string,
  endpoint: string,
): Promise<SpecContext> {
  let raw: unknown;

  try {
    const res = await fetch(`${endpoint}/spec-context/${executionId}`, {
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      throw new SpecUnavailableError(
        executionId,
        `ff-context-server responded ${res.status}`,
      );
    }
    raw = await res.json();
  } catch (err) {
    if (err instanceof SpecUnavailableError) throw err;
    throw new SpecUnavailableError(executionId, `fetch failed: ${String(err)}`);
  }

  const parsed = SpecContextSchema.safeParse(raw);
  if (!parsed.success) {
    throw new SpecUnavailableError(
      executionId,
      `invalid shape from ff-context-server: ${parsed.error.message}`,
    );
  }

  return parsed.data;
}
