/**
 * Automated Critic review for PRD-META-SIMULATION-COVERAGE.
 * First PRD through universal Critic review — no carve-out.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { getModel, streamSimple, calculateCost } from "@mariozechner/pi-ai"
import type { TextContent } from "@mariozechner/pi-ai"

const REPO = join(import.meta.dirname, "..", "..", "..")
const prd = readFileSync(join(REPO, "specs/prds/PRD-META-SIMULATION-COVERAGE.md"), "utf-8")
const wp = readFileSync(join(REPO, "specs/reference/The_Function_Factory_2026-04-18_v4.md"), "utf-8")
const s6 = wp.match(/## 6\. Spec Coverage[\s\S]*?(?=## 7\.|$)/)?.[0]?.slice(0, 8000) ?? "§6 not found"

async function main() {
  console.log("=== AUTOMATED CRITIC REVIEW: PRD-META-SIMULATION-COVERAGE ===\n")
  const model = getModel("anthropic", "claude-haiku-4-5-20251001")
  const stream = streamSimple(model, {
    systemPrompt: `You are the Critic. Review this PRD for semantic alignment with whitepaper §6 (Spec Coverage and Three Gates). Produce JSON only, no markdown fences: {"verdict":"aligned|miscast|uncertain","confidence":0.0-1.0,"citations":[{"section":"§6.X","quote":"...","supports":true,"reasoning":"..."}],"summary":"..."}`,
    messages: [{ role: "user" as const, content: `WHITEPAPER §6:\n${s6}\n\n---\n\nPRD:\n${prd}\n\nProduce verdict as JSON.`, timestamp: Date.now() }],
  }, { maxTokens: 4096 })

  const result = await stream.result()
  calculateCost(model, result.usage)
  const text = result.content.filter((c): c is TextContent => c.type === "text").map(c => c.text).join("")

  console.log(text)
  console.log(`\nTokens: ${result.usage.totalTokens} Cost: $${result.usage.cost.total.toFixed(4)}`)

  try {
    const v = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? "{}")
    console.log(`VERDICT: ${v.verdict} (${v.confidence})`)
    console.log(`CITATIONS: ${v.citations?.length ?? 0}`)

    // Write CRV artifact
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
    mkdirSync(join(REPO, "specs/critic-reviews"), { recursive: true })
    const crvPath = join(REPO, `specs/critic-reviews/CRV-PRD-META-SIMULATION-COVERAGE-${ts}.yaml`)
    writeFileSync(crvPath, `id: CRV-PRD-META-SIMULATION-COVERAGE-${ts}
source_refs:
  - PRD-META-SIMULATION-COVERAGE
reviewer: Critic-role-via-pi-ai
model: claude-haiku-4-5-20251001
verdict: ${v.verdict}
confidence: ${v.confidence}
citations: ${v.citations?.length ?? 0}
summary: "${(v.summary ?? "").replace(/"/g, "'").slice(0, 200)}"
`)
    console.log(`\nCRV artifact: ${crvPath}`)

    if (v.verdict === "aligned") {
      console.log("\n✅ Critic: ALIGNED — proceed to compilation.")
    } else if (v.verdict === "miscast") {
      console.log("\n❌ Critic: MISCAST — compilation HALTED. Architect decides.")
    } else {
      console.log("\n⚠️ Critic: UNCERTAIN — proceed with flag for Architect.")
    }
  } catch { console.log("PARSE FAILED") }
}

main().catch(console.error)
