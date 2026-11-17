import { describe, expect, it } from "vitest"

import { effectiveFor, optionLabel, project } from "./scope-rules"
import type { ScopeNode } from "@/schemas/human-support/admin.schema"

describe("regra do escopo do Anjo (espelho de backend/.../domain/enablement.ts)", () => {
  it("chave geral desligada bloqueia tudo; opção própria vence; Subgrupo herdando segue o Grupo; Grupo sem opção = desabilitado", () => {
    expect(effectiveFor({ type: "SUBGROUP", state: "ON", masterOn: false, groupState: "ON" })).toEqual({ effective: false, source: "MASTER_OFF" })
    expect(effectiveFor({ type: "SUBGROUP", state: "OFF", masterOn: true, groupState: "ON" })).toEqual({ effective: false, source: "OWN" })
    expect(effectiveFor({ type: "SUBGROUP", state: "ON", masterOn: true, groupState: "OFF" })).toEqual({ effective: true, source: "OWN" })
    expect(effectiveFor({ type: "SUBGROUP", state: "INHERIT", masterOn: true, groupState: "ON" })).toEqual({ effective: true, source: "GROUP" })
    expect(effectiveFor({ type: "SUBGROUP", state: "INHERIT", masterOn: true, groupState: "OFF" })).toEqual({ effective: false, source: "GROUP" })
    expect(effectiveFor({ type: "SUBGROUP", state: "INHERIT", masterOn: true, groupState: "INHERIT" })).toEqual({ effective: false, source: "DEFAULT_OFF" })
    expect(effectiveFor({ type: "GROUP", state: "INHERIT", masterOn: true, groupState: null })).toEqual({ effective: false, source: "DEFAULT_OFF" })
  })

  it("rótulos: 'Herdar do escopo superior' só no Subgrupo", () => {
    expect(optionLabel("SUBGROUP", "INHERIT")).toBe("Herdar do escopo superior")
    expect(optionLabel("GROUP", "INHERIT")).toBe("Sem configuração própria")
    expect(optionLabel("GROUP", "ON")).toBe("Habilitar neste escopo")
    expect(optionLabel("SUBGROUP", "OFF")).toBe("Desabilitar neste escopo")
  })

  it("prévia do Grupo: só os Subgrupos que herdam mudam junto", () => {
    const sub = (id: string, state: ScopeNode["state"], effective: boolean): ScopeNode => ({ type: "SUBGROUP", id, name: id, state, effective, effectiveSource: state === "INHERIT" ? "GROUP" : "OWN", anjoCount: 1, warnings: [] })
    const group: ScopeNode = { type: "GROUP", id: "g", name: "G", state: "ON", effective: true, effectiveSource: "OWN", anjoCount: 1, warnings: [], children: [sub("a", "INHERIT", true), sub("b", "ON", true)] }
    expect(project(group, null, "OFF", true)).toEqual({ after: { effective: false, source: "OWN" }, children: [{ id: "a", name: "a", before: true, after: false }] })
  })
})
