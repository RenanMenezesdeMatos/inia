/**
 * V1.4.8f — SIDECAR needKind (SIDECAR_NEED_KIND_V1). Anota uma CustomerNeed JÁ extraída e verificada com a INTENÇÃO do pedido:
 * ACTION | INFORMATION | MIXED | UNKNOWN. Feasibility: G-NK1 (holdout-v2/dev-regression-v148e-gnk1, GO em 784fe37) — o prompt,
 * o formato de entrada e a validação são os MESMOS do gate, byte a byte (teste de fixture).
 *
 * Contrato:
 *  - entrada mínima por necessidade: interactionRef, needRef, evidência literal VERIFICADA (turno, falante, trecho) e os turnos
 *    ±1 da projeção. Nunca summary, status ou transcrição inteira;
 *  - saída: needKind + basisTurns + provenance (source, model, requestSha256, status);
 *  - ANOTAÇÃO: nunca cria CustomerNeed, nunca altera summary/status/evidência; roda DEPOIS da Fase A (que fica intocada);
 *  - FAIL-CLOSED: erro do provider, JSON malformado, ref inválido, item ausente, enum inválido ou basisTurns inválidos ⇒ UNKNOWN.
 *    Nenhum caminho de erro produz INFORMATION;
 *  - needKind só fornece INTENÇÃO a consumidores; sozinho não cria finding, pattern nem claim (nenhum consumidor do runtime o lê).
 */
import type { InteractionSemanticFrame } from "./interaction-semantic-frame.js"
import type { ProjectedInteraction } from "./transcript-projection.js"

export const NEED_KIND_SIDECAR_VERSION = "SIDECAR_NEED_KIND_V1"
export const NEED_KINDS = ["ACTION", "INFORMATION", "MIXED", "UNKNOWN"] as const
export type NeedKind = (typeof NEED_KINDS)[number]
export type NeedKindFallbackReason = "PROVIDER_ERROR" | "MALFORMED" | "MISSING" | "INVALID_ENUM" | "INVALID_BASIS"

/** Anotação sobre a necessidade existente. status FALLBACK ⇒ needKind é sempre UNKNOWN. */
export type NeedKindAnnotation = {
  needKind: NeedKind
  basisTurns: string[]
  status: "VALID" | "FALLBACK"
  fallbackReason: NeedKindFallbackReason | null
  source: typeof NEED_KIND_SIDECAR_VERSION
  model: string | null
  requestSha256: string
}

export type NeedKindContextTurn = { turnRef: string; speaker: string | null; text: string }
export type NeedKindItem = { interactionRef: string; needRef: string; evidence: { turnRef: string; speaker: string | null; quote: string }[]; previousTurn: NeedKindContextTurn | null; nextTurn: NeedKindContextTurn | null; presentedTurns: string[] }

const turnNumber = (handle: string) => Number(handle.replace(/^T/i, ""))
const upper = (value: unknown) => (typeof value === "string" ? value.trim().toUpperCase() : "")

/** Um item por CustomerNeed verificada (evidência + ±1 turno da projeção). A ordem é a dos frames e das necessidades. */
export function buildNeedKindItems(frames: readonly InteractionSemanticFrame[], projected: ReadonlyMap<string, ProjectedInteraction>): NeedKindItem[] {
  return frames.flatMap((frame) => {
    const turns = projected.get(frame.interactionRef)?.projection.turns ?? []
    const turnAt = (number: number): NeedKindContextTurn | null => { const turn = turns.find((item) => turnNumber(item.handle) === number); return turn ? { turnRef: turn.handle, speaker: turn.speaker, text: turn.text } : null }
    return frame.customerNeeds.filter((need) => need.evidence.length > 0).map((need) => {
      const numbers = need.evidence.map((unit) => turnNumber(unit.turnRef)).filter((value) => Number.isFinite(value))
      const previousTurn = turnAt(Math.min(...numbers) - 1)
      const nextTurn = turnAt(Math.max(...numbers) + 1)
      const evidence = need.evidence.map((unit) => ({ turnRef: unit.turnRef, speaker: unit.speaker, quote: unit.quote }))
      const presentedTurns = [...new Set([previousTurn?.turnRef, ...evidence.map((unit) => unit.turnRef), nextTurn?.turnRef].filter((turn): turn is string => Boolean(turn)))]
      return { interactionRef: frame.interactionRef, needRef: need.id, evidence, previousTurn, nextTurn, presentedTurns }
    })
  })
}

