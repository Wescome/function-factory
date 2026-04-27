// gdk-ts/src/tools/coding-agent-tool.ts — CodingAgent subprocess tool for gdk-agent
// Spawns the Go CodingAgent binary as a subprocess, streams output, and records evidence.
// CONSOLE-4: Subprocess Tool for gdk-agent

import { spawn, type ChildProcess } from "child_process";
import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@weops/gdk-agent";

// ============================================================================
// Types
// ============================================================================

/**
 * Result structure returned by the coding_agent tool.
 */
export interface CodingAgentResult {
  /** Exit code from the CodingAgent process */
  exitCode: number;
  /** Last 100 lines of stdout (truncated for context window) */
  output: string;
  /** Files changed extracted from [TOOL: file_write] lines */
  filesChanged: string[];
  /** Whether tests were run */
  testsRun: boolean;
  /** Whether all tests passed */
  testsPassed: boolean;
}

/**
 * TypeBox schema for coding_agent tool parameters.
 */
const codingAgentSchema = Type.Object({
  taskFile: Type.String({
    description: "Path to task.md file",
  }),
  model: Type.Optional(
    Type.String({
      description: "Model override (default: kimi-k2p5)",
    })
  ),
  workDir: Type.Optional(
    Type.String({
      description: "Working directory override",
    })
  ),
});

type CodingAgentParams = Static<typeof codingAgentSchema>;

// ============================================================================
// Output Parsing
// ============================================================================

/**
 * Extracts files changed from CodingAgent output.
 * Looks for [TOOL: file_write] lines and extracts the path.
 */
function extractFilesChanged(output: string): string[] {
  const files: string[] = [];
  const fileWriteRegex = /\[TOOL:\s*file_write\]\s*(.+)/gi;
  let match: RegExpExecArray | null;

  while ((match = fileWriteRegex.exec(output)) !== null) {
    const path = match[1].trim();
    if (path && !files.includes(path)) {
      files.push(path);
    }
  }

  return files;
}

/**
 * Detects if tests were run from output.
 * Looks for test-related keywords in output.
 */
function detectTestsRun(output: string): boolean {
  const testIndicators = [
    /test\s+passed/i,
    /test\s+failed/i,
    /running\s+tests/i,
    /test\s+complete/i,
    /test\s+summary/i,
    /✓\s+\d+\s+test/i,
    /✗\s+\d+\s+test/i,
    /passed\s*\(\d+\s*tests?\)/i,
    /failed\s*\(\d+\s*tests?\)/i,
    /vitest/i,
    /jest/i,
    /go\s+test/i,
  ];

  return testIndicators.some((pattern) => pattern.test(output));
}

/**
 * Detects if all tests passed from output.
 * Returns false if any failure indicators found.
 */
function detectTestsPassed(output: string): boolean {
  // If no tests run, default to false
  if (!detectTestsRun(output)) {
    return false;
  }

  // Failure indicators
  const failurePatterns = [
    /test\s+failed/i,
    /✗/,
    /failed\s*\(\d+\s*tests?\)/i,
    /\d+\s+failing/i,
    /failures?:\s*\d+/i,
    /error.*test/i,
  ];

  const hasFailures = failurePatterns.some((pattern) => pattern.test(output));
  return !hasFailures;
}

/**
 * Truncates output to last N lines.
 */
function truncateOutput(output: string, maxLines: number = 100): string {
  const lines = output.split("\n");
  if (lines.length <= maxLines) {
    return output;
  }
  return lines.slice(-maxLines).join("\n");
}

// ============================================================================
// Environment Setup
// ============================================================================

/**
 * Builds environment variables for the CodingAgent subprocess.
 * Passes through required env vars and sets CodingAgent-specific ones.
 */
function buildCodingAgentEnv(
  params: CodingAgentParams,
  parentEnv: NodeJS.ProcessEnv
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...parentEnv,
    // Pass through required environment variables
    FIREWORKS_API_KEY: parentEnv.FIREWORKS_API_KEY,
    EVIDENCE_LEDGER_DSN: parentEnv.EVIDENCE_LEDGER_DSN,
    CODING_AGENT_ACTOR_ID: parentEnv.CODING_AGENT_ACTOR_ID,
    CODING_AGENT_ASSEMBLY_ID: parentEnv.CODING_AGENT_ASSEMBLY_ID,
    // Set CodingAgent-specific variables
    CODING_AGENT_MODEL: params.model ?? "kimi-k2p5",
    CODING_AGENT_WORK_DIR: params.workDir ?? process.cwd(),
  };

  // Clean up undefined values
  for (const key of Object.keys(env)) {
    if (env[key] === undefined) {
      delete env[key];
    }
  }

  return env;
}

