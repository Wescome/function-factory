/** Use case #2: multi-step geocode->weather. Deterministic (recorded shapes) +
 *  the CROSS-STEP anchor: weather must be called with the coords geocode returned. */
import { describe, it, expect } from "vitest";
import { fetchGeocode } from "../src/adapters/geo/geo-call";
import { fetchWeather } from "../src/adapters/weather/weather-call";

const GEO = { results: [{ name: "Paris", latitude: 48.85341, longitude: 2.3488 }] };
const WX = { current: { temperature_2m: 24.4 } };
const geoFetch = (async () => ({ ok: true, status: 200, json: async () => GEO }) as Response) as unknown as typeof fetch;
const wxFetch = (async () => ({ ok: true, status: 200, json: async () => WX }) as Response) as unknown as typeof fetch;

// A2 replicated: cross-step threading + faithful temp, all anchored on recorded calls
type Call = { connector: string; args: { latitude?: number; longitude?: number }; response: any };
const A2 = (result: { temperature_c: number }, calls: Call[]) => {
  const g = calls.find((c) => c.connector === "geo"); const w = calls.find((c) => c.connector === "weather");
  if (!g || !w || !g.response?.results?.[0] || !w.response?.current) return false;
  const gr = g.response.results[0];
  if (Math.abs(w.args.latitude! - gr.latitude) > 1e-4 || Math.abs(w.args.longitude! - gr.longitude) > 1e-4) return false;
  return result.temperature_c === w.response.current.temperature_2m;
};
const geoCall = (): Call => ({ connector: "geo", args: {}, response: GEO });
const wxCall = (lat: number, lon: number, temp = 24.4): Call => ({ connector: "weather", args: { latitude: lat, longitude: lon }, response: { current: { temperature_2m: temp } } });

describe("#2 connectors navigate nested shapes", () => {
  it("geocode coords are under results[0] (model must discover)", async () => {
    const g = await fetchGeocode("Paris", { fetchImpl: geoFetch });
    expect(g.results![0]!.latitude).toBe(48.85341);
  });
  it("weather temp is under current.temperature_2m", async () => {
    const w = await fetchWeather(48.85341, 2.3488, { fetchImpl: wxFetch });
    expect(w.current!.temperature_2m).toBe(24.4);
  });
  it("geo rejects a bad city; weather rejects out-of-range coords", async () => {
    await expect(fetchGeocode("'; DROP", { fetchImpl: geoFetch })).rejects.toThrow("invalid city");
    await expect(fetchWeather(999, 0, { fetchImpl: wxFetch })).rejects.toThrow("invalid coords");
  });
});

describe("#2 cross-step anchor (threading, not invented coords)", () => {
  it("weather called with the geocoded coords + faithful temp -> A2 pass", () => {
    expect(A2({ temperature_c: 24.4 }, [geoCall(), wxCall(48.85341, 2.3488)])).toBe(true);
  });
  it("FABRICATED coords (weather args != geocode output) -> A2 fails", () => {
    expect(A2({ temperature_c: 24.4 }, [geoCall(), wxCall(0, 0)])).toBe(false);
  });
  it("FABRICATED temperature (!= recorded weather response) -> A2 fails", () => {
    expect(A2({ temperature_c: 99 }, [geoCall(), wxCall(48.85341, 2.3488, 24.4)])).toBe(false);
  });
  it("no geocode call (hardcoded coords, skipped step 1) -> A2 fails", () => {
    expect(A2({ temperature_c: 24.4 }, [wxCall(48.85341, 2.3488)])).toBe(false);
  });
});
