import { describe, expect, it } from "vitest"
import { buildFixturePdf, grayImage, PAGE_HEIGHT, PAGE_WIDTH, type FixtureOp } from "../testing/pdf-layout-fixture.js"
import { orientationOf, readPdfImages } from "./pdf-image-reader.js"
import { extractKnowledgeFile } from "./text-extractor.js"

const text = (y: number, value: string): FixtureOp => ({ kind: "text", x: 56, y, text: value })
const picture = (y: number, value: number, width = 200, height = 100): FixtureOp => ({ kind: "image", x: 56, y, width: 300, height: 150, image: grayImage(width, height, value) })
/** Só o cabeçalho de um JPEG, com o tamanho declarado: o pdf.js recusa pelo tamanho antes de decodificar. */
const tinyJpeg = (width: number, height: number) => Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00, 0xff, 0xd9])
const isWebp = (data: Buffer) => data.subarray(0, 4).toString("latin1") === "RIFF" && data.subarray(8, 12).toString("latin1") === "WEBP"

describe("imagens do PDF", () => {
  it("lê cada imagem com a posição na página e grava em WebP", async () => {
    const read = await readPdfImages(buildFixturePdf([[text(100, "Passo um."), picture(120, 90)]]))
    expect(read.files).toHaveLength(1)
    expect(isWebp(read.files[0]!.data)).toBe(true)
    expect(read.files[0]).toMatchObject({ mimeType: "image/webp", width: 200, height: 100 })
    expect(read.files[0]!.id).toMatch(/^[0-9a-f]{32}$/)
    expect(read.images[0]).toMatchObject({ page: 1, width: 200, height: 100 })
    expect(read.images[0]!.top).toBeCloseTo(120)
    expect(read.images[0]!.bottom).toBeCloseTo(270)
    expect(read.images[0]!.left).toBeCloseTo(56)
  })

  it("a mesma imagem em duas páginas é gravada uma vez e aparece nas duas", async () => {
    const image = grayImage(200, 100, 90)
    const op = (y: number): FixtureOp => ({ kind: "image", x: 56, y, width: 300, height: 150, image })
    const read = await readPdfImages(buildFixturePdf([[op(100)], [op(200)]]))
    expect(read.files).toHaveLength(1)
    expect(read.images.map((item) => item.page)).toEqual([1, 2])
  })

  it("ícone pequeno na página ou de poucos pixels não é conteúdo", async () => {
    const tiny: FixtureOp = { kind: "image", x: 56, y: 100, width: 12, height: 12, image: grayImage(100, 100, 40) }
    const fewPixels: FixtureOp = { kind: "image", x: 56, y: 200, width: 300, height: 150, image: grayImage(16, 16, 60) }
    expect((await readPdfImages(buildFixturePdf([[tiny, fewPixels]]))).images).toEqual([])
  })

  it("passou do limite por documento: conta as que ficaram de fora e guarda as outras", async () => {
    const read = await readPdfImages(buildFixturePdf([[picture(100, 10), picture(300, 20), picture(500, 30)]]), { maxImages: 2, maxBytes: 1_000_000 })
    expect(read.files).toHaveLength(2)
    expect(read.images).toHaveLength(2)
    expect(read.omitted).toBe(1)
  })

  it("imagem acima do limite de pixels não é decodificada e conta como de fora, para a tela avisar", async () => {
    const big: FixtureOp = { kind: "image", x: 56, y: 100, width: 400, height: 400, image: { format: "jpeg", data: tinyJpeg(6000, 5000), width: 6000, height: 5000 } }
    const read = await readPdfImages(buildFixturePdf([[text(60, "Texto."), big]]))
    expect(read.files).toEqual([])
    expect(read.omitted).toBe(1)
  })

  it("imagem que o arquivo guarda deitada sai de pé, como a página mostra", async () => {
    const turned: FixtureOp = { kind: "image", x: 56, y: 100, width: 150, height: 300, image: grayImage(200, 100, 90), turned: true }
    const read = await readPdfImages(buildFixturePdf([[turned]]))
    expect(read.files[0]).toMatchObject({ width: 100, height: 200 })
    expect(isWebp(read.files[0]!.data)).toBe(true)
  })

  it("orientação: o normal não mexe em nada; um quarto de volta troca os lados; imagem enorme é reduzida", () => {
    expect(orientationOf([300, 0, 0, -150, 56, 270], 200, 100, 1)).toBeNull()
    expect(orientationOf([0, 300, 150, 0, 56, 100], 200, 100, 1)).toEqual({ matrix: [0, 1, -1, 0, 100, 0], width: 100, height: 200 })
    expect(orientationOf([300, 0, 0, -150, 56, 270], 4800, 2400, 0.5)).toEqual({ matrix: [0.5, 0, 0, 0.5, 0, 0], width: 2400, height: 1200 })
  })
})

describe("extração do arquivo com imagens", () => {
  it("o texto é o mesmo do documento e as imagens vêm junto, só as que têm lugar", async () => {
    const pdf = buildFixturePdf([[text(100, "1. Abrir a tela."), picture(120, 90), text(300, "2. Salvar.")]])
    const result = await extractKnowledgeFile(pdf, "PDF")
    expect(result.text).toBe("1. Abrir a tela.\n2. Salvar.")
    expect(result.images).toHaveLength(1)
    expect(result.extraction!.images).toEqual([{ id: result.images[0]!.id, page: 1, offset: "1. Abrir a tela.".length, width: 200, height: 100 }])
  })

  it("documento sem imagens registra que foram lidas e não há nenhuma", async () => {
    const result = await extractKnowledgeFile(buildFixturePdf([[text(100, "Só texto aqui.")]]), "PDF")
    expect(result.images).toEqual([])
    expect(result.extraction!.images).toEqual([])
  })

  it("digitalizado, sem texto nenhum: não decodifica nada, porque a tela abre o próprio PDF", async () => {
    const result = await extractKnowledgeFile(buildFixturePdf([[{ kind: "image", x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, image: grayImage(400, 560, 200) }]]), "PDF")
    expect(result.text).toBe("")
    expect(result.images).toEqual([])
  })

  it("formatos que não são PDF não têm imagens nem páginas digitalizadas", async () => {
    expect(await extractKnowledgeFile(Buffer.from("Texto puro."), "TXT")).toEqual({ text: "Texto puro.", extraction: null, images: [], scannedPages: [] })
  })
})
