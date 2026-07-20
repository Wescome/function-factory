export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export function migrate(
  storage: DurableObjectStorage,
  migrations: Migration[]
): void {
  const sql = storage.sql;

  // Ensure schema_history table exists (bootstrapping)
  sql.exec(`
    CREATE TABLE IF NOT EXISTS schema_history (
      version INTEGER PRIMARY KEY,
      name    TEXT    NOT NULL,
      applied INTEGER NOT NULL
    )
  `);

  // Find applied versions
  const applied = new Set(
    [...(sql.exec('SELECT version FROM schema_history') as Iterable<{ version: number }>)]
      .map(r => r.version)
  );

  // Apply pending migrations in order
  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    // Split multi-statement SQL
    const statements = migration.sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);
    for (const stmt of statements) {
      sql.exec(stmt);
    }
    sql.exec(
      'INSERT INTO schema_history (version, name, applied) VALUES (?, ?, ?)',
      migration.version,
      migration.name,
      Date.now()
    );
  }
}
