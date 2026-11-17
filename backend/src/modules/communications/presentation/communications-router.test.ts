import express, { type ErrorRequestHandler } from "express"
import request from "supertest"
import { describe, expect, it } from "vitest"
import { ZodError } from "zod"
import { DomainError } from "../../../shared/domain/domain-error.js"
import type { AuthTokenPayload } from "../../auth/infrastructure/jwt.js"
import { InMemoryCommunicationStore } from "../testing/in-memory-communication-store.js"
import { createCommunicationsRouter } from "./communications-router.js"

const ORG = "00000000-0000-4000-8000-0000000000aa"
const OTHER_ORG = "00000000-0000-4000-8000-0000000000bb"
const P = { director: "d", manager: "m", supervisor: "s", op1: "o1", op2: "o2", inactive: "o3", outsider: "x", foreign: "f" }

const people = [
  { id: P.director, name: "Diretora", organizationId: ORG, reportsTo: null },
  { id: P.manager, name: "Gerente", organizationId: ORG, reportsTo: P.director },
  { id: P.supervisor, name: "Supervisora Ana", organizationId: ORG, reportsTo: P.manager },
  { id: P.op1, name: "Op 1", organizationId: ORG, reportsTo: P.supervisor },
  { id: P.op2, name: "Op 2", organizationId: ORG, reportsTo: P.supervisor },
  { id: P.inactive, name: "Op inativo", organizationId: ORG, reportsTo: P.supervisor, active: false },
  { id: P.outsider, name: "Outra equipe", organizationId: ORG, reportsTo: P.director },
  { id: P.foreign, name: "Outra org", organizationId: OTHER_ORG, reportsTo: P.supervisor },
]

function user(personId: string, account = `acc-${personId}`): AuthTokenPayload {
  return { sub: account, personId, organizationId: ORG, role: "SUPERVISOR", name: "x", email: "x@inia.com", avatarUrl: null, jobTitle: null, teamId: null, teamName: null }
}

function appAs(sessionUser: AuthTokenPayload | null, store: InMemoryCommunicationStore) {
  const app = express()
  app.use(express.json({ limit: "3mb" }))
  app.use((req, _res, next) => {
    if (sessionUser) req.user = sessionUser
    next()
  })
  app.use("/communications", (req, res, next) => (req.user ? next() : res.status(401).json({ error: { code: "UNAUTHENTICATED" } })), createCommunicationsRouter(store))
  const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
    void next
    if (error instanceof DomainError) return res.status(error.statusCode).json({ error: { code: error.code, message: error.message } })
    if (error instanceof ZodError) return res.status(400).json({ error: { code: "VALIDATION_ERROR" } })
    return res.status(500).json({ error: { code: "INTERNAL_ERROR" } })
  }
  app.use(errorHandler)
  return app
}

const body = (overrides: Record<string, unknown> = {}) => ({ title: "Mudança no processo", contentHtml: "<p>Leia <strong>com atenção</strong></p>", audience: "TEAM", tags: ["Processos"], ...overrides })
const PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg=="
/** GIF 1×1 com um bloco de comentário ("segredo") — o tipo de metadado que voltaria intacto. */
const GIF_1PX = Buffer.concat([Buffer.from("GIF89a\x01\x00\x01\x00\x80\x00\x00", "latin1"), Buffer.alloc(6, 0xff), Buffer.from("\x21\xfe\x06segredo\x00\x2c\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02\x44\x01\x00\x3b", "latin1")]).toString("base64")

