import { hasUnmaskedNumericIdentifier } from "../../investigation/domain/feedback-display-evidence.js"
import { EVIDENCE_TYPE_LABELS } from "../../reliable-feedback/domain/verified-omission.js"
import { SINGLE_INTERACTION_UNCERTAINTY } from "../../investigation/domain/interaction-feedback.js"
import { validateItemWording, type ItemWording, type WordingViolation, type WriterItem } from "../../investigation/domain/interaction-feedback-writer.js"
import { redactEvidentPii } from "../../investigation/domain/peer-privacy-projection.js"
import { REVIEW_REASON_CATEGORIES, type ReviewReasonCategory, type ReviewStatus } from "./feedback-review.js"
import { deliveryStateOf, type FeedbackDeliveryDecision, type FeedbackDisposition } from "./feedback-delivery-policy.js"
import type { ReliableReviewRecord } from "../../reliable-feedback/application/ports.js"
import { CHECKPOINT_STATUS_LABELS, type GuidanceGrounding } from "../../agents/domain/process-assessment-contract.js"
import { actionClaimModeFor } from "../../investigation/domain/interaction-feedback-writer.js"
import { buildQaFeedbackPreview, type QaPreviewItemStatus } from "../../reliable-feedback/domain/qa-preview.js"
import { findingLabelOf, SECTION_LABELS as ARTIFACT_SECTION_LABELS, type ArtifactItem, type ReliableFeedbackArtifactV1 } from "../../reliable-feedback/domain/reliable-feedback-artifact.js"
import { isEmittableSection } from "../../reliable-feedback/domain/reliable-feedback-item.js"
import { normalizeForLiteralQuote } from "../../knowledge/domain/knowledge-match.js"

/**
 * V1.5.4 — PROJEÇÃO DO QA DE FEEDBACK (o que a tela mostra) + CHECAGEM DA EDIÇÃO HUMANA. V1.5.5: a tela é "QA Lab ›
 * Feedbacks" — avaliação da QUALIDADE do output da INIA, não autorização do supervisor.
 *
 * O avaliador responde três perguntas sem precisar entender a arquitetura de IA: o que aconteceu (contexto + evidência
 * EXIBÍVEL, já mascarada pela projeção de display), que feedback a INIA escreveu (os três textos) e qual a avaliação dele.
 * Mostra também por que o item foi selecionado para QA (política + motivos) e os três estados separados:
 * estruturalmente entregável × aprovado no QA × entregue.
 * Nunca entram aqui: prompt/resposta do modelo, texto original rejeitado do redator, hashes, provenance, handles/refs
 * internas, ownership/kind técnicos, uso de tokens, dados de pares, evidência bruta retida.
 */
export const WORDING_MAX_CHARS = 600

export const SECTION_LABELS: Record<"STRENGTH" | "OPPORTUNITY", string> = { STRENGTH: "Ponto positivo", OPPORTUNITY: "Ponto de desenvolvimento" }
const KIND_LABELS: Record<string, string> = {
  STRENGTH: "Comportamento positivo",
  FRICTION: "Atrito na comunicação",
  CONTRADICTION: "Informação inconsistente",
  UNRESOLVED_NEED: "Necessidade do cliente em aberto",
  // V1.5.12 — feedback confiável do Workflow.
  MONITORING_DEVELOPMENT_POINT: "Ponto de desenvolvimento apontado pela análise do atendimento",
  INDICATOR_TARGET_MET: "Indicador dentro da meta",
  INDICATOR_TARGET_NOT_MET: "Indicador fora da meta",
  // V1.6.0/V1.6.1 — etapas de processo verificadas (monitoria e diagnóstico do indicador).
  MONITORING_STRENGTH: "Etapa do processo cumprida no atendimento",
  INDICATOR_DEVELOPMENT_PATTERN: "Etapa do processo não identificada de forma recorrente na amostra do motivo investigado",
  INDICATOR_STRENGTH_PATTERN: "Etapa do processo identificada de forma consistente na amostra do motivo investigado",
}
const GUIDANCE_LABELS: Record<string, string> = { REINFORCEMENT: "Reforço do comportamento observado", COACHING_SUGGESTION: "Sugestão de desenvolvimento (não é obrigação)", KB_RULE: "Regra da base de conhecimento" }
const SPEAKER_LABELS: Record<string, string> = { OPERADOR: "Operador", CLIENTE: "Cliente", EVENTO: "Evento da chamada", DADO_OFICIAL: "Dado oficial", ANALISE: "Análise da amostra", REFERENCIA: "Grupo de referência (agregado)" }
export const REVIEW_REASON_LABELS: Record<ReviewReasonCategory, string> = {
  FACTUAL_OVERCLAIM: "Afirma mais do que a evidência mostra",
  UNSUPPORTED_EFFECT: "Efeito no cliente sem evidência",
  UNSUPPORTED_PROCEDURE: "Procedimento ou regra sem base",
  TOO_GENERIC: "Genérico demais",
  NOT_ACTIONABLE: "Orientação não acionável",
  TONE: "Tom inadequado",
  PRIVACY: "Privacidade",
  WRONG_FOCUS: "Foco errado",
  OTHER: "Outro",
}
export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = { PENDING_REVIEW: "Aguardando avaliação", APPROVED_UNCHANGED: "Aprovado sem edição", APPROVED_EDITED: "Aprovado com edição", REJECTED: "Rejeitado", NOT_SELECTED_FOR_QA: "Não selecionado para QA" }

