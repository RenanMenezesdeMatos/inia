import { returnChannelEvidenceOf } from "./subitem-semantics.js"
import type { CanonicalBehavior } from "./canonical-behavior.js"

/**
 * V1.7.1n — POLARIDADE DA EVIDÊNCIA (`EVIDENCE_POLARITY_V1`, domínio puro, padrões CONTROLADOS, sem LLM, sem stemming aberto).
 *
 * No smoke V1.7.1m a etapa "informar o prazo" foi ao QA porque a contraprova léxica viu a palavra "prazo" em "Não sei te dizer
 * um prazo certinho" e concluiu que a etapa podia ter sido cumprida em outro momento. MENCIONAR ≠ CUMPRIR: dizer a palavra
 * "prazo" não informa prazo; dizer que não sabe o prazo é evidência de NÃO cumprimento.
 *
 *   FULFILLED    a fala cumpre o comportamento (prazo: duração/data/janela concreta — "em até cinco dias úteis", "até amanhã",
 *                "o prazo é de 48 horas"; protocolo: o número do protocolo dito);
 *   INABILITY    o operador diz que não sabe/não consegue/não tem como informar ("não sei te dizer um prazo", "não tenho o
 *                protocolo", "não sei quando vai ficar pronto");
 *   NEGATED      negação LIGADA ao objeto na mesma oração ("não tem prazo", "sem protocolo") — nunca "não" solto na fala;
 *   UNFULFILLED  o objeto aparece adiado/condicionado, sem valor ("depende da fila", "eles vão te passar o prazo");
 *   UNKNOWN      o objeto é só mencionado, ou a fala não trata do comportamento (`mentioned` distingue).
 *
 * Cada oração é avaliada à parte ("Não há problema, o prazo é de 5 dias" = FULFILLED: a negação é de outra oração). Uma oração
 * FULFILLED vence na fala ("não sei o prazo exato, mas é em até 5 dias úteis" = FULFILLED). Só os comportamentos com detector
 * confiável têm polaridade (`hasPolarityDetector`); os demais continuam nas regras de antes — na dúvida, UNKNOWN.
 */
export const EVIDENCE_POLARITY_VERSION = "EVIDENCE_POLARITY_V1" as const
export type EvidencePolarity = "FULFILLED" | "UNFULFILLED" | "NEGATED" | "INABILITY" | "UNKNOWN"
export type PolarityReading = { polarity: EvidencePolarity; mentioned: boolean }
export type PolarityFacet = "DEADLINE" | "PROTOCOL" | "RETURN_CHANNEL"

const fold = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ")
/** Orações: ponto, ponto-e-vírgula, interrogação/exclamação, vírgula seguida de espaço e "mas/porém". */
const clausesOf = (text: string) => fold(text).split(/[.;!?]+|,\s+|\s+(?:mas|porem|entretanto)\s+/u).map((clause) => clause.trim()).filter((clause) => clause.length > 0)

const NUMBER_WORDS = "um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|quinze|vinte|trinta|quarenta|quarenta e oito|setenta e duas|setenta e dois|48|24|72"
const UNIT = "dias?(?:\\s+uteis|\\s+corridos)?|horas?|semanas?|meses|mes"
const WEEKDAYS = "segunda|terca|quarta|quinta|sexta|sabado|domingo"
const INABILITY_VERB = /(?<!\p{L})(?:nao|nem)\s+(?:(?:\p{L}+\s+){0,2})?(?:sei|saberia|consigo|conseguiria|tenho\s+como|posso|da\s+(?:pra|para)|tem\s+como)(?!\p{L})/u

