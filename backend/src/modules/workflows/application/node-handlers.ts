import type { Database } from "../../../infrastructure/database/pool.js"
import { actionExecutors } from "./action-executors.js"
import { comparatorMatches, evaluateDataCondition, evaluateGenericComparator, type ConditionSubject, type EvaluationOptions } from "./condition-evaluator.js"
import { assertNodeMatchesIndicatorCatalog } from "./indicator-graph-guard.js"
import type { WorkflowEffectSink } from "./effect-sink.js"
import { resolveEnrollmentOperatorId } from "./enrollment-subject.js"
import { resolveContextValue } from "./execution-context.js"
import { resolveStructureAnchorOperatorIds } from "./hierarchy-subjects.js"
import { notifyHumanReviewPending } from "./human-review-executor.js"
import { resolveOrganizationTimezone } from "./organization-timezone.js"
import { executeOrchestrator, executeOrchestratorConsolidated } from "./orchestrator-executor.js"
import { executeSynthesisAgent } from "./synthesis-agent-executor.js"
import { withWorkflowAgent } from "./workflow-agent-version.js"
import { priorChainDelivery } from "./workflow-retry.js"
import { executeOutput } from "./output-executor.js"
import { executeInterventionPolicyNode } from "./intervention-policy-executor.js"
import { localDateParts } from "./schedule-recurrence.js"
import { resolveSelectionCandidates, runEmployeeRanking, runEmployeeSelection, type EmployeeCollectionOutput } from "./select-employees-executor.js"
import { elapsedScheduledPercent, resolveShiftWindow } from "./shift-schedule.js"
import { resolveEligibleOperatorIds, type WorkflowPopulation } from "./workflow-eligibility.js"
import { consolidatedStructureAnchorId, type ConsolidatedStructure } from "../domain/consolidated-structure-schema.js"
import {
  findEdge,
  findPrecedingCollectionNode,
  findPrecedingFanOutNode,
  findPrecedingJoinNode,
  findPairedJoinNode,
  resolveNodeContexts,
  type ConditionRule,
  type FlowGraph,
  type FlowNode,
  type HumanReviewDecision,
} from "../domain/graph-schema.js"
import type { EmployeeFanInOutput } from "./consolidate-results-executor.js"

// Compat: os comparadores e o resolvedor de janela agora vivem em condition-evaluator.ts (a
// única implementação das regras de Condition, compartilhada com a prévia do QA Lab).
export { comparatorMatches, evaluateGenericComparator, resolveHistoricalWindow } from "./condition-evaluator.js"

// Sem timer real — a única forma de sair de "waiting" num node Human Review é a rota de
// decisão gravar `node_outputs[nodeId].decision` e reagendar (`next_eval_at = now()`). Esta
// data é só o valor que evita o enrollment ser reivindicado pelo tick normal enquanto isso não
// acontece; nunca é lida como prazo de verdade.
const HUMAN_REVIEW_INDEFINITE_WAIT = new Date("2999-01-01T00:00:00Z")

export type EnrollmentRow = {
  id: string
  organization_id: string
  workflow_id: string
  version_id: string
  interaction_id: string | null
  indicator_measurement_id: string | null
  scheduled_subject_id: string | null
  scheduled_for: string | null
  current_node_id: string
  matched_flag_name: string | null
  matched_value_boolean: boolean | null
  matched_value_numeric: string | null
  status: string
  attempts: number
  revision: number
  node_outputs: Record<string, unknown>
  variables: Record<string, unknown>
  /** Não-nulo = esta matrícula é um FILHO nascido de um fan-out ("Aplicar individualmente") —
   * único sinal que "consolidate_results" (fan-in/JOIN) usa pra saber se está processando um
   * filho chegando na barreira (registra chegada e termina) ou o PAI checando se todos já
   * chegaram (aggregate readiness check, feito fora de processNode — ver engine.ts). Sempre
   * aponta pro enrollment RAIZ, nunca encadeia (nested fan-out é inválido pela matriz de
   * contexto — um filho nunca fan-out de novo). */
  parent_enrollment_id?: string | null
  /** Não-nulo = nova tentativa de uma execução bloqueada (PEN-073): o Output não repete entregas da cadeia. Ausente no QA Lab. */
  retry_of_enrollment_id?: string | null
  /** Só no QA Lab: o contexto da execução principal, que ali é simulada e não tem linha no banco. No motor, ela é lida quando preciso. */
  parent_node_outputs?: Record<string, unknown>
}

export type WorkflowScope = {
  scopeType: string
  teamId: string | null
  subteamId: string | null
  consolidatedStructure?: ConsolidatedStructure | null
  /** `population_filter` cru (jsonb) — só lido por "Selecionar colaboradores" (Parte 11 do
   * pedido de EMPLOYEE_COLLECTION), pra compor a população inicial junto da Abrangência, mesma
   * regra que Agenda/ingestão já aplicam (workflow-eligibility.ts). */
  populationFilter?: unknown
}

export type ProcessContext = {
  db: Database
  graph: FlowGraph
  enrollment: EnrollmentRow
  workflow: WorkflowScope
  inputContext: string
  now: Date
  /** Boundary de side effects (effect-sink.ts) — `productionEffects` no tick real, o sink
   * simulado no QA Lab. É o ÚNICO ponto onde os dois modos diferem: processNode e todos os
   * executores abaixo dele são exatamente os mesmos. */
  effects: WorkflowEffectSink
}

export type VariableUpdate = { variableId: string; value: unknown }

