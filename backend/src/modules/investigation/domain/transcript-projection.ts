/**
 * TRANSCRIPT PROJECTION (V1.3.3 — Evidence Projection & Literal Integrity).
 *
 * A transcrição bruta vira, de forma DETERMINÍSTICA, uma lista de TURNOS (uma fala por linha, com
 * handle execution-scoped T1..Tn, falante e texto); o modelo recebe "[T1] CLIENTE: …" sem timestamp
 * e cita por UNIDADE LITERAL REAL (interação + turno + falante + trecho). A verificação continua
 * literal e determinística — nunca fuzzy, nunca paráfrase, nunca LLM juiz —, mas passa a operar por
 * turno: um achado que depende de duas falas cita DOIS trechos, cada um validado sozinho (a
 * concatenação de duas falas nunca existiu como string na fonte e continua NÃO literal).
 *
 * Causa exata do BUG_V2_1 (BENCHMARK_BLIND_V2): a fonte tem "[mm:ss–mm:ss] PAPEL:" por linha; o modelo
 * citava "CLIENTE: … OPERADOR: …" e o `includes` sobre a transcrição inteira falhava por causa do
 * timestamp entre as falas — 23/221 trechos descartados, 5 achados corretos apagados antes do ledger.
 *
 * AUDIT ≠ MODEL: o turno guarda timestamp e índice da linha (só auditoria); o modelo nunca vê UUID.
 * Pares: a projeção de privacidade (peer-privacy-projection.ts) roda ANTES desta — o texto de cada
 * turno já é o redigido, e a citação é verificada contra ele + termos proibidos (reidentificação).
 */
import { createHash } from "node:crypto"
import { quoteReidentifies } from "./peer-privacy-projection.js"

export const TRANSCRIPT_PROJECTION_VERSION = "TRANSCRIPT_TURNS_V1"

export type TranscriptTurn = {
  /** Handle execution-scoped dentro da interação (T1..Tn) — o que o modelo cita. */
  handle: string
  /** Falante normalizado (OPERADOR, CLIENTE, EVENTO, SUPORTE…) ou null quando a linha não tem rótulo. */
  speaker: string | null
  /** Texto da fala, sem timestamp e sem rótulo — o que é validado literalmente. */
  text: string
  /** Só auditoria: timestamp original (quando existe) e índice da linha na fonte. Nunca vai ao modelo. */
  audit: { timestamp: string | null; lineIndex: number }
}

export type TranscriptProjection = {
  version: typeof TRANSCRIPT_PROJECTION_VERSION
  turns: TranscriptTurn[]
  /** SHA-256 do texto de origem projetado (bruto para o alvo; redigido para pares). */
  sourceHash: string
  /** Turnos que ficaram fora do Model Context por limite de tamanho (o modelo não os viu; citação deles não é literal). */
  truncatedTurns: number
  totalTurns: number
}

/** "[00:12–00:20] " ou "[00:12-00:20] " no início da linha. */
const TIMESTAMP_PREFIX = /^\[(\d{1,2}:\d{2}(?:[–-]\d{1,2}:\d{2})?)\]\s*/
/**
 * Rótulos de falante RECONHECIDOS (o corpus usa Operador/Cliente/Evento/Suporte; os demais são plausíveis em
 * outras fontes). Lista fechada de propósito: um padrão genérico "Palavra:" viraria falante em "Protocolo: 123",
 * "Confirmando: …", "CPF: …". Vale no início da linha e INLINE (118 transcrições da massa são uma linha só:
 * "Operador: … Cliente: … Operador: …" — cada rótulo abre um turno).
 */
const SPEAKER_LABELS = ["OPERADOR", "CLIENTE", "EVENTO", "SUPORTE", "ATENDENTE", "SISTEMA", "SUPERVISOR", "URA", "AGENTE"] as const
const SPEAKER_PREFIX = new RegExp(`^(${SPEAKER_LABELS.join("|")}):\\s*`, "i")
const INLINE_SPEAKER = new RegExp(`(?:^|(?<=\\s))(${SPEAKER_LABELS.join("|")}):\\s`, "gi")

