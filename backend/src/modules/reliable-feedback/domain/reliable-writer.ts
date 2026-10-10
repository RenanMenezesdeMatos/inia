import { facetPolarityOf } from "./evidence-polarity.js"
import { stripListMarker } from "../../knowledge/domain/knowledge-list.js"
import { cleanSectionHeading } from "./process-items.js"
import { z } from "zod"
import { detectPermanentTraitLanguage, detectProceduralConclusionLanguage, lexicalPolarityOf, stripInternalRefs } from "../../investigation/domain/evidence-gating.js"
import { INTERNAL_REF_PATTERN, SINGLE_INTERACTION_UNCERTAINTY } from "../../investigation/domain/interaction-feedback.js"
import {
  actionClaimModeFor,
  detectGuaranteedEffectLanguage,
  EFFECT_CLAIM_MODE,
  JSON_LEAKAGE,
  NORMATIVE_LANGUAGE,
  QUOTED,
  QUOTED_SPAN,
  slotPatternLanguage,
  TURN_REF,
  validateItemWording,
  WRITER_CONSTRAINTS,
  type ItemWording,
  type WriterItem,
} from "../../investigation/domain/interaction-feedback-writer.js"
import { canonicalFactsOf, type IndicatorCanonicalContext } from "../../indicators/domain/indicator-canonical-context.js"
import type { GuidanceGrounding } from "../../agents/domain/process-assessment-contract.js"
import { indicatorClaimViolations } from "./indicator-claims.js"
import { INDICATOR_PATTERN_KINDS, type ReliableItemDraft, type ReliableViolation, type ReliableWording } from "./reliable-feedback-item.js"
import { exampleContentAsFactIn, suggestedResponseScopeOf, suggestedResponseViolations, type KnowledgeContentKind, type SuggestedResponseScope } from "./suggested-response.js"
import { allowedNumbersFrom, causalIndicatorClaims, peerClaimsWithoutEvidence, segmentLabelClaims } from "./indicator-diagnosis-claims.js"
import { effectClaimsInContent } from "./effect-claims.js"
import { terms } from "./verified-omission.js"
import type { CheckpointEvidenceType } from "./verified-omission.js"
import { behaviorWordingOf, presentationLabelOf } from "./behavior-presentation.js"
import { isUnderstandingCheckQuestion } from "./action-semantics.js"

/**
 * V1.5.12 — CONTRATOS DO REDATOR DO FEEDBACK CONFIÁVEL (domínio puro).
 *
 * O Writer V2 (`FEEDBACK_WRITER_INPUT_V1` / `FEEDBACK_WRITER_PROMPT_V2`) é específico do InteractionFeedback direto: itens
 * vindos de frames semânticos, com significado DETERMINÍSTICO. O feedback vindo do Workflow tem uma peça a mais — a
 * INTERPRETAÇÃO da origem (Agent/Orquestrador), que não é evidência — e, no indicador, fatos CANÔNICOS em vez de trechos.
 * Por isso dois contratos NOVOS e versionados, com a mesma disciplina: mesma saída estrita
 * `{items:[{itemRef, observed, whyItMatters, whatYouCanDo}]}`, mesmos slots, mesma infraestrutura de chamada, validadores
 * comuns + fronteiras específicas e fallback determinístico do item inteiro (nunca aproveitamento parcial).
 *
 *   WORKFLOW_MONITORING_FEEDBACK_WRITER_INPUT_V1 → item = WriterItem (evidência exibível verificada) + `analysis` da origem;
 *   INDICATOR_FEEDBACK_WRITER_INPUT_V1           → item = fatos canônicos + `analysis` da origem (já filtrada).
 */
/** V1 = contratos da V1.5.12 (preservados só para o freeze dos prompts V1). V2 (V1.6.0) = origem da orientação por item
 * (`grounding`), regra da base VERIFICADA (título + trecho literal) e etapa do processo; campos de relevância e de
 * orientação OPCIONAIS — vazios quando não há fundamento. */
export const MONITORING_WRITER_INPUT_CONTRACT_V1 = "WORKFLOW_MONITORING_FEEDBACK_WRITER_INPUT_V1" as const
export const INDICATOR_WRITER_INPUT_CONTRACT_V1 = "INDICATOR_FEEDBACK_WRITER_INPUT_V1" as const
export const MONITORING_WRITER_INPUT_CONTRACT_V2 = "WORKFLOW_MONITORING_FEEDBACK_WRITER_INPUT_V2" as const
/** V1.7.1 — etapa (nome exibível, tipo da evidência, omissão verificada) e contexto LITERAL da regra (abertura, detalhe). */
export const MONITORING_WRITER_INPUT_CONTRACT_V3 = "WORKFLOW_MONITORING_FEEDBACK_WRITER_INPUT_V3" as const
/** V1.7.1a — escopo do EXEMPLO DE CONDUÇÃO por item (permitido? números que pode citar) e trecho de exemplo da base marcado. */
export const MONITORING_WRITER_INPUT_CONTRACT_V4 = "WORKFLOW_MONITORING_FEEDBACK_WRITER_INPUT_V4" as const
/** V1.7.1b — + resumo para a APRESENTAÇÃO pessoal (abertura/fechamento), sem nome. */
export const MONITORING_WRITER_INPUT_CONTRACT_V5 = "WORKFLOW_MONITORING_FEEDBACK_WRITER_INPUT_V5" as const
/** V1.7.1e — BEHAVIOR-FIRST: assunto do achado (`topic`, nunca o nome interno da etapa) e a REGRA OPERACIONAL da seção. */
export const MONITORING_WRITER_INPUT_CONTRACT = "WORKFLOW_MONITORING_FEEDBACK_WRITER_INPUT_V6" as const
export const INDICATOR_WRITER_INPUT_CONTRACT_V2 = "INDICATOR_FEEDBACK_WRITER_INPUT_V2" as const
/** V1.6.1 — itens de padrão do diagnóstico (`diagnosis`) e fronteiras de causa/pares/rótulo de motivo. */
export const INDICATOR_WRITER_INPUT_CONTRACT_V3 = "INDICATOR_FEEDBACK_WRITER_INPUT_V3" as const
/** V1.7.1b — + exemplo de condução nos padrões de desenvolvimento e resumo para a APRESENTAÇÃO pessoal. */
export const INDICATOR_WRITER_INPUT_CONTRACT = "INDICATOR_FEEDBACK_WRITER_INPUT_V4" as const

/**
 * V1.7.1b — RESUMO PARA A APRESENTAÇÃO (abertura/fechamento), calculado pelo sistema a partir dos itens. NUNCA leva nome: a
 * saudação com o primeiro nome do cadastro é do sistema e o nome não sai da INIA.
 */
export type WriterPresentationBrief = {
  subject: string
  developmentSteps: string[]
  strengthSteps: string[]
  /** Pontos em que o produto/processo não foi confirmado ("Vale confirmar o produto"). */
  attentionPoints: number
  confirmedProducts: string[]
  /** Indicador: nome, período e a comparação oficial com a meta; se houve análise de amostra. */
  indicator?: { name: string; period: string; comparison: string; sampleAnalyzed: boolean } | null
}
export function presentationBriefOf(label: string, items: readonly ReliableItemDraft[], extras: { confirmedProducts?: string[]; indicator?: WriterPresentationBrief["indicator"] } = {}): WriterPresentationBrief {
  // V1.7.1e — a apresentação fala de ASSUNTOS (rótulo do achado), nunca do nome interno da etapa.
  const stepName = (item: ReliableItemDraft) => presentationLabelOf(item) ?? item.process?.stepTitle ?? null
  const names = (section: string) => [...new Set(items.filter((item) => item.section === section && item.structuralBlock === null).flatMap((item) => { const name = stepName(item); return name ? [name] : [] }))]
  return { subject: label, developmentSteps: names("OPPORTUNITY"), strengthSteps: names("STRENGTH"), attentionPoints: items.filter((item) => item.section === "ATTENTION" && item.structuralBlock === null).length, confirmedProducts: extras.confirmedProducts ?? [], indicator: extras.indicator ?? null }
}

