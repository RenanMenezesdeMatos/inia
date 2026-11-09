import { buildReviewPresentation } from "../../pending-actions/domain/review-presentation.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import {
  AiCallBlockedError,
  createLlmTelemetryStore,
  type KnowledgeRetrievalRecord,
  runWithLlmTelemetry,
  type LlmCallRecord,
  type LlmTelemetryStore,
} from "../../../shared/application/llm-telemetry.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { buildEmployeeFanInOutput, type EmployeeFanInChild } from "../../workflows/application/consolidate-results-executor.js"
import { processNode, type EnrollmentRow, type WorkflowScope } from "../../workflows/application/node-handlers.js"
import { resolveSource } from "../../workflows/application/output-executor.js"
import { findNode, type FlowGraph } from "../../workflows/domain/graph-schema.js"
import type { EmployeeRun, QaEffect, QaPerson, QaStep, QaTrace, WorkflowRunMode, WorkflowSimulationState, WorkflowSnapshot } from "../domain/qa-run-schema.js"
import type { InteractionEvidence } from "./interaction-evidence.js"
import { createReadOnlyDatabase } from "./read-only-database.js"
import { SimulationEffectSink } from "./simulation-effect-sink.js"

export type SimulationOptions = {
  mode: WorkflowRunMode
  untilNodeId: string | null
  aiPolicy: "REAL" | "STOP_BEFORE_AI"
  maxAiCalls: number | null
}

export type SimulationSession = {
  graph: FlowGraph
  workflow: WorkflowScope
  /** Linha-base do enrollment simulado (origem/flag/medição/sujeito) — o estado mutável
   * (node atual, outputs, variáveis, status) vive em `state`. */
  enrollment: EnrollmentRow
  inputContext: string
  state: WorkflowSimulationState
  effects: QaEffect[]
  aiCalls: LlmCallRecord[]
  /** Ausente em runs anteriores a esta telemetria existir. */
  knowledgeRetrievals?: KnowledgeRetrievalRecord[] | undefined
  steps: QaStep[]
  /** Configuração congelada no "Executar" (ver WorkflowSnapshot) — ausente só em runs antigos. */
  snapshot?: WorkflowSnapshot | undefined
  /** Trigger por Flag: a interação usada como evento (ver interaction-evidence.ts). */
  evidence?: InteractionEvidence | undefined
  /** Fan-out simulado (EMPLOYEE_COLLECTION) — 1 item por colaborador, ausente até "Aplicar
   * individualmente" rodar pela primeira vez. */
  employeeRuns?: EmployeeRun[] | undefined
}

function sumTokens(calls: LlmCallRecord[]): number {
  return calls.reduce((total, call) => total + (call.totalTokens ?? 0), 0)
}

function mergeOutput(state: WorkflowSimulationState, nodeId: string, nodeOutput: unknown, variableUpdate?: { variableId: string; value: unknown }) {
  if (nodeOutput !== undefined) state.nodeOutputs = { ...state.nodeOutputs, [nodeId]: nodeOutput }
  if (variableUpdate) state.variables = { ...state.variables, [variableUpdate.variableId]: variableUpdate.value }
}

/**
 * O loop de execução propriamente dito — extraído pra ser reutilizável tanto pro trace principal
 * quanto por CADA sub-trace de "Aplicar individualmente" (fan-out simulado, EMPLOYEE_COLLECTION):
 * mesma lógica de sempre, só que operando sobre um `state`/`steps` próprios (nunca o de
 * `session` direto), com um `enrollmentBase` próprio (pra cada colaborador do fan-out ter seu
 * `scheduled_subject_id`). `store`/`sink` continuam os MESMOS em toda chamada (mesmo dentro de
 * um fan-out) — é isso que faz o orçamento de IA ficar naturalmente compartilhado entre
 * "filhos" (Parte 49/50 do pedido), sem nenhum código extra.
 */
