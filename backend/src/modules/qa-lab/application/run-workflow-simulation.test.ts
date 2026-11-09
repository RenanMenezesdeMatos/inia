import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { answerAgentVersionQuery } from "../../agents/testing/agent-version-fakes.js"
import type { FlowGraph } from "../../workflows/domain/graph-schema.js"
import type { QaRunRecord } from "./qa-run-repository.js"

vi.mock("../../../config/env.js", () => ({
  env: { NODE_ENV: "test", GEMINI_API_KEY: "test-key", JWT_SECRET: "s", JWT_EXPIRES_IN: "1h", CORS_ORIGIN: "*", activeDatabaseUrl: "" },
}))

const { startWorkflowSimulation, resumeWorkflowSimulation, submitSimulatedDecision } = await import("./workflow-simulation-service.js")
const { createReadOnlyDatabase, isReadOnlySql } = await import("./read-only-database.js")

/** Organização da sessão de quem testa no QA Lab. */
const QA_ORGANIZATION = "00000000-0000-4000-8000-000000000001"

/**
 * Testes funcionais do QA Lab (Parte 59): a MESMA engine (processNode) rodando em memória,
 * com banco somente-leitura + sink simulado. A "IA" é um `fetch` stubado que devolve um JSON
 * estruturado válido (com evidência literal da transcrição) e `usageMetadata`, pra testar
 * contabilização de tokens de verdade, sem Gemini.
 */
const WORKFLOW_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const AGENT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const FLAG_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
const INTERACTION_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
const OPERATOR_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
const SUPERVISOR_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff"
const MANAGER_ID = "99999999-9999-4999-8999-999999999999"
const TEAM_ID = "11111111-1111-4111-8111-111111111111"
const ADMIN_ID = "22222222-2222-4222-8222-222222222222"
const ORCHESTRATOR_ID = "33333333-3333-4333-8333-333333333333"
const TRANSCRIPT = "Operador: bom dia. Cliente: quero cancelar. Operador: não posso ajudar com isso, tchau."

