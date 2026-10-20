/**
 * METADADOS FORA DA IMAGEM antes de gravar (achado AUTH-11 da auditoria de 17/10/2026): foto de celular usada como capa do perfil
 * ou fundo do cenário levava latitude/longitude, aparelho e data a toda a organização. Sem decodificar a imagem (nenhuma
 * dependência nativa): só os blocos de metadados saem — os pixels ficam byte a byte iguais.
 *
 *  - JPEG: saem APP1 (EXIF/XMP), APP3–APP13 e APP15 (IPTC/Photoshop e afins) e comentários; ficam APP0 (JFIF), APP2 (perfil de cor
 *    ICC) e APP14 (Adobe, cor). A ORIENTAÇÃO da foto (tag EXIF 0x0112) volta num EXIF mínimo, só com ela — senão a foto em pé
 *    apareceria deitada.
 *  - PNG: saem os blocos de texto (tEXt, zTXt, iTXt), eXIf e tIME.
 *  - WebP: saem os blocos EXIF e XMP (e as marcas deles no VP8X).
 * Formato que não for reconhecido volta igual (quem chama já validou o tipo).
 */
export function stripImageMetadata(data: Buffer, mimeType: string): Buffer {
  try {
    if (mimeType === "image/jpeg") return stripJpeg(data)
    if (mimeType === "image/png") return stripPng(data)
    if (mimeType === "image/webp") return stripWebp(data)
  } catch {
    // Estrutura inesperada: nada é cortado no escuro — quem chama já validou assinatura e dimensões.
  }
  return data
}

const KEPT_JPEG_APP = new Set([0xe0, 0xe2, 0xee])

function stripJpeg(data: Buffer): Buffer {
  if (data[0] !== 0xff || data[1] !== 0xd8) return data
  const parts: Buffer[] = [data.subarray(0, 2)]
  let orientation: number | null = null
  let offset = 2
  while (offset + 4 <= data.length) {
    if (data[offset] !== 0xff) return data
    const marker = data[offset + 1]!
    // Início dos dados da imagem (SOS): daqui ao fim é a imagem comprimida — copiada inteira.
    if (marker === 0xda) {
      // Depois do APP0 (JFIF), se houver — a ordem que os leitores esperam.
      if (orientation && orientation !== 1) parts.splice(parts[1]?.[1] === 0xe0 ? 2 : 1, 0, minimalExifWithOrientation(orientation))
      parts.push(data.subarray(offset))
      return Buffer.concat(parts)
    }
    const length = data.readUInt16BE(offset + 2)
    const end = offset + 2 + length
    if (length < 2 || end > data.length) return data
    const segment = data.subarray(offset, end)
    const isApp = marker >= 0xe0 && marker <= 0xef
    if (marker === 0xe1) orientation ??= exifOrientation(segment.subarray(4))
    if (!(isApp && !KEPT_JPEG_APP.has(marker)) && marker !== 0xfe) parts.push(segment)
    offset = end
  }
  return data
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

function stripPng(data: Buffer): Buffer {
  const parts: Buffer[] = [data.subarray(0, 8)]
  let offset = 8
  while (offset + 12 <= data.length) {
    const length = data.readUInt32BE(offset)
    const type = data.toString("latin1", offset + 4, offset + 8)
    const end = offset + 12 + length
    if (end > data.length) return data
    if (!DROPPED_PNG_CHUNKS.has(type)) parts.push(data.subarray(offset, end))
    offset = end
    if (type === "IEND") return Buffer.concat(parts)
  }
  return data
}

const DROPPED_WEBP_CHUNKS = new Set(["EXIF", "XMP "])

function stripWebp(data: Buffer): Buffer {
  if (data.toString("latin1", 0, 4) !== "RIFF" || data.toString("latin1", 8, 12) !== "WEBP") return data
  const chunks: Buffer[] = []
  let offset = 12
  while (offset + 8 <= data.length) {
    const type = data.toString("latin1", offset, offset + 4)
    const size = data.readUInt32LE(offset + 4)
    const end = offset + 8 + size + (size % 2)
    if (offset + 8 + size > data.length) return data
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
