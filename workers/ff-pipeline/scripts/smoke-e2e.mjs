#!/usr/bin/env node
// smoke-e2e.mjs — post-deploy smoke probe driver.
//
// POST {FF_PIPELINE_URL}/smoke/e2e with Authorization: Bearer {OPERATOR_CONTROL_TOKEN}.
// HTTP request timeout: 270s (§3.5 timeout budget — nested inside CI's 300s).
//
// Exit 0: outcome === "approved" || outcome === "skipped"
// Exit 1: outcome === "failed" | non-2xx | request timeout
//
// Spec: specs/reference/SPEC-G3-SMOKE-FIDELITY-SCRIPTS.md §3.4.
// No external npm deps — global fetch/AbortController + node:process only (AC-S7).

import process from "node:process";

const HTTP_TIMEOUT_MS = 270_000;

function fail(message) {
  console.error(`[smoke:e2e] ${message}`);
  process.exit(1);
}

async function main() {
  const baseUrl = process.env.FF_PIPELINE_URL || "";
  const token = process.env.OPERATOR_CONTROL_TOKEN || "";

  if (!baseUrl) fail("FF_PIPELINE_URL is not set.");
  if (!token) fail("OPERATOR_CONTROL_TOKEN is not set.");

  const url = `${baseUrl.replace(/\/+$/, "")}/smoke/e2e`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: "{}",
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err && err.name === "AbortError") {
      fail(`Request timed out after ${HTTP_TIMEOUT_MS}ms. (AC-S4)`);
    }
    fail(`Request to ${url} failed: ${err && err.message ? err.message : err}`);
    return;
  }
  clearTimeout(timer);

  const bodyText = await res.text().catch(() => "");
  let parsed = null;
  try {
    parsed = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    parsed = null;
  }

  if (res.status < 200 || res.status >= 300) {
    fail(
      `/smoke/e2e returned HTTP ${res.status}. (AC-S3)\n${bodyText}`,
    );
  }

  const outcome = parsed && typeof parsed.outcome === "string" ? parsed.outcome : "";

  if (outcome === "approved" || outcome === "skipped") {
    console.log(
      `[smoke:e2e] outcome=${outcome}` +
        (parsed.workflowId ? ` workflowId=${parsed.workflowId}` : "") +
        (typeof parsed.durationMs === "number" ? ` durationMs=${parsed.durationMs}` : "") +
        (parsed.reason ? ` reason=${parsed.reason}` : "") +
        " — passing. (AC-S1/AC-S2)",
    );
    process.exit(0);
  }

  fail(
    `/smoke/e2e outcome=${outcome || "<missing>"}` +
      (parsed && parsed.reason ? ` reason=${parsed.reason}` : "") +
      `. (AC-S3)\n${bodyText}`,
  );
}

main().catch((err) => {
  fail(`Unexpected error: ${err && err.stack ? err.stack : err}`);
});
