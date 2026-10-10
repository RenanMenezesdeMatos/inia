import type { Database } from "../../../infrastructure/database/pool.js"
import { AiCallBlockedError, createLlmTelemetryStore, runWithLlmTelemetry } from "../../../shared/application/llm-telemetry.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { resolveOrchestratorById } from "../../assistant/application/resolve-orchestrator.js"
import { runOrchestratedReply, type OrchestratedReply } from "../../assistant/application/run-orchestrated-reply.js"
import type { OrchestratorSimulationInput, QaStep, QaTrace } from "../domain/qa-run-schema.js"
import { getQaRun, insertQaRun, type QaRunRecord } from "./qa-run-repository.js"
import { createReadOnlyDatabase } from "./read-only-database.js"
import { describeError, resolveAgentNames, resolvePeople, resolveRetrievalAgentNames } from "./run-workflow-simulation.js"


/**
 * Teste isolado de UM Orchestrator (Parte 13/14): mesma resolução e execução do caminho
 * interativo e do node de Workflow (`resolveOrchestratorById` + `runOrchestratedReply`), sem
 * gravar interação de chat nem publicar nada. O trace vira "Entrada → Orchestrator → Agent A →
 * Agent B → Síntese", com tokens por etapa (etiquetados via withLlmScope no caminho real).
 */