export const DISPOSITION_LABELS: Record<FeedbackDisposition, string> = { AUTO_DELIVER: "Entrega autônoma", HOLD_FOR_QA: "Selecionado para QA", BLOCKED: "Bloqueado pela estrutura" }
const SELECTION_REASON_LABELS: Record<string, string> = {
  PILOT_HOLD_ALL_FOR_QA: "Política do piloto: todo feedback entregável passa por QA",
  RISK_POLICY_SECTION: "Política de risco exige QA para este tipo de ponto",
  RISK_POLICY_FINDING_KIND: "Política de risco exige QA para este tipo de achado",
  WRITER_NOT_PASSED: "O redator não respondeu",
  WRITER_FALLBACK_USED: "Texto de fallback de segurança",
  WRITER_VALIDATION_FAILED: "O texto do redator não passou nas validações",
  WORDING_PRIVACY_FLAG: "Possível dado pessoal no texto",
  OWNERSHIP_NOT_ALLOWED: "Ponto não atribuído ao colaborador",
  BLOCKING_UNCERTAINTY: "Incerteza na análise da interação",
  PROCEDURAL_CONTENT: "Conteúdo procedimental",
  READINESS_NOT_READY: "Evidência exibível insuficiente",
  AUTONOMY_CRITERIA_MET: "Critérios de autonomia atendidos",
  // V1.5.9
  FINDING_KIND_NOT_RELEASED_FOR_AUTONOMY: "Tipo de ponto ainda não liberado para envio automático",
  EFFECT_CLAIM_BOUNDARY_VIOLATED: "O texto afirmou um efeito no cliente que a evidência não mostra",
  ACTION_CLAIM_BOUNDARY_VIOLATED: "O texto afirmou como executada uma ação apenas declarada",
  CLAIM_BOUNDARY_NOT_ENFORCED: "Texto escrito fora do contrato de afirmações validado",
  ITEM_EVIDENCE_UNVERIFIED_PROCEDURE_ASSERTION: "A evidência é uma afirmação sobre procedimento não verificada",
  // V1.5.12 — feedback confiável do Workflow
  FEEDBACK_KIND_NOT_RELEASED_FOR_AUTONOMY: "Tipo de feedback ainda não liberado para seguir sem QA",
  SOURCE_INTERPRETATION_CONFLICT: "A análise da origem contradiz o dado oficial — descartada do texto",
  // V1.7.1d — portão de qualidade do conhecimento
  KNOWLEDGE_APPLICABILITY_UNVERIFIED: "A regra da base é literal, mas não está ancorada no que aconteceu na chamada",
  COMPOSITE_COMPLETENESS_UNVERIFIED: "A etapa tem vários itens e a chamada não mostra todos",
  KNOWLEDGE_RULE_IS_EXAMPLE: "O trecho citado como regra é um exemplo do material",
  KNOWLEDGE_PROVENANCE_INCONSISTENT: "Trechos da base de documentos/versões diferentes",
  CHECKPOINT_LABEL_UNRESOLVED: "A etapa ficou sem nome identificável",
  CANONICAL_BEHAVIOR_CONFLICT: "Duas regras do mesmo comportamento chegaram a conclusões opostas",
  // V1.7.1n
  EVIDENCE_POLARITY_CONFLICT: "A fala citada contradiz a conclusão sobre a etapa",
  CHECKPOINT_SOURCE_AMBIGUOUS: "O trecho da base citado é de outra etapa do que a escolhida",
  REQUIRED_CHECKPOINT_NOT_ASSESSED: "Uma etapa obrigatória do processo ficou sem avaliação",
  // V1.7.3
  MISSING_REQUIRED_ASSESSMENT: "Uma etapa que a análise precisava avaliar ficou sem resposta",
  // MONITORING V2
  PREREQUISITE_UNVERIFIED: "A etapa depende de outra que não pôde ser confirmada na chamada",
}
/**
 * V1.7.1e — POR QUE PRECISA DA SUA AVALIAÇÃO, em linguagem humana (uma frase por motivo; motivos do mesmo fato viram uma
 * frase só). É o que a tela mostra primeiro; os rótulos curtos/códigos continuam nos detalhes técnicos.
 */
const QA_EXPLANATIONS: readonly { codes: readonly string[]; text: string }[] = [
  { codes: ["WRITER_NOT_PASSED"], text: "O redator automático não produziu uma resposta válida, e a INIA usou o texto de segurança — montado só com as falas da chamada e as regras do procedimento. Confira se o texto está claro e útil para o colaborador." },
  { codes: ["WRITER_FALLBACK_USED", "WRITER_VALIDATION_FAILED"], text: "O texto do redator automático não passou nas verificações, e a INIA usou o texto de segurança — montado só com as falas da chamada e as regras do procedimento. Confira se o texto está claro e útil para o colaborador." },
  { codes: ["KNOWLEDGE_APPLICABILITY_UNVERIFIED"], text: "A regra do procedimento citada existe no documento, mas não foi possível confirmar automaticamente que ela se aplica a este momento da chamada. Confira se a regra corresponde ao que aconteceu." },
  { codes: ["COMPOSITE_COMPLETENESS_UNVERIFIED"], text: "Esta etapa do procedimento tem vários itens e a chamada só mostra parte deles. Não foi possível confirmar se os demais foram feitos (por exemplo, verificações no sistema que não aparecem na fala). Confira se o ponto forte está justo antes de aprová-lo." },
  { codes: ["KNOWLEDGE_RULE_IS_EXAMPLE"], text: "O trecho citado como regra é um exemplo do material, não uma regra. Confira se o ponto se sustenta." },
  { codes: ["KNOWLEDGE_PROVENANCE_INCONSISTENT"], text: "Os trechos da base usados neste ponto vieram de documentos ou versões diferentes. Confira a origem." },
  { codes: ["CHECKPOINT_LABEL_UNRESOLVED"], text: "Não foi possível dar um nome claro a este ponto a partir do procedimento. Confira se o ponto faz sentido para o colaborador." },
  { codes: ["CANONICAL_BEHAVIOR_CONFLICT"], text: "Duas regras oficiais sobre o mesmo comportamento levaram a conclusões opostas nesta chamada (uma como cumprida, outra como não cumprida). Confira qual se aplica ao que aconteceu." },
  { codes: ["EVIDENCE_POLARITY_CONFLICT"], text: "A fala citada não sustenta a conclusão: por exemplo, a etapa aparece como cumprida, mas o operador disse que não sabia informar; ou aparece como não cumprida, mas a informação foi dada. Confira o que aconteceu." },
  { codes: ["PREREQUISITE_UNVERIFIED"], text: "Este ponto tem fala válida, mas depende de uma etapa anterior que não pôde ser confirmada na chamada (a fala citada dela não foi encontrada como está na transcrição). Confira se a etapa anterior aconteceu antes de reconhecer este ponto." },
  { codes: ["CHECKPOINT_SOURCE_AMBIGUOUS"], text: "A análise escolheu uma etapa do procedimento, mas citou o texto de outra. Confira qual etapa corresponde ao que aconteceu." },
  { codes: ["REQUIRED_CHECKPOINT_NOT_ASSESSED"], text: "Uma etapa obrigatória do processo (por exemplo, a recapitulação) não foi avaliada nesta análise e não pôde ser verificada automaticamente. O feedback está incompleto: confira antes de aprovar." },
  { codes: ["MISSING_REQUIRED_ASSESSMENT"], text: "A análise automática não devolveu resposta para uma etapa principal do processo (nem depois de uma nova tentativa só com ela). Isso não significa que a etapa deixou de acontecer: o feedback está incompleto. Confira a chamada antes de aprovar." },
  { codes: ["PROCESS_RULE_UNVERIFIED"], text: "A regra do procedimento deste ponto não foi verificada na base. Confira antes de aprovar." },
  { codes: ["SOURCE_INTERPRETATION_CONFLICT"], text: "A análise automática contradiz o dado oficial; a parte conflitante foi descartada do texto. Confira o resultado." },
  { codes: ["WORDING_PRIVACY_FLAG"], text: "O texto pode conter um dado pessoal. Confira antes de aprovar." },
  { codes: ["OWNERSHIP_NOT_ALLOWED"], text: "Não ficou claro que este ponto depende do colaborador. Confira se ele deve mesmo recebê-lo." },
  { codes: ["CLAIM_BOUNDARY_NOT_ENFORCED", "EFFECT_CLAIM_BOUNDARY_VIOLATED", "ACTION_CLAIM_BOUNDARY_VIOLATED"], text: "O texto pode afirmar mais do que a chamada mostra (efeito no cliente ou ação dada como concluída). Confira as afirmações." },
  { codes: ["NO_DIAGNOSIS_HOLD_FOR_QA"], text: "Não houve diagnóstico acionável na amostra; a estratégia do indicador pede que o feedback factual passe por avaliação." },
  { codes: ["PILOT_HOLD_ALL_FOR_QA"], text: "Pela política atual, todo feedback passa por avaliação humana antes de seguir." },
  { codes: ["FEEDBACK_KIND_NOT_RELEASED_FOR_AUTONOMY", "FINDING_KIND_NOT_RELEASED_FOR_AUTONOMY", "RISK_POLICY_SECTION", "RISK_POLICY_FINDING_KIND"], text: "Este tipo de feedback ainda não está liberado para seguir sem avaliação humana." },
]
export function qaExplanationsOf(reasons: readonly string[]): string[] {
  const sentences = QA_EXPLANATIONS.filter((entry) => entry.codes.some((code) => reasons.includes(code))).map((entry) => entry.text)
  // WRITER_NOT_PASSED já explica o texto de segurança: a frase das verificações não se repete.
  const deduped = reasons.includes("WRITER_NOT_PASSED") ? sentences.filter((text) => !text.startsWith("O texto do redator automático não passou")) : sentences
  const known = new Set(QA_EXPLANATIONS.flatMap((entry) => entry.codes))
  const others = reasons.filter((code) => !known.has(code) && code !== "AUTONOMY_CRITERIA_MET").map((code) => SELECTION_REASON_LABELS[code]).filter((label): label is string => Boolean(label))
  return [...new Set([...deduped, ...others])]
}

