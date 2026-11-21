/**
 * Validação do OCR de PDF em qualquer lote de arquivos, sem IA, sem banco e sem custo. Roda o MESMO leitor do servidor (`readScannedPages`, as duas
 * passadas, a escolha entre a regra da tinta e a posição das imagens, as conferências por página) e mostra o que ele fez, de três jeitos:
 *
 *  - `producao`:     o arquivo como chegou; só as páginas sem camada de texto, como no envio. Sem gabarito: serve para olhar (imagens marcadas,
 *                    texto, páginas a conferir). É o modo para um PDF que deu errado, como a IT do Vantive de 20/11/2026.
 *  - `objetos`:      PDF com camada de texto lido como se não tivesse (todas as páginas pelo OCR): o texto vetorial é desenhado e as imagens ficam
 *                    como imagens do PDF, como no "Print To PDF". Gabarito: as palavras e as imagens do próprio arquivo.
 *  - `digitalizado`: cada página vira uma imagem do tamanho da página (com papel tingido e ruído leve, como scanner) e o PDF é montado de novo, sem
 *                    texto. Os prints ficam DENTRO da imagem, e só a regra da tinta pode achá-los. Mesmo gabarito, escalado.
 *
 *   npx tsx scripts/dev/pdf-ocr-eval/validar-ocr.ts <pasta-de-saída> <pdf-ou-pasta>... [--modos=producao,objetos,digitalizado] [--max-paginas=20]
 *
 * Saída: `relatorio.md` e `resultado.json` com as notas por documento e modo, e, para cada página, `<doc>/<modo>/p<N>.png` (vermelho = cortado como
 * print, verde = imagem de verdade, laranja = faixa que a conferência apontou) e `<doc>/<modo>/texto.md` (o Markdown que a base receberia).
 *
 * A falha grave é `realWordsCut` (texto do documento cortado como print e tirado do texto). Print não achado vira texto com lixo e aparece em
 * `extraWords` e nas conferências.
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { basename, extname, join } from "node:path"
import { createCanvas, loadImage } from "@napi-rs/canvas"
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs"
import { classifyScannedPage, PDF_EMBEDDED_PRINT_RULE } from "../../../src/modules/knowledge/domain/pdf-ocr/embedded-prints.js"
import { wordsOf, type OcrBox } from "../../../src/modules/knowledge/domain/pdf-ocr/hocr.js"
import { PDF_OCR_CHECKS } from "../../../src/modules/knowledge/domain/pdf-ocr/ocr-page-checks.js"
import { ocrPageLayouts } from "../../../src/modules/knowledge/domain/pdf-ocr/ocr-layout.js"
import { inkBands, PDF_PRINT_RULE } from "../../../src/modules/knowledge/domain/pdf-ocr/print-regions.js"
import { pdfLayoutToMarkdown } from "../../../src/modules/knowledge/domain/pdf-markdown/pdf-markdown.js"
import { createOcrEngine } from "../../../src/modules/knowledge/infrastructure/pdf-ocr/ocr-engine.js"
import { readScannedPages, type OcrReadResult } from "../../../src/modules/knowledge/infrastructure/pdf-ocr/pdf-ocr-reader.js"
import { openRasterDocument, placementsOf } from "../../../src/modules/knowledge/infrastructure/pdf-ocr/pdf-page-raster.js"
import { extractKnowledgeFile } from "../../../src/modules/knowledge/infrastructure/text-extractor.js"
import { buildFixturePdf, PAGE_HEIGHT, PAGE_WIDTH, type FixturePage } from "../../../src/modules/knowledge/testing/pdf-layout-fixture.js"
import { scorePage, sumScores, type PageScore, type TruthWord } from "./score.js"

type Mode = "producao" | "objetos" | "digitalizado"
type Truth = { words: TruthWord[]; images: OcrBox[]; width: number; height: number }
type PageReport = { page: number; source: string; prints: number; reviews: string[]; score: PageScore | null }
type ModeReport = { doc: string; mode: Mode; pages: PageReport[]; total: PageScore | null; seconds: number; note?: string }

const args = process.argv.slice(2)
const flags = Object.fromEntries(args.filter((arg) => arg.startsWith("--")).map((arg) => arg.slice(2).split("=") as [string, string]))
const [output, ...inputs] = args.filter((arg) => !arg.startsWith("--"))
if (!output || inputs.length === 0) {
  console.error("Uso: validar-ocr.ts <pasta-de-saída> <pdf-ou-pasta>... [--modos=producao,objetos,digitalizado] [--max-paginas=20]")
  process.exit(2)
}
const modes = (flags.modos ?? "producao,objetos,digitalizado").split(",") as Mode[]
const maxPages = Number(flags["max-paginas"] ?? 20)

const files = inputs.flatMap((input) => (statSync(input).isDirectory() ? readdirSync(input).filter((file) => extname(file).toLowerCase() === ".pdf").sort().map((file) => join(input, file)) : [input]))
const slug = (file: string) => basename(file, extname(file)).normalize("NFD").replace(/\p{M}/gu, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60)

/** O gabarito de cada página: palavras da camada de texto, com a posição dividida pelo número de letras, e as imagens de conteúdo do PDF. */
async function truthOf(buffer: Buffer, limit: number): Promise<Truth[]> {
  const document = await getDocument({ data: new Uint8Array(buffer), verbosity: 0, isEvalSupported: false }).promise
  const truths: Truth[] = []
  try {
    for (let number = 1; number <= Math.min(document.numPages, limit); number += 1) {
      const page = await document.getPage(number)
      const viewport = page.getViewport({ scale: 1 })
      const content = await page.getTextContent()
      const words: TruthWord[] = []
      for (const item of content.items) {
        if (!("str" in item) || !item.str.trim()) continue
        const [, , , , e, f] = item.transform as number[]
        const height = Math.abs(item.height) || Math.abs((item.transform as number[])[3]!)
        const top = viewport.height - f! - height
        const perChar = item.width / Math.max(1, item.str.length)
        let offset = 0
        for (const piece of item.str.split(/(\s+)/)) {
          if (piece.trim()) words.push({ text: piece, left: e! + offset * perChar, right: e! + (offset + piece.length) * perChar, top, bottom: top + height })
          offset += piece.length
        }
      }
      // Página com operações ou imagens demais não é lida pelas imagens (regra V2): o gabarito de prints dela fica vazio, como no produto.
      const placements = await placementsOf(page)
      const classified = placements ? classifyScannedPage(placements, viewport.width, viewport.height) : { source: "SCAN" as const, prints: [] }
      truths.push({ words, images: classified.source === "SCAN" ? [] : classified.prints, width: viewport.width, height: viewport.height })
      page.cleanup()
    }
  } finally {
    await document.destroy()
  }
  return truths
}