export type NodeOutcome =
  | {
      kind: "advance"
      nextNodeId: string
      eventType: string
      eventPayload?: Record<string, unknown>
      agentRunId?: string
      nodeOutput?: unknown
      variableUpdate?: VariableUpdate
    }
  | { kind: "wait"; nextEvalAt: Date; eventType: string; eventPayload?: Record<string, unknown> }
  | { kind: "complete"; eventPayload?: Record<string, unknown>; nodeOutput?: unknown; variableUpdate?: VariableUpdate }
  | { kind: "fail"; message: string }
  // "Aplicar individualmente" (fan-out — Parte 16-24 do pedido de EMPLOYEE_COLLECTION): nunca
  // insere nada no banco aqui (processNode só DECIDE, mesmo princípio de todo NodeOutcome) —
  // quem aplica de verdade é engine.ts (produção) ou o simulador do QA Lab, cada um do seu jeito
  // (inserir workflow_enrollments filhos x simular sub-execuções em memória). `joinNodeId`
  // presente = este fan-out tem um "Consolidar resultados" pareado adiante no grafo (fan-in/JOIN
  // — ver findPairedJoinNode); ausente = comportamento legado intacto (cada filho termina
  // sozinho, pai completa imediatamente).
  | { kind: "fan_out"; fanOutNodeId: string; nextNodeId: string; memberIds: string[]; joinNodeId?: string }
  // "Consolidar resultados" (fan-in/JOIN) — só emitido quando esta matrícula é o PAI (sem
  // parent_enrollment_id) chegando/reavaliando a barreira. Igual a fan_out, processNode só
  // DECIDE que é preciso checar prontidão dos filhos — quem faz a query agregada e decide
  // avançar (uma vez só, via a mesma trava otimista de revision de qualquer outro node) é
  // engine.ts/QA, nunca processNode. Quando esta matrícula é um FILHO chegando na barreira,
  // processNode devolve `complete` normal (mesma semântica de chegar num `end`) — nenhum outcome
  // novo precisa existir pro lado do filho.
  | { kind: "join_check"; joinNodeId: string; fanOutNodeId: string; nextNodeId: string }

/**
 * Sujeito(s) da Condition histórica/performance — quase sempre UMA pessoa (o operador do
 * evento, modo Individual), exceto quando o Workflow está em modo de avaliação Consolidado
 * (Estrutura Consolidada configurada), caso em que resolve o CONJUNTO de operadores por trás da
 * pessoa-âncora/subgrupo/grupo escolhido. `performanceQuery` (atingimento/quartil mais recente)
 * permanece individual-only mesmo em modo Consolidado — "quartil mais recente de um GRUPO" não
 * tem definição segura sem inventar um cálculo que a fonte não fornece — só `historicalQuery`
 * (Média/Mínimo/Máximo/Contagem) agrega de verdade (bloqueado no publish do Workflow — ver
 * workflow-router.ts).
 */
/** Contexto organizacional das avaliações (timezone IANA da organização) — resolvido do enrollment, nunca fixo. */
async function evaluationOptions(context: ProcessContext): Promise<EvaluationOptions> {
  // `quartileCache` é por execução de nó: um "Selecionar colaboradores" com critério de quartil
  // operacional avalia N candidatos sobre a MESMA população — uma resolução em lote, nunca N+1.
  return { timeZone: await resolveOrganizationTimezone(context.db, context.enrollment.organization_id), quartileCache: new Map() }
}

/**
 * A coleção de um "Selecionar colaboradores" anterior. A execução filha de "Aplicar individualmente" nasce sem contexto: copiar a lista
 * para cada filho custaria N × N (fan-out grande), então ela fica só na execução principal e é lida de lá, apenas quando alguém pede.
 */
async function readCollection(context: ProcessContext, collectionNodeId: string): Promise<EmployeeCollectionOutput | undefined> {
  const { enrollment } = context
  const own = enrollment.node_outputs[collectionNodeId] as EmployeeCollectionOutput | undefined
  if (own || !enrollment.parent_enrollment_id) return own
  if (enrollment.parent_node_outputs) return enrollment.parent_node_outputs[collectionNodeId] as EmployeeCollectionOutput | undefined
  const parent = await context.db.query<{ collection: EmployeeCollectionOutput | null }>(`select node_outputs -> $1 collection from workflow_enrollments where id = $2 and organization_id = $3`, [collectionNodeId, enrollment.parent_enrollment_id, enrollment.organization_id])
  return parent.rows[0]?.collection ?? undefined
}

/**
 * População do quartil OPERACIONAL de uma Condition (source OPERATIONAL_QUARTILE — Parte 33):
 * a coleção anterior quando a Condition vem depois de um "Selecionar colaboradores"; senão a
 * Estrutura Consolidada ∩ elegíveis (modo Consolidado) ou Abrangência ∩ Filtro populacional
 * (modo Individual). Nunca "todos os operadores da empresa" por padrão — o quartil é relativo à
 * população do Workflow, igual ao Ranking (`resolveSelectionCandidates`).
 */
async function resolveConditionPopulation(context: ProcessContext, nodeId: string, operatorId: string): Promise<string[]> {
  const previous = findPrecedingCollectionNode(context.graph, nodeId)
  if (previous) return (await readCollection(context, previous.id))?.memberIds ?? []
  const population: WorkflowPopulation = {
    scopeType: context.workflow.scopeType,
    teamId: context.workflow.teamId,
    subteamId: context.workflow.subteamId,
    populationFilter: context.workflow.populationFilter,
  }
  const structure = context.workflow.consolidatedStructure
  if (structure) {
    const { candidateIds } = await resolveSelectionCandidates(context.db, context.graph, nodeId, context.enrollment.organization_id, structure, population, consolidatedStructureAnchorId(structure) ?? context.enrollment.scheduled_subject_id, context.enrollment.node_outputs)
    return candidateIds
  }
  const eligible = await resolveEligibleOperatorIds(context.db, context.enrollment.organization_id, population)
  return eligible.length > 0 ? eligible : [operatorId]
}

