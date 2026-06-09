import { Container } from "@cloudflare/containers";
import type { StopParams } from "@cloudflare/containers";

// ---------------------------------------------------------------------------
// Full pipeline schema
// ---------------------------------------------------------------------------

const DOC_COLLECTIONS = [
  "execution_packets",
  "verification_reports",
  "specs_signals",
  "specs_pressures",
  "specs_capabilities",
  "specs_functions",
  "intent_specifications",
  "executable_specifications",
  "specs_invariants",
  "specs_critic_reviews",
  "verification_status",
  "trust_scores",
  "invariant_health",
  "memory_episodic",
  "memory_semantic",
  "memory_working",
  "memory_personal",
  "function_runs",
  "execution_artifacts",
  "mentorscript_rules",
  "consultation_requests",
  "version_controlled_resolutions",
  "merge_readiness_packs",
  "merge_readiness_evidence",
  "trellis_execution_packets",
  "lifecycle_transitions",
  "hot_config",
  "config_aliases",
  "config_routing",
  "config_model_capabilities",
  "orl_telemetry",
  "intent_anchors",
  "compilation_drift_ledger",
  "completion_ledgers",
  "file_context_cache",
  "learning_run_transcripts",
  "learning_observations",
  "learning_template_candidates",
  "learning_template_usage",
  "learning_routing_observations",
  "learning_consolidation_reports",
  "learning_mutation_journal",
  "learning_routing_proposals",
  "learning_template_promotion_requests",
  "elucidation_artifacts",
  "skeleton_manifests",
] as const;

// type 3 = edge collection in ArangoDB
const EDGE_COLLECTIONS = [
  "lineage_edges",
  "assurance_edges",
  "dependency_edges",
] as const;

const DB_NAME = "function_factory";
const BASE = "http://localhost:8529";

// ---------------------------------------------------------------------------
// Env interface
// ---------------------------------------------------------------------------

interface Env {
  ARANGO_STORE: DurableObjectNamespace;
  ARANGO_ROOT_PASSWORD: string;
  ARANGO_BACKUP: R2Bucket;
}

// ---------------------------------------------------------------------------
// ArangoStore Container
// ---------------------------------------------------------------------------

export class ArangoStore extends Container<Env> {
  defaultPort = 8529;
  sleepAfter = "30m";
  enableInternet = true;

  private initialized = false;
  private restored = false;

  override async fetch(request: Request): Promise<Response> {
    if (!this.initialized) {
      await this.ensureDatabase();
      if (!this.restored) {
        await this.restoreFromR2();
        this.restored = true;
      }
      this.initialized = true;
    }

    const url = new URL(request.url);
    url.protocol = "http:";
    url.hostname = "localhost";
    url.port = "8529";

    const headers = new Headers(request.headers);
    headers.delete("Authorization"); // ArangoDB runs with ARANGO_NO_AUTH=1

    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    const forwarded = new Request(url.toString(), {
      method: request.method,
      headers,
      body: hasBody ? request.body : undefined,
    });

    return this.containerFetch(forwarded, 8529);
  }

  override async onStop(_params: StopParams): Promise<void> {
    this.initialized = false;
    this.restored = false;
    await this.backupToR2();
  }

  // -------------------------------------------------------------------------
  // ensureDatabase — visible errors on collection creation failures
  // -------------------------------------------------------------------------

