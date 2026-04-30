import { spawn } from 'node:child_process'
import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const AGENT_REQUEST_SCHEMA_VERSION = 'factory.agent-request.v0' as const
export const AGENT_RESULT_SCHEMA_VERSION = 'factory.agent-result.v0' as const
export const QUEUE_EVENT_SCHEMA_VERSION = 'factory.queue-event.v0' as const
export const DEFAULT_CODEX_TIMEOUT_MS = 30 * 60 * 1000

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
  'verification_output',
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
export type CommandRunPhase = 'preflight' | 'codex' | 'commit' | 'verification' | 'pull_request'
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
  leaseMs?: number
  now?: () => Date
}

export interface QueueClaim {
  requestId: string
  actor: string
  claimedAt: string
  heartbeatAt: string
  leaseExpiresAt: string
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
  timeoutMs?: number
}

export interface CodexRunnerPlanOptions {
  repoRoot: string
  codexBinary?: string
  branchNameSuffix?: string
  codexTimeoutMs?: number
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
  timedOut?: boolean
  signal?: string
  phase?: CommandRunPhase
}

export interface CodexRunnerExecution {
  requestId: string
  branchName: string
  status: AgentResultStatus
  commands: CommandRunResult[]
  failedCommand?: string
  refusalReason?: string
}

export type CommandExecutor = (command: RunnerCommand) => Promise<CommandRunResult>

export interface ProcessCommandExecutorOptions {
  now?: () => Date
  timeoutMs?: number
}

export interface DryRunCommandExecutorOptions {
  now?: () => Date
  prUrl?: string
  failCommandIncludes?: string
}

export interface AgentResultFromExecutionOptions {
  resultId: string
  agentRunId: string
  completedAt: string
  artifactBasePath: string
  prUrl?: string
  changedFiles?: string[]
  summary?: string
}

export interface AgentResultBundleOptions {
  bundleDir: string
  diff?: string
}

export interface AgentResultBundleManifest {
  schemaVersion: 'factory.agent-result-bundle.v0'
  requestId: string
  resultId: string
  bundleDir: string
  files: {
    request: string
    execution: string
    result: string
    manifest: string
    commands: string[]
    diff?: string
    verification?: string
  }
}

export interface PullRequestPlanOptions {
  repoRoot: string
  title?: string
  body?: string
}

export interface PullRequestPlan {
  requestId: string
  branchName: string
  title: string
  body: string
  pushCommand: RunnerCommand
  command: RunnerCommand
}

export interface PullRequestExecution {
  requestId: string
  branchName: string
  prUrl: string
  commands: CommandRunResult[]
  command: CommandRunResult
}

export interface RequiredCommandExecutionOptions {
  repoRoot: string
  executor?: CommandExecutor
  shell?: string
}

interface WorkerCommitExecution {
  requestId: string
  branchName: string
  status: 'committed' | 'failed'
  commands: CommandRunResult[]
  changedPaths: string[]
  failedCommand?: string
}

export interface SingleAgentRunOptions {
  queue: JsonlAgentQueue
  repoRoot: string
  bundleDir: string
  resultId: string
  agentRunId: string
  completedAt: string
  branchNameSuffix?: string
  changedFiles?: string[]
  diff?: string
  codexExecutor?: CommandExecutor
  pullRequestExecutor?: CommandExecutor
  codexTimeoutMs?: number
}

export interface SingleAgentRunOutcome {
  request: AgentRequest
  execution: CodexRunnerExecution
  pullRequest?: PullRequestExecution
  result: AgentResult
  bundle: AgentResultBundleManifest
}

export interface QueueDaemonOptions {
  queue: JsonlAgentQueue
  repoRoot: string
  bundleRoot: string
  pollIntervalMs?: number
  maxIterations?: number
  shouldStop?: () => boolean | Promise<boolean>
  codexExecutor?: CommandExecutor
  pullRequestExecutor?: CommandExecutor
  now?: () => Date
  branchNameSuffix?: string
  codexTimeoutMs?: number
}

export interface QueueDaemonOutcome {
  iterations: number
  completedRuns: number
  stopReason: 'max_iterations' | 'stop_requested'
}

export interface StrategyRecipesDogfoodRunPaths {
  runId: string
  runRoot: string
  queueDir: string
  bundleDir: string
}

export interface StrategyRecipesDogfoodOptions {
  request: unknown
  repoRoot: string
  queueDir: string
  bundleDir: string
  mode?: 'dry-run' | 'real'
  mockPrUrl?: string
  branchNameSuffix?: string
  changedFiles?: string[]
  diff?: string
  now?: () => Date
  codexTimeoutMs?: number
}

export interface StrategyRecipesDogfoodOutcome {
  mode: 'dry-run' | 'real'
  repoRoot: string
  queueDir: string
  bundleDir: string
  outcome: SingleAgentRunOutcome
}

