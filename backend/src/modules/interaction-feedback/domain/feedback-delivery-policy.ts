import type { InteractionFeedbackItem, InteractionFeedbackV1, ItemDeliveryBlock } from "../../investigation/domain/interaction-feedback.js"
import { COLLABORATOR_SECTIONS } from "../../investigation/domain/interaction-feedback.js"
import { hasUnmaskedNumericIdentifier } from "../../investigation/domain/feedback-display-evidence.js"
import type { ItemWording, WordingViolation } from "../../investigation/domain/interaction-feedback-writer.js"
import { redactEvidentPii } from "../../investigation/domain/peer-privacy-projection.js"

/**
 * V1.5.5 — FEEDBACK AUTONOMY POLICY.
 *
 * GERAR o feedback ≠ AVALIAR a qualidade do feedback. A revisão humana NÃO é requisito intrínseco do feedback: é uma
 * política de rollout/QA. O destino de cada item é decidido POR CÓDIGO, só com sinais estruturais já existentes — o LLM
 * nunca escolhe:
 *
 *   BLOCKED       → a estrutura impede a entrega (procedimental bloqueado, evidência exibível insuficiente, privacidade da
 *                   evidência, item sem orientação comunicável). Nenhuma decisão de QA transforma BLOCKED em entregável.
 *   HOLD_FOR_QA   → estruturalmente entregável, mas a política seleciona para QA antes da entrega.
 *   AUTO_DELIVER  → estruturalmente entregável e todos os critérios de autonomia atendidos; nenhuma política de risco exige QA.
 *
 * Três estados que nunca se confundem: STRUCTURALLY_DELIVERABLE (a estrutura permite) × QA_APPROVED (a avaliação humana
 * aprovou) × ACTUALLY_DELIVERED (chegou ao colaborador — nada entrega nesta versão). PENDING_REVIEW não significa "inseguro
 * para entregar": significa "selecionado para QA e ainda não avaliado".
 */
export const FEEDBACK_DISPOSITIONS = ["AUTO_DELIVER", "HOLD_FOR_QA", "BLOCKED"] as const
export type FeedbackDisposition = (typeof FEEDBACK_DISPOSITIONS)[number]
export type StructuralDeliverability = "STRUCTURALLY_DELIVERABLE" | "BLOCKED"

/** Motivos de BLOCKED (estrutura — independem de política). */
export type StructuralBlockReason = ItemDeliveryBlock | "EVIDENCE_PRIVACY_FAIL" | "NOT_COLLABORATOR_DELIVERABLE" | "NO_COMMUNICABLE_GUIDANCE"
/** O que impede AUTO_DELIVER num item estruturalmente entregável (o item continua entregável — só exige QA). */
export type AutonomyBlocker =
  | "WRITER_NOT_PASSED" | "WRITER_FALLBACK_USED" | "WRITER_VALIDATION_FAILED" | "WORDING_PRIVACY_FLAG"
  | "OWNERSHIP_NOT_ALLOWED" | "BLOCKING_UNCERTAINTY" | "PROCEDURAL_CONTENT" | "READINESS_NOT_READY"
  // V1.5.9 — detalhe ESTRUTURADO de por que o item não é autônomo (motivo real, nunca "por segurança"):
  /** O texto do redator violou a fronteira de EFEITO (garantiu efeito/compreensão não observados) — o item caiu no fallback. */
  | "EFFECT_CLAIM_BOUNDARY_VIOLATED"
  /** O texto do redator promoveu uma ação DECLARADA a executada — o item caiu no fallback. */
  | "ACTION_CLAIM_BOUNDARY_VIOLATED"
  /** O item não foi escrito sob os modos de afirmação validados (efeito POTENTIAL_ONLY, ação DECLARED_ONLY). */
  | "CLAIM_BOUNDARY_NOT_ENFORCED"
  /** A evidência DO ITEM é uma afirmação do operador sobre procedimento que a base não verificou (dúvida real, por item). */
  | "ITEM_EVIDENCE_UNVERIFIED_PROCEDURE_ASSERTION"