const DELIVERY_STATE_LABELS = {
  BLOCKED: "Bloqueado pela estrutura — não será entregue",
  AWAITING_QA: "Estruturalmente entregável · aguardando avaliação de QA",
  QA_REJECTED: "Rejeitado no QA — não será entregue",
  READY_FOR_DELIVERY: "Pronto para entrega — aguardando o envio ao Acompanhamento",
  DELIVERED: "Entregue no Acompanhamento do colaborador",
} as const
/** Rótulo da política para quem avalia (a versão técnica fica só no dado). */
const policyLabel = (version: string) => (/PILOT/.test(version) ? "Política do piloto" : "Política de entrega")

export const kindLabel = (kind: string) => KIND_LABELS[kind] ?? "Ponto de desenvolvimento"
export const guidanceLabel = (source: string) => GUIDANCE_LABELS[source] ?? "Orientação"
export const speakerLabel = (speaker: string | null) => (speaker ? SPEAKER_LABELS[speaker.toUpperCase()] ?? "Participante" : "Participante")

// ---------------------------------------------------------------------------------------------
// CHECAGEM DA EDIÇÃO HUMANA — bloqueio × aviso
// ---------------------------------------------------------------------------------------------

/** Violação só da edição humana: dado pessoal digitado pelo revisor (a lista canônica de PII ou identificador numérico longo). */
export type HumanEditViolation = WordingViolation | "PRIVACY_DATA"
/** ALTA GRAVIDADE — impedem o envio: vazamento interno, JSON/refs, citação adulterada, dado pessoal. */
export const HUMAN_EDIT_BLOCKING: readonly HumanEditViolation[] = ["INTERNAL_REF", "INTERNAL_JSON_LEAKAGE", "EVIDENCE_ALTERATION", "PRIVACY_DATA"]
const VIOLATION_MESSAGES: Record<HumanEditViolation, string> = {
  SCHEMA: "Formato inválido.",
  INTERNAL_REF: "O texto contém um identificador interno (ex.: códigos como I6, SF2, T12). Remova-o.",
  INTERNAL_JSON_LEAKAGE: "O texto contém trechos técnicos (chaves, nomes de campo). Remova-os.",
  EVIDENCE_ALTERATION: "Um trecho entre aspas não corresponde à evidência. Cite a fala exatamente como está ou remova as aspas.",
  PRIVACY_DATA: "O texto contém um dado pessoal (CPF, telefone, e-mail, protocolo ou número longo). Remova-o.",
  POLARITY_MISMATCH: "O tom do texto observado parece não corresponder ao tipo do ponto (positivo × desenvolvimento).",
  PATTERN_LANGUAGE: "O texto descreve um padrão ou hábito (\"sempre\", \"costuma\"); o feedback é sobre esta interação.",
  PERMANENT_TRAIT: "O texto atribui uma característica permanente à pessoa.",
  TEMPORAL_RELATION: "O texto afirma evolução ou mudança ao longo do tempo; o feedback é sobre esta interação.",
  PROCEDURAL_CONCLUSION_WITHOUT_KB: "O texto conclui sobre procedimento sem uma regra da base.",
  PROCEDURAL_COMPLETENESS: "O texto afirma cumprimento integral de procedimento.",
  UNSUPPORTED_PROCEDURE: "O texto usa linguagem normativa (\"deve\", \"é obrigatório\") sem uma regra da base.",
  UNSUPPORTED_NUMBER: "O texto contém um número que não aparece na evidência.",
  GUARANTEED_EFFECT: "O texto afirma um efeito garantido no cliente que a evidência não mostra.",
  DECLARED_ACTION_UPGRADE: "O texto afirma como executada uma ação que o operador apenas declarou ter feito.",
  COMPREHENSION_UNOBSERVED: "O texto afirma compreensão/entendimento do cliente sem que o cliente tenha confirmado.",
}
/** V1.5.12 — fronteiras do feedback de indicador (o dado oficial é do sistema). */
const INDICATOR_VIOLATION_MESSAGES: Record<string, string> = {
  TARGET_COMPARISON_MISMATCH: "O texto afirma sobre a meta algo diferente do resultado oficial (dentro/fora, acima/abaixo).",
  TREND_WITHOUT_CANONICAL_HISTORY: "O texto fala de evolução ou tendência — os dados oficiais só cobrem este período.",
  PERIOD_MISMATCH: "O texto cita um período diferente do período da medição.",
  UNGROUNDED_GUIDANCE: "Este ponto não tem orientação fundamentada na base — deixe \"o que fazer\" vazio.",
  UNGROUNDED_RELEVANCE: "Nenhuma regra da base sustenta \"por que importa\" — deixe o campo vazio.",
  GENERIC_WORDING: "O texto não nomeia a etapa do processo — serviria para qualquer chamada.",
  CAUSAL_CLAIM: "O texto liga um comportamento ao resultado do indicador por causa e efeito.",
  PEER_CLAIM_WITHOUT_EVIDENCE: "O texto fala de colegas ou grupo de referência sem evidência agregada.",
  UNSUPPORTED_SEGMENT_LABEL: "O texto rotula o motivo/atendimento (simples, complexo…).",
  // V1.7.1a — exemplo de condução
  SUGGESTED_RESPONSE_NOT_ALLOWED: "Este ponto não admite exemplo de condução (só ponto de desenvolvimento com regra verificada e orientação oficial) — deixe o campo vazio.",
  SUGGESTED_RESPONSE_NOT_SPEECH: "O exemplo de condução precisa ser a fala ao cliente (\"Registrei a sua contestação…\"), não uma orientação ao operador.",
  SUGGESTED_RESPONSE_PLACEHOLDER: "O exemplo de condução tem um marcador de lacuna ([prazo], X dias…) — escreva a fala sem inventar o valor.",
  UNSUPPORTED_FACT: "O exemplo cita prazo, canal, valor, crédito, protocolo ou resultado que a regra do item e a chamada não trazem.",
  EXAMPLE_CONTENT_AS_FACT: "O texto usa um número ou canal de um EXEMPLO do documento como se fosse desta chamada.",
}
export const violationMessage = (code: string) => VIOLATION_MESSAGES[code as HumanEditViolation] ?? INDICATOR_VIOLATION_MESSAGES[code] ?? (code === "UNSUPPORTED_NUMBER" ? VIOLATION_MESSAGES.UNSUPPORTED_NUMBER : "Revise este ponto.")

