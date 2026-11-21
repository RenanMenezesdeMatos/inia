import { describe, expect, it } from "vitest"
import {
  failUploadStages,
  finishStage,
  initialUploadStages,
  parseUploadStages,
  startStage,
  UPLOAD_RUN_STALE_MS,
  uploadRunView,
  type UploadOcrJob,
  type UploadStage,
} from "./upload-stages.js"

const T0 = new Date("2026-11-19T12:00:00.000Z")
const later = (ms: number) => new Date(T0.getTime() + ms)
const stateOf = (stages: readonly UploadStage[]) => Object.fromEntries(stages.map((stage) => [stage.key, stage.state]))

/** As etapas de um PDF lidas até a gravação, com OCR pedido. */
function pdfSavedWithOcr(): UploadStage[] {
  let stages = initialUploadStages("PDF")
  for (const key of ["CHECK", "TEXT", "IMAGES", "MARKDOWN", "SAVE"] as const) stages = finishStage(startStage(stages, key, T0), key, "DONE", {}, later(1000))
  return stages.map((stage) => (stage.key === "OCR" ? { ...stage, detail: "2 páginas digitalizadas: a leitura entra na fila quando o rascunho for gravado." } : stage))
}

const job = (patch: Partial<UploadOcrJob>): UploadOcrJob => ({ status: "QUEUED", stage: null, pagesDone: 0, pagesTotal: 2, errorCode: null, errorMessage: null, result: null, ...patch })

