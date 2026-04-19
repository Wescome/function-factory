/**
 * @factory/compiler
 *
 * Stage 5 compiler- transforms PRDDraft into a Gate 1 Coverage Report
 * (and, in a future PR, a WorkGraph). Eight narrow passes per the
 * `prd-compiler` SKILL; Pass 7 is Gate 1 from @factory/coverage-gates.
 *
 * MVP scope- Passes 0–7. Pass 8 (assemble_workgraph) is not implemented
 * in this PR; the Coverage Report is the bootstrap proof.
 */

export { compile } from "./compile.js"
export type { CompileOptions } from "./compile.js"
export type {
  CompileResult,
  CompilerIntermediates,
  FactoryMode,
  NormalizedPRD,
} from "./types.js"
