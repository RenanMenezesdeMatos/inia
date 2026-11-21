/**
 * O texto da própria base junto de uma imagem (print de instrução de trabalho), para a tela mostrar embaixo da imagem ampliada. É sempre o texto
 * literal do material, nunca gerado: texto de IA não é evidência. Sem texto por perto, null, e a tela não mostra descrição.
 *
 * Regra `IMAGE_STEP_TEXT_V1` (a mesma em `frontend/src/lib/knowledge/image-step-text.ts`; as duas respondem o caderno único
 * `backend/src/modules/knowledge/testing/image-step-text-cases.ts` em `image-step-text.parity.test.ts`):
 *   - a imagem entra no fim da linha do último texto acima dela (`placeImages`), então o passo que ela ilustra é o bloco que termina ali: o item
 *     de lista (com as linhas de continuação) ou o parágrafo;
 *   - se antes dela só há título, tabela ou nada, vale o primeiro bloco depois dela (a legenda ou o passo seguinte);
 *   - marcação de Markdown sai (títulos, negrito, código), espaços são juntados e o texto é limitado a `IMAGE_STEP_TEXT_MAX` caracteres.
 */
export const IMAGE_STEP_TEXT_VERSION = "IMAGE_STEP_TEXT_V1"
export const IMAGE_STEP_TEXT_MAX = 400

const HEADING = /^\s{0,3}#{1,6}\s/
const TABLE_ROW = /^\s*\|/
const LIST_ITEM = /^\s*(?:[-*+•]|\d{1,3}[.)])\s+/
/** Linha que é só uma imagem ou separador de Markdown: não é texto do passo. */
const NOT_TEXT = /^\s*(?:!\[[^\]]*\]\([^)]*\)|[-*_]{3,}|```.*)\s*$/

const isBreak = (line: string) => line.trim() === "" || HEADING.test(line) || TABLE_ROW.test(line) || NOT_TEXT.test(line)

function blockBefore(lines: readonly string[]): string | null {
  let end = lines.length - 1
  while (end >= 0 && lines[end]!.trim() === "") end -= 1
  if (end < 0 || isBreak(lines[end]!)) return null
  let start = end
  while (start > 0 && !LIST_ITEM.test(lines[start]!) && !isBreak(lines[start - 1]!)) start -= 1
  return lines.slice(start, end + 1).join(" ")
}

function blockAfter(lines: readonly string[]): string | null {
  let start = 0
  while (start < lines.length && lines[start]!.trim() === "") start += 1
  if (start >= lines.length || isBreak(lines[start]!)) return null
  let end = start
  while (end + 1 < lines.length && !isBreak(lines[end + 1]!) && !LIST_ITEM.test(lines[end + 1]!)) end += 1
  return lines.slice(start, end + 1).join(" ")
}

function clean(block: string): string {
  const plain = block
    .replace(/\*\*|__|`/g, "")
    .replace(/\s+/g, " ")
    .trim()
  if (plain.length <= IMAGE_STEP_TEXT_MAX) return plain
  const cut = plain.slice(0, IMAGE_STEP_TEXT_MAX - 1)
  const space = cut.lastIndexOf(" ")
  return `${(space > IMAGE_STEP_TEXT_MAX / 2 ? cut.slice(0, space) : cut).trimEnd()}…`
}

/** `at` é a posição da imagem no texto (fim de linha). Fora do texto, vale a borda mais próxima. */
export function imageStepText(text: string, at: number): string | null {
  const normalized = text.replace(/\r\n?/g, "\n")
  const position = Math.max(0, Math.min(at, normalized.length))
  const lineEnd = normalized.indexOf("\n", position)
  const split = lineEnd < 0 ? normalized.length : lineEnd
  const found = blockBefore(normalized.slice(0, split).split("\n")) ?? blockAfter(normalized.slice(split).split("\n"))
  if (!found) return null
  const result = clean(found)
  return result ? result : null
}
