import { Agent } from "agents";

interface Env {
  TESTAGENT: DurableObjectNamespace;
}

/**
 * Minimal falsifiable test of the claim: onFiberRecovered fires iff the DO
 * instance is TRULY evicted (not merely re-fetched), and never fires for a
 * clean in-instance throw.
 */
export class TestAgent extends Agent<Env> {
  private ensureSchema() {
    this.sql`CREATE TABLE IF NOT EXISTS recovery_flag (id INTEGER PRIMARY KEY, recovered INTEGER, snapshot TEXT)`;
  }

  /** Fire-and-forget: starts a fiber that never resolves on its own, so the
   *  ONLY way it ends is via true eviction + recovery, or a thrown error. */
  startNeverEndingFiber(): boolean {
    this.ensureSchema();
    void this.runFiber("never-ending", async (ctx) => {
      ctx.stash({ started: true, marker: "hello-from-fiber" });
      await new Promise(() => {}); // never resolves within this instance's life
    });
    return true;
  }

  /** Control: same shape, but throws instead of hanging — tests whether a
   *  clean throw ALSO leaves something recoverable (the KEEL-spike finding
   *  says it should NOT). */
  async startThrowingFiber(): Promise<string> {
    this.ensureSchema();
    try {
      await this.runFiber("throwing", async (ctx) => {
        ctx.stash({ started: true });
        throw new Error("SIMULATED_INTERRUPT");
      });
      return "no-throw";
    } catch (e) {
      return "threw:" + (e instanceof Error ? e.message : String(e));
    }
  }

  async onFiberRecovered(ctx: { snapshot: unknown }): Promise<void> {
    this.ensureSchema();
    this.sql`INSERT OR REPLACE INTO recovery_flag (id, recovered, snapshot) VALUES (1, 1, ${JSON.stringify(ctx.snapshot)})`;
  }

  wasRecovered(): { recovered: boolean; snapshot: string | null } {
    this.ensureSchema();
    const rows = [...this.sql`SELECT recovered, snapshot FROM recovery_flag WHERE id = 1`] as { recovered: number; snapshot: string }[];
    return rows.length ? { recovered: rows[0].recovered === 1, snapshot: rows[0].snapshot } : { recovered: false, snapshot: null };
  }

  /** Introspect the raw fiber ledger — does an orphaned row exist? */
  activeFiberRows(): number {
    const rows = [...this.sql`SELECT COUNT(*) as c FROM cf_agents_runs`] as { c: number }[];
    return rows[0]?.c ?? 0;
  }
}

export default { fetch() { return new Response("fiber-recovery-verify"); } };
