import { inflateRawSync } from "node:zlib"

/**
 * GUARDA CONTRA ZIP MALICIOSO — XLSX e DOCX são pacotes ZIP que os parsers (exceljs, mammoth) descompactam INTEIROS na
 * memória do processo. Um arquivo de poucos MB pode virar gigabytes descompactados ("zip bomb") e derrubar a API (um
 * processo só). Antes de qualquer parser, lê o DIRETÓRIO CENTRAL do ZIP e recusa: pacote sem diretório legível, entradas
 * demais, tamanho descompactado total acima do teto ou taxa de compressão absurda. E não confia no tamanho DECLARADO: cada
 * entrada é descompactada de verdade com o teto do próprio tamanho declarado — entrada que passa dele (ou tem tamanho real
 * diferente) recusa o pacote (achado DATA-1 da auditoria de 17/10/2026: o JSZip dos parsers só compara no fim, depois de ter
 * descompactado tudo). A memória dessa conferência é a de UMA entrada por vez, dentro do teto total.
 * E o pacote precisa ser LIDO DO MESMO JEITO pela guarda e pelo JSZip dos parsers (achado N04 da 4ª auditoria): o JSZip continua
 * lendo registros além da contagem do fim do diretório, troca para ZIP64 com um campo de disco 0xFFFF e reposiciona tudo quando
 * há um vão antes do fim — entradas que a guarda nunca via eram descompactadas sem teto. Por isso o fim do diretório precisa ser
 * coerente (volume único, contagens iguais, diretório terminando exatamente nele, fim do arquivo depois do comentário), o
 * diretório não pode ter registro a mais e nome repetido não entra. Documento do Office sempre atende a isso.
 */
export type ZipLimits = { maxEntries: number; maxTotalUncompressedBytes: number; maxEntryRatio: number }

export const OFFICE_ZIP_LIMITS: ZipLimits = { maxEntries: 20_000, maxTotalUncompressedBytes: 300 * 1024 * 1024, maxEntryRatio: 1_000 }

/** `files`: nome e tamanho descompactado de cada parte, como o diretório central declara (e a guarda conferiu). */
export type ZipInspection = { ok: true; entries: number; totalUncompressedBytes: number; files: { name: string; bytes: number }[] } | { ok: false; reason: string }

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50
const ZIP64_MARKER = 0xffffffff
const STORED = 0
const DEFLATED = 8

/** Descompacta a entrada com teto = o tamanho declarado; devolve o motivo da recusa ou null (conteúdo confere). */
function verifyEntry(data: Buffer, centralCursor: number, compressed: number, uncompressed: number): string | null {
  const flags = data.readUInt16LE(centralCursor + 8)
  const method = data.readUInt16LE(centralCursor + 10)
  const localOffset = data.readUInt32LE(centralCursor + 42)
  if (flags & 0x1) return "entrada cifrada"
  if (localOffset === ZIP64_MARKER || localOffset + 30 > data.length || data.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) return "entrada corrompida"
  const start = localOffset + 30 + data.readUInt16LE(localOffset + 26) + data.readUInt16LE(localOffset + 28)
  if (start + compressed > data.length) return "entrada fora do arquivo"
  const body = data.subarray(start, start + compressed)
  if (method === STORED) return compressed === uncompressed ? null : "tamanho real diferente do declarado"
  if (method !== DEFLATED) return "método de compressão não suportado"
  try {
    const inflated = inflateRawSync(body, { maxOutputLength: Math.max(uncompressed, 1) })
    return inflated.length === uncompressed ? null : "tamanho real diferente do declarado"
  } catch (error) {
    return error instanceof RangeError ? "conteúdo descompactado maior que o declarado" : "entrada corrompida"
  }
}

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
  if (eocd >= 20 && data.readUInt32LE(eocd - 20) === ZIP64_LOCATOR_SIGNATURE) return { ok: false, reason: "pacote ZIP64 (grande demais para um documento)" }
  if (data.readUInt16LE(eocd + 4) !== 0 || data.readUInt16LE(eocd + 6) !== 0 || data.readUInt16LE(eocd + 8) !== entries) return { ok: false, reason: "pacote em vários volumes ou com contagem inconsistente" }
  if (eocd + 22 + data.readUInt16LE(eocd + 20) !== data.length) return { ok: false, reason: "fim do pacote inconsistente" }
  if (entries > limits.maxEntries) return { ok: false, reason: `entradas demais (${entries})` }
  if (centralOffset + centralSize > data.length) return { ok: false, reason: "diretório central fora do arquivo" }
  if (centralOffset + centralSize !== eocd) return { ok: false, reason: "diretório central fora do lugar" }

  let cursor = centralOffset
  let total = 0
  const names = new Set<string>()
  const files: { name: string; bytes: number }[] = []
  for (let index = 0; index < entries; index += 1) {
    if (cursor + 46 > data.length || data.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) return { ok: false, reason: "diretório central corrompido" }
    const name = data.toString("latin1", cursor + 46, cursor + 46 + data.readUInt16LE(cursor + 28))
    if (names.has(name)) return { ok: false, reason: "entrada com nome repetido" }
    names.add(name)
    const compressed = data.readUInt32LE(cursor + 20)
    const uncompressed = data.readUInt32LE(cursor + 24)
    if (compressed === ZIP64_MARKER || uncompressed === ZIP64_MARKER) return { ok: false, reason: "entrada ZIP64 (grande demais para um documento)" }
    total += uncompressed
    if (total > limits.maxTotalUncompressedBytes) return { ok: false, reason: "conteúdo descompactado grande demais" }
    if (uncompressed > 1024 * 1024 && uncompressed / Math.max(compressed, 1) > limits.maxEntryRatio) return { ok: false, reason: "taxa de compressão suspeita" }
    const mismatch = verifyEntry(data, cursor, compressed, uncompressed)
    if (mismatch) return { ok: false, reason: mismatch }
    files.push({ name, bytes: uncompressed })
    cursor += 46 + data.readUInt16LE(cursor + 28) + data.readUInt16LE(cursor + 30) + data.readUInt16LE(cursor + 32)
  }
  // Registro além da contagem (o JSZip leria e descompactaria sem esta conferência).
  if (cursor !== centralOffset + centralSize) return { ok: false, reason: "diretório central com registros não contados" }
  return { ok: true, entries, totalUncompressedBytes: total, files }
}

/** Limites completos do multer para uploads em memória: além do tamanho, partes, campos e tamanho de campo. */
export function multerLimits(fileSize: number, files = 1) {
  return { fileSize, files, fields: 30, fieldSize: 1024 * 1024, parts: 40, headerPairs: 200 }
}
