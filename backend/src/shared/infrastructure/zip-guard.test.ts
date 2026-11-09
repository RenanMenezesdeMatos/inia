import { once } from "node:events"
import { createDeflateRaw, deflateRawSync } from "node:zlib"
import { describe, expect, it } from "vitest"
import { inspectZip } from "./zip-guard.js"

const MB = 1024 * 1024

/** Entrada pelo conteúdo (compactado aqui, com o tamanho declarado opcional) ou já compactada, com o tamanho real. */
type ZipEntry = { name: string; content: Buffer; declaredSize?: number } | { name: string; compressed: Buffer; size: number }

/** Monta um ZIP mínimo (sem descritor de dados) com as entradas dadas — o bastante para o diretório central. */
function buildZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const compressed = "compressed" in entry ? entry.compressed : deflateRawSync(entry.content)
    const declared = "compressed" in entry ? entry.size : (entry.declaredSize ?? entry.content.length)
    const name = Buffer.from(entry.name)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(declared, 22)
    local.writeUInt16LE(name.length, 26)
    locals.push(local, name, compressed)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(declared, 24)
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

/** Aba de planilha legítima com `size` bytes descompactados, compactada em fluxo: o teste nunca tem o conteúdo inteiro na memória. */
async function largeSheetZip(size: number): Promise<Buffer> {
  const deflate = createDeflateRaw({ level: 1 })
  const parts: Buffer[] = []
  deflate.on("data", (part: Buffer) => parts.push(part))
  const ended = once(deflate, "end")
  let written = 0
  let row = 0
  while (written < size) {
    let text = ""
    while (text.length < 64 * 1024) {
      row += 1
      text += `<row r="${row}"><c t="s"><v>${row}</v></c></row>`
    }
    const block = Buffer.from(text).subarray(0, size - written)
    written += block.length
    if (!deflate.write(block)) await once(deflate, "drain")
  }
  deflate.end()
  await ended
  return buildZip([{ name: "[Content_Types].xml", content: Buffer.from("<Types/>") }, { name: "xl/worksheets/sheet1.xml", compressed: Buffer.concat(parts), size }])
}

describe("guarda de ZIP (XLSX/DOCX) — achados I-F11/A-F13", () => {
  it("aceita um pacote comum", async () => {
    const zip = buildZip([{ name: "[Content_Types].xml", content: Buffer.from("<Types/>") }, { name: "xl/workbook.xml", content: Buffer.from("<workbook/>".repeat(100)) }])
    expect(await inspectZip(zip)).toMatchObject({ ok: true, entries: 2 })
  })

  it("recusa zip bomb: compressão absurda e tamanho descompactado acima do teto", async () => {
    const bomb = buildZip([{ name: "xl/sheet1.xml", content: Buffer.alloc(20 * MB, 0x41) }])
    expect(await inspectZip(bomb)).toEqual({ ok: false, reason: "taxa de compressão suspeita" })
    const declaredHuge = buildZip([{ name: "a.xml", content: Buffer.from("x"), declaredSize: 400 * MB }])
    expect((await inspectZip(declaredHuge)).ok).toBe(false)
  })

  it("recusa o que não é ZIP ou tem diretório corrompido", async () => {
    expect(await inspectZip(Buffer.from("isto não é um zip"))).toEqual({ ok: false, reason: "pacote sem diretório central" })
    const zip = buildZip([{ name: "a.xml", content: Buffer.from("conteúdo") }])
    const corrupted = Buffer.from(zip)
    corrupted.writeUInt32LE(0xdeadbeef, corrupted.length - 22 - 46 - 5)
    expect((await inspectZip(corrupted)).ok).toBe(false)
  })
})