// ---------------------------------------------------------------------------------------------------------------------
// PRAZO
// ---------------------------------------------------------------------------------------------------------------------
const DEADLINE_OBJECT = /(?<!\p{L})(?:prazos?|quando|quanto\s+tempo|em\s+quanto\s+tempo|data|demora\p{L}*)(?!\p{L})/u
const CONCRETE_DEADLINE: RegExp[] = [
  // "em até 5 dias", "dentro de 48 horas", "daqui a dois dias", "no máximo 3 dias", "até 10 dias úteis"
  new RegExp(`(?<!\\p{L})(?:em(?:\\s+ate)?|ate|dentro\\s+de|daqui\\s+a|no\\s+maximo|no\\s+prazo\\s+de|num\\s+prazo\\s+de)\\s+(?:${NUMBER_WORDS}|\\d+)\\s+(?:${UNIT})(?!\\p{L})`, "u"),
  // "o prazo é de 48 horas", "prazo de cinco dias", "o prazo fica em 2 dias"
  new RegExp(`(?<!\\p{L})prazos?\\s+(?:\\p{L}+\\s+){0,3}(?:e|sera|fica|de|em)\\s+(?:de\\s+|em\\s+)?(?:ate\\s+)?(?:${NUMBER_WORDS}|\\d+)\\s+(?:${UNIT})(?!\\p{L})`, "u"),
  // "5 dias úteis" em qualquer lugar da oração
  /(?<!\p{L})(?:\d+|um|dois|tres|quatro|cinco|seis|sete|oito|nove|dez)\s+dias?\s+uteis(?!\p{L})/u,
  // "até amanhã", "até sexta", "até o fim do dia", "até o dia 10", "até 15/10"
  new RegExp(`(?<!\\p{L})ate\\s+(?:a\\s+|o\\s+)?(?:amanha|hoje|depois\\s+de\\s+amanha|(?:proxima\\s+)?(?:${WEEKDAYS})(?:-feira)?|(?:o\\s+)?(?:fim|final)\\s+d[oa]\\s+(?:dia|semana|mes)|(?:o\\s+)?dia\\s+\\d{1,2}(?!\\d)|\\d{1,2}\\/\\d{1,2})`, "u"),
  // V1.7.4 — janela de horário: "amanhã até o meio-dia", "hoje à tarde", "até as 18h", "amanhã de manhã"
  /(?<!\p{L})(?:(?:hoje|amanha)\s+(?:ate\s+(?:o\s+|a\s+|as\s+)?|de\s+|pela\s+|a\s+|no\s+|na\s+)?(?:meio[- ]dia|manha|tarde|noite|\d{1,2}\s*h)|ate\s+(?:o\s+|as\s+)?(?:meio[- ]dia|\d{1,2}\s*h(?:oras)?))(?!\p{L})/u,
]
const DEADLINE_INABILITY: RegExp[] = [
  // "não sei (te dizer) um prazo", "não consigo informar o prazo", "não tenho como passar prazo", "não sei quando…", "não sei em quanto tempo"
  new RegExp(`${INABILITY_VERB.source}(?:\\s+(?:\\p{L}+\\s+){0,4}?)?\\s*(?:${DEADLINE_OBJECT.source})`, "u"),
  // "o prazo eu não consigo confirmar", "prazo, não sei"
  /(?<!\p{L})prazos?\s+(?:(?:\p{L}+\s+){0,2})?(?:nao|nem)\s+(?:sei|consigo|tenho|posso|da)(?!\p{L})/u,
  // "não tenho (o) prazo", "não tenho essa informação de prazo"
  /(?<!\p{L})nao\s+tenho\s+(?:(?:\p{L}+\s+){0,3})?prazos?(?!\p{L})/u,
]
const DEADLINE_NEGATED = /(?<!\p{L})(?:nao|sem|nem)\s+(?:(?:\p{L}+\s+){0,3})?prazos?(?!\p{L})|(?<!\p{L})prazos?\s+(?:\p{L}+\s+){0,2}nao\s+(?:existe|tem|ha)(?!\p{L})/u
const DEADLINE_DEFERRAL = /(?<!\p{L})(?:depende(?:ndo)?|vai\s+depender|conforme|de\s+acordo\s+com)\s+(?:d[aoe]s?\s+)?\p{L}+|(?<!\p{L})(?:eles|ela|ele|a\s+area|o\s+setor|a\s+equipe)\s+(?:vao|vai|irao|ira)\s+(?:te\s+|lhe\s+)?(?:informar|passar|avisar|dizer)(?!\p{L})/u

function deadlineClause(clause: string): PolarityReading {
  const mentioned = DEADLINE_OBJECT.test(clause)
  if (CONCRETE_DEADLINE.some((pattern) => pattern.test(clause)) && !DEADLINE_INABILITY.some((pattern) => pattern.test(clause))) return { polarity: "FULFILLED", mentioned: true }
  if (DEADLINE_INABILITY.some((pattern) => pattern.test(clause))) return { polarity: "INABILITY", mentioned: true }
  if (DEADLINE_NEGATED.test(clause)) return { polarity: "NEGATED", mentioned: true }
  if (mentioned && DEADLINE_DEFERRAL.test(clause)) return { polarity: "UNFULFILLED", mentioned: true }
  return { polarity: "UNKNOWN", mentioned }
}

