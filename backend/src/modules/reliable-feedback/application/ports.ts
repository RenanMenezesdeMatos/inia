import type { ReviewReasonCategory } from "../../interaction-feedback/domain/feedback-review.js"
import type { WriterProvenance } from "../../interaction-feedback/domain/feedback-writer-provenance.js"
import type { FeedbackDomain, FeedbackInvestigationResultV1, InvestigationSourceType } from "../domain/feedback-investigation-result.js"
import type { IndicatorCanonicalContext } from "../../indicators/domain/indicator-canonical-context.js"
import type { ArtifactDisposition, ReliableKnowledgeRef, ReliableProcessRef, ReliableWording } from "../domain/reliable-feedback-item.js"
import type { ReliableFeedbackArtifactV1 } from "../domain/reliable-feedback-artifact.js"
import type { ProcessObservation } from "../../indicator-diagnosis/domain/process-patterns.js"
import type { IndicatorWriterInput, IndicatorWriterItem, MonitoringWriterInput, MonitoringWriterItem } from "../domain/reliable-writer.js"
import type { NarrativeBrief, NarrativeDraft } from "../domain/supervisor-narrative.js"
import type { StoredFactuality } from "../domain/narrative-factuality.js"
import type { EmittedItem } from "../domain/reliable-feedback-artifact.js"
import type { PrvNarrativeBrief, PrvNarrativeDraft } from "../domain/prv-closing-views.js"
/** Resultado do redator da narrativa (proveniência mínima, sem texto do prompt; o rascunho fica no artefato). */
export type NarrativeWriterResult = { draft: NarrativeDraft | null; error: string | null; provenance: { promptVersion: string; requestSha256: string | null; responseSha256: string | null; responseModel: string | null; durationMs: number | null; usage: unknown } | null }

/** PORT dos redatores (uma chamada, zero retry; erro = fallback de cada item). Implementação real: adapter Gemini pelo gateway único. */
export type ReliableFeedbackWriterPort = {
  writeMonitoring(input: MonitoringWriterInput): Promise<{ rawOutput: unknown; provenance?: WriterProvenance | null }>
  writeIndicator(input: IndicatorWriterInput): Promise<{ rawOutput: unknown; provenance?: WriterProvenance | null }>
  /** FEEDBACK POR FLAG V2 — narrativa de supervisor (monitoria de processo). Opcional: sem ela, a narrativa é a do sistema.
   * Nunca lança: falha vira `{ draft: null, error }` (a narrativa determinística assume; o feedback nunca espera por ela). */
  writeNarrative?(brief: NarrativeBrief): Promise<NarrativeWriterResult>
  /** FEEDBACK EXPERIENCE V2.1 — verificação SEMÂNTICA da composição: cada frase/card × os fatos dos pontos a que se refere. Opcional:
   * sem ela, nenhum texto do redator de composição é entregue (fail-closed). Nunca lança (falha = `status: ERROR`). */
  verifyNarrativeFactuality?(draft: NarrativeDraft, brief: NarrativeBrief, items: readonly EmittedItem[]): Promise<StoredFactuality>
  /** INDICATOR DIAGNOSIS V1 — interpretação + narrativa do FECHAMENTO do PRV (colaborador, card e notas do supervisor). Opcional:
   * sem ela, tudo é texto do sistema. Nunca lança (falha = `{ draft: null, error }`). */
  writePrvNarrative?(brief: PrvNarrativeBrief): Promise<PrvNarrativeWriterResult>
}
export type PrvNarrativeWriterResult = { draft: PrvNarrativeDraft | null; error: string | null; provenance: NarrativeWriterResult["provenance"] }

export type ArtifactIdentity = {
  organizationId: string
  artifactKey: string
  enrollmentId: string | null
  workflowId: string | null
  workflowVersionId: string | null
  nodeId: string
  sourceNodeId: string
  sourceType: InvestigationSourceType
  domain: FeedbackDomain
  collaboratorId: string
  interactionId: string | null
  indicatorMeasurementId: string | null
  contractVersion: string
  /** INDICATOR DIAGNOSIS V1 — feedback de indicador nascido de um FECHAMENTO do PRV (sem medição diária): a chave do diagnóstico. */
  prvClosingKey?: string | null
}

export type ArtifactRecord = ArtifactIdentity & {
  id: string
  status: "PENDING" | "COMPLETED" | "FAILED"
  disposition: ArtifactDisposition | null
  policyVersion: string | null
  artifact: ReliableFeedbackArtifactV1 | null
  qaResolvedAt: Date | null
  createdAt: Date
  completedAt: Date | null
}

export type ClaimResult = { kind: "CLAIMED"; artifactId: string } | { kind: "COMPLETED"; record: ArtifactRecord } | { kind: "IN_PROGRESS" }

export type NewReliableReview = {
  itemIndex: number
  section: "STRENGTH" | "OPPORTUNITY"
  itemKind: string
  subjectLabel: string
  /** O item como o revisor o vê (evidência exibível/fatos canônicos, significado seguro) — o mesmo item enviado ao redator. */
  reviewItem: ReliableReviewItem
  wordingSource: "WRITER" | "FALLBACK"
  writerViolations: string[]
  proposedWording: ReliableWording
  reviewRequiredBy: string[]
}

/**
 * V1.7.1a — o item DENTRO da análise completa, para o QA: posição na leitura, base da ordem e os OUTROS pontos da mesma análise
 * (etapa, seção e situação) — o revisor vê o item em contexto e nada some. Ausente em revisões anteriores.
 */
