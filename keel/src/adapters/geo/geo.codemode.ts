import { CodemodeConnector } from "@cloudflare/codemode";
import type { CallRecorder } from "../codemode/call-recorder";
import { fetchGeocode } from "./geo-call";
import { requiresApprovalFor } from "../../domain/index";
export class GeoConnector extends CodemodeConnector<unknown> {
  private readonly f: typeof fetch;
  constructor(ctx: unknown, env: unknown, private readonly rec?: CallRecorder, fetchImpl?: typeof fetch) {
    super(ctx as never, env as never); this.f = fetchImpl ?? fetch.bind(globalThis);
  }
  override name() { return "geo"; }
  override tools() {
    const rec = this.rec, f = this.f;
    return { lookup: { description: "geo.lookup({city}) => geocoding result for a city name.",
      requiresApproval: requiresApprovalFor("geo", "lookup"),
      execute: (a: unknown) => fetchGeocode(((a ?? {}) as { city?: string }).city as string, { fetchImpl: f, recorder: rec }) } };
  }
}
