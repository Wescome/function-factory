export interface FunctionIdentityDocument {
  _key?: string
  lifecycleState?: string
  proposalId?: string
  proposal_ref?: string
  functionId?: string
  function_id?: string
}

export interface FunctionIdentityMergeReadiness {
  id?: string
  proposalId?: string
  functionId?: string
  verdict?: string
  readinessVerdict?: string
  prEvidence?: {
    signalId?: string
    headSha?: string
  }
}

export interface FunctionIdentityInput {
  proposalKey: string
  functionId: string
  proposalDocument?: FunctionIdentityDocument | null
  functionDocument?: FunctionIdentityDocument | null
  mergeReadinessPack?: FunctionIdentityMergeReadiness | null
}

export type FunctionIdentityMigrationAction =
  | 'create_function_document'
  | 'preserve_proposal_document'
  | 'block_monitored_promotion'
  | 'halt_identity_inconsistent'
  | 'halt_missing_proposal_document'

export interface FunctionIdentityMigrationOperation {
  action: FunctionIdentityMigrationAction
  targetKey: string
  sourceKey?: string
  reason: string
  fields?: {
    _key: string
    id: string
    proposal_ref: string
    functionId: string
    lifecycleState: string | null
    lifecycleStateSource: string
  }
}

export interface FunctionIdentityMigrationPlan {
  required: boolean
  safeToApply: boolean
  operations: FunctionIdentityMigrationOperation[]
}

export interface FunctionIdentityReport {
  proposalKey: string
  functionId: string
  derivedFunctionId: string | null
  identityConsistent: boolean
  resolution: 'mapped_not_migrated' | 'fully_materialized' | 'inconsistent'
  mutationApplied: false
  runtime: {
    proposalDocumentFound: boolean
    proposalLifecycleState: string | null
    functionDocumentFound: boolean
    functionLifecycleState: string | null
  }
  mergeReadiness?: {
    id: string | null
    proposalId: string | null
    functionId: string | null
    verdict: string | null
    signalId: string | null
    headSha: string | null
    consistent: boolean
  }
  migrationPlan: FunctionIdentityMigrationPlan
  findings: string[]
}

export class FunctionIdentityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FunctionIdentityError'
  }
}

function assertNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new FunctionIdentityError(`${field} is required`)
  }
}

export function deriveFunctionIdFromProposalKey(proposalKey: string): string | null {
  return proposalKey.startsWith('FP-') && proposalKey.length > 3
    ? `FN-${proposalKey.slice(3)}`
    : null
}

function docProposalRef(doc: FunctionIdentityDocument | null | undefined): string | null {
  if (!doc) return null
  return doc.proposalId ?? doc.proposal_ref ?? null
}

function docFunctionRef(doc: FunctionIdentityDocument | null | undefined): string | null {
  if (!doc) return null
  return doc.functionId ?? doc.function_id ?? null
}

function buildMigrationPlan(
  input: FunctionIdentityInput,
  identityConsistent: boolean,
  proposalDocumentFound: boolean,
  functionDocumentFound: boolean,
): FunctionIdentityMigrationPlan {
  if (!identityConsistent) {
    return {
      required: false,
      safeToApply: false,
      operations: [{
        action: 'halt_identity_inconsistent',
        targetKey: input.functionId,
        reason: 'Identity evidence is inconsistent; migration must not be applied until findings are resolved.',
      }],
    }
  }

  if (!proposalDocumentFound) {
    return {
      required: false,
      safeToApply: false,
      operations: [{
        action: 'halt_missing_proposal_document',
        targetKey: input.proposalKey,
        reason: 'The proposal-keyed lifecycle document is missing, so there is no source document to materialize.',
      }],
    }
  }

  const monitoredBlock: FunctionIdentityMigrationOperation = {
    action: 'block_monitored_promotion',
    targetKey: input.functionId,
    reason: 'Persistence Verification active monitoring is still required before monitored promotion.',
  }

  if (functionDocumentFound) {
    return {
      required: false,
      safeToApply: true,
      operations: [monitoredBlock],
    }
  }

  return {
    required: true,
    safeToApply: true,
    operations: [
      {
        action: 'create_function_document',
        targetKey: input.functionId,
        sourceKey: input.proposalKey,
        reason: 'Materialize the FN-keyed runtime document from the existing proposal-keyed lifecycle document.',
        fields: {
          _key: input.functionId,
          id: input.functionId,
          proposal_ref: input.proposalKey,
          functionId: input.functionId,
          lifecycleState: input.proposalDocument?.lifecycleState ?? null,
          lifecycleStateSource: input.proposalKey,
        },
      },
      {
        action: 'preserve_proposal_document',
        targetKey: input.proposalKey,
        reason: 'Keep the proposal-keyed lifecycle history intact until an explicit migration apply path exists.',
      },
      monitoredBlock,
    ],
  }
}