/**
 * V1.6.0 — GROUNDING DO TEXTO (aplicado por código, não só pedido no prompt):
 *   whatYouCanDo  só existe com orientação fundamentada (OFFICIAL_PROCEDURE/OFFICIAL_SERVICE_GUIDELINE sobre regra da base
 *                 verificada); com NO_GROUNDED_GUIDANCE precisa vir VAZIO — nada de "organize melhor", "seja mais objetivo".
 *   whyItMatters  só existe quando o item traz a regra da base (o porquê vem dela); sem regra, VAZIO.
 * Vazio ("") é a representação de "sem fundamento" em todo o feedback confiável (a renderização omite a seção).
 */
export const GROUNDING_CONSTRAINTS = [
  { code: "GUIDANCE_ONLY_WHEN_GROUNDED", text: "whatYouCanDo só quando guidanceGrounding for OFFICIAL_PROCEDURE ou OFFICIAL_SERVICE_GUIDELINE, e somente conforme o trecho da base do item; com NO_GROUNDED_GUIDANCE devolva null." },
  { code: "RELEVANCE_ONLY_WITH_KNOWLEDGE", text: "whyItMatters só quando o item trouxer a regra da base (knowledge); sem ela devolva null." },
  { code: "NO_GENERIC_TIPS", text: "Nunca escreva dica genérica sem fonte (organizar melhor, centralizar informações, ser mais objetivo, conversar com a liderança, acompanhar resultados)." },
] as const
export type GroundingViolation = "UNGROUNDED_GUIDANCE" | "UNGROUNDED_RELEVANCE"
export function groundingViolations(wording: ItemWording, input: { grounding: GuidanceGrounding; hasKnowledge: boolean }): GroundingViolation[] {
  const violations: GroundingViolation[] = []
  if (input.grounding === "NO_GROUNDED_GUIDANCE" && wording.whatYouCanDo.trim().length > 0) violations.push("UNGROUNDED_GUIDANCE")
  if (!input.hasKnowledge && wording.whyItMatters.trim().length > 0) violations.push("UNGROUNDED_RELEVANCE")
  return violations
}

const ANALYSIS_MAX_CHARS = 1200
const UUID_TEXT = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi
/** Interpretação da origem pronta para o redator: sem handles internos da investigação, sem UUID, cortada no limite. Ref que sobreviver = descartada. */
const clip = (value: string | null): string | null => {
  if (!value) return null
  const cleaned = stripInternalRefs(value).replace(UUID_TEXT, "").replace(/https?:\/\/\S+|\/materiais\/\S+/gi, "").trim()
  if (cleaned.length === 0 || INTERNAL_REF_PATTERN.test(cleaned)) return null
  return cleaned.length > ANALYSIS_MAX_CHARS ? `${cleaned.slice(0, ANALYSIS_MAX_CHARS)}…` : cleaned
}

export const ANALYSIS_CONSTRAINTS = [
  { code: "ANALYSIS_IS_INTERPRETATION", text: "O campo analysis é a interpretação de quem analisou o caso; use-o para entender qual é o ponto, mas afirme somente o que a evidência (ou os dados oficiais) do item mostra." },
  { code: "NO_PROCEDURE_FROM_ANALYSIS", text: "Não copie da analysis nome de procedimento, documento, regra, prazo, número ou obrigação: nada disso foi verificado." },
] as const

// ---------------------------------------------------------------------------------------------
// MONITORIA
// ---------------------------------------------------------------------------------------------

export type MonitoringWriterItem = WriterItem & {
  analysis: { observation: string | null; recommendation: string | null } | null
  /** V1.6.0 — origem da orientação e a etapa de processo (null no caminho legado). */
  grounding: GuidanceGrounding
  requirement: string | null
  /**
   * V1.7.1 — a ETAPA do item: nome exibível (da regra literal), tipo da evidência e o contexto LITERAL da regra (título da
   * seção, frase de abertura, trecho que diz como cumprir). Ausente em revisões anteriores à V1.7.1 (nada retroativo).
   */
  /** V1.7.1e — `topic`: o ASSUNTO do achado (rótulo de apresentação); o nome interno da etapa não vai ao modelo a partir do V6. */
  checkpoint?: { stepTitle: string | null; evidenceType: CheckpointEvidenceType | null; topic?: string | null; /** V1.7.1p — código do comportamento canônico (nunca vai ao modelo; usado pela guarda de especificidade). */ behavior?: string | null; /** V1.7.1i — etapa composta (nunca vai ao modelo; usada pelo texto do sistema). */ completeness?: { status: string; /** V1.7.1k */ family?: string; observed: string[]; absent: string[]; /** SUBITEM_APPLICABILITY_V1 */ notApplicable?: string[] } | null; /** V1.7.3 — ausência verificada exibida pela frase do sistema (nunca vai ao modelo). */ absenceShown?: boolean } | null
  knowledgeContext?: { heading: string | null; leadIn: string | null; quote: string; detail: string | null; detailIsExample?: boolean; /** V1.7.1d — tipo de cada trecho (não vai ao modelo; usado pelo texto de segurança). */ ruleKind?: KnowledgeContentKind | null; detailKind?: KnowledgeContentKind | null; /** V1.7.1e — regra operacional literal da mesma seção (null = a citada já é a regra). */ operativeRule?: string | null; /** V1.7.1k — item de lista escolhido (não vai ao modelo). */ step?: string | null } | null
  /** V1.7.1a — ESCOPO do exemplo de condução (calculado pelo código). Ausente em revisões anteriores = exemplo não permitido. */
  suggestedResponse?: SuggestedResponseScope | null
}
export type MonitoringWriterInput = {
  /** V1.7.1b: resumo para a abertura/fechamento (ausente em entradas anteriores). */
  presentation?: WriterPresentationBrief | null
  contract: typeof MONITORING_WRITER_INPUT_CONTRACT
  effectClaimMode: typeof EFFECT_CLAIM_MODE
  interactionLabel: string
  uncertainty: typeof SINGLE_INTERACTION_UNCERTAINTY
  items: MonitoringWriterItem[]
  constraints: { code: string; text: string }[]
  outputFields: readonly ["observed", "whyItMatters", "whatYouCanDo"]
}

const speakerOf = (role: string): string | null => (role === "OPERADOR" || role === "CLIENTE" || role === "EVENTO" ? role : null)

