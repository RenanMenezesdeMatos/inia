/**
 * V1.7.1k — REPRESENTAÇÃO CANÔNICA DE LISTA da Base de Conhecimento (`KNOWLEDGE_LIST_V1`, domínio puro, sem LLM).
 *
 * O mesmo conteúdo aparece com formatações editoriais diferentes — bullets ("- ", "• ", "* "), caixas ("[ ]"), numeração em
 * linhas ("1. ", "2) "), numeração entre parênteses ("(1) ") e enumeração DENTRO de uma linha ("Antes de encerrar qualquer
 * chamada: (1) confirme…; (2) informe…; (3) …"), além das listas achatadas pelo retrieval. No smoke V1.7.1j o "Checklist de
 * Encerramento" (enumeração em linha) nunca era reconhecido como lista e toda etapa dele ia ao QA. Aqui existe UMA leitura:
 *
 *   KnowledgeList { heading, leadIn, layout MULTILINE | INLINE, ordered, items[] }
 *   KnowledgeListItem { position, text (literal, sem o marcador), marker (literal), markerKind, ordinal, line }
 *
 * Todos os consumidores (contexto da regra/etapa canônica, âncora, normalização literal, nome da etapa) usam as funções daqui.
 *
 * Marcador é ESTRUTURA EDITORIAL, nunca "qualquer número": só vale no começo da linha (ou numa fronteira de item), seguido de
 * espaço; a enumeração em linha exige ordinais SEQUENCIAIS a partir de 1 (≥ 2 itens) e texto começando por letra. Protocolo
 * ("2026 0925 4471"), telefone ("(11) 98765-4321"), data ("25.09.2026"), valor ("R$ 12,90") e prazo ("5 dias") não viram item.
 */
export const KNOWLEDGE_LIST_VERSION = "KNOWLEDGE_LIST_V1" as const

export type ListMarkerKind = "BULLET" | "CHECKBOX" | "NUMBER_DOT" | "NUMBER_PAREN" | "PAREN_NUMBER"
export type ListMarker = { kind: ListMarkerKind; raw: string; ordinal: number | null }
export type KnowledgeListItem = { position: number; text: string; marker: string; markerKind: ListMarkerKind; ordinal: number | null; line: number }
export type KnowledgeList = { heading: string | null; leadIn: string | null; layout: "MULTILINE" | "INLINE"; ordered: boolean; items: KnowledgeListItem[] }

/** Marcador editorial no COMEÇO de uma linha (fonte única do padrão). */
// Numeração só é marcador quando o item começa por texto (letra, aspas, ênfase): "(11) 98765-4321" e "1. 2026" não são itens.
const MARKER = String.raw`(?:[-*•+](?=\s|\[)\s*(?:\[[ xX]\]\s*)?|\d{1,3}[.)](?=\s+[\p{L}“"«*_\[])|\(\d{1,3}\)(?=\s+[\p{L}“"«*_\[]))`
export const LEADING_LIST_MARKER = new RegExp(`^\\s*${MARKER}\\s*`, "u")
const LEADING_CAPTURE = new RegExp(`^(\\s*)(${MARKER})\\s*(.*)$`, "u")

function markerOf(raw: string): ListMarker {
  const value = raw.trim()
  const paren = /^\((\d{1,3})\)$/.exec(value)
  if (paren) return { kind: "PAREN_NUMBER", raw: value, ordinal: Number(paren[1]) }
  const numbered = /^(\d{1,3})([.)])$/.exec(value)
  if (numbered) return { kind: numbered[2] === "." ? "NUMBER_DOT" : "NUMBER_PAREN", raw: value, ordinal: Number(numbered[1]) }
  return { kind: /\[[ xX]\]/.test(value) ? "CHECKBOX" : "BULLET", raw: value, ordinal: null }
}

/** A linha começa com um marcador de lista? Devolve o marcador e o corpo literal (sem o marcador). */
export function listMarkerOf(line: string): { marker: ListMarker; body: string } | null {
  const match = LEADING_CAPTURE.exec(line)
  if (!match) return null
  return { marker: markerOf(match[2]!), body: match[3]! }
}
export const isListLine = (line: string) => LEADING_LIST_MARKER.test(line)
/** Texto sem o marcador inicial ("(2) informe o número do protocolo;" → "informe o número do protocolo;"). */
export const stripListMarker = (text: string) => text.replace(LEADING_LIST_MARKER, "")

export type InlineEnumeration = { leadIn: string | null; items: { ordinal: number; marker: string; markerKind: ListMarkerKind; text: string }[] }
const INLINE_MARKER = /(\(\d{1,3}\)|\d{1,3}[.)])(?=\s+\p{L})/gu

/**
 * Enumeração DENTRO de uma linha: "(1) … (2) … (3) …" ou, depois de ":"/";", "1. … 2. …" / "1) … 2) …". Exige ordinais
 * sequenciais 1..n (n ≥ 2) do MESMO tipo de marcador e texto começando por letra. O texto antes do 1º marcador é a abertura.
 */
