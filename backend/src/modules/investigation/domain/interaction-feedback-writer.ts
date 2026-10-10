import { z } from "zod"
import { unsupportedTypedNumbers } from "../../reliable-feedback/domain/typed-number-grounding.js"
import { detectPermanentTraitLanguage, detectProceduralCompletenessLanguage, detectProceduralConclusionLanguage, detectStrongPatternLanguage, lexicalPolarityOf } from "./evidence-gating.js"
import { INTERNAL_REF_PATTERN, SINGLE_INTERACTION_UNCERTAINTY, type FeedbackSection, type GuidanceSource, type InteractionFeedbackItem, type InteractionFeedbackStatus, type InteractionFeedbackV1, type ItemDeliveryBlock } from "./interaction-feedback.js"
import type { InteractionFindingKind } from "./interaction-semantic-frame.js"
import { type DisplayEvidence, type DisplayEvidenceResult, type WithheldEvidence } from "./feedback-display-evidence.js"
import { detectTemporalLanguage } from "./temporal-semantics.js"
import type { ClaimPolarity } from "./tool-trace.js"

/**
 * V1.4.9b — DISPLAY EVIDENCE + FEEDBACK WRITER INPUT CONTRACT (domínio puro, sem modelo, sem fiação).
 *
 *   raw verified evidence (provenance do InteractionFeedback, intacta)
 *     → DISPLAY EVIDENCE (redaction só de fragmentos sensíveis, pela MESMA lista canônica da projeção de pares;
 *       fail-closed: o que não pode ser mascarado com segurança não é exibido nem enviado)
 *     → FEEDBACK WRITER INPUT V1 (só o necessário para escrever: seção, evidência exibível, significado seguro, fonte da
 *       orientação, regra da base quando KB_RULE, rótulo, constraints — nenhum handle, ref, provenance ou texto de modelo)
 *     → saída do redator (só wording.observed / whyItMatters / whatYouCanDo) validada por item; qualquer violação ⇒ fallback
 *       determinístico do item inteiro (nunca aproveitamento parcial).
 */
export const FEEDBACK_WRITER_INPUT_CONTRACT = "FEEDBACK_WRITER_INPUT_V1" as const

export * from "./feedback-display-evidence.js"

// ---------------------------------------------------------------------------------------------
// CONSTRAINTS DE LINGUAGEM (contrato do redator)
// ---------------------------------------------------------------------------------------------

export const WRITER_CONSTRAINTS = [
  { code: "ONLY_THIS_INTERACTION", text: "Fale somente sobre esta interação." },
  { code: "NEVER_PATTERN", text: "Nunca descreva como padrão, hábito, tendência ou característica do colaborador (nada de 'costuma', 'sempre', 'frequentemente')." },
  { code: "NO_INTENT_DIAGNOSIS", text: "Não diagnostique intenção, motivação ou estado emocional do colaborador." },
  { code: "NO_UNSUPPORTED_CAUSE", text: "Não afirme causa ou consequência que a evidência não mostra." },
  { code: "NO_INVENTED_POLICY", text: "Não cite política, procedimento ou regra além do documento informado no item." },
  { code: "NO_INVENTED_NUMBERS", text: "Não escreva número, prazo, valor ou meta que não esteja na evidência ou na regra do item." },
  { code: "NO_SYSTEM_EXECUTION_CLAIM", text: "Não afirme que algo foi executado ou registrado em sistema." },
  { code: "NO_INTERNAL_IDS", text: "Não mencione identificadores, códigos ou nomes de campos." },
  { code: "NO_AI_ATTRIBUTION", text: "Não diga que uma IA, a INIA ou um sistema detectou algo." },
  { code: "NO_DISCIPLINARY_LANGUAGE", text: "Não use linguagem disciplinar (advertência, punição, penalidade, infração)." },
  { code: "COACHING_IS_SUGGESTION", text: "Em COACHING_SUGGESTION, a orientação é sugestão, nunca obrigação." },
  { code: "NORMATIVE_ONLY_WITH_KB_RULE", text: "Linguagem normativa ('deve', 'é obrigatório') só em item KB_RULE e só sobre a regra informada." },
  { code: "PRESERVE_EVIDENCE", text: "Se citar a evidência entre aspas, copie o texto exibível exatamente; nunca reconstrua dado mascarado ([CPF], [TELEFONE]…)." },
  { code: "FILL_ONLY_WORDING", text: "Preencha somente observed, whyItMatters e whatYouCanDo de cada item; nada mais." },
  // V1.4.9g — CLAIM CEILING (effectClaimMode = POTENTIAL_ONLY).
  { code: "POTENTIAL_EFFECT_ONLY", text: "Benefício para o cliente só como possibilidade ('pode ajudar', 'contribui para'); nunca como resultado ocorrido ou garantido ('garante que', 'assegura que', 'fez com que o cliente entendesse')." },
  { code: "REINFORCE_OBSERVED_ONLY", text: "Em ponto positivo, reforce exatamente o comportamento observado na evidência; não o troque por outro comportamento que não aparece nela." },
  // V1.5.3 — CLAIM BOUNDARIES V2 (fronteiras vistas no smoke de produção V1.5.2).
  { code: "NO_CAUSAL_UPGRADE", text: "Sequência não é causa: descreva o que o operador disse e o que o cliente respondeu, lado a lado; não afirme que uma coisa levou, fez, provocou, gerou, causou ou resultou na outra, a menos que a própria evidência diga isso." },
  { code: "DECLARED_ACTION_ONLY", text: "Com actionClaimMode DECLARED_ONLY, uma ação que o operador diz ter feito é uma declaração: escreva que ele informou, declarou ou comunicou que fez; nunca afirme a ação como executada ou concluída." },
] as const
export type WriterConstraintCode = (typeof WRITER_CONSTRAINTS)[number]["code"]

