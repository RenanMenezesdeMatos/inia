import { z } from "zod"
import { unwrapJsonFence } from "./call-analysis.js"
import { groundingTextsOf, type BriefFinding, type ComposedMessage, type ComposedSentence, type FeedbackBrief, type TrustedReadings } from "./feedback-brief.js"
import { feedbackViewOf, plainTextOf } from "./feedback-view.js"
import type { VerificationClaim } from "./composition-prompt.js"

/**
 * COMPOSIÇÃO VERIFICADA (domínio puro, `FEEDBACK_COMPOSITION_V3`). Duas perguntas diferentes, duas checagens diferentes:
 *   FACTUALIDADE — cada frase diz só o que os FATOS sustentam (verificação semântica por frase). A leitura da análise
 *                  (orientação, "por que importa") NÃO é fato: ela é conferida como qualquer frase, na mesma chamada.
 *   UTILIDADE    — todo desvio HIGH tem um ajuste ou orientação ESPECÍFICA; uma mensagem sem desvio tem um reconhecimento
 *                  ESPECÍFICO. Checado por código sobre as refs e os vereditos.
 * Contrato de confiança aplicado por código:
 *   - frase recusada (acréscimo, contradição, exagero) sai; a reescrita do verificador NUNCA é aceita sem nova verificação
 *     (remover palavras pode tirar uma negação ou condição e inverter a orientação);
 *   - V3: o sistema NÃO escreve frase nenhuma da conversa — nada de "Ponto principal", "Destaque", "a etapa não aparece",
 *     "O procedimento orienta" para tapar lacuna. A mensagem é só o que o redator escreveu e o verificador sustentou; quando uma
 *     frase sai, o CONJUNTO é reconferido (coerência) antes de valer; sem mensagem útil e coerente = abstenção com motivo;
 *   - trava final (`contentLeaksOf`): conteúdo recusado não aparece em nenhuma superfície (texto, card, detalhes).
 * Checagens determinísticas locais: refs válidas por stance, nenhum código interno/UUID no texto, todo número presente nos fatos,
 * repetição da mesma ideia.
 */
/** `examples` (`SPEECH_EXAMPLE_V1`): fala ao cliente proposta pelo redator por ponto de desenvolvimento — formulação, nunca fato. */
export type WriterDraft = { sentences: { text: string; stance: ComposedSentence["stance"]; refs: string[]; paragraph: number; format?: SentenceFormat }[]; card: { text: string; refs: string[] }; examples?: { ref: string; text: string }[] }

/**
 * `NARRATIVE_FORMATTING_V1` — formatação para facilitar a leitura, decidida pelo redator e montada pelo SISTEMA: cada frase pode ser item
 * de lista (`format` BULLET/NUMBERED — o sistema põe o marcador e a numeração) e pode destacar a expressão essencial com **negrito**.
 * Nenhum outro markdown passa (título, tabela, link, código, citação são removidos); negrito desbalanceado sai; o card é texto puro. A
 * verificação continua sendo frase a frase: a formatação não muda o que a frase diz. Na voz, `toSpeakable` tira as marcas.
 */