describe("POST /communications — publicar", () => {
  it("sem sessão → 401; sem nenhuma das permissões → 403 sem gravar", async () => {
    const store = new InMemoryCommunicationStore(people)
    expect((await request(appAs(null, store)).post("/communications").send(body())).status).toBe(401)
    const denied = await request(appAs(user(P.supervisor), store)).post("/communications").send(body())
    expect(denied.status).toBe(403)
    expect(denied.body.error.code).toBe("COMMUNICATION_FORBIDDEN")
    expect(store.saved).toHaveLength(0)
  })

  it("equipe: público = toda a estrutura abaixo de quem publica, ativa, calculada no servidor", async () => {
    const store = new InMemoryCommunicationStore(people, { [`acc-${P.manager}`]: { team: true, organization: false } })
    const response = await request(appAs(user(P.manager), store)).post("/communications").send(body({ recipients: [P.outsider] }))
    // Campo desconhecido (tentativa de escolher destinatário) é recusado: o público nunca vem do navegador.
    expect(response.status).toBe(400)
    const ok = await request(appAs(user(P.manager), store)).post("/communications").send(body())
    expect(ok.status).toBe(201)
    expect(ok.body.data.recipientCount).toBe(3)
    expect(store.saved[0]!.recipients).toEqual(expect.arrayContaining([P.supervisor, P.op1, P.op2]))
    expect(store.saved[0]!.recipients).not.toContain(P.inactive)
    expect(store.saved[0]!.recipients).not.toContain(P.outsider)
    expect(store.saved[0]!.recipients).not.toContain(P.foreign)
    expect(store.saved[0]!.authorPersonId).toBe(P.manager)
    expect(store.saved[0]!.organizationId).toBe(ORG)
  })

  it("toda a empresa só com a permissão de organização; com ela, a própria equipe também", async () => {
    const store = new InMemoryCommunicationStore(people, { [`acc-${P.manager}`]: { team: true, organization: false }, [`acc-${P.director}`]: { team: false, organization: true } })
    const denied = await request(appAs(user(P.manager), store)).post("/communications").send(body({ audience: "ORGANIZATION" }))
    expect(denied.status).toBe(403)
    expect(denied.body.error.code).toBe("COMMUNICATION_AUDIENCE_FORBIDDEN")
    const company = await request(appAs(user(P.director), store)).post("/communications").send(body({ audience: "ORGANIZATION" }))
    expect(company.status).toBe(201)
    expect(company.body.data.recipientCount).toBe(5)
    expect((await request(appAs(user(P.director), store)).post("/communications").send(body())).status).toBe(201)
  })

  it("quem não lidera ninguém → 422 sem público", async () => {
    const store = new InMemoryCommunicationStore(people, { [`acc-${P.op1}`]: { team: true, organization: false } })
    const response = await request(appAs(user(P.op1), store)).post("/communications").send(body())
    expect(response.status).toBe(422)
    expect(response.body.error.code).toBe("COMMUNICATION_NO_AUDIENCE")
  })

  it("conteúdo saneado no servidor, texto derivado; imagem sem conteúdo legível é recusada", async () => {
    const store = new InMemoryCommunicationStore(people, { [`acc-${P.supervisor}`]: { team: true, organization: false } })
    const app = appAs(user(P.supervisor), store)
    const ok = await request(app).post("/communications").send(body({ contentHtml: `<p onclick="x">Olá<script>alert(1)</script></p><img src="data:image/png;base64,${PNG_1PX}" onerror="y">` }))
    expect(ok.status).toBe(201)
    expect(store.saved[0]!.contentHtml).toBe(`<p>Olá</p><img src="data:image/png;base64,${PNG_1PX}" alt="Imagem do comunicado">`)
    expect(store.saved[0]!.plainText).toBe("Olá")
    const fake = await request(app).post("/communications").send(body({ contentHtml: `<p>x</p><img src="data:image/png;base64,${Buffer.from("<svg onload=alert(1)>").toString("base64")}">` }))
    expect(fake.status).toBe(422)
    expect(fake.body.error.code).toBe("COMMUNICATION_IMAGE_INVALID")
    const empty = await request(app).post("/communications").send(body({ contentHtml: "<script>só isto</script>" }))
    expect(empty.status).toBe(422)
    expect(empty.body.error.code).toBe("COMMUNICATION_CONTENT_EMPTY")
    // Publicar exige categoria (rascunho não): a conferência é do serviço (220).
    const noTags = await request(app).post("/communications").send(body({ tags: [] }))
    expect(noTags.status).toBe(422)
    expect(noTags.body.error.code).toBe("COMMUNICATION_TAGS_REQUIRED")
    expect((await request(app).post("/communications").send(body({ tags: ["Outra"] }))).status).toBe(400)
    expect((await request(app).post("/communications").send(body({ title: "x" }))).status).toBe(400)
  })
  it("GIF é recusado com mensagem própria (o removedor de metadados não entende GIF), mesmo declarado como PNG", async () => {
    const store = new InMemoryCommunicationStore(people, { [`acc-${P.supervisor}`]: { team: true, organization: false } })
    const app = appAs(user(P.supervisor), store)
    for (const declared of ["gif", "png"]) {
      const response = await request(app).post("/communications").send(body({ contentHtml: `<p>x</p><img src="data:image/${declared};base64,${GIF_1PX}">` }))
      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe("COMMUNICATION_IMAGE_TYPE_UNSUPPORTED")
      expect(response.body.error.message).toContain("JPG, PNG ou WebP")
    }
    expect(store.saved).toHaveLength(0)
  })

  it("só imagem, sem texto, é aceito (a mesma regra que a tela aplica)", async () => {
    const store = new InMemoryCommunicationStore(people, { [`acc-${P.supervisor}`]: { team: true, organization: false } })
    const response = await request(appAs(user(P.supervisor), store)).post("/communications").send(body({ contentHtml: `<p><img src="data:image/png;base64,${PNG_1PX}"></p>` }))
    expect(response.status).toBe(201)
    expect(store.saved[0]!.plainText).toBe("(imagem)")
  })
})