export class AutonomousSchedulerValidationError extends Error {
  public readonly issues: string[]

  public constructor(message: string, issues: string[]) {
    super(message)
    this.name = 'AutonomousSchedulerValidationError'
    this.issues = issues
  }
}

export class PullRequestExecutionError extends Error {
  public readonly commands: CommandRunResult[]

  public constructor(message: string, commands: CommandRunResult[]) {
    super(message)
    this.name = 'PullRequestExecutionError'
    this.commands = commands
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

  const branchName = buildBranchName(request, options.branchNameSuffix)
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
      args: ['exec', '--sandbox', 'workspace-write', '--cd', options.repoRoot, prompt],
      cwd: options.repoRoot,
      timeoutMs: options.codexTimeoutMs ?? DEFAULT_CODEX_TIMEOUT_MS,
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
        failedCommand: result.timedOut
          ? `${stringifyCommand(command)} timed out`
          : stringifyCommand(command),
      }
    }

    if (command === plan.codexCommand) {
      const refusalReason = extractCodexRefusalReason(result)
      if (refusalReason) {
        return {
          requestId: plan.requestId,
          branchName: plan.branchName,
          status: 'refused',
          commands,
          failedCommand: 'codex refused request',
          refusalReason,
        }
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
    const timeoutMs = command.timeoutMs ?? options?.timeoutMs
    const spawnOptions: SpawnCommandOptions = {}
    if (timeoutMs !== undefined) spawnOptions.timeoutMs = timeoutMs
    const { exitCode, stdout, stderr, timedOut, signal } = await spawnCommand(command, spawnOptions)
    const completedAt = now().toISOString()

    const result: CommandRunResult = {
      command: command.command,
      args: command.args,
      cwd: command.cwd,
      exitCode,
      stdout,
      stderr,
      startedAt,
      completedAt,
    }

    if (timedOut) result.timedOut = true
    if (signal) result.signal = signal

    return result
  }
}

export function createDryRunCommandExecutor(options?: DryRunCommandExecutorOptions): CommandExecutor {
  const now = options?.now ?? (() => new Date())
  const prUrl = options?.prUrl ?? 'https://github.com/Wescome/strategy-recipes/pull/dry-run'

  return async (command: RunnerCommand): Promise<CommandRunResult> => {
    const commandText = stringifyCommand(command)
    const shouldFail = options?.failCommandIncludes ? commandText.includes(options.failCommandIncludes) : false
    const stdout = command.command === 'gh'
      ? `${prUrl}\n`
      : `dry-run: ${commandText}\n`

    return {
      command: command.command,
      args: command.args,
      cwd: command.cwd,
      exitCode: shouldFail ? 1 : 0,
      stdout,
      stderr: shouldFail ? `dry-run failure for ${commandText}` : '',
      startedAt: now().toISOString(),
      completedAt: now().toISOString(),
    }
  }
}

export function buildAgentResultFromExecution(
  requestInput: unknown,
  execution: CodexRunnerExecution,
  options: AgentResultFromExecutionOptions,
): AgentResult {
  const request = validateAgentRequest(requestInput)
  const changedFiles = options.changedFiles ?? []
  const commandEvidence = execution.commands.map((command, index) => ({
    command: stringifyCommand(command),
    exitCode: command.exitCode,
    outputRef: join(options.artifactBasePath, `command-${index + 1}-${sanitizeId(command.command)}.txt`),
  }))

  const evidence: EvidenceRef[] = [
    {
      kind: 'artifact_paths',
      path: join(options.artifactBasePath, 'manifest.json'),
      summary: 'Runner artifact manifest.',
    },
  ]

  if (execution.commands.some((command) => stringifyCommand(command).includes('test'))) {
    evidence.push({
      kind: 'test_output',
      path: join(options.artifactBasePath, 'test-output.txt'),
      summary: 'Test command output captured by runner.',
    })
  }

  if (execution.commands.some((command) => stringifyCommand(command).includes('typecheck'))) {
    evidence.push({
      kind: 'typecheck_output',
      path: join(options.artifactBasePath, 'typecheck-output.txt'),
      summary: 'Typecheck command output captured by runner.',
    })
  }

  if (execution.commands.some((command) => command.phase === 'verification')) {
    evidence.push({
      kind: 'verification_output',
      path: join(options.artifactBasePath, 'verification-output.txt'),
      summary: 'Parent scheduler verification output captured after commit and before PR publication.',
    })
  }

  if (execution.status === 'completed') {
    evidence.push({
      kind: 'git_diff',
      path: join(options.artifactBasePath, 'diff.patch'),
      summary: 'Git diff captured after worker execution.',
    })

    if (options.prUrl) {
      evidence.push({
        kind: 'pr_url',
        url: options.prUrl,
        summary: 'Pull request opened for worker output.',
      })
    }
  }

  const result: AgentResult = {
    schemaVersion: AGENT_RESULT_SCHEMA_VERSION,
    id: options.resultId,
    requestId: request.id,
    agentRunId: options.agentRunId,
    status: execution.status,
    completedAt: options.completedAt,
    summary: options.summary ?? defaultExecutionSummary(request, execution),
    changedFiles,
    commands: commandEvidence,
    evidence,
  }

  if (execution.status === 'completed') {
    result.branchName = execution.branchName
  }

  if (options.prUrl) {
    result.prUrl = options.prUrl
  }

  if (execution.status === 'refused') {
    result.refusalReason = execution.refusalReason ?? 'Codex refused the AgentRequest.'
  }

  return validateAgentResult(result)
}

