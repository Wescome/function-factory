import { createAgent, type FlueContext, type WorkflowRouteHandler } from '@flue/runtime';
import { Bash, InMemoryFs } from 'just-bash';
import * as v from 'valibot';
import { fetchSpecContext, SpecUnavailableError } from '@factory/ff-context';
import { injectSpecIntoHarness } from '@factory/ff-context/inject';
import { extractCandidatePatch } from '@factory/ff-context/patch';
import {
  ProbeVerdictSchema,
  VerificationBlockedError,
  writeElucidicationArtifact,
} from '@factory/ff-arango';

// Route exposed via HTTP — WeOps gateway authenticates upstream
export const route: WorkflowRouteHandler = async (_c, next) => next();

interface Env {
  FF_CONTEXT_ENDPOINT: string;
  ARANGO_ENDPOINT: string;
  ARANGO_DB: string;
}

// Virtual sandbox (just-bash) — Worker-tier, no container
// Shared InMemoryFs across sessions within the same workflow run
const fs = new InMemoryFs();

const compiler = createAgent(() => ({
  model: 'anthropic/claude-sonnet-4-6',
  sandbox: () => new Bash({ fs, cwd: '/workspace' }),
  // Skills are discovered from /workspace/.agents/skills/ at runtime
  // (Factory's .agent/skills/ → renamed to .agents/skills/ per Flue convention)
}));

export async function run({
  init,
  payload,
  env,
}: FlueContext<{ executionId: string; prdKey: string }>) {
  const { executionId, prdKey } = payload;

  // ── 1. Retrieve Specification (I1 + I2) ────────────────────────────────
  // fetchSpecContext throws SpecUnavailableError on any failure (I4 at source)
  const typedEnv = env as unknown as Env;
  const specContext = await fetchSpecContext(executionId, typedEnv.FF_CONTEXT_ENDPOINT);

  // ── 2. Materialize Specification into harness VFS ───────────────────────
  const harness = await init(compiler);

  // injectSpecIntoHarness throws SpecUnavailableError if specContext is
  // null/empty (I4 — execution cannot proceed without spec)
  await injectSpecIntoHarness(harness, specContext, executionId);

  // Record which paths were pre-staged (for CandidatePatch delta later)
  const seedPaths = new Set(specContext.files.map((f) => f.virtualPath));

  // ── 3. Execution: run prd-compiler skill ────────────────────────────────
  const session = await harness.session();

  const { data: compileResult } = await session.skill('prd-compiler', {
    args: { prdKey },
    result: v.object({
      workgraphKey: v.string(),
      coverageScore: v.number(),
    }),
  });

  // ── 4. Verification-Process (independent Divergence detector) ───────────
  const probeResult = await session.task(
    `You are a Verification-Process executor. Run these bash checks.
    For each: report checkName, outcome (pass/fail/error), evidence, blocking.

    1. checkName: "no-retired-vocabulary"
       script: grep -ri "stage [0-9]\\|gate [0-9]\\|pass [0-9]" /workspace/specs/ 2>/dev/null | wc -l
       pass when output is "0"
       blocking: true

    2. checkName: "workgraph-produced"
       script: find /workspace/specs/workgraphs -name "WG-*.md" | wc -l
       pass when output > 0
       blocking: true

    3. checkName: "source-refs-present"
       script: grep -rl "source_refs" /workspace/specs/workgraphs/ 2>/dev/null | wc -l
       pass when output > 0
       blocking: false`,
    {
      cwd: '/workspace',
      result: v.object({
        checkResults: v.array(v.object({
          checkName: v.string(),
          outcome: v.picklist(['pass', 'fail', 'error']),
          evidence: v.string(),
          blocking: v.boolean(),
        })),
      }),
    },
  );

  const hasBlockingFailure = probeResult.data['checkResults'] instanceof Array
    ? (probeResult.data['checkResults'] as Array<{ blocking: boolean; outcome: string }>).some(
        (c) => c.blocking && c.outcome !== 'pass',
      )
    : false;

  const verdict = ProbeVerdictSchema.parse({
    probeId: 'wg-conformance',
    executionId,
    producedAt: new Date().toISOString(),
    verdict: hasBlockingFailure ? 'unfavorable' : 'favorable',
    checkResults: probeResult.data['checkResults'],
    blocksExecution: hasBlockingFailure,
  });

  // ── 5. Write Elucidation Artifact BEFORE I4 check ──────────────────────
  // Artifact must exist in ArangoDB for Hypothesis formation even when blocked
  await writeElucidicationArtifact(verdict, typedEnv.ARANGO_ENDPOINT, typedEnv.ARANGO_DB);
  // ^ env values are runtime-provided strings; ?? '' fallback satisfies strict null checks

  // ── 6. I4: fail-closed ─────────────────────────────────────────────────
  if (verdict.blocksExecution) {
    throw new VerificationBlockedError(verdict);
  }

  // ── 7. Extract CandidatePatch ──────────────────────────────────────────
  const patch = await extractCandidatePatch(harness, seedPaths, executionId);

  // ── 8. Return Execution result ─────────────────────────────────────────
  return {
    executionId,
    workgraphKey: compileResult['workgraphKey'],
    coverageScore: compileResult['coverageScore'],
    verdictFavorable: verdict.verdict === 'favorable',
    patch: patch.unifiedDiff,
  };
}
