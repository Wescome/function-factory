import {
  TemplateCandidate,
  type RunTranscript,
  type TemplateCandidate as TemplateCandidateType,
} from "./types.js"
import { templateCandidateKey } from "./storage-keys.js"

export interface DetectTemplateCandidateOptions {
  minEvidenceRuns?: number
  createdAt: string
}

export function detectTemplateCandidates(
  transcripts: readonly RunTranscript[],
  options: DetectTemplateCandidateOptions,
): TemplateCandidateType[] {
  const minEvidenceRuns = options.minEvidenceRuns ?? 3
  const groups = new Map<string, RunTranscript[]>()

  for (const transcript of transcripts) {
    if (
      transcript.final_verdict.status !== "synthesis-passed"
      || transcript.repair_count !== 0
      || !transcript.executable_specification_id
    ) {
      continue
    }
    const group = groups.get(transcript.executable_specification_id) ?? []
    group.push(transcript)
    groups.set(transcript.executable_specification_id, group)
  }

  return [...groups.entries()]
    .filter(([, group]) => group.length >= minEvidenceRuns)
    .map(([executableSpecificationId, group]) => {
      const sourceRefs = [...new Set(group.flatMap((transcript) => transcript.source_refs))].sort()
      const templateCandidateId = templateCandidateKey({
        executableSpecificationId,
        sourceRefs,
      })
      return TemplateCandidate.parse({
        _key: templateCandidateId,
        template_candidate_id: templateCandidateId,
        state: "candidate",
        executable_specification_id: executableSpecificationId,
        evidence_run_ids: group.map((transcript) => transcript.run_id).sort(),
        evidence_summary: `${group.length} zero-repair successful runs share ${executableSpecificationId}.`,
        explicitness: "inferred",
        rationale: "Template candidate derived from repeated zero-repair successful transcripts.",
        source_refs: sourceRefs,
        created_at: options.createdAt,
      })
    })
}
