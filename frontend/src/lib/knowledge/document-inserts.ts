import type { PdfExtraction } from "@/schemas/admin/knowledge.schema"

type ImagePlacement = NonNullable<PdfExtraction["images"]>[number]

/** O que entra entre os blocos do texto de um PDF convertido, sem fazer parte dele. `at` é a posição no texto. */
export type DocumentInsert =
  /** Âncora invisível: uma citação "p. 12" leva até aqui. */
  | { kind: "page"; at: number; page: number }
  | { kind: "image"; at: number; image: ImagePlacement }
  /** Página sem texto nem imagem que dê para mostrar: o aviso fica no lugar dela, para nada sumir sem a pessoa perceber. */
  | { kind: "missing"; at: number; page: number }

/**
 * O PDF abre como conteúdo só quando isso não esconde nada. Sem `images`, as imagens não foram lidas (versão anterior a isso, ou a leitura falhou) e
 * ficariam de fora; com a maior parte das páginas sem texto legível, o próprio PDF é a leitura melhor.
 */
export function canReadAsContent(content: string, extraction: PdfExtraction | null | undefined): boolean {
  if (!extraction?.images || !content.trim()) return false
  const pages = extraction.pages.filter((page) => page.status !== "BLANK")
  const readable = pages.filter((page) => page.status === "TEXT" || page.status === "PARTIAL").length
  return readable * 2 >= pages.length
}

function blockStartAt(content: string, offset: number): number {
  const found = offset >= 2 ? content.lastIndexOf("\n\n", offset - 2) : -1
  return found < 0 ? 0 : found + 2
}

/** Fim da linha onde a imagem entra. Depois de uma edição, a linha pode ter ido parar no meio de uma tabela: a imagem espera a tabela terminar. */
export function imageInsertAt(content: string, offset: number | null): number {
  if (offset === null) return content.length
  if (offset <= 0) return 0
  const endOf = (from: number) => {
    const found = content.indexOf("\n", from)
    return found < 0 ? content.length : found
  }
  let at = endOf(offset)
  while (at < content.length) {
    const current = content.slice(content.lastIndexOf("\n", at - 1) + 1, at)
    const nextEnd = endOf(at + 1)
    if (!current.trimStart().startsWith("|") || !content.slice(at + 1, nextEnd).trimStart().startsWith("|")) break
    at = nextEnd
  }
  return at
}

export function documentInserts(content: string, extraction: PdfExtraction): DocumentInsert[] {
  const images = extraction.images ?? []
  const pagesWithImage = new Set(images.map((image) => image.page))
  const inserts: DocumentInsert[] = images.map((image) => ({ kind: "image", at: imageInsertAt(content, image.offset), image }))
  extraction.pages.forEach((entry, index) => {
    if (entry.offset !== null) {
      if (entry.offset > 0) inserts.push({ kind: "page", at: blockStartAt(content, entry.offset), page: entry.page })
      return
    }
    if ((entry.status !== "NO_TEXT" && entry.status !== "UNREADABLE") || pagesWithImage.has(entry.page)) return
    const next = extraction.pages.slice(index + 1).find((page) => page.offset !== null)
    inserts.push({ kind: "missing", at: next ? blockStartAt(content, next.offset!) : content.length, page: entry.page })
  })
  return inserts.sort((left, right) => left.at - right.at)
}
