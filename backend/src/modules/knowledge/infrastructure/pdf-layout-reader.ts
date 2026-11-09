import { getDocument, OPS, Util } from "pdfjs-dist/legacy/build/pdf.mjs"
import type { PDFPageProxy } from "pdfjs-dist/types/src/display/api.js"
import type { PdfPageLayout, PdfRule, PdfRun, PdfRunHint } from "../domain/pdf-markdown/layout.js"

/**
 * Lê do PDF o que o conversor usa, pelo pdf.js que o `pdf-parse` já traz (mesma versão, mesmo módulo que ele carrega). `getTable` do
 * pdf-parse não serve aqui: nos manuais reais ele achou 0 tabelas (a borda é retângulo preenchido, e ele só olha traços) e leu caixas de
 * diagrama como tabela de uma coluna. Nada aqui altera o arquivo. Falha na grade ou nas tags de uma página nunca derruba a leitura do texto.
 */
type Matrix = [number, number, number, number, number, number]
type TextItemLike = { str: string; transform: number[]; width: number; height: number; fontName: string; hasEOL?: boolean }
type MarkedLike = { type: string; id?: string; tag?: string }

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]
const THIN = 2.5
const MIN_LENGTH = 8
const MAX_PATHS_READ = 20_000

const isBoldFont = (font: { name?: string; bold?: boolean; black?: boolean } | null) => Boolean(font?.bold || font?.black || /(bold|black|heavy|semibold|demi)/i.test(font?.name ?? ""))
const isMonoFont = (font: { name?: string; isMonospace?: boolean } | null) => Boolean(font?.isMonospace || /(mono|courier|consolas|menlo|monaco)/i.test(font?.name ?? ""))

function ruleOf(x0: number, y0: number, x1: number, y1: number): PdfRule | null {
  const width = Math.abs(x1 - x0)
  const height = Math.abs(y1 - y0)
  if (width >= MIN_LENGTH && height <= THIN) return { orientation: "H", at: (y0 + y1) / 2, from: Math.min(x0, x1), to: Math.max(x0, x1) }
  if (height >= MIN_LENGTH && width <= THIN) return { orientation: "V", at: (x0 + x1) / 2, from: Math.min(y0, y1), to: Math.max(y0, y1) }
  return null
}

/** Traços de um caminho do pdf.js: [0=moveTo, 1=lineTo, 2=curveTo, 3=quadraticCurveTo, 4=closePath], em coordenadas do usuário. */
function rulesOfPath(data: ArrayLike<number>, stroked: boolean, toPage: (x: number, y: number) => [number, number]): PdfRule[] {
  const rules: PdfRule[] = []
  const points: [number, number][] = []
  const flush = () => {
    if (points.length === 0) return
    const xs = points.map((point) => point[0])
    const ys = points.map((point) => point[1])
    const left = Math.min(...xs)
    const right = Math.max(...xs)
    const top = Math.min(...ys)
    const bottom = Math.max(...ys)
    // Retângulo fino preenchido é uma borda; retângulo traçado são quatro.
    const single = ruleOf(left, top, right, bottom)
    if (single && (points.length <= 2 || !stroked || Math.min(right - left, bottom - top) <= THIN)) rules.push(single)
    else if (stroked && points.length >= 4) {
      for (const edge of [ruleOf(left, top, right, top), ruleOf(left, bottom, right, bottom), ruleOf(left, top, left, bottom), ruleOf(right, top, right, bottom)]) if (edge) rules.push(edge)
    }
    points.length = 0
  }
  let index = 0
  while (index < data.length) {
    const op = data[index]!
    if (op === 0) {
      flush()
      points.push(toPage(data[index + 1]!, data[index + 2]!))
      index += 3
    } else if (op === 1) {
      points.push(toPage(data[index + 1]!, data[index + 2]!))
      index += 3
    } else if (op === 2) index += 7
    else if (op === 3) index += 5
    else index += 1
  }
  flush()
  return rules
}

/**
 * Traços, imagens e desenhos da página. O PDF é aberto sem decodificar imagens (ver `readPdfLayout`): a operação de pintar a imagem some da lista,
 * mas a matriz que a posiciona fica (`q … cm /Im Do Q` vira `save, transform, restore`). Uma matriz que não pintou nada e cobre uma área real
 * da página é a imagem. Matrizes vazias que alguns geradores deixam têm escala de 1 ponto e não chegam ao mínimo de área.
 */
const MIN_IMAGE_SHARE = 0.005

