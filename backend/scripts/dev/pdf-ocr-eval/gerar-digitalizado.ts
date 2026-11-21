/**
 * PDF DIGITALIZADO DE TESTE para o OCR, com gabarito — sem IA, sem banco e sem custo. Desenha uma instrução de trabalho fictícia (empresa
 * "Operadora Exemplo", nenhum material de cliente) com títulos, parágrafos acentuados, passos, tabela com grade, aviso em caixa, prints de
 * sistema (janela, tabela de faturas, diálogo), foto de celular, gráfico e carimbo. Depois "escaneia" cada página como um scanner faria:
 * papel tingido, leve inclinação, desfoque, ruído, sombra da lombada, poeira e JPEG — umas páginas em cores, outras em tons de cinza.
 *
 * Variantes (cada uma vira um PDF, todas com o mesmo conteúdo):
 *  - `pagina-inteira`: a imagem do scanner ocupa a página inteira (o caso comum), com sombra da lombada e poeira.
 *  - `limpo`:          igual, sem sombra nem poeira (scanner de mesa bem calibrado).
 *  - `com-margem`:     a imagem ocupa ~70% da página, com margem branca em volta (app de celular, Carta impressa em A4). É o caso do QA-07 da
 *                      run-8: imagem menor que 85% da página pode ser tomada por um print só.
 *  - `misto`:          páginas 1 e 3 com camada de texto (PDF exportado), 2 e 4 digitalizadas — o envio só passa as digitalizadas pelo OCR.
 *
 *   npx tsx scripts/dev/pdf-ocr-eval/gerar-digitalizado.ts <pasta-de-saída> [--sem-avaliar]
 *
 * Saída: `<variante>.pdf`, `gabarito.json` (palavras e prints de cada página, em pontos da página) e, sem `--sem-avaliar`, `relatorio.md` com
 * as notas do MESMO leitor do servidor (`readScannedPages`). Para ver as páginas marcadas, rode depois
 * `validar-ocr.ts <pasta> <pdf> --modos=producao`.
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas"
import { wordsOf, type OcrBox } from "../../../src/modules/knowledge/domain/pdf-ocr/hocr.js"
import { PDF_EMBEDDED_PRINT_RULE } from "../../../src/modules/knowledge/domain/pdf-ocr/embedded-prints.js"
import { PDF_PRINT_RULE } from "../../../src/modules/knowledge/domain/pdf-ocr/print-regions.js"
import { createOcrEngine } from "../../../src/modules/knowledge/infrastructure/pdf-ocr/ocr-engine.js"
import { readScannedPages } from "../../../src/modules/knowledge/infrastructure/pdf-ocr/pdf-ocr-reader.js"
import { extractKnowledgeFile } from "../../../src/modules/knowledge/infrastructure/text-extractor.js"
import { buildFixturePdf, PAGE_HEIGHT, PAGE_WIDTH, type FixtureOp, type FixturePage } from "../../../src/modules/knowledge/testing/pdf-layout-fixture.js"
import { scorePage, sumScores, type PageScore, type TruthWord } from "./score.js"

const args = process.argv.slice(2)
const output = args.find((arg) => !arg.startsWith("--"))
if (!output) {
  console.error("Uso: gerar-digitalizado.ts <pasta-de-saída> [--sem-avaliar]")
  process.exit(2)
}

const DPI = 150
const K = DPI / 72
const FONT = "Arial, Helvetica, sans-serif"

/** O que foi desenhado numa página, em pontos: linhas de texto (o gabarito do texto) e retângulos de imagem (o gabarito dos prints). */
type TextRun = {
  text: string
  x: number
  y: number
  size: number
  bold: boolean
}
type Drawn = { runs: TextRun[]; prints: (OcrBox & { label: string })[] }