export type ReviewAnalysisContext = {
  position: number
  total: number
  priorityBasis: string[]
  others: { position: number; sectionLabel: string; stepTitle: string | null; dispositionLabel: string }[]
  /** V1.7.1b — abertura/fechamento propostos (a validação final é na emissão). */
  presentation?: { greeting: string; introduction: string; closing: string; source: "WRITER" | "SYSTEM" } | null
}

/** Item para o QA: monitoria = item do redator (formato Writer V2 + análise); indicador = item do redator de indicador. */
export type ReliableReviewItem =
  /** V1.6.0: `knowledge`/`process` = a regra da base verificada e a etapa de processo (ausentes em revisões anteriores/legado). */
  | { domain: "MONITORING"; writerItem: MonitoringWriterItem; knowledge?: ReliableKnowledgeRef | null; process?: ReliableProcessRef | null; analysis?: ReviewAnalysisContext | null }
  /** V1.6.1: nos padrões do diagnóstico, a regra da base e a etapa (ausentes no item do fato oficial e em revisões anteriores). */
  | { domain: "INDICATOR"; writerItem: IndicatorWriterItem; canonical: IndicatorCanonicalContext; knowledge?: ReliableKnowledgeRef | null; process?: ReliableProcessRef | null; analysis?: ReviewAnalysisContext | null }

export type ReliableReviewRecord = NewReliableReview & {
  id: string
  organizationId: string
  artifactId: string
  reviewStatus: "PENDING_REVIEW" | "APPROVED_UNCHANGED" | "APPROVED_EDITED" | "REJECTED"
  finalWording: ReliableWording | null
  reasonCategory: ReviewReasonCategory | null
  reviewerComment: string | null
  editWarnings: string[]
  reviewedBy: string | null
  reviewedAt: Date | null
  createdAt: Date
}

export type CompleteArtifact = {
  disposition: ArtifactDisposition
  policyVersion: string
  normalizedInput: FeedbackInvestigationResultV1 | { failure: string } | null
  canonicalContext: IndicatorCanonicalContext | null
  artifact: ReliableFeedbackArtifactV1
  writerInput: unknown
  writerRawOutput: unknown
  writerError: string | null
  writerProvenance: WriterProvenance | null
  reviews: NewReliableReview[]
  /** V1.6.1 — etapas VERIFICADAS (regra VERIFIED) a registrar como observações (base da evidência de pares), na MESMA transação.
   * Indicator Diagnosis V1: `displayContext` = falas display-safe + regra + orientação (o que torna a observação reaproveitável). */
  observations?: (ProcessObservation & { displayContext?: unknown })[]
  /** INDICATOR DIAGNOSIS V1 — a verdade diagnóstica do fechamento (uma por chave de idempotência), na MESMA transação. */
  /** INDICATOR DIAGNOSIS — a verdade diagnóstica (fechamento do PRV ou, V2, diagnóstico DIRETO de um indicador — `sourceKind`). */
  prvDiagnosis?: { sourceKind?: "PRV_CLOSING" | "DIRECT_INDICATOR"; personId: string; referencePeriod: string; idempotencyKey: string; logicVersion: string; strategyVersions: unknown; closing: unknown; diagnosis: unknown; enrollmentId: string | null; generatedAt: string } | null
}

export type ReliableDecisionWrite = { status: "APPROVED_UNCHANGED" | "APPROVED_EDITED" | "REJECTED"; finalWording: ReliableWording | null; reasonCategory: ReviewReasonCategory | null; comment: string | null; editWarnings: string[]; reviewedBy: string; reviewedAt: Date }

/** PORT de persistência — toda leitura/escrita escopada à organização. */
export type ReliableFeedbackStore = {
  /** Posse ATÔMICA da geração pela chave (insert … on conflict … where): concluído = reaproveitado; lease ativa de outro = IN_PROGRESS. */
  claim(identity: ArtifactIdentity, now: Date, leaseSeconds: number): Promise<ClaimResult>
  /** Grava o artefato + as revisões de QA numa transação só (nada parcial fica visível). */
  complete(organizationId: string, artifactId: string, data: CompleteArtifact, now: Date): Promise<ArtifactRecord>
  fail(organizationId: string, artifactId: string, error: string, now: Date): Promise<void>
  get(organizationId: string, artifactId: string): Promise<ArtifactRecord | null>
  listReviews(organizationId: string, artifactId: string): Promise<ReliableReviewRecord[]>
  getReview(organizationId: string, reviewId: string): Promise<ReliableReviewRecord | null>
  /**
   * Decisão de QA numa TRANSAÇÃO: grava a avaliação SÓ se o item ainda estiver PENDING_REVIEW (concorrência otimista) e,
   * quando nenhum item do artefato fica pendente, fecha o QA do artefato (disposição pela regra única `resolve`) e REATIVA a
   * matrícula que espera no nó "Gerar feedback" (update condicional: status waiting + nó atual). `written: false` = já decidido.
   */
  decideReview(organizationId: string, reviewId: string, decision: ReliableDecisionWrite, resolve: (artifact: ReliableFeedbackArtifactV1, reviews: ReliableReviewRecord[]) => ArtifactDisposition): Promise<{ written: false } | { written: true; resolution: { disposition: ArtifactDisposition; reactivated: boolean } | null }>
}
