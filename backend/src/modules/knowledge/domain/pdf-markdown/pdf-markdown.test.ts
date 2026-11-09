import { describe, expect, it } from "vitest"
import { chunkKnowledgeDocument } from "../knowledge-chunking.js"
import { buildFixturePdf, gridTable, grayImage, paragraph, PAGE_HEIGHT, PAGE_WIDTH, type FixtureOp, type FixturePage } from "../../testing/pdf-layout-fixture.js"
import { readPdfLayout } from "../../infrastructure/pdf-layout-reader.js"
import type { PdfExtraction, PdfPageImage } from "./layout.js"
import { pdfLayoutToMarkdown } from "./pdf-markdown.js"
import { chunkDisplayTexts, remapExtraction, withChunkPages } from "./page-map.js"

const convert = async (pages: readonly FixturePage[]) => pdfLayoutToMarkdown(await readPdfLayout(buildFixturePdf(pages)))
const text = (y: number, value: string, options: Partial<Extract<FixtureOp, { kind: "text" }>> = {}): FixtureOp => ({ kind: "text", x: 56, y, text: value, ...options })
const LONG = "Esta orientação vale para todos os canais de atendimento e precisa ser consultada antes de qualquer registro no sistema, sempre conferindo os dados informados pelo cliente durante o contato."