/** Item de monitoria no formato do Writer V2 (evidência exibível; significado seguro determinístico) + a interpretação da origem. */
export function toMonitoringWriterItem(item: ReliableItemDraft, slot: string): MonitoringWriterItem {
  return {
    slot,
    section: item.section as "STRENGTH" | "OPPORTUNITY",
    // O kind do Writer V2 é o do frame semântico; aqui só a polaridade/seção importam para os validadores.
    interpretation: { kind: item.kind as unknown as WriterItem["interpretation"]["kind"], polarity: item.polarity, scope: "INTERACTION_SPECIFIC", safeMeaning: item.safeMeaning },
    // Regra da base VERIFICADA ⇒ item KB_RULE: os validadores aceitam a linguagem da regra e a citação literal do trecho.
    // ruleText = TODOS os textos literais verificados da regra (abertura, etapa, detalhe), separados por um marcador que nenhuma
    // citação atravessa — é a fonte literal dos validadores (aspas e números).
    guidance: { source: item.knowledge ? "KB_RULE" : item.guidanceSource, mandatory: false, knowledge: item.knowledge ? { documentTitle: item.knowledge.documentTitle, ruleText: [item.knowledge.leadIn ?? null, item.knowledge.quote, item.knowledge.detail?.quote ?? null, item.knowledge.operativeRule?.quote ?? null].filter((text): text is string => Boolean(text)).join(RULE_TEXT_SEPARATOR) } : null },
    evidence: item.facts.map((fact) => ({ speaker: speakerOf(fact.role), text: fact.text, truncated: fact.truncated, wasRedacted: fact.masked })),
    evidenceWithheld: item.withheldFacts,
    actionClaimMode: actionClaimModeFor(),
    analysis: item.analysis ? { observation: clip(item.analysis.observation), recommendation: clip(item.analysis.recommendation) } : null,
    grounding: item.grounding,
    requirement: item.process?.requirement ?? null,
    checkpoint: item.process ? { stepTitle: item.process.stepTitle ?? null, evidenceType: item.process.evidenceType ?? null, topic: presentationLabelOf(item), ...(item.process.behavior?.code ? { behavior: item.process.behavior.code } : {}), ...(item.process.completeness ? { completeness: { status: item.process.completeness.status, family: item.process.completeness.family, observed: item.process.completeness.observed, absent: item.process.completeness.absent, ...(item.process.completeness.notApplicable?.length ? { notApplicable: item.process.completeness.notApplicable } : {}) } } : {}), ...(item.process.absenceDisplay ? { absenceShown: true } : {}) } : null,
    knowledgeContext: item.knowledge ? { heading: item.knowledge.heading, leadIn: item.knowledge.leadIn ?? null, quote: item.knowledge.quote, detail: item.knowledge.detail?.quote ?? null, detailIsExample: item.knowledge.detail?.contentKind === "EXAMPLE_CONTENT", ruleKind: item.knowledge.contentKind ?? "RULE_CONTENT", detailKind: item.knowledge.detail?.contentKind ?? null, operativeRule: item.knowledge.operativeRule?.quote ?? null, step: item.knowledge.step ?? null } : null,
    suggestedResponse: suggestedResponseScopeOf(item),
  }
}

export const RULE_TEXT_SEPARATOR = " ⁂ "
/** Textos da regra verificada do item (para "a fonte oficial sustenta a relação" e para a guarda de especificidade). */
export const ruleTextsOf = (item: Pick<MonitoringWriterItem, "guidance">) => (item.guidance.knowledge?.ruleText ?? "").split(RULE_TEXT_SEPARATOR).filter((text) => text.length > 0)

export function buildMonitoringWriterInput(label: string, items: readonly { item: ReliableItemDraft; slot: string }[], presentation: WriterPresentationBrief | null = null): MonitoringWriterInput {
  return {
    presentation,
    contract: MONITORING_WRITER_INPUT_CONTRACT,
    effectClaimMode: EFFECT_CLAIM_MODE,
    interactionLabel: label,
    uncertainty: SINGLE_INTERACTION_UNCERTAINTY,
    items: items.map(({ item, slot }) => toMonitoringWriterItem(item, slot)),
    constraints: [...WRITER_CONSTRAINTS.map((constraint) => ({ code: constraint.code, text: constraint.text })), ...ANALYSIS_CONSTRAINTS.map((constraint) => ({ ...constraint })), ...GROUNDING_CONSTRAINTS.map((constraint) => ({ ...constraint })), ...EXAMPLE_CONSTRAINTS.map((constraint) => ({ ...constraint }))],
    outputFields: ["observed", "whyItMatters", "whatYouCanDo"] as const,
  }
}

/**
 * V1.7.1f — EXEMPLO/SCRIPT NÃO É FATO (explícito no contexto do redator; o validador `exampleOnlyFactsIn` continua sendo quem
 * decide). No smoke V1.7.1e o redator escreveu "cinco dias úteis… por SMS", que só existia numa fala-modelo do documento.
 */
export const EXAMPLE_CONSTRAINTS = [
  { code: "EXAMPLE_IS_NOT_FACT", text: "Trechos de EXEMPLO do material (falas-modelo, scripts, detail com detailIsExample) nunca autorizam fato operacional: prazo, número, canal (SMS, e-mail, aplicativo), valor ou protocolo que só aparece num exemplo não entra em observed, whatYouCanDo, suggestedResponse nem na abertura/fechamento — use só o que está na regra verificada do item ou nas falas da chamada." },
] as const

/**
 * V1.7.1 — ESPECIFICIDADE (não genérico): num item nascido de uma ETAPA de processo com regra verificada, o texto precisa
 * nomear a etapa. `observed` compartilha ≥ 1 termo de conteúdo com (nome da etapa ∪ requisito ∪ trecho da regra) e
 * `whatYouCanDo`, quando existe, ≥ 1 termo com (trecho ∪ detalhe ∪ nome da etapa ∪ requisito). "Procure ser mais claro nas
 * orientações" não fala de etapa nenhuma → fallback (que é específico por construção). Não retroativo (sem `checkpoint`).
 */
export function genericWordingViolations(wording: ItemWording, item: MonitoringWriterItem): "GENERIC_WORDING"[] {
  if (!item.checkpoint || !item.guidance.knowledge) return []
  const step = new Set([...terms(item.checkpoint.stepTitle ?? ""), ...terms(item.checkpoint.topic ?? ""), ...terms(item.requirement ?? ""), ...ruleTextsOf(item).flatMap((text) => [...terms(text)]), ...behaviorVocabularyOf(item)])
  // V1.7.1m — flexão não é texto genérico: "pagas" nomeia a etapa "…foi paga" (termos de ≥ 4 letras, um começa pelo outro).
  const stepTerms = [...step]
  const shares = (text: string) => [...terms(text)].some((term) => step.has(term) || stepTerms.some((other) => Math.min(term.length, other.length) >= 4 && (term.startsWith(other) || other.startsWith(term))))
  // V1.7.4 — a mesma CLASSE DE OBJETO da regra também nomeia a etapa: prazo concreto ("até o meio-dia do dia seguinte") para uma
  // regra de "prazo" (a mesma detecção da verificação da paráfrase, `semanticConductAnchorOf`).
  const deadlineStep = [...ruleTextsOf(item), item.checkpoint.stepTitle ?? "", item.requirement ?? ""].some((text) => /(?<!\p{L})prazos?(?!\p{L})/iu.test(text))
  const namesObject = (text: string) => deadlineStep && facetPolarityOf("DEADLINE", text).polarity === "FULFILLED"
  if (!shares(wording.observed) && !namesObject(wording.observed)) return ["GENERIC_WORDING"]
  if (wording.whatYouCanDo.trim().length > 0 && !shares(wording.whatYouCanDo)) return ["GENERIC_WORDING"]
  // V1.7.1e (só itens V6, com `topic`) — com uma regra operacional disponível, "Como aplicar" nunca pode ser só "siga o
  // procedimento" / "observe a etapa": precisa dizer O QUE fazer diferente na próxima chamada.
  if (item.checkpoint.topic !== undefined && item.section === "OPPORTUNITY" && GENERIC_HOW_TO.test(wording.whatYouCanDo)) return ["GENERIC_WORDING"]
  return []
}
/**
 * V1.7.1p — VOCABULÁRIO DO COMPORTAMENTO (fechado). A regra de confirmação de entendimento costuma ser uma pergunta-modelo
 * ("As informações ficaram claras?") e o redator descreve o MESMO ato pela fala real ("perguntou se o cliente tinha alguma
 * dúvida") — sinônimo, não texto genérico. Só vale quando o comportamento canônico do item já é CONFIRM_UNDERSTANDING e a
 * evidência verificada do operador é uma pergunta de confirmação de entendimento (formulação controlada). Contradição com o
 * achado continua com os outros validadores (polaridade, efeito, compreensão não observada…).
 */
const BEHAVIOR_VOCABULARY: Readonly<Record<string, { terms: string; sustained: (item: MonitoringWriterItem) => boolean }>> = {
  CONFIRM_UNDERSTANDING: {
    terms: "dúvida dúvidas entendimento entender entendeu entendido compreensão compreender compreendeu claro clara claros claras esclarecer esclarecido",
    sustained: (item) => item.evidence.some((entry) => entry.speaker === "OPERADOR" && isUnderstandingCheckQuestion(entry.text)),
  },
}
function behaviorVocabularyOf(item: MonitoringWriterItem): string[] {
  const entry = item.checkpoint?.behavior ? BEHAVIOR_VOCABULARY[item.checkpoint.behavior] : undefined
  return entry && entry.sustained(item) ? [...terms(entry.terms)] : []
}

