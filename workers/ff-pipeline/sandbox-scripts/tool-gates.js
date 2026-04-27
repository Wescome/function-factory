/**
 * Tool gating functions for sandbox agent sessions.
 *
 * These gates run as `beforeToolCall` hooks in the gdk-agent loop,
 * enforcing file-scope, command-policy, and read-only constraints
 * on tool execution inside the sandbox container.
 */

import { resolve, relative } from "node:path";

// ---------------------------------------------------------------------------
// File-scope gate
// ---------------------------------------------------------------------------

/**
 * Creates a beforeToolCall gate that blocks file writes outside allowed paths.
 *
 * @param {object} fileScope
 * @param {string[]} fileScope.allowWrite  - Glob-free absolute directory prefixes the agent may write to.
 * @param {string[]} [fileScope.denyWrite] - Absolute directory prefixes explicitly denied (takes precedence).
 * @returns {(ctx: import("@weops/gdk-agent").BeforeToolCallContext) => import("@weops/gdk-agent").BeforeToolCallResult | undefined}
 */
export function createFileScopeGate(fileScope) {
  const allowWrite = (fileScope.allowWrite ?? []).map((p) => resolve(p));
  const denyWrite = (fileScope.denyWrite ?? []).map((p) => resolve(p));

  return (ctx) => {
    // Only gate write-capable tools
    const writingTools = ["file_write", "bash_execute"];
    if (!writingTools.includes(ctx.toolCall.name)) return undefined;

    if (ctx.toolCall.name === "file_write") {
      const filePath = resolve(String(ctx.args?.file_path ?? ctx.args?.path ?? ""));
      if (!filePath) return undefined;

      // Deny list takes precedence
      for (const denied of denyWrite) {
        if (filePath.startsWith(denied)) {
          return {
            block: true,
            reason: `File write blocked: ${filePath} is inside denied path ${denied}`,
          };
        }
      }

      // Must be inside at least one allowed prefix
      const allowed = allowWrite.some((prefix) => filePath.startsWith(prefix));
      if (!allowed) {
        return {
          block: true,
          reason: `File write blocked: ${filePath} is outside allowed write paths [${allowWrite.join(", ")}]`,
        };
      }
    }

    // bash_execute: we cannot statically analyze arbitrary shell commands for
    // file writes. Command-policy gate handles command restrictions separately.
    // File-scope gate only applies structurally to file_write.
    return undefined;
  };
}

// ---------------------------------------------------------------------------
// Command-policy gate
// ---------------------------------------------------------------------------

/**
 * Creates a beforeToolCall gate that blocks disallowed shell commands.
 *
 * @param {object} commandPolicy
 * @param {string[]} [commandPolicy.allowCommands] - Command prefixes allowed (e.g., ["pnpm test", "node"]).
 *                                                    If provided, only matching commands execute.
 * @param {string[]} [commandPolicy.denyCommands]  - Command prefixes always blocked (e.g., ["rm -rf /", "curl"]).
 *                                                    Deny takes precedence over allow.
 * @returns {(ctx: import("@weops/gdk-agent").BeforeToolCallContext) => import("@weops/gdk-agent").BeforeToolCallResult | undefined}
 */
export function createCommandPolicyGate(commandPolicy) {
  const allowCommands = commandPolicy.allowCommands ?? null; // null = allow all
  const denyCommands = commandPolicy.denyCommands ?? [];

  return (ctx) => {
    if (ctx.toolCall.name !== "bash_execute") return undefined;

    const command = String(ctx.args?.command ?? "").trim();
    if (!command) return undefined;

    // Deny list takes precedence
    for (const denied of denyCommands) {
      if (command.startsWith(denied) || command.includes(`&& ${denied}`) || command.includes(`; ${denied}`)) {
        return {
          block: true,
          reason: `Command blocked by policy: "${denied}" is not allowed`,
        };
      }
    }

    // If allow list is set, command must match at least one prefix
    if (allowCommands !== null) {
      const allowed = allowCommands.some((prefix) => command.startsWith(prefix));
      if (!allowed) {
        return {
          block: true,
          reason: `Command blocked by policy: "${command.slice(0, 60)}..." does not match any allowed command prefix`,
        };
      }
    }

    return undefined;
  };
}

// ---------------------------------------------------------------------------
// Read-only gate (Tester role)
// ---------------------------------------------------------------------------

/**
 * Creates a beforeToolCall gate that blocks ALL write operations.
 * Used for the Tester role which should only read and execute tests,
 * never modify source files.
 *
 * @returns {(ctx: import("@weops/gdk-agent").BeforeToolCallContext) => import("@weops/gdk-agent").BeforeToolCallResult | undefined}
 */
export function createReadOnlyGate() {
  return (ctx) => {
    if (ctx.toolCall.name === "file_write") {
      return {
        block: true,
        reason: "Write blocked: Tester role operates in read-only mode",
      };
    }

    // For bash_execute, block known destructive patterns
    if (ctx.toolCall.name === "bash_execute") {
      const command = String(ctx.args?.command ?? "").trim();
      const destructivePatterns = [
        /\brm\s/,
        /\bmv\s/,
        /\bcp\s.*>/,
        /\bchmod\s/,
        /\bchown\s/,
        /\bmkdir\s/,
        /\brmdir\s/,
        /\bgit\s+(push|commit|reset|checkout|merge|rebase|stash)/,
        /\bnpm\s+(publish|install|uninstall)/,
        /\bpnpm\s+(publish|install|add|remove)/,
        /\bbun\s+(add|remove|install)/,
        /\btee\s/,
        /\bdd\s/,
        />\s*[^\s]/, // redirect to file
      ];

      for (const pattern of destructivePatterns) {
        if (pattern.test(command)) {
          return {
            block: true,
            reason: `Command blocked: Tester role is read-only, cannot run destructive command "${command.slice(0, 80)}"`,
          };
        }
      }
    }

    return undefined;
  };
}

// ---------------------------------------------------------------------------
// Compose multiple gates
// ---------------------------------------------------------------------------

/**
 * Combines multiple gate functions into a single beforeToolCall hook.
 * The first gate that returns `{ block: true }` wins.
 *
 * @param  {...Function} gates - Gate functions to compose.
 * @returns {(ctx: import("@weops/gdk-agent").BeforeToolCallContext) => import("@weops/gdk-agent").BeforeToolCallResult | undefined}
 */
export function composeGates(...gates) {
  return (ctx) => {
    for (const gate of gates) {
      const result = gate(ctx);
      if (result?.block) return result;
    }
    return undefined;
  };
}