const hasPersonalData = (text: string) => redactEvidentPii(text).redactions.length > 0 || hasUnmaskedNumericIdentifier(text)

/**
 * A versão humana passa pelos MESMOS validadores do redator (validateItemWording) + a checagem de dado pessoal. Os de alta
 * gravidade bloqueiam; o resto vira AVISO (a política da V1.5.0: o revisor humano tem a palavra final, mas vê o aviso).
 */
export function checkHumanEdit(wording: ItemWording, item: WriterItem, interactionLabel: string): { blocking: HumanEditViolation[]; warnings: HumanEditViolation[] } {
  const violations: HumanEditViolation[] = [...validateItemWording(wording, item, interactionLabel)]
  if ([wording.observed, wording.whyItMatters, wording.whatYouCanDo].some(hasPersonalData)) violations.push("PRIVACY_DATA")
  return { blocking: violations.filter((code) => HUMAN_EDIT_BLOCKING.includes(code)), warnings: violations.filter((code) => !HUMAN_EDIT_BLOCKING.includes(code)) }
}

// ---------------------------------------------------------------------------------------------
// VIEW MODELS
// ---------------------------------------------------------------------------------------------

/** Disposição do item (V1.5.5) — o que a política decidiu; `deliveredAt` = entrega real (nenhum fluxo grava ainda). */
export type ReviewSelection = { decision: Pick<FeedbackDeliveryDecision, "disposition" | "structural" | "reasons" | "policyVersion" | "autonomyEligible">; deliveredAt: Date | null }
export type ReviewContext = { collaborator: { id: string; name: string; jobTitle: string | null }; team: { id: string; name: string } | null; occurredAt: Date | null; createdAt: Date; reviewerName: string | null; selection: ReviewSelection }
export type KnowledgeRecommendationView = { documentTitle: string; href: string | null; status: string; statusLabel: string; reason: string; readyForOperator: boolean }

export type ReviewQueueItemRecord = {
  /** V1.5.12: WORKFLOW = item do feedback confiável (a decisão retoma o Workflow); ausente = feedback direto de atendimento. */
  origin?: "INTERACTION" | "WORKFLOW"
  id: string
  reviewStatus: ReviewStatus
  section: "STRENGTH" | "OPPORTUNITY"
  findingKind: string
  wordingSource: "WRITER" | "FALLBACK"
  interactionLabel: string
  reviewedAt: Date | null
}

export function toQueueItem(record: ReviewQueueItemRecord, context: ReviewContext) {
  return {
    reviewId: record.id,
    origin: record.origin ?? "INTERACTION",
    status: record.reviewStatus,
    statusLabel: REVIEW_STATUS_LABELS[record.reviewStatus],
    collaborator: { id: context.collaborator.id, name: context.collaborator.name },
    team: context.team,
    interactionLabel: record.interactionLabel,
    occurredAt: context.occurredAt?.toISOString() ?? null,
    createdAt: context.createdAt.toISOString(),
    section: record.section,
    sectionLabel: SECTION_LABELS[record.section],
    kindLabel: kindLabel(record.findingKind),
    isFallback: record.wordingSource === "FALLBACK",
    reviewedAt: record.reviewedAt?.toISOString() ?? null,
  }
}

export type ReviewDetailRecord = ReviewQueueItemRecord & {
  writerItem: WriterItem
  proposedWording: ItemWording
  finalWording: ItemWording | null
  reasonCategory: ReviewReasonCategory | null
  reviewerComment: string | null
  editWarnings: string[]
}

/**
 * Detalhe para o revisor. `finalWording` é o texto que SERIA entregue: o editado (APPROVED_EDITED) ou o proposto
 * (APPROVED_UNCHANGED — a persistência guarda null por construção, "sem versão humana"); REJECTED/PENDING = null.
 * `deliveryState` (regra única `deliveryStateOf`) só descreve — nada é entregue nesta versão. `selection` diz por que o item
 * está no QA; a avaliação nunca altera a disposição estrutural.
 */