export async function writeAgentResultBundle(
  requestInput: unknown,
  execution: CodexRunnerExecution,
  resultInput: unknown,
  options: AgentResultBundleOptions,
): Promise<AgentResultBundleManifest> {
  const request = validateAgentRequest(requestInput)
  const result = validateAgentResult(resultInput)

  if (request.id !== execution.requestId || request.id !== result.requestId) {
    throw new Error(`Bundle request mismatch: ${request.id}, ${execution.requestId}, ${result.requestId}`)
  }

  await mkdir(options.bundleDir, { recursive: true })

  const requestPath = join(options.bundleDir, 'request.json')
  const executionPath = join(options.bundleDir, 'execution.json')
  const resultPath = join(options.bundleDir, 'result.json')
  const manifestPath = join(options.bundleDir, 'manifest.json')
  const commandPaths: string[] = []

  await writeJsonFile(requestPath, request)
  await writeJsonFile(executionPath, execution)
  await writeJsonFile(resultPath, result)

  for (let index = 0; index < execution.commands.length; index += 1) {
    const command = execution.commands[index]
    if (!command) continue
    const outputPath = join(options.bundleDir, `command-${index + 1}-${sanitizeId(command.command)}.txt`)
    commandPaths.push(outputPath)
    await writeFile(
      outputPath,
      [
        `$ ${stringifyCommand(command)}`,
        '',
        `exitCode: ${command.exitCode}`,
        `cwd: ${command.cwd}`,
        `startedAt: ${command.startedAt}`,
        `completedAt: ${command.completedAt}`,
        '',
        'stdout:',
        command.stdout,
        '',
        'stderr:',
        command.stderr,
        '',
      ].join('\n'),
      'utf8',
    )
  }

  let diffPath: string | undefined
  if (options.diff !== undefined) {
    diffPath = join(options.bundleDir, 'diff.patch')
    await writeFile(diffPath, options.diff, 'utf8')
  }

  let verificationPath: string | undefined
  const verificationCommands = execution.commands.filter((command) => command.phase === 'verification')
  if (verificationCommands.length > 0) {
    verificationPath = join(options.bundleDir, 'verification-output.txt')
    await writeFile(
      verificationPath,
      verificationCommands.map((command) => formatCommandOutput(command)).join('\n---\n'),
      'utf8',
    )
  }

  const manifest: AgentResultBundleManifest = {
    schemaVersion: 'factory.agent-result-bundle.v0',
    requestId: request.id,
    resultId: result.id,
    bundleDir: options.bundleDir,
    files: {
      request: requestPath,
      execution: executionPath,
      result: resultPath,
      manifest: manifestPath,
      commands: commandPaths,
    },
  }

  if (diffPath) {
    manifest.files.diff = diffPath
  }

  if (verificationPath) {
    manifest.files.verification = verificationPath
  }

  await writeJsonFile(manifestPath, manifest)
  return manifest
}

