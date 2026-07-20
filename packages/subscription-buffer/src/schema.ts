/**
 * @factory/subscription-buffer — schema
 *
 * DO SQLite DDL for the SubscriptionEventBuffer DO.
 * Spec: Factory GraphQL Subscription Replay Contract v1 §2.2
 */

const CREATE_BUFFERED_EVENTS = `
  CREATE TABLE IF NOT EXISTS buffered_events (
    seq               INTEGER PRIMARY KEY,
    stream            TEXT    NOT NULL,
    kind              TEXT    NOT NULL,
    scope_run_id      TEXT,
    scope_assembly_id TEXT,
    payload           TEXT    NOT NULL,
    occurred_at       INTEGER NOT NULL,
    appended_at       INTEGER NOT NULL,
    terminal          INTEGER NOT NULL DEFAULT 0
  )
`

const CREATE_IDX_BUFFERED_STREAM = `
  CREATE INDEX IF NOT EXISTS idx_buffered_stream ON buffered_events (stream, seq)
`

const CREATE_BUFFER_META = `
  CREATE TABLE IF NOT EXISTS buffer_meta (
    id                  INTEGER PRIMARY KEY CHECK (id = 0),
    session_id          TEXT    NOT NULL,
    run_id              TEXT,
    assembly_id         TEXT,
    next_seq            INTEGER NOT NULL DEFAULT 1,
    last_write_at       INTEGER NOT NULL,
    terminal_at         INTEGER,
    producer_token_hash TEXT
  )
`

/** Run all CREATE TABLE IF NOT EXISTS and index statements. */
export function initSchema(sql: SqlStorage): void {
  sql.exec(CREATE_BUFFERED_EVENTS)
  sql.exec(CREATE_IDX_BUFFERED_STREAM)
  sql.exec(CREATE_BUFFER_META)
}
