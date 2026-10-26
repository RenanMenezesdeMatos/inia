import { createHash } from "node:crypto"

/**
 * PROJEÇÃO DE PRIVACIDADE DA TRANSCRIÇÃO DE UM PAR (hotfix de homologação, 2026-09-18).
 *
 * Três contextos que nunca se misturam:
 *   - AUDIT: a transcrição ORIGINAL persistida (`transcripts.content`) — nunca alterada, sempre
 *     rastreável pelo `sourceInteractionId` + `sourceHash`;
 *   - MODEL: só a PROJEÇÃO — a identidade do par (nome completo, primeiro nome, apresentação, vocativo)
 *     e PII evidente (telefone, e-mail, CPF, protocolo) substituídas por marcadores estáveis;
 *   - VERIFICAÇÃO: a citação literal do modelo é conferida contra a PROJEÇÃO (o que ele recebeu), e
 *     qualquer citação que reintroduza a identidade do par é recusada.
 *
 * Determinístico, sem LLM: nomes vêm da identidade conhecida (people), padrões de PII são regex fixos.
 * O ALVO da investigação não é redigido aqui (o modelo já o conhece por autorização); a projeção só se
 * aplica a transcrições de PARES. Nome de cliente não é redigido (não há identidade estruturada para
 * fazê-lo com confiança — nunca por adivinhação).
 */
export const OPERATOR_PLACEHOLDER = "[OPERADOR]"
export const PII_PLACEHOLDERS = { PHONE: "[TELEFONE]", EMAIL: "[EMAIL]", CPF: "[CPF]", PROTOCOL: "[PROTOCOLO]" } as const
export const PEER_PRIVACY_PROJECTION_VERSION = "PEER_PRIVACY_V1"

export type RedactionKind = "PEER_NAME" | "OPERATOR_NAME" | "PHONE" | "EMAIL" | "CPF" | "PROTOCOL"
export type PrivacyRedaction = { kind: RedactionKind; replacement: string; count: number }
export type PeerIdentity = { personId: string; fullName: string }
export type PeerPrivacyProjectionInput = {
  sourceInteractionId: string
  transcript: string
  /** Operador dono da transcrição (par): todas as formas identificáveis do nome saem. */
  peer: PeerIdentity
  /** Outros operadores conhecidos da população (nome completo sai; primeiro nome só em apresentação/vocativo). */
  knownOperators?: readonly PeerIdentity[]
  /** Alvo da investigação — nunca é redigido (identidade autorizada), nem confundido com o par. */
  target?: PeerIdentity | null
  redactPii?: boolean
}
export type PeerTranscriptPrivacyProjection = {
  version: typeof PEER_PRIVACY_PROJECTION_VERSION
  sourceInteractionId: string
  /** SHA-256 da transcrição original — ponte da projeção para o AUDIT context. */
  sourceHash: string
  projected: string
  redactions: PrivacyRedaction[]
  /** Formas que NUNCA podem aparecer numa citação do modelo (verificação de reidentificação). */
  forbiddenTerms: string[]
}

/** Primeiros nomes que também são palavras comuns: só saem em apresentação/vocativo, nunca soltos. */
const COMMON_WORD_FIRST_NAMES = new Set(["sol", "rosa", "bela", "luz", "paz", "flor", "cristal", "graca", "gloria", "vitoria", "branca", "mar", "bento", "leda", "celeste", "alba", "estrela", "aurora", "iris"])
const PARTICLES = new Set(["da", "de", "do", "das", "dos", "e"])

export function foldAccents(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "")
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Regex insensível a caixa e acentos para um nome (cada letra acentuada casa com/sem acento). */
function namePattern(name: string): string {
  return foldAccents(name)
    .split(/\s+/)
    .map((token) => [...token].map((char) => (/[a-z]/i.test(char) ? `[${char}${accentVariants(char)}]` : escapeRegex(char))).join(""))
    .join("\\s+")
}

function accentVariants(char: string): string {
  const table: Record<string, string> = { a: "áàâãä", e: "éèêë", i: "íìîï", o: "óòôõö", u: "úùûü", c: "ç", n: "ñ", A: "ÁÀÂÃÄ", E: "ÉÈÊË", I: "ÍÌÎÏ", O: "ÓÒÔÕÖ", U: "ÚÙÛÜ", C: "Ç", N: "Ñ" }
  const lower = table[char.toLowerCase()] ?? ""
  return `${lower}${lower.toUpperCase()}`
}

const boundary = (pattern: string) => `(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`