async function runNodeLoop(
  readDb: Database,
  sink: SimulationEffectSink,
  store: LlmTelemetryStore,
  graph: FlowGraph,
  workflow: WorkflowScope,
  inputContext: string,
  enrollmentBase: EnrollmentRow,
  state: WorkflowSimulationState,
  steps: QaStep[],
  options: SimulationOptions,
  employeeRuns: EmployeeRun[],
): Promise<void> {
  let iterations = 0
  for (;;) {
    iterations += 1
    if (iterations > 200) {
      state.status = "failed"
      steps.push(failedStep(steps, state, state.currentNodeId, "Simulação interrompida: mais de 200 nodes executados (possível ciclo no grafo)."))
      break
    }
    const node = findNode(graph, state.currentNodeId)
    if (!node) {
      state.status = "failed"
      steps.push(failedStep(steps, state, state.currentNodeId, `Node "${state.currentNodeId}" não existe neste grafo.`))
      break
    }
    // "Executar até aqui" — para ANTES de rodar o node escolhido (Parte 37: Conditions
    // testadas, zero chamadas de IA). Aplica igualmente dentro de cada sub-trace do fan-out —
    // "executar até Human Review", por exemplo, pausa CADA colaborador no seu próprio node.
    if (options.mode === "UNTIL_NODE" && options.untilNodeId === node.id && state.status !== "waiting") {
      state.status = "paused"
      state.pauseReason = "UNTIL_NODE"
      steps.push({
        index: steps.length + 1,
        nodeId: node.id,
        nodeType: node.type,
        label: node.label,
        status: "stopped_here",
        startedAt: new Date().toISOString(),
        simulatedNow: state.simulatedNow,
        durationMs: 0,
        outcome: null,
        aiCalls: 0,
        totalTokens: 0,
      })
      break
    }

    sink.beginNode(node.id)
    const enrollment: EnrollmentRow = {
      ...enrollmentBase,
      current_node_id: state.currentNodeId,
      status: state.status === "waiting" ? "waiting" : "active",
      node_outputs: state.nodeOutputs,
      variables: state.variables,
      revision: state.revision,
    }
    const startedAt = new Date()
    const callsBefore = store.calls.length
    const step: QaStep = {
      index: steps.length + 1,
      nodeId: node.id,
      nodeType: node.type,
      label: node.label,
      status: "completed",
      startedAt: startedAt.toISOString(),
      simulatedNow: state.simulatedNow,
      durationMs: 0,
      outcome: null,
      aiCalls: 0,
      totalTokens: 0,
    }

    let outcome
    try {
      outcome = await processNode({ db: readDb, graph, enrollment, workflow, inputContext, now: new Date(state.simulatedNow), effects: sink }, node)
    } catch (error) {
      const newCalls = store.calls.slice(callsBefore)
      step.durationMs = Date.now() - startedAt.getTime()
      step.aiCalls = newCalls.length
      step.totalTokens = sumTokens(newCalls)
      if (error instanceof AiCallBlockedError) {
        step.status = "paused_before_ai"
        step.error = error.message
        state.status = "paused"
        state.pauseReason = error.reason === "STOP_BEFORE_AI" ? "AI_BLOCKED" : "AI_BUDGET"
      } else {
        step.status = "failed"
        step.error = describeError(error)
        state.status = "failed"
      }
      steps.push(step)
      break
    }

    const newCalls = store.calls.slice(callsBefore)
    step.durationMs = Date.now() - startedAt.getTime()
    step.aiCalls = newCalls.length
    step.totalTokens = sumTokens(newCalls)

    if (outcome.kind === "advance") {
      step.outcome = { kind: "advance", eventType: outcome.eventType, nextNodeId: outcome.nextNodeId, ...(outcome.eventPayload ? { payload: outcome.eventPayload } : {}), ...(typeof outcome.eventPayload?.branch === "string" ? { branch: outcome.eventPayload.branch } : {}) }
      if (outcome.nodeOutput !== undefined) step.nodeOutput = outcome.nodeOutput
      mergeOutput(state, node.id, outcome.nodeOutput, outcome.variableUpdate)
      state.currentNodeId = outcome.nextNodeId
      state.status = "active"
      state.pauseReason = null
      state.resumeAt = null
      state.revision += 1
      steps.push(step)
      if (options.mode === "STEP") {
        state.status = "paused"
        state.pauseReason = "STEP"
        break
      }
      continue
    }

    if (outcome.kind === "wait") {
      step.status = "waiting"
      step.outcome = { kind: "wait", eventType: outcome.eventType, ...(outcome.eventPayload ? { payload: outcome.eventPayload } : {}) }
      state.status = "waiting"
      state.pauseReason = node.type === "human_review" ? "HUMAN_REVIEW" : "WAIT"
      state.resumeAt = node.type === "human_review" ? null : outcome.nextEvalAt.toISOString()
      state.revision += 1
      steps.push(step)
      break
    }

    if (outcome.kind === "complete") {
      step.outcome = { kind: "complete", ...(outcome.eventPayload ? { payload: outcome.eventPayload } : {}) }
      if (outcome.nodeOutput !== undefined) step.nodeOutput = outcome.nodeOutput
      mergeOutput(state, node.id, outcome.nodeOutput, outcome.variableUpdate)
      state.status = "completed"
      state.pauseReason = null
      state.resumeAt = null
      state.revision += 1
      steps.push(step)
      break
    }

    if (outcome.kind === "fan_out") {
      // "Aplicar individualmente" simulado (Parte 47/48 do pedido de EMPLOYEE_COLLECTION) — NUNCA
      // cria workflow_enrollments/Human Review/Output/Pendência reais (mesmo `sink` simulado de
      // sempre). Cada colaborador ganha seu PRÓPRIO state/steps, mas roda sob o MESMO
      // store/sink — orçamento de IA global, zero side effect real, automáticos por
      // construção (nunca trocamos o sink/store aqui).
      step.outcome = { kind: "fan_out", eventType: "fan_out_completed", nextNodeId: outcome.nextNodeId, payload: { childCount: outcome.memberIds.length, memberIds: outcome.memberIds } }
      steps.push(step)
      state.revision += 1
      // Sequencial (nunca paralelo) — reprodutibilidade determinística de quem consome o
      // orçamento de IA compartilhado primeiro (Parte 49/50: João consome, depois Maria,
      // depois Pedro pausa se o orçamento já acabou).
      for (const employeeId of outcome.memberIds) {
        const employeeState: WorkflowSimulationState = {
          currentNodeId: outcome.nextNodeId,
          status: "active",
          pauseReason: null,
          resumeAt: null,
          nodeOutputs: {},
          variables: {},
          simulatedNow: state.simulatedNow,
          revision: 0,
        }
        const employeeSteps: QaStep[] = []
        // `parent_enrollment_id` não-nulo é o único sinal que "consolidate_results" usa pra saber
        // que esta é uma execução FILHA chegando na barreira (registra chegada, termina) — nunca
        // o PAI checando prontidão (fan-in/JOIN, ver processNode's case "consolidate_results").
        const employeeEnrollment: EnrollmentRow = {
          ...enrollmentBase,
          scheduled_subject_id: employeeId,
          interaction_id: null,
          indicator_measurement_id: null,
          parent_enrollment_id: enrollmentBase.id,
          parent_node_outputs: state.nodeOutputs,
        }
        await runNodeLoop(readDb, sink, store, graph, workflow, inputContext, employeeEnrollment, employeeState, employeeSteps, options, employeeRuns)
        employeeRuns.push({ employeeId, fanOutNodeId: outcome.fanOutNodeId, state: employeeState, steps: employeeSteps })
      }
      if (!outcome.joinNodeId) {
        // Sem "Consolidar resultados" pareado — comportamento legado intacto (Parte 35/80 do
        // pedido de fan-in/JOIN: regressão zero, cada filho termina sozinho).
        state.status = "completed"
        state.pauseReason = null
        state.resumeAt = null
        break
      }
      // Join pareado — o trace principal NÃO completa: segue pro Join (mesmo node id) e reentra
      // no loop, que vai chamar processNode nele — como este `state` é o PAI (nunca ganhou
      // parent_enrollment_id), processNode devolve `join_check`, tratado logo abaixo.
      state.currentNodeId = outcome.joinNodeId
      continue
    }

    if (outcome.kind === "join_check") {
      // Prontidão da barreira (fan-in/JOIN) — os filhos já rodaram (sequencialmente, acima), sob
      // o MESMO store/sink; "pronto" é conferir se todos chegaram a um estado terminal (Parte 14).
      // Filtra só os filhos DESTE fan-out — `employeeRuns` é um único array acumulado pela sessão
      // inteira (nunca resetado entre fan-outs sequenciais — Parte 38/84), misturar com um
      // fan-out anterior já resolvido contaria filho errado no resultado consolidado. Array vazio
      // (0 filhos) é `true` por vacuidade — resolve 0 filhos de graça (Parte 26/77).
      const ownChildren = employeeRuns.filter((run) => run.fanOutNodeId === outcome.fanOutNodeId)
      const ready = ownChildren.every((run) => run.state.status === "completed" || run.state.status === "failed")
      if (!ready) {
        step.status = "waiting"
        step.outcome = { kind: "join_check", eventType: "consolidate_results_waiting", nextNodeId: outcome.nextNodeId }
        steps.push(step)
        state.status = "waiting"
        state.pauseReason = "FAN_IN"
        state.resumeAt = null
        state.revision += 1
        break
      }
      const fanInChildren: EmployeeFanInChild[] = ownChildren.map((run) => {
        const failedStep = run.state.status === "failed" ? [...run.steps].reverse().find((s) => s.status === "failed") : undefined
        return {
          employeeId: run.employeeId,
          childEnrollmentId: run.employeeId,
          status: run.state.status === "failed" ? "failed" : "completed",
          nodeOutputs: run.state.nodeOutputs,
          ...(failedStep?.error ? { failureReason: failedStep.error } : {}),
        }
      })
      const fanInOutput = buildEmployeeFanInOutput(outcome.fanOutNodeId, ownChildren.length, fanInChildren, new Date(state.simulatedNow))
      step.outcome = { kind: "advance", eventType: "consolidate_results_completed", nextNodeId: outcome.nextNodeId, payload: { expectedCount: fanInOutput.expectedCount, completedCount: fanInOutput.completedCount, failedCount: fanInOutput.failedCount } }
      step.nodeOutput = fanInOutput
      steps.push(step)
      mergeOutput(state, node.id, fanInOutput)
      state.currentNodeId = outcome.nextNodeId
      state.status = "active"
      state.pauseReason = null
      state.resumeAt = null
      state.revision += 1
      if (options.mode === "STEP") {
        state.status = "paused"
        state.pauseReason = "STEP"
        break
      }
      continue
    }

    step.status = "failed"
    step.error = outcome.message
    step.outcome = { kind: "fail" }
    state.status = "failed"
    steps.push(step)
    break
  }
}

