import { z } from 'zod';

// ── Probe verdict = Verification-Process output + Elucidation Artifact ─────

export const CheckResultSchema = z.object({
  checkName: z.string(),
  /** 'pass' | 'fail' | 'error' */
  outcome: z.enum(['pass', 'fail', 'error']),
  evidence: z.string(),   // stdout/stderr from the bash check
  blocking: z.boolean(),
});

export const ProbeVerdictSchema = z.object({
  probeId: z.string(),
  executionId: z.string(),
  producedAt: z.string().datetime(),
  /** 'favorable' when all blocking checks pass */
  verdict: z.enum(['favorable', 'unfavorable']),
  checkResults: z.array(CheckResultSchema),
  blocksExecution: z.boolean(),
});

export type CheckResult = z.infer<typeof CheckResultSchema>;
export type ProbeVerdict = z.infer<typeof ProbeVerdictSchema>;

// ── ArangoDB write ─────────────────────────────────────────────────────────

/**
 * Write a ProbeVerdict as an Elucidation Artifact document in ArangoDB.
 *
 * Collection: elucidation_artifacts
 * Edge (written separately by caller if needed): execution → elucidation_artifact
 *
 * Uses the ArangoDB HTTP API directly (same pattern as ff-context-server).
 * No ORM, no client library — one POST.
 */
export async function writeElucidicationArtifact(
  verdict: ProbeVerdict,
  arangoEndpoint: string,
  arangoDb: string,
): Promise<string> {
  const key = `probe-${verdict.executionId}-${verdict.probeId}-${Date.now()}`;
  const doc = {
    _key: key,
    artifact_type: 'elucidation',
    ...verdict,
  };

  const res = await fetch(
    `${arangoEndpoint}/_db/${arangoDb}/_api/document/elucidation_artifacts`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(doc),
    },
  );

  if (!res.ok) {
    throw new Error(
      `ArangoDB write failed (${res.status}): ${await res.text()}`,
    );
  }

  return key;
}

export class VerificationBlockedError extends Error {
  constructor(public readonly verdict: ProbeVerdict) {
    super(
      `VerificationBlockedError [${verdict.executionId}]: ` +
      `probe '${verdict.probeId}' produced an unfavorable verdict. ` +
      `Blocking checks failed: ` +
      verdict.checkResults
        .filter(c => c.blocking && c.outcome !== 'pass')
        .map(c => c.checkName)
        .join(', ')
    );
    this.name = 'VerificationBlockedError';
  }
}