export type SentenceFormat = "BULLET" | "NUMBERED"
const formatOf = (value: unknown): SentenceFormat | undefined => (value === "BULLET" || value === "NUMBERED" ? value : undefined)
/** Texto de uma frase como markdown SEGURO de linha: só **negrito** balanceado; marcadores, títulos, links, código e tabela saem. */
export function inlineMarkdownOf(text: string, options: { listItem?: boolean } = {}): string {
  let clean = text
    .replace(/\s+/gu, " ")
    .replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+•]\s+|\d+[.)]\s+)/u, "")
    .replace(/`+/gu, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/\|/gu, " ")
    .replace(/__/gu, "")
    .replace(/(?<!\*)\*(?!\*)/gu, "")
    .trim()
  if ((clean.match(/\*\*/gu) ?? []).length % 2 !== 0) clean = clean.replace(/\*\*/gu, "")
  // A frase INTEIRA em negrito não destaca nada: volta a ser texto (num item de lista, o rótulo curto em negrito é legítimo).
  const whole = options.listItem ? null : /^\*\*([^*]+)\*\*([.!?…;:]?)$/u.exec(clean)
  if (whole) clean = `${whole[1]}${whole[2]}`
  return clean.replace(/\*\*\s*\*\*/gu, "").replace(/\s{2,}/gu, " ").trim()
}
/** Texto puro (card, resumo): sem nenhuma marca de formatação. */
export const plainInlineOf = (text: string) => inlineMarkdownOf(text).replace(/\*\*/gu, "")
/**
 * Um parágrafo da narrativa em markdown: frases sem `format` juntas em texto corrido; frases seguidas com o mesmo `format` viram uma
 * lista ("- " ou "1. "), separada do texto por linha em branco. Lista de um item só não é lista: vira texto corrido.
 */
/** `BOLD_LIMIT_V1`: negrito é destaque CURTO — um trecho longo (mais de 8 palavras) volta a ser texto (na portabilidade, 06/10, o
 * redator marcou frases inteiras). */
const BOLD_MAX_WORDS = 8
const boldSpans = /\*\*([^*]+)\*\*/gu
const withoutLongBold = (text: string) => text.replace(boldSpans, (span, inner: string) => (inner.trim().split(/\s+/u).length > BOLD_MAX_WORDS ? inner : span))
/** No texto corrido de um parágrafo, um destaque só (o primeiro); itens de lista podem ter o seu. */
function keepFirstBold(text: string, used: { value: boolean }): string {
  return text.replace(boldSpans, (span, inner: string) => {
    if (used.value) return inner
    used.value = true
    return span
  })
}
export function paragraphMarkdownOf(sentences: readonly { text: string; format?: SentenceFormat }[]): string {
  const runs: { kind: SentenceFormat | "TEXT"; items: string[] }[] = []
  const boldInText = { value: false }
  for (const sentence of sentences) {
    const shortBold = withoutLongBold(inlineMarkdownOf(sentence.text, { listItem: Boolean(sentence.format) }))
    const text = sentence.format ? shortBold : keepFirstBold(shortBold, boldInText)
    if (!text) continue
    const kind = sentence.format ?? "TEXT"
    const last = runs[runs.length - 1]
    if (last && last.kind === kind) last.items.push(text)
    else runs.push({ kind, items: [text] })
  }
  const blocks: string[] = []
  for (const run of runs) {
    if (run.kind === "TEXT" || run.items.length < 2) {
      const text = run.items.join(" ")
      const previous = blocks[blocks.length - 1]
      // Texto que segue outro texto (lista de um item absorvida) continua o mesmo bloco.
      if (previous !== undefined && !/^(?:- |\d+\. )/u.test(previous)) blocks[blocks.length - 1] = `${previous} ${text}`
      else blocks.push(text)
    } else blocks.push(run.items.map((item, index) => (run.kind === "NUMBERED" ? `${index + 1}. ${item}` : `- ${item}`)).join("\n"))
  }
  return blocks.join("\n\n")
}
export type VerdictKind = "SUPPORTED" | "GENERALIZATION" | "UNSUPPORTED_ADDITION" | "CONTRADICTION" | "OVERREACH"
export type Verdict = { id: string; verdict: VerdictKind; specific: boolean | null; repeats: string | null; note: string | null; /** V5 — repete a ideia, mas traz detalhe concreto sustentado. */ addsInformation?: boolean | null }
/** V5 — o verificador lê a MENSAGEM inteira: transmite o ponto principal? vai além de narrar etapas? (mesma chamada de verificação). */
export type MessageAssessment = { conveysPrimary: boolean; valueBeyondNarration: boolean; note: string | null; /** `LIST_CHECK_V1`: frases que trazem uma relação de 3+ itens em texto corrido (leitura do verificador). */ unlistedRelation?: string[]; /** `FEEDBACK_FIRMNESS_V1` — null = nenhum ponto CORRECT/INSIST. */ firmnessRespected?: boolean | null }

const draftSchema = z.object({
  sentences: z.array(z.object({ text: z.string().trim().min(1), stance: z.enum(["CONTEXT", "RECOGNITION", "ADJUSTMENT", "GUIDANCE", "VALUE"]), refs: z.array(z.string()).default([]), paragraph: z.number().int().min(1).max(20).catch(1), format: z.unknown().optional().transform(formatOf) })).min(1),
  card: z.object({ text: z.string().trim().min(1), refs: z.array(z.string()).default([]) }),
})
const exampleSchema = z.object({ ref: z.string().trim().min(1), text: z.string().trim().min(1) })
export function parseWriterDraft(text: string): { ok: true; draft: WriterDraft } | { ok: false; error: string } {
  let raw: unknown
  try {
    raw = JSON.parse(unwrapJsonFence(text))
  } catch {
    return { ok: false, error: "MALFORMED_JSON" }
  }
  const parsed = draftSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: `SCHEMA_INVALID:${parsed.error.issues.map((issue) => issue.path.join(".")).slice(0, 5).join(",")}` }
  // Exemplo é opcional: um item malformado sai sozinho, nunca derruba o rascunho; um por ponto (o primeiro).
  const examples: { ref: string; text: string }[] = []
  for (const entry of Array.isArray((raw as { examples?: unknown }).examples) ? (raw as { examples: unknown[] }).examples : []) {
    const example = exampleSchema.safeParse(entry)
    if (!example.success) continue
    const ref = example.data.ref.trim().toUpperCase()
    if (!examples.some((existing) => existing.ref === ref)) examples.push({ ref, text: example.data.text })
  }
  const sentences = parsed.data.sentences.map(({ format, ...sentence }) => (format ? { ...sentence, format } : sentence))
  return { ok: true, draft: { ...parsed.data, sentences, ...(examples.length > 0 ? { examples } : {}) } }
}

/** Exemplos do rascunho como itens a conferir (E-<ref>), na mesma verificação das frases. */
export const exampleClaimId = (ref: string) => `E-${ref}`
export function exampleClaimsOf(draft: Pick<WriterDraft, "examples">): VerificationClaim[] {
  return (draft.examples ?? []).map((example) => ({ id: exampleClaimId(example.ref), text: example.text, stance: "EXAMPLE", refs: [example.ref] }))
}

const verdictSchema = z.object({
  verdicts: z.array(z.object({ id: z.string(), verdict: z.enum(["SUPPORTED", "GENERALIZATION", "UNSUPPORTED_ADDITION", "CONTRADICTION", "OVERREACH"]), specific: z.boolean().nullish(), repeats: z.string().nullish(), addsInformation: z.boolean().nullish(), note: z.string().nullish() })),
  message: z.object({ conveysPrimary: z.boolean(), valueBeyondNarration: z.boolean(), firmnessRespected: z.boolean().nullish(), unlistedRelation: z.array(z.string()).nullish().catch(null), note: z.string().nullish() }).nullish().catch(null),
  lostInformation: z.array(z.string()).nullish().catch(null),
})
/** `requiredIds` = frases do texto e card (sem eles não há verificação); leituras da análise ausentes ficam NÃO conferidas. */
export function parseVerdicts(text: string, requiredIds: readonly string[]): { ok: true; verdicts: Map<string, Verdict>; message: MessageAssessment | null; lost: string[] } | { ok: false; error: string } {
  let raw: unknown
  try {
    raw = JSON.parse(unwrapJsonFence(text))
  } catch {
    return { ok: false, error: "MALFORMED_JSON" }
  }
  const parsed = verdictSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: "SCHEMA_INVALID" }
  const normalize = (id: string) => id.trim().toUpperCase()
  const verdicts = new Map(parsed.data.verdicts.map((entry) => [normalize(entry.id), { id: normalize(entry.id), verdict: entry.verdict, specific: entry.specific ?? null, repeats: entry.repeats && entry.repeats.trim().length > 0 ? normalize(entry.repeats) : null, note: entry.note ?? null, addsInformation: entry.addsInformation ?? null }]))
  const missing = requiredIds.filter((id) => !verdicts.has(id))
  const unlisted = (parsed.data.message?.unlistedRelation ?? []).map(normalize).filter((id) => requiredIds.includes(id) && id !== "CARD")
  const message = parsed.data.message ? { conveysPrimary: parsed.data.message.conveysPrimary, valueBeyondNarration: parsed.data.message.valueBeyondNarration, note: parsed.data.message.note?.trim() || null, firmnessRespected: parsed.data.message.firmnessRespected ?? null, ...(unlisted.length > 0 ? { unlistedRelation: [...new Set(unlisted)] } : {}) } : null
  const lost = (parsed.data.lostInformation ?? []).map((entry) => entry.trim()).filter((entry) => entry.length > 0)
  return missing.length > 0 ? { ok: false, error: `VERDICTS_MISSING:${missing.join(",")}` } : { ok: true, verdicts, message, lost }
}

// ---------------------------------------------------------------------------------------------
// Checagens locais
// ---------------------------------------------------------------------------------------------
const INTERNAL_TOKEN = /\b(?:[ASLTDCP]\d{1,3}|KC-[0-9a-f]+|CP-[0-9a-f]+)\b|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\/materiais\//i
export const fold = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()
const numbersOf = (text: string) => [...text.matchAll(/\d+(?:[.,]\d+)?/g)].map((match) => match[0].replace(",", "."))
/** Palavras de conteúdo (≥ 4 letras, sem as de ligação mais comuns) — base da trava de vazamento dos DETALHES montados pelo sistema
 * (nunca julga frase do redator: repetição é decidida pelo verificador, `repeats`). */
const STOPWORDS = new Set(["para", "como", "quando", "antes", "depois", "sobre", "entre", "mais", "menos", "muito", "essa", "esse", "esta", "este", "isso", "isto", "aquele", "aquela", "pela", "pelo", "pelas", "pelos", "numa", "num", "uma", "umas", "uns", "cada", "que", "com", "sem", "você", "voce", "seus", "suas", "seu", "sua", "também", "tambem", "ainda", "porque", "então", "entao", "assim", "nesta", "neste", "nessa", "nesse", "chamada", "cliente", "etapa", "próxima", "proxima", "vez"])
export const contentTermsOf = (text: string) => new Set((fold(text).match(/\p{L}{4,}/gu) ?? []).filter((word) => !STOPWORDS.has(word)))

export type LocalViolation = "INTERNAL_REFERENCE" | "UNGROUNDED_NUMBER" | "UNKNOWN_REF" | "STANCE_REF_MISMATCH" | "PROHIBITED_CLAIM" | "IDENTIFIER_NOT_FROM_CALL"
/**
 * `CALL_IDENTIFIER_INTEGRITY_V1` (06/10/2026): identificador longo — protocolo, número de atendimento, telefone, documento: 8 dígitos
 * ou mais, juntos ou separados por ponto, hífen ou espaço — só vale se estiver numa FALA desta chamada. O número que aparece no texto
 * de uma regra é o exemplo ilustrativo do procedimento (a monitoria da L06 sugeriu "seu protocolo é 202609130184", o número do exemplo
 * da base). Integridade de dado, nunca leitura de sentido.
 */
const DATE_TOKEN = /^(?:\d{4}-\d{2}-\d{2}|\d{2}[.-]\d{2}[.-]\d{4})$/
const identifiersOf = (text: string) => [...text.matchAll(/\d(?:[\d.\- ]*\d)?/g)].map((match) => match[0].trim()).filter((token) => !DATE_TOKEN.test(token)).map((token) => token.replace(/\D/g, "")).filter((digits) => digits.length >= 8)
const callQuotesOf = (brief: FeedbackBrief) => [
  ...(brief.scenarioQuotes ?? []).map((quote) => quote.text),
  ...[...brief.developments, ...brief.strengths].flatMap((finding) => [...finding.quotes.map((quote) => quote.text), ...(finding.absence?.opportunity ? [finding.absence.opportunity.text] : []), ...(finding.steps ?? []).flatMap((step) => step.quotes.map((quote) => quote.text))]),
  ...(brief.openPoints ?? []).flatMap((point) => point.quotes.map((quote) => quote.text)),
]
/** Afirmação proibida pela ESTRATÉGIA do indicador (texto configurado pela operação — comparação pelo próprio texto configurado). */
export const containsProhibitedClaim = (text: string, prohibited: readonly string[]) => prohibited.some((claim) => claim.trim().length >= 3 && fold(text).includes(fold(claim).trim()))
export function localViolationsOf(sentence: { text: string; stance: ComposedSentence["stance"]; refs: readonly string[] }, brief: FeedbackBrief, grounding: string): LocalViolation[] {
  const violations: LocalViolation[] = []
  if (INTERNAL_TOKEN.test(sentence.text)) violations.push("INTERNAL_REFERENCE")
  if (containsProhibitedClaim(sentence.text, brief.prohibitedClaims ?? [])) violations.push("PROHIBITED_CLAIM")
  const allowed = new Set(numbersOf(grounding))
  if (numbersOf(sentence.text).some((number) => !allowed.has(number))) violations.push("UNGROUNDED_NUMBER")
  const identifiers = identifiersOf(sentence.text)
  if (identifiers.length > 0) {
    const fromCall = new Set(callQuotesOf(brief).flatMap(identifiersOf))
    if (identifiers.some((identifier) => !fromCall.has(identifier))) violations.push("IDENTIFIER_NOT_FROM_CALL")
  }
  const developments = new Set(brief.developments.map((finding) => finding.ref))
  const strengths = new Set(brief.strengths.map((finding) => finding.ref))
  const openPoints = new Set((brief.openPoints ?? []).map((point) => point.ref))
  const practices = new Set((brief.referencePractices ?? []).map((practice) => practice.ref))
  // Ponto feito só em parte: a parte cumprida pode ser reconhecida (os itens cumpridos da mesma lista estão nos fatos dele).
  const partlyDone = new Set(brief.developments.filter((finding) => (finding.sameList ?? []).some((sibling) => sibling.status === "MET")).map((finding) => finding.ref))
  const refs = sentence.refs.map((ref) => ref.trim().toUpperCase())
  if (refs.some((ref) => !developments.has(ref) && !strengths.has(ref) && !openPoints.has(ref) && !practices.has(ref))) violations.push("UNKNOWN_REF")
  if (sentence.stance === "RECOGNITION" && (refs.length === 0 || refs.some((ref) => !strengths.has(ref) && !partlyDone.has(ref)))) violations.push("STANCE_REF_MISMATCH")
  if (sentence.stance === "ADJUSTMENT" && (refs.length === 0 || refs.some((ref) => !developments.has(ref)))) violations.push("STANCE_REF_MISMATCH")
  if (sentence.stance === "GUIDANCE" && (refs.length === 0 || refs.some((ref) => !developments.has(ref) && !openPoints.has(ref) && !practices.has(ref)))) violations.push("STANCE_REF_MISMATCH")
  return violations
}

// ---------------------------------------------------------------------------------------------
// Leitura da análise a conferir (a orientação e o "por que importa" propostos pela análise são LEITURA, nunca fato)
// ---------------------------------------------------------------------------------------------
export const sentenceOf = (text: string) => {
  const trimmed = text.trim()
  if (trimmed.length === 0) return trimmed
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}${/[.!?…]$/.test(trimmed) ? "" : "."}`
}
const lowerFirst = (text: string) => text.replace(/^\p{Lu}(?!\p{Lu})/u, (letter) => letter.toLowerCase())

