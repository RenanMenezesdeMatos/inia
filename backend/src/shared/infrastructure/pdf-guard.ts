import { promisify } from "node:util"
import { inflate, inflateRaw } from "node:zlib"

const inflateAsync = promisify(inflate)
const inflateRawAsync = promisify(inflateRaw)

/**
 * GUARDA CONTRA PDF "BOMBA" — o extrator de texto (pdf-parse/pdf.js) descompacta os fluxos FlateDecode inteiros na memória do
 * processo da API: um PDF de 200 KB com um fluxo que vira 200 MB levou o processo a ~1 GB (achado DATA-1 da auditoria de
 * 17/10/2026). Antes do parser, cada fluxo FlateDecode é descompactado de verdade, fora da thread principal e com teto: fluxo
 * acima do teto, taxa de compressão absurda ou soma acima do teto total recusa o arquivo. A memória dessa conferência é a de UM
 * fluxo por vez (até o teto). Outros filtros (LZW, RunLength, cadeias de filtros) não são medidos — ver pendências de segurança.
 */
export type PdfLimits = { maxStreamInflatedBytes: number; maxImageInflatedBytes: number; maxTotalInflatedBytes: number; maxStreamRatio: number; maxStreams: number }

/**
 * Manuais reais com capturas de tela chegam a ~200 MB descompactados em ~8 MB (imagens), com fluxos de imagem muito comprimíveis
 * (tela branca): imagem tem teto próprio e fica fora da regra de taxa; o resto (conteúdo das páginas, fontes, objetos) não.
 */
export const PDF_LIMITS: PdfLimits = { maxStreamInflatedBytes: 32 * 1024 * 1024, maxImageInflatedBytes: 64 * 1024 * 1024, maxTotalInflatedBytes: 512 * 1024 * 1024, maxStreamRatio: 200, maxStreams: 50_000 }

export type PdfInspection = { ok: true; streams: number; totalInflatedBytes: number } | { ok: false; reason: string }

/** Início dos dados de cada fluxo (`stream` + EOL), sem casar o `endstream`. */
const STREAM_KEYWORD = /(?<![a-z])stream(?:\r\n|\n|\r)/g

async function inflatedSize(body: Buffer, cap: number): Promise<number | "TOO_LARGE" | "UNREADABLE"> {
  for (const decode of [inflateAsync, inflateRawAsync]) {
    try {
      return (await decode(body, { maxOutputLength: cap })).length
    } catch (error) {
      if (error instanceof RangeError) return "TOO_LARGE"
    }
  }
  return "UNREADABLE"
}

export async function inspectPdf(buffer: Buffer, limits: PdfLimits = PDF_LIMITS): Promise<PdfInspection> {
  const text = buffer.toString("latin1")
  let streams = 0
  let total = 0
  for (const match of text.matchAll(STREAM_KEYWORD)) {
    const start = match.index + match[0].length
    const end = text.indexOf("endstream", start)
    if (end < 0) break
    // Dicionário do fluxo: o trecho entre o último "obj" antes dele e a palavra `stream`.
    const header = text.slice(Math.max(0, match.index - 2048), match.index)
    const dictionary = header.slice(header.lastIndexOf("obj") + 1)
    if (!/\/FlateDecode\b/.test(dictionary)) continue
    streams += 1
    if (streams > limits.maxStreams) return { ok: false, reason: "fluxos comprimidos demais" }
    const image = /\/Subtype\s*\/Image\b/.test(dictionary)
    const body = buffer.subarray(start, end)
    const cap = Math.min(image ? limits.maxImageInflatedBytes : limits.maxStreamInflatedBytes, limits.maxTotalInflatedBytes - total) + 1
    const size = await inflatedSize(body, cap)
    if (size === "TOO_LARGE") return { ok: false, reason: "fluxo comprimido grande demais" }
    if (size === "UNREADABLE") continue
    if (!image && size > 1024 * 1024 && size / Math.max(body.length, 1) > limits.maxStreamRatio) return { ok: false, reason: "taxa de compressão suspeita" }
    total += size
    if (total > limits.maxTotalInflatedBytes) return { ok: false, reason: "conteúdo descompactado grande demais" }
  }
  return { ok: true, streams, totalInflatedBytes: total }
}
