/**
 * gateway-model.test.ts — the real ModelPort adapter, unit-tested with a mocked
 * gateway (no live LLM). Proves prompt construction, response parsing (OpenAI +
 * Anthropic shapes), fence stripping, and fail-loud on a gateway error.
 */
import { describe, it, expect } from "vitest";
import { GatewayModelAdapter } from "../src/adapters/model/gateway-model.adapter";
import type { SpecificationContent } from "../src/domain/index";

const spec: SpecificationContent = {
  intent: "produce a payload whose value is 42",
  acceptance: [{ id: "A1", statement: "result.value === 42", kind: "example" }],
  connectors: ["echo"],
  capabilityCeiling: "connectors-only",
  approvalGated: [],
  attemptBudget: 3,
  oracleRef: "echo@v1",
};

function mockFetch(payload: unknown, ok = true, status = 200): { fn: typeof fetch; captured: { init?: RequestInit } } {
  const captured: { init?: RequestInit } = {};
  const fn = (async (_url: string, init?: RequestInit) => {
    captured.init = init;
    return {
      ok, status,
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    } as Response;
  }) as unknown as typeof fetch;
  return { fn, captured };
}

describe("GatewayModelAdapter", () => {
  it("builds a connectors-only prompt and parses an OpenAI-shaped response", async () => {
    const { fn, captured } = mockFetch({ choices: [{ message: { content: "```js\nconst r = await echo.emit({ value: 42 }); return r;\n```" } }] });
    const a = new GatewayModelAdapter({ url: "https://gw/openai", model: "m", apiKey: "k", fetchImpl: fn });
    const out = await a.generate(spec);
    expect(out.code).toBe("const r = await echo.emit({ value: 42 }); return r;"); // fences stripped
    expect(out.connectors).toEqual(["echo"]);

    const body = JSON.parse(captured.init?.body as string);
    expect(body.model).toBe("m");
    const user = body.messages.find((m: { role: string }) => m.role === "user").content;
    expect(user).toContain("produce a payload whose value is 42"); // the intent
    expect(user).toContain("[A1]");                                 // the acceptance
    expect(user).toContain("echo.emit");                            // the connector doc
  });

  it("parses an Anthropic-shaped response too", async () => {
    const { fn } = mockFetch({ content: [{ text: "return await echo.emit({ value: 42 });" }] });
    const a = new GatewayModelAdapter({ url: "https://gw/anthropic", model: "m", apiKey: "k", fetchImpl: fn });
    expect((await a.generate(spec)).code).toBe("return await echo.emit({ value: 42 });");
  });

  it("appends failing evidence on an amend", async () => {
    const { fn, captured } = mockFetch({ choices: [{ message: { content: "return 1;" } }] });
    const a = new GatewayModelAdapter({ url: "https://gw/openai", model: "m", apiKey: "k", fetchImpl: fn });
    await a.generate(spec, { outcome: "fail", results: { A1: "fail" }, evidence: { observed: { A1: 41 } }, oracleRef: "echo@v1", attempt: 1, ms: 5 });
    const user = JSON.parse(captured.init?.body as string).messages.find((m: { role: string }) => m.role === "user").content;
    expect(user).toContain("FAILED verification");
    expect(user).toContain("[A1]");                    // names the failed criterion
    expect(user).toContain("result.value === 42");     // and its statement
    expect(user).toContain("41");                     // the OBSERVED value is still surfaced (new neutral attribution)
    expect(user).toContain("materially different");    // the reinterpretation nudge (Option D)
    expect(user).not.toContain("expected");            // INV-ORACLE-BLIND: never the answer
  });

  it("fails loud on an EMPTY model response — never a silent no-op (return undefined)", async () => {
    // 200 OK but empty content — the reasoning-model truncation shape
    const { fn } = mockFetch({ choices: [{ finish_reason: "length", message: { content: "", reasoning_content: "...thinking..." } }], usage: { completion_tokens: 2000 } });
    const a = new GatewayModelAdapter({ url: "https://gw/openai", model: "m", apiKey: "k", fetchImpl: fn });
    const out = await a.generate(spec);
    expect(out.code).toContain("throw new Error");
    expect(out.code).toContain("empty model response");
    expect(out.code).not.toContain("return undefined");      // no laundered no-op
    expect(out.code).toContain("finish_reason=length");      // diagnostics land in lineage
    expect(out.code).toContain("reasoning_content=present");
    expect(out.code).toContain("completion_tokens=2000");
  });

  it("uses temperature 0 on cold start but samples on the amend turn (retries must vary)", async () => {
    const { fn, captured } = mockFetch({ choices: [{ message: { content: "return 1;" } }] });
    const a = new GatewayModelAdapter({ url: "https://gw/openai", model: "m", apiKey: "k", fetchImpl: fn });

    await a.generate(spec); // cold start
    expect(JSON.parse(captured.init?.body as string).temperature).toBe(0);

    await a.generate(spec, { outcome: "fail", results: { A1: "fail" }, evidence: { observed: { A1: 41 } }, oracleRef: "echo@v1", attempt: 1, ms: 5 });
    expect(JSON.parse(captured.init?.body as string).temperature).toBeGreaterThan(0); // amend samples
  });

  it("applies amendParams only on the amend turn (e.g. capping reasoning on retries)", async () => {
    const { fn, captured } = mockFetch({ choices: [{ message: { content: "return 1;" } }] });
    const a = new GatewayModelAdapter({ url: "https://gw/openai", model: "m", apiKey: "k", fetchImpl: fn, amendParams: { reasoning_effort: "low" } });

    await a.generate(spec); // cold start: no amendParams
    expect(JSON.parse(captured.init?.body as string).reasoning_effort).toBeUndefined();

    await a.generate(spec, { outcome: "fail", results: { A1: "fail" }, evidence: { observed: { A1: 41 } }, oracleRef: "echo@v1", attempt: 1, ms: 5 });
    expect(JSON.parse(captured.init?.body as string).reasoning_effort).toBe("low"); // amend turn: applied
  });

  it("MR mode: instructs a bare compute(value) body, no connectors, no function wrapper", async () => {
    const { fn, captured } = mockFetch({ choices: [{ message: { content: "return { value, check: value*2 };" } }] });
    const a = new GatewayModelAdapter({ url: "https://gw/openai", model: "m", apiKey: "k", fetchImpl: fn, metamorphic: true });
    await a.generate(spec);
    const body = JSON.parse(captured.init?.body as string);
    const sys = body.messages.find((m: { role: string }) => m.role === "system").content;
    const user = body.messages.find((m: { role: string }) => m.role === "user").content;
    expect(sys).toContain("BODY of a function `compute(value)`");
    expect(sys).toContain("Do NOT wrap your code in a function declaration");
    expect(sys).toContain("Do NOT call any connectors");
    expect(user).not.toContain("Available connectors"); // connectors omitted for MR
  });

  it("MR mode: all-null probes -> amend evidence flags a SHAPE bug, not a value bug", async () => {
    const { fn, captured } = mockFetch({ choices: [{ message: { content: "return { value, check: value*2 };" } }] });
    const a = new GatewayModelAdapter({ url: "https://gw/openai", model: "m", apiKey: "k", fetchImpl: fn, metamorphic: true });
    await a.generate(spec, {
      outcome: "fail", results: { A1: "fail" },
      evidence: { observed: { A1: [{ input: 42, output: null }, { input: 43, output: null }] } },
      oracleRef: "derived-mr@v1", attempt: 1, ms: 5,
    });
    const user = JSON.parse(captured.init?.body as string).messages.find((m: { role: string }) => m.role === "user").content;
    expect(user).toContain("returned NOTHING for the probed inputs");
    expect(user).toContain("do not wrap it in a function declaration");
  });

  it("fails loud on a STALLED backend — times out into a throwing action, never hangs", async () => {
    // a fetch that respects AbortSignal but never resolves on its own
    const stalling = ((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const sig = init?.signal;
      if (sig) sig.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "TimeoutError" })));
    })) as unknown as typeof fetch;
    const a = new GatewayModelAdapter({ url: "https://gw/openai", model: "m", apiKey: "k", fetchImpl: stalling, timeoutMs: 40 });
    const out = await a.generate(spec);
    expect(out.code).toContain("throw new Error");
    expect(out.code).toContain("timed out after 40ms");
  });

  it("fails loud (throwing action) on a gateway error — never fabricates code", async () => {
    const { fn } = mockFetch({ error: "unauthorized" }, false, 401);
    const a = new GatewayModelAdapter({ url: "https://gw/openai", model: "m", apiKey: "k", fetchImpl: fn });
    const out = await a.generate(spec);
    expect(out.code).toContain("throw new Error");
    expect(out.code).toContain("401");
  });
});
