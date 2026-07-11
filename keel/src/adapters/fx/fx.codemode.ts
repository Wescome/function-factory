/**
 * Real read-only connector over the Frankfurter FX API (ECB, no auth). KEEL-
 * authored; endpoint fixed, model supplies only ISO-4217 codes (validated), so
 * it cannot steer the URL. Returns the raw API shape — the model must discover
 * the nesting (rates[to]). Logic lives in fetchRate (pure, tested).
 */
import { CodemodeConnector } from "@cloudflare/codemode";
import type { CallRecorder } from "../codemode/call-recorder";
import { fetchRate } from "./fx-call";

export class FxConnector extends CodemodeConnector<unknown> {
  private readonly f: typeof fetch;
  constructor(ctx: unknown, env: unknown, private readonly rec?: CallRecorder, fetchImpl?: typeof fetch) {
    super(ctx as never, env as never);
    this.f = fetchImpl ?? fetch.bind(globalThis); // avoid Workers "Illegal invocation"
  }
  override name() { return "fx"; }
  override tools() {
    const rec = this.rec, f = this.f;
    return {
      rate: {
        description: "fx.rate({from, to}) => latest reference FX rate; from/to are ISO-4217 codes.",
        execute: (args: unknown) => {
          const { from, to } = (args ?? {}) as { from?: string; to?: string };
          return fetchRate(from as string, to as string, { fetchImpl: f, recorder: rec });
        },
      },
    };
  }
}
