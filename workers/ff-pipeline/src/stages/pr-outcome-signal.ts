/**
 * @module pr-outcome-signal
 *
 * Converts Factory-generated GitHub PR outcomes into internal Factory signals.
 * This module is observational only: it never merges, closes, or mutates PRs.
 */

import type { ArangoClient } from '@factory/arango-client'
import type { SignalInput } from '../types'
import type { FeedbackSignal } from './generate-feedback'
import { ingestSignal } from './ingest-signal'

export type GitHubPRState = 'OPEN' | 'CLOSED'
export type NormalizedPRState = 'draft' | 'ready' | 'merged' | 'closed'
export type NormalizedCIState = 'none' | 'pending' | 'passed' | 'failed'
export type NormalizedReviewState = 'none' | 'review-requested' | 'approved' | 'changes-requested'

export interface PROutcomeLineage {
  pipelineId: string
  signalId?: string
  pressureId?: string
  capabilityId?: string
  proposalId: string
  workGraphId: string
}

export interface PROutcomePullRequest {
  number: number
  url: string
  title: string
  state: GitHubPRState
  draft: boolean
  merged?: boolean
  headRefName: string
  baseRefName: string
  headSha: string
}

export interface PROutcomeCheck {
  name: string
  state: string
  workflow?: string
  link?: string
}

export interface PROutcomeReview {
  state: string
  author?: string
  submittedAt?: string
}

export interface PROutcomeInput {
  lineage: PROutcomeLineage
  pullRequest: PROutcomePullRequest
  checks?: PROutcomeCheck[]
  reviews?: PROutcomeReview[]
  reviewRequests?: string[]
  observedAt?: string
}

export type PROutcomeFetch = (input: string, init?: RequestInit) => Promise<Response>

export interface FetchPROutcomeOptions {
  githubToken: string
  repoOwner: string
  repoName: string
  pullNumber: number
  lineage: PROutcomeLineage
  observedAt?: string
  fetchFn?: PROutcomeFetch
}

export interface NormalizedPROutcome {
  prState: NormalizedPRState
  ciState: NormalizedCIState
  reviewState: NormalizedReviewState
  failingChecks: PROutcomeCheck[]
  pendingChecks: PROutcomeCheck[]
  passingChecks: PROutcomeCheck[]
}

export class PROutcomeSignalError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PROutcomeSignalError'
  }
}

const FAILED_CHECK_STATES = new Set(['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'SKIPPED'])
const PASSED_CHECK_STATES = new Set(['SUCCESS', 'PASS', 'PASSED'])
const PENDING_CHECK_STATES = new Set(['PENDING', 'IN_PROGRESS', 'QUEUED', 'WAITING', 'REQUESTED', 'EXPECTED'])

interface GitHubPullResponse {
  number: number
  html_url: string
  title: string
  state: string
  draft: boolean
  merged?: boolean
  head: {
    ref: string
    sha: string
  }
  base: {
    ref: string
  }
}

interface GitHubCheckRun {
  name: string
  status?: string
  conclusion?: string | null
  html_url?: string
}

interface GitHubCheckRunsResponse {
  check_runs?: GitHubCheckRun[]
}

interface GitHubReviewResponse {
  state: string
  user?: {
    login?: string
  } | null
  submitted_at?: string
}

interface GitHubRequestedReviewersResponse {
  users?: Array<{ login?: string }>
  teams?: Array<{ slug?: string }>
}

function assertNonEmpty(value: unknown, message: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new PROutcomeSignalError(message)
  }
}

function assertPositiveInteger(value: unknown, message: string): asserts value is number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new PROutcomeSignalError(message)
  }
}

function assertInput(input: PROutcomeInput): void {
  assertNonEmpty(input.lineage.pipelineId, 'lineage.pipelineId is required')
  assertNonEmpty(input.lineage.proposalId, 'lineage.proposalId is required')
  assertNonEmpty(input.lineage.workGraphId, 'lineage.workGraphId is required')
  assertPositiveInteger(input.pullRequest.number, 'pullRequest.number is required')
  assertNonEmpty(input.pullRequest.url, 'pullRequest.url is required')
  assertNonEmpty(input.pullRequest.title, 'pullRequest.title is required')
  assertNonEmpty(input.pullRequest.headRefName, 'pullRequest.headRefName is required')
  assertNonEmpty(input.pullRequest.baseRefName, 'pullRequest.baseRefName is required')
  assertNonEmpty(input.pullRequest.headSha, 'pullRequest.headSha is required')
}

function normalizedCheckState(check: PROutcomeCheck): string {
  return check.state.trim().toUpperCase().replace(/\s+/g, '_')
}

function apiHeaders(token: string): Record<string, string> {
  return {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'ff-pipeline',
  }
}

function apiUrl(owner: string, repo: string, path: string): string {
  return `https://api.github.com/repos/${owner}/${repo}${path}`
}

async function jsonOrThrow<T>(
  response: Response,
  message: string,
): Promise<T> {
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new PROutcomeSignalError(`${message} (${response.status}): ${body}`)
  }
  return await response.json() as T
}

