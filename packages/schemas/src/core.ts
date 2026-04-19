/**
 * Core Factory artifact schemas.
 *
 * This module is the canonical definition of every Factory object. It is
 * on the permissions.md "never allowed" list for unapproved modification
 * because all downstream packages depend on these shapes.
 *
 * Each schema extends `Lineage` so source_refs / explicitness / rationale
 * are statically required. Every schema also has a companion JSON Schema
 * export (via zod-to-json-schema in a build step, not included here).
 */

import { z } from "zod"
import { ArtifactId, Lineage } from "./lineage.js"

// ─── Factory-wide enums ──────────────────────────────────────────────

/**
 * Factory operating mode. `bootstrap` is the Factory-built-by-Factory phase
 * where Gate 1's bootstrap_prefix_check runs and every artifact ID in
 * compiler intermediates must carry the META- qualifier (ConOps §4.1
 * Rule 2). `steady_state` is post-bootstrap operation where the prefix
 * check is skipped and Gate 1 runs only the four core coverage checks.
 *
 * Canonical definition. Every downstream package that distinguishes
 * Bootstrap from Steady-State imports from here. Do not redeclare.
 */
export const FactoryMode = z.enum(["bootstrap", "steady_state"])
export type FactoryMode = z.infer<typeof FactoryMode>

// ─── Stage 1 — Signals ───────────────────────────────────────────────

export const SignalType = z.enum([
  "market",
  "customer",
  "competitor",
  "regulatory",
  "internal",
  "meta",
])
export type SignalType = z.infer<typeof SignalType>

export const ExternalSignal = Lineage.extend({
  id: ArtifactId.refine((s) => s.startsWith("SIG-"), "Signal IDs must start with SIG-"),
  type: SignalType,
  source: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  timestamp: z.string().datetime(),
  confidence: z.number().min(0).max(1),
  frequency: z.number().min(0).max(1).optional(),
  severity: z.number().min(0).max(1).optional(),
  tags: z.array(z.string()).default([]),
  entities: z.array(z.string()).default([]),
  evidenceRefs: z.array(z.string()).optional(),
})
export type ExternalSignal = z.infer<typeof ExternalSignal>

// ─── Stage 2 — Pressures (Forcing Functions) ─────────────────────────

export const PressureCategory = z.enum([
  "growth",
  "retention",
  "reliability",
  "compliance",
  "risk",
  "efficiency",
  "competitive_gap",
  "trust",
])
export type PressureCategory = z.infer<typeof PressureCategory>

export const Pressure = Lineage.extend({
  id: ArtifactId.refine((s) => s.startsWith("PRS-"), "Pressure IDs must start with PRS-"),
  category: PressureCategory,
  name: z.string().min(1),
  description: z.string().min(1),
  derivedFromSignalIds: z.array(ArtifactId).min(1),
  affectedDomains: z.array(z.string()).default([]),
  affectedPersonas: z.array(z.string()).default([]),
  strength: z.number().min(0).max(1),
  urgency: z.number().min(0).max(1),
  frequency: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
})
export type Pressure = z.infer<typeof Pressure>

// ─── Stage 3 — Business Capabilities ─────────────────────────────────

export const BusinessCapability = Lineage.extend({
  id: ArtifactId.refine((s) => s.startsWith("BC-"), "Capability IDs must start with BC-"),
  name: z.string().min(1),
  purpose: z.string().min(1),
  addressesPressureIds: z.array(ArtifactId).min(1),
  desiredOutcomes: z.array(z.string()).min(1),
  constraints: z.array(z.string()).default([]),
  successMetrics: z.array(z.string()).min(1),
  affectedPersonas: z.array(z.string()).default([]),
  strategicPriority: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
})
export type BusinessCapability = z.infer<typeof BusinessCapability>

// ─── Stage 4 — Function Proposals ────────────────────────────────────

export const FunctionType = z.enum(["execution", "control", "evidence", "integration"])
export type FunctionType = z.infer<typeof FunctionType>