/**
 * V1.7.1p — "SEMPRE" EM ORIENTAÇÃO FUTURA ≠ PADRÃO PASSADO. No campo de orientação (whatYouCanDo = "Para manter"/"Como
 * aplicar"), uma frase DIRETIVA ("Continue informando o protocolo sempre ao final", "Mantenha…", "Na próxima chamada…") fala
 * do que fazer daqui em diante; só deixa de contar quando a frase não tem sujeito "você" ("Continue fazendo o que você sempre
 * faz" continua sendo afirmação sobre o histórico). "Costuma", "frequentemente" etc. continuam bloqueados em qualquer frase;
 * observed/whyItMatters seguem a regra rígida.
 */
const DIRECTIVE_OPENER = /^\W*(?:continue|mantenha|siga|procure|busque|tente|lembre(?:-se)?|informe|pergunte|confirme|explique|reforce|repita|use|utilize|ofere[çc]a|registre|cancele|verifique|na\s+pr[óo]xima|nas\s+pr[óo]ximas|no\s+pr[óo]ximo|nos\s+pr[óo]ximos)(?!\p{L})/iu
const SECOND_PERSON = /(?<!\p{L})(?:voc[êe]|vc)(?!\p{L})/iu
const SEMPRE = /(?<!\p{L})sempre(?!\p{L})/giu
export function guidancePatternLanguage(slot: keyof ItemWording, prose: string): string[] {
  if (slot !== "whatYouCanDo") return slotPatternLanguage(slot, prose)
  const prospective = prose
    .split(/(?<=[.!?…])\s+/u)
    .map((sentence) => (DIRECTIVE_OPENER.test(sentence) && !SECOND_PERSON.test(sentence) ? sentence.replace(SEMPRE, " ") : sentence))
    .join(" ")
  return slotPatternLanguage(slot, prospective)
}
/** Padrão/hábito no texto do redator com a exceção prospectiva acima (a checagem comum do Writer V2 fica intacta). */
function patternLanguageViolation(wording: ItemWording): boolean {
  return (["observed", "whyItMatters", "whatYouCanDo"] as const).some((slot) => guidancePatternLanguage(slot, wording[slot].replace(QUOTED_SPAN, " ")).length > 0)
}

const GENERIC_HOW_TO = /(?<!\p{L})(?:sig[ae]\s+o\s+(?:procedimento|documento|processo)(?!\s*:)|observe\s+a\s+etapa|inclua\s+a\s+etapa|procure\s+ser\s+mais\s+clar\p{L}*|cumpra\s+a\s+etapa)(?!\p{L})/iu

/** V1.7.1 — efeito garantido/causal em QUALQUER campo, permitido só quando a regra verificada do item o sustenta. */
export function effectViolations(wording: object, groundingTexts: readonly string[]): "GUARANTEED_EFFECT"[] {
  return effectClaimsInContent(wording, groundingTexts).length > 0 ? ["GUARANTEED_EFFECT"] : []
}

/**
 * V1.7.1a — o EXEMPLO DE CONDUÇÃO do item (vazio = sem exemplo) e o EXEMPLO DA BASE usado como fato em qualquer campo.
 * Revisões anteriores à V1.7.1a não têm escopo: qualquer exemplo é recusado (nada retroativo, nada permitido por omissão).
 */
export function suggestedResponseViolationsOf(wording: ReliableWording, item: Pick<MonitoringWriterItem, "suggestedResponse">): ReliableViolation[] {
  const scope = item.suggestedResponse ?? null
  const violations: ReliableViolation[] = [...suggestedResponseViolations(wording.suggestedResponse, scope)]
  if (scope && exampleContentAsFactIn([wording.observed, wording.whyItMatters, wording.whatYouCanDo, wording.suggestedResponse ?? ""], scope)) violations.push("EXAMPLE_CONTENT_AS_FACT")
  return violations
}

/** Mesmos validadores do Writer V2 (a interpretação da origem NUNCA é fonte literal: número/aspas só da evidência) + V1.7.1 + V1.7.1a. */
export function validateMonitoringWording(wording: ReliableWording, item: MonitoringWriterItem, label: string): ReliableViolation[] {
  return [...new Set<ReliableViolation>([
    // V1.7.1p — PATTERN_LANGUAGE decidido por `guidancePatternLanguage` ("sempre" em orientação futura não é padrão passado).
    ...validateItemWording(wording, item, label).filter((code) => code !== "PATTERN_LANGUAGE"),
    ...(patternLanguageViolation(wording) ? (["PATTERN_LANGUAGE"] as const) : []),
    ...groundingViolations(wording, { grounding: item.grounding, hasKnowledge: item.guidance.knowledge !== null }),
    ...effectViolations(wording, ruleTextsOf(item)),
    ...genericWordingViolations(wording, item),
    ...suggestedResponseViolationsOf(wording, item),
  ])]
}

/**
 * FALLBACK DETERMINÍSTICO V4 (V1.7.1d — o redator falhou, omitiu o item ou violou alguma regra). "Redator falhou" nunca vira
 * feedback genérico: com etapa, fala, regra e orientação oficial o sistema monta um texto ESPECÍFICO, sem fato novo.
 *   observed      o que aconteceu com a etapa (nome canônico): cumprida / declarada na fala / não identificada (omissão) / não
 *                 cumprida / formulação que o procedimento pede para evitar;
 *   whatYouCanDo  só com regra verificada e orientação oficial: a própria regra, citada literalmente quando é curta e de uma
 *                 linha (a regra de COMO cumprir, quando o detalhe é regra, vem antes da etapa); trecho longo → aponta a seção
 *                 citada logo abaixo; "evitar" → trocar a formulação pelo que o procedimento orienta;
 *   whyItMatters  vazio (a regra já é mostrada; benefício nunca é inventado);
 *   exemplo       só quando um EXEMPLO da base passa nas mesmas validações do exemplo do redator (sem número/canal que só o
 *                 exemplo sustenta); senão omitido — nunca "Procure…/Seja…/Siga o documento" no lugar.
 * O item continua indo ao QA (fonte FALLBACK), como antes; a evidência (fala, trecho, documento, seção) é do sistema.
 */
export const MONITORING_FALLBACK_VERSION = "MONITORING_FALLBACK_V5" as const
const MAX_QUOTED_RULE_CHARS = 180
const singleLine = (text: string | null | undefined) => {
  // V1.7.4 — o marcador de lista da base ("- Não prometer…") não entra na citação dirigida ao operador.
  const value = stripListMarker((text ?? "").replace(/^[“"«\s]+|[”"»\s]+$/g, "").trim()).trim()
  return value.length > 0 && value.length <= MAX_QUOTED_RULE_CHARS && !/\n/.test(value) ? value : null
}
const sectionOf = (heading: string | null | undefined) => (heading ? cleanSectionHeading(heading) : null)

/**
 * V1.7.1e — FALLBACK V5 = BEHAVIOR-FIRST: primeiro a frase de COMPORTAMENTO derivada da regra literal + falas verificadas
 * (`behaviorWordingOf`: "Você fez as perguntas para identificar…", "Você usou a formulação “É só aguardar”…", "Nesse momento
 * da chamada, faltou informar prazo…") e o "Como aplicar" a partir da REGRA OPERACIONAL da seção ("Na próxima chamada, informe
 * o prazo exibido na ferramenta"). Sem suporte para a frase, a formulação conservadora da V4 — com o ASSUNTO do achado, nunca
 * o nome interno da etapa.
 */
export function monitoringFallbackWording(item: MonitoringWriterItem): ItemWording {
  return monitoringFallbackOf(item).wording
}

/**
 * V1.7.1k — o texto de segurança é ESPECÍFICO quando a frase de comportamento veio da regra literal + falas verificadas (nunca
 * a formulação conservadora "aparece o que o procedimento orienta em…") e, num ponto de desenvolvimento, o "Como aplicar" diz o
 * que fazer (ação da regra/regra operacional citada) — não só "aplique o que a seção orienta".
 */