describe("guarda de ZIP — tamanho REAL de cada entrada (auditoria 17/10/2026, DATA-1)", () => {
  it("recusa entrada que declara 1 KB e descompacta 40 MB (o diretório central mente), sem descompactar além do declarado", async () => {
    const lying = buildZip([{ name: "[Content_Types].xml", content: Buffer.from("<Types/>") }, { name: "xl/sharedStrings.xml", content: Buffer.alloc(40 * MB, 0x30), declaredSize: 1000 }])
    const before = process.memoryUsage().rss
    expect(await inspectZip(lying)).toEqual({ ok: false, reason: "conteúdo descompactado maior que o declarado" })
    expect(process.memoryUsage().rss - before).toBeLessThan(30 * MB)
  })

  it("recusa imagem-bomba num DOCX (o parser de texto não a lê, mas a prévia leria)", async () => {
    const docx = buildZip([{ name: "word/document.xml", content: Buffer.from("<w:document>olá</w:document>") }, { name: "word/media/image1.png", content: Buffer.alloc(30 * MB, 0), declaredSize: 2048 }])
    expect((await inspectZip(docx)).ok).toBe(false)
  })

  it("recusa tamanho real MENOR que o declarado e entrada corrompida; pacote real continua aceito", async () => {
    expect(await inspectZip(buildZip([{ name: "a.xml", content: Buffer.from("conteúdo real"), declaredSize: 50 }]))).toEqual({ ok: false, reason: "tamanho real diferente do declarado" })
    const zip = buildZip([{ name: "a.xml", content: Buffer.from("conteúdo de verdade ".repeat(200)) }])
    const corrupted = Buffer.from(zip)
    const position = 30 + "a.xml".length + 2
    corrupted.writeUInt8(corrupted.readUInt8(position) ^ 0xff, position)
    expect((await inspectZip(corrupted)).ok).toBe(false)
    const sheet = Buffer.from(`<sheetData>${Array.from({ length: 20_000 }, (_, row) => `<row r="${row + 1}"><c t="s"><v>${row}</v></c></row>`).join("")}</sheetData>`)
    expect(await inspectZip(buildZip([{ name: "[Content_Types].xml", content: Buffer.from("<Types/>") }, { name: "xl/worksheets/sheet1.xml", content: sheet }]))).toMatchObject({ ok: true, entries: 2 })
  })

  it("pacote legítimo com entrada de 200 MB é conferido sem a memória do processo subir junto (a conferência descompacta em fluxo)", async () => {
    const zip = await largeSheetZip(200 * MB)
    const before = process.memoryUsage.rss()
    let peak = before
    const sampler = setInterval(() => {
      peak = Math.max(peak, process.memoryUsage.rss())
    }, 5)
    try {
      expect(await inspectZip(zip)).toMatchObject({ ok: true, entries: 2, totalUncompressedBytes: 200 * MB + "<Types/>".length })
    } finally {
      clearInterval(sampler)
    }
    // Antes a conferência guardava a entrada inteira: +200 MB aqui.
    expect(Math.max(peak, process.memoryUsage.rss()) - before).toBeLessThan(100 * MB)
  })
})

/** Partes de uma entrada (registro local + registro central apontando para `offset`), para montar layouts fora do padrão. */
function entryParts(entry: { name: string; content: Buffer; declaredSize?: number }, offset: number): { local: Buffer; central: Buffer } {
  const zip = buildZip([entry])
  const localLength = 30 + entry.name.length + zip.readUInt32LE(18)
  const central = Buffer.from(zip.subarray(localLength, zip.length - 22))
  central.writeUInt32LE(offset, 42)
  return { local: zip.subarray(0, localLength), central }
}

function endRecord(fields: { disk?: number; onDisk: number; total: number; size: number; offset: number; commentLength?: number }): Buffer {
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(fields.disk ?? 0, 4)
  end.writeUInt16LE(fields.onDisk, 8)
  end.writeUInt16LE(fields.total, 10)
  end.writeUInt32LE(fields.size, 12)
  end.writeUInt32LE(fields.offset, 16)
  end.writeUInt16LE(fields.commentLength ?? 0, 20)
  return end
}

