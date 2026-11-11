/**
 * METADADOS FORA DA IMAGEM antes de gravar (achado AUTH-11 da auditoria de 17/10/2026): foto de celular usada como capa do perfil
 * ou fundo do cenário levava latitude/longitude, aparelho e data a toda a organização. Sem decodificar a imagem (nenhuma
 * dependência nativa): só os blocos de metadados saem — os pixels ficam byte a byte iguais.
 *
 *  - JPEG: saem APP1 (EXIF/XMP), APP3–APP13 e APP15 (IPTC/Photoshop e afins), comentários e o índice MPF (APP2 "MPF"); ficam
 *    APP0 (JFIF), APP2 (perfil de cor ICC) e APP14 (Adobe, cor). A ORIENTAÇÃO da foto (tag EXIF 0x0112) volta num EXIF mínimo,
 *    só com ela — senão a foto em pé apareceria deitada. O arquivo TERMINA no EOI da imagem principal: imagens secundárias do
 *    MPF (mapa de ganho, prévia, profundidade — cada uma com o próprio EXIF) e o vídeo anexado de "foto com movimento" (com
 *    local nos átomos do MP4) saem inteiros (achado de 10/11/2026: antes, tudo depois do primeiro SOS era copiado).
 *  - PNG: saem os blocos de texto (tEXt, zTXt, iTXt), eXIf e tIME; nada depois do IEND.
 *  - WebP: saem os blocos EXIF e XMP (e as marcas deles no VP8X).
 * Estrutura que não for entendida (cortada, marcador inválido, sem EOI/IEND) = `null`: quem chama recusa a imagem — nunca grava
 * os bytes originais com os metadados. Tipo que não for um desses três volta igual (quem chama já validou o tipo).
 */
export function stripImageMetadata(data: Buffer, mimeType: string): Buffer | null {
  try {
    if (mimeType === "image/jpeg") return stripJpeg(data)
    if (mimeType === "image/png") return stripPng(data)
    if (mimeType === "image/webp") return stripWebp(data)
  } catch {
    return null
  }
  return data
}

const KEPT_JPEG_APP = new Set([0xe0, 0xe2, 0xee])

const isStandaloneMarker = (marker: number) => marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)
const isMpfIndex = (marker: number, segment: Buffer) => marker === 0xe2 && segment.toString("latin1", 4, 8) === "MPF\0"
const isDroppedSegment = (marker: number, segment: Buffer) => (marker >= 0xe0 && marker <= 0xef && !KEPT_JPEG_APP.has(marker)) || marker === 0xfe || isMpfIndex(marker, segment)

function stripJpeg(data: Buffer): Buffer | null {
  if (data[0] !== 0xff || data[1] !== 0xd8) return null
  const parts: Buffer[] = [data.subarray(0, 2)]
  let orientation: number | null = null
  let scanned = false
  let offset = 2
  while (offset + 2 <= data.length) {
    if (data[offset] !== 0xff) return null
    const marker = data[offset + 1]!
    // Bytes de preenchimento (0xFF repetido) antes de um marcador.
    if (marker === 0xff) {
      offset += 1
      continue
    }
    // Fim da imagem principal: o que vier depois (imagens do MPF, vídeo anexado, lixo) não é gravado.
    if (marker === 0xd9) {
      if (!scanned) return null
      parts.push(data.subarray(offset, offset + 2))
      return Buffer.concat(parts)
    }
    // Marcadores sem tamanho (SOI repetido, TEM, RST0–RST7) — os mesmos que a validação (`jpegSize`) aceita: sem tratá-los, um
    // arquivo com um deles antes do SOF passava na validação e voltava inteiro daqui, COM o EXIF/GPS (auditoria AppSec 29/10/2026).
    if (isStandaloneMarker(marker)) {
      parts.push(data.subarray(offset, offset + 2))
      offset += 2
      continue
    }
    if (offset + 4 > data.length) return null
    const length = data.readUInt16BE(offset + 2)
    const end = offset + 2 + length
    if (length < 2 || end > data.length) return null
    const segment = data.subarray(offset, end)
    if (marker === 0xe1) orientation ??= exifOrientation(segment.subarray(4))
    if (marker === 0xda && !scanned) {
      // Primeiro SOS: o EXIF mínimo entra antes, depois do APP0 (JFIF), se houver — a ordem que os leitores esperam.
      if (orientation && orientation !== 1) parts.splice(parts[1]?.[1] === 0xe0 ? 2 : 1, 0, minimalExifWithOrientation(orientation))
      scanned = true
    }
    if (!isDroppedSegment(marker, segment)) parts.push(segment)
    offset = end
    if (marker === 0xda) {
      // Dados comprimidos do scan: copiados até o próximo marcador de verdade (0xFF00 é byte escapado; RSTn faz parte do scan).
      const scanEnd = entropyDataEnd(data, offset)
      if (scanEnd === null) return null
      parts.push(data.subarray(offset, scanEnd))
      offset = scanEnd
    }
  }
  return null
}