function normalizeSpeaker(label: string): string {
  return label.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase()
}

/** Quebra uma linha física nos rótulos inline: "Operador: a Cliente: b" → ["Operador: a", "Cliente: b"]. Sem rótulo inline → a própria linha. */
function splitInlineSpeakers(line: string): string[] {
  const starts: number[] = []
  INLINE_SPEAKER.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = INLINE_SPEAKER.exec(line)) !== null) starts.push(match.index)
  if (starts.length === 0 || (starts.length === 1 && starts[0] === 0)) return [line]
  const segments: string[] = []
  if (starts[0]! > 0) segments.push(line.slice(0, starts[0]).trim())
  for (let i = 0; i < starts.length; i += 1) segments.push(line.slice(starts[i], starts[i + 1] ?? line.length).trim())
  return segments.filter((segment) => segment.length > 0)
}

/** Quebra a transcrição em turnos (uma linha = um turno; linhas vazias ignoradas). Determinística. */
export function projectTranscript(content: string, options: { maxChars?: number } = {}): TranscriptProjection {
  const lines = content.split(/\r?\n/)
  const turns: TranscriptTurn[] = []
  let rendered = 0
  let truncated = 0
  let total = 0
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index]!.trim()
    if (raw.length === 0) continue
    let line = raw
    let timestamp: string | null = null
    const ts = TIMESTAMP_PREFIX.exec(line)
    if (ts) {
      timestamp = ts[1]!
      line = line.slice(ts[0].length)
    }
    for (const segment of splitInlineSpeakers(line)) {
      total += 1
      let rest = segment
      let speaker: string | null = null
      const sp = SPEAKER_PREFIX.exec(rest)
      if (sp) {
        speaker = normalizeSpeaker(sp[1]!)
        rest = rest.slice(sp[0].length)
      }
      const text = rest.trim()
      if (text.length === 0) continue
      const handle = `T${turns.length + 1}`
      const renderedLength = renderTurn({ handle, speaker, text }).length + 1
      if (options.maxChars !== undefined && rendered + renderedLength > options.maxChars && turns.length > 0) {
        truncated += 1
        continue
      }
      rendered += renderedLength
      turns.push({ handle, speaker, text, audit: { timestamp, lineIndex: index } })
    }
  }
  return { version: TRANSCRIPT_PROJECTION_VERSION, turns, sourceHash: createHash("sha256").update(content, "utf8").digest("hex"), truncatedTurns: truncated, totalTurns: total }
}

function renderTurn(turn: { handle: string; speaker: string | null; text: string }): string {
  return `[${turn.handle}] ${turn.speaker ? `${turn.speaker}: ` : ""}${turn.text}`
}

/** Texto MODEL-FACING: "[T1] OPERADOR: …" por linha — sem timestamp, sem UUID. */
export function renderTranscriptForModel(projection: TranscriptProjection): string {
  const body = projection.turns.map(renderTurn).join("\n")
  return projection.truncatedTurns > 0 ? `${body}\n[… ${projection.truncatedTurns} turno(s) omitido(s) por limite de tamanho]` : body
}

/**
 * Uma UNIDADE de evidência como o modelo a cita: interação + (turno) + (falante) + trecho.
 * V1.3.4.2 (§22): `interactionRef` é o HANDLE (I3 é sempre I3); `interactionOrdinal` é a POSIÇÃO DE APRESENTAÇÃO
 * ("Interação #3") — identidades diferentes, traduzidas só quando o modelo é explícito.
 */