/** Cada página desenhada em cinza, com papel tingido e ruído leve (semente fixa), num PDF novo só de imagens. */
async function simulateScan(buffer: Buffer, limit: number): Promise<Buffer> {
  const source = await openRasterDocument(buffer)
  const pages: FixturePage[] = []
  let seed = 7
  const random = () => ((seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff) / 0x7fffffff)
  try {
    for (let number = 1; number <= Math.min(source.pageCount, limit); number += 1) {
      const rendered = await source.render(number)
      const rgba = rendered.pixels()
      const gray = Buffer.alloc(rendered.pixelWidth * rendered.pixelHeight)
      for (let pixel = 0; pixel < gray.length; pixel += 1) {
        const value = (rgba[pixel * 4]! + rgba[pixel * 4 + 1]! + rgba[pixel * 4 + 2]!) / 3
        gray[pixel] = Math.max(0, Math.min(255, Math.round(value * 0.95 + (random() - 0.5) * 18)))
      }
      pages.push([{ kind: "image", x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, image: { format: "gray", pixels: gray, width: rendered.pixelWidth, height: rendered.pixelHeight } }])
      rendered.release()
    }
  } finally {
    await source.close()
  }
  return buildFixturePdf(pages)
}

const scaleTruth = (truth: Truth): Truth => {
  const sx = PAGE_WIDTH / truth.width
  const sy = PAGE_HEIGHT / truth.height
  const scale = <T extends OcrBox>(box: T): T => ({ ...box, left: box.left * sx, right: box.right * sx, top: box.top * sy, bottom: box.bottom * sy })
  return { words: truth.words.map(scale), images: truth.images.map(scale), width: PAGE_WIDTH, height: PAGE_HEIGHT }
}

