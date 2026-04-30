import { spawn } from 'node:child_process'
import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const AGENT_REQUEST_SCHEMA_VERSION = 'factory.agent-request.v0' as const
export const AGENT_RESULT_SCHEMA_VERSION = 'factory.agent-result.v0' as const
export const QUEUE_EVENT_SCHEMA_VERSION = 'factory.queue-event.v0' as const

export const AGENT_ROLES = [
  'architect',
  'builder',
  'tester',
  'critic',
  'verifier',
  'operator',
] as const

export const AUTONOMY_MODES = [
  'recommend_only',
  'enqueue_only',
  'branch_pr',
  'multi_agent_pr',
] as const

export const BRANCH_MODES = ['read_only', 'new_pr_branch'] as const

export const FORBIDDEN_ACTIONS = [
  'merge_default_branch',
  'deploy_production',
  'force_push',
  'delete_remote_branch',
  'edit_secrets',
] as const

export const EVIDENCE_KINDS = [
  'git_diff',
  'test_output',
  'typecheck_output',
  'artifact_paths',
  'pr_url',
  'review_report',
  'coverage_report',
] as const

export const QUEUE_EVENT_TYPES = [
  'request.enqueued',
  'request.claimed',
  'request.heartbeat',
  'request.completed',
  'request.failed',
  'request.dead_lettered',
] as const

export type AgentRole = (typeof AGENT_ROLES)[number]
export type AutonomyMode = (typeof AUTONOMY_MODES)[number]
export type BranchMode = (typeof BRANCH_MODES)[number]
export type ForbiddenAction = (typeof FORBIDDEN_ACTIONS)[number]
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number]
export type QueueEventType = (typeof QUEUE_EVENT_TYPES)[number]
type NonEmptyReadonlyArray<T> = readonly [T, ...T[]]

export interface WorkGraphHandle {
  id: string
  nodeId: string
  sourcePrdId?: string
  sourceRefs: string[]
}

export interface RepoTarget {
  provider: 'github' | 'local'
  owner?: string
  name: string
  defaultBranch: string
  remoteUrl?: string
  localPath?: string
}

export interface BranchPolicy {
  mode: BranchMode
  base: string
  prefix: string
}

export interface ExecutionPolicy {
  autonomyMode: AutonomyMode
  allowedPaths: string[]
  forbiddenActions: ForbiddenAction[]
  requiresHumanApprovalFor: ForbiddenAction[]
  maxRuntimeMinutes?: number
}

export interface ContextArtifact {
  id: string
  kind: string
  path: string
}

export interface RequestContext {
  summary: string
  artifacts: ContextArtifact[]
}

export interface ExpectedArtifact {
  path: string
  kind: string
}

export interface AgentRequest {
  schemaVersion: typeof AGENT_REQUEST_SCHEMA_VERSION
  id: string
  createdAt: string
  workgraph: WorkGraphHandle
  role: AgentRole
  objective: string
  prompt: string
  repo: RepoTarget
  branch: BranchPolicy
  policy: ExecutionPolicy
  context: RequestContext
  acceptanceCriteria: string[]
  requiredCommands: string[]
  expectedArtifacts: ExpectedArtifact[]
  evidenceRequired: EvidenceKind[]
}

export type AgentResultStatus = 'completed' | 'failed' | 'refused'

export interface CommandEvidence {
  command: string
  exitCode: number
  outputRef: string
}

export interface EvidenceRef {
  kind: EvidenceKind
  path?: string
  url?: string
  summary: string
}

export interface AgentResult {
  schemaVersion: typeof AGENT_RESULT_SCHEMA_VERSION
  id: string
  requestId: string
  agentRunId: string
  status: AgentResultStatus
  completedAt: string
  branchName?: string
  prUrl?: string
  summary: string
  changedFiles: string[]
  commands: CommandEvidence[]
  evidence: EvidenceRef[]
  refusalReason?: string
}

export interface QueueEvent {
  schemaVersion: typeof QUEUE_EVENT_SCHEMA_VERSION
  id: string
  type: QueueEventType
  requestId: string
  timestamp: string
  actor: string
  details: Record<string, unknown>
}

export interface JsonlAgentQueueOptions {
  queueDir: string
  actor: string
  now?: () => Date
}

