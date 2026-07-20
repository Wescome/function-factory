/** Pure FX call logic (testable without a DO). The connector delegates here. */
import type { CallRecorder } from "../codemode/call-recorder";

const FX_BASE = "https://api.frankfurter.dev/v1/latest";
const CODE = /^[A-Z]{3}$/;

export interface FxDeps { readonly fetchImpl: typeof fetch; readonly recorder?: CallRecorder; }
export interface FxRate { readonly amount: number; readonly base: string; readonly date: string; readonly rates: Record<string, number>; }

export async function fetchRate(from: string, to: string, deps: FxDeps): Promise<FxRate> {
  if (!from || !to || !CODE.test(from) || !CODE.test(to)) {
    throw new Error(`invalid currency codes: ${String(from)}->${String(to)}`);
  }
  const res = await deps.fetchImpl(`${FX_BASE}?base=${from}&symbols=${to}`);
  if (!res.ok) throw new Error(`fx failed: HTTP ${res.status}`);
  const body = (await res.json()) as FxRate;
  deps.recorder?.record("fx", "rate", { from, to }, body);
  return body; // raw shape: { amount, base, date, rates: { [to]: number } }
}