/** Prepara o `readDb`/`sink`/`store` de sempre (orçamento de IA carregando as chamadas já
 * feitas) e devolve os efeitos/chamadas resultantes pra `session` — extraído pra ser
 * reaproveitado tanto pelo trace principal quanto por retomar/decidir UM sub-trace específico
 * do fan-out (nunca duas implementações desse setup). */
async function withSimulationRuntime(
  db: Database,
  session: SimulationSession,
  options: SimulationOptions,
  run: (readDb: Database, sink: SimulationEffectSink, store: LlmTelemetryStore) => Promise<void>,
): Promise<void> {
  const readDb = createReadOnlyDatabase(db)
  const sink = new SimulationEffectSink(session.effects)
  const store: LlmTelemetryStore = createLlmTelemetryStore({ policy: options.aiPolicy, maxCalls: options.maxAiCalls })
  store.calls.push(...session.aiCalls)
  store.knowledge.push(...(session.knowledgeRetrievals ?? []))
  await runWithLlmTelemetry(store, () => run(readDb, sink, store))
  session.effects = sink.effects
  session.aiCalls = store.calls
  session.knowledgeRetrievals = store.knowledge
}

/**
 * O loop do QA Lab — o MESMO `processNode` do motor de produção (node-handlers.ts), só que
 * o estado do enrollment fica em memória e os efeitos vão pro `SimulationEffectSink`. Nada de
 * `workflow_enrollments`/`workflow_enrollment_events`: o que em produção é `applyOutcome`
 * (engine.ts) aqui é `mergeOutput` + avanço do `state`. Executa até: terminar, falhar, um
 * Wait/Human Review pausar, a política de IA bloquear, ou o modo (passo a passo / até o node X)
 * mandar parar. Retomar é chamar de novo com o mesmo `session` — SÓ o trace principal; se o
 * fan-out já aconteceu, o trace principal já está `completed` e retomar por aqui não faz
 * sentido (ver `runEmployeeNodeLoop` pra retomar/decidir um colaborador específico).
 */
