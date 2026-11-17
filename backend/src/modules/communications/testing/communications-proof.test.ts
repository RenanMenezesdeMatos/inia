/**
 * PROVA contra o banco de TESTE real: comunicados da liderança (migration 199), pela API de verdade (login, cookie, app.ts).
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run communications-proof
 *
 * - A supervisora publica para a equipe; uma sessão NOVA (recarregar) ainda vê o comunicado no Acompanhamento dela, com o número
 *   de destinatários; o público foi calculado pelo servidor (toda a estrutura abaixo, ativa) e a auditoria não leva o conteúdo.
 * - "Toda a empresa" só com o papel de organização; sem papel nenhum, 403 — o nível hierárquico não dá o direito.
 * - Cada colaborador vê no Acompanhamento dele o que recebeu (da equipe de cima e da organização); outra equipe e outra
 *   organização não veem; o conteúdo chega saneado.
 * - O feed da estrutura traz o comunicado como ramo próprio (NOTICE) no mesmo keyset e no mesmo recorte since/until; "Só
 *   aguardando ciência" não o traz (comunicado é só leitura).
 * Organizações PRÓPRIAS da prova, apagadas no fim. Nenhuma chamada de modelo.
 */
import pg from "pg"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { createApp } from "../../../main/app.js"
import { hashPassword } from "../../auth/infrastructure/password-hasher.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "c0ffee00-0000-4000-8000-0000000c0199"
const OTHER_ORG = "c0ffee00-0000-4000-8000-0000000c0299"
const PASSWORD = "Proof@12345"

let pool: pg.Pool
let db: Database
const ids: Record<string, string> = {}

async function cleanup() {
  for (const org of [ORG, OTHER_ORG]) {
    await db.query(`delete from communication_recipients where organization_id = $1`, [org])
    await db.query(`delete from communication_revisions where organization_id = $1`, [org])
    await db.query(`delete from communications where organization_id = $1`, [org])
    await db.query(`delete from audit_logs where organization_id = $1`, [org])
    await db.query(`delete from access_role_assignments where organization_id = $1`, [org])
    await db.query(`delete from auth_session_activity where account_id in (select id from user_accounts where organization_id = $1)`, [org]).catch(() => undefined)
    await db.query(`delete from auth_revoked_sessions where account_id in (select id from user_accounts where organization_id = $1)`, [org]).catch(() => undefined)
    await db.query(`delete from user_accounts where organization_id = $1`, [org])
    // Histórico do universo de atuação (migration 197, quando aplicada no banco de teste) segura a pessoa pela chave estrangeira.
    if ((await db.query(`select to_regclass('person_operating_universe_history') is not null present`)).rows[0]?.present) await db.query(`delete from person_operating_universe_history where organization_id = $1`, [org])
    await db.query(`update people set reports_to_id = null where organization_id = $1`, [org])
    await db.query(`delete from people where organization_id = $1`, [org])
    await db.query(`delete from organizations where id = $1`, [org])
  }
}

async function person(key: string, organizationId: string, name: string, role: string, reportsTo: string | null, options: { active?: boolean; email?: string; grant?: { role: string; scope: string }; extraGrant?: { role: string; scope: string } } = {}) {
  const id = (await db.query<{ id: string }>(`insert into people (organization_id, name, role, reports_to_id, active) values ($1, $2, $3, $4, $5) returning id`, [organizationId, name, role, reportsTo, options.active ?? true])).rows[0]!.id
  ids[key] = id
  if (options.email) {
    const account = (await db.query<{ id: string }>(`insert into user_accounts (organization_id, person_id, email, password_hash) values ($1, $2, $3, $4) returning id`, [organizationId, id, options.email, await hashPassword(PASSWORD)])).rows[0]!.id
    for (const grant of [options.grant, options.extraGrant]) if (grant) await db.query(`insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, granted_at) values ($1, $2, $3, $4, now())`, [organizationId, account, grant.role, grant.scope])
  }
  return id
}

