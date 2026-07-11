// D6 import-boundary lint (M1 gate, extended for M2 adapters).
// RULE: src/domain/** must import NO substrate. src/adapters/** and
// src/composition/** MAY (they are the ports' implementations + wiring).
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
const BAD = /from\s+["'](?:@cloudflare\/[^"']+|agents|codemode|miniflare|wrangler)["']/;
const decomment = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
let violations = [];
function walk(dir) {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".ts") && BAD.test(decomment(readFileSync(p, "utf8")))) violations.push(p.replace(/\\/g, "/"));
  }
}
walk("src/domain"); // ONLY the domain is checked; it must be substrate-free
if (violations.length) {
  console.error("D6 VIOLATION — the substrate is imported inside src/domain:\n  " + violations.join("\n  "));
  process.exit(1);
}
console.log("D6 import boundary: clean (src/domain is substrate-free).");
