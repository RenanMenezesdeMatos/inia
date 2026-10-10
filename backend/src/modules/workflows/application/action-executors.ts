import type { Database } from "../../../infrastructure/database/pool.js"
import { DEFAULT_ORGANIZATION_TIMEZONE } from "./organization-timezone.js"
import { resolveCalendarWindow, resolvePreviousCalendarWindow, type CalendarUnit } from "./time-window.js"
import { runAgent } from "../../agents/application/run-agent.js"
import { findPrecedingCondition, type ActionConfig, type FlowGraph } from "../domain/graph-schema.js"
import type { WorkflowEffectSink } from "./effect-sink.js"
import { loadLatestTranscript } from "./transcript.js"
import { prepareIndicatorDiagnosis } from "../../indicator-diagnosis/application/prepare-diagnosis.js"
import { executeEscalation } from "./escalate-executor.js"
import { resolveContextValue } from "./execution-context.js"
import { resolveOfficialClosure } from "../../indicators/application/official-closure.js"
import { eligibleMeasurementFilter } from "../../indicators/application/operational-measurement-resolver.js"
import { resolveOrganizationTimezone } from "./organization-timezone.js"
import { describeTargetGap, renderIndicatorContextForAgent } from "../../indicators/domain/indicator-canonical-context.js"
import { loadIndicatorCanonicalContext } from "../../indicators/application/load-indicator-canonical-context.js"
import { executeGenerateInteractionFeedback } from "./interaction-feedback-action.js"
import { executeGenerateFeedback } from "./generate-feedback-action.js"
import { callAgentForIndicatorDiagnosis, callAgentForPrvClosing } from "./prv-closing-agent-action.js"
import { INDICATOR_ANALYSIS_NODE_OUTPUT_KIND, type IndicatorAnalysisNodeOutput } from "../../feedback-engine/domain/node-output.js"
import type { InvestigationTarget } from "../../feedback-engine/application/investigate-indicator.js"

export type ActionExecutionContext = {
  db: Database
  organizationId: string
  workflowId: string
  /** Versão publicada em execução (a pinada na matrícula) — só auditoria da geração de feedback (V1.5.10). */
  workflowVersionId: string | null
  nodeId: string
  graph: FlowGraph
  enrollment: {
    id: string
    interactionId: string | null
    indicatorMeasurementId: string | null
    scheduledSubjectId: string | null
    matchedFlagName: string | null
    matchedValueBoolean: boolean | null
    matchedValueNumeric: string | null
    // Presentes só pra Actions que precisam ler o Execution Context (hoje: SET_VARIABLE
    // dinâmico) — mesmo dado já disponível em node-handlers.ts, só propagado aqui.
    nodeOutputs: Record<string, unknown>
    variables: Record<string, unknown>
  }
  scopeType: string
  teamId: string | null
  subteamId: string | null
  inputContext: string
  /** Relógio da execução — o mesmo `now` do ProcessContext (real em produção, simulado no QA
   * Lab), nunca `new Date()` solto dentro de um executor. */
  now: Date
  /** Boundary de side effects (ver effect-sink.ts). */
  effects: WorkflowEffectSink
}

/**
 * `control` (V1.5.12) = a ação muda o fluxo em vez de seguir pela aresta "Sempre": WAIT = a matrícula espera neste nó
 * (sem timer; quem libera reativa a MESMA matrícula); COMPLETE = encerra a execução (nada adiante roda).
 */
export type ActionControl = { kind: "WAIT"; nextEvalAt: Date; eventType: string; eventPayload: Record<string, unknown> } | { kind: "COMPLETE"; eventPayload: Record<string, unknown> }
export type ActionResult = { agentRunId?: string; nodeOutput?: unknown; variableUpdate?: { variableId: string; value: unknown }; control?: ActionControl }

type Executor = (config: ActionConfig, context: ActionExecutionContext) => Promise<ActionResult>

async function callAgentForInteraction(config: Extract<ActionConfig, { actionType: "CALL_AGENT" }>, context: ActionExecutionContext) {
  const operatorRow = await context.db.query<{ operator_id: string; started_at: string; team_id: string | null }>(
    `select operator_id, started_at, team_id from interactions i join people p on p.id = i.operator_id where i.id = $1`,
    [context.enrollment.interactionId],
  )
  const operator = operatorRow.rows[0]
  if (!operator) throw new Error("Interação não encontrada para montar o contexto do agente.")

  const condition = findPrecedingCondition(context.graph, context.nodeId)

  return runAgent(context.db, {
    organizationId: context.organizationId,
    agentId: config.agentId,
    inputContext: context.inputContext,
    source: "WORKFLOW",
    recorder: context.effects.agentRuns,
    allowedCapabilities: config.allowedCapabilities ?? null,
    now: context.now,
    workflow: {
      kind: "channel_flag",
      interactionId: context.enrollment.interactionId!,
      operatorId: operator.operator_id,
      teamId: operator.team_id ?? "",
      startedAt: operator.started_at,
      flagName: context.enrollment.matchedFlagName ?? "",
      matchedValueBoolean: context.enrollment.matchedValueBoolean,
      matchedValueNumeric: context.enrollment.matchedValueNumeric,
      comparator: condition?.config.comparator ?? "EQUALS",
      thresholdBoolean: condition?.config.thresholdBoolean ?? null,
      thresholdNumeric: condition?.config.thresholdNumeric?.toString() ?? null,
      // PRV_CLOSING_DIAGNOSIS só existe com Agenda (a publicação recusa com Flag): aqui vale o formato de sempre.
      outputContract: config.outputContract === "PRV_CLOSING_DIAGNOSIS" ? undefined : config.outputContract,
    },
  })
}

