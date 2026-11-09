import { inspectZip } from "../../../shared/infrastructure/zip-guard.js"
import { parseDocumentIsolated } from "./text-extractor.js"

// Converte o DOCX original em HTML simples para a prévia na tela. Imagens ficam embutidas como
// data URI (comportamento padrão do mammoth) — o frontend sanitiza o HTML antes de renderizar e só
// aceita imagens data:image/*, então nada aponta para fora. Arquivos gravados antes da guarda de upload também passam pela
// conferência do pacote ZIP (a prévia roda a cada leitura, inclusive por quem só lê o material), e o mammoth roda no processo
// filho do parser isolado, com teto de memória e de tempo (R-24).
//
// TAMANHO DA PRÉVIA (lote 3 da 4ª auditoria; P-04 da preparação AppSec): um DOCX legítimo de 1,2 MB com uma imagem de 100 MB
// (passa pela guarda) virava, A CADA prévia, 133 MB de HTML e ~1,3 GB de memória no processo da API. Agora: texto (partes XML)
// acima do teto = sem prévia; imagens/binários acima do teto = prévia sem as imagens (elas nem são descompactadas), com aviso.

export const DOCX_PREVIEW_LIMITS = { maxTextBytes: 20 * 1024 * 1024, maxImageBytes: 25 * 1024 * 1024 }

export const PREVIEW_IMAGES_OMITTED_NOTICE = "<p><em>As imagens deste documento são grandes demais para a prévia — baixe o arquivo original para vê-las.</em></p>"

/** Documento cujo texto passa do teto da prévia: a tela oferece o download do original. */
export class DocxPreviewTooLargeError extends Error {
  constructor() {
    super("Documento grande demais para a prévia — baixe o arquivo original.")
  }
}

export async function renderDocxPreviewHtml(buffer: Buffer, limits: { maxTextBytes: number; maxImageBytes: number } = DOCX_PREVIEW_LIMITS): Promise<string> {
  const zip = await inspectZip(buffer)
  if (!zip.ok) throw new Error(`DOCX recusado: ${zip.reason}`)
  // O mammoth lê as partes XML; imagem é qualquer parte binária (o tipo vem das relações do documento, não do nome).
  const textBytes = zip.files.filter((file) => /\.(xml|rels)$/i.test(file.name)).reduce((total, file) => total + file.bytes, 0)
  const binaryBytes = zip.totalUncompressedBytes - textBytes
  if (textBytes > limits.maxTextBytes) throw new DocxPreviewTooLargeError()
  const omitImages = binaryBytes > limits.maxImageBytes
  const html = await parseDocumentIsolated("DOCX_HTML", buffer, { omitImages })
  return omitImages ? `${PREVIEW_IMAGES_OMITTED_NOTICE}${html}` : html
}
