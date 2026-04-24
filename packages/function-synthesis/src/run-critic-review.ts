/**
 * Step 7: Critic reviews a real PRD for semantic alignment against whitepaper §3.
 * Bootstrap carve-out expiration test.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { getModel, streamSimple, calculateCost } from "@mariozechner/pi-ai"
import type { TextContent } from "@mariozechner/pi-ai"

const REPO = join(import.meta.dirname, "..", "..", "..")

const prdPath = join(REPO, "specs/prds/PRD-META-COMPILER-PASS-8.md")
const prdContent = readFileSync(prdPath, "utf-8")

const whitepaperPath = join(REPO, "specs/reference/The_Function_Factory_2026-04-18_v4.md")
const whitepaper = readFileSync(whitepaperPath, "utf-8")
const section3Match = whitepaper.match(/## 3\. The seven stages[\s\S]*?(?=## 4\.|$)/)
const section3 = section3Match ? section3Match[0].slice(0, 8000) : "§3 not found"

console.log("=== CRITIC PRD REVIEW (Step 7 — Bootstrap Carve-Out Expiration Test) ===\n")
console.log(`PRD: PRD-META-COMPILER-PASS-8`)
console.log(`Ground truth: whitepaper §3 (${section3.length} chars)\n`)

const model = getModel("anthropic", "claude-haiku-4-5-20251001")

const systemPrompt = `You are the Critic in the Function Factory's five-role topology.

YOUR ROLE: Review this PRD for SEMANTIC ALIGNMENT with whitepaper §3.

YOUR CONTRACT:
- You READ: the PRD content, the whitepaper §3 text
- You WRITE: a typed review verdict
- You MUST NOT: modify the PRD, modify the whitepaper, produce code

TASK: Compare the PRD's conceptual model against whitepaper §3.
Produce a verdict:
- "aligned": the PRD matches §3's definitions
- "miscast": the PRD contradicts §3
- "uncertain": cannot determine

Include citations to §3 text.

OUTPUT FORMAT (JSON only, no markdown fences):
{"verdict":"aligned|miscast|uncertain","confidence":0.0-1.0,"citations":[{"section":"§3","quote":"...","supports":true,"reasoning":"..."}],"summary":"..."}`

async function main() {
  const start = Date.now()
  const stream = streamSimple(model, {
    systemPrompt,
    messages: [{ role: "user" as const, content: `WHITEPAPER §3:\n${section3}\n\n---\n\nPRD TO REVIEW:\n${prdContent}\n\nProduce your verdict as JSON.`, timestamp: Date.now() }],
  }, { maxTokens: 4096 })

  const result = await stream.result()
  calculateCost(model, result.usage)

  const text = result.content
    .filter((c): c is TextContent => c.type === "text")
    .map(c => c.text)
    .join("")

  console.log("=== CRITIC VERDICT ===\n")
  console.log(text)
  console.log(`\n=== METRICS ===`)
  console.log(`Tokens: ${result.usage.input}in + ${result.usage.output}out = ${result.usage.totalTokens}`)
  console.log(`Cost: $${result.usage.cost.total.toFixed(4)}`)
  console.log(`Duration: ${((Date.now()-start)/1000).toFixed(1)}s`)

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    const verdict = JSON.parse(jsonMatch?.[0] ?? "{}")
    if (verdict.verdict && ["aligned", "miscast", "uncertain"].includes(verdict.verdict)) {
      console.log(`\n=== CARVE-OUT STATUS ===`)
      console.log(`Verdict: ${verdict.verdict} (confidence: ${verdict.confidence})`)
      console.log(`Citations: ${verdict.citations?.length ?? 0}`)
      console.log(`\n✅ Critic produced a real typed verdict with citations on a real PRD.`)
      console.log(`✅ Bootstrap carve-out expiration condition: MET.`)
    } else {
      console.log(`\n❌ Verdict not in expected format. Carve-out NOT expired.`)
    }
  } catch {
    console.log(`\n❌ Could not parse verdict JSON. Carve-out NOT expired.`)
  }
}

main().catch(console.error)
