import express, { type ErrorRequestHandler } from "express"
import request from "supertest"
import { describe, expect, it } from "vitest"
import { ZodError } from "zod"
import { DomainError } from "../../../shared/domain/domain-error.js"
import type { AuthTokenPayload } from "../../auth/infrastructure/jwt.js"
import { sanitizeCommunicationHtml } from "../domain/communication-content.js"
import { communicationStateOf } from "../domain/communication.js"
import { InMemoryCommunicationStore } from "../testing/in-memory-communication-store.js"
import { createCommunicationsRouter } from "./communications-router.js"

// Área editorial (migration 220): rascunho, publicar agora × agendar, período de exibição, arquivar, público por recorte.
const ORG = "00000000-0000-4000-8000-0000000000aa"
const T_OUV = "00000000-0000-4000-8000-00000000a001"
const T_VEN = "00000000-0000-4000-8000-00000000a002"
const S_OUV1 = "00000000-0000-4000-8000-00000000b001"
const P = { director: "d", supervisor: "s", op1: "o1", op2: "o2", seller: "v1", b2b: "b1", admin: "adm" }

const people = [
  { id: P.director, name: "Diretora Carla", organizationId: ORG, reportsTo: null, jobTitle: "Diretora de Operações" },
  { id: P.supervisor, name: "Supervisora Ana", organizationId: ORG, reportsTo: P.director, teamId: T_OUV, universe: "B2C", jobTitle: "Supervisora" },
  { id: P.op1, name: "Op Ouvidoria 1", organizationId: ORG, reportsTo: P.supervisor, teamId: T_OUV, subteamId: S_OUV1, universe: "B2C" },
  { id: P.op2, name: "Op Ouvidoria 2", organizationId: ORG, reportsTo: P.supervisor, teamId: T_OUV, universe: "B2C" },
  { id: P.seller, name: "Vendas", organizationId: ORG, reportsTo: P.director, teamId: T_VEN, universe: "B2C" },
  { id: P.b2b, name: "Empresas", organizationId: ORG, reportsTo: P.director, teamId: T_VEN, universe: "B2B" },
]
const rights = { [`acc-${P.director}`]: { team: true, organization: true }, [`acc-${P.supervisor}`]: { team: true, organization: false }, [`acc-${P.admin}`]: { team: false, organization: false, moderate: true } }
const catalog = { teams: [{ id: T_OUV, subteams: [S_OUV1] }, { id: T_VEN }] }

function user(personId: string): AuthTokenPayload {
  return { sub: `acc-${personId}`, personId, organizationId: ORG, role: "SUPERVISOR", name: "x", email: "x@inia.com", avatarUrl: null, jobTitle: null, teamId: null, teamName: null }
}

function appAs(sessionUser: AuthTokenPayload, store: InMemoryCommunicationStore) {
  const app = express()
  app.use(express.json({ limit: "3mb" }))
  app.use((req, _res, next) => {
    req.user = sessionUser
    next()
  })
  app.use("/communications", createCommunicationsRouter(store))
  const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
    void next
    if (error instanceof DomainError) return res.status(error.statusCode).json({ error: { code: error.code, message: error.message } })
    if (error instanceof ZodError) return res.status(400).json({ error: { code: "VALIDATION_ERROR" } })
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: String(error) } })
  }
  app.use(errorHandler)
  return app
}

const newStore = () => new InMemoryCommunicationStore(people, rights, catalog)
const received = async (store: InMemoryCommunicationStore, personId: string) => (await request(appAs(user(personId), store)).get("/communications/received")).body.data.items.map((item: { title: string }) => item.title)

