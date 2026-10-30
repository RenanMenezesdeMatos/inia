import { Router } from "express"
import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { recordPersonalDataAccess } from "../../data-lifecycle/application/personal-data-access-log.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import {
  agentSimulationInputSchema,
  orchestratorSimulationInputSchema,
  qaRunDecisionSchema,
  qaRunResumeSchema,
  workflowSimulationInputSchema,
} from "../domain/qa-run-schema.js"
import { getQaRun, listQaRuns, listQaRunsSchema } from "../application/qa-run-repository.js"
import { runAgentSimulation } from "../application/run-agent-simulation.js"
import { runOrchestratorSimulation } from "../application/run-orchestrator-simulation.js"
import {
  findInteractions,
  findInteractionsSchema,
  findMeasurements,
  findMeasurementsSchema,
  listOperatorsSchema,
  listPeople,
  previewConditionForOperators,
  previewConditionSchema,
} from "../application/test-data-finders.js"
import { resumeWorkflowSimulation, previousRunOf, startWorkflowSimulation, submitSimulatedDecision } from "../application/workflow-simulation-service.js"
import { findCompatibleInteractions, findCompatibleInteractionsSchema, getInteractionDetail } from "../application/interaction-evidence.js"
import { loadWorkflowForSimulation } from "../application/build-simulated-enrollment.js"
import { sessionUser } from "../../auth/presentation/session-user.js"

const NOT_FOUND = { error: { code: "QA_RUN_NOT_FOUND", message: "Execução de QA não encontrada." } }

/**
 * Endpoints do QA Lab — TODOS montados atrás de `requireGlobalAdmin` (ver app.ts): um admin
 * de grupo, um supervisor ou um usuário comum recebe 403 aqui antes de qualquer handler rodar,
 * inclusive nas rotas de leitura (nunca serve pra descobrir Agents/Workflows/chamadas).
 * Quem executou fica gravado em qa_runs.executed_by (auditoria mínima, Parte 54).
 */
