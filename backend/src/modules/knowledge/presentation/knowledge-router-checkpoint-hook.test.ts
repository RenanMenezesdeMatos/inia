import express from "express"
import request from "supertest"
import { describe, expect, it, vi } from "vitest"

const sync = vi.fn(async () => ({ status: "SYNCED" }))
vi.mock("../../checkpoint-registry/application/checkpoint-registry-service.js", () => ({ syncCheckpointRegistry: (...args: unknown[]) => sync(...(args as [])) }))
const { createKnowledgeRouter } = await import("./knowledge-router.js")
const { legacyAccessQuery } = await import("../../access/testing/legacy-admin-fixture.js")

const DOC = "d0c00000-0000-4000-8000-000000000001"

// Organização da sessão — diferente da organização da instalação: a sincronização usa a da sessão.
const ORG = "00000000-0000-4000-8000-0000000000e5"

/** Checkpoint Registry — publicar uma versão da base dispara a extração/reconciliação; salvar rascunho não; falha nunca desfaz. */
function appWith() {
  // Administrador geral (escopo de organização) sobre uma base global — o escopo não é o assunto deste teste.
  const query = vi.fn(async (sql: string) =>
    legacyAccessQuery(sql, "ADMIN", []) ??
    (sql.includes("select true found") ? { rows: [{ found: true, scopes: [{ scopeType: "ALL_TEAMS", teamId: null, subteamId: null }] }] } : sql.includes("from knowledge_documents where id") ? { rows: [{ id: DOC }] } : { rows: [{ next: 2 }] }))
  const db = { query, connect: async () => ({ query, release: () => undefined }) }
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => { (req as unknown as { user: unknown }).user = { personId: "person-1", sub: "acc-1", organizationId: ORG }; next() })
  app.use("/", createKnowledgeRouter(db as never))
  return app
}

describe("Base de Conhecimento → Checkpoint Registry (gancho de publicação)", () => {
  it("PUBLISHED dispara a sincronização do registry; rascunho não; erro na sincronização não desfaz a publicação", async () => {
    sync.mockClear()
    expect((await request(appWith()).patch(`/${DOC}`).send({ content: "Conteúdo da versão nova", status: "PUBLISHED" })).status).toBe(200)
    expect(sync).toHaveBeenCalledTimes(1)
    expect(sync.mock.calls[0]).toEqual([expect.anything(), { organizationId: ORG, personId: "person-1" }, DOC])
    expect((await request(appWith()).patch(`/${DOC}`).send({ content: "Rascunho sem publicar" })).status).toBe(200)
    expect(sync).toHaveBeenCalledTimes(1)
    sync.mockRejectedValueOnce(new Error("falhou"))
    expect((await request(appWith()).patch(`/${DOC}`).send({ status: "PUBLISHED" })).status).toBe(200)
  })
})