/**
 * Meta vigente do OPERADOR para um indicador na data: pessoa > Subgrupo > Grupo (a mesma
 * precedência das Tools de investigação; a Condition usa Subgrupo > Grupo porque avalia
 * populações). Antes o contexto do Agent só olhava a meta por PESSOA — e dizia "sem meta cadastrada"
 * mesmo com meta de Grupo vigente, contradizendo os fatos das ferramentas.
 */
async function resolveOperatorTarget(db: Database, organizationId: string, indicatorId: string, operatorId: string, at: string): Promise<number | null> {
  const person = await db.query<{ team_id: string | null; subteam_id: string | null }>(`select team_id, subteam_id from people where id = $1`, [operatorId])
  const candidates: { type: "PERSON" | "SUBTEAM" | "TEAM"; id: string | null }[] = [
    { type: "PERSON", id: operatorId },
    { type: "SUBTEAM", id: person.rows[0]?.subteam_id ?? null },
    { type: "TEAM", id: person.rows[0]?.team_id ?? null },
  ]
  for (const candidate of candidates) {
    if (!candidate.id) continue
    const goal = await db.query<{ target_value: string }>(
      `select target_value from goals
       where organization_id = $1 and indicator_definition_id = $2 and subject_type = $3 and subject_id = $4
         and valid_from <= $5::timestamptz::date and (valid_until is null or valid_until >= $5::timestamptz::date)
       order by valid_from desc limit 1`,
      [organizationId, indicatorId, candidate.type, candidate.id, at],
    )
    if (goal.rows[0]) return Number(goal.rows[0].target_value)
  }
  return null
}


async function callAgentForIndicator(config: Extract<ActionConfig, { actionType: "CALL_AGENT" }>, context: ActionExecutionContext) {
  // Contexto CANÔNICO único (V1.5.12a): o MESMO que o feedback confiável usa para validar — valor, meta, comparação e
  // distância até a meta vêm do sistema; o Agent nunca recebe um número que a validação não reconheça.
  const canonical = await loadIndicatorCanonicalContext(context.db, { organizationId: context.organizationId, measurementId: context.enrollment.indicatorMeasurementId!, now: context.now })
  if (!canonical) throw new Error("Medição de indicador não encontrada para montar o contexto do agente.")

  const operatorRow = await context.db.query<{ team_id: string | null }>(`select team_id from people where id = $1`, [canonical.measurement.subjectId])
  const teamId = operatorRow.rows[0]?.team_id ?? null
  const condition = findPrecedingCondition(context.graph, context.nodeId)

  // V1.6.1 — DIAGNÓSTICO: o SISTEMA decide onde investigar e quais atendimentos (plano determinístico); o Agent recebe só
  // essas transcrições (por handle) para avaliar os processos. "Gerar feedback" recalcula o mesmo plano e verifica tudo.
  const diagnosis = config.outputContract === "INDICATOR_DIAGNOSIS" ? await prepareIndicatorDiagnosis(context.db, context.organizationId, { measurementId: context.enrollment.indicatorMeasurementId!, collaboratorId: canonical.measurement.subjectId, indicatorId: canonical.indicator.id, enrollmentId: context.enrollment.id, agentId: config.agentId }) : null

  return runAgent(context.db, {
    organizationId: context.organizationId,
    agentId: config.agentId,
    inputContext: diagnosis ? `${renderIndicatorContextForAgent(canonical)}\n\n${diagnosis.prompt}` : renderIndicatorContextForAgent(canonical),
    source: "WORKFLOW",
    recorder: context.effects.agentRuns,
    allowedCapabilities: config.allowedCapabilities ?? null,
    now: context.now,
    workflow: {
      kind: "indicator",
      operatorId: canonical.measurement.subjectId,
      teamId: teamId ?? "",
      indicatorMeasurementId: context.enrollment.indicatorMeasurementId!,
      measuredAt: canonical.measurement.periodEndAt ?? canonical.measurement.periodEnd,
      indicatorCode: canonical.indicator.code,
      indicatorName: canonical.indicator.name,
      unit: canonical.indicator.unit,
      value: canonical.measurement.value,
      targetValue: canonical.target?.value ?? null,
      comparator: condition?.config.comparator ?? "EQUALS",
      thresholdNumeric: condition?.config.thresholdNumeric?.toString() ?? null,
      ...(diagnosis ? { outputContract: "INDICATOR_DIAGNOSIS" as const, diagnosisSample: diagnosis.sample } : {}),
    },
  })
}

const PERIOD_LABEL: Record<string, string> = {
  TODAY: "Hoje",
  D1: "Ontem (D-1)",
  WEEK: "Semana anterior",
  MONTH: "Mês anterior",
  TWO_MONTHS: "Bimestre anterior",
  QUARTER: "Trimestre anterior",
  FOUR_MONTHS: "Quadrimestre anterior",
  SEMESTER: "Semestre anterior",
}