async function readDrawing(page: PDFPageProxy, viewportTransform: number[], pageArea: number): Promise<{ rules: PdfRule[]; imageShare: number; imageCount: number; drawnPaths: number }> {
  const operators = await page.getOperatorList()
  const rules: PdfRule[] = []
  let matrix: Matrix = IDENTITY
  const stack: Matrix[] = []
  let imageArea = 0
  let imageCount = 0
  let drawnPaths = 0
  /** Área da última matriz aplicada, enquanto nada foi pintado com ela. */
  let pendingArea = 0
  const areaOf = (): number => {
    const full = Util.transform(viewportTransform, matrix)
    return Math.abs(full[0] * full[3] - full[1] * full[2])
  }
  const toPage = (x: number, y: number): [number, number] => {
    const full = Util.transform(viewportTransform, matrix)
    return [full[0] * x + full[2] * y + full[4], full[1] * x + full[3] * y + full[5]]
  }
  for (let index = 0; index < operators.fnArray.length; index += 1) {
    const fn = operators.fnArray[index]
    const args = operators.argsArray[index] as unknown[] | null
    if (fn === OPS.save) {
      stack.push(matrix)
      pendingArea = 0
    } else if (fn === OPS.restore) {
      if (pendingArea >= pageArea * MIN_IMAGE_SHARE) {
        imageCount += 1
        imageArea += pendingArea
      }
      pendingArea = 0
      matrix = stack.pop() ?? matrix
    } else if (fn === OPS.transform && args) {
      matrix = Util.transform(matrix, args as number[]) as Matrix
      pendingArea = areaOf()
    } else if (fn === OPS.paintFormXObjectBegin && args) {
      stack.push(matrix)
      pendingArea = 0
      if (Array.isArray(args[0]) || ArrayBuffer.isView(args[0])) matrix = Util.transform(matrix, Array.from(args[0] as ArrayLike<number>)) as Matrix
    } else if (fn === OPS.paintFormXObjectEnd) {
      pendingArea = 0
      matrix = stack.pop() ?? matrix
    } else if (fn === OPS.showText || fn === OPS.showSpacedText || fn === OPS.nextLineShowText || fn === OPS.nextLineSetSpacingShowText) {
      pendingArea = 0
    } else if (fn === OPS.constructPath && args) {
      drawnPaths += 1
      const op = args[0]
      if (op !== OPS.endPath) pendingArea = 0
      const stroked = op === OPS.stroke || op === OPS.closeStroke || op === OPS.fillStroke || op === OPS.eoFillStroke || op === OPS.closeFillStroke || op === OPS.closeEOFillStroke
      const filled = op === OPS.fill || op === OPS.eoFill || stroked
      const data = (args[1] as unknown[] | undefined)?.[0] as ArrayLike<number> | undefined
      if (filled && data && drawnPaths <= MAX_PATHS_READ) rules.push(...rulesOfPath(data, stroked, toPage))
    } else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageXObjectRepeat || fn === OPS.paintImageMaskXObject) {
      // Imagem decodificada (só no modo de conferência): ocupa o quadrado unitário das coordenadas correntes.
      imageCount += 1
      imageArea += areaOf()
      pendingArea = 0
    }
  }
  return { rules, imageShare: pageArea > 0 ? Math.min(1, imageArea / pageArea) : 0, imageCount, drawnPaths }
}

type StructNode = { role?: string; type?: string; id?: string; children?: StructNode[] }

