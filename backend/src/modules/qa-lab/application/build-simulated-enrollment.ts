import { createHash, randomUUID } from "node:crypto"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { resolveStructureAnchorOperatorIds } from "../../workflows/application/hierarchy-subjects.js"
import type { EnrollmentRow, WorkflowScope } from "../../workflows/application/node-handlers.js"
import { resolveOrganizationTimezone } from "../../workflows/application/organization-timezone.js"
import { localDateParts } from "../../workflows/application/schedule-recurrence.js"
import { resolveRelativeInstant, resolveShiftWindow } from "../../workflows/application/shift-schedule.js"
import { consolidatedStructureAnchorId, consolidatedStructureSchema, type ConsolidatedStructure } from "../../workflows/domain/consolidated-structure-schema.js"
import type { FlowGraph } from "../../workflows/domain/graph-schema.js"
import { flowGraphSchema } from "../../workflows/domain/graph-schema.js"
import { triggerConfigSchema, triggerIndicatorCodeOf, type TriggerConfig } from "../../workflows/domain/trigger-config-schema.js"
import type { WorkflowSnapshot, WorkflowState, WorkflowSubject } from "../domain/qa-run-schema.js"
import { assertOperatorEligible, resolveInteractionEvidence, type InteractionEvidence } from "./interaction-evidence.js"
import { lastClosedReferencePeriod } from "../../indicators/domain/official-closure-policy.js"


export type QaWorkflowRow = {
  id: string
  name: string
  scope_type: string
  team_id: string | null
  subteam_id: string | null
  trigger_config: unknown
  consolidated_structure: unknown
  population_filter: unknown
  active_version_id: string | null
  draft_graph: unknown
  published_graph: unknown
  /** Configuração PUBLICADA (o que o runtime lê) — os campos acima são a do RASCUNHO até `withSimulationConfiguration`. */
  published_configuration?: PublishedConfiguration | null
}

type PublishedConfiguration = Pick<QaWorkflowRow, "scope_type" | "team_id" | "subteam_id" | "trigger_config" | "consolidated_structure" | "population_filter">

/**
 * Carrega o Workflow com a configuração do RASCUNHO nos campos de cima (Gatilho, Abrangência, Modo de
 * avaliação — o QA Lab testa o rascunho por padrão, e os seletores de massa seguem o que está sendo
 * editado) e a PUBLICADA em `published_configuration`. Quem testa a versão publicada troca para ela
 * com `withSimulationConfiguration` — nunca mistura grafo publicado com configuração do rascunho.
 */
export async function loadWorkflowForSimulation(db: Database, organizationId: string, workflowId: string): Promise<QaWorkflowRow | null> {
  const result = await db.query<QaWorkflowRow>(
    `select w.id, w.name, w.draft_scope_type scope_type, w.draft_team_id team_id, w.draft_subteam_id subteam_id, w.draft_trigger_config trigger_config,
            w.draft_consolidated_structure consolidated_structure, w.draft_population_filter population_filter, w.active_version_id, w.draft_graph,
            (select graph from workflow_versions where id = w.active_version_id) published_graph,
            jsonb_build_object('scope_type', w.scope_type, 'team_id', w.team_id, 'subteam_id', w.subteam_id, 'trigger_config', w.trigger_config,
                               'consolidated_structure', w.consolidated_structure, 'population_filter', w.population_filter) published_configuration
     from workflows w where w.id = $1 and w.organization_id = $2`,
    [workflowId, organizationId],
  )
  return result.rows[0] ?? null
}

/** A configuração que acompanha o grafo testado: rascunho com rascunho, publicada com publicada. */
export function withSimulationConfiguration(row: QaWorkflowRow, state: WorkflowState): QaWorkflowRow {
  if (state !== "PUBLISHED" || !row.published_configuration) return row
  return { ...row, ...row.published_configuration }
}