/** A orientação proposta pela análise, na forma EXATA em que seria usada nos detalhes ("como aplicar") — é essa frase que o verificador confere. */
export function guidanceSentenceOf(finding: Pick<BriefFinding, "guidance">): string | null {
  if (!finding.guidance) return null
  const condition = finding.guidance.condition ? `, ${lowerFirst(finding.guidance.condition.trim().replace(/^[,;\s]+/, "").replace(/[.;:]+$/, ""))}` : ""
  return sentenceOf(`Na próxima vez, ${lowerFirst(finding.guidance.moment.trim().replace(/[.;:]+$/, ""))}${condition}: ${lowerFirst(finding.guidance.action.trim())}`)
}

/** Itens da LEITURA da análise a conferir junto com o texto (orientação dos desvios; "por que importa" dos reconhecimentos). */
export function analysisClaimsOf(brief: FeedbackBrief): VerificationClaim[] {
  const claims: VerificationClaim[] = []
  for (const finding of brief.developments) {
    const guidance = guidanceSentenceOf(finding)
    if (guidance) claims.push({ id: `G-${finding.ref}`, text: guidance, stance: "GUIDANCE", refs: [finding.ref] })
  }
  for (const finding of brief.strengths) if (finding.whyItMatters) claims.push({ id: `W-${finding.ref}`, text: sentenceOf(finding.whyItMatters), stance: "VALUE", refs: [finding.ref] })
  return claims
}

