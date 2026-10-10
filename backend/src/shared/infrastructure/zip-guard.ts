/**
 * GUARDA CONTRA ZIP MALICIOSO — XLSX e DOCX são pacotes ZIP que os parsers (exceljs, mammoth) descompactam INTEIROS na
 * memória do processo. Um arquivo de poucos MB pode declarar gigabytes descompactados ("zip bomb") e derrubar a API (um
 * processo só). Antes de qualquer parser, lê o DIRETÓRIO CENTRAL do ZIP (sem descompactar nada) e recusa: pacote sem
 * diretório legível, entradas demais, tamanho descompactado total acima do teto ou taxa de compressão absurda.
 */
export type ZipLimits = { maxEntries: number; maxTotalUncompressedBytes: number; maxEntryRatio: number }

export const OFFICE_ZIP_LIMITS: ZipLimits = { maxEntries: 20_000, maxTotalUncompressedBytes: 300 * 1024 * 1024, maxEntryRatio: 1_000 }

export type ZipInspection = { ok: true; entries: number; totalUncompressedBytes: number } | { ok: false; reason: string }

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const ZIP64_MARKER = 0xffffffff

export function inspectZip(buffer: Uint8Array, limits: ZipLimits = OFFICE_ZIP_LIMITS): ZipInspection {
  const data = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  // Fim do diretório central: nos últimos 22 + 65.535 bytes (comentário do ZIP).
  const searchStart = Math.max(0, data.length - 22 - 0xffff)
  let eocd = -1
  for (let offset = data.length - 22; offset >= searchStart; offset -= 1) {
    if (data.readUInt32LE(offset) === EOCD_SIGNATURE) {
      eocd = offset
      break
    }
  }
  if (eocd < 0) return { ok: false, reason: "pacote sem diretório central" }
  const entries = data.readUInt16LE(eocd + 10)
  const centralSize = data.readUInt32LE(eocd + 12)
  const centralOffset = data.readUInt32LE(eocd + 16)
  if (entries === 0xffff || centralSize === ZIP64_MARKER || centralOffset === ZIP64_MARKER) return { ok: false, reason: "pacote ZIP64 (grande demais para um documento)" }
  if (entries > limits.maxEntries) return { ok: false, reason: `entradas demais (${entries})` }
  if (centralOffset + centralSize > data.length) return { ok: false, reason: "diretório central fora do arquivo" }

  let cursor = centralOffset
  let total = 0
  for (let index = 0; index < entries; index += 1) {
    if (cursor + 46 > data.length || data.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) return { ok: false, reason: "diretório central corrompido" }
    const compressed = data.readUInt32LE(cursor + 20)
    const uncompressed = data.readUInt32LE(cursor + 24)
    if (compressed === ZIP64_MARKER || uncompressed === ZIP64_MARKER) return { ok: false, reason: "entrada ZIP64 (grande demais para um documento)" }
    total += uncompressed
    if (total > limits.maxTotalUncompressedBytes) return { ok: false, reason: "conteúdo descompactado grande demais" }
    if (uncompressed > 1024 * 1024 && uncompressed / Math.max(compressed, 1) > limits.maxEntryRatio) return { ok: false, reason: "taxa de compressão suspeita" }
    cursor += 46 + data.readUInt16LE(cursor + 28) + data.readUInt16LE(cursor + 30) + data.readUInt16LE(cursor + 32)
  }
  return { ok: true, entries, totalUncompressedBytes: total }
}

/** Limites completos do multer para uploads em memória: além do tamanho, partes, campos e tamanho de campo. */
export function multerLimits(fileSize: number, files = 1) {
  return { fileSize, files, fields: 30, fieldSize: 1024 * 1024, parts: 40, headerPairs: 200 }
}
