import mammoth from "mammoth"
import { inspectZip } from "../../../shared/infrastructure/zip-guard.js"
import { PDFParse } from "pdf-parse"

export type KnowledgeSourceType = "TEXT" | "PDF" | "DOCX" | "TXT" | "JSON"

const MIME_TO_SOURCE_TYPE: Record<string, KnowledgeSourceType> = {
  "application/pdf": "PDF",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
  "text/plain": "TXT",
  "application/json": "JSON",
}

export function resolveSourceType(mimeType: string, filename: string): KnowledgeSourceType {
  if (MIME_TO_SOURCE_TYPE[mimeType]) return MIME_TO_SOURCE_TYPE[mimeType]
  const extension = filename.split(".").pop()?.toLowerCase()
  if (extension === "pdf") return "PDF"
  if (extension === "docx") return "DOCX"
  if (extension === "json") return "JSON"
  return "TXT"
}

/**
 * O conteúdo bate com o tipo detectado? PDF começa com `%PDF-`; DOCX é um pacote ZIP (`PK\x03\x04`). Texto/JSON não podem
 * ter bytes nulos (binário renomeado). Barra arquivo trocado/polígota antes de qualquer parser rodar sobre ele.
 */
export function contentMatchesSourceType(buffer: Buffer, sourceType: KnowledgeSourceType): boolean {
  if (sourceType === "PDF") return buffer.subarray(0, 5).toString("latin1") === "%PDF-"
  // DOCX = ZIP; também recusa pacote cujo conteúdo descompactado explodiria a memória (zip bomb) antes do mammoth.
  if (sourceType === "DOCX") return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04 && inspectZip(buffer).ok
  return !buffer.includes(0)
}

export async function extractTextFromFile(buffer: Buffer, sourceType: KnowledgeSourceType): Promise<string> {
  if (sourceType === "PDF") {
    const parser = new PDFParse({ data: buffer })
    try {
      const parsed = await parser.getText()
      return parsed.text.trim()
    } finally {
      await parser.destroy()
    }
  }
  if (sourceType === "DOCX") {
    const result = await mammoth.extractRawText({ buffer })
    return result.value.trim()
  }
  return buffer.toString("utf8").trim()
}