class Page {
  readonly canvas = createCanvas(Math.round(PAGE_WIDTH * K), Math.round(PAGE_HEIGHT * K))
  readonly ctx: SKRSContext2D = this.canvas.getContext("2d")
  readonly drawn: Drawn = { runs: [], prints: [] }
  constructor() {
    this.ctx.fillStyle = "#ffffff"
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
    this.ctx.scale(K, K)
  }
  font(size: number, bold = false) {
    this.ctx.font = `${bold ? "bold " : ""}${size}px ${FONT}`
  }
  /** Texto que conta no gabarito (fora de print). `y` = linha de base. */
  text(text: string, x: number, y: number, size = 10.5, bold = false, color = "#1a1a1a") {
    this.font(size, bold)
    this.ctx.fillStyle = color
    this.ctx.fillText(text, x, y)
    this.drawn.runs.push({ text, x, y, size, bold })
  }
  /** Parágrafo com quebra de linha pela largura; devolve o `y` seguinte. */
  paragraph(text: string, x: number, y: number, width: number, size = 10.5, leading = 1.45): number {
    this.font(size)
    let line = ""
    for (const word of text.split(" ")) {
      const next = line ? `${line} ${word}` : word
      if (this.ctx.measureText(next).width > width && line) {
        this.text(line, x, y, size)
        y += size * leading
        line = word
      } else line = next
    }
    if (line) this.text(line, x, y, size)
    return y + size * leading
  }
  print(label: string, x: number, y: number, width: number, height: number, draw: (ctx: SKRSContext2D) => void) {
    this.ctx.save()
    this.ctx.translate(x, y)
    this.ctx.beginPath()
    this.ctx.rect(0, 0, width, height)
    this.ctx.clip()
    draw(this.ctx)
    this.ctx.restore()
    this.drawn.prints.push({
      label,
      left: x,
      top: y,
      right: x + width,
      bottom: y + height,
    })
  }
  /** Palavras do gabarito com a posição medida pela fonte. */
  truthWords(): TruthWord[] {
    const words: TruthWord[] = []
    for (const run of this.drawn.runs) {
      this.font(run.size, run.bold)
      let cursor = run.x
      const space = this.ctx.measureText(" ").width
      for (const token of run.text.split(" ")) {
        if (!token) continue
        const width = this.ctx.measureText(token).width
        words.push({
          text: token,
          left: cursor,
          right: cursor + width,
          top: run.y - run.size * 0.75,
          bottom: run.y + run.size * 0.2,
        })
        cursor += width + space
      }
    }
    return words
  }
}

// ---------- peças de desenho dos prints (texto dentro de print não conta no gabarito: o print sai do texto) ----------

function uiText(ctx: SKRSContext2D, text: string, x: number, y: number, size = 7.5, color = "#222", bold = false) {
  ctx.font = `${bold ? "bold " : ""}${size}px ${FONT}`
  ctx.fillStyle = color
  ctx.fillText(text, x, y)
}