/** O que a árvore de estrutura do PDF diz sobre cada trecho marcado da página. Sem árvore (PDF sem tags), nada. */
async function readStructure(page: PDFPageProxy): Promise<Map<string, PdfRunHint>> {
  const hints = new Map<string, PdfRunHint>()
  const tree = (await page.getStructTree().catch(() => null)) as StructNode | null
  if (!tree) return hints
  let nextId = 0
  const walk = (node: StructNode, inherited: PdfRunHint | null, listDepth: number, table: { id: string; row: number; col: number; rows: { value: number } } | null) => {
    if (node.type === "content" && node.id) {
      if (inherited) hints.set(node.id, inherited)
      return
    }
    const role = node.role ?? ""
    let hint = inherited
    let nextTable = table
    let nextList = listDepth
    const heading = /^H([1-6])$/.exec(role)
    if (heading) hint = { kind: "HEADING", level: Number(heading[1]), blockId: `h${(nextId += 1)}` }
    else if (role === "H") hint = { kind: "HEADING", level: 2, blockId: `h${(nextId += 1)}` }
    else if (role === "Code" && !inherited) hint = { kind: "CODE", blockId: `c${(nextId += 1)}` }
    else if (role === "L") nextList = listDepth + 1
    else if (role === "LI") hint = { kind: "LIST_ITEM", depth: Math.max(0, listDepth - 1), blockId: `l${(nextId += 1)}` }
    else if (role === "Table") nextTable = { id: `t${(nextId += 1)}`, row: -1, col: -1, rows: { value: 0 } }
    else if (role === "TR" && nextTable) {
      nextTable = { ...nextTable, row: nextTable.rows.value, col: 0 }
      nextTable.rows.value += 1
      let column = 0
      for (const child of node.children ?? []) {
        const header = child.role === "TH"
        const cell: PdfRunHint = { kind: "TABLE_CELL", tableId: nextTable.id, row: nextTable.row, col: column, header }
        walk(child, cell, nextList, nextTable)
        column += 1
      }
      return
    }
    for (const child of node.children ?? []) walk(child, hint, nextList, nextTable)
  }
  walk(tree, null, 0, null)
  return hints
}

const fontOf = (page: PDFPageProxy, fontName: string): { name?: string; bold?: boolean; black?: boolean; isMonospace?: boolean } | null => {
  try {
    return page.commonObjs.has(fontName) ? (page.commonObjs.get(fontName) as { name?: string; bold?: boolean; black?: boolean; isMonospace?: boolean }) : null
  } catch {
    return null
  }
}

async function readPage(page: PDFPageProxy): Promise<PdfPageLayout> {
  const viewport = page.getViewport({ scale: 1 })
  const content = await page.getTextContent({ includeMarkedContent: true })
  const hints = await readStructure(page).catch(() => new Map<string, PdfRunHint>())
  // As fontes só ficam disponíveis depois da lista de operações; por isso ela vem antes de montar o texto.
  const drawing = await readDrawing(page, viewport.transform, viewport.width * viewport.height).catch(() => ({ rules: [] as PdfRule[], imageShare: 0, imageCount: 0, drawnPaths: 0 }))
  const runs: PdfRun[] = []
  const marks: (string | null)[] = []
  for (const item of content.items as (TextItemLike | MarkedLike)[]) {
    if ("type" in item) {
      if (item.type === "beginMarkedContentProps" || item.type === "beginMarkedContent") marks.push(item.id ?? null)
      else if (item.type === "endMarkedContent") marks.pop()
      continue
    }
    if (!item.str) continue
    const [x, y] = viewport.convertToViewportPoint(item.transform[4]!, item.transform[5]!) as [number, number]
    const font = fontOf(page, item.fontName)
    const markId = [...marks].reverse().find((id) => id && hints.has(id)) ?? null
    runs.push({
      text: item.str,
      x,
      y,
      width: item.width,
      fontSize: item.height,
      bold: isBoldFont(font),
      mono: isMonoFont(font),
      rotated: Math.abs(item.transform[1]!) > Math.abs(item.transform[0]!) * 0.1,
      hint: markId ? hints.get(markId)! : null,
    })
  }
  return { page: page.pageNumber, width: viewport.width, height: viewport.height, runs, ...drawing, tagged: hints.size > 0 }
}

/**
 * `decodeImages` só existe para a prova de que a detecção sem decodificar dá o mesmo resultado. Em produção as imagens não são decodificadas: isso
 * era 90% do tempo (9,5 s × 1,7 s num manual de 74 páginas), e nada do que é lido depende dos pixels. O pdf.js no Node trabalha na mesma thread e
 * só em microtarefas: sem a pausa entre as páginas, a API inteira ficaria sem atender ninguém durante a leitura.
 */
export async function readPdfLayout(buffer: Buffer, options: { decodeImages?: boolean } = {}): Promise<PdfPageLayout[]> {
  // O pdf.js fica com o buffer que recebe: uma cópia mantém o arquivo a ser gravado intacto.
  const document = await getDocument({ data: new Uint8Array(buffer), verbosity: 0, isEvalSupported: false, ...(options.decodeImages ? {} : { maxImageSize: 1 }) }).promise
  try {
    const pages: PdfPageLayout[] = []
    for (let number = 1; number <= document.numPages; number += 1) {
      const page = await document.getPage(number)
      pages.push(await readPage(page))
      page.cleanup()
      await new Promise((resume) => setImmediate(resume))
    }
    return pages
  } finally {
    await document.destroy()
  }
}
