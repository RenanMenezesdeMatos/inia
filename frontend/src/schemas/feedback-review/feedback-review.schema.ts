import { z } from "zod"

/** Espelho de backend/src/modules/interaction-feedback/domain/review-view.ts (V1.5.4 → V1.5.5 — QA de qualidade do feedback). */
export const feedbackReviewStatusSchema = z.enum(["PENDING_REVIEW", "APPROVED_UNCHANGED", "APPROVED_EDITED", "REJECTED"])
export type FeedbackReviewStatus = z.infer<typeof feedbackReviewStatusSchema>
export const feedbackReviewDecisionSchema = z.enum(["APPROVED_UNCHANGED", "APPROVED_EDITED", "REJECTED"])
export type FeedbackReviewDecision = z.infer<typeof feedbackReviewDecisionSchema>
export const feedbackSectionSchema = z.enum(["STRENGTH", "OPPORTUNITY"])

/** V1.7.1a — `suggestedResponse` = exemplo de condução (só no feedback confiável; ausente/"" = sem exemplo). */
export const itemWordingSchema = z.object({ observed: z.string(), whyItMatters: z.string(), whatYouCanDo: z.string(), suggestedResponse: z.string().optional() })
export type ItemWording = z.infer<typeof itemWordingSchema>
export type WordingFieldKey = "observed" | "whyItMatters" | "whatYouCanDo"

const namedSchema = z.object({ id: z.string(), name: z.string() })

export const feedbackReviewQueueItemSchema = z.object({
  reviewId: z.string(),
  status: feedbackReviewStatusSchema,
  statusLabel: z.string(),
  collaborator: namedSchema,
  team: namedSchema.nullable(),
  interactionLabel: z.string(),
  occurredAt: z.string().nullable(),
  createdAt: z.string(),
  section: feedbackSectionSchema,
  sectionLabel: z.string(),
  kindLabel: z.string(),
  isFallback: z.boolean(),
  reviewedAt: z.string().nullable(),
})
export type FeedbackReviewQueueItem = z.infer<typeof feedbackReviewQueueItemSchema>

