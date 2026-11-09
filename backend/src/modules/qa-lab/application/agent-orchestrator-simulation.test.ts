import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { answerAgentVersionQuery, fakeAgentVersionIdOf } from "../../agents/testing/agent-version-fakes.js"

vi.mock("../../../config/env.js", () => ({
  env: { NODE_ENV: "test", GEMINI_API_KEY: "test-key", JWT_SECRET: "s", JWT_EXPIRES_IN: "1h", CORS_ORIGIN: "*", activeDatabaseUrl: "" },
}))

const { runAgentSimulation } = await import("./run-agent-simulation.js")
const { runOrchestratorSimulation } = await import("./run-orchestrator-simulation.js")
const { isReadOnlySql } = await import("./read-only-database.js")

/** Organização da sessão de quem testa no QA Lab. */
const QA_ORGANIZATION = "00000000-0000-4000-8000-000000000001"

const AGENT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const SPECIALIST_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2"
const ORCH_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const OPERATOR_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
const ADMIN_ID = "22222222-2222-4222-8222-222222222222"
/** Base "Manual de PRV" vinculada à versão dos agentes (a configuração da versão guarda o uuid; o fake devolve a linha "k1"). */
const PRV_MANUAL_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"

function fakeDatabase(options: { agentActive?: boolean; invocationMode?: string } = {}) {
  const log: { sql: string; params: unknown[] }[] = []
  const runs = new Map<string, Record<string, unknown>>()
  // Agentes publicados (versão vigente v1, migration 164): o agente testado/orquestrador e o especialista, ambos com a base "Manual de PRV".
  const agentOf = (id: string) =>
    id === AGENT_ID
      ? { id, name: "Agente de Indicadores", agent_type: "INDICATOR_FEEDBACK", objective: "obj", description: "desc", context_prompt: "prompt", active: options.agentActive ?? true, knowledgeDocumentIds: [PRV_MANUAL_ID] }
      : id === SPECIALIST_ID
        ? { id, name: "Especialista de Indicadores", objective: "Explica indicadores", description: "", context_prompt: "prompt", active: options.agentActive ?? true, knowledgeDocumentIds: [PRV_MANUAL_ID] }
        : undefined
  async function query(sql: string, params: unknown[] = []) {
    log.push({ sql, params })
    const versioned = answerAgentVersionQuery(sql, params, agentOf)
    if (versioned) return versioned
    const text = sql.replace(/\s+/g, " ").trim()
    if (text.startsWith("insert into qa_runs")) {
      const id = `run-${runs.size + 1}`
      const [, executedBy, resourceType, resourceId, resourceName, status, input, context, state, trace, aiCalls, inputTokens, outputTokens, totalTokens, durationMs, errorMessage] = params
      runs.set(id, { id, executedBy, executedByName: "Admin", resourceType, resourceId, resourceName, status, input: JSON.parse(input as string), context: JSON.parse(context as string), state: state ? JSON.parse(state as string) : null, trace: JSON.parse(trace as string), aiCalls, inputTokens, outputTokens, totalTokens, durationMs, errorMessage, createdAt: "", updatedAt: "" })
      return { rows: [{ id }], rowCount: 1 }
    }
    if (text.includes("from qa_runs r")) {
      const run = runs.get(params[1] as string)
      return { rows: run ? [run] : [], rowCount: run ? 1 : 0 }
    }
    if (text.includes("select id, name, agent_type, objective, active, current_version_id from agents")) {
      return { rows: [{ id: AGENT_ID, name: "Agente de Indicadores", agent_type: "INDICATOR_FEEDBACK", objective: "Explicar indicadores", active: options.agentActive ?? true, current_version_id: fakeAgentVersionIdOf(AGENT_ID) }], rowCount: 1 }
    }
    if (/select name, objective, description, context_prompt, active[a-z_, ]* from agents/.test(text)) {
      const id = params[0]
      const name = id === SPECIALIST_ID ? "Especialista de Indicadores" : "Agente de Indicadores"
      return { rows: [{ name, objective: "obj", description: "desc", context_prompt: "prompt", active: options.agentActive ?? true }], rowCount: 1 }
    }
    // Atende tanto a listagem de bases do contexto do QA quanto o retrieval do prompt (retrieve-knowledge.ts), que primeiro
    // lê as versões publicadas vinculadas (`versionId`) e depois o `content` dessas versões.
    if (text.includes("from agent_knowledge_documents akd join knowledge_documents kd")) {
      return { rows: [{ id: "k1", title: "Manual de PRV", versionId: "k1-v1", version: 1, organizationId: "org-qa", content: "## PRV\nO PRV é o programa de remuneração variável." }], rowCount: 1 }
    }
    // Bases da VERSÃO em execução (retrieve-knowledge.ts com o agente no contexto de versão).
    if (text.includes("from knowledge_documents kd cross join agent_scope a")) {
      return (params[0] as string[]).includes(PRV_MANUAL_ID)
        ? { rows: [{ id: "k1", title: "Manual de PRV", documentType: "MANUAL", versionId: "k1-v1", version: 1, organizationId: "org-qa" }], rowCount: 1 }
        : { rows: [], rowCount: 0 }
    }
    if (text.includes("from knowledge_versions where id = any")) {
      return { rows: (params[0] as string[]).includes("k1-v1") ? [{ id: "k1-v1", content: "## PRV\nO PRV é o programa de remuneração variável." }] : [], rowCount: 1 }
    }
    if (text.includes("select id, name from agents where id = any")) {
      return { rows: [{ id: AGENT_ID, name: "Agente de Indicadores" }, { id: SPECIALIST_ID, name: "Especialista de Indicadores" }], rowCount: 2 }
    }
    if (text.includes("from agent_knowledge_documents") || text.includes("from prohibited_topics") || text.includes("from call_expectations")) return { rows: [], rowCount: 0 }
    if (text.includes("select p.name, p.team_id, t.name team_name, p.job_title, p.role")) return { rows: [{ name: "João Silva", team_id: null, team_name: "FATURAS", job_title: "Operador de Atendimento", role: "OPERATOR", direct_reports: 0 }], rowCount: 1 }
    if (text.includes("from people p left join teams t on t.id = p.team_id where p.id = any")) return { rows: [{ id: OPERATOR_ID, name: "João Silva", role: "OPERATOR", team_name: "FATURAS" }], rowCount: 1 }
    if (text.includes("from feedbacks f")) return { rows: [], rowCount: 0 }
    if (text.includes("select id, name, active, invocation_mode from assistant_orchestrators")) {
      return { rows: [{ id: ORCH_ID, name: "Orquestrador Geral", active: true, invocation_mode: options.invocationMode ?? "BOTH" }], rowCount: 1 }
    }
    if (text.includes("from assistant_orchestrators o join agents a")) {
      // Mesmo filtro `invocation_mode in ('BOTH', $3)` do SQL real.
      const mode = options.invocationMode ?? "BOTH"
      if (mode !== "BOTH" && mode !== params[2]) return { rows: [], rowCount: 0 }
      return { rows: [{ id: ORCH_ID, name: "Orquestrador Geral", orchestrator_agent_id: AGENT_ID, objective: "obj", description: "desc", context_prompt: "prompt", output_instructions: "um JSON com { diagnostico: { severidade } }" }], rowCount: 1 }
    }
    if (text.includes("from assistant_orchestrator_specialists where orchestrator_id = $1")) {
      return { rows: [{ agentId: SPECIALIST_ID, toolName: "consultar_indicadores" }], rowCount: 1 }
    }
    return { rows: [], rowCount: 0 }
  }
  return { db: { query, connect: async () => ({ query, release: () => {} }) } as unknown as Database, log }
}