export interface QueueClaim {
  requestId: string
  actor: string
  claimedAt: string
}

export interface JsonlQueueStatus {
  queueDir: string
  total: number
  pending: number
  claimed: number
  completed: number
  failed: number
  refused: number
}

export interface RunnerCommand {
  command: string
  args: string[]
  cwd: string
}

export interface CodexRunnerPlanOptions {
  repoRoot: string
  codexBinary?: string
}

export interface CodexRunnerPlan {
  requestId: string
  branchName: string
  repoRoot: string
  preflightCommands: RunnerCommand[]
  codexCommand: RunnerCommand
  prompt: string
}

export interface CommandRunResult {
  command: string
  args: string[]
  cwd: string
  exitCode: number
  stdout: string
  stderr: string
  startedAt: string
  completedAt: string
}

export interface CodexRunnerExecution {
  requestId: string
  branchName: string
  status: 'completed' | 'failed'
  commands: CommandRunResult[]
  failedCommand?: string
}

export type CommandExecutor = (command: RunnerCommand) => Promise<CommandRunResult>

export interface ProcessCommandExecutorOptions {
  now?: () => Date
}

export class AutonomousSchedulerValidationError extends Error {
  public readonly issues: string[]

  public constructor(message: string, issues: string[]) {
    super(message)
    this.name = 'AutonomousSchedulerValidationError'
    this.issues = issues
  }
}

export function validateAgentRequest(input: unknown): AgentRequest {
  const issues: string[] = []
  const data = record(input, 'AgentRequest', issues)

  const schemaVersion = literal(
    value(data, 'schemaVersion'),
    AGENT_REQUEST_SCHEMA_VERSION,
    'schemaVersion',
    issues,
  )
  const id = prefixedString(value(data, 'id'), 'AR-', 'id', issues)
  const createdAt = isoString(value(data, 'createdAt'), 'createdAt', issues)
  const workgraph = parseWorkGraph(record(value(data, 'workgraph'), 'workgraph', issues), issues)
  const role = oneOf(value(data, 'role'), AGENT_ROLES, 'role', issues)
  const objective = nonEmptyString(value(data, 'objective'), 'objective', issues)
  const prompt = nonEmptyString(value(data, 'prompt'), 'prompt', issues)
  const repo = parseRepo(record(value(data, 'repo'), 'repo', issues), issues)
  const branch = parseBranch(record(value(data, 'branch'), 'branch', issues), issues)
  const policy = parsePolicy(record(value(data, 'policy'), 'policy', issues), issues)
  const context = parseContext(record(value(data, 'context'), 'context', issues), issues)
  const acceptanceCriteria = nonEmptyStringArray(value(data, 'acceptanceCriteria'), 'acceptanceCriteria', issues)
  const requiredCommands = nonEmptyStringArray(value(data, 'requiredCommands'), 'requiredCommands', issues)
  const expectedArtifacts = parseExpectedArtifacts(array(value(data, 'expectedArtifacts'), 'expectedArtifacts', issues), issues)
  const evidenceRequired = enumArray(value(data, 'evidenceRequired'), EVIDENCE_KINDS, 'evidenceRequired', issues)

  if (evidenceRequired.length === 0) {
    issues.push('evidenceRequired must contain at least one evidence kind')
  }

  if (role === 'builder' && branch.mode !== 'new_pr_branch') {
    issues.push('builder requests must use branch.mode=new_pr_branch')
  }

  throwIfIssues('AgentRequest validation failed', issues)

  return {
    schemaVersion,
    id,
    createdAt,
    workgraph,
    role,
    objective,
    prompt,
    repo,
    branch,
    policy,
    context,
    acceptanceCriteria,
    requiredCommands,
    expectedArtifacts,
    evidenceRequired,
  }
}

