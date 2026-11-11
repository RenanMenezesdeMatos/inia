import { describe, expect, it } from "vitest"
import { buildFixturePdf, type FixturePage } from "../../testing/pdf-layout-fixture.js"
import { pdfOcrLimits } from "../text-extractor.js"
import { openRasterDocument, PageRenderTimeoutError } from "./pdf-page-raster.js"
import { OCR_MAX_PAGES } from "./pdf-ocr-reader.js"

/** Página pesada de desenhar: muitos traços e textos. Serve para o teto de tempo do desenho de UMA página (auditoria de segurança, rodada 2). */
const heavyPage: FixturePage = Array.from({ length: 20_000 }, (_, index) =>
  index % 2 === 0 ? { kind: "thinRect" as const, x: (index % 500) + 10, y: (index % 700) + 10, width: 40, height: 0.5 } : { kind: "text" as const, x: (index % 400) + 10, y: (index % 700) + 20, text: "texto" },
)

describe("desenho da página para o OCR — teto de tempo por página", () => {
  it("página que passa do teto é cancelada e falha como página, sem segurar a leitura", async () => {
    const document = await openRasterDocument(buildFixturePdf([heavyPage]), { renderTimeoutMs: 5 })
    try {
      const started = performance.now()
      await expect(document.render(1)).rejects.toBeInstanceOf(PageRenderTimeoutError)
      expect(performance.now() - started).toBeLessThan(2_000)
    } finally {
      await document.close()
    }
  })

  it("dentro do teto, a página sai desenhada", async () => {
    const document = await openRasterDocument(buildFixturePdf([[{ kind: "text", x: 56, y: 80, text: "Regulamento" }]]))
    try {
      const rendered = await document.render(1)
      expect(rendered.pixelWidth).toBeGreaterThan(0)
      rendered.release()
    } finally {
      await document.close()
    }
  })
})

describe("prazo da leitura por OCR", () => {
  it("cresce só até as páginas que serão lidas: milhares de páginas digitalizadas não esticam o prazo do único leitor", () => {
    expect(pdfOcrLimits(1).timeoutMs).toBe(180_000)
    expect(pdfOcrLimits(5_000).timeoutMs).toBe(pdfOcrLimits(OCR_MAX_PAGES).timeoutMs)
  })
})
