/**
 * PROVA contra o banco de TESTE real — P5c (`docs/qa/workflows/propostas.md`): revisão humana sem revisor bloqueia com motivo, avisa
 * quem publicou e ainda tem acesso ao workflow (D1), não sobe na cadeia (D3) e aceita nova tentativa depois de corrigida a hierarquia.
 *
 * Escrita antes da implementação. ZERO chamada de modelo. Tudo numa transação desfeita no fim.
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run workflow-human-review-no-reviewer-proof
 */
import type pg from "pg"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { startWorkflowSimulation } from "../../qa-lab/application/workflow-simulation-service.js"
import { submitHumanReviewDecision } from "../application/submit-human-review-decision.js"
import { confirmWorkflowRetry, previewWorkflowRetry } from "../application/workflow-retry.js"
import {
  ORG,
  REVIEW_HANDLES,
  alertsByEnrollment,
  alertsOfType,
  closeProofTransaction,
  createAccount,
  createPerson,
  createTeam,
  endNode,
  enrollmentEvents,
  enrollmentState,
  flowEdge,
  flowNode,
  insertEnrollment,
  insertLiveWorkflow,
  loginAs,
  openProofTransaction,
  reviewNode,
  runEnrollmentOnce,
  singleStepGraph,
  triggerNode,
  type ProofClient,
} from "./p5-proof-helpers.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
const BLOCK_REASON = "HUMAN_REVIEW_NO_REVIEWER"
const NOTICE_TYPE = "WORKFLOW_EXECUTION_BLOCKED"
const COLLABORATOR_NAME = "Colaboradora Prova P5c"
const SUPERVISOR_ROLE_TARGET = { reviewTarget: { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" } }

describe.skipIf(!ENABLED)("P5c · revisão humana sem revisor (prova Postgres)", () => {
  let pool: pg.Pool
  let client: ProofClient
  let publisherId = ""
  let publisherEmail = ""

  beforeAll(async () => {
    ;({ pool, client } = await openProofTransaction())
    publisherId = await createPerson(client, "Quem Publicou Prova P5c")
    publisherEmail = (await createAccount(client, publisherId, [{ role: "ADMINISTRADOR_GERAL" }])).email
  })
  afterAll(async () => closeProofTransaction(pool, client))
  // Cada caso desfaz o que criou: os avisos são contados por pessoa, e um caso não pode contaminar o outro.
  beforeEach(async () => {
    await client.query("savepoint caso_p5c")
  })
  afterEach(async () => {
    await client.query("rollback to savepoint caso_p5c")
  })

  async function reviewWorkflow(config: Record<string, unknown>, name = "Prova P5c Revisão", options: { publisherId?: string | null; teamId?: string | null } = {}) {
    return insertLiveWorkflow(client, name, singleStepGraph(reviewNode(config), REVIEW_HANDLES), { publisherId, ...options })
  }

  async function expectBlocked(enrollmentId: string, cause: string) {
    const state = await enrollmentState(client, enrollmentId)
    expect(state).toMatchObject({ status: "blocked", blocked_reason: BLOCK_REASON, blocked_node_id: "revisao", attempts: 0 })
    expect(state.blocked_details).toMatchObject({ cause })
    // Não fica na espera até 2999, e o evento conta o motivo.
    expect(state.next_eval_year).toBeLessThan(2999)
    expect((await enrollmentEvents(client, enrollmentId)).filter((event) => event.event_type === "node_blocked").map((event) => event.payload.reason)).toEqual([BLOCK_REASON])
    // Nenhum aviso de revisão para ninguém.
    expect((await alertsByEnrollment(client, enrollmentId)).filter((alert) => alert.alert_type === "WORKFLOW_HUMAN_REVIEW")).toEqual([])
    // O motivo guardado não traz nome de pessoa.
    expect(JSON.stringify(state.blocked_details)).not.toContain(COLLABORATOR_NAME)
  }

  describe("bloqueia em cada caso sem revisor", () => {
    it("ninguém com o cargo acima do colaborador", async () => {
      const operator = await createPerson(client, COLLABORATOR_NAME)
      const enrollment = await insertEnrollment(client, await reviewWorkflow(SUPERVISOR_ROLE_TARGET), { nodeId: "revisao", subjectId: operator, nodeOutputs: { agente: { text: "Resultado já pago" } } })
      await runEnrollmentOnce(client, enrollment)
      await expectBlocked(enrollment, "NO_ONE_IN_CHAIN")
      // O que já foi produzido antes do bloqueio é mantido.
      expect((await enrollmentState(client, enrollment)).node_outputs).toEqual({ agente: { text: "Resultado já pago" } })
    })

    it("revisor do cargo inativo", async () => {
      const inactive = await createPerson(client, "Supervisão Inativa", { role: "SUPERVISOR", active: false })
      const operator = await createPerson(client, COLLABORATOR_NAME, { reportsToId: inactive })
      const enrollment = await insertEnrollment(client, await reviewWorkflow(SUPERVISOR_ROLE_TARGET), { nodeId: "revisao", subjectId: operator })
      await runEnrollmentOnce(client, enrollment)
      await expectBlocked(enrollment, "REVIEWER_INACTIVE")
    })

    it("D3: revisor inativo com outro do mesmo cargo acima não sobe na cadeia", async () => {
      const above = await createPerson(client, "Supervisão Acima", { role: "SUPERVISOR" })
      const inactive = await createPerson(client, "Supervisão Inativa", { role: "SUPERVISOR", active: false, reportsToId: above })
      const operator = await createPerson(client, COLLABORATOR_NAME, { reportsToId: inactive })
      const enrollment = await insertEnrollment(client, await reviewWorkflow(SUPERVISOR_ROLE_TARGET), { nodeId: "revisao", subjectId: operator })
      await runEnrollmentOnce(client, enrollment)
      await expectBlocked(enrollment, "REVIEWER_INACTIVE")
      expect(await alertsOfType(client, "WORKFLOW_HUMAN_REVIEW", above)).toEqual([])
    })

    it("pessoa específica que ficou inativa depois de publicar", async () => {
      const inactive = await createPerson(client, "Pessoa Inativa", { active: false })
      const operator = await createPerson(client, COLLABORATOR_NAME)
      const enrollment = await insertEnrollment(client, await reviewWorkflow({ reviewTarget: { type: "SPECIFIC_USER", userId: inactive } }), { nodeId: "revisao", subjectId: operator })
      await runEnrollmentOnce(client, enrollment)
      await expectBlocked(enrollment, "REVIEWER_INACTIVE")
    })

    it("revisor relativo sem decisão anterior: o ramo pulou a revisão", async () => {
      const operator = await createPerson(client, COLLABORATOR_NAME)
      const enrollment = await insertEnrollment(client, await reviewWorkflow({ reviewTarget: { type: "ROLE_OF_PREVIOUS_REVIEWER", role: "MANAGER", previousReviewNodeId: "revisao-anterior" } }), { nodeId: "revisao", subjectId: operator })
      await runEnrollmentOnce(client, enrollment)
      await expectBlocked(enrollment, "PREVIOUS_REVIEW_NOT_DECIDED")
    })

    it("só o próprio colaborador", async () => {
      const operator = await createPerson(client, COLLABORATOR_NAME)
      const enrollment = await insertEnrollment(client, await reviewWorkflow({ reviewTarget: { type: "SPECIFIC_USER", userId: operator } }), { nodeId: "revisao", subjectId: operator })
      await runEnrollmentOnce(client, enrollment)
      await expectBlocked(enrollment, "ONLY_THE_COLLABORATOR")
    })
  })

  describe("o que não muda (controles)", () => {
    it("controle: revisor ativo recebe o aviso, a execução espera e ninguém mais é avisado", async () => {
      const supervisor = await createPerson(client, "Supervisão Ativa", { role: "SUPERVISOR" })
      const operator = await createPerson(client, COLLABORATOR_NAME, { reportsToId: supervisor })
      const enrollment = await insertEnrollment(client, await reviewWorkflow(SUPERVISOR_ROLE_TARGET), { nodeId: "revisao", subjectId: operator })
      await runEnrollmentOnce(client, enrollment)
      expect((await enrollmentState(client, enrollment)).status).toBe("waiting")
      expect((await alertsByEnrollment(client, enrollment)).map((alert) => [alert.recipient_id, alert.alert_type])).toEqual([[supervisor, "WORKFLOW_HUMAN_REVIEW"]])
      expect(await alertsOfType(client, NOTICE_TYPE, publisherId)).toEqual([])
    })

    it("controle: execução que já estava esperando não é bloqueada depois", async () => {
      const operator = await createPerson(client, COLLABORATOR_NAME)
      const enrollment = await insertEnrollment(client, await reviewWorkflow(SUPERVISOR_ROLE_TARGET), { nodeId: "revisao", subjectId: operator, status: "waiting" })
      await runEnrollmentOnce(client, enrollment)
      expect((await enrollmentState(client, enrollment)).status).toBe("waiting")
      expect(await alertsByEnrollment(client, enrollment)).toEqual([])
    })

    it("controle: Escalonar sem ninguém na cadeia continua falhando com o motivo", async () => {
      const operator = await createPerson(client, COLLABORATOR_NAME)
      const escalate = flowNode("escalar", "action", "Escalonar", { actionType: "ESCALATE", target: { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" }, surfaces: ["NOTIFICATION"] })
      const enrollment = await insertEnrollment(client, await insertLiveWorkflow(client, "Prova P5c Escalonar", singleStepGraph(escalate)), { nodeId: "escalar", subjectId: operator })
      await runEnrollmentOnce(client, enrollment)
      expect((await enrollmentState(client, enrollment)).status).not.toBe("completed")
      expect((await enrollmentEvents(client, enrollment)).some((event) => String(event.payload.message).includes("destinatário"))).toBe(true)
    })

    it("Escalonar não avisa quem está inativo: o filtro é o mesmo da revisão", async () => {
      const inactive = await createPerson(client, "Supervisão Inativa", { role: "SUPERVISOR", active: false })
      const operator = await createPerson(client, COLLABORATOR_NAME, { reportsToId: inactive })
      const escalate = flowNode("escalar", "action", "Escalonar", { actionType: "ESCALATE", target: { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" }, surfaces: ["NOTIFICATION"] })
      const enrollment = await insertEnrollment(client, await insertLiveWorkflow(client, "Prova P5c Escalonar Inativo", singleStepGraph(escalate)), { nodeId: "escalar", subjectId: operator })
      await runEnrollmentOnce(client, enrollment)
      expect(await alertsOfType(client, "WORKFLOW_ESCALATION", inactive)).toEqual([])
      expect((await enrollmentState(client, enrollment)).status).not.toBe("completed")
    })
  })

  describe("D1: aviso a quem publicou a versão", () => {
    const blockOne = async (workflow: { workflowId: string; versionId: string }, subjectId?: string) => {
      const operator = subjectId ?? (await createPerson(client, COLLABORATOR_NAME))
      const enrollment = await insertEnrollment(client, workflow, { nodeId: "revisao", subjectId: operator })
      await runEnrollmentOnce(client, enrollment)
      return enrollment
    }

    it("um aviso por workflow, etapa e dia, mesmo com várias execuções bloqueadas", async () => {
      const workflow = await reviewWorkflow(SUPERVISOR_ROLE_TARGET)
      await blockOne(workflow)
      await blockOne(workflow)
      const notices = await alertsOfType(client, NOTICE_TYPE, publisherId)
      expect(notices).toHaveLength(1)
      expect(notices[0]!.dedupe_key).toMatch(new RegExp(`^workflow_execution_blocked:${workflow.workflowId}:revisao:\\d{4}-\\d{2}-\\d{2}$`))
    })

    it("a linha do aviso não guarda nome de colaborador, de workflow nem de etapa: isso só aparece na leitura, para quem pode ver", async () => {
      await blockOne(await reviewWorkflow(SUPERVISOR_ROLE_TARGET, "Nome Do Workflow Restrito"))
      const [notice] = await alertsOfType(client, NOTICE_TYPE, publisherId)
      const stored = `${notice!.title} ${notice!.description}`
      expect(stored).not.toContain(COLLABORATOR_NAME)
      expect(stored).not.toContain("Nome Do Workflow Restrito")
      expect(stored).not.toContain("Revisão da supervisão")
    })

    it("quem publicou recebe mesmo sendo o colaborador da execução, com o mesmo conteúdo mínimo", async () => {
      const enrollment = await blockOne(await reviewWorkflow(SUPERVISOR_ROLE_TARGET), publisherId)
      expect((await enrollmentState(client, enrollment)).status).toBe("blocked")
      const [notice] = await alertsOfType(client, NOTICE_TYPE, publisherId)
      expect(notice).toBeDefined()
      expect(`${notice!.title} ${notice!.description}`).not.toContain("Quem Publicou Prova P5c")
    })

    it("versão sem autor: bloqueia igual, sem aviso e sem erro", async () => {
      const enrollment = await blockOne(await reviewWorkflow(SUPERVISOR_ROLE_TARGET, "Prova P5c Sem Autor", { publisherId: null }))
      await expectBlocked(enrollment, "NO_ONE_IN_CHAIN")
      expect((await client.query("select 1 from alerts where alert_type = $1 and organization_id = $2 and dedupe_key like $3", [NOTICE_TYPE, ORG, "workflow_execution_blocked:%"])).rowCount).toBe(0)
    })

    it("autor inativo: bloqueia igual, sem aviso e sem escolher outra pessoa", async () => {
      const formerPublisher = await createPerson(client, "Publicou E Saiu", { active: false })
      const enrollment = await blockOne(await reviewWorkflow(SUPERVISOR_ROLE_TARGET, "Prova P5c Autor Inativo", { publisherId: formerPublisher }))
      await expectBlocked(enrollment, "NO_ONE_IN_CHAIN")
      expect(await alertsOfType(client, NOTICE_TYPE, formerPublisher)).toEqual([])
      expect(await alertsOfType(client, NOTICE_TYPE, publisherId)).toEqual([])
    })

    const myNotice = async (agent: Awaited<ReturnType<typeof loginAs>>) => {
      const response = await agent.get("/api/v1/notifications")
      expect(response.status).toBe(200)
      return (response.body.data.items as { title: string; description: string; target: Record<string, unknown>; operator: unknown; alertType?: string }[]).find((item) => item.target.type === "ADMIN_WORKFLOW_EXECUTIONS" || /bloquead/i.test(item.title))
    }

    it("no sino, com permissão atual: mostra workflow, etapa e motivo, leva a Execuções e não cita o colaborador", async () => {
      const workflow = await reviewWorkflow(SUPERVISOR_ROLE_TARGET, "Prova P5c No Sino")
      await blockOne(workflow)
      const item = await myNotice(await loginAs(client, publisherEmail))
      expect(item?.target).toEqual({ type: "ADMIN_WORKFLOW_EXECUTIONS", workflowId: workflow.workflowId })
      expect(`${item!.title} ${item!.description}`).toContain("Prova P5c No Sino")
      expect(`${item!.title} ${item!.description}`).toContain("Revisão da supervisão")
      expect(`${item!.title} ${item!.description}`).not.toContain(COLLABORATOR_NAME)
      expect(item!.operator).toBeNull()
    })

    it("quem publicou e não tem mais acesso a workflows não recebe o aviso, e a execução bloqueia igual", async () => {
      const formerAdmin = await createPerson(client, "Publicou E Perdeu Acesso")
      const { email } = await createAccount(client, formerAdmin)
      const enrollment = await blockOne(await reviewWorkflow(SUPERVISOR_ROLE_TARGET, "Prova P5c Sem Permissão", { publisherId: formerAdmin }))
      await expectBlocked(enrollment, "NO_ONE_IN_CHAIN")
      expect(await alertsOfType(client, NOTICE_TYPE, formerAdmin)).toEqual([])
      expect(await myNotice(await loginAs(client, email))).toBeUndefined()
    })

    it("quem publicou e só tem permissão em outro grupo também não recebe", async () => {
      const teamOfWorkflow = await createTeam(client, "Prova P5c Grupo Do Workflow")
      const otherTeam = await createTeam(client, "Prova P5c Outro Grupo")
      const scopedAdmin = await createPerson(client, "Publicou Em Outro Grupo")
      await createAccount(client, scopedAdmin, [{ role: "ADMINISTRADOR", scopeType: "GROUP", teamId: otherTeam }])
      await blockOne(await reviewWorkflow(SUPERVISOR_ROLE_TARGET, "Prova P5c Workflow Alheio", { publisherId: scopedAdmin, teamId: teamOfWorkflow }))
      expect(await alertsOfType(client, NOTICE_TYPE, scopedAdmin)).toEqual([])
    })

    it("quem publicou e está sem conta de acesso ativa não recebe", async () => {
      const noAccount = await createPerson(client, "Publicou Sem Conta")
      await blockOne(await reviewWorkflow(SUPERVISOR_ROLE_TARGET, "Prova P5c Sem Conta", { publisherId: noAccount }))
      expect(await alertsOfType(client, NOTICE_TYPE, noAccount)).toEqual([])
    })

    it("no sino, com permissão no grupo do workflow: leva a Execuções", async () => {
      const team = await createTeam(client, "Prova P5c Mesmo Grupo")
      const scopedAdmin = await createPerson(client, "Publicou No Mesmo Grupo")
      const { email } = await createAccount(client, scopedAdmin, [{ role: "ADMINISTRADOR", scopeType: "GROUP", teamId: team }])
      const workflow = await reviewWorkflow(SUPERVISOR_ROLE_TARGET, "Prova P5c Grupo Certo", { publisherId: scopedAdmin, teamId: team })
      await blockOne(workflow)
      expect((await myNotice(await loginAs(client, email)))?.target).toEqual({ type: "ADMIN_WORKFLOW_EXECUTIONS", workflowId: workflow.workflowId })
    })

    it("a perda de permissão vale na leitura: o aviso já criado some do sino e da contagem de não lidos", async () => {
      const admin = await createPerson(client, "Tinha Acesso Ao Publicar")
      const { accountId, email } = await createAccount(client, admin, [{ role: "ADMINISTRADOR_GERAL" }])
      const workflow = await reviewWorkflow(SUPERVISOR_ROLE_TARGET, "Prova P5c Permissão Revogada", { publisherId: admin })
      await blockOne(workflow)
      const agent = await loginAs(client, email)
      expect((await myNotice(agent))?.target).toEqual({ type: "ADMIN_WORKFLOW_EXECUTIONS", workflowId: workflow.workflowId })
      const unreadBefore = (await agent.get("/api/v1/notifications")).body.data.unreadCount as number
      await client.query("update access_role_assignments set revoked_at = now() where user_account_id = $1", [accountId])
      const after = await loginAs(client, email)
      expect(await myNotice(after)).toBeUndefined()
      expect((await after.get("/api/v1/notifications")).body.data.unreadCount).toBe(unreadBefore - 1)
      expect(JSON.stringify((await after.get("/api/v1/notifications")).body)).not.toContain("Prova P5c Permissão Revogada")
    })

    it("controle: o destino recusa quem não tem permissão, com ou sem aviso", async () => {
      const outsider = await createPerson(client, "Sem Acesso A Workflows")
      const { email } = await createAccount(client, outsider)
      const workflow = await reviewWorkflow(SUPERVISOR_ROLE_TARGET)
      const response = await (await loginAs(client, email)).get(`/api/v1/admin/workflows/${workflow.workflowId}/enrollments`)
      expect([403, 404]).toContain(response.status)
    })

    it("o aviso não vira pendência: nem na lista, nem na contagem do sino", async () => {
      const agent = await loginAs(client, publisherEmail)
      const before = (await agent.get("/api/v1/notifications")).body.data.pendingActionCount as number
      await blockOne(await reviewWorkflow(SUPERVISOR_ROLE_TARGET, "Prova P5c Pendência"))
      expect(await alertsOfType(client, NOTICE_TYPE, publisherId)).toHaveLength(1)
      expect((await agent.get("/api/v1/notifications")).body.data.pendingActionCount).toBe(before)
      const pending = await agent.get("/api/v1/pending-actions")
      expect(pending.status).toBe(200)
      expect(JSON.stringify(pending.body)).not.toContain("Prova P5c Pendência")
    })

    it("o aviso não entra no Acompanhamento: é só do sino, e os outros avisos continuam lá", async () => {
      // O feed só traz avisos na estrutura da própria pessoa: quem publica aqui também é supervisor.
      const supervisorPublisher = await createPerson(client, "Supervisão Que Publica", { role: "SUPERVISOR" })
      const { email } = await createAccount(client, supervisorPublisher, [{ role: "ADMINISTRADOR_GERAL" }])
      await blockOne(await reviewWorkflow(SUPERVISOR_ROLE_TARGET, "Prova P5c Acompanhamento", { publisherId: supervisorPublisher }))
      expect(await alertsOfType(client, NOTICE_TYPE, supervisorPublisher)).toHaveLength(1)
      await client.query("insert into alerts (organization_id, recipient_id, title, description, severity, alert_type, dedupe_key) values ($1, $2, 'Controle do Acompanhamento', 'Outro aviso.', 'MEDIUM', 'WORKFLOW_OUTPUT', $3)", [ORG, supervisorPublisher, `prova-p5c-${Date.now()}`])
      const feed = await (await loginAs(client, email)).get(`/api/v1/analytics/follow-ups?subjectKind=SUPERVISOR_TEAM&subjectId=${supervisorPublisher}`)
      expect(feed.status, JSON.stringify(feed.body)).toBe(200)
      const items = JSON.stringify(feed.body.data)
      expect(items).toContain("Controle do Acompanhamento")
      expect(items).not.toContain("WORKFLOW_EXECUTION_BLOCKED")
      expect(items).not.toContain("Execução de workflow bloqueada")
    })
  })

  describe("nova tentativa", () => {
    it("ainda sem revisor: a prévia mostra o impedimento, e confirmar é recusado", async () => {
      const operator = await createPerson(client, COLLABORATOR_NAME)
      const enrollment = await insertEnrollment(client, await reviewWorkflow(SUPERVISOR_ROLE_TARGET), { nodeId: "revisao", subjectId: operator })
      await runEnrollmentOnce(client, enrollment)
      expect((await enrollmentState(client, enrollment)).status).toBe("blocked")
      const preview = await previewWorkflowRetry(client as never, ORG, enrollment)
      expect(preview.blockers.map((blocker) => blocker.code)).toContain("WORKFLOW_RETRY_REVIEWER_MISSING")
      await expect(confirmWorkflowRetry(client as never, ORG, enrollment, { fingerprint: preview.fingerprint }, { personId: null, name: "Prova" })).rejects.toMatchObject({ code: "WORKFLOW_RETRY_REVIEWER_MISSING" })
    })

    it("corrigida a hierarquia: continua da revisão, avisa o revisor, e a decisão termina o fluxo", async () => {
      const operator = await createPerson(client, COLLABORATOR_NAME)
      const enrollment = await insertEnrollment(client, await reviewWorkflow(SUPERVISOR_ROLE_TARGET), { nodeId: "revisao", subjectId: operator, nodeOutputs: { agente: { text: "Resultado já pago" } } })
      await runEnrollmentOnce(client, enrollment)
      expect((await enrollmentState(client, enrollment)).status).toBe("blocked")

      // Corrigir a hierarquia não cria tentativa sozinho.
      const supervisor = await createPerson(client, "Supervisão Corrigida", { role: "SUPERVISOR" })
      await client.query("update people set reports_to_id = $2 where id = $1", [operator, supervisor])
      expect((await client.query("select 1 from workflow_enrollments where retry_of_enrollment_id = $1", [enrollment])).rowCount).toBe(0)

      const preview = await previewWorkflowRetry(client as never, ORG, enrollment)
      expect(preview).toMatchObject({ blockers: [], startsAt: "BLOCKED_STEP" })
      const retry = await confirmWorkflowRetry(client as never, ORG, enrollment, { fingerprint: preview.fingerprint }, { personId: null, name: "Prova" })
      await runEnrollmentOnce(client, retry.enrollmentId)

      const waiting = await enrollmentState(client, retry.enrollmentId)
      expect(waiting).toMatchObject({ status: "waiting", current_node_id: "revisao" })
      expect(waiting.node_outputs).toMatchObject({ agente: { text: "Resultado já pago" } })
      expect((await alertsByEnrollment(client, retry.enrollmentId)).map((alert) => alert.recipient_id)).toEqual([supervisor])
      expect((await enrollmentState(client, enrollment)).status).toBe("blocked")

      await submitHumanReviewDecision(client as never, { enrollmentId: retry.enrollmentId, nodeId: "revisao", decision: "approved", reviewerId: supervisor })
      await runEnrollmentOnce(client, retry.enrollmentId)
      await runEnrollmentOnce(client, retry.enrollmentId)
      expect((await enrollmentState(client, retry.enrollmentId)).status).toBe("completed")
    })
  })

  describe("nova tentativa em versão diferente da bloqueada", () => {
    async function publishNewVersion(workflow: { workflowId: string }, graph: unknown) {
      const versionId = (await client.query<{ id: string }>("insert into workflow_versions (workflow_id, graph, created_by, trigger_config, scope_type, created_at) select id, $2, $3, trigger_config, scope_type, now() + interval '1 second' from workflows where id = $1 returning id", [workflow.workflowId, JSON.stringify(graph), publisherId])).rows[0]!.id
      await client.query("update workflows set active_version_id = $2 where id = $1", [workflow.workflowId, versionId])
      return versionId
    }

    it("recomeça do gatilho, e a prévia avisa se a etapa continua sem revisor", async () => {
      const operator = await createPerson(client, COLLABORATOR_NAME)
      const workflow = await reviewWorkflow(SUPERVISOR_ROLE_TARGET, "Prova P5c Versão Nova")
      const enrollment = await insertEnrollment(client, workflow, { nodeId: "revisao", subjectId: operator })
      await runEnrollmentOnce(client, enrollment)
      expect((await enrollmentState(client, enrollment)).status).toBe("blocked")

      const newVersion = await publishNewVersion(workflow, singleStepGraph(reviewNode(SUPERVISOR_ROLE_TARGET), REVIEW_HANDLES))
      const stillMissing = await previewWorkflowRetry(client as never, ORG, enrollment)
      expect(stillMissing).toMatchObject({ startsAt: "TRIGGER", workflowVersion: { id: newVersion } })
      expect(stillMissing.blockers.map((blocker) => blocker.code)).toContain("WORKFLOW_RETRY_REVIEWER_MISSING")

      const supervisor = await createPerson(client, "Supervisão Corrigida", { role: "SUPERVISOR" })
      await client.query("update people set reports_to_id = $2 where id = $1", [operator, supervisor])
      const preview = await previewWorkflowRetry(client as never, ORG, enrollment)
      expect(preview.blockers).toEqual([])
      const retry = await confirmWorkflowRetry(client as never, ORG, enrollment, { fingerprint: preview.fingerprint }, { personId: null, name: "Prova" })
      expect((await client.query("select current_node_id, version_id from workflow_enrollments where id = $1", [retry.enrollmentId])).rows[0]).toEqual({ current_node_id: "trigger", version_id: newVersion })
    })

    it("a versão nova que tirou a revisão não tem o que conferir: a tentativa segue", async () => {
      const operator = await createPerson(client, COLLABORATOR_NAME)
      const workflow = await reviewWorkflow(SUPERVISOR_ROLE_TARGET, "Prova P5c Sem Revisão")
      const enrollment = await insertEnrollment(client, workflow, { nodeId: "revisao", subjectId: operator })
      await runEnrollmentOnce(client, enrollment)
      await publishNewVersion(workflow, singleStepGraph(flowNode("espera", "wait", "Aguardar", { durationMs: 1000 })))
      expect((await previewWorkflowRetry(client as never, ORG, enrollment)).blockers).toEqual([])
    })

    it("conteúdo ausente: na mesma versão a prévia mostra o impedimento; numa versão corrigida, a tentativa segue", async () => {
      const supervisor = await createPerson(client, "Supervisão Ativa", { role: "SUPERVISOR" })
      const operator = await createPerson(client, COLLABORATOR_NAME, { reportsToId: supervisor })
      const workflow = await reviewWorkflow({ ...SUPERVISOR_ROLE_TARGET, contentSource: "nodeOutputs.sumiu" }, "Prova P5c Conteúdo")
      const enrollment = await insertEnrollment(client, workflow, { nodeId: "revisao", subjectId: operator })
      await runEnrollmentOnce(client, enrollment)
      expect((await enrollmentState(client, enrollment)).blocked_reason).toBe("HUMAN_REVIEW_CONTENT_MISSING")
      expect((await previewWorkflowRetry(client as never, ORG, enrollment)).blockers.map((blocker) => blocker.code)).toContain("WORKFLOW_RETRY_CONTENT_MISSING")
      await publishNewVersion(workflow, singleStepGraph(reviewNode(SUPERVISOR_ROLE_TARGET), REVIEW_HANDLES))
      expect((await previewWorkflowRetry(client as never, ORG, enrollment)).blockers).toEqual([])
    })
  })

  describe("filhas de 'Selecionar colaboradores'", () => {
    const SELECT_CONFIG = { selectionMode: "CONDITION", criterion: { comparator: "GTE", thresholdNumeric: 1, thresholdBoolean: null, historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "TMA", aggregation: "COUNT", comparator: "LT", indicatorThreshold: 0, period: { kind: "ROLLING_DAYS", days: 7 } } } }
    const fanOutGraph = () => ({
      nodes: [
        triggerNode,
        flowNode("selecionar", "select_employees", "Selecionar", SELECT_CONFIG),
        flowNode("aplicar", "apply_individually", "Aplicar", {}),
        reviewNode(SUPERVISOR_ROLE_TARGET),
        flowNode("juntar", "consolidate_results", "Consolidar", {}),
        endNode,
      ],
      edges: [
        flowEdge("trigger", "always", "selecionar"),
        flowEdge("selecionar", "always", "aplicar"),
        flowEdge("aplicar", "always", "revisao"),
        flowEdge("revisao", "approved", "juntar"),
        flowEdge("revisao", "rejected", "juntar"),
        flowEdge("revisao", "escalated", "juntar"),
        flowEdge("juntar", "always", "end"),
      ],
    })

    async function parentWaitingAtJoin(workflow: { workflowId: string; versionId: string }, subjectId: string, childCount: number) {
      const parent = await insertEnrollment(client, workflow, { nodeId: "juntar", subjectId, nodeOutputs: { aplicar: { kind: "FAN_OUT_COMPLETED", childCount, memberIds: [], fanOutNodeId: "aplicar", completedAt: new Date().toISOString() } } })
      return parent
    }

    async function childAt(workflow: { workflowId: string; versionId: string }, parentId: string, subjectId: string, status: "active" | "completed") {
      const child = await insertEnrollment(client, workflow, { nodeId: status === "completed" ? "juntar" : "revisao", subjectId })
      await client.query("update workflow_enrollments set parent_enrollment_id = $2, fan_out_node_id = 'aplicar', status = $3 where id = $1", [child, parentId, status])
      return child
    }

    it("Consolidar resultados conta a filha bloqueada na revisão como resultado que não chegou, com o motivo", async () => {
      const supervisor = await createPerson(client, "Supervisão Ativa", { role: "SUPERVISOR" })
      const withReviewer = await createPerson(client, "Colaboradora Com Revisor", { reportsToId: supervisor })
      const withoutReviewer = await createPerson(client, COLLABORATOR_NAME)
      const workflow = await insertLiveWorkflow(client, "Prova P5c Consolidado", fanOutGraph(), { publisherId })
      const parent = await parentWaitingAtJoin(workflow, withReviewer, 2)
      await childAt(workflow, parent, withReviewer, "completed")
      const blockedChild = await childAt(workflow, parent, withoutReviewer, "active")
      await runEnrollmentOnce(client, blockedChild)
      await expectBlocked(blockedChild, "NO_ONE_IN_CHAIN")

      await runEnrollmentOnce(client, parent)
      const state = await enrollmentState(client, parent)
      expect(state.current_node_id).toBe("end")
      expect(state.node_outputs.juntar).toMatchObject({ kind: "EMPLOYEE_FAN_IN", expectedCount: 2, completedCount: 1, failedCount: 1 })
      const failed = (state.node_outputs.juntar as { children: { status: string; failureReason: string | null }[] }).children.find((item) => item.status !== "COMPLETED" && item.status !== "completed")
      expect(failed?.failureReason).toContain("hierarquia")
    })

    it("filha bloqueada na revisão: na mesma versão continua da revisão; em versão nova, recomeça como uma filha nasce", async () => {
      const operator = await createPerson(client, COLLABORATOR_NAME)
      const workflow = await insertLiveWorkflow(client, "Prova P5c Filha", fanOutGraph(), { publisherId })
      const parent = await parentWaitingAtJoin(workflow, operator, 1)
      const child = await childAt(workflow, parent, operator, "active")
      await runEnrollmentOnce(client, child)
      await expectBlocked(child, "NO_ONE_IN_CHAIN")

      const supervisor = await createPerson(client, "Supervisão Corrigida", { role: "SUPERVISOR" })
      await client.query("update people set reports_to_id = $2 where id = $1", [operator, supervisor])
      const sameVersion = await previewWorkflowRetry(client as never, ORG, child)
      expect(sameVersion).toMatchObject({ blockers: [], startsAt: "BLOCKED_STEP", fanOut: { parentEnrollmentId: parent } })

      const newVersion = (await client.query<{ id: string }>("insert into workflow_versions (workflow_id, graph, created_by, trigger_config, scope_type, created_at) select id, $2, $3, trigger_config, scope_type, now() + interval '1 second' from workflows where id = $1 returning id", [workflow.workflowId, JSON.stringify(fanOutGraph()), publisherId])).rows[0]!.id
      await client.query("update workflows set active_version_id = $2 where id = $1", [workflow.workflowId, newVersion])
      const preview = await previewWorkflowRetry(client as never, ORG, child)
      expect(preview).toMatchObject({ blockers: [], startsAt: "AFTER_FAN_OUT", fanOut: { parentEnrollmentId: parent } })
      const retry = await confirmWorkflowRetry(client as never, ORG, child, { fingerprint: preview.fingerprint }, { personId: null, name: "Prova" })
      expect((await client.query("select current_node_id, parent_enrollment_id, fan_out_node_id, version_id from workflow_enrollments where id = $1", [retry.enrollmentId])).rows[0]).toEqual({ current_node_id: "revisao", parent_enrollment_id: parent, fan_out_node_id: "aplicar", version_id: newVersion })
    })
  })

  describe("QA Lab", () => {
    it("a simulação mostra 'sem revisor' em vez de pausar em revisão, e o aviso é só um efeito simulado", async () => {
      const operator = await createPerson(client, COLLABORATOR_NAME)
      const { workflowId } = await reviewWorkflow(SUPERVISOR_ROLE_TARGET, "Prova P5c QA Lab")
      const run = await startWorkflowSimulation(client as never, ORG, { workflowId, graphSource: "PUBLISHED", subject: { kind: "operator", operatorId: operator }, mode: "RUN_ALL", aiPolicy: "STOP_BEFORE_AI" } as never, publisherId)
      expect(run.status).toBe("FAILED")
      const step = run.trace.steps.find((item) => item.nodeId === "revisao")
      expect(step?.status).toBe("failed")
      expect(step?.error).toMatch(/sem revisor/i)
      expect(run.trace.pendingReview).toBeNull()
      const notices = run.trace.effects.filter((effect) => effect.kind === "ALERT" && effect.alertType === NOTICE_TYPE)
      expect(notices).toHaveLength(1)
      expect(await alertsOfType(client, NOTICE_TYPE, publisherId)).toEqual([])
    })
  })

  describe("lista de workflows", () => {
    it("mostra a contagem de bloqueadas, sem somar em 'em execução'", async () => {
      const workflow = await reviewWorkflow(SUPERVISOR_ROLE_TARGET, "Prova P5c Contagem")
      const operator = await createPerson(client, COLLABORATOR_NAME)
      await runEnrollmentOnce(client, await insertEnrollment(client, workflow, { nodeId: "revisao", subjectId: operator }))
      const response = await (await loginAs(client, publisherEmail)).get(`/api/v1/admin/workflows/${workflow.workflowId}`)
      expect(response.status).toBe(200)
      expect(response.body.data).toMatchObject({ blockedEnrollments: 1, activeEnrollments: 0 })
    })
  })

})
