#!/usr/bin/env node

/**
 * run-session.js — Sandbox agent session runner.
 *
 * Runs inside the sandbox container. Accepts a task JSON on stdin (or via
 * file argument), sets up a gdk-agent session with the appropriate tools
 * and gates, executes the agent loop, and writes results as JSON to stdout.
 *
 * Usage:
 *   echo '{ "role": "coder", "prompt": "...", ... }' | node run-session.js
 *   node run-session.js task.json
 *
 * Input schema:
 *   {
 *     role:           "coder" | "tester",
 *     prompt:         string,
 *     workDir:        string,
 *     model:          { provider: string, modelId: string },
 *     systemPrompt?:  string,
 *     fileScope?:     { allowWrite?: string[], denyWrite?: string[] },
 *     commandPolicy?: { allowCommands?: string[], denyCommands?: string[] },
 *     apiKey?:        string
 *   }
 *
 * Output schema (JSON on stdout):
 *   {
 *     ok:             boolean,
 *     role:           string,
 *     filesChanged:   string[],
 *     testOutput?:    string,
 *     agentOutput:    string,
 *     tokenUsage:     { input: number, output: number, total: number },
 *     error?:         string
 *   }
 */

import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { execSync } from "node:child_process";
import { Type } from "@sinclair/typebox";

import { agentLoop } from "@weops/gdk-agent";
import { getModel, registerBuiltInApiProviders } from "@weops/gdk-ai";
registerBuiltInApiProviders();

import {
  createFileScopeGate,
  createCommandPolicyGate,
  createReadOnlyGate,
  composeGates,
} from "./tool-gates.js";

// ---------------------------------------------------------------------------
// Stderr logger (stdout is reserved for JSON result)
// ---------------------------------------------------------------------------

function log(...args) {
  process.stderr.write(`[run-session] ${args.join(" ")}\n`);
}

// ---------------------------------------------------------------------------
// Read task input
// ---------------------------------------------------------------------------

async function readTaskInput() {
  // File argument takes precedence
  const fileArg = process.argv[2];
  if (fileArg) {
    log(`Reading task from file: ${fileArg}`);
    return JSON.parse(readFileSync(resolve(fileArg), "utf-8"));
  }

  // Otherwise read from stdin
  log("Reading task from stdin...");
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (!raw) {
    throw new Error("No task input provided on stdin or as file argument");
  }
  return JSON.parse(raw);
}

// ---------------------------------------------------------------------------
// Workspace setup
// ---------------------------------------------------------------------------

function ensureWorkspace(workDir) {
  try {
    execSync(`test -d "${workDir}"`, { stdio: "ignore" });
    log(`Workspace exists: ${workDir}`);
  } catch {
    log(`Creating workspace: ${workDir}`);
    execSync(`mkdir -p "${workDir}"`, { stdio: "inherit" });
  }
}

// ---------------------------------------------------------------------------
// Built-in sandbox tools
// ---------------------------------------------------------------------------