/** Variantes identificáveis de um nome: completo, primeiro+segundo, primeiro (se não for palavra comum). */
export function identifyingNameVariants(fullName: string): { strong: string[]; first: string | null; commonWordFirst: boolean } {
  const tokens = fullName.trim().split(/\s+/).filter((token) => token.length > 0)
  const strong = new Set<string>()
  if (tokens.length > 1) strong.add(tokens.join(" "))
  const meaningful = tokens.filter((token) => !PARTICLES.has(foldAccents(token).toLowerCase()))
  if (meaningful.length > 2) strong.add(meaningful.slice(0, 2).join(" "))
  if (meaningful.length > 1) strong.add(`${meaningful[0]} ${meaningful[meaningful.length - 1]}`)
  const first = meaningful[0] ?? null
  const commonWordFirst = first !== null && COMMON_WORD_FIRST_NAMES.has(foldAccents(first).toLowerCase())
  return { strong: [...strong].filter((variant) => variant !== first), first, commonWordFirst }
}

const INTRODUCTION_TEMPLATES = ["meu nome é", "me chamo", "aqui é", "aqui quem fala é", "quem fala é", "sou a", "sou o", "com a", "com o", "pela", "pelo", "obrigad[oa],?", "obrigad[oa] pela atenção,?", "tchau,?", "valeu,?"]

/** Apresentação/vocativo: "<nome> falando", "meu nome é <nome>", "obrigado, <nome>", "com a <nome>". */
function introductionPatterns(first: string): RegExp[] {
  const name = namePattern(first)
  return [
    new RegExp(boundary(`${name}\\s+falando`), "giu"),
    // Artigo opcional entre o template e o nome ("aqui é a Rosa", "sou o Bento").
    ...INTRODUCTION_TEMPLATES.map((template) => new RegExp(`(${template}\\s+(?:[ao]\\s+)?)${boundary(name)}`, "giu")),
  ]
}

const PII_PATTERNS: { kind: RedactionKind; pattern: RegExp; replacement: string }[] = [
  { kind: "EMAIL", pattern: /[\w.+-]+@[\w-]+(\.[\w-]+)+/giu, replacement: PII_PLACEHOLDERS.EMAIL },
  { kind: "CPF", pattern: /(?<!\d)\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?!\d)/gu, replacement: PII_PLACEHOLDERS.CPF },
  // Protocolo do lote de diagnóstico (DEMO-AAAAMM-X999), protocolo gerado pela massa (AAAAMM + 6 dígitos) e "protocolo <número>".
  { kind: "PROTOCOL", pattern: /(?<![\p{L}\p{N}-])DEMO-\d{6}-[A-Z]\d{3}(?![\p{L}\p{N}])/gu, replacement: PII_PLACEHOLDERS.PROTOCOL },
  { kind: "PROTOCOL", pattern: /(?<!\d)20\d{2}(0[1-9]|1[0-2])\d{6}(?!\d)/gu, replacement: PII_PLACEHOLDERS.PROTOCOL },
  { kind: "PROTOCOL", pattern: /(protocolo\s+(?:n[º°.]?\s*)?)\d{6,}/giu, replacement: `$1${PII_PLACEHOLDERS.PROTOCOL}` },
  // V1.4.9e: protocolo com conector EXPLÍCITO antes do número — "protocolo: N", "protocolo é N", "protocolo, por favor: N",
  // "protocolo deste atendimento: N". Só o número sai; número solto (sem a palavra protocolo + conector) NÃO é protocolo.
  { kind: "PROTOCOL", pattern: /(protocolo(?:\s+(?:deste|desse|do|da)\s+(?:atendimento|chamado|contato))?(?:,\s*por\s+favor)?(?:\s*:\s*|\s+é\s+))\d{6,}/giu, replacement: `$1${PII_PLACEHOLDERS.PROTOCOL}` },
  // Telefone BR: (99) 99999-9999, 99 9999-9999, 99999-9999.
  { kind: "PHONE", pattern: /(?<!\d)(?:\(?\d{2}\)?\s?)?9?\d{4}[-\s]\d{4}(?!\d)/gu, replacement: PII_PLACEHOLDERS.PHONE },
]

/**
 * Redaction de PII EVIDENTE (e-mail, CPF, protocolo, telefone) por padrão determinístico — a MESMA lista usada pela projeção
 * de pares, exposta para outras superfícies (ex.: evidência exibível do InteractionFeedback). Só substitui o fragmento
 * sensível pelo marcador estável; o resto do texto fica intacto.
 */