// ---------------------------------------------------------------------------------------------
// Decisão por frase
// ---------------------------------------------------------------------------------------------
export type SentenceDecision = { id: string; text: string; stance: ComposedSentence["stance"]; refs: string[]; paragraph: number; kept: boolean; finalText: string | null; reasons: string[]; verdict: Verdict | null; format?: SentenceFormat }
const FACTUAL_REJECTIONS = new Set(["UNSUPPORTED_ADDITION", "CONTRADICTION", "OVERREACH"])
const accepted = (verdict: Verdict | null | undefined) => verdict?.verdict === "SUPPORTED" || verdict?.verdict === "GENERALIZATION"

/** Decisão sobre um exemplo de como dizer: vale só se o verificador o sustentou, como fala concreta, de um ponto de desenvolvimento. */
export type ExampleDecision = { id: string; ref: string; text: string; accepted: boolean; reasons: string[]; verdict: Verdict | null }
export type AppliedVerdicts = { sentences: SentenceDecision[]; card: SentenceDecision; analysis: { id: string; text: string; accepted: boolean; verdict: Verdict | null }[]; /** V5 */ message?: MessageAssessment | null; /** V5 — informação útil aprovada antes e perdida nesta versão. */ lost?: string[]; /** `SPEECH_EXAMPLE_V1` */ examples?: ExampleDecision[] }

export function applyVerdicts(draft: WriterDraft, brief: FeedbackBrief, verdicts: ReadonlyMap<string, Verdict> | null, assessment: { message?: MessageAssessment | null; lost?: readonly string[] } = {}): AppliedVerdicts {
  const grounding = groundingTextsOf(brief).join("\n")
  const decide = (id: string, sentence: { text: string; stance: ComposedSentence["stance"]; refs: string[]; paragraph: number; format?: SentenceFormat }): SentenceDecision => {
    const refs = sentence.refs.map((ref) => ref.trim().toUpperCase())
    const local = localViolationsOf({ ...sentence, refs }, brief, grounding)
    const verdict = verdicts?.get(id) ?? null
    const reasons: string[] = [...local]
    if (!verdict) reasons.push("NOT_VERIFIED")
    else if (FACTUAL_REJECTIONS.has(verdict.verdict)) reasons.push(verdict.verdict)
    if ((sentence.stance === "GUIDANCE" || sentence.stance === "RECOGNITION") && verdict && verdict.specific === false) reasons.push("GENERIC")
    return { id, text: sentence.text, stance: sentence.stance, refs, paragraph: sentence.paragraph, kept: reasons.length === 0, finalText: reasons.length === 0 ? sentence.text : null, reasons, verdict, ...(sentence.format ? { format: sentence.format } : {}) }
  }
  const sentences = draft.sentences.map((sentence, index) => decide(`F${index + 1}`, sentence))
  // Repetição: a frase que SÓ repete uma anterior mantida sai (a mesma orientação uma vez só) — decidido pelo verificador (`repeats`),
  // nunca por palavras em comum. A que repete a ideia trazendo um detalhe concreto e sustentado (`addsInformation`) fica.
  const kept: SentenceDecision[] = []
  for (const decision of sentences) {
    if (!decision.kept) continue
    if (decision.verdict?.addsInformation === true) {
      kept.push(decision)
      continue
    }
    const repeatsKept = decision.verdict?.repeats ? kept.some((entry) => entry.id === decision.verdict!.repeats) : false
    if (repeatsKept) {
      decision.kept = false
      decision.finalText = null
      decision.reasons.push("REDUNDANT")
      continue
    }
    kept.push(decision)
  }
  const card = decide("CARD", { text: draft.card.text, stance: "CONTEXT", refs: draft.card.refs, paragraph: 0 })
  // O cartão RESUME o conjunto final (`FEEDBACK_COMPOSITION_V7`): citar um ponto que nenhuma frase mantida comunica é trazer de volta
  // uma conclusão que saiu do corpo (rodada real V11: a frase sobre "localizar no histórico" caiu, o cartão continuou dizendo isso).
  const keptRefs = new Set(kept.flatMap((entry) => entry.refs))
  if (card.kept && card.refs.some((ref) => !keptRefs.has(ref))) {
    card.kept = false
    card.finalText = null
    card.reasons.push("CARD_NOT_IN_TEXT")
  }
  const analysis = analysisClaimsOf(brief).map((claim) => {
    const verdict = verdicts?.get(claim.id) ?? null
    const local = localViolationsOf({ text: claim.text, stance: claim.stance as ComposedSentence["stance"], refs: claim.refs }, brief, grounding)
    return { id: claim.id, text: claim.text, accepted: accepted(verdict) && local.length === 0 && (claim.stance !== "GUIDANCE" || verdict?.specific !== false), verdict }
  })
  // Exemplo de como dizer: as mesmas checagens locais de uma frase (código interno, número fora dos fatos, ref), só de ponto de
  // desenvolvimento, e o verificador precisa sustentá-lo E dizê-lo concreto (fala pronta ao cliente, sem lacuna) — ausente = recusado.
  const developments = new Set(brief.developments.map((finding) => finding.ref))
  const examples: ExampleDecision[] = (draft.examples ?? []).map((example) => {
    const id = exampleClaimId(example.ref)
    const verdict = verdicts?.get(id) ?? null
    const reasons: string[] = [...localViolationsOf({ text: example.text, stance: "CONTEXT", refs: [example.ref] }, brief, grounding)]
    if (!developments.has(example.ref)) reasons.push("NOT_A_DEVELOPMENT")
    if (!verdict) reasons.push("NOT_VERIFIED")
    else if (FACTUAL_REJECTIONS.has(verdict.verdict)) reasons.push(verdict.verdict)
    else if (verdict.specific !== true) reasons.push("NOT_USABLE_AS_SPEECH")
    return { id, ref: example.ref, text: example.text, accepted: reasons.length === 0, reasons, verdict }
  })
  return { sentences, card, analysis, message: assessment.message ?? null, lost: [...(assessment.lost ?? [])], ...(examples.length > 0 ? { examples } : {}) }
}

