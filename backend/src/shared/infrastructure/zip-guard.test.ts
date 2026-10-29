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

describe("guarda de ZIP — tamanho REAL de cada entrada (auditoria 17/10/2026, DATA-1)", () => {
  it("recusa entrada que declara 1 KB e descompacta 40 MB (o diretório central mente), sem descompactar além do declarado", () => {
    const lying = buildZip([{ name: "[Content_Types].xml", content: Buffer.from("<Types/>") }, { name: "xl/sharedStrings.xml", content: Buffer.alloc(40 * 1024 * 1024, 0x30), declaredSize: 1000 }])
    const before = process.memoryUsage().rss
    expect(inspectZip(lying)).toEqual({ ok: false, reason: "conteúdo descompactado maior que o declarado" })
    expect(process.memoryUsage().rss - before).toBeLessThan(30 * 1024 * 1024)
  })

  it("recusa imagem-bomba num DOCX (o parser de texto não a lê, mas a prévia leria)", () => {
    const docx = buildZip([{ name: "word/document.xml", content: Buffer.from("<w:document>olá</w:document>") }, { name: "word/media/image1.png", content: Buffer.alloc(30 * 1024 * 1024, 0), declaredSize: 2048 }])
    expect(inspectZip(docx).ok).toBe(false)
  })

  it("recusa tamanho real MENOR que o declarado e entrada corrompida; pacote real continua aceito", () => {
    expect(inspectZip(buildZip([{ name: "a.xml", content: Buffer.from("conteúdo real"), declaredSize: 50 }]))).toEqual({ ok: false, reason: "tamanho real diferente do declarado" })
    const zip = buildZip([{ name: "a.xml", content: Buffer.from("conteúdo de verdade ".repeat(200)) }])
    const corrupted = Buffer.from(zip)
    const position = 30 + "a.xml".length + 2
    corrupted.writeUInt8(corrupted.readUInt8(position) ^ 0xff, position)
    expect(inspectZip(corrupted).ok).toBe(false)
    const sheet = Buffer.from(`<sheetData>${Array.from({ length: 20_000 }, (_, row) => `<row r="${row + 1}"><c t="s"><v>${row}</v></c></row>`).join("")}</sheetData>`)
    expect(inspectZip(buildZip([{ name: "[Content_Types].xml", content: Buffer.from("<Types/>") }, { name: "xl/worksheets/sheet1.xml", content: sheet }]))).toMatchObject({ ok: true, entries: 2 })
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

  it("registro além da contagem do fim do diretório (o JSZip continuaria lendo) é recusado", () => {
    const a = entryParts(types, 0)
    const b = entryParts(lying, a.local.length)
    const directory = Buffer.concat([a.central, b.central])
    const zip = Buffer.concat([a.local, b.local, directory, endRecord({ onDisk: 1, total: 1, size: directory.length, offset: a.local.length + b.local.length })])
    expect(inspectZip(zip)).toEqual({ ok: false, reason: "diretório central com registros não contados" })
  })

  it("campo de disco 0xFFFF (o JSZip troca para ZIP64 e lê outro diretório) e registro ZIP64 antes do fim são recusados", () => {
    const plain = buildZip([types])
    const multiVolume = Buffer.from(plain)
    multiVolume.writeUInt16LE(0xffff, plain.length - 22 + 4)
    expect(inspectZip(multiVolume)).toEqual({ ok: false, reason: "pacote em vários volumes ou com contagem inconsistente" })
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
    expect(inspectZip(zip64)).toEqual({ ok: false, reason: "pacote ZIP64 (grande demais para um documento)" })
  })

  it("vão entre o diretório e o fim (o JSZip reposiciona tudo e lê outro diretório) é recusado", () => {
    const a = entryParts({ name: "docProps/app.xml", content: Buffer.from("<Properties/>".repeat(20)) }, 0)
    const b = entryParts(lying, a.local.length + a.central.length)
    const zip = Buffer.concat([a.local, a.central, b.local, b.central, endRecord({ onDisk: 1, total: 1, size: b.central.length, offset: a.local.length })])
    expect(inspectZip(zip)).toEqual({ ok: false, reason: "diretório central fora do lugar" })
  })

  it("fim do arquivo incoerente com o comentário e nome repetido são recusados; comentário de verdade continua aceito", () => {
    const plain = buildZip([types])
    expect(inspectZip(Buffer.concat([plain, Buffer.from("lixo depois do fim")]))).toEqual({ ok: false, reason: "fim do pacote inconsistente" })
    const commented = Buffer.from(plain)
    commented.writeUInt16LE(11, plain.length - 22 + 20)
    expect(inspectZip(Buffer.concat([commented, Buffer.from("comentário")]))).toMatchObject({ ok: true, entries: 1 })
    expect(inspectZip(buildZip([types, { name: "xl/workbook.xml", content: Buffer.from("<a/>") }, { name: "xl/workbook.xml", content: Buffer.from("<b/>") }]))).toEqual({ ok: false, reason: "entrada com nome repetido" })
  })

  it("planilha de verdade (exceljs, o mesmo JSZip) continua aceita", async () => {
    const { default: ExcelJS } = await import("exceljs")
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet("Dados")
    sheet.addRow(["matrícula", "nome", "valor"])
    for (let row = 0; row < 500; row += 1) sheet.addRow([`M${row}`, `Pessoa ${row}`, row * 1.5])
    expect(inspectZip(Buffer.from(await workbook.xlsx.writeBuffer()))).toMatchObject({ ok: true })
  })
})
