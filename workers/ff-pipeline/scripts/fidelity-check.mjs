#!/usr/bin/env node
// fidelity-check.mjs — enforce INV-DEVOPS-13.
//
// No agent-authored PR touching FN-* implementation files may merge without a
// Fidelity VR ID cited in the PR body.
//
// Spec: specs/reference/SPEC-G3-SMOKE-FIDELITY-SCRIPTS.md §2 (APPROVED).
// No external npm deps — only node:https, node:process, node:url (AC-F6).

import https from "node:https";
import process from "node:process";
import { URL } from "node:url";

const FN_PATCH_RE = /functionId\s*[=:]\s*["']FN-[A-Z0-9][A-Z0-9-]*["']/g;
const FN_ID_RE = /FN-[A-Z0-9][A-Z0-9-]*/;
const VR_FIDELITY_RE = /VR-[A-Z0-9][A-Z0-9-]+-FIDELITY/;

/**
 * Perform a GitHub API GET request.
 * Resolves with { status, headers, body } where body is the raw response text.
 * Rejects only on transport-level errors.
 */
function githubGet(apiUrl, token) {
  return new Promise((resolve, reject) => {
    const u = new URL(apiUrl);
    const options = {
      method: "GET",
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "ff-fidelity-check",
      },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        resolve({ status: res.statusCode, headers: res.headers, body: data });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

/**
 * Parse the GitHub Link header and return the URL for rel="next", or null.
 * Example: <https://api.github.com/...?page=2>; rel="next", <...>; rel="last"
 */
function parseNextLink(linkHeader) {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (match) return match[1];
  }
  return null;
}

function fail(message) {
  console.error(`[fidelity:check] ${message}`);
  process.exit(1);
}

async function main() {
  const ref = process.env.GITHUB_REF || "";
  const repo = process.env.GITHUB_REPOSITORY || "";
  const token = process.env.GITHUB_TOKEN || "";

  // 1. Resolve PR number from GITHUB_REF (refs/pull/{N}/merge).
  const prMatch = ref.match(/^refs\/pull\/(\d+)\/merge$/);
  if (!prMatch) {
    console.log(
      `[fidelity:check] GITHUB_REF (${ref || "<unset>"}) is not a PR merge ref — skipping. (AC-F4)`,
    );
    process.exit(0);
  }
  const prNumber = prMatch[1];

  if (!repo) fail("GITHUB_REPOSITORY is not set.");
  if (!token) fail("GITHUB_TOKEN is not set.");

  // 2. Fetch PR metadata (for body / VR citation).
  const prRes = await githubGet(
    `https://api.github.com/repos/${repo}/pulls/${prNumber}`,
    token,
  );
  if (prRes.status < 200 || prRes.status >= 300) {
    fail(
      `GitHub API returned ${prRes.status} for PR metadata. (AC-F5)\n${prRes.body}`,
    );
  }
  let pr;
  try {
    pr = JSON.parse(prRes.body);
  } catch (err) {
    fail(`Failed to parse PR metadata JSON: ${err.message}`);
  }
  const prBody = pr.body == null ? "" : String(pr.body);

  // 3. Fetch changed file list with Link-header pagination (AC-F7).
  const files = [];
  let nextUrl = `https://api.github.com/repos/${repo}/pulls/${prNumber}/files?per_page=100`;
  while (nextUrl) {
    const res = await githubGet(nextUrl, token);
    if (res.status < 200 || res.status >= 300) {
      fail(
        `GitHub API returned ${res.status} for PR files. (AC-F5)\n${res.body}`,
      );
    }
    let page;
    try {
      page = JSON.parse(res.body);
    } catch (err) {
      fail(`Failed to parse PR files JSON: ${err.message}`);
    }
    if (!Array.isArray(page)) {
      fail("PR files response was not an array.");
    }
    for (const f of page) files.push(f);
    nextUrl = parseNextLink(res.headers.link);
  }

  // 4. FN detection (content-based): scan each file's .patch for functionId="FN-..."
  const fnIds = new Set();
  for (const file of files) {
    const patch = typeof file.patch === "string" ? file.patch : "";
    if (!patch) continue;
    const matches = patch.match(FN_PATCH_RE);
    if (!matches) continue;
    for (const m of matches) {
      const id = m.match(FN_ID_RE);
      if (id) fnIds.add(id[0]);
    }
  }

  // 5. No FN references → exit 0 (AC-F1).
  if (fnIds.size === 0) {
    console.log(
      "[fidelity:check] No FN-* functionId references in changed file patches — passing. (AC-F1)",
    );
    process.exit(0);
  }

  const fnList = [...fnIds].sort();

  // 6 & 7. Scan PR body for VR-*-FIDELITY citation.
  const hasFidelityVr = VR_FIDELITY_RE.test(prBody);
  if (!hasFidelityVr) {
    fail(
      `INV-DEVOPS-13 violation: PR touches FN-* implementation (${fnList.join(", ")}) ` +
        `but the PR body cites no Fidelity VR (expected a token matching VR-*-FIDELITY). (AC-F3)`,
    );
  }

  // 8. Exit 0.
  console.log(
    `[fidelity:check] FN-* references (${fnList.join(", ")}) found and Fidelity VR cited in PR body — passing. (AC-F2)`,
  );
  process.exit(0);
}

main().catch((err) => {
  fail(`Unexpected error: ${err && err.stack ? err.stack : err}`);
});
