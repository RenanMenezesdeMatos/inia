import { deflateRawSync } from "node:zlib"
import { describe, expect, it } from "vitest"
import { inspectZip } from "./zip-guard.js"

/** Monta um ZIP mínimo (sem descritor de dados) com as entradas dadas — o bastante para o diretório central. */
function buildZip(entries: { name: string; content: Buffer; declaredSize?: number }[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const compressed = deflateRawSync(entry.content)
    const name = Buffer.from(entry.name)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(entry.declaredSize ?? entry.content.length, 22)
    local.writeUInt16LE(name.length, 26)
    locals.push(local, name, compressed)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(entry.declaredSize ?? entry.content.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)
    offset += 30 + name.length + compressed.length
  }
  const centralDirectory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralDirectory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, centralDirectory, end])
}

describe("guarda de ZIP (XLSX/DOCX) — achados I-F11/A-F13", () => {
  it("aceita um pacote comum", () => {
    const zip = buildZip([{ name: "[Content_Types].xml", content: Buffer.from("<Types/>") }, { name: "xl/workbook.xml", content: Buffer.from("<workbook/>".repeat(100)) }])
    expect(inspectZip(zip)).toMatchObject({ ok: true, entries: 2 })
  })

  it("recusa zip bomb: compressão absurda e tamanho descompactado acima do teto", () => {
    const bomb = buildZip([{ name: "xl/sheet1.xml", content: Buffer.alloc(20 * 1024 * 1024, 0x41) }])
    expect(inspectZip(bomb)).toEqual({ ok: false, reason: "taxa de compressão suspeita" })
    const declaredHuge = buildZip([{ name: "a.xml", content: Buffer.from("x"), declaredSize: 400 * 1024 * 1024 }])
    expect(inspectZip(declaredHuge).ok).toBe(false)
  })

  it("recusa o que não é ZIP ou tem diretório corrompido", () => {
    expect(inspectZip(Buffer.from("isto não é um zip"))).toEqual({ ok: false, reason: "pacote sem diretório central" })
    const zip = buildZip([{ name: "a.xml", content: Buffer.from("conteúdo") }])
    const corrupted = Buffer.from(zip)
    corrupted.writeUInt32LE(0xdeadbeef, corrupted.length - 22 - 46 - 5)
    expect(inspectZip(corrupted).ok).toBe(false)
  })
})
