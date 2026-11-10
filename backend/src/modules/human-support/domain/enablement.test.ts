import { describe, expect, it } from "vitest"
import { effectiveGroup, effectiveSubgroup, supportEnabledFor } from "./enablement.js"

const person = (overrides: Partial<Parameters<typeof supportEnabledFor>[0]> = {}) => supportEnabledFor({ master: true, groupState: null, subgroupState: null, hasGroup: true, hasSubgroup: true, ...overrides })

describe("liga/desliga", () => {
  it("tudo nasce desligado; sem chave geral nada vale; sem Grupo, desligado", () => {
    expect(person()).toBe(false)
    expect(person({ master: false, groupState: "ON", subgroupState: "ON" })).toBe(false)
    expect(person({ hasGroup: false, groupState: "ON" })).toBe(false)
  })

  it("Subgrupo decide quando não herda; herdando, vale o Grupo", () => {
    expect(person({ groupState: "ON" })).toBe(true)
    expect(person({ groupState: "ON", subgroupState: "OFF" })).toBe(false)
    expect(person({ groupState: "OFF", subgroupState: "ON" })).toBe(true)
    expect(person({ groupState: "INHERIT", subgroupState: "INHERIT" })).toBe(false)
  })

  it("pessoa sem Subgrupo usa o Grupo (estado de Subgrupo ignorado)", () => {
    expect(person({ hasSubgroup: false, subgroupState: "ON", groupState: null })).toBe(false)
    expect(person({ hasSubgroup: false, groupState: "ON" })).toBe(true)
  })

  it("árvore da tela: de onde vem o efetivo", () => {
    expect(effectiveGroup({ master: false, own: "ON" })).toEqual({ effective: false, source: "MASTER_OFF" })
    expect(effectiveGroup({ master: true, own: "ON" })).toEqual({ effective: true, source: "OWN" })
    expect(effectiveGroup({ master: true, own: null })).toEqual({ effective: false, source: "DEFAULT_OFF" })
    expect(effectiveSubgroup({ master: true, own: "INHERIT", group: "ON" })).toEqual({ effective: true, source: "GROUP" })
    expect(effectiveSubgroup({ master: true, own: "OFF", group: "ON" })).toEqual({ effective: false, source: "OWN" })
    expect(effectiveSubgroup({ master: true, own: null, group: null })).toEqual({ effective: false, source: "DEFAULT_OFF" })
  })
})
