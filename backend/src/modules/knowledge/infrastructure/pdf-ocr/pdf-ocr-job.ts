import { createOcrEngine, OcrEngineUnavailableError } from "./ocr-engine.js"
import { readScannedPages, type OcrReadResult } from "./pdf-ocr-reader.js"

/**
 * Roda SÓ no processo filho do parser isolado (`shared/infrastructure/isolated-parser`, R-24), nunca na API nem no processamento: é aqui que o pdf.js
 * desenha as páginas do arquivo enviado e o Tesseract as lê. Quem chama é `text-extractor.ts` (`extractScannedPdf`). O andamento sai por `emit`, uma
 * parte por página; o resultado final leva as palavras, as posições dos prints e os prints em WebP.
 */
export type OcrJobInput = {
  data: Uint8Array
  pages: number[]
  limits: { maxImages: number; maxBytes: number }
  existingImageBytes: number
  /** Só para os testes: outra pasta do motor (ex.: uma que não existe). */
  engineDirectory?: string
}

/** Sem os arquivos do motor, o motivo volta como resultado: o processo principal decide o que fazer com ele, sem confundir com arquivo ilegível. */
export type OcrJobOutput = OcrReadResult | { unavailable: string }

export async function run(input: OcrJobInput, emit: (chunk: unknown) => void): Promise<OcrJobOutput> {
  const buffer = Buffer.from(input.data.buffer, input.data.byteOffset, input.data.byteLength)
  const engine = createOcrEngine(input.engineDirectory ? { directory: input.engineDirectory } : {})
  try {
    return await readScannedPages(buffer, input.pages, engine, { onProgress: (progress) => emit(progress), limits: input.limits, existingImageBytes: input.existingImageBytes })
  } catch (error) {
    if (error instanceof OcrEngineUnavailableError) return { unavailable: error.message }
    throw error
  } finally {
    await engine.close()
  }
}