export async function runSimulationLoop(db: Database, session: SimulationSession, options: SimulationOptions): Promise<void> {
  await withSimulationRuntime(db, session, options, async (readDb, sink, store) => {
    const employeeRuns = session.employeeRuns ?? []
    await runNodeLoop(readDb, sink, store, session.graph, session.workflow, session.inputContext, session.enrollment, session.state, session.steps, options, employeeRuns)
    session.employeeRuns = employeeRuns
  })
}

/**
 * Retoma/decide especificamente UM sub-trace do fan-out simulado (Parte 63/64 do pedido) — cada
 * colaborador pausa/retoma de forma independente (aprovar o João nunca decide o da Maria), sob
 * o MESMO orçamento de IA da sessão inteira (o `store` aqui carrega as mesmas chamadas já
 * feitas, de qualquer sub-trace). Nunca reprocessa o trace principal (já `completed` desde que o
 * fan-out aconteceu).
 */
export async function runEmployeeNodeLoop(db: Database, session: SimulationSession, employeeId: string, options: SimulationOptions): Promise<EmployeeRun> {
  const employeeRun = session.employeeRuns?.find((run) => run.employeeId === employeeId)
  if (!employeeRun) throw new DomainError(`Colaborador "${employeeId}" não faz parte de nenhuma coleção desta simulação.`, "QA_RUN_EMPLOYEE_NOT_FOUND", 404)
  await withSimulationRuntime(db, session, options, async (readDb, sink, store) => {
    // `parent_enrollment_id` precisa continuar presente ao RETOMAR — se este colaborador decidido
    // avançar naturalmente até um "Consolidar resultados" (fan-in/JOIN) dentro deste mesmo loop
    // (Human Review decidida -> advance -> Join, tudo na mesma chamada), processNode precisa
    // continuar reconhecendo que é um FILHO chegando na barreira (`complete`), nunca o PAI
    // checando prontidão (`join_check`) — mesmo sinal usado no fan-out original (session.enrollment.id).
    const employeeEnrollment: EnrollmentRow = {
      ...session.enrollment,
      scheduled_subject_id: employeeId,
      interaction_id: null,
      indicator_measurement_id: null,
      parent_enrollment_id: session.enrollment.id,
      parent_node_outputs: session.state.nodeOutputs,
    }
    await runNodeLoop(readDb, sink, store, session.graph, session.workflow, session.inputContext, employeeEnrollment, employeeRun.state, employeeRun.steps, options, session.employeeRuns ?? [])
  })
  return employeeRun
}