export function evaluateFunctionIdentity(input: FunctionIdentityInput): FunctionIdentityReport {
  assertNonEmpty(input.proposalKey, 'proposalKey')
  assertNonEmpty(input.functionId, 'functionId')

  const derivedFunctionId = deriveFunctionIdFromProposalKey(input.proposalKey)
  const findings: string[] = []
  const proposalDocumentFound = !!input.proposalDocument
  const functionDocumentFound = !!input.functionDocument
  const proposalDocFunctionRef = docFunctionRef(input.proposalDocument)
  const functionDocProposalRef = docProposalRef(input.functionDocument)
  const functionDocFunctionRef = docFunctionRef(input.functionDocument)

  if (derivedFunctionId !== input.functionId) {
    findings.push(`Derived Function ID ${derivedFunctionId ?? 'null'} does not match supplied functionId ${input.functionId}.`)
  }
  if (!proposalDocumentFound) {
    findings.push(`Runtime lifecycle document ${input.proposalKey} is missing from specs_functions.`)
  }
  if (!functionDocumentFound) {
    findings.push(`Materialized Function document ${input.functionId} is not present in specs_functions; lifecycle remains proposal-keyed.`)
  }
  if (proposalDocFunctionRef && proposalDocFunctionRef !== input.functionId) {
    findings.push(`Runtime proposal document function reference ${proposalDocFunctionRef} does not match ${input.functionId}.`)
  }
  if (functionDocProposalRef && functionDocProposalRef !== input.proposalKey) {
    findings.push(`Function document proposal reference ${functionDocProposalRef} does not match ${input.proposalKey}.`)
  }
  if (functionDocFunctionRef && functionDocFunctionRef !== input.functionId) {
    findings.push(`Function document function reference ${functionDocFunctionRef} does not match ${input.functionId}.`)
  }

  const mergeReadiness = input.mergeReadinessPack
    ? {
        id: input.mergeReadinessPack.id ?? null,
        proposalId: input.mergeReadinessPack.proposalId ?? null,
        functionId: input.mergeReadinessPack.functionId ?? null,
        verdict: input.mergeReadinessPack.verdict ?? input.mergeReadinessPack.readinessVerdict ?? null,
        signalId: input.mergeReadinessPack.prEvidence?.signalId ?? null,
        headSha: input.mergeReadinessPack.prEvidence?.headSha ?? null,
        consistent: input.mergeReadinessPack.proposalId === input.proposalKey
          && input.mergeReadinessPack.functionId === input.functionId,
      }
    : undefined

  if (mergeReadiness && !mergeReadiness.consistent) {
    findings.push('Merge-readiness pack identity does not match the supplied proposal/function pair.')
  }

  const identityConsistent = derivedFunctionId === input.functionId
    && (!proposalDocFunctionRef || proposalDocFunctionRef === input.functionId)
    && (!functionDocProposalRef || functionDocProposalRef === input.proposalKey)
    && (!functionDocFunctionRef || functionDocFunctionRef === input.functionId)
    && (!mergeReadiness || mergeReadiness.consistent)

  const resolution = identityConsistent && proposalDocumentFound && functionDocumentFound
    ? 'fully_materialized'
    : identityConsistent
      ? 'mapped_not_migrated'
      : 'inconsistent'
  const migrationPlan = buildMigrationPlan(input, identityConsistent, proposalDocumentFound, functionDocumentFound)

  return {
    proposalKey: input.proposalKey,
    functionId: input.functionId,
    derivedFunctionId,
    identityConsistent,
    resolution,
    mutationApplied: false,
    runtime: {
      proposalDocumentFound,
      proposalLifecycleState: input.proposalDocument?.lifecycleState ?? null,
      functionDocumentFound,
      functionLifecycleState: input.functionDocument?.lifecycleState ?? null,
    },
    ...(mergeReadiness ? { mergeReadiness } : {}),
    migrationPlan,
    findings,
  }
}