export function monitoringFallbackOf(item: MonitoringWriterItem): { wording: ItemWording; specific: boolean } {
  const knowledge = item.guidance.knowledge
  const context = item.knowledgeContext ?? null
  const topic = item.checkpoint?.topic ?? presentationLabelOf({ section: item.section, process: { stepTitle: item.checkpoint?.stepTitle ?? null }, knowledge: context ? { quote: context.quote, heading: context.heading } : null }) ?? item.checkpoint?.stepTitle ?? null
  const official = Boolean(knowledge) && item.grounding !== "NO_GROUNDED_GUIDANCE"
  const behavior = context
    ? behaviorWordingOf(
        {
          section: item.section,
          // V1.7.1m — o rótulo das frases é o título do comportamento (o mesmo do bloco), quando existe.
          process: { stepTitle: item.checkpoint?.stepTitle ?? null, evidenceType: item.checkpoint?.evidenceType ?? null, completeness: item.checkpoint?.completeness ?? null, behavior: item.checkpoint?.topic ? { title: item.checkpoint.topic } : null, ...(item.checkpoint?.absenceShown ? { absenceShown: true } : {}) },
          knowledge: { quote: context.quote, step: context.step ?? null, heading: context.heading, leadIn: context.leadIn, contentKind: context.ruleKind ?? "RULE_CONTENT", detail: context.detail ? { quote: context.detail, contentKind: context.detailKind ?? null } : null, operativeRule: context.operativeRule ? { quote: context.operativeRule } : null },
        },
        item.evidence.filter((entry) => entry.speaker === "OPERADOR").map((entry) => entry.text),
        official,
      )
    : { observed: null, whatYouCanDo: null }
  const about = topic ? `“${topic}”` : knowledge ? `o documento “${knowledge.documentTitle}”` : null
  if (item.section === "STRENGTH") {
    const declared = item.checkpoint?.evidenceType === "OBSERVED_DECLARATION"
    return {
      wording: {
        observed: behavior.observed ?? (about ? (declared ? `Na sua fala ao cliente, citada abaixo, aparece o que o procedimento orienta em ${about}.` : `Nesta chamada você conduziu bem ${about}, como o procedimento orienta.`) : "Nesta chamada foi observada uma etapa do processo cumprida."),
        whyItMatters: "",
        // V1.7.1k — lista de conferência com completude desconhecida: nada de "continue aplicando" (não se sabe se tudo foi feito).
        whatYouCanDo: official && !(item.checkpoint?.completeness?.family === "VERIFY" && item.checkpoint.completeness.status === "UNKNOWN") ? behavior.whatYouCanDo ?? (topic ? `Continue aplicando o que o procedimento orienta em “${topic}”.` : "") : "",
      },
      specific: behavior.observed !== null,
    }
  }
  const omission = item.checkpoint?.evidenceType === "VERIFIED_OMISSION" || item.checkpoint?.evidenceType === "UNVERIFIED_OMISSION"
  const doNot = context?.ruleKind === "DO_NOT_CONTENT"
  const observed = behavior.observed ?? (!about
    ? "Nesta chamada foi observado um ponto do processo que pode ser desenvolvido."
    : doNot
      ? `Nesta chamada apareceu uma formulação que o procedimento pede para evitar (${about}).`
      : omission
        ? `Nesta chamada não apareceu o que o procedimento orienta em ${about}.`
        : `Nesta chamada, o que o procedimento orienta em ${about} não foi seguido.`)
  const howTo = context?.detailKind === "RULE_CONTENT" ? singleLine(context.detail) : null
  const operative = singleLine(context?.operativeRule)
  const rule = context && context.ruleKind !== "EXAMPLE_CONTENT" && context.ruleKind !== "DO_NOT_CONTENT" ? singleLine(context.quote.replace(/[;:.,]+$/, "")) : null
  const section = sectionOf(context?.heading)
  const whatYouCanDo = !official || !knowledge
    ? ""
    : behavior.whatYouCanDo
      ?? (operative
        ? `Na próxima chamada, siga o que o procedimento orienta: “${operative}”`
        : doNot
          ? `Nos próximos atendimentos, troque essa formulação pelo que o procedimento orienta para esse momento${section ? ` (seção “${section}”)` : ""}.`
          : howTo
            ? `Na próxima chamada, siga o que o procedimento orienta: “${howTo}”`
            : rule
              ? `Na próxima chamada, siga o que o procedimento orienta: “${rule}”.`
              : section
                ? `Na próxima chamada, aplique o que o procedimento orienta na seção “${section}”, citada abaixo.`
                : "")
  const example = fallbackSuggestedResponse(item)
  const concreteHowTo = !official || !knowledge || behavior.whatYouCanDo !== null || Boolean(operative) || (!doNot && (Boolean(howTo) || Boolean(rule)))
  return { wording: { observed, whyItMatters: "", whatYouCanDo, ...(example ? { suggestedResponse: example } : {}) }, specific: behavior.observed !== null && concreteHowTo }
}

/** Exemplo de condução SEM modelo: só um exemplo da própria base que passa nas mesmas validações do exemplo do redator. */
function fallbackSuggestedResponse(item: MonitoringWriterItem): string | null {
  const context = item.knowledgeContext ?? null
  if (!context || !item.suggestedResponse?.allowed || context.detailKind !== "EXAMPLE_CONTENT") return null
  const candidate = singleLine(context.detail)
  if (!candidate) return null
  return suggestedResponseViolationsOf({ observed: "", whyItMatters: "", whatYouCanDo: "", suggestedResponse: candidate }, item).length === 0 ? candidate : null
}

// ---------------------------------------------------------------------------------------------
// INDICADOR
// ---------------------------------------------------------------------------------------------

/**
 * V1.6.1 — bloco do DIAGNÓSTICO num item de padrão (INDICATOR_DEVELOPMENT_PATTERN / INDICATOR_STRENGTH_PATTERN). Tudo pronto
 * pelo sistema: frase do motivo investigado, frase da contagem na amostra, etapa, falas verificadas do operador, regra da base
 * verificada e (quando existe) o agregado do grupo de referência. O redator só escreve a partir disso.
 */
export type IndicatorDiagnosisWriterBlock = {
  segment: string | null
  pattern: string
  requirement: string
  evidence: { speaker: string; text: string; truncated: boolean; masked: boolean }[]
  knowledge: { documentTitle: string; quote: string } | null
  peer: string | null
}
export type IndicatorWriterItem = {
  slot: string
  section: "STRENGTH" | "OPPORTUNITY"
  polarity: "POSITIVE" | "NEGATIVE"
  safeMeaning: string
  guidanceSource: "REINFORCEMENT" | "COACHING_SUGGESTION"
  /** Sem regra da base verificada: NO_GROUNDED_GUIDANCE (o texto não traz orientação). */
  grounding: GuidanceGrounding
  canonical: { indicatorName: string; value: string; target: string; direction: string; comparison: string; period: string }
  analysis: { summary: string | null; recommendation: string | null } | null
  /** V1.6.1 — só nos itens de padrão; ausente/null no item do fato oficial (e em revisões anteriores). */
  diagnosis?: IndicatorDiagnosisWriterBlock | null
  /** V1.7.1b — escopo do exemplo de condução (só padrão de DESENVOLVIMENTO com etapa, regra verificada e orientação oficial). */
  suggestedResponse?: SuggestedResponseScope | null
}
export type IndicatorWriterInput = {
  presentation?: WriterPresentationBrief | null
  contract: typeof INDICATOR_WRITER_INPUT_CONTRACT
  effectClaimMode: typeof EFFECT_CLAIM_MODE
  items: IndicatorWriterItem[]
  constraints: { code: string; text: string }[]
  outputFields: readonly ["observed", "whyItMatters", "whatYouCanDo"]
}

