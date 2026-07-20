import { CodemodeConnector } from "@cloudflare/codemode";
import type { CallRecorder } from "../codemode/call-recorder";
import { fetchWeather } from "./weather-call";
import { requiresApprovalFor } from "../../domain/index";
export class WeatherConnector extends CodemodeConnector<unknown> {
  private readonly f: typeof fetch;
  constructor(ctx: unknown, env: unknown, private readonly rec?: CallRecorder, fetchImpl?: typeof fetch) {
    super(ctx as never, env as never); this.f = fetchImpl ?? fetch.bind(globalThis);
  }
  override name() { return "weather"; }
  override tools() {
    const rec = this.rec, f = this.f;
    return { current: { description: "weather.current({latitude, longitude}) => current weather at coords.",
      requiresApproval: requiresApprovalFor("weather", "current"),
      execute: (a: unknown) => { const x = (a ?? {}) as { latitude?: number; longitude?: number };
        return fetchWeather(x.latitude as number, x.longitude as number, { fetchImpl: f, recorder: rec }); } } };
  }
}