export function validateAgentResult(input: unknown): AgentResult {
  const issues: string[] = []
  const data = record(input, 'AgentResult', issues)

  const schemaVersion = literal(
    value(data, 'schemaVersion'),
    AGENT_RESULT_SCHEMA_VERSION,
    'schemaVersion',
    issues,
  )
  const id = prefixedString(value(data, 'id'), 'ARES-', 'id', issues)
  const requestId = prefixedString(value(data, 'requestId'), 'AR-', 'requestId', issues)
  const agentRunId = prefixedString(value(data, 'agentRunId'), 'RUN-', 'agentRunId', issues)
  const status = oneOf(value(data, 'status'), ['completed', 'failed', 'refused'] as const, 'status', issues)
  const completedAt = isoString(value(data, 'completedAt'), 'completedAt', issues)
  const branchName = optionalNonEmptyString(value(data, 'branchName'), 'branchName', issues)
  const prUrl = optionalNonEmptyString(value(data, 'prUrl'), 'prUrl', issues)
  const summary = nonEmptyString(value(data, 'summary'), 'summary', issues)
  const changedFiles = stringArray(value(data, 'changedFiles'), 'changedFiles', issues)
  const commands = parseCommands(array(value(data, 'commands'), 'commands', issues), issues)
  const evidence = parseEvidence(array(value(data, 'evidence'), 'evidence', issues), issues)
  const refusalReason = optionalNonEmptyString(value(data, 'refusalReason'), 'refusalReason', issues)

  if (status === 'completed') {
    if (!branchName) issues.push('completed AgentResult must include branchName')
    if (!prUrl) issues.push('completed AgentResult must include prUrl')
    if (changedFiles.length === 0) issues.push('completed AgentResult must include changedFiles')
    if (!evidence.some((entry) => entry.kind === 'pr_url')) {
      issues.push('completed AgentResult must include pr_url evidence')
    }
  }

  if (status === 'refused' && !refusalReason) {
    issues.push('refused AgentResult must include refusalReason')
  }

  throwIfIssues('AgentResult validation failed', issues)

  const result: AgentResult = {
    schemaVersion,
    id,
    requestId,
    agentRunId,
    status,
    completedAt,
    summary,
    changedFiles,
    commands,
    evidence,
  }

  if (branchName) result.branchName = branchName
  if (prUrl) result.prUrl = prUrl
  if (refusalReason) result.refusalReason = refusalReason

  return result
}

export function validateQueueEvent(input: unknown): QueueEvent {
  const issues: string[] = []
  const data = record(input, 'QueueEvent', issues)

  const schemaVersion = literal(
    value(data, 'schemaVersion'),
    QUEUE_EVENT_SCHEMA_VERSION,
    'schemaVersion',
    issues,
  )
  const id = prefixedString(value(data, 'id'), 'QE-', 'id', issues)
  const type = oneOf(value(data, 'type'), QUEUE_EVENT_TYPES, 'type', issues)
  const requestId = prefixedString(value(data, 'requestId'), 'AR-', 'requestId', issues)
  const timestamp = isoString(value(data, 'timestamp'), 'timestamp', issues)
  const actor = nonEmptyString(value(data, 'actor'), 'actor', issues)
  const details = record(value(data, 'details'), 'details', issues)

  throwIfIssues('QueueEvent validation failed', issues)

  return {
    schemaVersion,
    id,
    type,
    requestId,
    timestamp,
    actor,
    details,
  }
}

export function planCodexRunner(input: unknown, options: CodexRunnerPlanOptions): CodexRunnerPlan {
  const request = validateAgentRequest(input)

  if (request.branch.mode !== 'new_pr_branch') {
    throw new Error(`Codex runner requires branch.mode=new_pr_branch for ${request.id}`)
  }

  if (request.policy.autonomyMode !== 'branch_pr' && request.policy.autonomyMode !== 'multi_agent_pr') {
    throw new Error(`Codex runner cannot execute autonomyMode=${request.policy.autonomyMode}`)
  }

  const branchName = buildBranchName(request)
  const codexBinary = options.codexBinary ?? 'codex'
  const prompt = buildCodexWorkerPrompt(request)

  return {
    requestId: request.id,
    branchName,
    repoRoot: options.repoRoot,
    preflightCommands: [
      {
        command: 'git',
        args: ['fetch', 'origin', request.branch.base],
        cwd: options.repoRoot,
      },
      {
        command: 'git',
        args: ['switch', '-c', branchName, `origin/${request.branch.base}`],
        cwd: options.repoRoot,
      },
      {
        command: 'git',
        args: ['status', '--short'],
        cwd: options.repoRoot,
      },
    ],
    codexCommand: {
      command: codexBinary,
      args: ['exec', prompt],
      cwd: options.repoRoot,
    },
    prompt,
  }
}

