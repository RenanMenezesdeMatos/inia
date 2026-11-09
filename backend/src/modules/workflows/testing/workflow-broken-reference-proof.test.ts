/**
 * PROVA contra o banco de TESTE real — P5b e WF-41 (`docs/qa/workflows/propostas.md`): referência quebrada não publica, conteúdo
 * ausente nunca vira entrega vazia, nem em versão publicada antes da regra (D2), e a origem em variável entrega o valor, no tipo dele.
 *
 * Escrita antes da implementação. ZERO chamada de modelo: o agente só é criado e publicado, nunca executado. Tudo numa transação
 * desfeita no fim.
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run workflow-broken-reference-proof
 */
import type pg from "pg"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { startWorkflowSimulation } from "../../qa-lab/application/workflow-simulation-service.js"
import {
  ORG,
  REVIEW_HANDLES,
  alertsByEnrollment,
  alertsOfType,
  closeProofTransaction,
  createAccount,
  createPerson,
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
const VARIABLE_ID = "0a7a0000-0000-4000-8000-0000000000d1"
const CONTENT = "Conteúdo real da análise"

describe.skipIf(!ENABLED)("P5b · referência quebrada e conteúdo ausente (prova Postgres)", () => {
  let pool: pg.Pool
  let client: ProofClient
  let adminEmail = ""

  beforeAll(async () => {
    ;({ pool, client } = await openProofTransaction())
    const admin = await createPerson(client, "Admin Prova P5b")
    adminEmail = (await createAccount(client, admin, [{ role: "ADMINISTRADOR_GERAL" }])).email
  })
  afterAll(async () => closeProofTransaction(pool, client))
  beforeEach(async () => {
    await client.query("savepoint caso_p5b")
  })
  afterEach(async () => {
    await client.query("rollback to savepoint caso_p5b")
  })

  describe("publicar e dry-run", () => {
    const base = "/api/v1/admin/workflows"
    const outputTo = (id: string, source: string) => flowNode(id, "output", "Entrega", { target: { type: "SUPERVISOR_OF_OPERATOR" }, surfaces: ["NOTIFICATION"], source })

    async function draftWith(graph: (agentId: string) => unknown) {
      const admin = await loginAs(client, adminEmail)
      const agent = await admin.post("/api/v1/admin/agents").send({ name: `Prova P5b Agente ${Date.now()}`, agentType: "CUSTOM", objective: "Objetivo da prova da P5b.", description: "Agente da prova; nunca executado.", contextPrompt: "Contexto da prova da P5b.", scopeType: "ALL_TEAMS" })
      expect(agent.status, JSON.stringify(agent.body)).toBe(201)
      const agentId = agent.body.data.id as string
      expect((await admin.post(`/api/v1/admin/agents/${agentId}/publish`).send({})).status).toBe(201)
      const created = await admin.post(base).send({ name: `Prova P5b ${Date.now()}`, scopeType: "ALL_TEAMS", trigger: { kind: "manual", context: "INTERACTION" } })
      expect(created.status, JSON.stringify(created.body)).toBe(201)
      const workflowId = created.body.data.id as string
      expect((await admin.put(`${base}/${workflowId}/draft`).send({ graph: graph(agentId) })).status).toBe(200)
      return { admin, workflowId }
    }

    const agentNode = (agentId: string) => flowNode("agente", "action", "Analisar", { actionType: "CALL_AGENT", agentId })
    const versionCount = async (workflowId: string) => (await client.query<{ n: number }>("select count(*)::int n from workflow_versions where workflow_id = $1", [workflowId])).rows[0]!.n

    async function expectRefused(graph: (agentId: string) => unknown, code: string, nodeId: string) {
      const { admin, workflowId } = await draftWith(graph)
      const dryRun = await admin.post(`${base}/${workflowId}/validate`).send({})
      expect(dryRun.body.data).toMatchObject({ valid: false, error: { code, nodeId } })
      const publish = await admin.post(`${base}/${workflowId}/publish`).send({})
      expect(publish.status).toBe(422)
      expect(publish.body.error).toMatchObject({ code, details: { nodeId } })
      expect(await versionCount(workflowId)).toBe(0)
    }

    it("controle: fluxo com a origem certa publica", async () => {
      const { admin, workflowId } = await draftWith((agentId) => ({
        nodes: [triggerNode, agentNode(agentId), outputTo("entrega", "nodeOutputs.agente"), endNode],
        edges: [flowEdge("trigger", "always", "agente"), flowEdge("agente", "always", "entrega"), flowEdge("entrega", "always", "end")],
      }))
      expect((await admin.post(`${base}/${workflowId}/validate`).send({})).body.data).toEqual({ valid: true, error: null })
    })

    it("Output com origem que não existe é recusado, com a etapa", async () => {
      await expectRefused((agentId) => ({
        nodes: [triggerNode, agentNode(agentId), outputTo("boa", "nodeOutputs.agente"), outputTo("quebrada", "nodeOutputs.sumiu"), endNode],
        edges: [flowEdge("trigger", "always", "agente"), flowEdge("agente", "always", "boa"), flowEdge("boa", "always", "quebrada"), flowEdge("quebrada", "always", "end")],
      }), "WORKFLOW_INVALID_OUTPUT", "quebrada")
    })

    it("Output com origem que vem depois dele é recusado, com a etapa", async () => {
      await expectRefused((agentId) => ({
        nodes: [triggerNode, outputTo("cedo", "nodeOutputs.agente"), agentNode(agentId), outputTo("boa", "nodeOutputs.agente"), endNode],
        edges: [flowEdge("trigger", "always", "cedo"), flowEdge("cedo", "always", "agente"), flowEdge("agente", "always", "boa"), flowEdge("boa", "always", "end")],
      }), "WORKFLOW_INVALID_OUTPUT", "cedo")
    })

    it("Revisão com conteúdo de etapa que não existe é recusada, com a etapa", async () => {
      await expectRefused((agentId) => ({
        nodes: [triggerNode, agentNode(agentId), reviewNode({ reviewTarget: { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" }, contentSource: "nodeOutputs.sumiu" }), outputTo("boa", "nodeOutputs.agente"), endNode],
        edges: [flowEdge("trigger", "always", "agente"), flowEdge("agente", "always", "revisao"), flowEdge("revisao", "approved", "boa"), flowEdge("revisao", "rejected", "end"), flowEdge("revisao", "escalated", "end"), flowEdge("boa", "always", "end")],
      }), "WORKFLOW_INVALID_HUMAN_REVIEW", "revisao")
    })

    it("Condição com origem que não existe é recusada, com a etapa", async () => {
      await expectRefused((agentId) => ({
        nodes: [triggerNode, agentNode(agentId), flowNode("condicao", "condition", "Condição", { comparator: "GT", thresholdNumeric: 3, sourcePath: "nodeOutputs.sumiu" }), outputTo("boa", "nodeOutputs.agente"), endNode],
        edges: [flowEdge("trigger", "always", "agente"), flowEdge("agente", "always", "condicao"), flowEdge("condicao", "true", "boa"), flowEdge("condicao", "false", "end"), flowEdge("boa", "always", "end")],
      }), "WORKFLOW_INVALID_CONDITION", "condicao")
    })
  })

  describe("ao rodar uma versão já publicada", () => {
    const people = async () => {
      const supervisor = await createPerson(client, "Supervisão Prova P5b", { role: "SUPERVISOR" })
      const operator = await createPerson(client, "Colaboradora Prova P5b", { reportsToId: supervisor })
      return { supervisor, operator }
    }
    const notification = (source: string) => flowNode("entrega", "output", "Entrega", { target: { type: "SUPERVISOR_OF_OPERATOR" }, surfaces: ["NOTIFICATION"], source })
    const escalation = (contentSource?: string) => flowNode("escalar", "action", "Escalonar", { actionType: "ESCALATE", target: { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" }, surfaces: ["NOTIFICATION"], ...(contentSource ? { contentSource } : {}) })
    const review = (contentSource?: string) => reviewNode({ reviewTarget: { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" }, ...(contentSource ? { contentSource } : {}) })
    const stopsWithReason = async (enrollment: string) => {
      const state = await enrollmentState(client, enrollment)
      expect(state.status).toBe("dead")
      const finished = (await enrollmentEvents(client, enrollment)).find((event) => event.event_type === "flow_dead")
      expect(String(finished?.payload.message)).toMatch(/conteúdo|origem/i)
      expect(finished?.payload.errorCategory).toBe("APPLICATION_INVARIANT_VIOLATION")
    }

    it("controle: Output com a origem presente entrega o conteúdo", async () => {
      const { supervisor, operator } = await people()
      const enrollment = await insertEnrollment(client, await insertLiveWorkflow(client, "Prova P5b Output", singleStepGraph(notification("nodeOutputs.agente"))), { nodeId: "entrega", subjectId: operator, nodeOutputs: { agente: { text: CONTENT, orchestratorName: "Orquestrador" } } })
      await runEnrollmentOnce(client, enrollment)
      const alerts = await alertsOfType(client, "WORKFLOW_OUTPUT", supervisor)
      expect(alerts).toHaveLength(1)
      expect(alerts[0]!.description).toContain(CONTENT)
    })

    it("D2: Output sem a origem para com motivo, em vez de entregar aviso vazio", async () => {
      const { supervisor, operator } = await people()
      const enrollment = await insertEnrollment(client, await insertLiveWorkflow(client, "Prova P5b Output Vazio", singleStepGraph(notification("nodeOutputs.sumiu"))), { nodeId: "entrega", subjectId: operator })
      await runEnrollmentOnce(client, enrollment)
      expect(await alertsOfType(client, "WORKFLOW_OUTPUT", supervisor)).toEqual([])
      await stopsWithReason(enrollment)
    })

    it("Output com origem em variável entrega o valor: a tela oferece essa origem", async () => {
      const { supervisor, operator } = await people()
      const enrollment = await insertEnrollment(client, await insertLiveWorkflow(client, "Prova P5b Output Variável", singleStepGraph(notification(`variables.${VARIABLE_ID}`))), { nodeId: "entrega", subjectId: operator, variables: { [VARIABLE_ID]: "Valor da variável" } })
      await runEnrollmentOnce(client, enrollment)
      const alerts = await alertsOfType(client, "WORKFLOW_OUTPUT", supervisor)
      expect(alerts).toHaveLength(1)
      expect(alerts[0]!.description).toContain("Valor da variável")
    })

    it.each([
      ["número zero", 0, "0"],
      ["número com casas decimais", 1234.5, "1.234,5"],
      ["falso", false, "Não"],
      ["verdadeiro", true, "Sim"],
    ])("WF-41: variável com %s entrega o valor no formato do tipo, e nunca conta como ausente", async (_name, value, expected) => {
      const { supervisor, operator } = await people()
      const enrollment = await insertEnrollment(client, await insertLiveWorkflow(client, "Prova P5b Output Tipo", singleStepGraph(notification(`variables.${VARIABLE_ID}`))), { nodeId: "entrega", subjectId: operator, variables: { [VARIABLE_ID]: value } })
      await runEnrollmentOnce(client, enrollment)
      const [alert] = await alertsOfType(client, "WORKFLOW_OUTPUT", supervisor)
      expect(alert?.description).toBe(expected)
    })

    it("campo de texto escolhido do resultado estruturado também chega: tinha o mesmo defeito da variável", async () => {
      const { supervisor, operator } = await people()
      const enrollment = await insertEnrollment(client, await insertLiveWorkflow(client, "Prova P5b Campo", singleStepGraph(notification("nodeOutputs.orq.structuredResult.resumo"))), { nodeId: "entrega", subjectId: operator, nodeOutputs: { orq: { text: "Texto inteiro", orchestratorName: "Orquestrador", structuredResult: { resumo: "Só o campo escolhido" } } } })
      await runEnrollmentOnce(client, enrollment)
      const [alert] = await alertsOfType(client, "WORKFLOW_OUTPUT", supervisor)
      expect(alert?.description).toBe("Só o campo escolhido")
    })

    it.each([
      ["sem valor", {}],
      ["com texto em branco", { [VARIABLE_ID]: "   " }],
    ])("D2: variável %s para com o motivo, sem entregar nada", async (_name, variables) => {
      const { supervisor, operator } = await people()
      const enrollment = await insertEnrollment(client, await insertLiveWorkflow(client, "Prova P5b Variável Sem Valor", singleStepGraph(notification(`variables.${VARIABLE_ID}`))), { nodeId: "entrega", subjectId: operator, variables })
      await runEnrollmentOnce(client, enrollment)
      expect(await alertsOfType(client, "WORKFLOW_OUTPUT", supervisor)).toEqual([])
      await stopsWithReason(enrollment)
      const finished = (await enrollmentEvents(client, enrollment)).find((event) => event.event_type === "flow_dead")
      expect(String(finished?.payload.message)).toContain("variável")
    })

    it("WF-41: Chat do próprio colaborador recebe o valor da variável", async () => {
      const { operator } = await people()
      const chat = flowNode("entrega", "output", "Recado", { target: { type: "CURRENT_OPERATOR" }, surfaces: ["CHAT"], source: `variables.${VARIABLE_ID}` })
      const enrollment = await insertEnrollment(client, await insertLiveWorkflow(client, "Prova P5b Chat Variável", singleStepGraph(chat)), { nodeId: "entrega", subjectId: operator, variables: { [VARIABLE_ID]: "Valor da variável" } })
      await runEnrollmentOnce(client, enrollment)
      const state = await enrollmentState(client, enrollment)
      expect(state.status).not.toBe("dead")
      const conversationIds = (state.node_outputs.entrega as { conversationIds?: string[] } | undefined)?.conversationIds ?? []
      expect(conversationIds).toHaveLength(1)
      const stored = await client.query("select 1 from assistant_interactions where conversation_id = $1 and content like $2", [conversationIds[0], "%Valor da variável%"])
      expect(stored.rowCount).toBeGreaterThan(0)
    })

    it("WF-41: quem revisa vê o valor da variável também no detalhe de Pendências", async () => {
      const { supervisor, operator } = await people()
      const { email } = await createAccount(client, supervisor)
      const enrollment = await insertEnrollment(client, await insertLiveWorkflow(client, "Prova P5b Pendência Variável", singleStepGraph(review(`variables.${VARIABLE_ID}`), REVIEW_HANDLES)), { nodeId: "revisao", subjectId: operator, variables: { [VARIABLE_ID]: "Valor da variável" } })
      await runEnrollmentOnce(client, enrollment)
      const detail = await (await loginAs(client, email)).get(`/api/v1/pending-actions/human-reviews/${enrollment}/revisao`)
      expect(detail.status, JSON.stringify(detail.body)).toBe(200)
      expect(detail.body.data.content).toContain("Valor da variável")
    })

    it("controle: Escalonar sem conteúdo configurado continua escalando", async () => {
      const { supervisor, operator } = await people()
      const enrollment = await insertEnrollment(client, await insertLiveWorkflow(client, "Prova P5b Escalonar", singleStepGraph(escalation())), { nodeId: "escalar", subjectId: operator })
      await runEnrollmentOnce(client, enrollment)
      expect(await alertsOfType(client, "WORKFLOW_ESCALATION", supervisor)).toHaveLength(1)
    })

    it("D2: Escalonar com conteúdo configurado e ausente para com motivo, sem escalar", async () => {
      const { supervisor, operator } = await people()
      const enrollment = await insertEnrollment(client, await insertLiveWorkflow(client, "Prova P5b Escalonar Vazio", singleStepGraph(escalation("nodeOutputs.sumiu"))), { nodeId: "escalar", subjectId: operator })
      await runEnrollmentOnce(client, enrollment)
      expect(await alertsOfType(client, "WORKFLOW_ESCALATION", supervisor)).toEqual([])
      await stopsWithReason(enrollment)
    })

    it("Escalonar com conteúdo em variável leva o valor", async () => {
      const { supervisor, operator } = await people()
      const enrollment = await insertEnrollment(client, await insertLiveWorkflow(client, "Prova P5b Escalonar Variável", singleStepGraph(escalation(`variables.${VARIABLE_ID}`))), { nodeId: "escalar", subjectId: operator, variables: { [VARIABLE_ID]: "Valor da variável" } })
      await runEnrollmentOnce(client, enrollment)
      const alerts = await alertsOfType(client, "WORKFLOW_ESCALATION", supervisor)
      expect(alerts).toHaveLength(1)
      expect(alerts[0]!.description).toContain("Valor da variável")
    })

    it("controle: Revisão com o conteúdo presente pede a decisão mostrando o conteúdo", async () => {
      const { supervisor, operator } = await people()
      const enrollment = await insertEnrollment(client, await insertLiveWorkflow(client, "Prova P5b Revisão", singleStepGraph(review("nodeOutputs.agente"), REVIEW_HANDLES)), { nodeId: "revisao", subjectId: operator, nodeOutputs: { agente: CONTENT } })
      await runEnrollmentOnce(client, enrollment)
      expect((await enrollmentState(client, enrollment)).status).toBe("waiting")
      const [alert] = await alertsOfType(client, "WORKFLOW_HUMAN_REVIEW", supervisor)
      expect(alert?.description).toContain(CONTENT)
    })

    it("controle: Revisão sem conteúdo configurado continua pedindo a decisão", async () => {
      const { supervisor, operator } = await people()
      const enrollment = await insertEnrollment(client, await insertLiveWorkflow(client, "Prova P5b Revisão Sem Conteúdo", singleStepGraph(review(), REVIEW_HANDLES)), { nodeId: "revisao", subjectId: operator })
      await runEnrollmentOnce(client, enrollment)
      expect((await enrollmentState(client, enrollment)).status).toBe("waiting")
      expect(await alertsOfType(client, "WORKFLOW_HUMAN_REVIEW", supervisor)).toHaveLength(1)
    })

    it("D2: Revisão com conteúdo configurado e ausente bloqueia: ninguém decide sem ver o conteúdo", async () => {
      const { supervisor, operator } = await people()
      const enrollment = await insertEnrollment(client, await insertLiveWorkflow(client, "Prova P5b Revisão Vazia", singleStepGraph(review("nodeOutputs.sumiu"), REVIEW_HANDLES)), { nodeId: "revisao", subjectId: operator })
      await runEnrollmentOnce(client, enrollment)
      expect(await enrollmentState(client, enrollment)).toMatchObject({ status: "blocked", blocked_reason: "HUMAN_REVIEW_CONTENT_MISSING", blocked_node_id: "revisao", attempts: 0 })
      expect(await alertsByEnrollment(client, enrollment)).toEqual([])
      expect(await alertsOfType(client, "WORKFLOW_HUMAN_REVIEW", supervisor)).toEqual([])
    })

    it("Revisão com conteúdo em variável mostra o valor", async () => {
      const { supervisor, operator } = await people()
      const enrollment = await insertEnrollment(client, await insertLiveWorkflow(client, "Prova P5b Revisão Variável", singleStepGraph(review(`variables.${VARIABLE_ID}`), REVIEW_HANDLES)), { nodeId: "revisao", subjectId: operator, variables: { [VARIABLE_ID]: "Valor da variável" } })
      await runEnrollmentOnce(client, enrollment)
      const [alert] = await alertsOfType(client, "WORKFLOW_HUMAN_REVIEW", supervisor)
      expect(alert?.description).toContain("Valor da variável")
    })
  })

  it("QA Lab: rascunho com origem ausente mostra a falha com o motivo, sem entrega simulada vazia", async () => {
    const supervisor = await createPerson(client, "Supervisão Prova P5b", { role: "SUPERVISOR" })
    const operator = await createPerson(client, "Colaboradora Prova P5b", { reportsToId: supervisor })
    const admin = await createPerson(client, "Admin QA Prova P5b")
    const output = flowNode("entrega", "output", "Entrega", { target: { type: "SUPERVISOR_OF_OPERATOR" }, surfaces: ["NOTIFICATION"], source: "nodeOutputs.sumiu" })
    const { workflowId } = await insertLiveWorkflow(client, "Prova P5b QA Lab", singleStepGraph(output))
    const run = await startWorkflowSimulation(client as never, ORG, { workflowId, graphSource: "DRAFT", subject: { kind: "operator", operatorId: operator }, mode: "RUN_ALL", aiPolicy: "STOP_BEFORE_AI" } as never, admin)
    expect(run.status).toBe("FAILED")
    const failed = run.trace.steps.find((step) => step.nodeId === "entrega")
    expect(failed?.status).toBe("failed")
    expect(failed?.error).toMatch(/conteúdo/i)
    expect(run.trace.effects.filter((effect) => effect.kind === "ALERT")).toEqual([])
    expect(await alertsOfType(client, "WORKFLOW_OUTPUT", supervisor)).toEqual([])
  })
})