/** Motivos de HOLD_FOR_QA vindos da POLÍTICA (não do item). */
export type PolicyHoldReason = "PILOT_HOLD_ALL_FOR_QA" | "RISK_POLICY_SECTION" | "RISK_POLICY_FINDING_KIND"
  /** V1.5.9: o tipo de achado ainda não foi LIBERADO para autonomia (sem evidência de revisão humana suficiente). */
  | "FINDING_KIND_NOT_RELEASED_FOR_AUTONOMY"
export type DispositionReason = StructuralBlockReason | AutonomyBlocker | PolicyHoldReason | "AUTONOMY_CRITERIA_MET"

/**
 * Política de entrega (dados, versionada). Trocar a política NÃO exige mexer no InteractionFeedback nem no Writer: o
 * pipeline recebe a política por injeção e grava `policyVersion` em cada decisão.
 */
export type FeedbackDeliveryPolicy = {
  version: string
  /** true = todo item estruturalmente entregável vai para QA (piloto). */
  holdAllForQa: boolean
  /** Políticas de risco: seções/kinds que sempre exigem QA mesmo com os critérios de autonomia atendidos. */
  requireQaForSections: readonly ("STRENGTH" | "OPPORTUNITY")[]
  requireQaForFindingKinds: readonly string[]
  /** Donos permitidos para AUTO_DELIVER (feedback ao colaborador só descreve conduta dele). */
  autonomyOwnership: readonly string[]
  /** Incertezas que NÃO impedem autonomia (SINGLE_INTERACTION é sempre verdadeira num feedback de uma interação). */
  nonBlockingUncertainties: readonly string[]
  /** V1.5.9 — tipos de achado LIBERADOS para autonomia (lista de permissão: tipo novo entra em QA até ser liberado). Ausente = sem restrição. */
  autonomyReleasedFindingKinds?: readonly string[]
  /** V1.5.9 — modos de afirmação do redator exigidos para autonomia (o contrato validado nos gates). Ausente = não exigido. */
  autonomyClaimModes?: { effect: string; action: readonly string[] }
  /** V1.5.9 — evidência do item que é afirmação de procedimento não verificada → QA (dúvida por ITEM, não pela interação). */
  holdOnItemProcedureAssertion?: boolean
  /**
   * V1.5.9 — AUDITORIA PÓS-ENTREGA (conceito, NÃO implementado): uma amostra de AUTO_DELIVER pode ir ao QA DEPOIS de entregue.
   * É auditoria do INIA, nunca aprovação prévia: não bloqueia nem atrasa a entrega. `sampleRate` 0 = desligada.
   */
  postDeliveryAudit?: { sampleRate: number; note: string }
  note: string
}

/**
 * POLÍTICA DO PILOTO: todo item estruturalmente entregável fica HOLD_FOR_QA. É uma PILOT POLICY (rollout/calibração), não
 * regra do domínio — os critérios de autonomia continuam sendo avaliados e gravados (`autonomyEligible`), para medir
 * depois quais itens teriam sido entregues sozinhos e quantos deles o QA editou/rejeitou (falsos positivos da autonomia).
 */
export const FEEDBACK_PILOT_DELIVERY_POLICY: FeedbackDeliveryPolicy = {
  version: "FEEDBACK_DELIVERY_POLICY_PILOT_V1",
  holdAllForQa: true,
  requireQaForSections: [],
  requireQaForFindingKinds: [],
  autonomyOwnership: ["AGENT"],
  nonBlockingUncertainties: ["SINGLE_INTERACTION"],
  note: "piloto: 100% dos feedbacks entregáveis passam por QA de qualidade até haver evidência de produção suficiente",
}

