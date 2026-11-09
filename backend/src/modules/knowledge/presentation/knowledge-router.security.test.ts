import express, { type ErrorRequestHandler } from "express"
import request from "supertest"
import { describe, expect, it, vi } from "vitest"
import { DomainError } from "../../../shared/domain/domain-error.js"

vi.mock("../../checkpoint-registry/application/checkpoint-registry-service.js", () => ({ syncCheckpointRegistry: async () => ({ status: "SYNCED" }) }))
// O ciclo de vida das versões tem a prova contra o banco real (knowledge-version-lifecycle-proof); aqui o assunto é só o escopo da rota.
vi.mock("../application/knowledge-versions.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../application/knowledge-versions.js")>()),
  lockKnowledgeDocument: async () => true,
  saveKnowledgeDraft: async () => null,
  archiveKnowledge: async () => undefined,
}))
const { createKnowledgeRouter } = await import("./knowledge-router.js")
const { chainedFilterBombPdf } = await import("../testing/pdf-fixtures.js")
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
// Em uso só no Grupo A, com um rascunho preparado por quem administra a organização: um vale para todos os Grupos, o outro passou a valer só para o B.
const DOC_WIDER_DRAFT = "d0000000-0000-4000-8000-0000000000a1"
const DOC_MOVED_DRAFT = "d0000000-0000-4000-8000-0000000000a2"
// Rascunho que quem administra a organização amplia para todos os Grupos enquanto o pedido de quem administra o Grupo A está em curso.
const DOC_RACE = "d0000000-0000-4000-8000-0000000000a3"
const DRAFT_RACE = "e0000000-0000-4000-8000-000000000005"
// Sem rascunho, mas com uma atualização que falhou e valia só para o Grupo B: um rascunho novo partiria dela (texto e alcance).
const DOC_FAILED_B = "d0000000-0000-4000-8000-0000000000a4"
const FAILED_B = "e0000000-0000-4000-8000-000000000006"
const LIVE_A3 = "e0000000-0000-4000-8000-000000000007"
const LIVE_A = "e0000000-0000-4000-8000-000000000001"
const DRAFT_ALL = "e0000000-0000-4000-8000-000000000002"
const DRAFT_B = "e0000000-0000-4000-8000-000000000003"
const LIVE_A2 = "e0000000-0000-4000-8000-000000000004"

const documents: Record<string, { scopes: { scopeType: string; teamId: string | null; subteamId: string | null }[]; sourceType: string; file: Buffer }> = {
  [DOC_WIDER_DRAFT]: { scopes: [{ scopeType: "TEAM", teamId: TEAM_A, subteamId: null }], sourceType: "TXT", file: Buffer.from("procedimento A") },
  [DOC_MOVED_DRAFT]: { scopes: [{ scopeType: "TEAM", teamId: TEAM_A, subteamId: null }], sourceType: "TXT", file: Buffer.from("procedimento A") },
  [DOC_FAILED_B]: { scopes: [{ scopeType: "TEAM", teamId: TEAM_A, subteamId: null }], sourceType: "TXT", file: Buffer.from("procedimento A") },
  [DOC_RACE]: { scopes: [{ scopeType: "TEAM", teamId: TEAM_A, subteamId: null }], sourceType: "PDF", file: Buffer.from("%PDF-1.7 corrida") },
  [DOC_GLOBAL]: { scopes: [{ scopeType: "ALL_TEAMS", teamId: null, subteamId: null }], sourceType: "PDF", file: Buffer.from("%PDF-1.7 global") },
  [DOC_TEAM_A]: { scopes: [{ scopeType: "TEAM", teamId: TEAM_A, subteamId: null }], sourceType: "TXT", file: Buffer.from("procedimento A") },
  [DOC_TEAM_B]: { scopes: [{ scopeType: "TEAM", teamId: TEAM_B, subteamId: null }], sourceType: "TXT", file: Buffer.from("procedimento B") },
  // Gravado antes da correção com o tipo que o navegador declarou: o servidor agora ignora e decide pelo source_type.
  [DOC_HTML]: { scopes: [{ scopeType: "TEAM", teamId: TEAM_A, subteamId: null }], sourceType: "TXT", file: Buffer.from("<script>alert(document.cookie)</script>") },
}

