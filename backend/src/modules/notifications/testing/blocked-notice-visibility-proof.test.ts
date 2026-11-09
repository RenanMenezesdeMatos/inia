/**
 * PROVA contra o banco de TESTE real: o aviso de execução bloqueada só aparece e só conta nos não lidos para quem administra o workflow
 * AGORA, independentemente do limite da lista do sino (`docs/qa/workflows/registro-de-achados.md`, contagem do sino).
 * Pela API real, com sessões reais. ZERO chamada de modelo. Tudo numa transação desfeita no fim.
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run blocked-notice-visibility-proof
 */
import { randomUUID } from "node:crypto"
import type pg from "pg"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { getManageableScopes } from "../../auth/application/manageable-scopes.js"
import { PgPendingActionsRepository } from "../../pending-actions/application/pending-actions-repository.js"
import {
  ORG,
  closeProofTransaction,
  createAccount,
  createPerson,
  createTeam,
  flowNode,
  insertLiveWorkflow,
  loginAs,
  openProofTransaction,
  singleStepGraph,
  type ProofClient,
} from "../../workflows/testing/p5-proof-helpers.js"
import { buildNotificationSummary, NOTIFICATION_LIST_LIMIT } from "../application/build-notification-summary.js"
import { PgNotificationsRepository } from "../application/notifications-repository.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
const TYPE = "WORKFLOW_EXECUTION_BLOCKED"
const STEP = flowNode("revisao", "human_review", "Revisão da supervisão", { reviewTarget: { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" } })
const graph = singleStepGraph(STEP, ["approved", "rejected", "escalated"])

type Agent = Awaited<ReturnType<typeof loginAs>>
type Item = { id: string; title: string; description: string; resolved: boolean; readAt: string | null; target: { type: string; workflowId?: string } }

describe.skipIf(!ENABLED)("Aviso de execução bloqueada: a permissão atual decide o que aparece e o que conta (prova Postgres)", () => {
  let pool: pg.Pool
  let client: ProofClient

  beforeAll(async () => {
    ;({ pool, client } = await openProofTransaction())
  })
  afterAll(async () => closeProofTransaction(pool, client))
  beforeEach(async () => {
    await client.query("savepoint caso_sino")
  })
  afterEach(async () => {
    await client.query("rollback to savepoint caso_sino")
  })

  let daySequence = 0
  /** Chave com um dia único: a chave real é uma por workflow, etapa e dia. */
  const nextDay = () => {
    daySequence += 1
    return new Date(Date.UTC(2020, 0, daySequence)).toISOString().slice(0, 10)
  }

  type NoticeOptions = { ageDays?: number; status?: string; readAt?: string | null; organizationId?: string; key?: string }
  async function notice(recipientId: string, workflowId: string, options: NoticeOptions = {}): Promise<string> {
    const { ageDays = 0, status = "OPEN", readAt = null, organizationId = ORG, key = `workflow_execution_blocked:${workflowId}:revisao:${nextDay()}` } = options
    return (await client.query<{ id: string }>(
      `insert into alerts (organization_id, recipient_id, title, description, severity, alert_type, dedupe_key, status, read_at, created_at)
       values ($1, $2, 'Execução de workflow bloqueada', 'Uma execução parou porque a revisão não tem revisor disponível.', 'HIGH', $3, $4, $5::alert_status, $6, now() - ($7 || ' days')::interval) returning id`,
      [organizationId, recipientId, TYPE, key, status, readAt, String(ageDays)],
    )).rows[0]!.id
  }

  async function otherAlerts(recipientId: string, count: number, options: { status?: string; readAt?: string | null } = {}) {
    for (let index = 0; index < count; index += 1) {
      await client.query(
        `insert into alerts (organization_id, recipient_id, title, description, severity, alert_type, dedupe_key, status, read_at) values ($1, $2, 'Outro aviso', 'Sem relação com Workflows.', 'MEDIUM', 'WORKFLOW_OUTPUT', $3, $4::alert_status, $5)`,
        [ORG, recipientId, `prova-sino-${randomUUID()}`, options.status ?? "OPEN", options.readAt ?? null],
      )
    }
  }

  const bell = async (agent: Agent) => {
    const response = await agent.get("/api/v1/notifications")
    expect(response.status).toBe(200)
    return response.body.data as { unreadCount: number; items: Item[] }
  }
  const blockedItems = (items: Item[]) => items.filter((item) => item.target.type === "ADMIN_WORKFLOW_EXECUTIONS" || /bloquead/i.test(item.title))

  async function viewer(name: string, grants: Parameters<typeof createAccount>[2] = []) {
    const personId = await createPerson(client, name)
    const { accountId, email } = await createAccount(client, personId, grants)
    return { personId, accountId, agent: await loginAs(client, email) }
  }
  const ORG_ROLE = [{ role: "ADMINISTRADOR_GERAL" }]
  const workflowIn = async (options: { teamId?: string; subteamId?: string } = {}, name = "Prova Sino Workflow") => (await insertLiveWorkflow(client, name, graph, options)).workflowId
  const subteam = async (teamId: string, name: string) => (await client.query<{ id: string }>("insert into subteams (organization_id, team_id, name) values ($1, $2, $3) returning id", [ORG, teamId, name])).rows[0]!.id

  describe("independente do limite da lista", () => {
    it("aviso sem permissão, mais antigo que o limite da lista, não conta nos não lidos", async () => {
      const { personId, agent } = await viewer("Sem Permissão Com Aviso Antigo")
      const workflowId = await workflowIn({}, "Prova Sino Aviso Antigo")
      await notice(personId, workflowId, { ageDays: 40 })
      await otherAlerts(personId, NOTIFICATION_LIST_LIMIT + 5)
      const { unreadCount, items } = await bell(agent)
      expect(items).toHaveLength(NOTIFICATION_LIST_LIMIT)
      expect(blockedItems(items)).toEqual([])
      expect(unreadCount).toBe(NOTIFICATION_LIST_LIMIT + 5)
    })

    it("com permissão, o mesmo aviso antigo conta, mesmo fora da lista", async () => {
      const { personId, agent } = await viewer("Com Permissão Com Aviso Antigo", ORG_ROLE)
      await notice(personId, await workflowIn(), { ageDays: 40 })
      await otherAlerts(personId, NOTIFICATION_LIST_LIMIT + 5)
      const { unreadCount, items } = await bell(agent)
      expect(blockedItems(items)).toEqual([])
      expect(unreadCount).toBe(NOTIFICATION_LIST_LIMIT + 6)
    })

    it("avisos escondidos não ocupam a lista: os permitidos mais antigos continuam aparecendo", async () => {
      const allowedTeam = await createTeam(client, "Prova Sino Grupo Permitido")
      const hiddenTeam = await createTeam(client, "Prova Sino Grupo Alheio")
      const { personId, agent } = await viewer("Vê Só Um Grupo", [{ role: "ADMINISTRADOR", scopeType: "GROUP", teamId: allowedTeam }])
      const hiddenWorkflow = await workflowIn({ teamId: hiddenTeam }, "Prova Sino Alheio")
      const allowedWorkflow = await workflowIn({ teamId: allowedTeam }, "Prova Sino Permitido")
      for (let index = 0; index < NOTIFICATION_LIST_LIMIT + 3; index += 1) await notice(personId, hiddenWorkflow)
      for (let index = 0; index < 3; index += 1) await notice(personId, allowedWorkflow, { ageDays: 10 + index })
      const { unreadCount, items } = await bell(agent)
      expect(unreadCount).toBe(3)
      expect(items).toHaveLength(3)
      expect(items.every((item) => item.target.workflowId === allowedWorkflow)).toBe(true)
      expect(JSON.stringify(items)).not.toContain("Prova Sino Alheio")
    })
  })

  it("mistura de permitidos e não permitidos: conta e mostra só os permitidos; os demais tipos não mudam", async () => {
    const allowedTeam = await createTeam(client, "Prova Sino Grupo Permitido")
    const hiddenTeam = await createTeam(client, "Prova Sino Grupo Alheio")
    const { personId, agent } = await viewer("Mistura", [{ role: "ADMINISTRADOR", scopeType: "GROUP", teamId: allowedTeam }])
    const allowed = await workflowIn({ teamId: allowedTeam }, "Prova Sino Permitido")
    const hidden = await workflowIn({ teamId: hiddenTeam }, "Prova Sino Alheio")
    await notice(personId, allowed)
    await notice(personId, allowed)
    await notice(personId, hidden)
    await otherAlerts(personId, 2)
    const { unreadCount, items } = await bell(agent)
    expect(unreadCount).toBe(4)
    expect(items).toHaveLength(4)
    expect(blockedItems(items).map((item) => item.target.workflowId)).toEqual([allowed, allowed])
    expect(blockedItems(items)[0]?.title).toBe("Execução bloqueada: Prova Sino Permitido")
    expect(blockedItems(items)[0]?.description).toContain("Revisão da supervisão")
  })

  describe("perda e recuperação de permissão", () => {
    it("some ao perder e volta igual ao recuperar: nada é marcado como lido para esconder", async () => {
      const { personId, accountId, agent } = await viewer("Perde E Recupera", ORG_ROLE)
      const workflowId = await workflowIn()
      const alertId = await notice(personId, workflowId)
      await otherAlerts(personId, 1)
      expect((await bell(agent)).unreadCount).toBe(2)

      await client.query("update access_role_assignments set revoked_at = now() where user_account_id = $1", [accountId])
      const hidden = await bell(agent)
      expect(hidden.unreadCount).toBe(1)
      expect(blockedItems(hidden.items)).toEqual([])
      expect((await client.query("select read_at, status from alerts where id = $1", [alertId])).rows[0]).toEqual({ read_at: null, status: "OPEN" })

      await client.query("update access_role_assignments set revoked_at = null where user_account_id = $1", [accountId])
      const back = await bell(agent)
      expect(back.unreadCount).toBe(2)
      expect(blockedItems(back.items).map((item) => [item.id, item.readAt])).toEqual([[alertId, null]])
    })

    it("marcar tudo como lido sem acesso não toca no aviso escondido, que volta não lido", async () => {
      const { personId, accountId, agent } = await viewer("Marca Tudo Sem Acesso", ORG_ROLE)
      const alertId = await notice(personId, await workflowIn())
      await otherAlerts(personId, 2)
      await client.query("update access_role_assignments set revoked_at = now() where user_account_id = $1", [accountId])
      const readAll = await agent.post("/api/v1/notifications/read-all").send({})
      expect(readAll.body.data).toEqual({ updated: 2 })
      expect((await bell(agent)).unreadCount).toBe(0)
      expect((await client.query("select read_at from alerts where id = $1", [alertId])).rows[0]).toEqual({ read_at: null })
      await client.query("update access_role_assignments set revoked_at = null where user_account_id = $1", [accountId])
      expect((await bell(agent)).unreadCount).toBe(1)
    })

    it("marcar como lido um aviso escondido responde como se não existisse", async () => {
      const { personId, accountId, agent } = await viewer("Marca Escondido", ORG_ROLE)
      const alertId = await notice(personId, await workflowIn())
      await client.query("update access_role_assignments set revoked_at = now() where user_account_id = $1", [accountId])
      expect((await agent.post(`/api/v1/notifications/${alertId}/read`).send({})).status).toBe(404)
      expect((await client.query("select read_at from alerts where id = $1", [alertId])).rows[0]).toEqual({ read_at: null })
    })
  })

  describe("escopos: a mesma regra da aba Execuções", () => {
    type Scope = "ALL" | "TEAM_A" | "SUB_A1" | "SUB_A2" | "TEAM_B" | "SUB_B1"
    const CASES: { role: string; grant: "ORGANIZATION" | "GROUP" | "SUBGROUP"; visible: Scope[]; hidden: Scope[] }[] = [
      { role: "organização", grant: "ORGANIZATION", visible: ["ALL", "TEAM_A", "SUB_A1", "SUB_A2", "TEAM_B", "SUB_B1"], hidden: [] },
      { role: "grupo", grant: "GROUP", visible: ["TEAM_A", "SUB_A1", "SUB_A2"], hidden: ["ALL", "TEAM_B", "SUB_B1"] },
      { role: "subgrupo", grant: "SUBGROUP", visible: ["SUB_A1"], hidden: ["ALL", "TEAM_A", "SUB_A2", "TEAM_B", "SUB_B1"] },
    ]

    it.each(CASES)("administrador de $role", async ({ grant, visible, hidden }) => {
      const teamA = await createTeam(client, "Prova Sino Grupo A")
      const teamB = await createTeam(client, "Prova Sino Grupo B")
      const subA1 = await subteam(teamA, "A1")
      const subA2 = await subteam(teamA, "A2")
      const subB1 = await subteam(teamB, "B1")
      const scopes: Record<Scope, { teamId?: string; subteamId?: string }> = { ALL: {}, TEAM_A: { teamId: teamA }, SUB_A1: { teamId: teamA, subteamId: subA1 }, SUB_A2: { teamId: teamA, subteamId: subA2 }, TEAM_B: { teamId: teamB }, SUB_B1: { teamId: teamB, subteamId: subB1 } }
      const grants = grant === "ORGANIZATION" ? [{ role: "ADMINISTRADOR" }] : grant === "GROUP" ? [{ role: "ADMINISTRADOR", scopeType: "GROUP" as const, teamId: teamA }] : [{ role: "ADMINISTRADOR", scopeType: "SUBGROUP" as const, subteamId: subA1 }]
      const { personId, agent } = await viewer(`Administra ${grant}`, grants)
      const workflowOf = {} as Record<Scope, string>
      for (const scope of Object.keys(scopes) as Scope[]) {
        workflowOf[scope] = await workflowIn(scopes[scope], `Prova Sino ${scope}`)
        await notice(personId, workflowOf[scope])
      }
      const { unreadCount, items } = await bell(agent)
      expect(unreadCount).toBe(visible.length)
      expect(new Set(blockedItems(items).map((item) => item.target.workflowId))).toEqual(new Set(visible.map((scope) => workflowOf[scope])))
      // A rota do destino concorda com o sino, nos dois sentidos.
      for (const scope of visible) expect((await agent.get(`/api/v1/admin/workflows/${workflowOf[scope]}/enrollments`)).status, scope).toBe(200)
      for (const scope of hidden) expect([403, 404], scope).toContain((await agent.get(`/api/v1/admin/workflows/${workflowOf[scope]}/enrollments`)).status)
    })
  })

  describe("workflow removido ou indisponível", () => {
    it("workflow removido: o aviso não aparece nem conta, e não gera erro", async () => {
      const { personId, agent } = await viewer("Workflow Removido", ORG_ROLE)
      const workflowId = await workflowIn()
      await notice(personId, workflowId)
      await otherAlerts(personId, 1)
      await client.query("update workflows set active_version_id = null where id = $1", [workflowId])
      await client.query("delete from workflow_versions where workflow_id = $1", [workflowId])
      await client.query("delete from workflows where id = $1", [workflowId])
      const { unreadCount, items } = await bell(agent)
      expect(unreadCount).toBe(1)
      expect(blockedItems(items)).toEqual([])
    })

    it("chave fora do formato: fica invisível, sem erro na consulta", async () => {
      const { personId, agent } = await viewer("Chave Fora Do Formato", ORG_ROLE)
      await notice(personId, "x", { key: `workflow_execution_blocked:nao-e-uuid:revisao:${nextDay()}` })
      await notice(personId, "x", { key: `workflow_execution_blocked:${"-".repeat(36)}:revisao:${nextDay()}` })
      const { unreadCount, items } = await bell(agent)
      expect(unreadCount).toBe(0)
      expect(items).toEqual([])
    })

    it("workflow desligado continua visível: quem publicou ainda o administra e pode corrigir", async () => {
      const { personId, agent } = await viewer("Workflow Desligado", ORG_ROLE)
      const { workflowId } = await insertLiveWorkflow(client, "Prova Sino Desligado", graph, { active: false })
      await notice(personId, workflowId)
      const { unreadCount, items } = await bell(agent)
      expect(unreadCount).toBe(1)
      expect(blockedItems(items)[0]?.title).toBe("Execução bloqueada: Prova Sino Desligado")
    })

    it("workflow sem versão publicada: continua visível, sem nome de etapa", async () => {
      const { personId, agent } = await viewer("Sem Versão", ORG_ROLE)
      const workflowId = await workflowIn({}, "Prova Sino Sem Versão")
      await notice(personId, workflowId)
      await client.query("update workflows set active_version_id = null where id = $1", [workflowId])
      const { unreadCount, items } = await bell(agent)
      expect(unreadCount).toBe(1)
      expect(blockedItems(items)[0]?.description).not.toContain("Etapa")
    })

    it("etapa que não existe mais na versão vigente: o aviso aparece, sem o nome da etapa", async () => {
      const { personId, agent } = await viewer("Etapa Removida", ORG_ROLE)
      const workflowId = await workflowIn()
      await notice(personId, workflowId, { key: `workflow_execution_blocked:${workflowId}:etapa-antiga:${nextDay()}` })
      const [item] = blockedItems((await bell(agent)).items)
      expect(item?.target.workflowId).toBe(workflowId)
      expect(item?.description).not.toContain("Etapa")
    })
  })

  describe("isolamento", () => {
    it("o aviso de outra pessoa não conta para quem lê", async () => {
      const { personId: other } = await viewer("Outra Pessoa", ORG_ROLE)
      const { personId, agent } = await viewer("Quem Lê", ORG_ROLE)
      const workflowId = await workflowIn()
      await notice(other, workflowId)
      await notice(personId, workflowId)
      const { unreadCount, items } = await bell(agent)
      expect(unreadCount).toBe(1)
      expect(blockedItems(items)).toHaveLength(1)
    })

    it("outra organização: workflow e avisos de lá não existem para quem é daqui", async () => {
      const otherOrg = (await client.query<{ id: string }>("insert into organizations (name, slug) values ('Prova Sino Org B', $1) returning id", [`prova-sino-${randomUUID()}`])).rows[0]!.id
      const otherPerson = (await client.query<{ id: string }>("insert into people (organization_id, name, role) values ($1, 'Pessoa Org B', 'OPERATOR') returning id", [otherOrg])).rows[0]!.id
      const { workflowId: foreignWorkflow } = await insertLiveWorkflow(client, "Prova Sino Org B", graph, { organizationId: otherOrg })
      const { personId, agent } = await viewer("Administra Só A Sua", ORG_ROLE)

      // Aviso gravado aqui, apontando para um workflow de outra organização: mesmo com papel de organização, não aparece.
      await notice(personId, foreignWorkflow)
      // Aviso gravado na outra organização para esta mesma pessoa, e aviso da pessoa de lá.
      await notice(personId, foreignWorkflow, { organizationId: otherOrg })
      await notice(otherPerson, foreignWorkflow, { organizationId: otherOrg })
      const { unreadCount, items } = await bell(agent)
      expect(unreadCount).toBe(0)
      expect(items).toEqual([])
      expect(JSON.stringify(items)).not.toContain("Prova Sino Org B")

      const repository = new PgNotificationsRepository(client as never)
      expect(await repository.loadBlockedNoticeWorkflows(personId, ORG)).toEqual([])
      expect((await repository.loadBlockedNoticeWorkflows(otherPerson, otherOrg)).map((row) => row.workflowId)).toEqual([foreignWorkflow])
      expect(await repository.countUnread(otherPerson, otherOrg, [foreignWorkflow])).toBe(1)
      expect(await repository.countUnread(otherPerson, ORG, [foreignWorkflow])).toBe(0)
      expect(await repository.loadBlockedNoticeDetails(ORG, [{ workflowId: foreignWorkflow, nodeId: "revisao" }])).toEqual([])
    })
  })

  describe("estados de leitura e resolução", () => {
    it("com permissão: não lido conta; lido e resolvido só aparecem; expirado some", async () => {
      const { personId, agent } = await viewer("Estados Com Permissão", ORG_ROLE)
      const workflowId = await workflowIn()
      const open = await notice(personId, workflowId, { status: "OPEN" })
      const acknowledged = await notice(personId, workflowId, { status: "ACKNOWLEDGED" })
      const read = await notice(personId, workflowId, { status: "SEEN", readAt: new Date().toISOString() })
      const resolved = await notice(personId, workflowId, { status: "RESOLVED" })
      const expired = await notice(personId, workflowId, { status: "EXPIRED" })
      const { unreadCount, items } = await bell(agent)
      expect(unreadCount).toBe(2)
      const shown = new Map(items.map((item) => [item.id, item]))
      expect(shown.has(open) && shown.has(acknowledged) && shown.has(read) && shown.has(resolved)).toBe(true)
      expect(shown.has(expired)).toBe(false)
      expect(shown.get(resolved)?.resolved).toBe(true)
      expect(shown.get(read)?.readAt).not.toBeNull()
    })

    it("sem permissão: nenhum estado aparece nem conta", async () => {
      const { personId, agent } = await viewer("Estados Sem Permissão")
      const workflowId = await workflowIn()
      for (const status of ["OPEN", "SEEN", "ACKNOWLEDGED", "RESOLVED", "EXPIRED"]) await notice(personId, workflowId, { status })
      const { unreadCount, items } = await bell(agent)
      expect(unreadCount).toBe(0)
      expect(items).toEqual([])
    })

    it("marcar como lido um aviso permitido baixa a contagem uma vez", async () => {
      const { personId, agent } = await viewer("Marca Permitido", ORG_ROLE)
      const alertId = await notice(personId, await workflowIn())
      expect((await bell(agent)).unreadCount).toBe(1)
      expect((await agent.post(`/api/v1/notifications/${alertId}/read`).send({})).status).toBe(204)
      expect((await bell(agent)).unreadCount).toBe(0)
    })

    it("os demais tipos seguem as regras de sempre, com ou sem permissão em Workflows", async () => {
      const { personId, agent } = await viewer("Outros Tipos Sem Permissão")
      await otherAlerts(personId, 2)
      await otherAlerts(personId, 1, { status: "SEEN", readAt: new Date().toISOString() })
      await otherAlerts(personId, 1, { status: "RESOLVED" })
      await otherAlerts(personId, 1, { status: "EXPIRED" })
      const { unreadCount, items } = await bell(agent)
      expect(unreadCount).toBe(2)
      expect(items).toHaveLength(4)
    })
  })

  describe("custo do badge", () => {
    const spying = () => {
      const returnedColumns = new Set<string>()
      const db = {
        query: async (...args: Parameters<ProofClient["query"]>) => {
          const result = await (client.query as (...params: unknown[]) => Promise<pg.QueryResult>)(...args)
          for (const field of result.fields ?? []) returnedColumns.add(field.name)
          return result
        },
      }
      return { db: db as never, returnedColumns }
    }

    it("quem não tem aviso desse tipo nem carrega os alcances", async () => {
      const personId = await createPerson(client, "Sem Aviso De Execução")
      await otherAlerts(personId, 3)
      const { db } = spying()
      const loadScopes = vi.fn(async () => getManageableScopes(client as never, { organizationId: ORG, sub: randomUUID() }, "workflows.manage"))
      const summary = await buildNotificationSummary(new PgNotificationsRepository(db), new PgPendingActionsRepository(db), { personId, organizationId: ORG }, loadScopes)
      expect(summary.unreadCount).toBe(3)
      expect(loadScopes).not.toHaveBeenCalled()
    })

    it("com aviso, nenhuma consulta devolve o grafo nem o histórico de avisos para calcular", async () => {
      const { personId, accountId } = await viewer("Com Avisos", ORG_ROLE)
      const workflowId = await workflowIn()
      for (let index = 0; index < 30; index += 1) await notice(personId, workflowId, { ageDays: index })
      await otherAlerts(personId, 3)
      const { db, returnedColumns } = spying()
      const repository = new PgNotificationsRepository(db)
      const loadScopes = vi.fn(async () => getManageableScopes(client as never, { organizationId: ORG, sub: accountId }, "workflows.manage"))
      const summary = await buildNotificationSummary(repository, new PgPendingActionsRepository(db), { personId, organizationId: ORG }, loadScopes)
      expect(summary.unreadCount).toBe(33)
      expect(summary.items).toHaveLength(NOTIFICATION_LIST_LIMIT)
      expect(loadScopes).toHaveBeenCalledTimes(1)
      expect(returnedColumns.has("graph")).toBe(false)
      expect(returnedColumns.has("draft_graph")).toBe(false)
      // Uma linha por workflow, não por aviso.
      expect(await repository.loadBlockedNoticeWorkflows(personId, ORG)).toHaveLength(1)
    })

    it("a consulta que roda para todos usa o índice só desse tipo de aviso", async () => {
      const personId = await createPerson(client, "Plano Da Consulta")
      await client.query("set local enable_seqscan = off")
      const plan = await client.query<{ "QUERY PLAN": string }>(
        `explain select a.id from alerts a where a.recipient_id = $1 and a.organization_id = $2 and a.alert_type = '${TYPE}' and a.status <> 'EXPIRED'`,
        [personId, ORG],
      )
      expect(plan.rows.map((row) => row["QUERY PLAN"]).join("\n")).toContain("idx_alerts_recipient_blocked_notice")
    })
  })
})