// ============================================================================
// Subprocess Execution
// ============================================================================

/**
 * Spawns the CodingAgent subprocess and streams output.
 */
export function spawnCodingAgent(
  taskFile: string,
  env: NodeJS.ProcessEnv,
  signal?: AbortSignal
): {
  process: ChildProcess;
  outputPromise: Promise<CodingAgentResult>;
} {
  const child = spawn("coding-agent", ["-f", taskFile], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";

  // Collect stdout
  child.stdout?.on("data", (data: Buffer) => {
    stdout += data.toString();
  });

  // Collect stderr (merge into output for visibility)
  child.stderr?.on("data", (data: Buffer) => {
    stderr += data.toString();
  });

  // Handle abort signal
  if (signal) {
    const abortHandler = () => {
      child.kill("SIGTERM");
    };
    signal.addEventListener("abort", abortHandler, { once: true });

    // Clean up handler when process exits
    child.on("exit", () => {
      signal.removeEventListener("abort", abortHandler);
    });
  }

  const outputPromise = new Promise<CodingAgentResult>((resolve, reject) => {
    child.on("error", (error) => {
      reject(new Error(`Failed to spawn coding-agent: ${error.message}`));
    });

    child.on("exit", (code) => {
      const combinedOutput = stdout + (stderr ? "\n" + stderr : "");
      const truncatedOutput = truncateOutput(combinedOutput, 100);

      resolve({
        exitCode: code ?? 0,
        output: truncatedOutput,
        filesChanged: extractFilesChanged(combinedOutput),
        testsRun: detectTestsRun(combinedOutput),
        testsPassed: detectTestsPassed(combinedOutput),
      });
    });
  });

  return { process: child, outputPromise };
}

// ============================================================================
// Tool Definition
// ============================================================================

/**
 * AgentTool that spawns the Go CodingAgent as a subprocess.
 *
 * Side effect: EXECUTE — spawns external process
 * Governance: Evaluated at T1 minimum by gdk-agent governance wrapper
 * Evidence: Recorded in both gdk-ts layer (ToolInvocation) and CodingAgent's internal PDP
 */
export const codingAgentTool: AgentTool<
  typeof codingAgentSchema,
  CodingAgentResult
> = {
  name: "coding_agent",
  label: "Coding Agent",
  description:
    "Spawn governed CodingAgent for Go implementation tasks. Writes Go code via Kimi K2.5.",
  parameters: codingAgentSchema,

  execute: async (
    _toolCallId: string,
    params: CodingAgentParams,
    signal?: AbortSignal,
    onUpdate?: (result: AgentToolResult<CodingAgentResult>) => void
  ): Promise<AgentToolResult<CodingAgentResult>> => {
    // Build environment
    const env = buildCodingAgentEnv(params, process.env);

    // Spawn the subprocess
    const { process: child, outputPromise } = spawnCodingAgent(
      params.taskFile,
      env,
      signal
    );

    // Stream updates if callback provided
    if (onUpdate && child.stdout) {
      let streamedOutput = "";
      child.stdout.on("data", (data: Buffer) => {
        streamedOutput += data.toString();
        const truncated = truncateOutput(streamedOutput, 100);

        onUpdate({
          content: [
            {
              type: "text",
              text: `Streaming output...\n\n${truncated}`,
            },
          ],
          details: {
            exitCode: -1, // Still running
            output: truncated,
            filesChanged: extractFilesChanged(streamedOutput),
            testsRun: detectTestsRun(streamedOutput),
            testsPassed: detectTestsPassed(streamedOutput),
          },
        });
      });
    }

    // Wait for completion
    const result = await outputPromise;

    // Build final result
    const toolResult: AgentToolResult<CodingAgentResult> = {
      content: [
        {
          type: "text",
          text:
            result.exitCode === 0
              ? `CodingAgent completed successfully.\n\nOutput:\n${result.output}`
              : `CodingAgent exited with code ${result.exitCode}.\n\nOutput:\n${result.output}`,
        },
      ],
      details: result,
    };

    return toolResult;
  },
};

// ============================================================================
// Exports
// ============================================================================

export { codingAgentSchema };
export type { CodingAgentParams };

// Re-export utility functions for testing
export const _testing = {
  extractFilesChanged,
  detectTestsRun,
  detectTestsPassed,
  truncateOutput,
  buildCodingAgentEnv,
};