function failedStep(steps: QaStep[], state: WorkflowSimulationState, nodeId: string, message: string): QaStep {
  return {
    index: steps.length + 1,
    nodeId,
    nodeType: "unknown",
    label: nodeId,
    status: "failed",
    startedAt: new Date().toISOString(),
    simulatedNow: state.simulatedNow,
    durationMs: 0,
    outcome: { kind: "fail" },
    aiCalls: 0,
    totalTokens: 0,
    error: message,
  }
}

export function describeError(error: unknown): string {
  if (error instanceof DomainError) return error.message
  if (error instanceof Error) return error.message
  return "Erro desconhecido."
}

/** Human Review pendente — quem revisaria (alertas simulados desse node), instrução e conteúdo. */
/** Extraído de `pendingReviewFor` pra ser reaproveitado por CADA sub-trace do fan-out
 * (`state`/`effects` de um `EmployeeRun`, nunca só o trace principal — Parte 46/48 do pedido de
 * EMPLOYEE_COLLECTION: cada colaborador tem seu próprio Human Review pendente, independente). */
function pendingReviewForState(graph: FlowGraph, effects: QaEffect[], state: WorkflowSimulationState): QaTrace["pendingReview"] {
  if (state.status !== "waiting" || state.pauseReason !== "HUMAN_REVIEW") return null
  const node = findNode(graph, state.currentNodeId)
  if (!node || node.type !== "human_review") return null
  const reviewerIds = effects
    .filter((effect): effect is Extract<QaEffect, { kind: "ALERT" }> => effect.kind === "ALERT" && effect.nodeId === node.id && effect.alertType === "WORKFLOW_HUMAN_REVIEW")
    .map((effect) => effect.recipientId)
  const content = node.config.contentSource ? resolveSource(state.nodeOutputs, node.config.contentSource, state.variables) : undefined
  return { nodeId: node.id, reviewerIds: [...new Set(reviewerIds)], instruction: node.config.instruction ?? null, content: content ?? null, presentation: buildReviewPresentation(content) }
}

export function pendingReviewFor(session: SimulationSession): QaTrace["pendingReview"] {
  return pendingReviewForState(session.graph, session.effects, session.state)
}

export { pendingReviewForState }

/** Nomes/cargos de todas as pessoas citadas no trace (destinatários, operador, revisores) —
 * resolvidos de uma vez, só leitura, pra UI nunca mostrar UUID cru. */