export const feedbackReviewPageSchema = z.object({
  items: z.array(feedbackReviewQueueItemSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  filterOptions: z.object({ collaborators: z.array(namedSchema), teams: z.array(namedSchema) }),
})
export type FeedbackReviewPage = z.infer<typeof feedbackReviewPageSchema>

const violationSchema = z.object({ code: z.string(), message: z.string() })
export type EditViolation = z.infer<typeof violationSchema>

const technicalSchema = z.object({
  internalStep: z.string().nullable(),
  requirement: z.string().nullable(),
  evidenceTypeLabel: z.string().nullable(),
  facts: z.array(z.object({ speakerLabel: z.string(), text: z.string(), truncated: z.boolean(), masked: z.boolean() })),
  knowledge: z
    .object({
      documentTitle: z.string(),
      href: z.string(),
      section: z.string().nullable(),
      version: z.number().nullable(),
      quote: z.string(),
      kindLabel: z.string(),
      detail: z.object({ quote: z.string(), section: z.string().nullable(), kindLabel: z.string() }).nullable(),
      operativeRule: z.object({ quote: z.string(), reason: z.string().nullable() }).nullable(),
      applicabilityLabel: z.string(),
    })
    .nullable(),
  reliability: z.object({ dispositionLabel: z.string(), reasons: z.array(z.string()) }),
  wordingSourceLabel: z.string().nullable(),
  validationWarnings: z.array(z.string()),
  /** V1.7.1h — campos do redator removidos/substituídos (ausente em respostas anteriores). */
  fieldValidation: z.array(z.object({ field: z.string(), action: z.string(), reasons: z.array(z.string()) })).optional(),
  /** V1.7.1j — etapa composta: completude e subitens (ausente em respostas anteriores). */
  completeness: z.object({ statusLabel: z.string(), groups: z.array(z.object({ label: z.string(), items: z.array(z.string()) })) }).nullable().optional(),
  /** V1.7.1k — prontidão analítica da observação desta etapa (só detalhes técnicos). */
  analyticReadiness: z.object({ statusLabel: z.string(), reasons: z.array(z.string()), eligibleLabel: z.string() }).nullable().optional(),
})
export type FeedbackPreviewTechnical = z.infer<typeof technicalSchema>
export const feedbackPreviewSchema = z.object({
  version: z.string(),
  basisLabel: z.string(),
  parts: z.array(z.object({ kind: z.enum(["GREETING", "INTRODUCTION", "OVERVIEW", "GROUP", "FINDING", "MATERIALS", "LIMITATIONS", "CLOSING"]), markdown: z.string(), itemIndexes: z.array(z.number()), label: z.string().nullable(), section: z.string().nullable() })),
  pending: z.number(),
  currentItemIndex: z.number(),
  items: z.array(z.object({ itemIndex: z.number(), reviewId: z.string().nullable(), label: z.string(), sectionLabel: z.string(), status: z.string(), statusLabel: z.string(), inPreview: z.boolean(), isCurrent: z.boolean(), technical: technicalSchema })),
})
export type FeedbackPreview = z.infer<typeof feedbackPreviewSchema>

export const feedbackReviewDetailSchema = feedbackReviewQueueItemSchema.extend({
  collaborator: namedSchema.extend({ jobTitle: z.string().nullable() }),
  meaning: z.string(),
  guidanceLabel: z.string(),
  uncertainty: z.string(),
  evidence: z.array(z.object({ speakerLabel: z.string(), text: z.string(), truncated: z.boolean(), masked: z.boolean() })),
  evidenceWithheldCount: z.number(),
  proposedWording: itemWordingSchema,
  proposedIsFallback: z.boolean(),
  finalWording: itemWordingSchema.nullable(),
  decision: z
    .object({ status: feedbackReviewStatusSchema, statusLabel: z.string(), reviewerName: z.string().nullable(), reviewedAt: z.string().nullable(), reasonCategory: z.string().nullable(), reasonLabel: z.string().nullable(), comment: z.string().nullable(), editWarnings: z.array(violationSchema) })
    .nullable(),
  /** Por que o item está no QA (política + motivos, só rótulos) — a avaliação nunca muda isso. */
  selection: z.object({ disposition: z.enum(["AUTO_DELIVER", "HOLD_FOR_QA", "BLOCKED"]), dispositionLabel: z.string(), structurallyDeliverable: z.boolean(), policyLabel: z.string(), reasons: z.array(z.string()), /** V1.7.1e — o motivo em linguagem humana (o que a tela mostra primeiro). */ explanations: z.array(z.string()).default([]) }),
  /** V1.7.1e — o que está sendo avaliado e o efeito real de cada decisão (semântica do backend, por origem). */
  decisionEffects: z.object({ summary: z.string(), approve: z.string(), edit: z.string(), reject: z.string() }).optional(),
  /** Estrutura × QA × entrega real (regra única do backend). */
  deliveryState: z.enum(["BLOCKED", "AWAITING_QA", "QA_REJECTED", "READY_FOR_DELIVERY", "DELIVERED"]),
  deliveryStateLabel: z.string(),
  knowledgeRecommendations: z.array(z.object({ documentTitle: z.string(), href: z.string().nullable(), status: z.string(), statusLabel: z.string(), reason: z.string(), readyForOperator: z.boolean() })),
  /** V1.5.12: WORKFLOW = item do feedback confiável (campos de relevância/orientação opcionais). */
  origin: z.enum(["INTERACTION", "WORKFLOW"]).optional(),
  /** V1.6.0 — a etapa de processo e a regra da base (trecho literal verificado) que sustentam o item. */
  processBasis: z
    .object({
      requirement: z.string().nullable(),
      statusLabel: z.string().nullable(),
      documentTitle: z.string(),
      quote: z.string(),
      href: z.string(),
      applicability: z.enum(["VERIFIED", "LITERAL_ONLY"]),
      applicabilityLabel: z.string(),
      // V1.7.1 — etapa exibível, tipo da evidência (ex.: "Omissão verificada"), seção, abertura da lista, trecho de como cumprir.
      stepTitle: z.string().nullable().optional(),
      evidenceTypeLabel: z.string().nullable().optional(),
      heading: z.string().nullable().optional(),
      leadIn: z.string().nullable().optional(),
      detail: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  /** V1.6.0 — origem da orientação ("Sem orientação fundamentada" quando o texto não pode trazer "o que fazer"). */
  groundingLabel: z.string().nullable().optional(),
  /** V1.7.1a — exemplo de condução: se o item admite (e por que não), rótulo, aviso e o proposto. */
  suggestedResponse: z.object({ allowed: z.boolean(), notAllowedLabel: z.string().nullable(), label: z.string(), disclaimer: z.string(), proposed: z.string() }).nullable().optional(),
  /** V1.7.1a — o item DENTRO da análise completa: posição, base da ordem e os outros pontos (nada some). */
  analysis: z
    .object({
      position: z.number(),
      total: z.number(),
      priorityLabels: z.array(z.string()),
      others: z.array(z.object({ position: z.number(), sectionLabel: z.string(), stepTitle: z.string().nullable(), dispositionLabel: z.string() })),
      /** V1.7.1b — abertura/fechamento propostos para o feedback inteiro (validados de novo na emissão). */
      presentation: z.object({ greeting: z.string(), introduction: z.string(), closing: z.string(), source: z.enum(["WRITER", "SYSTEM"]) }).nullable().optional(),
    })
    .nullable()
    .optional(),
  /** V1.7.1e — o ASSUNTO do ponto (título no feedback; nunca o nome interno da etapa). */
  findingLabel: z.string().optional(),
  /** V1.7.1e — o feedback COMPLETO como o colaborador receberia (mesmo renderizador da publicação) + cada ponto com estado e
   * detalhes técnicos (recolhidos). null/ausente = item sem análise completa (feedback direto de atendimento). */
  feedbackPreview: feedbackPreviewSchema.nullable().optional(),
  limits: z.object({ maxChars: z.number() }),
  reasons: z.array(z.object({ code: z.string(), label: z.string() })),
})
export type FeedbackReviewDetail = z.infer<typeof feedbackReviewDetailSchema>

/** Derivado das permissões do papel QA_DE_FEEDBACK (V1.5.7): ver (fila/detalhe) × avaliar. */
/** `enabled` = o módulo respondeu (rota montada). Desligado (404) ≠ sem permissão (403): nunca se confundem (V1.5.8a). */
export const feedbackQualityAccessSchema = z.object({ enabled: z.boolean().default(true), canReview: z.boolean(), canDecide: z.boolean().default(false), scopes: z.array(z.object({ scopeType: z.string(), label: z.string() })) })
export type FeedbackQualityAccess = z.infer<typeof feedbackQualityAccessSchema>

export const editCheckSchema = z.object({ blocking: z.array(violationSchema), warnings: z.array(violationSchema) })
export type EditCheck = z.infer<typeof editCheckSchema>

export type FeedbackReviewDecisionInput = { decision: FeedbackReviewDecision; finalWording?: ItemWording | null; reasonCategory?: string | null; comment?: string | null }
export type FeedbackReviewListParams = { status: FeedbackReviewStatus | "ALL"; search?: string | undefined; collaboratorId?: string | undefined; teamId?: string | undefined; section?: "STRENGTH" | "OPPORTUNITY" | undefined; from?: string | undefined; to?: string | undefined; page: number; pageSize: number }

export const STATUS_FILTER_LABELS: Record<FeedbackReviewStatus | "ALL", string> = { PENDING_REVIEW: "Aguardando avaliação", APPROVED_UNCHANGED: "Aprovados sem edição", APPROVED_EDITED: "Aprovados com edição", REJECTED: "Rejeitados", ALL: "Todos" }
export const SECTION_LABELS: Record<"STRENGTH" | "OPPORTUNITY", string> = { STRENGTH: "Ponto positivo", OPPORTUNITY: "Ponto de desenvolvimento" }
export const WORDING_FIELDS: { key: WordingFieldKey; label: string; hint: string }[] = [
  { key: "observed", label: "O que aconteceu", hint: "O fato observado nesta interação." },
  { key: "whyItMatters", label: "Por que importa", hint: "A relevância para o atendimento, como possibilidade." },
  { key: "whatYouCanDo", label: "O que você pode fazer", hint: "A orientação prática para conversas parecidas." },
]