/**
 * V1.5.9 — POLÍTICA AUTÔNOMA: QA é EXCEÇÃO, não o caminho padrão.
 *
 *   FEEDBACK CLARO E SEGURO → AUTO_DELIVER · FEEDBACK AMBÍGUO → HOLD_FOR_QA (com motivo estruturado) · INSEGURO → BLOCKED.
 *
 * Cada campo tem um motivo verificável (nada "por segurança"):
 * - `autonomyReleasedFindingKinds`: STRENGTH e FRICTION têm revisão humana cega nos gates do Writer (V1.4.9c/V1.4.9f/V1.5.2:
 *   STRENGTH 21 amostras, FRICTION 7) e as falhas observadas hoje são barradas por readiness (sem evidência exibível) ou pelos
 *   validadores de fronteira (efeito garantido, ação declarada). CONTRADICTION (2 amostras) e UNRESOLVED_NEED (1) NÃO têm
 *   evidência de autonomia — e os dois afirmam ERRO/resultado atribuído ao operador (o risco de causalidade que ainda não tem
 *   guarda automática, ver NO_CAUSAL_UPGRADE). Ficam em QA até serem liberados com dados de produção.
 * - `nonBlockingUncertainties`: incertezas da INTERAÇÃO que não tornam ESTE item obscuro — SINGLE_INTERACTION (sempre
 *   verdadeira), ITEMS_EXCLUDED (um irmão sem evidência foi excluído; este item tem a própria), PROCEDURAL_COVERAGE_PARTIAL
 *   (diz respeito a itens procedimentais, bloqueados à parte) e PROCEDURE_PENDING_VERIFICATION (tratada POR ITEM por
 *   `holdOnItemProcedureAssertion`). FRAME_NOT_RETURNED/FRAME_EMPTY/NO_FINDINGS continuam bloqueando (dúvida real sobre a análise).
 * - `autonomyClaimModes`: o contrato do redator validado (efeito POTENTIAL_ONLY, ação DECLARED_ONLY).
 * Fallback NUNCA é AUTO_DELIVER (WRITER_FALLBACK_USED → HOLD_FOR_QA; a elegibilidade de entrega também recusa fallback).
 */
export const FEEDBACK_AUTONOMOUS_DELIVERY_POLICY: FeedbackDeliveryPolicy = {
  version: "FEEDBACK_DELIVERY_POLICY_AUTONOMOUS_V1",
  holdAllForQa: false,
  requireQaForSections: [],
  requireQaForFindingKinds: [],
  autonomyOwnership: ["AGENT"],
  nonBlockingUncertainties: ["SINGLE_INTERACTION", "ITEMS_EXCLUDED", "PROCEDURAL_COVERAGE_PARTIAL", "PROCEDURE_PENDING_VERIFICATION"],
  autonomyReleasedFindingKinds: ["STRENGTH", "FRICTION"],
  autonomyClaimModes: { effect: "POTENTIAL_ONLY", action: ["DECLARED_ONLY"] },
  holdOnItemProcedureAssertion: true,
  postDeliveryAudit: { sampleRate: 0, note: "futuro: amostra de AUTO_DELIVER avaliada no QA depois da entrega (auditoria, não aprovação)" },
  note: "autônoma: QA só para exceção com motivo estruturado; STRENGTH/FRICTION claros vão direto ao colaborador",
}

/** Políticas conhecidas por versão (configuração de runtime escolhe uma; histórico continua legível). */
export const FEEDBACK_DELIVERY_POLICIES = { PILOT_V1: FEEDBACK_PILOT_DELIVERY_POLICY, AUTONOMOUS_V1: FEEDBACK_AUTONOMOUS_DELIVERY_POLICY } as const

/** Versão da política que criou as revisões da V1.5.4 (antes da separação geração × QA) — usada só para dados legados. */
export const LEGACY_PILOT_REVIEW_POLICY_VERSION = "FEEDBACK_PILOT_REVIEW_POLICY_V1" as const

/** O resultado do redator para UM item (null = o item não foi ao redator). `claimModes` = modos sob os quais o item foi escrito. */
export type WriterItemOutcome = { invoked: boolean; writerError: string | null; source: "WRITER" | "FALLBACK"; violations: readonly WordingViolation[]; wording: ItemWording; claimModes?: { effect: string; action: string } }

const EFFECT_BOUNDARY_VIOLATIONS: readonly WordingViolation[] = ["GUARANTEED_EFFECT", "COMPREHENSION_UNOBSERVED"]

export type FeedbackDeliveryDecision = {
  disposition: FeedbackDisposition
  structural: StructuralDeliverability
  reasons: DispositionReason[]
  policyVersion: string
  /** Critérios de autonomia atendidos, INDEPENDENTE da política (null = não avaliável: item bloqueado). */
  autonomyEligible: boolean | null
  autonomyBlockers: AutonomyBlocker[]
}