export function toReviewDetail(record: ReviewDetailRecord, context: ReviewContext, knowledge: KnowledgeRecommendationView[]) {
  const item = record.writerItem
  const decided = record.reviewStatus !== "PENDING_REVIEW" && record.reviewStatus !== "NOT_SELECTED_FOR_QA"
  const deliveryState = deliveryStateOf(context.selection.decision.disposition, record.reviewStatus, context.selection.deliveredAt)
  const finalWording = record.reviewStatus === "APPROVED_EDITED" ? record.finalWording : record.reviewStatus === "APPROVED_UNCHANGED" ? record.proposedWording : null
  return {
    ...toQueueItem(record, context),
    collaborator: { id: context.collaborator.id, name: context.collaborator.name, jobTitle: context.collaborator.jobTitle },
    meaning: item.interpretation.safeMeaning,
    guidanceLabel: guidanceLabel(item.guidance.source),
    uncertainty: SINGLE_INTERACTION_UNCERTAINTY,
    evidence: item.evidence.map((entry) => ({ speakerLabel: speakerLabel(entry.speaker), text: entry.text, truncated: entry.truncated, masked: entry.wasRedacted })),
    evidenceWithheldCount: item.evidenceWithheld,
    proposedWording: record.proposedWording,
    proposedIsFallback: record.wordingSource === "FALLBACK",
    finalWording,
    decision: decided
      ? {
          status: record.reviewStatus,
          statusLabel: REVIEW_STATUS_LABELS[record.reviewStatus],
          reviewerName: context.reviewerName,
          reviewedAt: record.reviewedAt?.toISOString() ?? null,
          reasonCategory: record.reasonCategory,
          reasonLabel: record.reasonCategory ? REVIEW_REASON_LABELS[record.reasonCategory] : null,
          comment: record.reviewerComment,
          editWarnings: record.editWarnings.map((code) => ({ code, message: violationMessage(code as HumanEditViolation) })),
        }
      : null,
    selection: {
      disposition: context.selection.decision.disposition,
      dispositionLabel: DISPOSITION_LABELS[context.selection.decision.disposition],
      structurallyDeliverable: context.selection.decision.structural === "STRUCTURALLY_DELIVERABLE",
      policyLabel: policyLabel(context.selection.decision.policyVersion),
      // Só rótulos (os códigos da política ficam no dado — o avaliador não precisa de detalhe técnico).
      reasons: [...new Set(context.selection.decision.reasons.map((code) => SELECTION_REASON_LABELS[code] ?? "Critério da política"))],
      // V1.7.1e — o motivo em linguagem humana (o que a tela mostra primeiro).
      explanations: qaExplanationsOf(context.selection.decision.reasons),
    },
    // V1.7.1e — o que cada decisão faz (a semântica real da avaliação), mostrado junto dos botões.
    decisionEffects: record.origin === "WORKFLOW" ? WORKFLOW_DECISION_EFFECTS : INTERACTION_DECISION_EFFECTS,
    deliveryState,
    deliveryStateLabel: DELIVERY_STATE_LABELS[deliveryState] as string,
    knowledgeRecommendations: knowledge,
    limits: { maxChars: WORDING_MAX_CHARS },
    reasons: REVIEW_REASON_CATEGORIES.map((code) => ({ code, label: REVIEW_REASON_LABELS[code] })),
  }
}
export type ReviewDetailView = ReturnType<typeof toReviewDetail>

/** Recomendação de material: só dados seguros; bloqueada NUNCA aparece como orientação pronta ao operador. */
export function toKnowledgeView(input: { documentTitle: string; href: string | null; deliveryStatus: string }): KnowledgeRecommendationView {
  const blocked = input.deliveryStatus === "BLOCKED_PROCEDURAL_MATCHING"
  return {
    documentTitle: input.documentTitle,
    href: input.href,
    status: input.deliveryStatus,
    statusLabel: blocked ? "Identificado internamente — não é orientação ao operador" : input.deliveryStatus === "PENDING_REVIEW" ? "Aguardando validação" : "Não entregue",
    reason: "Material relacionado ao ponto observado",
    readyForOperator: false,
  }
}

/** V1.7.1e — o que está sendo avaliado e o efeito de cada decisão (semântica real, por origem). */
const WORKFLOW_DECISION_EFFECTS = {
  summary: "Você está avaliando a qualidade do feedback que a INIA pretende enviar. Aprovar não altera a evidência encontrada; apenas autoriza este texto a seguir no Workflow.",
  approve: "Autoriza este ponto, como está, a seguir no Workflow.",
  edit: "Permite ajustar a redação sem alterar os fatos suportados (falas, regra, documento). O texto editado passa pelas mesmas verificações.",
  reject: "Impede que este ponto seja enviado. Os demais pontos da análise continuam com as próprias avaliações.",
} as const
const INTERACTION_DECISION_EFFECTS = {
  summary: "Você está avaliando a qualidade do feedback que a INIA pretende enviar. Aprovar não altera a evidência encontrada; apenas autoriza este texto a ser entregue.",
  approve: "Autoriza este texto, como está, a ser entregue ao colaborador.",
  edit: "Permite ajustar a redação sem alterar os fatos suportados. O texto editado passa pelas mesmas verificações.",
  reject: "Impede que este ponto seja enviado ao colaborador.",
} as const

// ---------------------------------------------------------------------------------------------
// V1.5.12 — item do FEEDBACK CONFIÁVEL (Workflow) na MESMA tela de QA
// ---------------------------------------------------------------------------------------------

const WORKFLOW_STATE_LABELS: Record<string, string> = {
  PENDING_REVIEW: "Aguardando avaliação — o Workflow está esperando esta decisão",
  APPROVED_UNCHANGED: "Aprovado — o Workflow retoma e segue para o próximo passo",
  APPROVED_EDITED: "Aprovado com edição — o Workflow retoma com o texto editado",
  REJECTED: "Rejeitado — o Workflow encerra sem emitir este feedback",
}

