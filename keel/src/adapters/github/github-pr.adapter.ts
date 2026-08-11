/**
 * PLAYBOOK-KEEL-SCR-PORT-3, Track 2: open the PR through a governed foreign
 * call, plain REST -- not KEEL's `ForeignMcpConnector` (which speaks actual
 * MCP over Streamable HTTP against an allowlisted origin; GitHub doesn't
 * expose PR-opening over MCP by default, and nothing here assumes a real
 * GitHub MCP server is deployed).
 *
 * Same discipline as every foreign connector in this codebase, just over
 * REST instead of MCP: ONE allowlisted origin (`api.github.com`, hardcoded,
 * never caller-supplied), and the response projected to three typed
 * fields (`number`/`htmlUrl`/`state`) -- the raw GitHub response body
 * never reaches the model or the review log.
 *
 * This is NOT a `CodemodeConnector` (the `git`/`fx`/`foreign` connectors
 * exist for MODEL-GENERATED sandboxed code to call). `land()` is a direct
 * service-method call, not model-initiated -- there is no model in this
 * loop to gate with `requiresApprovalFor`.
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

  async openPr(args: OpenPrArgs): Promise<OpenPrResult> {
    const url = `${GITHUB_API_ORIGIN}/repos/${encodeURIComponent(args.owner)}/${encodeURIComponent(args.repo)}/pulls`;
    const doFetch = this.fetchImpl ?? fetch;
    const res = await doFetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "keel-scr-port3",
        "Content-Type": "application/json",
      },
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
}