async function executeWorkerCommit(
  request: AgentRequest,
  execution: CodexRunnerExecution,
  options: {
    repoRoot: string
    executor?: CommandExecutor
    fallbackChangedPaths: string[]
  },
): Promise<WorkerCommitExecution> {
  const executor = options.executor ?? createProcessCommandExecutor()
  const commands: CommandRunResult[] = []
  const statusCommand: RunnerCommand = {
    command: 'git',
    args: ['status', '--porcelain'],
    cwd: options.repoRoot,
  }
  const status = await executor(statusCommand)
  commands.push(status)

  if (status.exitCode !== 0) {
    return {
      requestId: request.id,
      branchName: execution.branchName,
      status: 'failed',
      commands,
      changedPaths: [],
      failedCommand: stringifyCommand(statusCommand),
    }
  }

  let changedPaths = parseGitStatusChangedPaths(status.stdout)
  if (changedPaths.length === 0 && status.stdout.startsWith('dry-run:')) {
    changedPaths = [...options.fallbackChangedPaths]
  }

  if (changedPaths.length === 0) {
    return {
      requestId: request.id,
      branchName: execution.branchName,
      status: 'failed',
      commands,
      changedPaths,
      failedCommand: 'worker produced no git changes',
    }
  }

  const blockedPaths = changedPaths.filter((path) => !isAllowedWorkerPath(path, request.policy.allowedPaths))
  if (blockedPaths.length > 0) {
    return {
      requestId: request.id,
      branchName: execution.branchName,
      status: 'failed',
      commands,
      changedPaths,
      failedCommand: `worker changed paths outside policy: ${blockedPaths.join(', ')}`,
    }
  }

  const addCommand: RunnerCommand = {
    command: 'git',
    args: ['add', '--', ...changedPaths],
    cwd: options.repoRoot,
  }
  const add = await executor(addCommand)
  commands.push(add)
  if (add.exitCode !== 0) {
    return {
      requestId: request.id,
      branchName: execution.branchName,
      status: 'failed',
      commands,
      changedPaths,
      failedCommand: stringifyCommand(addCommand),
    }
  }

  const commitCommand: RunnerCommand = {
    command: 'git',
    args: ['commit', '-m', `[Factory] ${request.id}`],
    cwd: options.repoRoot,
  }
  const commit = await executor(commitCommand)
  commands.push(commit)
  if (commit.exitCode !== 0) {
    return {
      requestId: request.id,
      branchName: execution.branchName,
      status: 'failed',
      commands,
      changedPaths,
      failedCommand: stringifyCommand(commitCommand),
    }
  }

  return {
    requestId: request.id,
    branchName: execution.branchName,
    status: 'committed',
    commands,
    changedPaths,
  }
}

export function planPullRequest(
  requestInput: unknown,
  execution: CodexRunnerExecution,
  options: PullRequestPlanOptions,
): PullRequestPlan {
  const request = validateAgentRequest(requestInput)

  if (execution.requestId !== request.id) {
    throw new Error(`Pull request plan request mismatch: ${request.id}, ${execution.requestId}`)
  }

  if (execution.status !== 'completed') {
    throw new Error(`Pull request plan requires completed execution for ${request.id}`)
  }

  const title = options.title ?? `[Factory] ${request.objective}`
  const body = options.body ?? buildPullRequestBody(request, execution)
  const repoSpecifier = request.repo.owner ? `${request.repo.owner}/${request.repo.name}` : request.repo.name

  return {
    requestId: request.id,
    branchName: execution.branchName,
    title,
    body,
    pushCommand: {
      command: 'git',
      args: ['push', '-u', 'origin', execution.branchName],
      cwd: options.repoRoot,
    },
    command: {
      command: 'gh',
      args: [
        'pr',
        'create',
        '--repo',
        repoSpecifier,
        '--base',
        request.branch.base,
        '--head',
        execution.branchName,
        '--title',
        title,
        '--body',
        body,
      ],
      cwd: options.repoRoot,
    },
  }
}

export async function executePullRequestPlan(
  plan: PullRequestPlan,
  executor: CommandExecutor = createProcessCommandExecutor(),
): Promise<PullRequestExecution> {
  const commands: CommandRunResult[] = []
  const pushCommand = await executor(plan.pushCommand)
  commands.push(pushCommand)

  if (pushCommand.exitCode !== 0) {
    throw new PullRequestExecutionError(
      `Pull request branch push failed for ${plan.requestId}: ${pushCommand.stderr || pushCommand.stdout}`,
      commands,
    )
  }

  const command = await executor(plan.command)
  commands.push(command)

  if (command.exitCode !== 0) {
    throw new PullRequestExecutionError(
      `Pull request creation failed for ${plan.requestId}: ${command.stderr || command.stdout}`,
      commands,
    )
  }

  const prUrl = command.stdout.trim().split('\n').find((line) => line.startsWith('https://'))
  if (!prUrl) {
    throw new PullRequestExecutionError(
      `Pull request creation did not return a URL for ${plan.requestId}`,
      commands,
    )
  }

  return {
    requestId: plan.requestId,
    branchName: plan.branchName,
    prUrl,
    commands,
    command,
  }
}

export async function executeRequiredCommands(
  requestInput: unknown,
  options: RequiredCommandExecutionOptions,
): Promise<CommandRunResult[]> {
  const request = validateAgentRequest(requestInput)
  const executor = options.executor ?? createProcessCommandExecutor()
  const commands: CommandRunResult[] = []

  for (const requiredCommand of request.requiredCommands) {
    const command = buildRequiredCommand(requiredCommand, options)
    const result = await executor(command)
    commands.push({ ...result, phase: 'verification' })

    if (result.exitCode !== 0) break
  }

  return commands
}

export async function runSingleAgentRequest(
  requestInput: unknown,
  options: SingleAgentRunOptions,
): Promise<SingleAgentRunOutcome> {
  const request = await options.queue.enqueue(requestInput)
  const claimed = await options.queue.claimNext()

  if (!claimed || claimed.id !== request.id) {
    throw new Error(`Unable to claim enqueued AgentRequest: ${request.id}`)
  }

  return await runClaimedAgentRequest(claimed, options)
}