export const INDICATOR_WRITER_CONSTRAINTS = [
  { code: "CANONICAL_METRIC_ONLY", text: "Use somente os números dos dados oficiais do item e, nos itens com diagnosis, os números das frases de diagnóstico do próprio item; nunca outro número." },
  { code: "NO_METRIC_RECALC", text: "Não calcule nada: nada de diferença, percentual, média, conversão de unidade ou arredondamento novo." },
  { code: "TARGET_COMPARISON_REQUIRES_CANONICAL_DATA", text: "Sobre a meta, diga apenas o que a comparação oficial do item diz (dentro ou fora da meta)." },
  { code: "TREND_REQUIRES_CANONICAL_EVIDENCE", text: "Não fale de evolução, tendência ou comparação com outros períodos: o item só traz este período." },
  { code: "PERIOD_CLAIM_REQUIRES_MATCHING_PERIOD", text: "Fale somente do período informado no item." },
  { code: "NEVER_PATTERN", text: "Nunca descreva como hábito ou característica do colaborador; contagens da amostra só como 'em N de M atendimentos analisados'." },
  { code: "NO_CAUSALITY", text: "Nunca ligue um comportamento ao resultado do indicador por causa ou efeito (nada de 'porque', 'por isso', 'explica', 'para reduzir/melhorar o indicador')." },
  { code: "PEER_ONLY_WHEN_PRESENT", text: "Só mencione grupo de referência, colegas ou melhores resultados quando o item trouxer diagnosis.peer, com os números dele." },
  { code: "NO_SEGMENT_LABEL", text: "Nunca chame um motivo ou atendimento de simples, complexo, fácil ou difícil." },
  { code: "NO_INTENT_DIAGNOSIS", text: "Não diagnostique intenção, motivação ou estado emocional do colaborador." },
  { code: "NO_INVENTED_POLICY", text: "Não cite política, procedimento, regra ou obrigação fora de diagnosis.knowledge." },
  { code: "NO_AI_ATTRIBUTION", text: "Não diga que uma IA, a INIA ou um sistema detectou algo." },
  { code: "NO_DISCIPLINARY_LANGUAGE", text: "Não use linguagem disciplinar (advertência, punição, penalidade, infração)." },
  { code: "COACHING_IS_SUGGESTION", text: "A orientação é sugestão, nunca obrigação." },
  { code: "POTENTIAL_EFFECT_ONLY", text: "Benefício só como possibilidade para o atendimento, nunca para o indicador." },
  { code: "FILL_ONLY_WORDING", text: "Preencha somente observed, whyItMatters e whatYouCanDo de cada item; nada mais." },
  ...ANALYSIS_CONSTRAINTS,
] as const

const factByTopic = (item: ReliableItemDraft, topic: "SEGMENT" | "PATTERN" | "PEER") => item.facts.find((fact) => fact.topic === topic)?.text ?? null

export function toIndicatorWriterItem(item: ReliableItemDraft, slot: string, canonical: IndicatorCanonicalContext): IndicatorWriterItem {
  const facts = canonicalFactsOf(canonical)
  const pattern = factByTopic(item, "PATTERN")
  return {
    slot,
    section: item.section as "STRENGTH" | "OPPORTUNITY",
    polarity: item.polarity as "POSITIVE" | "NEGATIVE",
    safeMeaning: item.safeMeaning,
    guidanceSource: item.guidanceSource,
    grounding: item.grounding,
    canonical: { indicatorName: canonical.indicator.name, value: facts.valueText, target: facts.targetText ?? "", direction: facts.directionLabel, comparison: facts.comparisonLabel ?? "", period: facts.periodLabel },
    analysis: item.analysis ? { summary: clip(item.analysis.summary), recommendation: clip(item.analysis.recommendation) } : null,
    diagnosis: INDICATOR_PATTERN_KINDS.includes(item.kind) && pattern
      ? {
          segment: factByTopic(item, "SEGMENT"),
          pattern,
          requirement: item.process?.requirement ?? "",
          evidence: item.facts.filter((fact) => fact.role === "OPERADOR").map((fact) => ({ speaker: fact.role, text: fact.text, truncated: fact.truncated, masked: fact.masked })),
          knowledge: item.knowledge ? { documentTitle: item.knowledge.documentTitle, quote: item.knowledge.quote } : null,
          peer: factByTopic(item, "PEER"),
        }
      : null,
    suggestedResponse: suggestedResponseScopeOf(item),
  }
}

export function buildIndicatorWriterInput(items: readonly { item: ReliableItemDraft; slot: string }[], canonical: IndicatorCanonicalContext, presentation: WriterPresentationBrief | null = null): IndicatorWriterInput {
  return {
    presentation,
    contract: INDICATOR_WRITER_INPUT_CONTRACT,
    effectClaimMode: EFFECT_CLAIM_MODE,
    items: items.map(({ item, slot }) => toIndicatorWriterItem(item, slot, canonical)),
    constraints: [...INDICATOR_WRITER_CONSTRAINTS.map((constraint) => ({ code: constraint.code, text: constraint.text })), ...GROUNDING_CONSTRAINTS.map((constraint) => ({ ...constraint }))],
    outputFields: ["observed", "whyItMatters", "whatYouCanDo"] as const,
  }
}

/** Textos VERIFICADOS de um item de padrão: frases do sistema + etapa + regra literal da base e seu título (os únicos números
 * além dos canônicos — "até 5 dias úteis" da regra pode ser citado; nenhum número novo). */
const diagnosisTexts = (item: IndicatorWriterItem) => (item.diagnosis ? [item.diagnosis.segment ?? "", item.diagnosis.pattern, item.diagnosis.peer ?? "", item.diagnosis.requirement, item.diagnosis.knowledge?.quote ?? "", item.diagnosis.knowledge?.documentTitle ?? ""] : [])

/**
 * Validação de UM item do redator contra o item e o CONTEXTO CANÔNICO (nunca contra a interpretação da origem). V1.6.1: vale
 * para o fato oficial e para os padrões do diagnóstico — números só canônicos ou do diagnóstico do próprio item; sem causa
 * entre comportamento e indicador; pares só com evidência agregada; motivo nunca rotulado; linguagem de regra só com a regra
 * da base verificada do item.
 */
