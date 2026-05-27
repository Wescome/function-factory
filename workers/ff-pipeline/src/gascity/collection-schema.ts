interface GasCityCollectionDb {
  ensureCollection(collection: string, options?: { type?: "document" | "edge" }): Promise<void>
  ensureIndex?(
    collection: string,
    options: {
      type: "hash" | "persistent" | "skiplist"
      fields: string[]
      unique?: boolean
      sparse?: boolean
      name?: string
    },
  ): Promise<void>
}

const GAS_CITY_COLLECTIONS = [
  { name: "completion_events", type: "document" as const },
  { name: "fidelity_verdicts", type: "document" as const },
  { name: "lifecycle_transitions", type: "edge" as const },
  { name: "webhook_rejections", type: "document" as const },
]

const GAS_CITY_INDEXES = [
  {
    collection: "completion_events",
    type: "hash" as const,
    fields: ["bead_id"],
    unique: true,
    name: "idx_completion_events_bead_id",
  },
  {
    collection: "completion_events",
    type: "hash" as const,
    fields: ["fn_id", "factory_attempt"],
    name: "idx_completion_events_fn_attempt",
  },
  {
    collection: "fidelity_verdicts",
    type: "hash" as const,
    fields: ["bead_id"],
    name: "idx_fidelity_verdicts_bead_id",
  },
  {
    collection: "fidelity_verdicts",
    type: "hash" as const,
    fields: ["function_id", "overall"],
    name: "idx_fidelity_verdicts_function_overall",
  },
  {
    collection: "lifecycle_transitions",
    type: "hash" as const,
    fields: ["_from"],
    name: "idx_lifecycle_transitions_from",
  },
  {
    collection: "lifecycle_transitions",
    type: "skiplist" as const,
    fields: ["timestamp"],
    name: "idx_lifecycle_transitions_timestamp",
  },
  {
    collection: "webhook_rejections",
    type: "skiplist" as const,
    fields: ["received_at"],
    name: "idx_webhook_rejections_received_at",
  },
  {
    collection: "webhook_rejections",
    type: "hash" as const,
    fields: ["reason"],
    name: "idx_webhook_rejections_reason",
  },
]

export async function ensureGasCityCollections(db: GasCityCollectionDb): Promise<void> {
  for (const collection of GAS_CITY_COLLECTIONS) {
    await db.ensureCollection(collection.name, { type: collection.type })
  }

  if (!db.ensureIndex) return
  for (const index of GAS_CITY_INDEXES) {
    await db.ensureIndex(index.collection, index)
  }
}