function buildSandboxTools(workDir) {
  return [
    // file_read — read file contents
    {
      name: "file_read",
      label: "Read File",
      description: "Read the contents of a file at the given path.",
      parameters: Type.Object({
        file_path: Type.String({ description: "Absolute path to the file to read" }),
      }),
      async execute(_id, params) {
        const { readFile } = await import("node:fs/promises");
        const target = resolve(workDir, params.file_path);
        const content = await readFile(target, "utf-8");
        return {
          content: [{ type: "text", text: content }],
          details: { path: target, size: content.length },
        };
      },
    },

    // file_write — write file contents
    {
      name: "file_write",
      label: "Write File",
      description: "Write content to a file, creating directories as needed.",
      parameters: Type.Object({
        file_path: Type.String({ description: "Absolute path to the file to write" }),
        content: Type.String({ description: "Content to write to the file" }),
      }),
      async execute(_id, params) {
        const { writeFile, mkdir } = await import("node:fs/promises");
        const { dirname } = await import("node:path");
        const target = resolve(workDir, params.file_path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, params.content, "utf-8");
        return {
          content: [{ type: "text", text: `Wrote ${params.content.length} bytes to ${target}` }],
          details: { path: target, size: params.content.length },
        };
      },
    },

    // bash_execute — run a shell command
    {
      name: "bash_execute",
      label: "Execute Command",
      description: "Execute a bash command in the workspace directory.",
      parameters: Type.Object({
        command: Type.String({ description: "The bash command to execute" }),
        timeout: Type.Optional(Type.Number({ description: "Timeout in milliseconds (default 30000)" })),
      }),
      async execute(_id, params) {
        const timeout = params.timeout ?? 30_000;
        try {
          const output = execSync(params.command, {
            cwd: workDir,
            timeout,
            maxBuffer: 1024 * 1024 * 10, // 10 MB
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
          });
          return {
            content: [{ type: "text", text: output || "(no output)" }],
            details: { command: params.command, exitCode: 0 },
          };
        } catch (err) {
          const stderr = err.stderr ?? "";
          const stdout = err.stdout ?? "";
          const exitCode = err.status ?? 1;
          return {
            content: [
              {
                type: "text",
                text: `Exit code: ${exitCode}\n\nSTDOUT:\n${stdout}\n\nSTDERR:\n${stderr}`,
              },
            ],
            details: { command: params.command, exitCode },
          };
        }
      },
    },

    // grep_search — search files with regex
    {
      name: "grep_search",
      label: "Search Files",
      description: "Search for a pattern across files in the workspace using grep.",
      parameters: Type.Object({
        pattern: Type.String({ description: "Regex pattern to search for" }),
        path: Type.Optional(Type.String({ description: "Subdirectory to search in (relative to workDir)" })),
        include: Type.Optional(Type.String({ description: "File glob to include (e.g. '*.ts')" })),
      }),
      async execute(_id, params) {
        const searchPath = params.path ? resolve(workDir, params.path) : workDir;
        const includeFlag = params.include ? `--include="${params.include}"` : "";
        const cmd = `grep -rn ${includeFlag} -E "${params.pattern.replace(/"/g, '\\"')}" "${searchPath}" 2>/dev/null | head -200`;
        try {
          const output = execSync(cmd, {
            cwd: workDir,
            timeout: 15_000,
            maxBuffer: 1024 * 1024 * 5,
            encoding: "utf-8",
          });
          return {
            content: [{ type: "text", text: output || "(no matches)" }],
            details: { pattern: params.pattern, searchPath },
          };
        } catch {
          return {
            content: [{ type: "text", text: "(no matches)" }],
            details: { pattern: params.pattern, searchPath },
          };
        }
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Gate composition based on role
// ---------------------------------------------------------------------------

function buildGates(role, fileScope, commandPolicy) {
  const gates = [];

  if (role === "tester") {
    // Tester is read-only: block all writes
    gates.push(createReadOnlyGate());
  } else {
    // Coder: apply file scope and command policy
    if (fileScope) {
      gates.push(createFileScopeGate(fileScope));
    }
  }

  if (commandPolicy) {
    gates.push(createCommandPolicyGate(commandPolicy));
  }

  return gates.length > 0 ? composeGates(...gates) : undefined;
}

// ---------------------------------------------------------------------------
// Collect results from agent events
// ---------------------------------------------------------------------------

function createResultCollector() {
  const filesChanged = new Set();
  const textOutput = [];
  let totalInput = 0;
  let totalOutput = 0;
  let testOutput = "";

  return {
    /** Process a single agent event. */
    onEvent(event) {
      switch (event.type) {
        case "tool_execution_end":
          // Track file writes
          if (event.toolName === "file_write" && !event.isError) {
            const path = event.result?.details?.path;
            if (path) filesChanged.add(path);
          }
          // Capture test output from bash commands
          if (event.toolName === "bash_execute") {
            const text = event.result?.content?.[0]?.text ?? "";
            if (text.includes("PASS") || text.includes("FAIL") || text.includes("test")) {
              testOutput += text + "\n";
            }
          }
          break;

        case "message_end":
          if (event.message?.role === "assistant") {
            // Accumulate token usage
            const usage = event.message.usage;
            if (usage) {
              totalInput += usage.input ?? 0;
              totalOutput += usage.output ?? 0;
            }
            // Accumulate text output
            for (const block of event.message.content ?? []) {
              if (block.type === "text") {
                textOutput.push(block.text);
              }
            }
          }
          break;
      }
    },

    /** Build the final result object. */
    toResult(role, error) {
      return {
        ok: !error,
        role,
        filesChanged: [...filesChanged],
        testOutput: testOutput || undefined,
        agentOutput: textOutput.join("\n\n"),
        tokenUsage: {
          input: totalInput,
          output: totalOutput,
          total: totalInput + totalOutput,
        },
        error: error ?? undefined,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Default system prompts by role
// ---------------------------------------------------------------------------

const DEFAULT_SYSTEM_PROMPTS = {
  coder: `You are the Coder agent in a Factory pipeline sandbox.

Your job is to implement code changes according to the task prompt.
You have access to: file_read, file_write, bash_execute, grep_search.

Rules:
- Write clean, tested code
- Follow the project's existing patterns
- Run tests after making changes
- Output a summary of what you changed and why`,

  tester: `You are the Tester agent in a Factory pipeline sandbox.

Your job is to verify code quality by reading source and running tests.
You have access to: file_read, bash_execute, grep_search.
You do NOT have write access — you are read-only.

Rules:
- Read the code under test
- Run the existing test suite
- Report pass/fail status with details
- Note any coverage gaps or missing test cases`,
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  let task;
  try {
    task = await readTaskInput();
  } catch (err) {
    const result = {
      ok: false,
      role: "unknown",
      filesChanged: [],
      agentOutput: "",
      tokenUsage: { input: 0, output: 0, total: 0 },
      error: `Failed to read task input: ${err.message}`,
    };
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    process.exit(1);
  }

  const {
    role,
    prompt,
    workDir,
    model: modelSpec,
    systemPrompt: customSystemPrompt,
    fileScope,
    commandPolicy,
    apiKey,
  } = task;

  log(`Role: ${role}`);
  log(`Model: ${modelSpec.provider}/${modelSpec.modelId}`);
  log(`WorkDir: ${workDir}`);

  // Ensure workspace exists
  ensureWorkspace(workDir);

  // Resolve the model
  let model;
  try {
    model = getModel(modelSpec.provider, modelSpec.modelId);
    if (!model) {
      throw new Error(`Model not found: ${modelSpec.provider}/${modelSpec.modelId}`);
    }
  } catch (err) {
    const result = {
      ok: false,
      role,
      filesChanged: [],
      agentOutput: "",
      tokenUsage: { input: 0, output: 0, total: 0 },
      error: `Model resolution failed: ${err.message}`,
    };
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    process.exit(1);
  }

  // Build tools and gates
  const tools = buildSandboxTools(workDir);
  const beforeToolCall = buildGates(role, fileScope, commandPolicy);
  const systemPrompt = customSystemPrompt ?? DEFAULT_SYSTEM_PROMPTS[role] ?? DEFAULT_SYSTEM_PROMPTS.coder;

  // Set up result collector
  const collector = createResultCollector();

  // Create the agent context
  const context = {
    systemPrompt,
    messages: [],
    tools,
  };

  // Agent loop config
  const config = {
    model,
    apiKey,
    convertToLlm: (messages) => messages.filter((m) => m.role !== undefined),
    beforeToolCall: beforeToolCall
      ? async (ctx) => beforeToolCall(ctx)
      : undefined,
  };

  // Run the agent loop
  log("Starting agent loop...");
  const userMessage = {
    role: "user",
    content: prompt,
    timestamp: Date.now(),
  };

  let error = null;
  try {
    const stream = agentLoop([userMessage], context, config);

    for await (const event of stream) {
      collector.onEvent(event);

      // Log progress to stderr
      if (event.type === "turn_start") {
        log("Turn started");
      } else if (event.type === "tool_execution_start") {
        log(`Tool: ${event.toolName}`);
      } else if (event.type === "agent_end") {
        log("Agent loop complete");
      }
    }
  } catch (err) {
    error = err.message ?? String(err);
    log(`Agent loop error: ${error}`);
  }

  // Write result to stdout
  const result = collector.toResult(role, error);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  process.exit(result.ok ? 0 : 1);
}

main().catch((err) => {
  const result = {
    ok: false,
    role: "unknown",
    filesChanged: [],
    agentOutput: "",
    tokenUsage: { input: 0, output: 0, total: 0 },
    error: `Unhandled error: ${err.message}`,
  };
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  process.exit(1);
});