function flagGraph(extra: { withReview?: boolean; withWait?: boolean; twoAgents?: boolean; withConfig?: boolean } = {}): FlowGraph {
  const nodes: FlowGraph["nodes"] = [
    { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
    { id: "condition", type: "condition", label: "Nota URA < 3", position: { x: 0, y: 1 }, config: { comparator: "LT", thresholdNumeric: 3 } },
    { id: "agent", type: "action", label: "Chamar agente", position: { x: 0, y: 2 }, config: { actionType: "CALL_AGENT", agentId: AGENT_ID } },
    {
      id: "output",
      type: "output",
      label: "Publicar",
      position: { x: 0, y: 3 },
      config: { target: { type: "CURRENT_OPERATOR" }, surfaces: ["FOLLOW_UP"], source: "nodeOutputs.agent" },
    },
    {
      id: "notify",
      type: "output",
      label: "Notificar supervisor",
      position: { x: 0, y: 4 },
      config: { target: { type: "SUPERVISOR_OF_OPERATOR" }, surfaces: ["NOTIFICATION"], source: "nodeOutputs.agent" },
    },
    {
      id: "escalate",
      type: "action",
      label: "Escalonar",
      position: { x: 0, y: 5 },
      config: { actionType: "ESCALATE", target: { type: "ROLE_OF_OPERATOR", role: "MANAGER" }, surfaces: ["NOTIFICATION", "INBOX"], reason: "Rechamada crítica" },
    },
    { id: "end", type: "end", label: "Fim", position: { x: 0, y: 9 }, config: {} },
  ]
  const chain = ["trigger", "condition", "agent"]
  if (extra.twoAgents) {
    nodes.push({ id: "agent2", type: "action", label: "Segundo agente", position: { x: 0, y: 2 }, config: { actionType: "CALL_AGENT", agentId: AGENT_ID } })
    chain.push("agent2")
  }
  if (extra.withConfig) {
    nodes.push({ id: "config", type: "action", label: "Definir config", position: { x: 1, y: 2 }, config: { actionType: "SET_CONFIG_VALUE", configKey: "ura.alerta", valueType: "BOOLEAN", value: true } })
    chain.push("config")
  }
  if (extra.withWait) {
    nodes.push({ id: "wait", type: "wait", label: "Aguardar 7 dias", position: { x: 0, y: 2 }, config: { durationMs: 7 * 24 * 60 * 60 * 1000 } })
    chain.push("wait")
  }
  if (extra.withReview) {
    nodes.push({
      id: "review",
      type: "human_review",
      label: "Revisão do supervisor",
      position: { x: 0, y: 2 },
      config: { reviewTarget: { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" }, contentSource: "nodeOutputs.agent", instruction: "Confirme o feedback" },
    })
    chain.push("review")
  }
  chain.push("output", "notify", "escalate", "end")
  const edges: FlowGraph["edges"] = []
  for (let index = 0; index < chain.length - 1; index += 1) {
    const source = chain[index]!
    const target = chain[index + 1]!
    const handle = source === "condition" ? "true" : source === "review" ? "approved" : "always"
    edges.push({ id: `e-${source}-${target}`, source, sourceHandle: handle, target })
  }
  edges.push({ id: "e-condition-false", source: "condition", sourceHandle: "false", target: "end" })
  if (extra.withReview) {
    edges.push({ id: "e-review-rejected", source: "review", sourceHandle: "rejected", target: "end" })
    edges.push({ id: "e-review-escalated", source: "review", sourceHandle: "escalated", target: "escalate" })
  }
  return { nodes, edges }
}

type Row = Record<string, unknown>

function qaRunRecordFrom(insertParams: unknown[], id: string): QaRunRecord {
  const [, executedBy, resourceType, resourceId, resourceName, status, input, context, state, trace, aiCalls, inputTokens, outputTokens, totalTokens, durationMs, errorMessage] = insertParams
  return {
    id,
    executedBy: executedBy as string,
    executedByName: "Admin Global",
    resourceType: resourceType as QaRunRecord["resourceType"],
    resourceId: resourceId as string,
    resourceName: resourceName as string,
    status: status as QaRunRecord["status"],
    input: JSON.parse(input as string),
    context: JSON.parse(context as string),
    state: state ? JSON.parse(state as string) : null,
    trace: JSON.parse(trace as string),
    aiCalls: aiCalls as number,
    inputTokens: inputTokens as number,
    outputTokens: outputTokens as number,
    totalTokens: totalTokens as number,
    durationMs: durationMs as number,
    errorMessage: errorMessage as string | null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

/**
 * Banco fake com roteamento por trecho de SQL. Registra TODA query (pra provar que nenhuma
 * escrita operacional aconteceu) e simula a tabela qa_runs em memória (única escrita permitida,
 * feita pelo serviço no banco REAL — não pelo motor).
 */
function fakeDatabase(options: {
  graph: FlowGraph
  workflow?: Partial<Row>
  flagValue?: number
  shift?: { start_time: string; work_minutes: number } | null
  unit?: unknown
  measurementValue?: number
  prv?: { achievement_percent: string; quartile: string } | null
  /** Interação sem transcrição persistida (Parte 17). */
  withoutTranscript?: boolean
  /** Versão do Orquestrador que a etapa fixa (`orchestratorVersionId`), com o alcance gravado nela. */
  orchestratorVersion?: { id: string; number: number; config: Row }
}) {
  const log: { sql: string; params: unknown[] }[] = []
  const runs = new Map<string, QaRunRecord>()
  let runCounter = 0

  async function query(sql: string, params: unknown[] = []) {
    if (sql.includes("from people where id = any($1::uuid[]) and active")) return { rows: (params[0] as string[]).map((id) => ({ id })), rowCount: (params[0] as string[]).length }
    log.push({ sql, params })
    // --- versão do agente (migration 164): o agente de monitoria publicado, versão vigente v1 ---
    const versioned = answerAgentVersionQuery(sql, params, (agentId) =>
      agentId === AGENT_ID ? { id: AGENT_ID, name: "Agente de Monitoria", objective: "Avaliar", description: "desc", context_prompt: "prompt", active: true } : undefined,
    )
    if (versioned) return versioned
    const text = sql.replace(/\s+/g, " ").trim()

    // --- qa_runs (banco real) ---
    if (text.startsWith("insert into qa_runs")) {
      runCounter += 1
      const id = `run-${runCounter}`
      runs.set(id, qaRunRecordFrom(params, id))
      return { rows: [{ id }], rowCount: 1 }
    }
    if (text.startsWith("update qa_runs")) {
      const [id, status, state, trace, aiCalls, inputTokens, outputTokens, totalTokens, durationMs, errorMessage] = params
      const current = runs.get(id as string)!
      runs.set(id as string, {
        ...current,
        status: status as QaRunRecord["status"],
        state: state ? JSON.parse(state as string) : null,
        trace: JSON.parse(trace as string),
        aiCalls: aiCalls as number,
        inputTokens: inputTokens as number,
        outputTokens: outputTokens as number,
        totalTokens: totalTokens as number,
        durationMs: current.durationMs + (durationMs as number),
        errorMessage: errorMessage as string | null,
      })
      return { rows: [], rowCount: 1 }
    }
    if (text.includes("from qa_runs r")) {
      const run = runs.get(params[1] as string)
      return { rows: run ? [run] : [], rowCount: run ? 1 : 0 }
    }

    // --- workflow ---
    if (text.includes("from workflows w where w.id = $1")) {
      return {
        rows: [
          {
            id: WORKFLOW_ID,
            name: "URA crítica",
            scope_type: "ALL_TEAMS",
            team_id: null,
            subteam_id: null,
            trigger_config: { kind: "channel_flag", channelFlagId: FLAG_ID },
            consolidated_structure: options.unit ?? null,
            active_version_id: "77777777-7777-4777-8777-777777777777",
            draft_graph: options.graph,
            published_graph: options.graph,
            ...options.workflow,
          },
        ],
        rowCount: 1,
      }
    }
    if (text.includes("from operations where organization_id")) return { rows: [{ timezone: "America/Fortaleza" }], rowCount: 1 }

    // --- chamada / flag / transcrição (mesmas consultas de interaction-evidence.ts) ---
    if (text.includes("from interactions i join people p on p.id = i.operator_id left join teams t") && text.includes("where i.id = $1 and i.organization_id")) {
      return {
        rows: [{ id: INTERACTION_ID, external_id: "ABC123", operator_id: OPERATOR_ID, operator_name: "João Silva", team_id: TEAM_ID, team_name: "FATURAS", channel: "VOICE", reason: "Cancelamento", started_at: "2026-09-10T12:00:00.000Z", ended_at: "2026-09-10T12:10:00.000Z" }],
        rowCount: 1,
      }
    }
    if (text.includes("select id, channel, flag_name, value_type from channel_flags where id = $1")) {
      return { rows: [{ id: FLAG_ID, channel: "VOICE", flag_name: "nota_ura", value_type: "NUMERIC" }], rowCount: 1 }
    }
    if (text.includes("select f.value_boolean, f.value_numeric from interaction_flags f where f.interaction_id = $1 and f.channel_flag_id = $2")) {
      return { rows: [{ value_boolean: null, value_numeric: String(options.flagValue ?? 1) }], rowCount: 1 }
    }
    // Elegibilidade (workflow-eligibility.ts): decisão pontual + conjunto da Abrangência.
    if (text.includes("select id, team_id, subteam_id, reports_to_id from people where id = $1")) {
      return params[0] === OPERATOR_ID ? { rows: [{ id: OPERATOR_ID, team_id: TEAM_ID, subteam_id: null, reports_to_id: SUPERVISOR_ID }], rowCount: 1 } : { rows: [], rowCount: 0 }
    }
    if (text.includes("select id from people where organization_id = $1 and role = 'OPERATOR' and active")) return { rows: [{ id: OPERATOR_ID }], rowCount: 1 }
    if (text.includes("from transcripts where interaction_id")) return options.withoutTranscript ? { rows: [], rowCount: 0 } : { rows: [{ content: TRANSCRIPT, version: 1, language: "pt-BR", confidence: null }], rowCount: 1 }
    if (text.includes("select operator_id, started_at, team_id from interactions i join people p")) {
      return { rows: [{ operator_id: OPERATOR_ID, started_at: "2026-09-10T12:00:00.000Z", team_id: TEAM_ID }], rowCount: 1 }
    }
    if (text.includes("select operator_id from interactions where id = $1")) return { rows: [{ operator_id: OPERATOR_ID }], rowCount: 1 }
    if (text.includes("select started_at from interactions where id = $1")) return { rows: [{ started_at: "2026-09-10T12:00:00.000Z" }], rowCount: 1 }

    // --- pessoas / hierarquia ---
    const people: Record<string, Row> = {
      [OPERATOR_ID]: { id: OPERATOR_ID, name: "João Silva", role: "OPERATOR", team_id: TEAM_ID, team_name: "FATURAS", subteam_name: null, reports_to_id: SUPERVISOR_ID },
      [SUPERVISOR_ID]: { id: SUPERVISOR_ID, name: "Carlos", role: "SUPERVISOR", team_id: TEAM_ID, team_name: "FATURAS", subteam_name: null, reports_to_id: MANAGER_ID },
      [MANAGER_ID]: { id: MANAGER_ID, name: "Gerente X", role: "MANAGER", team_id: TEAM_ID, team_name: "FATURAS", subteam_name: null, reports_to_id: null },
    }
    if (text.includes("from people p left join teams t on t.id = p.team_id where p.id = any")) {
      const ids = params[0] as string[]
      return { rows: ids.filter((id) => people[id]).map((id) => people[id]), rowCount: ids.length }
    }
    if (text.includes("from people p left join teams t on t.id = p.team_id left join subteams st") && text.includes("where p.id = $1")) {
      const person = people[params[0] as string]
      return { rows: person ? [person] : [], rowCount: person ? 1 : 0 }
    }
    if (text.includes("select id, role, reports_to_id from people where id = $1")) {
      const person = people[params[0] as string]
      return { rows: person ? [person] : [], rowCount: person ? 1 : 0 }
    }
    if (text.includes("select name from people where id = $1")) {
      const person = people[params[0] as string]
      return { rows: person ? [{ name: person.name }] : [], rowCount: person ? 1 : 0 }
    }
    if (text.includes("select team_id from people where id = $1")) return { rows: [{ team_id: TEAM_ID }], rowCount: 1 }
    if (text.includes("select id from people where reports_to_id = $1 and role = 'OPERATOR'")) return { rows: [{ id: OPERATOR_ID }], rowCount: 1 }
    if (text.includes("from employee_work_shifts")) return options.shift ? { rows: [options.shift], rowCount: 1 } : { rows: [], rowCount: 0 }
    if (text.includes("from employee_prv_performance where") && text.includes("person_id = $1 and reference_period <= $2")) {
      return options.prv ? { rows: [{ id: "prv-1", personId: OPERATOR_ID, subteamId: null, referencePeriod: "2026-08", achievementPercent: options.prv.achievement_percent, quartile: options.prv.quartile, source: "SEED" }], rowCount: 1 } : { rows: [], rowCount: 0 }
    }
    if (text.includes("from employee_indicator_performance") || text.includes("from employee_prv_performance")) return { rows: [], rowCount: 0 }
    if (text.includes("from indicator_measurements m join indicator_definitions i on i.id = m.indicator_definition_id where m.id = $1")) {
      return { rows: [{ id: "mmmmmmmm-mmmm-4mmm-8mmm-mmmmmmmmmmmm", subject_id: OPERATOR_ID, value: String(options.measurementValue ?? 72), period_start: "2026-09-01T03:00:00.000Z", period_end: "2026-09-30T03:00:00.000Z", code: "QUALIDADE", name: "Qualidade", unit: "%", target: "80" }], rowCount: 1 }
    }
    if (text.includes("select subject_id from indicator_measurements where id = $1")) return { rows: [{ subject_id: OPERATOR_ID }], rowCount: 1 }
    if (text.includes("count(*)::int count from indicator_measurements")) return { rows: [{ count: 42 }], rowCount: 1 }

    // --- agente ---
    if (/select name, objective, description, context_prompt, active[a-z_, ]* from agents/.test(text)) {
      return { rows: [{ name: "Agente de Monitoria", objective: "Avaliar", description: "desc", context_prompt: "prompt", active: true }], rowCount: 1 }
    }
    if (text.includes("select id, name from agents where id = any")) return { rows: [{ id: AGENT_ID, name: "Agente de Monitoria" }], rowCount: 1 }

    // --- orquestrador como node do workflow (mesmas consultas de resolve-orchestrator/run-orchestrated-reply) ---
    if (text.includes("from assistant_orchestrators o join agents a")) {
      return { rows: [{ id: ORCHESTRATOR_ID, name: "Orquestrador Geral", orchestrator_agent_id: AGENT_ID, objective: "obj", description: "desc", context_prompt: "prompt", output_instructions: "um JSON" }], rowCount: 1 }
    }
    if (text.includes("from assistant_orchestrator_specialists where orchestrator_id = $1")) {
      return { rows: [{ agentId: AGENT_ID, toolName: "consultar_indicadores" }], rowCount: 1 }
    }
    if (text.includes("from assistant_orchestrator_versions where id = $1 and orchestrator_id = $2")) {
      const version = options.orchestratorVersion
      return version && params[0] === version.id && params[1] === ORCHESTRATOR_ID ? { rows: [version], rowCount: 1 } : { rows: [], rowCount: 0 }
    }
    if (text.includes("select p.name, p.team_id, t.name team_name from people p")) return { rows: [{ name: "João Silva", team_id: TEAM_ID, team_name: "FATURAS" }], rowCount: 1 }
    if (text.includes("from feedbacks f")) return { rows: [], rowCount: 0 }
    if (text.includes("from agent_knowledge_documents") || text.includes("from prohibited_topics") || text.includes("from call_expectations")) return { rows: [], rowCount: 0 }

    return { rows: [], rowCount: 0 }
  }

  const db = { query, connect: async () => ({ query, release: () => {} }) } as unknown as Database
  return { db, log, runs }
}

function geminiResponse(text: string, usage = { promptTokenCount: 1200, candidatesTokenCount: 300, totalTokenCount: 1500 }) {
  return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }], usageMetadata: usage }), text: async () => "" }
}