export async function runClaimedAgentRequest(
  requestInput: unknown,
  options: SingleAgentRunOptions,
): Promise<SingleAgentRunOutcome> {
  const claimed = validateAgentRequest(requestInput)
  await options.queue.heartbeat(claimed.id)

  const codexPlanOptions: CodexRunnerPlanOptions = {
    repoRoot: options.repoRoot,
  }
  if (options.branchNameSuffix) codexPlanOptions.branchNameSuffix = options.branchNameSuffix
  if (options.codexTimeoutMs !== undefined) codexPlanOptions.codexTimeoutMs = options.codexTimeoutMs

  const codexPlan = planCodexRunner(claimed, codexPlanOptions)
  const execution = await executeCodexRunnerPlan(codexPlan, options.codexExecutor)
  let resultExecution = execution
  let pullRequest: PullRequestExecution | undefined

  if (execution.status === 'completed') {
    const commitOptions: Parameters<typeof executeWorkerCommit>[2] = {
      repoRoot: options.repoRoot,
      fallbackChangedPaths: options.changedFiles ?? claimed.expectedArtifacts.map((artifact) => artifact.path),
    }
    if (options.pullRequestExecutor) commitOptions.executor = options.pullRequestExecutor
    const commit = await executeWorkerCommit(claimed, execution, commitOptions)

    resultExecution = {
      requestId: execution.requestId,
      branchName: execution.branchName,
      status: commit.status === 'committed' ? 'completed' : 'failed',
      commands: [...execution.commands, ...commit.commands],
      ...(commit.status === 'failed' ? { failedCommand: commit.failedCommand ?? 'worker commit' } : {}),
    }

    if (resultExecution.status !== 'completed') {
      const resultOptions: AgentResultFromExecutionOptions = {
        resultId: options.resultId,
        agentRunId: options.agentRunId,
        completedAt: options.completedAt,
        artifactBasePath: options.bundleDir,
      }
      if (options.changedFiles) resultOptions.changedFiles = options.changedFiles

      const result = buildAgentResultFromExecution(claimed, resultExecution, resultOptions)
      const bundleOptions: AgentResultBundleOptions = {
        bundleDir: options.bundleDir,
      }
      if (options.diff !== undefined) bundleOptions.diff = options.diff
      const bundle = await writeAgentResultBundle(claimed, resultExecution, result, bundleOptions)
      await options.queue.complete(result)
      return { request: claimed, execution: resultExecution, result, bundle }
    }

    const verification = await executeRequiredCommands(claimed, {
      repoRoot: options.repoRoot,
      ...(options.pullRequestExecutor ? { executor: options.pullRequestExecutor } : {}),
    })
    const failedVerification = verification.find((command) => command.exitCode !== 0)
    resultExecution = {
      requestId: execution.requestId,
      branchName: execution.branchName,
      status: failedVerification ? 'failed' : 'completed',
      commands: [...resultExecution.commands, ...verification],
      ...(failedVerification
        ? { failedCommand: `parent verification: ${stringifyCommand(failedVerification)}` }
        : {}),
    }

    if (resultExecution.status !== 'completed') {
      const resultOptions: AgentResultFromExecutionOptions = {
        resultId: options.resultId,
        agentRunId: options.agentRunId,
        completedAt: options.completedAt,
        artifactBasePath: options.bundleDir,
      }
      if (options.changedFiles) resultOptions.changedFiles = options.changedFiles

      const result = buildAgentResultFromExecution(claimed, resultExecution, resultOptions)
      const bundleOptions: AgentResultBundleOptions = {
        bundleDir: options.bundleDir,
      }
      if (options.diff !== undefined) bundleOptions.diff = options.diff
      const bundle = await writeAgentResultBundle(claimed, resultExecution, result, bundleOptions)
      await options.queue.complete(result)
      return { request: claimed, execution: resultExecution, result, bundle }
    }

    const prPlan = planPullRequest(claimed, resultExecution, { repoRoot: options.repoRoot })
    try {
      pullRequest = await executePullRequestPlan(prPlan, options.pullRequestExecutor)
    } catch (error) {
      if (!(error instanceof PullRequestExecutionError)) {
        throw error
      }
      resultExecution = {
        requestId: execution.requestId,
        branchName: execution.branchName,
        status: 'failed',
        commands: [...resultExecution.commands, ...error.commands],
        failedCommand: 'pull request creation',
      }
    }
  }

  const resultOptions: AgentResultFromExecutionOptions = {
    resultId: options.resultId,
    agentRunId: options.agentRunId,
    completedAt: options.completedAt,
    artifactBasePath: options.bundleDir,
  }
  if (pullRequest) resultOptions.prUrl = pullRequest.prUrl
  if (options.changedFiles) resultOptions.changedFiles = options.changedFiles

  const result = buildAgentResultFromExecution(claimed, resultExecution, resultOptions)

  const bundleOptions: AgentResultBundleOptions = {
    bundleDir: options.bundleDir,
  }
  if (options.diff !== undefined) bundleOptions.diff = options.diff

  const bundle = await writeAgentResultBundle(claimed, resultExecution, result, bundleOptions)

  await options.queue.complete(result)

  const outcome: SingleAgentRunOutcome = {
    request: claimed,
    execution: resultExecution,
    result,
    bundle,
  }

  if (pullRequest) {
    outcome.pullRequest = pullRequest
  }

  return outcome
}