describe.skipIf(!ENABLED)("Comunicados da liderança — prova Postgres (migration 199)", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL, max: 6 })
    db = pool
    await cleanup()
    await db.query(`insert into organizations (id, name, slug) values ($1, 'COM Proof', 'com-proof'), ($2, 'COM Outra', 'com-outra')`, [ORG, OTHER_ORG])
    const director = await person("director", ORG, "Diretora Prova", "MANAGER", null, { email: "com.diretora@proof.inia.local", grant: { role: "COMUNICADOS_DA_EMPRESA", scope: "ORGANIZATION" }, extraGrant: { role: "ADMINISTRADOR_DE_DADOS", scope: "ORGANIZATION" } })
    const supervisor = await person("supervisor", ORG, "Supervisora Prova", "SUPERVISOR", director, { email: "com.supervisora@proof.inia.local", grant: { role: "COMUNICADOS_DA_EQUIPE", scope: "MY_STRUCTURE" } })
    await person("op1", ORG, "Operadora Um", "OPERATOR", supervisor, { email: "com.op1@proof.inia.local" })
    await person("op2", ORG, "Operador Dois", "OPERATOR", supervisor)
    await person("inactive", ORG, "Operador Inativo", "OPERATOR", supervisor, { active: false })
    const peer = await person("peer", ORG, "Supervisor Sem Papel", "SUPERVISOR", director, { email: "com.par@proof.inia.local" })
    await person("op3", ORG, "Operadora Três", "OPERATOR", peer, { email: "com.op3@proof.inia.local" })
    await person("foreign", OTHER_ORG, "Outra Org", "OPERATOR", null, { email: "com.outra@proof.inia.local" })
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
  const titles = (items: { title: string }[]) => items.map((item) => item.title)

  it("publica, persiste, chega a quem deve e respeita o recorte do calendário", async () => {
    const supervisora = await login("com.supervisora@proof.inia.local")
    const me = await supervisora.get("/api/v1/auth/me")
    expect(me.body.data.access.capabilities).toMatchObject({ canPublishTeamCommunications: true, canPublishOrganizationCommunications: false })

    const published = await supervisora.post("/api/v1/communications").send({ title: "Novo roteiro de retenção", contentHtml: `<p onclick="x">Usem o <strong>roteiro novo</strong> a partir de hoje.</p><script>alert(1)</script>`, audience: "TEAM", tags: ["Processos", "Aviso"] })
    expect(published.status).toBe(201)
    expect(published.body.data.recipientCount).toBe(2)
    const teamId: string = published.body.data.id

    const stored = (await db.query(`select content_html, plain_text, author_person_id::text author, recipient_count from communications where id = $1`, [teamId])).rows[0]
    expect(stored).toEqual({ content_html: "<p>Usem o <strong>roteiro novo</strong> a partir de hoje.</p>", plain_text: "Usem o roteiro novo a partir de hoje.", author: ids.supervisor, recipient_count: 2 })
    const recipients = (await db.query<{ id: string }>(`select person_id::text id from communication_recipients where communication_id = $1 order by 1`, [teamId])).rows.map((row) => row.id)
    expect(recipients.sort()).toEqual([ids.op1, ids.op2].sort())
    const audit = (await db.query(`select actor_id::text actor, payload from audit_logs where organization_id = $1 and action = 'COMMUNICATION_PUBLISHED' and entity_id = $2`, [ORG, teamId])).rows
    expect(audit).toHaveLength(1)
    expect(audit[0].actor).toBe(ids.supervisor)
    expect(JSON.stringify(audit[0].payload)).not.toContain("roteiro")

    // Empresa: a supervisora (só equipe) não pode; o supervisor sem papel não publica nada (nível não dá direito).
    expect((await supervisora.post("/api/v1/communications").send({ title: "Para todos", contentHtml: "<p>x</p>", audience: "ORGANIZATION", tags: ["Aviso"] })).status).toBe(403)
    const par = await login("com.par@proof.inia.local")
    expect((await par.post("/api/v1/communications").send({ title: "Sem papel", contentHtml: "<p>x</p>", audience: "TEAM", tags: ["Aviso"] })).status).toBe(403)

    const diretora = await login("com.diretora@proof.inia.local")
    const company = await diretora.post("/api/v1/communications").send({ title: "Campanha de novembro", contentHtml: "<p>Vale para todos.</p>", audience: "ORGANIZATION", tags: ["Campanha"] })
    expect(company.status).toBe(201)
    expect(company.body.data.recipientCount).toBe(5)

    // Recarregar (sessão nova): o comunicado continua no Acompanhamento de quem publicou — com o público — e o da empresa chega a ela.
    const reloaded = await login("com.supervisora@proof.inia.local")
    const feed = await reloaded.get("/api/v1/analytics/follow-ups")
    expect(feed.status).toBe(200)
    const notices = feed.body.data.items.filter((item: { kind: string }) => item.kind === "NOTICE")
    expect(titles(notices)).toEqual(["Campanha de novembro", "Novo roteiro de retenção"])
    expect(notices[1]).toMatchObject({ category: "NOTICE", summary: "Usem o roteiro novo a partir de hoje.", notice: { authoredByViewer: true, recipientCount: 2, audience: "TEAM", tags: ["Processos", "Aviso"], author: { personId: ids.supervisor, name: "Supervisora Prova" } } })
    expect(notices[0].notice).toMatchObject({ authoredByViewer: false, recipientCount: null, audience: "ORGANIZATION", author: { name: "Diretora Prova" } })
    // Só aguardando ciência: comunicado é só leitura, não entra.
    expect((await reloaded.get("/api/v1/analytics/follow-ups?ack=pending")).body.data.items.filter((item: { kind: string }) => item.kind === "NOTICE")).toHaveLength(0)

    // Colaboradores: cada um vê o que recebeu.
    const op1 = await login("com.op1@proof.inia.local")
    const received = await op1.get("/api/v1/communications/received")
    expect(titles(received.body.data.items)).toEqual(["Campanha de novembro", "Novo roteiro de retenção"])
    // Lista LEVE (U4-02): trecho do texto, sem o conteúdo; o conteúdo vem pelo id, com a visibilidade conferida de novo.
    expect(received.body.data.items[1]).toMatchObject({ excerpt: "Usem o roteiro novo a partir de hoje.", hasImages: false, recipientCount: null, authoredByViewer: false, author: { name: "Supervisora Prova" } })
    expect(received.body.data.items[1]).not.toHaveProperty("contentHtml")
    expect((await op1.get(`/api/v1/communications/${teamId}`)).body.data).toMatchObject({ contentHtml: "<p>Usem o <strong>roteiro novo</strong> a partir de hoje.</p>", authoredByViewer: false })
    expect((await (await login("com.op3@proof.inia.local")).get(`/api/v1/communications/${teamId}`)).status).toBe(404)
    expect(titles((await (await login("com.op3@proof.inia.local")).get("/api/v1/communications/received")).body.data.items)).toEqual(["Campanha de novembro"])
    expect((await (await login("com.outra@proof.inia.local")).get("/api/v1/communications/received")).body.data.items).toEqual([])
    // Operador não lê o feed da estrutura de ninguém para "descobrir" comunicados alheios: o da equipe de outro líder nunca aparece.
    expect(titles((await (await login("com.op3@proof.inia.local")).get("/api/v1/communications/received")).body.data.items)).not.toContain("Novo roteiro de retenção")

    // Recorte do calendário e keyset: o comunicado da equipe "aconteceu" em 01/10; o da empresa fica de hoje.
    await db.query(`update communications set published_at = '2026-10-01T13:00:00Z' where id = $1`, [teamId])
    const october = await reloaded.get("/api/v1/analytics/follow-ups?since=2026-10-01T03:00:00.000Z&until=2026-10-02T03:00:00.000Z")
    expect(titles(october.body.data.items)).toEqual(["Novo roteiro de retenção"])
    const first = await reloaded.get("/api/v1/analytics/follow-ups?limit=1")
    expect(titles(first.body.data.items)).toEqual(["Campanha de novembro"])
    expect(first.body.data.nextCursor).toBeTruthy()
    const second = await reloaded.get(`/api/v1/analytics/follow-ups?limit=1&cursor=${encodeURIComponent(first.body.data.nextCursor)}`)
    expect(titles(second.body.data.items)).toEqual(["Novo roteiro de retenção"])
    expect(second.body.data.nextCursor).toBeNull()

    // Editar: só o autor; a versão anterior fica guardada; o público não muda; quem recebeu vê a nova com "editado".
    const companyId: string = company.body.data.id
    expect((await diretora.patch(`/api/v1/communications/${teamId}`).send({ title: "Tomado", contentHtml: "<p>x</p>", tags: ["Aviso"] })).status).toBe(404)
    const edited = await reloaded.patch(`/api/v1/communications/${teamId}`).send({ title: "Roteiro de retenção (corrigido)", contentHtml: "<p>Usem o roteiro <em>v2</em>.</p><script>x</script>", tags: ["Processos"] })
    expect(edited.status).toBe(200)
    expect(edited.body.data).toMatchObject({ title: "Roteiro de retenção (corrigido)", contentHtml: "<p>Usem o roteiro <em>v2</em>.</p>", audience: "TEAM", recipientCount: 2, editedAt: expect.any(String) })
    const revisions = (await db.query(`select title, content_html, replaced_by::text by from communication_revisions where communication_id = $1`, [teamId])).rows
    expect(revisions).toEqual([{ title: "Novo roteiro de retenção", content_html: "<p>Usem o <strong>roteiro novo</strong> a partir de hoje.</p>", by: ids.supervisor }])
    const seenByOp = (await op1.get("/api/v1/communications/received")).body.data.items.find((item: { id: string }) => item.id === teamId)
    expect(seenByOp).toMatchObject({ title: "Roteiro de retenção (corrigido)", editedAt: expect.any(String) })

    // Retirar: só o autor; exclusão LÓGICA com quem retirou; some de todos os lados; auditoria das duas ações.
    expect((await diretora.delete(`/api/v1/communications/${teamId}`)).status).toBe(404)
    expect((await reloaded.delete(`/api/v1/communications/${teamId}`)).status).toBe(204)
    const retired = (await db.query(`select deleted_at is not null retired, deleted_by_person_id::text by, title from communications where id = $1`, [teamId])).rows[0]
    expect(retired).toEqual({ retired: true, by: ids.supervisor, title: "Roteiro de retenção (corrigido)" })
    expect(titles((await op1.get("/api/v1/communications/received")).body.data.items)).toEqual(["Campanha de novembro"])
    expect(titles((await reloaded.get("/api/v1/analytics/follow-ups")).body.data.items.filter((item: { kind: string }) => item.kind === "NOTICE"))).toEqual(["Campanha de novembro"])
    expect((await reloaded.patch(`/api/v1/communications/${teamId}`).send({ title: "Volta", contentHtml: "<p>x</p>", tags: ["Aviso"] })).status).toBe(404)
    const actions = (await db.query<{ action: string }>(`select action from audit_logs where organization_id = $1 and entity_id = $2 order by created_at`, [ORG, teamId])).rows.map((row) => row.action)
    expect(actions).toEqual(["COMMUNICATION_PUBLISHED", "COMMUNICATION_EDITED", "COMMUNICATION_RETIRED"])

    // Rastreio: aparece em Consultar dados › Itens excluídos (quem publica para a organização + Consultar dados), com quem retirou, e volta.
    const deletedList = await diretora.get("/api/v1/admin/data-explorer/deleted-items?type=COMMUNICATION")
    expect(deletedList.status).toBe(200)
    expect(deletedList.body.data.items).toEqual([expect.objectContaining({ type: "COMMUNICATION", typeLabel: "Comunicado", id: teamId, name: "Roteiro de retenção (corrigido)" })])
    expect(deletedList.body.data.items[0].deletedBy).toBeTruthy()
    // Quem só publica para a equipe não vê a lista de excluídos da organização.
    expect((await reloaded.get("/api/v1/admin/data-explorer/deleted-items?type=COMMUNICATION")).status).toBe(403)
    expect((await diretora.post(`/api/v1/admin/data-explorer/deleted-items/COMMUNICATION/${teamId}/restoration`).send({})).status).toBe(200)
    expect(titles((await op1.get("/api/v1/communications/received")).body.data.items)).toContain("Roteiro de retenção (corrigido)")
    expect((await db.query(`select deleted_at, deleted_by_person_id from communications where id = $1`, [teamId])).rows[0]).toEqual({ deleted_at: null, deleted_by_person_id: null })
    expect(companyId).toBeTruthy()
  }, 60_000)
})