/** Leituras da análise APROVADAS em todas as verificações que as conferiram (uma recusa em qualquer rodada = não confiável). */
export function trustedReadingsOf(brief: FeedbackBrief, rounds: readonly AppliedVerdicts[]): TrustedReadings {
  const trusted: TrustedReadings = { guidance: {}, why: {} }
  for (const claim of analysisClaimsOf(brief)) {
    const judged = rounds.map((round) => round.analysis.find((entry) => entry.id === claim.id)).filter((entry): entry is AppliedVerdicts["analysis"][number] => Boolean(entry && entry.verdict))
    if (judged.length === 0 || !judged.every((entry) => entry.accepted)) continue
    const ref = claim.refs[0]!
    if (claim.id.startsWith("G-")) trusted.guidance[ref] = claim.text
    else trusted.why[ref] = claim.text
  }
  return trusted
}

/**
 * UTILIDADE (checada por código sobre refs e vereditos):
 *   - o ponto PRINCIPAL precisa ser entregue: com desvio, o primeiro desvio com uma orientação praticável (GUIDANCE específica ou
 *     ADJUSTMENT que o verificador considerou específico — o que mudar, quando); sem desvio, um reconhecimento ESPECÍFICO; sem
 *     nenhum dos dois (comunicação INFORMATIVA), ao menos uma frase de contexto verificada;
 *   - os demais desvios HIGH sem orientação são pedidos na reescrita, mas não impedem a mensagem: a IA decide o que comunicar; o que
 *     não foi comunicado não é marcado como entregue e continua disponível para outro retorno.
 */
export type Usefulness = { primaryRef: string | null; primaryCovered: boolean; missingGuidance: string[]; missingRecognition: boolean; missingContext: boolean; /** V5 — leitura do verificador sobre a mensagem inteira: não transmite o ponto principal ou só narra etapas. */ missingValue?: string | null; /** `REFERENCE_PRACTICES_V1` — há prática dos colegas com melhor resultado que orienta (P-n) e nenhuma frase a usa. */ missingPractice?: string[]; /** `FEEDBACK_FIRMNESS_V1` — pontos CORRECT/INSIST comunicados sem nenhuma frase de ajuste (viraram só sugestão). */ missingCorrection?: string[]; /** O verificador leu a mensagem e a correção ficou amaciada (ou a insistência sem a orientação anterior). */ softenedCorrection?: string | null; /** `ARGUMENT_PHRASING_V1` — pontos comunicados com fraseologia do argumentário e sem exemplo de como dizer aceito. */ missingPhrasingExample?: string[]; /** `ALL_DEVELOPMENTS_V1` — pontos de desenvolvimento que nenhuma frase mantida comunica. */ missingDevelopment?: string[]; /** `ADJUSTMENT_IN_CALL_V1` — pontos comunicados só como orientação para a próxima vez, sem dizer o que aconteceu nesta chamada. */ missingAdjustment?: string[]; /** `LIST_CHECK_V1` — frases mantidas com uma relação de itens em texto corrido (o verificador leu). */ missingList?: string[] }
/** Práticas dos colegas que ACRESCENTAM orientação (a pessoa não tem avaliação dela, ou o grupo cumpre e ela não): pedidas na reescrita. */
const actionablePracticesOf = (brief: FeedbackBrief) => (brief.referencePractices ?? []).filter((practice) => practice.contrast === "REFERENCE_ONLY" || practice.contrast === "REFERENCE_FOLLOWS_PERSON_MISSES")
/** Pontos de desenvolvimento cuja regra (ou etapa) vem com a fraseologia sugerida pelo argumentário. */
const phrasedDevelopmentsOf = (brief: FeedbackBrief) => brief.developments.filter((finding) => [...finding.rules, ...(finding.steps ?? []).flatMap((step) => step.rules ?? (step.rule ? [step.rule] : []))].some((rule) => rule.phrasing)).map((finding) => finding.ref)
/** `acceptedExamples` ausente = a exigência da fraseologia não é conferida (leitores antigos da auditoria). */
export function usefulnessOf(brief: FeedbackBrief, kept: readonly (Pick<SentenceDecision, "stance" | "refs" | "verdict"> & { id?: string })[], message?: MessageAssessment | null, acceptedExamples?: ReadonlySet<string>): Usefulness {
  const covered = (ref: string) => kept.some((sentence) => sentence.refs.includes(ref) && ((sentence.stance === "GUIDANCE" && sentence.verdict?.specific !== false) || (sentence.stance === "ADJUSTMENT" && sentence.verdict?.specific === true)))
  const missingGuidance = brief.developments.filter((finding) => finding.materiality === "HIGH" && !covered(finding.ref)).map((finding) => finding.ref)
  const recognized = brief.strengths.some((finding) => kept.some((sentence) => sentence.refs.includes(finding.ref) && sentence.stance === "RECOGNITION" && sentence.verdict?.specific !== false))
  const missingRecognition = brief.developments.length === 0 && brief.strengths.length > 0 && !recognized
  const missingContext = brief.developments.length === 0 && brief.strengths.length === 0 && !kept.some((sentence) => sentence.stance === "CONTEXT")
  const primary = brief.developments[0] ?? brief.strengths[0] ?? null
  const primaryCovered = primary ? (primary.kind === "DEVELOPMENT" ? covered(primary.ref) : recognized) : !missingContext
  const missingValue = message && (!message.conveysPrimary || !message.valueBeyondNarration) ? (message.note ?? (!message.conveysPrimary ? "a mensagem não transmite o ponto principal" : "a mensagem só narra etapas cumpridas")) : null
  const practiceRefs = new Set((brief.referencePractices ?? []).map((practice) => practice.ref))
  const usesPractice = kept.some((sentence) => sentence.refs.some((ref) => practiceRefs.has(ref)))
  const missingPractice = usesPractice ? [] : actionablePracticesOf(brief).map((practice) => practice.ref)
  // Firmeza (estrutural): um ponto que pede correção e que o texto comunica precisa de uma frase de AJUSTE com a ref dele — só
  // orientação ("da próxima vez, vale…") transforma a correção em sugestão. Ponto não comunicado não entra (a IA decide o que dizer).
  const firm = brief.developments.filter((finding) => finding.firmness && finding.firmness.level !== "ORIENT")
  const missingCorrection = firm.filter((finding) => kept.some((sentence) => sentence.refs.includes(finding.ref)) && !kept.some((sentence) => sentence.stance === "ADJUSTMENT" && sentence.refs.includes(finding.ref))).map((finding) => finding.ref)
  const softenedCorrection = firm.length > 0 && message?.firmnessRespected === false ? (message.note ?? "a correção ficou amaciada") : null
  // `ARGUMENT_PHRASING_V1`: a operação escreveu como dizer — o ponto comunicado que tem essa fraseologia leva um exemplo a partir dela.
  // Lacuna de utilidade (pede a reescrita), nunca bloqueio: sem exemplo aceito, a mensagem sai sem ele.
  const missingPhrasingExample = acceptedExamples ? phrasedDevelopmentsOf(brief).filter((ref) => kept.some((sentence) => sentence.refs.includes(ref)) && !acceptedExamples.has(ref)) : []
  // `ALL_DEVELOPMENTS_V1`: todo ponto de desenvolvimento é uma conduta confirmada nesta chamada (o brief só traz os materiais) — ponto
  // que nenhuma frase comunica é lacuna pedida na reescrita (titularidade, 06/10: recapitulação e contato anterior ficaram de fora).
  // Nunca bloqueia: sem reescrita que caiba, a mensagem sai e o ponto não comunicado não é marcado como entregue.
  const missingDevelopment = brief.domain !== "MONITORING" ? [] : brief.developments.filter((finding) => !kept.some((sentence) => sentence.refs.includes(finding.ref))).map((finding) => finding.ref)
  // `ADJUSTMENT_IN_CALL_V1`: ponto de desenvolvimento comunicado só como orientação ("nas próximas chamadas, recapitule…") deixa a pessoa
  // sem saber se errou ou se é uma dica (titularidade, 06/10: recapitulação e contato anterior). Precisa de uma frase ADJUSTMENT com o que
  // aconteceu NESTA chamada. Ponto que pede correção já é cobrado por `missingCorrection`; reavaliação pela regra atual não cobra a época.
  const missingAdjustment = brief.domain !== "MONITORING" ? [] : brief.developments.filter((finding) => (!finding.firmness || finding.firmness.level === "ORIENT") && finding.ruleBasis !== "CURRENT_RULE_REEVALUATION" && kept.some((sentence) => sentence.refs.includes(finding.ref)) && !kept.some((sentence) => sentence.stance === "ADJUSTMENT" && sentence.refs.includes(finding.ref))).map((finding) => finding.ref)
  const missingList = (message?.unlistedRelation ?? []).filter((id) => kept.some((sentence) => sentence.id === id))
  return { primaryRef: primary?.ref ?? null, primaryCovered, missingGuidance, missingRecognition, missingContext, missingValue, ...(missingPractice.length > 0 ? { missingPractice } : {}), ...(missingCorrection.length > 0 ? { missingCorrection } : {}), ...(softenedCorrection ? { softenedCorrection } : {}), ...(missingPhrasingExample.length > 0 ? { missingPhrasingExample } : {}), ...(missingDevelopment.length > 0 ? { missingDevelopment } : {}), ...(missingAdjustment.length > 0 ? { missingAdjustment } : {}), ...(missingList.length > 0 ? { missingList } : {}) }
}
/** Compatibilidade com leitores antigos da auditoria (`gaps`). */
export const utilityGapsOf = (brief: FeedbackBrief, kept: readonly Pick<SentenceDecision, "stance" | "refs" | "verdict">[]) => {
  const usefulness = usefulnessOf(brief, kept)
  return { missingGuidance: usefulness.missingGuidance, missingRecognition: usefulness.missingRecognition }
}

