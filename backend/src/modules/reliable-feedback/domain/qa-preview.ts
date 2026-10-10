import type { ApplicabilityResolution } from "./applicability-resolution.js"
import { confirmedProductsOf, findingLabelOf, nodeOutputOf, renderPublishedDocument, SECTION_LABELS, type ArtifactReviewState, type FeedbackDocumentPart, type ReliableFeedbackArtifactV1 } from "./reliable-feedback-artifact.js"
import { isEmittableSection, type ItemQaStatus } from "./reliable-feedback-item.js"

/**
 * V1.7.1e — PRÉVIA DO FEEDBACK COMPLETO para o QA ("Eu enviaria isto ao colaborador?").
 *
 * Usa EXATAMENTE o caminho da publicação: `nodeOutputOf` (itens emitíveis, texto final, apresentação validada contra os itens que
 * saem) → `renderPublishedDocument` (o mesmo renderizador do texto publicado no Acompanhamento). A única hipótese é a do QA:
 * itens ainda PENDENTES entram como se fossem aprovados SEM edição — o que o revisor vê é o que o colaborador receberia se ele
 * aprovar; decisões já registradas (edição, rejeição) valem como estão. Nada aqui muda disposição, evidência ou QA.
 *
 * Cada parte do documento diz de quais itens nasceu; cada item traz o estado de QA e o `reviewId` — é assim que a tela liga um
 * bloco do feedback aos detalhes técnicos e navega entre os pontos que ainda aguardam avaliação (a decisão continua por item).
 */
export const QA_FEEDBACK_PREVIEW_VERSION = "QA_FEEDBACK_PREVIEW_V1" as const

export type QaPreviewItemStatus = Exclude<ItemQaStatus, null> | "READY" | "BLOCKED"
export type QaPreviewItem = {
  itemIndex: number
  reviewId: string | null
  label: string
  section: "STRENGTH" | "OPPORTUNITY" | "ATTENTION" | "CONTEXT"
  status: QaPreviewItemStatus
  /** Está no texto da prévia (bloqueado/rejeitado nunca está). */
  inPreview: boolean
}
export type QaFeedbackPreview = {
  version: typeof QA_FEEDBACK_PREVIEW_VERSION
  /** A hipótese da prévia: pendentes como aprovados sem edição. */
  basis: "PENDING_AS_APPROVED_UNCHANGED"
  parts: FeedbackDocumentPart[]
  items: QaPreviewItem[]
  pending: number
}

type ReviewLike = { id: string; itemIndex: number; reviewStatus: Exclude<ItemQaStatus, null>; finalWording: ArtifactReviewState["finalWording"] }

export function buildQaFeedbackPreview(artifactId: string, artifact: ReliableFeedbackArtifactV1, reviews: readonly ReviewLike[]): QaFeedbackPreview {
  const hypothetical: ArtifactReviewState[] = reviews.map((review) => ({ itemIndex: review.itemIndex, status: review.reviewStatus === "PENDING_REVIEW" ? "APPROVED_UNCHANGED" : review.reviewStatus, finalWording: review.finalWording }))
  const output = nodeOutputOf(artifactId, artifact, hypothetical)
  const parts = output.items.length > 0 ? renderPublishedDocument(output.items, output.limitations, { presentation: output.presentation ?? null, confirmedProducts: confirmedProductsOf(artifact.processAssessment?.applicability as ApplicabilityResolution[] | undefined) }) : []
  const emitted = new Set(output.items.map((item) => item.index))
  const items = artifact.items.map((item): QaPreviewItem => {
    const review = reviews.find((entry) => entry.itemIndex === item.index) ?? null
    const status: QaPreviewItemStatus = item.decision.disposition === "BLOCKED" ? "BLOCKED" : review ? review.reviewStatus : item.decision.disposition === "READY" ? "READY" : "PENDING_REVIEW"
    const sectionLabel = isEmittableSection(item.section) ? SECTION_LABELS[item.section] : "Contexto"
    return {
      itemIndex: item.index,
      reviewId: review?.id ?? null,
      label: findingLabelOf({ section: isEmittableSection(item.section) ? item.section : "OPPORTUNITY", process: item.process ?? null, knowledge: item.knowledge ?? null, sectionLabel }),
      section: isEmittableSection(item.section) ? item.section : "CONTEXT",
      status,
      inPreview: emitted.has(item.index),
    }
  })
  return { version: QA_FEEDBACK_PREVIEW_VERSION, basis: "PENDING_AS_APPROVED_UNCHANGED", parts, items, pending: items.filter((item) => item.status === "PENDING_REVIEW").length }
}