/**
 * Janela [início, fim) do período pedido, alinhada ao calendário LOCAL da organização (timezone
 * IANA — `operations.timezone`, fallback documentado em organization-timezone.ts), sempre no
 * passado (exceto TODAY/CURRENT, parciais até agora). `phase` "PREVIOUS" (padrão) = período de
 * calendário ANTERIOR completo; "CURRENT" = período CORRENTE, parcial. TODAY/D1 são o vocabulário
 * de `scheduledDataSource`; DAY/WEEK/MONTH/TWO_MONTHS/QUARTER/FOUR_MONTHS/SEMESTER, o das Conditions.
 * A matemática vive em time-window.ts (única no sistema) — aqui só o mapeamento do vocabulário.
 */
export function resolvePeriodWindow(period: string, now: Date, phase: "CURRENT" | "PREVIOUS" = "PREVIOUS", timeZone: string = DEFAULT_ORGANIZATION_TIMEZONE): { start: Date; end: Date } {
  switch (period) {
    case "TODAY":
      return resolveCalendarWindow("DAY", now, "CURRENT", timeZone)
    case "D1":
      return resolveCalendarWindow("DAY", now, "PREVIOUS", timeZone)
    case "DAY":
    case "WEEK":
    case "MONTH":
    case "TWO_MONTHS":
    case "QUARTER":
    case "FOUR_MONTHS":
    case "SEMESTER":
      return resolveCalendarWindow(period, now, phase, timeZone)
    default:
      throw new Error(`Período "${period}" desconhecido.`)
  }
}

/** Janela do período imediatamente ANTERIOR ao devolvido por `resolvePeriodWindow` pro mesmo
 * `period`/`phase` — sempre um período completo (nunca parcial). */
export function resolvePreviousPeriodWindow(period: string, now: Date, phase: "CURRENT" | "PREVIOUS" = "PREVIOUS", timeZone: string = DEFAULT_ORGANIZATION_TIMEZONE): { start: Date; end: Date } {
  const unit: CalendarUnit = period === "TODAY" || period === "D1" ? "DAY" : (period as CalendarUnit)
  const effectivePhase = period === "TODAY" ? "CURRENT" : period === "D1" ? "PREVIOUS" : phase
  return resolvePreviousCalendarWindow(unit, now, effectivePhase, timeZone)
}

async function callAgentForSampledInteraction(
  config: Extract<ActionConfig, { actionType: "CALL_AGENT" }>,
  context: ActionExecutionContext,
  interactionId: string,
  operatorId: string,
  teamId: string,
) {
  const interactionRow = await context.db.query<{ started_at: string }>(`select started_at from interactions where id = $1`, [interactionId])
  const interaction = interactionRow.rows[0]
  if (!interaction) throw new Error("Interação amostrada não encontrada.")

  const transcript = await loadLatestTranscript(context.db, interactionId)

  return runAgent(context.db, {
    organizationId: context.organizationId,
    agentId: config.agentId,
    inputContext: transcript?.content ?? "",
    source: "WORKFLOW",
    recorder: context.effects.agentRuns,
    allowedCapabilities: config.allowedCapabilities ?? null,
    now: context.now,
    workflow: {
      kind: "channel_flag",
      interactionId,
      operatorId,
      teamId,
      startedAt: interaction.started_at,
      flagName: "Revisão periódica de monitoria",
      matchedValueBoolean: null,
      matchedValueNumeric: null,
      comparator: "EQUALS",
      thresholdBoolean: null,
      thresholdNumeric: null,
    },
  })
}

async function callAgentForIndicatorPeriod(
  config: Extract<ActionConfig, { actionType: "CALL_AGENT" }>,
  context: ActionExecutionContext,
  operatorId: string,
  teamId: string,
  indicatorCode: string,
  period: string,
  window: { start: Date; end: Date },
) {
  const indicatorRow = await context.db.query<{ id: string; name: string; unit: string; desired_direction: string }>(
    `select id, name, unit, desired_direction from indicator_definitions where code = $1 and organization_id = $2`,
    [indicatorCode, context.organizationId],
  )
  const indicator = indicatorRow.rows[0]
  if (!indicator) throw new Error(`Indicador "${indicatorCode}" não encontrado.`)

  // Só medições de datas ELEGÍVEIS (mesmo predicado canônico de Condition/Ranking/Analytics):
  // folga, day off, férias… ficam no banco e fora do contexto do agente.
  const eligible = await eligibleMeasurementFilter(context.db, { subjectIds: [operatorId], window, timeZone: await resolveOrganizationTimezone(context.db, context.organizationId), firstParam: 6 })
  const aggRow = await context.db.query<{ avg_value: string | null; ids: string[] | null }>(
    `with ${eligible.cte}
     select avg(m.value)::numeric avg_value, array_agg(m.id) ids
     from indicator_measurements m
     ${eligible.join}
     where m.organization_id = $1 and m.indicator_definition_id = $2 and m.subject_type = 'PERSON' and m.subject_id = $3
       and m.period_start >= $4 and m.period_start < $5 and ${eligible.predicate}`,
    [context.organizationId, indicator.id, operatorId, window.start.toISOString(), window.end.toISOString(), ...eligible.params],
  )
  const agg = aggRow.rows[0]
  if (!agg?.avg_value) throw new Error(`Sem medições de "${indicatorCode}" no período selecionado (${PERIOD_LABEL[period]}) para este operador.`)
  const value = Number(agg.avg_value)

  const targetValue = await resolveOperatorTarget(context.db, context.organizationId, indicator.id, operatorId, window.end.toISOString())
  const gapText = describeTargetGap(value, targetValue, indicator.desired_direction, indicator.unit)
  const periodLabel = PERIOD_LABEL[period] ?? period

  const inputContext = [
    `Indicador: ${indicator.name} (${indicatorCode})`,
    `Período avaliado: ${periodLabel} (${window.start.toISOString().slice(0, 10)} a ${window.end.toISOString().slice(0, 10)})`,
    `Valor médio no período: ${value.toFixed(2)} ${indicator.unit}`,
    `Meta vigente: ${targetValue !== null ? `${targetValue} ${indicator.unit}` : "não cadastrada para o período"}`,
    gapText,
  ]
    .filter(Boolean)
    .join("\n")

  return runAgent(context.db, {
    organizationId: context.organizationId,
    agentId: config.agentId,
    inputContext,
    source: "WORKFLOW",
    recorder: context.effects.agentRuns,
    allowedCapabilities: config.allowedCapabilities ?? null,
    now: context.now,
    workflow: {
      kind: "indicator",
      operatorId,
      teamId,
      indicatorMeasurementId: null,
      measuredAt: window.end.toISOString(),
      indicatorCode,
      indicatorName: indicator.name,
      unit: indicator.unit,
      value,
      targetValue,
      comparator: "EQUALS",
      thresholdNumeric: targetValue !== null ? targetValue.toString() : null,
      periodSummary: {
        measurementIds: agg.ids ?? [],
        periodLabel,
        periodStart: window.start.toISOString(),
        periodEnd: window.end.toISOString(),
      },
    },
  })
}