/** Instruções da reescrita: só motivos e FATOS (a regra literal para situar) — nunca a orientação da análise que não foi aprovada. */
export function repairInstructionsOf(decisions: readonly SentenceDecision[], usefulness: Usefulness, brief: FeedbackBrief, trusted: TrustedReadings): string[] {
  const reasons: string[] = []
  for (const decision of decisions.filter((entry) => !entry.kept)) {
    if (decision.id === "CARD" && decision.reasons.includes("CARD_NOT_IN_TEXT")) reasons.push(`O resumo (card) "${decision.text}" cita ponto(s) que o texto não comunica mais (${decision.refs.join(", ")}): o resumo só pode resumir o que está no texto — reescreva-o a partir das frases mantidas.`)
    else reasons.push(`A frase "${decision.text}" foi recusada (${decision.reasons.join(", ")}). ${decision.verdict?.note ?? ""}`.trim())
  }
  for (const ref of usefulness.missingDevelopment ?? []) {
    const finding = brief.developments.find((entry) => entry.ref === ref)
    if (!finding) continue
    reasons.push(`O ponto ${ref} ("${finding.title}") não foi comunicado: ele é uma conduta confirmada nesta chamada e precisa aparecer — diga o que aconteceu (ou o que faltou) e o que fazer, numa frase ADJUSTMENT ou GUIDANCE com a ref ${ref}. Pode juntá-lo a outro ponto do mesmo momento da chamada.`)
  }
  for (const id of usefulness.missingList ?? []) {
    const decision = decisions.find((entry) => entry.id === id)
    if (!decision) continue
    reasons.push(`A frase "${decision.text}" traz uma relação de itens em texto corrido: escreva esses itens como lista (format BULLET, um item por frase), com uma frase sem format que a apresente antes, no mesmo parágrafo. O resto do texto pode continuar como está.`)
  }
  for (const ref of usefulness.missingAdjustment ?? []) {
    const finding = brief.developments.find((entry) => entry.ref === ref)
    if (!finding) continue
    reasons.push(`O ponto ${ref} ("${finding.title}") foi dito só como orientação para as próximas chamadas: diga também, numa frase ADJUSTMENT com a ref ${ref}, o que aconteceu NESTA chamada — o que foi dito no lugar (a fala, se ajudar) ou que a etapa não aconteceu — antes do que fazer. Sem julgar a pessoa.`)
  }
  for (const ref of usefulness.missingGuidance) {
    const finding = brief.developments.find((entry) => entry.ref === ref)
    if (!finding) continue
    const approved = trusted.guidance[ref]
    reasons.push(`Para ${ref} ("${finding.title}") ainda não há uma orientação praticável: diga o que fazer e em que momento, com base na regra desse ponto${approved ? ` (a leitura conferida pode ajudar: ${approved})` : ""}. Se esse ponto não for o que importa comunicar agora, ele pode ficar de fora — mas o ponto principal (${usefulness.primaryRef ?? "—"}) precisa estar claro.`)
  }
  if (usefulness.missingRecognition) reasons.push("Falta um reconhecimento ESPECÍFICO (RECOGNITION com ref S-n): diga exatamente o que foi bem feito neste caso e por que isso importou nesta situação.")
  if (usefulness.missingContext) reasons.push("Falta dizer, com os fatos do caso, o que a investigação mostrou (CONTEXT).")
  if ((usefulness.missingPractice ?? []).length > 0) {
    const practices = (brief.referencePractices ?? []).filter((practice) => usefulness.missingPractice!.includes(practice.ref))
    reasons.push(`Os fatos trazem prática(s) dos colegas com melhor resultado que dão uma orientação concreta (${practices.map((practice) => `${practice.ref} "${practice.title}"`).join("; ")}). Inclua ao menos uma como boa prática que vale reforçar (GUIDANCE ou CONTEXT com a ref P-n), com o número agregado como está — sem nomes, sem dizer que ela explica o resultado de alguém e, quando you é null, sem dizer nem insinuar que a pessoa não faz.`)
  }
  for (const ref of usefulness.missingCorrection ?? []) {
    const finding = brief.developments.find((entry) => entry.ref === ref)
    if (!finding?.firmness) continue
    reasons.push(`O ponto ${ref} ("${finding.title}") pede correção (firmness ${finding.firmness.level}): diga com clareza, numa frase ADJUSTMENT com a ref ${ref}, o que não foi feito naquela chamada e por que importa${finding.firmness.level === "INSIST" ? ", e que esse ponto já tinha sido orientado antes (como está no basis)" : ""} — não só uma sugestão para a próxima vez. Firme sobre a conduta, nunca sobre a pessoa.`)
  }
  for (const ref of usefulness.missingPhrasingExample ?? []) {
    const finding = brief.developments.find((entry) => entry.ref === ref)
    if (!finding) continue
    reasons.push(`O ponto ${ref} ("${finding.title}") traz a fraseologia sugerida pelo argumentário da operação (suggestedPhrasing) e ainda não tem um exemplo de como dizer aceito: proponha em examples, com a ref ${ref}, uma fala ao cliente a partir dela — adaptada ao caso, com as lacunas preenchidas só pelos fatos (o prazo da regra, as palavras do cliente) e sem protocolo, telefone ou documento que não esteja nas falas desta chamada.`)
  }
  if (usefulness.softenedCorrection) reasons.push(`A correção ficou amaciada: ${usefulness.softenedCorrection}. Nos pontos com firmness CORRECT ou INSIST, diga diretamente o que não foi feito e o que fazer, sem transformar em sugestão nem esconder atrás de elogio — e sem julgar a pessoa.`)
  if (usefulness.missingValue) reasons.push(`A mensagem como um todo ainda não ajuda o suficiente: ${usefulness.missingValue}. O ponto principal (${usefulness.primaryRef ?? "—"}) precisa ficar claro — o que aconteceu e o que fazer e quando (ajuste), ou a decisão concreta e o que ela significou no caso (reconhecimento) — sem narrar etapas.`)
  // Preservar o que já estava bom: a reescrita corrige o que foi apontado SEM perder a informação útil aprovada.
  // A formatação vai junto (`NARRATIVE_FORMATTING_V1`): sem ela, a reescrita desfazia a lista aprovada (titularidade, 06/10).
  const approved = decisions.filter((entry) => entry.kept && entry.id !== "CARD").map((entry) => (entry.format === "BULLET" ? `[item de lista] ${entry.text}` : entry.format === "NUMBERED" ? `[item numerado] ${entry.text}` : entry.text))
  if (reasons.length > 0 && approved.length > 0) reasons.push(`Mantenha a informação destas frases aprovadas (pode reescrever, juntar ou reordenar, sem perder o detalhe concreto, as condições e a formatação — o que era item de lista continua item de lista, com format): ${approved.map((text) => `"${text}"`).join(" ")}`)
  const redundantWithDetail = decisions.filter((entry) => !entry.kept && entry.reasons.includes("REDUNDANT") && entry.verdict?.addsInformation === true)
  for (const entry of redundantWithDetail) reasons.push(`A frase "${entry.text}" repetia outra, mas trazia detalhe concreto: junte esse detalhe à frase que ela repete.`)
  return reasons
}