export function redactEvidentPii(text: string): { text: string; redactions: PrivacyRedaction[] } {
  const redactions: PrivacyRedaction[] = []
  let result = text
  for (const rule of PII_PATTERNS) {
    let count = 0
    result = result.replace(rule.pattern, (...args) => {
      count += 1
      return rule.replacement.includes("$1") ? rule.replacement.replace("$1", typeof args[1] === "string" ? args[1] : "") : rule.replacement
    })
    if (count === 0) continue
    const replacement = rule.replacement.replace("$1", "")
    const current = redactions.find((item) => item.kind === rule.kind && item.replacement === replacement)
    if (current) current.count += count
    else redactions.push({ kind: rule.kind, replacement, count })
  }
  return { text: result, redactions }
}

/** Dígito escondido pela máscara que preserva o formato. */
export const MASKED_DIGIT = "•"
const hideDigits = (text: string) => text.replace(/\d/g, MASKED_DIGIT)
// CPF só com a pontuação de CPF; 11 dígitos sem pontuação caem na regra geral de número longo (pode ser conta).
const FORMATTED_CPF = /(?<!\d)(?:\d{3}\.\d{3}\.\d{3}|\d{9})-\d{2}(?!\d)/gu
// Telefone BR com DDD opcional ("(11) 98765-4321", "11-98765-4321", "3456-7890"): DDD e o 1º dígito do número ficam.
const PHONE_PRESERVING = /(?<!\d)(\(?\d{2}\)?[\s-]?)?(\d)(\d{3,4})([-\s])(\d{4})(?!\d)/gu
// Número longo (conta, LP, código): 6+ dígitos, com separador simples entre eles; valor em dinheiro fica de fora.
const LONG_NUMBER = /(?<![\d•]|R\$\s?)\d(?:[.\-\s]?\d){5,}(?![\d•]|,\d)/gu
const KEPT_LEADING_DIGITS = 3

/**
 * Máscara que PRESERVA O FORMATO (`SUBJECT_PII_MASK_V2`, transcrição que vai para a IA e o que o colaborador vê dela): e-mail, CPF
 * pontuado e protocolo viram marcadores; telefone mantém o DDD e o 1º dígito ("11-9••••-••••"); qualquer outro número longo mantém
 * os 3 primeiros dígitos e a quantidade ("123•••••••"). Assim a análise ainda lê o formato que os indícios cadastrados descrevem
 * (começo da conta, quantidade de dígitos, fixo × móvel) e ninguém recupera o número. Genérico: nenhum prefixo ou produto aqui.
 * Idempotente — o texto mascarado não volta a casar com nenhuma regra.
 */
export function maskPreservingFormat(text: string): string {
  let result = text
  for (const rule of PII_PATTERNS) if (rule.kind === "EMAIL" || rule.kind === "PROTOCOL") result = result.replace(rule.pattern, (...args) => (rule.replacement.includes("$1") ? rule.replacement.replace("$1", typeof args[1] === "string" ? args[1] : "") : rule.replacement))
  result = result.replace(FORMATTED_CPF, PII_PLACEHOLDERS.CPF)
  result = result.replace(PHONE_PRESERVING, (_match, ddd: string | undefined, first: string, rest: string, separator: string, last: string) => `${ddd ?? ""}${first}${hideDigits(rest)}${separator}${hideDigits(last)}`)
  result = result.replace(LONG_NUMBER, (run) => {
    let kept = 0
    return run.replace(/\d/g, (digit) => (kept++ < KEPT_LEADING_DIGITS ? digit : MASKED_DIGIT))
  })
  return result
}

export function sourceHashOf(transcript: string): string {
  return createHash("sha256").update(transcript, "utf8").digest("hex")
}

