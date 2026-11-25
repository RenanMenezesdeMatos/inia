import { describe, expect, it } from "vitest"
import { resolveUnitNames, type ExistingUnitName, type UnitName } from "./unit-name-conflicts.js"

const row = (externalCode: string, name: string, parentId = "op"): UnitName => ({ externalCode, name, parentId })
const existing = (externalCode: string | null, name: string, parentId = "op"): ExistingUnitName => ({ externalCode, name, parentId })
const codes = (rows: readonly UnitName[]) => rows.map((entry) => entry.externalCode)
const refused = (result: ReturnType<typeof resolveUnitNames>) => Object.fromEntries(result.conflicts.map(({ row: entry, kind, ownerCode }) => [entry.externalCode, [kind, ownerCode]]))

describe("resolveUnitNames", () => {
  it("sem colisão, nada muda; mesmo nome em outro pai não é colisão", () => {
    const result = resolveUnitNames([row("A", "Voz"), row("B", "Voz", "outra"), row("C", "Chat")], [existing("A", "Voz")])
    expect(codes(result.ready)).toEqual(["A", "B", "C"])
    expect(result.conflicts).toEqual([])
  })

  it("nome repetido na carga: a primeira linha vale, as outras são recusadas", () => {
    const result = resolveUnitNames([row("A", "Voz"), row("B", "Voz"), row("C", "Voz")], [])
    expect(codes(result.ready)).toEqual(["A"])
    expect(refused(result)).toEqual({ B: ["SAME_LOAD", "A"], C: ["SAME_LOAD", "A"] })
  })

  it("quem já tem o nome na INIA fica com ele, mesmo vindo depois na carga", () => {
    const result = resolveUnitNames([row("NOVO", "Voz"), row("A", "Voz")], [existing("A", "Voz")])
    expect(codes(result.ready)).toEqual(["A"])
    expect(refused(result)).toEqual({ NOVO: ["EXISTING", "A"] })
  })

  it("nome de quem não está na carga (ou não tem código) é recusado", () => {
    const result = resolveUnitNames([row("B", "Voz"), row("C", "Chat")], [existing("A", "Voz"), existing(null, "Chat")])
    expect(result.ready).toEqual([])
    expect(refused(result)).toEqual({ B: ["EXISTING", "A"], C: ["EXISTING", null] })
  })

  it("cadeia de renomeações: sai na ordem em que os nomes são liberados", () => {
    const result = resolveUnitNames([row("C", "Dois"), row("B", "Um"), row("A", "Novo")], [existing("A", "Um"), existing("B", "Dois")])
    expect(codes(result.ready)).toEqual(["A", "B", "C"])
    expect(result.conflicts).toEqual([])
  })

  it("cadeia que termina em nome ocupado: todos os que dependiam dela são recusados", () => {
    const result = resolveUnitNames([row("C", "Dois"), row("B", "Um"), row("D", "Livre")], [existing("X", "Um"), existing("B", "Dois")])
    expect(codes(result.ready)).toEqual(["D"])
    expect(refused(result)).toEqual({ B: ["EXISTING", "X"], C: ["EXISTING", "B"] })
  })

  it("troca de nomes entre si (e quem espera por ela) é recusada; o resto entra", () => {
    const result = resolveUnitNames([row("A", "Dois"), row("B", "Um"), row("C", "Três")], [existing("A", "Um"), existing("B", "Dois")])
    expect(codes(result.ready)).toEqual(["C"])
    expect(refused(result)).toEqual({ A: ["SWAP", "B"], B: ["SWAP", "A"] })
  })

  it("perdeu o nome na carga e por isso não larga o antigo: quem esperava o antigo também é recusado", () => {
    const result = resolveUnitNames([row("A", "Voz"), row("B", "Voz"), row("C", "Velho")], [existing("B", "Velho")])
    expect(codes(result.ready)).toEqual(["A"])
    expect(refused(result)).toEqual({ B: ["SAME_LOAD", "A"], C: ["EXISTING", "B"] })
  })

  it("cadeia longa não estoura a pilha", () => {
    const size = 50_000
    const rows = Array.from({ length: size }, (_, index) => row(`C${index}`, `N${index + 1}`))
    const result = resolveUnitNames(rows, rows.map((entry, index) => existing(entry.externalCode, `N${index}`)))
    expect(result.ready).toHaveLength(size)
    expect(result.ready[0]!.externalCode).toBe(`C${size - 1}`)
  })
})
