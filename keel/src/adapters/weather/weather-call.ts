/** Pure weather call (Open-Meteo, no auth). Temp is nested under current.temperature_2m. */
import type { CallRecorder } from "../codemode/call-recorder";
const WX_BASE = "https://api.open-meteo.com/v1/forecast";
export interface WxResult { current?: { temperature_2m: number }; }
export async function fetchWeather(latitude: number, longitude: number, deps: { fetchImpl: typeof fetch; recorder?: CallRecorder }): Promise<WxResult> {
  if (typeof latitude !== "number" || typeof longitude !== "number" || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw new Error(`invalid coords: ${String(latitude)},${String(longitude)}`);
  }
  const res = await deps.fetchImpl(`${WX_BASE}?latitude=${latitude}&longitude=${longitude}&current=temperature_2m`);
  if (!res.ok) throw new Error(`weather failed: HTTP ${res.status}`);
  const body = (await res.json()) as WxResult;
  deps.recorder?.record("weather", "current", { latitude, longitude }, body);
  return body;
}
