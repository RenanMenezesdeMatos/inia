/**
 * PROVA contra o banco de TESTE real — alinhamento no Acompanhamento do operador (migration 227, `MY_OPERATIONAL_ALIGNMENTS_V1`):
 * cadastro e publicação pela API real; `GET /operational-alignments/mine` só do público da pessoa da sessão (outro Grupo não vê),
 * um item por alinhamento (em vigor, a começar, encerrado como histórico), "Li o alinhamento" idempotente por versão (nova versão
 * pede leitura de novo; encerrado, fora do público ou excluído = 404) e o aviso no sino quando a versão COMEÇA a valer (só
 * operadores do público, uma vez, com o destino no item do Acompanhamento). ZERO chamada de modelo. Tudo numa transação desfeita.
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run my-alignments-proof
 */
import { randomUUID } from "node:crypto"
import pg from "pg"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import { createApp } from "../../../main/app.js"
import { hashPassword } from "../../auth/infrastructure/password-hasher.js"
import { buildNotificationSummary } from "../../notifications/application/build-notification-summary.js"
import { PgNotificationsRepository } from "../../notifications/application/notifications-repository.js"
import { PgPendingActionsRepository } from "../../pending-actions/application/pending-actions-repository.js"
import { runAlignmentLifecycle } from "../application/alignment-audit.js"
import { resolveOrganizationTimezone } from "../../workflows/application/organization-timezone.js"
import { executeAlignmentsInForce } from "../application/alignments-in-force-tool.js"
import { listStructureAlignments } from "../application/structure-alignments.js"
import { renderStructureAlignments } from "../../leadership-analytics/application/leadership-toolset.js"
import { PgAnalyticsReadRepository } from "../../performance-analytics/application/analytics-read-repository.js"
import { decodeFollowUpCursor } from "../../feedbacks/domain/follow-up-cursor.js"
import { listMyAlignments, markMyAlignmentRead, notifyAlignmentVersionsStarted } from "../application/my-alignments.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "00000000-0000-4000-8000-000000000001"
let pool: pg.Pool
let client: pg.PoolClient

const DAY = 24 * 60 * 60 * 1000

