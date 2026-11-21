import { describe, expect, it } from "vitest"
import { outOfOrderMigrations } from "./run-migrations.js"

describe("migrations fora de ordem (run-8, ARQ-11)", () => {
  const files = ["226_a.sql", "227_b.sql", "230_atrasada.sql", "243_c.sql", "245_d.sql"]

  it("pendente com número menor que a última aplicada é recusada", () => {
    expect(outOfOrderMigrations(files, new Set(["226_a.sql", "227_b.sql", "243_c.sql", "245_d.sql"]))).toEqual(["230_atrasada.sql"])
  })

  it("pendentes depois da última aplicada, banco vazio ou tudo aplicado: nada a recusar", () => {
    expect(outOfOrderMigrations(files, new Set(["226_a.sql", "227_b.sql"]))).toEqual([])
    expect(outOfOrderMigrations(files, new Set())).toEqual([])
    expect(outOfOrderMigrations(files, new Set(files))).toEqual([])
  })

  it("aplicada que não existe mais no diretório (renumerada) não conta", () => {
    expect(outOfOrderMigrations(files, new Set(["226_a.sql", "999_renumerada.sql"]))).toEqual([])
  })
})
