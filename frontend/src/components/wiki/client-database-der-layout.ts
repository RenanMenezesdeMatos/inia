import { CLIENT_INIA_REFERENCES, CLIENT_RELATIONS, CLIENT_TABLES, type ClientRelation, type ClientTableGroup } from "./client-database-tables"

/**
 * Geometria do DER das tabelas do banco do cliente: caixas, linhas e rotas, sem desenho. Tudo sai das definições das tabelas e
 * das relações, então uma coluna ou relação nova aparece aqui ou faz o teste falhar. As rotas são fixas para as linhas de
 * mesmo destino correrem juntas em uma faixa própria, e não cruzarem as caixas (o teste confere).
 */
const BOX_WIDTH = 232
const HEADER_HEIGHT = 28
const ROW_HEIGHT = 20
const BOX_GAP = 28
const TOP = 12

const COLUMN_A = 62
const COLUMN_B = 404
const COLUMN_C = 746
export const DER_WIDTH = 1010

const COLUMNS: { x: number; tables: string[] }[] = [
  { x: COLUMN_A, tables: ["grupos", "subgrupos", "metas", "fechamentos_mensais", "prv_mensal"] },
  { x: COLUMN_B, tables: ["colaboradores", "indicadores_diarios", "ausencias", "jornadas"] },
  { x: COLUMN_C, tables: ["chamadas", "transcricoes", "flags_chamada", "escalas", "excecoes_calendario"] },
]

type Side = "L" | "R"
type Route = { from: Side; to: Side; lane: number; entry: number }

const LANE = {
  metasToGroup: 10,
  subgroupToGroup: 22,
  metasToSubgroup: 34,
  toSubgroup: 46,
  employeeToGroup: 312,
  employeeToSubgroup: 330,
  metasToEmployee: 356,
  toEmployeeLeft: 380,
  manager: 654,
  toEmployeeRight: 700,
  toCall: 996,
} as const

/** Afasta linhas que chegam ao mesmo lado da mesma linha da tabela, para não ficarem sobrepostas. */
const ENTRY_OFFSET = 4

const ROUTES: Record<string, Route> = {
  "subgrupos.grupo>grupos": { from: "L", to: "L", lane: LANE.subgroupToGroup, entry: ENTRY_OFFSET },
  "colaboradores.grupo>grupos": { from: "L", to: "R", lane: LANE.employeeToGroup, entry: 0 },
  "colaboradores.subgrupo>subgrupos": { from: "L", to: "R", lane: LANE.employeeToSubgroup, entry: 0 },
  "colaboradores.gestor_matricula>colaboradores": { from: "R", to: "R", lane: LANE.manager, entry: -ENTRY_OFFSET },
  "chamadas.matricula>colaboradores": { from: "L", to: "R", lane: LANE.toEmployeeRight, entry: ENTRY_OFFSET },
  "transcricoes.id_chamada>chamadas": { from: "R", to: "R", lane: LANE.toCall, entry: 0 },
  "flags_chamada.id_chamada>chamadas": { from: "R", to: "R", lane: LANE.toCall, entry: 0 },
  "indicadores_diarios.matricula>colaboradores": { from: "L", to: "L", lane: LANE.toEmployeeLeft, entry: -ENTRY_OFFSET },
  "fechamentos_mensais.matricula>colaboradores": { from: "R", to: "L", lane: LANE.toEmployeeLeft, entry: -ENTRY_OFFSET },
  "fechamentos_mensais.subgrupo>subgrupos": { from: "L", to: "L", lane: LANE.toSubgroup, entry: -ENTRY_OFFSET },
  "metas.sujeito>grupos": { from: "L", to: "L", lane: LANE.metasToGroup, entry: -ENTRY_OFFSET },
  "metas.sujeito>subgrupos": { from: "L", to: "L", lane: LANE.metasToSubgroup, entry: ENTRY_OFFSET },
  "metas.sujeito>colaboradores": { from: "R", to: "L", lane: LANE.metasToEmployee, entry: ENTRY_OFFSET },
  "prv_mensal.matricula>colaboradores": { from: "R", to: "L", lane: LANE.toEmployeeLeft, entry: -ENTRY_OFFSET },
  "prv_mensal.subgrupo>subgrupos": { from: "L", to: "L", lane: LANE.toSubgroup, entry: -ENTRY_OFFSET },
  "ausencias.matricula>colaboradores": { from: "L", to: "L", lane: LANE.toEmployeeLeft, entry: -ENTRY_OFFSET },
  "escalas.matricula>colaboradores": { from: "L", to: "R", lane: LANE.toEmployeeRight, entry: ENTRY_OFFSET },
  "excecoes_calendario.matricula>colaboradores": { from: "L", to: "R", lane: LANE.toEmployeeRight, entry: ENTRY_OFFSET },
  "jornadas.matricula>colaboradores": { from: "L", to: "L", lane: LANE.toEmployeeLeft, entry: -ENTRY_OFFSET },
}