async function callAgentForIndicatorSummary(
  config: Extract<ActionConfig, { actionType: "CALL_AGENT" }>,
  context: ActionExecutionContext,
  operatorId: string,
  teamId: string,
  period: string,
  window: { start: Date; end: Date },
) {
  const goalRows = await context.db.query<{ code: string; name: string; unit: string; desired_direction: string; indicator_id: string }>(
    `select i.code, i.name, i.unit, i.desired_direction, i.id indicator_id
     from goals g join indicator_definitions i on i.id = g.indicator_definition_id
     where g.organization_id = $1 and g.subject_type = 'TEAM' and g.subject_id = $2
       and g.valid_from <= $3::date and (g.valid_until is null or g.valid_until >= $3::date)`,
    [context.organizationId, teamId, window.end.toISOString()],
  )
  if (goalRows.rows.length === 0) throw new Error("Nenhum indicador com meta cadastrada para o time deste operador.")

  const indicators: { code: string; name: string; unit: string; value: number; targetValue: number | null; direction: string; measurementIds: string[] }[] = []
  // Elegibilidade resolvida UMA vez para o operador e reaproveitada em todos os indicadores.
  const eligible = await eligibleMeasurementFilter(context.db, { subjectIds: [operatorId], window, timeZone: await resolveOrganizationTimezone(context.db, context.organizationId), firstParam: 6 })
  for (const row of goalRows.rows) {
    const aggRow = await context.db.query<{ avg_value: string | null; ids: string[] | null }>(
      `with ${eligible.cte}
       select avg(m.value)::numeric avg_value, array_agg(m.id) ids
       from indicator_measurements m
       ${eligible.join}
       where m.organization_id = $1 and m.indicator_definition_id = $2 and m.subject_type = 'PERSON' and m.subject_id = $3
         and m.period_start >= $4 and m.period_start < $5 and ${eligible.predicate}`,
      [context.organizationId, row.indicator_id, operatorId, window.start.toISOString(), window.end.toISOString(), ...eligible.params],
    )
    const agg = aggRow.rows[0]
    if (!agg?.avg_value) continue // sem medição desse indicador no período — pula, não bloqueia o resumo

    const targetValue = await resolveOperatorTarget(context.db, context.organizationId, row.indicator_id, operatorId, window.end.toISOString())
    indicators.push({
      code: row.code,
      name: row.name,
      unit: row.unit,
      value: Number(agg.avg_value),
      targetValue,
      direction: row.desired_direction,
      measurementIds: agg.ids ?? [],
    })
  }
  if (indicators.length === 0) throw new Error(`Sem nenhuma medição no período selecionado (${PERIOD_LABEL[period]}) para este operador.`)

  const periodLabel = PERIOD_LABEL[period] ?? period
  const inputContext = [
    `Período avaliado: ${periodLabel} (${window.start.toISOString().slice(0, 10)} a ${window.end.toISOString().slice(0, 10)})`,
    ...indicators.map((indicator) => {
      const gap = describeTargetGap(indicator.value, indicator.targetValue, indicator.direction, indicator.unit)
      return `- ${indicator.name} (${indicator.code}): ${indicator.value.toFixed(2)} ${indicator.unit}, meta ${
        indicator.targetValue !== null ? `${indicator.targetValue} ${indicator.unit}` : "não cadastrada"
      }. ${gap}`
    }),
  ].join("\n")

  return runAgent(context.db, {
    organizationId: context.organizationId,
    agentId: config.agentId,
    inputContext,
    source: "WORKFLOW",
    recorder: context.effects.agentRuns,
    allowedCapabilities: config.allowedCapabilities ?? null,
    now: context.now,
    workflow: {
      kind: "indicator_summary",
      operatorId,
      teamId,
      periodLabel,
      periodStart: window.start.toISOString(),
      periodEnd: window.end.toISOString(),
      indicators,
    },
  })
}

