import { describe, expect, it } from "vitest"
import { SqlFilter } from "../../../shared/presentation/list-query.js"
import { applyUniverseListFilter, universeListParam } from "./universe-list-filter.js"

describe("filtro Universo das listagens", () => {
  it("aceita B2B/B2C/B2X e PENDING, em lista ou separado por vírgula; recusa outro valor", () => {
    expect(universeListParam.parse("B2B,PENDING")).toEqual(["B2B", "PENDING"])
    expect(universeListParam.parse(["B2C"])).toEqual(["B2C"])
    expect(universeListParam.parse(undefined)).toBeUndefined()
    expect(() => universeListParam.parse("B2Z")).toThrow()
  })

  it("monta a cláusula com parâmetro (nunca o valor no SQL) e PENDING = sem universo", () => {
    const filter = new SqlFilter(["org"])
    applyUniverseListFilter(filter, 'q."operatingUniverse"', ["B2B", "PENDING"])
    expect(filter.where()).toBe(` where (q."operatingUniverse" = any($2::text[]) or q."operatingUniverse" is null)`)
    expect(filter.params).toEqual(["org", ["B2B"]])
  })

  it("só PENDING e nenhum valor", () => {
    const pending = applyUniverseListFilter(new SqlFilter([]), "u", ["PENDING"])
    expect(pending.where()).toBe(" where (u is null)")
    expect(applyUniverseListFilter(new SqlFilter([]), "u", undefined).where()).toBe("")
  })
})
