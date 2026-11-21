import { describe, expect, it } from "vitest"
import { docxWithLines } from "../testing/knowledge-file-fixtures.js"
import { buildFixturePdf, grayImage } from "../testing/pdf-layout-fixture.js"
import { extractKnowledgeFile, type ExtractionObserver } from "./text-extractor.js"

/**
 * O acompanhamento do envio (migration 243) recebe cada etapa da leitura de verdade, no processo filho do parser: começa antes do trabalho e só
 * termina depois dele. Arquivo real montado no teste; nada de IA.
 */
type Event = { key: string; state: string; detail?: string | undefined; warning?: string | undefined; errorCode?: string | undefined }

function recorder(): { events: Event[]; observer: ExtractionObserver } {
  const events: Event[] = []
  return { events, observer: { onStage: (key, state, outcome) => events.push({ key, state, detail: outcome?.detail, warning: outcome?.warning, errorCode: outcome?.errorCode }) } }
}

describe("etapas da leitura do arquivo enviado", () => {
  it("PDF com print: texto, imagens e Markdown, cada uma começando antes e terminando depois do trabalho", async () => {
    const pdf = buildFixturePdf([[
      { kind: "text", x: 56, y: 80, text: "Como abrir o chamado", size: 16, font: "bold" },
      { kind: "text", x: 56, y: 120, text: "1. Abra a tela de chamados." },
      { kind: "image", x: 56, y: 140, width: 300, height: 150, image: grayImage(200, 100, 90) },
      { kind: "text", x: 56, y: 320, text: "2. Clique em Novo chamado." },
    ]])
    const { events, observer } = recorder()
    const extracted = await extractKnowledgeFile(pdf, "PDF", observer)
    expect(events.map((event) => `${event.key}:${event.state}`)).toEqual(["TEXT:RUNNING", "TEXT:DONE", "IMAGES:RUNNING", "MARKDOWN:RUNNING", "MARKDOWN:DONE", "IMAGES:DONE"])
    expect(events.find((event) => event.key === "TEXT" && event.state === "DONE")?.detail).toBe("1 página lida.")
    expect(events.find((event) => event.key === "IMAGES" && event.state === "DONE")?.detail).toBe(`${extracted.images.length} imagem separada e posicionada no texto.`)
    expect(extracted.images).toHaveLength(1)
    expect(extracted.text).toContain("Como abrir o chamado")
  })

  it("PDF digitalizado: o texto diz quantas páginas ficaram para o OCR", async () => {
    const pdf = buildFixturePdf([
      [{ kind: "text", x: 56, y: 80, text: "Página com texto selecionável." }],
      [{ kind: "image", x: 0, y: 0, width: 595, height: 842, image: grayImage(60, 84, 30) }],
    ])
    const { events, observer } = recorder()
    const extracted = await extractKnowledgeFile(pdf, "PDF", observer)
    expect(extracted.scannedPages).toEqual([2])
    expect(events.find((event) => event.key === "TEXT" && event.state === "DONE")?.detail).toBe("2 páginas lidas, 1 digitalizada (sem texto selecionável).")
  })

  it("DOCX: só a extração do texto (imagens e Markdown não existem para ele)", async () => {
    const { events, observer } = recorder()
    await extractKnowledgeFile(docxWithLines(["Confirme o e-mail.", "Encerre o atendimento."]), "DOCX", observer)
    expect(events.map((event) => `${event.key}:${event.state}`)).toEqual(["TEXT:RUNNING", "TEXT:DONE"])
    expect(events[1]?.detail).toMatch(/caracteres de texto\.$/)
  })

  it("quem acompanha falhar nunca atrapalha a leitura", async () => {
    const extracted = await extractKnowledgeFile(docxWithLines(["Texto do procedimento."]), "DOCX", { onStage: () => { throw new Error("banco fora") } })
    expect(extracted.text).toBe("Texto do procedimento.")
  })
})