describe("etapas do processamento do arquivo enviado", () => {
  it("PDF começa com todas as etapas aguardando; DOCX nunca promete imagens, Markdown nem OCR", () => {
    expect(stateOf(initialUploadStages("PDF"))).toEqual({ CHECK: "PENDING", TEXT: "PENDING", IMAGES: "PENDING", MARKDOWN: "PENDING", SAVE: "PENDING", OCR: "PENDING" })
    const docx = initialUploadStages("DOCX")
    expect(stateOf(docx)).toEqual({ CHECK: "PENDING", TEXT: "PENDING", IMAGES: "SKIPPED", MARKDOWN: "SKIPPED", SAVE: "PENDING", OCR: "SKIPPED" })
    expect(docx.find((stage) => stage.key === "MARKDOWN")?.detail).toMatch(/DOCX entra como está/)
    expect(docx.find((stage) => stage.key === "IMAGES")?.detail).toMatch(/prévia do arquivo/)
  })

  it("começar e terminar registram o momento; falha que não para o envio guarda o motivo só na etapa", () => {
    const running = startStage(initialUploadStages("PDF"), "IMAGES", T0)
    expect(running.find((stage) => stage.key === "IMAGES")).toMatchObject({ state: "RUNNING", startedAt: T0.toISOString(), finishedAt: null })
    const failed = finishStage(running, "IMAGES", "FAILED", { errorCode: "KNOWLEDGE_IMAGES_FAILED", errorMessage: "Não foi possível separar as imagens." }, later(500))
    expect(failed.find((stage) => stage.key === "IMAGES")).toMatchObject({ state: "FAILED", errorCode: "KNOWLEDGE_IMAGES_FAILED", errorMessage: "Não foi possível separar as imagens.", finishedAt: later(500).toISOString() })
    // As outras etapas não mudam.
    expect(stateOf(failed)).toMatchObject({ TEXT: "PENDING", MARKDOWN: "PENDING" })
    // Concluída depois de falhar não arrasta o erro.
    expect(finishStage(failed, "IMAGES", "DONE", { detail: "2 imagens" }, later(600)).find((stage) => stage.key === "IMAGES")).toMatchObject({ state: "DONE", errorCode: null, errorMessage: null, detail: "2 imagens" })
  })

  it("arquivo recusado: a etapa em andamento falha com o motivo e as que esperavam ficam como não feitas, nunca aguardando", () => {
    let stages = finishStage(startStage(initialUploadStages("PDF"), "CHECK", T0), "CHECK", "DONE", {}, T0)
    stages = startStage(stages, "TEXT", T0)
    const failed = failUploadStages(stages, null, { code: "KNOWLEDGE_EXTRACTION_BUSY", message: "Há muitos arquivos sendo lidos agora." }, later(100))
    expect(stateOf(failed)).toEqual({ CHECK: "DONE", TEXT: "FAILED", IMAGES: "SKIPPED", MARKDOWN: "SKIPPED", SAVE: "SKIPPED", OCR: "SKIPPED" })
    expect(failed.find((stage) => stage.key === "TEXT")).toMatchObject({ errorCode: "KNOWLEDGE_EXTRACTION_BUSY", errorMessage: "Há muitos arquivos sendo lidos agora." })
    expect(failed.find((stage) => stage.key === "SAVE")?.detail).toMatch(/Não executada/)
    // Etapa indicada (texto vazio depois de lido) falha mesmo já concluída.
    const done = finishStage(stages, "TEXT", "DONE", {}, T0)
    expect(stateOf(failUploadStages(done, "TEXT", { code: "KNOWLEDGE_EXTRACTION_FAILED", message: "Sem texto." }, T0))).toMatchObject({ TEXT: "FAILED", SAVE: "SKIPPED" })
  })

  it("a etapa de OCR é a da fila: na fila, lendo página a página, recortando prints, concluída ou com o erro dela", () => {
    const run = { status: "DONE" as const, stages: pdfSavedWithOcr(), errorCode: null, errorMessage: null, updatedAt: T0 }
    const ocrOf = (ocr: UploadOcrJob | null) => uploadRunView(run, ocr, later(1000)).stages.find((stage) => stage.key === "OCR")!

    expect(ocrOf(job({ status: "QUEUED" }))).toMatchObject({ state: "PENDING", detail: "2 páginas digitalizadas na fila de leitura.", progress: null })
    expect(ocrOf(job({ status: "RUNNING", stage: "READING", pagesDone: 1 }))).toMatchObject({ state: "RUNNING", detail: "Desenhando e lendo as páginas: 1 de 2.", progress: { done: 1, total: 2 } })
    expect(ocrOf(job({ status: "RUNNING", stage: "PRINTS", pagesDone: 0, pagesTotal: 1 })).detail).toMatch(/^Recortando os prints/)
    expect(ocrOf(job({ status: "DONE", result: { pagesRead: 2, failedPages: [], skippedPages: [], prints: 3 } }))).toMatchObject({ state: "DONE", detail: expect.stringContaining("2 páginas lidas, 3 prints recortados"), warning: null })
    expect(ocrOf(job({ status: "DONE", result: { pagesRead: 1, failedPages: [2], skippedPages: [], prints: 0 } })).warning).toBe("1 página ficou sem leitura.")
    expect(ocrOf(job({ status: "FAILED", errorCode: "KNOWLEDGE_OCR_LIMIT", errorMessage: "A leitura passou do limite." }))).toMatchObject({ state: "FAILED", errorCode: "KNOWLEDGE_OCR_LIMIT", errorMessage: "A leitura passou do limite." })
    expect(ocrOf(job({ status: "CANCELLED" }))).toMatchObject({ state: "FAILED", errorMessage: "A leitura das páginas digitalizadas foi cancelada." })
  })

  it("nada termina antes de terminar: com o OCR na fila ou lendo, o envio ainda não acabou", () => {
    const run = { status: "DONE" as const, stages: pdfSavedWithOcr(), errorCode: null, errorMessage: null, updatedAt: T0 }
    expect(uploadRunView(run, job({ status: "QUEUED" }), T0).finished).toBe(false)
    expect(uploadRunView(run, job({ status: "RUNNING", pagesDone: 1 }), T0).finished).toBe(false)
    expect(uploadRunView(run, job({ status: "DONE", result: { pagesRead: 2, failedPages: [], skippedPages: [], prints: 0 } }), T0).finished).toBe(true)
    expect(uploadRunView(run, job({ status: "FAILED" }), T0).finished).toBe(true)
    // Ainda gravando: nada acabou, e o OCR não é lido da fila antes de o rascunho existir.
    const processing = { ...run, status: "PROCESSING" as const, stages: startStage(initialUploadStages("PDF"), "TEXT", T0) }
    const view = uploadRunView(processing, job({ status: "DONE" }), T0)
    expect(view.finished).toBe(false)
    expect(view.stages.find((stage) => stage.key === "OCR")?.state).toBe("PENDING")
    expect(view.stages.every((stage) => stage.key === "CHECK" || stage.state !== "DONE")).toBe(true)
  })

  it("requisição sem notícia além do prazo aparece interrompida, com a etapa em curso falhada", () => {
    const run = { status: "PROCESSING" as const, stages: startStage(initialUploadStages("PDF"), "IMAGES", T0), errorCode: null, errorMessage: null, updatedAt: T0 }
    expect(uploadRunView(run, null, later(UPLOAD_RUN_STALE_MS - 1)).status).toBe("PROCESSING")
    const stale = uploadRunView(run, null, later(UPLOAD_RUN_STALE_MS + 1))
    expect(stale).toMatchObject({ status: "FAILED", finished: true, errorCode: "KNOWLEDGE_UPLOAD_INTERRUPTED" })
    expect(stale.stages.find((stage) => stage.key === "IMAGES")).toMatchObject({ state: "FAILED", errorCode: "KNOWLEDGE_UPLOAD_INTERRUPTED" })
    expect(stale.stages.find((stage) => stage.key === "SAVE")?.state).toBe("SKIPPED")
  })

  it("lê só etapas conhecidas do registro gravado", () => {
    const stored = JSON.parse(JSON.stringify(initialUploadStages("DOCX"))) as unknown[]
    expect(parseUploadStages([...stored, { key: "OUTRA", state: "DONE" }, { key: "TEXT", state: "QUASE" }, null])).toEqual(initialUploadStages("DOCX"))
    expect(parseUploadStages("x")).toEqual([])
  })
})
