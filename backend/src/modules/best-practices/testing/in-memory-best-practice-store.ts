import { randomUUID } from "node:crypto"
import { reuseKeyOf, type AnalysisCompletion, type AnalysisWrite, type BestPracticeStore, type CodingRecord, type KnownPattern, type ModelMode, type PatternScope, type PatternWrite, type ReusableCoding } from "../application/ports.js"
import type { ReviewStatus, StoredObligationStatus } from "../domain/pattern.js"

/** Armazenamento em memória com a MESMA semântica do Postgres (testes de mecanismo; nenhum banco). */
export type MemoryPattern = KnownPattern & { scope: PatternScope; currentStrength: string; versions: { analysisId: string; write: PatternWrite }[]; reviews: { action: string; note: string }[] }

export function createInMemoryBestPracticeStore() {
  const patterns: MemoryPattern[] = []
  const codings: (CodingRecord & { analysisId: string; modelMode: ModelMode })[] = []
  const modes = new Map<string, ModelMode>()
  const completions = new Map<string, AnalysisCompletion>()
  const store: BestPracticeStore & { patterns: MemoryPattern[]; codings: typeof codings; setMode(analysisId: string, mode: ModelMode): void; review(patternId: string, status: ReviewStatus): void } = {
    patterns,
    codings,
    setMode(analysisId, mode) {
      modes.set(analysisId, mode)
    },
    review(patternId, status) {
      const pattern = patterns.find((item) => item.id === patternId)
      if (pattern) pattern.reviewStatus = status
    },
    async knownPatterns(scope) {
      return patterns
        .filter((pattern) => JSON.stringify(pattern.scope) === JSON.stringify(scope))
        .map((pattern): KnownPattern => ({ id: pattern.id, name: pattern.name, description: pattern.description, observableDefinition: pattern.observableDefinition, appliesWhen: pattern.appliesWhen, notApplicableWhen: pattern.notApplicableWhen, guidance: pattern.guidance, suggestedPhrasing: pattern.suggestedPhrasing, phrasingContexts: pattern.phrasingContexts, reviewStatus: pattern.reviewStatus, obligationStatus: pattern.obligationStatus, obligationConfirmedByReview: pattern.obligationConfirmedByReview }))
    },
    async reusableCodings(_organizationId, analysisId, modelMode, keys) {
      const wanted = new Set(keys.map(reuseKeyOf))
      const out = new Map<string, ReusableCoding>()
      for (const coding of [...codings].reverse()) {
        if (coding.analysisId === analysisId || coding.modelMode !== modelMode || !coding.transcriptChecksum) continue
        const definitive = ["PRESENT", "ABSENT", "NOT_APPLICABLE"].includes(coding.status) || coding.unclearReason === "MODEL_UNCLEAR"
        if (!definitive || (coding.status === "PRESENT" && !coding.quoteVerified)) continue
        const key = reuseKeyOf({ callRef: coding.callRef, definitionHash: coding.definitionHash, transcriptChecksum: coding.transcriptChecksum })
        if (wanted.has(key) && !out.has(key)) out.set(key, { status: coding.status, turnRef: coding.turnRef, quote: coding.quote, quoteVerified: coding.quoteVerified, unclearReason: coding.unclearReason, analysisId: coding.analysisId })
      }
      return out
    },
    async saveAnalysis(scope, analysisId, write: AnalysisWrite, _now, complete) {
      const mode = modes.get(analysisId) ?? "SIMULATED_ANSWER_KEY"
      for (const coding of write.codings) codings.push({ ...coding, analysisId, modelMode: mode })
      const created: string[] = []
      const updated: string[] = []
      for (const entry of write.patterns) {
        let pattern = entry.patternId ? patterns.find((item) => item.id === entry.patternId) : undefined
        if (!pattern) {
          const candidate = entry.candidate
          pattern = { id: randomUUID(), scope, name: candidate.name, description: candidate.description, observableDefinition: candidate.observableDefinition, appliesWhen: candidate.appliesWhen, notApplicableWhen: candidate.notApplicableWhen, guidance: candidate.guidance, suggestedPhrasing: candidate.suggestedPhrasing, phrasingContexts: candidate.phrasingContexts ?? null, reviewStatus: "PENDING_REVIEW", obligationStatus: entry.obligationStatus, obligationConfirmedByReview: false, currentStrength: entry.strength, versions: [], reviews: [] }
          patterns.push(pattern)
          created.push(pattern.id)
        } else updated.push(pattern.id)
        pattern.obligationStatus = entry.obligationStatus as StoredObligationStatus
        if (entry.resetObligationConfirmation) pattern.obligationConfirmedByReview = false
        pattern.currentStrength = entry.strength
        pattern.versions.push({ analysisId, write: entry })
        pattern.reviews.push({ action: "ANALYSIS_UPDATE", note: entry.updateNote })
      }
      const completion = complete({ created, updated })
      completions.set(analysisId, completion)
      return { created, updated, completion }
    },
  }
  return store
}