/**
 * Qual configuração testar — DRAFT (rascunho atual persistido) ou PUBLISHED (versão pinada por
 * active_version_id). Nunca mistura os dois. Ausente = rascunho: o QA Lab existe pra testar
 * ANTES de publicar; publicar nunca é pré-requisito. Rascunho e publicada são sempre lidos do
 * banco tal como estão — publicar automaticamente pra testar é proibido (Parte 8).
 */
export function resolveSimulationGraph(row: QaWorkflowRow, source: WorkflowState | undefined): { graph: FlowGraph; source: WorkflowState } {
  const effective: WorkflowState = source ?? "DRAFT"
  if (effective === "PUBLISHED" && !row.published_graph) {
    throw new DomainError("Este workflow ainda não tem versão publicada — teste o rascunho.", "QA_WORKFLOW_NOT_PUBLISHED", 422)
  }
  return { graph: flowGraphSchema.parse(effective === "PUBLISHED" ? row.published_graph : row.draft_graph), source: effective }
}

export function graphChecksum(graph: unknown): string {
  return createHash("sha256").update(JSON.stringify(graph)).digest("hex").slice(0, 12)
}

/** Congela tudo que a engine lê do Workflow no momento do "Executar" (ver WorkflowSnapshot). */
export function captureWorkflowSnapshot(row: QaWorkflowRow, graph: FlowGraph, state: WorkflowState, capturedAt: Date): WorkflowSnapshot {
  return {
    workflowId: row.id,
    name: row.name,
    workflowState: state,
    versionId: state === "PUBLISHED" ? row.active_version_id : null,
    graphChecksum: graphChecksum(graph),
    graph,
    triggerConfig: row.trigger_config,
    scopeType: row.scope_type,
    teamId: row.team_id,
    subteamId: row.subteam_id,
    consolidatedStructure: row.consolidated_structure ?? null,
    populationFilter: row.population_filter ?? null,
    capturedAt: capturedAt.toISOString(),
  }
}

/** Reconstrói a "linha" do Workflow a partir de um snapshot — é assim que "Executar novamente
 * esta versão" roda sem reler o Workflow atual (que pode ter mudado ou nem existir mais). */
export function rowFromSnapshot(snapshot: WorkflowSnapshot): QaWorkflowRow {
  return {
    id: snapshot.workflowId,
    name: snapshot.name,
    scope_type: snapshot.scopeType,
    team_id: snapshot.teamId,
    subteam_id: snapshot.subteamId,
    trigger_config: snapshot.triggerConfig,
    consolidated_structure: snapshot.consolidatedStructure,
    population_filter: snapshot.populationFilter,
    active_version_id: snapshot.versionId,
    draft_graph: snapshot.workflowState === "DRAFT" ? snapshot.graph : null,
    published_graph: snapshot.workflowState === "PUBLISHED" ? snapshot.graph : null,
  }
}

export type SimulatedEnrollment = {
  enrollment: EnrollmentRow
  inputContext: string
  workflow: WorkflowScope
  trigger: TriggerConfig
  /** Painel "Contexto utilizado" (Parte 42) — só o que é relevante pro teste. */
  context: Record<string, unknown>
  /** Pessoas citadas no contexto (operador, supervisor...), pra resolução de nomes na UI. */
  personIds: string[]
  /** Só em Trigger por Flag: identidade + checksum da interação usada (ver interaction-evidence.ts). */
  evidence?: InteractionEvidence
}

/** Evidência congelada de um QA Run anterior — "Executar novamente esta versão" reutiliza a
 * MESMA interação e a MESMA transcrição, nunca escolhe outra (Parte 42). */
export type FrozenEvidence = { evidence: InteractionEvidence; inputContext: string }

type PersonRow = { id: string; name: string; role: string; team_id: string | null; team_name: string | null; subteam_name: string | null; reports_to_id: string | null }

