import { describe, expect, it } from "vitest"

import { orgEdgePath } from "./organization-structure-flow"
import { balancedRows, columnsFor, ESTIMATED_HEIGHT, LAYOUT_GAP, layoutOrganization, NODE_WIDTH, type OrganizationLayout, type OrganizationLayoutInput } from "./organization-layout"

function input(children: number, options: { manager?: boolean; expandedChild?: number } = {}): OrganizationLayoutInput {
  return {
    manager: options.manager === false ? null : { id: "mgr", height: ESTIMATED_HEIGHT.manager },
    focal: { id: "focal", height: ESTIMATED_HEIGHT.focalExpanded },
    reports: Array.from({ length: children }, (_, index) => ({ id: `c${index + 1}`, height: index === options.expandedChild ? ESTIMATED_HEIGHT.reportExpanded : ESTIMATED_HEIGHT.report })),
  }
}

const at = (layout: OrganizationLayout, id: string) => layout.positions.get(id)!

describe("Layout do organograma — função pura e determinística", () => {
  it.each([0, 1, 3, 5, 10, 25, 40])("%i filho(s): gestor acima da focal, focal acima dos filhos, ninguém na mesma posição, todos posicionados", (children) => {
    const layout = layoutOrganization(input(children))
    expect(layout.positions.size).toBe(children + 2)
    const manager = at(layout, "mgr")
    const focal = at(layout, "focal")
    expect(manager.y).toBe(0)
    expect(focal.y).toBe(ESTIMATED_HEIGHT.manager + LAYOUT_GAP.managerToFocal)
    // Gestor e focal centralizados no eixo lógico x = 0.
    expect(manager.x + NODE_WIDTH.manager / 2).toBe(0)
    expect(focal.x + NODE_WIDTH.focal / 2).toBe(0)
    for (let index = 1; index <= children; index += 1) {
      const child = at(layout, `c${index}`)
      expect(child.y).toBeGreaterThanOrEqual(focal.y + ESTIMATED_HEIGHT.focalExpanded + LAYOUT_GAP.focalToReports)
    }
    const seen = new Set([...layout.positions.values()].map((position) => `${position.x},${position.y}`))
    expect(seen.size).toBe(children + 2)
    expect(layout.rows.flat()).toHaveLength(children)
  })

  it("linhas balanceadas: até 4 numa linha; 5 → 3+2; 10 → 4+3+3; 25 → 5×5; 40 → 6 colunas em 7 linhas (6,6,6,6,6,5,5) — nunca uma fileira gigante", () => {
    expect(layoutOrganization(input(3)).rows.map((row) => row.length)).toEqual([3])
    expect(layoutOrganization(input(4)).rows.map((row) => row.length)).toEqual([4])
    expect(layoutOrganization(input(5)).rows.map((row) => row.length)).toEqual([3, 2])
    expect(layoutOrganization(input(10)).rows.map((row) => row.length)).toEqual([4, 3, 3])
    expect(layoutOrganization(input(25)).rows.map((row) => row.length)).toEqual([5, 5, 5, 5, 5])
    expect(layoutOrganization(input(40)).rows.map((row) => row.length)).toEqual([6, 6, 6, 6, 6, 5, 5])
    expect(columnsFor(0)).toBe(0)
    expect(columnsFor(16)).toBe(6)
    expect(columnsFor(100)).toBe(6)
    expect(balancedRows(["a", "b", "c", "d", "e"], 3)).toEqual([["a", "b", "c"], ["d", "e"]])
    // A linha mais larga de 40 filhos tem ~1.900px — não 8.000px.
    const forty = layoutOrganization(input(40))
    expect(forty.bounds.maxX - forty.bounds.minX).toBeLessThan(2000)
    expect(forty.bounds.maxY).toBeLessThan(1500)
  })

  it("cada linha é centralizada na focal e os cards da linha ficam na mesma altura; linhas seguintes ficam abaixo, com barra e tronco", () => {
    const layout = layoutOrganization(input(10))
    for (const row of layout.rows) {
      const first = at(layout, row[0]!)
      const last = at(layout, row[row.length - 1]!)
      expect(first.x + (last.x + NODE_WIDTH.report - first.x) / 2).toBeCloseTo(0)
      for (const id of row) expect(at(layout, id).y).toBe(first.y)
    }
    expect(at(layout, layout.rows[1]![0]!).y).toBeGreaterThan(at(layout, layout.rows[0]![0]!).y + ESTIMATED_HEIGHT.report)
    expect(layout.busY).toHaveLength(3)
    expect(layout.busY[0]).toBe(at(layout, "c1").y - LAYOUT_GAP.busToRow)
    // O tronco fica à esquerda da linha mais larga (4 cards).
    expect(layout.trunkX).toBeLessThan(at(layout, "c1").x)
    expect(layoutOrganization(input(3)).trunkX).toBeNull()
  })

  it("um filho expandido cresce PARA BAIXO: a própria linha fica mais alta e empurra as linhas seguintes; a largura das colunas não muda", () => {
    const compact = layoutOrganization(input(10))
    const expanded = layoutOrganization(input(10, { expandedChild: 0 }))
    expect(at(expanded, "c1")).toEqual(at(compact, "c1"))
    expect(at(expanded, "c2").x).toBe(at(compact, "c2").x)
    const delta = ESTIMATED_HEIGHT.reportExpanded - ESTIMATED_HEIGHT.report
    expect(at(expanded, "c5").y).toBe(at(compact, "c5").y + delta)
    expect(at(expanded, "c10").y).toBe(at(compact, "c10").y + delta)
    // Nunca sobrepõe: o topo da linha 2 fica abaixo do fim do card expandido.
    expect(at(expanded, "c5").y).toBeGreaterThan(at(expanded, "c1").y + ESTIMATED_HEIGHT.reportExpanded)
  })

  it("sem gestor (topo da cadeia): a focal começa em y = 0; determinístico para a mesma entrada", () => {
    const layout = layoutOrganization(input(3, { manager: false }))
    expect(at(layout, "focal").y).toBe(0)
    expect(layout.positions.has("mgr")).toBe(false)
    expect(layoutOrganization(input(25))).toEqual(layoutOrganization(input(25)))
  })

  it("edge organizacional: gestor → focal é um traço reto; focal → filho desce à barra da linha 0, e nas linhas seguintes passa pelo tronco até a barra da linha", () => {
    expect(orgEdgePath(0, 100, 0, 200, { kind: "manager", busY: 0, rowBusY: 0, trunkX: null })).toBe("M 0 100 L 0 200")
    expect(orgEdgePath(0, 300, -150, 400, { kind: "report", busY: 372, rowBusY: 372, trunkX: -500 })).toBe("M 0 300 V 372 H -150 V 400")
    expect(orgEdgePath(0, 300, 150, 600, { kind: "report", busY: 372, rowBusY: 572, trunkX: -500 })).toBe("M 0 300 V 372 H -500 V 572 H 150 V 600")
  })
})