describe("rascunho", () => {
  it("guarda incompleto, não chega a ninguém e só o autor o vê na área editorial; publicar depois exige o conteúdo", async () => {
    const store = newStore()
    const app = appAs(user(P.supervisor), store)
    const draft = await request(app).post("/communications").send({ title: "Segunda via", contentHtml: "", tags: [], mode: "DRAFT" })
    expect(draft.status).toBe(201)
    expect(draft.body.data).toMatchObject({ status: "DRAFT", recipientCount: 0, publishedAt: null })
    const id = draft.body.data.id as string
    expect(await received(store, P.op1)).toEqual([])
    expect((await request(appAs(user(P.op1), store)).get(`/communications/${id}`)).status).toBe(404)
    expect((await request(app).get(`/communications/${id}`)).status).toBe(404) // fora do ar nem para o autor no feed
    expect((await request(app).get("/communications/mine")).body.data.items).toMatchObject([{ id, state: "DRAFT" }])

    const incomplete = await request(app).patch(`/communications/${id}`).send({ mode: "PUBLISH" })
    expect(incomplete.status).toBe(422)
    expect(incomplete.body.error.code).toBe("COMMUNICATION_TAGS_REQUIRED")
    const empty = await request(app).patch(`/communications/${id}`).send({ tags: ["Aviso"], mode: "PUBLISH" })
    expect(empty.body.error.code).toBe("COMMUNICATION_CONTENT_EMPTY")

    const published = await request(app).patch(`/communications/${id}`).send({ contentHtml: "<p>Use o app.</p>", tags: ["Processos"], mode: "PUBLISH" })
    expect(published.status).toBe(200)
    expect(published.body.data).toMatchObject({ status: "PUBLISHED", state: "PUBLISHED", recipientCount: 2 })
    expect(await received(store, P.op1)).toEqual(["Segunda via"])
    expect(store.revisions).toEqual([]) // rascunho não tem versões
  })

  it("rascunho não é arquivado (descarta-se); outra pessoa não o lê nem o altera", async () => {
    const store = newStore()
    const id = (await request(appAs(user(P.supervisor), store)).post("/communications").send({ title: "Rascunho", contentHtml: "<p>x</p>", tags: ["Aviso"], mode: "DRAFT" })).body.data.id
    expect((await request(appAs(user(P.supervisor), store)).post(`/communications/${id}/archive`)).body.error.code).toBe("COMMUNICATION_DRAFT_NOT_ARCHIVABLE")
    expect((await request(appAs(user(P.director), store)).get(`/communications/mine/${id}`)).status).toBe(404)
    expect((await request(appAs(user(P.director), store)).patch(`/communications/${id}`).send({ title: "Tomado" })).status).toBe(404)
    expect((await request(appAs(user(P.op1), store)).get("/communications/mine")).status).toBe(403)
  })
})

