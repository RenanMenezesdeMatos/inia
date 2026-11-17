import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { MIGRATIONS_DIRECTORY } from "../../../infrastructure/database/run-migrations.js"

/**
 * Etapa 3 do universo de atuação (migrations/pending/, aplicada só com zero pendentes): segue a regra da revisão de 16/11 — só o
 * OPERADOR precisa de universo (liderança sem universo vê a própria estrutura) (auditoria run-4, UB-07). Ao movê-la para migrations/,
 * renumere para depois da última aplicada (o número atual é só reserva).
 */
describe("migration pendente do universo obrigatório", () => {
  it("exige universo só de operador ativo", async () => {
    const inPending = (await readdir(join(MIGRATIONS_DIRECTORY, "pending"))).filter((file) => file.includes("operating_universe_required"))
    const applied = (await readdir(MIGRATIONS_DIRECTORY)).filter((file) => file.includes("operating_universe_required"))
    const [file] = inPending.length ? inPending.map((name) => join(MIGRATIONS_DIRECTORY, "pending", name)) : applied.map((name) => join(MIGRATIONS_DIRECTORY, name))
    expect(inPending.length + applied.length).toBe(1)
    const sql = await readFile(file!, "utf8")
    expect(sql).toContain("from people where active and role = 'OPERATOR' and operating_universe is null")
    expect(sql).toContain("check (not active or role <> 'OPERATOR' or operating_universe is not null)")
    expect(sql).not.toMatch(/check \(not active or operating_universe is not null\)/)
  })
})
