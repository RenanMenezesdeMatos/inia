/**
 * Gera os PDFs da medição em `OUT_DIR` (padrão: pasta temporária informada). Só usa o que já existe no projeto: o escritor de PDF de
 * teste, o `pdf-parse` e o `@napi-rs/canvas` que ele traz (para transformar páginas em imagem) e, se houver na máquina, o Google Chrome
 * para os PDFs de navegador. Nada disso entra no servidor: é só para fabricar arquivos de teste.
 *
 *   npx tsx scripts/dev/pdf-markdown-eval/generate-corpus.ts <pasta>
 */
import { execFileSync, spawn } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createCanvas, loadImage } from "@napi-rs/canvas"
import { PDFParse } from "pdf-parse"
import { duasColunasPages, manualTabelasPages, mistoPages, pdfOf, scannedPages, simplesPages } from "./corpus.js"
import { grayImage, paragraph, PAGE_WIDTH, type FixtureImage, type FixturePage } from "../../../src/modules/knowledge/testing/pdf-layout-fixture.js"

const here = dirname(fileURLToPath(import.meta.url))
const repository = resolve(here, "../../../..")
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

async function jpegPages(pdf: Buffer): Promise<FixtureImage[]> {
  const parser = new PDFParse({ data: new Uint8Array(pdf) })
  try {
    const shots = await parser.getScreenshot({ desiredWidth: 1000, imageDataUrl: false, imageBuffer: true })
    const images: FixtureImage[] = []
    for (const shot of shots.pages) {
      const image = await loadImage(Buffer.from(shot.data))
      const canvas = createCanvas(image.width, image.height)
      canvas.getContext("2d").drawImage(image, 0, 0)
      images.push({ format: "jpeg", data: canvas.toBuffer("image/jpeg", 70), width: image.width, height: image.height })
    }
    return images
  } finally {
    await parser.destroy()
  }
}

/** Regulamento que só existe como imagem: o dado do gabarito E1 fica fora do alcance de qualquer leitura de texto. */
function regulamentoPages(): FixturePage[] {
  const title = paragraph("Regulamento de devolução de equipamentos", { x: 56, y: 90, width: PAGE_WIDTH - 112, size: 18, font: "bold" })
  const body = paragraph("A devolução atrasada de equipamento gera multa de R$ 210,00 por item, cobrada na fatura seguinte ao fim do prazo de 30 dias corridos. O cliente pode contestar a multa em até 10 dias úteis com o comprovante de postagem.", { x: 56, y: title.y + 20, width: PAGE_WIDTH - 112 })
  return [[...title.ops, ...body.ops]]
}

/** O Chrome só desliga as tags pelo protocolo de depuração (`generateTaggedPDF`). Usa o WebSocket nativo do Node. */
async function printWithoutTags(url: string): Promise<Buffer> {
  const port = 9400 + Math.floor(Math.random() * 400)
  const profile = mkdtempSync(join(tmpdir(), "pdf-corpus-"))
  const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, url], { stdio: "ignore" })
  try {
    let target: { webSocketDebuggerUrl: string; type: string } | undefined
    for (let attempt = 0; attempt < 50 && !target; attempt += 1) {
      await new Promise((done) => setTimeout(done, 200))
      target = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json() as Promise<{ webSocketDebuggerUrl: string; type: string }[]>).then((list) => list.find((entry) => entry.type === "page")).catch(() => undefined)
    }
    if (!target) throw new Error("Chrome não respondeu.")
    const socket = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((done, fail) => {
      socket.onopen = done
      socket.onerror = fail
    })
    const result = await new Promise<string>((done, fail) => {
      socket.onmessage = (event) => {
        const message = JSON.parse(String(event.data)) as { id?: number; result?: { data: string }; error?: unknown }
        if (message.id !== 1) return
        if (message.result) done(message.result.data)
        else fail(new Error(JSON.stringify(message.error)))
      }
      socket.send(JSON.stringify({ id: 1, method: "Page.printToPDF", params: { generateTaggedPDF: false, printBackground: false, displayHeaderFooter: false } }))
    })
    socket.close()
    return Buffer.from(result, "base64")
  } finally {
    const closed = new Promise((done) => chrome.once("exit", done))
    chrome.kill()
    await closed
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
}

async function main() {
  const out = process.argv[2]
  if (!out) throw new Error("Informe a pasta de saída.")
  mkdirSync(out, { recursive: true })
  const write = (name: string, data: Buffer) => writeFileSync(join(out, `${name}.pdf`), data)
  write("simples", pdfOf(simplesPages()))
  write("manual-tabelas", pdfOf(manualTabelasPages()))
  write("duas-colunas-coluna", pdfOf(duasColunasPages("column")))
  write("duas-colunas-linha", pdfOf(duasColunasPages("row")))
  const regulamento = await jpegPages(pdfOf(regulamentoPages()))
  write("escaneado", pdfOf(scannedPages(regulamento)))
  write("misto", pdfOf(mistoPages(regulamento[0]!, grayImage(120, 80))))
  // Pior caso de tempo: 40 páginas digitalizadas, cada uma com a própria imagem JPEG.
  const scanned = await jpegPages(pdfOf(simplesPages()))
  write("escaneado-40-paginas", pdfOf(scannedPages(Array.from({ length: 40 }, (_, index) => ({ ...scanned[index % scanned.length]! })))))

  const html = join(here, "chrome-corpus.html")
  if (existsSync(CHROME)) {
    const print = (name: string, extra: string[]) => execFileSync(CHROME, ["--headless=new", "--disable-gpu", "--no-pdf-header-footer", ...extra, `--print-to-pdf=${join(out, `${name}.pdf`)}`, `file://${html}`], { stdio: "ignore" })
    print("manual-chrome-tags", [])
    writeFileSync(join(out, "manual-chrome-sem-tags.pdf"), await printWithoutTags(`file://${html}`))
  } else {
    console.log("Chrome não encontrado: PDFs de navegador não gerados.")
  }
  // Manuais do próprio projeto (só para extração e busca; não vão para a IA).
  for (const [name, file] of [["it-013", "IT-INIA-013-Instalar-a-INIA-na-VM-Windows-da-empresa.pdf"], ["it-008", "IT-INIA-008-Central-de-Dados-banco-e-arquivos.pdf"]] as const) {
    const source = join(repository, "docs/manuais", file)
    if (existsSync(source)) copyFileSync(source, join(out, `${name}.pdf`))
  }
  console.log("Corpus gerado em", out)
}

void main()
