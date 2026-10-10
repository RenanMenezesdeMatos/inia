/**
 * Layout determinístico do organograma da aba "Minha estrutura": UM gestor imediato acima, a
 * pessoa focal no centro e os subordinados diretos abaixo, em linhas balanceadas. É uma função
 * pura (payload + alturas medidas → posições), sem motor de layout externo: a estrutura é sempre
 * "1 gestor · 1 focal · N filhos diretos", então dagre/ELK seriam peso sem ganho. Nenhuma regra
 * de permissão vive aqui — o backend decide capabilities; o layout só posiciona.
 *
 * Coordenadas: o centro lógico é x = 0 (a focal e o gestor ficam centralizados nele); y cresce
 * para baixo. Alturas vêm medidas do React Flow quando existem (o card selecionado cresce PARA
 * BAIXO) e caem para estimativas antes da primeira medição — por isso o layout é recalculado a
 * cada mudança de dimensão, e uma linha mais alta empurra as seguintes, nunca sobrepõe.
 */
export const NODE_WIDTH = {
  manager: 288,
  focal: 400,
  report: 300,
} as const

/** Alturas estimadas antes da medição real (compacto ≈ header; expandido ≈ header + detalhes). */
export const ESTIMATED_HEIGHT = {
  manager: 76,
  focalExpanded: 250,
  focalCompact: 92,
  report: 84,
  reportExpanded: 300,
} as const

export const LAYOUT_GAP = {
  /** Entre cards da mesma linha. */
  column: 24,
  /** Entre linhas de subordinados. */
  row: 40,
  /** Gestor → focal (o conector vertical). */
  managerToFocal: 56,
  /** Focal → primeira linha de subordinados (o conector desce, vira barra e desce de novo). */
  focalToReports: 72,
  /** Distância da barra horizontal ao topo dos cards da linha. */
  busToRow: 28,
  /** Distância do tronco vertical (linhas 2+) à borda esquerda da linha mais larga. */
  trunkInset: 28,
} as const

export type LayoutNodeInput = { id: string; height: number }

export type OrganizationLayoutInput = {
  manager: LayoutNodeInput | null
  focal: LayoutNodeInput
  reports: LayoutNodeInput[]
}

export type LayoutPosition = { x: number; y: number }

export type OrganizationLayout = {
  positions: Map<string, LayoutPosition>
  /** Ids por linha, na ordem de entrada (linhas balanceadas: as primeiras recebem o excedente). */
  rows: string[][]
  /** y da barra horizontal de cada linha (linha 0 = a que recebe o conector direto da focal). */
  busY: number[]
  /** x do tronco vertical que liga a barra da linha 0 às barras das linhas seguintes; null com uma linha só. */
  trunkX: number | null
  /** Caixa total ocupada (útil para testes e para o fitView). */
  bounds: { minX: number; maxX: number; minY: number; maxY: number }
}

/**
 * Quantas colunas uma linha recebe: até 4 filhos cabem numa linha; depois o objetivo é uma caixa
 * de proporção confortável (nem uma fileira quilométrica, nem uma coluna alta) — 5–8 → 2 linhas,
 * 9–15 → 3 linhas, 16+ → ~√(n×1,6) colunas limitadas a [5, 6] (6 colunas ≈ 1.600px: a linha
 * inteira ainda cabe legível num canvas de 1.200px com zoom ≈ 0,62). `maxColumns` é o teto do
 * chamador (2 em telas estreitas → árvore vertical).
 */
export function columnsFor(count: number, maxColumns = 6): number {
  const columns = count <= 4 ? Math.max(count, 0) : count <= 8 ? Math.ceil(count / 2) : count <= 15 ? Math.ceil(count / 3) : Math.min(6, Math.max(5, Math.ceil(Math.sqrt(count * 1.6))))
  return count === 0 ? 0 : Math.max(1, Math.min(columns, maxColumns))
}

/** Divide os ids em linhas balanceadas: `rows = ceil(n / cols)`, e o excedente vai para as primeiras linhas. */
export function balancedRows<T>(items: T[], columns: number): T[][] {
  if (items.length === 0 || columns <= 0) return []
  const rowCount = Math.ceil(items.length / columns)
  const base = Math.floor(items.length / rowCount)
  const extra = items.length % rowCount
  const rows: T[][] = []
  let cursor = 0
  for (let row = 0; row < rowCount; row += 1) {
    const size = base + (row < extra ? 1 : 0)
    rows.push(items.slice(cursor, cursor + size))
    cursor += size
  }
  return rows
}

export type OrganizationLayoutOptions = {
  /** Teto de colunas por linha — telas estreitas (mobile) usam 2, para a árvore ficar vertical. */
  maxColumns?: number
}

export function layoutOrganization(input: OrganizationLayoutInput, options: OrganizationLayoutOptions = {}): OrganizationLayout {
  const positions = new Map<string, LayoutPosition>()
  let cursorY = 0

  if (input.manager) {
    positions.set(input.manager.id, { x: -NODE_WIDTH.manager / 2, y: 0 })
    cursorY = input.manager.height + LAYOUT_GAP.managerToFocal
  }

  const focalY = cursorY
  positions.set(input.focal.id, { x: -NODE_WIDTH.focal / 2, y: focalY })
  cursorY = focalY + input.focal.height + LAYOUT_GAP.focalToReports

  const rows = balancedRows(input.reports, columnsFor(input.reports.length, options.maxColumns))
  const busY: number[] = []
  const widest = rows.reduce((max, row) => Math.max(max, rowWidth(row.length)), 0)
  const trunkX = rows.length > 1 ? -widest / 2 - LAYOUT_GAP.trunkInset : null

  for (const row of rows) {
    const width = rowWidth(row.length)
    const rowTop = cursorY
    busY.push(rowTop - LAYOUT_GAP.busToRow)
    row.forEach((node, index) => positions.set(node.id, { x: -width / 2 + index * (NODE_WIDTH.report + LAYOUT_GAP.column), y: rowTop }))
    const rowHeight = row.reduce((max, node) => Math.max(max, node.height), 0)
    cursorY = rowTop + rowHeight + LAYOUT_GAP.row + LAYOUT_GAP.busToRow
  }

  const allX = [...positions.values()].map((position) => position.x)
  const minX = Math.min(-NODE_WIDTH.focal / 2, trunkX ?? 0, ...allX)
  const maxX = Math.max(NODE_WIDTH.focal / 2, ...[...positions.entries()].map(([id, position]) => position.x + widthOf(input, id)))
  const maxY = Math.max(...[...positions.entries()].map(([id, position]) => position.y + heightOf(input, id)))

  return { positions, rows: rows.map((row) => row.map((node) => node.id)), busY, trunkX, bounds: { minX, maxX, minY: 0, maxY } }
}

function rowWidth(columns: number): number {
  return columns * NODE_WIDTH.report + Math.max(0, columns - 1) * LAYOUT_GAP.column
}

function widthOf(input: OrganizationLayoutInput, id: string): number {
  if (input.manager?.id === id) return NODE_WIDTH.manager
  if (input.focal.id === id) return NODE_WIDTH.focal
  return NODE_WIDTH.report
}

function heightOf(input: OrganizationLayoutInput, id: string): number {
  if (input.manager?.id === id) return input.manager.height
  if (input.focal.id === id) return input.focal.height
  return input.reports.find((node) => node.id === id)?.height ?? 0
}