export type EvidenceUnit = { interactionRef: string; interactionOrdinal?: number | undefined; turnRef?: string | null | undefined; speaker?: string | null | undefined; quote: string }
export type EvidenceRequirement = "ANY" | "ALL"
export type EvidenceRejectionReason = "NOT_LITERAL" | "WRONG_TURN" | "WRONG_SPEAKER" | "WRONG_INTERACTION" | "REIDENTIFICATION" | "MISSING_REQUIRED_EVIDENCE"

/**
 * `resolvedBy` (TURNO): TURN_REF = o turno citado contém o trecho; QUOTE_SEARCH = sem turnRef, ou turnRef errado/inexistente e o
 * trecho é literal em outro turno (locator errado, evidência real — contado em `turnRefMismatchResolved`).
 * `referenceResolution` (INTERAÇÃO, V1.3.4.2 §28): HANDLE = citada pelo ref (I-n/P-n); PRESENTATION_ORDINAL = citada só pela
 * posição de apresentação e traduzida pelo resolver determinístico. Nunca existe QUOTE_SEARCH de interação (§27).
 */
export type ReferenceResolution = "HANDLE" | "PRESENTATION_ORDINAL"
export type VerifiedEvidence = { interactionRef: string; interactionId: string; turnRef: string; speaker: string | null; quote: string; resolvedBy: "TURN_REF" | "QUOTE_SEARCH"; turnRefMismatch: boolean; referenceResolution: ReferenceResolution }
export type EvidenceVerdict = { ok: true; evidence: VerifiedEvidence } | { ok: false; reason: EvidenceRejectionReason; /** V1.3.4.2: a unidade citou ordinal e ele não resolveu (fora da apresentação / ambíguo). */ ordinalRejected?: boolean }

/**
 * ORDINAL RESOLVER (V1.3.4.2 §24–§27): traduz uma referência EXPLICITAMENTE ordinal ("Interação #3", `interactionOrdinal: 3`)
 * para o handle apresentado naquela posição — a ordem de apresentação é a ordem de inserção do mapa model-facing. Só resolve
 * quando o ordinal existe e aponta para UMA interação; nunca reinterpreta "I3" como ordinal 3; nunca procura o trecho em
 * outras interações para "corrigir" o ref.
 */
export function resolvePresentationOrdinal(ordinal: number, interactions: ReadonlyMap<string, ProjectedInteraction>): ProjectedInteraction | null {
  if (!Number.isInteger(ordinal) || ordinal < 1) return null
  const presented = [...interactions.values()]
  return presented[ordinal - 1] ?? null
}

