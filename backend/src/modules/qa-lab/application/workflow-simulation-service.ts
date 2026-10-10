import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import type { EnrollmentRow, WorkflowScope } from "../../workflows/application/node-handlers.js"
import { flowGraphSchema, type HumanReviewDecision } from "../../workflows/domain/graph-schema.js"
import type { PersistedWorkflowState, QaTrace, WorkflowSimulationInput, WorkflowSimulationState, WorkflowSnapshot } from "../domain/qa-run-schema.js"
import { buildSimulatedEnrollment, captureWorkflowSnapshot, loadWorkflowForSimulation, resolveSimulationGraph, rowFromSnapshot, type FrozenEvidence } from "./build-simulated-enrollment.js"
import { graphNeedsTranscript } from "./interaction-evidence.js"
import { getQaRun, insertQaRun, statusFromState, updateQaRun, type QaRunRecord } from "./qa-run-repository.js"
import { createReadOnlyDatabase } from "./read-only-database.js"
import {
  peopleIdsFromEffects,
  peopleIdsFromSteps,
  pendingReviewFor,
  pendingReviewForState,
  resolveAgentNames,
  resolveRetrievalAgentNames,
  resolvePeople,
  runEmployeeNodeLoop,
  runSimulationLoop,
  type SimulationOptions,
  type SimulationSession,
} from "./run-workflow-simulation.js"

type ResumeInput = {
  aiPolicy?: SimulationOptions["aiPolicy"] | undefined
  maxAiCalls?: number | null | undefined
  mode?: SimulationOptions["mode"] | undefined
  untilNodeId?: string | null | undefined
  employeeId?: string | undefined
}

async function buildTrace(db: Database, session: SimulationSession, context: Record<string, unknown>, extraPeopleIds: string[]): Promise<QaTrace> {
  const readDb = createReadOnlyDatabase(db)
  const pendingReview = pendingReviewFor(session)
  // Fan-out simulado (Parte 48 do pedido) — 1 sub-trace por colaborador, cada um com seu
  // próprio Human Review pendente (se houver), nunca misturado com o do trace principal.
  const employeeRuns = (session.employeeRuns ?? []).map((run) => ({
    employeeId: run.employeeId,
    steps: run.steps,
    status: run.state.status,
    pendingReview: pendingReviewForState(session.graph, session.effects, run.state),
  }))
  const employeeReviewerIds = employeeRuns.flatMap((run) => run.pendingReview?.reviewerIds ?? [])
  const people = await resolvePeople(readDb, [
    ...extraPeopleIds,
    ...peopleIdsFromEffects(session.effects),
    ...(pendingReview?.reviewerIds ?? []),
    ...employeeRuns.map((run) => run.employeeId),
    ...employeeReviewerIds,
    ...peopleIdsFromSteps(session.steps),
    ...employeeRuns.flatMap((run) => peopleIdsFromSteps(run.steps)),
  ])
  return {
    steps: session.steps,
    effects: session.effects,
    aiCalls: await resolveAgentNames(readDb, session.aiCalls),
    knowledgeRetrievals: await resolveRetrievalAgentNames(readDb, session.knowledgeRetrievals ?? []),
    people,
    context,
    pendingReview: pendingReview ?? null,
    ...(employeeRuns.length > 0 ? { employeeRuns } : {}),
  }
}

function persistedState(session: SimulationSession, options: SimulationOptions): PersistedWorkflowState {
  return {
    ...session.state,
    session: {
      graph: session.graph,
      workflow: session.workflow,
      enrollment: session.enrollment,
      inputContext: session.inputContext,
      options,
      ...(session.snapshot ? { snapshot: session.snapshot } : {}),
      ...(session.evidence ? { evidence: session.evidence } : {}),
      ...(session.employeeRuns ? { employeeRuns: session.employeeRuns } : {}),
    },
  }
}

/** O que uma reexecução reaproveita do QA Run original: o Workflow congelado e, em Trigger por
 * Flag, a mesma interação/transcrição. */
export type PreviousRun = { snapshot: WorkflowSnapshot; frozen?: FrozenEvidence | undefined }

