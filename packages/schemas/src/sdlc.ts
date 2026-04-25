import { z } from "zod"
import { ArtifactId, Lineage } from "./lineage.js"

// ─── Shared enums ───────────────────────────────────────────────────

export const RoleName = z.enum([
  "Planner",
  "Coder",
  "Critic",
  "Tester",
  "Verifier",
])
export type RoleName = z.infer<typeof RoleName>

export const MentorRuleScope = z.enum(["global", "package", "role"])
export type MentorRuleScope = z.infer<typeof MentorRuleScope>

export const MentorRuleSource = z.enum([
  "architect",
  "inferred",
  "crystallized",
])
export type MentorRuleSource = z.infer<typeof MentorRuleSource>

export const MentorRuleStatus = z.enum([
  "active",
  "proposed",
  "superseded",
])
export type MentorRuleStatus = z.infer<typeof MentorRuleStatus>

// ─── MentorScript (MR-*) ───────────────────────────────────────────

export const MentorRule = z.object({
  _key: z.string(),
  id: ArtifactId.refine(
    (s) => s.startsWith("MR-"),
    "MentorRule IDs must start with MR-"
  ),
  rule: z.string().min(1),
  scope: MentorRuleScope,
  appliesTo: z.array(RoleName).min(1),
  source: MentorRuleSource,
  source_refs: z.array(ArtifactId),
  testable: z.boolean(),
  detectorId: ArtifactId.optional(),
  conflictsWith: z.array(z.string()).default([]),
  status: MentorRuleStatus,
  supersededBy: z.string().optional(),
  version: z.number().int().min(1).default(1),
  createdAt: z.string().datetime(),
  createdBy: z.string().min(1),
})
export type MentorRule = z.infer<typeof MentorRule>

// ─── CRP — Consultation Request Pack (CRP-*) ───────────────────────

export const CRPQuestionType = z.enum([
  "ambiguity",
  "tradeoff",
  "authority",
  "conflict",
])
export type CRPQuestionType = z.infer<typeof CRPQuestionType>

export const CRPUrgency = z.enum(["blocking", "advisory"])
export type CRPUrgency = z.infer<typeof CRPUrgency>

export const CRPStatus = z.enum(["pending", "resolved", "expired"])
export type CRPStatus = z.infer<typeof CRPStatus>

export const ConsultationOption = z.object({
  option: z.string().min(1),
  pros: z.string().min(1),
  cons: z.string().min(1),
})

export const ConsultationRequestPack = z.object({
  _key: z.string(),
  id: ArtifactId.refine(
    (s) => s.startsWith("CRP-"),
    "CRP IDs must start with CRP-"
  ),
  functionRunId: z.string(),
  workflowInstanceId: z.string(),
  role: z.string().min(1),
  stage: z.string().min(1),

  question: z.string().min(1),
  questionType: CRPQuestionType,

  context: z.object({
    currentState: z.string().min(1),
    optionsConsidered: z.array(ConsultationOption).min(1),
    tradeoffs: z.string().min(1),
    relevantArtifacts: z.array(z.string()).default([]),
    relevantCode: z.string().optional(),
  }),

  routing: z.object({
    targetRole: z.enum(["architect", "domain-expert", "tech-lead"]),
    urgency: CRPUrgency,
  }),

  status: CRPStatus,
  resolution: z.string().optional(),
  deadline: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime().optional(),
})
export type ConsultationRequestPack = z.infer<typeof ConsultationRequestPack>

// ─── VCR — Version Controlled Resolution (VCR-*) ───────────────────

export const VersionControlledResolution = z.object({
  _key: z.string(),
  id: ArtifactId.refine(
    (s) => s.startsWith("VCR-"),
    "VCR IDs must start with VCR-"
  ),
  resolves: z.object({
    type: z.enum(["crp", "mrp"]),
    id: z.string().min(1),
  }),

  decision: z.string().min(1),
  rationale: z.string().min(1),
  resolvedBy: z.string().min(1),

  mentorRuleProposal: z
    .object({
      rule: z.string().min(1),
      scope: MentorRuleScope,
      appliesTo: z.array(RoleName).min(1),
    })
    .optional(),

  revisionGuidance: z.string().optional(),
  source_refs: z.array(ArtifactId).default([]),
  createdAt: z.string().datetime(),
})
export type VersionControlledResolution = z.infer<
  typeof VersionControlledResolution
>

// ─── MRP — Merge-Readiness Pack (MRP-*) ────────────────────────────

export const MRPVerdict = z.enum([
  "merge-ready",
  "needs-revision",
  "rejected",
])
export type MRPVerdict = z.infer<typeof MRPVerdict>