/**
 * Fechamentos oficiais (PRV + indicadores por competência) — lidos prontos de
 * employee_prv_performance/employee_indicator_performance, nunca recalculados (o PRV é sempre o
 * valor persistido; weight_percent só explica a composição). Reaproveita o contrato
 * "indicator_summary" de runAgent: a competência mais recente vira a lista de indicadores, e
 * as anteriores entram como histórico textual pro agente comentar a evolução com os números
 * oficiais, sem calcular variação.
 */
async function callAgentForPerformance(
  config: Extract<ActionConfig, { actionType: "CALL_AGENT" }>,
  context: ActionExecutionContext,
  operatorId: string,
  teamId: string,
  closures: number,
) {
  type PrvRow = { id: string; reference_period: string; achievement_percent: string; quartile: string }
  type IndicatorRow = {
    id: string
    reference_period: string
    code: string
    name: string
    unit: string
    desired_direction: string
    value: string
    target_value: string | null
    achievement_percent: string | null
    weight_percent: string | null
    quartile: string | null
  }
  // Guard central do fechamento oficial: só competências <= último mês fechado no fuso da
  // organização (official-closure-policy.ts) — o mês corrente nunca chega ao Agent como fechamento.
  const closure = await resolveOfficialClosure(context.db, context.organizationId, context.now)
  const prvRows = await context.db.query<PrvRow>(
    `select id, reference_period, achievement_percent, quartile
     from employee_prv_performance
     where organization_id = $1 and person_id = $2 and reference_period <= $4
     order by reference_period desc limit $3`,
    [context.organizationId, operatorId, closures, closure.lastClosedPeriod],
  )
  const indicatorRows = await context.db.query<IndicatorRow>(
    `select e.id, e.reference_period, i.code, i.name, i.unit, i.desired_direction, e.value, e.target_value, e.achievement_percent, e.weight_percent, e.quartile
     from employee_indicator_performance e
     join indicator_definitions i on i.id = e.indicator_definition_id
     where e.organization_id = $1 and e.person_id = $2 and e.reference_period <= $4
       and e.reference_period in (
         select reference_period from employee_indicator_performance
         where organization_id = $1 and person_id = $2 and reference_period <= $4 group by reference_period order by reference_period desc limit $3
       )
     order by e.reference_period desc, i.name`,
    [context.organizationId, operatorId, closures, closure.lastClosedPeriod],
  )
  const periods = [...new Set([...prvRows.rows.map((row) => row.reference_period), ...indicatorRows.rows.map((row) => row.reference_period)])].sort().reverse()
  if (periods.length === 0) throw new Error("Sem fechamento oficial de performance (PRV/indicadores) para este operador.")

  const latestPeriod = periods[0]!
  const describeIndicator = (row: IndicatorRow) =>
    `- ${row.name} (${row.code}): ${row.value} ${row.unit}, meta ${row.target_value ?? "não informada"}${row.achievement_percent !== null ? `, atingimento ${row.achievement_percent}%` : ""}${row.weight_percent !== null ? `, peso ${row.weight_percent}%` : ""}${row.quartile ? `, quartil ${row.quartile}` : ""}`
  const lines: string[] = []
  for (const period of periods) {
    const prv = prvRows.rows.find((row) => row.reference_period === period)
    lines.push(`Fechamento ${period}${period === latestPeriod ? " (mais recente)" : ""}:`)
    lines.push(prv ? `- PRV oficial: atingimento ${prv.achievement_percent}%, quartil ${prv.quartile}` : "- PRV oficial: sem dados nesta competência")
    const rows = indicatorRows.rows.filter((row) => row.reference_period === period)
    if (rows.length === 0) lines.push("- Indicadores: sem dados nesta competência")
    lines.push(...rows.map(describeIndicator))
    lines.push("")
  }
  lines.push("Os números acima são oficiais e já fechados — use-os exatamente como estão; nunca recalcule PRV, atingimento ou variação.")

  const latestRows = indicatorRows.rows.filter((row) => row.reference_period === latestPeriod)
  const latestPrv = prvRows.rows.find((row) => row.reference_period === latestPeriod)
  const indicators = latestRows.map((row) => ({
    code: row.code,
    name: row.name,
    unit: row.unit,
    value: Number(row.value),
    targetValue: row.target_value === null ? null : Number(row.target_value),
    direction: row.desired_direction,
    measurementIds: [row.id],
  }))
  if (latestPrv) indicators.unshift({ code: "PRV", name: "PRV (atingimento oficial)", unit: "%", value: Number(latestPrv.achievement_percent), targetValue: 100, direction: "HIGHER", measurementIds: [latestPrv.id] })

  const periodLabel = `Fechamento ${latestPeriod}${periods.length > 1 ? ` (+${periods.length - 1} anterior${periods.length > 2 ? "es" : ""})` : ""}`
  return runAgent(context.db, {
    organizationId: context.organizationId,
    agentId: config.agentId,
    inputContext: lines.join("\n"),
    source: "WORKFLOW",
    recorder: context.effects.agentRuns,
    allowedCapabilities: config.allowedCapabilities ?? null,
    now: context.now,
    workflow: {
      kind: "indicator_summary",
      operatorId,
      teamId,
      periodLabel,
      periodStart: `${periods[periods.length - 1]}-01`,
      periodEnd: `${latestPeriod}-01`,
      evidenceSourceType: "employee_performance",
      indicators,
    },
  })
}

