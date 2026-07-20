/** Pure geocoding call (Open-Meteo, no auth). Returns raw shape; coords are nested
 *  under results[0] — the model must discover that. */
import type { CallRecorder } from "../codemode/call-recorder";
const GEO_BASE = "https://geocoding-api.open-meteo.com/v1/search";
export interface GeoResult { results?: { latitude: number; longitude: number; name: string }[]; }
export async function fetchGeocode(city: string, deps: { fetchImpl: typeof fetch; recorder?: CallRecorder }): Promise<GeoResult> {
  if (typeof city !== "string" || !/^[A-Za-z .'-]{1,60}$/.test(city)) throw new Error(`invalid city: ${String(city)}`);
  const res = await deps.fetchImpl(`${GEO_BASE}?name=${encodeURIComponent(city)}&count=1`);
  if (!res.ok) throw new Error(`geo failed: HTTP ${res.status}`);
  const body = (await res.json()) as GeoResult;
  deps.recorder?.record("geo", "lookup", { city }, body);
  return body;
}