function gemini(parts: unknown[], usage = { promptTokenCount: 100, candidatesTokenCount: 20, totalTokenCount: 120 }) {
  return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts } }], usageMetadata: usage }), text: async () => "" }
}

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe("QA Lab — Agent isolado", () => {
  it("executa SOMENTE o agente: sem orquestrador, sem workflow, sem agent_runs; mostra prompt, bases, tokens e structured output", async () => {
    fetchMock.mockImplementation(async () => gemini([{ text: JSON.stringify({ diagnostico: "PRV abaixo da meta" }) }]))
    const { db, log } = fakeDatabase()
    const run = await runAgentSimulation(db, QA_ORGANIZATION, { agentId: AGENT_ID, input: "Como está meu PRV?", operatorId: OPERATOR_ID, aiPolicy: "REAL" }, ADMIN_ID)

    expect(run.status).toBe("COMPLETED")
    expect(run.resourceType).toBe("AGENT")
    expect(run.aiCalls).toBe(1)
    expect(run.totalTokens).toBe(120)
    expect(run.trace.context).toMatchObject({ agent: { name: "Agente de Indicadores" }, knowledgeDocuments: [{ title: "Manual de PRV" }] })
    // Contexto de operador injetado igual ao de um especialista em produção.
    expect(run.trace.context.inputContext).toContain("Colaborador que está perguntando: João Silva")
    expect(run.trace.context.inputContext).toContain("Pergunta do colaborador: Como está meu PRV?")
    expect(run.trace.steps[0]!.nodeOutput).toMatchObject({ structured: { diagnostico: "PRV abaixo da meta" } })
    expect(run.trace.aiCalls[0]).toMatchObject({ role: "agent", agentId: AGENT_ID, agentName: "Agente de Indicadores" })
    expect(run.trace.aiCalls[0]!.systemPrompt).toContain("Você é Agente de Indicadores")
    expect(run.trace.aiCalls[0]!.systemPrompt).not.toContain("test-key")
    // Rastro de KB por request: bases autorizadas × o que entrou no prompt (base pequena cabe inteira).
    expect(run.trace.aiCalls[0]!.knowledge).toMatchObject({ mode: "FULL", authorizedDocuments: [{ id: "k1", title: "Manual de PRV" }] })
    expect(run.trace.aiCalls[0]!.knowledge!.retrieved[0]).toMatchObject({ documentTitle: "Manual de PRV", heading: "PRV" })
    expect(run.trace.effects).toEqual([{ kind: "AGENT_RUN", id: 1, nodeId: null, runId: "qa-agent-run-1", agentId: AGENT_ID, status: "COMPLETED", outputText: expect.any(String), errorMessage: null }])

    const writes = log.filter((entry) => !isReadOnlySql(entry.sql)).map((entry) => entry.sql.trim().slice(0, 20))
    expect(writes).toEqual(["insert into qa_runs("])
    expect(log.some((entry) => entry.sql.includes("agent_runs") || entry.sql.includes("assistant_orchestrators"))).toBe(false)
  })

  it("'Parar antes da IA' pausa sem chamar o modelo", async () => {
    const { db } = fakeDatabase()
    const run = await runAgentSimulation(db, QA_ORGANIZATION, { agentId: AGENT_ID, input: "oi", aiPolicy: "STOP_BEFORE_AI" }, ADMIN_ID)
    expect(run.status).toBe("PAUSED")
    expect(run.trace.steps[0]!.status).toBe("paused_before_ai")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("agente inativo: erro claro na etapa, execução marcada como falha", async () => {
    const { db } = fakeDatabase({ agentActive: false })
    const run = await runAgentSimulation(db, QA_ORGANIZATION, { agentId: AGENT_ID, input: "oi", aiPolicy: "REAL" }, ADMIN_ID)
    expect(run.status).toBe("FAILED")
    expect(run.errorMessage).toContain("inativo")
  })
})

describe("QA Lab — Orchestrator isolado", () => {
  it("mostra o trace Entrada → roteamento → especialista → síntese, com tokens por etapa e structured output", async () => {
    fetchMock
      .mockImplementationOnce(async () => gemini([{ functionCall: { name: "consultar_indicadores", args: { query: "PRV de João" } } }], { promptTokenCount: 500, candidatesTokenCount: 50, totalTokenCount: 550 }))
      .mockImplementationOnce(async () => gemini([{ text: "PRV em 78%, meta 80%." }], { promptTokenCount: 300, candidatesTokenCount: 40, totalTokenCount: 340 }))
      .mockImplementationOnce(async () => gemini([{ text: 'Seu PRV está em 78%.\nSTRUCTURED_RESULT_JSON: {"diagnostico":{"severidade":"MEDIA"}}' }], { promptTokenCount: 700, candidatesTokenCount: 60, totalTokenCount: 760 }))

    const { db, log } = fakeDatabase()
    const run = await runOrchestratorSimulation(db, QA_ORGANIZATION, { orchestratorId: ORCH_ID, operatorId: OPERATOR_ID, instruction: "Como está meu PRV?", invocationContext: "INTERACTIVE", aiPolicy: "REAL" }, ADMIN_ID)

    expect(run.status).toBe("COMPLETED")
    expect(run.trace.steps.map((step) => step.nodeId)).toEqual(["input", "orchestrator_routing", "specialist:consultar_indicadores", "orchestrator_synthesis"])
    expect(run.trace.steps[1]).toMatchObject({ aiCalls: 1, totalTokens: 550 })
    expect(run.trace.steps[2]).toMatchObject({ label: "Especialista de Indicadores", aiCalls: 1, totalTokens: 340, nodeOutput: { text: "PRV em 78%, meta 80%.", query: "PRV de João" } })
    expect(run.trace.steps[3]).toMatchObject({ aiCalls: 1, totalTokens: 760, nodeOutput: { text: "Seu PRV está em 78%.", structuredResult: { diagnostico: { severidade: "MEDIA" } } } })
    expect(run.aiCalls).toBe(3)
    expect(run.totalTokens).toBe(1650)
    expect(run.trace.context).toMatchObject({ availableSpecialists: [{ agentId: SPECIALIST_ID, toolName: "consultar_indicadores", name: "Especialista de Indicadores" }] })
    expect(run.trace.aiCalls.map((call) => call.role)).toEqual(["orchestrator_routing", "specialist", "orchestrator_synthesis"])
    // Nada gravado além do próprio qa_run (nenhuma assistant_interactions, nenhum feedback).
    expect(log.filter((entry) => !isReadOnlySql(entry.sql)).map((entry) => entry.sql.trim().slice(0, 20))).toEqual(["insert into qa_runs("])
  })

  it("respeita o mesmo gate de produção (invocation_mode)", async () => {
    const { db } = fakeDatabase({ invocationMode: "WORKFLOW" })
    const run = await runOrchestratorSimulation(db, QA_ORGANIZATION, { orchestratorId: ORCH_ID, operatorId: OPERATOR_ID, instruction: "oi", invocationContext: "INTERACTIVE", aiPolicy: "REAL" }, ADMIN_ID)
    expect(run.status).toBe("FAILED")
    expect(run.errorMessage).toContain("não está habilitado")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("orçamento de 1 chamada pausa antes do especialista", async () => {
    fetchMock.mockImplementationOnce(async () => gemini([{ functionCall: { name: "consultar_indicadores", args: { query: "PRV" } } }]))
    const { db } = fakeDatabase()
    const run = await runOrchestratorSimulation(db, QA_ORGANIZATION, { orchestratorId: ORCH_ID, operatorId: OPERATOR_ID, instruction: "oi", invocationContext: "INTERACTIVE", aiPolicy: "REAL", maxAiCalls: 1 }, ADMIN_ID)
    expect(run.status).toBe("PAUSED")
    expect(run.aiCalls).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
