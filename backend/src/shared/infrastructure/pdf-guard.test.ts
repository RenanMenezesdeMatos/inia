import { deflateSync } from "node:zlib"
import { describe, expect, it } from "vitest"
import { inspectPdf } from "./pdf-guard.js"

/** PDF mínimo com um fluxo de conteúdo FlateDecode (o mesmo formato que o pdf.js lê). */
function buildPdf(content: Buffer, extraStreams: Buffer[] = []): Buffer {
  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n")]
  const stream = (id: number, body: Buffer) => Buffer.concat([Buffer.from(`${id} 0 obj\n<< /Length ${body.length} /Filter /FlateDecode >>\nstream\n`), body, Buffer.from("\nendstream\nendobj\n")])
  parts.push(Buffer.from("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"))
  parts.push(stream(4, deflateSync(content)))
  extraStreams.forEach((body, index) => parts.push(stream(10 + index, deflateSync(body))))
  parts.push(Buffer.from("trailer\n<< /Root 1 0 R >>\n%%EOF\n"))
  return Buffer.concat(parts)
}

describe("guarda de PDF — fluxos comprimidos medidos antes do parser (auditoria 17/10/2026, DATA-1)", () => {
  it("aceita um PDF comum com texto", async () => {
    const result = await inspectPdf(buildPdf(Buffer.from("BT /F1 12 Tf 72 712 Td (Procedimento de cancelamento) Tj ET\n".repeat(200))))
    expect(result).toMatchObject({ ok: true, streams: 1 })
  })

  it("recusa fluxo que descompacta muito além do teto (bomba de 200 KB → 200 MB), sem descompactá-lo inteiro", async () => {
    const bomb = buildPdf(Buffer.concat([Buffer.from("BT (x) Tj ET\n"), Buffer.alloc(200 * 1024 * 1024, 0x20)]))
    expect(bomb.length).toBeLessThan(400 * 1024)
    expect(await inspectPdf(bomb)).toEqual({ ok: false, reason: "fluxo comprimido grande demais" })
  })

  it("recusa taxa de compressão absurda dentro do teto e soma de fluxos acima do teto total", async () => {
    expect(await inspectPdf(buildPdf(Buffer.alloc(8 * 1024 * 1024, 0x20)))).toEqual({ ok: false, reason: "taxa de compressão suspeita" })
    const limits = { maxStreamInflatedBytes: 1024 * 1024, maxImageInflatedBytes: 1024 * 1024, maxTotalInflatedBytes: 1500 * 1024, maxStreamRatio: 1_000_000, maxStreams: 10 }
    const chunk = Buffer.from("BT (texto) Tj ET\n".repeat(50_000))
    expect((await inspectPdf(buildPdf(chunk, [chunk]), limits)).ok).toBe(false)
  })

  it("conta linear no tamanho: palavras `stream` soltas com um único `endstream` no fim não travam a thread (auditoria run-2: 1 MiB levava 12 s)", async () => {
    const tokens = Buffer.from(`%PDF-1.4\n${"stream\n".repeat(150_000)}endstream\n`, "latin1")
    const started = performance.now()
    expect(await inspectPdf(tokens)).toEqual({ ok: true, streams: 0, totalInflatedBytes: 0 })
    expect(performance.now() - started).toBeLessThan(1_000)
  })

  it("o dicionário de cada fluxo continua sendo o trecho depois do último `obj`: FlateDecode de outro objeto não conta", async () => {
    const flate = deflateSync(Buffer.from("BT (x) Tj ET\n"))
    const parts = [
      Buffer.from("%PDF-1.4\n1 0 obj\n<< /Filter /FlateDecode >>\nendobj\n2 0 obj\n<< /Length 3 >>\nstream\nabc\nendstream\nendobj\n"),
      Buffer.from(`3 0 obj\n<< /Length ${flate.length} /Filter /FlateDecode >>\nstream\n`), flate, Buffer.from("\nendstream\nendobj\n%%EOF\n"),
    ]
    expect(await inspectPdf(Buffer.concat(parts))).toMatchObject({ ok: true, streams: 1 })
  })
})