// ---------------------------------------------------------------------------------------------
// FEEDBACK WRITER INPUT V1
// ---------------------------------------------------------------------------------------------

export type WriterEvidence = { speaker: string | null; text: string; truncated: boolean; wasRedacted: boolean }
export type WriterItem = {
  /** Posição no pedido ("ITEM_1") — o único identificador que o redator vê; o mapeamento para o item fica fora do payload. */
  slot: string
  section: "STRENGTH" | "OPPORTUNITY"
  interpretation: { kind: InteractionFindingKind; polarity: ClaimPolarity; scope: "INTERACTION_SPECIFIC"; safeMeaning: string }
  guidance: { source: Exclude<GuidanceSource, "NONE">; mandatory: boolean; knowledge: { documentTitle: string; ruleText: string | null } | null }
  evidence: WriterEvidence[]
  /** Trechos não enviados por privacidade (fail-closed) — só a contagem. */
  evidenceWithheld: number
  /** V1.5.3 — o que o texto pode afirmar sobre AÇÕES do operador (ver `actionClaimModeFor`). */
  actionClaimMode: ActionClaimMode
}

/**
 * V1.5.3 — ACTION CLAIM MODE (estrutural, nunca inferido do vocabulário do redator).
 *
 * A INIA analisa o que foi DITO na interação; não verifica execução em sistemas externos. Uma fala do operador "enviei",
 * "disparei", "alterei", "registrei"… prova que ele DECLAROU ter feito — não que a ação foi executada/concluída.
 *   DECLARED_ONLY          → ação só pode ser escrita como declaração ("você informou que enviou…").
 *   OBSERVED_EVENT_ALLOWED → RESERVADO: exigiria um evento estrutural independente que sustente a execução. Nenhuma
 *                            estrutura atual faz isso (EVENTO descreve a própria conversa — espera, sobreposição,
 *                            transferência — nunca um sistema externo), então nunca é produzido na V1.
 */
export const ACTION_CLAIM_MODES = ["DECLARED_ONLY", "OBSERVED_EVENT_ALLOWED"] as const
export type ActionClaimMode = (typeof ACTION_CLAIM_MODES)[number]
export function actionClaimModeFor(): ActionClaimMode {
  return "DECLARED_ONLY"
}
/**
 * V1.4.9g — CLAIM CEILING. O redator pode descrever o fato sustentado, explicar um benefício POTENCIAL, sugerir ação futura e
 * reforçar o comportamento observado; nunca transformar benefício potencial em resultado ocorrido/garantido no cliente sem
 * evidência desse resultado. V1 = sempre POTENTIAL_ONLY (efeito observado explicitamente seria outro contrato, futuro).
 */