// ---------------------------------------------------------------------------------------------------------------------
// PROTOCOLO
// ---------------------------------------------------------------------------------------------------------------------
const PROTOCOL_OBJECT = /(?<!\p{L})protocolos?(?!\p{L})/u
/** O número dito junto do protocolo ("o seu protocolo é 2026 0926 3357", "protocolo: 202609130184", "anota o protocolo, 2026…"). */
const PROTOCOL_NUMBER = /(?<!\p{L})protocolos?(?!\p{L})[^0-9]{0,40}\d[\d\s.\-/]{5,}\d/u
const PROTOCOL_INABILITY: RegExp[] = [
  new RegExp(`${INABILITY_VERB.source}\\s+(?:(?:\\p{L}+\\s+){0,4})?protocolos?(?!\\p{L})`, "u"),
  /(?<!\p{L})nao\s+(?:tenho|temos|tem|ha|gerou|gerei|saiu|foi\s+gerad\p{L}*)\s+(?:(?:\p{L}+\s+){0,3})?protocolos?(?!\p{L})/u,
  /(?<!\p{L})protocolos?\s+(?:(?:\p{L}+\s+){0,3})?(?:nao|nem)\s+(?:saiu|gerou|foi\s+gerad\p{L}*|consigo|tenho|sei)(?!\p{L})/u,
]
const PROTOCOL_NEGATED = /(?<!\p{L})(?:nao|sem|nem)\s+(?:(?:\p{L}+\s+){0,3})?protocolos?(?!\p{L})/u
const PROTOCOL_DEFERRAL = /(?<!\p{L})(?:vai|vao|ira|irao)\s+(?:(?:\p{L}+\s+){0,2})?(?:receber|chegar|enviar|mandar)\s+(?:(?:\p{L}+\s+){0,3})?protocolos?|protocolos?\s+(?:(?:\p{L}+\s+){0,3})?(?:vai|vao)\s+(?:chegar|ser\s+enviad\p{L}*)/u

function protocolText(text: string): PolarityReading {
  // O número do protocolo costuma vir DEPOIS de uma vírgula ("o protocolo é, anota aí, 2026…"): a leitura positiva é da fala.
  const folded = fold(text)
  const clauses = clausesOf(text)
  const mentioned = PROTOCOL_OBJECT.test(folded)
  const inability = clauses.some((clause) => PROTOCOL_INABILITY.some((pattern) => pattern.test(clause)))
  if (PROTOCOL_NUMBER.test(folded) && !clauses.some((clause) => PROTOCOL_OBJECT.test(clause) && PROTOCOL_INABILITY.some((pattern) => pattern.test(clause)) && !/\d{4}/.test(clause))) return { polarity: "FULFILLED", mentioned: true }
  if (inability) return { polarity: "INABILITY", mentioned: true }
  if (clauses.some((clause) => PROTOCOL_NEGATED.test(clause))) return { polarity: "NEGATED", mentioned: true }
  if (clauses.some((clause) => PROTOCOL_DEFERRAL.test(clause))) return { polarity: "UNFULFILLED", mentioned: true }
  return { polarity: "UNKNOWN", mentioned }
}

// ---------------------------------------------------------------------------------------------------------------------
// CANAL DE RETORNO (faceta: exportada e testada; não ligada a comportamento próprio nesta versão)
// ---------------------------------------------------------------------------------------------------------------------
const RETURN_OBJECT = /(?<!\p{L})(?:retorno|resposta|resultado|avis\p{L}*)(?!\p{L})/u
const RETURN_INABILITY = new RegExp(`${INABILITY_VERB.source}\\s+(?:(?:\\p{L}+\\s+){0,3})?(?:por\\s+onde|como|por\\s+qual\\s+(?:canal|meio)|se\\s+(?:eles\\s+)?(?:vao|vai)\\s+(?:ligar|mandar|enviar|avisar))`, "u")

function returnChannelClause(clause: string): PolarityReading {
  const mentioned = RETURN_OBJECT.test(clause)
  if (returnChannelEvidenceOf(clause) === "RETURN_CHANNEL") return { polarity: "FULFILLED", mentioned: true }
  if (RETURN_INABILITY.test(clause) && (mentioned || /ligar|mandar|enviar|avisar/.test(clause))) return { polarity: "INABILITY", mentioned: true }
  return { polarity: "UNKNOWN", mentioned }
}

