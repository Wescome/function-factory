// gdk-ts/src/tools/core-tools.ts — The 4 core tools for governed agent execution
// Read, Write, Bash, Grep — minimal tool set, each governed by AOMA

import { execSync } from "child_process";
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";
import { Type } from "@sinclair/typebox";

// ── Tool Result Type ─────────────────────────────────────

export interface ToolResult {
  content: string;
  isError: boolean;
}

// ── File Read ────────────────────────────────────────────

export const fileReadParams = Type.Object({
  path: Type.String({ description: "Absolute or relative file path to read" }),
  offset: Type.Optional(Type.Number({ description: "Start line (0-based)" })),
  limit: Type.Optional(Type.Number({ description: "Max lines to return" })),
});

export function fileRead(args: { path: string; offset?: number; limit?: number }, workDir: string): ToolResult {
  try {
    const fullPath = resolve(workDir, args.path);
    if (!existsSync(fullPath)) {
      return { content: `File not found: ${args.path}`, isError: true };
    }
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      const entries = readdirSync(fullPath).map((e) => {
        const s = statSync(join(fullPath, e));
        return `${s.isDirectory() ? "d" : "-"} ${e}`;
      });
      return { content: entries.join("\n"), isError: false };
    }
    let content = readFileSync(fullPath, "utf-8");
    if (args.offset !== undefined || args.limit !== undefined) {
      const lines = content.split("\n");
      const start = args.offset ?? 0;
      const end = args.limit ? start + args.limit : lines.length;
      content = lines.slice(start, end).join("\n");
    }
    return { content, isError: false };
  } catch (err) {
    return { content: `Error reading ${args.path}: ${err}`, isError: true };
  }
}

// ── File Write ───────────────────────────────────────────

export const fileWriteParams = Type.Object({
  path: Type.String({ description: "File path to write" }),
  content: Type.String({ description: "Content to write" }),
});

export function fileWrite(args: { path: string; content: string }, workDir: string): ToolResult {
  try {
    const fullPath = resolve(workDir, args.path);
    writeFileSync(fullPath, args.content, "utf-8");
    return { content: `Written ${args.content.length} bytes to ${args.path}`, isError: false };
  } catch (err) {
    return { content: `Error writing ${args.path}: ${err}`, isError: true };
  }
}

// ── Bash Execute ─────────────────────────────────────────

export const bashExecuteParams = Type.Object({
  command: Type.String({ description: "Shell command to execute" }),
  timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (default: 30)", default: 30 })),
});

export function bashExecute(args: { command: string; timeout?: number }, workDir: string): ToolResult {
  try {
    const timeout = (args.timeout ?? 30) * 1000;
    const output = execSync(args.command, {
      cwd: workDir,
      encoding: "utf-8",
      timeout,
      maxBuffer: 1024 * 1024, // 1MB
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { content: output || "(no output)", isError: false };
  } catch (err: any) {
    const stderr = err.stderr || "";
    const stdout = err.stdout || "";
    const code = err.status ?? 1;
    return {
      content: `Exit code: ${code}\nstdout: ${stdout}\nstderr: ${stderr}`,
      isError: code !== 0,
    };
  }
}

// ── Grep Search ──────────────────────────────────────────

export const grepSearchParams = Type.Object({
  pattern: Type.String({ description: "Regex pattern to search for" }),
  path: Type.Optional(Type.String({ description: "Directory or file to search (default: cwd)" })),
  glob: Type.Optional(Type.String({ description: "File glob filter (e.g., '*.ts')" })),
});

export function grepSearch(args: { pattern: string; path?: string; glob?: string }, workDir: string): ToolResult {
  try {
    const searchPath = args.path ? resolve(workDir, args.path) : workDir;
    let cmd = `grep -rn --include='${args.glob || "*"}' '${args.pattern.replace(/'/g, "'\\''")}' '${searchPath}' 2>/dev/null | head -50`;
    const output = execSync(cmd, {
      cwd: workDir,
      encoding: "utf-8",
      timeout: 15000,
      maxBuffer: 512 * 1024,
    });
    return { content: output || "(no matches)", isError: false };
  } catch (err: any) {
    if (err.status === 1) {
      return { content: "(no matches)", isError: false };
    }
    return { content: `Grep error: ${err.stderr || err}`, isError: true };
  }
}

// ── Side Effect Map ──────────────────────────────────────

export const CORE_SIDE_EFFECT_MAP: Record<string, string> = {
  file_read: "READ_ONLY",
  file_write: "WRITE",
  bash_execute: "EXECUTE",
  grep_search: "READ_ONLY",
};

// ── Build AgentTool Array ────────────────────────────────

export function buildCoreTools(workDir: string) {
  return [
    {
      name: "file_read",
      description: "Read a file or list a directory. Returns content as text.",
      parameters: fileReadParams,
      execute: async (args: any) => fileRead(args, workDir),
    },
    {
      name: "file_write",
      description: "Write content to a file. Creates parent directories if needed.",
      parameters: fileWriteParams,
      execute: async (args: any) => fileWrite(args, workDir),
    },
    {
      name: "bash_execute",
      description: "Execute a shell command in the workspace. Returns stdout, stderr, exit code. Timeout: 30s.",
      parameters: bashExecuteParams,
      execute: async (args: any) => bashExecute(args, workDir),
    },
    {
      name: "grep_search",
      description: "Search for a regex pattern across files. Returns matching lines with file paths and line numbers.",
      parameters: grepSearchParams,
      execute: async (args: any) => grepSearch(args, workDir),
    },
  ];
}