/** Posição do primeiro marcador depois dos dados comprimidos de um scan (pula 0xFF00, RST0–RST7 e preenchimento), ou null. */
function entropyDataEnd(data: Buffer, start: number): number | null {
  let at = start
  for (;;) {
    at = data.indexOf(0xff, at)
    if (at < 0 || at + 1 >= data.length) return null
    let next = at + 1
    while (next < data.length && data[next] === 0xff) next += 1
    if (next >= data.length) return null
    const marker = data[next]!
    if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) {
      at = next + 1
      continue
    }
    return next - 1
  }
}

/** Orientação (1–8) do EXIF de um APP1 (`Exif\0\0` + TIFF), ou null. */
function exifOrientation(payload: Buffer): number | null {
  if (payload.length < 14 || payload.toString("latin1", 0, 6) !== "Exif\0\0") return null
  const tiff = payload.subarray(6)
  const little = tiff.toString("latin1", 0, 2) === "II"
  const u16 = (at: number) => (little ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at))
  const u32 = (at: number) => (little ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at))
  const ifd = u32(4)
  if (ifd + 2 > tiff.length) return null
  const entries = u16(ifd)
  for (let index = 0; index < entries; index += 1) {
    const entry = ifd + 2 + index * 12
    if (entry + 12 > tiff.length) return null
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8)
      return value >= 1 && value <= 8 ? value : null
    }
  }
  return null
}

/** APP1 com um EXIF de UMA tag (Orientation), big-endian. */
function minimalExifWithOrientation(orientation: number): Buffer {
  const tiff = Buffer.alloc(8 + 2 + 12 + 4)
  tiff.write("MM", 0, "latin1")
  tiff.writeUInt16BE(42, 2)
  tiff.writeUInt32BE(8, 4)
  tiff.writeUInt16BE(1, 8)
  tiff.writeUInt16BE(0x0112, 10)
  tiff.writeUInt16BE(3, 12)
  tiff.writeUInt32BE(1, 14)
  tiff.writeUInt16BE(orientation, 18)
  tiff.writeUInt32BE(0, 22)
  const payload = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff])
  const header = Buffer.alloc(4)
  header.writeUInt16BE(0xffe1, 0)
  header.writeUInt16BE(payload.length + 2, 2)
  return Buffer.concat([header, payload])
}

const DROPPED_PNG_CHUNKS = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "tIME"])

function stripPng(data: Buffer): Buffer | null {
  const parts: Buffer[] = [data.subarray(0, 8)]
  let offset = 8
  while (offset + 12 <= data.length) {
    const length = data.readUInt32BE(offset)
    const type = data.toString("latin1", offset + 4, offset + 8)
    const end = offset + 12 + length
    if (end > data.length) return null
    if (!DROPPED_PNG_CHUNKS.has(type)) parts.push(data.subarray(offset, end))
    offset = end
    if (type === "IEND") return Buffer.concat(parts)
  }
  return null
}

const DROPPED_WEBP_CHUNKS = new Set(["EXIF", "XMP "])

function stripWebp(data: Buffer): Buffer | null {
  if (data.toString("latin1", 0, 4) !== "RIFF" || data.toString("latin1", 8, 12) !== "WEBP") return null
  const chunks: Buffer[] = []
  let offset = 12
  while (offset + 8 <= data.length) {
    const type = data.toString("latin1", offset, offset + 4)
    const size = data.readUInt32LE(offset + 4)
    const end = offset + 8 + size + (size % 2)
    if (offset + 8 + size > data.length) return null
    if (!DROPPED_WEBP_CHUNKS.has(type)) {
      const chunk = Buffer.from(data.subarray(offset, Math.min(end, data.length)))
      // VP8X: desliga as marcas de EXIF (0x08) e XMP (0x04) — os blocos saíram.
      if (type === "VP8X" && chunk.length > 8) chunk[8] = chunk[8]! & ~0x0c
      chunks.push(chunk)
    }
    offset = end
  }
  const body = Buffer.concat(chunks)
  const header = Buffer.alloc(12)
  header.write("RIFF", 0, "latin1")
  header.writeUInt32LE(body.length + 4, 4)
  header.write("WEBP", 8, "latin1")
  return Buffer.concat([header, body])
}