function windowFrame(ctx: SKRSContext2D, width: number, height: number, title: string) {
  ctx.fillStyle = "#f3f5f9"
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = "#2f4b8a"
  ctx.fillRect(0, 0, width, 16)
  uiText(ctx, title, 8, 11, 7.5, "#ffffff", true)
  for (const [index, color] of ["#e5534b", "#e7b416", "#3fb950"].entries()) {
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(width - 12 - index * 11, 8, 3.2, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.strokeStyle = "#9aa4b5"
  ctx.lineWidth = 0.8
  ctx.strokeRect(0.4, 0.4, width - 0.8, height - 0.8)
}

function sidebar(ctx: SKRSContext2D, height: number, items: string[], active: number) {
  ctx.fillStyle = "#e3e8f2"
  ctx.fillRect(0, 16, 92, height - 16)
  items.forEach((item, index) => {
    if (index === active) {
      ctx.fillStyle = "#c7d3ee"
      ctx.fillRect(4, 24 + index * 18, 84, 14)
    }
    uiText(ctx, item, 10, 34 + index * 18, 7, index === active ? "#1d3a7a" : "#3a4250", index === active)
  })
}

function field(ctx: SKRSContext2D, label: string, value: string, x: number, y: number, width: number) {
  uiText(ctx, label, x, y, 6.5, "#555")
  ctx.fillStyle = "#ffffff"
  ctx.fillRect(x, y + 3, width, 14)
  ctx.strokeStyle = "#a7b0c0"
  ctx.strokeRect(x + 0.4, y + 3.4, width - 0.8, 13.2)
  uiText(ctx, value, x + 4, y + 13, 7.5, "#111")
}

function button(ctx: SKRSContext2D, label: string, x: number, y: number, width: number, color = "#3b6fd6") {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.roundRect(x, y, width, 16, 7)
  ctx.fill()
  ctx.font = `bold 7px ${FONT}`
  const textWidth = ctx.measureText(label).width
  uiText(ctx, label, x + (width - textWidth) / 2, y + 10.8, 7, "#ffffff", true)
}

function screenCustomer(ctx: SKRSContext2D, width: number, height: number) {
  windowFrame(ctx, width, height, "Portal de Atendimento — Consulta de cliente")
  sidebar(ctx, height, ["Início", "Consulta de cliente", "Faturas", "Contestações", "Protocolos", "Relatórios"], 1)
  const x = 106
  uiText(ctx, "Consulta de cliente", x, 34, 10, "#1d3a7a", true)
  field(ctx, "CPF ou CNPJ", "123.456.789-09", x, 46, 120)
  field(ctx, "Número da linha", "(11) 98765-4321", x + 132, 46, 110)
  button(ctx, "Buscar", x + 254, 49, 52)
  ctx.fillStyle = "#ffffff"
  ctx.fillRect(x, 76, width - x - 12, height - 88)
  ctx.strokeStyle = "#cfd6e3"
  ctx.strokeRect(x + 0.4, 76.4, width - x - 12.8, height - 88.8)
  const rows: [string, string][] = [
    ["Nome", "Mariana Albuquerque Souza"],
    ["Plano", "Controle 25 GB"],
    ["Situação da linha", "Ativa"],
    ["Cliente desde", "03/2019"],
    ["Forma de pagamento", "Boleto"],
  ]
  rows.forEach(([label, value], index) => {
    uiText(ctx, label, x + 8, 92 + index * 15, 7, "#666")
    uiText(ctx, value, x + 96, 92 + index * 15, 7.5, "#111", index === 0)
  })
}

function screenInvoices(ctx: SKRSContext2D, width: number, height: number) {
  windowFrame(ctx, width, height, "Portal de Atendimento — Faturas")
  sidebar(ctx, height, ["Início", "Consulta de cliente", "Faturas", "Contestações", "Protocolos"], 2)
  const x = 104
  uiText(ctx, "Faturas da linha (11) 98765-4321", x, 32, 9, "#1d3a7a", true)
  const columns = ["Mês", "Vencimento", "Valor", "Situação"]
  const xs = [x, x + 60, x + 130, x + 190]
  ctx.fillStyle = "#dde5f5"
  ctx.fillRect(x - 4, 40, width - x - 8, 14)
  columns.forEach((column, index) => uiText(ctx, column, xs[index]!, 50, 7, "#1d3a7a", true))
  const data = [
    ["Out/2026", "10/11/2026", "R$ 89,90", "Em aberto"],
    ["Set/2026", "10/10/2026", "R$ 112,40", "Paga"],
    ["Ago/2026", "10/09/2026", "R$ 89,90", "Paga"],
    ["Jul/2026", "10/08/2026", "R$ 94,15", "Paga"],
  ]
  data.forEach((row, rowIndex) => {
    if (rowIndex === 0) {
      ctx.fillStyle = "#fff6d6"
      ctx.fillRect(x - 4, 56 + rowIndex * 15, width - x - 8, 14)
    }
    row.forEach((cell, index) => uiText(ctx, cell, xs[index]!, 66 + rowIndex * 15, 7.2, index === 3 && cell === "Em aberto" ? "#b45309" : "#222"))
  })
  button(ctx, "Gerar 2ª via", x, height - 26, 70)
  button(ctx, "Contestar valor", x + 78, height - 26, 78, "#6b7280")
}

function screenDialog(ctx: SKRSContext2D, width: number, height: number) {
  ctx.fillStyle = "#8a93a6"
  ctx.fillRect(0, 0, width, height)
  const w = width - 40
  const h = height - 30
  ctx.fillStyle = "#ffffff"
  ctx.beginPath()
  ctx.roundRect(20, 15, w, h, 8)
  ctx.fill()
  ctx.fillStyle = "#16a34a"
  ctx.beginPath()
  ctx.arc(44, 40, 10, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = "#ffffff"
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(39, 40)
  ctx.lineTo(43, 44)
  ctx.lineTo(50, 35)
  ctx.stroke()
  uiText(ctx, "Contestação registrada", 62, 38, 10, "#14532d", true)
  uiText(ctx, "Protocolo 2026112100123 · prazo de resposta: 5 dias úteis", 62, 52, 7.2, "#333")
  uiText(ctx, "O cliente recebe o protocolo por SMS e e-mail.", 34, 74, 7.2, "#333")
  button(ctx, "Fechar", w - 46, h - 10, 52)
}

function phonePhoto(ctx: SKRSContext2D, width: number, height: number) {
  const gradient = ctx.createLinearGradient(0, 0, width, height)
  gradient.addColorStop(0, "#7b5e3b")
  gradient.addColorStop(1, "#3d2b1a")
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)
  for (let index = 0; index < 40; index += 1) {
    ctx.fillStyle = `rgba(255,255,255,${0.02 + (index % 5) * 0.01})`
    ctx.fillRect((index * 37) % width, 0, 2, height)
  }
  ctx.fillStyle = "#111"
  ctx.beginPath()
  ctx.roundRect(width * 0.3, height * 0.08, width * 0.4, height * 0.84, 10)
  ctx.fill()
  ctx.fillStyle = "#e9eef7"
  ctx.fillRect(width * 0.33, height * 0.14, width * 0.34, height * 0.7)
  ctx.fillStyle = "#3b6fd6"
  ctx.beginPath()
  ctx.roundRect(width * 0.35, height * 0.3, width * 0.29, height * 0.16, 5)
  ctx.fill()
  uiText(ctx, "SMS", width * 0.37, height * 0.26, 5.5, "#555", true)
  uiText(ctx, "Sua 2ª via", width * 0.37, height * 0.36, 5.5, "#fff")
  uiText(ctx, "está pronta", width * 0.37, height * 0.42, 5.5, "#fff")
}

function barChart(ctx: SKRSContext2D, width: number, height: number) {
  ctx.fillStyle = "#ffffff"
  ctx.fillRect(0, 0, width, height)
  uiText(ctx, "Contestações por mês", 10, 14, 8, "#222", true)
  const values = [42, 55, 38, 61, 47, 33]
  const months = ["Mai", "Jun", "Jul", "Ago", "Set", "Out"]
  const base = height - 18
  ctx.strokeStyle = "#999"
  ctx.beginPath()
  ctx.moveTo(24, 22)
  ctx.lineTo(24, base)
  ctx.lineTo(width - 8, base)
  ctx.stroke()
  values.forEach((value, index) => {
    const bar = ((base - 28) * value) / 70
    const x = 34 + index * ((width - 44) / values.length)
    ctx.fillStyle = index === 3 ? "#d9480f" : "#4c6ef5"
    ctx.fillRect(x, base - bar, 16, bar)
    uiText(ctx, String(value), x + 2, base - bar - 3, 6, "#333")
    uiText(ctx, months[index]!, x, base + 10, 6, "#555")
  })
}

function stamp(ctx: SKRSContext2D, width: number, height: number) {
  ctx.strokeStyle = "rgba(29, 78, 216, 0.75)"
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.arc(width / 2, height / 2, Math.min(width, height) / 2 - 4, 0, Math.PI * 2)
  ctx.stroke()
  ctx.lineWidth = 1.2
  ctx.beginPath()
  ctx.arc(width / 2, height / 2, Math.min(width, height) / 2 - 10, 0, Math.PI * 2)
  ctx.stroke()
  ctx.save()
  ctx.translate(width / 2, height / 2)
  ctx.rotate(-0.25)
  uiText(ctx, "CONFERIDO", -30, 4, 11, "rgba(29, 78, 216, 0.85)", true)
  ctx.restore()
}

// ---------- o documento ----------

const M = 56
const W = PAGE_WIDTH - 2 * M

function header(page: Page, pageNumber: number) {
  const ctx = page.ctx
  ctx.strokeStyle = "#333"
  ctx.lineWidth = 0.8
  ctx.strokeRect(M, 34, W, 44)
  ctx.beginPath()
  ctx.moveTo(M + 150, 34)
  ctx.lineTo(M + 150, 78)
  ctx.moveTo(M + W - 120, 34)
  ctx.lineTo(M + W - 120, 78)
  ctx.stroke()
  page.text("Operadora Exemplo", M + 10, 52, 11, true)
  page.text("Atendimento ao cliente", M + 10, 68, 8.5)
  page.text("INSTRUÇÃO DE TRABALHO", M + 166, 52, 11, true)
  page.text("Segunda via de fatura e contestação", M + 166, 68, 8.5)
  page.text("IT-TESTE-OCR-001", M + W - 112, 50, 8.5, true)
  page.text(`Revisão 03 · Página ${pageNumber} de 4`, M + W - 112, 66, 7.5)
}

function heading(page: Page, text: string, y: number) {
  page.text(text, M, y, 12.5, true, "#1d3a7a")
  return y + 20
}

function buildPages(): Page[] {
  const pages: Page[] = []

  // Página 1 — objetivo, quando usar e o primeiro passo com o print da consulta.
  const one = new Page()
  header(one, 1)
  let y = 110
  y = heading(one, "1. Objetivo", y)
  y = one.paragraph(
    "Orientar o atendimento na emissão da segunda via da fatura e no registro de contestação de cobrança, garantindo que o cliente saia da ligação com o boleto ou o protocolo em mãos.",
    M,
    y,
    W,
  )
  y += 8
  y = heading(one, "2. Quando usar", y)
  for (const item of [
    "O cliente não recebeu a fatura ou perdeu o boleto.",
    "O cliente discorda de um valor cobrado na fatura do mês.",
    "O cliente pede o código de barras ou o PIX para pagar hoje.",
  ]) {
    one.text("•", M + 4, y)
    y = one.paragraph(item, M + 16, y, W - 16)
  }
  y += 8
  y = heading(one, "3. Passo a passo", y)
  y = one.paragraph("Passo 1. Abra a Consulta de cliente e pesquise pelo CPF ou pelo número da linha. Confirme o nome completo com o cliente antes de seguir.", M, y, W)
  y += 4
  one.print("Figura 1 — tela de consulta do cliente", M, y, W, 190, (ctx) => screenCustomer(ctx, W, 190))
  y += 204
  one.text("Figura 1 — Tela de consulta do cliente no portal de atendimento.", M, y, 8.5)
  y += 22
  one.paragraph("Se a busca não encontrar o cliente, confira se o documento foi digitado sem pontos e tente pelo número da linha com o DDD.", M, y, W)
  pages.push(one)

  // Página 2 — faturas (print largo) e foto de celular ao lado do texto, aviso em caixa.
  const two = new Page()
  header(two, 2)
  y = 110
  y = two.paragraph(
    "Passo 2. No menu Faturas, localize o mês pedido. A fatura em aberto aparece destacada em amarelo; o valor e o vencimento devem ser lidos para o cliente.",
    M,
    y,
    W,
  )
  y += 4
  two.print("Figura 2 — tela de faturas", M, y, W, 150, (ctx) => screenInvoices(ctx, W, 150))
  y += 164
  two.text("Figura 2 — Lista de faturas com a do mês em aberto destacada.", M, y, 8.5)
  y += 26
  const photoWidth = 170
  two.print("Figura 3 — foto do celular do cliente", M, y, photoWidth, 200, (ctx) => phonePhoto(ctx, photoWidth, 200))
  const sideX = M + photoWidth + 16
  const afterFirst = two.paragraph("Passo 3. Clique em Gerar 2ª via e escolha o envio por SMS ou por e-mail. O cliente recebe o link na hora, como na foto ao lado.", sideX, y + 10, W - photoWidth - 16)
  two.paragraph("Leia o código de barras só se o cliente pedir. Nunca informe o valor de faturas de outra linha, mesmo que seja do mesmo titular.", sideX, afterFirst + 6, W - photoWidth - 16)
  y += 214
  two.text("Figura 3 — Mensagem da 2ª via recebida no celular.", M, y, 8.5)
  y += 24
  two.ctx.fillStyle = "#fff4e5"
  two.ctx.fillRect(M, y, W, 58)
  two.ctx.strokeStyle = "#d97706"
  two.ctx.lineWidth = 1.2
  two.ctx.strokeRect(M, y, W, 58)
  two.text("Atenção:", M + 10, y + 18, 10.5, true, "#92400e")
  two.paragraph("a 2ª via não altera o vencimento. Se a fatura já venceu, informe que multa e juros aparecem na próxima conta.", M + 10, y + 34, W - 20)
  pages.push(two)

  // Página 3 — tabela com grade, passo 4 com o diálogo e gráfico ao lado.
  const three = new Page()
  header(three, 3)
  y = 110
  y = heading(three, "4. Contestação de valor", y)
  y = three.paragraph("Use a tabela abaixo para saber o prazo e quem aprova cada tipo de contestação.", M, y, W)
  y += 4
  const cols = [M, M + 190, M + 300, M + W]
  const tableRows = [
    ["Motivo", "Prazo", "Quem aprova"],
    ["Serviço não contratado", "5 dias úteis", "Retenção"],
    ["Cobrança em duplicidade", "3 dias úteis", "Faturamento"],
    ["Desconto não aplicado", "7 dias úteis", "Supervisão"],
    ["Roaming internacional", "10 dias úteis", "Faturamento"],
  ]
  three.ctx.strokeStyle = "#333"
  three.ctx.lineWidth = 0.7
  tableRows.forEach((row, index) => {
    const top = y + index * 20
    if (index === 0) {
      three.ctx.fillStyle = "#e8edf7"
      three.ctx.fillRect(M, top, W, 20)
    }
    row.forEach((cell, column) => three.text(cell, cols[column]! + 6, top + 14, 9.5, index === 0))
    three.ctx.strokeRect(M, top, W, 20)
  })
  for (const x of cols.slice(1, -1)) {
    three.ctx.beginPath()
    three.ctx.moveTo(x, y)
    three.ctx.lineTo(x, y + tableRows.length * 20)
    three.ctx.stroke()
  }
  y += tableRows.length * 20 + 20
  y = three.paragraph(
    "Passo 4. Em Contestar valor, escolha o motivo, descreva o que o cliente relatou e confirme. O sistema mostra o protocolo, que deve ser lido em voz alta.",
    M,
    y,
    W,
  )
  y += 4
  const dialogWidth = 270
  three.print("Figura 4 — diálogo de contestação registrada", M, y, dialogWidth, 120, (ctx) => screenDialog(ctx, dialogWidth, 120))
  three.print("Figura 5 — gráfico de contestações por mês", M + dialogWidth + 14, y, W - dialogWidth - 14, 120, (ctx) => barChart(ctx, W - dialogWidth - 14, 120))
  y += 134
  three.text("Figuras 4 e 5 — Protocolo gerado e volume de contestações no semestre.", M, y, 8.5)
  y += 24
  three.paragraph("Em agosto houve mais contestações por causa do reajuste anual. Se o cliente citar o reajuste, explique a regra antes de abrir a contestação.", M, y, W)
  pages.push(three)

  // Página 4 — encerramento, só texto, com carimbo e assinatura.
  const four = new Page()
  header(four, 4)
  y = 110
  y = heading(four, "5. Encerramento do atendimento", y)
  for (const item of [
    "Confirme se o cliente recebeu o SMS ou o e-mail com a 2ª via.",
    "Informe o número do protocolo e o prazo de resposta da contestação.",
    "Pergunte se há mais alguma dúvida e registre a tabulação Fatura › 2ª via.",
    "Agradeça o contato pelo nome do cliente.",
  ]) {
    four.text("•", M + 4, y)
    y = four.paragraph(item, M + 16, y, W - 16)
  }
  y += 10
  y = heading(four, "6. Histórico de revisões", y)
  for (const line of ["Rev. 01 — criação do procedimento.", "Rev. 02 — inclusão do envio por e-mail.", "Rev. 03 — prazos de contestação atualizados conforme a tabela da seção 4."])
    y = four.paragraph(line, M, y, W)
  y += 30
  four.ctx.strokeStyle = "#333"
  four.ctx.beginPath()
  four.ctx.moveTo(M, y + 40)
  four.ctx.lineTo(M + 200, y + 40)
  four.ctx.stroke()
  // Assinatura "à mão": rabisco que não é texto nem print.
  four.ctx.strokeStyle = "#1e3a8a"
  four.ctx.lineWidth = 1.3
  four.ctx.beginPath()
  four.ctx.moveTo(M + 20, y + 34)
  for (let step = 0; step <= 40; step += 1) four.ctx.lineTo(M + 20 + step * 4, y + 30 - Math.sin(step / 2.2) * 9 - (step % 7))
  four.ctx.stroke()
  four.text("Coordenação de Qualidade", M, y + 54, 9)
  four.print("Carimbo de conferência", M + W - 120, y - 6, 110, 110, (ctx) => stamp(ctx, 110, 110))
  pages.push(four)
  return pages
}

// ---------- o "scanner" ----------

type Placement = { x: number; y: number; width: number; height: number }
type Scan = {
  jpeg: Buffer
  width: number
  height: number
  transform: (box: OcrBox) => OcrBox
}

function scan(page: Page, index: number, gray: boolean, placement: Placement, clean = false): Scan {
  let seed = 11 + index * 97
  const random = () => (seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff) / 0x7fffffff
  const width = page.canvas.width
  const height = page.canvas.height
  const out = createCanvas(width, height)
  const ctx = out.getContext("2d")
  ctx.fillStyle = gray ? "#efefef" : "#f6f2e7"
  ctx.fillRect(0, 0, width, height)
  const angle = ((index % 2 === 0 ? 1 : -1) * (0.35 + index * 0.15) * Math.PI) / 180
  const shiftX = 6 + index * 3
  const shiftY = 9 - index * 2
  ctx.save()
  ctx.translate(width / 2 + shiftX, height / 2 + shiftY)
  ctx.rotate(angle)
  ctx.filter = "blur(0.7px)"
  ctx.globalCompositeOperation = "multiply"
  ctx.drawImage(page.canvas, -width / 2, -height / 2)
  ctx.restore()
  // Sombra da lombada à esquerda e borda escura do vidro (não no scanner "limpo").
  if (!clean) {
    const shadow = ctx.createLinearGradient(0, 0, width * 0.06, 0)
    shadow.addColorStop(0, "rgba(0,0,0,0.35)")
    shadow.addColorStop(1, "rgba(0,0,0,0)")
    ctx.fillStyle = shadow
    ctx.fillRect(0, 0, width * 0.06, height)
    // Poeira e pontinhos.
    for (let dot = 0; dot < 220; dot += 1) {
      ctx.fillStyle = `rgba(0,0,0,${0.15 + random() * 0.45})`
      ctx.beginPath()
      ctx.arc(random() * width, random() * height, 0.4 + random() * 1.4, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  const image = ctx.getImageData(0, 0, width, height)
  const data = image.data
  for (let pixel = 0; pixel < data.length; pixel += 4) {
    const noise = (random() - 0.5) * 22
    if (gray) {
      const value = Math.max(0, Math.min(255, 0.299 * data[pixel]! + 0.587 * data[pixel + 1]! + 0.114 * data[pixel + 2]! + noise))
      data[pixel] = data[pixel + 1] = data[pixel + 2] = value
    } else {
      for (let channel = 0; channel < 3; channel += 1) data[pixel + channel] = Math.max(0, Math.min(255, data[pixel + channel]! * 0.97 + noise))
    }
  }
  ctx.putImageData(image, 0, 0)
  const jpeg = out.encodeSync("jpeg", gray ? 62 : 70)
  // Pontos da página original → pontos da página do PDF (rotação e deslocamento do scanner, depois a escala da colocação).
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const point = (px: number, py: number) => {
    const dx = px * K - width / 2
    const dy = py * K - height / 2
    const sx = dx * cos - dy * sin + width / 2 + shiftX
    const sy = dx * sin + dy * cos + height / 2 + shiftY
    return {
      x: placement.x + (sx / width) * placement.width,
      y: placement.y + (sy / height) * placement.height,
    }
  }
  const transform = (box: OcrBox): OcrBox => {
    const corners = [point(box.left, box.top), point(box.right, box.top), point(box.left, box.bottom), point(box.right, box.bottom)]
    return {
      left: Math.min(...corners.map((c) => c.x)),
      right: Math.max(...corners.map((c) => c.x)),
      top: Math.min(...corners.map((c) => c.y)),
      bottom: Math.max(...corners.map((c) => c.y)),
    }
  }
  return { jpeg, width, height, transform }
}

/** Página com camada de texto (variante mista): o mesmo conteúdo como PDF exportado, com os prints como imagens. */
function vectorPage(page: Page): FixturePage {
  const ops: FixtureOp[] = page.drawn.runs.map((run) => ({
    kind: "text",
    x: run.x,
    y: run.y,
    text: run.text,
    size: run.size,
    font: run.bold ? "bold" : "regular",
  }))
  for (const print of page.drawn.prints) {
    const left = Math.round(print.left * K)
    const top = Math.round(print.top * K)
    const w = Math.round((print.right - print.left) * K)
    const h = Math.round((print.bottom - print.top) * K)
    const crop = createCanvas(w, h)
    crop.getContext("2d").drawImage(page.canvas, left, top, w, h, 0, 0, w, h)
    ops.push({
      kind: "image",
      x: print.left,
      y: print.top,
      width: print.right - print.left,
      height: print.bottom - print.top,
      image: {
        format: "jpeg",
        data: crop.encodeSync("jpeg", 85),
        width: w,
        height: h,
      },
    })
  }
  return ops
}

type Variant = "pagina-inteira" | "limpo" | "com-margem" | "misto"
type PageTruth = {
  page: number
  scanned: boolean
  words: TruthWord[]
  prints: (OcrBox & { label: string })[]
}

function buildVariant(pages: Page[], variant: Variant): { pdf: Buffer; truth: PageTruth[] } {
  const full: Placement = {
    x: 0,
    y: 0,
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
  }
  const margin: Placement = { x: 50, y: 62, width: 495, height: 700 }
  const fixturePages: FixturePage[] = []
  const truth: PageTruth[] = []
  pages.forEach((page, index) => {
    const words = page.truthWords()
    if (variant === "misto" && index % 2 === 0) {
      fixturePages.push(vectorPage(page))
      truth.push({
        page: index + 1,
        scanned: false,
        words,
        prints: page.drawn.prints,
      })
      return
    }
    const placement = variant === "com-margem" ? margin : full
    const scanned = scan(page, index, index % 2 === 1, placement, variant === "limpo")
    fixturePages.push([
      {
        kind: "image",
        ...placement,
        image: {
          format: "jpeg",
          data: scanned.jpeg,
          width: scanned.width,
          height: scanned.height,
        },
      },
    ])
    truth.push({
      page: index + 1,
      scanned: true,
      words: words.map((word) => ({
        ...scanned.transform(word),
        text: word.text,
      })),
      prints: page.drawn.prints.map((print) => ({
        ...scanned.transform(print),
        label: print.label,
      })),
    })
  })
  return { pdf: buildFixturePdf(fixturePages), truth }
}

const pct = (part: number, whole: number) => (whole > 0 ? `${((100 * part) / whole).toFixed(1)}%` : "—")

async function main() {
  mkdirSync(output!, { recursive: true })
  const pages = buildPages()
  const variants: Variant[] = ["pagina-inteira", "limpo", "com-margem", "misto"]
  const built = variants.map((variant) => ({
    variant,
    ...buildVariant(pages, variant),
  }))
  for (const { variant, pdf } of built) writeFileSync(join(output!, `IT-TESTE-OCR-001-${variant}.pdf`), pdf)
  for (const [index, page] of pages.entries()) writeFileSync(join(output!, `original-p${index + 1}.png`), page.canvas.encodeSync("png"))
  writeFileSync(join(output!, "gabarito.json"), JSON.stringify(Object.fromEntries(built.map(({ variant, truth }) => [variant, truth])), null, 2))
  console.log(`PDFs em ${output}`)
  if (args.includes("--sem-avaliar")) return

  const engine = createOcrEngine()
  const lines = [
    "# OCR no PDF digitalizado de teste (IT-TESTE-OCR-001)",
    "",
    `Regras: ${PDF_PRINT_RULE.version} (digitalização), ${PDF_EMBEDDED_PRINT_RULE.version} (imagens do PDF). Gerado em ${new Date().toISOString()}.`,
    "",
    "| Variante | Página | Páginas no OCR (envio) | Origem dos prints | Palavras lidas | Acentos | Texto real cortado | Palavras a mais | Prints achados | Cortes errados | Conferir |",
    "| --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
  ]
  try {
    for (const { variant, pdf, truth } of built) {
      process.stdout.write(`${variant}… `)
      const scannedPages = (await extractKnowledgeFile(pdf, "PDF")).scannedPages ?? []
      const result = await readScannedPages(pdf, scannedPages, engine)
      const scores: PageScore[] = []
      for (const page of result.pages) {
        const expected = truth[page.page - 1]!
        const outsidePrints = (box: OcrBox) =>
          !expected.prints.some((print) => {
            const cx = (box.left + box.right) / 2
            const cy = (box.top + box.bottom) / 2
            return cx >= print.left && cx <= print.right && cy >= print.top && cy <= print.bottom
          })
        const read = wordsOf({
          lines: page.lines.map((line) => ({
            ...line,
            words: line.words.filter(
              (word) =>
                !page.prints.some((print) => {
                  const cx = (word.left + word.right) / 2
                  const cy = (word.top + word.bottom) / 2
                  return cx >= print.left && cx <= print.right && cy >= print.top && cy <= print.bottom
                }),
            ),
          })),
        })
        const score = scorePage(expected.words.filter(outsidePrints), expected.prints, read, page.prints)
        scores.push(score)
        const review = result.reviews.find((entry) => entry.page === page.page)?.reasons.join("+") ?? "—"
        lines.push(
          `| ${variant} | ${page.page} | sim | ${page.source} | ${score.wordsRead}/${score.truthWords} (${pct(score.wordsRead, score.truthWords)}) | ${score.accentsRight}/${score.accentedTruth} | ${score.realWordsCut} | ${score.extraWords} | ${score.printsFound}/${score.truthPrints} | ${score.falsePrints} | ${review} |`,
        )
      }
      for (const expected of truth)
        if (!scannedPages.includes(expected.page)) lines.push(`| ${variant} | ${expected.page} | não (camada de texto) | — | — | — | — | — | — | — | — |`)
      const total = scores.length > 0 ? sumScores(scores) : null
      if (total)
        lines.push(
          `| **${variant}** | **total** | | | **${pct(total.wordsRead, total.truthWords)}** | ${total.accentsRight}/${total.accentedTruth} | **${total.realWordsCut}** | ${total.extraWords} | **${total.printsFound}/${total.truthPrints}** | ${total.falsePrints} | |`,
        )
      console.log(total ? `lido ${pct(total.wordsRead, total.truthWords)}, cortado ${total.realWordsCut}, prints ${total.printsFound}/${total.truthPrints}` : "sem páginas no OCR")
    }
  } finally {
    await engine.close()
  }
  lines.push("", "Texto real cortado = palavra do documento (fora dos prints) que o leitor tomou por print e tirou do texto: é a falha grave.")
  writeFileSync(join(output!, "relatorio.md"), lines.join("\n") + "\n")
  console.log(`Relatório: ${join(output!, "relatorio.md")}`)
}

await main()
process.exit(0)