/** Detalhe de um item do feedback confiável no formato da tela de QA (evidência exibível OU dados oficiais do indicador). */
export function toReliableReviewDetail(record: ReliableReviewRecord, context: ReviewContext, analysis: { artifact: ReliableFeedbackArtifactV1; reviews: ReliableReviewRecord[] } | null = null) {
  const writerItem: WriterItem = record.reviewItem.domain === "MONITORING"
    ? record.reviewItem.writerItem
    : {
        slot: record.reviewItem.writerItem.slot,
        section: record.reviewItem.writerItem.section,
        interpretation: { kind: record.itemKind as WriterItem["interpretation"]["kind"], polarity: record.reviewItem.writerItem.polarity, scope: "INTERACTION_SPECIFIC", safeMeaning: record.reviewItem.writerItem.safeMeaning },
        guidance: { source: record.reviewItem.writerItem.guidanceSource, mandatory: false, knowledge: null },
        evidence: [
          { speaker: "DADO_OFICIAL", text: `${record.reviewItem.writerItem.canonical.indicatorName} no período ${record.reviewItem.writerItem.canonical.period}: ${record.reviewItem.writerItem.canonical.value}`, truncated: false, wasRedacted: false },
          { speaker: "DADO_OFICIAL", text: `Meta vigente: ${record.reviewItem.writerItem.canonical.target} (${record.reviewItem.writerItem.canonical.direction}) — ${record.reviewItem.writerItem.canonical.comparison}`, truncated: false, wasRedacted: false },
          // V1.6.1 — padrão do diagnóstico: motivo investigado, contagem na amostra, falas verificadas e agregado de pares.
          ...diagnosisEvidenceOf(record.reviewItem.writerItem),
        ],
        evidenceWithheld: 0,
        actionClaimMode: actionClaimModeFor(),
      }
  const detail = toReviewDetail(
    { origin: "WORKFLOW", id: record.id, reviewStatus: record.reviewStatus, section: record.section, findingKind: record.itemKind, wordingSource: record.wordingSource, interactionLabel: record.subjectLabel, reviewedAt: record.reviewedAt, writerItem, proposedWording: record.proposedWording, finalWording: record.finalWording, reasonCategory: record.reasonCategory, reviewerComment: record.reviewerComment, editWarnings: record.editWarnings },
    context,
    [],
  )
  return {
    ...detail,
    uncertainty: record.reviewItem.domain === "INDICATOR" ? (record.reviewItem.writerItem.diagnosis ? "amostra de atendimentos do motivo investigado no período; associação com o indicador não é causa" : "dados oficiais de um único período; sem histórico") : detail.uncertainty,
    deliveryStateLabel: WORKFLOW_STATE_LABELS[record.reviewStatus] ?? detail.deliveryStateLabel,
    processBasis: processBasisOf(record),
    groundingLabel: record.reviewItem.writerItem.grounding ? GROUNDING_LABELS[record.reviewItem.writerItem.grounding] : null,
    suggestedResponse: suggestedResponseViewOf(record),
    analysis: analysisViewOf(record),
    // V1.7.1e — o ASSUNTO do ponto (título no feedback) e o feedback COMPLETO como o colaborador receberia.
    findingLabel: findingLabelOf({ section: record.section, process: record.reviewItem.process ?? null, knowledge: record.reviewItem.knowledge ?? null, sectionLabel: ARTIFACT_SECTION_LABELS[record.section] }),
    feedbackPreview: analysis ? feedbackPreviewViewOf(record, analysis) : null,
  }
}

const PREVIEW_STATUS_LABELS: Record<QaPreviewItemStatus, string> = {
  PENDING_REVIEW: "Aguardando avaliação",
  APPROVED_UNCHANGED: "Aprovado",
  APPROVED_EDITED: "Aprovado com edição",
  REJECTED: "Rejeitado — não será enviado",
  READY: "Segue sem avaliação",
  BLOCKED: "Fora do feedback — bloqueado pela estrutura",
}
const CONTENT_KIND_LABELS: Record<string, string> = { RULE_CONTENT: "Regra", DO_NOT_CONTENT: "O procedimento pede evitar", EXAMPLE_CONTENT: "Exemplo do material (não é regra)" }
const WORDING_SOURCE_LABELS: Record<string, string> = { WRITER: "Redator automático", FALLBACK: "Texto de segurança (sem redator)", SYSTEM: "Texto do sistema" }
const OPERATIVE_RULE_REASONS: Record<string, string> = { INTRODUCTORY_CITATION: "o trecho citado era uma frase de abertura; a regra normativa da mesma seção foi usada para orientar", DO_NOT_CITATION: "o trecho citado era a lista do que evitar; a regra normativa da mesma seção diz o que fazer no lugar" }
const sectionName = (heading: string | null | undefined) => (heading ? heading.replace(/^\s*\d+(?:\.\d+)*\.?\s+/, "").trim() : null)

/** Detalhes TÉCNICOS de um ponto (recolhidos na tela): fala, regra, seção, documento, aplicabilidade, tipo da evidência, confiabilidade. */
function technicalOf(item: ArtifactItem) {
  const knowledge = item.knowledge ?? null
  return {
    internalStep: item.process?.stepTitle ?? null,
    requirement: item.process?.requirement ?? null,
    evidenceTypeLabel: item.process?.evidenceType ? EVIDENCE_TYPE_LABELS[item.process.evidenceType] : null,
    facts: item.facts.map((fact) => ({ speakerLabel: speakerLabel(fact.role), text: fact.text, truncated: fact.truncated, masked: fact.masked })),
    knowledge: knowledge
      ? {
          documentTitle: knowledge.documentTitle,
          href: knowledge.href,
          section: sectionName(knowledge.heading),
          version: knowledge.version,
          quote: `${knowledge.leadIn && !normalizeForLiteralQuote(knowledge.quote).startsWith(normalizeForLiteralQuote(knowledge.leadIn)) ? `${knowledge.leadIn} … ` : ""}${knowledge.quote}`,
          kindLabel: CONTENT_KIND_LABELS[knowledge.contentKind ?? "RULE_CONTENT"] ?? "Regra",
          detail: knowledge.detail ? { quote: knowledge.detail.quote, section: sectionName(knowledge.detail.heading ?? knowledge.heading), kindLabel: CONTENT_KIND_LABELS[knowledge.detail.contentKind ?? "RULE_CONTENT"] ?? "Regra" } : null,
          operativeRule: knowledge.operativeRule ? { quote: knowledge.operativeRule.quote, reason: OPERATIVE_RULE_REASONS[knowledge.operativeRule.replaced] ?? null } : null,
          applicabilityLabel: applicabilityLabelOf(knowledge),
        }
      : null,
    reliability: {
      dispositionLabel: item.decision.disposition === "READY" ? "Seguiria sem avaliação" : item.decision.disposition === "HOLD_FOR_QA" ? "Selecionado para avaliação" : "Bloqueado pela estrutura",
      reasons: qaExplanationsOf(item.decision.reasons),
    },
    wordingSourceLabel: item.wordingSource ? WORDING_SOURCE_LABELS[item.wordingSource] ?? null : null,
    validationWarnings: [...new Set(item.writerViolations.filter((code) => code !== "SCHEMA").map(violationMessage))],
    // V1.7.1h — o que aconteceu com cada campo do redator (só os que não foram mantidos como vieram).
    fieldValidation: (item.writerFieldValidation ?? []).filter((entry) => entry.action !== "KEPT").map((entry) => ({ field: WRITER_FIELD_LABELS[entry.field] ?? entry.field, action: WRITER_FIELD_ACTION_LABELS[entry.action] ?? entry.action, reasons: [...new Set(entry.codes.map(violationMessage))] })),
    // V1.7.1j — etapa COMPOSTA: completude e subitens por situação (só QA/debug; o colaborador vê o texto do ponto).
    completeness: item.process?.completeness ? {
      statusLabel: COMPLETENESS_LABELS[item.process.completeness.status] ?? item.process.completeness.status,
      groups: ([["Observado na etapa", item.process.completeness.observed], ["Comprovadamente ausente", item.process.completeness.absent], ["Não aplicável (resultado ainda pendente)", item.process.completeness.notApplicable ?? []], ["Dito na chamada, fora da etapa", item.process.completeness.elsewhere ?? []], ["Condicional (sem evidência)", item.process.completeness.conditional], ["Desconhecido / não verificável", item.process.completeness.unknown]] as const)
        .filter(([, items]) => items.length > 0).map(([label, items]) => ({ label, items: [...items] })),
    } : null,
    // V1.7.1k — prontidão analítica da observação desta etapa (a mesma regra da persistência; só debug do QA).
    analyticReadiness: item.process?.analyticReadiness ? {
      statusLabel: ANALYTIC_STATUS_LABELS[item.process.analyticReadiness.status] ?? item.process.analyticReadiness.status,
      reasons: item.process.analyticReadiness.reasons.map((reason) => ANALYTIC_REASON_LABELS[reason] ?? reason),
      eligibleLabel: item.process.analyticReadiness.eligible ? "Entra no histórico analítico" : "Fica fora do histórico analítico",
    } : null,
  }
}
const ANALYTIC_STATUS_LABELS: Record<string, string> = { VERIFIED: "Verificada", NEEDS_REVIEW: "Precisa de revisão", REJECTED: "Rejeitada" }
const ANALYTIC_REASON_LABELS: Record<string, string> = { EXAMPLE_ONLY_RULE: "A base citada é só exemplo", APPLICABILITY_UNVERIFIED: "Aplicabilidade da regra não verificada", UNVERIFIED_OMISSION: "Omissão não verificada", CHECKPOINT_CONFLICT: "Mesma etapa marcada como cumprida e não cumprida", LEGACY_BEFORE_ANALYTIC_READINESS: "Registro anterior à prontidão analítica", NOT_A_PROCESS_CHECKPOINT: "O trecho citado é contexto do procedimento (objetivo, abrangência…), não uma etapa", LEGACY_BEFORE_CHECKPOINT_ELIGIBILITY: "Registro anterior à verificação de etapa executável", CANONICAL_BEHAVIOR_CONFLICT: "Fontes do mesmo comportamento com conclusões opostas", LEGACY_BEFORE_CANONICAL_BEHAVIOR: "Registro anterior à identidade canônica do comportamento", EVIDENCE_POLARITY_CONFLICT: "A fala citada contradiz a conclusão da etapa", CHECKPOINT_SOURCE_AMBIGUOUS: "Citação de outra etapa do que a escolhida" }
const COMPLETENESS_LABELS: Record<string, string> = { COMPLETE: "Completa", PARTIAL: "Parcial", UNKNOWN: "Desconhecida (não comprovável pela chamada)" }
const WRITER_FIELD_LABELS: Record<string, string> = { observed: "O que aconteceu", whyItMatters: "Por que importa", whatYouCanDo: "Como aplicar", suggestedResponse: "Exemplo de condução" }
const WRITER_FIELD_ACTION_LABELS: Record<string, string> = { DROPPED: "Removido (o ponto seguiu sem este campo)", FALLBACK_FIELD: "Substituído pelo texto do sistema", INVALIDATED_ITEM: "Invalidou o texto inteiro do ponto" }

