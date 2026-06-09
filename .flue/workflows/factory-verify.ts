import { createAgent, type FlueContext, type WorkflowRouteHandler } from '@flue/runtime';
import { Bash, InMemoryFs } from 'just-bash';
import * as v from 'valibot';
import { fetchSpecContext } from '@factory/ff-context';
import { injectSpecIntoHarness } from '@factory/ff-context/inject';
import {
  ProbeVerdictSchema,
  VerificationBlockedError,
  writeElucidicationArtifact,
} from '@factory/ff-arango';

export const route: WorkflowRouteHandler = async (_c, next) => next();

interface Env {
  FF_CONTEXT_ENDPOINT: string;
  ARANGO_ENDPOINT: string;
  ARANGO_DB: string;
}

const fs = new InMemoryFs();

const verifier = createAgent(() => ({
  model: 'anthropic/claude-haiku-4-5', // Verification tasks are cheaper than generation
  sandbox: () => new Bash({ fs, cwd: '/workspace' }),
}));

export async function run({
  init,
  payload,
  env,
}: FlueContext<{
  executionId: string;
  probeId: string;
  /** Serialized workspace artifact content to verify, keyed by virtual path */
  artifacts: Record<string, string>;
}>) {
  const { executionId, probeId, artifacts } = payload;

  const specContext = await fetchSpecContext(executionId, (env as unknown as Env).FF_CONTEXT_ENDPOINT);
  const harness = await init(verifier);
  await injectSpecIntoHarness(harness, specContext, executionId);

  // Stage the artifacts under verification
  for (const [vPath, content] of Object.entries(artifacts)) {
    await harness.fs.writeFile(vPath, content);
  }

  const session = await harness.session();

  const probeResult = await session.task(
    `You are a Verification-Process executor. Run the following bash checks against /spec/ and /workspace/ artifacts.
    For each check: report checkName, outcome (pass/fail/error), evidence (relevant stdout), blocking (true/false).

    1. checkName: "no-retired-vocabulary"
       script: grep -ri "stage [0-9]\\|gate [0-9]\\|pass [0-9]" /spec/ /workspace/specs/ 2>/dev/null | wc -l
       pass when output is "0"
       blocking: true

    2. checkName: "spec-files-present"
       script: find /spec/ -type f | wc -l
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
    probeId,
    executionId,
    producedAt: new Date().toISOString(),
    verdict: hasBlockingFailure ? 'unfavorable' : 'favorable',
    checkResults: probeResult.data.checkResults,
    blocksExecution: hasBlockingFailure,
  });

  const typedEnv = env as unknown as Env;
  await writeElucidicationArtifact(verdict, typedEnv.ARANGO_ENDPOINT, typedEnv.ARANGO_DB);

  if (verdict.blocksExecution) {
    throw new VerificationBlockedError(verdict);
  }

  return { verdict };
}
