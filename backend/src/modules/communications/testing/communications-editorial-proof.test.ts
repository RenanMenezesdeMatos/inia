/**
 * PROVA contra o banco de TESTE real: área editorial dos comunicados (migration 220) e o comunicado no chat
 * (`COMMUNICATION_CONVERSATION_V2`), pela API de verdade (login, cookie, app.ts).
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run communications-editorial-proof
 *
 * Exemplo da fatura: a diretora (papel de organização) escreve um comunicado para a Ouvidoria sobre onde fica a segunda via no app.
 * - Rascunho: não chega a ninguém (Acompanhamento, leitura por id e chat); só o autor o vê na área editorial.
 * - Agendado: só aparece quando chega a hora (simulada no banco); antes disso, nada no feed nem no chat.
 * - Público específico (Grupo Ouvidoria): a operadora da Ouvidoria recebe; a de Vendas não — nem no chat.
 * - Fim da exibição e arquivamento tiram do feed e do chat; desarquivar devolve. Tudo auditado, sem o conteúdo.
 * - O chat só leva o comunicado relacionado à pergunta, com autoria e cargo do cadastro e o link.
 * Organização PRÓPRIA da prova, apagada no fim. Nenhuma chamada de modelo.
 */
import pg from "pg"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { createApp } from "../../../main/app.js"
import { hashPassword } from "../../auth/infrastructure/password-hasher.js"
import { loadCommunicationsForConversation } from "../infrastructure/communication-conversation-loader.js"
import { fakePublicationRelevanceModel } from "./fake-publication-relevance-model.js"
import { loadLeaderStructureBlock, loadStructureSubjects } from "../infrastructure/leader-structure-context.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "c0ffee00-0000-4000-8000-0000000c0220"
const PASSWORD = "Proof@12345"

let pool: pg.Pool
let db: Database
const ids: Record<string, string> = {}

async function cleanup() {
  await db.query(`delete from communication_recipients where organization_id = $1`, [ORG])
  await db.query(`delete from communication_revisions where organization_id = $1`, [ORG])
  await db.query(`delete from communication_segment_scopes where organization_id = $1`, [ORG])
  await db.query(`delete from communications where organization_id = $1`, [ORG])
  await db.query(`delete from audit_logs where organization_id = $1`, [ORG])
  await db.query(`delete from access_role_assignments where organization_id = $1`, [ORG])
  await db.query(`delete from auth_session_activity where account_id in (select id from user_accounts where organization_id = $1)`, [ORG]).catch(() => undefined)
  await db.query(`delete from auth_revoked_sessions where account_id in (select id from user_accounts where organization_id = $1)`, [ORG]).catch(() => undefined)
  await db.query(`delete from user_accounts where organization_id = $1`, [ORG])
  if ((await db.query(`select to_regclass('person_operating_universe_history') is not null present`)).rows[0]?.present) await db.query(`delete from person_operating_universe_history where organization_id = $1`, [ORG])
  await db.query(`update people set reports_to_id = null where organization_id = $1`, [ORG])
  await db.query(`delete from people where organization_id = $1`, [ORG])
  await db.query(`delete from subteams where organization_id = $1`, [ORG])
  await db.query(`delete from teams where organization_id = $1`, [ORG])
  await db.query(`delete from operations where organization_id = $1`, [ORG])
  await db.query(`delete from organizations where id = $1`, [ORG])
}

async function person(key: string, name: string, role: string, reportsTo: string | null, options: { teamId?: string; jobTitle?: string; email?: string; grant?: { role: string; scope: string } } = {}) {
  const id = (await db.query<{ id: string }>(`insert into people (organization_id, name, role, reports_to_id, team_id, job_title) values ($1, $2, $3, $4, $5, $6) returning id`, [ORG, name, role, reportsTo, options.teamId ?? null, options.jobTitle ?? null])).rows[0]!.id
  ids[key] = id
  if (options.email) {
    const account = (await db.query<{ id: string }>(`insert into user_accounts (organization_id, person_id, email, password_hash) values ($1, $2, $3, $4) returning id`, [ORG, id, options.email, await hashPassword(PASSWORD)])).rows[0]!.id
    if (options.grant) await db.query(`insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, granted_at) values ($1, $2, $3, $4, now())`, [ORG, account, options.grant.role, options.grant.scope])
  }
  return id
}