async function callAgentForSchedule(config: Extract<ActionConfig, { actionType: "CALL_AGENT" }>, context: ActionExecutionContext) {
  const source = config.scheduledDataSource
  if (!source) throw new Error("Ação sem fonte de dados configurada para o gatilho por agenda.")
  const operatorId = context.enrollment.scheduledSubjectId
  if (!operatorId) throw new Error("Matrícula por agenda sem operador associado.")

  const operatorRow = await context.db.query<{ team_id: string | null }>(`select team_id from people where id = $1`, [operatorId])
  const teamId = operatorRow.rows[0]?.team_id
  if (!teamId) throw new Error("O operador não está associado a um grupo.")

  // INDICATOR DIAGNOSIS V1 — diagnóstico do FECHAMENTO do PRV (plano do sistema; o Agent só avalia o que falta).
  if (source.kind === "PERFORMANCE" && config.outputContract === "PRV_CLOSING_DIAGNOSIS") return callAgentForPrvClosing(config, context, operatorId, teamId)
  // INDICATOR DIAGNOSIS V2 — diagnóstico DIRETO de UM indicador a partir do fechamento oficial dele (sem PRV).
  if (source.kind === "PERFORMANCE" && config.outputContract === "INDICATOR_DIAGNOSIS" && source.indicatorCode) return callAgentForIndicatorDiagnosis(config, context, operatorId, teamId, source.indicatorCode)
  if (source.kind === "PERFORMANCE") return callAgentForPerformance(config, context, operatorId, teamId, source.closures)

  const window = resolvePeriodWindow(source.period, context.now)

  if (source.kind === "MONITORING") {
    const interactions = await context.db.query<{ id: string }>(
      `select id from interactions where operator_id = $1 and started_at >= $2 and started_at < $3 order by random() limit $4`,
      [operatorId, window.start.toISOString(), window.end.toISOString(), source.sampleSize],
    )
    if (interactions.rows.length === 0) {
      return { id: "", outputText: null, status: "COMPLETED", errorMessage: null } as const
    }
    let last = { id: "", outputText: null as string | null, status: "COMPLETED", errorMessage: null as string | null }
    for (const interaction of interactions.rows) {
      last = await callAgentForSampledInteraction(config, context, interaction.id, operatorId, teamId)
      if (last.status === "FAILED") return last // propaga a falha — o enrollment tenta de novo
    }
    return last
  }

  if (source.indicatorCode) return callAgentForIndicatorPeriod(config, context, operatorId, teamId, source.indicatorCode, source.period, window)
  return callAgentForIndicatorSummary(config, context, operatorId, teamId, source.period, window)
}

// A lógica de verdade mora em escalate-executor.ts (mesmo padrão de orchestrator/output/human
// review — cada um com seu próprio arquivo de execução). Esta é só a ponte que monta o context
// esperado a partir do ActionExecutionContext genérico, igual as outras Actions já fazem.
const escalate: Executor = async (config, context) => {
  if (config.actionType !== "ESCALATE") throw new Error("Config de ação inválida para ESCALATE.")
  const result = await executeEscalation(config, {
    db: context.db,
    organizationId: context.organizationId,
    enrollmentId: context.enrollment.id,
    nodeId: context.nodeId,
    nodeOutputs: context.enrollment.nodeOutputs,
    enrollment: {
      interactionId: context.enrollment.interactionId,
      indicatorMeasurementId: context.enrollment.indicatorMeasurementId,
      scheduledSubjectId: context.enrollment.scheduledSubjectId,
    },
    effects: context.effects,
  })
  return { nodeOutput: result.nodeOutput }
}

const CONCLUSION_LABELS: Record<string, string> = {
  PATTERN_SUPPORTED: "padrão de processo sustentado nas chamadas do recorte",
  STRENGTH_PATTERN: "prática consistente a preservar",
  RESULT_RECOGNITION: "resultado a reconhecer",
  CHANGE_LOCATED_NO_CAUSE: "mudança localizada, sem causa sustentada",
  CHANGE_LOCATED_NOT_EXAMINED: "mudança localizada, chamadas do recorte não examinadas",
  MIX_EFFECT: "variação explicada pela mudança no mix de assuntos",
  INSUFFICIENT_DATA: "dados insuficientes para diagnosticar",
}

/**
 * MOTOR DE FEEDBACK — formatos de análise que o motor executa (a MESMA análise vira memória, diagnóstico e feedback):
 *   Flag + "Avaliação de processo"                        → análise da chamada contra o procedimento completo;
 *   Indicador + "Diagnóstico do indicador"                → investigação a partir da medição;
 *   Agenda + fechamentos oficiais + diagnóstico (PRV/um indicador) → investigação a partir do fechamento oficial.
 * O especialista configurado no nó dá a base de conhecimento e a orientação do domínio. Demais formatos: o Agent de sempre.
 */
