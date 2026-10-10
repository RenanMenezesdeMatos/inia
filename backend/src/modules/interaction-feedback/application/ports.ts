import type { FeedbackWriterInputV1, ItemWording, WordingViolation, WriterItem } from "../../investigation/domain/interaction-feedback-writer.js"
import type { InteractionFeedbackStatus, InteractionFeedbackV1 } from "../../investigation/domain/interaction-feedback.js"
import type { ReviewReasonCategory, ReviewStatus } from "../domain/feedback-review.js"
import type { FeedbackDeliveryDecision } from "../domain/feedback-delivery-policy.js"
import type { KnowledgeRecommendationDraft, OperationalIssueOccurrenceDraft } from "../domain/operational-issue.js"
import type { WriterProvenance } from "../domain/feedback-writer-provenance.js"

/**
 * PORT do redator: recebe SÓ o FeedbackWriterInput V1 e devolve a resposta (a validação de linguagem, o fallback e a
 * revisão são do pipeline). Implementação real: `infrastructure/gemini-feedback-writer.ts` (V1.5.1, gateway único + prompt
 * congelado). `provenance` diz qual Writer gerou o texto; um erro do adapter (`FeedbackWriterError`) também a carrega.
 * Nenhuma chamada de modelo acontece sem a flag e sem um adapter explícito.
 */
export type FeedbackWriterPort = { write(input: FeedbackWriterInputV1): Promise<{ rawOutput: unknown; provenance?: WriterProvenance | null }> }

/** `generationId` (V1.5.10): a intenção lógica que originou o run (registro de idempotência do Workflow); null = chamada direta. */
export type RunContext = { organizationId: string; collaboratorId: string; teamId: string | null; interactionId: string | null; occurredAt: Date | null; generationId?: string | null }

export type NewRun = RunContext & {
  pipelineVersion: string
  contractVersion: string
  status: InteractionFeedbackStatus
  deliveryState: InteractionFeedbackV1["delivery"]["state"]
  writerInvoked: boolean
  writerSkippedReason: string | null
  feedbackSnapshot: InteractionFeedbackV1
  writerInput: FeedbackWriterInputV1 | null
  createdAt: Date
}

export type NewItemReview = {
  organizationId: string
  runId: string
  slot: string
  itemIndex: number
  section: "STRENGTH" | "OPPORTUNITY"
  findingKind: string
  guidanceSource: string
  writerItem: WriterItem
  interactionLabel: string
  wordingSource: "WRITER" | "FALLBACK"
  writerViolations: WordingViolation[]
  writerOriginal: unknown
  proposedWording: ItemWording
  /** Motivos da seleção para QA (os da decisão de entrega); vazio quando o item não foi selecionado. */
  reviewRequiredBy: string[]
  /** PENDING_REVIEW = selecionado para QA (HOLD_FOR_QA); NOT_SELECTED_FOR_QA = AUTO_DELIVER. */
  initialStatus: "PENDING_REVIEW" | "NOT_SELECTED_FOR_QA"
  createdAt: Date
}

export type ItemReviewRecord = Omit<NewItemReview, "initialStatus"> & { id: string; reviewStatus: ReviewStatus; finalWording: ItemWording | null; reasonCategory: ReviewReasonCategory | null; reviewerComment: string | null; editWarnings: string[]; reviewedBy: string | null; reviewedAt: Date | null }

export type ReviewDecisionWrite = { status: "APPROVED_UNCHANGED" | "APPROVED_EDITED" | "REJECTED"; finalWording: ItemWording | null; reasonCategory: ReviewReasonCategory | null; comment: string | null; editWarnings: string[]; reviewedBy: string; reviewedAt: Date }

/** Disposição de UM item de colaborador (V1.5.5) — gravada para todo item, inclusive BLOCKED (sem redação). */
export type NewDeliveryDecision = { organizationId: string; runId: string; itemIndex: number; section: "STRENGTH" | "OPPORTUNITY"; findingKind: string; decision: FeedbackDeliveryDecision; itemReviewId: string | null; createdAt: Date }
export type DeliveryDecisionRecord = NewDeliveryDecision & { id: string; deliveredAt: Date | null }

/** PORT de persistência. Toda leitura/escrita é escopada à organização. */
export type InteractionFeedbackStore = {
  createRun(run: NewRun): Promise<string>
  recordWriterOutcome(runId: string, outcome: { rawOutput: unknown; error: string | null; provenance: WriterProvenance | null }): Promise<void>
  createItemReviews(reviews: NewItemReview[]): Promise<ItemReviewRecord[]>
  createOccurrences(context: RunContext & { runId: string; pipelineVersion: string; createdAt: Date }, occurrences: OperationalIssueOccurrenceDraft[]): Promise<{ itemIndex: number; id: string }[]>
  createRecommendations(organizationId: string, recommendations: (KnowledgeRecommendationDraft & { occurrenceId: string })[], createdAt: Date): Promise<string[]>
  getItemReview(organizationId: string, reviewId: string): Promise<ItemReviewRecord | null>
  /** Grava a avaliação de QA SÓ se o item ainda está PENDING_REVIEW (concorrência otimista); false = já decidido. Nunca toca a disposição. */
  decideItemReview(organizationId: string, reviewId: string, decision: ReviewDecisionWrite): Promise<boolean>
  listItemReviews(organizationId: string, runId: string): Promise<ItemReviewRecord[]>
  /** ATÔMICO (V1.5.10): todas as decisões do run numa instrução só — nenhuma decisão parcial fica visível ao varredor. */
  createDeliveryDecisions(decisions: NewDeliveryDecision[]): Promise<DeliveryDecisionRecord[]>
  /** Marca o run como COMPLETO (todas as decisões gravadas) — um run sem a marca foi interrompido e nunca é adotado. */
  completeRun(organizationId: string, runId: string, completedAt: Date): Promise<void>
  listDeliveryDecisions(organizationId: string, runId: string): Promise<DeliveryDecisionRecord[]>
}