const versionConfig = (orgScopes: { scopeType: string; teamId: string | null }[]) => ({ title: "Base", documentType: "PROCEDURE", sourceType: "TXT", file: null, orgScopes, subjectScopes: [{ scopeType: "ALL_SUBJECTS" }], productNodeIds: [] })
const ONLY_A = [{ scopeType: "TEAM", teamId: TEAM_A }]
const versions: Record<string, { id: string; version: number; status: string; text_status: string; config: unknown }[]> = {
  [DOC_WIDER_DRAFT]: [
    { id: DRAFT_ALL, version: 2, status: "DRAFT", text_status: "AVAILABLE", config: versionConfig([{ scopeType: "ALL_TEAMS", teamId: null }]) },
    { id: LIVE_A, version: 1, status: "PUBLISHED", text_status: "AVAILABLE", config: versionConfig(ONLY_A) },
  ],
  [DOC_FAILED_B]: [
    { id: FAILED_B, version: 2, status: "FAILED", text_status: "AVAILABLE", config: versionConfig([{ scopeType: "TEAM", teamId: TEAM_B }]) },
    { id: LIVE_A3, version: 1, status: "PUBLISHED", text_status: "AVAILABLE", config: versionConfig(ONLY_A) },
  ],
  [DOC_MOVED_DRAFT]: [
    { id: DRAFT_B, version: 2, status: "DRAFT", text_status: "AVAILABLE", config: versionConfig([{ scopeType: "TEAM", teamId: TEAM_B }]) },
    { id: LIVE_A2, version: 1, status: "PUBLISHED", text_status: "AVAILABLE", config: versionConfig(ONLY_A) },
  ],
}
const versionContents: Record<string, string> = { [FAILED_B]: "Procedimento interno só do Grupo B (falhou)", [LIVE_A3]: "Procedimento em uso no Grupo A", [LIVE_A]: "Procedimento em uso no Grupo A", [DRAFT_ALL]: "Procedimento para todos os Grupos", [LIVE_A2]: "Procedimento em uso no Grupo A", [DRAFT_B]: "Procedimento interno só do Grupo B" }