/**
 * Inicia uma simulação de Workflow (Parte 15-24): UM workflow, UM contexto, UMA execução.
 * `fromSnapshot` (rerun histórico) reexecuta exatamente a configuração congelada de um QA Run
 * anterior — sem reler o Workflow atual; sem ele, captura um snapshot novo do rascunho atual ou
 * da versão publicada, conforme `input.graphSource` (rascunho por padrão — publicar nunca é
 * pré-requisito pra testar, e o QA Lab jamais publica por conta própria).
 */
export async function startWorkflowSimulation(db: Database, organizationId: string, input: WorkflowSimulationInput, executedBy: string, previous?: PreviousRun): Promise<QaRunRecord> {
  const readDb = createReadOnlyDatabase(db)
  const fromSnapshot = previous?.snapshot
  const row = fromSnapshot ? rowFromSnapshot(fromSnapshot) : await loadWorkflowForSimulation(readDb, organizationId, input.workflowId)
  if (!row) throw new DomainError("Workflow não encontrado.", "WORKFLOW_NOT_FOUND", 404)
  const { graph, source } = resolveSimulationGraph(row, fromSnapshot ? fromSnapshot.workflowState : input.graphSource)
  const snapshot = fromSnapshot ?? captureWorkflowSnapshot(row, graph, source, new Date())
  const simulatedNow = input.simulatedNow ? new Date(input.simulatedNow) : new Date()
  const simulated = await buildSimulatedEnrollment(
    readDb,
    organizationId,
    row,
    graph,
    input.subject,
    { simulatedNow, scheduledFor: input.scheduledFor ? new Date(input.scheduledFor) : null },
    previous?.frozen,
  )
  // Aviso cedo, nunca "erro inesperado" (Parte 17/51): uma request de IA sem transcrição seria
  // inútil e consumiria tokens — com "Parar antes da IA" ou "Executar até" as etapas anteriores
  // continuam testáveis.
  if (simulated.evidence && !simulated.evidence.transcript.available && input.aiPolicy === "REAL" && graphNeedsTranscript(graph)) {
    throw new DomainError(
      "Este Workflow necessita de transcrição e esta interação não possui uma disponível. Escolha outra interação ou use \"Parar antes da IA\" para testar as etapas anteriores.",
      "QA_TRANSCRIPT_REQUIRED",
      422,
    )
  }
  const options: SimulationOptions = { mode: input.mode, untilNodeId: input.untilNodeId ?? null, aiPolicy: input.aiPolicy, maxAiCalls: input.maxAiCalls ?? null }
  const state: WorkflowSimulationState = {
    currentNodeId: simulated.enrollment.current_node_id,
    status: "active",
    pauseReason: null,
    resumeAt: null,
    nodeOutputs: {},
    variables: {},
    simulatedNow: simulatedNow.toISOString(),
    revision: 0,
  }
  const session: SimulationSession = {
    graph,
    workflow: simulated.workflow,
    enrollment: simulated.enrollment,
    inputContext: simulated.inputContext,
    state,
    effects: [],
    aiCalls: [],
    steps: [],
    snapshot,
    ...(simulated.evidence ? { evidence: simulated.evidence } : {}),
  }
  const startedAt = Date.now()
  await runSimulationLoop(db, session, options)
  const context = {
    ...simulated.context,
    workflow: {
      id: row.id,
      name: row.name,
      workflowState: snapshot.workflowState,
      graphSource: source,
      versionId: snapshot.versionId,
      graphChecksum: snapshot.graphChecksum,
      capturedAt: snapshot.capturedAt,
      rerunOfSnapshot: Boolean(fromSnapshot),
      triggerKind: simulated.trigger.kind,
    },
  }
  const trace = await buildTrace(db, session, context, simulated.personIds)
  const id = await insertQaRun(db, {
    organizationId,
    executedBy,
    resourceType: "WORKFLOW",
    resourceId: row.id,
    resourceName: row.name,
    status: statusFromState(state),
    input: { ...input, graphSource: source },
    context,
    state: persistedState(session, options),
    trace,
    durationMs: Date.now() - startedAt,
    errorMessage: state.status === "failed" ? (session.steps[session.steps.length - 1]?.error ?? "Falha na simulação.") : null,
  })
  return (await getQaRun(db, organizationId, id))!
}

/** Snapshot congelado de um QA Run de Workflow — null pra runs antigos (anteriores ao snapshot). */
export function snapshotOfRun(run: QaRunRecord): WorkflowSnapshot | null {
  const persisted = run.state as PersistedWorkflowState | null
  return persisted?.session?.snapshot ?? null
}

