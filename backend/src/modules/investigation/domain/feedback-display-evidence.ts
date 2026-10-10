import type { FeedbackFact, RawVerifiedEvidence } from "./interaction-feedback.js"
import { identifyingNameVariants, quoteReidentifies, redactEvidentPii, sourceHashOf, type RedactionKind } from "./peer-privacy-projection.js"
import { mentionRoleOf, type PersonMentionRoles } from "./person-mention-roles.js"

/**
 * DISPLAY EVIDENCE (V1.4.9b; módulo próprio desde a V1.4.9d para ser usado pelo compositor E pelo redator — uma única
 * projeção): raw verificado → trecho exibível, com redaction só de fragmentos sensíveis pela lista canônica e FAIL-CLOSED
 * (`WITHHELD`) quando não dá para mascarar com segurança. Sem paráfrase, sem correção, sem LLM.
 */
export const DISPLAY_EVIDENCE_VERSION = "DISPLAY_EVIDENCE_V1" as const
export const DISPLAY_QUOTE_MAX_CHARS = 240
/** Sequência numérica com ≥ 8 dígitos que sobreviveu à redaction = identificador que a infraestrutura não sabe mascarar. */
export const UNMASKED_NUMERIC_MIN_DIGITS = 8

// ---------------------------------------------------------------------------------------------
// DISPLAY EVIDENCE
// ---------------------------------------------------------------------------------------------

export type DisplayWithheldReason = "UNMASKED_NUMERIC_IDENTIFIER" | "OPERATOR_IDENTITY" | "EMPTY_AFTER_REDACTION"

export type DisplayEvidence = {
  status: "DISPLAYED"
  version: typeof DISPLAY_EVIDENCE_VERSION
  speaker: string | null
  /** Texto exibível: o trecho verificado com SÓ os fragmentos sensíveis trocados por marcadores estáveis ([CPF]…). */
  text: string
  truncated: boolean
  evidenceType: FeedbackFact["evidenceType"]
  wasRedacted: boolean
  redactionKinds: RedactionKind[]
  /** Só aqui a evidência vira segura para exibir — `assertDisplaySafe` aceita; o FACT bruto continua PENDING. */
  redaction: { required: true; status: "APPLIED"; version: typeof DISPLAY_EVIDENCE_VERSION }
  /** Origem no raw (auditoria): posição no item, turno e hash do trecho bruto — nunca o trecho bruto. */
  origin: { factIndex: number; turnRef: string; rawSha256: string }
}
export type WithheldEvidence = { status: "WITHHELD"; reason: DisplayWithheldReason; origin: DisplayEvidence["origin"] }
export type DisplayEvidenceResult = DisplayEvidence | WithheldEvidence

export type DisplayProjectionContext = {
  /** Nomes de OUTROS operadores conhecidos (transferência, menção): se aparecerem no trecho, o trecho não é exibido. */
  otherOperatorNames?: readonly string[] | undefined
  /** V1.7.1g — papel de cada primeiro nome nesta interação (`PERSON_MENTION_ROLES_V1`). Ausente = comportamento conservador de
   * sempre (qualquer primeiro nome de colega protege o trecho). Presente: o primeiro nome que a transcrição prova ser do CLIENTE
   * ou do próprio colaborador não protege; nome completo de colega e nome usado em referência a terceiro continuam protegidos. */
  mentionRoles?: PersonMentionRoles | undefined
}

const NUMERIC_RUN = /\d(?:[\d.\-/ ]*\d)?/g
const DATE_OR_TIME = /(?<!\d)(?:\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\d{1,2}:\d{2}(?::\d{2})?|\d{1,2}h\d{0,2})(?!\d)/g

/** Sobrou identificador numérico que a redaction canônica não mascarou? (fail-closed da exibição). */
export function hasUnmaskedNumericIdentifier(text: string): boolean {
  const withoutDates = text.replace(DATE_OR_TIME, " ")
  return (withoutDates.match(NUMERIC_RUN) ?? []).some((run) => run.replace(/\D/g, "").length >= UNMASKED_NUMERIC_MIN_DIGITS)
}

/** Corte sem quebrar marcador: se o limite cai dentro de "[…]", corta antes do "[". */
function truncateDisplay(text: string): { text: string; truncated: boolean } {
  if (text.length <= DISPLAY_QUOTE_MAX_CHARS) return { text, truncated: false }
  let cut = text.slice(0, DISPLAY_QUOTE_MAX_CHARS)
  const open = cut.lastIndexOf("[")
  if (open > cut.lastIndexOf("]")) cut = cut.slice(0, open)
  return { text: cut.trimEnd(), truncated: true }
}

function forbiddenNameTerms(names: readonly string[], roles: PersonMentionRoles | undefined): string[] {
  return names.flatMap((name) => {
    const variants = identifyingNameVariants(name)
    const firstIsNotColleague = variants.first !== null && roles !== undefined && ["CUSTOMER", "SUBJECT_OPERATOR"].includes(mentionRoleOf(variants.first, roles))
    return [...variants.strong, ...(variants.first && !variants.commonWordFirst && !firstIsNotColleague ? [variants.first] : [])]
  })
}

/**
 * raw → display de UMA unidade de evidência. Redaction sobre o trecho INTEIRO (antes de qualquer corte, para nunca deixar
 * meio CPF sem máscara); só fragmentos sensíveis mudam; o resto é o texto verificado, sem paráfrase nem correção.
 */
export function projectDisplayEvidence(raw: RawVerifiedEvidence, meta: { factIndex: number; evidenceType: FeedbackFact["evidenceType"] }, context: DisplayProjectionContext = {}): DisplayEvidenceResult {
  const origin = { factIndex: meta.factIndex, turnRef: raw.turnRef, rawSha256: sourceHashOf(raw.quote) }
  const forbidden = forbiddenNameTerms(context.otherOperatorNames ?? [], context.mentionRoles)
  if (forbidden.length > 0 && quoteReidentifies(forbidden, raw.quote)) return { status: "WITHHELD", reason: "OPERATOR_IDENTITY", origin }
  const redacted = redactEvidentPii(raw.quote)
  if (hasUnmaskedNumericIdentifier(redacted.text)) return { status: "WITHHELD", reason: "UNMASKED_NUMERIC_IDENTIFIER", origin }
  const { text, truncated } = truncateDisplay(redacted.text)
  if (text.trim().length === 0) return { status: "WITHHELD", reason: "EMPTY_AFTER_REDACTION", origin }
  return {
    status: "DISPLAYED", version: DISPLAY_EVIDENCE_VERSION, speaker: raw.speaker, text, truncated, evidenceType: meta.evidenceType,
    wasRedacted: redacted.redactions.length > 0, redactionKinds: [...new Set(redacted.redactions.map((item) => item.kind))],
    redaction: { required: true, status: "APPLIED", version: DISPLAY_EVIDENCE_VERSION }, origin,
  }
}