export async function runQueueDaemon(options: QueueDaemonOptions): Promise<QueueDaemonOutcome> {
  const pollIntervalMs = options.pollIntervalMs ?? 5_000
  const maxIterations = options.maxIterations ?? Number.POSITIVE_INFINITY
  const now = options.now ?? (() => new Date())
  let iterations = 0
  let completedRuns = 0

  while (iterations < maxIterations) {
    if (await options.shouldStop?.()) {
      return { iterations, completedRuns, stopReason: 'stop_requested' }
    }

    iterations += 1
    const request = await options.queue.claimNext()
    if (!request) {
      await sleep(pollIntervalMs)
      continue
    }

    const stamp = now().toISOString().replace(/[^0-9TZ]/g, '')
    const runOptions: SingleAgentRunOptions = {
      queue: options.queue,
      repoRoot: options.repoRoot,
      bundleDir: join(options.bundleRoot, sanitizeId(request.id)),
      resultId: `ARES-${request.id.slice(3)}-${stamp}`,
      agentRunId: `RUN-${request.id.slice(3)}-${stamp}`,
      completedAt: now().toISOString(),
      branchNameSuffix: options.branchNameSuffix ?? stamp,
      changedFiles: request.expectedArtifacts.map((artifact) => artifact.path),
    }
    if (options.codexExecutor) runOptions.codexExecutor = options.codexExecutor
    if (options.pullRequestExecutor) runOptions.pullRequestExecutor = options.pullRequestExecutor
    if (options.codexTimeoutMs !== undefined) runOptions.codexTimeoutMs = options.codexTimeoutMs

    await runClaimedAgentRequest(request, runOptions)
    completedRuns += 1
  }

  return { iterations, completedRuns, stopReason: 'max_iterations' }
}

export function createStrategyRecipesDogfoodRunPaths(
  rootDir: string,
  now: () => Date = () => new Date(),
): StrategyRecipesDogfoodRunPaths {
  const runId = `strategy-recipes-${now().toISOString().replace(/[^0-9TZ]/g, '')}`
  const runRoot = join(rootDir, runId)

  return {
    runId,
    runRoot,
    queueDir: join(runRoot, 'queue'),
    bundleDir: join(runRoot, 'bundle'),
  }
}

export async function runStrategyRecipesDogfood(
  options: StrategyRecipesDogfoodOptions,
): Promise<StrategyRecipesDogfoodOutcome> {
  const now = options.now ?? (() => new Date())
  const request = validateAgentRequest(options.request)
  const mode = options.mode ?? 'dry-run'
  const completedAt = now().toISOString()
  const stamp = completedAt.replace(/[^0-9TZ]/g, '')
  const executor = mode === 'dry-run'
    ? createDryRunCommandExecutor(buildDryRunOptions(options))
    : undefined
  const runOptions: SingleAgentRunOptions = {
    queue: new JsonlAgentQueue({ queueDir: options.queueDir, actor: 'factory-dogfood', now }),
    repoRoot: options.repoRoot,
    bundleDir: options.bundleDir,
    resultId: `ARES-${request.id.slice(3)}-${stamp}`,
    agentRunId: `RUN-${request.id.slice(3)}-${stamp}`,
    completedAt,
    branchNameSuffix: options.branchNameSuffix ?? stamp,
    changedFiles: options.changedFiles ?? request.expectedArtifacts.map((artifact) => artifact.path),
  }

  if (options.diff !== undefined) runOptions.diff = options.diff
  if (options.codexTimeoutMs !== undefined) runOptions.codexTimeoutMs = options.codexTimeoutMs
  if (executor) {
    runOptions.codexExecutor = executor
    runOptions.pullRequestExecutor = executor
  }

  return {
    mode,
    repoRoot: options.repoRoot,
    queueDir: options.queueDir,
    bundleDir: options.bundleDir,
    outcome: await runSingleAgentRequest(request, runOptions),
  }
}

export class JsonlAgentQueue {
  private readonly queueDir: string
  private readonly actor: string
  private readonly leaseMs: number
  private readonly now: () => Date