/** Cor da linha conforme o cadastro apontado, para o olho seguir cada família de relações. */
export type DerTone = "structure" | "people" | "call"
const TONE_OF_TARGET: Record<string, DerTone> = { grupos: "structure", subgrupos: "structure", colaboradores: "people", chamadas: "call" }

export type DerRow = { column: string; y: number; pk: boolean; fk: boolean; ref: boolean }
export type DerBox = { table: string; group: ClientTableGroup; need: string; x: number; y: number; width: number; height: number; rows: DerRow[] }
export type DerEdge = { id: string; relation: ClientRelation; tone: DerTone; conditional: boolean; points: [number, number][]; childDirection: 1 | -1; parentDirection: 1 | -1 }
export type DerLayout = { boxes: DerBox[]; edges: DerEdge[]; width: number; diagramHeight: number; height: number }

export const relationId = (relation: ClientRelation) => `${relation.table}.${relation.column}>${relation.targetTable}`

const LEGEND_HEIGHT = 104

export function buildClientDerLayout(): DerLayout {
  const boxes: DerBox[] = []
  for (const { x, tables } of COLUMNS) {
    let y = TOP
    for (const name of tables) {
      const table = CLIENT_TABLES.find((entry) => entry.name === name)
      if (!table) throw new Error(`Tabela do DER não existe: ${name}`)
      const rows = table.columns.map((column, index): DerRow => ({
        column: column.name,
        y: y + HEADER_HEIGHT + ROW_HEIGHT * index,
        pk: table.primaryKey.includes(column.name),
        fk: CLIENT_RELATIONS.some((relation) => relation.table === name && relation.column === column.name),
        ref: CLIENT_INIA_REFERENCES.some((reference) => reference.table === name && reference.column === column.name),
      }))
      const height = HEADER_HEIGHT + ROW_HEIGHT * rows.length
      boxes.push({ table: name, group: table.group, need: table.need, x, y, width: BOX_WIDTH, height, rows })
      y += height + BOX_GAP
    }
  }

  const rowCenter = (table: string, column: string) => {
    const box = boxes.find((entry) => entry.table === table)
    const row = box?.rows.find((entry) => entry.column === column)
    if (!box || !row) throw new Error(`Coluna do DER não existe: ${table}.${column}`)
    return { box, y: row.y + ROW_HEIGHT / 2 }
  }

  const edges = CLIENT_RELATIONS.map((relation): DerEdge => {
    const id = relationId(relation)
    const route = ROUTES[id]
    if (!route) throw new Error(`Relação sem rota no DER: ${id}`)
    const child = rowCenter(relation.table, relation.column)
    const parent = rowCenter(relation.targetTable, relation.targetColumn)
    const childX = route.from === "L" ? child.box.x : child.box.x + child.box.width
    const parentX = route.to === "L" ? parent.box.x : parent.box.x + parent.box.width
    const parentY = parent.y + route.entry
    return {
      id,
      relation,
      tone: TONE_OF_TARGET[relation.targetTable] ?? "people",
      conditional: Boolean(relation.condition),
      points: [[childX, child.y], [route.lane, child.y], [route.lane, parentY], [parentX, parentY]],
      childDirection: route.from === "L" ? -1 : 1,
      parentDirection: route.to === "L" ? -1 : 1,
    }
  })

  const diagramHeight = Math.max(...boxes.map((box) => box.y + box.height)) + 12
  return { boxes, edges, width: DER_WIDTH, diagramHeight, height: diagramHeight + LEGEND_HEIGHT }
}
