import { DurableObject } from 'cloudflare:workers';
import { migrate } from './migrate.js';
import type { Migration } from './migrate.js';
import * as BQ from './bead-queries.js';
import { computeBeadId } from './bead-id.js';
import type { AnyBead } from './schemas.js';

export abstract class BeadGraphDOBase<Env> extends DurableObject<Env> {
  protected sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env, migrations: Migration[]) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.ctx.blockConcurrencyWhile(async () => {
      migrate(ctx.storage, migrations);
    });
  }

  async writeBead(bead: AnyBead, auditBead?: AnyBead): Promise<void> {
    // CF Workers DO SQLite: use storage.transactionSync for atomicity (SQL BEGIN forbidden)
    this.ctx.storage.transactionSync(() => {
      BQ.writeBead(this.sql, bead, auditBead);
    });
  }

  async getBead(beadId: string) {
    return BQ.getBead(this.sql, beadId);
  }

  async getCurrentTrustBead(orgId: string, subjectId: string) {
    return BQ.getCurrentTrustBead(this.sql, orgId, subjectId);
  }

  async getActiveConsent(orgId: string, roleId: string) {
    return BQ.getActiveConsent(this.sql, orgId, roleId);
  }

  async getTrustLineage(orgId: string, subjectId: string) {
    return BQ.getTrustLineage(this.sql, orgId, subjectId);
  }

  async getOpenAmendments(orgId: string) {
    return BQ.getOpenAmendments(this.sql, orgId);
  }

  async retrieveKnowingState(orgId: string, roleId: string, category?: string) {
    return BQ.retrieveKnowingState(this.sql, orgId, roleId, category);
  }

  computeBeadId(type: string, content: Record<string, unknown>, parentIds: string[]): string {
    return computeBeadId(type, content, parentIds);
  }
}