export const FunctionProposal = Lineage.extend({
  id: ArtifactId.refine((s) => s.startsWith("FP-"), "FunctionProposal IDs must start with FP-"),
  capabilityId: ArtifactId,
  name: z.string().regex(/^[a-z][a-z0-9_]*$/, "name must be snake_case"),
  purpose: z.string().min(1),
  functionType: FunctionType,
  expectedInputs: z.array(z.string()).default([]),
  expectedOutputs: z.array(z.string()).default([]),
  governingConstraints: z.array(z.string()).default([]),
  candidateInvariants: z.array(z.string()).default([]),
  successSignals: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
})
export type FunctionProposal = z.infer<typeof FunctionProposal>

// ─── Stage 5 — PRD, atoms, contracts, invariants, dependencies, validations, WorkGraph

export const PRDDraft = Lineage.extend({
  id: ArtifactId.refine((s) => s.startsWith("PRD-"), "PRD IDs must start with PRD-"),
  sourceCapabilityId: ArtifactId,
  sourceFunctionId: ArtifactId,
  title: z.string().min(1),
  problem: z.string().min(1),
  goal: z.string().min(1),
  constraints: z.array(z.string()).default([]),
  acceptanceCriteria: z.array(z.string()).min(1),
  successMetrics: z.array(z.string()).min(1),
  outOfScope: z.array(z.string()).default([]),
})
export type PRDDraft = z.infer<typeof PRDDraft>

export const AtomCategory = z.enum([
  "user_story",
  "business_rule",
  "constraint",
  "nfr",
  "integration",
  "acceptance",
])
export type AtomCategory = z.infer<typeof AtomCategory>

export const RequirementAtom = Lineage.extend({
  id: ArtifactId.refine((s) => s.startsWith("ATOM-"), "Atom IDs must start with ATOM-"),
  category: AtomCategory,
  subject: z.string().min(1),
  action: z.string().min(1),
  object: z.string().min(1),
  conditions: z.array(z.string()).default([]),
  qualifiers: z.array(z.string()).default([]),
  successCondition: z.string().nullable(),
})
export type RequirementAtom = z.infer<typeof RequirementAtom>

export const ContractKind = z.enum(["api", "schema", "behavior", "invariant"])
export const Contract = Lineage.extend({
  id: ArtifactId,
  kind: ContractKind,
  statement: z.string().min(1),
  producerHint: z.string().nullable(),
  consumerHints: z.array(z.string()).default([]),
  derivedFromAtomIds: z.array(ArtifactId).min(1),
})
export type Contract = z.infer<typeof Contract>

export const InvariantScope = z.enum(["entity", "workflow", "system"])
export const ViolationImpact = z.enum(["low", "medium", "high"])

/**
 * Detector spec. An Invariant without one of these is rejected at Gate 1.
 */
export const DetectorSpec = z.object({
  name: z.string().min(1),
  evidence_sources: z
    .array(z.string())
    .min(1, "at least one evidence source must be named"),
  direct_rules: z
    .array(z.string())
    .min(1, "at least one direct rule required — the detector must be evaluable"),
  warning_rules: z.array(z.string()).default([]),
  regression_policy: z
    .record(z.string(), z.enum(["watch", "degraded", "regressed"]))
    .refine(
      (p) => Object.keys(p).length > 0,
      "regression_policy must map at least one judgment to a transition"
    ),
  incident_tags: z.array(z.string()).default([]),
})
export type DetectorSpec = z.infer<typeof DetectorSpec>

export const Invariant = Lineage.extend({
  id: ArtifactId.refine((s) => s.startsWith("INV-"), "Invariant IDs must start with INV-"),
  functionId: ArtifactId.optional(),
  scope: InvariantScope,
  statement: z.string().min(1),
  violationImpact: ViolationImpact,
  derivedFromAtomIds: z.array(ArtifactId).default([]),
  derivedFromContractIds: z.array(ArtifactId).default([]),
  detector: DetectorSpec,
})
export type Invariant = z.infer<typeof Invariant>

export const DependencyType = z.enum([
  "blocks",
  "constrains",
  "implements",
  "validates",
  "informs",
])

export const Dependency = Lineage.extend({
  id: ArtifactId.refine((s) => s.startsWith("DEP-"), "Dependency IDs must start with DEP-"),
  from: ArtifactId,
  to: ArtifactId,
  type: DependencyType,
})
export type Dependency = z.infer<typeof Dependency>

