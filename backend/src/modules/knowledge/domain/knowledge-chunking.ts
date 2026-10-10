/**
 * Divide o conteúdo de uma Base de Conhecimento em trechos recuperáveis — puro, sem banco.
 *
 * As bases da INIA são texto extraído (Markdown escrito à mão ou DOCX/PDF convertidos), quase
 * sempre organizadas por títulos `#`/`##`/`###` ("## 3. Etapas do atendimento"). O corte segue
 * essa estrutura: um trecho por seção, e seções longas são subdivididas por parágrafo até caber
 * em `maxChunkChars`. Cada trecho carrega o título da seção de origem para a IA conseguir citar
 * "documento + seção" (e para o QA Lab mostrar exatamente o que foi recuperado) — nunca um
 * pedaço anônimo de texto.
 */
export type KnowledgeChunk = {
  documentId: string
  documentTitle: string
  /** Cabeçalho da seção de origem (ex.: "3. Etapas do atendimento") — vazio quando o documento
   * não tem títulos. */
  heading: string
  /** Posição do trecho dentro do documento (0-based) — mantém a ordem original ao montar o prompt. */
  index: number
  text: string
}

export const DEFAULT_MAX_CHUNK_CHARS = 1400

const HEADING_PATTERN = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/

function normalizeLineBreaks(content: string): string {
  return content.replace(/\r\n?/g, "\n")
}

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0)
}

/** Quebra um parágrafo maior que o limite em frases, acumulando até o limite — última linha de
 * defesa para listas enormes sem linha em branco entre os itens. */
function splitOversizedParagraph(paragraph: string, maxChars: number): string[] {
  const sentences = paragraph.split(/(?<=[.;:!?])\s+|\n/)
  const pieces: string[] = []
  let current = ""
  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence
    if (candidate.length > maxChars && current) {
      pieces.push(current)
      current = sentence
    } else {
      current = candidate
    }
  }
  if (current) pieces.push(current)
  return pieces
}

function packParagraphs(paragraphs: string[], maxChars: number): string[] {
  const pieces: string[] = []
  let current = ""
  for (const paragraph of paragraphs) {
    const parts = paragraph.length > maxChars ? splitOversizedParagraph(paragraph, maxChars) : [paragraph]
    for (const part of parts) {
      const candidate = current ? `${current}\n\n${part}` : part
      if (candidate.length > maxChars && current) {
        pieces.push(current)
        current = part
      } else {
        current = candidate
      }
    }
  }
  if (current) pieces.push(current)
  return pieces
}

type Section = { heading: string; body: string }

function splitSections(content: string): Section[] {
  const sections: Section[] = []
  let heading = ""
  let buffer: string[] = []
  const flush = () => {
    const body = buffer.join("\n").trim()
    if (body.length > 0 || heading) sections.push({ heading, body })
    buffer = []
  }
  for (const line of normalizeLineBreaks(content).split("\n")) {
    const match = HEADING_PATTERN.exec(line)
    if (match) {
      flush()
      heading = match[1]!.trim()
      continue
    }
    buffer.push(line)
  }
  flush()
  return sections.filter((section) => section.body.length > 0)
}

export function chunkKnowledgeDocument(
  document: { id: string; title: string; content: string },
  options: { maxChunkChars?: number } = {},
): KnowledgeChunk[] {
  const maxChars = options.maxChunkChars ?? DEFAULT_MAX_CHUNK_CHARS
  const chunks: KnowledgeChunk[] = []
  for (const section of splitSections(document.content)) {
    for (const text of packParagraphs(splitParagraphs(section.body), maxChars)) {
      chunks.push({ documentId: document.id, documentTitle: document.title, heading: section.heading, index: chunks.length, text })
    }
  }
  return chunks
}
