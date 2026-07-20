// D6 import-boundary lint (spike form): domain/control code must not import the
// substrate (@cloudflare/* or codemode/agents) directly. Two kinds of file MAY:
//   - src/substrate.ts        (the ACL)
//   - src/connectors/*        (adapters — connectors are infrastructure by role)
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const allow = (p) => p === "src/substrate.ts" || p.startsWith("src/connectors/");
const BAD = /from\s+["'](?:@cloudflare\/codemode|agents)["']/;

// strip // line comments and /* */ block comments so commented imports don't trip
const decomment = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

let violations = [];
function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".ts")) {
      const rel = p.replace(/\\/g, "/");
      if (!allow(rel) && BAD.test(decomment(readFileSync(p, "utf8")))) violations.push(rel);
    }
  }
}
walk("src");
if (violations.length) {
  console.error("D6 VIOLATION — substrate imported outside ACL/connectors:\n  " + violations.join("\n  "));
  process.exit(1);
}
console.log("D6 import boundary: clean.");