/** Tudo que "Executar novamente esta versão" reaproveita — snapshot do Workflow e, em Trigger
 * por Flag, a interação + transcrição congeladas (ausente em runs anteriores à evidência). */
export function previousRunOf(run: QaRunRecord): PreviousRun | null {
  const persisted = run.state as PersistedWorkflowState | null
  const session = persisted?.session
  if (!session?.snapshot) return null
  return {
    snapshot: session.snapshot,
    ...(session.evidence ? { frozen: { evidence: session.evidence, inputContext: session.inputContext } } : {}),
  }
}

function restoreSession(run: QaRunRecord): { session: SimulationSession; options: SimulationOptions } {
  const persisted = run.state as PersistedWorkflowState | null
  if (run.resourceType !== "WORKFLOW" || !persisted?.session) {
    throw new DomainError("Esta execução de QA não é uma simulação de Workflow retomável.", "QA_RUN_NOT_RESUMABLE", 422)
  }
  const { session: stored, ...state } = persisted
  const session: SimulationSession = {
    // Sempre o grafo congelado na sessão — nunca relê o Workflow atual numa retomada (passo a
    // passo, Human Review, Wait, "até o node"): edições posteriores no editor não entram aqui.
    graph: flowGraphSchema.parse(stored.graph),
    workflow: stored.workflow as WorkflowScope,
    enrollment: stored.enrollment as unknown as EnrollmentRow,
    inputContext: stored.inputContext,
    state,
    effects: run.trace.effects,
    aiCalls: run.trace.aiCalls,
    steps: run.trace.steps,
    ...(stored.snapshot ? { snapshot: stored.snapshot } : {}),
    ...(stored.evidence ? { evidence: stored.evidence } : {}),
    // Sub-traces do fan-out (Parte 52 do pedido) — restaurados exatamente como ficaram
    // gravados (state + steps por colaborador), nunca recalculados numa retomada.
    ...(stored.employeeRuns ? { employeeRuns: stored.employeeRuns } : {}),
  }
  return { session, options: stored.options }
}

/** `employeeId` presente = continua só o sub-trace daquele colaborador (fan-out simulado, Parte
 * 63/64 do pedido) — nunca o trace principal, que já está `completed` desde que o fan-out
 * aconteceu. O status/erro reportados pro qa_run inteiro continuam refletindo o trace principal
 * (badge geral); o detalhe por colaborador vive em `trace.employeeRuns` — simplificação
 * documentada, nenhum "status agregado" é inventado nesta versão. */
async function continueRun(db: Database, organizationId: string, run: QaRunRecord, session: SimulationSession, options: SimulationOptions, employeeId?: string): Promise<QaRunRecord> {
  const startedAt = Date.now()
  let errorSteps = session.steps
  let errorStatus = session.state.status
  if (employeeId) {
    const employeeRun = await runEmployeeNodeLoop(db, session, employeeId, options)
    errorSteps = employeeRun.steps
    errorStatus = employeeRun.state.status
    // Liberar "Consolidar resultados" quando a última execução pendente termina (Parte 15/52 do
    // pedido de fan-in/JOIN): o trace principal pode estar parado em FAN_IN esperando exatamente
    // este colaborador. Reavalia a barreira agora — reentra no MESMO loop do trace principal
    // (mesmo store/sink acumulados via session.aiCalls/effects); se ainda faltar alguém, volta a
    // ficar "waiting"/FAN_IN sem efeito nenhum (idempotente).
    if (session.state.status === "waiting" && session.state.pauseReason === "FAN_IN") {
      await runSimulationLoop(db, session, options)
      errorSteps = session.steps
      errorStatus = session.state.status
    }
  } else {
    await runSimulationLoop(db, session, options)
  }
  const trace = await buildTrace(db, session, run.context, Object.keys(run.trace.people))
  await updateQaRun(db, organizationId, run.id, {
    status: statusFromState(session.state),
    state: persistedState(session, options),
    trace,
    durationMs: Date.now() - startedAt,
    errorMessage: errorStatus === "failed" ? (errorSteps[errorSteps.length - 1]?.error ?? "Falha na simulação.") : null,
  })
  return (await getQaRun(db, organizationId, run.id))!
}