describe("agendar e período de exibição", () => {
  it("agendado só aparece na hora; antes dela público e horário mudam e pode voltar a rascunho", async () => {
    const store = newStore()
    const app = appAs(user(P.director), store)
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString()
    const scheduled = await request(app).post("/communications").send({ title: "Novo fluxo", contentHtml: "<p>A partir de amanhã.</p>", tags: ["Processos"], publishAt: tomorrow })
    expect(scheduled.status).toBe(201)
    const id = scheduled.body.data.id as string
    expect(await received(store, P.op1)).toEqual([])
    expect((await request(appAs(user(P.op1), store)).get(`/communications/${id}`)).status).toBe(404)
    expect((await request(app).get(`/communications/mine/${id}`)).body.data.state).toBe("SCHEDULED")

    // Ainda não saiu: o público muda (e é recalculado) e o comunicado pode voltar a rascunho.
    const retargeted = await request(app).patch(`/communications/${id}`).send({ audience: "SEGMENT", segment: { teamIds: [T_OUV] } })
    expect(retargeted.body.data).toMatchObject({ audience: "SEGMENT", state: "SCHEDULED", recipientCount: 3 })
    const back = await request(app).patch(`/communications/${id}`).send({ mode: "DRAFT" })
    expect(back.body.data).toMatchObject({ status: "DRAFT", recipientCount: 0, publishedAt: null })
    expect((await request(app).patch(`/communications/${id}`).send({ mode: "PUBLISH", publishAt: tomorrow })).body.data.state).toBe("SCHEDULED")

    store.now = () => new Date(Date.now() + 2 * 86_400_000)
    expect(await received(store, P.op1)).toEqual(["Novo fluxo"])
    expect(await received(store, P.seller)).toEqual([])
  })

  it("já no ar: público, horário e volta a rascunho ficam travados", async () => {
    const store = newStore()
    const app = appAs(user(P.director), store)
    const id = (await request(app).post("/communications").send({ title: "No ar", contentHtml: "<p>x</p>", tags: ["Aviso"], audience: "ORGANIZATION" })).body.data.id
    expect((await request(app).patch(`/communications/${id}`).send({ publishAt: "2099-01-01T00:00:00Z" })).body.error.code).toBe("COMMUNICATION_PUBLISHED_AT_LOCKED")
    expect((await request(app).patch(`/communications/${id}`).send({ mode: "DRAFT" })).body.error.code).toBe("COMMUNICATION_ALREADY_OUT")
    expect((await request(app).patch(`/communications/${id}`).send({ audience: "TEAM" })).body.error.code).toBe("COMMUNICATION_AUDIENCE_LOCKED")
    const edited = await request(app).patch(`/communications/${id}`).send({ summary: "Resumo novo", featured: true })
    expect(edited.body.data).toMatchObject({ summary: "Resumo novo", featured: true, audience: "ORGANIZATION" })
  })

  it("datas inválidas: agendar no passado, fim antes do início, mais de um ano", async () => {
    const app = appAs(user(P.supervisor), newStore())
    const base = { title: "Datas", contentHtml: "<p>x</p>", tags: ["Aviso"] }
    expect((await request(app).post("/communications").send({ ...base, publishAt: "2020-01-01T00:00:00Z" })).body.error.code).toBe("COMMUNICATION_SCHEDULE_IN_PAST")
    expect((await request(app).post("/communications").send({ ...base, displayUntil: "2020-01-01T00:00:00Z" })).body.error.code).toBe("COMMUNICATION_DISPLAY_WINDOW_INVALID")
    expect((await request(app).post("/communications").send({ ...base, publishAt: "2199-01-01T00:00:00Z" })).body.error.code).toBe("COMMUNICATION_SCHEDULE_TOO_FAR")
  })

  it("encerrado o período de exibição, sai do Acompanhamento e da leitura por id", async () => {
    const store = newStore()
    const app = appAs(user(P.supervisor), store)
    const until = new Date(Date.now() + 3_600_000).toISOString()
    const id = (await request(app).post("/communications").send({ title: "Campanha da semana", contentHtml: "<p>x</p>", tags: ["Campanha"], displayUntil: until })).body.data.id
    expect(await received(store, P.op1)).toEqual(["Campanha da semana"])
    store.now = () => new Date(Date.now() + 2 * 3_600_000)
    expect(await received(store, P.op1)).toEqual([])
    expect((await request(appAs(user(P.op1), store)).get(`/communications/${id}`)).status).toBe(404)
    expect((await request(app).get(`/communications/mine/${id}`)).body.data.state).toBe("EXPIRED")
  })
})

describe("arquivar", () => {
  it("arquivado sai de circulação, não é alterado e volta pelo desarquivar", async () => {
    const store = newStore()
    const app = appAs(user(P.supervisor), store)
    const id = (await request(app).post("/communications").send({ title: "Aviso", contentHtml: "<p>x</p>", tags: ["Aviso"] })).body.data.id
    expect((await request(app).post(`/communications/${id}/archive`)).status).toBe(204)
    expect(await received(store, P.op1)).toEqual([])
    expect((await request(app).patch(`/communications/${id}`).send({ title: "Mudar" })).body.error.code).toBe("COMMUNICATION_ARCHIVED")
    expect((await request(app).post(`/communications/${id}/archive`)).body.error.code).toBe("COMMUNICATION_ARCHIVE_STATE")
    expect((await request(app).post(`/communications/${id}/unarchive`)).status).toBe(204)
    expect(await received(store, P.op1)).toEqual(["Aviso"])
    expect(store.audits.map((entry) => entry.action)).toEqual(["PUBLISHED", "ARCHIVED", "UNARCHIVED"])
  })
})