// ---------------------------------------------------------------------------------------------
// Conjunto: mensagem = frases VERIFICADAS do redator (nada de frase pronta do sistema)
// ---------------------------------------------------------------------------------------------
/** Conteúdo que NÃO pode aparecer: recusado (em qualquer superfície) e leitura não conferida (nos detalhes montados pelo sistema). */
export type ForbiddenContent = { rejected: string[]; untrusted: string[] }

export function forbiddenContentOf(brief: FeedbackBrief, rounds: readonly AppliedVerdicts[], trusted: TrustedReadings): ForbiddenContent {
  const rejected = new Set<string>()
  for (const round of rounds) {
    for (const decision of [...round.sentences, round.card]) if (decision.reasons.some((reason) => FACTUAL_REJECTIONS.has(reason))) rejected.add(decision.text)
    for (const claim of round.analysis) if (claim.verdict && FACTUAL_REJECTIONS.has(claim.verdict.verdict)) rejected.add(claim.text)
  }
  const findings = [...brief.developments, ...brief.strengths]
  for (const finding of brief.developments) if (finding.guidance && !trusted.guidance[finding.ref] && [...rejected].some((text) => text === guidanceSentenceOf(finding))) rejected.add(finding.guidance.action)
  const untrusted = [
    ...findings.flatMap((finding) => [finding.reading ?? "", ...(finding.guidance && !trusted.guidance[finding.ref] ? [finding.guidance.action, guidanceSentenceOf(finding) ?? ""] : []), ...(finding.whyItMatters && !trusted.why[finding.ref] ? [finding.whyItMatters] : [])]),
    brief.situation ?? "",
  ].filter((text) => text.trim().length > 0)
  return { rejected: [...rejected], untrusted }
}

/**
 * Termos NOVOS de um conteúdo = palavras de conteúdo que não existem em nenhum fato do caso. Um texto que traz de volta esses
 * termos está reintroduzindo o que só a leitura recusada/não conferida dizia. Sem termo novo (ex.: a regra invertida com as mesmas
 * palavras), a comparação é pelo texto inteiro.
 */
function leaks(surface: string, item: string, factTerms: Set<string>): boolean {
  const novel = [...contentTermsOf(item)].filter((term) => !factTerms.has(term))
  const surfaceTerms = contentTermsOf(surface)
  if (novel.length === 0) return item.trim().length >= 20 && fold(surface).includes(fold(item).replace(/[.!?…]+$/, "").trim())
  const present = novel.filter((term) => surfaceTerms.has(term)).length
  return present >= Math.min(2, novel.length) && (novel.length > 1 || novel[0]!.length >= 6)
}

export type ContentLeak = { surface: string; text: string; item: string; kind: "REJECTED" | "UNTRUSTED" }
/**
 * Trava final dos DETALHES montados pelo sistema ("o que aconteceu", "como aplicar", "por que importa", provas do que manter):
 * conteúdo recusado ou leitura não conferida nunca aparece neles. As frases e o card do REDATOR não passam por esta trava — cada
 * uma foi conferida pelo verificador contra os fatos (uma comparação de palavras aqui só criaria falso positivo). Frase de origem
 * SYSTEM, se um dia existir, é conferida como os detalhes.
 */