async function loadPerson(db: Database, organizationId: string, personId: string): Promise<PersonRow | null> {
  const result = await db.query<PersonRow>(
    `select p.id, p.name, p.role, p.team_id, t.name team_name, st.name subteam_name, p.reports_to_id
     from people p left join teams t on t.id = p.team_id left join subteams st on st.id = p.subteam_id
     where p.id = $1 and p.organization_id = $2`,
    [personId, organizationId],
  )
  return result.rows[0] ?? null
}

/** Cadeia hierárquica acima do operador (supervisor, coordenador, gerente...) — só nomes/cargos,
 * pra explicar no painel de contexto quem seria alvo de Output/Escalonar/Human Review. */
async function loadHierarchy(db: Database, organizationId: string, person: PersonRow): Promise<{ id: string; name: string; role: string }[]> {
  const chain: { id: string; name: string; role: string }[] = []
  const visited = new Set<string>([person.id])
  let currentId = person.reports_to_id
  while (currentId && !visited.has(currentId) && chain.length < 8) {
    visited.add(currentId)
    const row = await loadPerson(db, organizationId, currentId)
    if (!row) break
    chain.push({ id: row.id, name: row.name, role: row.role })
    currentId = row.reports_to_id
  }
  return chain
}

async function loadLatestPerformance(db: Database, personId: string, lastClosedPeriod: string): Promise<Record<string, unknown>[]> {
  // Guard central do fechamento oficial (official-closure-policy.ts): o contexto simulado nunca
  // apresenta o mês corrente como fechamento, mesmo que exista linha no banco.
  const indicators = await db.query<{ code: string; name: string; value: string; target_value: string | null; achievement_percent: string | null; quartile: string | null; reference_period: string }>(
    `select distinct on (idef.code) idef.code, idef.name, eip.value, eip.target_value, eip.achievement_percent, eip.quartile, eip.reference_period
     from employee_indicator_performance eip join indicator_definitions idef on idef.id = eip.indicator_definition_id
     where eip.person_id = $1 and eip.reference_period <= $2 order by idef.code, eip.reference_period desc`,
    [personId, lastClosedPeriod],
  )
  const prv = await db.query<{ achievement_percent: string; quartile: string; reference_period: string }>(
    `select achievement_percent, quartile, reference_period from employee_prv_performance where person_id = $1 and reference_period <= $2 order by reference_period desc limit 1`,
    [personId, lastClosedPeriod],
  )
  const rows: Record<string, unknown>[] = indicators.rows.map((row) => ({
    code: row.code,
    name: row.name,
    value: Number(row.value),
    targetValue: row.target_value !== null ? Number(row.target_value) : null,
    achievementPercent: row.achievement_percent !== null ? Number(row.achievement_percent) : null,
    quartile: row.quartile,
    referencePeriod: row.reference_period,
  }))
  if (prv.rows[0]) {
    rows.push({ code: "PRV", name: "PRV", value: null, targetValue: null, achievementPercent: Number(prv.rows[0].achievement_percent), quartile: prv.rows[0].quartile, referencePeriod: prv.rows[0].reference_period })
  }
  return rows
}

async function loadShift(db: Database, personId: string, dateStr: string): Promise<{ startTime: string; workMinutes: number } | null> {
  const result = await db.query<{ start_time: string; work_minutes: number }>(
    `select start_time, work_minutes from employee_work_shifts
     where person_id = $1 and effective_from <= $2::date and (effective_to is null or effective_to >= $2::date)
     order by effective_from desc limit 1`,
    [personId, dateStr],
  )
  const row = result.rows[0]
  return row ? { startTime: row.start_time, workMinutes: row.work_minutes } : null
}

