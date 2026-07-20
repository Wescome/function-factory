/**
 * GraphQL Schema SDL — Factory External Interface
 *
 * Source: Factory-External-Interface-gRPC-GraphQL_v3.md §3.1 + §3.2
 * Query types only. Subscription stubs are present (returns null) — will be
 * wired in a later phase (ADR-0016 / Factory-Subscription-Replay-Contract-v1).
 */

export const typeDefs = /* GraphQL */ `
  scalar JSON

  # ── Enums ──────────────────────────────────────────────────────────────────

  enum SessionStatus {
    SUBMITTED
    CANDIDATE_SET_BUILT
    APPROVAL_GRANTED
    COMPILATION_STARTED
    COMPILATION_COMPLETE
    COMPILATION_FAILED
    REVIEW_REQUIRED
    REVIEW_RESOLVED
    DEPLOYING
    MONITORED
    COMPLETED
    FAILED
    CANCELLED
  }

  enum BeadStatus {
    ready
    in_progress
    done
    failed
  }

  enum ConsentVerdict {
    ACTIVE
    REVOKED
  }

  enum ArtifactKind {
    COMPILED_FUNCTION
    REVIEW_REPORT
    AMENDMENT
    VERIFICATION_REPORT
    EXECUTION_TRACE
    SPECIFICATION
    ELUCIDATION
  }

  enum VerificationKind {
    FIDELITY
    COHERENCE
    SAFETY
  }

  enum AmendmentStatus {
    PENDING
    APPROVED
    REJECTED
    SUPERSEDED
  }

  # ── Supporting scalars/types ───────────────────────────────────────────────

  type OptionScore {
    option: String!
    score: Float!
  }

  type EpistemicSurface {
    decisionId: ID!
    selectedOption: String!
    decisionEntropy: Float!
    decisionMargin: Float!
    alternativePressure: Float!
    governanceFriction: Float!
    topKAlternatives: JSON
    policyRefs: [String!]!
    requiresDownstreamReview: Boolean!
  }

  type ReviewPrompt {
    promptId: ID!
    role: String!
    question: String!
    context: JSON
    requiredBy: String
  }

  type IntentSpecRef {
    specId: ID!
    version: String!
    domain: String!
  }

  # ── Verification ───────────────────────────────────────────────────────────

  type VerificationReport {
    reportId: ID!
    sessionId: ID!
    kind: VerificationKind!
    verdict: String!
    score: Float
    notes: String
    producedAt: String!
    artifactId: ID
  }

  type EvidenceBundle {
    bundleId: ID!
    seq: Int!
    stream: String!
    kind: String!
    payload: JSON
    occurredAt: String!
  }

  type EvidenceChain {
    sessionId: ID!
    root: String!
    tip: String!
    bundleCount: Int!
    bundles: [EvidenceBundle!]!
  }

  # ── Lineage ────────────────────────────────────────────────────────────────

  type LineageEdge {
    sourceId: ID!
    targetId: ID!
    rel: String!
    props: JSON
  }

  type LineageGraph {
    rootId: ID!
    depth: Int!
    edges: [LineageEdge!]!
  }

  # ── Beads ──────────────────────────────────────────────────────────────────

  type ConsentBead {
    id: ID!
    beadId: String!
    roleId: String!
    grants: [String!]!
    status: ConsentVerdict!
    grantedBy: String!
    grantedAt: String!
    expiresAt: String
    revokes: String
  }

  type ExecutionBead {
    id: ID!
    moleculeId: String!
    gearId: String!
    nodeId: String!
    status: BeadStatus!
    assignedTo: String
    attemptCount: Int!
    payload: JSON
    result: JSON
    createdAt: String
    updatedAt: String
    consentBeads: [ConsentBead!]!
  }

  type Amendment {
    id: ID!
    beadId: String!
    targetBeadId: String!
    targetType: String!
    proposedChange: JSON!
    rationale: String!
    triggeredBy: String!
    status: AmendmentStatus!
    reviewedBy: String
    reviewedAt: String
    artifactGraphAmendmentId: String
  }

  # ── Artifacts ─────────────────────────────────────────────────────────────

  type FactoryArtifact {
    id: ID!
    sessionId: ID!
    kind: ArtifactKind!
    contentRef: String
    contentHash: String
    createdAt: String!
    metadata: JSON
  }

  # ── Sessions ───────────────────────────────────────────────────────────────

  type FactorySession {
    id: ID!
    assemblyId: ID!
    workOrderId: ID
    status: SessionStatus!
    createdAt: String!
    updatedAt: String!
    runId: String
    orgId: String
    intentSpecRef: IntentSpecRef
    epistemicSurface: EpistemicSurface
    reviewPrompts: [ReviewPrompt!]!
    beads: [ExecutionBead!]!
    amendments: [Amendment!]!
    artifacts(kinds: [ArtifactKind!]): [FactoryArtifact!]!
    verificationReports: [VerificationReport!]!
    evidenceChain: EvidenceChain
  }

  type SessionPage {
    sessions: [FactorySession!]!
    cursor: String
  }

  # ── Query ──────────────────────────────────────────────────────────────────

  type Query {
    """Fetch a single session by ID."""
    session(id: ID!): FactorySession

    """Paginated session list for an assembly, optionally filtered by status."""
    sessions(
      assemblyId: ID!
      status: SessionStatus
      limit: Int
      cursor: String
    ): SessionPage!

    """All sessions for a given work order."""
    sessionsByWorkOrder(workOrderId: ID!): [FactorySession!]!

    """Fetch a single artifact by ID."""
    artifact(id: ID!): FactoryArtifact

    """Lineage graph rooted at an artifact (max depth 5)."""
    lineage(artifactId: ID!, depth: Int): LineageGraph!

    """Raw bead list for a coordinator run."""
    beads(runId: ID!): [ExecutionBead!]!

    """Amendment list for a coordinator run."""
    amendments(runId: ID!): [Amendment!]!
  }

  # ── Subscription (stubs — wired in Phase 4 per ADR-0016) ──────────────────

  type Subscription {
    """
    Live session event stream (ADR-0016 Phase 4).
    Stub: returns null until SubscriptionEventBufferDO integration is wired.
    """
    sessionEvents(sessionId: ID!): JSON

    """
    Live artifact write stream for an assembly (ADR-0016 Phase 4).
    Stub: returns null until SubscriptionEventBufferDO integration is wired.
    """
    artifactWrites(assemblyId: ID!): JSON

    """
    Live bead status stream for a run (ADR-0016 Phase 4).
    Stub: returns null until SubscriptionEventBufferDO integration is wired.
    """
    beadUpdates(runId: ID!): JSON
  }
`
