import type { InteractionFeedbackItem, InteractionFeedbackV1 } from "../../investigation/domain/interaction-feedback.js"
import type { InteractionFindingKind } from "../../investigation/domain/interaction-semantic-frame.js"

/**
 * V1.5.0 — ANALYTICS ESTRUTURAL (nunca derivado do texto do redator).
 *
 * OperationalIssueOccurrence = o PROBLEMA observado numa interação, com dono = operador (ownership AGENT, polaridade
 * negativa, seção OPPORTUNITY) — atrito, informação inconsistente, necessidade não resolvida atribuída, divergência
 * procedimental. Registrado mesmo quando o item não pode ser comunicado (bloqueio procedimental ou evidência exibível
 * insuficiente), com o status de entrega, para "o que aconteceu" nunca depender de "o que foi dito".
 * KnowledgeRecommendation = material da base RELACIONADO ao problema (hoje: a regra da divergência procedimental, com o
 * link canônico da KB). "Material identificado internamente" ≠ "material recomendado ao operador": o status de entrega diz qual.
 */
export const ISSUE_CATEGORY_BY_KIND: Partial<Record<InteractionFindingKind, IssueCategory>> = {
  FRICTION: "COMMUNICATION_FRICTION",
  CONTRADICTION: "INCONSISTENT_INFORMATION",
  UNRESOLVED_NEED: "UNRESOLVED_CUSTOMER_NEED",
  PROCEDURAL_DIVERGENCE: "PROCEDURAL_DIVERGENCE",
}
export type IssueCategory = "COMMUNICATION_FRICTION" | "INCONSISTENT_INFORMATION" | "UNRESOLVED_CUSTOMER_NEED" | "PROCEDURAL_DIVERGENCE"
export type IssueDeliveryStatus = "ELIGIBLE_PENDING_REVIEW" | "BLOCKED_PROCEDURAL_MATCHING" | "INSUFFICIENT_DISPLAY_EVIDENCE"

export type OperationalIssueOccurrenceDraft = {
  /** Posição do item no feedback — liga a ocorrência ao item comunicado (quando houver) sem fundir os objetos. */
  itemIndex: number
  findingKind: InteractionFindingKind
  issueCategory: IssueCategory
  structuralPolarity: string
  ownership: string
  scope: string
  evidenceRefs: { turnRef: string; rawSha256: string; displayed: boolean }[]
  findingRefs: string[]
  deliveryStatus: IssueDeliveryStatus
}

export type KnowledgeRecommendationDraft = {
  itemIndex: number
  knowledgeBaseId: string | null
  documentId: string | null
  documentTitle: string
  ruleRef: string
  href: string | null
  recommendationReason: string
  recommendationType: "PROCEDURAL_RULE"
  deliveryStatus: "BLOCKED_PROCEDURAL_MATCHING" | "PENDING_REVIEW"
  reviewStatus: "NOT_REVIEWED"
}

const deliveryStatusOf = (item: InteractionFeedbackItem): IssueDeliveryStatus => (item.delivery.blocked === "PROCEDURAL_MATCHING_NOT_VALIDATED" ? "BLOCKED_PROCEDURAL_MATCHING" : item.delivery.blocked === "INSUFFICIENT_DISPLAY_EVIDENCE" ? "INSUFFICIENT_DISPLAY_EVIDENCE" : "ELIGIBLE_PENDING_REVIEW")

/** Ocorrências + recomendações de UM feedback — só estrutura (kind, dono, polaridade, escopo, evidência, lineage). */
export function buildOperationalAnalytics(feedback: InteractionFeedbackV1): { occurrences: OperationalIssueOccurrenceDraft[]; recommendations: KnowledgeRecommendationDraft[] } {
  const occurrences: OperationalIssueOccurrenceDraft[] = []
  const recommendations: KnowledgeRecommendationDraft[] = []
  feedback.items.forEach((item, itemIndex) => {
    const category = ISSUE_CATEGORY_BY_KIND[item.interpretation.kind]
    if (item.section !== "OPPORTUNITY" || item.interpretation.ownership !== "AGENT" || item.interpretation.polarity !== "NEGATIVE" || !category) return
    occurrences.push({
      itemIndex,
      findingKind: item.interpretation.kind,
      issueCategory: category,
      structuralPolarity: item.interpretation.polarity,
      ownership: item.interpretation.ownership,
      scope: item.interpretation.scope,
      evidenceRefs: item.displayEvidence.map((entry) => ({ turnRef: entry.origin.turnRef, rawSha256: entry.origin.rawSha256, displayed: entry.status === "DISPLAYED" })),
      findingRefs: [item.provenance.findingRef, ...item.provenance.collapsedFindings.map((collapsed) => collapsed.findingRef)],
      deliveryStatus: deliveryStatusOf(item),
    })
    const lineage = item.provenance.proceduralLineage
    const knowledge = item.guidance.knowledge
    if (item.interpretation.kind === "PROCEDURAL_DIVERGENCE" && lineage && knowledge) {
      recommendations.push({
        itemIndex,
        knowledgeBaseId: null,
        documentId: lineage.documentId,
        documentTitle: lineage.documentTitle,
        ruleRef: lineage.ruleRef,
        href: knowledge.href,
        recommendationReason: "PROCEDURAL_DIVERGENCE_AGAINST_VERIFIED_RULE",
        recommendationType: "PROCEDURAL_RULE",
        deliveryStatus: item.delivery.blocked === "PROCEDURAL_MATCHING_NOT_VALIDATED" ? "BLOCKED_PROCEDURAL_MATCHING" : "PENDING_REVIEW",
        reviewStatus: "NOT_REVIEWED",
      })
    }
  })
  return { occurrences, recommendations }
}