async function resolveConditionSubject(db: Database, enrollment: EnrollmentRow, workflow: WorkflowScope): Promise<ConditionSubject> {
  const operatorId = await resolveEnrollmentOperatorId({
    db,
    enrollment: {
      interactionId: enrollment.interaction_id,
      indicatorMeasurementId: enrollment.indicator_measurement_id,
      scheduledSubjectId: enrollment.scheduled_subject_id,
    },
  })
  if (!operatorId) throw new Error("Não foi possível identificar o operador para avaliar a condição.")

  const structure = workflow.consolidatedStructure
  // Execução filha de "Aplicar individualmente": o sujeito é a pessoa, mesmo em Workflow consolidado (mesmo critério do destinatário do
  // Output). Agregar a estrutura aqui faria uma pessoa seguir pelo caminho decidido pelo resultado da equipe.
  if (!structure || enrollment.parent_enrollment_id) return { operatorId, subjectIds: [operatorId] }

  // Modo Consolidado: a pessoa-âncora do enrollment (`scheduled_subject_id`) já É a pessoa
  // configurada (Supervisor/Coordenador/.../ou um membro-carregador de Subgrupo/Grupo — ver
  // schedule-check.ts) — mas o CONJUNTO a agregar é sempre resolvido de novo aqui, nunca
  // congelado na matrícula, pra refletir a equipe/estrutura atual no momento da avaliação.
  const anchorId = consolidatedStructureAnchorId(structure) ?? enrollment.scheduled_subject_id
  const memberIds = await resolveStructureAnchorOperatorIds(db, structure, anchorId)
  return { operatorId, subjectIds: memberIds.length > 0 ? memberIds : [operatorId] }
}

/**
 * Avalia uma regra simples (fora de historicalQuery/performanceQuery) contra o Execution
 * Context — mesma lógica que já existia inline no case "condition", extraída pra ser
 * reaproveitada tanto pela Condition simples quanto por cada regra de um ConditionGroup
 * (Parte 3 do pedido). Lança erro (nunca retorna um estado especial) quando o path não resolve —
 * quem chama decide como converter isso num NodeOutcome.
 */
function evaluateConditionRule(rule: ConditionRule, enrollment: EnrollmentRow): boolean {
  if (rule.sourcePath) {
    const raw = resolveContextValue({ nodeOutputs: enrollment.node_outputs, variables: enrollment.variables }, rule.sourcePath)
    if (typeof raw === "boolean") {
      return comparatorMatches(rule.comparator, true, raw, rule.thresholdBoolean, null)
    }
    if (typeof raw === "number") {
      return comparatorMatches(rule.comparator, false, raw, null, rule.thresholdNumeric)
    }
    const nonNumericComparators = ["NOT_EQUALS", "CONTAINS", "NOT_CONTAINS", "STARTS_WITH", "ENDS_WITH", "IS_EMPTY", "NOT_EMPTY"]
    if (typeof raw === "string" && raw.trim() !== "" && !Number.isNaN(Number(raw)) && !nonNumericComparators.includes(rule.comparator)) {
      return comparatorMatches(rule.comparator, false, Number(raw), null, rule.thresholdNumeric)
    }
    if (typeof raw === "string" && (raw.trim() !== "" || rule.comparator === "IS_EMPTY" || rule.comparator === "NOT_EMPTY")) {
      return evaluateGenericComparator(rule.comparator, raw, rule.thresholdText)
    }
    if (Array.isArray(raw)) {
      return evaluateGenericComparator(rule.comparator, raw, rule.thresholdText)
    }
    throw new Error(`Não foi possível resolver "${rule.sourcePath}" no contexto de execução (valor encontrado: ${JSON.stringify(raw ?? null)}).`)
  }
  const isBoolean = enrollment.matched_value_boolean !== null
  const actualValue = isBoolean ? enrollment.matched_value_boolean! : Number(enrollment.matched_value_numeric)
  return comparatorMatches(rule.comparator, isBoolean, actualValue, rule.thresholdBoolean, rule.thresholdNumeric)
}

function requireEdge(graph: FlowGraph, nodeId: string, handle: string): { target: string } | { fail: NodeOutcome } {
  const edge = findEdge(graph, nodeId, handle)
  if (!edge) return { fail: { kind: "fail", message: `Nó "${nodeId}" não tem aresta de saída "${handle}".` } }
  return { target: edge.target }
}

/**
 * Contexto de jornada pro nó Trigger de uma execução nascida da Agenda (calendário OU relativa
 * ao expediente — Parte 14 do pedido de agendamento relativo): se o colaborador da matrícula tem
 * uma jornada vigente cadastrada pra data do disparo, grava esses dados em `nodeOutputs.trigger`
 * (mesmo mecanismo genérico de "Valor do gatilho" já usado desde Variáveis do Workflow — nenhum
 * resolvedor novo, `nodeOutputs.trigger.elapsedScheduledPercent` já é utilizável via
 * `resolveSource`). `null` quando não há colaborador ou não há jornada cadastrada — nunca inventa.
 */
async function resolveShiftTriggerOutput(context: ProcessContext): Promise<Record<string, unknown> | null> {
  const { enrollment } = context
  if (!enrollment.scheduled_subject_id || !enrollment.scheduled_for) return null
  const timezone = await resolveOrganizationTimezone(context.db, enrollment.organization_id)
  const dateStr = localDateParts(new Date(enrollment.scheduled_for), timezone).date
  const shiftResult = await context.db.query<{ start_time: string; work_minutes: number }>(
    `select start_time, work_minutes from employee_work_shifts
     where person_id = $1 and effective_from <= $2::date and (effective_to is null or effective_to >= $2::date)
     order by effective_from desc limit 1`,
    [enrollment.scheduled_subject_id, dateStr],
  )
  const shift = shiftResult.rows[0]
  if (!shift) return null
  const window = resolveShiftWindow({ startTime: shift.start_time, workMinutes: shift.work_minutes }, dateStr, timezone)
  const triggeredAt = new Date(enrollment.scheduled_for)
  return {
    employeeId: enrollment.scheduled_subject_id,
    scheduledShiftStart: window.start.toISOString(),
    scheduledShiftEnd: window.end.toISOString(),
    scheduledWorkMinutes: shift.work_minutes,
    triggeredAt: triggeredAt.toISOString(),
    elapsedScheduledPercent: Math.round(elapsedScheduledPercent(window, triggeredAt) * 100) / 100,
  }
}

