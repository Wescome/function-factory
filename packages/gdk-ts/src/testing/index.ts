// gdk-ts/src/testing/index.ts — MockGovernance testing utility
// Per SDD-GDK §7.1: MockGovernance intercepts all kernel HTTP calls.
// No network required.

import type { ServiceConfig, Tier } from "../types.js";
import type { FidelityLevel } from "../types.js";
import { KernelClient } from "../client.js";

interface Expectation {
  kind: "tier" | "escalation" | "policy_violation" | "approval_delay" | "deny";
  checked: boolean;
}

interface PolicyViolationSpec {
  policyId: string;
  message: string;
}

interface RecordedCall {
  endpoint: string;
  tier?: string;
  decision?: string;
}

/**
 * MockGovernance intercepts all kernel HTTP calls for testing.
 * Use it to configure expectations, wire to GovernedService, then verify.
 *
 * Usage:
 *   const mock = new MockGovernance();
 *   const svc = new MyService(mock.serviceOptions());
 *   mock.expectTier(Tier.AUTONOMOUS);
 *   await svc.doSomething();
 *   mock.verify();
 */
export class MockGovernance {
  private defaultTier: Tier;
  private defaultFidelity: FidelityLevel;

  private expectations: Expectation[] = [];
  private calls: RecordedCall[] = [];

  private woCounter = 0;
  private childCounter = 0;
  private pdpCounter = 0;