  private async ensureDatabase(): Promise<void> {
    // Create the database (ignore 409 conflict = already exists)
    const dbRes = await this.containerFetch(
      new Request(`${BASE}/_api/database`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: DB_NAME }),
      }),
      8529,
    );
    if (!dbRes.ok && dbRes.status !== 409) {
      const body = await dbRes.text();
      throw new Error(`[arango-store] Failed to create database: ${dbRes.status} ${body}`);
    }

    // Doc collections
    for (const col of DOC_COLLECTIONS) {
      await this.ensureCollection(col, 2);
    }

    // Edge collections (type 3)
    for (const col of EDGE_COLLECTIONS) {
      await this.ensureCollection(col, 3);
    }

    console.log(
      `[arango-store] DB + ${DOC_COLLECTIONS.length} doc + ${EDGE_COLLECTIONS.length} edge collections ensured`,
    );
  }

  private async ensureCollection(name: string, type: 2 | 3): Promise<void> {
    const res = await this.containerFetch(
      new Request(`${BASE}/_db/${DB_NAME}/_api/collection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, type }),
      }),
      8529,
    );
    if (!res.ok && res.status !== 409) {
      const body = await res.text();
      throw new Error(
        `[arango-store] Failed to create collection "${name}" (type ${type}): ${res.status} ${body}`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // R2 backup
  // -------------------------------------------------------------------------

  private async backupToR2(): Promise<void> {
    const env = this.env;
    if (!env?.ARANGO_BACKUP) {
      console.warn("[arango-store] ARANGO_BACKUP binding not available, skipping backup");
      return;
    }

    for (const col of DOC_COLLECTIONS) {
      const docs = await this.fetchAllDocs(col);
      await env.ARANGO_BACKUP.put(
        `backup/${col}.json`,
        JSON.stringify(docs),
      );
    }

    for (const col of EDGE_COLLECTIONS) {
      const docs = await this.fetchAllDocs(col);
      await env.ARANGO_BACKUP.put(
        `backup/${col}.json`,
        JSON.stringify(docs),
      );
    }

    await env.ARANGO_BACKUP.put(
      "backup/meta.json",
      JSON.stringify({
        collections: [...DOC_COLLECTIONS],
        edgeCollections: [...EDGE_COLLECTIONS],
        backedUpAt: new Date().toISOString(),
      }),
    );

    console.log(
      `[arango-store] backed up ${DOC_COLLECTIONS.length} doc + ${EDGE_COLLECTIONS.length} edge collections to R2`,
    );
  }

  /** Fetch all documents from a collection, handling AQL cursor pagination. */
  private async fetchAllDocs(collection: string): Promise<unknown[]> {
    const docs: unknown[] = [];

    // Open cursor
    const initRes = await this.containerFetch(
      new Request(`${BASE}/_db/${DB_NAME}/_api/cursor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: `FOR doc IN ${collection} RETURN doc`,
          batchSize: 1000,
        }),
      }),
      8529,
    );

    if (!initRes.ok) {
      // Collection may not exist yet; log and return empty
      console.warn(
        `[arango-store] cursor open failed for "${collection}": ${initRes.status}`,
      );
      return docs;
    }

    let cursor: { result: unknown[]; hasMore: boolean; id?: string } =
      await initRes.json();
    docs.push(...cursor.result);

    while (cursor.hasMore && cursor.id) {
      const nextRes = await this.containerFetch(
        new Request(`${BASE}/_db/${DB_NAME}/_api/cursor/${cursor.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
        }),
        8529,
      );
      if (!nextRes.ok) break;
      cursor = await nextRes.json();
      docs.push(...cursor.result);
    }

    return docs;
  }

  // -------------------------------------------------------------------------
  // R2 restore
  // -------------------------------------------------------------------------

  private async restoreFromR2(): Promise<boolean> {
    const env = this.env;
    if (!env?.ARANGO_BACKUP) {
      console.warn("[arango-store] ARANGO_BACKUP binding not available, skipping restore");
      return false;
    }

    const metaObj = await env.ARANGO_BACKUP.get("backup/meta.json");
    if (!metaObj) {
      // Fresh start — no backup yet
      return false;
    }

    const meta: { collections: string[]; edgeCollections: string[] } =
      await metaObj.json();

    let restoredCount = 0;

    for (const col of [...meta.collections, ...meta.edgeCollections]) {
      const obj = await env.ARANGO_BACKUP.get(`backup/${col}.json`);
      if (!obj) continue;

      const docs: unknown[] = await obj.json();
      if (docs.length === 0) continue;

      const insertRes = await this.containerFetch(
        new Request(
          `${BASE}/_db/${DB_NAME}/_api/document/${col}?overwriteMode=replace`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(docs),
          },
        ),
        8529,
      );

      if (!insertRes.ok) {
        const body = await insertRes.text();
        console.warn(
          `[arango-store] restore failed for "${col}": ${insertRes.status} ${body}`,
        );
      } else {
        restoredCount++;
      }
    }

    console.log(`[arango-store] restored ${restoredCount} collections from R2 backup`);
    return true;
  }
}

// ---------------------------------------------------------------------------
// Worker default export — validates Basic Auth before routing to the DO
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const authHeader = request.headers.get("Authorization") ?? "";
    if (authHeader.startsWith("Basic ")) {
      const decoded = atob(authHeader.slice(6));
      const colonIdx = decoded.indexOf(":");
      const username = decoded.slice(0, colonIdx);
      const password = decoded.slice(colonIdx + 1);
      if (username === "root" && password === env.ARANGO_ROOT_PASSWORD) {
        const id = env.ARANGO_STORE.idFromName("singleton");
        const stub = env.ARANGO_STORE.get(id);
        return stub.fetch(request);
      }
    }
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  },
};
