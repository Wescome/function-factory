/**
 * PLAYBOOK-KEEL-RUN-SUITE-001 (B.2, A.5): the Sandbox's own verdict
 * projection. `{ passed, failures[] }` is NOT an existing frozen shape --
 * confirmed by grep across the whole repo (nothing named
 * `parseSimulationResult`/`SimulationResult` exists anywhere) -- the
 * playbook's A.5 assumption ("find where the verdict type lives") was
 * false; this file is that shape, built fresh, then projected into KEEL's
 * real frozen one (`VerdictContent`, `src/domain/lineage/nodes.ts`).
 *
 * Kept out of `src/domain` deliberately: this is substrate-messy parsing of
 * arbitrary, untrusted test-runner output (JSON reporter text, exit codes),
 * not a pure policy decision like `decide()` -- consistent with
 * `suite-oracle.adapter.ts`, which keeps its own "pure-ish" assertion logic
 * in adapters/, not domain/, for the same reason.
 */

export interface SimulationFailure {
  readonly id: string;
  readonly expected: unknown;
  readonly received: unknown;
}

export interface SimulationResult {
  readonly passed: boolean;
  readonly failures: readonly SimulationFailure[];
}

/** A jest/vitest-shaped `--reporter=json` result: the real, standard shape
 *  both frameworks emit (vitest's json reporter is jest-output-compatible).
 *  Structural, not nominal -- any reporter producing this shape is accepted. */
interface JestLikeJsonReport {
  readonly numFailedTests?: number;
  readonly testResults?: readonly {
    readonly assertionResults?: readonly {
      readonly fullName?: string;
      readonly title?: string;
      readonly status?: string;
      readonly failureMessages?: readonly string[];
    }[];
  }[];
}

function tryParseJestLikeReport(stdout: string): JestLikeJsonReport | null {
  // The reporter's JSON may be interleaved with other stdout lines (npm's own
  // banners, install logs) -- find the first '{' that parses as JSON with a
  // `testResults` array, rather than assuming the whole stdout is clean JSON.
  const start = stdout.indexOf("{");
  if (start === -1) return null;
  for (let end = stdout.length; end > start; ) {
    const candidate = stdout.slice(start, end);
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === "object" && Array.isArray((parsed as JestLikeJsonReport).testResults)) {
        return parsed as JestLikeJsonReport;
      }
      return null; // parsed, but not the shape we're looking for
    } catch {
      end = stdout.lastIndexOf("}", end - 1);
      if (end === -1) return null;
      end += 1;
    }
  }
  return null;
}

/**
 * Parse a Sandbox `exec()` result into KEEL's `{passed, failures[]}` shape.
 * B.2: reporter JSON first; OD-RUN-2 exit-code fallback when there is no
 * reporter (or it doesn't parse) -- exit 0 is `passed`, non-zero is ONE
 * unstructured failure, never a throw.
 */
export function parseSimulationResult(exec: { readonly stdout: string; readonly exitCode: number }): SimulationResult {
  const report = tryParseJestLikeReport(exec.stdout);
  if (report) {
    const failures: SimulationFailure[] = [];
    for (const file of report.testResults ?? []) {
      for (const a of file.assertionResults ?? []) {
        if (a.status && a.status !== "passed") {
          failures.push({
            id: a.fullName ?? a.title ?? "unknown test",
            expected: "passed",
            received: a.failureMessages?.length ? a.failureMessages.join("\n") : (a.status ?? "failed"),
          });
        }
      }
    }
    return { passed: (report.numFailedTests ?? failures.length) === 0 && failures.length === 0, failures };
  }
  // No parseable reporter: exit-code fallback (OD-RUN-2).
  if (exec.exitCode === 0) return { passed: true, failures: [] };
  return {
    passed: false,
    failures: [{ id: "exec", expected: "exit code 0", received: `exit code ${exec.exitCode}` }],
  };
}
