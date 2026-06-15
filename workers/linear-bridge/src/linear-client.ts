/**
 * @module linear-client
 *
 * Linear GraphQL client — createComment, addLabel, updateIssueState.
 *
 * All mutations use Web Crypto / fetch (no external graphql packages).
 * Authentication: Linear personal API key passed as Bearer token.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LinearCommentResult {
  ok: true
  commentId: string
}

export interface LinearMutationFailure {
  ok: false
  error: string
}

export type LinearMutationResult = LinearCommentResult | LinearMutationFailure

export interface LinearLabelResult {
  ok: true
}

export interface LinearStateResult {
  ok: true
}

// ─── Endpoint ────────────────────────────────────────────────────────────────

const LINEAR_API_URL = 'https://api.linear.app/graphql'

// ─── GraphQL executor ─────────────────────────────────────────────────────────

async function graphql<T>(
  apiKey: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<{ data?: T; errors?: Array<{ message: string }> }> {
  const resp = await fetch(LINEAR_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ query, variables }),
  })

  if (!resp.ok) {
    const body = await resp.text().catch(() => '<unreadable>')
    throw new Error(`Linear API returned ${resp.status}: ${body}`)
  }

  return resp.json() as Promise<{ data?: T; errors?: Array<{ message: string }> }>
}

// ─── createComment ────────────────────────────────────────────────────────────

/**
 * Posts a comment on a Linear issue.
 *
 * @param apiKey   LINEAR_API_KEY
 * @param issueId  Linear issue ID (UUID)
 * @param body     Comment markdown body
 */
export async function createComment(
  apiKey: string,
  issueId: string,
  body: string,
): Promise<LinearCommentResult | LinearMutationFailure> {
  const query = `
    mutation CreateComment($issueId: String!, $body: String!) {
      commentCreate(input: { issueId: $issueId, body: $body }) {
        success
        comment {
          id
        }
      }
    }
  `

  type CreateCommentResponse = {
    commentCreate: {
      success: boolean
      comment: { id: string } | null
    }
  }

  try {
    const result = await graphql<CreateCommentResponse>(apiKey, query, { issueId, body })

    if (result.errors && result.errors.length > 0) {
      const msg = result.errors.map((e) => e.message).join('; ')
      return { ok: false, error: `Linear commentCreate errors: ${msg}` }
    }

    const commentId = result.data?.commentCreate?.comment?.id
    if (!commentId) {
      return { ok: false, error: 'Linear commentCreate returned no comment ID' }
    }

    return { ok: true, commentId }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ─── addLabel ────────────────────────────────────────────────────────────────

/**
 * Adds a label to a Linear issue by label ID.
 *
 * @param apiKey   LINEAR_API_KEY
 * @param issueId  Linear issue ID (UUID)
 * @param labelId  Linear label ID to add
 */
export async function addLabel(
  apiKey: string,
  issueId: string,
  labelId: string,
): Promise<LinearLabelResult | LinearMutationFailure> {
  const query = `
    mutation AddLabel($issueId: String!, $labelIds: [String!]!) {
      issueUpdate(id: $issueId, input: { labelIds: $labelIds }) {
        success
      }
    }
  `

  // First fetch existing labels, then append — Linear issueUpdate replaces, not appends.
  const getLabelsQuery = `
    query GetIssueLabels($issueId: String!) {
      issue(id: $issueId) {
        labels {
          nodes {
            id
          }
        }
      }
    }
  `

  type GetLabelsResponse = {
    issue: {
      labels: {
        nodes: Array<{ id: string }>
      }
    } | null
  }

  type UpdateResponse = {
    issueUpdate: { success: boolean }
  }

  try {
    // Get existing labels.
    const existing = await graphql<GetLabelsResponse>(apiKey, getLabelsQuery, { issueId })
    const existingIds = existing.data?.issue?.labels.nodes.map((n) => n.id) ?? []

    // Deduplicate.
    const labelIds = Array.from(new Set([...existingIds, labelId]))

    const result = await graphql<UpdateResponse>(apiKey, query, { issueId, labelIds })

    if (result.errors && result.errors.length > 0) {
      const msg = result.errors.map((e) => e.message).join('; ')
      return { ok: false, error: `Linear issueUpdate (add label) errors: ${msg}` }
    }

    if (!result.data?.issueUpdate?.success) {
      return { ok: false, error: 'Linear issueUpdate (add label) returned success=false' }
    }

    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ─── updateIssueState ─────────────────────────────────────────────────────────

/**
 * Updates a Linear issue to a given workflow state by state ID.
 *
 * @param apiKey   LINEAR_API_KEY
 * @param issueId  Linear issue ID (UUID)
 * @param stateId  Linear workflow state ID
 */
export async function updateIssueState(
  apiKey: string,
  issueId: string,
  stateId: string,
): Promise<LinearStateResult | LinearMutationFailure> {
  const query = `
    mutation UpdateIssueState($issueId: String!, $stateId: String!) {
      issueUpdate(id: $issueId, input: { stateId: $stateId }) {
        success
      }
    }
  `

  type UpdateStateResponse = {
    issueUpdate: { success: boolean }
  }

  try {
    const result = await graphql<UpdateStateResponse>(apiKey, query, { issueId, stateId })

    if (result.errors && result.errors.length > 0) {
      const msg = result.errors.map((e) => e.message).join('; ')
      return { ok: false, error: `Linear issueUpdate (state) errors: ${msg}` }
    }

    if (!result.data?.issueUpdate?.success) {
      return { ok: false, error: 'Linear issueUpdate (state) returned success=false' }
    }

    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