/** Prompt CONGELADO no G-NK1 (sha256 61c3289b78f9bf41…). Placeholders de exemplo nunca têm formato de handle real. */
export const NEED_KIND_SYSTEM_PROMPT = `Você classifica a INTENÇÃO de necessidades de clientes que já foram registradas em atendimentos. Para cada necessidade você recebe somente o trecho literal em que ela aparece e os dois turnos vizinhos da conversa (um antes, um depois).

Classifique needKind:
- ACTION: o cliente quer que algo seja feito, alterado ou executado pelo atendimento.
- INFORMATION: o cliente quer saber, entender ou receber uma explicação.
- MIXED: a mesma necessidade pede as duas coisas.
- UNKNOWN: os trechos mostrados não permitem decidir, inclusive quando o trecho da necessidade não é fala do cliente.

Regras: (1) use somente os trechos mostrados; não presuma fatos anteriores ou posteriores a eles; (2) a forma da frase não decide: uma pergunta pode pedir que algo seja feito, e uma afirmação pode pedir uma explicação; (3) basisTurns lista os turnos mostrados que sustentam a classificação, e só turnos que aparecem naquele item; (4) devolva exatamente uma classificação por necessidade listada, com o mesmo interactionRef e needRef, nunca outra; (5) na dúvida, UNKNOWN.

Responda SOMENTE com JSON válido:
{"needs":[{"interactionRef":"<INTERACTION_REF>","needRef":"<NEED_REF>","needKind":"ACTION|INFORMATION|MIXED|UNKNOWN","basisTurns":["<TURN_REF>"]}]}`

const lineOf = (turnRef: string, speaker: string | null, text: string) => `[${turnRef}] ${speaker ? `${speaker}: ` : ""}${text}`

/** Mesmo formato do G-NK1: cabeçalho por necessidade, anterior, trecho(s) da necessidade (com marcador de lacuna), posterior. */
export function renderNeedKindInput(items: readonly NeedKindItem[]): string {
  const blocks = items.map((item) => {
    const lines = [`=== ${item.interactionRef} · necessidade ${item.needRef} ===`, `anterior: ${item.previousTurn ? lineOf(item.previousTurn.turnRef, item.previousTurn.speaker, item.previousTurn.text) : "(início da conversa)"}`]
    item.evidence.forEach((unit, index) => {
      const gap = index > 0 ? turnNumber(unit.turnRef) - turnNumber(item.evidence[index - 1]!.turnRef) - 1 : 0
      if (gap > 0) lines.push(`(… ${gap} turno(s) não mostrado(s) …)`)
      lines.push(`necessidade: ${lineOf(unit.turnRef, unit.speaker, unit.quote)}`)
    })
    lines.push(`posterior: ${item.nextTurn ? lineOf(item.nextTurn.turnRef, item.nextTurn.speaker, item.nextTurn.text) : "(fim da conversa)"}`)
    return lines.join("\n")
  })
  return `Necessidades nesta análise: ${items.map((item) => `${item.interactionRef}/${item.needRef}`).join(", ")}\n\n${blocks.join("\n\n")}`
}

export type NeedKindItemResult = { interactionRef: string; needRef: string; needKind: NeedKind; basisTurns: string[]; status: "VALID" | "FALLBACK"; fallbackReason: NeedKindFallbackReason | null; declaredNeedKind: string | null }
export type NeedKindValidation = {
  parseStatus: "PARSED" | "MALFORMED_JSON" | "SCHEMA_INVALID" | "NO_TEXT" | "PROVIDER_ERROR"
  items: NeedKindItemResult[]
  inventedRefs: string[]
  duplicates: string[]
  missing: string[]
  invalidEnums: string[]
  invalidBasis: string[]
}

const stripFence = (raw: string) => raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim()
const fallbackAll = (items: readonly NeedKindItem[], parseStatus: NeedKindValidation["parseStatus"], reason: NeedKindFallbackReason): NeedKindValidation => ({ parseStatus, items: items.map((item) => ({ interactionRef: item.interactionRef, needRef: item.needRef, needKind: "UNKNOWN", basisTurns: [], status: "FALLBACK", fallbackReason: reason, declaredNeedKind: null })), inventedRefs: [], duplicates: [], missing: [], invalidEnums: [], invalidBasis: [] })

/** Erro do provider (exceção, timeout, resposta não-texto): TODOS os itens UNKNOWN. */
export const needKindProviderFailure = (items: readonly NeedKindItem[]): NeedKindValidation => fallbackAll(items, "PROVIDER_ERROR", "PROVIDER_ERROR")

/**
 * Validação determinística e fail-closed (sem parser leniente): ref fora do lote = descartado e contado; duplicado = vale o
 * primeiro; enum inválido, basisTurns vazio ou fora dos turnos apresentados daquele item, item ausente ⇒ UNKNOWN.
 */