export function inlineEnumerationOf(line: string): InlineEnumeration | null {
  const found: { index: number; raw: string; ordinal: number; kind: ListMarkerKind }[] = []
  for (const match of line.matchAll(INLINE_MARKER)) {
    const raw = match[1]!
    const index = match.index!
    const before = line.slice(0, index)
    const kind = markerOf(raw).kind
    // Fronteira editorial: começo da linha, ou espaço depois de ":"/";" (e, para "(n)", depois de qualquer espaço).
    const boundary = before.trim().length === 0 || /[:;]\s*$/.test(before) || (kind === "PAREN_NUMBER" && /\s$/.test(before))
    if (!boundary) continue
    found.push({ index, raw, ordinal: markerOf(raw).ordinal!, kind })
  }
  // A sequência precisa começar em 1, ser contínua e usar um só tipo de marcador.
  const start = found.findIndex((entry) => entry.ordinal === 1)
  if (start < 0) return null
  const sequence = [found[start]!]
  for (const entry of found.slice(start + 1)) {
    if (entry.kind === sequence[0]!.kind && entry.ordinal === sequence[sequence.length - 1]!.ordinal + 1) sequence.push(entry)
  }
  if (sequence.length < 2) return null
  const lead = line.slice(0, sequence[0]!.index).trim()
  const items = sequence.map((entry, position) => {
    const end = position + 1 < sequence.length ? sequence[position + 1]!.index : line.length
    const text = line.slice(entry.index + entry.raw.length, end).trim().replace(/\s+(?:e|ou)$/iu, "").trim()
    return { ordinal: entry.ordinal, marker: entry.raw, markerKind: entry.kind, text }
  })
  if (items.some((item) => !/^\p{L}/u.test(item.text))) return null
  return { leadIn: lead.length > 0 ? lead : null, items }
}

/**
 * LINHAS ESTRUTURAIS do conteúdo: cada enumeração em linha vira a abertura + uma linha por item, com o marcador original
 * ("(1) confirme…"). Demais linhas ficam como estão. `source` = índice da linha original (proveniência).
 */
export function structuralLinesOf(content: string): { text: string; source: number }[] {
  return content.split(/\r?\n/).flatMap((line, source) => {
    if (isListLine(line)) return [{ text: line, source }]
    const inline = inlineEnumerationOf(line)
    if (!inline) return [{ text: line, source }]
    return [...(inline.leadIn ? [{ text: inline.leadIn, source }] : []), ...inline.items.map((item) => ({ text: `${item.marker} ${item.text}`, source }))]
  })
}

const HEADING = /^\s*#{1,6}\s+(.*)$/
const cleanText = (text: string) => text.replace(/[*_`>]/g, "").replace(/\s+/g, " ").trim()

/** Todas as listas do documento na representação canônica (seção, abertura, itens literais com marcador e posição). */
export function parseKnowledgeLists(content: string): KnowledgeList[] {
  const lines = structuralLinesOf(content)
  const inlineSources = new Set(content.split(/\r?\n/).flatMap((line, source) => (!isListLine(line) && inlineEnumerationOf(line) ? [source] : [])))
  const lists: KnowledgeList[] = []
  let heading: string | null = null
  let current: KnowledgeList | null = null
  let previous: string | null = null
  lines.forEach((line, index) => {
    const title = HEADING.exec(line.text)
    if (title) { heading = cleanText(title[1]!); current = null; previous = null; return }
    const item = listMarkerOf(line.text)
    if (!item) {
      if (line.text.trim().length > 0) { current = null; previous = line.text.trim() }
      return
    }
    if (!current) {
      current = { heading, leadIn: previous && previous.endsWith(":") ? cleanText(previous) : null, layout: inlineSources.has(line.source) ? "INLINE" : "MULTILINE", ordered: true, items: [] }
      lists.push(current)
    }
    if (item.marker.ordinal === null) current.ordered = false
    current.items.push({ position: current.items.length + 1, text: cleanText(item.body), marker: item.marker.raw, markerKind: item.marker.kind, ordinal: item.marker.ordinal, line: index })
  })
  return lists
}

/**
 * Remove SÓ a estrutura editorial de lista para a comparação literal: marcadores/numeração/caixas no começo da linha, depois de
 * ":"/";" (lista achatada) e depois do fim de um item (".", "?", "!" — com ou sem aspas de fechamento: "…claras?” - “Ficou…").
 * Nenhuma palavra muda.
 */
export function stripEditorialListStructure(text: string): string {
  return text
    .replace(/\[[ xX]\]/g, " ")
    .replace(/(^|[\n:;]|[.?!][”"»]?)[ \t]*(?:[-*•+]|\d{1,3}[.)]|\(\d{1,3}\))(?=\s)/g, "$1 ")
}