export function buildCodexWorkerPrompt(input: unknown): string {
  const request = validateAgentRequest(input)

  return [
    'You are a Function Factory Codex worker.',
    '',
    `Request: ${request.id}`,
    `Role: ${request.role}`,
    `Objective: ${request.objective}`,
    `WorkGraph: ${request.workgraph.id} / ${request.workgraph.nodeId}`,
    `Repository: ${request.repo.provider}:${request.repo.owner ? `${request.repo.owner}/` : ''}${request.repo.name}`,
    '',
    'Execution policy:',
    `- Autonomy mode: ${request.policy.autonomyMode}`,
    `- Branch mode: ${request.branch.mode}`,
    `- Base branch: ${request.branch.base}`,
    `- Allowed paths: ${request.policy.allowedPaths.join(', ')}`,
    `- Forbidden actions: ${request.policy.forbiddenActions.join(', ')}`,
    `- Human approval required for: ${request.policy.requiresHumanApprovalFor.join(', ')}`,
    '',
    'Context artifacts:',
    ...request.context.artifacts.map((artifact) => `- ${artifact.id} (${artifact.kind}): ${artifact.path}`),
    '',
    'Worker prompt:',
    request.prompt,
    '',
    'Acceptance criteria:',
    ...request.acceptanceCriteria.map((criterion, index) => `${index + 1}. ${criterion}`),
    '',
    'Required commands:',
    ...request.requiredCommands.map((command) => `- ${command}`),
    '',
    'Expected artifacts:',
    ...request.expectedArtifacts.map((artifact) => `- ${artifact.path} (${artifact.kind})`),
    '',
    'Required evidence:',
    ...request.evidenceRequired.map((kind) => `- ${kind}`),
    '',
    'Return an AgentResult-compatible summary with changed files, command evidence, PR URL, and refusalReason if refused.',
    'Do not merge, deploy, force-push, delete remote branches, edit secrets, or write outside allowed paths.',
  ].join('\n')
}

export async function executeCodexRunnerPlan(
  plan: CodexRunnerPlan,
  executor: CommandExecutor = createProcessCommandExecutor(),
): Promise<CodexRunnerExecution> {
  const commands: CommandRunResult[] = []

  for (const command of [...plan.preflightCommands, plan.codexCommand]) {
    const result = await executor(command)
    commands.push(result)

    if (result.exitCode !== 0) {
      return {
        requestId: plan.requestId,
        branchName: plan.branchName,
        status: 'failed',
        commands,
        failedCommand: stringifyCommand(command),
      }
    }
  }

  return {
    requestId: plan.requestId,
    branchName: plan.branchName,
    status: 'completed',
    commands,
  }
}

export function createProcessCommandExecutor(options?: ProcessCommandExecutorOptions): CommandExecutor {
  const now = options?.now ?? (() => new Date())

  return async (command: RunnerCommand): Promise<CommandRunResult> => {
    const startedAt = now().toISOString()
    const { exitCode, stdout, stderr } = await spawnCommand(command)
    const completedAt = now().toISOString()

    return {
      command: command.command,
      args: command.args,
      cwd: command.cwd,
      exitCode,
      stdout,
      stderr,
      startedAt,
      completedAt,
    }
  }
}

export class JsonlAgentQueue {
  private readonly queueDir: string
  private readonly actor: string
  private readonly now: () => Date

  public constructor(options: JsonlAgentQueueOptions) {
    this.queueDir = options.queueDir
    this.actor = options.actor
    this.now = options.now ?? (() => new Date())
  }

  public async init(): Promise<void> {
    await mkdir(this.queueDir, { recursive: true })
    await mkdir(this.claimsDir, { recursive: true })
    await mkdir(this.resultsDir, { recursive: true })
  }

  public async enqueue(input: unknown): Promise<AgentRequest> {
    await this.init()
    const request = validateAgentRequest(input)
    const existing = await this.listRequests()
    if (existing.some((entry) => entry.id === request.id)) {
      throw new Error(`AgentRequest already exists in queue: ${request.id}`)
    }

    await appendJsonLine(this.requestsPath, request)
    await this.appendEvent('request.enqueued', request.id, {
      role: request.role,
      repo: request.repo.name,
      workgraph: request.workgraph.id,
    })

    return request
  }

