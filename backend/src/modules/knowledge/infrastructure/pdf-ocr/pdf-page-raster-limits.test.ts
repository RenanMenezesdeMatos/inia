import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs"
import { describe, expect, it } from "vitest"

import { PDF_EMBEDDED_PRINT_RULE } from "../../domain/pdf-ocr/embedded-prints.js"
import { placementsOf } from "./pdf-page-raster.js"

/**
 * Tetos da regra PDF_EMBEDDED_PRINTS_V2 (run-8, SB-01): página montada com operações ou imagens demais não é lida pelas imagens — `null`, e o
 * leitor aplica a regra da tinta como numa digitalização. Página normal continua devolvendo as posições.
 */
const pageWith = (fnArray: number[]) =>
  ({
    getViewport: () => ({ transform: [1, 0, 0, -1, 0, 800], width: 600, height: 800 }),
    getOperatorList: async () => ({ fnArray, argsArray: fnArray.map(() => []) }),
  }) as never

describe("placementsOf — tetos da V2", () => {
  it("página normal: uma imagem, uma posição", async () => {
    expect(await placementsOf(pageWith([OPS.paintImageXObject]))).toHaveLength(1)
  })

  it("operações demais: não percorre a lista e devolve null", async () => {
    expect(await placementsOf(pageWith(new Array(PDF_EMBEDDED_PRINT_RULE.maxPageOperators + 1).fill(OPS.save)))).toBeNull()
  })

  it("imagens demais: para no teto e devolve null", async () => {
    expect(await placementsOf(pageWith(new Array(PDF_EMBEDDED_PRINT_RULE.maxPlacements + 1).fill(OPS.paintImageXObject)))).toBeNull()
  })
})