const STRUCTURED_REPLY = JSON.stringify({
  title: "Encerramento inadequado",
  summary: "Operador encerrou sem oferecer alternativa.",
  impactedIndicator: "nota_ura",
  evidenceFound: "não posso ajudar com isso, tchau",
  observedBehavior: "Encerrou a ligação sem alternativa.",
  relatedProcedure: "Nenhum procedimento específico cadastrado",
  recommendation: "Ofereça alternativas antes de encerrar.",
})

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => geminiResponse(STRUCTURED_REPLY))
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

const flagSubject = { kind: "interaction" as const, interactionId: INTERACTION_ID }
const baseInput = { workflowId: WORKFLOW_ID, subject: flagSubject, mode: "RUN_ALL" as const, aiPolicy: "REAL" as const }

/** Só os comandos de escrita executados, identificados pela tabela-alvo. */
function writes(log: { sql: string }[]) {
  return log.filter((entry) => !isReadOnlySql(entry.sql)).map((entry) => /^\s*(insert into|update)\s+(\w+)/i.exec(entry.sql)?.slice(1, 3).join(" ") ?? entry.sql.slice(0, 40))
}

describe("QA Lab — simulação isolada de Workflow (engine real, efeitos simulados)", () => {
  it("Flag: executa trigger → condition → agente → outputs → escalonamento → fim sem gravar NADA operacional", async () => {
    const { db, log } = fakeDatabase({ graph: flagGraph(), flagValue: 1 })
    const run = await startWorkflowSimulation(db, QA_ORGANIZATION, baseInput, ADMIN_ID)

    expect(run.status).toBe("COMPLETED")
    expect(run.trace.steps.map((step) => `${step.nodeId}:${step.status}`)).toEqual([
      "trigger:completed",
      "condition:completed",
      "agent:completed",
      "output:completed",
      "notify:completed",
      "escalate:completed",
      "end:completed",
    ])
    // Debug da Condition: valores efetivamente resolvidos (Parte 30).
    const condition = run.trace.steps[1]!
    expect(condition.outcome).toMatchObject({ branch: "true", payload: { result: true, evaluation: { kind: "trigger_value", value: 1, comparator: "LT", threshold: 3 } } })

    // Efeitos simulados — "o que teria acontecido" (Parte 31-34): Feedback pro operador,
    // notificação pro supervisor, escalonamento pro gerente (Pendência + INBOX).
    const kinds = run.trace.effects.map((effect) => `${effect.kind}@${effect.nodeId}`)
    expect(kinds).toEqual(["AGENT_RUN@agent", "FEEDBACK@output", "ALERT@notify", "ALERT@escalate", "WORKFLOW_OUTPUT@escalate"])
    const feedback = run.trace.effects.find((effect) => effect.kind === "FEEDBACK")!
    expect(feedback).toMatchObject({ kind: "FEEDBACK", feedbackKind: "monitoring", operatorId: OPERATOR_ID, caseId: "qa-case-2", evidenceFound: "não posso ajudar com isso, tchau" })
    const notify = run.trace.effects.find((effect) => effect.kind === "ALERT" && effect.nodeId === "notify")!
    expect(notify).toMatchObject({ recipientId: SUPERVISOR_ID, alertType: "WORKFLOW_OUTPUT", caseId: "qa-case-2" })
    const escalation = run.trace.effects.find((effect) => effect.kind === "ALERT" && effect.nodeId === "escalate")!
    expect(escalation).toMatchObject({ recipientId: MANAGER_ID, alertType: "WORKFLOW_ESCALATION", surfaces: ["NOTIFICATION"] })
    expect(escalation.kind === "ALERT" && escalation.description).toContain("Rechamada crítica")
    // Nomes resolvidos pra UI nunca mostrar UUID.
    expect(run.trace.people[SUPERVISOR_ID]).toMatchObject({ name: "Carlos", role: "SUPERVISOR" })
    expect(run.trace.people[MANAGER_ID]).toMatchObject({ name: "Gerente X" })

    // Tokens contabilizados (Parte 39/59) a partir do usageMetadata real da resposta.
    expect(run.aiCalls).toBe(1)
    expect(run.inputTokens).toBe(1200)
    expect(run.outputTokens).toBe(300)
    expect(run.totalTokens).toBe(1500)
    expect(run.trace.aiCalls[0]).toMatchObject({ role: "agent", agentId: AGENT_ID, agentName: "Agente de Monitoria", model: expect.any(String) })
    expect(run.trace.aiCalls[0]!.systemPrompt).toContain("Você é Agente de Monitoria")
    expect(run.trace.steps[2]).toMatchObject({ aiCalls: 1, totalTokens: 1500 })

    // Isolamento (Parte 8/45/47): a ÚNICA escrita no banco é a própria qa_runs. Nenhum
    // agent_runs, alerts, feedbacks, workflow_outputs, org_config_values, workflow_enrollments,
    // — logo nenhum Workflow B pode ter sido matriculado.
    expect(writes(log)).toEqual(["insert into qa_runs"])
    expect(log.some((entry) => /workflow_enrollments|agent_runs|into alerts|into feedbacks|workflow_outputs|org_config_values/.test(entry.sql))).toBe(false)
    expect(run.executedBy).toBe(ADMIN_ID)
  })

  it("Condition FALSE: vai pro Fim sem chamar IA (0 chamadas, 0 tokens)", async () => {
    const { db } = fakeDatabase({ graph: flagGraph(), flagValue: 4 })
    const run = await startWorkflowSimulation(db, QA_ORGANIZATION, baseInput, ADMIN_ID)
    expect(run.status).toBe("COMPLETED")
    expect(run.trace.steps.map((step) => step.nodeId)).toEqual(["trigger", "condition", "end"])
    expect(run.trace.steps[1]!.outcome).toMatchObject({ branch: "false" })
    expect(run.aiCalls).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(run.trace.effects).toEqual([])
  })

  it("Human Review simulado: pausa sem criar Pendência real, mostra o revisor, e a decisão continua só a execução de QA", async () => {
    const { db, log } = fakeDatabase({ graph: flagGraph({ withReview: true }), flagValue: 1 })
    const started = await startWorkflowSimulation(db, QA_ORGANIZATION, baseInput, ADMIN_ID)
    expect(started.status).toBe("WAITING")
    expect(started.state).toMatchObject({ currentNodeId: "review", status: "waiting", pauseReason: "HUMAN_REVIEW" })
    expect(started.trace.pendingReview).toMatchObject({ nodeId: "review", reviewerIds: [SUPERVISOR_ID], instruction: "Confirme o feedback" })
    expect(started.trace.effects.filter((effect) => effect.kind === "ALERT")).toHaveLength(1)
    expect(started.trace.effects.find((effect) => effect.kind === "ALERT")).toMatchObject({ alertType: "WORKFLOW_HUMAN_REVIEW", recipientId: SUPERVISOR_ID })

    await expect(resumeWorkflowSimulation(db, QA_ORGANIZATION, started.id, {})).rejects.toMatchObject({ code: "QA_RUN_AWAITING_DECISION" })

    const decided = await submitSimulatedDecision(db, QA_ORGANIZATION, started.id, "approved", ADMIN_ID)
    expect(decided.status).toBe("COMPLETED")
    expect(decided.trace.steps.map((step) => `${step.nodeId}:${step.status}`)).toEqual([
      "trigger:completed",
      "condition:completed",
      "agent:completed",
      "review:waiting",
      "review:completed",
      "output:completed",
      "notify:completed",
      "escalate:completed",
      "end:completed",
    ])
    expect(decided.state?.nodeOutputs.review).toMatchObject({ decision: "approved", reviewerId: ADMIN_ID, simulated: true })
    expect(writes(log)).toEqual(["insert into qa_runs", "update qa_runs"])
  })

  it("Human Review 'Escalar' segue pelo ramo escalated", async () => {
    const { db } = fakeDatabase({ graph: flagGraph({ withReview: true }), flagValue: 1 })
    const started = await startWorkflowSimulation(db, QA_ORGANIZATION, baseInput, ADMIN_ID)
    const decided = await submitSimulatedDecision(db, QA_ORGANIZATION, started.id, "escalated", ADMIN_ID)
    expect(decided.trace.steps.slice(4).map((step) => step.nodeId)).toEqual(["review", "escalate", "end"])
  })

  it("Wait: pausa com 'Avançar 7 dias', e a retomada pula o relógio simulado em vez de esperar tempo real", async () => {
    const { db } = fakeDatabase({ graph: flagGraph({ withWait: true }), flagValue: 1 })
    const started = await startWorkflowSimulation(db, QA_ORGANIZATION, { ...baseInput, simulatedNow: "2026-09-14T12:00:00.000Z" }, ADMIN_ID)
    expect(started.status).toBe("WAITING")
    expect(started.state).toMatchObject({ currentNodeId: "wait", pauseReason: "WAIT", resumeAt: "2026-09-21T12:00:00.000Z", simulatedNow: "2026-09-14T12:00:00.000Z" })

    const resumed = await resumeWorkflowSimulation(db, QA_ORGANIZATION, started.id, {})
    expect(resumed.status).toBe("COMPLETED")
    expect(resumed.state?.simulatedNow).toBe("2026-09-21T12:00:00.000Z")
    const waitSteps = resumed.trace.steps.filter((step) => step.nodeId === "wait")
    expect(waitSteps.map((step) => step.status)).toEqual(["waiting", "completed"])
    expect(waitSteps[1]!.simulatedNow).toBe("2026-09-21T12:00:00.000Z")
  })

  it("'Parar antes da IA': pausa no node de agente sem consumir token; retomar com IA real conclui", async () => {
    const { db } = fakeDatabase({ graph: flagGraph(), flagValue: 1 })
    const paused = await startWorkflowSimulation(db, QA_ORGANIZATION, { ...baseInput, aiPolicy: "STOP_BEFORE_AI" }, ADMIN_ID)
    expect(paused.status).toBe("PAUSED")
    expect(paused.state).toMatchObject({ currentNodeId: "agent", pauseReason: "AI_BLOCKED" })
    expect(paused.trace.steps[2]).toMatchObject({ nodeId: "agent", status: "paused_before_ai", aiCalls: 0 })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(paused.aiCalls).toBe(0)

    const resumed = await resumeWorkflowSimulation(db, QA_ORGANIZATION, paused.id, { aiPolicy: "REAL" })
    expect(resumed.status).toBe("COMPLETED")
    expect(resumed.aiCalls).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("Orçamento: 'Máximo de chamadas de IA = 1' pausa antes da segunda chamada", async () => {
    const { db } = fakeDatabase({ graph: flagGraph({ twoAgents: true }), flagValue: 1 })
    const paused = await startWorkflowSimulation(db, QA_ORGANIZATION, { ...baseInput, maxAiCalls: 1 }, ADMIN_ID)
    expect(paused.status).toBe("PAUSED")
    expect(paused.state).toMatchObject({ currentNodeId: "agent2", pauseReason: "AI_BUDGET" })
    expect(paused.aiCalls).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const resumed = await resumeWorkflowSimulation(db, QA_ORGANIZATION, paused.id, { maxAiCalls: 5 })
    expect(resumed.status).toBe("COMPLETED")
    expect(resumed.aiCalls).toBe(2)
  })

  it("'Executar até este node': para ANTES do agente — Conditions testadas, zero chamadas de IA", async () => {
    const { db } = fakeDatabase({ graph: flagGraph(), flagValue: 1 })
    const run = await startWorkflowSimulation(db, QA_ORGANIZATION, { ...baseInput, mode: "UNTIL_NODE", untilNodeId: "agent" }, ADMIN_ID)
    expect(run.status).toBe("PAUSED")
    expect(run.state).toMatchObject({ currentNodeId: "agent", pauseReason: "UNTIL_NODE" })
    expect(run.trace.steps.map((step) => `${step.nodeId}:${step.status}`)).toEqual(["trigger:completed", "condition:completed", "agent:stopped_here"])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("Passo a passo: executa um node por vez e 'Continuar' avança o próximo", async () => {
    const { db } = fakeDatabase({ graph: flagGraph(), flagValue: 1 })
    const first = await startWorkflowSimulation(db, QA_ORGANIZATION, { ...baseInput, mode: "STEP" }, ADMIN_ID)
    expect(first.status).toBe("PAUSED")
    expect(first.state).toMatchObject({ currentNodeId: "condition", pauseReason: "STEP" })
    expect(first.trace.steps).toHaveLength(1)
    const second = await resumeWorkflowSimulation(db, QA_ORGANIZATION, first.id, {})
    expect(second.state).toMatchObject({ currentNodeId: "agent", pauseReason: "STEP" })
    expect(second.trace.steps).toHaveLength(2)
    const rest = await resumeWorkflowSimulation(db, QA_ORGANIZATION, second.id, { mode: "RUN_ALL" })
    expect(rest.status).toBe("COMPLETED")
  })

  it("Action com efeito persistente (SET_CONFIG_VALUE) é simulada: aparece no trace, nunca em org_config_values", async () => {
    const { db, log } = fakeDatabase({ graph: flagGraph({ withConfig: true }), flagValue: 1 })
    const run = await startWorkflowSimulation(db, QA_ORGANIZATION, baseInput, ADMIN_ID)
    expect(run.status).toBe("COMPLETED")
    expect(run.trace.effects.find((effect) => effect.kind === "CONFIG_VALUE")).toMatchObject({ configKey: "ura.alerta", valueType: "BOOLEAN", value: true, nodeId: "config" })
    expect(log.some((entry) => entry.sql.includes("org_config_values"))).toBe(false)
  })

  it("Falha de IA (evidência não literal) é mostrada na etapa certa, sem gravar agent_runs", async () => {
    fetchMock.mockImplementation(async () => geminiResponse(JSON.stringify({ ...JSON.parse(STRUCTURED_REPLY), evidenceFound: "frase inventada" })))
    const { db, log } = fakeDatabase({ graph: flagGraph(), flagValue: 1 })
    const run = await startWorkflowSimulation(db, QA_ORGANIZATION, baseInput, ADMIN_ID)
    expect(run.status).toBe("FAILED")
    expect(run.trace.steps[2]).toMatchObject({ nodeId: "agent", status: "failed" })
    expect(run.trace.steps[2]!.error).toContain("evidência")
    expect(run.errorMessage).toContain("evidência")
    expect(run.trace.effects.find((effect) => effect.kind === "AGENT_RUN")).toMatchObject({ status: "FAILED" })
    expect(log.some((entry) => entry.sql.includes("agent_runs"))).toBe(false)
  })

  it("Chamada sem a flag do workflow: erro claro em vez de execução vazia", async () => {
    const { db } = fakeDatabase({ graph: flagGraph(), flagValue: 1 })
    const original = db.query
    ;(db as { query: unknown }).query = async (sql: string, params?: unknown[]) => {
      if (sql.includes("from interaction_flags f where f.interaction_id = $1 and f.channel_flag_id = $2")) return { rows: [], rowCount: 0 }
      return (original as (sql: string, params?: unknown[]) => Promise<unknown>)(sql, params)
    }
    await expect(startWorkflowSimulation(db, QA_ORGANIZATION, baseInput, ADMIN_ID)).rejects.toMatchObject({ code: "QA_FLAG_MISSING_ON_INTERACTION", message: "Esta interação não possui a Flag VOICE.nota_ura exigida pelo gatilho." })
  })

  it("Agenda relativa ao expediente: calcula o momento a partir da jornada do colaborador; sem jornada → erro claro", async () => {
    const graph: FlowGraph = {
      nodes: [
        { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
        { id: "end", type: "end", label: "Fim", position: { x: 0, y: 1 }, config: {} },
      ],
      edges: [{ id: "e", source: "trigger", sourceHandle: "always", target: "end" }],
    }
    const trigger = { kind: "schedule", mode: "RELATIVE_TO_SHIFT", relative: { anchor: "PERCENTAGE", percentage: 50 }, intervalDays: 1 }
    const withShift = fakeDatabase({ graph, workflow: { trigger_config: trigger }, shift: { start_time: "08:00:00", work_minutes: 480 } })
    const run = await startWorkflowSimulation(
      withShift.db,
      QA_ORGANIZATION,
      { workflowId: WORKFLOW_ID, subject: { kind: "operator", operatorId: OPERATOR_ID }, mode: "RUN_ALL", aiPolicy: "REAL", simulatedNow: "2026-09-14T13:00:00.000Z" },
      ADMIN_ID,
    )
    expect(run.status).toBe("COMPLETED")
    // 08:00 + 50% de 8h = 12:00 em America/Fortaleza (-03) = 15:00Z.
    expect(run.context.trigger).toMatchObject({ mode: "RELATIVE_TO_SHIFT", scheduledFor: "2026-09-14T15:00:00.000Z" })
    expect(run.context.shift).toMatchObject({ startTime: "08:00", workMinutes: 480 })
    expect(run.trace.steps[0]!.nodeOutput).toMatchObject({ employeeId: OPERATOR_ID, elapsedScheduledPercent: 50 })

    const withoutShift = fakeDatabase({ graph, workflow: { trigger_config: trigger }, shift: null })
    await expect(
      startWorkflowSimulation(withoutShift.db, QA_ORGANIZATION, { workflowId: WORKFLOW_ID, subject: { kind: "operator", operatorId: OPERATOR_ID }, mode: "RUN_ALL", aiPolicy: "REAL" }, ADMIN_ID),
    ).rejects.toMatchObject({ code: "QA_SHIFT_MISSING" })
  })

  it("Agenda agregada (Equipe de Supervisor): executa UMA unidade, sem fan-out por operador", async () => {
    const graph: FlowGraph = {
      nodes: [
        { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
        { id: "end", type: "end", label: "Fim", position: { x: 0, y: 1 }, config: {} },
      ],
      edges: [{ id: "e", source: "trigger", sourceHandle: "always", target: "end" }],
    }
    const { db, log } = fakeDatabase({
      graph,
      workflow: { trigger_config: { kind: "schedule", mode: "CALENDAR", times: ["09:00"], intervalDays: 1 } },
      unit: { kind: "SUPERVISOR_TEAM", supervisorId: SUPERVISOR_ID },
    })
    const run = await startWorkflowSimulation(
      db,
      QA_ORGANIZATION,
      {
        workflowId: WORKFLOW_ID,
        subject: { kind: "unit", consolidatedStructure: { kind: "SUPERVISOR_TEAM", supervisorId: SUPERVISOR_ID } },
        mode: "RUN_ALL",
        aiPolicy: "REAL",
        scheduledFor: "2026-09-05T12:00:00.000Z",
      },
      ADMIN_ID,
    )
    expect(run.status).toBe("COMPLETED")
    expect(run.context.unit).toMatchObject({ kind: "SUPERVISOR_TEAM", anchorName: "Carlos", memberCount: 1, measurementsLast30Days: 42, label: "Equipe de Supervisor — Carlos" })
    // Uma única execução (um único qa_run), nunca uma matrícula por operador.
    expect(writes(log)).toEqual(["insert into qa_runs"])
  })

  it("Executar novamente reaproveita o mesmo contexto numa execução nova", async () => {
    const { db, runs } = fakeDatabase({ graph: flagGraph(), flagValue: 4 })
    const first = await startWorkflowSimulation(db, QA_ORGANIZATION, baseInput, ADMIN_ID)
    const again = await startWorkflowSimulation(db, QA_ORGANIZATION, first.input as typeof baseInput, ADMIN_ID)
    expect(again.id).not.toBe(first.id)
    expect(runs.size).toBe(2)
    expect(again.trace.steps.map((step) => step.nodeId)).toEqual(first.trace.steps.map((step) => step.nodeId))
  })
})

describe("QA Lab — Indicador: TRUE / FALSE / SEM DADOS", () => {
  const graph: FlowGraph = {
    nodes: [
      { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
      { id: "meta", type: "condition", label: "Qualidade < 80", position: { x: 0, y: 1 }, config: { comparator: "LT", thresholdNumeric: 80 } },
      { id: "prv", type: "condition", label: "PRV < 80%", position: { x: 0, y: 2 }, config: { comparator: "LT", thresholdNumeric: 80, performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric: "PRV_ACHIEVEMENT" } } },
      { id: "end", type: "end", label: "Fim", position: { x: 0, y: 3 }, config: {} },
    ],
    edges: [
      { id: "e1", source: "trigger", sourceHandle: "always", target: "meta" },
      { id: "e2", source: "meta", sourceHandle: "true", target: "prv" },
      { id: "e3", source: "meta", sourceHandle: "false", target: "end" },
      { id: "e4", source: "prv", sourceHandle: "true", target: "end" },
      { id: "e5", source: "prv", sourceHandle: "false", target: "end" },
      { id: "e6", source: "prv", sourceHandle: "no_data", target: "end" },
    ],
  }
  const trigger = { kind: "indicator", indicatorCode: "QUALIDADE" }
  const input = { workflowId: WORKFLOW_ID, subject: { kind: "measurement" as const, measurementId: "mmmmmmmm-mmmm-4mmm-8mmm-mmmmmmmmmmmm" }, mode: "RUN_ALL" as const, aiPolicy: "REAL" as const }

  it("TRUE: medição 72 < 80 e PRV 78% < 80% — mostra valor atual e meta no contexto", async () => {
    const { db } = fakeDatabase({ graph, workflow: { trigger_config: trigger }, measurementValue: 72, prv: { achievement_percent: "78", quartile: "Q3" } })
    const run = await startWorkflowSimulation(db, QA_ORGANIZATION, input, ADMIN_ID)
    expect(run.status).toBe("COMPLETED")
    expect(run.context.trigger).toMatchObject({ kind: "indicator", value: 72, targetValue: 80, indicatorName: "Qualidade" })
    expect(run.trace.steps.map((step) => `${step.nodeId}:${step.outcome?.branch ?? "-"}`)).toEqual(["trigger:-", "meta:true", "prv:true", "end:-"])
    expect(run.trace.steps[2]!.outcome?.payload?.evaluation).toMatchObject({ kind: "performance", metric: "PRV_ACHIEVEMENT", value: 78, threshold: 80 })
  })

  it("FALSE: medição 85 não é < 80", async () => {
    const { db } = fakeDatabase({ graph, workflow: { trigger_config: trigger }, measurementValue: 85 })
    const run = await startWorkflowSimulation(db, QA_ORGANIZATION, input, ADMIN_ID)
    expect(run.trace.steps.map((step) => `${step.nodeId}:${step.outcome?.branch ?? "-"}`)).toEqual(["trigger:-", "meta:false", "end:-"])
  })

  it("SEM DADOS: sem registro de PRV, a Condition de performance sai pelo ramo no_data (nunca FALSE)", async () => {
    const { db } = fakeDatabase({ graph, workflow: { trigger_config: trigger }, measurementValue: 72, prv: null })
    const run = await startWorkflowSimulation(db, QA_ORGANIZATION, input, ADMIN_ID)
    expect(run.trace.steps.map((step) => `${step.nodeId}:${step.outcome?.branch ?? "-"}`)).toEqual(["trigger:-", "meta:true", "prv:no_data", "end:-"])
    expect(run.trace.steps[2]!.outcome?.payload?.evaluation).toMatchObject({ kind: "performance", value: null })
  })
})

describe("createReadOnlyDatabase — boundary fechada", () => {
  it("deixa leituras passarem e bloqueia qualquer escrita/transação", async () => {
    const seen: string[] = []
    const inner = { query: async (sql: string) => (seen.push(sql), { rows: [], rowCount: 0 }), connect: async () => ({}) } as unknown as Database
    const readOnly = createReadOnlyDatabase(inner)
    await readOnly.query("select 1")
    await readOnly.query("with recursive s as (select 1) select * from s")
    await expect(readOnly.query("insert into alerts values (1)")).rejects.toMatchObject({ code: "QA_WRITE_BLOCKED" })
    await expect(readOnly.query("update workflow_enrollments set status = 'x'")).rejects.toMatchObject({ code: "QA_WRITE_BLOCKED" })
    await expect(readOnly.query("with x as (insert into t values (1) returning id) select * from x")).rejects.toMatchObject({ code: "QA_WRITE_BLOCKED" })
    await expect(readOnly.connect()).rejects.toMatchObject({ code: "QA_WRITE_BLOCKED" })
    expect(seen).toEqual(["select 1", "with recursive s as (select 1) select * from s"])
  })
})

/** Trigger → Condition → Orchestrator → Output: o orquestrador precisa de MAIS de uma request
 * (roteamento → especialista → síntese) — cenário do limite de requests (Parte 62). */
function orchestratorGraph(orchestratorVersionId?: string): FlowGraph {
  return {
    nodes: [
      { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
      { id: "condition", type: "condition", label: "Nota URA < 3", position: { x: 0, y: 1 }, config: { comparator: "LT", thresholdNumeric: 3 } },
      { id: "orch", type: "orchestrator", label: "Analisar chamada", position: { x: 0, y: 2 }, config: { orchestratorId: ORCHESTRATOR_ID, instruction: "Analise a chamada.", ...(orchestratorVersionId ? { orchestratorVersionId } : {}) } },
      { id: "output", type: "output", label: "Publicar", position: { x: 0, y: 3 }, config: { target: { type: "CURRENT_OPERATOR" }, surfaces: ["FOLLOW_UP"], source: "nodeOutputs.orch" } },
      { id: "end", type: "end", label: "Fim", position: { x: 0, y: 4 }, config: {} },
    ],
    edges: [
      { id: "e1", source: "trigger", sourceHandle: "always", target: "condition" },
      { id: "e2", source: "condition", sourceHandle: "true", target: "orch" },
      { id: "e2f", source: "condition", sourceHandle: "false", target: "end" },
      { id: "e3", source: "orch", sourceHandle: "always", target: "output" },
      { id: "e4", source: "output", sourceHandle: "always", target: "end" },
    ],
  }
}

function fetchBodies() {
  return fetchMock.mock.calls.map((call) => JSON.stringify((call as [string, { body?: string }])[1]?.body ?? ""))
}

describe("QA Lab — UMA interação real como massa de teste (Trigger por Flag)", () => {
  it("Flag → Condition → Agent → Output: a interação selecionada É o evento; o Agent recebe a transcrição; o Output simulado carrega a resposta; zero efeito operacional", async () => {
    const { db, log } = fakeDatabase({ graph: flagGraph(), flagValue: 1 })
    const run = await startWorkflowSimulation(db, QA_ORGANIZATION, { ...baseInput, maxAiCalls: 1 }, ADMIN_ID)
    expect(run.status).toBe("COMPLETED")

    // Trigger usa exatamente aquela interação (mesma linha que a ingestão gravaria).
    const session = (run.state as unknown as { session: { enrollment: Record<string, unknown>; evidence: Record<string, unknown>; inputContext: string } }).session
    expect(session.enrollment).toMatchObject({ interaction_id: INTERACTION_ID, matched_flag_name: "nota_ura", matched_value_numeric: "1" })
    expect(session.evidence).toMatchObject({ interactionId: INTERACTION_ID, externalId: "ABC123", operatorId: OPERATOR_ID, flag: { name: "nota_ura", value: 1 }, transcript: { available: true, length: TRANSCRIPT.length } })
    expect(session.inputContext).toBe(TRANSCRIPT)
    // Condition avaliou o valor da flag DESSA interação.
    expect(run.trace.steps[1]!.outcome).toMatchObject({ branch: "true", payload: { evaluation: { kind: "trigger_value", value: 1 } } })
    // Agent recebeu a transcrição como contexto (1 request, exatamente a transcrição da interação).
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchBodies()[0]).toContain("não posso ajudar com isso, tchau")
    expect(run.trace.aiCalls[0]!.input).toBe(TRANSCRIPT)
    expect(run.aiCalls).toBe(1)
    // Output simulado com a resposta do Agent — NÃO PUBLICADO.
    const feedback = run.trace.effects.find((effect) => effect.kind === "FEEDBACK")!
    expect(feedback).toMatchObject({ recommendation: "Ofereça alternativas antes de encerrar.", evidenceFound: "não posso ajudar com isso, tchau" })
    // Contexto do run responde "qual interação testei?" sem a transcrição inteira.
    expect(run.trace.context.interaction).toMatchObject({ id: INTERACTION_ID, externalId: "ABC123", operatorName: "João Silva", durationSeconds: 600, hasTranscript: true, transcriptChangedSinceOriginalRun: false })
    expect(JSON.stringify(run.trace.context)).not.toContain("não posso ajudar com isso")
    expect(writes(log)).toEqual(["insert into qa_runs"])
  })

  it("Limite de requests de IA = 1 com Agent simples: 1 request, resultado e Output disponíveis", async () => {
    const { db } = fakeDatabase({ graph: flagGraph(), flagValue: 1 })
    const run = await startWorkflowSimulation(db, QA_ORGANIZATION, { ...baseInput, maxAiCalls: 1 }, ADMIN_ID)
    expect(run.status).toBe("COMPLETED")
    expect(run.aiCalls).toBe(1)
    expect(run.totalTokens).toBe(1500)
    expect(run.trace.effects.some((effect) => effect.kind === "FEEDBACK")).toBe(true)
    expect(run.trace.effects.some((effect) => effect.kind === "AGENT_RUN" && effect.status === "COMPLETED")).toBe(true)
  })

  it("Orchestrator + limite 1: a primeira request acontece, a segunda é bloqueada, o trace mostra 1/1 com motivo amigável, nenhum side effect", async () => {
    fetchMock.mockImplementation(async () => geminiResponse(JSON.stringify({ candidates: [] })))
    fetchMock
      .mockImplementationOnce(async () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ functionCall: { name: "consultar_indicadores", args: { query: "chamada" } } }] } }], usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 50, totalTokenCount: 550 } }), text: async () => "" }))
    const { db, log } = fakeDatabase({ graph: orchestratorGraph(), flagValue: 1 })
    const run = await startWorkflowSimulation(db, QA_ORGANIZATION, { ...baseInput, maxAiCalls: 1 }, ADMIN_ID)

    expect(run.status).toBe("PAUSED")
    expect(run.state).toMatchObject({ pauseReason: "AI_BUDGET", currentNodeId: "orch" })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(run.aiCalls).toBe(1)
    expect(run.trace.aiCalls.map((call) => call.role)).toEqual(["orchestrator_routing"])
    const step = run.trace.steps.find((item) => item.nodeId === "orch")!
    expect(step.status).toBe("paused_before_ai")
    expect(step.aiCalls).toBe(1)
    expect(step.error).toBe("Limite de requests de IA atingido antes da próxima etapa (utilizado: 1 / 1).")
    expect(writes(log)).toEqual(["insert into qa_runs"])
  })

  // A versão fixada leva o alcance e os especialistas dela para a execução. Rascunho (o QA Lab não passa pela publicação) ou versão
  // publicada antes da conferência da publicação: a etapa falha antes de qualquer especialista ou IA, sem cair na versão atual.
  const PINNED_VERSION_ID = "55555555-5555-4555-8555-555555555555"
  const OTHER_TEAM_ID = "44444444-4444-4444-8444-444444444444"
  const pinnedVersion = (teamId: string) => ({ id: PINNED_VERSION_ID, number: 1, config: { scopeType: "TEAM", teamId, subteamId: null, specialists: [{ agentId: AGENT_ID, toolName: "consultar_indicadores" }] } })

  it("Orchestrator com versão fixada de outro Grupo: a etapa falha com o motivo, sem chamar a IA nem cair na versão atual", async () => {
    const { db, log } = fakeDatabase({ graph: orchestratorGraph(PINNED_VERSION_ID), flagValue: 1, workflow: { scope_type: "TEAM", team_id: TEAM_ID }, orchestratorVersion: pinnedVersion(OTHER_TEAM_ID) })
    const run = await startWorkflowSimulation(db, QA_ORGANIZATION, { ...baseInput, maxAiCalls: 5 }, ADMIN_ID)

    expect(run.status).toBe("FAILED")
    const step = run.trace.steps.find((item) => item.nodeId === "orch")!
    expect(step.status).toBe("failed")
    expect(step.error).toContain("não está disponível para o grupo deste workflow")
    expect(fetchMock).not.toHaveBeenCalled()
    expect(run.aiCalls).toBe(0)
    // Nada dos especialistas da versão foi resolvido (nem a lista atual do Orquestrador).
    expect(log.some((entry) => entry.sql.includes("assistant_orchestrator_specialists") || entry.sql.includes("agent_versions"))).toBe(false)
    expect(writes(log)).toEqual(["insert into qa_runs"])
  })

  it("Orchestrator com versão fixada do mesmo Grupo: executa normalmente com os especialistas da versão", async () => {
    fetchMock.mockImplementation(async () => geminiResponse(JSON.stringify({ candidates: [] })))
    fetchMock
      .mockImplementationOnce(async () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ functionCall: { name: "consultar_indicadores", args: { query: "chamada" } } }] } }], usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 50, totalTokenCount: 550 } }), text: async () => "" }))
    const { db } = fakeDatabase({ graph: orchestratorGraph(PINNED_VERSION_ID), flagValue: 1, workflow: { scope_type: "TEAM", team_id: TEAM_ID }, orchestratorVersion: pinnedVersion(TEAM_ID) })
    const run = await startWorkflowSimulation(db, QA_ORGANIZATION, { ...baseInput, maxAiCalls: 1 }, ADMIN_ID)

    expect(run.status).toBe("PAUSED")
    expect(run.state).toMatchObject({ pauseReason: "AI_BUDGET", currentNodeId: "orch" })
    expect(run.trace.aiCalls.map((call) => call.role)).toEqual(["orchestrator_routing"])
  })

  it("Parar antes da IA com interação selecionada: Trigger e Condition avaliados, evidência visível, IA não chamada, 0 tokens", async () => {
    const { db } = fakeDatabase({ graph: flagGraph(), flagValue: 1 })
    const run = await startWorkflowSimulation(db, QA_ORGANIZATION, { ...baseInput, aiPolicy: "STOP_BEFORE_AI" }, ADMIN_ID)
    expect(run.status).toBe("PAUSED")
    expect(run.trace.steps.map((step) => `${step.nodeId}:${step.status}`)).toEqual(["trigger:completed", "condition:completed", "agent:paused_before_ai"])
    expect(run.trace.steps[2]!.error).toBe("Execução pausada antes da request de IA (política \"Parar antes da IA\").")
    expect(fetchMock).not.toHaveBeenCalled()
    expect(run.aiCalls).toBe(0)
    expect(run.totalTokens).toBe(0)
    expect(run.trace.context.interaction).toMatchObject({ externalId: "ABC123", flag: { name: "nota_ura", value: 1 }, hasTranscript: true })
  })

  it("Executar até a Condition: valida interação, flag e ramo sem chamar IA", async () => {
    const { db } = fakeDatabase({ graph: flagGraph(), flagValue: 1 })
    const run = await startWorkflowSimulation(db, QA_ORGANIZATION, { ...baseInput, mode: "UNTIL_NODE", untilNodeId: "agent" }, ADMIN_ID)
    expect(run.status).toBe("PAUSED")
    expect(run.trace.steps.map((step) => `${step.nodeId}:${step.status}`)).toEqual(["trigger:completed", "condition:completed", "agent:stopped_here"])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("interação sem transcrição + IA real num workflow com Agent: aviso claro antes de gastar tokens; com 'Parar antes da IA' continua testável", async () => {
    const { db } = fakeDatabase({ graph: flagGraph(), flagValue: 1, withoutTranscript: true })
    await expect(startWorkflowSimulation(db, QA_ORGANIZATION, baseInput, ADMIN_ID)).rejects.toMatchObject({ code: "QA_TRANSCRIPT_REQUIRED" })
    expect(fetchMock).not.toHaveBeenCalled()
    const run = await startWorkflowSimulation(db, QA_ORGANIZATION, { ...baseInput, aiPolicy: "STOP_BEFORE_AI" }, ADMIN_ID)
    expect(run.status).toBe("PAUSED")
    expect(run.trace.context.interaction).toMatchObject({ hasTranscript: false })
  })

  it("Executar novamente esta versão reutiliza a MESMA interação e transcrição congeladas", async () => {
    const { db, runs } = fakeDatabase({ graph: flagGraph(), flagValue: 1 })
    const first = await startWorkflowSimulation(db, QA_ORGANIZATION, { ...baseInput, aiPolicy: "STOP_BEFORE_AI" }, ADMIN_ID)
    const { previousRunOf } = await import("./workflow-simulation-service.js")
    const previous = previousRunOf(runs.get(first.id)!)!
    expect(previous.frozen).toMatchObject({ evidence: { interactionId: INTERACTION_ID }, inputContext: TRANSCRIPT })
    const rerun = await startWorkflowSimulation(db, QA_ORGANIZATION, first.input as typeof baseInput, ADMIN_ID, previous)
    expect(rerun.context.workflow).toMatchObject({ rerunOfSnapshot: true })
    expect(rerun.trace.context.interaction).toMatchObject({ id: INTERACTION_ID, transcriptChangedSinceOriginalRun: false })
  })

  it("prompts/entradas exibidos no QA Lab passam por redação de segredos técnicos", async () => {
    // Chave inventada montada em tempo de execução: o formato literal de uma chave do Google no código acionaria qualquer
    // scanner de segredos (Gitleaks/Conviso) — auditoria AppSec 29/10/2026.
    const FAKE_GOOGLE_KEY = ["AIza", "SyA123", "x".repeat(29)].join("")
    const { redactSecrets } = await import("./run-workflow-simulation.js")
    expect(redactSecrets(`chave ${FAKE_GOOGLE_KEY} no prompt`)).toBe("chave [REDIGIDO] no prompt")
    expect(redactSecrets("Authorization: Bearer abcdefghijklmnopqrstuvwxyz")).toBe("Authorization: [REDIGIDO]")
    expect(redactSecrets("Operador: bom dia, protocolo 123456789012")).toBe("Operador: bom dia, protocolo 123456789012")
  })
})