  // Dynamic overrides set by expectations
  private nextDecision: "PERMIT" | "DENY" = "PERMIT";
  private nextDenyCode = "";
  private nextTier: Tier | null = null;
  private nextEscalateTo = "";
  private nextPolicyViolation: PolicyViolationSpec | null = null;
  private approvalDelayMs = 0;
  private woStatus: string = "APPROVED";
  private approvalTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options?: { defaultTier?: Tier; defaultFidelity?: FidelityLevel }) {
    this.defaultTier = options?.defaultTier ?? 0;
    this.defaultFidelity = options?.defaultFidelity ?? 1;
  }

  // --------------------------------------------------------------------------
  // Configuration methods (mirror gdktest.MockGovernance Go API)
  // --------------------------------------------------------------------------

  withDefaultTier(tier: Tier): this {
    this.defaultTier = tier;
    return this;
  }

  withDefaultFidelity(level: FidelityLevel): this {
    this.defaultFidelity = level;
    return this;
  }

  // --------------------------------------------------------------------------
  // Expectation methods
  // --------------------------------------------------------------------------

  expectTier(tier: Tier): void {
    this.nextTier = tier;
    this.expectations.push({ kind: "tier", checked: false });
  }

  expectDeny(wacCode: string): void {
    this.nextDecision = "DENY";
    this.nextDenyCode = wacCode;
    this.expectations.push({ kind: "deny", checked: false });
  }

  expectEscalationTo(role: string): void {
    this.nextEscalateTo = role;
    this.expectations.push({ kind: "escalation", checked: false });
  }

  expectPolicyViolation(policyId: string, message: string): void {
    this.nextDecision = "DENY";
    this.nextPolicyViolation = { policyId, message };
    this.expectations.push({ kind: "policy_violation", checked: false });
  }

  expectApprovalGrantedAfter(ms: number): void {
    this.approvalDelayMs = ms;
    this.woStatus = "APPROVAL_PENDING";
    this.expectations.push({ kind: "approval_delay", checked: false });

    this.approvalTimer = setTimeout(() => {
      this.woStatus = "APPROVED";
    }, ms);
  }

  // --------------------------------------------------------------------------
  // Assertion methods
  // --------------------------------------------------------------------------

  /** Assert all expectations were exercised (at least one call was made). */
  verify(): void {
    if (this.expectations.length > 0 && this.calls.length === 0) {
      throw new Error(
        `MockGovernance: ${this.expectations.length} expectations set but no kernel calls were made`,
      );
    }
  }

  /** Returns all recorded kernel calls. */
  getCalls(): RecordedCall[] {
    return [...this.calls];
  }

  /** Returns the total number of kernel HTTP calls made. */
  callCount(): number {
    return this.calls.length;
  }

  /** Returns the number of PDP evaluate calls. */
  pdpCallCount(): number {
    return this.pdpCounter;
  }

  /** Returns the number of work orders created. */
  workOrderCount(): number {
    return this.woCounter;
  }

  /** Clean up timers. */
  close(): void {
    if (this.approvalTimer) {
      clearTimeout(this.approvalTimer);
      this.approvalTimer = null;
    }
  }

  // --------------------------------------------------------------------------
  // Service wiring
  // --------------------------------------------------------------------------

  /**
   * Returns a ServiceConfig that wires GovernedService to this mock.
   * Also returns a setup function that replaces the kernelClient's fetchFn.
   */
  serviceOptions(): ServiceConfig & { _mockSetup: (client: KernelClient) => void } {
    return {
      assemblyId: "mock-assembly",
      purposeId: "mock-purpose",
      kernelEndpoint: "http://mock-kernel",
      authToken: "mock-token",
      approvalTimeoutMs: 10_000,
      approvalPollIntervalMs: 25,
      _mockSetup: (client: KernelClient) => {
        client.fetchFn = this.createMockFetch();
      },
    };
  }

  // --------------------------------------------------------------------------
  // Mock fetch implementation
  // --------------------------------------------------------------------------

  private createMockFetch(): typeof fetch {
    return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      // POST /v1/workorders (not children)
      if (method === "POST" && /\/v1\/workorders$/.test(url)) {
        this.woCounter++;
        const woId = `wo_mock_${this.woCounter}`;
        this.calls.push({ endpoint: "POST /v1/workorders" });
        return new Response(
          JSON.stringify({ work_order_id: woId, status: "DRAFT" }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        );
      }

      // POST /v1/workorders/{id}/children
      if (method === "POST" && /\/v1\/workorders\/[^/]+\/children$/.test(url)) {
        this.childCounter++;
        const woId = `wo_mock_child_${this.childCounter}`;
        this.calls.push({ endpoint: "POST /v1/workorders/{id}/children" });
        return new Response(
          JSON.stringify({ work_order_id: woId, status: "DRAFT" }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        );
      }

      // GET /v1/workorders/{id}
      if (method === "GET" && /\/v1\/workorders\/[^/]+$/.test(url)) {
        const woId = url.split("/").pop()!;
        this.calls.push({ endpoint: "GET /v1/workorders/{id}" });
        return new Response(
          JSON.stringify({
            work_order_id: woId,
            status: this.woStatus,
            autonomy_tier: "T2",
            primary_purpose: "GOVERN_VALUE",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      // POST /v1/pdp/decide
      if (method === "POST" && /\/v1\/pdp\/decide$/.test(url)) {
        this.pdpCounter++;
        const decision = this.nextDecision;
        const pv = this.nextPolicyViolation;

        this.calls.push({
          endpoint: "POST /v1/pdp/decide",
          decision,
        });

        const resp: Record<string, unknown> = {
          policy_decision_id: `pd_mock_${this.pdpCounter}`,
          decision,
          evaluated_at: new Date().toISOString(),
        };

        if (pv) {
          resp.reasons = [{ code: pv.policyId, summary: pv.message }];
        } else {
          resp.reasons = [{ summary: "mock" }];
        }

        return new Response(JSON.stringify(resp), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // GET /v1/evidence/{id}
      if (method === "GET" && /\/v1\/evidence\/[^/]+$/.test(url)) {
        const id = url.split("/").pop()!;
        this.calls.push({ endpoint: "GET /v1/evidence/{id}" });
        return new Response(
          JSON.stringify({
            evidence_id: id,
            work_order_id: "wo_mock_1",
            invocation_id: "inv_mock_1",
            policy_decision_id: "pd_mock_1",
            timestamp: new Date().toISOString(),
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      // Unknown endpoint
      return new Response("Not Found", { status: 404 });
    };
  }
}

/**
 * Helper: create a GovernedService wired to a MockGovernance instance.
 * This handles the internal plumbing so tests stay clean.
 */
export function createMockService<T extends { new (...args: unknown[]): import("../service.js").GovernedService }>(
  ServiceClass: T,
  mock: MockGovernance,
): InstanceType<T> {
  const opts = mock.serviceOptions();
  const svc = new ServiceClass(opts) as InstanceType<T>;
  opts._mockSetup(svc.kernelClient);
  return svc;
}