export function validateIndicatorWording(wording: ReliableWording, item: IndicatorWriterItem, canonical: IndicatorCanonicalContext): ReliableViolation[] {
  const slots = { observed: wording.observed, whyItMatters: wording.whyItMatters, whatYouCanDo: wording.whatYouCanDo }
  const all = Object.values(slots).join("\n")
  const violations = new Set<ReliableViolation>()
  // V1.7.1b — exemplo de condução só no padrão de desenvolvimento com base (escopo do código); revisões antigas sem escopo = recusado.
  for (const code of suggestedResponseViolationsOf(wording, item)) violations.add(code)
  const diagnosis = item.diagnosis ?? null
  const extraNumbers = allowedNumbersFrom(diagnosisTexts(item))
  if (Object.values(slots).some((value) => INTERNAL_REF_PATTERN.test(value) || TURN_REF.test(value))) violations.add("INTERNAL_REF")
  if (JSON_LEAKAGE.some((pattern) => pattern.test(all))) violations.add("INTERNAL_JSON_LEAKAGE")
  const lexical = lexicalPolarityOf(wording.observed.replace(QUOTED_SPAN, " "))
  const allowed = item.polarity === "POSITIVE" ? ["POSITIVE", "NEUTRAL"] : ["NEGATIVE", "NEUTRAL"]
  if (lexical && lexical !== "MIXED" && !allowed.includes(lexical)) violations.add("POLARITY_MISMATCH")
  for (const [slot, value] of Object.entries(slots) as [keyof ItemWording, string][]) {
    const prose = value.replace(QUOTED_SPAN, " ")
    if (guidancePatternLanguage(slot, prose).length > 0) violations.add("PATTERN_LANGUAGE")
    for (const code of indicatorClaimViolations(value, canonical, slot, extraNumbers)) violations.add(code)
  }
  const prose = all.replace(QUOTED_SPAN, " ")
  // EFFECT_CLAIM_MODE = POTENTIAL_ONLY: a guarda V1.4.9g (observed/whyItMatters) + V1.7.1 em TODOS os campos (efeito
  // garantido/causal só quando a regra verificada do item o sustenta).
  if ([wording.observed, wording.whyItMatters].some((value) => detectGuaranteedEffectLanguage(value.replace(QUOTED_SPAN, " ")).length > 0)) violations.add("GUARANTEED_EFFECT")
  for (const code of effectViolations(wording, [diagnosis?.knowledge?.quote ?? ""])) violations.add(code)
  if (detectPermanentTraitLanguage(prose).length > 0) violations.add("PERMANENT_TRAIT")
  if (detectProceduralConclusionLanguage(prose).length > 0) violations.add("PROCEDURAL_CONCLUSION_WITHOUT_KB")
  // Linguagem de regra/obrigação só quando o item traz a regra da base verificada (o mesmo princípio do KB_RULE da monitoria).
  if (!diagnosis?.knowledge && NORMATIVE_LANGUAGE.some((pattern) => pattern.test(prose))) violations.add("UNSUPPORTED_PROCEDURE")
  if (causalIndicatorClaims(all, { name: canonical.indicator.name, code: canonical.indicator.code }).length > 0) violations.add("CAUSAL_CLAIM")
  if (peerClaimsWithoutEvidence(all, Boolean(diagnosis?.peer)).length > 0) violations.add("PEER_CLAIM_WITHOUT_EVIDENCE")
  if (segmentLabelClaims(all).length > 0) violations.add("UNSUPPORTED_SEGMENT_LABEL")
  // Aspas só podem citar os fatos oficiais do item ou, no diagnóstico, a etapa, as falas verificadas e a regra da base.
  const literal = [item.canonical.indicatorName, item.canonical.value, item.canonical.target, item.canonical.period, ...(diagnosis ? [diagnosis.requirement, diagnosis.segment ?? "", diagnosis.pattern, ...diagnosis.evidence.map((entry) => entry.text), diagnosis.knowledge?.quote ?? "", diagnosis.knowledge?.documentTitle ?? ""] : [])].join(" ")
  for (const match of all.matchAll(QUOTED)) if (!literal.includes(match[1]!.trim())) violations.add("EVIDENCE_ALTERATION")
  // Revisões anteriores à V1.6.0 não têm `grounding` (nada retroativo).
  if (item.grounding) for (const code of groundingViolations(wording, { grounding: item.grounding, hasKnowledge: Boolean(diagnosis?.knowledge) })) violations.add(code)
  return [...violations]
}

/**
 * FALLBACK determinístico do indicador (V1.6.0/V1.6.1): no fato oficial, SÓ o resultado do período; num padrão do diagnóstico,
 * SÓ a contagem da amostra + (com regra verificada) o que o documento orienta. Nunca dica genérica, nunca causa.
 */
export function indicatorFallbackWording(item: IndicatorWriterItem): ItemWording {
  const diagnosis = item.diagnosis ?? null
  if (diagnosis) {
    const rule = diagnosis.knowledge ? `O documento “${diagnosis.knowledge.documentTitle}” orienta: “${diagnosis.knowledge.quote}”.` : ""
    return {
      observed: diagnosis.pattern,
      whyItMatters: rule,
      whatYouCanDo: diagnosis.knowledge && item.section === "OPPORTUNITY" && item.grounding !== "NO_GROUNDED_GUIDANCE" ? `Nos próximos atendimentos desse motivo, siga o que orienta o documento “${diagnosis.knowledge.documentTitle}”.` : "",
    }
  }
  const { indicatorName, value, target, period, direction } = item.canonical
  if (item.section === "STRENGTH") return { observed: `No período de ${period}, o resultado oficial de ${indicatorName} foi ${value}, dentro da meta de ${target}.`, whyItMatters: "", whatYouCanDo: "" }
  return { observed: `No período de ${period}, o resultado oficial de ${indicatorName} foi ${value}, fora da meta de ${target} (${direction}).`, whyItMatters: "", whatYouCanDo: "" }
}

// ---------------------------------------------------------------------------------------------
// RESOLUÇÃO: saída do redator → wording por item (válido ou fallback inteiro)
// ---------------------------------------------------------------------------------------------

const wordingText = z.string().trim().min(1).max(600)
/** V1.6.0: relevância e orientação são OPCIONAIS — null (ou vazio) = sem fundamento; a representação interna é "". */
const optionalWordingText = z.string().trim().max(600).nullable().transform((value) => value ?? "")
/** V1.7.1a — `suggestedResponse` opcional (saída V3 da monitoria); ausente nas saídas anteriores e no indicador. */
const slotItemSchema = z.object({ slot: z.string(), observed: wordingText, whyItMatters: optionalWordingText, whatYouCanDo: optionalWordingText, suggestedResponse: optionalWordingText.optional() }).strict()
/** V1.7.1b — `presentation` (abertura/fechamento) opcional no envelope; lido à parte por `presentationDraftOf`. */
const outputSchema = z.object({ items: z.array(z.unknown()), presentation: z.unknown().optional() }).strict()
const presentationDraftSchema = z.object({ introduction: z.string().trim().min(1).max(900), closing: z.string().trim().min(1).max(900) }).strict()
export const reliablePresentationSchema = presentationDraftSchema
/** A abertura/fechamento que o redator devolveu (forma válida) — a validação de CONTEÚDO é da apresentação (feedback-presentation). */
export function presentationDraftOf(rawOutput: unknown): { introduction: string; closing: string } | null {
  const parsed = presentationDraftSchema.safeParse((rawOutput as { presentation?: unknown } | null)?.presentation)
  return parsed.success ? parsed.data : null
}

/**
 * V1.7.1h — DEGRADAÇÃO POR CAMPO (`WRITER_FIELD_VALIDATION_V1`, determinística, sem modelo).
 *
 * Antes, um campo inválido derrubava o texto inteiro do item para o fallback (e o item ia ao QA): no smoke V1.7.1f o redator
 * escreveu um bom ponto sobre prazo, mas o EXEMPLO DE CONDUÇÃO inventou "5 dias úteis". Agora:
 *
 *   CORE        `observed` — a afirmação do que aconteceu (conclusão de força/desenvolvimento, comportamento, evidência).
 *   DEGRADÁVEL  cada campo complementar, SÓ pelos códigos que dizem respeito ao próprio campo:
 *                 whyItMatters       sem regra que sustente a relevância                          → DROPPED (vazio = sem fundamento);
 *                 whatYouCanDo       orientação sem fundamento oficial ou genérica ("siga o procedimento") → texto determinístico do
 *                                    fallback para ESSE campo (FALLBACK_FIELD), senão DROPPED;
 *                 suggestedResponse  exemplo fora do escopo/sem fonte: número, fato, canal que só o exemplo da base traz, não é
 *                                    fala, marcador de lacuna, genérico, dado pessoal → exemplo do fallback se houver, senão DROPPED.
 *   V1.7.1i     efeito garantido/causa só no campo complementar também degrada SÓ esse campo (antes derrubava o item — no smoke
 *               V1.7.1h, "Continue X para garantir Y" levou escuta, protocolo e confirmação ao QA). No núcleo, continua invalidando.
 *   ITEM        qualquer outro código — polaridade trocada, evidência alterada, efeito garantido/causa NO NÚCLEO, padrão/traço,
 *               procedimento/regra inventados (número inventado em whatYouCanDo/whyItMatters é regra inventada), ref interna, JSON,
 *               ação declarada vendida como executada, compreensão não observada — ou qualquer falha do CORE ⇒ INVALIDATED_ITEM:
 *               o item inteiro vai para o fallback, como sempre (nunca se tenta adivinhar a intenção do redator).
 *
 * Atribuição sem heurística: valida o CORE sozinho (complementares vazios), depois CORE + cada campo sozinho; o texto montado é
 * validado de novo inteiro — qualquer violação que só apareça na combinação invalida o item. Item degradado continua fonte
 * WRITER, sem violação de item (não vai ao QA só por isso); o que aconteceu com cada campo fica em `fields`.
 */