const PRECEDENCE: EvidencePolarity[] = ["FULFILLED", "INABILITY", "NEGATED", "UNFULFILLED", "UNKNOWN"]
function combine(readings: readonly PolarityReading[]): PolarityReading {
  const mentioned = readings.some((reading) => reading.mentioned)
  for (const polarity of PRECEDENCE) if (readings.some((reading) => reading.polarity === polarity)) return { polarity, mentioned }
  return { polarity: "UNKNOWN", mentioned }
}

/** Polaridade de UMA fala para uma faceta (prazo, protocolo, canal de retorno). */
export function facetPolarityOf(facet: PolarityFacet, text: string): PolarityReading {
  if (facet === "PROTOCOL") return protocolText(text)
  return combine(clausesOf(text).map((clause) => (facet === "DEADLINE" ? deadlineClause(clause) : returnChannelClause(clause))))
}

/** Comportamentos canônicos com detector de polaridade CONFIÁVEL (os demais seguem as regras anteriores). */
const BEHAVIOR_FACET: Partial<Record<CanonicalBehavior, PolarityFacet>> = { INFORM_DEADLINE: "DEADLINE", PROVIDE_PROTOCOL: "PROTOCOL" }
export const hasPolarityDetector = (behavior: CanonicalBehavior | null | undefined): behavior is CanonicalBehavior => Boolean(behavior && BEHAVIOR_FACET[behavior])

/** Polaridade de uma fala para um comportamento canônico (null = comportamento sem detector confiável). */
export function behaviorPolarityOf(behavior: CanonicalBehavior | null | undefined, text: string): PolarityReading | null {
  const facet = behavior ? BEHAVIOR_FACET[behavior] : undefined
  return facet ? facetPolarityOf(facet, text) : null
}

/**
 * Leitura da evidência de uma etapa para um comportamento com detector: a polaridade AGREGADA das falas verificadas do operador
 * e as falas do operador na chamada que CUMPREM o comportamento (contraprova real — nunca palavra solta).
 */
export type EvidencePolarityAssessment = {
  version: typeof EVIDENCE_POLARITY_VERSION
  behavior: CanonicalBehavior
  evidence: EvidencePolarity
  evidenceUnits: { turnRef: string; polarity: EvidencePolarity; mentioned: boolean }[]
  fulfilledTurns: string[]
  /** FOLLOWED sem fala que cumpra (mencionar/negar não cumpre) · NOT_FOLLOWED com a própria evidência cumprindo · cumprimento em outra fala. */
  conflict: "FOLLOWED_WITHOUT_FULFILLING_EVIDENCE" | "NOT_FOLLOWED_EVIDENCE_FULFILLS" | "BEHAVIOR_FULFILLED_ELSEWHERE" | null
}

export function assessEvidencePolarity(input: { behavior: CanonicalBehavior | null | undefined; status: string; evidence: readonly { turnRef: string; text: string }[]; operatorTurns: readonly { turnRef: string; text: string }[] }): EvidencePolarityAssessment | null {
  if (!hasPolarityDetector(input.behavior)) return null
  const behavior = input.behavior
  const evidenceUnits = input.evidence.map((unit) => ({ turnRef: unit.turnRef, ...behaviorPolarityOf(behavior, unit.text)! }))
  const evidence = combine(evidenceUnits).polarity
  const fulfilledTurns = input.operatorTurns.filter((unit) => behaviorPolarityOf(behavior, unit.text)!.polarity === "FULFILLED").map((unit) => unit.turnRef)
  const conflict = input.status === "FOLLOWED"
    ? (evidence === "FULFILLED" ? null : "FOLLOWED_WITHOUT_FULFILLING_EVIDENCE")
    : input.status === "NOT_FOLLOWED"
      ? (evidence === "FULFILLED" ? "NOT_FOLLOWED_EVIDENCE_FULFILLS" : fulfilledTurns.length > 0 ? "BEHAVIOR_FULFILLED_ELSEWHERE" : null)
      : null
  return { version: EVIDENCE_POLARITY_VERSION, behavior, evidence, evidenceUnits, fulfilledTurns, conflict }
}
