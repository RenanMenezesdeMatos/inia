import { describe, expect, it } from "vitest"
import { inspectImage } from "../../modules/profile-preferences/domain/profile-image.js"
import { stripImageMetadata } from "./image-metadata.js"

const segment = (marker: number, payload: Buffer) => {
  const header = Buffer.alloc(4)
  header.writeUInt16BE(0xff00 | marker, 0)
  header.writeUInt16BE(payload.length + 2, 2)
  return Buffer.concat([header, payload])
}

/** EXIF big-endian com Orientation e uma tag GPS (o que um celular grava). */
function exifPayload(orientation: number): Buffer {
  const tiff = Buffer.alloc(8 + 2 + 24 + 4)
  tiff.write("MM", 0, "latin1")
  tiff.writeUInt16BE(42, 2)
  tiff.writeUInt32BE(8, 4)
  tiff.writeUInt16BE(2, 8)
  tiff.writeUInt16BE(0x0112, 10)
  tiff.writeUInt16BE(3, 12)
  tiff.writeUInt32BE(1, 14)
  tiff.writeUInt16BE(orientation, 18)
  tiff.writeUInt16BE(0x8825, 22)
  tiff.writeUInt16BE(4, 24)
  tiff.writeUInt32BE(1, 26)
  tiff.writeUInt32BE(0xdeadbeef, 30)
  return Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff, Buffer.from("GPS -23.5505,-46.6333 iPhone", "latin1")])
}

function jpeg(orientation: number): Buffer {
  const sof = Buffer.from([0x08, 0x02, 0x58, 0x03, 0x20, 0x01, 0x01, 0x11, 0x00])
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    segment(0xe0, Buffer.from("JFIF\0\x01\x01\0\0\x01\0\x01\0\0", "latin1")),
    segment(0xe1, exifPayload(orientation)),
    segment(0xe1, Buffer.from("http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>Rua X, 123</x:xmpmeta>", "latin1")),
    segment(0xed, Buffer.from("Photoshop 3.0\0IPTC autor", "latin1")),
    segment(0xfe, Buffer.from("comentário do aparelho", "utf8")),
    segment(0xdb, Buffer.alloc(65, 1)),
    segment(0xc0, sof),
    segment(0xda, Buffer.from([0x01, 0x01, 0x00, 0x00, 0x3f, 0x00])),
    Buffer.from([0x12, 0x34, 0x56, 0xff, 0x00, 0x78]),
    Buffer.from([0xff, 0xd9]),
  ])
}

describe("metadados fora da imagem (auditoria 17/10/2026, AUTH-11)", () => {
  it("JPEG: EXIF/GPS, XMP, IPTC e comentário saem; pixels, tabelas e tamanho ficam; a orientação volta num EXIF mínimo", () => {
    const original = jpeg(6)
    const clean = stripImageMetadata(original, "image/jpeg")
    const text = clean.toString("latin1")
    for (const leaked of ["GPS", "iPhone", "xmpmeta", "Rua X", "IPTC", "comentário"]) expect(text).not.toContain(leaked)
    expect(clean.subarray(-8).equals(original.subarray(-8))).toBe(true)
    expect(inspectImage(clean)).toEqual({ mimeType: "image/jpeg", width: 800, height: 600 })
    // EXIF mínimo logo depois do JFIF, só com Orientation = 6.
    const app1 = clean.indexOf(Buffer.from([0xff, 0xe1]))
    expect(app1).toBeGreaterThan(clean.indexOf(Buffer.from([0xff, 0xe0])))
    expect(clean.subarray(app1 + 4, app1 + 10).toString("latin1")).toBe("Exif\0\0")
    expect(clean.readUInt16BE(app1 + 10 + 18)).toBe(6)
    // Orientação normal: nenhum EXIF.
    expect(stripImageMetadata(jpeg(1), "image/jpeg").includes(Buffer.from("Exif", "latin1"))).toBe(false)
  })

  it("PNG: blocos de texto e eXIf saem; o resto fica igual", () => {
    const chunk = (type: string, data: Buffer) => {
      const length = Buffer.alloc(4)
      length.writeUInt32BE(data.length, 0)
      return Buffer.concat([length, Buffer.from(type, "latin1"), data, Buffer.alloc(4)])
    }
    const ihdr = Buffer.alloc(13)
    ihdr.writeUInt32BE(640, 0)
    ihdr.writeUInt32BE(200, 4)
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("tEXt", Buffer.from("Author\0Ana Lima", "latin1")), chunk("eXIf", Buffer.from("GPS")), chunk("IDAT", Buffer.from([1, 2, 3])), chunk("IEND", Buffer.alloc(0))])
    const clean = stripImageMetadata(png, "image/png")
    expect(clean.toString("latin1")).not.toContain("Ana Lima")
    expect(clean.toString("latin1")).not.toContain("eXIf")
    expect(clean.toString("latin1")).toContain("IDAT")
    expect(inspectImage(clean)).toEqual({ mimeType: "image/png", width: 640, height: 200 })
  })

  it("WebP: blocos EXIF/XMP saem, a marca do VP8X é desligada e o tamanho do RIFF é refeito", () => {
    const chunk = (type: string, data: Buffer) => {
      const size = Buffer.alloc(4)
      size.writeUInt32LE(data.length, 0)
      return Buffer.concat([Buffer.from(type, "latin1"), size, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)])
    }
    const vp8x = Buffer.alloc(10)
    vp8x[0] = 0x08 | 0x04
    vp8x.writeUIntLE(799, 4, 3)
    vp8x.writeUIntLE(199, 7, 3)
    const body = Buffer.concat([chunk("VP8X", vp8x), chunk("EXIF", Buffer.from("GPS -23.55")), chunk("XMP ", Buffer.from("<x/>")), chunk("VP8L", Buffer.from([0x2f, 0, 0, 0, 0]))])
    const header = Buffer.alloc(12)
    header.write("RIFF", 0, "latin1")
    header.writeUInt32LE(body.length + 4, 4)
    header.write("WEBP", 8, "latin1")
    const clean = stripImageMetadata(Buffer.concat([header, body]), "image/webp")
    expect(clean.toString("latin1")).not.toContain("GPS")
    expect(clean.toString("latin1")).not.toContain("XMP ")
    expect(clean[20]! & 0x0c).toBe(0)
    expect(clean.readUInt32LE(4)).toBe(clean.length - 8)
    expect(inspectImage(clean)).toEqual({ mimeType: "image/webp", width: 800, height: 200 })
  })

  it("JPEG com marcador sem tamanho (RST/TEM) antes do SOF: a validação aceita e o EXIF/GPS também sai (auditoria AppSec 29/10/2026)", () => {
    const original = jpeg(1)
    const withStandalone = Buffer.concat([original.subarray(0, 2), Buffer.from([0xff, 0xd0, 0xff, 0x01]), original.subarray(2)])
    expect(inspectImage(withStandalone)).toEqual({ mimeType: "image/jpeg", width: 800, height: 600 })
    const clean = stripImageMetadata(withStandalone, "image/jpeg")
    for (const leaked of ["GPS", "iPhone", "xmpmeta", "IPTC"]) expect(clean.toString("latin1")).not.toContain(leaked)
    expect(inspectImage(clean)).toEqual({ mimeType: "image/jpeg", width: 800, height: 600 })
  })

  it("estrutura inesperada volta igual (nada é cortado no escuro)", () => {
    const broken = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 0x00])
    expect(stripImageMetadata(broken, "image/jpeg").equals(broken)).toBe(true)
  })
})
