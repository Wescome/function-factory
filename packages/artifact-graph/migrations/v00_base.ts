export const v00Base = {
  version: 0,
  name: 'v00_artifact_graph_base',
  sql: `
    CREATE TABLE nodes (
      id      TEXT    PRIMARY KEY,
      type    TEXT    NOT NULL,
      data    TEXT    NOT NULL DEFAULT '{}',
      ns      TEXT    NOT NULL,
      created INTEGER NOT NULL,
      updated INTEGER NOT NULL
    );

    CREATE TABLE edges (
      id      TEXT    PRIMARY KEY,
      source  TEXT    NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      target  TEXT    NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      rel     TEXT    NOT NULL,
      props   TEXT    NOT NULL DEFAULT '{}',
      created INTEGER NOT NULL,
      UNIQUE(source, target, rel)
    );

    CREATE INDEX idx_nodes_ns_type    ON nodes(ns, type);
    CREATE INDEX idx_nodes_ns_created ON nodes(ns, created DESC);
    CREATE INDEX idx_edges_source     ON edges(source);
    CREATE INDEX idx_edges_target     ON edges(target);
    CREATE INDEX idx_edges_rel        ON edges(rel);
    CREATE INDEX idx_edges_src_rel    ON edges(source, rel);
    CREATE INDEX idx_edges_tgt_rel    ON edges(target, rel);
  `,
};