async function drawPages(buffer: Buffer, result: OcrReadResult, truths: Truth[] | null, folder: string) {
  const document = await openRasterDocument(buffer)
  try {
    for (const page of result.pages) {
      const rendered = await document.render(page.page)
      const bands = inkBands(rendered.pixels(), rendered.pixelWidth, rendered.pixelHeight, rendered.scale)
      const image = await loadImage(await rendered.png())
      const canvas = createCanvas(image.width, image.height)
      const context = canvas.getContext("2d")
      context.drawImage(image, 0, 0)
      const box = (b: OcrBox, color: string, width: number) => {
        context.strokeStyle = color
        context.lineWidth = width
        context.strokeRect(b.left * rendered.scale, b.top * rendered.scale, (b.right - b.left) * rendered.scale, (b.bottom - b.top) * rendered.scale)
      }
      for (const truth of truths?.[page.page - 1]?.images ?? []) box(truth, "rgba(0,160,60,0.9)", 10)
      for (const print of page.prints) box(print, "rgba(220,0,0,0.95)", 5)
      const review = result.reviews.find((entry) => entry.page === page.page)
      if (review) for (const band of bands) if (!page.prints.some((print) => band.top < print.bottom && band.bottom > print.top)) box(band, "rgba(255,140,0,0.6)", 3)
      context.fillStyle = "rgba(0,0,0,0.75)"
      context.fillRect(0, 0, canvas.width, 44)
      context.fillStyle = "#fff"
      context.font = "28px sans-serif"
      context.fillText(`p${page.page} · ${page.source} · ${page.prints.length} print(s)${review ? ` · conferir: ${review.reasons.join(", ")}` : ""}`, 12, 32)
      writeFileSync(join(folder, `p${page.page}.png`), await canvas.encode("png"))
      rendered.release()
    }
  } finally {
    await document.close()
  }
}

async function runMode(doc: string, mode: Mode, original: Buffer, engine: ReturnType<typeof createOcrEngine>, truths: Truth[] | null): Promise<ModeReport> {
  const started = performance.now()
  let buffer = original
  let pages: number[]
  let modeTruths = truths
  if (mode === "producao") {
    pages = (await extractKnowledgeFile(original, "PDF")).scannedPages ?? []
    modeTruths = null
    if (pages.length === 0) return { doc, mode, pages: [], total: null, seconds: 0, note: "todas as páginas têm camada de texto: o OCR não roda neste arquivo" }
  } else {
    if (!truths || truths.every((truth) => truth.words.length === 0)) return { doc, mode, pages: [], total: null, seconds: 0, note: "sem camada de texto: não há gabarito" }
    pages = truths.map((_, index) => index + 1)
    if (mode === "digitalizado") {
      buffer = await simulateScan(original, maxPages)
      modeTruths = truths.map(scaleTruth)
    }
  }
  pages = pages.filter((page) => page <= maxPages)
  const result = await readScannedPages(buffer, pages, engine)
  const folder = join(output!, doc, mode)
  mkdirSync(folder, { recursive: true })
  const { markdown } = pdfLayoutToMarkdown(ocrPageLayouts(result.pages), { images: result.images, omitted: result.imagesOmitted })
  writeFileSync(join(folder, "texto.md"), markdown)
  await drawPages(buffer, result, modeTruths, folder)
  const reports: PageReport[] = result.pages.map((page) => {
    const truth = modeTruths?.[page.page - 1]
    const read = wordsOf({ lines: page.lines.map((line) => ({ ...line, words: line.words.filter((word) => !page.prints.some((print) => (word.left + word.right) / 2 >= print.left && (word.left + word.right) / 2 <= print.right && (word.top + word.bottom) / 2 >= print.top && (word.top + word.bottom) / 2 <= print.bottom)) })) })
    return { page: page.page, source: page.source, prints: page.prints.length, reviews: result.reviews.find((entry) => entry.page === page.page)?.reasons ?? [], score: truth ? scorePage(truth.words, truth.images, read, page.prints) : null }
  })
  const scored = reports.flatMap((report) => (report.score ? [report.score] : []))
  return { doc, mode, pages: reports, total: scored.length > 0 ? sumScores(scored) : null, seconds: (performance.now() - started) / 1000 }
}

