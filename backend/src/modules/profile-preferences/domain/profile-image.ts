/**
 * Validação de imagem de perfil pelo CONTEÚDO (assinatura binária + dimensões lidas do cabeçalho), nunca pela extensão ou pelo
 * `content-type` que o navegador declarou. Só JPEG, PNG e WebP; SVG/GIF/HEIC ficam de fora (SVG executa script; os outros não
 * são exibidos de forma confiável em todos os navegadores).
 */

export type ProfileImageUsage = "AVATAR" | "COVER"
export type ProfileImageMime = "image/jpeg" | "image/png" | "image/webp"

export const PROFILE_IMAGE_LIMITS: Record<ProfileImageUsage, { maxBytes: number; minWidth: number; minHeight: number; maxSide: number }> = {
  // A foto chega já recortada em quadrado pelo editor; aceita qualquer quadrado razoável.
  AVATAR: { maxBytes: 5 * 1024 * 1024, minWidth: 64, minHeight: 64, maxSide: 4096 },
  COVER: { maxBytes: 8 * 1024 * 1024, minWidth: 600, minHeight: 150, maxSide: 8000 },
}

export type ImageInspection = { mimeType: ProfileImageMime; width: number; height: number }
export type ImageValidation = { ok: true; image: ImageInspection } | { ok: false; code: "IMAGE_EMPTY" | "IMAGE_TOO_LARGE" | "IMAGE_UNSUPPORTED_TYPE" | "IMAGE_UNREADABLE" | "IMAGE_TOO_SMALL" | "IMAGE_DIMENSIONS_TOO_LARGE" | "IMAGE_NOT_SQUARE" }

function pngSize(data: Buffer): { width: number; height: number } | null {
  // Assinatura (8) + tamanho do chunk (4) + "IHDR" (4) + largura (4) + altura (4).
  if (data.length < 24 || data.toString("latin1", 12, 16) !== "IHDR") return null
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) }
}

function jpegSize(data: Buffer): { width: number; height: number } | null {
  let offset = 2
  while (offset + 9 < data.length) {
    if (data[offset] !== 0xff) return null
    const marker = data[offset + 1]!
    // SOF0..SOF15 (menos DHT 0xC4, JPG 0xC8 e DAC 0xCC) trazem altura/largura.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: data.readUInt16BE(offset + 5), width: data.readUInt16BE(offset + 7) }
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2
      continue
    }
    offset += 2 + data.readUInt16BE(offset + 2)
  }
  return null
}

function webpSize(data: Buffer): { width: number; height: number } | null {
  if (data.length < 30) return null
  const chunk = data.toString("latin1", 12, 16)
  if (chunk === "VP8X") return { width: 1 + data.readUIntLE(24, 3), height: 1 + data.readUIntLE(27, 3) }
  if (chunk === "VP8 ") return { width: data.readUInt16LE(26) & 0x3fff, height: data.readUInt16LE(28) & 0x3fff }
  if (chunk === "VP8L") {
    const bits = data.readUInt32LE(21)
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
  }
  return null
}

export function inspectImage(data: Buffer): ImageInspection | "UNSUPPORTED" | "UNREADABLE" {
  let mimeType: ProfileImageMime
  let size: { width: number; height: number } | null
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    mimeType = "image/png"
    size = pngSize(data)
  } else if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    mimeType = "image/jpeg"
    size = jpegSize(data)
  } else if (data.length >= 12 && data.toString("latin1", 0, 4) === "RIFF" && data.toString("latin1", 8, 12) === "WEBP") {
    mimeType = "image/webp"
    size = webpSize(data)
  } else {
    return "UNSUPPORTED"
  }
  if (!size || size.width <= 0 || size.height <= 0) return "UNREADABLE"
  return { mimeType, ...size }
}

export function validateProfileImage(data: Buffer, usage: ProfileImageUsage): ImageValidation {
  if (data.length === 0) return { ok: false, code: "IMAGE_EMPTY" }
  const limits = PROFILE_IMAGE_LIMITS[usage]
  if (data.length > limits.maxBytes) return { ok: false, code: "IMAGE_TOO_LARGE" }
  const inspected = inspectImage(data)
  if (inspected === "UNSUPPORTED") return { ok: false, code: "IMAGE_UNSUPPORTED_TYPE" }
  if (inspected === "UNREADABLE") return { ok: false, code: "IMAGE_UNREADABLE" }
  if (inspected.width < limits.minWidth || inspected.height < limits.minHeight) return { ok: false, code: "IMAGE_TOO_SMALL" }
  if (inspected.width > limits.maxSide || inspected.height > limits.maxSide) return { ok: false, code: "IMAGE_DIMENSIONS_TOO_LARGE" }
  // A foto é exibida em círculo: o editor recorta em quadrado; uma imagem muito fora disso não foi recortada.
  if (usage === "AVATAR" && Math.abs(inspected.width - inspected.height) > Math.max(2, inspected.width * 0.02)) return { ok: false, code: "IMAGE_NOT_SQUARE" }
  return { ok: true, image: inspected }
}

export const IMAGE_ERROR_MESSAGES: Record<Exclude<ImageValidation, { ok: true }>["code"], string> = {
  IMAGE_EMPTY: "A imagem enviada está vazia.",
  IMAGE_TOO_LARGE: "A imagem é grande demais.",
  IMAGE_UNSUPPORTED_TYPE: "Formato não suportado. Envie JPG, PNG ou WebP.",
  IMAGE_UNREADABLE: "Não foi possível ler a imagem enviada.",
  IMAGE_TOO_SMALL: "A imagem é pequena demais.",
  IMAGE_DIMENSIONS_TOO_LARGE: "As dimensões da imagem são grandes demais.",
  IMAGE_NOT_SQUARE: "A foto precisa estar recortada em formato quadrado.",
}
