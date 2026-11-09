import type { Database } from "../../../infrastructure/database/pool.js"
import { AiCallBlockedError, createLlmTelemetryStore, runWithLlmTelemetry } from "../../../shared/application/llm-telemetry.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { runAgent } from "../../agents/application/run-agent.js"
import { resolveAgentDraftForTest } from "../../agents/application/agent-versions.js"
import { buildSpecialistInput } from "../../assistant/application/run-specialist-tool.js"
import type { AgentSimulationInput, QaStep, QaTrace } from "../domain/qa-run-schema.js"
import { getQaRun, insertQaRun, type QaRunRecord } from "./qa-run-repository.js"
import { createReadOnlyDatabase } from "./read-only-database.js"
import { describeError, resolveAgentNames, resolvePeople, resolveRetrievalAgentNames } from "./run-workflow-simulation.js"
import { SimulationEffectSink } from "./simulation-effect-sink.js"


/** Tenta ler a resposta como JSON (agentes configurados pra Structured Output respondem só
 * JSON) — best-effort, nunca lança; texto livre continua texto livre. */
export function tryParseStructured(text: string | null): Record<string, unknown> | null {
  if (!text) return null
  try {
    const parsed: unknown = JSON.parse(text.trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim())
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * Teste isolado de UM Agent (Parte 11/12): só ele — nenhum Orchestrator, nenhum Workflow,
 * nenhum efeito. Roda pelo mesmo `runAgent` de produção, com banco somente-leitura e o
 * registrador de execuções em memória (nada em agent_runs). Opcionalmente com o mesmo contexto
 * de operador que um especialista recebe em produção.
 */
export async function runAgentSimulation(db: Database, organizationId: string, input: AgentSimulationInput, executedBy: string): Promise<QaRunRecord> {
  const readDb = createReadOnlyDatabase(db)
  const agentRow = await readDb.query<{ id: string; name: string; agent_type: string; objective: string; active: boolean; current_version_id: string | null }>(
    `select id, name, agent_type, objective, active, current_version_id from agents where id = $1 and organization_id = $2`,
    [input.agentId, organizationId],
  )
  const agent = agentRow.rows[0]
  if (!agent) throw new DomainError("Agente não encontrado.", "AGENT_NOT_FOUND", 404)

  const knowledge = await readDb.query<{ id: string; title: string }>(
    `select kd.id, kd.title from agent_knowledge_documents akd join knowledge_documents kd on kd.id = akd.knowledge_document_id where akd.agent_id = $1 and kd.deleted_at is null order by kd.title`,
    [input.agentId],
  )

  const startedAt = Date.now()
  const sink = new SimulationEffectSink()
  const store = createLlmTelemetryStore({ policy: input.aiPolicy, maxCalls: input.maxAiCalls ?? null })
  const inputContext = input.operatorId ? await buildSpecialistInput(readDb, organizationId, input.operatorId, input.input) : input.input

  const step: QaStep = {
    index: 1,
    nodeId: "agent",
    nodeType: "agent",
    label: agent.name,
    status: "completed",
    startedAt: new Date(startedAt).toISOString(),
    simulatedNow: new Date(startedAt).toISOString(),
    durationMs: 0,
    outcome: null,
    aiCalls: 0,
    totalTokens: 0,
  }
  let errorMessage: string | null = null
  let outputText: string | null = null
  let supportMaterials: unknown = undefined
  let toolTrace: unknown = undefined
  let investigationSummary: unknown = undefined

  try {
    if (!agent.active) throw new DomainError("Este agente está inativo — ative-o antes de testar.", "AGENT_INACTIVE", 422)
    // Com um operador escolhido, o Agent investiga com as Tools sobre ELE (sujeito definido pelo QA,
    // nunca pelo modelo) — exatamente como em produção.
    // Nunca publicado: o rascunho lido aqui é o que executa (a execução não relê o rascunho).
    const target = agent.current_version_id ? { kind: "VERSION" as const } : { kind: "DRAFT" as const, config: (await resolveAgentDraftForTest(readDb, organizationId, input.agentId)).config }
    const run = await runWithLlmTelemetry(store, () => runAgent(readDb, { organizationId, agentId: input.agentId, inputContext, source: "QA_SIMULATION", recorder: sink.agentRuns, subject: input.operatorId ? { operatorId: input.operatorId } : null, target }))
    outputText = run.outputText
    supportMaterials = run.supportMaterials ?? (run.workflowResult ? run.workflowResult.supportMaterials : undefined)
    toolTrace = run.toolTrace
    investigationSummary = run.investigation
    if (run.status === "FAILED") {
      step.status = "failed"
      errorMessage = run.errorMessage ?? "Falha ao executar o agente."
      step.error = errorMessage
    }
  } catch (error) {
    if (error instanceof AiCallBlockedError) {
      step.status = "paused_before_ai"
      step.error = error.message
    } else {
      step.status = "failed"
      errorMessage = describeError(error)
      step.error = errorMessage
    }
  }
  step.durationMs = Date.now() - startedAt
  step.aiCalls = store.calls.length
  step.totalTokens = store.calls.reduce((total, call) => total + (call.totalTokens ?? 0), 0)
  step.outcome = { kind: step.status === "completed" ? "complete" : step.status }
  step.nodeOutput = outputText !== null ? { text: outputText, structured: tryParseStructured(outputText), supportMaterials: supportMaterials ?? [], ...(toolTrace ? { toolTrace, investigation: investigationSummary } : {}) } : undefined

  const people = await resolvePeople(readDb, input.operatorId ? [input.operatorId] : [])
  const trace: QaTrace = {
    steps: [step],
    effects: sink.effects,
    aiCalls: await resolveAgentNames(readDb, store.calls),
    knowledgeRetrievals: await resolveRetrievalAgentNames(readDb, store.knowledge),
    people,
    context: {
      agent: { id: agent.id, name: agent.name, agentType: agent.agent_type, objective: agent.objective, active: agent.active },
      knowledgeDocuments: knowledge.rows,
      operator: input.operatorId ? (people[input.operatorId] ?? null) : null,
      inputContext,
    },
  }
  const status = step.status === "completed" ? "COMPLETED" : step.status === "paused_before_ai" ? "PAUSED" : "FAILED"
  const id = await insertQaRun(db, {
    organizationId,
    executedBy,
    resourceType: "AGENT",
    resourceId: agent.id,
    resourceName: agent.name,
    status,
    input,
    context: trace.context,
    state: null,
    trace,
    durationMs: step.durationMs,
    errorMessage,
  })
  return (await getQaRun(db, organizationId, id))!
}