const hasPersonalData = (text: string) => redactEvidentPii(text).redactions.length > 0 || hasUnmaskedNumericIdentifier(text)
const isProcedural = (item: InteractionFeedbackItem) => item.provenance.proceduralLineage !== null || item.guidance.source === "KB_RULE" || item.interpretation.kind === "PROCEDURAL_DIVERGENCE"

/** Bloqueio ESTRUTURAL de um item de colaborador (null = estruturalmente entregável). Não depende de política. */
export function structuralBlockOf(item: InteractionFeedbackItem, hasWriterItem: boolean): StructuralBlockReason | null {
  if (item.delivery.blocked) return item.delivery.blocked
  if (!COLLABORATOR_SECTIONS.includes(item.section) || !item.delivery.collaborator) return "NOT_COLLABORATOR_DELIVERABLE"
  // Defesa em profundidade: a evidência EXIBÍVEL não pode carregar dado pessoal (a projeção de display já mascara).
  if (item.displayEvidence.some((entry) => entry.status === "DISPLAYED" && hasPersonalData(entry.text))) return "EVIDENCE_PRIVACY_FAIL"
  if (!hasWriterItem) return "NO_COMMUNICABLE_GUIDANCE"
  return null
}

/** Critérios de autonomia de um item estruturalmente entregável (vazio = critérios atendidos). */
export function autonomyBlockersOf(item: InteractionFeedbackItem, feedback: Pick<InteractionFeedbackV1, "uncertainties">, writer: WriterItemOutcome, policy: FeedbackDeliveryPolicy): AutonomyBlocker[] {
  const blockers: AutonomyBlocker[] = []
  if (item.readiness.status !== "READY") blockers.push("READINESS_NOT_READY")
  if (isProcedural(item)) blockers.push("PROCEDURAL_CONTENT")
  if (!policy.autonomyOwnership.includes(item.interpretation.ownership)) blockers.push("OWNERSHIP_NOT_ALLOWED")
  if (feedback.uncertainties.some((entry) => !policy.nonBlockingUncertainties.includes(entry.code))) blockers.push("BLOCKING_UNCERTAINTY")
  if (!writer.invoked || writer.writerError) blockers.push("WRITER_NOT_PASSED")
  if (writer.source === "FALLBACK") blockers.push("WRITER_FALLBACK_USED")
  if (writer.violations.length > 0) blockers.push("WRITER_VALIDATION_FAILED")
  if (writer.violations.some((code) => EFFECT_BOUNDARY_VIOLATIONS.includes(code))) blockers.push("EFFECT_CLAIM_BOUNDARY_VIOLATED")
  if (writer.violations.includes("DECLARED_ACTION_UPGRADE")) blockers.push("ACTION_CLAIM_BOUNDARY_VIOLATED")
  if (policy.autonomyClaimModes && (!writer.claimModes || writer.claimModes.effect !== policy.autonomyClaimModes.effect || !policy.autonomyClaimModes.action.includes(writer.claimModes.action))) blockers.push("CLAIM_BOUNDARY_NOT_ENFORCED")
  if (policy.holdOnItemProcedureAssertion && item.fact.some((fact) => fact.evidenceType === "PROCEDURE_ASSERTION")) blockers.push("ITEM_EVIDENCE_UNVERIFIED_PROCEDURE_ASSERTION")
  if ([writer.wording.observed, writer.wording.whyItMatters, writer.wording.whatYouCanDo].some(hasPersonalData)) blockers.push("WORDING_PRIVACY_FLAG")
  return blockers
}

/**
 * DECISÃO DE ENTREGA de um item (pura, determinística). `writer` null = o item não foi ao redator.
 * Ordem: estrutura (BLOCKED) → critérios de autonomia (sempre calculados) → política (piloto/risco) → AUTO_DELIVER.
 */
