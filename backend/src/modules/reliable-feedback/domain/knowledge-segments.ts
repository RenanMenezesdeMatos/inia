import { normalizeForLiteralQuote } from "../../knowledge/domain/knowledge-match.js"
import { knowledgeContentKindOf } from "./suggested-response.js"
import { LEADING_LIST_MARKER } from "../../knowledge/domain/knowledge-list.js"

/**
 * V1.7.1j — SEGMENTOS DO TRECHO DA BASE (`KNOWLEDGE_SEGMENTS_V1`, domínio puro, sem LLM).
 *
 * No smoke V1.7.1i o especialista citou "Sempre informar prazo de forma objetiva: “A contestação foi registrada hoje e será
 * analisada em até cinco dias úteis. O retorno será enviado por SMS.”" — abertura normativa + FALA-MODELO no mesmo trecho. O
 * tipo era decidido pelo começo do trecho (regra), e "cinco dias úteis"/"SMS" ganharam autoridade de regra. Agora o trecho
 * citado é dividido em SEGMENTOS, cada um com o PAPEL decidido pelo próprio texto no documento publicado:
 *
 *   RULE            texto normativo/lista de procedimento (o que o documento manda), inclusive a pergunta/frase PRESCRITA em
 *                   item de lista logo abaixo de uma abertura normativa ("Perguntar:\n- “As informações ficaram claras?”");
 *   SCRIPT_EXAMPLE  fala-modelo entre aspas que o documento marca como exemplo ("Sempre informar…: “A contestação…”");
 *   EXAMPLE         texto de exemplo sem aspas (linha/seção de "Exemplo:");
 *   AVOID           o que o documento manda NÃO dizer/fazer ("Evitar:", frases proibidas);
 *   CONTEXT         marcador sem conteúdo ("Exemplo:", "**Exemplo recomendado:**").
 *
 * Só segmentos RULE sustentam regra ou fato; SCRIPT_EXAMPLE/EXAMPLE só aparecem rotulados como exemplo. Cada segmento guarda a
 * posição no trecho citado e no documento publicado (proveniência); documento, versão e seção são os do trecho verificado.
 */
export const KNOWLEDGE_SEGMENTS_VERSION = "KNOWLEDGE_SEGMENTS_V1" as const

export type KnowledgeSegmentRole = "RULE" | "SCRIPT_EXAMPLE" | "EXAMPLE" | "AVOID" | "CONTEXT"
export type KnowledgeSegment = {
  role: KnowledgeSegmentRole
  /** Texto LITERAL do segmento (como está no trecho citado, sem aspas externas nas falas-modelo). */
  text: string
  /** Posição do segmento no trecho citado. */
  start: number
  end: number
  /** Posição no documento publicado (comparação estrutural); null quando não localizável. */
  documentOffset: number | null
}