export function contentLeaksOf(message: Pick<ComposedMessage, "card" | "sentences" | "view">, brief: FeedbackBrief, forbidden: ForbiddenContent): ContentLeak[] {
  const factTerms = contentTermsOf(groundingTextsOf(brief).join("\n"))
  const out: ContentLeak[] = []
  const check = (surface: string, text: string, checkUntrusted: boolean) => {
    if (!text) return
    for (const item of forbidden.rejected) if (leaks(text, item, factTerms)) out.push({ surface, text, item, kind: "REJECTED" })
    if (checkUntrusted) for (const item of forbidden.untrusted) if (leaks(text, item, factTerms)) out.push({ surface, text, item, kind: "UNTRUSTED" })
  }
  message.sentences.forEach((sentence, index) => {
    if (sentence.source === "SYSTEM") check(`sentence:${index}`, sentence.text, true)
  })
  message.view.developments.forEach((detail, index) => {
    check(`view.developments.${index}.whatHappened`, detail.whatHappened, true)
    if (detail.howToApply) check(`view.developments.${index}.howToApply`, detail.howToApply, false)
    detail.whyItMatters.forEach((text, position) => check(`view.developments.${index}.whyItMatters.${position}`, text, false))
    detail.adjustment.forEach((text, position) => check(`view.developments.${index}.adjustment.${position}`, text, true))
  })
  if (message.view.maintain) {
    check("view.maintain.summary", message.view.maintain.summary, true)
    message.view.maintain.evidence.forEach((entry, index) => check(`view.maintain.evidence.${index}`, entry.statement, false))
  }
  return out
}

/** Frase que depende da anterior ("Isso…", "Nesse caso…", "Por isso…") — quando a anterior saiu, o conjunto precisa ser reconferido. */
const ANAPHORIC_OPENING = /^(?:isso|isto|esse|essa|este|esta|nesse|nessa|neste|nesta|assim|por isso|dessa forma|desse modo|com isso|também|além disso|mas|porém|entretanto|então|aí)\b/i
export type CoherenceNeed = { required: boolean; removed: string[]; danglingAfterRemoval: string[] }
/**
 * O conjunto precisa ser reconferido quando uma frase do rascunho saiu por um motivo que não é mera repetição: tirar uma frase pode
 * deixar a seguinte sem referente, sem a condição ou com a conclusão invertida. Frase que abre com referência à anterior removida
 * é sinal de conjunto quebrado (a conferência semântica decide o resto).
 */
export function coherenceNeedOf(decisions: AppliedVerdicts): CoherenceNeed {
  const removed = decisions.sentences.filter((entry) => !entry.kept && !entry.reasons.every((reason) => reason === "REDUNDANT"))
  const dangling: string[] = []
  decisions.sentences.forEach((entry, index) => {
    if (!entry.kept || index === 0) return
    const previous = decisions.sentences[index - 1]!
    if (!previous.kept && !previous.reasons.every((reason) => reason === "REDUNDANT") && ANAPHORIC_OPENING.test(fold(entry.text).trim())) dangling.push(entry.id)
  })
  return { required: removed.length > 0, removed: removed.map((entry) => entry.id), danglingAfterRemoval: dangling }
}

export type AssembledMessage = ComposedMessage & { leaksRemoved: ContentLeak[]; communicatedRefs: string[] }

/**
 * Monta a mensagem a partir das frases VERIFICADAS do redator — sem nenhuma frase do sistema. O card é o do redator; recusado, a
 * primeira frase mantida do ponto principal (também verificada). Conteúdo proibido que reaparecer em qualquer superfície derruba a
 * montagem (null): a mensagem não é publicada "para não ficar sem feedback".
 */
export function assembleMessage(brief: FeedbackBrief, decisions: AppliedVerdicts, options: { trusted?: TrustedReadings; forbidden?: ForbiddenContent } = {}): AssembledMessage | null {
  const trusted = options.trusted ?? { guidance: {}, why: {} }
  const forbidden = options.forbidden ?? { rejected: [], untrusted: [] }
  const sentences: ComposedSentence[] = decisions.sentences.filter((entry) => entry.kept && entry.finalText).map((entry) => ({ text: entry.finalText!, stance: entry.stance, refs: entry.refs, paragraph: entry.paragraph, source: "WRITER" as const, basis: "WRITER_VERIFIED" as const, ...(entry.format ? { format: entry.format } : {}) }))
  if (sentences.length === 0) return null
  const communicatedRefs = [...new Set(sentences.flatMap((sentence) => sentence.refs))]
  const primaryRef = brief.developments[0]?.ref ?? brief.strengths[0]?.ref ?? null
  const card = plainInlineOf(decisions.card.kept && decisions.card.finalText ? decisions.card.finalText : (sentences.find((sentence) => primaryRef !== null && sentence.refs.includes(primaryRef)) ?? sentences[0]!).text)
  const approved: TrustedReadings = { guidance: { ...trusted.guidance }, why: { ...trusted.why } }
  const paragraphs = [...new Set(sentences.map((entry) => entry.paragraph))].sort((a, b) => a - b).map((number) => paragraphMarkdownOf(sentences.filter((entry) => entry.paragraph === number))).filter((paragraph) => paragraph.length > 0)
  // Exemplo verificado vai aos detalhes do ponto ("Como melhorar"); de ponto não comunicado, não aparece (o ponto não aparece).
  const examples = Object.fromEntries((decisions.examples ?? []).filter((entry) => entry.accepted).map((entry) => [entry.ref, entry.text]))
  let view = feedbackViewOf(brief, { card, paragraphs, sentences, trusted: approved, communicatedRefs, examples })
  const leaksRemoved: ContentLeak[] = []
  // Trava final: leitura aprovada suspeita deixa de aparecer nos detalhes; conteúdo recusado no texto ou no card = sem mensagem.
  for (let round = 0; round < 2; round++) {
    const found = contentLeaksOf({ card, sentences, view }, brief, forbidden)
    if (found.length === 0) break
    if (found.some((leak) => leak.surface.startsWith("sentence:") || leak.surface === "card")) return null
    leaksRemoved.push(...found)
    for (const leak of found) {
      const development = /^view\.developments\.(\d+)\./.exec(leak.surface)
      if (development) {
        const ref = view.developments[Number(development[1])]?.key
        // Etapa de um ponto consolidado (`STEP_DETAILS_V1`) tem a chave da etapa: o ponto é o que a contém.
        const finding = brief.developments.find((entry) => entry.findingKey === ref || (entry.steps ?? []).some((step) => step.findingKey === ref))
        if (finding) delete approved.guidance[finding.ref]
      }
      const maintained = /^view\.maintain\.evidence\.(\d+)/.exec(leak.surface)
      if (maintained) {
        const title = view.maintain?.evidence[Number(maintained[1])]?.title
        const finding = brief.strengths.find((entry) => entry.title === title)
        if (finding) delete approved.why[finding.ref]
      }
    }
    view = feedbackViewOf(brief, { card, paragraphs, sentences, trusted: approved, communicatedRefs, examples })
    if (round === 1 && contentLeaksOf({ card, sentences, view }, brief, forbidden).length > 0) return null
  }
  return { card, paragraphs, sentences, view, text: plainTextOf(view), source: "WRITER", trusted: approved, leaksRemoved, communicatedRefs }
}
