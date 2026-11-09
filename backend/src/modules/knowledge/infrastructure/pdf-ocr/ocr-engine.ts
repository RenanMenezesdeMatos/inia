import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { Worker } from "node:worker_threads"

/**
 * O Tesseract que lê as páginas digitalizadas. Ele vem compilado em WebAssembly, com o português, em `backend/vendor/tesseract` (ver o LEIA-ME de lá):
 * chega ao servidor junto com o código e não é instalado em lugar nenhum, nem entra no package.json. Ler uma página ocupa a CPU por 1 a 4 segundos
 * sem pausa, por isso o motor roda numa thread própria: a thread principal continua atendendo enquanto ele lê. Uma página por vez.
 */
export const OCR_VENDOR_DIRECTORY = fileURLToPath(new URL("../../../../../vendor/tesseract/", import.meta.url))
/**
 * Primeiro a versão com SIMD (mais rápida); se a CPU não aceitar, a versão sem SIMD, com o mesmo resultado. `.cjs` porque o backend é "type":
 * "module" e o carregador do motor é CommonJS; o nome do `.wasm` ao lado é o que ele procura.
 */
const CORE_FILES = ["tesseract-core-simd-lstm.cjs", "tesseract-core-lstm.cjs"]
const LANGUAGE_FILE = "por.traineddata"

export const OCR_ENGINE_LABEL = "Tesseract 5.1 (tesseract.js-core 6.1.2) com português tessdata_fast"

/** Página que passa disso travou o motor: a thread é encerrada, e a página seguinte começa numa nova. */
const PAGE_TIMEOUT_MS = 180_000

/** O motor só lê a página e devolve o hOCR (palavras, linhas e blocos com posição). Tudo o que se decide sobre isso fica fora da thread. */
const WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads")
const { readFileSync } = require("node:fs")
const quiet = { print() {}, printErr() {} }
async function load() {
  let failure = null
  for (const file of workerData.cores) {
    try {
      return await require(file)(quiet)
    } catch (error) {
      failure = error
    }
  }
  throw failure || new Error("motor de OCR não encontrado")
}
const ready = load().then((core) => {
  core.FS.writeFile("por.traineddata", readFileSync(workerData.language))
  const api = new core.TessBaseAPI()
  if (api.Init(null, "por", 1) !== 0) throw new Error("o motor de OCR não iniciou com o português")
  api.SetPageSegMode(3)
  return { core, api }
})
// A falha ao carregar chega a quem pediu a página; sem isso, a promessa rejeitada sem ninguém esperando derrubaria a thread antes.
ready.catch(() => undefined)
parentPort.on("message", async ({ id, png }) => {
  try {
    const { core, api } = await ready
    core.FS.writeFile("/input", png)
    try {
      if (api.SetImageFile(1, 0) === 1) throw new Error("a imagem da página não abriu no motor de OCR")
      if (api.Recognize(null) !== 0) throw new Error("o motor de OCR não conseguiu ler a página")
      parentPort.postMessage({ id, ok: true, hocr: api.GetHOCRText(0) })
    } finally {
      api.Clear()
      core.FS.unlink("/input")
    }
  } catch (error) {
    parentPort.postMessage({ id, ok: false, message: error instanceof Error ? error.message : String(error) })
  }
})
`

export class OcrEngineUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "OcrEngineUnavailableError"
  }
}

export type OcrEngine = {
  /** hOCR da página (PNG). */
  recognize(png: Buffer): Promise<string>
  close(): Promise<void>
}

/** Os arquivos do motor estão no lugar? Sem eles, a leitura das páginas digitalizadas não acontece e o motivo aparece para quem enviou. */
export function ocrEngineFiles(directory = OCR_VENDOR_DIRECTORY): { cores: string[]; language: string } | null {
  const cores = CORE_FILES.map((file) => `${directory}${file}`).filter((file) => existsSync(file) && existsSync(file.replace(/\.cjs$/, ".wasm")))
  const language = `${directory}${LANGUAGE_FILE}`
  return cores.length > 0 && existsSync(language) ? { cores, language } : null
}

type Pending = { id: number; resolve: (hocr: string) => void; reject: (error: unknown) => void; timer: NodeJS.Timeout }

export function createOcrEngine(options: { directory?: string; pageTimeoutMs?: number } = {}): OcrEngine {
  const files = ocrEngineFiles(options.directory)
  const timeoutMs = options.pageTimeoutMs ?? PAGE_TIMEOUT_MS
  let worker: Worker | null = null
  let pending: Pending | null = null
  let nextId = 0
  let chain: Promise<unknown> = Promise.resolve()

  const finish = (error: unknown) => {
    const current = pending
    pending = null
    if (current) {
      clearTimeout(current.timer)
      current.reject(error)
    }
  }
  const stop = async () => {
    const current = worker
    worker = null
    if (current) await current.terminate().catch(() => undefined)
  }
  const start = (): Worker => {
    if (!files) throw new OcrEngineUnavailableError("Os arquivos do motor de OCR não estão em backend/vendor/tesseract. Atualize o código do servidor.")
    const created = new Worker(WORKER_SOURCE, { eval: true, workerData: files })
    created.unref()
    created.on("message", (message: { id: number; ok: boolean; hocr?: string; message?: string }) => {
      const current = pending
      if (!current || current.id !== message.id) return
      pending = null
      clearTimeout(current.timer)
      created.unref()
      if (message.ok) current.resolve(message.hocr ?? "")
      else current.reject(new Error(message.message ?? "falha no motor de OCR"))
    })
    created.on("error", (error) => {
      if (worker === created) worker = null
      finish(error)
    })
    created.on("exit", (code) => {
      if (worker === created) worker = null
      finish(new Error(`o motor de OCR parou (código ${code})`))
    })
    return created
  }

  const read = (png: Buffer) =>
    new Promise<string>((resolve, reject) => {
      let current: Worker
      try {
        current = worker ?? (worker = start())
      } catch (error) {
        reject(error)
        return
      }
      const id = (nextId += 1)
      const timer = setTimeout(() => {
        finish(new Error("o motor de OCR passou do tempo numa página"))
        void stop()
      }, timeoutMs)
      pending = { id, resolve, reject, timer }
      current.ref()
      current.postMessage({ id, png })
    })

  return {
    recognize(png) {
      // Uma página por vez: a próxima só entra quando a anterior termina, com ou sem erro.
      const result = chain.then(() => read(png))
      chain = result.catch(() => undefined)
      return result
    },
    async close() {
      await chain
      await stop()
    },
  }
}
