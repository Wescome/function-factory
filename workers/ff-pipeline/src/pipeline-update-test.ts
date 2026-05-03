import { describe, it, expect } from 'vitest';
import { getPipelineUpsertAql } from './config/crystallizer-config';

describe('AQL UPDATE clause crystallizer preservation', () => {
  it('preserves operator-set crystallizer.enabled configuration during pipeline updates', () => {
    const aql = getPipelineUpsertAql();

    // The AQL string must contain an UPDATE statement.
    expect(aql).toContain('UPDATE');

    // Extract the inline object from the UPDATE clause.
    // Expected shape after the fix: { seededAt: @now, source: hardcoded-defaults }
    const updateMatch = aql.match(/UPDATE\s+({[^{}]+})/s);
    expect(updateMatch).toBeTruthy();
    const updateClause = updateMatch![1];

    // The UPDATE clause should refresh seededAt and source...
    expect(updateClause).toContain('seededAt: @now');
    expect(updateClause).toContain('source: hardcoded-defaults');

    // ...but must NOT include crystallizer so that an operator-set
    // crystallizer.enabled value survives the upsert.
    expect(updateClause).not.toContain('crystallizer:');
    expect(aql).not.toMatch(/UPDATE\s+{[^}]*\bcrystallizer\s*:/s);
  });
});