export const EFFECT_CLAIM_MODE = "POTENTIAL_ONLY" as const

export type FeedbackWriterInputV1 = {
  contract: typeof FEEDBACK_WRITER_INPUT_CONTRACT
  effectClaimMode: typeof EFFECT_CLAIM_MODE
  interactionLabel: string
  uncertainty: typeof SINGLE_INTERACTION_UNCERTAINTY
  items: WriterItem[]
  constraints: { code: WriterConstraintCode; text: string }[]
  outputFields: readonly ["observed", "whyItMatters", "whatYouCanDo"]
}

/** Auditoria do payload (NUNCA enviada ao redator): slot → item do feedback e origem de cada evidência. */
export type WriterInputAudit = { blocked: BlockedWriterItem[]; slots: { slot: string; itemIndex: number; findingRef: string; evidence: (Pick<DisplayEvidence, "origin" | "status" | "redactionKinds"> | WithheldEvidence)[]; display: DisplayEvidenceResult[] }[] }

/** Item de colaborador que NÃO vai ao redator por política de entrega (hoje: conteúdo procedimental — divergência e aderência, `PROCEDURAL_MATCHING_DELIVERY_POLICY`). */
export type BlockedWriterItem = { itemIndex: number; findingRef: string; reason: ItemDeliveryBlock }

export type PreparedWriterInput =
  | { invoke: false; reason: Exclude<InteractionFeedbackStatus, "HAS_POINTS"> | "DELIVERY_BLOCKED"; audit: null | { blocked: BlockedWriterItem[] } }
  | { invoke: true; input: FeedbackWriterInputV1; audit: WriterInputAudit }

const SAFE_MEANING = (item: InteractionFeedbackItem): string => {
  const procedural = item.provenance.proceduralLineage !== null
  switch (item.interpretation.kind) {
    case "STRENGTH":
      return procedural ? "orientação do operador coerente com uma regra verificada da base, nesta interação" : "comportamento positivo do operador observado nesta interação"
    case "FRICTION":
      return "momento de atrito na conversa ligado à condução do operador, observado nesta interação"
    case "CONTRADICTION":
      return "informações conflitantes dadas pelo operador nesta interação"
    case "UNRESOLVED_NEED":
      return "necessidade do cliente que ficou em aberto, ligada à condução do operador nesta interação"
    case "PROCEDURAL_DIVERGENCE":
      return "orientação do operador divergente de uma regra verificada da base, limitada a este ponto desta interação"
    default:
      return item.interpretation.meaning
  }
}

const WRITER_SECTIONS: readonly FeedbackSection[] = ["STRENGTH", "OPPORTUNITY"]

/**
 * Item do redator a partir de um item do feedback — só o necessário para escrever. `knowledge` leva título + trecho literal da
 * regra (nunca `ruleRef` nem link: o link vem da estrutura e é anexado pela interface, nunca escrito pelo redator).
 */
export function toWriterItem(item: InteractionFeedbackItem, slot: string): { writerItem: WriterItem; display: DisplayEvidenceResult[] } | null {
  if (!WRITER_SECTIONS.includes(item.section) || item.guidance.source === "NONE") return null
  // A MESMA projeção de display que o compositor usou para decidir readiness (uma única fonte).
  const display = item.displayEvidence
  const shown = display.filter((entry): entry is DisplayEvidence => entry.status === "DISPLAYED")
  const lineage = item.provenance.proceduralLineage
  const knowledge = item.guidance.source === "KB_RULE" && lineage ? { documentTitle: lineage.documentTitle, ruleText: lineage.ruleQuote } : null
  if (item.guidance.source === "KB_RULE" && !knowledge) return null
  return {
    writerItem: {
      slot,
      section: item.section as WriterItem["section"],
      interpretation: { kind: item.interpretation.kind, polarity: item.interpretation.polarity, scope: "INTERACTION_SPECIFIC", safeMeaning: SAFE_MEANING(item) },
      guidance: { source: item.guidance.source, mandatory: item.guidance.mandatory, knowledge },
      evidence: shown.map((entry) => ({ speaker: entry.speaker, text: entry.text, truncated: entry.truncated, wasRedacted: entry.wasRedacted })),
      evidenceWithheld: display.length - shown.length,
      actionClaimMode: actionClaimModeFor(),
    },
    display,
  }
}