export function projectPeerTranscript(input: PeerPrivacyProjectionInput): PeerTranscriptPrivacyProjection {
  const counts = new Map<string, PrivacyRedaction>()
  const bump = (kind: RedactionKind, replacement: string, count: number) => {
    if (count === 0) return
    const key = `${kind}:${replacement}`
    const current = counts.get(key)
    if (current) current.count += count
    else counts.set(key, { kind, replacement, count })
  }
  const apply = (text: string, pattern: RegExp, replacement: string, kind: RedactionKind): string => {
    let count = 0
    const result = text.replace(pattern, (...args) => {
      count += 1
      // Templates com grupo de captura ($1) preservam o prefixo ("meu nome é ", "Obrigado, ").
      return replacement.includes("$1") ? replacement.replace("$1", typeof args[1] === "string" ? args[1] : "") : replacement
    })
    bump(kind, replacement.replace("$1", ""), count)
    return result
  }

  let projected = input.transcript
  const forbidden = new Set<string>()
  const targetFold = input.target ? foldAccents(input.target.fullName).toLowerCase() : null
  // O ALVO nunca é redigido: o nome completo dele é protegido antes de qualquer substituição (par homônimo pelo
  // primeiro nome — "Mariana Costa" × alvo "Mariana Alves" — sai sem levar o alvo junto) e restaurado no fim.
  const TARGET_GUARD = "\u0000ALVO\u0000"
  if (input.target) projected = projected.replace(new RegExp(boundary(namePattern(input.target.fullName)), "giu"), TARGET_GUARD)

  // 1) O PAR: nome completo e variantes fortes sempre; primeiro nome inteiro (palavra) salvo palavra comum.
  const peer = identifyingNameVariants(input.peer.fullName)
  for (const variant of peer.strong) {
    projected = apply(projected, new RegExp(boundary(namePattern(variant)), "giu"), OPERATOR_PLACEHOLDER, "PEER_NAME")
    forbidden.add(variant)
  }
  if (peer.first) {
    forbidden.add(peer.first)
    if (peer.commonWordFirst) for (const pattern of introductionPatterns(peer.first)) projected = apply(projected, pattern, pattern.source.startsWith("(") ? `$1${OPERATOR_PLACEHOLDER}` : `${OPERATOR_PLACEHOLDER} falando`, "PEER_NAME")
    else projected = apply(projected, new RegExp(boundary(namePattern(peer.first)), "giu"), OPERATOR_PLACEHOLDER, "PEER_NAME")
  }

  // 2) OUTROS operadores conhecidos (transferência, menção): nome completo sempre; primeiro nome só em apresentação/vocativo.
  for (const other of input.knownOperators ?? []) {
    if (other.personId === input.peer.personId) continue
    if (targetFold !== null && foldAccents(other.fullName).toLowerCase() === targetFold) continue
    const variants = identifyingNameVariants(other.fullName)
    for (const variant of variants.strong) projected = apply(projected, new RegExp(boundary(namePattern(variant)), "giu"), OPERATOR_PLACEHOLDER, "OPERATOR_NAME")
    if (variants.first && !(targetFold !== null && identifyingNameVariants(input.target!.fullName).first?.toLowerCase() === variants.first.toLowerCase())) {
      for (const pattern of introductionPatterns(variants.first)) projected = apply(projected, pattern, pattern.source.startsWith("(") ? `$1${OPERATOR_PLACEHOLDER}` : `${OPERATOR_PLACEHOLDER} falando`, "OPERATOR_NAME")
    }
  }

  // 3) PII evidente por padrão determinístico.
  if (input.redactPii !== false) {
    const pii = redactEvidentPii(projected)
    projected = pii.text
    for (const item of pii.redactions) bump(item.kind, item.replacement, item.count)
  }

  if (input.target) projected = projected.split(TARGET_GUARD).join(input.target.fullName)

  return {
    version: PEER_PRIVACY_PROJECTION_VERSION,
    sourceInteractionId: input.sourceInteractionId,
    sourceHash: sourceHashOf(input.transcript),
    projected,
    redactions: [...counts.values()],
    forbiddenTerms: [...forbidden],
  }
}

/** A citação reintroduz alguma forma proibida da identidade do par? (mesma regra da verificação de projeção — V1.3.3 reutiliza por turno.) */
export function quoteReidentifies(forbiddenTerms: readonly string[], quote: string): boolean {
  return forbiddenTerms.some((term) => new RegExp(boundary(namePattern(term)), "iu").test(quote))
}

function normalizeQuote(text: string): string {
  return foldAccents(text).replace(/[“”‘’"']/g, "'").replace(/\s+/g, " ").trim().toLowerCase()
}

/**
 * Verificação de citação PRIVACY-SAFE: o trecho precisa existir literalmente na PROJEÇÃO (o que o modelo
 * recebeu) e não pode reintroduzir nenhuma forma proibida da identidade do par. A projeção continua
 * rastreável ao original pelo `sourceHash` — nunca se compara a citação sanitizada com o bruto.
 */
export function verifyProjectedQuote(projection: PeerTranscriptPrivacyProjection, quote: string): { ok: boolean; reason: "LITERAL" | "NOT_IN_PROJECTION" | "REIDENTIFICATION" } {
  const normalizedQuote = normalizeQuote(quote)
  if (quoteReidentifies(projection.forbiddenTerms, quote)) return { ok: false, reason: "REIDENTIFICATION" }
  if (!normalizeQuote(projection.projected).includes(normalizedQuote)) return { ok: false, reason: "NOT_IN_PROJECTION" }
  return { ok: true, reason: "LITERAL" }
}
