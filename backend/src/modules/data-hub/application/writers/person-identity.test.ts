import type pg from "pg"
import { describe, expect, it } from "vitest"
import { normalizePersonName } from "../../../people/domain/person-name.js"
import type { WriteContext } from "./domain-writer.js"
import { linkByAccountEmail, linkedWarnings, possibleDuplicateWarnings, type IdentityRow } from "./person-identity.js"

/** O SQL de verdade é provado contra o banco em testing/person-identity-proof.test.ts; aqui, a regra em volta dele. */
const context = { organizationId: "org-1", runId: "run-1", feed: { id: "feed-1" } } as unknown as WriteContext
const row = (recordNumber: number, matricula: string, name: string, email: string | null = null): IdentityRow => ({ recordNumber, sourceRecordKey: matricula, record: {}, matricula, name, email })

function fakeClient(respond: (sql: string, params: unknown[]) => unknown[]) {
  const calls: { sql: string; params: unknown[] }[] = []
  const client = { query: async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); const rows = respond(sql, params); return { rows, rowCount: rows.length } } } as unknown as pg.PoolClient
  return { client, calls }
}

describe("nome comparável", () => {
  it("ignora caixa, acento e espaços — só para avisar, nunca para juntar", () => {
    expect(normalizePersonName("  Célia   PRADO ")).toBe("celia prado")
    expect(normalizePersonName("João da Conceição")).toBe(normalizePersonName("joao da conceicao"))
    expect(normalizePersonName("Ana Souza")).not.toBe(normalizePersonName("Ana Sousa"))
  })
})

describe("chave forte — conta com o e-mail do registro", () => {
  it("sem e-mail na carga, não consulta nada", async () => {
    const { client, calls } = fakeClient(() => [])
    expect(await linkByAccountEmail(context, client, [row(1, "M-1", "Ana")])).toEqual([])
    expect(calls).toHaveLength(0)
  })

  it("liga só pelos registros com e-mail e audita com id, matrícula, carga e feed", async () => {
    const { client, calls } = fakeClient((sql) => (sql.includes("update people") ? [{ id: "p-ana", matricula: "M-1" }] : []))
    const linked = await linkByAccountEmail(context, client, [row(1, "M-1", "Ana", "Ana@Empresa.com"), row(2, "M-2", "Bruno")])
    expect(linked.map((entry) => [entry.personId, entry.row.recordNumber])).toEqual([["p-ana", 1]])
    expect(calls[0]!.params).toEqual(["org-1", ["M-1"], ["Ana@Empresa.com"]])
    expect(calls[0]!.sql).toContain("having count(*) = 1")
    expect(calls[1]!.sql).toContain("'PERSON_LINKED_TO_SOURCE'")
    expect(calls[1]!.params).toEqual(["org-1", ["p-ana"], ["M-1"], "run-1", "feed-1"])
    expect(linkedWarnings(linked)).toEqual([{ recordNumber: 1, sourceRecordKey: "M-1", error: { code: "DATA_PERSON_LINKED_BY_EMAIL", field: "email", message: expect.stringContaining("nenhuma pessoa nova foi criada") } }])
  })

  it("ninguém ligado: sem auditoria", async () => {
    const { client, calls } = fakeClient(() => [])
    expect(await linkByAccountEmail(context, client, [row(1, "M-1", "Ana", "ana@empresa.com")])).toEqual([])
    expect(calls).toHaveLength(1)
  })
})

describe("chave fraca — mesmo nome de pessoa sem matrícula", () => {
  it("avisa com os dois ids e nunca junta; nome diferente não avisa", async () => {
    const { client, calls } = fakeClient(() => [{ id: "p-manual", name: "  bruno SOUZA" }, { id: "p-outro", name: "Carla Dias" }])
    const warnings = await possibleDuplicateWarnings(context, client, [{ personId: "p-novo", row: row(2, "M-2", "Bruno Souza") }, { personId: "p-dora", row: row(3, "M-3", "Dora Nunes") }])
    expect(calls[0]!.params).toEqual(["org-1", ["p-novo", "p-dora"]])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({ recordNumber: 2, error: { code: "DATA_POSSIBLE_DUPLICATE_PERSON", field: "name" } })
    expect(warnings[0]!.error.message).toContain("p-novo")
    expect(warnings[0]!.error.message).toContain("p-manual")
  })

  it("sem pessoa nova, não consulta", async () => {
    const { client, calls } = fakeClient(() => [])
    expect(await possibleDuplicateWarnings(context, client, [])).toEqual([])
    expect(calls).toHaveLength(0)
  })
})