export async function runOrchestratorSimulation(db: Database, organizationId: string, input: OrchestratorSimulationInput, executedBy: string): Promise<QaRunRecord> {
  const readDb = createReadOnlyDatabase(db)
  const orchestratorRow = await readDb.query<{ id: string; name: string; active: boolean; invocation_mode: string }>(
    `select id, name, active, invocation_mode from assistant_orchestrators where id = $1 and organization_id = $2`,
    [input.orchestratorId, organizationId],
  )
  const row = orchestratorRow.rows[0]
  if (!row) throw new DomainError("Orquestrador não encontrado.", "ORCHESTRATOR_NOT_FOUND", 404)

  const startedAt = Date.now()
  const store = createLlmTelemetryStore({ policy: input.aiPolicy, maxCalls: input.maxAiCalls ?? null })
  const steps: QaStep[] = []
  let errorMessage: string | null = null
  let reply: OrchestratedReply | null = null
  let available: { agentId: string; toolName: string; name: string }[] = []
  let finalStatus: "completed" | "paused_before_ai" | "failed" = "completed"

  const t0 = new Date(startedAt).toISOString()
  const baseStep = (index: number, nodeId: string, label: string): QaStep => ({
    index,
    nodeId,
    nodeType: nodeId,
    label,
    status: "completed",
    startedAt: t0,
    simulatedNow: t0,
    durationMs: 0,
    outcome: null,
    aiCalls: 0,
    totalTokens: 0,
  })

  try {
    if (!row.active) throw new DomainError("Este orquestrador está inativo — ative-o antes de testar.", "ORCHESTRATOR_INACTIVE", 422)
    const orchestrator = await resolveOrchestratorById(readDb, organizationId, input.orchestratorId, input.invocationContext, input.instruction)
    if (!orchestrator) {
      throw new DomainError(
        `Este orquestrador não está habilitado para o contexto "${input.invocationContext}" (modo de invocação: ${row.invocation_mode}).`,
        "ORCHESTRATOR_INVOCATION_MODE_MISMATCH",
        422,
      )
    }
    const names = await readDb.query<{ id: string; name: string }>(`select id, name from agents where id = any($1::uuid[])`, [orchestrator.specialists.map((s) => s.agentId)])
    const nameById = new Map(names.rows.map((r) => [r.id, r.name]))
    available = orchestrator.specialists.map((specialist) => ({ ...specialist, name: nameById.get(specialist.agentId) ?? specialist.toolName }))

    reply = await runWithLlmTelemetry(store, () =>
      runOrchestratedReply(readDb, orchestrator, [{ role: "user", text: input.instruction }], input.extraContext ?? "", input.operatorId),
    )
  } catch (error) {
    if (error instanceof AiCallBlockedError) {
      finalStatus = "paused_before_ai"
      errorMessage = null
    } else {
      finalStatus = "failed"
      errorMessage = describeError(error)
    }
  }

  // Monta o trace a partir das chamadas etiquetadas (roteamento → especialistas → síntese).
  const calls = store.calls
  const tokens = (role: string, agentId?: string | null) =>
    calls.filter((call) => call.role === role && (agentId === undefined || call.agentId === agentId)).reduce((total, call) => total + (call.totalTokens ?? 0), 0)
  const count = (role: string, agentId?: string | null) => calls.filter((call) => call.role === role && (agentId === undefined || call.agentId === agentId)).length

  steps.push({ ...baseStep(1, "input", "Entrada"), nodeOutput: { instruction: input.instruction, extraContext: input.extraContext ?? null } })
  const routing = baseStep(2, "orchestrator_routing", `${row.name} — roteamento`)
  routing.aiCalls = count("orchestrator_routing")
  routing.totalTokens = tokens("orchestrator_routing")
  routing.nodeOutput = reply ? { calls: reply.calls } : undefined
  steps.push(routing)
  if (reply) {
    reply.results.forEach((result, index) => {
      const step = baseStep(steps.length + 1, `specialist:${result.toolName}`, available.find((a) => a.toolName === result.toolName)?.name ?? result.toolName)
      step.nodeType = "specialist"
      step.aiCalls = count("specialist", result.agentId)
      step.totalTokens = tokens("specialist", result.agentId)
      step.nodeOutput = { query: reply!.calls[index]?.query ?? null, text: result.text, agentId: result.agentId, contract: result.contract ?? "TEXT", ...(result.structured ? { structured: result.structured } : {}), ...(result.supportMaterialCandidates ? { supportMaterialCandidates: result.supportMaterialCandidates } : {}), ...(result.toolTrace ? { toolTrace: result.toolTrace, investigation: result.investigation } : {}) }
      steps.push(step)
    })
    const synthesis = baseStep(steps.length + 1, "orchestrator_synthesis", "Síntese final")
    synthesis.aiCalls = count("orchestrator_synthesis")
    synthesis.totalTokens = tokens("orchestrator_synthesis")
    // Validação do resultado estruturado (definição nova): o QA Lab mostra "válido ✓" com os
    // campos rotulados, ou "inválido" com os motivos — nunca só o JSON cru.
    // Materiais de apoio: candidatos agregados × recomendados pelo Orquestrador (ao lado do rastro
    // de conhecimento, nunca dentro do resultado estruturado).
    synthesis.nodeOutput = {
      text: reply.text,
      structuredResult: reply.structuredResult,
      supportMaterialCandidates: reply.supportMaterialCandidates,
      supportMaterials: reply.supportMaterials ?? [],
      ...(reply.supportMaterialsRejected ? { supportMaterialsRejected: reply.supportMaterialsRejected } : {}),
      ...(reply.structuredResultValidation ? { structuredResultValidation: reply.structuredResultValidation } : {}),
    }
    steps.push(synthesis)
  }
  const last = steps[steps.length - 1]!
  if (finalStatus !== "completed") {
    last.status = finalStatus
    if (errorMessage) last.error = errorMessage
    if (finalStatus === "paused_before_ai") last.error = "Execução pausada antes da chamada de IA."
  }
  const durationMs = Date.now() - startedAt
  last.durationMs = durationMs

  const trace: QaTrace = {
    steps,
    effects: [],
    aiCalls: await resolveAgentNames(readDb, calls),
    knowledgeRetrievals: await resolveRetrievalAgentNames(readDb, store.knowledge),
    people: await resolvePeople(readDb, [input.operatorId]),
    context: {
      orchestrator: { id: row.id, name: row.name, invocationMode: row.invocation_mode, invocationContext: input.invocationContext },
      availableSpecialists: available,
      operatorId: input.operatorId,
      reply,
    },
  }
  const id = await insertQaRun(db, {
    organizationId,
    executedBy,
    resourceType: "ORCHESTRATOR",
    resourceId: row.id,
    resourceName: row.name,
    status: finalStatus === "completed" ? "COMPLETED" : finalStatus === "paused_before_ai" ? "PAUSED" : "FAILED",
    input,
    context: trace.context,
    state: null,
    trace,
    durationMs,
    errorMessage,
  })
  return (await getQaRun(db, organizationId, id))!
}