export const ValidationKind = z.enum([
  "compile",
  "lint",
  "unit",
  "integration",
  "scenario",
  "property",
  "security",
  "performance",
])
export const ValidationPriority = z.enum(["required", "recommended", "optional"])

export const ValidationSpec = Lineage.extend({
  id: ArtifactId.refine((s) => s.startsWith("VAL-"), "Validation IDs must start with VAL-"),
  kind: ValidationKind,
  statement: z.string().min(1),
  targetRefs: z.array(ArtifactId).default([]),
  coversAtomIds: z.array(ArtifactId).default([]),
  coversContractIds: z.array(ArtifactId).default([]),
  coversInvariantIds: z.array(ArtifactId).default([]),
  priority: ValidationPriority,
})
export type ValidationSpec = z.infer<typeof ValidationSpec>

export const WorkGraphNodeType = z.enum(["interface", "execution", "control", "evidence"])

export const WorkGraphNode = z.object({
  id: z.string().min(1),
  type: WorkGraphNodeType,
  title: z.string().min(1),
  implements: ArtifactId.optional(),
})

export const WorkGraphEdge = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  condition: z.string().optional(),
  dependencyType: DependencyType.optional(),
})

export const WorkGraph = Lineage.extend({
  id: ArtifactId.refine((s) => s.startsWith("WG-"), "WorkGraph IDs must start with WG-"),
  functionId: ArtifactId,
  nodes: z.array(WorkGraphNode).min(1),
  edges: z.array(WorkGraphEdge).default([]),
})
export type WorkGraph = z.infer<typeof WorkGraph>

// ─── Stage 7 — Trust, Trajectory, Regression ──────────────────────────

export const FunctionLifecycle = z.enum([
  "designed",
  "planned",
  "in_progress",
  "implemented",
  "verified",
  "monitored",
  "regressed",
  "assurance_regressed",
  "retired",
])
export type FunctionLifecycle = z.infer<typeof FunctionLifecycle>

export const TrustSignal = z.object({
  functionId: ArtifactId,
  correctness: z.number().min(0).max(1),
  compliance: z.number().min(0).max(1),
  observability: z.number().min(0).max(1),
  stability: z.number().min(0).max(1),
  userResponse: z.number().min(0).max(1),
  composite: z.number().min(0).max(1).optional(),
  timestamp: z.string().datetime(),
})
export type TrustSignal = z.infer<typeof TrustSignal>

export const Trajectory = Lineage.extend({
  id: ArtifactId.refine((s) => s.startsWith("TRJ-"), "Trajectory IDs must start with TRJ-"),
  subject: z.string().min(1),
  driftType: z.string().min(1),
  dimensions: z.object({
    frequency: z.enum(["low", "medium", "high"]),
    severity: z.enum(["low", "medium", "high"]),
    coupling: z.enum(["low", "medium", "high"]),
    latency: z.enum(["low", "medium", "high"]),
    recovery_cost: z.enum(["low", "medium", "high"]),
  }),
  timeWindow: z.string(),
  observedMetrics: z.array(
    z.object({
      metric: z.string(),
      baseline: z.number(),
      current: z.number(),
    })
  ),
})
export type Trajectory = z.infer<typeof Trajectory>

export const ProblemFrame = Lineage.extend({
  id: ArtifactId.refine((s) => s.startsWith("PF-"), "ProblemFrame IDs must start with PF-"),
  trajectoryId: ArtifactId,
  systemArea: z.string().min(1),
  problemStatement: z.string().min(1),
  likelyFailureModes: z.array(z.string()).min(1),
  currentFunctionsImpacted: z.array(ArtifactId).default([]),
  unmetNeeds: z.array(z.string()).min(1),
  confidence: z.number().min(0).max(1),
})
export type ProblemFrame = z.infer<typeof ProblemFrame>

export const Incident = Lineage.extend({
  id: ArtifactId.refine((s) => s.startsWith("INC-"), "Incident IDs must start with INC-"),
  invariantIds: z.array(ArtifactId).default([]),
  functionIds: z.array(ArtifactId).default([]),
  severity: z.enum(["sev1", "sev2", "sev3", "sev4"]),
  status: z.enum(["open", "mitigated", "resolved"]),
  confidence: z.number().min(0).max(1),
})
export type Incident = z.infer<typeof Incident>