export function createQaLabRouter(db: Database) {
  const router = Router()

  // ---- Massa de teste (consultas determinísticas, zero IA) ----
  router.get("/test-data/interactions", async (request, response) => {
    const input = findInteractionsSchema.parse(request.query)
    response.json({ data: await findInteractions(db, sessionUser(request).organizationId, input) })
  })

  // Interações compatíveis com o gatilho de UM workflow, colaborador-first (Parte 6/7 da massa
  // por interação): flag + canal + Abrangência + Filtro Populacional + período, paginado.
  router.get("/test-data/workflows/:workflowId/interactions", async (request, response) => {
    const workflowId = z.string().uuid().parse(request.params.workflowId)
    const input = findCompatibleInteractionsSchema.parse(request.query)
    const workflow = await loadWorkflowForSimulation(db, sessionUser(request).organizationId, workflowId)
    if (!workflow) return response.status(404).json({ error: { code: "WORKFLOW_NOT_FOUND", message: "Workflow não encontrado." } })
    response.json({ data: await findCompatibleInteractions(db, sessionUser(request).organizationId, workflow, input) })
  })

  // Detalhe + transcrição persistida (só leitura; nunca chama IA, nunca reprocessa áudio). A
  // transcrição é dado sensível: só sai por aqui, atrás de requireGlobalAdmin, no corpo da
  // resposta (nunca em URL/log/erro).
  router.get("/test-data/interactions/:id", async (request, response) => {
    const id = z.string().uuid().parse(request.params.id)
    const detail = await getInteractionDetail(db, sessionUser(request).organizationId, id)
    if (!detail) return response.status(404).json({ error: { code: "QA_INTERACTION_NOT_FOUND", message: "Interação não encontrada." } })
    // LGPD: quem abriu a transcrição da chamada de outra pessoa (migration 151).
    if (detail.operatorId) await recordPersonalDataAccess(db, { organizationId: sessionUser(request).organizationId, viewerPersonId: sessionUser(request).personId, subjectPersonId: detail.operatorId, dataKind: "CALL_TRANSCRIPT", resourceId: id })
    response.json({ data: detail })
  })

  router.get("/test-data/measurements", async (request, response) => {
    const input = findMeasurementsSchema.parse(request.query)
    response.json({ data: await findMeasurements(db, sessionUser(request).organizationId, input) })
  })

  router.get("/test-data/people", async (request, response) => {
    const input = listOperatorsSchema.parse(request.query)
    response.json({ data: await listPeople(db, sessionUser(request).organizationId, input) })
  })

  router.post("/test-data/condition-preview", async (request, response) => {
    const input = previewConditionSchema.parse(request.body)
    const result = await previewConditionForOperators(db, sessionUser(request).organizationId, input)
    response.json({ data: { nodeId: result.node.id, label: result.node.label, rows: result.rows } })
  })

  // ---- Execuções ----
  router.post("/runs/workflow", async (request, response) => {
    const input = workflowSimulationInputSchema.parse(request.body)
    const run = await startWorkflowSimulation(db, sessionUser(request).organizationId, input, sessionUser(request).personId)
    response.status(201).json({ data: run })
  })

  router.post("/runs/agent", async (request, response) => {
    const input = agentSimulationInputSchema.parse(request.body)
    const run = await runAgentSimulation(db, sessionUser(request).organizationId, input, sessionUser(request).personId)
    response.status(201).json({ data: run })
  })

  router.post("/runs/orchestrator", async (request, response) => {
    const input = orchestratorSimulationInputSchema.parse(request.body)
    const run = await runOrchestratorSimulation(db, sessionUser(request).organizationId, input, sessionUser(request).personId)
    response.status(201).json({ data: run })
  })

  // Histórico de QA — filtros e paginação no padrão das listagens administrativas (list-query.ts).
  router.get("/runs", async (request, response) => {
    const input = listQaRunsSchema.parse(request.query)
    response.json({ data: await listQaRuns(db, sessionUser(request).organizationId, request.query, input) })
  })

  router.get("/runs/:id", async (request, response) => {
    const run = await getQaRun(db, sessionUser(request).organizationId, request.params.id!)
    if (!run) return response.status(404).json(NOT_FOUND)
    response.json({ data: run })
  })

  router.post("/runs/:id/resume", async (request, response) => {
    const input = qaRunResumeSchema.parse(request.body ?? {})
    const run = await resumeWorkflowSimulation(db, sessionUser(request).organizationId, request.params.id!, input)
    response.json({ data: run })
  })

  router.post("/runs/:id/decision", async (request, response) => {
    const input = qaRunDecisionSchema.parse(request.body)
    const run = await submitSimulatedDecision(db, sessionUser(request).organizationId, request.params.id!, input.decision, sessionUser(request).personId, input.employeeId)
    response.json({ data: run })
  })

  // "Executar novamente esta versão" (Parte 26 do hardening): reexecuta EXATAMENTE o snapshot
  // congelado no QA Run original (rascunho ou publicada da época) — reprodutível mesmo que o
  // Workflow tenha sido editado, publicado ou excluído depois. Sempre uma execução NOVA (a
  // anterior fica intacta no histórico). Agent/Orchestrator reexecutam com a mesma entrada.
  router.post("/runs/:id/rerun", async (request, response) => {
    const previous = await getQaRun(db, sessionUser(request).organizationId, request.params.id!)
    if (!previous) return response.status(404).json(NOT_FOUND)
    const executedBy = sessionUser(request).personId
    let run
    switch (previous.resourceType) {
      case "WORKFLOW": {
        const previousRun = previousRunOf(previous)
        if (!previousRun) {
          throw new DomainError("Esta execução antiga não guardou o snapshot da configuração — use \"Testar rascunho atual\".", "QA_RUN_WITHOUT_SNAPSHOT", 422)
        }
        run = await startWorkflowSimulation(db, sessionUser(request).organizationId, workflowSimulationInputSchema.parse(previous.input), executedBy, previousRun)
        break
      }
      case "AGENT":
        run = await runAgentSimulation(db, sessionUser(request).organizationId, agentSimulationInputSchema.parse(previous.input), executedBy)
        break
      case "ORCHESTRATOR":
        run = await runOrchestratorSimulation(db, sessionUser(request).organizationId, orchestratorSimulationInputSchema.parse(previous.input), executedBy)
        break
      default:
        throw new DomainError("Tipo de recurso desconhecido.", "QA_RESOURCE_UNKNOWN", 422)
    }
    response.status(201).json({ data: run })
  })

  // "Testar rascunho atual" — ação explicitamente DIFERENTE do rerun: mesmo contexto (sujeito,
  // relógio, modo, IA), mas contra o rascunho como está AGORA no editor. Nunca misturada com o
  // rerun do snapshot (Parte 26/27).
  router.post("/runs/:id/rerun-current", async (request, response) => {
    const previous = await getQaRun(db, sessionUser(request).organizationId, request.params.id!)
    if (!previous) return response.status(404).json(NOT_FOUND)
    if (previous.resourceType !== "WORKFLOW") {
      throw new DomainError("\"Testar rascunho atual\" só se aplica a execuções de Workflow.", "QA_RUN_NOT_WORKFLOW", 422)
    }
    const input = workflowSimulationInputSchema.parse({ ...previous.input, graphSource: "DRAFT" })
    response.status(201).json({ data: await startWorkflowSimulation(db, sessionUser(request).organizationId, input, sessionUser(request).personId) })
  })

  return router
}