  public constructor(options: JsonlAgentQueueOptions) {
    this.queueDir = options.queueDir
    this.actor = options.actor
    this.leaseMs = options.leaseMs ?? 15 * 60 * 1000
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
      const claim = this.createClaim(request.id)

      try {
        await writeFile(claimPath, `${JSON.stringify(claim, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
        await this.appendEvent('request.claimed', request.id, {
          actor: this.actor,
          claimPath,
          reclaimed: false,
        })
        return request
      } catch (error) {
        if (!isAlreadyExists(error)) throw error
        const existingClaim = await this.readClaim(request.id)
        if (existingClaim && this.isClaimActive(existingClaim)) continue
        await writeFile(claimPath, `${JSON.stringify(claim, null, 2)}\n`, 'utf8')
        await this.appendEvent('request.claimed', request.id, {
          actor: this.actor,
          claimPath,
          reclaimed: true,
        })
        return request
      }
    }

    return null
  }

  public async heartbeat(requestId: string): Promise<QueueClaim> {
    await this.init()
    const existing = await this.readClaim(requestId)
    if (!existing) {
      throw new Error(`Cannot heartbeat unclaimed request: ${requestId}`)
    }

    const now = this.now()
    const updated: QueueClaim = {
      ...existing,
      actor: this.actor,
      heartbeatAt: now.toISOString(),
      leaseExpiresAt: new Date(now.getTime() + this.leaseMs).toISOString(),
    }

    await writeFile(this.claimPath(requestId), `${JSON.stringify(updated, null, 2)}\n`, 'utf8')
    await this.appendEvent('request.heartbeat', requestId, {
      actor: this.actor,
      leaseExpiresAt: updated.leaseExpiresAt,
    })

    return updated
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
    const activeClaimIds = new Set(claims.filter((claim) => this.isClaimActive(claim)).map((claim) => claim.requestId))
    const claimed = requests.filter((request) => activeClaimIds.has(request.id) && !resultRequestIds.has(request.id)).length
    const pending = requests.filter((request) => !activeClaimIds.has(request.id) && !resultRequestIds.has(request.id)).length

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

  private async readClaim(requestId: string): Promise<QueueClaim | null> {
    try {
      return JSON.parse(await readFile(this.claimPath(requestId), 'utf8')) as QueueClaim
    } catch (error) {
      if (isNotFound(error)) return null
      throw error
    }
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

  private createClaim(requestId: string): QueueClaim {
    const now = this.now()
    return {
      requestId,
      actor: this.actor,
      claimedAt: now.toISOString(),
      heartbeatAt: now.toISOString(),
      leaseExpiresAt: new Date(now.getTime() + this.leaseMs).toISOString(),
    }
  }

  private isClaimActive(claim: QueueClaim): boolean {
    return Date.parse(claim.leaseExpiresAt) > this.now().getTime()
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

async function writeJsonFile(path: string, valueToWrite: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(valueToWrite, null, 2)}\n`, 'utf8')
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

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function sanitizeId(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, '-')
}

function buildBranchName(request: AgentRequest, suffix?: string): string {
  const baseName = `${request.branch.prefix}/${sanitizeId(request.id).toLowerCase()}`
  if (!suffix) return baseName
  return `${baseName}-${sanitizeId(suffix).toLowerCase()}`
}

function stringifyCommand(command: RunnerCommand): string {
  return [command.command, ...redactCommandArgs(command)].join(' ')
}

function buildRequiredCommand(command: string, options: RequiredCommandExecutionOptions): RunnerCommand {
  return {
    command: options.shell ?? process.env.SHELL ?? 'sh',
    args: ['-lc', command],
    cwd: options.repoRoot,
  }
}

function formatCommandOutput(command: CommandRunResult): string {
  return [
    `$ ${stringifyCommand(command)}`,
    '',
    `exitCode: ${command.exitCode}`,
    `cwd: ${command.cwd}`,
    `startedAt: ${command.startedAt}`,
    `completedAt: ${command.completedAt}`,
    '',
    'stdout:',
    command.stdout,
    '',
    'stderr:',
    command.stderr,
    '',
  ].join('\n')
}

function redactCommandArgs(command: RunnerCommand): string[] {
  if (command.command !== 'codex') return command.args
  const args = [...command.args]
  if (args[0] === 'exec' && args.length > 1) {
    args[args.length - 1] = '<prompt omitted>'
  }
  return args
}

function parseGitStatusChangedPaths(output: string): string[] {
  const paths = new Set<string>()
  for (const line of output.split('\n')) {
    if (line.trim().length === 0 || line.startsWith('dry-run:')) continue
    const pathspec = (line[2] === ' ' ? line.slice(3) : line.replace(/^.{1,2}\s+/, '')).trim()
    if (!pathspec) continue

    if (pathspec.includes(' -> ')) {
      const [from, to] = pathspec.split(' -> ').map((entry) => entry.trim())
      if (from) paths.add(from)
      if (to) paths.add(to)
      continue
    }

    paths.add(pathspec)
  }

  return [...paths].sort()
}

function isAllowedWorkerPath(path: string, allowedPaths: readonly string[]): boolean {
  return allowedPaths.some((pattern) => {
    if (pattern.endsWith('/**')) {
      return path.startsWith(pattern.slice(0, -3))
    }

    if (pattern.endsWith('/*')) {
      const prefix = pattern.slice(0, -1)
      if (!path.startsWith(prefix)) return false
      return !path.slice(prefix.length).includes('/')
    }

    return path === pattern
  })
}

function defaultExecutionSummary(request: AgentRequest, execution: CodexRunnerExecution): string {
  if (execution.status === 'completed') {
    return `Completed ${request.id} on branch ${execution.branchName}.`
  }

  if (execution.status === 'refused') {
    return `Refused ${request.id}: ${execution.refusalReason ?? 'Codex refused the AgentRequest.'}`
  }

  return `Failed ${request.id} at ${execution.failedCommand ?? 'unknown command'}.`
}

function extractCodexRefusalReason(command: CommandRunResult): string | undefined {
  const text = `${command.stdout}\n${command.stderr}`
  const hasRefusedStatus =
    /(^|\n)\s*status:\s*refused\b/.test(text) ||
    /"status"\s*:\s*"refused"/.test(text)

  if (!hasRefusedStatus) return undefined

  const jsonReason = text.match(/"refusalReason"\s*:\s*"([^"]+)"/)?.[1]
  if (jsonReason) return jsonReason.trim()

  const foldedReason = text.match(/(^|\n)\s*refusalReason:\s*>\s*\n((?:[ \t]+.+(?:\n|$))+)/)?.[2]
  if (foldedReason) {
    const normalized = foldedReason
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .join(' ')
      .trim()
    if (normalized) return normalized
  }

  const inlineReason = text.match(/(^|\n)\s*refusalReason:\s*(.+)/)?.[2]?.trim()
  if (inlineReason) return inlineReason

  return 'Codex refused the AgentRequest.'
}

function buildPullRequestBody(request: AgentRequest, execution: CodexRunnerExecution): string {
  return [
    `Factory request: ${request.id}`,
    `WorkGraph: ${request.workgraph.id} / ${request.workgraph.nodeId}`,
    `Role: ${request.role}`,
    `Branch: ${execution.branchName}`,
    '',
    'Acceptance criteria:',
    ...request.acceptanceCriteria.map((criterion, index) => `${index + 1}. ${criterion}`),
    '',
    'Required evidence:',
    ...request.evidenceRequired.map((kind) => `- ${kind}`),
  ].join('\n')
}

function buildDryRunOptions(options: StrategyRecipesDogfoodOptions): DryRunCommandExecutorOptions {
  const dryRunOptions: DryRunCommandExecutorOptions = {}
  if (options.now) dryRunOptions.now = options.now
  if (options.mockPrUrl) dryRunOptions.prUrl = options.mockPrUrl
  return dryRunOptions
}

interface SpawnCommandOptions {
  timeoutMs?: number
}

interface SpawnCommandResult {
  exitCode: number
  stdout: string
  stderr: string
  timedOut?: boolean
  signal?: string
}

async function spawnCommand(command: RunnerCommand, options?: SpawnCommandOptions): Promise<SpawnCommandResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command.command, command.args, {
      cwd: command.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let timedOut = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    let killTimeout: ReturnType<typeof setTimeout> | undefined

    if (options?.timeoutMs !== undefined) {
      timeout = setTimeout(() => {
        timedOut = true
        killChildProcess(child.pid, 'SIGTERM')
        killTimeout = setTimeout(() => {
          killChildProcess(child.pid, 'SIGKILL')
        }, 2_000)
      }, options.timeoutMs)
    }

    child.stdout.on('data', (chunk: Buffer) => {
      stdout.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr.push(chunk)
    })
    child.on('error', reject)
    child.on('close', (code, signal) => {
      if (timeout) clearTimeout(timeout)
      if (killTimeout) clearTimeout(killTimeout)
      const stderrText = Buffer.concat(stderr).toString('utf8')
      resolve({
        exitCode: timedOut ? 124 : code ?? 1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: timedOut
          ? `${stderrText}${stderrText.endsWith('\n') || stderrText.length === 0 ? '' : '\n'}Command timed out after ${options?.timeoutMs}ms.`
          : stderrText,
        ...(timedOut ? { timedOut: true } : {}),
        ...(signal ? { signal } : {}),
      })
    })
  })
}

function killChildProcess(pid: number | undefined, signal: NodeJS.Signals): void {
  if (!pid) return

  try {
    if (process.platform === 'win32') {
      process.kill(pid, signal)
      return
    }

    process.kill(-pid, signal)
  } catch (error) {
    if (!isNoSuchProcess(error)) throw error
  }
}

function isNoSuchProcess(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ESRCH'
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST'
}
