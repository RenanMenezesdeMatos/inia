/**
 * FRAMING de blocos estruturados em respostas de texto (V1.3.2 — P0 do BENCHMARK_BLIND_V1).
 *
 * O modelo devolve texto livre + linhas-marcador com JSON ("EVIDENCE_JSON:", "SUPPORT_MATERIALS_JSON:",
 * "STRUCTURED_RESULT_JSON:", "INVESTIGATION_STATE_JSON:"). Cada marcador extrai SOMENTE o payload
 * que lhe pertence: o JSON é delimitado por um scanner balanceado (chaves/colchetes, ciente de
 * strings e escapes) — nunca por "primeiro { … último }", que engolia o marcador seguinte e
 * invalidava 17 de 31 envelopes no benchmark V1. O texto devolvido é o original SEM o bloco do
 * marcador (o que vem antes e depois — inclusive outros marcadores — continua para os demais parsers).
 *
 * Política fail-closed: marcador duplicado, payload sem JSON, JSON não balanceado ou inválido são
 * status distintos e NUNCA viram "válido"; quem chama decide correção/fallback/descarte.
 */
export const MARKER_PARSE_STATUSES = ["VALID", "MARKER_NOT_FOUND", "MARKER_DUPLICATE", "MARKER_PAYLOAD_INVALID", "MARKER_BOUNDARY_ERROR"] as const
export type MarkerParseStatus = (typeof MARKER_PARSE_STATUSES)[number]

export type MarkerExtraction = {
  status: MarkerParseStatus
  /** JSON parseado (só com status VALID). */
  payload: unknown
  /** Texto original sem o bloco do marcador (marcador + payload + cerca de markdown). Com MARKER_NOT_FOUND é o texto intacto. */
  text: string
  /** Quantas vezes o marcador apareceu em posição de marcador (início de linha). */
  occurrences: number
}

const FENCE_OPEN = /^```[a-zA-Z]*[ \t]*\r?\n?/
const FENCE_CLOSE = /^[ \t]*\r?\n?[ \t]*```/

/** Posições em que `marker` aparece como MARCADOR: início do texto ou de linha, com prefixos tolerados (espaços, "**", "- "). */
function markerPositions(text: string, marker: string): number[] {
  const positions: number[] = []
  let from = 0
  while (from <= text.length) {
    const index = text.indexOf(marker, from)
    if (index === -1) break
    const lineStart = text.lastIndexOf("\n", index - 1) + 1
    const prefix = text.slice(lineStart, index)
    if (/^[ \t]*(?:[-*]\s+)?(?:\*\*)?[ \t]*$/.test(prefix)) positions.push(index)
    from = index + marker.length
  }
  return positions
}

/** Fim (exclusivo) do JSON balanceado que começa em `start` ("{" ou "["); -1 se não fecha. Ciente de strings/escapes. */
export function scanBalancedJson(text: string, start: number): number {
  let depth = 0
  let inString = false
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]!
    if (inString) {
      if (char === "\\") index += 1
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === "{" || char === "[") depth += 1
    else if (char === "}" || char === "]") {
      depth -= 1
      if (depth === 0) return index + 1
      if (depth < 0) return -1
    }
  }
  return -1
}

export function extractMarkerPayload(rawText: string, marker: string): MarkerExtraction {
  const positions = markerPositions(rawText, marker)
  if (positions.length === 0) return { status: "MARKER_NOT_FOUND", payload: undefined, text: rawText, occurrences: 0 }
  const markerAt = positions[0]!
  const lineStart = rawText.lastIndexOf("\n", markerAt - 1) + 1
  let cursor = markerAt + marker.length
  // Espaços, quebra de linha e cerca ```json opcionais entre o marcador e o JSON.
  cursor += (/^[ \t]*(?:\*\*)?[ \t]*\r?\n?[ \t]*/.exec(rawText.slice(cursor))?.[0].length ?? 0)
  const fence = FENCE_OPEN.exec(rawText.slice(cursor))
  if (fence) cursor += fence[0].length
  cursor += (/^\s*/.exec(rawText.slice(cursor))?.[0].length ?? 0)
  const opener = rawText[cursor]
  const invalid = (status: MarkerParseStatus, end: number): MarkerExtraction => ({ status, payload: undefined, text: spliceOut(rawText, lineStart, end), occurrences: positions.length })
  if (opener !== "{" && opener !== "[") return invalid("MARKER_PAYLOAD_INVALID", nextLineEnd(rawText, cursor))
  const end = scanBalancedJson(rawText, cursor)
  if (end === -1) return invalid("MARKER_BOUNDARY_ERROR", rawText.length)
  let blockEnd = end
  const closing = FENCE_CLOSE.exec(rawText.slice(end))
  if (fence && closing) blockEnd = end + closing[0].length
  // Outra ocorrência FORA do payload deste marcador = duplicado (fail-closed: nenhum dos dois vale).
  const duplicate = positions.some((position) => position !== markerAt && (position < lineStart || position >= end))
  if (duplicate) return { status: "MARKER_DUPLICATE", payload: undefined, text: spliceOut(rawText, lineStart, blockEnd), occurrences: positions.length }
  let payload: unknown
  try {
    payload = JSON.parse(rawText.slice(cursor, end))
  } catch {
    return invalid("MARKER_PAYLOAD_INVALID", blockEnd)
  }
  return { status: "VALID", payload, text: spliceOut(rawText, lineStart, blockEnd), occurrences: positions.length }
}

function nextLineEnd(text: string, from: number): number {
  const newline = text.indexOf("\n", from)
  return newline === -1 ? text.length : newline
}

/** Remove [start, end) e normaliza as bordas (sem deixar linhas em branco duplas onde o bloco estava). */
function spliceOut(text: string, start: number, end: number): string {
  const before = text.slice(0, start).replace(/[ \t]*\r?\n?[ \t]*$/, "")
  const after = text.slice(end).replace(/^[ \t]*\r?\n?/, "")
  if (before.length === 0) return after.trim()
  if (after.trim().length === 0) return before.trim()
  return `${before}\n${after}`.trim()
}
