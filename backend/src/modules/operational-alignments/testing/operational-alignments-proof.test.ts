/**
 * PROVA contra o banco de TESTE real — Alinhamentos operacionais (migration 209): cadastro pela API real (sessão, `configuration.manage`
 * com escopo, universo), validação, rascunho → publicação → nova versão que substitui a anterior a partir do início dela → encerramento,
 * conflito entre alinhamentos tratado NA PUBLICAÇÃO, assunto proibido recusado, vigência em datas civis no fuso da organização e a regra
 * única lida do banco (`resolveOperationalAlignmentsFor`) pela data de referência. ZERO chamada de modelo (a conferência de assunto
 * proibido é desligada na transação para a API e injetada no teste do serviço). Tudo numa transação desfeita no fim.
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run operational-alignments-proof
 */
import pg from "pg"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import { createApp } from "../../../main/app.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { hashPassword } from "../../auth/infrastructure/password-hasher.js"
import { affectedAssessments, publishAlignment } from "../application/operational-alignment-service.js"
import { resolveOperationalAlignmentsFor } from "../infrastructure/operational-alignment-loaders.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "00000000-0000-4000-8000-000000000001"
let pool: pg.Pool
let client: pg.PoolClient

/** Os serviços abrem a própria transação: aqui ela vira savepoint dentro da transação da prova (nunca um commit de fora). */
function savepointDb(connection: pg.PoolClient): Database {
  const proxy = { query: (sql: string, params?: unknown[]) => (sql === "begin" ? connection.query("savepoint service_tx") : sql === "commit" ? connection.query("release savepoint service_tx") : sql === "rollback" ? connection.query("rollback to savepoint service_tx") : connection.query(sql, params)), release: () => undefined }
  return { query: (sql: string, params?: unknown[]) => connection.query(sql, params), connect: async () => proxy } as unknown as Database
}