export const MergeReadinessPack = z.object({
  _key: z.string(),
  id: ArtifactId.refine(
    (s) => s.startsWith("MRP-"),
    "MRP IDs must start with MRP-"
  ),
  functionId: z.string().min(1),
  workGraphId: z.string().min(1),
  pipelineInstanceId: z.string().min(1),

  functionalCompleteness: z.object({
    passed: z.boolean(),
    acceptanceCriteria: z.array(
      z.object({
        criterion: z.string(),
        met: z.boolean(),
        evidence: z.string(),
      })
    ),
  }),

  soundVerification: z.object({
    passed: z.boolean(),
    testPlan: z.string(),
    newTestCases: z.array(
      z.object({
        name: z.string(),
        type: z.enum(["unit", "integration", "property"]),
        result: z.enum(["pass", "fail"]),
      })
    ),
    gate2ReportId: z.string(),
    coveragePercentage: z.number().min(0).max(100).optional(),
  }),

  seHygiene: z.object({
    passed: z.boolean(),
    mentorRuleCompliance: z.array(
      z.object({
        ruleId: z.string(),
        rule: z.string(),
        compliant: z.boolean(),
        evidence: z.string().optional(),
      })
    ),
    lintReport: z
      .object({
        errors: z.number().int().min(0),
        warnings: z.number().int().min(0),
      })
      .optional(),
    complexityDelta: z
      .object({
        before: z.number(),
        after: z.number(),
      })
      .optional(),
  }),

  rationale: z.object({
    approach: z.string(),
    tradeoffsConsidered: z.string(),
    prDescription: z.string(),
    crpsResolved: z.array(z.string()).default([]),
  }),

  auditability: z.object({
    prdId: z.string(),
    workGraphId: z.string(),
    semanticReviewId: z.string(),
    gate1ReportId: z.string(),
    gate2ReportId: z.string(),
    sessionTreeId: z.string().optional(),
    modelBindings: z.record(z.object({
      provider: z.string(),
      model: z.string(),
    })),
    mentorRulesApplied: z.array(z.string()).default([]),
    totalTokenUsage: z.number().int().min(0),
    totalCost: z.number().min(0),
    executionDurationMs: z.number().int().min(0),
  }),

  ciEvidence: z
    .object({
      status: z.enum(["passed", "failed", "pending"]),
      checksPassed: z.array(z.string()).default([]),
      checksFailed: z
        .array(
          z.object({
            name: z.string(),
            conclusion: z.string(),
            logUrl: z.string(),
            annotation: z.string().optional(),
          })
        )
        .default([]),
      workflowRunId: z.number().optional(),
      commitSha: z.string().optional(),
      durationMs: z.number().optional(),
      verifiedAt: z.string().datetime().optional(),
    })
    .optional(),

  verdict: MRPVerdict,
  verdictRationale: z.string(),
  resolution: z.string().optional(),
  createdAt: z.string().datetime(),
})
export type MergeReadinessPack = z.infer<typeof MergeReadinessPack>

// ─── CI Signal Payloads ─────────────────────────────────────────────

export const CIPassPayload = z.object({
  subtype: z.literal("ci-pass"),
  prNumber: z.number().int(),
  branch: z.string(),
  functionId: z.string(),
  pipelineInstanceId: z.string(),
  mrpId: z.string(),
  commitSha: z.string(),
  ciWorkflowName: z.string(),
  ciWorkflowRunId: z.number().int(),
  durationMs: z.number().int(),
  checksPassed: z.array(z.string()),
})
export type CIPassPayload = z.infer<typeof CIPassPayload>

export const CIFailPayload = z.object({
  subtype: z.literal("ci-fail"),
  prNumber: z.number().int(),
  branch: z.string(),
  functionId: z.string(),
  pipelineInstanceId: z.string(),
  mrpId: z.string(),
  commitSha: z.string(),
  ciWorkflowName: z.string(),
  ciWorkflowRunId: z.number().int(),
  durationMs: z.number().int(),
  checksFailed: z.array(
    z.object({
      name: z.string(),
      conclusion: z.enum(["failure", "timed_out", "cancelled"]),
      logUrl: z.string(),
      annotation: z.string().optional(),
    })
  ),
  checksPassed: z.array(z.string()),
})
export type CIFailPayload = z.infer<typeof CIFailPayload>

export const CIRepairPayload = z.object({
  subtype: z.literal("ci-repair"),
  originalFunctionId: z.string(),
  originalMrpId: z.string(),
  originalPipelineInstanceId: z.string(),
  workGraphId: z.string(),
  classification: z.object({
    type: z.enum(["deterministic", "test-regression", "environment", "ambiguous"]),
    repairHint: z.string(),
    affectedChecks: z.array(z.string()),
  }),
  failureLogs: z.string(),
  prNumber: z.number().int(),
  branch: z.string(),
  commitSha: z.string(),
  repairAttempt: z.number().int().min(1),
})
export type CIRepairPayload = z.infer<typeof CIRepairPayload>

export const GitHubEventPayload = z.object({
  subtype: z.literal("github-event"),
  eventType: z.enum(["issue", "issue_comment", "pull_request"]),
  action: z.string(),
  raw: z.record(z.unknown()),
})
export type GitHubEventPayload = z.infer<typeof GitHubEventPayload>

export const CISignalPayload = z.discriminatedUnion("subtype", [
  CIPassPayload,
  CIFailPayload,
  CIRepairPayload,
  GitHubEventPayload,
])
export type CISignalPayload = z.infer<typeof CISignalPayload>

// ─── CI Failure Classification ──────────────────────────────────────

export const CIFailureType = z.enum([
  "deterministic",
  "test-regression",
  "environment",
  "ambiguous",
])
export type CIFailureType = z.infer<typeof CIFailureType>

export const CIFailureClassification = z.object({
  type: CIFailureType,
  repairHint: z.string(),
  affectedChecks: z.array(z.string()),
})
export type CIFailureClassification = z.infer<typeof CIFailureClassification>

// ─── Branch Naming Contract ─────────────────────────────────────────

export const FACTORY_BRANCH_PREFIX = "ff-" as const

export const FactoryBranchName = z
  .string()
  .regex(
    /^ff-[A-Z0-9][A-Z0-9-]*$/,
    "Factory branches must match ff-{FUNCTION-ID}"
  )
export type FactoryBranchName = z.infer<typeof FactoryBranchName>

export function toFactoryBranch(functionId: string): string {
  return `${FACTORY_BRANCH_PREFIX}${functionId}`
}

export function extractFunctionId(branch: string): string | null {
  if (!branch.startsWith(FACTORY_BRANCH_PREFIX)) return null
  return branch.slice(FACTORY_BRANCH_PREFIX.length)
}
