import { deflateSync } from "node:zlib"

/**
 * PDFs gerados para os testes do extrator: uma página com fonte Helvetica e os fluxos de conteúdo dados (concatenados pelo
 * pdf.js na leitura), com tabela xref de verdade — o mesmo formato que um editor grava.
 */
export type PdfContentStream = { filter: string; body: Buffer }

export function buildPdf(contents: PdfContentStream[]): Buffer {
  const references = contents.map((_, index) => `${5 + index} 0 R`).join(" ")
  const objects: Buffer[] = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents [${references}] /Resources << /Font << /F1 4 0 R >> >> >>`),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
    ...contents.map(({ filter, body }) => Buffer.concat([Buffer.from(`<< /Length ${body.length} /Filter ${filter} >>\nstream\n`), body, Buffer.from("\nendstream")])),
  ]
  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n")]
  const offsets: number[] = []
  let length = parts[0]!.length
  objects.forEach((body, index) => {
    offsets.push(length)
    const object = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), body, Buffer.from("\nendobj\n")])
    parts.push(object)
    length += object.length
  })
  const xref = [`xref\n0 ${objects.length + 1}\n`, "0000000000 65535 f \n", ...offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)].join("")
  parts.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`))
  return Buffer.concat(parts)
}

/** Página com as linhas de texto dadas, num fluxo FlateDecode comum. */
export function textPdf(lines: string[]): Buffer {
  const operators = lines.map((line, index) => `BT /F1 12 Tf 72 ${720 - index * 16} Td (${line}) Tj ET`).join("\n")
  return buildPdf([{ filter: "/FlateDecode", body: deflateSync(Buffer.from(operators, "latin1")) }])
}

/**
 * Bomba que a pré-varredura (`pdf-guard.ts`) NÃO pega: cada fluxo passa por `[/FlateDecode /RunLengthDecode]`. O estágio Flate
 * descompacta para exatamente 1 MB (abaixo da regra de taxa) de pares RunLength "repita 128×", e o pdf.js expande cada um para
 * 64 MB e concatena os fluxos da página: 35 KB de arquivo viram ~2 GB na memória de quem lê (no processo da API, a de 20 fluxos
 * — 23 KB — chegou a 2,4 GB de memória residente).
 */
export function chainedFilterBombPdf(streams = 30): Buffer {
  const runs = Buffer.alloc(1024 * 1024)
  for (let index = 0; index < runs.length; index += 2) {
    runs[index] = 0x81 // 257 - 0x81 = 128 cópias do próximo byte
    runs[index + 1] = 0x20
  }
  const bomb = deflateSync(runs)
  return buildPdf([
    { filter: "/FlateDecode", body: deflateSync(Buffer.from("BT /F1 12 Tf 72 712 Td (Procedimento) Tj ET")) },
    ...Array.from({ length: streams }, () => ({ filter: "[/FlateDecode /RunLengthDecode]", body: bomb })),
  ])
}