/** Mesma normalização literal usada até a V1.3.2 (aspas curvas → ', espaços colapsados, minúsculas). Nada de fuzzy. */
export function normalizeLiteral(text: string): string {
  return text.replace(/[“”‘’"']/g, "'").replace(/\s+/g, " ").trim().toLowerCase()
}

export type ProjectedInteraction = { interactionRef: string; interactionId: string; projection: TranscriptProjection; forbiddenTerms?: readonly string[] | undefined }

/**
 * Verifica UMA unidade contra a projeção model-facing da interação citada.
 * Ordem: interação → reidentificação (pares) → literal em UM turno → falante.
 * O turnRef é um LOCALIZADOR: se o turno citado contém o trecho, resolve por ele; se não (turnRef errado ou
 * inexistente) mas o trecho é literal em outro turno da mesma interação, resolve por busca e marca o
 * mismatch (telemetria) — a evidência é real, o número estava errado. Rejeita só quando o trecho não é
 * literal em turno nenhum (NOT_LITERAL; WRONG_TURN quando também citou um turno que não existe).
 */
export function verifyEvidenceUnit(unit: EvidenceUnit, interactions: ReadonlyMap<string, ProjectedInteraction>): EvidenceVerdict {
  // IDENTIDADE (V1.3.4.2 §25/§26): handle citado é SEMPRE o handle (I3 = I3, mesmo com ordinal junto); sem handle, o ordinal
  // explícito é traduzido pela apresentação; fora da apresentação = WRONG_INTERACTION (contado como ordinal rejeitado).
  const ref = unit.interactionRef.trim().toUpperCase()
  let referenceResolution: ReferenceResolution = "HANDLE"
  let interaction = ref.length > 0 ? interactions.get(ref) : undefined
  if (!interaction && ref.length === 0 && unit.interactionOrdinal !== undefined) {
    const byOrdinal = resolvePresentationOrdinal(unit.interactionOrdinal, interactions)
    if (!byOrdinal) return { ok: false, reason: "WRONG_INTERACTION", ordinalRejected: true }
    interaction = byOrdinal
    referenceResolution = "PRESENTATION_ORDINAL"
  }
  if (!interaction) return { ok: false, reason: "WRONG_INTERACTION" }
  if (interaction.forbiddenTerms && interaction.forbiddenTerms.length > 0 && quoteReidentifies(interaction.forbiddenTerms, unit.quote)) return { ok: false, reason: "REIDENTIFICATION" }
  const quote = normalizeLiteral(unit.quote)
  if (quote.length === 0) return { ok: false, reason: "NOT_LITERAL" }
  // Literal = substring da LINHA que o modelo viu ("[T3] CLIENTE: texto"): aceita o texto puro ou com o rótulo do
  // falante na frente (o modelo copia "CLIENTE: …" com frequência); nunca atravessa a quebra de turno.
  // Timestamp na frente da citação só vale se for o timestamp de AUDITORIA daquele turno (fonte literal), nunca outro.
  const turnsWithQuote = interaction.projection.turns.filter((turn) => normalizeLiteral(renderTurn(turn)).includes(quote) || (turn.audit.timestamp !== null && normalizeLiteral(`[${turn.audit.timestamp}] ${renderTurn(turn).replace(/^\[T\d+\] /, "")}`).includes(quote)))
  const turnRef = unit.turnRef?.trim().toUpperCase() || null
  const named = turnRef ? interaction.projection.turns.find((item) => item.handle === turnRef) : undefined
  if (turnsWithQuote.length === 0) {
    // Literal em OUTRA interação analisada = atribuição errada (rejeitada, mas nomeada como tal).
    for (const other of interactions.values()) if (other !== interaction && other.projection.turns.some((turn) => normalizeLiteral(renderTurn(turn)).includes(quote))) return { ok: false, reason: "WRONG_INTERACTION" }
    return { ok: false, reason: turnRef && !named ? "WRONG_TURN" : "NOT_LITERAL" }
  }
  const claimedSpeaker = unit.speaker ? normalizeSpeaker(unit.speaker) : null
  let turn: TranscriptTurn
  let resolvedBy: VerifiedEvidence["resolvedBy"]
  if (named && turnsWithQuote.includes(named)) {
    turn = named
    resolvedBy = "TURN_REF"
  } else {
    turn = (claimedSpeaker ? turnsWithQuote.find((item) => item.speaker === claimedSpeaker) : undefined) ?? turnsWithQuote[0]!
    resolvedBy = "QUOTE_SEARCH"
  }
  if (claimedSpeaker && turn.speaker && claimedSpeaker !== turn.speaker) return { ok: false, reason: "WRONG_SPEAKER" }
  return { ok: true, evidence: { interactionRef: interaction.interactionRef, interactionId: interaction.interactionId, turnRef: turn.handle, speaker: turn.speaker, quote: unit.quote.trim(), resolvedBy, turnRefMismatch: turnRef !== null && resolvedBy === "QUOTE_SEARCH", referenceResolution } }
}

export type FindingVerification = {
  survives: boolean
  requirement: EvidenceRequirement
  verified: VerifiedEvidence[]
  rejected: { unit: EvidenceUnit; reason: EvidenceRejectionReason; ordinalRejected?: boolean }[]
  /** Motivo do descarte do ACHADO (não das unidades) quando não sobrevive. */
  findingRejection: "MISSING_REQUIRED_EVIDENCE" | null
}

/** Sobrevivência: ANY = ≥1 unidade válida; ALL = todas válidas. Zero válidas nunca sobrevive. */
export function verifyFinding(units: EvidenceUnit[], requirement: EvidenceRequirement, interactions: ReadonlyMap<string, ProjectedInteraction>): FindingVerification {
  const verified: VerifiedEvidence[] = []
  const rejected: FindingVerification["rejected"] = []
  for (const unit of units) {
    const verdict = verifyEvidenceUnit(unit, interactions)
    if (verdict.ok) verified.push(verdict.evidence)
    else rejected.push({ unit, reason: verdict.reason, ...(verdict.ordinalRejected ? { ordinalRejected: true } : {}) })
  }
  const survives = verified.length > 0 && (requirement === "ANY" || rejected.length === 0)
  return { survives, requirement, verified: survives ? verified : [], rejected, findingRejection: survives ? null : "MISSING_REQUIRED_EVIDENCE" }
}

/** Telemetria por chamada de análise (V1.3.3 — §24): contagens, nunca texto. */
export type EvidenceVerificationTelemetry = {
  candidateExcerptCount: number
  verifiedExcerptCount: number
  rejectedExcerptCount: number
  findingsBeforeVerification: number
  findingsAfterVerification: number
  rejectionReasons: Record<EvidenceRejectionReason, number>
  /** Unidades válidas cujo turnRef citado estava errado/inexistente (resolvidas pelo trecho literal em outro turno). */
  turnRefMismatchResolved: number
  /** V1.3.4.2 (§28): unidades válidas citadas SÓ por ordinal de apresentação e traduzidas para o handle real. */
  ordinalResolvedCount: number
  /** V1.3.4.2 (§28): unidades citadas por ordinal que não resolveu (posição inexistente) — rejeitadas como WRONG_INTERACTION. */
  ordinalResolutionRejectedCount: number
}

export function emptyVerificationTelemetry(): EvidenceVerificationTelemetry {
  return { candidateExcerptCount: 0, verifiedExcerptCount: 0, rejectedExcerptCount: 0, findingsBeforeVerification: 0, findingsAfterVerification: 0, rejectionReasons: { NOT_LITERAL: 0, WRONG_TURN: 0, WRONG_SPEAKER: 0, WRONG_INTERACTION: 0, REIDENTIFICATION: 0, MISSING_REQUIRED_EVIDENCE: 0 }, turnRefMismatchResolved: 0, ordinalResolvedCount: 0, ordinalResolutionRejectedCount: 0 }
}

/** Soma a verificação de um achado à telemetria (unidades válidas de achado que NÃO sobreviveu contam como rejeitadas por MISSING_REQUIRED_EVIDENCE). */
export function accumulateVerification(telemetry: EvidenceVerificationTelemetry, verification: FindingVerification, candidateUnits: number): void {
  telemetry.candidateExcerptCount += candidateUnits
  telemetry.findingsBeforeVerification += 1
  for (const item of verification.rejected) telemetry.rejectionReasons[item.reason] += 1
  telemetry.rejectedExcerptCount += verification.rejected.length
  telemetry.turnRefMismatchResolved += verification.verified.filter((item) => item.turnRefMismatch).length
  telemetry.ordinalResolvedCount += verification.verified.filter((item) => item.referenceResolution === "PRESENTATION_ORDINAL").length
  telemetry.ordinalResolutionRejectedCount += verification.rejected.filter((item) => item.ordinalRejected).length
  if (verification.survives) {
    telemetry.findingsAfterVerification += 1
    telemetry.verifiedExcerptCount += verification.verified.length
  } else {
    const validButLost = candidateUnits - verification.rejected.length
    telemetry.rejectionReasons.MISSING_REQUIRED_EVIDENCE += validButLost
    telemetry.rejectedExcerptCount += validButLost
  }
}