function sourceRefs(lineage: PROutcomeLineage): string[] {
  const refs: string[] = []
  if (lineage.signalId) refs.push(`SIG:${lineage.signalId}`)
  if (lineage.pressureId) refs.push(`PRS:${lineage.pressureId}`)
  if (lineage.capabilityId) refs.push(`BC:${lineage.capabilityId}`)
  refs.push(`FN:${lineage.proposalId}`)
  refs.push(`WG:${lineage.workGraphId}`)
  return refs
}

function prState(pr: PROutcomePullRequest): NormalizedPRState {
  if (pr.state === 'CLOSED' && pr.merged === true) return 'merged'
  if (pr.state === 'CLOSED') return 'closed'
  if (pr.draft) return 'draft'
  return 'ready'
}

function reviewState(input: PROutcomeInput): NormalizedReviewState {
  const reviews = input.reviews ?? []
  if (reviews.some(review => review.state.toUpperCase() === 'CHANGES_REQUESTED')) {
    return 'changes-requested'
  }
  if (reviews.some(review => review.state.toUpperCase() === 'APPROVED')) {
    return 'approved'
  }
  if ((input.reviewRequests ?? []).length > 0) {
    return 'review-requested'
  }
  return 'none'
}

export function normalizePROutcome(input: PROutcomeInput): NormalizedPROutcome {
  assertInput(input)

  const checks = input.checks ?? []
  const failingChecks = checks.filter(check => FAILED_CHECK_STATES.has(normalizedCheckState(check)))
  const passingChecks = checks.filter(check => PASSED_CHECK_STATES.has(normalizedCheckState(check)))
  const pendingChecks = checks.filter(check => {
    const state = normalizedCheckState(check)
    return PENDING_CHECK_STATES.has(state) || (!FAILED_CHECK_STATES.has(state) && !PASSED_CHECK_STATES.has(state))
  })

  let ciState: NormalizedCIState = 'none'
  if (checks.length > 0 && failingChecks.length > 0) {
    ciState = 'failed'
  } else if (checks.length > 0 && pendingChecks.length > 0) {
    ciState = 'pending'
  } else if (checks.length > 0 && passingChecks.length === checks.length) {
    ciState = 'passed'
  }

  return {
    prState: prState(input.pullRequest),
    ciState,
    reviewState: reviewState(input),
    failingChecks,
    pendingChecks,
    passingChecks,
  }
}

export async function fetchPROutcomeFromGitHub(options: FetchPROutcomeOptions): Promise<PROutcomeInput> {
  assertNonEmpty(options.githubToken, 'githubToken is required')
  assertNonEmpty(options.repoOwner, 'repoOwner is required')
  assertNonEmpty(options.repoName, 'repoName is required')
  assertPositiveInteger(options.pullNumber, 'pullNumber is required')

  const fetcher = options.fetchFn ?? fetch
  const headers = apiHeaders(options.githubToken)
  const owner = options.repoOwner
  const repo = options.repoName

  const pullRequest = await jsonOrThrow<GitHubPullResponse>(
    await fetcher(apiUrl(owner, repo, `/pulls/${options.pullNumber}`), { method: 'GET', headers }),
    'GitHub PR fetch failed',
  )

  const checkRuns = await jsonOrThrow<GitHubCheckRunsResponse>(
    await fetcher(apiUrl(owner, repo, `/commits/${pullRequest.head.sha}/check-runs?per_page=100`), { method: 'GET', headers }),
    'GitHub check-runs fetch failed',
  )

  const reviews = await jsonOrThrow<GitHubReviewResponse[]>(
    await fetcher(apiUrl(owner, repo, `/pulls/${options.pullNumber}/reviews`), { method: 'GET', headers }),
    'GitHub reviews fetch failed',
  )

  const requestedReviewers = await jsonOrThrow<GitHubRequestedReviewersResponse>(
    await fetcher(apiUrl(owner, repo, `/pulls/${options.pullNumber}/requested_reviewers`), { method: 'GET', headers }),
    'GitHub requested-reviewers fetch failed',
  )

  return {
    lineage: options.lineage,
    pullRequest: {
      number: pullRequest.number,
      url: pullRequest.html_url,
      title: pullRequest.title,
      state: pullRequest.state.toUpperCase() === 'CLOSED' ? 'CLOSED' : 'OPEN',
      draft: pullRequest.draft,
      merged: pullRequest.merged ?? false,
      headRefName: pullRequest.head.ref,
      baseRefName: pullRequest.base.ref,
      headSha: pullRequest.head.sha,
    },
    checks: (checkRuns.check_runs ?? []).map(check => ({
      name: check.name,
      state: check.conclusion ?? check.status ?? 'unknown',
      ...(check.html_url ? { link: check.html_url } : {}),
    })),
    reviews: reviews.map(review => ({
      state: review.state,
      ...(review.user?.login ? { author: review.user.login } : {}),
      ...(review.submitted_at ? { submittedAt: review.submitted_at } : {}),
    })),
    reviewRequests: [
      ...(requestedReviewers.users ?? [])
        .map(user => user.login)
        .filter((login): login is string => typeof login === 'string' && login.length > 0),
      ...(requestedReviewers.teams ?? [])
        .map(team => team.slug)
        .filter((slug): slug is string => typeof slug === 'string' && slug.length > 0)
        .map(slug => `team:${slug}`),
    ],
    ...(options.observedAt ? { observedAt: options.observedAt } : {}),
  }
}

