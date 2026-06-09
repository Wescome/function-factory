import { createAgent, type FlueContext, type WorkflowRouteHandler } from '@flue/runtime';
import * as v from 'valibot';
import { fetchSpecContext, injectSpecIntoHarness } from '@factory/ff-context';
import { extractCandidatePatch } from '@factory/ff-context/patch';
import {
  ProbeVerdictSchema,
  VerificationBlockedError,
  writeElucidicationArtifact,
} from '@factory/ff-arango';
import { gasCity } from '../../connectors/cloudflare';

export const route: WorkflowRouteHandler = async (_c, next) => next();

interface Env {
  FF_CONTEXT_ENDPOINT: string;
  ARANGO_ENDPOINT: string;
  ARANGO_DB: string;
  Sandbox: unknown;
}

export async function run({
  init,
  payload,
  env,
}: FlueContext<{ executionId: string; buildKey: string }>) {
  const { executionId, buildKey } = payload;
  const typedEnv = env as unknown as Env;

  // ── 1. Retrieve Specification (I1 + I2) ────────────────────────────────
  const specContext = await fetchSpecContext(executionId, typedEnv.FF_CONTEXT_ENDPOINT);

  // ── 2. Gas City tier: CF Container — full Linux, persistent FS ─────────
  const builder = createAgent(() => ({
    model: 'anthropic/claude-sonnet-4-6',
    sandbox: gasCity(typedEnv.Sandbox, `build-${executionId}`),
  }));

  const harness = await init(builder);
  await injectSpecIntoHarness(harness, specContext, executionId);

  const seedPaths = new Set(specContext.files.map((f) => f.virtualPath));

  // ── 3. Execution ────────────────────────────────────────────────────────
  const session = await harness.session();

  const { data: buildResult } = await session.skill('factory-build', {
    args: { buildKey },
    result: v.object({
      artifactKey: v.string(),
      passed: v.boolean(),
    }),
  });

  // ── 4. Verification-Process ─────────────────────────────────────────────
  const probeResult = await session.task(
    `You are a Verification-Process executor. Run the following bash checks.
    For each: report checkName, outcome (pass/fail/error), evidence, blocking.

    1. checkName: "no-retired-vocabulary"
       script: grep -ri "stage [0-9]\\|gate [0-9]\\|pass [0-9]" /spec/ /workspace/specs/ 2>/dev/null | wc -l
       pass when output is "0"
       blocking: true

    2. checkName: "build-artifact-present"
       script: find /workspace -name "*.js" -o -name "*.wasm" | wc -l
       pass when output > 0
       blocking: true`,
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

  const hasBlockingFailure = probeResult.data.checkResults.some(
    (c) => c.blocking && c.outcome !== 'pass',
  );

  const verdict = ProbeVerdictSchema.parse({
    probeId: 'build-conformance',
    executionId,
    producedAt: new Date().toISOString(),
    verdict: hasBlockingFailure ? 'unfavorable' : 'favorable',
    checkResults: probeResult.data.checkResults,
    blocksExecution: hasBlockingFailure,
  });

  // ── 5. Write Elucidation Artifact BEFORE I4 check ──────────────────────
  await writeElucidicationArtifact(verdict, typedEnv.ARANGO_ENDPOINT, typedEnv.ARANGO_DB);

  if (verdict.blocksExecution) {
    throw new VerificationBlockedError(verdict);
  }

  // ── 6. Extract CandidatePatch ───────────────────────────────────────────
  const patch = await extractCandidatePatch(harness, seedPaths, executionId);

  return {
    executionId,
    artifactKey: buildResult.artifactKey,
    passed: buildResult.passed,
    verdictFavorable: verdict.verdict === 'favorable',
    patch: patch.unifiedDiff,
  };
}