describe.skipIf(!ENABLED)("Alinhamentos operacionais — prova Postgres (cadastro, escopo, versões, conflito, vigência, regra única)", () => {
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

  it("cenário da Ouvidoria de ponta a ponta", async () => {
    // Sem assunto proibido ativo na transação: a API publica sem chamar modelo (a recusa é provada abaixo com a conferência injetada).
    await client.query("update prohibited_topics set active = false where organization_id = $1", [ORG])
    const operation = (await client.query<{ id: string }>("select id from operations where organization_id = $1 order by created_at limit 1", [ORG])).rows[0]!.id
    const team = async (name: string, universe: string) => (await client.query<{ id: string }>("insert into teams (organization_id, operation_id, name, operating_universe) values ($1, $2, $3, $4) returning id", [ORG, operation, name, universe])).rows[0]!.id
    const ouvidoria = await team("Proof AO Ouvidoria", "B2C")
    const outro = await team("Proof AO Outro", "B2C")
    const empresas = await team("Proof AO Empresas", "B2B")
    const nivel2 = (await client.query<{ id: string }>("insert into subteams (organization_id, team_id, name) values ($1, $2, 'Proof AO Ouvidoria N2') returning id", [ORG, ouvidoria])).rows[0]!.id
    const kb = async (title: string, type: string, universe: string | null) => {
      const id = (await client.query<{ id: string }>("insert into knowledge_documents (organization_id, title, document_type, operating_universe) values ($1, $2, $3, $4) returning id", [ORG, title, type, universe])).rows[0]!.id
      await client.query("insert into knowledge_versions (organization_id, document_id, version, content, status, content_hash) values ($1, $2, 1, 'Conteúdo', 'PUBLISHED', md5($3))", [ORG, id, id])
      return id
    }
    const doc = await kb("Proof AO — PR Envio de fatura", "PROCEDURE", "B2C")
    const itFatura = await kb("Proof AO — IT Segunda via", "WORK_INSTRUCTION", "B2C")
    const docEmpresas = await kb("Proof AO — PR Empresas", "PROCEDURE", "B2B")
    const hash = await hashPassword("Proof@12345")
    let n = 0
    const person = async (teamId: string | null, subteamId: string | null, roleCode?: string, scope?: { type: string; teamId?: string }) => {
      n += 1
      const id = (await client.query<{ id: string }>("insert into people (organization_id, name, role, team_id, subteam_id) values ($1, $2, 'OPERATOR', $3, $4) returning id", [ORG, `Proof AO ${n}`, teamId, subteamId])).rows[0]!.id
      const email = `proof-ao-${n}-${Date.now()}@proof.inia.local`
      const accountId = (await client.query<{ id: string }>("insert into user_accounts (organization_id, person_id, email, password_hash) values ($1, $2, $3, $4) returning id", [ORG, id, email, hash])).rows[0]!.id
      if (roleCode && scope) await client.query("insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, team_id, granted_at) values ($1, $2, $3, $4, $5, now())", [ORG, accountId, roleCode, scope.type, scope.teamId ?? null])
      return { id, email, accountId }
    }
    const geral = await person(null, null, "ADMINISTRADOR_GERAL", { type: "ORGANIZATION" })
    // O gerente da Ouvidoria tem SÓ o papel Gestor de alinhamentos no Grupo dele (nada de Administrador).
    const gerenteOuvidoria = await person(ouvidoria, null, "GESTOR_DE_ALINHAMENTOS", { type: "GROUP", teamId: ouvidoria })
    const semPapel = await person(ouvidoria, null)
    const operadorOuvidoria = await person(ouvidoria, null)
    const operadorN2 = await person(ouvidoria, nivel2)
    const operadorOutro = await person(outro, null)
    const operadorEmpresas = await person(empresas, null)
    const app = createApp(client as never)
    const login = async (email: string) => {
      const http = request.agent(app)
      expect((await http.post("/api/v1/auth/login").send({ email, password: "Proof@12345" })).status).toBe(200)
      return http
    }
    const org = await login(geral.email)
    const gerente = await login(gerenteOuvidoria.email)
    const none = await login(semPapel.email)
    const base = "/api/v1/admin/operational-alignments"
    // Motivos (213): o do alinhamento vem da lista inicial; o do pedido do cliente é um assunto canônico da organização.
    const contingency = (await client.query<{ id: string }>("select id from operational_alignment_reasons where organization_id = $1 and name = 'Contingência'", [ORG])).rows[0]!.id
    const invoiceSubject = (await client.query<{ id: string }>("insert into interaction_subject_definitions (organization_id, code, name) values ($1, $2, 'Proof AO Fatura') returning id", [ORG, `proof_ao_fatura_${Date.now()}`])).rows[0]!.id
    const body = { reasonId: contingency, requestSubjectIds: [invoiceSubject], title: "Fatura pelo App Meu Telnova ou site", guidance: "Oriente o cliente a acessar a fatura pelo App Meu Telnova ou pelo site. Não envie a fatura.", affectedDocumentIds: [doc], affectedTopic: "Envio da fatura quando o cliente solicita", justification: "Envio de fatura suspenso na Ouvidoria enquanto o sistema de envio é substituído.", operatingUniverse: "B2C", scopeType: "TEAM", teamId: ouvidoria, startsOn: "2026-11-10", endsOn: "2026-11-30" }

    // Permissão e escopo no backend.
    expect((await none.get(base)).status).toBe(403)
    expect((await gerente.get(`${base}/scope-options`)).body.data.teams.map((team: { id: string }) => team.id)).toEqual([ouvidoria])
    expect((await gerente.post(base).send({ ...body, scopeType: "UNIVERSE", teamId: null })).body.error.code).toBe("OPERATIONAL_ALIGNMENT_SCOPE_FORBIDDEN")
    expect((await gerente.post(base).send({ ...body, teamId: outro })).status).toBe(403)
    // Validação: justificativa obrigatória, intervalo coerente; universo do público e do procedimento.
    expect((await gerente.post(base).send({ ...body, justification: "" })).status).toBe(400)
    expect((await gerente.post(base).send({ ...body, endsOn: "2026-11-01" })).status).toBe(400)
    expect((await gerente.post(base).send({ ...body, operatingUniverse: "B2B" })).body.error.code).toBe("OPERATIONAL_ALIGNMENT_UNIVERSE_CONFLICT")
    expect((await gerente.post(base).send({ ...body, reasonId: undefined })).status).toBe(400)
    expect((await gerente.post(base).send({ ...body, affectedDocumentIds: [] })).status).toBe(400)
    expect((await gerente.post(base).send({ ...body, affectedDocumentIds: [doc, docEmpresas] })).body.error.code).toBe("OPERATIONAL_ALIGNMENT_UNIVERSE_CONFLICT")
    // O papel não abre o resto da Administração (bases, agentes).
    expect((await gerente.get("/api/v1/admin/knowledge")).status).toBe(403)
    // Processos: busca no servidor, paginada, filtrável por tipo e universo (só bases publicadas).
    const options = await gerente.get(`${base}/process-options?search=Proof AO&operatingUniverse=B2C&page=1&pageSize=10`)
    expect(options.body.data.items.map((item: { title: string }) => item.title)).toEqual(["Proof AO — IT Segunda via", "Proof AO — PR Envio de fatura"])
    expect((await gerente.get(`${base}/process-options?search=Proof AO&documentType=WORK_INSTRUCTION&page=1&pageSize=10`)).body.data.items.map((item: { id: string }) => item.id)).toEqual([itFatura])
    expect((await gerente.get(`${base}/process-options?ids=${doc},${itFatura}`)).body.data).toHaveLength(2)

    const created = await gerente.post(base).send(body)
    expect(created.status).toBe(201)
    const id = created.body.data.id as string
    expect(created.body.data).toMatchObject({ state: "DRAFT", draft: { version: 1, status: "DRAFT", justification: body.justification, createdBy: "Proof AO 2" } })
    // Rascunho não vale para ninguém.
    const resolve = (personId: string, at: string) => resolveOperationalAlignmentsFor(client, { organizationId: ORG, personId, at: new Date(at), documentIds: [doc] })
    expect((await resolve(operadorOuvidoria.id, "2026-11-15T15:00:00Z")).applied).toEqual([])

    const published = await gerente.post(`${base}/${id}/publish`).send({})
    expect(published.status).toBe(200)
    expect(published.body.data.current).toMatchObject({ version: 1, status: "PUBLISHED", publishedBy: "Proof AO 2", timeZone: "America/Fortaleza" })
    // Vigência: datas civis no fuso da organização (Fortaleza, UTC-3) — 10/11 00:00 até o fim de 30/11.
    expect(published.body.data.current).toMatchObject({ effectiveFrom: "2026-11-10T03:00:00.000Z", effectiveUntil: "2026-12-01T03:00:00.000Z" })

    // A regra única, lida do banco, pela data de referência e pelo público.
    const applied = async (personId: string, at: string) => (await resolve(personId, at)).applied.map((entry) => `${entry.title}@v${entry.version}`).filter((entry) => !entry.startsWith("Prazo de retorno"))
    expect(await applied(operadorOuvidoria.id, "2026-11-15T15:00:00Z")).toEqual(["Fatura pelo App Meu Telnova ou site@v1"])
    expect(await applied(operadorOuvidoria.id, "2026-11-10T02:59:59Z")).toEqual([])
    expect(await applied(operadorOuvidoria.id, "2026-12-01T02:59:59Z")).toEqual(["Fatura pelo App Meu Telnova ou site@v1"])
    expect(await applied(operadorOuvidoria.id, "2026-12-01T03:00:00Z")).toEqual([])
    expect(await applied(operadorOutro.id, "2026-11-15T15:00:00Z")).toEqual([])
    expect(await applied(operadorEmpresas.id, "2026-11-15T15:00:00Z")).toEqual([])
    expect((await resolve(operadorOuvidoria.id, "invalid")).status).toBe("REFERENCE_DATE_UNKNOWN")

    // Conflito: outro alinhamento do MESMO público, procedimento e período — a publicação exige dizer a relação; mesmo recorte e mesmo
    // ponto = recusado; pontos diferentes = os dois valem.
    const second = (await org.post(base).send({ ...body, title: "Fatura só por SMS", guidance: "Envie o link da fatura por SMS para o número cadastrado." })).body.data.id as string
    const relationRequired = await org.post(`${base}/${second}/publish`).send({})
    expect(relationRequired.body.error).toMatchObject({ code: "OPERATIONAL_ALIGNMENT_RELATION_REQUIRED" })
    expect(relationRequired.body.error.details.overlaps.map((entry: { alignmentId: string }) => entry.alignmentId)).toEqual([id])
    expect((await org.post(`${base}/${second}/publish`).send({ relations: [{ alignmentId: id, relation: "SAME_TOPIC" }] })).body.error.code).toBe("OPERATIONAL_ALIGNMENT_CONFLICT")
    expect((await org.post(`${base}/${second}/publish`).send({ relations: [{ alignmentId: id, relation: "INDEPENDENT" }] })).status).toBe(200)
    expect((await applied(operadorOuvidoria.id, "2026-11-15T15:00:00Z")).sort()).toEqual(["Fatura pelo App Meu Telnova ou site@v1", "Fatura só por SMS@v1"])
    // Orientação NOVA, sem trecho, para dois processos: vale para os dois; lista paginada com busca pelo processo.
    const novo = (await gerente.post(base).send({ ...body, title: "Prazo de retorno da Ouvidoria", guidance: "Informe que a Ouvidoria retorna em até 48 horas.", affectedTopic: null, affectedDocumentIds: [doc, itFatura] })).body.data
    expect(novo.draft).toMatchObject({ affectedTopic: null })
    expect(novo.draft.processes.map((process: { id: string }) => process.id).sort()).toEqual([doc, itFatura].sort())
    const listed = await gerente.get(`${base}?page=1&pageSize=20&search=Segunda via`)
    expect(listed.body.data.items.map((item: { id: string; processCount: number }) => [item.id, item.processCount])).toEqual([[novo.id, 2]])
    expect((await gerente.post(`${base}/${novo.id}/publish`).send({ relations: [{ alignmentId: id, relation: "INDEPENDENT" }, { alignmentId: second, relation: "INDEPENDENT" }] })).status).toBe(200)
    expect((await resolveOperationalAlignmentsFor(client, { organizationId: ORG, personId: operadorOuvidoria.id, at: new Date("2026-11-15T15:00:00Z"), documentIds: [itFatura] })).applied.map((entry) => entry.title)).toEqual(["Prazo de retorno da Ouvidoria"])

    // Recorte mais específico do MESMO ponto: publicado, prevalece só para o Subgrupo.
    const specific = (await gerente.post(base).send({ ...body, title: "N2: fatura pelo site", guidance: "Oriente só o site da Telnova para a fatura.", scopeType: "SUBTEAM", subteamId: nivel2 })).body.data.id as string
    expect((await gerente.post(`${base}/${specific}/publish`).send({ relations: [{ alignmentId: id, relation: "SAME_TOPIC" }, { alignmentId: second, relation: "INDEPENDENT" }, { alignmentId: novo.id, relation: "INDEPENDENT" }] })).status).toBe(200)
    expect((await applied(operadorN2.id, "2026-11-15T15:00:00Z")).sort()).toEqual(["Fatura só por SMS@v1", "N2: fatura pelo site@v1"])
    expect((await applied(operadorOuvidoria.id, "2026-11-15T15:00:00Z")).sort()).toEqual(["Fatura pelo App Meu Telnova ou site@v1", "Fatura só por SMS@v1"])

    // Alterar o publicado: motivo obrigatório; nova versão nunca começa antes da anterior; publicada, substitui a partir do início dela.
    expect((await gerente.put(`${base}/${id}/draft`).send({ ...body, guidance: "Oriente o App Meu Telnova, o site ou a URA de fatura." })).body.error.code).toBe("OPERATIONAL_ALIGNMENT_CHANGE_REASON_REQUIRED")
    expect((await gerente.put(`${base}/${id}/draft`).send({ ...body, startsOn: "2026-11-05", guidance: "Oriente o App Meu Telnova, o site ou a URA de fatura.", changeReason: "Inclusão da URA" })).status).toBe(200)
    const relationsV2 = [{ alignmentId: second, relation: "INDEPENDENT" }, { alignmentId: specific, relation: "SAME_TOPIC" }, { alignmentId: novo.id, relation: "INDEPENDENT" }]
    expect((await gerente.post(`${base}/${id}/publish`).send({ relations: relationsV2 })).body.error.code).toBe("OPERATIONAL_ALIGNMENT_RETROACTIVE_VERSION")
    expect((await gerente.put(`${base}/${id}/draft`).send({ ...body, startsOn: "2026-11-20", guidance: "Oriente o App Meu Telnova, o site ou a URA de fatura.", changeReason: "Inclusão da URA" })).body.data.draft.version).toBe(2)
    const v2 = await gerente.post(`${base}/${id}/publish`).send({ relations: relationsV2 })
    expect(v2.status).toBe(200)
    expect(v2.body.data.versions.map((version: { version: number; status: string }) => [version.version, version.status])).toEqual([[2, "PUBLISHED"], [1, "SUPERSEDED"]])
    expect(v2.body.data.versions[1].effectiveUntil).toBe("2026-11-20T03:00:00.000Z")
    const forOuvidoria = async (at: string) => (await applied(operadorOuvidoria.id, at)).filter((entry) => !entry.startsWith("Fatura só por SMS"))
    expect(await forOuvidoria("2026-11-15T15:00:00Z")).toEqual(["Fatura pelo App Meu Telnova ou site@v1"]) // avaliação histórica: v1
    expect(await forOuvidoria("2026-11-25T15:00:00Z")).toEqual(["Fatura pelo App Meu Telnova ou site@v2"])

    // Histórico e autoria auditados.
    const audit = (await client.query<{ action: string }>("select action from audit_logs where entity_type = 'operational_alignment' and entity_id = $1 order by created_at, action", [id])).rows.map((row) => row.action)
    expect(audit).toEqual(expect.arrayContaining(["OPERATIONAL_ALIGNMENT_CREATED", "OPERATIONAL_ALIGNMENT_PUBLISHED", "OPERATIONAL_ALIGNMENT_DRAFT_SAVED"]))

    // Encerrar: motivo obrigatório; o que já passou continua coberto (v1 vale em 15/11). A v2 (início em 20/11, depois de hoje na data
    // desta prova) fica cancelada — ou, se a prova rodar depois de 20/11, termina agora.
    expect((await gerente.post(`${base}/${id}/end`).send({})).status).toBe(400)
    const ended = await gerente.post(`${base}/${id}/end`).send({ reason: "Base oficial atualizada" })
    expect(ended.status).toBe(200)
    expect(ended.body.data.versions[0]).toMatchObject({ version: 2, endReason: "Base oficial atualizada" })
    expect(await forOuvidoria("2026-11-15T15:00:00Z")).toEqual(["Fatura pelo App Meu Telnova ou site@v1"])
    expect(await forOuvidoria("2026-11-29T15:00:00Z")).toEqual(Date.now() < Date.parse("2026-11-29T15:00:00Z") ? [] : ["Fatura pelo App Meu Telnova ou site@v2"])

    // Monitorias possivelmente afetadas: a consulta roda (nenhuma avaliação desta transação no período).
    const scopes = { unrestricted: false as const, allTeams: true, teamIds: new Set<string>(), subteamIds: new Set<string>() }
    expect((await affectedAssessments(client, ORG, scopes, id)).items).toEqual([])

    // OPÇÕES DE ESCOPO com o universo de cada Grupo/Subgrupo (os filtros e o formulário encadeiam por elas).
    const scopeOptions = (await gerente.get(`${base}/scope-options`)).body.data
    expect(scopeOptions).toMatchObject({ universe: false, teams: [{ id: ouvidoria, operatingUniverse: "B2C", manageable: true, subteams: [{ id: nivel2, operatingUniverse: "B2C" }] }] })

    // RASTRO DE AUDITORIA (sem tela): cada ação com quem fez; alteração com os campos mudados e os processos incluídos/excluídos.
    const events = async (alignmentId: string) => (await client.query<{ event_type: string; version: number | null; actor_person_id: string | null; details: Record<string, unknown>; occurred_at: Date }>(`select event_type, version, actor_person_id, details, occurred_at from operational_alignment_events where alignment_id = $1 order by occurred_at, event_type`, [alignmentId])).rows
    const ofId = await events(id)
    expect(ofId.map((event) => event.event_type)).toEqual(expect.arrayContaining(["CREATED", "DRAFT_SAVED", "PUBLISHED", "SUPERSEDED"]))
    expect(ofId.filter((event) => event.event_type !== "SUPERSEDED").every((event) => event.actor_person_id === gerenteOuvidoria.id)).toBe(true)
    const v2Saved = ofId.find((event) => event.event_type === "DRAFT_SAVED" && (event.details as { newVersion?: boolean }).newVersion)!
    expect(v2Saved.details).toMatchObject({ basedOnVersion: 1, changedFields: expect.arrayContaining(["guidance", "startsOn", "changeReason"]) })
    expect((await gerente.put(`${base}/${novo.id}/draft`).send({ ...body, title: "Prazo de retorno da Ouvidoria", guidance: "Informe que a Ouvidoria retorna em até 48 horas.", affectedTopic: null, affectedDocumentIds: [doc], changeReason: "IT de segunda via fora" })).status).toBe(200)
    expect((await events(novo.id)).find((event) => event.event_type === "DRAFT_SAVED" && (event.details as { newVersion?: boolean }).newVersion)!.details).toMatchObject({ processesAdded: [], processesRemoved: [itFatura] })

    // INÍCIO E EXPIRAÇÃO pelo relógio, gravados uma vez por versão, no instante da vigência.
    const { runAlignmentLifecycle } = await import("../application/alignment-audit.js")
    await runAlignmentLifecycle(client, new Date("2026-12-02T00:00:00Z"))
    await runAlignmentLifecycle(client, new Date("2026-12-02T00:00:00Z"))
    const secondEvents = await events(second)
    expect(secondEvents.filter((event) => event.event_type === "STARTED").map((event) => event.occurred_at.toISOString())).toEqual(["2026-11-10T03:00:00.000Z"])
    expect(secondEvents.filter((event) => event.event_type === "EXPIRED").map((event) => [event.occurred_at.toISOString(), (event.details as { reason: string }).reason])).toEqual([["2026-12-01T03:00:00.000Z", "END_DATE"]])

    // QUAL VERSÃO A IA LEU: cada resolução com uso registra a versão aplicada, a superfície e a data de referência.
    await resolveOperationalAlignmentsFor(client, { organizationId: ORG, personId: operadorOuvidoria.id, at: new Date("2026-11-15T15:00:00Z"), documentIds: [doc], usage: { surface: "MONITORING", interactionId: null, agentId: null } })
    const usages = (await client.query<{ version_id: string; surface: string; reference_date: Date }>(`select u.version_id, u.surface, u.reference_date from operational_alignment_usages u where u.alignment_id = $1`, [second])).rows
    expect(usages).toEqual([{ version_id: expect.any(String), surface: "MONITORING", reference_date: new Date("2026-11-15T15:00:00Z") }])

    // EXCLUSÃO LÓGICA (motivo obrigatório): deixa de valer a partir de agora, sai da lista; o passado continua coberto.
    expect((await org.delete(`${base}/${second}`).send({})).status).toBe(400)
    expect((await org.delete(`${base}/${second}`).send({ reason: "Cadastrado no Grupo errado" })).status).toBe(200)
    expect((await org.get(`${base}?page=1&pageSize=50`)).body.data.items.map((item: { id: string }) => item.id)).not.toContain(second)
    expect((await org.get(`${base}/${second}`)).status).toBe(404)
    const appliedSecond = async (at: string) => (await resolve(operadorOuvidoria.id, at)).applied.some((entry) => entry.alignmentId === second)
    expect(await appliedSecond("2026-11-15T15:00:00Z")).toBe(Date.now() > Date.parse("2026-11-15T15:00:00Z"))
    expect(await appliedSecond(new Date(Date.now() + 60_000).toISOString())).toBe(false)
    expect((await events(second)).find((event) => event.event_type === "DELETED")).toMatchObject({ actor_person_id: geral.id, details: expect.objectContaining({ reason: "Cadastrado no Grupo errado" }) })

    // Volta por Consultar dados › Itens excluídos — encerrado (não volta a valer sozinho), com o rastro da restauração.
    // (A rota abre uma sessão própria no banco; aqui, dentro da transação desfeita, vão o trecho da listagem e o serviço de restauração.)
    const { deletedItemsBranch, findDeletedItemDefinition } = await import("../../data-explorer/domain/deleted-items.js")
    const { restoreDeletedItem } = await import("../../data-explorer/application/deleted-items-service.js")
    const { explorerLimitsFrom } = await import("../../data-explorer/domain/explorer-limits.js")
    const { createPostgresAccessRepository } = await import("../../access/infrastructure/postgres-access-repository.js")
    const definition = findDeletedItemDefinition("OPERATIONAL_ALIGNMENT")!
    const deletedItems = (await client.query<{ item_id: string; item_name: string; person_id: string }>(deletedItemsBranch(definition), [ORG])).rows
    expect(deletedItems).toContainEqual(expect.objectContaining({ item_id: second, item_name: "Fatura só por SMS", person_id: geral.id }))
    const access = await createPostgresAccessRepository(client as never).loadContext(ORG, geral.accountId)
    await restoreDeletedItem({ db: savepointDb(client), limits: explorerLimitsFrom(process.env as never) }, { organizationId: ORG, accountId: geral.accountId, personId: geral.id, access }, "OPERATIONAL_ALIGNMENT", second)
    const restored = (await org.get(`${base}/${second}`)).body.data
    expect(["ENDED", "CANCELLED"]).toContain(restored.state)
    expect(await appliedSecond(new Date(Date.now() + 60_000).toISOString())).toBe(false)
    expect((await events(second)).map((event) => event.event_type)).toContain("RESTORED")

    // HISTÓRICO para o chat (decisão do usuário): só o que já NÃO vale, últimos 12 meses, do público da pessoa, SEM os excluídos.
    expect((await org.delete(`${base}/${specific}`).send({ reason: "Subgrupo errado" })).status).toBe(200)
    const { loadAlignmentHistory, executeAlignmentHistory } = await import("../application/alignment-history.js")
    const historyAt = new Date("2026-12-10T12:00:00Z")
    const titles = async (personId: string, at = historyAt) => (await loadAlignmentHistory(client, { organizationId: ORG, personId, now: at })).map((entry) => entry.title)
    expect(await titles(operadorOuvidoria.id)).toEqual(expect.arrayContaining(["Fatura pelo App Meu Telnova ou site", "Fatura só por SMS", "Prazo de retorno da Ouvidoria"]))
    expect(await titles(operadorN2.id)).not.toContain("N2: fatura pelo site") // excluído
    expect(await titles(operadorEmpresas.id)).toEqual([]) // outro universo
    expect(await titles(operadorOuvidoria.id, new Date("2027-12-10T12:00:00Z"))).toEqual([]) // mais de 12 meses
    const answer = await executeAlignmentHistory(client, { organizationId: ORG, personId: operadorOuvidoria.id, now: historyAt })
    expect(answer.text).toContain("REGISTRO: nenhum destes vale mais")
    expect(answer.text).toMatch(/não vale mais desde \d{2}\/\d{2}\/2026/)

    // MOTIVOS: listas pela API; manter as listas exige alcance da organização (o gerente do Grupo só lê).
    const reasons = (await gerente.get(`${base}/reasons`)).body.data as { name: string; uses: number }[]
    expect(reasons.map((reason) => reason.name)).toEqual(expect.arrayContaining(["Processo em alteração", "Processo desatualizado", "Contingência", "Outro"]))
    expect(reasons.find((reason) => reason.name === "Contingência")!.uses).toBeGreaterThan(0)
    expect((await gerente.post(`${base}/reasons`).send({ name: "Mudança de fornecedor" })).status).toBe(403)
    expect((await org.post(`${base}/reasons`).send({ name: "Mudança de fornecedor" })).status).toBe(201)
    expect((await org.post(`${base}/reasons`).send({ name: "mudança de fornecedor" })).body.error.code).toBe("OPERATIONAL_ALIGNMENT_REASON_DUPLICATED")
    expect((await org.post(`${base}/request-reasons`).send({ name: "Proof AO Mudança de endereço" })).status).toBe(201)
    expect((await gerente.get(`${base}/request-reasons`)).body.data.map((reason: { name: string }) => reason.name)).toEqual(expect.arrayContaining(["Proof AO Fatura", "Proof AO Mudança de endereço"]))
    expect((await org.post(`${base}/request-reasons`).send({ name: "Proof AO Fatura" })).body.error.code).toBe("OPERATIONAL_ALIGNMENT_REQUEST_REASON_DUPLICATED")
    expect((await gerente.get(`${base}/${id}`)).body.data.current).toMatchObject({ reason: { name: "Contingência" }, requestReasons: [{ name: "Proof AO Fatura" }] })

    // INDICADORES DE SUCESSO (bloco 7): por área, quem mais faz, motivos, bases e o mais antigo ativo — no alcance de quem lê.
    const { alignmentsSummary } = await import("../../inia-success/application/alignments-reader.js")
    const summary = await alignmentsSummary(client, { organizationId: ORG, personId: geral.id, accountId: geral.accountId }, { from: "2026-11-01", to: "2026-11-30" })
    const area = (label: string) => summary.byArea.find((entry) => entry.label === label)?.count ?? 0
    expect(area("Proof AO Ouvidoria")).toBeGreaterThanOrEqual(2)
    expect(summary.byReason.find((entry) => entry.label === "Contingência")!.count).toBe(summary.inPeriod)
    expect(summary.byRequestReason.find((entry) => entry.label === "Proof AO Fatura")!.count).toBe(summary.inPeriod)
    expect(summary.topProcesses.find((entry) => entry.key === doc)!.count).toBe(summary.inPeriod)
    expect(summary.byAuthorArea.find((entry) => entry.label === "Proof AO Ouvidoria")?.count ?? 0).toBeGreaterThanOrEqual(1)
    const managerView = await alignmentsSummary(client, { organizationId: ORG, personId: gerenteOuvidoria.id, accountId: gerenteOuvidoria.accountId }, { from: "2026-11-01", to: "2026-11-30", teamId: [outro] })
    expect(managerView.inPeriod).toBe(0) // filtro por outro Grupo: nada do alcance dele
  })

  it("alcance (run-5 PUB-01/PUB-02): versão antiga do próprio Grupo não dá acesso; universo fora do alcance some", async () => {
    const operation = (await client.query<{ id: string }>("select id from operations where organization_id = $1 order by created_at limit 1", [ORG])).rows[0]!.id
    const teamA = (await client.query<{ id: string }>("insert into teams (organization_id, operation_id, name, operating_universe) values ($1, $2, 'Proof AO Alcance A', 'B2C') returning id", [ORG, operation])).rows[0]!.id
    // Vínculo novo exige ao menos um operador "Em produção" no Grupo escolhido (seletor de alcance, 23/11/2026).
    await client.query("insert into people (organization_id, name, role, team_id, active, current_employment_status) values ($1, 'Proof AO Operador A', 'OPERATOR', $2, true, 'EM_PRODUCAO')", [ORG, teamA])
    const doc = (await client.query<{ id: string }>("insert into knowledge_documents (organization_id, title, document_type, operating_universe) values ($1, 'Proof AO — PR Alcance', 'PROCEDURE', 'B2C') returning id", [ORG])).rows[0]!.id
    const docB2B = (await client.query<{ id: string }>("insert into knowledge_documents (organization_id, title, document_type, operating_universe) values ($1, 'Proof AO — PR Alcance B2B', 'PROCEDURE', 'B2B') returning id", [ORG])).rows[0]!.id
    for (const id of [doc, docB2B]) await client.query("insert into knowledge_versions (organization_id, document_id, version, content, status, content_hash) values ($1, $2, 1, 'Conteúdo', 'PUBLISHED', md5($3))", [ORG, id, id])
    const admin = (await client.query<{ id: string; account: string }>("select p.id, ua.id account from people p join user_accounts ua on ua.person_id = p.id join access_role_assignments ara on ara.user_account_id = ua.id where p.organization_id = $1 and ara.role_code = 'ADMINISTRADOR_GERAL' and ara.revoked_at is null limit 1", [ORG])).rows[0]!
    const actor = { organizationId: ORG, personId: admin.id, accountId: admin.account, sub: admin.account }
    const reasonId = (await client.query<{ id: string }>("select id from operational_alignment_reasons where organization_id = $1 and name = 'Outro'", [ORG])).rows[0]!.id
    const all = { unrestricted: false as const, allTeams: true, teamIds: new Set<string>(), subteamIds: new Set<string>() }
    const groupA = { unrestricted: false as const, allTeams: false, teamIds: new Set([teamA]), subteamIds: new Set<string>() }
    const ok = async () => ({ outcome: "ALLOWED" as const, model: null, durationMs: 0 })
    const db = savepointDb(client)
    const service = await import("../application/operational-alignment-service.js")
    const base = { reasonId, title: "Alcance", guidance: "Orientação de teste do alcance.", affectedDocumentIds: [doc], affectedTopic: "Teste", justification: "Prova do alcance.", operatingUniverse: "B2C" as const, startsOn: "2026-12-01", endsOn: "2026-12-31" }

    // v1 do Grupo A (publicada) → v2 do universo inteiro (publicada pelo admin) → rascunho v3 do admin.
    const created = await service.createAlignment(db, actor, all, { ...base, scopeType: "TEAM", teamId: teamA })
    await service.publishAlignment(db, actor, all, created.id, {}, { prohibitedTopicCheck: ok })
    await service.updateAlignment(db, actor, all, created.id, { ...base, scopeType: "UNIVERSE", changeReason: "Vale para todos." })
    await service.publishAlignment(db, actor, all, created.id, {}, { prohibitedTopicCheck: ok })
    await service.updateAlignment(db, actor, all, created.id, { ...base, scopeType: "UNIVERSE", title: "Rascunho do admin", changeReason: "Ajuste." })

    // O gestor do Grupo A não lê, não edita, não descarta e não publica — a v1 dele ficou só no histórico.
    const notFound = { code: "OPERATIONAL_ALIGNMENT_NOT_FOUND" }
    await expect(service.getAlignment(client, ORG, groupA, created.id)).rejects.toMatchObject(notFound)
    await expect(service.updateAlignment(db, actor, groupA, created.id, { ...base, scopeType: "TEAM", teamId: teamA, changeReason: "Só o meu Grupo." })).rejects.toMatchObject(notFound)
    await expect(service.discardDraft(db, actor, groupA, created.id)).rejects.toMatchObject(notFound)
    await expect(service.publishAlignment(db, actor, groupA, created.id, {}, { prohibitedTopicCheck: ok })).rejects.toMatchObject(notFound)
    await expect(service.affectedAssessments(client, ORG, groupA, created.id)).rejects.toMatchObject(notFound)
    const listA = await service.listAlignments(client as unknown as Database, ORG, groupA, {})
    expect((Array.isArray(listA) ? listA : listA.items).some((item) => item.id === created.id)).toBe(false)
    expect((await service.getAlignment(client, ORG, all, created.id)).id).toBe(created.id) // o admin continua vendo

    // Universo: alinhamento B2B fora do alcance de quem administra só B2C — some da lista, do detalhe, de encerrar e de excluir.
    const b2b = await service.createAlignment(db, actor, all, { ...base, affectedDocumentIds: [docB2B], operatingUniverse: "B2B", scopeType: "UNIVERSE" })
    await service.publishAlignment(db, actor, all, b2b.id, {}, { prohibitedTopicCheck: ok })
    const onlyB2C = { ...all, universes: ["B2C" as const] }
    await expect(service.getAlignment(client, ORG, onlyB2C, b2b.id)).rejects.toMatchObject(notFound)
    await expect(service.endAlignment(db, actor, onlyB2C, b2b.id, { reason: "Encerrar." })).rejects.toMatchObject(notFound)
    await expect(service.deleteAlignment(db, actor, onlyB2C, b2b.id, { reason: "Excluir." })).rejects.toMatchObject(notFound)
    const listB2C = await service.listAlignments(client as unknown as Database, ORG, onlyB2C, {})
    expect((Array.isArray(listB2C) ? listB2C : listB2C.items).some((item) => item.id === b2b.id)).toBe(false)
    const processes = await service.listProcessOptions(client as unknown as Database, ORG, { ids: docB2B }, ["B2C"])
    expect((Array.isArray(processes) ? processes : processes.items).map((item) => item.id)).not.toContain(docB2B)
  })

  it("assunto proibido: a publicação é recusada (e a conferência indisponível também não publica)", async () => {
    const doc = (await client.query<{ id: string }>("insert into knowledge_documents (organization_id, title, document_type) values ($1, 'Proof AO — PR Cancelamento', 'PROCEDURE') returning id", [ORG])).rows[0]!.id
    const adminId = (await client.query<{ id: string; account: string }>("select p.id, ua.id account from people p join user_accounts ua on ua.person_id = p.id join access_role_assignments ara on ara.user_account_id = ua.id where p.organization_id = $1 and ara.role_code = 'ADMINISTRADOR_GERAL' and ara.revoked_at is null limit 1", [ORG])).rows[0]!
    const actor = { organizationId: ORG, personId: adminId.id, accountId: adminId.account, sub: adminId.account }
    const scopes = { unrestricted: false as const, allTeams: true, teamIds: new Set<string>(), subteamIds: new Set<string>() }
    const db = savepointDb(client)
    const { createAlignment } = await import("../application/operational-alignment-service.js")
    const created = await createAlignment(db, actor, scopes, { reasonId: (await client.query<{ id: string }>("select id from operational_alignment_reasons where organization_id = $1 and name = 'Outro'", [ORG])).rows[0]!.id, title: "Cancelamento direto", guidance: "Durante a campanha, cancele a linha na hora quando o cliente pedir.", affectedDocumentIds: [doc], affectedTopic: "Pedido de cancelamento", justification: "Campanha de retenção encerrada.", operatingUniverse: "B2C", scopeType: "UNIVERSE", startsOn: "2026-11-10", endsOn: "2026-11-30" })
    await expect(publishAlignment(db, actor, scopes, created.id, {}, { prohibitedTopicCheck: async () => ({ outcome: "VIOLATION", hits: [{ kind: "PROHIBITED_TOPIC", name: "Cancelamento" }], reason: "Orienta cancelamento.", model: null, durationMs: 0 }) })).rejects.toMatchObject({ code: "OPERATIONAL_ALIGNMENT_PROHIBITED_TOPIC" })
    await expect(publishAlignment(db, actor, scopes, created.id, {}, { prohibitedTopicCheck: async () => ({ outcome: "CHECK_FAILED", code: "X", message: "x", model: null, durationMs: 0 }) })).rejects.toMatchObject({ code: "OPERATIONAL_ALIGNMENT_CHECK_UNAVAILABLE" })
    const status = (await client.query<{ status: string }>("select status from operational_alignment_versions where alignment_id = $1", [created.id])).rows.map((row) => row.status)
    expect(status).toEqual(["DRAFT"])
  })
  it("multi-grupo (223): um cadastro para o Grupo A inteiro e só o Subgrupo B1; B2 e o Grupo C de fora; gestor parcial; conflito, precedência e remoção de vínculo", async () => {
    await client.query("update prohibited_topics set active = false where organization_id = $1", [ORG])
    const operation = (await client.query<{ id: string }>("select id from operations where organization_id = $1 order by created_at limit 1", [ORG])).rows[0]!.id
    const team = async (name: string) => (await client.query<{ id: string }>("insert into teams (organization_id, operation_id, name, operating_universe) values ($1, $2, $3, 'B2C') returning id", [ORG, operation, name])).rows[0]!.id
    const subteam = async (teamId: string, name: string) => (await client.query<{ id: string }>("insert into subteams (organization_id, team_id, name) values ($1, $2, $3) returning id", [ORG, teamId, name])).rows[0]!.id
    const teamA = await team("Proof MG Grupo A")
    const teamB = await team("Proof MG Grupo B")
    const teamC = await team("Proof MG Grupo C")
    const subB1 = await subteam(teamB, "Proof MG B1")
    const subB2 = await subteam(teamB, "Proof MG B2")
    const doc = (await client.query<{ id: string }>("insert into knowledge_documents (organization_id, title, document_type, operating_universe) values ($1, 'Proof MG — PR Fatura', 'PROCEDURE', 'B2C') returning id", [ORG])).rows[0]!.id
    await client.query("insert into knowledge_versions (organization_id, document_id, version, content, status, content_hash) values ($1, $2, 1, 'Conteúdo', 'PUBLISHED', md5($3))", [ORG, doc, doc])
    const hash = await hashPassword("Proof@12345")
    let n = 0
    const person = async (teamId: string | null, subteamId: string | null, roleCode?: string, scope?: { type: string; teamId?: string }) => {
      n += 1
      const id = (await client.query<{ id: string }>("insert into people (organization_id, name, role, team_id, subteam_id) values ($1, $2, 'OPERATOR', $3, $4) returning id", [ORG, `Proof MG ${n}`, teamId, subteamId])).rows[0]!.id
      const email = `proof-mg-${n}-${Date.now()}@proof.inia.local`
      const accountId = (await client.query<{ id: string }>("insert into user_accounts (organization_id, person_id, email, password_hash) values ($1, $2, $3, $4) returning id", [ORG, id, email, hash])).rows[0]!.id
      if (roleCode && scope) await client.query("insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, team_id, granted_at) values ($1, $2, $3, $4, $5, now())", [ORG, accountId, roleCode, scope.type, scope.teamId ?? null])
      return { id, email }
    }
    const geral = await person(null, null, "ADMINISTRADOR_GERAL", { type: "ORGANIZATION" })
    const gestorA = await person(teamA, null, "GESTOR_DE_ALINHAMENTOS", { type: "GROUP", teamId: teamA })
    const opA = await person(teamA, null)
    const opB1 = await person(teamB, subB1)
    const opB2 = await person(teamB, subB2)
    const opC = await person(teamC, null)
    const opInconsistent = await person(teamA, subB1)
    const app = createApp(client as never)
    const login = async (email: string) => {
      const http = request.agent(app)
      expect((await http.post("/api/v1/auth/login").send({ email, password: "Proof@12345" })).status).toBe(200)
      return http
    }
    const org = await login(geral.email)
    const gestor = await login(gestorA.email)
    const base = "/api/v1/admin/operational-alignments"
    const reasonId = (await client.query<{ id: string }>("select id from operational_alignment_reasons where organization_id = $1 and name = 'Contingência'", [ORG])).rows[0]!.id
    const body = { reasonId, title: "Proof MG — compartilhado", guidance: "Oriente o cliente a acessar a fatura pelo app.", affectedDocumentIds: [doc], affectedTopic: "Envio da fatura", justification: "Sistema de envio em substituição.", operatingUniverse: "B2C", scopeType: "GROUPS", links: [{ teamId: teamA }, { subteamId: subB1 }], startsOn: "2026-11-10", endsOn: "2026-11-30" }

    // Validação dos vínculos no backend: Subgrupo de outro Grupo, duplicado, Subgrupo junto do próprio Grupo inteiro.
    expect((await org.post(base).send({ ...body, links: [{ teamId: teamA, subteamId: subB1 }] })).body.error.code).toBe("OPERATIONAL_ALIGNMENT_SCOPE_INVALID")
    expect((await org.post(base).send({ ...body, links: [{ teamId: teamA }, { teamId: teamA }] })).body.error.code).toBe("OPERATIONAL_ALIGNMENT_SCOPE_INVALID")
    expect((await org.post(base).send({ ...body, links: [{ teamId: teamB }, { subteamId: subB1 }] })).body.error.code).toBe("OPERATIONAL_ALIGNMENT_SCOPE_INVALID")
    // Gestor só do Grupo A não cria para o Subgrupo B1 (fora do escopo).
    expect((await gestor.post(base).send(body)).status).toBe(403)

    const created = await org.post(base).send(body)
    expect(created.status).toBe(201)
    const shared = created.body.data.id as string
    expect(created.body.data.draft.links).toEqual([expect.objectContaining({ teamId: teamA, subteamId: null }), expect.objectContaining({ teamId: teamB, subteamId: subB1 })])
    expect((await org.post(`${base}/${shared}/publish`).send({})).status).toBe(200)

    const at = (iso: string) => new Date(iso)
    const titles = async (personId: string, iso: string) => (await resolveOperationalAlignmentsFor(client, { organizationId: ORG, personId, at: at(iso), documentIds: [doc] })).applied.map((entry) => `${entry.title}@v${entry.version}`)
    expect(await titles(opA.id, "2026-11-15T15:00:00Z")).toEqual(["Proof MG — compartilhado@v1"])
    expect(await titles(opB1.id, "2026-11-15T15:00:00Z")).toEqual(["Proof MG — compartilhado@v1"])
    expect(await titles(opB2.id, "2026-11-15T15:00:00Z")).toEqual([])
    expect(await titles(opC.id, "2026-11-15T15:00:00Z")).toEqual([])
    // Alcançado pelos dois vínculos (cadastro inconsistente Grupo A + Subgrupo B1): uma vez só.
    expect(await titles(opInconsistent.id, "2026-11-15T15:00:00Z")).toEqual(["Proof MG — compartilhado@v1"])

    // Gestor parcial (só o Grupo A): o alinhamento também vale para B1, que ele não administra — fica fora da lista e do detalhe
    // (política anterior: ver = administrar), e ele não edita nem publica.
    const gestorList = (await gestor.get(`${base}?page=1&pageSize=50&search=Proof MG`)).body.data.items as { id: string }[]
    expect(gestorList.some((item) => item.id === shared)).toBe(false)
    expect((await gestor.get(`${base}/${shared}`)).status).toBe(404)
    expect((await gestor.put(`${base}/${shared}/draft`).send({ ...body, links: [{ teamId: teamA }], changeReason: "Tirar o B1" })).status).toBe(404)
    // Lista do administrador: filtro pelo Grupo B acha pelo vínculo do Subgrupo; uma linha só.
    expect(((await org.get(`${base}?page=1&pageSize=50&teamId=${teamB}`)).body.data.items as { id: string }[]).filter((item) => item.id === shared)).toHaveLength(1)

    // Conflito: outro alinhamento do mesmo ponto com vínculo IDÊNTICO (Subgrupo B1) é recusado; com o Grupo B inteiro, há precedência.
    const other = (await org.post(base).send({ ...body, title: "Proof MG — Grupo B", links: [{ subteamId: subB1 }] })).body.data.id as string
    const preview = await org.get(`${base}/${other}/publication-preview`)
    expect(preview.body.data.overlaps).toEqual([expect.objectContaining({ alignmentId: shared, sameScopeLevel: true, moreSpecific: null })])
    expect((await org.post(`${base}/${other}/publish`).send({ relations: [{ alignmentId: shared, relation: "SAME_TOPIC" }] })).body.error.code).toBe("OPERATIONAL_ALIGNMENT_CONFLICT")
    expect((await org.put(`${base}/${other}/draft`).send({ ...body, title: "Proof MG — Grupo B", links: [{ teamId: teamB }] })).status).toBe(200)
    expect((await org.post(`${base}/${other}/publish`).send({ relations: [{ alignmentId: shared, relation: "SAME_TOPIC" }] })).status).toBe(200)
    // Em B1 o compartilhado é de Subgrupo (mais específico); em B2 só o do Grupo B inteiro alcança.
    expect(await titles(opB1.id, "2026-11-15T15:00:00Z")).toEqual(["Proof MG — compartilhado@v1"])
    expect(await titles(opB2.id, "2026-11-15T15:00:00Z")).toEqual(["Proof MG — Grupo B@v1"])

    // Remover o vínculo do B1 (nova versão a partir de 20/11): B1 perde o compartilhado dali em diante; A continua; a história fica.
    expect((await org.put(`${base}/${shared}/draft`).send({ ...body, links: [{ teamId: teamA }], startsOn: "2026-11-20", changeReason: "B1 voltou ao procedimento do Grupo B" })).status).toBe(200)
    expect((await org.post(`${base}/${shared}/publish`).send({})).status).toBe(200)
    expect(await titles(opB1.id, "2026-11-25T15:00:00Z")).toEqual(["Proof MG — Grupo B@v1"])
    expect(await titles(opA.id, "2026-11-25T15:00:00Z")).toEqual(["Proof MG — compartilhado@v2"])
    expect(await titles(opB1.id, "2026-11-15T15:00:00Z")).toEqual(["Proof MG — compartilhado@v1"])
    // A versão publicada guardou os vínculos dela (v1 com B1, v2 sem).
    const linksByVersion = (await client.query<{ version: number; n: number }>("select v.version, count(l.*)::int n from operational_alignment_versions v left join operational_alignment_version_scopes l on l.version_id = v.id where v.alignment_id = $1 group by v.version order by v.version", [shared])).rows
    expect(linksByVersion).toEqual([{ version: 1, n: 2 }, { version: 2, n: 1 }])
  })
})
