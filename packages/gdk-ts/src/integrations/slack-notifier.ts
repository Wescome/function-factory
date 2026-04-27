// gdk-ts/src/integrations/slack-notifier.ts — Sprint lifecycle notifications via Slack
// Fire-and-forget — never blocks agent execution

export interface SlackConfig {
  /** Webhook URL or gdk-mom endpoint */
  webhookUrl?: string;
  /** Channel overrides per event type */
  channels?: {
    sprint_complete?: string;
    task_blocked?: string;
    approval_needed?: string;
    evidence_milestone?: string;
  };
  /** Default channel if no override */
  defaultChannel?: string;
  /** Enable/disable (default: true if webhookUrl set) */
  enabled?: boolean;
}

export type SlackEventType =
  | "sprint_complete"
  | "task_blocked"
  | "approval_needed"
  | "evidence_milestone";

export interface SlackEvent {
  type: SlackEventType;
  title: string;
  fields: Record<string, string | number>;
  color?: string;
  urgency?: "low" | "medium" | "high";
}

const COLORS: Record<SlackEventType, string> = {
  sprint_complete: "#22c55e", // green
  task_blocked: "#ef4444",   // red
  approval_needed: "#f59e0b", // amber
  evidence_milestone: "#3b82f6", // blue
};

export class SlackNotifier {
  private config: SlackConfig;

  constructor(config: SlackConfig) {
    this.config = config;
  }

  get enabled(): boolean {
    return (this.config.enabled ?? true) && !!this.config.webhookUrl;
  }

  /**
   * Send notification — fire-and-forget, never throws.
   */
  async notify(event: SlackEvent): Promise<void> {
    if (!this.enabled) return;

    const channel =
      this.config.channels?.[event.type] ||
      this.config.defaultChannel ||
      "#weops-alerts";

    const color = event.color || COLORS[event.type] || "#6b7280";

    const fields = Object.entries(event.fields).map(([key, value]) => ({
      title: key,
      value: String(value),
      short: String(value).length < 30,
    }));

    const payload = {
      channel,
      attachments: [
        {
          color,
          title: event.title,
          fields,
          footer: "WeOps GDK",
          ts: Math.floor(Date.now() / 1000),
        },
      ],
    };

    try {
      await fetch(this.config.webhookUrl!, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      // Fire-and-forget — never block agent execution
    }
  }

  // ── Convenience methods ──────────────────────────────────

  async sprintComplete(sprint: number, resolved: number, total: number, cost: number): Promise<void> {
    await this.notify({
      type: "sprint_complete",
      title: `Sprint ${sprint} Complete`,
      fields: {
        Resolved: `${resolved}/${total}`,
        Cost: `$${cost.toFixed(2)}`,
        Status: resolved === total ? "All passed" : `${total - resolved} blocked`,
      },
    });
  }

  async taskBlocked(gapId: string, reason: string, sprint: number): Promise<void> {
    await this.notify({
      type: "task_blocked",
      title: `Task Blocked: ${gapId}`,
      urgency: "high",
      fields: {
        Sprint: String(sprint),
        Reason: reason,
        Action: "Manual intervention required",
      },
    });
  }

  async approvalNeeded(toolName: string, tier: string, workOrderId: string): Promise<void> {
    await this.notify({
      type: "approval_needed",
      title: `Approval Required: ${toolName}`,
      urgency: "high",
      fields: {
        Tool: toolName,
        Tier: tier,
        "Work Order": workOrderId,
        Action: "Approve in gdk agent console",
      },
    });
  }

  async evidenceMilestone(count: number, workOrderId: string): Promise<void> {
    await this.notify({
      type: "evidence_milestone",
      title: `Evidence Milestone: ${count} records`,
      fields: {
        "Total Records": String(count),
        "Work Order": workOrderId,
      },
    });
  }
}