function rawPayload(input: PROutcomeInput, outcome: NormalizedPROutcome): Record<string, unknown> {
  return {
    pipelineId: input.lineage.pipelineId,
    proposalId: input.lineage.proposalId,
    workGraphId: input.lineage.workGraphId,
    pr: {
      number: input.pullRequest.number,
      url: input.pullRequest.url,
      title: input.pullRequest.title,
      state: input.pullRequest.state,
      draft: input.pullRequest.draft,
      merged: input.pullRequest.merged ?? false,
      headRefName: input.pullRequest.headRefName,
      baseRefName: input.pullRequest.baseRefName,
      headSha: input.pullRequest.headSha,
    },
    outcome: {
      prState: outcome.prState,
      ciState: outcome.ciState,
      reviewState: outcome.reviewState,
    },
    checks: {
      passed: outcome.passingChecks.map(check => check.name),
      failed: outcome.failingChecks.map(check => check.name),
      pending: outcome.pendingChecks.map(check => check.name),
    },
    reviews: input.reviews ?? [],
    reviewRequests: input.reviewRequests ?? [],
    observedAt: input.observedAt ?? new Date().toISOString(),
  }
}

function makeSignal(
  input: PROutcomeInput,
  subtype: string,
  title: string,
  description: string,
  outcome: NormalizedPROutcome,
): FeedbackSignal {
  const head = input.pullRequest.headSha.slice(0, 7)
  const signal: SignalInput & { raw: Record<string, unknown> } = {
    signalType: 'internal',
    source: 'factory:pr-outcome',
    subtype,
    title,
    description: `${description} at head ${head}`,
    sourceRefs: sourceRefs(input.lineage),
    raw: rawPayload(input, outcome),
  }
  return { signal, autoApprove: false }
}

export function buildPROutcomeSignals(input: PROutcomeInput): FeedbackSignal[] {
  const outcome = normalizePROutcome(input)
  const pr = input.pullRequest
  const wg = input.lineage.workGraphId
  const signals: FeedbackSignal[] = []

  if (outcome.ciState === 'failed') {
    const failed = outcome.failingChecks.map(check => check.name).join(', ')
    signals.push(makeSignal(
      input,
      'synthesis:pr-ci-failed',
      `PR CI failed: #${pr.number} for ${wg}`,
      `Factory PR #${pr.number} failed CI checks: ${failed}`,
      outcome,
    ))
  } else if (outcome.ciState === 'passed') {
    signals.push(makeSignal(
      input,
      'synthesis:pr-ci-passed',
      `PR CI passed: #${pr.number} for ${wg}`,
      `Factory PR #${pr.number} passed all observed CI checks`,
      outcome,
    ))
  }

  if (outcome.reviewState === 'changes-requested') {
    signals.push(makeSignal(
      input,
      'synthesis:pr-changes-requested',
      `PR changes requested: #${pr.number} for ${wg}`,
      `Factory PR #${pr.number} has requested changes`,
      outcome,
    ))
  } else if (outcome.reviewState === 'approved') {
    signals.push(makeSignal(
      input,
      'synthesis:pr-approved',
      `PR approved: #${pr.number} for ${wg}`,
      `Factory PR #${pr.number} has an approving review`,
      outcome,
    ))
  } else if (outcome.reviewState === 'review-requested') {
    signals.push(makeSignal(
      input,
      'synthesis:pr-review-requested',
      `PR review requested: #${pr.number} for ${wg}`,
      `Factory PR #${pr.number} is waiting on requested review`,
      outcome,
    ))
  }

  if (outcome.prState === 'merged') {
    signals.push(makeSignal(
      input,
      'synthesis:pr-merged',
      `PR merged: #${pr.number} for ${wg}`,
      `Factory PR #${pr.number} was merged`,
      outcome,
    ))
  } else if (outcome.prState === 'closed') {
    signals.push(makeSignal(
      input,
      'synthesis:pr-closed',
      `PR closed: #${pr.number} for ${wg}`,
      `Factory PR #${pr.number} was closed without merge`,
      outcome,
    ))
  }

  return signals
}

export async function ingestPROutcomeSignals(
  input: PROutcomeInput,
  db: ArangoClient,
): Promise<Record<string, unknown>[]> {
  const signals = buildPROutcomeSignals(input)
  const records: Record<string, unknown>[] = []
  for (const signal of signals) {
    records.push(await ingestSignal(signal.signal, db))
  }
  return records
}