describe("guarda de ZIP — lê o MESMO diretório que o JSZip dos parsers (achado N04 da 4ª auditoria)", () => {
  // Entrada que declara 16 bytes e descompacta 16 KiB: recusada quando a guarda a enxerga.
  const lying = { name: "xl/sharedStrings.xml", content: Buffer.alloc(16 * 1024, 0x30), declaredSize: 16 }
  const types = { name: "[Content_Types].xml", content: Buffer.from("<Types/>") }

  it("registro além da contagem do fim do diretório (o JSZip continuaria lendo) é recusado", async () => {
    const a = entryParts(types, 0)
    const b = entryParts(lying, a.local.length)
    const directory = Buffer.concat([a.central, b.central])
    const zip = Buffer.concat([a.local, b.local, directory, endRecord({ onDisk: 1, total: 1, size: directory.length, offset: a.local.length + b.local.length })])
    expect(await inspectZip(zip)).toEqual({ ok: false, reason: "diretório central com registros não contados" })
  })

  it("campo de disco 0xFFFF (o JSZip troca para ZIP64 e lê outro diretório) e registro ZIP64 antes do fim são recusados", async () => {
    const plain = buildZip([types])
    const multiVolume = Buffer.from(plain)
    multiVolume.writeUInt16LE(0xffff, plain.length - 22 + 4)
    expect(await inspectZip(multiVolume)).toEqual({ ok: false, reason: "pacote em vários volumes ou com contagem inconsistente" })
    const a = entryParts(types, 0)
    const b = entryParts(lying, a.local.length)
    const z64Offset = a.local.length + b.local.length + a.central.length + b.central.length
    const z64 = Buffer.alloc(56)
    z64.writeUInt32LE(0x06064b50, 0)
    z64.writeBigUInt64LE(44n, 4)
    z64.writeBigUInt64LE(1n, 24)
    z64.writeBigUInt64LE(1n, 32)
    z64.writeBigUInt64LE(BigInt(b.central.length), 40)
    z64.writeBigUInt64LE(BigInt(a.local.length + b.local.length + a.central.length), 48)
    const locator = Buffer.alloc(20)
    locator.writeUInt32LE(0x07064b50, 0)
    locator.writeBigUInt64LE(BigInt(z64Offset), 8)
    locator.writeUInt32LE(1, 16)
    const zip64 = Buffer.concat([a.local, b.local, a.central, b.central, z64, locator, endRecord({ disk: 0xffff, onDisk: 1, total: 1, size: a.central.length, offset: a.local.length + b.local.length })])
    expect(await inspectZip(zip64)).toEqual({ ok: false, reason: "pacote ZIP64 (grande demais para um documento)" })
  })

  it("vão entre o diretório e o fim (o JSZip reposiciona tudo e lê outro diretório) é recusado", async () => {
    const a = entryParts({ name: "docProps/app.xml", content: Buffer.from("<Properties/>".repeat(20)) }, 0)
    const b = entryParts(lying, a.local.length + a.central.length)
    const zip = Buffer.concat([a.local, a.central, b.local, b.central, endRecord({ onDisk: 1, total: 1, size: b.central.length, offset: a.local.length })])
    expect(await inspectZip(zip)).toEqual({ ok: false, reason: "diretório central fora do lugar" })
  })

  it("fim do arquivo incoerente com o comentário e nome repetido são recusados; comentário de verdade continua aceito", async () => {
    const plain = buildZip([types])
    expect(await inspectZip(Buffer.concat([plain, Buffer.from("lixo depois do fim")]))).toEqual({ ok: false, reason: "fim do pacote inconsistente" })
    const commented = Buffer.from(plain)
    commented.writeUInt16LE(11, plain.length - 22 + 20)
    expect(await inspectZip(Buffer.concat([commented, Buffer.from("comentário")]))).toMatchObject({ ok: true, entries: 1 })
    expect(await inspectZip(buildZip([types, { name: "xl/workbook.xml", content: Buffer.from("<a/>") }, { name: "xl/workbook.xml", content: Buffer.from("<b/>") }]))).toEqual({ ok: false, reason: "entrada com nome repetido" })
  })

  it("planilha de verdade (exceljs, o mesmo JSZip) continua aceita", async () => {
    const { default: ExcelJS } = await import("exceljs")
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet("Dados")
    sheet.addRow(["matrícula", "nome", "valor"])
    for (let row = 0; row < 500; row += 1) sheet.addRow([`M${row}`, `Pessoa ${row}`, row * 1.5])
    expect(await inspectZip(Buffer.from(await workbook.xlsx.writeBuffer()))).toMatchObject({ ok: true })
  })
})