describe.skipIf(!ENABLED)("Alinhamento no Acompanhamento do operador — prova Postgres (público, estados, leitura, sino)", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL })
    client = await pool.connect()
    await client.query("begin")
  })
  afterAll(async () => {
    if (client) {
      await client.query("rollback")
      client.release()
    }
    if (pool) await pool.end()
  })

  it("Ouvidoria: em vigor, a começar, nova versão, encerrado, excluído e o sino", async () => {
    await client.query("update prohibited_topics set active = false where organization_id = $1", [ORG])
    const timeZone = await resolveOrganizationTimezone(client, ORG)
    const civil = (offsetDays: number) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + offsetDays * DAY))
    const operation = (await client.query<{ id: string }>("select id from operations where organization_id = $1 order by created_at limit 1", [ORG])).rows[0]!.id
    const team = async (name: string) => (await client.query<{ id: string }>("insert into teams (organization_id, operation_id, name, operating_universe) values ($1, $2, $3, 'B2C') returning id", [ORG, operation, name])).rows[0]!.id
    const ouvidoria = await team("Proof MA Ouvidoria")
    const outro = await team("Proof MA Outro")
    const doc = (await client.query<{ id: string }>("insert into knowledge_documents (organization_id, title, document_type, operating_universe) values ($1, 'Proof MA — PR Envio de fatura', 'PROCEDURE', 'B2C') returning id", [ORG])).rows[0]!.id
    await client.query("insert into knowledge_versions (organization_id, document_id, version, content, status, content_hash) values ($1, $2, 1, 'Conteúdo', 'PUBLISHED', md5($3))", [ORG, doc, doc])
    const hash = await hashPassword("Proof@12345")
    let n = 0
    const person = async (teamId: string | null, role: string, roleCode?: string) => {
      n += 1
      const id = (await client.query<{ id: string }>("insert into people (organization_id, name, role, team_id, operating_universe) values ($1, $2, $3, $4, 'B2C') returning id", [ORG, `Proof MA ${n}`, role, teamId])).rows[0]!.id
      const email = `proof-ma-${n}-${Date.now()}@proof.inia.local`
      const accountId = (await client.query<{ id: string }>("insert into user_accounts (organization_id, person_id, email, password_hash) values ($1, $2, $3, $4) returning id", [ORG, id, email, hash])).rows[0]!.id
      if (roleCode) await client.query("insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, granted_at) values ($1, $2, $3, 'ORGANIZATION', now())", [ORG, accountId, roleCode])
      return { id, email }
    }
    const admin = await person(null, "ADMIN", "ADMINISTRADOR_GERAL")
    const ana = await person(ouvidoria, "OPERATOR")
    const bia = await person(ouvidoria, "OPERATOR")
    const supervisora = await person(ouvidoria, "SUPERVISOR")
    const caio = await person(outro, "OPERATOR")
    const app = createApp(client as never)
    const login = async (email: string) => {
      const http = request.agent(app)
      expect((await http.post("/api/v1/auth/login").send({ email, password: "Proof@12345" })).status).toBe(200)
      return http
    }
    const gestor = await login(admin.email)
    const base = "/api/v1/admin/operational-alignments"
    const reasonId = (await client.query<{ id: string }>("select id from operational_alignment_reasons where organization_id = $1 and name = 'Contingência'", [ORG])).rows[0]!.id
    const body = { reasonId, title: "Fatura pelo App Meu Vivo", guidance: "Oriente o cliente a acessar a fatura pelo App Meu Vivo. Não envie a fatura.", affectedDocumentIds: [doc], affectedTopic: "Envio da fatura", justification: "Envio suspenso durante a troca do sistema de faturas.", operatingUniverse: "B2C", scopeType: "TEAM", teamId: ouvidoria, startsOn: civil(-2), endsOn: civil(10) }
    const publish = async (payload: typeof body, relations: { alignmentId: string; relation: string }[] = []) => {
      const id = (await gestor.post(base).send(payload)).body.data.id as string
      const published = await gestor.post(`${base}/${id}/publish`).send({ relations })
      expect(published.status).toBe(200)
      return id
    }
    const emVigor = await publish(body)
    const aComecar = await publish({ ...body, title: "Prazo de retorno da Ouvidoria", guidance: "Informe que a Ouvidoria retorna em até 48 horas.", affectedTopic: null as never, startsOn: civil(3), endsOn: civil(20) }, [{ alignmentId: emVigor, relation: "INDEPENDENT" }])

    // Só o público, pela sessão: a operadora da Ouvidoria vê os dois; o operador de outro Grupo, nenhum.
    const anaHttp = await login(ana.email)
    const mineResponse = await anaHttp.get("/api/v1/operational-alignments/mine")
    expect(mineResponse.body).toMatchObject({ data: expect.anything() })
    const mine = mineResponse.body.data.items as { alignmentId: string; versionId: string; state: string; audienceLabel: string; readAt: string | null; startsOn: string; endsOn: string; definedBy: { name: string } | null }[]
    const ofAna = (id: string) => mine.find((item) => item.alignmentId === id)!
    expect(ofAna(emVigor)).toMatchObject({ state: "IN_FORCE", audienceLabel: "Proof MA Ouvidoria", readAt: null, startsOn: civil(-2), endsOn: civil(10), definedBy: { name: "Proof MA 1" } })
    expect(ofAna(aComecar)).toMatchObject({ state: "UPCOMING", startsOn: civil(3) })
    expect(((await (await login(caio.email)).get("/api/v1/operational-alignments/mine")).body.data.items as { alignmentId: string }[]).filter((item) => [emVigor, aComecar].includes(item.alignmentId))).toEqual([])

    // No chat, "temos algum alinhamento?" usa a MESMA leitura, de todos os processos: os dois aparecem para ela; o outro Grupo não tem nenhum.
    const inForce = (await executeAlignmentsInForce(client, { organizationId: ORG, personId: ana.id })).text
    expect(inForce).toContain('"Fatura pelo App Meu Vivo" — em vigor')
    expect(inForce).toContain('"Prazo de retorno da Ouvidoria" — começa em')
    expect(inForce).toContain("Definido por: Proof MA 1")
    expect((await executeAlignmentsInForce(client, { organizationId: ORG, personId: caio.id })).text).toContain("Nenhum alinhamento operacional vale hoje nem está programado")

    // "Li o alinhamento": idempotente; outra pessoa fora do público = 404; versão errada = 404.
    const readUrl = (item: { alignmentId: string; versionId: string }) => `/api/v1/operational-alignments/${item.alignmentId}/versions/${item.versionId}/read`
    const first = await anaHttp.post(readUrl(ofAna(emVigor))).send({})
    expect(first.status).toBe(200)
    expect((await anaHttp.post(readUrl(ofAna(emVigor))).send({})).body.data.readAt).toBe(first.body.data.readAt)
    expect((await (await login(caio.email)).post(readUrl(ofAna(emVigor))).send({})).status).toBe(404)
    expect((await anaHttp.post(readUrl({ alignmentId: emVigor, versionId: ofAna(aComecar).versionId })).send({})).status).toBe(404)
    expect((await listMyAlignments(client, { organizationId: ORG, personId: ana.id })).find((item) => item.alignmentId === emVigor)!.readAt).toBe(first.body.data.readAt)

    // FASE 2 — quem lidera: os alinhamentos que alcançam os liderados, com alcance e leituras da versão mostrada (Ana leu a v1).
    const structure = await listStructureAlignments(client, { organizationId: ORG, memberIds: [ana.id, bia.id, caio.id] })
    const inStructure = (id: string) => structure.find((item) => item.alignmentId === id)!
    expect(inStructure(emVigor)).toMatchObject({ state: "IN_FORCE", audienceLabel: "Proof MA Ouvidoria", reach: { people: 2, read: 1 } })
    expect(inStructure(aComecar)).toMatchObject({ state: "UPCOMING", reach: { people: 2, read: 0 } })
    expect((await listStructureAlignments(client, { organizationId: ORG, memberIds: [caio.id] })).filter((item) => [emVigor, aComecar].includes(item.alignmentId))).toEqual([])
    expect(renderStructureAlignments("Equipe de prova", structure)).toContain("Nesta estrutura: alcança 2 pessoas; 1 marcou que leu a versão atual.")
    expect(renderStructureAlignments("Equipe de prova", structure)).toContain("alcança 2 pessoas; 0 marcaram que leram a versão atual.")
    // No feed do líder: ramo ALIGNMENT na própria estrutura, com o filtro "Tipo" e "Da equipe"; fora de "Para mim" e de "aguardando ciência".
    const repository = new PgAnalyticsReadRepository(client as never)
    const feedBase = { organizationId: ORG, viewerId: supervisora.id, operatorIds: [ana.id, bia.id], includeViewerAlerts: true, unacknowledgedOnly: false, limit: 50, before: null }
    const alignmentItems = async (extra: Record<string, unknown> = {}) => (await repository.loadFollowUpFeed({ ...feedBase, ...extra })).items.filter((item) => item.kind === "ALIGNMENT")
    const all = await alignmentItems()
    expect(all.map((item) => item.id).sort()).toEqual([emVigor, aComecar].sort())
    expect(all.find((item) => item.id === emVigor)).toMatchObject({ category: "ALIGNMENT", title: "Fatura pelo App Meu Vivo", alignment: { reach: { people: 2, read: 1 } } })
    expect((await alignmentItems({ types: ["ALIGNMENT"] })).length).toBe(2)
    expect((await repository.loadFollowUpFeed({ ...feedBase, types: ["ALIGNMENT"] })).items.every((item) => item.kind === "ALIGNMENT")).toBe(true)
    expect(await alignmentItems({ types: ["MONITORING"] })).toEqual([])
    expect((await alignmentItems({ audience: "TEAM" })).length).toBe(2)
    expect(await alignmentItems({ audience: "MINE" })).toEqual([])
    expect(await alignmentItems({ unacknowledgedOnly: true })).toEqual([])
    expect(await alignmentItems({ includeViewerAlerts: false })).toEqual([])
    // Cursor: página de 1 em 1 percorre os dois sem repetir.
    const firstPage = await repository.loadFollowUpFeed({ ...feedBase, types: ["ALIGNMENT"], limit: 1 })
    const secondPage = await repository.loadFollowUpFeed({ ...feedBase, types: ["ALIGNMENT"], limit: 1, before: decodeFollowUpCursor(firstPage.nextCursor) })
    expect([...firstPage.items, ...secondPage.items].map((item) => item.id).sort()).toEqual([emVigor, aComecar].sort())

    // Nova versão: enquanto não começa, o item continua na v1 (lida); quando começa, mostra a v2 com o motivo e pede leitura de novo.
    expect((await gestor.put(`${base}/${emVigor}/draft`).send({ ...body, startsOn: civil(1), guidance: "Oriente o App Meu Vivo ou o site.", changeReason: "Inclusão do site" })).status).toBe(200)
    expect((await gestor.post(`${base}/${emVigor}/publish`).send({ relations: [{ alignmentId: aComecar, relation: "INDEPENDENT" }] })).status).toBe(200)
    const atV1 = (await listMyAlignments(client, { organizationId: ORG, personId: ana.id })).find((item) => item.alignmentId === emVigor)!
    expect(atV1).toMatchObject({ version: 1, state: "IN_FORCE" })
    expect(atV1.readAt).not.toBeNull()
    const v2At = new Date(Date.now() + 2 * DAY)
    const atV2 = (await listMyAlignments(client, { organizationId: ORG, personId: ana.id, now: v2At })).find((item) => item.alignmentId === emVigor)!
    expect(atV2).toMatchObject({ version: 2, state: "IN_FORCE", changeReason: "Inclusão do site", readAt: null, guidance: "Oriente o App Meu Vivo ou o site." })
    expect((await markMyAlignmentRead(client, { organizationId: ORG, personId: ana.id, alignmentId: emVigor, versionId: atV2.versionId, now: v2At })).readAt).toBeTruthy()

    // Depois do fim: histórico "não vale mais desde" (dia seguinte ao último) e sem leitura.
    const after = new Date(Date.now() + 30 * DAY)
    const ended = (await listMyAlignments(client, { organizationId: ORG, personId: ana.id, now: after })).find((item) => item.alignmentId === emVigor)!
    expect(ended).toMatchObject({ version: 2, state: "ENDED", noLongerValidSince: civil(11), endedEarly: false })
    await expect(markMyAlignmentRead(client, { organizationId: ORG, personId: ana.id, alignmentId: emVigor, versionId: ended.versionId, now: after })).rejects.toMatchObject({ code: "OPERATIONAL_ALIGNMENT_NOT_FOUND" })

    // Sino ao COMEÇAR a valer: só operadores do público (a supervisora e o outro Grupo, não), uma vez por versão.
    const startedAt = new Date(new Date(ofAna(aComecar).startsOn + "T12:00:00Z").getTime())
    await runAlignmentLifecycle(client, startedAt, (versionIds, now) => notifyAlignmentVersionsStarted(client, versionIds, now))
    const alerts = async () => (await client.query<{ recipient_id: string; title: string; description: string; dedupe_key: string }>("select recipient_id, title, description, dedupe_key from alerts where alert_type = 'OPERATIONAL_ALIGNMENT_STARTED' and dedupe_key like $1", [`operational_alignment_started:${aComecar}:%`])).rows
    const sent = await alerts()
    expect(sent.map((alert) => alert.recipient_id).sort()).toEqual([ana.id, bia.id].sort())
    expect(sent[0]).toMatchObject({ title: "Novo alinhamento em vigor", description: "Prazo de retorno da Ouvidoria" })
    expect(sent.map((alert) => alert.recipient_id)).not.toContain(supervisora.id)
    expect(await notifyAlignmentVersionsStarted(client, [ofAna(aComecar).versionId], startedAt)).toBe(0)
    // Versão que começou há mais de 2 dias (job parado, implantação) não avisa.
    expect(await notifyAlignmentVersionsStarted(client, [ofAna(aComecar).versionId], new Date(startedAt.getTime() + 3 * DAY))).toBe(0)
    // No sino, o destino é o item do alinhamento no Acompanhamento.
    const summary = await buildNotificationSummary(new PgNotificationsRepository(client as never), new PgPendingActionsRepository(client as never), { personId: ana.id, organizationId: ORG })
    expect(summary.items.find((item) => item.kind === "OPERATIONAL_ALIGNMENT")).toMatchObject({ title: "Novo alinhamento em vigor", target: { type: "FOLLOW_UP", itemId: `alignment:${aComecar}` } })

    // Excluído (lógico) some do Acompanhamento.
    expect((await gestor.delete(`${base}/${aComecar}`).send({ reason: "Prova: retirado do ar." })).status).toBe(200)
    expect((await listMyAlignments(client, { organizationId: ORG, personId: ana.id })).map((item) => item.alignmentId)).not.toContain(aComecar)
    // AL-09: o aviso do alinhamento excluído sai do sino (lista e contagem); a linha em `alerts` continua (volta se for restaurado).
    const bell = new PgNotificationsRepository(client as never)
    expect(summary.unreadCount).toBeGreaterThan(0)
    const afterDelete = await buildNotificationSummary(bell, new PgPendingActionsRepository(client as never), { personId: ana.id, organizationId: ORG })
    expect(afterDelete.items.find((item) => item.kind === "OPERATIONAL_ALIGNMENT" && item.target.type === "FOLLOW_UP" && item.target.itemId === `alignment:${aComecar}`)).toBeUndefined()
    expect(afterDelete.unreadCount).toBe(summary.unreadCount - 1)
    expect(await alerts()).toHaveLength(2)

    // AL-02: 1001 versões MAIS RECENTES de outro Grupo não escondem o alinhamento da Ouvidoria — o público é aplicado antes do teto de linhas.
    const outroId = await publish({ ...body, title: "Proof MA outro Grupo", teamId: outro })
    const copies = Array.from({ length: 1001 }, () => ({ alignment: randomUUID(), version: randomUUID() }))
    await client.query("insert into operational_alignments select (jsonb_populate_record(null::operational_alignments, to_jsonb(a) || jsonb_build_object('id', c.id))).* from operational_alignments a, unnest($2::uuid[]) c(id) where a.id = $1", [outroId, copies.map((copy) => copy.alignment)])
    await client.query(
      `insert into operational_alignment_versions
       select (jsonb_populate_record(null::operational_alignment_versions, to_jsonb(v) || jsonb_build_object('id', c.version, 'alignment_id', c.alignment, 'published_at', now() + interval '1 minute'))).*
       from operational_alignment_versions v, unnest($2::uuid[], $3::uuid[]) c(alignment, version) where v.alignment_id = $1`,
      [outroId, copies.map((copy) => copy.alignment), copies.map((copy) => copy.version)],
    )
    await client.query("insert into operational_alignment_version_scopes (version_id, organization_id, team_id, subteam_id) select c.version, $1, $2, null from unnest($3::uuid[]) c(version)", [ORG, outro, copies.map((copy) => copy.version)])
    expect((await listMyAlignments(client, { organizationId: ORG, personId: ana.id })).map((item) => item.alignmentId)).toContain(emVigor)
    expect((await executeAlignmentsInForce(client, { organizationId: ORG, personId: ana.id })).text).not.toContain("Nenhum alinhamento operacional vale hoje")
  })
})
