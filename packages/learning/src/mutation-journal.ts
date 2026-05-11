import {
  MutationJournalEntry,
  type MutationJournalEntry as MutationJournalEntryType,
} from "./types.js"
import { stableHash } from "./storage-keys.js"

export function buildMutationJournalEntry(
  input: Omit<MutationJournalEntryType, "_key">,
): MutationJournalEntryType {
  const key = `mutation-${stableHash({
    mutation_batch_id: input.mutation_batch_id,
    affected_collection: input.affected_collection,
    affected_key: input.affected_key,
    after_image: input.after_image,
  })}`
  return MutationJournalEntry.parse({
    _key: key,
    ...input,
  })
}
