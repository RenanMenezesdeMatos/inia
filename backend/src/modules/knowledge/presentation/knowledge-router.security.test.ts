import express, { type ErrorRequestHandler } from "express"
import request from "supertest"
import { describe, expect, it, vi } from "vitest"
import { DomainError } from "../../../shared/domain/domain-error.js"

vi.mock("../../checkpoint-registry/application/checkpoint-registry-service.js", () => ({ syncCheckpointRegistry: async () => ({ status: "SYNCED" }) }))
const { createKnowledgeRouter } = await import("./knowledge-router.js")
const { legacyAccessQuery } = await import("../../access/testing/legacy-admin-fixture.js")

/**
 * Achados A-F01 (XSS armazenado pelo arquivo original) e A-F02 (router sem escopo) da auditoria de segurança.
 * Banco falso por SQL: o administrador de Grupo A vê bases globais e do Grupo A; altera só as do Grupo A.
 */
const ORG = "00000000-0000-4000-8000-000000000001"
const TEAM_A = "a0000000-0000-4000-8000-00000000000a"
const TEAM_B = "b0000000-0000-4000-8000-00000000000b"
const DOC_GLOBAL = "d0000000-0000-4000-8000-000000000001"
const DOC_TEAM_A = "d0000000-0000-4000-8000-00000000000a"
const DOC_TEAM_B = "d0000000-0000-4000-8000-00000000000b"
const DOC_HTML = "d0000000-0000-4000-8000-0000000000ff"

const documents: Record<string, { scopes: { scopeType: string; teamId: string | null; subteamId: string | null }[]; sourceType: string; file: Buffer }> = {
  [DOC_GLOBAL]: { scopes: [{ scopeType: "ALL_TEAMS", teamId: null, subteamId: null }], sourceType: "PDF", file: Buffer.from("%PDF-1.7 global") },
  [DOC_TEAM_A]: { scopes: [{ scopeType: "TEAM", teamId: TEAM_A, subteamId: null }], sourceType: "TXT", file: Buffer.from("procedimento A") },
  [DOC_TEAM_B]: { scopes: [{ scopeType: "TEAM", teamId: TEAM_B, subteamId: null }], sourceType: "TXT", file: Buffer.from("procedimento B") },
  // Gravado antes da correção com o tipo que o navegador declarou: o servidor agora ignora e decide pelo source_type.
  [DOC_HTML]: { scopes: [{ scopeType: "TEAM", teamId: TEAM_A, subteamId: null }], sourceType: "TXT", file: Buffer.from("<script>alert(document.cookie)</script>") },
}

function appFor(admin: "GROUP_A" | "ORGANIZATION") {
  const writes: string[] = []
  const legacyRows = admin === "GROUP_A" ? [{ scope_type: "TEAM", team_id: TEAM_A, subteam_id: null }] : []
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    const access = legacyAccessQuery(sql, "ADMIN", legacyRows)
    if (access) return access
    if (sql.includes("from subteams")) return { rows: [] }
    if (sql.includes("select true found")) {
      const document = documents[String(params[0])]
      return { rows: document ? [{ found: true, scopes: document.scopes }] : [] }
    }
    if (sql.includes("join knowledge_files f")) {
      const document = documents[String(params[0])]
      return { rows: document ? [{ title: "Base", original_filename: "base.html", source_type: document.sourceType, file_data: document.file }] : [] }
    }
    if (sql.includes("and d.id = $2")) return { rows: [{ id: params[1], title: "Base" }] }
    if (sql.includes("from knowledge_versions where document_id")) return { rows: [] }
    if (sql.includes("from knowledge_documents where id")) return { rows: [{ id: params[0] }] }
    if (/^\s*(update|insert|delete)/i.test(sql)) writes.push(sql.trim().split(/\s+/).slice(0, 3).join(" "))
    if (sql.includes("returning id")) return { rows: [{ id: DOC_TEAM_A }] }
    if (sql.includes("select q.*")) return { rows: [] }
    return { rows: [{ next: 2 }] }
  })
  const db = { query, connect: async () => ({ query, release: () => undefined }) }
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    ;(req as unknown as { user: unknown }).user = { personId: "person-1", sub: "acc-1", organizationId: ORG }
    next()
  })
  app.use("/", createKnowledgeRouter(db as never))
  app.use(((error, _req, res, next) => {
    void next
    res.status(error instanceof DomainError ? error.statusCode : 500).json({ error: { code: error instanceof DomainError ? error.code : "INTERNAL" } })
  }) as ErrorRequestHandler)
  return { app, writes, query }
}

