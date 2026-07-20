export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export function migrate(storage: DurableObjectStorage, migrations: Migration[]): void {
  // Ensure schema_history table exists first (idempotent)
  storage.sql.exec(`CREATE TABLE IF NOT EXISTS schema_history (
    version INTEGER PRIMARY KEY,
    name    TEXT    NOT NULL,
    applied INTEGER NOT NULL
  )`);

  const applied = new Set(
    [...storage.sql.exec('SELECT version FROM schema_history')].map(r => r.version as number)
  );

  for (const m of migrations) {
    if (!applied.has(m.version)) {
      // Execute the migration SQL. Split on semicolons to handle multi-statement strings.
      const statements = m.sql
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0);
      for (const stmt of statements) {
        storage.sql.exec(stmt);
      }
      storage.sql.exec(
        'INSERT INTO schema_history (version, name, applied) VALUES (?, ?, ?)',
        m.version, m.name, Date.now()
      );
    }
  }
}
