export interface Env {
  /** CoordinatorDO — per-run bead DAG (ff-pipeline) */
  COORDINATOR_DO: DurableObjectNamespace
  /** FactoryArtifactGraphDO — per-repo governance graph (ff-pipeline) */
  ARTIFACT_GRAPH: DurableObjectNamespace
  /** D1: factory-artifacts — artifact rows */
  DB: D1Database
  /** D1: factory-ops — session_state, bead_audit */
  FACTORY_OPS_DB: D1Database
  /** R2: artifact blob storage */
  ARTIFACT_BLOBS: R2Bucket
  /** SubscriptionEventBufferDO — per-session live fan-out */
  SUB_BUFFER: DurableObjectNamespace
  /** KV: subscription buffer liveness shadows */
  SUB_BUFFER_KV: KVNamespace
}
