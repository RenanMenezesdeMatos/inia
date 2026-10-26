import { renderAnswerMarkers, type PresentedEvidence } from "./clarification-contract.js"

/**
 * RESPOSTA DO ESCLARECIMENTO EM FLUXO. A redação chega como o JSON do contrato (`{"contract":…,"answer":"…","sources":[…],…}`) em
 * pedaços. Para a tela sai só o texto do campo `answer`, com os marcadores das seções já numerados como na validação final
 * (`renderAnswerMarkers`: [K3, K5] → [1][2]), e só enquanto a conferência incremental passa:
 *
 *  - um marcador ainda incompleto no fim ("[K1" ou "[K1, K") espera o próximo pedaço decidir;
 *  - um marcador que cita uma seção que não foi lida TRAVA o fluxo: nada mais sai (a validação final recusa a resposta e quem
 *    chamou retira o que apareceu);
 *  - espaço antes do primeiro caractere não sai (a validação final apara o texto).
 *
 * Nada aqui aprova a resposta: a validação final (`validateAnswerOutput`) continua decidindo, e o texto validado é conferido com o
 * que foi mostrado (`reconcileShownText`) — igual = só completa; diferente ou recusado = retira.
 */
export type AnswerStream = {
  push(raw: string): void
  /** O que já foi entregue à tela (sempre um prefixo do texto da resposta validada, se ela passar). */
  emitted(): string
  /** Um marcador citou seção não lida (ou o texto saiu do formato): o fluxo parou. */
  blocked(): boolean
}

/** Começo de um marcador de seção que ainda pode se completar: "[", "[K", "[K12", "[K1, K", "[K1;K2 "… (nunca com "]"). */
const MARKER_PREFIX = /^\[\s*(?:K(?:\d+(?:\s*[,;]\s*(?:K\d*)?)*\s*)?)?$/i

export function createAnswerStream(evidence: PresentedEvidence, out: (text: string) => void): AnswerStream {
  let raw = ""
  let shown = ""
  let stopped = false
  return {
    push(chunk) {
      if (stopped || !chunk) return
      raw += chunk
      const field = partialJsonStringField(raw, "answer")
      if (!field) return
      let safe = field.text
      if (!field.complete) {
        const open = safe.lastIndexOf("[")
        if (open !== -1 && MARKER_PREFIX.test(safe.slice(open))) safe = safe.slice(0, open)
      }
      const order: string[] = []
      let unknown = false
      const rendered = renderAnswerMarkers(safe, (ref) => {
        const normalized = ref.trim().toUpperCase()
        if (!evidence.has(normalized)) {
          unknown = true
          return null
        }
        if (!order.includes(normalized)) order.push(normalized)
        return order.indexOf(normalized) + 1
      }).trimStart()
      if (unknown || !rendered.startsWith(shown)) {
        stopped = true
        return
      }
      if (rendered.length > shown.length) {
        out(rendered.slice(shown.length))
        shown = rendered
      }
    },
    emitted: () => shown,
    blocked: () => stopped,
  }
}

type ScannedString = { content: string; complete: boolean; end: number }

/**
 * O valor (talvez ainda incompleto) de um campo de texto do OBJETO DE TOPO de um JSON que está chegando — null enquanto o campo
 * não começou (ou o começo não é um objeto). Tolera cerca de markdown antes do objeto; nunca devolve um escape pela metade.
 */
export function partialJsonStringField(raw: string, field: string): { text: string; complete: boolean } | null {
  let i = raw.indexOf("{")
  if (i === -1) return null
  i += 1
  for (;;) {
    i = skipSpace(raw, i)
    if (i >= raw.length || raw[i] !== '"') return null
    const key = scanString(raw, i)
    if (!key.complete) return null
    i = skipSpace(raw, key.end)
    if (raw[i] !== ":") return null
    i = skipSpace(raw, i + 1)
    if (i >= raw.length) return null
    if (decode(key.content) === field) {
      if (raw[i] !== '"') return null
      const value = scanString(raw, i)
      const text = decode(value.content)
      if (text === null) return null
      // Um par substituto pela metade (emoji partido entre pedaços) espera o resto.
      const last = text.charCodeAt(text.length - 1)
      return { text: !value.complete && last >= 0xd800 && last <= 0xdbff ? text.slice(0, -1) : text, complete: value.complete }
    }
    const next = skipValue(raw, i)
    if (next === null) return null
    i = skipSpace(raw, next)
    if (raw[i] !== ",") return null
    i += 1
  }
}

const skipSpace = (raw: string, from: number) => {
  let i = from
  while (i < raw.length && /\s/.test(raw[i]!)) i += 1
  return i
}

/** Texto JSON a partir das aspas em `start`: o conteúdo até o fechamento, ou até o último ponto seguro (sem escape partido). */
function scanString(raw: string, start: number): ScannedString {
  let i = start + 1
  while (i < raw.length) {
    const char = raw[i]
    if (char === "\\") {
      const size = raw[i + 1] === "u" ? 6 : 2
      if (i + size > raw.length) break
      i += size
      continue
    }
    if (char === '"') return { content: raw.slice(start + 1, i), complete: true, end: i + 1 }
    i += 1
  }
  return { content: raw.slice(start + 1, i), complete: false, end: i }
}

function decode(content: string): string | null {
  try {
    return JSON.parse(`"${content}"`) as string
  } catch {
    return null
  }
}

/** Fim de um valor JSON qualquer (texto, número, literal, objeto ou lista) — null se ainda não chegou inteiro. */
function skipValue(raw: string, start: number): number | null {
  if (raw[start] === '"') {
    const scanned = scanString(raw, start)
    return scanned.complete ? scanned.end : null
  }
  if (raw[start] === "{" || raw[start] === "[") {
    let depth = 0
    let i = start
    while (i < raw.length) {
      const char = raw[i]!
      if (char === '"') {
        const scanned = scanString(raw, i)
        if (!scanned.complete) return null
        i = scanned.end
        continue
      }
      if (char === "{" || char === "[") depth += 1
      else if (char === "}" || char === "]") {
        depth -= 1
        if (depth === 0) return i + 1
      }
      i += 1
    }
    return null
  }
  let i = start
  while (i < raw.length && !/[\s,}\]]/.test(raw[i]!)) i += 1
  return i < raw.length ? i : null
}