/** V1.7.1e — a prévia do feedback COMPLETO (mesmo renderizador da publicação) + cada ponto com estado e detalhes técnicos. */
function feedbackPreviewViewOf(record: ReliableReviewRecord, analysis: { artifact: ReliableFeedbackArtifactV1; reviews: ReliableReviewRecord[] }) {
  const preview = buildQaFeedbackPreview(record.artifactId, analysis.artifact, analysis.reviews.map((review) => ({ id: review.id, itemIndex: review.itemIndex, reviewStatus: review.reviewStatus, finalWording: review.finalWording })))
  return {
    version: preview.version,
    basisLabel: "Prévia exata do que o colaborador receberia — os pontos que ainda aguardam avaliação aparecem como se fossem aprovados sem edição.",
    parts: preview.parts.map((entry) => ({ kind: entry.kind, markdown: entry.markdown, itemIndexes: entry.itemIndexes, label: entry.label, section: entry.section })),
    pending: preview.pending,
    currentItemIndex: record.itemIndex,
    items: preview.items.map((entry) => {
      const item = analysis.artifact.items.find((candidate) => candidate.index === entry.itemIndex)!
      return {
        itemIndex: entry.itemIndex,
        reviewId: entry.reviewId,
        label: entry.label,
        sectionLabel: isEmittableSection(item.section) ? ARTIFACT_SECTION_LABELS[item.section] : "Contexto",
        status: entry.status,
        statusLabel: PREVIEW_STATUS_LABELS[entry.status],
        inPreview: entry.inPreview,
        isCurrent: entry.itemIndex === record.itemIndex,
        technical: technicalOf(item),
      }
    }),
  }
}

/** V1.7.1a — rótulos da BASE DA ORDEM (prioridade determinística) para o revisor. */
const PRIORITY_BASIS_LABELS: Record<string, string> = {
  DEVELOPMENT_FIRST: "ponto de desenvolvimento (vem antes dos pontos fortes)",
  STRENGTH: "ponto forte",
  RULE_VERIFIED: "regra ancorada na conversa",
  RULE_LITERAL_ONLY: "regra só literal (confirmar aplicabilidade)",
  RULE_NOT_VERIFIED: "regra não verificada",
  PROCEDURE_ORDER: "ordem do procedimento no documento",
  ASSESSMENT_ORDER: "ordem da avaliação",
  APPLICABILITY_ATTENTION: "ponto a confirmar (produto não confirmado)",
}
const SUGGESTED_RESPONSE_NOT_ALLOWED_LABELS: Record<string, string> = {
  NOT_MONITORING_PROCESS_ITEM: "Só pontos de etapa de processo da monitoria têm exemplo de condução.",
  NOT_DEVELOPMENT_POINT: "Ponto forte: \"Para manter\" basta — sem exemplo de condução.",
  NO_STEP: "Sem nome de etapa verificado — sem exemplo de condução.",
  NO_VERIFIED_RULE: "Sem regra da base verificada — sem exemplo de condução.",
  NO_OFFICIAL_GUIDANCE: "Sem orientação oficial — sem exemplo de condução.",
  RULE_IS_EXAMPLE_ONLY: "O trecho da base é só um exemplo do documento — sem regra para sustentar o exemplo de condução.",
}

/**
 * V1.7.1a — EXEMPLO DE CONDUÇÃO para o revisor: se o item admite exemplo (e por que não), o proposto e o final. Revisões
 * anteriores à V1.7.1a não têm escopo: não admitem exemplo.
 */