describe.skipIf(!ENABLED)("Publicações — prova Postgres (migration 220) e comunicado no chat", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL, max: 6 })
    db = pool
    await cleanup()
    await db.query(`insert into organizations (id, name, slug) values ($1, 'PUB Proof', 'pub-proof')`, [ORG])
    const operation = (await db.query<{ id: string }>(`insert into operations (organization_id, name, timezone) values ($1, 'Operação Prova', 'America/Sao_Paulo') returning id`, [ORG])).rows[0]!.id
    ids.teamOuvidoria = (await db.query<{ id: string }>(`insert into teams (organization_id, operation_id, name) values ($1, $2, 'Ouvidoria Prova') returning id`, [ORG, operation])).rows[0]!.id
    ids.teamVendas = (await db.query<{ id: string }>(`insert into teams (organization_id, operation_id, name) values ($1, $2, 'Vendas Prova') returning id`, [ORG, operation])).rows[0]!.id
    const director = await person("director", "Mariana Souza", "MANAGER", null, { jobTitle: "Gerente de Operações", email: "pub.diretora@proof.inia.local", grant: { role: "COMUNICADOS_DA_EMPRESA", scope: "ORGANIZATION" } })
    await person("ouvidoria", "Operadora Ouvidoria", "OPERATOR", director, { teamId: ids.teamOuvidoria, email: "pub.ouv@proof.inia.local" })
    await person("vendas", "Operadora Vendas", "OPERATOR", director, { teamId: ids.teamVendas, email: "pub.ven@proof.inia.local" })
    await person("admin", "Administradora Geral Prova", "MANAGER", null, { email: "pub.admin@proof.inia.local", grant: { role: "ADMINISTRADOR_GERAL", scope: "ORGANIZATION" } })
  }, 60_000)

  afterAll(async () => {
    if (!db) return
    await cleanup()
    await pool.end()
  })

  const login = async (email: string) => {
    const agent = request.agent(createApp(db, { rateLimits: false }))
    expect((await agent.post("/api/v1/auth/login").send({ email, password: PASSWORD })).status).toBe(200)
    return agent
  }
  const received = async (agent: request.Agent) => ((await agent.get("/api/v1/communications/received")).body.data.items as { title: string }[]).map((item) => item.title)
  const QUESTION = "O cliente pediu a segunda via da fatura, onde fica no app?"
  // A decisão de relevância é da IA (`PUBLICATION_RELEVANCE_V1`); aqui um modelo falso — a prova é de visibilidade, não de relevância.
  const model = fakePublicationRelevanceModel([{ whenQuestionIncludes: "segunda via", titleIncludes: "segunda via" }, { whenQuestionIncludes: "segunda via", titleIncludes: "fatura" }])
  const chat = async (personKey: string) => (await loadCommunicationsForConversation(db, { organizationId: ORG, personId: ids[personKey]!, question: QUESTION, model })).items.map((item) => item.title)
  const TITLE = "Segunda via da fatura no App Meu Telnova"
  const BODY = `<h2>Onde fica</h2><p>No App Meu Telnova: Conta &gt; Faturas &gt; Segunda via. Veja <a href="https://www.telnova.com.br/meutelnova">o Meu Telnova</a>.</p>`

  it("rascunho → agendado → no ar para o recorte → encerrado → arquivado → desarquivado, com o chat acompanhando cada passo", async () => {
    const diretora = await login("pub.diretora@proof.inia.local")
    const ouvidoria = await login("pub.ouv@proof.inia.local")
    const vendas = await login("pub.ven@proof.inia.local")

    // Rascunho: ninguém recebe; nem o chat.
    const draft = await diretora.post("/api/v1/communications").send({ title: TITLE, contentHtml: "", tags: [], mode: "DRAFT" })
    expect(draft.status).toBe(201)
    const id: string = draft.body.data.id
    expect((await db.query(`select status, published_at, recipient_count from communications where id = $1`, [id])).rows[0]).toEqual({ status: "DRAFT", published_at: null, recipient_count: 0 })
    expect(await received(ouvidoria)).toEqual([])
    expect((await ouvidoria.get(`/api/v1/communications/${id}`)).status).toBe(404)
    expect(await chat("ouvidoria")).toEqual([])

    // Agendado para amanhã, Grupo Ouvidoria: a prévia conta 1 pessoa; nada aparece antes da hora.
    const previewResponse = await diretora.post("/api/v1/communications/audience-preview").send({ audience: "SEGMENT", segment: { teamIds: [ids.teamOuvidoria] } })
    expect(previewResponse.body).toMatchObject({ data: { recipientCount: 1 } })
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString()
    const scheduled = await diretora.patch(`/api/v1/communications/${id}`).send({ contentHtml: BODY, tags: ["Processos"], summary: "Caminho da segunda via no app.", audience: "SEGMENT", segment: { teamIds: [ids.teamOuvidoria] }, publishAt: tomorrow, mode: "PUBLISH" })
    expect(scheduled.status).toBe(200)
    expect(scheduled.body.data).toMatchObject({ state: "SCHEDULED", recipientCount: 1, audience: "SEGMENT" })
    expect(await received(ouvidoria)).toEqual([])
    expect(await chat("ouvidoria")).toEqual([])
    const stored = (await db.query<{ content_html: string }>(`select content_html from communications where id = $1`, [id])).rows[0]!
    expect(stored.content_html).toContain(`<a href="https://www.telnova.com.br/meutelnova" target="_blank" rel="noopener noreferrer nofollow">o Meu Telnova</a>`)

    // Chegou a hora (simulada): a Ouvidoria recebe e o chat usa o comunicado com autoria e cargo do cadastro; Vendas não.
    await db.query(`update communications set published_at = now() - interval '1 minute' where id = $1`, [id])
    expect(await received(ouvidoria)).toEqual([TITLE])
    expect(await received(vendas)).toEqual([])
    expect((await vendas.get(`/api/v1/communications/${id}`)).status).toBe(404)
    const loaded = await loadCommunicationsForConversation(db, { organizationId: ORG, personId: ids.ouvidoria!, question: QUESTION, model })
    expect(loaded.items.map((item) => item.title)).toEqual([TITLE])
    expect(loaded.promptBlock).toContain("Publicado por: Mariana Souza (Gerente de Operações)")
    expect(loaded.promptBlock).toContain(`Link: /publicacoes/${id}`)
    expect(await chat("vendas")).toEqual([])
    // Pergunta sem relação: nada entra.
    expect((await loadCommunicationsForConversation(db, { organizationId: ORG, personId: ids.ouvidoria!, question: "Qual o horário da confraternização?", model })).items).toEqual([])

    // Já no ar: público travado; o texto muda com versão guardada.
    expect((await diretora.patch(`/api/v1/communications/${id}`).send({ audience: "ORGANIZATION" })).body.error.code).toBe("COMMUNICATION_AUDIENCE_LOCKED")
    expect((await diretora.patch(`/api/v1/communications/${id}`).send({ summary: "Atualizado." })).status).toBe(200)
    expect((await db.query(`select count(*)::int n from communication_revisions where communication_id = $1`, [id])).rows[0].n).toBeGreaterThanOrEqual(1)

    // Fim da exibição: sai do feed e do chat; a área editorial mostra "Encerrado".
    await db.query(`update communications set display_until = now() - interval '1 second', published_at = now() - interval '1 hour' where id = $1`, [id])
    expect(await received(ouvidoria)).toEqual([])
    expect(await chat("ouvidoria")).toEqual([])
    expect((await diretora.get(`/api/v1/communications/mine/${id}`)).body.data.state).toBe("EXPIRED")
    await db.query(`update communications set display_until = null where id = $1`, [id])

    // Arquivar e desarquivar.
    expect((await diretora.post(`/api/v1/communications/${id}/archive`)).status).toBe(204)
    expect(await received(ouvidoria)).toEqual([])
    expect(await chat("ouvidoria")).toEqual([])
    expect((await diretora.post(`/api/v1/communications/${id}/unarchive`)).status).toBe(204)
    expect(await received(ouvidoria)).toEqual([TITLE])
    expect(await chat("ouvidoria")).toEqual([TITLE])

    // A área editorial da diretora lista a publicação; a operadora não tem área editorial.
    expect(((await diretora.get("/api/v1/communications/mine")).body.data.items as { id: string }[]).map((item) => item.id)).toEqual([id])
    expect((await ouvidoria.get("/api/v1/communications/mine")).status).toBe(403)

    // Auditoria do ciclo, sem o conteúdo.
    const actions = (await db.query<{ action: string; payload: unknown }>(`select action, payload from audit_logs where organization_id = $1 and entity_id = $2 order by created_at, id`, [ORG, id])).rows
    expect(actions.map((row) => row.action)).toEqual(expect.arrayContaining(["COMMUNICATION_DRAFT_SAVED", "COMMUNICATION_SCHEDULED", "COMMUNICATION_EDITED", "COMMUNICATION_ARCHIVED", "COMMUNICATION_UNARCHIVED"]))
    expect(JSON.stringify(actions)).not.toContain("Conta > Faturas")
  })

  it("moderação: o Administrador geral retira a publicação de outra pessoa com motivo; sai do feed e do chat na hora", async () => {
    const diretora = await login("pub.diretora@proof.inia.local")
    const admin = await login("pub.admin@proof.inia.local")
    const ouvidoria = await login("pub.ouv@proof.inia.local")
    expect((await admin.get("/api/v1/auth/me")).body.data.access.capabilities).toMatchObject({ canModerateCommunications: true })
    expect((await diretora.get("/api/v1/auth/me")).body.data.access.capabilities).toMatchObject({ canModerateCommunications: false })

    const created = await diretora.post("/api/v1/communications").send({ title: "Fatura: atalho proibido", contentHtml: "<p>Segunda via da fatura: mande o cliente para um link pessoal.</p>", tags: ["Aviso"], audience: "SEGMENT", segment: { teamIds: [ids.teamOuvidoria] } })
    expect(created.status).toBe(201)
    const id: string = created.body.data.id
    expect(await received(ouvidoria)).toContain("Fatura: atalho proibido")
    expect(await chat("ouvidoria")).toContain("Fatura: atalho proibido")

    // A diretora não modera; o admin não edita o texto de outra pessoa.
    expect((await diretora.get("/api/v1/communications/moderation")).status).toBe(403)
    expect((await admin.patch(`/api/v1/communications/${id}`).send({ title: "x" })).status).toBe(404)
    expect(((await admin.get("/api/v1/communications/moderation")).body.data.items as { id: string }[]).map((item) => item.id)).toContain(id)

    const retired = await admin.post(`/api/v1/communications/${id}/moderate-retire`).send({ reason: "Orientação contrária ao procedimento oficial." })
    expect(retired.status).toBe(204)
    expect(await received(ouvidoria)).not.toContain("Fatura: atalho proibido")
    expect(await chat("ouvidoria")).not.toContain("Fatura: atalho proibido")
    const row = (await db.query(`select deleted_at is not null retired, deleted_by_person_id::text "by", title from communications where id = $1`, [id])).rows[0]
    expect(row).toEqual({ retired: true, by: ids.admin, title: "Fatura: atalho proibido" })
    const audit = (await db.query<{ actor: string; payload: Record<string, unknown> }>(`select actor_id::text actor, payload from audit_logs where organization_id = $1 and entity_id = $2 and action = 'COMMUNICATION_RETIRED'`, [ORG, id])).rows
    expect(audit).toEqual([{ actor: ids.admin, payload: expect.objectContaining({ moderation: true, authorPersonId: ids.director, reason: "Orientação contrária ao procedimento oficial." }) }])
  })

  it("visão da estrutura do gestor: públicos e comunicados dos Grupos consultados, pelo SQL real", async () => {
    // A diretora lidera a Ouvidoria e Vendas; o Administrador geral publica só para a Ouvidoria (ela não está no recorte).
    const admin = await login("pub.admin@proof.inia.local")
    const created = await admin.post("/api/v1/communications").send({ title: "Segunda via no app para a Ouvidoria", contentHtml: "<p>A segunda via da fatura fica em Conta > Faturas no app.</p>", tags: ["Aviso"], audience: "SEGMENT", segment: { teamIds: [ids.teamOuvidoria] } })
    expect(created.status).toBe(201)
    const subjects = await loadStructureSubjects(db, ORG, { kind: "LEADER_STRUCTURE", leaderPersonId: ids.director!, teamIds: null })
    expect(subjects.map((subject) => subject.teamId).sort()).toEqual([ids.teamOuvidoria, ids.teamVendas].sort())
    const own = await loadCommunicationsForConversation(db, { organizationId: ORG, personId: ids.director!, question: QUESTION, model })
    expect(own.items.map((item) => item.title)).not.toContain("Segunda via no app para a Ouvidoria")
    const ouvidoria = await loadCommunicationsForConversation(db, { organizationId: ORG, personId: ids.director!, question: QUESTION, model, structure: { kind: "LEADER_STRUCTURE", leaderPersonId: ids.director!, teamIds: [ids.teamOuvidoria!], groupNames: ["Ouvidoria Prova"] } })
    expect(ouvidoria.items.map((item) => item.title)).toContain("Segunda via no app para a Ouvidoria")
    expect(ouvidoria.promptBlock).toContain("COMUNICADOS PUBLICADOS PARA PESSOAS DO GRUPO OUVIDORIA PROVA")
    const vendas = await loadCommunicationsForConversation(db, { organizationId: ORG, personId: ids.director!, question: QUESTION, model, structure: { kind: "LEADER_STRUCTURE", leaderPersonId: ids.director!, teamIds: [ids.teamVendas!], groupNames: ["Vendas Prova"] } })
    expect(vendas.items.map((item) => item.title)).not.toContain("Segunda via no app para a Ouvidoria")
    const whole = await loadLeaderStructureBlock(db, { organizationId: ORG, scope: { kind: "LEADER_STRUCTURE", leaderPersonId: ids.director!, teamIds: null }, question: QUESTION, model })
    expect(whole.communicationIds).toContain(created.body.data.id)
  })
  it("recorte multi-grupo (223): Grupo inteiro + um Subgrupo de outro Grupo; irmão e terceiro Grupo de fora, também na API e no chat; uma vez por pessoa", async () => {
    const diretora = await login("pub.diretora@proof.inia.local")
    const operation = (await db.query<{ id: string }>(`select id from operations where organization_id = $1 limit 1`, [ORG])).rows[0]!.id
    const teamB = (await db.query<{ id: string }>(`insert into teams (organization_id, operation_id, name) values ($1, $2, 'Retenção Prova MG') returning id`, [ORG, operation])).rows[0]!.id
    const teamC = (await db.query<{ id: string }>(`insert into teams (organization_id, operation_id, name) values ($1, $2, 'Terceiro Prova MG') returning id`, [ORG, operation])).rows[0]!.id
    const subB1 = (await db.query<{ id: string }>(`insert into subteams (organization_id, team_id, name) values ($1, $2, 'B1 Prova MG') returning id`, [ORG, teamB])).rows[0]!.id
    const subB2 = (await db.query<{ id: string }>(`insert into subteams (organization_id, team_id, name) values ($1, $2, 'B2 Prova MG') returning id`, [ORG, teamB])).rows[0]!.id
    const member = async (key: string, teamId: string, subteamId: string | null) => {
      const id = await person(key, `Pessoa ${key}`, "OPERATOR", ids.director!, { teamId, email: `pub.mg.${key}@proof.inia.local` })
      if (subteamId) await db.query(`update people set subteam_id = $2 where id = $1`, [id, subteamId])
      return login(`pub.mg.${key}@proof.inia.local`)
    }
    const inB1 = await member("b1", teamB, subB1)
    const inB2 = await member("b2", teamB, subB2)
    const inC = await member("c", teamC, null)
    const inA = await login("pub.ouv@proof.inia.local")
    const segment = { universe: null, links: [{ teamId: ids.teamOuvidoria }, { subteamId: subB1 }] }

    // Validação: Subgrupo de outro Grupo, Subgrupo junto do próprio Grupo inteiro, repetido.
    const send = (links: unknown[]) => diretora.post("/api/v1/communications/audience-preview").send({ audience: "SEGMENT", segment: { universe: null, links } })
    expect((await send([{ teamId: ids.teamOuvidoria, subteamId: subB1 }])).body.error.code).toBe("COMMUNICATION_REFERENCE_INVALID")
    expect((await send([{ teamId: teamB }, { subteamId: subB1 }])).body.error.code).toBe("COMMUNICATION_SEGMENT_INVALID")
    expect((await send([{ teamId: teamB }, { teamId: teamB }])).body.error.code).toBe("COMMUNICATION_SEGMENT_INVALID")
    // Prévia: Ouvidoria (1) + B1 (1) — cada pessoa uma vez.
    expect((await diretora.post("/api/v1/communications/audience-preview").send({ audience: "SEGMENT", segment })).body.data.recipientCount).toBe(2)

    const title = "Segunda via — Ouvidoria e B1"
    const created = await diretora.post("/api/v1/communications").send({ title, contentHtml: "<p>A segunda via da fatura fica em Conta &gt; Faturas no app.</p>", tags: ["Aviso"], audience: "SEGMENT", segment })
    expect(created.status).toBe(201)
    const id: string = created.body.data.id
    const editorial = (await diretora.get(`/api/v1/communications/mine/${id}`))
    expect(editorial.body.data.segment.links).toEqual([expect.objectContaining({ teamId: ids.teamOuvidoria, subteamId: null }), expect.objectContaining({ teamId: teamB, subteamId: subB1 })])
    const sees = async (agent: request.Agent) => (await received(agent)).filter((item) => item === title).length
    expect(await sees(inA)).toBe(1)
    expect(await sees(inB1)).toBe(1)
    expect(await sees(inB2)).toBe(0)
    expect(await sees(inC)).toBe(0)
    // Chamada direta pelo id: fora do recorte = 404.
    expect((await inB2.get(`/api/v1/communications/${id}`)).status).toBe(404)
    expect((await inC.get(`/api/v1/communications/${id}`)).status).toBe(404)
    expect((await inB1.get(`/api/v1/communications/${id}`)).status).toBe(200)
    // Chat: o mesmo público.
    expect(await chat("b1")).toContain(title)
    expect(await chat("b2")).not.toContain(title)
    // Público fixo depois que saiu.
    expect((await diretora.patch(`/api/v1/communications/${id}`).send({ audience: "SEGMENT", segment: { universe: null, links: [{ teamId: ids.teamOuvidoria }] } })).body.error.code).toBe("COMMUNICATION_AUDIENCE_LOCKED")

    // Agendado (ainda não saiu): tirar o B1 tira o acesso dele quando entrar no ar; Ouvidoria continua.
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString()
    const scheduled = await diretora.post("/api/v1/communications").send({ title: "Agendado MG", contentHtml: "<p>Aviso de amanhã.</p>", tags: ["Aviso"], audience: "SEGMENT", segment, publishAt: tomorrow })
    expect(scheduled.body.data.recipientCount).toBe(2)
    const narrowed = await diretora.patch(`/api/v1/communications/${scheduled.body.data.id}`).send({ audience: "SEGMENT", segment: { universe: null, links: [{ teamId: ids.teamOuvidoria }] } })
    expect(narrowed.status).toBe(200)
    const stored = (await db.query<{ n: number }>(`select count(*)::int n from communication_segment_scopes where communication_id = $1`, [scheduled.body.data.id])).rows[0]!.n
    expect(stored).toBe(1)
    await db.query(`update communications set published_at = now() - interval '1 minute' where id = $1`, [scheduled.body.data.id])
    expect((await received(inB1)).includes("Agendado MG")).toBe(false)
    expect((await received(inA)).includes("Agendado MG")).toBe(true)
  })
})