describe("PDF → Markdown", () => {
  it("títulos pelo tamanho da fonte, com níveis, e parágrafo em uma linha só", async () => {
    const body = paragraph(LONG, { x: 56, y: 150, width: 480 })
    const { markdown, extraction } = await convert([[text(80, "Manual de reparo", { size: 20, font: "bold" }), text(120, "1. Abertura", { size: 14, font: "bold" }), ...body.ops]])
    expect(markdown).toContain("# Manual de reparo\n\n## 1. Abertura\n\n")
    expect(markdown).toContain(LONG)
    expect(extraction.headings).toBe(2)
  })

  it("negrito sozinho no tamanho do corpo vira título; negrito no meio do texto, não", async () => {
    const body = paragraph(LONG, { x: 56, y: 130, width: 480 })
    const { markdown } = await convert([[text(110, "Prazos de análise", { font: "bold" }), ...body.ops, text(260, "Atenção ao prazo.", { font: "bold" }), text(274, "O texto continua aqui.")]])
    expect(markdown).toMatch(/^#+ Prazos de análise$/m)
    expect(markdown).toContain("Atenção ao prazo.")
    expect(markdown).not.toContain("# Atenção ao prazo")
  })

  it("não inventa título: linha curta comum continua texto", async () => {
    const { markdown } = await convert([[text(100, "Nome do responsável"), text(114, "Maria da Silva"), text(128, "Telefone de contato")]])
    expect(markdown).not.toContain("#")
    expect(markdown).toBe("Nome do responsável\nMaria da Silva\nTelefone de contato")
  })

  it("listas com marcador e numeradas, sem perder o rótulo do documento", async () => {
    const { markdown } = await convert([[
      text(100, "•"), { kind: "text", x: 76, y: 100, text: "Confirmar o titular" }, { kind: "text", x: 76, y: 114, text: "com o documento original." },
      text(140, "•"), { kind: "text", x: 76, y: 140, text: "Registrar o protocolo." },
      text(180, "1. Testar a linha."), text(194, "2. Abrir o reparo."),
      text(230, "a) Primeira condição."), text(244, "b) Segunda condição."),
    ]])
    expect(markdown).toContain("- Confirmar o titular com o documento original.\n- Registrar o protocolo.")
    expect(markdown).toContain("1. Testar a linha.\n2. Abrir o reparo.")
    expect(markdown).toContain("- a) Primeira condição.\n- b) Segunda condição.")
  })

  it("tabela com grade em traço e em retângulo fino: célula vazia fica vazia", async () => {
    const rows = [["Produto", "Prazo", "Responsável"], ["Fibra", "24 horas", "Rede"], ["Cabo", "48 horas", ""]]
    for (const style of ["stroke", "thin"] as const) {
      const { markdown, extraction } = await convert([gridTable(rows, { x: 56, y: 100, columnWidths: [150, 150, 150], style }).ops])
      expect(markdown).toBe("| Produto | Prazo | Responsável |\n| --- | --- | --- |\n| Fibra | 24 horas | Rede |\n| Cabo | 48 horas |  |")
      expect(extraction.tables).toBe(1)
    }
  })

  it("célula que quebra em várias linhas continua inteira na linha da tabela", async () => {
    const long = "Abrir visita técnica em até 24 horas e avisar o cliente pelo aplicativo da operadora"
    const { markdown } = await convert([gridTable([["Falha", "Encaminhamento", "Área"], ["Sinal intermitente", long, "Campo"], ["Sem energia", "Trocar o equipamento", "Logística"]], { x: 56, y: 100, columnWidths: [120, 180, 120], style: "stroke" }).ops])
    expect(markdown).toContain(`| Sinal intermitente | ${long} | Campo |`)
  })

  it("sem cabeçalho distinto, a primeira linha não é promovida a cabeçalho", async () => {
    const { markdown } = await convert([gridTable([["Fibra", "24 horas"], ["Cabo", "48 horas"]], { x: 56, y: 100, columnWidths: [150, 150], style: "stroke", boldHeader: false }).ops])
    expect(markdown.split("\n")[0]).toBe("|  |  |")
    expect(markdown).toContain("| Fibra | 24 horas |")
  })

  it("caixa de diagrama não vira tabela", async () => {
    const box: FixtureOp[] = [
      { kind: "line", x0: 56, y0: 100, x1: 300, y1: 100 }, { kind: "line", x0: 56, y0: 160, x1: 300, y1: 160 }, { kind: "line", x0: 56, y0: 100, x1: 56, y1: 160 }, { kind: "line", x0: 300, y0: 100, x1: 300, y1: 160 },
      text(120, "Servidor da aplicação"), text(140, "Banco de dados"),
    ]
    const { markdown, extraction } = await convert([box])
    expect(extraction.tables).toBe(0)
    expect(markdown).toContain("Servidor da aplicação")
  })

  it("colunas alinhadas sem grade viram tabela; duas linhas alinhadas só, não", async () => {
    const row = (y: number, a: string, b: string, font: "bold" | "regular" = "regular"): FixtureOp[] => [{ kind: "text", x: 56, y, text: a, font }, { kind: "text", x: 300, y, text: b, font }]
    const table = await convert([[...row(100, "Demora", "Crédito", "bold"), ...row(116, "Até 24 horas", "R$ 10,00"), ...row(132, "Mais de 72 horas", "R$ 60,00")]])
    expect(table.markdown).toBe("| Demora | Crédito |\n| --- | --- |\n| Até 24 horas | R$ 10,00 |\n| Mais de 72 horas | R$ 60,00 |")
    const ambiguous = await convert([[...row(100, "Rua das Flores", "São Paulo"), ...row(116, "Rua das Pedras", "Campinas")]])
    expect(ambiguous.extraction.tables).toBe(0)
    expect(ambiguous.markdown).toContain("Rua das Flores\tSão Paulo")
  })

  it("tabela que atravessa a página: junta, repete o cabeçalho e cada parte aponta para a sua página", async () => {
    const head = ["Região", "Prazo"]
    const page1 = gridTable([head, ["Norte", "6 horas"], ["Sul", "8 horas"]], { x: 56, y: 100, columnWidths: [150, 150], style: "stroke" }).ops
    const page2 = gridTable([head, ["Leste", "9 horas"]], { x: 56, y: 100, columnWidths: [150, 150], style: "stroke" }).ops
    const { markdown, extraction } = await convert([page1, page2])
    expect(markdown).toBe("| Região | Prazo |\n| --- | --- |\n| Norte | 6 horas |\n| Sul | 8 horas |\n\n| Região | Prazo |\n| --- | --- |\n| Leste | 9 horas |")
    expect(extraction.pages.map((page) => page.offset)).toEqual([0, markdown.lastIndexOf("| Região")])
  })

  it("tabelas diferentes em páginas seguidas continuam separadas; na mesma página, também", async () => {
    const one = gridTable([["Região", "Prazo"], ["Norte", "6 horas"], ["Sul", "8 horas"]], { x: 56, y: 100, columnWidths: [150, 150], style: "stroke" }).ops
    const other = gridTable([["Forma", "Valor"], ["Boleto", "R$ 5,00"], ["Cartão", "R$ 7,00"]], { x: 56, y: 100, columnWidths: [150, 150], style: "stroke" }).ops
    const { extraction, markdown } = await convert([one, other])
    expect(extraction.tables).toBe(2)
    expect(markdown).toContain("| Forma | Valor |")
    // Uma terceira tabela depois da que já atravessou a página não entra nela.
    const page2 = gridTable([["Região", "Prazo"], ["Leste", "9 horas"]], { x: 56, y: 100, columnWidths: [150, 150], style: "stroke" }).ops
    const third = gridTable([["Região", "Prazo"], ["Oeste", "7 horas"]], { x: 56, y: 300, columnWidths: [150, 150], style: "stroke" }).ops
    const crossing = await convert([one, [...page2, ...third]])
    expect(crossing.extraction.tables).toBe(2)
  })

  it("lista bem recuada não vira tabela", async () => {
    const item = (y: number, marker: string, value: string): FixtureOp[] => [{ kind: "text", x: 56, y, text: marker }, { kind: "text", x: 110, y, text: value }]
    const { markdown, extraction } = await convert([[...item(100, "•", "Testar a linha."), ...item(116, "•", "Abrir o reparo."), ...item(132, "•", "Avisar o cliente."), ...item(170, "1.", "Primeiro passo."), ...item(186, "2.", "Segundo passo."), ...item(202, "3.", "Terceiro passo.")]])
    expect(extraction.tables).toBe(0)
    expect(markdown).toContain("- Testar a linha.\n- Abrir o reparo.\n- Avisar o cliente.")
    expect(markdown).toContain("1. Primeiro passo.\n2. Segundo passo.\n3. Terceiro passo.")
  })

  it("tags: célula mesclada não empurra o valor para a coluna errada", () => {
    const base = { width: 80, fontSize: 11, bold: false, mono: false, rotated: false }
    const cell = (x: number, y: number, value: string, row: number, col: number, header = false) => ({ ...base, x, y, text: value, hint: { kind: "TABLE_CELL" as const, tableId: "t1", row, col, header } })
    const { markdown } = pdfLayoutToMarkdown([{
      page: 1, width: 595, height: 842, rules: [], imageShare: 0, imageCount: 0, drawnPaths: 0, tagged: true,
      runs: [
        cell(56, 100, "Produto", 0, 0, true), cell(200, 100, "Prazo", 0, 1, true), cell(344, 100, "Área", 0, 2, true),
        cell(56, 120, "Fibra", 1, 0), cell(200, 120, "24 horas", 1, 1), cell(344, 120, "Rede", 1, 2),
        // "Cabo" ocupa as duas primeiras colunas: a segunda célula da linha é a da coluna Área.
        cell(56, 140, "Cabo", 2, 0), cell(344, 140, "Campo", 2, 1),
      ],
    }])
    expect(markdown).toBe("| Produto | Prazo | Área |\n| --- | --- | --- |\n| Fibra | 24 horas | Rede |\n| Cabo |  | Campo |")
  })

  it("duas colunas gravadas linha a linha: cada frase inteira, sem texto da outra coluna no meio", async () => {
    const left = paragraph(`Coluna da esquerda. ${LONG} ${LONG}`, { x: 56, y: 150, width: 215, size: 10 }).ops
    const right = paragraph(`Coluna da direita. ${LONG} ${LONG}`, { x: 310, y: 150, width: 215, size: 10 }).ops
    const interleaved = left.flatMap((op, index) => [op, ...(right[index] ? [right[index]] : [])])
    const { markdown } = await convert([[text(90, "Boletim", { size: 18, font: "bold" }), ...interleaved]])
    expect(markdown.replace(/\s+/g, " ")).toContain(`Coluna da esquerda. ${LONG} ${LONG}`)
    expect(markdown.replace(/\s+/g, " ")).toContain(`Coluna da direita. ${LONG} ${LONG}`)
  })

  it("tira cabeçalho e rodapé repetidos, mas guarda uma vez o texto fixo", async () => {
    const page = (n: number): FixturePage => [text(40, "Documento controlado", { size: 8 }), text(120, `Conteúdo próprio da página ${"abcde"[n]}.`), text(810, `Página ${n} de 4`, { size: 8 })]
    const { markdown, extraction } = await convert([page(1), page(2), page(3), page(4)])
    expect(markdown.match(/Documento controlado/g)).toHaveLength(1)
    expect(markdown).not.toContain("Página 1 de 4")
    expect(extraction.repeatedLinesRemoved).toBe(7)
    for (const letter of "bcde") expect(markdown).toContain(`página ${letter}.`)
  })

  it("hífen no fim da linha: tira só quando o documento usa a palavra inteira", async () => {
    const { markdown } = await convert([[text(100, "Durante o atendi-"), text(114, "mento, e também no atendimento remoto. O plano pré-"), text(128, "pago continua igual.")]])
    expect(markdown).toContain("Durante o atendimento, e também no atendimento remoto.")
    expect(markdown).toContain("pré-pago continua igual.")
  })

  it("# no começo de uma linha de texto ou de código nunca vira título para quem divide os trechos", async () => {
    const { markdown } = await convert([[text(100, "Introdução ao comando."), { kind: "text", x: 56, y: 130, text: "# instala os pacotes", font: "mono" }, { kind: "text", x: 56, y: 144, text: "npm ci", font: "mono" }, text(180, "# de chamadas por dia")]])
    const chunks = chunkKnowledgeDocument({ id: "d", title: "T", content: markdown })
    expect(chunks.every((chunk) => chunk.heading === "")).toBe(true)
    expect(markdown).toContain("```\n    # instala os pacotes\nnpm ci\n```")
    expect(markdown).toContain("\\# de chamadas por dia")
  })

  it("documento todo em fonte monoespaçada não vira um grande bloco de código", async () => {
    const { markdown } = await convert([[{ kind: "text", x: 56, y: 100, text: "Procedimento de teste", font: "mono" }, { kind: "text", x: 56, y: 114, text: "Linha 1 de conteúdo", font: "mono" }]])
    expect(markdown).not.toContain("```")
  })

  it("cobertura por página num PDF misto: texto, digitalizada, imagem grande e em branco, com a numeração certa", async () => {
    const scan = grayImage()
    const { markdown, extraction } = await convert([
      [text(100, "Primeira página com texto suficiente para contar.")],
      [{ kind: "image", x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, image: scan }],
      [text(100, "Terceira página, com uma figura grande logo abaixo."), { kind: "image", x: 56, y: 120, width: 480, height: 400, image: scan }],
      [],
      [text(100, "Quinta página, de novo só com texto.")],
    ])
    expect(extraction.pages.map((page) => page.status)).toEqual(["TEXT", "NO_TEXT", "PARTIAL", "BLANK", "TEXT"])
    expect(extraction.pages[1]!.offset).toBeNull()
    const chunks = withChunkPages(chunkKnowledgeDocument({ id: "d", title: "T", content: markdown }, { maxChunkChars: 60 }), markdown, extraction)
    expect(chunks.map((chunk) => chunk.pages)).toEqual([{ from: 1, to: 1 }, { from: 3, to: 3 }, { from: 5, to: 5 }])
  })

  it("carimbo de número sobre uma imagem de página inteira continua sendo página digitalizada", async () => {
    const { extraction } = await convert([[{ kind: "image", x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, image: grayImage() }, text(810, "12", { size: 8 })]])
    expect(extraction.pages[0]!.status).toBe("NO_TEXT")
  })

  it("texto ilegível (fonte sem mapa de caracteres) fica de fora e a página é marcada", () => {
    const run = { x: 56, width: 400, fontSize: 11, bold: false, mono: false, rotated: false, hint: null }
    const { markdown, extraction } = pdfLayoutToMarkdown([
      { page: 1, width: 595, height: 842, rules: [], imageShare: 0, imageCount: 0, drawnPaths: 0, tagged: false, runs: [{ ...run, y: 100, text: "" }] },
      { page: 2, width: 595, height: 842, rules: [], imageShare: 0, imageCount: 0, drawnPaths: 0, tagged: false, runs: [{ ...run, y: 100, text: "Texto legível da segunda página." }] },
    ])
    expect(extraction.pages.map((page) => page.status)).toEqual(["UNREADABLE", "TEXT"])
    expect(markdown).toBe("Texto legível da segunda página.")
  })

  it("tags do PDF mandam: título, lista e tabela declarados, em linha que a aparência não diria", () => {
    const base = { width: 200, fontSize: 11, bold: false, mono: false, rotated: false }
    const { markdown } = pdfLayoutToMarkdown([{
      page: 1, width: 595, height: 842, rules: [], imageShare: 0, imageCount: 0, drawnPaths: 0, tagged: true,
      runs: [
        { ...base, x: 56, y: 100, text: "Regras gerais", hint: { kind: "HEADING", level: 2, blockId: "h1" } },
        { ...base, x: 56, y: 130, text: "Fibra", hint: { kind: "TABLE_CELL", tableId: "t1", row: 0, col: 0, header: true } },
        { ...base, x: 256, y: 130, text: "Prazo", hint: { kind: "TABLE_CELL", tableId: "t1", row: 0, col: 1, header: true } },
        { ...base, x: 56, y: 150, text: "Reparo", hint: { kind: "TABLE_CELL", tableId: "t1", row: 1, col: 0, header: false } },
        { ...base, x: 256, y: 150, text: "24 horas", hint: { kind: "TABLE_CELL", tableId: "t1", row: 1, col: 1, header: false } },
        { ...base, x: 56, y: 190, text: "Confirmar o titular", hint: { kind: "LIST_ITEM", depth: 0, blockId: "l1" } },
      ],
    }])
    expect(markdown).toBe("## Regras gerais\n\n| Fibra | Prazo |\n| --- | --- |\n| Reparo | 24 horas |\n\n- Confirmar o titular")
  })

  it("nada se perde: toda letra das páginas aparece no Markdown", async () => {
    const { markdown } = await convert([[text(80, "Título do documento", { size: 18, font: "bold" }), ...paragraph(LONG, { x: 56, y: 110, width: 480 }).ops, ...gridTable([["A", "B"], ["um valor", "outro valor"]], { x: 56, y: 200, columnWidths: [200, 200], style: "stroke" }).ops]])
    for (const word of `Título do documento ${LONG} um valor outro valor`.split(/\s+/)) expect(markdown).toContain(word)
  })
})

describe("origem das páginas ao editar o texto", () => {
  const extraction = { version: "PDF_MARKDOWN_V1", pageCount: 2, headings: 0, tables: 0, repeatedLinesRemoved: 0, taggedPages: 0, edited: false, pages: [{ page: 1, status: "TEXT", chars: 10, headings: 0, tables: 0, offset: 0 }, { page: 2, status: "TEXT", chars: 10, headings: 0, tables: 0, offset: 24 }] } as const
  const before = "Linha da primeira folha\nLinha da segunda folha"

  it("a página continua na mesma linha quando entra texto antes dela", () => {
    const after = "Linha da primeira folha\nFrase digitada a mais\nLinha da segunda folha"
    const remapped = remapExtraction({ ...extraction, pages: [...extraction.pages] }, before, after)
    expect(remapped.edited).toBe(true)
    expect(remapped.pages[1]!.offset).toBe(after.indexOf("Linha da segunda"))
  })

  it("texto todo trocado: a origem das páginas sai, a cobertura fica", () => {
    const remapped = remapExtraction({ ...extraction, pages: [...extraction.pages] }, before, "")
    expect(remapped.pages.every((page) => page.offset === null)).toBe(true)
    expect(remapped.pages.map((page) => page.status)).toEqual(["TEXT", "TEXT"])
  })

  it("sem registro, os trechos ficam como vieram", () => {
    const chunks = chunkKnowledgeDocument({ id: "d", title: "T", content: before })
    expect(withChunkPages(chunks, before, null)).toEqual(chunks)
  })
})

describe("trecho como está escrito no documento, para a tela", () => {
  const onlyWords = (text: string) => text.replace(/\s+/g, " ").trim()

  it("parágrafo grande que a divisão recompôs com espaços volta a ter as linhas do documento, com as mesmas palavras", () => {
    const content = `Procedimento de teste\n${Array.from({ length: 60 }, (_, index) => `Linha ${index + 1} de conteudo para forcar mais de uma pagina.`).join("\n")}`
    const chunks = chunkKnowledgeDocument({ id: "d", title: "T", content })
    expect(chunks[0]!.text).not.toContain("\n")
    const written = chunkDisplayTexts(chunks, content)
    expect(written[0]!.split("\n")[1]).toBe("Linha 1 de conteudo para forcar mais de uma pagina.")
    chunks.forEach((chunk, index) => expect(onlyWords(written[index] ?? chunk.text)).toBe(onlyWords(chunk.text)))
  })

  it("trecho que já está igual ao documento não muda", () => {
    const content = "## Prazos\n\nPrimeiro parágrafo curto.\n\nSegundo parágrafo curto."
    expect(chunkDisplayTexts(chunkKnowledgeDocument({ id: "d", title: "T", content }), content)).toEqual([null])
  })

  it("linhas parecidas não confundem: cada trecho acha o seu lugar, na ordem", () => {
    const repeated = (label: string) => Array.from({ length: 40 }, () => `${label} texto igual em todas as linhas deste bloco de prova.`).join("\n")
    const content = `${repeated("Item")}\n\n${repeated("Item")}`
    const chunks = chunkKnowledgeDocument({ id: "d", title: "T", content })
    const written = chunkDisplayTexts(chunks, content)
    chunks.forEach((chunk, index) => expect(onlyWords(written[index] ?? chunk.text)).toBe(onlyWords(chunk.text)))
  })

  it("se o texto não bate, a tela fica com o texto do trecho: nunca mostra outra coisa", () => {
    expect(chunkDisplayTexts([{ text: "Palavra que não está aqui" }], "Outro conteúdo qualquer do documento")).toEqual([null])
  })
})

describe("imagens no texto", () => {
  const read = (pages: readonly FixturePage[]) => readPdfLayout(buildFixturePdf(pages))
  const shot = (id: string, page: number, top: number, overrides: Partial<PdfPageImage> = {}): PdfPageImage => ({ id, page, left: 56, top, right: 540, bottom: top + 120, width: 800, height: 400, ...overrides })
  const lineBefore = (markdown: string, offset: number | null | undefined) => markdown.slice(0, offset ?? 0).split("\n").pop()

  it("o texto é o mesmo, caractere por caractere, com ou sem imagens; sem a leitura das imagens, o registro não afirma nada sobre elas", async () => {
    const layout = await read([[text(100, "1. Abrir a tela."), text(300, "2. Salvar.")]])
    const plain = pdfLayoutToMarkdown(layout)
    const withImage = pdfLayoutToMarkdown(layout, { images: [shot("a", 1, 120)], omitted: 0 })
    expect(withImage.markdown).toBe(plain.markdown)
    expect(plain.extraction).not.toHaveProperty("images")
    expect(pdfLayoutToMarkdown(layout, { images: [], omitted: 0 }).extraction.images).toEqual([])
  })

  it("print entre dois passos de uma lista fica entre os dois, no fim da linha do passo", async () => {
    const layout = await read([[text(100, "1. Abrir a tela."), text(300, "2. Clicar em Salvar."), text(500, "3. Conferir o aviso.")]])
    const { markdown, extraction } = pdfLayoutToMarkdown(layout, { images: [shot("a", 1, 120), shot("b", 1, 320)], omitted: 0 })
    expect(markdown).toBe("1. Abrir a tela.\n2. Clicar em Salvar.\n3. Conferir o aviso.")
    expect(extraction.images!.map((image) => lineBefore(markdown, image.offset))).toEqual(["1. Abrir a tela.", "2. Clicar em Salvar."])
    expect(markdown[extraction.images![0]!.offset!]).toBe("\n")
  })

  it("print no topo da página segue o último passo da página anterior: o cabeçalho repetido não segura a imagem", async () => {
    const header = (): FixtureOp => text(30, "Manual da operação")
    const layout = await read([
      [header(), text(100, "Primeiro passo do processo."), text(200, "Segundo passo do processo.")],
      [header(), text(400, "Terceiro passo do processo.")],
      [header(), text(100, "Quarto passo do processo.")],
    ])
    const { markdown, extraction } = pdfLayoutToMarkdown(layout, { images: [shot("topo", 2, 60), shot("meio", 2, 420)], omitted: 0 })
    expect(extraction.images!.map((image) => lineBefore(markdown, image.offset))).toEqual(["Segundo passo do processo.", "Terceiro passo do processo."])
  })

  it("print antes de qualquer texto fica no começo do documento", async () => {
    const layout = await read([[text(400, "Texto abaixo da imagem.")]])
    expect(pdfLayoutToMarkdown(layout, { images: [shot("a", 1, 60)], omitted: 0 }).extraction.images![0]!.offset).toBe(0)
  })

  it("print numa coluna só vem depois do texto dessa coluna", () => {
    const line = (x: number, y: number, value: string) => ({ text: value, x, y, width: 200, fontSize: 11, bold: false, mono: false, rotated: false, hint: null })
    const left = Array.from({ length: 12 }, (_, index) => line(56, 100 + index * 14, `Linha ${index + 1} da coluna esquerda do manual`))
    const right = Array.from({ length: 12 }, (_, index) => line(320, 100 + index * 14, `Linha ${index + 1} da coluna direita do manual`))
    const page = { page: 1, width: 595, height: 842, runs: [...left, ...right], rules: [], imageShare: 0, imageCount: 1, drawnPaths: 0, tagged: false }
    const { markdown, extraction } = pdfLayoutToMarkdown([page], { images: [shot("a", 1, 300, { left: 56, right: 280 })], omitted: 0 })
    const before = markdown.slice(0, extraction.images![0]!.offset!)
    expect(before).toContain("coluna esquerda")
    expect(before).not.toContain("coluna direita")
  })

  it("logo nas margens e fundo de todas as páginas ficam de fora; o mesmo print usado duas vezes fica", async () => {
    const pages: FixturePage[] = Array.from({ length: 6 }, (_, index) => [text(400, `Texto da página ${index + 1} do manual.`)])
    const layout = await read(pages)
    const logo = [1, 2].map((page) => shot("logo", page, 10, { bottom: 50 }))
    const background = [1, 2, 3].map((page) => shot("fundo", page, 0, { bottom: 842 }))
    const repeated = [4, 5].map((page) => shot("print", page, 420))
    expect(pdfLayoutToMarkdown(layout, { images: [...logo, ...background, ...repeated], omitted: 0 }).extraction.images!.map((image) => `${image.id}@${image.page}`)).toEqual(["print@4", "print@5"])
  })

  it("registra quantas ficaram de fora pelo limite", async () => {
    const layout = await read([[text(100, "Texto.")]])
    expect(pdfLayoutToMarkdown(layout, { images: [], omitted: 3 }).extraction.imagesOmitted).toBe(3)
    expect(pdfLayoutToMarkdown(layout, { images: [], omitted: 0 }).extraction).not.toHaveProperty("imagesOmitted")
  })
})

describe("imagens nos trechos e na edição", () => {
  const extractionOf = (images: NonNullable<PdfExtraction["images"]>): PdfExtraction => ({ version: "PDF_MARKDOWN_V1", pageCount: 1, pages: [{ page: 1, status: "TEXT", chars: 10, headings: 1, tables: 0, offset: 0 }], headings: 1, tables: 0, repeatedLinesRemoved: 0, taggedPages: 0, edited: false, images })
  const image = (id: string, offset: number | null) => ({ id, page: 1, offset, width: 800, height: 400 })

  it("cada imagem cai no trecho certo; print logo abaixo de um título é do trecho que vem depois dele", () => {
    const content = "## Primeira\n\nPasso da primeira seção.\n\n## Segunda\n\nPasso da segunda seção."
    const endOfFirst = content.indexOf("Passo da primeira seção.") + "Passo da primeira seção.".length
    const underHeading = content.indexOf("## Segunda") + "## Segunda".length
    const chunks = chunkKnowledgeDocument({ id: "d", title: "t", content })
    const located = withChunkPages(chunks, content, extractionOf([image("fim", endOfFirst), image("abaixo", underHeading), image("sem-lugar", null)]))
    expect(located.map((chunk) => (chunk.images ?? []).map((item) => item.id))).toEqual([["fim"], ["abaixo"]])
    expect(located[0]!.images![0]!.at).toBe("Passo da primeira seção.".length)
    expect(located[1]!.images![0]!.at).toBe(0)
  })

  it("o trecho que a IA recebe não muda por causa das imagens", () => {
    const content = "## Seção\n\nPasso um.\n\nPasso dois."
    const chunks = chunkKnowledgeDocument({ id: "d", title: "t", content })
    const located = withChunkPages(chunks, content, extractionOf([image("a", content.indexOf("Passo um.") + 9)]))
    expect(located.map((chunk) => chunk.text)).toEqual(chunks.map((chunk) => chunk.text))
    expect(located.map((chunk) => chunk.heading)).toEqual(chunks.map((chunk) => chunk.heading))
  })

  it("editar o texto: a imagem continua depois da mesma linha; se a linha sumiu, vale a anterior que ficou", () => {
    const before = "Primeira linha.\nSegunda linha.\nTerceira linha."
    const after = "Linha nova no começo.\nPrimeira linha.\nTerceira linha."
    const extraction = extractionOf([image("a", "Primeira linha.".length), image("b", "Primeira linha.\nSegunda linha.".length), image("c", 0), image("d", null)])
    const images = remapExtraction(extraction, before, after).images!
    const lineOf = (offset: number | null) => after.slice(0, offset ?? 0).split("\n").pop()
    expect(lineOf(images[0]!.offset)).toBe("Primeira linha.")
    expect(after[images[0]!.offset!]).toBe("\n")
    expect(images[1]!.offset === null).toBe(false)
    expect(images[2]!.offset).toBe(0)
    expect(images[3]!.offset).toBeNull()
  })

  it("texto todo trocado: a imagem perde o lugar, mas continua no registro", () => {
    const images = remapExtraction(extractionOf([image("a", 5)]), "Texto antigo.", "").images!
    expect(images[0]).toMatchObject({ id: "a", offset: null })
  })

  it("registro sem imagens continua sem imagens depois da edição", () => {
    const old = extractionOf([])
    delete old.images
    expect(remapExtraction(old, "Linha um.\nLinha dois.", "Linha um.\nLinha três.")).not.toHaveProperty("images")
  })
})