async function callAgentThroughEngine(config: Extract<ActionConfig, { actionType: "CALL_AGENT" }>, context: ActionExecutionContext): Promise<ActionResult | null> {
  const trigger = { kind: "WORKFLOW_SOURCE_NODE" as const, workflowId: context.workflowId, workflowVersionId: context.workflowVersionId, enrollmentId: context.enrollment.id, nodeId: context.nodeId }
  if (context.enrollment.interactionId && config.outputContract === "PROCESS_ASSESSMENT") {
    const operator = (await context.db.query<{ operator_id: string }>(`select operator_id from interactions where id = $1 and organization_id = $2`, [context.enrollment.interactionId, context.organizationId])).rows[0]
    if (!operator) throw new Error("Interação não encontrada para a análise da chamada.")
    const flag = context.enrollment.matchedFlagName
    const value = context.enrollment.matchedValueBoolean !== null ? (context.enrollment.matchedValueBoolean ? "sim" : "não") : context.enrollment.matchedValueNumeric ?? ""
    const selectionReason = flag ? `Sinal da chamada no gatilho do Workflow: ${flag}${value ? ` = ${value}` : ""}.` : "Chamada selecionada pela execução do Workflow."
    // `ONE_MONITORING_PER_CALL_V1`: chamada já monitorada não é analisada de novo para monitoria (zero IA); o "Gerar feedback" se abstém.
    const monitored = await context.effects.feedbackEngine.deliveredMonitoring(context.db, { organizationId: context.organizationId, interactionId: context.enrollment.interactionId })
    if (monitored) return { nodeOutput: { kind: "FEEDBACK_ENGINE_CALL_ALREADY_MONITORED", interactionId: context.enrollment.interactionId, personId: operator.operator_id, skippedReason: "CALL_ALREADY_MONITORED", existing: { source: monitored.source, id: monitored.id, deliveredAt: monitored.deliveredAt.toISOString() }, text: `Chamada já monitorada (${monitored.deliveredAt.toISOString().slice(0, 10)}): uma chamada recebe uma monitoria só — nada foi analisado.` } }
    const nodeOutput = await context.effects.feedbackEngine.analyzeCall(context.db, { organizationId: context.organizationId, interactionId: context.enrollment.interactionId, collaboratorId: operator.operator_id, agentId: config.agentId, trigger: { ...trigger, selectionReason } })
    return { nodeOutput }
  }
  let target: InvestigationTarget | null = null
  let personId: string | null = null
  if (context.enrollment.indicatorMeasurementId && config.outputContract === "INDICATOR_DIAGNOSIS") {
    target = { kind: "MEASUREMENT", measurementId: context.enrollment.indicatorMeasurementId }
    personId = (await context.db.query<{ subject_id: string }>(`select subject_id from indicator_measurements where id = $1 and organization_id = $2 and subject_type = 'PERSON'`, [context.enrollment.indicatorMeasurementId, context.organizationId])).rows[0]?.subject_id ?? null
  } else if (!context.enrollment.interactionId && !context.enrollment.indicatorMeasurementId && config.scheduledDataSource?.kind === "PERFORMANCE") {
    if (config.outputContract === "PRV_CLOSING_DIAGNOSIS") target = { kind: "PRV_CLOSING" }
    else if (config.outputContract === "INDICATOR_DIAGNOSIS" && config.scheduledDataSource.indicatorCode) target = { kind: "OFFICIAL_CLOSING", indicatorCode: config.scheduledDataSource.indicatorCode }
    personId = context.enrollment.scheduledSubjectId
  }
  if (!target) return null
  if (!personId) throw new Error("Não foi possível identificar o colaborador da investigação do indicador.")
  const agentConfiguredAt = (await context.db.query<{ updated_at: Date }>(`select updated_at from agents where id = $1 and organization_id = $2`, [config.agentId, context.organizationId])).rows[0]?.updated_at ?? null
  // "Ferramentas nesta execução" do nó restringe as capacidades do especialista (nunca concede) — também no motor.
  const result = await context.effects.feedbackEngine.investigateIndicator(context.db, { organizationId: context.organizationId, personId, agentId: config.agentId, agentConfiguredAt: agentConfiguredAt ? new Date(agentConfiguredAt).toISOString() : null, enrollmentId: context.enrollment.id, target, trigger: { ...trigger, kind: "INDICATOR_INVESTIGATION", selectionReason: "Investigação do indicador pelo Workflow." }, now: context.now, allowedCapabilities: config.allowedCapabilities ?? null })
  const nodeOutput: IndicatorAnalysisNodeOutput = {
    kind: INDICATOR_ANALYSIS_NODE_OUTPUT_KIND,
    personId,
    agentId: config.agentId,
    investigations: result.investigations.map((entry) => ({ analysisRunId: entry.runId, investigationId: entry.investigationId, indicatorCode: entry.indicatorCode, periodLabel: entry.periodLabel, conclusion: entry.conclusion, reused: entry.reused })),
    skippedReason: result.skippedReason,
    text: result.skippedReason ? `Nada a investigar (${result.skippedReason}).` : result.investigations.map((entry) => `${entry.indicatorCode} · ${entry.periodLabel}: ${entry.conclusion ? CONCLUSION_LABELS[entry.conclusion] ?? entry.conclusion : "sem conclusão"}.`).join("\n"),
  }
  return { nodeOutput }
}