describe("GET /communications/received — o que a pessoa da sessão recebeu", () => {
  it("só os da própria pessoa: equipe de cima e organização; nunca os de outra equipe", async () => {
    const store = new InMemoryCommunicationStore(people, { [`acc-${P.supervisor}`]: { team: true, organization: false }, [`acc-${P.director}`]: { team: false, organization: true } })
    await request(appAs(user(P.supervisor), store)).post("/communications").send(body({ title: "Da supervisora" }))
    await request(appAs(user(P.director), store)).post("/communications").send(body({ title: "Para todos", audience: "ORGANIZATION" }))
    const op = await request(appAs(user(P.op1), store)).get("/communications/received")
    expect(op.status).toBe(200)
    expect(op.body.data.items.map((item: { title: string }) => item.title)).toEqual(["Para todos", "Da supervisora"])
    const outsider = await request(appAs(user(P.outsider), store)).get("/communications/received")
    expect(outsider.body.data.items.map((item: { title: string }) => item.title)).toEqual(["Para todos"])
    const author = await request(appAs(user(P.supervisor), store)).get("/communications/received")
    expect(author.body.data.items.map((item: { title: string }) => item.title)).toEqual(["Para todos"])
  })
  it("lista LEVE: sem o conteúdo nem o texto inteiro; trecho do texto e se há imagem", async () => {
    const store = new InMemoryCommunicationStore(people, { [`acc-${P.supervisor}`]: { team: true, organization: false } })
    const app = appAs(user(P.supervisor), store)
    await request(app).post("/communications").send(body({ title: "Longo", contentHtml: `<p>${"palavra ".repeat(100)}</p><img src="data:image/png;base64,${PNG_1PX}">` }))
    await request(app).post("/communications").send(body({ title: "Só imagem", contentHtml: `<img src="data:image/png;base64,${PNG_1PX}">` }))
    await request(app).post("/communications").send(body({ title: "Curto" }))
    const response = await request(appAs(user(P.op1), store)).get("/communications/received")
    expect(response.status).toBe(200)
    const items = response.body.data.items as Record<string, unknown>[]
    for (const item of items) {
      expect(item).not.toHaveProperty("contentHtml")
      expect(item).not.toHaveProperty("plainText")
    }
    expect(items.map((item) => [item.title, item.hasImages])).toEqual([["Curto", false], ["Só imagem", true], ["Longo", true]])
    expect(items[0]!.excerpt).toBe("Leia com atenção")
    expect(items[1]!.excerpt).toBe("")
    expect(String(items[2]!.excerpt)).toMatch(/^palavra palavra .*…$/)
    expect(String(items[2]!.excerpt).length).toBeLessThanOrEqual(281)
  })
})

describe("GET /communications/:id — o conteúdo inteiro, com a visibilidade conferida de novo", () => {
  it("quem recebeu lê; o autor lê; outra equipe, outra organização, retirado ou id inexistente = 404; id inválido = 400", async () => {
    const store = new InMemoryCommunicationStore(people, { [`acc-${P.supervisor}`]: { team: true, organization: false } })
    const created = await request(appAs(user(P.supervisor), store)).post("/communications").send(body({ contentHtml: `<p>Olá</p><img src="data:image/png;base64,${PNG_1PX}">` }))
    const id = created.body.data.id as string
    const op = await request(appAs(user(P.op1), store)).get(`/communications/${id}`)
    expect(op.status).toBe(200)
    expect(op.body.data).toMatchObject({ id, contentHtml: `<p>Olá</p><img src="data:image/png;base64,${PNG_1PX}" alt="Imagem do comunicado">`, authoredByViewer: false, recipientCount: null })
    const author = await request(appAs(user(P.supervisor), store)).get(`/communications/${id}`)
    expect(author.body.data).toMatchObject({ authoredByViewer: true, recipientCount: 2 })
    expect((await request(appAs(user(P.outsider), store)).get(`/communications/${id}`)).status).toBe(404)
    expect((await request(appAs(user(P.manager), store)).get(`/communications/${id}`)).status).toBe(404)
    expect((await request(appAs({ ...user(P.op1), organizationId: OTHER_ORG }, store)).get(`/communications/${id}`)).status).toBe(404)
    expect((await request(appAs(user(P.op1), store)).get("/communications/00000000-0000-4000-8000-999999999999")).status).toBe(404)
    expect((await request(appAs(user(P.op1), store)).get("/communications/nao-e-uuid")).status).toBe(400)
    await request(appAs(user(P.supervisor), store)).delete(`/communications/${id}`)
    const retired = await request(appAs(user(P.op1), store)).get(`/communications/${id}`)
    expect(retired.status).toBe(404)
    expect(retired.body.error.code).toBe("COMMUNICATION_NOT_FOUND")
  })
})

