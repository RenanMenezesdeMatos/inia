import { deflateRawSync } from "node:zlib"
import { describe, expect, it } from "vitest"
import { DocxPreviewTooLargeError, PREVIEW_IMAGES_OMITTED_NOTICE, renderDocxPreviewHtml } from "./docx-preview.js"

/**
 * Tamanho da prévia de DOCX (lote 3 da 4ª auditoria; P-04 da preparação AppSec): um documento legítimo de 1,2 MB com uma imagem de
 * 100 MB virava, a cada prévia, 133 MB de HTML e ~1,3 GB de memória. Limites pequenos aqui para os arquivos do teste serem leves.
 */
function docx(image: Buffer, text = "Procedimento de atendimento"): Buffer {
  const entries = [
    { name: "[Content_Types].xml", content: Buffer.from(`<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="png" ContentType="image/png"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`) },
    { name: "_rels/.rels", content: Buffer.from(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`) },
    { name: "word/_rels/document.xml.rels", content: Buffer.from(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>`) },
    { name: "word/document.xml", content: Buffer.from(`<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body><w:p><w:r><w:t>${text}</w:t></w:r><w:r><w:drawing><wp:inline><wp:docPr id="1" name="i" descr="Tela do sistema"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rId9"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:body></w:document>`) },
    { name: "word/media/image1.png", content: image },
  ]
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const compressed = deflateRawSync(entry.content)
    const name = Buffer.from(entry.name)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(entry.content.length, 22)
    local.writeUInt16LE(name.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(entry.content.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, name, compressed)
    centrals.push(central, name)
    offset += 30 + name.length + compressed.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

const image = (bytes: number) => Buffer.alloc(bytes, 7)

describe("prévia de DOCX — tamanho", () => {
  it("dentro dos limites: texto e imagem, como sempre", async () => {
    const html = await renderDocxPreviewHtml(docx(image(4_000)), { maxTextBytes: 1_000_000, maxImageBytes: 10_000 })
    expect(html).toContain("Procedimento de atendimento")
    expect(html).toContain("data:image/png;base64,")
    expect(html).not.toContain(PREVIEW_IMAGES_OMITTED_NOTICE)
  })

  it("imagens acima do limite: a prévia sai só com o texto e o aviso para baixar o original", async () => {
    const html = await renderDocxPreviewHtml(docx(image(40_000)), { maxTextBytes: 1_000_000, maxImageBytes: 10_000 })
    expect(html.startsWith(PREVIEW_IMAGES_OMITTED_NOTICE)).toBe(true)
    expect(html).toContain("Procedimento de atendimento")
    expect(html).not.toContain("data:image")
  })

  it("texto acima do limite: sem prévia (a tela mostra o texto extraído e o download)", async () => {
    await expect(renderDocxPreviewHtml(docx(image(100), "x".repeat(50_000)), { maxTextBytes: 10_000, maxImageBytes: 10_000 })).rejects.toBeInstanceOf(DocxPreviewTooLargeError)
  })

  it("com os limites padrão, um documento comum segue com a prévia completa", async () => {
    expect(await renderDocxPreviewHtml(docx(image(200_000)))).toContain("data:image/png;base64,")
  })
})