/**
 * Payload EXATO do redator. Só HAS_POINTS invoca, e só com itens ENTREGÁVEIS ao colaborador: item com bloqueio de política
 * (conteúdo procedimental, `PROCEDURAL_MATCHING_DELIVERY_POLICY`) ou sem evidência exibível suficiente (readiness ≠ READY, V1.4.9d) fica fora e é registrado na auditoria. Evidência só pela projeção de display.
 */
export function buildFeedbackWriterInput(feedback: InteractionFeedbackV1): PreparedWriterInput {
  if (feedback.status !== "HAS_POINTS") return { invoke: false, reason: feedback.status, audit: null }
  const items: WriterItem[] = []
  const audit: WriterInputAudit = { blocked: [], slots: [] }
  feedback.items.forEach((item, itemIndex) => {
    if (!WRITER_SECTIONS.includes(item.section)) return
    if (item.delivery.blocked) { audit.blocked.push({ itemIndex, findingRef: item.provenance.findingRef, reason: item.delivery.blocked }); return }
    if (!item.delivery.collaborator) return
    const slot = `ITEM_${items.length + 1}`
    const built = toWriterItem(item, slot)
    if (!built) return
    items.push(built.writerItem)
    audit.slots.push({ slot, itemIndex, findingRef: item.provenance.findingRef, evidence: built.display.map((entry) => (entry.status === "DISPLAYED" ? { origin: entry.origin, status: entry.status, redactionKinds: entry.redactionKinds } : entry)), display: built.display })
  })
  if (items.length === 0) return { invoke: false, reason: audit.blocked.length > 0 ? "DELIVERY_BLOCKED" : "NOTHING_MATERIAL", audit: { blocked: audit.blocked } }
  return {
    invoke: true,
    input: { contract: FEEDBACK_WRITER_INPUT_CONTRACT, effectClaimMode: EFFECT_CLAIM_MODE, interactionLabel: feedback.interaction.label, uncertainty: SINGLE_INTERACTION_UNCERTAINTY, items, constraints: WRITER_CONSTRAINTS.map((item) => ({ code: item.code, text: item.text })), outputFields: ["observed", "whyItMatters", "whatYouCanDo"] as const },
    audit,
  }
}

// ---------------------------------------------------------------------------------------------
// SAÍDA DO REDATOR — só wording; validação por item; fallback determinístico
// ---------------------------------------------------------------------------------------------

export type ItemWording = { observed: string; whyItMatters: string; whatYouCanDo: string }
const wordingText = z.string().trim().min(1).max(600)
/** `.strict()`: qualquer campo além do wording (section, ownership, review, evidence…) invalida o item. */
const writerItemSchema = z.object({ slot: z.string(), observed: wordingText, whyItMatters: wordingText, whatYouCanDo: wordingText }).strict()
export const feedbackWriterOutputSchema = z.object({ items: z.array(z.unknown()) }).strict()

export type WordingViolation =
  | "SCHEMA" | "INTERNAL_REF" | "INTERNAL_JSON_LEAKAGE" | "POLARITY_MISMATCH" | "PATTERN_LANGUAGE" | "PERMANENT_TRAIT" | "TEMPORAL_RELATION"
  | "PROCEDURAL_CONCLUSION_WITHOUT_KB" | "PROCEDURAL_COMPLETENESS" | "UNSUPPORTED_PROCEDURE" | "UNSUPPORTED_NUMBER" | "EVIDENCE_ALTERATION"
  | "GUARANTEED_EFFECT" | "DECLARED_ACTION_UPGRADE" | "COMPREHENSION_UNOBSERVED"

