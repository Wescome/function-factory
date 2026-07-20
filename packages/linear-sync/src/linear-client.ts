/**
 * @factory/linear-sync — linear-client
 *
 * Plain-fetch Linear GraphQL client.  No external graphql packages.
 * Auth: `Authorization: <key>` (no "Bearer" prefix — matches Linear's service-account pattern).
 *
 * Rate-limit handling: exponential backoff 1 s → 16 s, max 5 retries on 429.
 */

// ── Types returned by the client ─────────────────────────────────────────────

export interface LinearIssue {
  id: string        // UUID
  identifier: string  // human-readable, e.g. "WEO-42"
}

export interface LinearIssueRelation {
  id: string
}

export interface LinearComment {
  id: string
}

export interface LinearIssueLabel {
  id: string
  name: string
}

export interface LinearWorkflowState {
  id: string
  name: string
  type: string
}

export interface LinearDocument {
  id: string
}

export interface LinearCycle {
  id: string
  name: string
  startsAt: string
  endsAt: string
}

export interface CycleContext {
  cycleId: string
  cycleName: string
  startDate: string
  endDate: string
  isLastTwoDays: boolean
  isCycleEnd: boolean
  teamId: string
}

// ── Input types ──────────────────────────────────────────────────────────────

export interface IssueCreateInput {
  teamId: string
  title: string
  description?: string | undefined
  projectId?: string | undefined
  projectMilestoneId?: string | undefined
  stateId?: string | undefined
  labelIds?: string[] | undefined
  parentId?: string | undefined
}

export interface IssueUpdateInput {
  stateId?: string
  labelIds?: string[]
}

export interface IssueRelationCreateInput {
  issueId: string
  relatedIssueId: string
  type: 'blocks' | 'duplicate' | 'related'
}

export interface CommentCreateInput {
  issueId: string
  body: string
}

export interface IssueLabelCreateInput {
  teamId: string
  name: string
  color: string
}

export interface DocumentCreateInput {
  projectId: string
  title: string
  content: string
}

export interface DocumentUpdateInput {
  title?: string
  content?: string
}

export interface ProjectMilestoneCreateInput {
  projectId: string
  name: string
  targetDate?: string
  description?: string
}

// ── Client ───────────────────────────────────────────────────────────────────

export class LinearClient {
  private readonly endpoint = 'https://api.linear.app/graphql'

  constructor(private readonly apiKey: string) {}

  // ── Core fetch with retry ──────────────────────────────────────────────────