const QUOTED = /[“"«]([^”"»]{12,})[”"»]/g
const MARKER_ONLY = /^(?:[-*•>\s]|\*\*)*(?:exemplos?(?:\s+recomendad[oa]s?)?|modelo(?:\s+de\s+fala)?|sugest[ãa]o(?:\s+de\s+fala)?|frase\s+sugerida|script)\s*:?\s*(?:\*\*)?$/iu
const MEANINGFUL = /\p{L}{3,}/u

const fold = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[“”"'`*_]/g, "").replace(/\s+/g, " ").trim().toLowerCase()
/** V1.7.1k — marcador da representação canônica de lista. */
const QUOTED_LIST_ITEM = new RegExp(`${LEADING_LIST_MARKER.source}[“"«]`)
const LIST_ITEM = LEADING_LIST_MARKER
const EXAMPLE_LEAD = /(?<!\p{L})(?:exemplos?|modelo|sugest[ãa]o|sugerid[ao]s?|recomendad[oa]s?|script)(?!\p{L})/iu
const AVOID_LEAD = /^(?:evit|proibid|n[ãa]o\s+(?:dever|deve|pode)|frases?\s+(?:que\s+)?(?:devem\s+ser\s+)?evitad)/iu

/**
 * Pergunta/frase PRESCRITA: item de lista entre aspas logo abaixo de uma abertura normativa ("Perguntar:\n- “As informações
 * ficaram claras?”") — é o conteúdo da regra ("pergunte isto"), não uma fala-modelo solta. A abertura não pode ser marcador de
 * exemplo/recomendação nem de "evitar"; fala-modelo avulsa (sem marcador de lista, como a da seção de prazo) continua exemplo.
 */
function prescribedPhrasing(content: string, text: string): boolean {
  const lines = content.split(/\r?\n/)
  const target = fold(text)
  const index = lines.findIndex((line) => QUOTED_LIST_ITEM.test(line) && fold(line).includes(target))
  if (index < 0) return false
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const value = lines[cursor]!.trim()
    if (value.length === 0 || LIST_ITEM.test(value)) continue
    return value.endsWith(":") && !/^#/.test(value) && !EXAMPLE_LEAD.test(value) && !AVOID_LEAD.test(fold(value))
  }
  return false
}

function roleOf(content: string, text: string, quoted: boolean): KnowledgeSegmentRole {
  if (MARKER_ONLY.test(text.trim())) return "CONTEXT"
  const kind = knowledgeContentKindOf(content, text)
  if (kind === "DO_NOT_CONTENT") return "AVOID"
  if (kind === "EXAMPLE_CONTENT" && quoted && prescribedPhrasing(content, text)) return "RULE"
  if (kind === "EXAMPLE_CONTENT") return quoted ? "SCRIPT_EXAMPLE" : "EXAMPLE"
  // Fala entre aspas no meio de uma linha de regra: o documento não a marca como exemplo — continua parte da regra.
  return "RULE"
}

/** Divide o trecho citado em segmentos por linha e por fala entre aspas; segmentos vizinhos do mesmo papel são unidos. */
export function segmentKnowledgeQuote(content: string, quote: string): KnowledgeSegment[] {
  const publishedNormalized = normalizeForLiteralQuote(content)
  const raw: { text: string; start: number; quoted: boolean }[] = []
  let lineStart = 0
  for (const line of quote.split(/\n/)) {
    let cursor = 0
    for (const match of line.matchAll(QUOTED)) {
      const before = line.slice(cursor, match.index)
      if (MEANINGFUL.test(before)) raw.push({ text: before, start: lineStart + cursor, quoted: false })
      raw.push({ text: match[1]!, start: lineStart + match.index! + 1, quoted: true })
      cursor = match.index! + match[0].length
    }
    const rest = line.slice(cursor)
    if (MEANINGFUL.test(rest)) raw.push({ text: rest, start: lineStart + cursor, quoted: false })
    lineStart += line.length + 1
  }
  const segments: KnowledgeSegment[] = []
  for (const piece of raw) {
    const role = roleOf(content, piece.text, piece.quoted)
    const text = piece.text.trim()
    const offset = publishedNormalized.indexOf(normalizeForLiteralQuote(text))
    const previous = segments[segments.length - 1]
    if (previous && previous.role === role && role === "RULE") {
      previous.text = `${previous.text}\n${text}`
      previous.end = piece.start + piece.text.length
      continue
    }
    segments.push({ role, text, start: piece.start, end: piece.start + piece.text.length, documentOffset: offset >= 0 ? offset : null })
  }
  return segments
}

export const EXAMPLE_SEGMENT_ROLES: readonly KnowledgeSegmentRole[] = ["SCRIPT_EXAMPLE", "EXAMPLE"]
/** O trecho citado mistura REGRA com exemplo (a regra precisa ser separada do exemplo antes de valer como base). */
export const isMixedCitation = (segments: readonly KnowledgeSegment[]) => segments.some((segment) => segment.role === "RULE") && segments.some((segment) => EXAMPLE_SEGMENT_ROLES.includes(segment.role))
/** Texto da REGRA do trecho (só segmentos RULE, na ordem) — o que pode sustentar regra/fato. */
export const ruleTextOfSegments = (segments: readonly KnowledgeSegment[]) => segments.filter((segment) => segment.role === "RULE").map((segment) => segment.text).join("\n")
/** Falas-modelo/exemplos do trecho citado (rotuladas como exemplo; nunca fato). */
export const exampleTextsOfSegments = (segments: readonly KnowledgeSegment[]) => segments.filter((segment) => EXAMPLE_SEGMENT_ROLES.includes(segment.role)).map((segment) => segment.text)