export const TURN_REF = /\bT\d{1,3}\b/
export const JSON_LEAKAGE = [/[{}]/, /"[A-Za-z_]+"\s*:/, /\b[A-Z]{2,}_[A-Z_]{2,}\b/]
/** Linguagem NORMATIVA/de norma — só em item KB_RULE (fora dele, é procedimento que o item não sustenta). */
export const NORMATIVE_LANGUAGE = [/\b(?:deve(?:ria)?|devem|é\s+obrigat[óo]ri[oa]|obrigatoriamente|é\s+proibid[oa]|n[ãa]o\s+é\s+permitid[oa])\b/iu, /\b(?:o\s+procedimento|a\s+norma|a\s+pol[íi]tica|a\s+regra|o\s+manual)\s+(?:determina|exige|prev[êe]|estabelece|pro[íi]be|orienta)\b/iu]
/**
 * V1.4.9g — GUARDA DE EFEITO GARANTIDO (alta precisão, nunca universal). Só pega a construção INEQUÍVOCA
 * "garante/assegura que … | faz/fez com que … | resultou em …" seguida (até 6 palavras) de um ESTADO DO CLIENTE de lista
 * fechada — estar ciente, compreender, entender, receber, saber, ficar tranquilo/satisfeito, ficar sem dúvidas: o ato do
 * operador vira resultado no cliente sem evidência. Garantir POSSE ("que ele tenha em mãos a referência") ou finalidade
 * genérica não é pego; benefício potencial ("pode ajudar", "contribui para", "permite que") também não. Calibrada nas 25
 * saídas dos Writer Gates (in-sample — precisão não validada fora delas); na dúvida, não detectar: a revisão humana cobre.
 */
const CUSTOMER_STATE = "(?:ciente|compreend\\p{L}*|entend\\p{L}*|receb\\p{L}*|saiba|sabe|soube|tranquil\\p{L}*|satisfeit\\p{L}*|sem\\s+d[úu]vidas?)"
const UP_TO_SIX_WORDS = "(?:\\S+\\s+){0,6}?"
const GUARANTEED_EFFECT_LANGUAGE: readonly RegExp[] = [
  new RegExp(`(?<!\\p{L})(?:garant|assegur)\\p{L}*\\s+que\\s+${UP_TO_SIX_WORDS}${CUSTOMER_STATE}(?!\\p{L})`, "iu"),
  new RegExp(`(?<!\\p{L})(?:faz|fez|fazem|fizeram|fazendo|fará|farão)\\s+com\\s+que\\s+${UP_TO_SIX_WORDS}${CUSTOMER_STATE}(?!\\p{L})`, "iu"),
  new RegExp(`(?<!\\p{L})result(?:ou|aram)\\s+em\\s+${UP_TO_SIX_WORDS}${CUSTOMER_STATE}(?!\\p{L})`, "iu"),
]
export function detectGuaranteedEffectLanguage(prose: string): string[] {
  return GUARANTEED_EFFECT_LANGUAGE.map((pattern) => pattern.exec(prose)?.[0] ?? null).filter((match): match is string => match !== null)
}
/**
 * V1.4.9g — linguagem de padrão CIENTE DO SLOT. Em observed/whyItMatters a regra é a rígida de sempre. Em whatYouCanDo (texto
 * PROSPECTIVO de orientação) só a construção condicional "sempre que <condição>" deixa de contar como padrão — "continue
 * fazendo o que você sempre faz", "costuma", "frequentemente" continuam bloqueados. Não há exceção global para "sempre".
 */
const PROSPECTIVE_CONDITIONAL = /(?<!\p{L})sempre\s+que(?!\p{L})/giu
export function slotPatternLanguage(slot: keyof ItemWording, prose: string): string[] {
  return detectStrongPatternLanguage(slot === "whatYouCanDo" ? prose.replace(PROSPECTIVE_CONDITIONAL, " ") : prose)
}
/**
 * V1.5.3 — DECLARED_ACTION_UPGRADE (guarda de ALTA PRECISÃO, condicionada à estrutura).
 * Só age quando: (1) o item é DECLARED_ONLY (sempre, na V1) e (2) a evidência EXIBÍVEL do OPERADOR contém a declaração de uma
 * ação concluída de execução (1ª pessoa do pretérito: "enviei", "já alterei", "acabei de disparar"…). Nesse caso o `observed`
 * não pode afirmar uma ação de execução como fato do operador ("você enviou", "ao realizar a alteração") fora de uma oração
 * declarativa ("você informou que enviou…" passa) nem fora de citação literal. Verbos ambíguos com outros sentidos
 * (gerar, fazer, abrir) ficam de fora — preferir não detectar a bloquear texto correto. Calibrada nos 29 textos históricos.
 */