export const WRITER_FIELD_VALIDATION_VERSION = "WRITER_FIELD_VALIDATION_V1" as const
export type WriterField = "observed" | "whyItMatters" | "whatYouCanDo" | "suggestedResponse"
export type WriterFieldAction = "KEPT" | "DROPPED" | "FALLBACK_FIELD" | "INVALIDATED_ITEM"
export type WriterFieldValidation = { field: WriterField; codes: ReliableViolation[]; action: WriterFieldAction }
type DegradableField = Exclude<WriterField, "observed">
const DEGRADABLE_FIELDS: readonly DegradableField[] = ["whyItMatters", "whatYouCanDo", "suggestedResponse"]
/** V1.7.1i — efeito garantido/causa num campo COMPLEMENTAR ("Continue X para garantir Y") não contamina o núcleo: sai o campo. */
const COMPLEMENTARY_CLAIM_CODES = ["GUARANTEED_EFFECT", "CAUSAL_CLAIM"] as const
export const DEGRADABLE_CODES: Record<DegradableField, ReadonlySet<string>> = {
  // V1.7.1j — fato que só existe na fala-modelo da base ("por SMS", "cinco dias úteis") num campo complementar: o campo sai (o
  // texto do sistema para esse campo nunca o traz); no núcleo continua invalidando o item.
  whyItMatters: new Set(["UNGROUNDED_RELEVANCE", "COMPREHENSION_UNOBSERVED", "EXAMPLE_CONTENT_AS_FACT", ...COMPLEMENTARY_CLAIM_CODES]),
  // V1.7.1p — padrão/hábito só na orientação: o campo sai (texto do sistema), o achado válido continua.
  whatYouCanDo: new Set(["UNGROUNDED_GUIDANCE", "GENERIC_WORDING", "EXAMPLE_CONTENT_AS_FACT", "PATTERN_LANGUAGE", ...COMPLEMENTARY_CLAIM_CODES]),
  suggestedResponse: new Set(["SUGGESTED_RESPONSE_NOT_ALLOWED", "SUGGESTED_RESPONSE_NOT_SPEECH", "SUGGESTED_RESPONSE_PLACEHOLDER", "SUGGESTED_RESPONSE_UNCOVERED_ACTION", "UNSUPPORTED_NUMBER", "UNSUPPORTED_FACT", "EXAMPLE_CONTENT_AS_FACT", "GENERIC_WORDING", "PRIVACY_DATA", ...COMPLEMENTARY_CLAIM_CODES]),
}

/** V1.7.1k — o texto de segurança usado no lugar do redator: é específico (`monitoringFallbackOf`) e passa nos MESMOS validadores? */
export type FallbackCheck = { specific: boolean; violations: ReliableViolation[] }
export type SlotResolution = { slot: string; source: "WRITER" | "FALLBACK"; wording: ReliableWording; violations: ReliableViolation[]; /** V1.7.1h — o que aconteceu com cada campo do redator (vazio = saída ausente). */ fields: WriterFieldValidation[]; /** V1.7.1k — só com fonte FALLBACK. */ fallbackCheck?: FallbackCheck }

const valueOf = (wording: ReliableWording, field: WriterField) => (field === "suggestedResponse" ? wording.suggestedResponse ?? "" : wording[field])
const withField = (wording: ReliableWording, field: DegradableField, value: string): ReliableWording => {
  if (field !== "suggestedResponse") return { ...wording, [field]: value }
  const rest: ReliableWording = { observed: wording.observed, whyItMatters: wording.whyItMatters, whatYouCanDo: wording.whatYouCanDo }
  return value.trim().length > 0 ? { ...rest, suggestedResponse: value } : rest
}

/** Resolução de UM item: saída inteira, núcleo + campos degradados, ou fallback do item inteiro. */
export function resolveWordingFields<TItem>(wording: ReliableWording, item: TItem, validate: (wording: ReliableWording, item: TItem) => ReliableViolation[], fallback: (item: TItem) => ReliableWording, specificity?: (item: TItem) => boolean): Omit<SlotResolution, "slot"> {
  const present = (["observed", ...DEGRADABLE_FIELDS] as WriterField[]).filter((field) => valueOf(wording, field).trim().length > 0)
  const all = validate(wording, item)
  if (all.length === 0) return { source: "WRITER", wording, violations: [], fields: present.map((field) => ({ field, codes: [], action: "KEPT" })) }
  const invalidate = (fields: WriterFieldValidation[]): Omit<SlotResolution, "slot"> => { const safe = fallback(item); return { source: "FALLBACK", wording: safe, violations: all, fields, fallbackCheck: { specific: specificity?.(item) ?? false, violations: validate(safe, item) } } }
  const core: ReliableWording = { observed: wording.observed, whyItMatters: "", whatYouCanDo: "" }
  const coreCodes = validate(core, item)
  if (coreCodes.length > 0) return invalidate([{ field: "observed", codes: coreCodes, action: "INVALIDATED_ITEM" }])
  const fields: WriterFieldValidation[] = [{ field: "observed", codes: [], action: "KEPT" }]
  let assembled = core
  let safe: ReliableWording | null = null
  for (const field of DEGRADABLE_FIELDS) {
    const value = valueOf(wording, field)
    if (value.trim().length === 0) continue
    const codes = validate(withField(core, field, value), item)
    if (codes.length === 0) { assembled = withField(assembled, field, value); fields.push({ field, codes, action: "KEPT" }); continue }
    if (!codes.every((code) => DEGRADABLE_CODES[field].has(code))) return invalidate([...fields, { field, codes, action: "INVALIDATED_ITEM" }])
    safe = safe ?? fallback(item)
    const replacement = valueOf(safe, field)
    const usable = replacement.trim().length > 0 && validate(withField(core, field, replacement), item).length === 0
    assembled = withField(assembled, field, usable ? replacement : "")
    fields.push({ field, codes, action: usable ? "FALLBACK_FIELD" : "DROPPED" })
  }
  // A combinação precisa continuar válida (violação que só aparece com os campos juntos invalida o item).
  if (validate(assembled, item).length > 0) return invalidate([...fields, { field: "observed", codes: validate(assembled, item), action: "INVALIDATED_ITEM" }])
  return { source: "WRITER", wording: assembled, violations: [], fields }
}

/** Genérico: para cada slot, a saída do redator validada POR CAMPO (V1.7.1h) ou o fallback do item inteiro. */
export function resolveSlots<TItem extends { slot: string }>(items: readonly TItem[], rawOutput: unknown, validate: (wording: ReliableWording, item: TItem) => ReliableViolation[], fallback: (item: TItem) => ReliableWording, specificity?: (item: TItem) => boolean): SlotResolution[] {
  const parsed = outputSchema.safeParse(rawOutput)
  const bySlot = new Map<string, unknown>()
  if (parsed.success) for (const entry of parsed.data.items) { const slot = (entry as { slot?: unknown } | null)?.slot; if (typeof slot === "string" && !bySlot.has(slot)) bySlot.set(slot, entry) }
  return items.map((item) => {
    const candidate = slotItemSchema.safeParse(bySlot.get(item.slot))
    if (!candidate.success) { const safe = fallback(item); return { slot: item.slot, source: "FALLBACK", wording: safe, violations: ["SCHEMA"], fields: [], fallbackCheck: { specific: specificity?.(item) ?? false, violations: validate(safe, item) } } }
    const wording: ReliableWording = { observed: candidate.data.observed, whyItMatters: candidate.data.whyItMatters, whatYouCanDo: candidate.data.whatYouCanDo, ...(candidate.data.suggestedResponse ? { suggestedResponse: candidate.data.suggestedResponse } : {}) }
    return { slot: item.slot, ...resolveWordingFields(wording, item, validate, fallback, specificity) }
  })
}
