import { describe, expect, it } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { createPostgresCommunicationStore } from "./postgres-communication-store.js"

const ORG = "00000000-0000-4000-8000-0000000000aa"
const VIEWER = "00000000-0000-4000-8000-000000000001"
const AUTHOR = "00000000-0000-4000-8000-000000000002"
const ID = "00000000-0000-4000-8000-000000000010"

/** Banco falso: guarda o SQL e devolve as linhas dadas (nenhuma consulta real). */
function fakeDb(rows: Record<string, unknown>[]) {
  const calls: { sql: string; params: unknown[] }[] = []
  const db = { query: async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); return { rows, rowCount: rows.length } } } as unknown as Database
  return { db, calls }
}

const base = { id: ID, title: "Aviso", tags: ["Aviso"], audience: "TEAM", authorPersonId: AUTHOR, authorName: "Paula", recipientCount: 7, publishedAt: new Date("2026-11-16T12:00:00Z"), editedAt: null }

describe("store Postgres dos comunicados — lista leve × leitura pelo id (achado U4-02)", () => {
  it("listReceived não seleciona o conteúdo nem o texto inteiro e devolve trecho + hasImages", async () => {
    const { db, calls } = fakeDb([{ ...base, plainTextStart: "Texto do aviso", plainTextCut: false, hasImages: true }])
    const items = await createPostgresCommunicationStore(db).listReceived(ORG, VIEWER, 200)
    const sql = calls[0]!.sql
    expect(sql).not.toMatch(/content_html "contentHtml"/)
    expect(sql).not.toMatch(/plain_text "plainText"/)
    expect(sql).toMatch(/left\(n\.plain_text, \d+\) "plainTextStart"/)
    expect(items).toEqual([{ id: ID, title: "Aviso", tags: ["Aviso"], audience: "TEAM", author: { personId: AUTHOR, name: "Paula" }, recipientCount: null, authoredByViewer: false, publishedAt: "2026-11-16T12:00:00.000Z", editedAt: null, excerpt: "Texto do aviso", hasImages: true }])
    expect(items[0]).not.toHaveProperty("contentHtml")
  })

  it("trecho: prefixo cortado pelo banco ganha \"…\"; só imagem fica vazio", async () => {
    const { db } = fakeDb([{ ...base, plainTextStart: "abc", plainTextCut: true, hasImages: false }, { ...base, id: "x", plainTextStart: "(imagem)", plainTextCut: false, hasImages: true }])
    const items = await createPostgresCommunicationStore(db).listReceived(ORG, VIEWER, 200)
    expect(items.map((item) => item.excerpt)).toEqual(["abc…", ""])
  })

  it("findVisible lê o conteúdo com a regra de visibilidade de quem lê (a mesma do feed)", async () => {
    const { db, calls } = fakeDb([{ ...base, contentHtml: "<p>x</p>", plainText: "x" }])
    const view = await createPostgresCommunicationStore(db).findVisible(ORG, VIEWER, ID)
    expect(view).toMatchObject({ id: ID, contentHtml: "<p>x</p>", plainText: "x" })
    expect(calls[0]!.sql).toContain("communication_recipients")
    expect(calls[0]!.sql).toContain("deleted_at is null")
    expect(calls[0]!.params).toEqual([ORG, [ID], VIEWER])
    const empty = fakeDb([])
    expect(await createPostgresCommunicationStore(empty.db).findVisible(ORG, VIEWER, ID)).toBeNull()
  })
})