export function validateNeedKindOutput(text: string | null, items: readonly NeedKindItem[]): NeedKindValidation {
  if (!text || !text.trim()) return fallbackAll(items, "NO_TEXT", "MALFORMED")
  let parsed: unknown
  try { parsed = JSON.parse(stripFence(text)) } catch { return fallbackAll(items, "MALFORMED_JSON", "MALFORMED") }
  const needs = (parsed as { needs?: unknown } | null)?.needs
  if (!Array.isArray(needs)) return fallbackAll(items, "SCHEMA_INVALID", "MALFORMED")
  const keyOf = (interactionRef: unknown, needRef: unknown) => `${upper(interactionRef)}/${upper(needRef)}`
  const byKey = new Map(items.map((item) => [keyOf(item.interactionRef, item.needRef), item]))
  const first = new Map<string, Record<string, unknown>>()
  const result: NeedKindValidation = { parseStatus: "PARSED", items: [], inventedRefs: [], duplicates: [], missing: [], invalidEnums: [], invalidBasis: [] }
  for (const entry of needs) {
    const record = (entry ?? {}) as Record<string, unknown>
    const key = keyOf(record.interactionRef, record.needRef)
    if (!byKey.has(key)) { result.inventedRefs.push(key); continue }
    if (first.has(key)) { result.duplicates.push(key); continue }
    first.set(key, record)
  }
  for (const [key, item] of byKey) {
    const base = { interactionRef: item.interactionRef, needRef: item.needRef }
    const record = first.get(key)
    if (!record) { result.missing.push(key); result.items.push({ ...base, needKind: "UNKNOWN", basisTurns: [], status: "FALLBACK", fallbackReason: "MISSING", declaredNeedKind: null }); continue }
    const declared = upper(record.needKind)
    const basis = Array.isArray(record.basisTurns) ? record.basisTurns.map(upper) : []
    if (!(NEED_KINDS as readonly string[]).includes(declared)) { result.invalidEnums.push(key); result.items.push({ ...base, needKind: "UNKNOWN", basisTurns: basis, status: "FALLBACK", fallbackReason: "INVALID_ENUM", declaredNeedKind: typeof record.needKind === "string" ? record.needKind : null }); continue }
    const presented = new Set(item.presentedTurns.map((turn) => turn.toUpperCase()))
    if (basis.length === 0 || basis.some((turn) => !presented.has(turn))) { result.invalidBasis.push(key); result.items.push({ ...base, needKind: "UNKNOWN", basisTurns: basis, status: "FALLBACK", fallbackReason: "INVALID_BASIS", declaredNeedKind: declared }); continue }
    result.items.push({ ...base, needKind: declared as NeedKind, basisTurns: basis, status: "VALID", fallbackReason: null, declaredNeedKind: declared })
  }
  return result
}

/** Aplica a anotação às necessidades EXISTENTES (só o campo `needKind`); necessidade sem item fica sem anotação. */
export function applyNeedKindAnnotations(frames: InteractionSemanticFrame[], validation: NeedKindValidation, provenance: { model: string | null; requestSha256: string }): number {
  let applied = 0
  for (const item of validation.items) {
    const need = frames.find((frame) => frame.interactionRef === item.interactionRef)?.customerNeeds.find((entry) => entry.id === item.needRef)
    if (!need) continue
    need.needKind = { needKind: item.status === "VALID" ? item.needKind : "UNKNOWN", basisTurns: item.basisTurns, status: item.status, fallbackReason: item.fallbackReason, source: NEED_KIND_SIDECAR_VERSION, model: provenance.model, requestSha256: provenance.requestSha256 }
    applied += 1
  }
  return applied
}

export type NeedKindTelemetry = { version: typeof NEED_KIND_SIDECAR_VERSION; status: "OK" | "FAILED"; parseStatus: NeedKindValidation["parseStatus"]; needs: number; byKind: Record<NeedKind, number>; valid: number; fallback: number; fallbackReasons: Partial<Record<NeedKindFallbackReason, number>>; inventedRefs: number; duplicates: number }
export function needKindTelemetryOf(validation: NeedKindValidation): NeedKindTelemetry {
  const byKind: Record<NeedKind, number> = { ACTION: 0, INFORMATION: 0, MIXED: 0, UNKNOWN: 0 }
  const fallbackReasons: Partial<Record<NeedKindFallbackReason, number>> = {}
  for (const item of validation.items) {
    byKind[item.status === "VALID" ? item.needKind : "UNKNOWN"] += 1
    if (item.fallbackReason) fallbackReasons[item.fallbackReason] = (fallbackReasons[item.fallbackReason] ?? 0) + 1
  }
  return { version: NEED_KIND_SIDECAR_VERSION, status: validation.parseStatus === "PARSED" ? "OK" : "FAILED", parseStatus: validation.parseStatus, needs: validation.items.length, byKind, valid: validation.items.filter((item) => item.status === "VALID").length, fallback: validation.items.filter((item) => item.status === "FALLBACK").length, fallbackReasons, inventedRefs: validation.inventedRefs.length, duplicates: validation.duplicates.length }
}