const pct = (part: number, whole: number) => (whole > 0 ? `${((100 * part) / whole).toFixed(1)}%` : "—")

function markdownReport(reports: ModeReport[]): string {
  const lines = [
    `# Validação do OCR de PDF`,
    ``,
    `Regras: ${PDF_PRINT_RULE.version} (digitalização), ${PDF_EMBEDDED_PRINT_RULE.version} (imagens do PDF), conferências ${PDF_OCR_CHECKS.version}. Gerado em ${new Date().toISOString()}.`,
    ``,
    `| Documento | Modo | Páginas | Origem dos prints | Palavras lidas | Acentos | Texto real cortado | Palavras a mais | Prints achados | Cortes errados | Páginas a conferir | Tempo |`,
    `| --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |`,
  ]
  for (const report of reports) {
    if (report.note) {
      lines.push(`| ${report.doc} | ${report.mode} | — | ${report.note} | | | | | | | | |`)
      continue
    }
    const sources = Object.entries(report.pages.reduce<Record<string, number>>((acc, page) => ({ ...acc, [page.source]: (acc[page.source] ?? 0) + 1 }), {})).map(([source, count]) => `${source} ${count}`).join(", ")
    const review = report.pages.filter((page) => page.reviews.length > 0).map((page) => `p${page.page} (${page.reviews.join("+")})`).join(", ") || "nenhuma"
    const t = report.total
    lines.push(`| ${report.doc} | ${report.mode} | ${report.pages.length} | ${sources} | ${t ? `${t.wordsRead}/${t.truthWords} (${pct(t.wordsRead, t.truthWords)})` : "—"} | ${t ? `${t.accentsRight}/${t.accentedTruth}` : "—"} | ${t ? t.realWordsCut : "—"} | ${t ? t.extraWords : "—"} | ${t ? `${t.printsFound}/${t.truthPrints}` : `${report.pages.reduce((sum, page) => sum + page.prints, 0)} cortados`} | ${t ? t.falsePrints : "—"} | ${review} | ${report.seconds.toFixed(0)} s |`)
  }
  const graves = reports.filter((report) => (report.total?.realWordsCut ?? 0) > 0)
  lines.push("", graves.length > 0 ? `**Atenção:** texto real cortado como print em ${graves.map((report) => `${report.doc} (${report.mode}: ${report.total!.realWordsCut})`).join(", ")}. Abra as imagens das páginas.` : "Nenhum texto real cortado como print nos documentos com gabarito.")
  return lines.join("\n") + "\n"
}

async function main() {
  mkdirSync(output!, { recursive: true })
  const engine = createOcrEngine()
  const reports: ModeReport[] = []
  try {
    for (const file of files) {
      const doc = slug(file)
      const buffer = readFileSync(file)
      const truths = modes.some((mode) => mode !== "producao") ? await truthOf(buffer, maxPages) : null
      for (const mode of modes) {
        process.stdout.write(`${doc} · ${mode}… `)
        const report = await runMode(doc, mode, buffer, engine, truths)
        reports.push(report)
        console.log(report.note ?? `${report.pages.length} páginas, ${report.seconds.toFixed(0)} s${report.total ? `, cortado ${report.total.realWordsCut}, prints ${report.total.printsFound}/${report.total.truthPrints}` : ""}`)
      }
      writeFileSync(join(output!, "resultado.json"), JSON.stringify(reports, null, 2))
      writeFileSync(join(output!, "relatorio.md"), markdownReport(reports))
    }
  } finally {
    await engine.close()
  }
  console.log(`\nRelatório: ${join(output!, "relatorio.md")}`)
}

await main()
process.exit(0)