function suggestedResponseViewOf(record: ReliableReviewRecord) {
  // V1.7.1b — monitoria de processo e padrão de desenvolvimento do diagnóstico de indicador (quando o item traz o escopo).
  const scope = record.reviewItem.writerItem.suggestedResponse ?? null
  if (record.reviewItem.domain !== "MONITORING" && !scope) return null
  // Item sem etapa de processo (caminho legado) e sem escopo: nada a dizer sobre exemplo.
  if (!scope && !record.reviewItem.process?.evidenceType) return null
  const allowed = Boolean(scope?.allowed)
  const legacy = !scope
  return {
    allowed,
    notAllowedLabel: allowed ? null : legacy ? "Item gerado antes do exemplo de condução — sem exemplo." : SUGGESTED_RESPONSE_NOT_ALLOWED_LABELS[scope?.notAllowedReason ?? "NOT_MONITORING_PROCESS_ITEM"] ?? null,
    label: "Exemplo de condução",
    disclaimer: "Sugestão de formulação — não é fala da chamada nem texto oficial. Prazo, canal, valor e resultado só quando a regra do item ou a chamada trazem.",
    proposed: (record.proposedWording as { suggestedResponse?: string }).suggestedResponse ?? "",
  }
}

/** V1.7.1a — o item DENTRO da análise completa (posição, base da ordem e os outros pontos). */
function analysisViewOf(record: ReliableReviewRecord) {
  const analysis = record.reviewItem.analysis ?? null
  if (!analysis) return null
  return {
    position: analysis.position,
    total: analysis.total,
    priorityLabels: analysis.priorityBasis.map((code) => PRIORITY_BASIS_LABELS[code] ?? code),
    others: analysis.others,
    presentation: analysis.presentation ?? null,
  }
}

function diagnosisEvidenceOf(item: Extract<ReliableReviewRecord["reviewItem"], { domain: "INDICATOR" }>["writerItem"]) {
  const diagnosis = item.diagnosis
  if (!diagnosis) return []
  return [
    ...(diagnosis.segment ? [{ speaker: "ANALISE", text: diagnosis.segment, truncated: false, wasRedacted: false }] : []),
    { speaker: "ANALISE", text: diagnosis.pattern, truncated: false, wasRedacted: false },
    ...diagnosis.evidence.map((entry) => ({ speaker: "OPERADOR", text: entry.text, truncated: entry.truncated, wasRedacted: entry.masked })),
    ...(diagnosis.peer ? [{ speaker: "REFERENCIA", text: diagnosis.peer, truncated: false, wasRedacted: false }] : []),
  ]
}

/** V1.6.0 — rótulos da ORIGEM da orientação (o revisor vê de onde vem o "o que fazer", ou que não há orientação). */
export const GROUNDING_LABELS: Record<GuidanceGrounding, string> = {
  OFFICIAL_PROCEDURE: "Procedimento oficial da base",
  OFFICIAL_SERVICE_GUIDELINE: "Diretriz oficial de atendimento da base",
  VERIFIED_PEER_PATTERN: "Padrão verificado de pares",
  NO_GROUNDED_GUIDANCE: "Sem orientação fundamentada — o texto não traz \"o que fazer\"",
}
const APPLICABILITY_LABELS = { VERIFIED: "Regra verificada e ancorada na conversa", LITERAL_ONLY: "Regra literal, mas sem âncora na conversa — confirme se se aplica" } as const

/** V1.6.0 — a etapa de processo e a regra da base que sustentam o item (monitoria PROCESS-CENTRIC); null no legado/indicador. */
function processBasisOf(record: ReliableReviewRecord) {
  if (!record.reviewItem.knowledge) return null
  const { knowledge, process } = record.reviewItem
  return {
    requirement: process?.requirement ?? null,
    statusLabel: process ? CHECKPOINT_STATUS_LABELS[process.status] : null,
    documentTitle: knowledge.documentTitle,
    quote: knowledge.quote,
    href: knowledge.href,
    applicability: knowledge.applicability,
    applicabilityLabel: applicabilityLabelOf(knowledge),
    // V1.7.1 — etapa exibível, tipo da evidência, seção, abertura da lista e trecho de como cumprir (ausentes antes da V1.7.1).
    stepTitle: process?.stepTitle ?? null,
    evidenceTypeLabel: process?.evidenceType ? EVIDENCE_TYPE_LABELS[process.evidenceType] : null,
    heading: knowledge.heading,
    leadIn: knowledge.leadIn ?? null,
    detail: knowledge.detail?.quote ?? null,
  }
}
/** V1.7.1f — a prova ESTRUTURADA (etapa da lista + processo aplicável + ação/pergunta da etapa na fala) tem rótulo próprio.
 * V1.7.1g — um rótulo por base (a escolha da etapa canônica e o desvio observado não exigem a mesma palavra na fala). */
const STRUCTURED_ANCHOR_LABEL = "Regra verificada pela estrutura: etapa da lista do processo aplicável, com a ação (ou a pergunta) da etapa na fala verificada do operador"
const STRUCTURED_ANCHOR_LABELS: Record<string, string> = {
  ACTION_STEP: STRUCTURED_ANCHOR_LABEL,
  ASKED_ITEM: "Regra verificada pela estrutura: item a perguntar da lista do processo aplicável, com a pergunta verificada do operador",
  CHECKPOINT_SELECTION: "Regra verificada pela estrutura: etapa da lista do processo aplicável escolhida para a fala verificada do operador (a fala não traz a ação de outra etapa)",
  OBSERVED_DEVIATION: "Regra verificada pela estrutura: etapa obrigatória da lista do processo aplicável; a fala verificada do operador mostra o que foi feito no lugar e nenhuma outra fala dele cumpre a etapa",
  SEMANTIC_CONDUCT: "Regra verificada pela conduta: a fala verificada do operador realiza a conduta da etapa com outras palavras (papel da fala compatível, relação equivalente declarada e objeto da regra presente)",
  PREREQUISITE_SKIPPED: "Regra verificada pela ordem da etapa: o operador fez a ação seguinte sem a etapa que deveria vir antes",
}
function applicabilityLabelOf(knowledge: { applicability: "VERIFIED" | "LITERAL_ONLY"; applicabilityBasis?: string | null; structuredAnchorBasis?: string | null }) {
  if (knowledge.applicabilityBasis === "VERIFIED_OMISSION") return VERIFIED_OMISSION_LABEL
  if (knowledge.applicabilityBasis === "STRUCTURED_ANCHOR") return STRUCTURED_ANCHOR_LABELS[knowledge.structuredAnchorBasis ?? ""] ?? STRUCTURED_ANCHOR_LABEL
  return APPLICABILITY_LABELS[knowledge.applicability]
}
const VERIFIED_OMISSION_LABEL = "Omissão verificada: processo aplicável, etapa obrigatória, transcrição completa, houve oportunidade e nenhuma fala cumpriu a etapa"
