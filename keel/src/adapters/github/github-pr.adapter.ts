/**
 * PLAYBOOK-KEEL-SCR-PORT-3, Track 2: open the PR through a governed foreign
 * call, plain REST -- not KEEL's `ForeignMcpConnector` (which speaks actual
 * MCP over Streamable HTTP against an allowlisted origin; GitHub doesn't
 * expose PR-opening over MCP by default, and nothing here assumes a real
 * GitHub MCP server is deployed).
 *
 * Same discipline as every foreign connector in this codebase, just over
 * REST instead of MCP: ONE allowlisted origin (`api.github.com`, hardcoded,
 * never caller-supplied), and every response projected to typed fields --
 * the raw GitHub response body never reaches the model or the review log.
 *
 * This is NOT a `CodemodeConnector` (the `git`/`fx`/`foreign` connectors
 * exist for MODEL-GENERATED sandboxed code to call). `land()` is a direct
 * service-method call, not model-initiated -- there is no model in this
 * loop to gate with `requiresApprovalFor`.
 *
 * PLAYBOOK-KEEL-SCR-PORT-3_5, Track 2: two more calls, both READS, both
 * existing only to make propagation idempotent -- `getBranchSha` and
 * `findExistingPr` are what `ReviewCore#propagate` consults BEFORE pushing
 * or opening a PR, so a resume after a crash between an external step and
 * its status-write never double-acts.
 */
const GITHUB_API_ORIGIN = "https://api.github.com";

export interface OpenPrArgs {
  readonly owner: string;
  readonly repo: string;
  readonly head: string;
  readonly base: string;
  readonly title: string;
  readonly body: string;
}

export interface OpenPrResult {
  readonly number: number;
  readonly htmlUrl: string;
  readonly state: string;
}

export interface PrOpener {
  openPr(args: OpenPrArgs): Promise<OpenPrResult>;
  getBranchSha(owner: string, repo: string, branch: string): Promise<string | null>;
  findExistingPr(owner: string, repo: string, head: string, base: string): Promise<OpenPrResult | null>;
}

export class GitHubRestPrOpener implements PrOpener {
  // A REAL finding from PORT-3's live-infra probe, and stubborn: workerd's
  // native `fetch` throws "Illegal invocation" not just when called via
  // `this.fetchImpl(...)` member access, but even through a
  // `.bind(globalThis)`-wrapped instance property invoked the same way --
  // only a genuinely BARE call (`fetch(...)`, a plain lexical reference,
  // never routed through `this`) is reliably safe. `fetchImpl` stays
  // injectable for tests, but production always resolves through the bare
  // global at call time, never a stored/bound instance property.
  constructor(private readonly token: string, private readonly fetchImpl?: typeof fetch) {}

  #headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "keel-scr-port3",
    };
  }

  async openPr(args: OpenPrArgs): Promise<OpenPrResult> {
    const url = `${GITHUB_API_ORIGIN}/repos/${encodeURIComponent(args.owner)}/${encodeURIComponent(args.repo)}/pulls`;
    const doFetch = this.fetchImpl ?? fetch;
    const res = await doFetch(url, {
      method: "POST",
      headers: { ...this.#headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ title: args.title, body: args.body, head: args.head, base: args.base }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`GitHub PR open failed: ${res.status} ${text.slice(0, 500)}`);
    }
    const raw = (await res.json()) as { number: number; html_url: string; state: string };
    // Projected -- only these three typed fields ever leave this function.
    return { number: raw.number, htmlUrl: raw.html_url, state: raw.state };
  }

  /** `null` for "branch does not exist" (404) -- never a throw for the
   *  expected "not there yet" case, only for genuine failures. */
  async getBranchSha(owner: string, repo: string, branch: string): Promise<string | null> {
    const url = `${GITHUB_API_ORIGIN}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs/heads/${encodeURIComponent(branch)}`;
    const doFetch = this.fetchImpl ?? fetch;
    const res = await doFetch(url, { headers: this.#headers() });
    if (res.status === 404) return null;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`GitHub branch lookup failed: ${res.status} ${text.slice(0, 500)}`);
    }
    const raw = (await res.json()) as { object: { sha: string } };
    return raw.object.sha;
  }

  /** `null` for "no open PR from this head onto this base" -- the caller's
   *  signal to go ahead and open one. */
  async findExistingPr(owner: string, repo: string, head: string, base: string): Promise<OpenPrResult | null> {
    const url = `${GITHUB_API_ORIGIN}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?head=${encodeURIComponent(owner)}:${encodeURIComponent(head)}&base=${encodeURIComponent(base)}&state=open`;
    const doFetch = this.fetchImpl ?? fetch;
    const res = await doFetch(url, { headers: this.#headers() });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`GitHub PR lookup failed: ${res.status} ${text.slice(0, 500)}`);
    }
    const raw = (await res.json()) as Array<{ number: number; html_url: string; state: string }>;
    const first = raw[0];
    return first ? { number: first.number, htmlUrl: first.html_url, state: first.state } : null;
  }
}