  public async listRequests(): Promise<AgentRequest[]> {
    await this.init()
    const entries = await readJsonLines(this.requestsPath)
    return entries.map((entry) => validateAgentRequest(entry))
  }

  public async listEvents(): Promise<QueueEvent[]> {
    await this.init()
    const entries = await readJsonLines(this.eventsPath)
    return entries.map((entry) => validateQueueEvent(entry))
  }

  public async claimNext(): Promise<AgentRequest | null> {
    await this.init()
    const requests = await this.listRequests()
    const completed = new Set((await this.listResults()).map((result) => result.requestId))

    for (const request of requests) {
      if (completed.has(request.id)) continue

      const claimPath = this.claimPath(request.id)
      const claim: QueueClaim = {
        requestId: request.id,
        actor: this.actor,
        claimedAt: this.now().toISOString(),
      }

      try {
        await writeFile(claimPath, `${JSON.stringify(claim, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
        await this.appendEvent('request.claimed', request.id, {
          actor: this.actor,
          claimPath,
        })
        return request
      } catch (error) {
        if (isAlreadyExists(error)) continue
        throw error
      }
    }

    return null
  }

  public async complete(input: unknown): Promise<AgentResult> {
    await this.init()
    const result = validateAgentResult(input)
    const resultPath = this.resultPath(result.requestId)

    try {
      await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    } catch (error) {
      if (isAlreadyExists(error)) {
        throw new Error(`AgentResult already exists for request: ${result.requestId}`)
      }
      throw error
    }

    await this.appendEvent(result.status === 'completed' ? 'request.completed' : 'request.failed', result.requestId, {
      status: result.status,
      resultId: result.id,
      prUrl: result.prUrl ?? null,
    })

    return result
  }

  public async status(): Promise<JsonlQueueStatus> {
    await this.init()
    const requests = await this.listRequests()
    const claims = await this.listClaims()
    const results = await this.listResults()
    const resultRequestIds = new Set(results.map((result) => result.requestId))
    const claimedRequestIds = new Set(claims.map((claim) => claim.requestId))
    const completed = results.filter((result) => result.status === 'completed').length
    const failed = results.filter((result) => result.status === 'failed').length
    const refused = results.filter((result) => result.status === 'refused').length
    const claimed = requests.filter((request) => claimedRequestIds.has(request.id) && !resultRequestIds.has(request.id)).length
    const pending = requests.filter((request) => !claimedRequestIds.has(request.id) && !resultRequestIds.has(request.id)).length

    return {
      queueDir: this.queueDir,
      total: requests.length,
      pending,
      claimed,
      completed,
      failed,
      refused,
    }
  }

  private async listClaims(): Promise<QueueClaim[]> {
    const names = await readDirectoryOrEmpty(this.claimsDir)
    const claims: QueueClaim[] = []
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      const parsed = JSON.parse(await readFile(join(this.claimsDir, name), 'utf8')) as QueueClaim
      claims.push(parsed)
    }
    return claims
  }

  private async listResults(): Promise<AgentResult[]> {
    const names = await readDirectoryOrEmpty(this.resultsDir)
    const results: AgentResult[] = []
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      const parsed = JSON.parse(await readFile(join(this.resultsDir, name), 'utf8')) as unknown
      results.push(validateAgentResult(parsed))
    }
    return results
  }

  private async appendEvent(type: QueueEventType, requestId: string, details: Record<string, unknown>): Promise<void> {
    const event = validateQueueEvent({
      schemaVersion: QUEUE_EVENT_SCHEMA_VERSION,
      id: `QE-${sanitizeId(requestId)}-${sanitizeId(type)}-${this.now().getTime()}`,
      type,
      requestId,
      timestamp: this.now().toISOString(),
      actor: this.actor,
      details,
    })

    await appendJsonLine(this.eventsPath, event)
  }

  private get requestsPath(): string {
    return join(this.queueDir, 'requests.jsonl')
  }

  private get eventsPath(): string {
    return join(this.queueDir, 'events.jsonl')
  }

  private get claimsDir(): string {
    return join(this.queueDir, 'claims')
  }

  private get resultsDir(): string {
    return join(this.queueDir, 'results')
  }

  private claimPath(requestId: string): string {
    return join(this.claimsDir, `${sanitizeId(requestId)}.json`)
  }

  private resultPath(requestId: string): string {
    return join(this.resultsDir, `${sanitizeId(requestId)}.json`)
  }
}

function parseWorkGraph(data: Record<string, unknown>, issues: string[]): WorkGraphHandle {
  const id = prefixedString(value(data, 'id'), 'WG-', 'workgraph.id', issues)
  const nodeId = nonEmptyString(value(data, 'nodeId'), 'workgraph.nodeId', issues)
  const sourcePrdId = optionalPrefixedString(value(data, 'sourcePrdId'), 'PRD-', 'workgraph.sourcePrdId', issues)
  const sourceRefs = nonEmptyStringArray(value(data, 'sourceRefs'), 'workgraph.sourceRefs', issues)

  if (sourceRefs.length === 0) {
    issues.push('workgraph.sourceRefs must not be empty')
  }

  const workgraph: WorkGraphHandle = { id, nodeId, sourceRefs }
  if (sourcePrdId) workgraph.sourcePrdId = sourcePrdId
  return workgraph
}

function parseRepo(data: Record<string, unknown>, issues: string[]): RepoTarget {
  const provider = oneOf(value(data, 'provider'), ['github', 'local'] as const, 'repo.provider', issues)
  const owner = optionalNonEmptyString(value(data, 'owner'), 'repo.owner', issues)
  const name = nonEmptyString(value(data, 'name'), 'repo.name', issues)
  const defaultBranch = nonEmptyString(value(data, 'defaultBranch'), 'repo.defaultBranch', issues)
  const remoteUrl = optionalNonEmptyString(value(data, 'remoteUrl'), 'repo.remoteUrl', issues)
  const localPath = optionalNonEmptyString(value(data, 'localPath'), 'repo.localPath', issues)

  if (provider === 'github' && !owner) {
    issues.push('repo.owner is required for github repos')
  }

  if (provider === 'local' && !localPath) {
    issues.push('repo.localPath is required for local repos')
  }

  const repo: RepoTarget = { provider, name, defaultBranch }
  if (owner) repo.owner = owner
  if (remoteUrl) repo.remoteUrl = remoteUrl
  if (localPath) repo.localPath = localPath
  return repo
}

function parseBranch(data: Record<string, unknown>, issues: string[]): BranchPolicy {
  return {
    mode: oneOf(value(data, 'mode'), BRANCH_MODES, 'branch.mode', issues),
    base: nonEmptyString(value(data, 'base'), 'branch.base', issues),
    prefix: safeBranchPrefix(value(data, 'prefix'), 'branch.prefix', issues),
  }
}

function parsePolicy(data: Record<string, unknown>, issues: string[]): ExecutionPolicy {
  const autonomyMode = oneOf(value(data, 'autonomyMode'), AUTONOMY_MODES, 'policy.autonomyMode', issues)
  const allowedPaths = nonEmptyStringArray(value(data, 'allowedPaths'), 'policy.allowedPaths', issues)
  const forbiddenActions = enumArray(value(data, 'forbiddenActions'), FORBIDDEN_ACTIONS, 'policy.forbiddenActions', issues)
  const requiresHumanApprovalFor = enumArray(
    value(data, 'requiresHumanApprovalFor'),
    FORBIDDEN_ACTIONS,
    'policy.requiresHumanApprovalFor',
    issues,
  )
  const maxRuntimeMinutes = optionalPositiveInteger(value(data, 'maxRuntimeMinutes'), 'policy.maxRuntimeMinutes', issues)

  validateAllowedPaths(allowedPaths, issues)

  for (const required of ['merge_default_branch', 'deploy_production', 'force_push', 'edit_secrets'] as const) {
    if (!forbiddenActions.includes(required)) {
      issues.push(`policy.forbiddenActions must include ${required}`)
    }
  }

  if (autonomyMode === 'multi_agent_pr' && !requiresHumanApprovalFor.includes('merge_default_branch')) {
    issues.push('multi_agent_pr mode still requires human approval for merge_default_branch')
  }

  const policy: ExecutionPolicy = {
    autonomyMode,
    allowedPaths,
    forbiddenActions,
    requiresHumanApprovalFor,
  }
  if (maxRuntimeMinutes !== undefined) policy.maxRuntimeMinutes = maxRuntimeMinutes
  return policy
}

function parseContext(data: Record<string, unknown>, issues: string[]): RequestContext {
  const summary = nonEmptyString(value(data, 'summary'), 'context.summary', issues)
  const artifactInputs = array(value(data, 'artifacts'), 'context.artifacts', issues)
  const artifacts = artifactInputs.map((entry, index) => {
    const artifact = record(entry, `context.artifacts[${index}]`, issues)
    return {
      id: nonEmptyString(value(artifact, 'id'), `context.artifacts[${index}].id`, issues),
      kind: nonEmptyString(value(artifact, 'kind'), `context.artifacts[${index}].kind`, issues),
      path: nonEmptyString(value(artifact, 'path'), `context.artifacts[${index}].path`, issues),
    }
  })

  return { summary, artifacts }
}

function parseExpectedArtifacts(inputs: unknown[], issues: string[]): ExpectedArtifact[] {
  return inputs.map((entry, index) => {
    const artifact = record(entry, `expectedArtifacts[${index}]`, issues)
    return {
      path: relativePath(value(artifact, 'path'), `expectedArtifacts[${index}].path`, issues),
      kind: nonEmptyString(value(artifact, 'kind'), `expectedArtifacts[${index}].kind`, issues),
    }
  })
}

function parseCommands(inputs: unknown[], issues: string[]): CommandEvidence[] {
  return inputs.map((entry, index) => {
    const command = record(entry, `commands[${index}]`, issues)
    return {
      command: nonEmptyString(value(command, 'command'), `commands[${index}].command`, issues),
      exitCode: integer(value(command, 'exitCode'), `commands[${index}].exitCode`, issues),
      outputRef: nonEmptyString(value(command, 'outputRef'), `commands[${index}].outputRef`, issues),
    }
  })
}

function parseEvidence(inputs: unknown[], issues: string[]): EvidenceRef[] {
  return inputs.map((entry, index) => {
    const evidence = record(entry, `evidence[${index}]`, issues)
    const result: EvidenceRef = {
      kind: oneOf(value(evidence, 'kind'), EVIDENCE_KINDS, `evidence[${index}].kind`, issues),
      summary: nonEmptyString(value(evidence, 'summary'), `evidence[${index}].summary`, issues),
    }
    const path = optionalNonEmptyString(value(evidence, 'path'), `evidence[${index}].path`, issues)
    const url = optionalNonEmptyString(value(evidence, 'url'), `evidence[${index}].url`, issues)
    if (path) result.path = path
    if (url) result.url = url
    if (!path && !url) {
      issues.push(`evidence[${index}] must include path or url`)
    }
    return result
  })
}

function validateAllowedPaths(paths: string[], issues: string[]): void {
  if (paths.length === 0) {
    issues.push('policy.allowedPaths must not be empty')
  }

  for (const path of paths) {
    if (path === '.' || path === './' || path === '*' || path === '**' || path === '**/*') {
      issues.push(`policy.allowedPaths contains overly broad path: ${path}`)
    }
    if (path.startsWith('/')) {
      issues.push(`policy.allowedPaths must be repo-relative: ${path}`)
    }
    if (path.includes('..')) {
      issues.push(`policy.allowedPaths must not contain parent traversal: ${path}`)
    }
  }
}

function record(input: unknown, label: string, issues: string[]): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    issues.push(`${label} must be an object`)
    return {}
  }
  return input as Record<string, unknown>
}

function value(data: Record<string, unknown>, key: string): unknown {
  return data[key]
}

function array(input: unknown, label: string, issues: string[]): unknown[] {
  if (!Array.isArray(input)) {
    issues.push(`${label} must be an array`)
    return []
  }
  return input
}

function nonEmptyString(input: unknown, label: string, issues: string[]): string {
  if (typeof input !== 'string' || input.trim().length === 0) {
    issues.push(`${label} must be a non-empty string`)
    return ''
  }
  return input
}

function optionalNonEmptyString(input: unknown, label: string, issues: string[]): string | undefined {
  if (input === undefined) return undefined
  return nonEmptyString(input, label, issues)
}

function prefixedString(input: unknown, prefix: string, label: string, issues: string[]): string {
  const parsed = nonEmptyString(input, label, issues)
  if (parsed && !parsed.startsWith(prefix)) {
    issues.push(`${label} must start with ${prefix}`)
  }
  return parsed
}

function optionalPrefixedString(input: unknown, prefix: string, label: string, issues: string[]): string | undefined {
  if (input === undefined) return undefined
  return prefixedString(input, prefix, label, issues)
}

function safeBranchPrefix(input: unknown, label: string, issues: string[]): string {
  const parsed = nonEmptyString(input, label, issues)
  if (parsed.startsWith('/') || parsed.endsWith('/') || parsed.includes('..') || parsed.includes(' ')) {
    issues.push(`${label} must be a safe git branch prefix`)
  }
  return parsed
}

function literal<T extends string>(input: unknown, expected: T, label: string, issues: string[]): T {
  if (input !== expected) {
    issues.push(`${label} must equal ${expected}`)
  }
  return expected
}

function oneOf<const T extends NonEmptyReadonlyArray<string>>(
  input: unknown,
  allowed: T,
  label: string,
  issues: string[],
): T[number] {
  const parsed = nonEmptyString(input, label, issues)
  if (!allowed.includes(parsed)) {
    issues.push(`${label} must be one of: ${allowed.join(', ')}`)
    return allowed[0]
  }
  return parsed as T[number]
}

function enumArray<const T extends NonEmptyReadonlyArray<string>>(
  input: unknown,
  allowed: T,
  label: string,
  issues: string[],
): T[number][] {
  const entries = array(input, label, issues)
  return entries.map((entry, index) => oneOf(entry, allowed, `${label}[${index}]`, issues))
}

function nonEmptyStringArray(input: unknown, label: string, issues: string[]): string[] {
  const entries = stringArray(input, label, issues)
  if (entries.length === 0) {
    issues.push(`${label} must not be empty`)
  }
  return entries
}

function stringArray(input: unknown, label: string, issues: string[]): string[] {
  const entries = array(input, label, issues)
  return entries.map((entry, index) => nonEmptyString(entry, `${label}[${index}]`, issues))
}

function relativePath(input: unknown, label: string, issues: string[]): string {
  const parsed = nonEmptyString(input, label, issues)
  if (parsed.startsWith('/') || parsed.includes('..')) {
    issues.push(`${label} must be a repo-relative path`)
  }
  return parsed
}

function integer(input: unknown, label: string, issues: string[]): number {
  if (typeof input !== 'number' || !Number.isInteger(input)) {
    issues.push(`${label} must be an integer`)
    return 0
  }
  return input
}

function optionalPositiveInteger(input: unknown, label: string, issues: string[]): number | undefined {
  if (input === undefined) return undefined
  const parsed = integer(input, label, issues)
  if (parsed <= 0) {
    issues.push(`${label} must be greater than zero`)
  }
  return parsed
}

function isoString(input: unknown, label: string, issues: string[]): string {
  const parsed = nonEmptyString(input, label, issues)
  if (parsed && Number.isNaN(Date.parse(parsed))) {
    issues.push(`${label} must be an ISO-parseable timestamp`)
  }
  return parsed
}

function throwIfIssues(message: string, issues: string[]): void {
  if (issues.length > 0) {
    throw new AutonomousSchedulerValidationError(message, issues)
  }
}

async function appendJsonLine(path: string, valueToWrite: unknown): Promise<void> {
  await appendFile(path, `${JSON.stringify(valueToWrite)}\n`, 'utf8')
}

async function readJsonLines(path: string): Promise<unknown[]> {
  let text = ''
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if (isNotFound(error)) return []
    throw error
  }

  return text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as unknown)
}

async function readDirectoryOrEmpty(path: string): Promise<string[]> {
  try {
    return await readdir(path)
  } catch (error) {
    if (isNotFound(error)) return []
    throw error
  }
}

function sanitizeId(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, '-')
}

function buildBranchName(request: AgentRequest): string {
  return `${request.branch.prefix}/${sanitizeId(request.id).toLowerCase()}`
}

function stringifyCommand(command: RunnerCommand): string {
  return [command.command, ...command.args].join(' ')
}

async function spawnCommand(command: RunnerCommand): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command.command, command.args, {
      cwd: command.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []

    child.stdout.on('data', (chunk: Buffer) => {
      stdout.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr.push(chunk)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      })
    })
  })
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST'
}