export async function resolvePeople(db: Database, ids: Iterable<string>): Promise<Record<string, QaPerson>> {
  const unique = [...new Set([...ids].filter((id) => /^[0-9a-f-]{36}$/i.test(id)))]
  if (unique.length === 0) return {}
  const result = await db.query<{ id: string; name: string; role: string; team_name: string | null }>(
    `select p.id, p.name, p.role, t.name team_name from people p left join teams t on t.id = p.team_id where p.id = any($1::uuid[])`,
    [unique],
  )
  return Object.fromEntries(result.rows.map((row) => [row.id, { id: row.id, name: row.name, role: row.role, teamName: row.team_name }]))
}

/**
 * Defesa em profundidade pro "Ver contexto/prompt enviado" (Parte 30/31): a API key vai no
 * header (nunca no corpo), mas se algum prompt/base de conhecimento carregar um segredo técnico
 * por engano, ele não chega ao trace persistido nem à tela. Só padrões inequívocos de credencial
 * — nunca mascara dado operacional (transcrição, nomes, números).
 */
const SECRET_PATTERNS: RegExp[] = [
  /AIza[0-9A-Za-z_-]{30,}/g, // Google API key
  /sk-[A-Za-z0-9_-]{20,}/g, // chaves estilo OpenAI/Anthropic
  /Bearer\s+[A-Za-z0-9._~+/=-]{16,}/gi,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWT
  /(api[_-]?key|authorization|secret|token|password)\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{12,}/gi,
]

export function redactSecrets(text: string): string {
  return SECRET_PATTERNS.reduce((current, pattern) => current.replace(pattern, "[REDIGIDO]"), text)
}

async function loadAgentNames(db: Database, items: { agentId: string | null }[]): Promise<Map<string, string>> {
  const ids = [...new Set(items.map((item) => item.agentId).filter((id): id is string => Boolean(id)))]
  const names = new Map<string, string>()
  if (ids.length > 0) {
    const result = await db.query<{ id: string; name: string }>(`select id, name from agents where id = any($1::uuid[])`, [ids])
    for (const row of result.rows) names.set(row.id, row.name)
  }
  return names
}

export async function resolveAgentNames(db: Database, calls: LlmCallRecord[]): Promise<(LlmCallRecord & { agentName: string | null })[]> {
  const names = await loadAgentNames(db, calls)
  return calls.map((call) => ({
    ...call,
    systemPrompt: redactSecrets(call.systemPrompt),
    input: redactSecrets(call.input),
    outputText: call.outputText === null ? null : redactSecrets(call.outputText),
    agentName: call.agentId ? (names.get(call.agentId) ?? null) : null,
  }))
}

/** Mesma resolução de nome pros retrievals de KB (ver `LlmTelemetryStore.knowledge`). */
export async function resolveRetrievalAgentNames(
  db: Database,
  retrievals: KnowledgeRetrievalRecord[],
): Promise<(KnowledgeRetrievalRecord & { agentName: string | null })[]> {
  const names = await loadAgentNames(db, retrievals)
  return retrievals.map((retrieval) => ({ ...retrieval, agentName: retrieval.agentId ? (names.get(retrieval.agentId) ?? null) : null }))
}

export function peopleIdsFromEffects(effects: QaEffect[]): string[] {
  const ids: string[] = []
  for (const effect of effects) {
    if (effect.kind === "ALERT" || effect.kind === "WORKFLOW_OUTPUT") ids.push(effect.recipientId)
    if (effect.kind === "FEEDBACK") ids.push(effect.operatorId)
  }
  return ids
}

/** Ids dos membros de toda coleção produzida por um "Selecionar colaboradores" no trace — pra UI
 * mostrar nome/cargo em vez de UUID cru na "COLEÇÃO DE COLABORADORES" (nunca só o `nodeOutput`
 * cru, que só tem ids estáveis por desenho, ver select-employees-executor.ts). */
export function peopleIdsFromSteps(steps: QaStep[]): string[] {
  const ids: string[] = []
  for (const step of steps) {
    if (step.nodeType !== "select_employees") continue
    const output = step.nodeOutput as { memberIds?: unknown } | undefined
    if (output && Array.isArray(output.memberIds)) ids.push(...output.memberIds.filter((id): id is string => typeof id === "string"))
  }
  return ids
}