async function operatorContext(db: Database, organizationId: string, operatorId: string, dateStr: string, timezone: string, simulatedNow: Date): Promise<{ context: Record<string, unknown>; personIds: string[] }> {
  const person = await loadPerson(db, organizationId, operatorId)
  if (!person) throw new DomainError("Colaborador não encontrado.", "QA_OPERATOR_NOT_FOUND", 404)
  const [hierarchy, indicators, shift] = await Promise.all([loadHierarchy(db, organizationId, person), loadLatestPerformance(db, operatorId, lastClosedReferencePeriod(simulatedNow, timezone)), loadShift(db, operatorId, dateStr)])
  const shiftWindow = shift ? resolveShiftWindow(shift, dateStr, timezone) : null
  return {
    context: {
      operator: {
        id: person.id,
        name: person.name,
        role: person.role,
        teamName: person.team_name,
        subteamName: person.subteam_name,
        hierarchy,
      },
      indicators,
      shift: shift && shiftWindow ? { startTime: shift.startTime.slice(0, 5), workMinutes: shift.workMinutes, start: shiftWindow.start.toISOString(), end: shiftWindow.end.toISOString() } : null,
    },
    personIds: [person.id, ...hierarchy.map((item) => item.id)],
  }
}

function baseEnrollment(organizationId: string, workflowId: string, versionId: string, triggerNodeId: string): EnrollmentRow {
  return {
    // UUID válido de propósito — várias leituras do motor filtram `where enrollment_id = $1`
    // (uuid) e falhariam com um id sintético não-uuid. Nunca existe no banco.
    id: randomUUID(),
    organization_id: organizationId,
    workflow_id: workflowId,
    version_id: versionId,
    interaction_id: null,
    indicator_measurement_id: null,
    scheduled_subject_id: null,
    scheduled_for: null,
    current_node_id: triggerNodeId,
    matched_flag_name: null,
    matched_value_boolean: null,
    matched_value_numeric: null,
    status: "active",
    attempts: 0,
    revision: 0,
    node_outputs: {},
    variables: {},
  }
}

/**
 * Monta, a partir de dados REAIS escolhidos explicitamente pelo admin, exatamente a linha que
 * a ingestão (flag/indicador) ou o checador de agenda criaria em `workflow_enrollments` — só que
 * em memória. É o "UM CONTEXTO" do QA Lab: nada passa pelo barramento, nenhum outro Workflow
 * é matriculado, nenhum dado é alterado (Parte 9/19).
 */
