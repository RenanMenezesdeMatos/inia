import { describe, expect, it } from "vitest"

import { buildClientDerLayout, relationId } from "./client-database-der-layout"
import { CLIENT_RELATIONS, CLIENT_TABLES } from "./client-database-tables"

const layout = buildClientDerLayout()

const inside = (box: { x: number; y: number; width: number; height: number }, x: number, y: number) => x > box.x && x < box.x + box.width && y > box.y && y < box.y + box.height

describe("DER das tabelas do banco do cliente", () => {
  it("desenha cada tabela uma vez, com todas as colunas de negócio", () => {
    expect(layout.boxes.map((box) => box.table).sort()).toEqual(CLIENT_TABLES.map((table) => table.name).sort())
    for (const table of CLIENT_TABLES) {
      const box = layout.boxes.find((entry) => entry.table === table.name)!
      expect(box.rows.map((row) => row.column)).toEqual(table.columns.map((column) => column.name))
    }
  })

  it("marca a chave primária de cada tabela e toda coluna com relação", () => {
    for (const table of CLIENT_TABLES) {
      const box = layout.boxes.find((entry) => entry.table === table.name)!
      expect(box.rows.filter((row) => row.pk).map((row) => row.column).sort()).toEqual([...table.primaryKey].sort())
    }
    for (const relation of CLIENT_RELATIONS) {
      const box = layout.boxes.find((entry) => entry.table === relation.table)!
      expect(box.rows.find((row) => row.column === relation.column)?.fk, relationId(relation)).toBe(true)
    }
  })

  it("desenha uma linha para cada relação, da coluna da FK à coluna da PK", () => {
    expect(layout.edges.map((edge) => edge.id).sort()).toEqual(CLIENT_RELATIONS.map(relationId).sort())
    for (const edge of layout.edges) {
      const child = layout.boxes.find((box) => box.table === edge.relation.table)!
      const parent = layout.boxes.find((box) => box.table === edge.relation.targetTable)!
      const childRow = child.rows.find((row) => row.column === edge.relation.column)!
      const parentRow = parent.rows.find((row) => row.column === edge.relation.targetColumn)!
      const [start, , , end] = edge.points as [[number, number], [number, number], [number, number], [number, number]]
      expect([child.x, child.x + child.width], edge.id).toContain(start[0])
      expect(start[1], edge.id).toBe(childRow.y + 10)
      expect([parent.x, parent.x + parent.width], edge.id).toContain(end[0])
      expect(Math.abs(end[1] - (parentRow.y + 10)), edge.id).toBeLessThanOrEqual(4)
    }
  })

  it("nenhuma caixa encosta em outra", () => {
    for (const [index, first] of layout.boxes.entries()) {
      for (const second of layout.boxes.slice(index + 1)) {
        const apart = first.x + first.width <= second.x || second.x + second.width <= first.x || first.y + first.height <= second.y || second.y + second.height <= first.y
        expect(apart, `${first.table} × ${second.table}`).toBe(true)
      }
    }
  })

  it("nenhuma linha passa por dentro de uma caixa e todas ficam na área do desenho", () => {
    for (const edge of layout.edges) {
      for (let index = 0; index < edge.points.length - 1; index += 1) {
        const [x1, y1] = edge.points[index]!
        const [x2, y2] = edge.points[index + 1]!
        for (let step = 1; step < 40; step += 1) {
          const x = x1 + ((x2 - x1) * step) / 40
          const y = y1 + ((y2 - y1) * step) / 40
          expect(x, edge.id).toBeGreaterThanOrEqual(0)
          expect(x, edge.id).toBeLessThanOrEqual(layout.width)
          expect(y, edge.id).toBeLessThanOrEqual(layout.diagramHeight)
          for (const box of layout.boxes) expect(inside(box, x, y), `${edge.id} atravessa ${box.table}`).toBe(false)
        }
      }
    }
  })
})