  private async gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const maxRetries = 5
    let delay = 1000

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const resp = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: this.apiKey,
        },
        body: JSON.stringify({ query, variables }),
      })

      if (resp.status === 429) {
        if (attempt === maxRetries) {
          throw new LinearApiError(429, 'Rate limit exceeded after max retries')
        }
        await sleep(delay)
        delay = Math.min(delay * 2, 16000)
        continue
      }

      if (!resp.ok) {
        const body = await resp.text()
        throw new LinearApiError(resp.status, body)
      }

      const json = (await resp.json()) as { data?: T; errors?: Array<{ message: string }> }
      if (json.errors && json.errors.length > 0) {
        throw new LinearGraphQLError(json.errors.map((e) => e.message).join('; '))
      }
      if (json.data === undefined) {
        throw new LinearGraphQLError('No data returned from Linear API')
      }
      return json.data
    }

    // unreachable — loop always returns or throws
    throw new LinearApiError(0, 'Unexpected end of retry loop')
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  async getWorkflowStates(teamId: string): Promise<LinearWorkflowState[]> {
    const query = `
      query($teamId: ID!) {
        workflowStates(filter: { team: { id: { eq: $teamId } } }) {
          nodes {
            id
            name
            type
          }
        }
      }
    `
    const data = await this.gql<{ workflowStates: { nodes: LinearWorkflowState[] } }>(query, { teamId })
    return data.workflowStates.nodes
  }

  async getIssueLabels(teamId: string): Promise<LinearIssueLabel[]> {
    const query = `
      query($teamId: ID!) {
        issueLabels(filter: { team: { id: { eq: $teamId } } }) {
          nodes {
            id
            name
          }
        }
      }
    `
    const data = await this.gql<{ issueLabels: { nodes: LinearIssueLabel[] } }>(query, { teamId })
    return data.issueLabels.nodes
  }

  async getCycleContext(teamId: string): Promise<CycleContext | null> {
    const query = `
      query($teamId: String!) {
        team(id: $teamId) {
          activeCycle {
            id
            name
            startsAt
            endsAt
          }
        }
      }
    `
    const data = await this.gql<{ team?: { activeCycle?: LinearCycle } }>(query, { teamId })
    const cycle = data.team?.activeCycle
    if (!cycle) return null

    const endDate = new Date(cycle.endsAt)
    const now = new Date()
    const msUntilEnd = endDate.getTime() - now.getTime()
    const daysUntilEnd = msUntilEnd / (1000 * 60 * 60 * 24)

    return {
      cycleId: cycle.id,
      cycleName: cycle.name,
      startDate: cycle.startsAt,
      endDate: cycle.endsAt,
      isLastTwoDays: daysUntilEnd >= 0 && daysUntilEnd <= 2,
      isCycleEnd: daysUntilEnd >= 0 && daysUntilEnd < 0.25,
      teamId,
    }
  }

  // ── Mutations ─────────────────────────────────────────────────────────────

  async issueCreate(input: IssueCreateInput): Promise<LinearIssue> {
    const query = `
      mutation($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue {
            id
            identifier
          }
        }
      }
    `
    const data = await this.gql<{ issueCreate: { success: boolean; issue: LinearIssue } }>(query, { input })
    return data.issueCreate.issue
  }

  async issueUpdate(id: string, input: IssueUpdateInput): Promise<LinearIssue> {
    const query = `
      mutation($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) {
          success
          issue {
            id
            identifier
          }
        }
      }
    `
    const data = await this.gql<{ issueUpdate: { success: boolean; issue: LinearIssue } }>(query, { id, input })
    return data.issueUpdate.issue
  }

  async issueRelationCreate(input: IssueRelationCreateInput): Promise<LinearIssueRelation> {
    const query = `
      mutation($input: IssueRelationCreateInput!) {
        issueRelationCreate(input: $input) {
          success
          issueRelation {
            id
          }
        }
      }
    `
    const data = await this.gql<{ issueRelationCreate: { success: boolean; issueRelation: LinearIssueRelation } }>(query, { input })
    return data.issueRelationCreate.issueRelation
  }

  async commentCreate(input: CommentCreateInput): Promise<LinearComment> {
    const query = `
      mutation($input: CommentCreateInput!) {
        commentCreate(input: $input) {
          success
          comment {
            id
          }
        }
      }
    `
    const data = await this.gql<{ commentCreate: { success: boolean; comment: LinearComment } }>(query, { input })
    return data.commentCreate.comment
  }

  async issueLabelCreate(input: IssueLabelCreateInput): Promise<LinearIssueLabel> {
    const query = `
      mutation($input: IssueLabelCreateInput!) {
        issueLabelCreate(input: $input) {
          success
          issueLabel {
            id
            name
          }
        }
      }
    `
    const data = await this.gql<{ issueLabelCreate: { success: boolean; issueLabel: LinearIssueLabel } }>(query, { input })
    return data.issueLabelCreate.issueLabel
  }

  async documentCreate(input: DocumentCreateInput): Promise<LinearDocument> {
    const query = `
      mutation($input: DocumentCreateInput!) {
        documentCreate(input: $input) {
          success
          document {
            id
          }
        }
      }
    `
    const data = await this.gql<{ documentCreate: { success: boolean; document: LinearDocument } }>(query, { input })
    return data.documentCreate.document
  }

  async documentUpdate(id: string, input: DocumentUpdateInput): Promise<LinearDocument> {
    const query = `
      mutation($id: String!, $input: DocumentUpdateInput!) {
        documentUpdate(id: $id, input: $input) {
          success
          document {
            id
          }
        }
      }
    `
    const data = await this.gql<{ documentUpdate: { success: boolean; document: LinearDocument } }>(query, { id, input })
    return data.documentUpdate.document
  }

  async projectMilestoneCreate(input: ProjectMilestoneCreateInput): Promise<{ id: string; name: string }> {
    const query = `
      mutation($input: ProjectMilestoneCreateInput!) {
        projectMilestoneCreate(input: $input) {
          success
          projectMilestone {
            id
            name
          }
        }
      }
    `
    const data = await this.gql<{ projectMilestoneCreate: { success: boolean; projectMilestone: { id: string; name: string } } }>(query, { input })
    return data.projectMilestoneCreate.projectMilestone
  }
}

// ── Error types ───────────────────────────────────────────────────────────────

export class LinearApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(`Linear API error ${status}: ${message}`)
    this.name = 'LinearApiError'
  }
}

export class LinearGraphQLError extends Error {
  constructor(message: string) {
    super(`Linear GraphQL error: ${message}`)
    this.name = 'LinearGraphQLError'
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