const DECLARED_EXECUTION = /(?<!\p{L})(?:(?:re)?enviei|disparei|registrei|alterei|removi|apliquei|cancelei|(?:des)?bloqueei|realizei|conclu[íi]|efetuei|executei|fiz|gerei|abri|cadastrei|atualizei|(?:re|des)?ativei|estornei|lancei|encaminhei|troquei|inclu[íi]|exclu[íi]|liberei|agendei|processei|acabei\s+de\s+\p{L}+(?:ar|er|ir))(?!\p{L})/iu
const EXECUTION_VERBS = "(?:re)?envi|dispar|registr|alter|remov|aplic|cancel|(?:des)?bloque|realiz|conclu|efetu|execut|cadastr|atualiz|(?:re|des)?ativ|estorn|lan[çc]|encaminh|troc|inclu|exclu|liber|agend|process"
const EXECUTION_FACT: readonly RegExp[] = [
  new RegExp(`(?<!\\p{L})(?:${EXECUTION_VERBS})(?:ou|eu|iu)(?!\\p{L})`, "iu"),
  new RegExp(`(?<!\\p{L})ao\\s+(?:${EXECUTION_VERBS})(?:ar|er|ir)(?!\\p{L})`, "iu"),
]
const DECLARATIVE_FRAME = /(?<!\p{L})(?:inform|declar|comunic|afirm|avis|relat|mencion|diss|diz|dit[oa]|sinaliz|indic)\p{L}*/iu
const NEGATED = /(?<!\p{L})n[ãa]o\s+$/iu

export function declaredActionsIn(evidence: readonly WriterEvidence[]): string[] {
  return evidence.filter((entry) => (entry.speaker ?? "").toUpperCase() === "OPERADOR").flatMap((entry) => { const match = DECLARED_EXECUTION.exec(entry.text); return match ? [match[0]] : [] })
}
/** Afirmações de execução como FATO na prosa (sem citações), por frase, fora de oração declarativa e não negadas. */
export function detectDeclaredActionUpgrade(prose: string): string[] {
  return prose.split(/[.!?;]+/).flatMap((sentence) => EXECUTION_FACT.flatMap((pattern) => {
    const match = pattern.exec(sentence)
    if (!match) return []
    const before = sentence.slice(0, match.index)
    return DECLARATIVE_FRAME.test(before) || NEGATED.test(before) ? [] : [match[0]]
  }))
}

/**
 * V1.5.3 — COMPREHENSION_UNOBSERVED (alta precisão, condicionada à estrutura). Quando o item NÃO tem nenhuma fala do CLIENTE
 * na evidência exibível, nada nele pode mostrar o cliente confirmando entendimento; então observed/whyItMatters não podem
 * dizer que algo confirma/assegura/garante a compreensão ("confirmar que o cliente compreende", "assegurar o entendimento").
 * whatYouCanDo fica de fora: sugerir "confirmar o entendimento do cliente" é orientação legítima (prospectiva).
 */
const COMPREHENSION_CONFIRMATION: readonly RegExp[] = [
  /(?<!\p{L})(?:confirm|assegur|garant)\p{L}*\s+(?:que\s+)?(?:o\s+cliente|a\s+cliente|ele|ela)\s+(?:\p{L}+\s+)?(?:compreend|entend|est[áa]\s+ciente|ficou\s+ciente)\p{L}*/iu,
  /(?<!\p{L})(?:confirm|assegur|garant)\p{L}*\s+(?:o|a)\s+(?:entendimento|compreens[ãa]o|alinhamento)(?!\p{L})/iu,
]
export function detectComprehensionClaim(prose: string): string[] {
  return COMPREHENSION_CONFIRMATION.map((pattern) => pattern.exec(prose)?.[0] ?? null).filter((match): match is string => match !== null)
}