function appFor(admin: "GROUP_A" | "ORGANIZATION") {
  const writes: string[] = []
  // A primeira leitura do rascunho da corrida vale só para o Grupo A; da segunda em diante, já foi ampliado para todos os Grupos.
  let raceReads = 0
  const raceVersions = () => [
    { id: DRAFT_RACE, version: 2, status: "DRAFT", text_status: "AVAILABLE", config: versionConfig(raceReads++ === 0 ? ONLY_A : [{ scopeType: "ALL_TEAMS", teamId: null }]) },
    { id: LIVE_A, version: 1, status: "PUBLISHED", text_status: "AVAILABLE", config: versionConfig(ONLY_A) },
  ]
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
    if (sql.includes("from knowledge_versions where document_id")) return { rows: String(params[0]) === DOC_RACE ? raceVersions() : (versions[String(params[0])] ?? []) }
    if (sql.includes("from knowledge_versions v join knowledge_documents d")) {
      const row = Object.values(versions).flat().find((version) => version.id === String(params[0]))
      return { rows: row ? [{ ...row, content: versionContents[row.id] ?? "", file_id: null, change_summary: null, published_at: null, extraction: null }] : [] }
    }
    if (sql.includes("from knowledge_versions where id = any(")) return { rows: (params[0] as string[]).map((id) => ({ id, content: versionContents[id] ?? "", extraction: null })) }
    if (sql.includes("from knowledge_ocr_jobs")) return { rows: [] }
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

describe("Base de Conhecimento — rascunho com alcance diferente do que está em uso", () => {
  it("quem administra só o Grupo A não publica, edita, troca o arquivo, reprocessa nem descarta um rascunho que vale para mais Grupos — nem pelo PATCH com status", async () => {
    const { app, writes } = appFor("GROUP_A")
    expect((await request(app).post(`/${DOC_WIDER_DRAFT}/publish`).send({})).status).toBe(403)
    expect((await request(app).patch(`/${DOC_WIDER_DRAFT}`).send({ status: "PUBLISHED" })).status).toBe(403)
    expect((await request(app).patch(`/${DOC_WIDER_DRAFT}`).send({ content: "Texto trocado por quem administra só o Grupo A" })).status).toBe(403)
    expect((await request(app).post(`/${DOC_WIDER_DRAFT}/draft/file`).attach("file", Buffer.from("procedimento novo"), { filename: "novo.txt", contentType: "text/plain" })).status).toBe(403)
    expect((await request(app).post(`/${DOC_WIDER_DRAFT}/reprocess`).send({})).status).toBe(403)
    expect((await request(app).post(`/${DOC_WIDER_DRAFT}/draft/discard`).send({})).status).toBe(403)
    expect(writes).toEqual([])
    // Arquivar não mexe no rascunho: continua valendo pelo alcance em uso.
    expect((await request(app).post(`/${DOC_WIDER_DRAFT}/archive`).send({})).status).toBe(200)
    // Quem administra a organização publica o mesmo rascunho pelo PATCH.
    expect((await request(appFor("ORGANIZATION").app).patch(`/${DOC_WIDER_DRAFT}`).send({ content: "Procedimento revisado para todos os Grupos" })).status).toBe(200)
  })

  it("reverter descartando um rascunho de alcance maior é recusado para quem administra só o Grupo A", async () => {
    const { app, writes } = appFor("GROUP_A")
    const answer = await request(app).post(`/${DOC_WIDER_DRAFT}/versions/${LIVE_A}/revert`).send({ discardDraft: true })
    expect(answer.status).toBe(403)
    expect(writes).toEqual([])
  })

  it("sem rascunho, editar não cria um rascunho a partir de uma atualização que falhou e valia para outro Grupo", async () => {
    const { app, writes } = appFor("GROUP_A")
    for (const body of [{ content: "Texto de quem administra só o Grupo A" }, { orgScopes: [{ scopeType: "TEAM", teamId: TEAM_A }] }, { status: "PUBLISHED" }]) {
      expect((await request(app).patch(`/${DOC_FAILED_B}`).send(body)).status).toBe(403)
    }
    expect(writes).toEqual([])
    // O detalhe não mostra o texto dela.
    expect(JSON.stringify((await request(app).get(`/${DOC_FAILED_B}`)).body)).not.toContain("só do Grupo B")
    // Quem administra a organização continua editando.
    expect((await request(appFor("ORGANIZATION").app).patch(`/${DOC_FAILED_B}`).send({ content: "Texto revisado pela organização" })).status).toBe(200)
  })

  it("o alcance do rascunho é relido com a base travada: ampliado no meio do pedido, a escrita é recusada", async () => {
    for (const send of [
      (app: express.Express) => request(app).patch(`/${DOC_RACE}`).send({ status: "PUBLISHED" }),
      (app: express.Express) => request(app).patch(`/${DOC_RACE}`).send({ content: "Texto de quem administra só o Grupo A" }),
      (app: express.Express) => request(app).post(`/${DOC_RACE}/publish`).send({}),
      (app: express.Express) => request(app).post(`/${DOC_RACE}/draft/discard`).send({}),
      (app: express.Express) => request(app).post(`/${DOC_RACE}/draft/file`).attach("file", Buffer.from("procedimento novo"), { filename: "novo.txt", contentType: "text/plain" }),
    ]) {
      const { app, writes } = appFor("GROUP_A")
      const answer = await send(app)
      expect(answer.status).toBe(403)
      expect(answer.body.error.code).toBe("KNOWLEDGE_SCOPE_FORBIDDEN")
      expect(writes).toEqual([])
    }
  })

  it("o detalhe não traz texto, extração nem configuração de um rascunho que vale só para outro Grupo; quem administra a organização vê tudo", async () => {
    const group = await request(appFor("GROUP_A").app).get(`/${DOC_MOVED_DRAFT}`)
    expect(group.status).toBe(200)
    expect(group.body.data.draft).toMatchObject({ id: DRAFT_B, version: 2, status: "DRAFT", content: "", extraction: null, config: null, changeSummary: null, restricted: true })
    expect(group.body.data.editable).toMatchObject({ versionId: DRAFT_B, version: 2, content: "", extraction: null, config: null, restricted: true })
    expect(group.body.data.latestVersion).toMatchObject({ version: 2, content: "", restricted: true })
    expect(group.body.data.inUse).toMatchObject({ id: LIVE_A2, content: "Procedimento em uso no Grupo A" })
    expect(JSON.stringify(group.body)).not.toContain("só do Grupo B")
    // Rascunho mais amplo, mas que inclui o Grupo dele: continua legível (só não pode publicar).
    expect((await request(appFor("GROUP_A").app).get(`/${DOC_WIDER_DRAFT}`)).body.data.draft).toMatchObject({ content: "Procedimento para todos os Grupos", restricted: false })
    const organization = await request(appFor("ORGANIZATION").app).get(`/${DOC_MOVED_DRAFT}`)
    expect(organization.body.data.draft).toMatchObject({ content: "Procedimento interno só do Grupo B", restricted: false })
    expect(organization.body.data.draft.config.orgScopes).toEqual([{ scopeType: "TEAM", teamId: TEAM_B }])
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

  it("PDF que estoura a memória do parser (cadeia de filtros que a pré-varredura não mede) é recusado com 422 e nada é gravado", async () => {
    const { app, writes } = appFor("ORGANIZATION")
    const bomb = await request(app).post("/").field("title", "Manual").field("documentType", "MANUAL").attach("file", chainedFilterBombPdf(), { filename: "manual.pdf", contentType: "application/pdf" })
    expect(bomb.status).toBe(422)
    expect(bomb.body.error.code).toBe("KNOWLEDGE_FILE_TYPE_MISMATCH")
    const unreadable = await request(app).post("/").field("title", "Manual").field("documentType", "MANUAL").attach("file", Buffer.from("%PDF-1.4\nisto não é um PDF\n"), { filename: "manual.pdf", contentType: "application/pdf" })
    expect(unreadable.status).toBe(422)
    expect(unreadable.body.error.code).toBe("KNOWLEDGE_EXTRACTION_FAILED")
    expect(writes).toEqual([])
    // Até quatro processos filhos de verdade: 5 s na máquina livre, mais que o limite padrão com a suíte inteira rodando junto.
  }, 60_000)
})