describe("público por recorte (SEGMENT)", () => {
  it("só com a permissão de organização; Grupo e universo avaliados no servidor; prévia conta as pessoas", async () => {
    const store = newStore()
    const segment = { universe: "B2C", teamIds: [T_OUV], subteamIds: [] }
    const supervisor = await request(appAs(user(P.supervisor), store)).post("/communications").send({ title: "Ouvidoria", contentHtml: "<p>x</p>", tags: ["Aviso"], audience: "SEGMENT", segment })
    expect(supervisor.body.error.code).toBe("COMMUNICATION_AUDIENCE_FORBIDDEN")

    const director = appAs(user(P.director), store)
    expect((await request(director).post("/communications/audience-preview").send({ audience: "SEGMENT", segment })).body.data).toEqual({ recipientCount: 3 })
    const created = await request(director).post("/communications").send({ title: "Ouvidoria", contentHtml: "<p>x</p>", tags: ["Aviso"], audience: "SEGMENT", segment })
    expect(created.body.data.recipientCount).toBe(3)
    expect(await received(store, P.op1)).toEqual(["Ouvidoria"])
    expect(await received(store, P.seller)).toEqual([])
    expect(await received(store, P.b2b)).toEqual([])

    const universe = await request(director).post("/communications").send({ title: "Só B2B", contentHtml: "<p>x</p>", tags: ["Aviso"], audience: "SEGMENT", segment: { universe: "B2B" } })
    expect(universe.body.data.recipientCount).toBe(1)
    expect(await received(store, P.b2b)).toEqual(["Só B2B"])
    expect(await received(store, P.op1)).toEqual(["Ouvidoria"])
  })

  it("recorte vazio ou de outra organização é recusado", async () => {
    const director = appAs(user(P.director), newStore())
    expect((await request(director).post("/communications").send({ title: "Vazio", contentHtml: "<p>x</p>", tags: ["Aviso"], audience: "SEGMENT", segment: {} })).body.error.code).toBe("COMMUNICATION_SEGMENT_EMPTY")
    expect((await request(director).post("/communications").send({ title: "Fora", contentHtml: "<p>x</p>", tags: ["Aviso"], audience: "SEGMENT", segment: { teamIds: ["00000000-0000-4000-8000-00000000ffff"] } })).body.error.code).toBe("COMMUNICATION_REFERENCE_INVALID")
  })

  it("opções do público: Grupos só para quem publica para a organização", async () => {
    const store = newStore()
    expect((await request(appAs(user(P.supervisor), store)).get("/communications/audience-options")).body.data).toMatchObject({ teams: [], audiences: ["TEAM"] })
    expect((await request(appAs(user(P.director), store)).get("/communications/audience-options")).body.data).toMatchObject({ audiences: ["TEAM", "ORGANIZATION", "SEGMENT"], teams: [{ id: T_OUV }, { id: T_VEN }] })
  })
})

