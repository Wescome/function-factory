// Type stubs for @flue/runtime — replace when @flue/runtime publishes types.

// Cloudflare Workers globals (minimal stub — use @cloudflare/workers-types for full coverage)
declare interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

declare module '@flue/runtime' {
  export function configureProvider(
    provider: string,
    config: {
      baseUrl: string;
      headers: Record<string, string>;
      apiKey: string;
    },
  ): void;

  export type WorkflowRouteHandler = (
    c: unknown,
    next: () => Promise<unknown>,
  ) => Promise<unknown>;

  // AgentProfile — returned by defineAgentProfile, passed to createAgent()
  export interface AgentProfile {
    name:         string;
    model:        string;
    instructions: string;
  }

  export function defineAgentProfile(opts: {
    name:         string;
    model:        string;
    instructions: string;
    skills?:      unknown[];
    tools?:       unknown[];
    subagents?:   unknown[];
    thinkingLevel?: string;
    compaction?:  unknown;
    durability?:  unknown;
  }): AgentProfile;

  // FlueHarness — returned by ctx.init(agent)
  export interface FlueHarness {
    fs: {
      writeFile(path: string, content: string): Promise<void>;
      readFile(path: string): Promise<string>;
    };
    shell(cmd: string): Promise<{ stdout: string; stderr: string; exitCode: number }>;
    session(name?: string): Promise<FlueSession>;
  }

  // FlueSession — returned by harness.session()
  export interface FlueSession {
    skill(
      name: string,
      opts: { args?: Record<string, unknown>; result?: unknown },
    ): Promise<{ data: Record<string, unknown>; text?: string }>;
    task(
      prompt: string,
      opts: { cwd: string; result: unknown },
    ): Promise<{ data: Record<string, unknown> }>;
  }

  // Legacy aliases kept for other workflows that use HarnessLike/SessionLike
  export type HarnessLike = FlueHarness;
  export type SessionLike = FlueSession;

  // FlueContext<TPayload, TEnv> — available inside a Flue workflow run()
  export interface FlueContext<TPayload = unknown, TEnv = Record<string, string>> {
    id:      string;
    init: (agent: ReturnType<typeof createAgent>) => Promise<FlueHarness>;
    payload: TPayload;
    env:     TEnv;
  }

  export function createAgent<TPayload = unknown, TEnv = unknown>(
    factory: (opts?: { id: string; env: TEnv }) => {
      profile?: AgentProfile;
      model?:   string;
      sandbox?: unknown;
      cwd?:     string;
      [key: string]: unknown;
    },
  ): unknown;
}

declare module '@flue/runtime/routing' {
  export function flue(): {
    fetch(req: Request, env: unknown, ctx: unknown): Response | Promise<Response>;
  };
}

// Type stubs for just-bash — replace when just-bash publishes types.
declare module 'just-bash' {
  export class InMemoryFs {
    constructor();
  }

  export interface BashOptions {
    fs?: InMemoryFs;
    cwd?: string;
  }

  export class Bash {
    constructor(opts?: BashOptions);
  }
}

// Type stubs for valibot — minimal surface used by factory workflows.
declare module 'valibot' {
  export function object<T extends Record<string, unknown>>(
    schema: T,
  ): unknown;
  export function string(): unknown;
  export function number(): unknown;
  export function boolean(): unknown;
  export function array(item: unknown): unknown;
  export function picklist<T extends string>(values: readonly T[]): unknown;
  export function literal<T extends string>(value: T): unknown;
}