export function decideItemDelivery(item: InteractionFeedbackItem, feedback: Pick<InteractionFeedbackV1, "uncertainties">, writer: WriterItemOutcome | null, policy: FeedbackDeliveryPolicy): FeedbackDeliveryDecision {
  const block = structuralBlockOf(item, writer !== null)
  if (block || !writer) return { disposition: "BLOCKED", structural: "BLOCKED", reasons: [block ?? "NO_COMMUNICABLE_GUIDANCE"], policyVersion: policy.version, autonomyEligible: null, autonomyBlockers: [] }
  const autonomyBlockers = autonomyBlockersOf(item, feedback, writer, policy)
  const policyHolds: PolicyHoldReason[] = [
    ...(policy.holdAllForQa ? ["PILOT_HOLD_ALL_FOR_QA" as const] : []),
    ...(policy.requireQaForSections.includes(item.section as "STRENGTH" | "OPPORTUNITY") ? ["RISK_POLICY_SECTION" as const] : []),
    ...(policy.requireQaForFindingKinds.includes(item.interpretation.kind) ? ["RISK_POLICY_FINDING_KIND" as const] : []),
    ...(policy.autonomyReleasedFindingKinds && !policy.autonomyReleasedFindingKinds.includes(item.interpretation.kind) ? ["FINDING_KIND_NOT_RELEASED_FOR_AUTONOMY" as const] : []),
  ]
  const base = { structural: "STRUCTURALLY_DELIVERABLE" as const, policyVersion: policy.version, autonomyEligible: autonomyBlockers.length === 0, autonomyBlockers }
  if (policyHolds.length > 0 || autonomyBlockers.length > 0) return { ...base, disposition: "HOLD_FOR_QA", reasons: [...policyHolds, ...autonomyBlockers] }
  return { ...base, disposition: "AUTO_DELIVER", reasons: ["AUTONOMY_CRITERIA_MET"] }
}

/** Resumo da execução: nada material = nada a entregar; evidência insuficiente = BLOCKED; senão o destino mais restritivo presente. */
export type RunDeliverySummary = { disposition: FeedbackDisposition | "NOTHING_TO_DELIVER"; counts: Record<FeedbackDisposition, number> }
export function summarizeRunDelivery(status: InteractionFeedbackV1["status"], decisions: readonly Pick<FeedbackDeliveryDecision, "disposition">[]): RunDeliverySummary {
  const counts = { AUTO_DELIVER: 0, HOLD_FOR_QA: 0, BLOCKED: 0 }
  for (const decision of decisions) counts[decision.disposition] += 1
  if (status === "INSUFFICIENT_EVIDENCE") return { disposition: "BLOCKED", counts }
  if (decisions.length === 0) return { disposition: "NOTHING_TO_DELIVER", counts }
  const disposition = counts.AUTO_DELIVER > 0 ? "AUTO_DELIVER" : counts.HOLD_FOR_QA > 0 ? "HOLD_FOR_QA" : "BLOCKED"
  return { disposition, counts }
}

// ---------------------------------------------------------------------------------------------
// ENTREGABILIDADE: estrutura × QA × entrega real
// ---------------------------------------------------------------------------------------------

/** Status de QA de um item com redação. NOT_SELECTED_FOR_QA = a política não o selecionou (AUTO_DELIVER). */
export type QaStatus = "PENDING_REVIEW" | "APPROVED_UNCHANGED" | "APPROVED_EDITED" | "REJECTED" | "NOT_SELECTED_FOR_QA"
export type DeliveryState = "BLOCKED" | "AWAITING_QA" | "QA_REJECTED" | "READY_FOR_DELIVERY" | "DELIVERED"

/**
 * O único lugar que decide se um item PODE ser entregue:
 *   BLOCKED                         → nunca (QA não desbloqueia);
 *   HOLD_FOR_QA                     → só depois de APPROVED_* (REJECTED nunca);
 *   AUTO_DELIVER                    → sim, exceto se um QA eventual (amostragem futura) o rejeitou.
 * `deliveredAt` = ACTUALLY_DELIVERED (nenhum fluxo grava nesta versão).
 */
export function deliveryStateOf(disposition: FeedbackDisposition, qaStatus: QaStatus | null, deliveredAt: Date | null): DeliveryState {
  if (disposition === "BLOCKED") return "BLOCKED"
  if (qaStatus === "REJECTED") return "QA_REJECTED"
  const cleared = disposition === "AUTO_DELIVER" ? qaStatus !== "PENDING_REVIEW" : qaStatus === "APPROVED_UNCHANGED" || qaStatus === "APPROVED_EDITED"
  if (!cleared) return "AWAITING_QA"
  return deliveredAt ? "DELIVERED" : "READY_FOR_DELIVERY"
}