export const QUOTED = /[“"«]([^”"»]{8,})[”"»]/g
export const QUOTED_SPAN = /[“"«][^”"»]*[”"»]/g
const normalizeSpaces = (text: string) => text.replace(/\s+/g, " ").trim()

/** Validação de UM item da saída do redator contra o item do payload (reaproveita os validadores do gating de claims). */
export function validateItemWording(wording: ItemWording, item: WriterItem, interactionLabel: string): WordingViolation[] {
  const fields = [wording.observed, wording.whyItMatters, wording.whatYouCanDo]
  const all = fields.join("\n")
  // Checagens LÉXICAS olham só a prosa do redator: o trecho entre aspas é evidência literal (conferida em EVIDENCE_ALTERATION),
  // não afirmação dele — "A cobrança está correta…" dito pelo operador não torna a oportunidade um elogio.
  const prose = all.replace(QUOTED_SPAN, " ")
  const violations = new Set<WordingViolation>()
  if (fields.some((text) => INTERNAL_REF_PATTERN.test(text) || TURN_REF.test(text))) violations.add("INTERNAL_REF")
  if (JSON_LEAKAGE.some((pattern) => pattern.test(all))) violations.add("INTERNAL_JSON_LEAKAGE")
  // Polaridade: só a OBSERVAÇÃO é a afirmação (a sugestão pode conter "com clareza" sem virar elogio).
  const lexical = lexicalPolarityOf(wording.observed.replace(QUOTED_SPAN, " "))
  const allowed: ClaimPolarity[] = item.interpretation.polarity === "POSITIVE" ? ["POSITIVE", "NEUTRAL"] : ["NEGATIVE", "NEUTRAL"]
  if (lexical && lexical !== "MIXED" && !allowed.includes(lexical)) violations.add("POLARITY_MISMATCH")
  const slotProse = (slot: keyof ItemWording) => wording[slot].replace(QUOTED_SPAN, " ")
  if ((["observed", "whyItMatters", "whatYouCanDo"] as const).some((slot) => slotPatternLanguage(slot, slotProse(slot)).length > 0)) violations.add("PATTERN_LANGUAGE")
  // Efeito garantido só nos slots que AFIRMAM/EXPLICAM (observed, whyItMatters); whatYouCanDo é prospectivo (finalidade de uma
  // sugestão) — medido nos gates: 5 de 5 "garantindo que…" em whatYouCanDo foram aceitos pelo revisor humano.
  if ((["observed", "whyItMatters"] as const).some((slot) => detectGuaranteedEffectLanguage(slotProse(slot)).length > 0)) violations.add("GUARANTEED_EFFECT")
  // V1.5.3 — fronteiras estruturais: ação só declarada (DECLARED_ONLY) e compreensão sem fala do cliente.
  if ((item.actionClaimMode ?? actionClaimModeFor()) === "DECLARED_ONLY" && declaredActionsIn(item.evidence).length > 0 && detectDeclaredActionUpgrade(slotProse("observed")).length > 0) violations.add("DECLARED_ACTION_UPGRADE")
  const hasCustomerEvidence = item.evidence.some((entry) => (entry.speaker ?? "").toUpperCase() === "CLIENTE")
  if (!hasCustomerEvidence && (["observed", "whyItMatters"] as const).some((slot) => detectComprehensionClaim(slotProse(slot)).length > 0)) violations.add("COMPREHENSION_UNOBSERVED")
  if (detectPermanentTraitLanguage(prose).length > 0) violations.add("PERMANENT_TRAIT")
  if (detectTemporalLanguage(prose).length > 0) violations.add("TEMPORAL_RELATION")
  const kbRule = item.guidance.source === "KB_RULE"
  if (!kbRule && detectProceduralConclusionLanguage(prose).length > 0) violations.add("PROCEDURAL_CONCLUSION_WITHOUT_KB")
  if (detectProceduralCompletenessLanguage(prose).length > 0) violations.add("PROCEDURAL_COMPLETENESS")
  if (!kbRule && NORMATIVE_LANGUAGE.some((pattern) => pattern.test(prose))) violations.add("UNSUPPORTED_PROCEDURE")
  const literalSources = [...item.evidence.map((entry) => entry.text), item.guidance.knowledge?.ruleText ?? "", item.guidance.knowledge?.documentTitle ?? "", interactionLabel].filter((text) => text.length > 0)
  // TYPED_NUMBER_GROUNDING_V1 — número só com fonte literal do MESMO papel ("7 dias úteis" nunca sustenta "protocolo 7").
  if (unsupportedTypedNumbers(all, literalSources).length > 0) violations.add("UNSUPPORTED_NUMBER")
  for (const match of all.matchAll(QUOTED)) {
    const quoted = normalizeSpaces(match[1]!.replace(/…$/, ""))
    if (!literalSources.some((source) => normalizeSpaces(source).includes(quoted))) violations.add("EVIDENCE_ALTERATION")
  }
  return [...violations]
}

const quoteOf = (item: WriterItem): string => {
  const evidence = item.evidence.find((entry) => (entry.speaker ?? "").toUpperCase() === "OPERADOR") ?? item.evidence[0]
  return evidence ? `: “${evidence.text}”${evidence.truncated ? "…" : ""}` : ""
}

/**
 * FALLBACK DETERMINÍSTICO por item (usado quando o redator falha, omite o item ou viola qualquer regra):
 *   STRENGTH           → reforço baseado no significado seguro;
 *   OPPORTUNITY/COACHING → significado seguro + sugestão genérica NÃO normativa;
 *   KB_RULE            → só o que a regra persistida sustenta (título + trecho literal da regra).
 * Usa apenas evidência de display (nunca o raw).
 */
export function fallbackItemWording(item: WriterItem): ItemWording {
  if (item.guidance.source === "KB_RULE" && item.guidance.knowledge) {
    const { documentTitle, ruleText } = item.guidance.knowledge
    return {
      observed: `Nesta interação foi identificada uma divergência em relação ao documento “${documentTitle}”${quoteOf(item) ? `. Trecho da conversa${quoteOf(item)}` : ""}.`,
      whyItMatters: ruleText ? `O documento “${documentTitle}” registra: “${ruleText}”.` : `A orientação para este ponto está no documento “${documentTitle}”.`,
      whatYouCanDo: `Revise o documento “${documentTitle}” para situações parecidas.`,
    }
  }
  if (item.section === "STRENGTH") {
    return {
      observed: `Nesta interação foi observado um comportamento positivo${quoteOf(item)}.`,
      whyItMatters: "Reconhecer o que funcionou nesta conversa ajuda a repetir a prática em atendimentos parecidos.",
      whatYouCanDo: "Considere manter essa prática quando uma situação parecida acontecer.",
    }
  }
  return {
    observed: `Nesta interação foi observado um ponto que pode ser desenvolvido${quoteOf(item)}.`,
    whyItMatters: "Revisitar este momento da conversa pode apoiar o seu desenvolvimento.",
    whatYouCanDo: "Sugestão: converse com a sua liderança sobre formas de conduzir situações parecidas.",
  }
}

export type ItemWordingResolution = { slot: string; source: "WRITER" | "FALLBACK"; wording: ItemWording; violations: WordingViolation[] }

/** Resolve o wording de cada item: saída válida do redator OU fallback do item inteiro. Nunca mistura campos dos dois. */
export function resolveFeedbackWording(input: FeedbackWriterInputV1, rawOutput: unknown): ItemWordingResolution[] {
  const parsed = feedbackWriterOutputSchema.safeParse(rawOutput)
  const bySlot = new Map<string, unknown>()
  if (parsed.success) for (const entry of parsed.data.items) { const slot = (entry as { slot?: unknown } | null)?.slot; if (typeof slot === "string" && !bySlot.has(slot)) bySlot.set(slot, entry) }
  return input.items.map((item) => {
    const candidate = writerItemSchema.safeParse(bySlot.get(item.slot))
    if (!candidate.success) return { slot: item.slot, source: "FALLBACK", wording: fallbackItemWording(item), violations: ["SCHEMA"] }
    const wording = { observed: candidate.data.observed, whyItMatters: candidate.data.whyItMatters, whatYouCanDo: candidate.data.whatYouCanDo }
    const violations = validateItemWording(wording, item, input.interactionLabel)
    return violations.length === 0 ? { slot: item.slot, source: "WRITER", wording, violations } : { slot: item.slot, source: "FALLBACK", wording: fallbackItemWording(item), violations }
  })
}