const callAgent: Executor = async (config, context) => {
  if (config.actionType !== "CALL_AGENT") throw new Error("Config de ação inválida para CALL_AGENT.")

  const engine = await callAgentThroughEngine(config, context)
  if (engine) return engine

  const run = context.enrollment.interactionId
    ? await callAgentForInteraction(config, context)
    : context.enrollment.indicatorMeasurementId
      ? await callAgentForIndicator(config, context)
      : await callAgentForSchedule(config, context)

  // V1.7.1c — propaga o erro ORIGINAL (classificável: contrato × provedor × invariante), não só a mensagem.
  if (run.status === "FAILED") throw "error" in run && run.error instanceof Error ? run.error : new Error(run.errorMessage ?? "Falha ao executar o agente.")
  // O agente nunca publica nada sozinho — só devolve o resultado estruturado (workflowResult)
  // pro Execution Context. Quem decide se/como publicar é um node Output mais à frente no grafo.
  return { agentRunId: run.id, nodeOutput: "workflowResult" in run ? run.workflowResult : undefined }
}

const setConfigValue: Executor = async (config, context) => {
  if (config.actionType !== "SET_CONFIG_VALUE") throw new Error("Config de ação inválida para SET_CONFIG_VALUE.")

  // Configuração persistente — em produção grava em org_config_values; no QA Lab o sink só
  // registra que "isso seria alterado", nunca toca a configuração real (Parte 34 do pedido).
  await context.effects.setConfigValue(context.db, {
    organizationId: context.organizationId,
    scopeType: context.scopeType,
    teamId: context.teamId,
    subteamId: context.subteamId,
    configKey: config.configKey,
    valueType: config.valueType,
    value: config.value,
  })
  return {}
}

// Exportado — reaproveitado pela validação de publish em workflow-router.ts, pra rejeitar um
// valor fixo incompatível ANTES de publicar (não só quando o node roda em runtime).
export const VARIABLE_TYPE_CHECKERS: Record<string, (value: unknown) => boolean> = {
  BOOLEAN: (value) => typeof value === "boolean",
  NUMERIC: (value) => typeof value === "number" && Number.isFinite(value),
  TEXT: (value) => typeof value === "string",
}

const setVariable: Executor = async (config, context) => {
  if (config.actionType !== "SET_VARIABLE") throw new Error("Config de ação inválida para SET_VARIABLE.")

  const variableRow = await context.db.query<{ type: string }>(
    `select type from workflow_variables where id = $1 and workflow_id = $2`,
    [config.variableId, context.workflowId],
  )
  const variable = variableRow.rows[0]
  if (!variable) throw new Error(`Variável "${config.variableId}" não existe mais neste workflow.`)

  let value: boolean | number | string
  if (config.sourcePath) {
    // Valor dinâmico — lê algo que já existe no Execution Context desta execução (gatilho, node
    // anterior ou outra variável), nunca calcula nada novo (evolução de Variáveis do Workflow).
    const raw = resolveContextValue({ nodeOutputs: context.enrollment.nodeOutputs, variables: context.enrollment.variables }, config.sourcePath)
    if (raw === undefined || raw === null) {
      throw new Error("Não foi possível resolver o valor dinâmico da variável — a origem selecionada ainda não produziu nenhum valor nesta execução.")
    }
    if (typeof raw !== "boolean" && typeof raw !== "number" && typeof raw !== "string") {
      throw new Error("O valor dinâmico da variável não é um tipo simples (texto, número ou verdadeiro/falso).")
    }
    value = raw
  } else {
    if (config.value === undefined) throw new Error("Nenhum valor fixo definido para a variável.")
    value = config.value
  }

  if (!VARIABLE_TYPE_CHECKERS[variable.type]?.(value)) {
    throw new Error(`O valor definido não é compatível com o tipo da variável (${variable.type}).`)
  }

  return {
    variableUpdate: { variableId: config.variableId, value },
    // Auditoria (Parte 28/29 do pedido) — nunca inclui UUID/JSON path cru, só o essencial pra
    // reconstruir "o que aconteceu": qual variável, qual valor, veio de onde.
    nodeOutput: { variableId: config.variableId, value, source: config.sourcePath ? "DYNAMIC" : "FIXED", ...(config.sourcePath ? { sourcePath: config.sourcePath } : {}) },
  }
}

/**
 * Registro de ações do nó "Ação" — extensível: um novo destino é uma nova
 * entrada aqui, sem tocar no motor de execução do grafo.
 */
// V1.5.10: feedback de atendimento (INTERACTION FEEDBACK V1) — execução em interaction-feedback-action.ts. Distinto do
// CALL_AGENT acima, que é o caminho do feedback de monitoria LEGADO (Agent → Output → `feedbacks`).
const generateInteractionFeedback: Executor = async (config, context) => {
  if (config.actionType !== "GENERATE_INTERACTION_FEEDBACK") throw new Error("Config de ação inválida para GENERATE_INTERACTION_FEEDBACK.")
  return executeGenerateInteractionFeedback(config, context)
}

// V1.5.12: feedback OFICIAL de monitoria/indicador pela camada de confiabilidade (generate-feedback-action.ts).
const generateFeedback: Executor = async (config, context) => {
  if (config.actionType !== "GENERATE_FEEDBACK") throw new Error("Config de ação inválida para GENERATE_FEEDBACK.")
  return executeGenerateFeedback(config, context)
}

export const actionExecutors: Record<ActionConfig["actionType"], Executor> = {
  CALL_AGENT: callAgent,
  SET_CONFIG_VALUE: setConfigValue,
  ESCALATE: escalate,
  SET_VARIABLE: setVariable,
  GENERATE_INTERACTION_FEEDBACK: generateInteractionFeedback,
  GENERATE_FEEDBACK: generateFeedback,
}