export async function processNode(context: ProcessContext, node: FlowNode): Promise<NodeOutcome> {
  switch (node.type) {
    case "trigger": {
      const edge = requireEdge(context.graph, node.id, "always")
      if ("fail" in edge) return edge.fail
      // Grava o valor bruto do gatilho em node_outputs.trigger — trata o trigger como "mais um
      // node" pro resolvedor de Execution Context, sem lógica especial nenhuma (Parte 7 do
      // pedido de variáveis dinâmicas: "Valor do gatilho" vira só mais uma origem resolvível).
      // Só disponível hoje pra gatilho por flag de canal (o único que carrega um valor bruto
      // escalar); schedule/indicator ficam sem valor de gatilho resolvível por ora — exceto
      // quando a matrícula tem um colaborador com jornada cadastrada (Agenda), caso em que o
      // contexto de jornada abaixo assume o lugar do valor bruto.
      const matchedValue =
        context.enrollment.matched_value_boolean ?? (context.enrollment.matched_value_numeric !== null ? Number(context.enrollment.matched_value_numeric) : null)
      const shiftOutput = await resolveShiftTriggerOutput(context)
      const nodeOutput = shiftOutput ?? matchedValue
      return {
        kind: "advance",
        nextNodeId: edge.target,
        eventType: "node_advanced",
        ...(nodeOutput !== null ? { nodeOutput } : {}),
      }
    }

    case "wait": {
      if (context.enrollment.status === "active") {
        const nextEvalAt = new Date(context.now.getTime() + node.config.durationMs)
        return { kind: "wait", nextEvalAt, eventType: "wait_started", eventPayload: { durationMs: node.config.durationMs } }
      }
      const edge = requireEdge(context.graph, node.id, "always")
      if ("fail" in edge) return edge.fail
      return { kind: "advance", nextNodeId: edge.target, eventType: "wait_elapsed" }
    }

    case "condition": {
      await assertNodeMatchesIndicatorCatalog(context.db, context.enrollment.organization_id, node)
      let branch: string
      let matched = false
      // Valores efetivamente resolvidos — vão pro payload do evento `condition_evaluated`
      // (auditável em workflow_enrollment_events e no trace do QA Lab: "Ocorrências
      // encontradas: 4 · 4 >= 3 · TRUE"), nunca só o booleano final.
      let evaluation: Record<string, unknown>

      if (node.config.group) {
        // AND/OR (Parte 3) — cada regra usa a MESMA avaliação de uma Condition simples; regras
        // com sourcePath não-resolvível lançam, propagando pro catch de processEnrollment
        // (engine.ts) como falha normal do node — mesmo efeito prático de um retorno "fail".
        const results = node.config.group.rules.map((rule) => evaluateConditionRule(rule, context.enrollment))
        matched = node.config.group.operator === "ALL" ? results.every(Boolean) : results.some(Boolean)
        branch = matched ? "true" : "false"
        evaluation = {
          kind: "group",
          operator: node.config.group.operator,
          rules: node.config.group.rules.map((rule, index) => ({
            sourcePath: rule.sourcePath ?? null,
            comparator: rule.comparator,
            threshold: rule.thresholdBoolean ?? rule.thresholdNumeric ?? rule.thresholdText ?? null,
            result: results[index],
          })),
        }
      } else if (node.config.historicalQuery || node.config.performanceQuery) {
        // Conditions "de dados" (histórico/performance) — o MESMO evaluator determinístico que a
        // prévia de massa do QA Lab usa (condition-evaluator.ts); aqui só resolvemos QUEM é o
        // sujeito a partir do enrollment. Nunca duas implementações da regra.
        const subject = await resolveConditionSubject(context.db, context.enrollment, context.workflow)
        if (node.config.historicalQuery?.source === "OPERATIONAL_QUARTILE") subject.populationIds = await resolveConditionPopulation(context, node.id, subject.operatorId)
        const result = await evaluateDataCondition(context.db, node.config, subject, context.now, await evaluationOptions(context))
        if (!result) return { kind: "fail", message: "Condição sem consulta de dados avaliável." }
        matched = result.matched
        branch = result.branch
        evaluation = result.evaluation
      } else if (node.config.sourcePath) {
        const raw = resolveContextValue({ nodeOutputs: context.enrollment.node_outputs, variables: context.enrollment.variables }, node.config.sourcePath)
        if (typeof raw === "boolean") {
          matched = comparatorMatches(node.config.comparator, true, raw, node.config.thresholdBoolean, null)
        } else if (typeof raw === "number") {
          matched = comparatorMatches(node.config.comparator, false, raw, null, node.config.thresholdNumeric)
        } else if (typeof raw === "string" && raw.trim() !== "" && !Number.isNaN(Number(raw)) && !["NOT_EQUALS", "CONTAINS", "NOT_CONTAINS", "STARTS_WITH", "ENDS_WITH", "IS_EMPTY", "NOT_EMPTY"].includes(node.config.comparator)) {
          matched = comparatorMatches(node.config.comparator, false, Number(raw), null, node.config.thresholdNumeric)
        } else if (typeof raw === "string" && (raw.trim() !== "" || node.config.comparator === "IS_EMPTY" || node.config.comparator === "NOT_EMPTY")) {
          // Texto não-numérico (ex.: "HIGH", "CRITICAL") ou um comparador de texto explícito —
          // comparadores de ordem (GT/LT/...) não têm significado bem definido pra string
          // arbitrária e caem no default (não bate) de evaluateGenericComparator.
          matched = evaluateGenericComparator(node.config.comparator, raw, node.config.thresholdText)
        } else if (Array.isArray(raw)) {
          matched = evaluateGenericComparator(node.config.comparator, raw, node.config.thresholdText)
        } else {
          return {
            kind: "fail",
            message: `Não foi possível resolver "${node.config.sourcePath}" no contexto de execução (valor encontrado: ${JSON.stringify(raw ?? null)}).`,
          }
        }
        branch = matched ? "true" : "false"
        evaluation = {
          kind: "source_path",
          sourcePath: node.config.sourcePath,
          value: raw,
          comparator: node.config.comparator,
          threshold: node.config.thresholdBoolean ?? node.config.thresholdNumeric ?? node.config.thresholdText ?? null,
        }
      } else {
        const isBoolean = context.enrollment.matched_value_boolean !== null
        const actualValue = isBoolean ? context.enrollment.matched_value_boolean! : Number(context.enrollment.matched_value_numeric)
        matched = comparatorMatches(node.config.comparator, isBoolean, actualValue, node.config.thresholdBoolean, node.config.thresholdNumeric)
        branch = matched ? "true" : "false"
        evaluation = {
          kind: "trigger_value",
          value: actualValue,
          comparator: node.config.comparator,
          threshold: isBoolean ? (node.config.thresholdBoolean ?? null) : (node.config.thresholdNumeric ?? null),
        }
      }

      const edge = requireEdge(context.graph, node.id, branch)
      if ("fail" in edge) return edge.fail
      // `result` preservado como booleano (compat com quem já lê esse campo); `branch` é o novo
      // campo que também distingue "no_data" das duas saídas antigas.
      return { kind: "advance", nextNodeId: edge.target, eventType: "condition_evaluated", eventPayload: { result: matched, branch, evaluation } }
    }

    case "action": {
      // "Chamar agente" depois de "Consolidar resultados" = Agent de SÍNTESE (evolução 2026-09-16):
      // recebe o mesmo resultado consolidado que o Orquestrador pós-JOIN recebia, em UMA request,
      // com contrato estruturado. Nunca `resolveEnrollmentOperatorId` aqui — não existe "o operador".
      if (node.config.actionType === "CALL_AGENT" && resolveNodeContexts(context.graph).get(node.id) === "CONSOLIDATED_RESULT") {
        const joinNode = findPrecedingJoinNode(context.graph, node.id)
        if (!joinNode) throw new Error(`O nó "${node.label}" (Agent de síntese) precisa de um "Consolidar resultados" antes dele.`)
        const fanIn = context.enrollment.node_outputs[joinNode.id] as EmployeeFanInOutput | undefined
        if (!fanIn || fanIn.kind !== "EMPLOYEE_FAN_IN") {
          throw new Error(`O nó "${node.label}" não encontrou um resultado consolidado válido — "${joinNode.label}" ainda não foi executado nesta matrícula.`)
        }
        const collectionNode = findPrecedingCollectionNode(context.graph, joinNode.id)
        const collection = collectionNode ? (context.enrollment.node_outputs[collectionNode.id] as EmployeeCollectionOutput | undefined) : undefined
        const synthesisConfig = node.config
        const synthesis = await withWorkflowAgent(context.db, context.enrollment.organization_id, synthesisConfig.agentId, { scopeType: context.workflow.scopeType, teamId: context.workflow.teamId, subteamId: context.workflow.subteamId }, () =>
          executeSynthesisAgent(synthesisConfig, {
            db: context.db,
            organizationId: context.enrollment.organization_id,
            inputContext: context.inputContext,
            fanIn,
            collection: collection ?? null,
            recorder: context.effects.agentRuns,
          }),
        )
        const edge = requireEdge(context.graph, node.id, "always")
        if ("fail" in edge) return edge.fail
        return {
          kind: "advance",
          nextNodeId: edge.target,
          eventType: "action_executed",
          eventPayload: { actionType: "CALL_AGENT", executionKind: "SYNTHESIS_AGENT", agentId: synthesis.nodeOutput.agentId, consolidatedCount: synthesis.nodeOutput.consolidatedCount, ...(synthesis.nodeOutput.skippedReason ? { skippedReason: synthesis.nodeOutput.skippedReason } : {}) },
          ...(synthesis.agentRunId ? { agentRunId: synthesis.agentRunId } : {}),
          nodeOutput: synthesis.nodeOutput,
        }
      }
      const executor = actionExecutors[node.config.actionType]
      const result = await executor(node.config, {
        db: context.db,
        organizationId: context.enrollment.organization_id,
        workflowId: context.enrollment.workflow_id,
        workflowVersionId: context.enrollment.version_id,
        nodeId: node.id,
        graph: context.graph,
        readCollection: (collectionNodeId) => readCollection(context, collectionNodeId),
        enrollment: {
          id: context.enrollment.id,
          interactionId: context.enrollment.interaction_id,
          indicatorMeasurementId: context.enrollment.indicator_measurement_id,
          scheduledSubjectId: context.enrollment.scheduled_subject_id,
          matchedFlagName: context.enrollment.matched_flag_name,
          matchedValueBoolean: context.enrollment.matched_value_boolean,
          matchedValueNumeric: context.enrollment.matched_value_numeric,
          nodeOutputs: context.enrollment.node_outputs,
          variables: context.enrollment.variables,
        },
        scopeType: context.workflow.scopeType,
        teamId: context.workflow.teamId,
        subteamId: context.workflow.subteamId,
        inputContext: context.inputContext,
        now: context.now,
        effects: context.effects,
      })
      // V1.5.12 — a ação decidiu o fluxo ("Gerar feedback": HOLD_FOR_QA espera neste nó; BLOCKED/REJECTED encerra sem Output).
      if (result.control?.kind === "WAIT") return { kind: "wait", nextEvalAt: result.control.nextEvalAt, eventType: result.control.eventType, eventPayload: result.control.eventPayload }
      if (result.control?.kind === "COMPLETE") {
        return { kind: "complete", eventPayload: result.control.eventPayload, ...(result.nodeOutput !== undefined ? { nodeOutput: result.nodeOutput } : {}) }
      }
      // Escalonar "Encerrar branch" (Parte 12/13 do pedido de evolução do Escalonamento):
      // conclui a execução sem exigir nenhuma edge de saída — mesmo `{kind:"complete"}` que o
      // node `end` já usa. `nodeBranches` (graph-schema.ts) já reflete isso no canvas (zero
      // Handle de saída quando essa combinação está configurada).
      if (node.config.actionType === "ESCALATE" && node.config.continuation === "END_BRANCH") {
        return {
          kind: "complete",
          eventPayload: { actionType: node.config.actionType, ...(result.nodeOutput !== undefined ? { nodeOutput: result.nodeOutput } : {}) },
          ...(result.nodeOutput !== undefined ? { nodeOutput: result.nodeOutput } : {}),
        }
      }
      const edge = requireEdge(context.graph, node.id, "always")
      if ("fail" in edge) return edge.fail
      return {
        kind: "advance",
        nextNodeId: edge.target,
        eventType: "action_executed",
        // `nodeOutput` entra no payload do evento (não só no node_outputs "atual") pra virar
        // histórico auditável — cada execução da Action "Definir variável" vira uma linha própria
        // em workflow_enrollment_events, mesmo quando a mesma variável é definida mais de uma vez
        // na mesma execução (Parte 29 do pedido de variáveis dinâmicas).
        eventPayload: { actionType: node.config.actionType, ...(node.config.actionType === "CALL_AGENT" ? { executionKind: "DIRECT_AGENT" } : {}), ...(result.nodeOutput !== undefined ? { nodeOutput: result.nodeOutput } : {}) },
        ...(result.agentRunId ? { agentRunId: result.agentRunId } : {}),
        ...(result.nodeOutput !== undefined ? { nodeOutput: result.nodeOutput } : {}),
        ...(result.variableUpdate ? { variableUpdate: result.variableUpdate } : {}),
      }
    }

    case "orchestrator": {
      // A versão fixada do Orquestrador só roda se servir ao Grupo do Workflow (conferida na resolução, motor e QA Lab).
      const workflowScope = { scopeType: context.workflow.scopeType, teamId: context.workflow.teamId, subteamId: context.workflow.subteamId }
      const contexts = resolveNodeContexts(context.graph)
      const isConsolidated = contexts.get(node.id) === "CONSOLIDATED_RESULT"
      const result = isConsolidated
        ? await (async () => {
            const joinNode = findPrecedingJoinNode(context.graph, node.id)
            if (!joinNode) throw new Error(`O nó "${node.label}" (Orchestrator consolidado) precisa de um "Consolidar resultados" antes dele.`)
            const fanIn = context.enrollment.node_outputs[joinNode.id] as EmployeeFanInOutput | undefined
            if (!fanIn || fanIn.kind !== "EMPLOYEE_FAN_IN") {
              throw new Error(`O nó "${node.label}" não encontrou um resultado consolidado válido — "${joinNode.label}" ainda não foi executado nesta matrícula.`)
            }
            const collectionNode = findPrecedingCollectionNode(context.graph, joinNode.id)
            const collection = collectionNode ? (context.enrollment.node_outputs[collectionNode.id] as EmployeeCollectionOutput | undefined) : undefined
            return executeOrchestratorConsolidated(node.config, { db: context.db, organizationId: context.enrollment.organization_id, inputContext: context.inputContext, fanIn, collection: collection ?? null, publishedRun: Boolean(context.enrollment.version_id), workflowScope })
          })()
        : await executeOrchestrator(node.config, {
            db: context.db,
            organizationId: context.enrollment.organization_id,
            inputContext: context.inputContext,
            publishedRun: Boolean(context.enrollment.version_id),
            workflowScope,
            enrollment: {
              interactionId: context.enrollment.interaction_id,
              indicatorMeasurementId: context.enrollment.indicator_measurement_id,
              scheduledSubjectId: context.enrollment.scheduled_subject_id,
            },
            engine: {
              effects: context.effects,
              organizationId: context.enrollment.organization_id,
              workflowId: context.enrollment.workflow_id,
              enrollmentId: context.enrollment.id,
              nodeId: node.id,
              matchedFlagName: context.enrollment.matched_flag_name ?? null,
            },
          })
      const edge = requireEdge(context.graph, node.id, "always")
      if ("fail" in edge) return edge.fail
      return {
        kind: "advance",
        nextNodeId: edge.target,
        eventType: "orchestrator_executed",
        eventPayload: {
          executionKind: isConsolidated ? "ORCHESTRATED_SYNTHESIS_LEGACY" : "ORCHESTRATED",
          callsCount: result.nodeOutput.calls.length,
          ...(result.nodeOutput.skippedReason ? { skippedReason: result.nodeOutput.skippedReason } : {}),
          // V1.7.1 — como a coordenação aconteceu (roteamento DETERMINISTIC|MODEL, síntese PASSTHROUGH|MODEL|NONE).
          ...(result.nodeOutput.orchestration ? { routingMode: result.nodeOutput.orchestration.routing.mode, routingReason: result.nodeOutput.orchestration.routing.reason, synthesisMode: result.nodeOutput.orchestration.synthesis.mode, synthesisReason: result.nodeOutput.orchestration.synthesis.reason } : {}),
        },
        nodeOutput: result.nodeOutput,
      }
    }

    case "human_review": {
      const stored = context.enrollment.node_outputs[node.id] as { decision?: HumanReviewDecision } | undefined
      if (stored?.decision) {
        const edge = requireEdge(context.graph, node.id, stored.decision)
        if ("fail" in edge) return edge.fail
        return { kind: "advance", nextNodeId: edge.target, eventType: "human_review_decided", eventPayload: { decision: stored.decision } }
      }
      // Primeira visita (status ainda "active" — não fomos nós que já colocamos pra esperar):
      // notifica o(s) revisor(es). Uma segunda passagem antes da decisão não deveria acontecer
      // (next_eval_at fica bem no futuro), mas se acontecer só continua esperando, sem notificar
      // de novo (dedupe_key do alerta já cobriria isso de qualquer forma).
      if (context.enrollment.status === "active") {
        await notifyHumanReviewPending(node.config, {
          db: context.db,
          organizationId: context.enrollment.organization_id,
          workflowId: context.enrollment.workflow_id,
          enrollmentId: context.enrollment.id,
          nodeId: node.id,
          nodeOutputs: context.enrollment.node_outputs,
          variables: context.enrollment.variables,
          enrollment: {
            interactionId: context.enrollment.interaction_id,
            indicatorMeasurementId: context.enrollment.indicator_measurement_id,
            scheduledSubjectId: context.enrollment.scheduled_subject_id,
          },
          effects: context.effects,
        })
      }
      return { kind: "wait", nextEvalAt: HUMAN_REVIEW_INDEFINITE_WAIT, eventType: "human_review_requested" }
    }

    case "output": {
      // Nova tentativa (PEN-073): o que a cadeia original → tentativas já entregou por este nó não é entregue de novo.
      const delivered = context.enrollment.retry_of_enrollment_id ? await priorChainDelivery(context.db, context.enrollment.id, node.id) : null
      if (delivered) {
        const edge = requireEdge(context.graph, node.id, "always")
        if ("fail" in edge) return edge.fail
        return { kind: "advance", nextNodeId: edge.target, eventType: "output_already_delivered", eventPayload: { deliveredByEnrollmentId: delivered.enrollmentId }, nodeOutput: delivered.nodeOutput ?? { alreadyDeliveredBy: delivered.enrollmentId } }
      }
      const result = await executeOutput(node.config, {
        db: context.db,
        organizationId: context.enrollment.organization_id,
        enrollmentId: context.enrollment.id,
        nodeId: node.id,
        nodeLabel: node.label,
        nodeOutputs: context.enrollment.node_outputs,
        variables: context.enrollment.variables,
        enrollment: {
          interactionId: context.enrollment.interaction_id,
          indicatorMeasurementId: context.enrollment.indicator_measurement_id,
          scheduledSubjectId: context.enrollment.scheduled_subject_id,
        },
        effects: context.effects,
        // Matrícula RAIZ de um Workflow Consolidado = o Output está fora do caminho individual
        // (contexto STRUCTURE/CONSOLIDATED_RESULT): o destinatário de gestão vem da ESTRUTURA.
        // Um filho de fan-out (parent_enrollment_id) é o caminho individual — cadeia do operador.
        structure: context.enrollment.parent_enrollment_id ? null : (context.workflow.consolidatedStructure ?? null),
        agentNodeIds: new Set(context.graph.nodes.filter((candidate) => candidate.type === "action" && candidate.config.actionType === "CALL_AGENT").map((candidate) => candidate.id)),
      })
      const edge = requireEdge(context.graph, node.id, "always")
      if ("fail" in edge) return edge.fail
      return {
        kind: "advance",
        nextNodeId: edge.target,
        eventType: "output_dispatched",
        eventPayload: {
          target: node.config.target,
          surfaces: node.config.surfaces,
          recipients: result.recipients,
          ...(result.nodeOutput.caseId ? { caseId: result.nodeOutput.caseId } : {}),
        },
        nodeOutput: result.nodeOutput,
      }
    }

    case "intervention_policy": {
      const nodeOutput = await executeInterventionPolicyNode(context, node)
      const edge = requireEdge(context.graph, node.id, "always")
      if ("fail" in edge) return edge.fail
      return {
        kind: "advance",
        nextNodeId: edge.target,
        eventType: "intervention_policy_evaluated",
        // `caseId` no topo do evento: um Output/Escalar posterior anexa ao MESMO caso (findRecentCaseId), como no Output.
        eventPayload: { policyId: nodeOutput.policyId, policyVersion: nodeOutput.policyVersion, mode: nodeOutput.mode, outcome: nodeOutput.structuredResult.outcome, evaluationId: nodeOutput.evaluationId, ...(nodeOutput.caseId ? { caseId: nodeOutput.caseId } : {}), decisions: nodeOutput.decisions.map((decision) => ({ typeKey: decision.typeKey, status: decision.status })) },
        nodeOutput,
      }
    }

    case "select_employees": {
      // Só existe dentro de um Workflow Consolidado — bloqueado no publish (workflow-router.ts);
      // defesa em runtime pro mesmo caso de payload/estado manual (mesmo padrão já usado em
      // condition-evaluator.ts nesta mesma evolução).
      const structure = context.workflow.consolidatedStructure
      if (!structure) throw new Error(`O nó "${node.label}" (Selecionar colaboradores) só é válido num Workflow em modo Consolidado.`)
      await assertNodeMatchesIndicatorCatalog(context.db, context.enrollment.organization_id, node)
      // Ausente = "CONDITION" (Parte 64 do pedido de Ranking — dado publicado antes desta
      // evolução nunca tem `selectionMode`, continua se comportando exatamente como antes).
      const mode = node.config.selectionMode === "RANKING" ? "RANKING" : "CONDITION"
      // Checado ANTES de resolver candidatos (nunca gasta uma query só pra descobrir depois que a
      // config está incompleta) — mesmo lugar/ordem que o critério de sempre já checava.
      if (mode === "RANKING" && !node.config.ranking) throw new Error(`O nó "${node.label}" precisa de uma configuração de ranking.`)
      if (mode === "CONDITION" && !node.config.criterion) throw new Error(`O nó "${node.label}" precisa de um critério de seleção configurado.`)
      const anchorId = consolidatedStructureAnchorId(structure) ?? context.enrollment.scheduled_subject_id
      const population: WorkflowPopulation = {
        scopeType: context.workflow.scopeType,
        teamId: context.workflow.teamId,
        subteamId: context.workflow.subteamId,
        populationFilter: context.workflow.populationFilter,
      }
      const { candidateIds, sourceKind, sourceNodeId } = await resolveSelectionCandidates(
        context.db,
        context.graph,
        node.id,
        context.enrollment.organization_id,
        structure,
        population,
        anchorId,
        context.enrollment.node_outputs,
      )

      let nodeOutput: EmployeeCollectionOutput
      let eventPayload: Record<string, unknown>
      if (mode === "RANKING") {
        if (!node.config.ranking) throw new Error(`O nó "${node.label}" precisa de uma configuração de ranking.`)
        const { memberIds, direction, partitionBy, requestedCountPerPartition, rankedCount, noDataCount, partitions } = await runEmployeeRanking(
          context.db,
          context.enrollment.organization_id,
          node.config.ranking,
          candidateIds,
          context.now,
          await evaluationOptions(context),
        )
        nodeOutput = {
          kind: "EMPLOYEE_COLLECTION",
          mode: "RANKING",
          memberIds,
          evaluatedCount: candidateIds.length,
          selectedCount: memberIds.length,
          direction,
          partitionBy,
          requestedCountPerPartition,
          rankedCount,
          noDataCount,
          ranking: node.config.ranking,
          partitions,
          sourceKind,
          sourceNodeId,
          selectedAt: context.now.toISOString(),
        }
        eventPayload = {
          evaluatedCount: nodeOutput.evaluatedCount,
          selectedCount: nodeOutput.selectedCount,
          rankedCount,
          noDataCount,
          partitionBy,
          requestedCountPerPartition,
          partitionCount: partitions.length,
        }
      } else {
        if (!node.config.criterion) throw new Error(`O nó "${node.label}" precisa de um critério de seleção configurado.`)
        const { memberIds, notMatchedCount, noDataCount } = await runEmployeeSelection(context.db, node.config.criterion, candidateIds, context.now, await evaluationOptions(context))
        nodeOutput = {
          kind: "EMPLOYEE_COLLECTION",
          mode: "CONDITION",
          memberIds,
          evaluatedCount: candidateIds.length,
          selectedCount: memberIds.length,
          notMatchedCount,
          noDataCount,
          sourceKind,
          sourceNodeId,
          criterion: node.config.criterion,
          selectedAt: context.now.toISOString(),
        }
        eventPayload = { evaluatedCount: nodeOutput.evaluatedCount, selectedCount: nodeOutput.selectedCount, notMatchedCount, noDataCount }
      }

      const edge = requireEdge(context.graph, node.id, "always")
      if ("fail" in edge) return edge.fail
      return {
        kind: "advance",
        nextNodeId: edge.target,
        eventType: "employees_selected",
        eventPayload,
        nodeOutput,
      }
    }

    case "apply_individually": {
      const collectionNode = findPrecedingCollectionNode(context.graph, node.id)
      if (!collectionNode) {
        throw new Error(`O nó "${node.label}" (Aplicar individualmente) precisa de uma coleção de colaboradores ("Selecionar colaboradores") antes dele.`)
      }
      const collection = context.enrollment.node_outputs[collectionNode.id] as EmployeeCollectionOutput | undefined
      if (!collection || collection.kind !== "EMPLOYEE_COLLECTION") {
        throw new Error(`O nó "${node.label}" não encontrou uma coleção de colaboradores válida — "${collectionNode.label}" ainda não foi executado nesta matrícula.`)
      }
      const edge = requireEdge(context.graph, node.id, "always")
      if ("fail" in edge) return edge.fail
      const joinNode = findPairedJoinNode(context.graph, node.id)
      return {
        kind: "fan_out",
        fanOutNodeId: node.id,
        nextNodeId: edge.target,
        memberIds: collection.memberIds,
        ...(joinNode ? { joinNodeId: joinNode.id } : {}),
      }
    }

    case "consolidate_results": {
      // Filho chegando na barreira (Parte 13 do pedido de fan-in/JOIN): registra a chegada e
      // termina — mesma semântica de alcançar um `end`, nunca continua além daqui (quem continua
      // o grafo depois do Join é sempre o PAI, uma vez só).
      if (context.enrollment.parent_enrollment_id) {
        return {
          kind: "complete",
          nodeOutput: { kind: "EMPLOYEE_REACHED_JOIN", joinNodeId: node.id },
          eventPayload: { joinNodeId: node.id },
        }
      }
      // PAI checando/reavaliando a barreira — defesa em runtime pro mesmo caso de payload/estado
      // manual (mesmo padrão já usado em apply_individually/select_employees): publish já bloqueia
      // um Join sem origem (WORKFLOW_CONSOLIDATE_RESULTS_MISSING_ORIGIN).
      const fanOutNode = findPrecedingFanOutNode(context.graph, node.id)
      if (!fanOutNode) {
        throw new Error(`O nó "${node.label}" (Consolidar resultados) precisa de um "Aplicar individualmente" antes dele.`)
      }
      const edge = requireEdge(context.graph, node.id, "always")
      if ("fail" in edge) return edge.fail
      return { kind: "join_check", joinNodeId: node.id, fanOutNodeId: fanOutNode.id, nextNodeId: edge.target }
    }

    case "end":
      return { kind: "complete" }
  }
}
