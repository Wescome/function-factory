-- Factory D1 Schema
--
-- Replaces ArangoDB's 48-collection model with two general-purpose tables:
--   documents  — stores any JSON document addressed by (collection, key)
--   edges      — stores directed relationships between documents within a collection
--
-- Both tables use IF NOT EXISTS so the schema is safe to apply idempotently.

CREATE TABLE IF NOT EXISTS documents (
    collection TEXT    NOT NULL,
    key        TEXT    NOT NULL,
    json       TEXT    NOT NULL,
    created_at INTEGER DEFAULT (unixepoch()),
    PRIMARY KEY (collection, key)
);

CREATE TABLE IF NOT EXISTS edges (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    collection TEXT    NOT NULL,
    from_id    TEXT    NOT NULL,
    to_id      TEXT    NOT NULL,
    data       TEXT,
    created_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_documents_collection ON documents(collection);
CREATE INDEX IF NOT EXISTS idx_edges_from           ON edges(collection, from_id);
CREATE INDEX IF NOT EXISTS idx_edges_to             ON edges(collection, to_id);
CREATE INDEX IF NOT EXISTS idx_edges_collection     ON edges(collection);