export async function buildSimulatedEnrollment(
  db: Database,
  /** Organização de quem executa o teste (sessão do administrador): a matrícula simulada nasce nela. */
  organizationId: string,
  row: QaWorkflowRow,
  graph: FlowGraph,
  subject: WorkflowSubject,
  clock: { simulatedNow: Date; scheduledFor: Date | null },
  frozen?: FrozenEvidence | undefined,
): Promise<SimulatedEnrollment> {
  const trigger = triggerConfigSchema.parse(row.trigger_config)
  const triggerNode = graph.nodes.find((node) => node.type === "trigger")
  if (!triggerNode) throw new DomainError("O grafo deste workflow não tem node Trigger.", "QA_WORKFLOW_NO_TRIGGER", 422)
  const timezone = await resolveOrganizationTimezone(db, organizationId)
  const simulatedDate = localDateParts(clock.simulatedNow, timezone).date
  const configuredStructure: ConsolidatedStructure | null = row.consolidated_structure ? consolidatedStructureSchema.parse(row.consolidated_structure) : null
  const versionId = row.active_version_id ?? randomUUID()
  const enrollment = baseEnrollment(organizationId, row.id, versionId, triggerNode.id)
  const workflow: WorkflowScope = { scopeType: row.scope_type, teamId: row.team_id, subteamId: row.subteam_id, consolidatedStructure: configuredStructure }

  const manual = trigger.kind === "manual" ? trigger : null
  if (trigger.kind === "channel_flag" || manual?.context === "INTERACTION") {
    if (subject.kind !== "interaction") throw new DomainError(manual ? "Este workflow manual analisa uma interação — selecione uma interação do colaborador." : "Este workflow dispara por flag de canal — selecione uma interação.", "QA_SUBJECT_MISMATCH", 422)
    // Existe / canal / flag do gatilho / colaborador elegível — validado no backend, nunca só
    // pela lista do frontend (Parte 22). A linha do enrollment abaixo é a MESMA que a ingestão
    // grava (interaction_id + matched_flag_name + matched_value_*): a interação É o evento.
    const resolved = await resolveInteractionEvidence(db, organizationId, row, subject.interactionId, frozen)
    const { evidence } = resolved
    const { context, personIds } = await operatorContext(db, organizationId, evidence.operatorId, simulatedDate, timezone, clock.simulatedNow)
    enrollment.interaction_id = evidence.interactionId
    enrollment.matched_flag_name = resolved.matched.flagName
    enrollment.matched_value_boolean = resolved.matched.valueBoolean
    enrollment.matched_value_numeric = resolved.matched.valueNumeric
    return {
      enrollment,
      inputContext: resolved.inputContext,
      workflow,
      trigger,
      context: {
        ...context,
        trigger: evidence.flag
          ? { kind: "channel_flag", flagName: evidence.flag.name, channel: evidence.channel, value: evidence.flag.value }
          : { kind: "manual", context: "INTERACTION", channel: evidence.channel },
        // Superconjunto do formato anterior (id/externalId/reason/channel/startedAt/endedAt/
        // hasTranscript) — runs antigos continuam legíveis na UI.
        interaction: {
          id: evidence.interactionId,
          externalId: evidence.externalId,
          reason: evidence.reason,
          ...(evidence.subReason ? { subReason: evidence.subReason } : {}),
          channel: evidence.channel,
          startedAt: evidence.startedAt,
          endedAt: evidence.endedAt,
          durationSeconds: evidence.durationSeconds,
          operatorId: evidence.operatorId,
          operatorName: evidence.operatorName,
          flag: evidence.flag,
          hasTranscript: evidence.transcript.available,
          transcript: evidence.transcript,
          transcriptChangedSinceOriginalRun: resolved.transcriptChangedSinceOriginalRun,
        },
        simulatedNow: clock.simulatedNow.toISOString(),
      },
      personIds,
      evidence,
    }
  }

  if (trigger.kind === "indicator" || manual?.context === "INDICATOR_MEASUREMENT") {
    const expectedCode = triggerIndicatorCodeOf(trigger)
    if (subject.kind !== "measurement") throw new DomainError("Este workflow parte de uma medição de indicador — selecione uma medição de um colaborador.", "QA_SUBJECT_MISMATCH", 422)
    const measurement = await db.query<{ id: string; subject_id: string; value: string; period_start: string; period_end: string; code: string; name: string; unit: string; target: string | null }>(
      `select m.id, m.subject_id, m.value, m.period_start, m.period_end, i.code, i.name, i.unit,
              (select g.target_value from goals g join people p on p.id = m.subject_id
                where g.indicator_definition_id = i.id and g.subject_type = 'TEAM' and g.subject_id = p.team_id
                  and g.valid_from <= m.period_end::date and (g.valid_until is null or g.valid_until >= m.period_end::date)
                order by g.valid_from desc limit 1) target
       from indicator_measurements m join indicator_definitions i on i.id = m.indicator_definition_id
       where m.id = $1 and m.organization_id = $2 and m.subject_type = 'PERSON'`,
      [subject.measurementId, organizationId],
    )
    const row2 = measurement.rows[0]
    if (!row2) throw new DomainError("Medição não encontrada.", "QA_MEASUREMENT_NOT_FOUND", 404)
    if (row2.code !== expectedCode) {
      throw new DomainError(`A medição selecionada é do indicador "${row2.code}", mas o workflow dispara por "${expectedCode}".`, "QA_INDICATOR_MISMATCH", 422)
    }
    if (manual) await assertOperatorEligible(db, organizationId, row, row2.subject_id)
    const { context, personIds } = await operatorContext(db, organizationId, row2.subject_id, simulatedDate, timezone, clock.simulatedNow)
    enrollment.indicator_measurement_id = row2.id
    enrollment.matched_value_numeric = row2.value
    return {
      enrollment,
      inputContext: "",
      workflow,
      trigger,
      context: {
        ...context,
        trigger: { kind: manual ? "manual" : "indicator", ...(manual ? { context: "INDICATOR_MEASUREMENT" } : {}), indicatorCode: row2.code, indicatorName: row2.name, unit: row2.unit, value: Number(row2.value), targetValue: row2.target !== null ? Number(row2.target) : null },
        measurement: { id: row2.id, periodStart: row2.period_start, periodEnd: row2.period_end },
        simulatedNow: clock.simulatedNow.toISOString(),
      },
      personIds,
    }
  }

  // Manual por colaborador: só o colaborador escolhido (a mesma linha que o "Executar agora" grava — sem horário agendado).
  if (trigger.kind === "manual") {
    if (subject.kind !== "operator") throw new DomainError("Este workflow manual executa para um colaborador — selecione um colaborador.", "QA_SUBJECT_MISMATCH", 422)
    await assertOperatorEligible(db, organizationId, row, subject.operatorId)
    const { context, personIds } = await operatorContext(db, organizationId, subject.operatorId, simulatedDate, timezone, clock.simulatedNow)
    enrollment.scheduled_subject_id = subject.operatorId
    return {
      enrollment,
      inputContext: "",
      workflow,
      trigger,
      context: { ...context, trigger: { kind: "manual", context: "COLLABORATOR" }, simulatedNow: clock.simulatedNow.toISOString() },
      personIds,
    }
  }

  // schedule
  if (trigger.mode === "RELATIVE_TO_SHIFT") {
    if (subject.kind !== "operator") throw new DomainError("Agenda relativa ao expediente é individual — selecione um colaborador.", "QA_SUBJECT_MISMATCH", 422)
    if (!trigger.relative) throw new DomainError("Trigger relativo ao expediente sem configuração.", "QA_TRIGGER_INVALID", 422)
    const shift = await loadShift(db, subject.operatorId, simulatedDate)
    if (!shift) throw new DomainError("O colaborador selecionado não tem jornada cadastrada para a data simulada — cadastre a jornada em Usuários ou escolha outro colaborador.", "QA_SHIFT_MISSING", 422)
    const instant = resolveRelativeInstant(shift, trigger.relative, simulatedDate, timezone)
    if (!instant) throw new DomainError("A regra relativa deste workflow é incompatível com a jornada do colaborador (cairia fora do expediente).", "QA_SHIFT_INCOMPATIBLE", 422)
    const { context, personIds } = await operatorContext(db, organizationId, subject.operatorId, simulatedDate, timezone, clock.simulatedNow)
    enrollment.scheduled_subject_id = subject.operatorId
    enrollment.scheduled_for = instant.toISOString()
    return {
      enrollment,
      inputContext: "",
      workflow,
      trigger,
      context: { ...context, trigger: { kind: "schedule", mode: "RELATIVE_TO_SHIFT", scheduledFor: instant.toISOString(), simulatedDate }, simulatedNow: clock.simulatedNow.toISOString() },
      personIds,
    }
  }

  const scheduledFor = clock.scheduledFor ?? clock.simulatedNow
  if (!configuredStructure) {
    // Modo Individual — o QA Lab sempre pede um colaborador específico (nunca faz fan-out, e
    // escolher manualmente fora do Filtro Populacional configurado é aceitável aqui: é uma
    // ferramenta de teste, a intenção já é explícita).
    if (subject.kind !== "operator") throw new DomainError("Este workflow analisa um colaborador por vez — selecione um colaborador.", "QA_SUBJECT_MISMATCH", 422)
    const { context, personIds } = await operatorContext(db, organizationId, subject.operatorId, simulatedDate, timezone, clock.simulatedNow)
    enrollment.scheduled_subject_id = subject.operatorId
    enrollment.scheduled_for = scheduledFor.toISOString()
    return {
      enrollment,
      inputContext: "",
      workflow,
      trigger,
      context: { ...context, trigger: { kind: "schedule", mode: "CALENDAR", scheduledFor: scheduledFor.toISOString() }, simulatedNow: clock.simulatedNow.toISOString() },
      personIds,
    }
  }

  // Modo Consolidado — o admin escolhe UMA estrutura (pode sobrescrever a Estrutura Consolidada
  // configurada, só dentro do Simulation Context). Mesma resolução de membros do checador
  // (schedule-check.ts).
  const structure: ConsolidatedStructure = subject.kind === "unit" ? subject.consolidatedStructure : configuredStructure
  if (subject.kind !== "unit") {
    throw new DomainError("Este workflow tem modo de avaliação Consolidado — selecione uma estrutura.", "QA_SUBJECT_MISMATCH", 422)
  }
  if (structure.kind !== configuredStructure.kind) {
    throw new DomainError(`A estrutura selecionada (${structure.kind}) não é do mesmo tipo configurado no workflow (${configuredStructure.kind}).`, "QA_UNIT_KIND_MISMATCH", 422)
  }
  const anchorId = consolidatedStructureAnchorId(structure)
  const memberIds = await resolveStructureAnchorOperatorIds(db, structure, anchorId)
  if (memberIds.length === 0) throw new DomainError("A estrutura selecionada não tem nenhum operador — nada a analisar.", "QA_UNIT_EMPTY", 422)
  const subjectId = anchorId ?? [...memberIds].sort()[0]!
  const anchor = anchorId ? await loadPerson(db, organizationId, anchorId) : null
  const windowStart = new Date(clock.simulatedNow.getTime() - 30 * 24 * 60 * 60 * 1000)
  const measurementCount = await db.query<{ count: string }>(
    `select count(*)::int count from indicator_measurements where subject_type = 'PERSON' and subject_id = any($1::uuid[]) and period_end >= $2 and period_end < $3`,
    [memberIds, windowStart.toISOString(), clock.simulatedNow.toISOString()],
  )
  const structureLabel = await describeStructure(db, structure, anchor)
  enrollment.scheduled_subject_id = subjectId
  enrollment.scheduled_for = scheduledFor.toISOString()
  return {
    enrollment,
    inputContext: "",
    workflow: { ...workflow, consolidatedStructure: structure },
    trigger,
    context: {
      unit: { ...structure, label: structureLabel, anchorName: anchor?.name ?? null, memberCount: memberIds.length, measurementsLast30Days: Number(measurementCount.rows[0]?.count ?? 0) },
      trigger: { kind: "schedule", mode: "CALENDAR", scheduledFor: scheduledFor.toISOString() },
      simulatedNow: clock.simulatedNow.toISOString(),
    },
    personIds: anchor ? [anchor.id] : [],
  }
}

async function describeStructure(db: Database, unit: ConsolidatedStructure, anchor: PersonRow | null): Promise<string> {
  switch (unit.kind) {
    case "SUPERVISOR_TEAM":
      return `Equipe de Supervisor — ${anchor?.name ?? "?"}`
    case "SUBTEAM": {
      const row = await db.query<{ name: string }>(`select name from subteams where id = $1`, [unit.subteamId])
      return `Subgrupo — ${row.rows[0]?.name ?? "?"}`
    }
    case "TEAM": {
      const row = await db.query<{ name: string }>(`select name from teams where id = $1`, [unit.teamId])
      return `Grupo — ${row.rows[0]?.name ?? "?"}`
    }
    case "COORDINATOR_STRUCTURE":
      return `Estrutura de Coordenador — ${anchor?.name ?? "?"}`
    case "MANAGER_STRUCTURE":
      return `Estrutura de Gerente — ${anchor?.name ?? "?"}`
    case "SENIOR_MANAGER_STRUCTURE":
      return `Estrutura de Gerente Sênior — ${anchor?.name ?? "?"}`
    case "DIRECTOR_STRUCTURE":
      return `Estrutura de Diretor — ${anchor?.name ?? "?"}`
  }
}