describe("conteúdo: links seguros e estado derivado", () => {
  it("link http(s) e caminho interno passam com rel fixo; javascript:, protocol-relative e barra invertida saem com o texto", () => {
    expect(sanitizeCommunicationHtml(`<p><a href="https://www.vivo.com.br/meuvivo" onclick="x">Meu Vivo</a></p>`).html).toBe(`<p><a href="https://www.vivo.com.br/meuvivo" target="_blank" rel="noopener noreferrer nofollow">Meu Vivo</a></p>`)
    expect(sanitizeCommunicationHtml(`<a href="/operator">painel</a>`).html).toBe(`<a href="/operator" target="_blank" rel="noopener noreferrer nofollow">painel</a>`)
    for (const href of ["javascript:alert(1)", "&#106;avascript:alert(1)", "//evil.example", "/\\evil.example", "data:text/html,x", "https://a b"]) {
      expect(sanitizeCommunicationHtml(`<a href="${href}">texto</a>`).html).toBe("texto")
    }
    expect(sanitizeCommunicationHtml(`<a href="https://a.example?x=1&y=2">q</a>`).html).toContain(`href="https://a.example?x=1&amp;y=2"`)
  })

  it("estado: agendado e encerrado são derivados das datas", () => {
    const now = new Date("2026-11-17T12:00:00Z")
    expect(communicationStateOf({ status: "PUBLISHED", publishedAt: "2026-11-18T00:00:00Z", displayUntil: null }, now)).toBe("SCHEDULED")
    expect(communicationStateOf({ status: "PUBLISHED", publishedAt: "2026-11-01T00:00:00Z", displayUntil: "2026-11-17T11:00:00Z" }, now)).toBe("EXPIRED")
    expect(communicationStateOf({ status: "PUBLISHED", publishedAt: "2026-11-01T00:00:00Z", displayUntil: "2026-11-30T00:00:00Z" }, now)).toBe("PUBLISHED")
    expect(communicationStateOf({ status: "ARCHIVED", publishedAt: "2026-11-01T00:00:00Z", displayUntil: null }, now)).toBe("ARCHIVED")
  })
})

describe("moderação (Administrador geral, `communications.moderate`)", () => {
  it("retira a publicação de outra pessoa com motivo; sem a permissão, nem lista nem retira; rascunho alheio continua privado", async () => {
    const store = newStore()
    const supervisor = appAs(user(P.supervisor), store)
    const id = (await request(supervisor).post("/communications").send({ title: "Gracinha", contentHtml: "<p>Texto impróprio</p>", tags: ["Aviso"] })).body.data.id
    const draftId = (await request(supervisor).post("/communications").send({ title: "Rascunho alheio", contentHtml: "", tags: [], mode: "DRAFT" })).body.data.id
    expect(await received(store, P.op1)).toEqual(["Gracinha"])

    // Quem publica para a organização (mas não modera) não lista nem retira o de outra pessoa.
    const director = appAs(user(P.director), store)
    expect((await request(director).get("/communications/moderation")).body.error.code).toBe("COMMUNICATION_MODERATION_FORBIDDEN")
    expect((await request(director).post(`/communications/${id}/moderate-retire`).send({ reason: "Conteúdo fora da política." })).status).toBe(403)
    expect((await request(director).delete(`/communications/${id}`)).status).toBe(404)

    const admin = appAs(user(P.admin), store)
    expect(((await request(admin).get("/communications/moderation")).body.data.items as { title: string; author: { name: string } }[]).map((item) => [item.title, item.author.name])).toEqual([["Gracinha", "Supervisora Ana"]])
    expect((await request(admin).get(`/communications/moderation/${draftId}`)).status).toBe(404)
    expect((await request(admin).get(`/communications/moderation/${id}`)).body.data).toMatchObject({ title: "Gracinha", contentHtml: "<p>Texto impróprio</p>" })
    // Motivo obrigatório; a moderação não edita o texto de ninguém.
    expect((await request(admin).post(`/communications/${id}/moderate-retire`).send({ reason: "curto" })).status).toBe(400)
    expect((await request(admin).patch(`/communications/${id}`).send({ title: "Trocado" })).status).toBe(404)
    expect((await request(admin).post(`/communications/${draftId}/moderate-retire`).send({ reason: "Rascunho não é moderado." })).status).toBe(404)

    expect((await request(admin).post(`/communications/${id}/moderate-retire`).send({ reason: "Conteúdo fora da política de comunicação." })).status).toBe(204)
    expect(await received(store, P.op1)).toEqual([])
    expect((await request(appAs(user(P.op1), store)).get(`/communications/${id}`)).status).toBe(404)
    expect((await request(admin).post(`/communications/${id}/moderate-retire`).send({ reason: "De novo, já retirada." })).status).toBe(404)
    expect(store.saved.find((item) => item.id === id)).toMatchObject({ deletedByPersonId: P.admin, title: "Gracinha" })
  })
})