/**
 * Retoma uma simulação pausada: após um Wait ("Avançar N e continuar" — o relógio simulado
 * pula pro fim da espera, Parte 35), após um passo (Parte 36), após "Executar até aqui" (Parte
 * 37) ou após uma pausa de IA (trocando a política/orçamento, Parte 38/40).
 */
/** Acha o `state` a operar — o trace principal (sempre que `employeeId` está ausente) ou o
 * sub-trace daquele colaborador dentro do fan-out simulado (Parte 63/64 do pedido). Lança se o
 * colaborador não existir em nenhuma coleção desta simulação. */
function targetState(session: SimulationSession, employeeId: string | undefined): WorkflowSimulationState {
  if (!employeeId) return session.state
  const employeeRun = session.employeeRuns?.find((run) => run.employeeId === employeeId)
  if (!employeeRun) throw new DomainError(`Colaborador "${employeeId}" não faz parte de nenhuma coleção desta simulação.`, "QA_RUN_EMPLOYEE_NOT_FOUND", 404)
  return employeeRun.state
}

export async function resumeWorkflowSimulation(db: Database, organizationId: string, runId: string, input: ResumeInput): Promise<QaRunRecord> {
  const run = await getQaRun(db, organizationId, runId)
  if (!run) throw new DomainError("Execução de QA não encontrada.", "QA_RUN_NOT_FOUND", 404)
  const { session, options: stored } = restoreSession(run)
  const state = targetState(session, input.employeeId)
  if (state.status === "completed" || state.status === "failed") {
    throw new DomainError("Esta simulação já terminou — use \"Executar novamente\".", "QA_RUN_FINISHED", 409)
  }
  if (state.status === "waiting" && state.pauseReason === "HUMAN_REVIEW") {
    throw new DomainError("Esta simulação está aguardando uma decisão de revisão humana (aprovar/reprovar/escalar).", "QA_RUN_AWAITING_DECISION", 409)
  }
  if (state.status === "waiting" && state.resumeAt) {
    // Wait: o motor só avança quando `now >= nextEvalAt`; aqui o relógio simulado pula direto.
    state.simulatedNow = state.resumeAt
  } else {
    state.status = "active"
    state.pauseReason = null
  }
  const options: SimulationOptions = {
    mode: input.mode ?? (stored.mode === "UNTIL_NODE" && input.untilNodeId === undefined ? "RUN_ALL" : stored.mode),
    untilNodeId: input.untilNodeId === undefined ? (input.mode === "UNTIL_NODE" ? stored.untilNodeId : null) : input.untilNodeId,
    aiPolicy: input.aiPolicy ?? stored.aiPolicy,
    maxAiCalls: input.maxAiCalls === undefined ? stored.maxAiCalls : input.maxAiCalls,
  }
  if (options.mode === "UNTIL_NODE" && !options.untilNodeId) options.mode = "RUN_ALL"
  return continueRun(db, organizationId, run, session, options, input.employeeId)
}

/** Decisão do Human Review SIMULADO (Parte 31) — grava `decision` em memória exatamente como a
 * rota real grava em node_outputs, e continua só a execução de QA. Nunca cria Pendência.
 * `employeeId` presente = decide o sub-trace daquele colaborador (fan-out simulado — Parte 25/63
 * do pedido): aprovar o João nunca decide o da Maria/Pedro, cada um independente. */
export async function submitSimulatedDecision(
  db: Database,
  organizationId: string,
  runId: string,
  decision: HumanReviewDecision,
  reviewerId: string,
  employeeId?: string,
): Promise<QaRunRecord> {
  const run = await getQaRun(db, organizationId, runId)
  if (!run) throw new DomainError("Execução de QA não encontrada.", "QA_RUN_NOT_FOUND", 404)
  const { session, options } = restoreSession(run)
  const state = targetState(session, employeeId)
  if (state.status !== "waiting" || state.pauseReason !== "HUMAN_REVIEW") {
    throw new DomainError("Esta simulação não está aguardando decisão de revisão humana.", "QA_RUN_NOT_AWAITING_DECISION", 409)
  }
  state.nodeOutputs = { ...state.nodeOutputs, [state.currentNodeId]: { decision, reviewerId, decidedAt: new Date().toISOString(), simulated: true } }
  state.status = "active"
  state.pauseReason = null
  return continueRun(db, organizationId, run, session, { ...options, mode: options.mode === "STEP" ? "STEP" : "RUN_ALL", untilNodeId: null }, employeeId)
}