describe("Base de Conhecimento — escopo do administrador", () => {
  it("administrador de Grupo lê bases globais e do próprio Grupo; a de outro Grupo é 404", async () => {
    const { app } = appFor("GROUP_A")
    expect((await request(app).get(`/${DOC_GLOBAL}`)).status).toBe(200)
    expect((await request(app).get(`/${DOC_TEAM_A}`)).status).toBe(200)
    expect((await request(app).get(`/${DOC_TEAM_B}`)).status).toBe(404)
    expect((await request(app).get(`/${DOC_TEAM_B}/file`)).status).toBe(404)
    expect((await request(app).get(`/${DOC_TEAM_B}/preview`)).status).toBe(404)
    expect((await request(app).get("/nao-e-uuid")).status).toBe(404)
  })

  it("a listagem do administrador de Grupo filtra no banco pelo escopo", async () => {
    const { app, query } = appFor("GROUP_A")
    expect((await request(app).get("/")).status).toBe(200)
    const listSql = query.mock.calls.map(([sql]) => String(sql)).find((sql) => sql.includes("select q.*"))!
    expect(listSql).toContain("os.scope_type = 'ALL_TEAMS' or os.team_id = any(")
  })

  it("administrador de Grupo altera só bases do Grupo dele — nunca a global, a de outro Grupo, nem promove a sua para global", async () => {
    const { app, writes } = appFor("GROUP_A")
    expect((await request(app).patch(`/${DOC_TEAM_A}`).send({ title: "Novo título" })).status).toBe(200)
    expect((await request(app).patch(`/${DOC_GLOBAL}`).send({ status: "ARCHIVED" })).status).toBe(403)
    expect((await request(app).patch(`/${DOC_TEAM_B}`).send({ status: "ARCHIVED" })).status).toBe(404)
    expect((await request(app).patch(`/${DOC_TEAM_A}`).send({ orgScopes: [{ scopeType: "ALL_TEAMS" }] })).status).toBe(403)
    expect((await request(app).delete(`/${DOC_GLOBAL}`)).status).toBe(404)
    expect((await request(app).delete(`/${DOC_TEAM_B}`)).status).toBe(404)
    const forbiddenCreate = await request(app).post("/").field("title", "Global").field("documentType", "FAQ").field("content", "Conteúdo de uma base global").field("orgScopes", JSON.stringify([{ scopeType: "ALL_TEAMS" }]))
    expect(forbiddenCreate.status).toBe(403)
    expect(writes.filter((write) => write.startsWith("delete"))).toEqual([])
  })

  it("administrador geral (organização) continua alterando a base global", async () => {
    const { app } = appFor("ORGANIZATION")
    expect((await request(app).patch(`/${DOC_GLOBAL}`).send({ title: "Revisada" })).status).toBe(200)
    expect((await request(app).delete(`/${DOC_GLOBAL}`)).status).not.toBe(404)
  })
})

describe("Base de Conhecimento — arquivo original nunca vira página ativa na origem da API", () => {
  it("o tipo vem do servidor, sempre como download, com sandbox e nosniff", async () => {
    const { app } = appFor("ORGANIZATION")
    const html = await request(app).get(`/${DOC_HTML}/file`)
    expect(html.status).toBe(200)
    expect(html.headers["content-type"]).toBe("text/plain; charset=utf-8")
    expect(html.headers["content-disposition"]).toMatch(/^attachment;/)
    expect(html.headers["content-security-policy"]).toBe("default-src 'none'; sandbox")
    expect(html.headers["x-content-type-options"]).toBe("nosniff")
    const pdf = await request(app).get(`/${DOC_GLOBAL}/file`)
    expect(pdf.headers["content-type"]).toBe("application/pdf")
  })

  it("upload cujo conteúdo não bate com o tipo é recusado antes de qualquer parser", async () => {
    const { app } = appFor("ORGANIZATION")
    const fakePdf = await request(app).post("/").field("title", "Manual").field("documentType", "MANUAL").attach("file", Buffer.from("<html><script>alert(1)</script></html>"), { filename: "manual.pdf", contentType: "application/pdf" })
    expect(fakePdf.status).toBe(422)
    expect(fakePdf.body.error.code).toBe("KNOWLEDGE_FILE_TYPE_MISMATCH")
    const binaryAsText = await request(app).post("/").field("title", "Texto").field("documentType", "FAQ").attach("file", Buffer.from([0x4d, 0x5a, 0x00, 0x01]), { filename: "nota.txt", contentType: "text/plain" })
    expect(binaryAsText.status).toBe(422)
  })
})
