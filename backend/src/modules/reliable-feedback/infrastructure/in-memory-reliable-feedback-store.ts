import type { ProcessObservation } from "../../indicator-diagnosis/domain/process-patterns.js"
import { randomUUID } from "node:crypto"
import type { ArtifactRecord, CompleteArtifact, ReliableFeedbackStore, ReliableReviewRecord } from "../application/ports.js"

/**
 * Store EFÊMERO do feedback confiável — mesmo contrato do Postgres, em memória. Usado pelo QA Lab (simulação: nada é
 * gravado) e pelos testes. `onReactivate` = o que a reativação da matrícula significaria (a simulação/o teste observam).
 */
export function createInMemoryReliableFeedbackStore(options: { onReactivate?: (input: { organizationId: string; enrollmentId: string; nodeId: string }) => boolean } = {}): ReliableFeedbackStore & { artifacts: Map<string, ArtifactRecord & { claimedUntil: Date | null; writerInput: unknown; writerRawOutput: unknown }>; reviews: ReliableReviewRecord[]; observations: (ProcessObservation & { sourceArtifactId: string; displayContext?: unknown })[]; prvDiagnoses: (NonNullable<CompleteArtifact["prvDiagnosis"]> & { organizationId: string; sourceArtifactId: string })[] } {
  const artifacts = new Map<string, ArtifactRecord & { claimedUntil: Date | null; writerInput: unknown; writerRawOutput: unknown }>()
  const reviews: ReliableReviewRecord[] = []
  // V1.6.1 — observações verificadas (em memória: QA Lab/testes nunca gravam no banco). Um status por atendimento × prática.
  const observations: (ProcessObservation & { sourceArtifactId: string; displayContext?: unknown })[] = []
  // INDICATOR DIAGNOSIS V1 — diagnósticos de fechamento (uma linha por chave, como a unique do Postgres).
  const prvDiagnoses: (NonNullable<CompleteArtifact["prvDiagnosis"]> & { organizationId: string; sourceArtifactId: string })[] = []
  const byKey = (organizationId: string, key: string) => [...artifacts.values()].find((row) => row.organizationId === organizationId && row.artifactKey === key)
  return {
    artifacts,
    reviews,
    observations,
    prvDiagnoses,
    async claim(identity, now, leaseSeconds) {
      const existing = byKey(identity.organizationId, identity.artifactKey)
      const leaseUntil = new Date(now.getTime() + leaseSeconds * 1000)
      if (!existing) {
        const id = randomUUID()
        artifacts.set(id, { ...identity, id, status: "PENDING", disposition: null, policyVersion: null, artifact: null, qaResolvedAt: null, createdAt: now, completedAt: null, claimedUntil: leaseUntil, writerInput: null, writerRawOutput: null })
        return { kind: "CLAIMED", artifactId: id }
      }
      if (existing.status === "COMPLETED") return { kind: "COMPLETED", record: { ...existing } }
      if (existing.status === "FAILED" || (existing.claimedUntil !== null && existing.claimedUntil < now)) {
        existing.status = "PENDING"
        existing.claimedUntil = leaseUntil
        return { kind: "CLAIMED", artifactId: existing.id }
      }
      return { kind: "IN_PROGRESS" }
    },
    async complete(organizationId, artifactId, data, now) {
      const row = artifacts.get(artifactId)
      if (!row || row.organizationId !== organizationId || row.status !== "PENDING") throw new Error("posse da geração do feedback perdida (lease expirada) — nada gravado")
      if (data.prvDiagnosis && prvDiagnoses.some((entry) => entry.organizationId === organizationId && entry.idempotencyKey === data.prvDiagnosis!.idempotencyKey)) throw new Error("diagnóstico deste fechamento já gravado (chave de idempotência) — nada gravado")
      if (data.prvDiagnosis) prvDiagnoses.push({ ...data.prvDiagnosis, organizationId, sourceArtifactId: artifactId })
      Object.assign(row, { status: "COMPLETED", disposition: data.disposition, policyVersion: data.policyVersion, artifact: data.artifact, completedAt: now, claimedUntil: null, writerInput: data.writerInput, writerRawOutput: data.writerRawOutput })
      for (const review of data.reviews) {
        reviews.push({ ...review, id: randomUUID(), organizationId, artifactId, reviewStatus: "PENDING_REVIEW", finalWording: null, reasonCategory: null, reviewerComment: null, editWarnings: [], reviewedBy: null, reviewedAt: null, createdAt: now })
      }
      for (const observation of data.observations ?? []) {
        const existing = observations.findIndex((entry) => entry.interactionId === observation.interactionId && entry.practiceKey === observation.practiceKey)
        if (existing >= 0) observations.splice(existing, 1)
        observations.push({ ...observation, sourceArtifactId: artifactId })
      }
      return { ...row }
    },
    async fail(organizationId, artifactId) {
      const row = artifacts.get(artifactId)
      if (row && row.organizationId === organizationId && row.status === "PENDING") Object.assign(row, { status: "FAILED", claimedUntil: null })
    },
    async get(organizationId, artifactId) {
      const row = artifacts.get(artifactId)
      return row && row.organizationId === organizationId ? { ...row } : null
    },
    async listReviews(organizationId, artifactId) {
      return reviews.filter((review) => review.organizationId === organizationId && review.artifactId === artifactId).sort((a, b) => a.itemIndex - b.itemIndex).map((review) => ({ ...review }))
    },
    async getReview(organizationId, reviewId) {
      const review = reviews.find((entry) => entry.organizationId === organizationId && entry.id === reviewId)
      return review ? { ...review } : null
    },
    async decideReview(organizationId, reviewId, decision, resolve) {
      const review = reviews.find((entry) => entry.organizationId === organizationId && entry.id === reviewId)
      if (!review || review.reviewStatus !== "PENDING_REVIEW") return { written: false }
      Object.assign(review, { reviewStatus: decision.status, finalWording: decision.finalWording, reasonCategory: decision.reasonCategory, reviewerComment: decision.comment, editWarnings: decision.editWarnings, reviewedBy: decision.reviewedBy, reviewedAt: decision.reviewedAt })
      const artifact = artifacts.get(review.artifactId)!
      const own = reviews.filter((entry) => entry.artifactId === review.artifactId)
      if (own.some((entry) => entry.reviewStatus === "PENDING_REVIEW") || artifact.qaResolvedAt !== null || !artifact.artifact) return { written: true, resolution: null }
      const disposition = resolve(artifact.artifact, own)
      Object.assign(artifact, { disposition, qaResolvedAt: decision.reviewedAt })
      const reactivated = artifact.enrollmentId ? options.onReactivate?.({ organizationId, enrollmentId: artifact.enrollmentId, nodeId: artifact.nodeId }) ?? false : false
      return { written: true, resolution: { disposition, reactivated } }
    },
  }
}