describe("PATCH/DELETE /communications/:id — o autor edita ou retira", () => {
  const setup = async () => {
    const store = new InMemoryCommunicationStore(people, { [`acc-${P.supervisor}`]: { team: true, organization: false }, [`acc-${P.manager}`]: { team: true, organization: false } })
    const created = await request(appAs(user(P.supervisor), store)).post("/communications").send(body({ title: "Versão 1" }))
    return { store, id: created.body.data.id as string }
  }

  it("autor edita: conteúdo saneado de novo, versão anterior guardada, público intocado; campo de público é recusado", async () => {
    const { store, id } = await setup()
    const app = appAs(user(P.supervisor), store)
    // Depois que saiu, o público não muda (220: o campo existe para rascunho/agendado; aqui é 409).
    const locked = await request(app).patch(`/communications/${id}`).send({ title: "Versão 2", contentHtml: "<p>x</p>", tags: ["Aviso"], audience: "ORGANIZATION" })
    expect(locked.status).toBe(409)
    expect(locked.body.error.code).toBe("COMMUNICATION_AUDIENCE_LOCKED")
    const edited = await request(app).patch(`/communications/${id}`).send({ title: "Versão 2", contentHtml: `<p onclick="x">Novo<script>y</script></p>`, tags: ["Aviso", "Aviso"] })
    expect(edited.status).toBe(200)
    expect(edited.body.data).toMatchObject({ title: "Versão 2", contentHtml: "<p>Novo</p>", tags: ["Aviso"], editedAt: expect.any(String) })
    expect(store.revisions).toEqual([{ communicationId: id, title: "Versão 1", contentHtml: "<p>Leia <strong>com atenção</strong></p>", replacedBy: P.supervisor }])
    expect(store.saved[0]!.audience).toBe("TEAM")
  })

  it("outra pessoa (mesmo acima na estrutura) não edita nem retira: 404, sem revelar; id inválido = 400", async () => {
    const { store, id } = await setup()
    const manager = appAs(user(P.manager), store)
    expect((await request(manager).patch(`/communications/${id}`).send({ title: "Tomado", contentHtml: "<p>x</p>", tags: ["Aviso"] })).status).toBe(404)
    expect((await request(manager).delete(`/communications/${id}`)).status).toBe(404)
    expect((await request(manager).delete("/communications/nao-e-uuid")).status).toBe(400)
    expect(store.saved[0]!.title).toBe("Versão 1")
    expect(store.saved[0]!.deletedAt).toBeNull()
  })

  it("autor que perdeu o papel não edita (403) mas ainda retira; retirar é lógico e some de quem recebeu", async () => {
    const { store, id } = await setup()
    const withoutRole = appAs(user(P.supervisor, "acc-sem-papel"), store)
    const denied = await request(withoutRole).patch(`/communications/${id}`).send({ title: "Versão 2", contentHtml: "<p>x</p>", tags: ["Aviso"] })
    expect(denied.status).toBe(403)
    expect(denied.body.error.code).toBe("COMMUNICATION_EDIT_FORBIDDEN")
    expect((await request(withoutRole).delete(`/communications/${id}`)).status).toBe(204)
    expect(store.saved[0]).toMatchObject({ deletedAt: expect.any(String), deletedByPersonId: P.supervisor })
    expect((await request(appAs(user(P.op1), store)).get("/communications/received")).body.data.items).toEqual([])
    // Já retirado: não edita nem retira de novo.
    expect((await request(appAs(user(P.supervisor), store)).delete(`/communications/${id}`)).status).toBe(404)
    expect((await request(appAs(user(P.supervisor), store)).patch(`/communications/${id}`).send({ title: "Volta", contentHtml: "<p>x</p>", tags: ["Aviso"] })).status).toBe(404)
  })
})
