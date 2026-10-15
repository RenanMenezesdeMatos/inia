import type { Database } from "../../../infrastructure/database/pool.js"
import { consolidatedStructureAnchorId, type ConsolidatedStructure } from "../domain/consolidated-structure-schema.js"
import type { PopulationFilter } from "../domain/population-filter-schema.js"
import type { RelativeSchedule, ScheduleFrequency } from "../domain/trigger-config-schema.js"
import { resolveStructureAnchorOperatorIds } from "./hierarchy-subjects.js"
import { resolveEligibleOperatorIds } from "./workflow-eligibility.js"
import { resolveOrganizationTimezone } from "./organization-timezone.js"
import { isDateDue, localDateParts, zonedTimeToIso, type ScheduleRecurrenceConfig } from "./schedule-recurrence.js"
import { isAssumedWorkday, resolveRelativeInstant, type EmployeeShift } from "./shift-schedule.js"


/**
 * Nascimento EM LOTE das matrículas de UM workflow num disparo: um único insert para todos os sujeitos (e horários) devidos —
 * antes era um insert por operador, a cada minuto, até o fim do dia. A idempotência continua sendo o índice único
 * `workflow_enrollments_schedule_slot_uk` (workflow, sujeito, horário): o que já nasceu é ignorado e só o novo conta.
 */
async function enrollScheduledSlots(db: Database, input: { organizationId: string; workflowId: string; versionId: string; triggerNodeId: string; slots: { subjectId: string; scheduledFor: string }[] }): Promise<number> {
  if (input.slots.length === 0) return 0
  const result = await db.query(
    `insert into workflow_enrollments(organization_id, workflow_id, version_id, scheduled_subject_id, scheduled_for, current_node_id)
     select $1, $2, $3, slot.subject_id, slot.scheduled_for, $4
     from unnest($5::uuid[], $6::timestamptz[]) as slot(subject_id, scheduled_for)
     on conflict (workflow_id, scheduled_subject_id, scheduled_for) where scheduled_subject_id is not null do nothing`,
    [input.organizationId, input.workflowId, input.versionId, input.triggerNodeId, input.slots.map((slot) => slot.subjectId), input.slots.map((slot) => slot.scheduledFor)],
  )
  return result.rowCount ?? 0
}

type ScheduledWorkflowRow = {
  organization_id: string
  id: string
  version_id: string
  scope_type: string
  team_id: string | null
  subteam_id: string | null
  mode: "CALENDAR" | "RELATIVE_TO_SHIFT" | null
  times: string[]
  interval_days: number
  anchor_date: string | null
  frequency: ScheduleFrequency | null
  relative: RelativeSchedule | null
  consolidated_structure: ConsolidatedStructure | null
  population_filter: PopulationFilter | null
}

/**
 * Checador do gatilho "por agenda" — cuida só de NASCER o enrollment na hora certa; quem
 * avança/executa o grafo é o worker do motor (workflow-worker.ts, sobre engine.ts). Um enrollment
 * por operador elegível, por horário configurado, por dia (modo
 * Individual) — ou UMA matrícula por horário, representando a estrutura inteira (modo
 * Consolidado) — a unique index em workflow_enrollments garante que rodar isso mais de uma vez
 * antes do próximo horário não duplica matrícula.
 *
 * Recuperação após indisponibilidade: como a matrícula só olha "hoje" e filtra `time <= agora`,
 * se o serviço cair e voltar dentro do MESMO dia, todos os horários já vencidos daquele dia são
 * recuperados (catch-up) na próxima rodada — mas se o dia inteiro for pulado (caiu antes da meia-
 * noite, voltou depois), a ocorrência daquele dia é perdida pra sempre. Nunca duplica
 * (idempotência via unique index) e nunca dispara passado antigo de dias anteriores —
 * comportamento preservado intencionalmente, não uma regressão.
 *
 * Agendamento relativo ao expediente: mesmo tick, mesmo índice único de idempotência — só troca
 * "isso já venceu hoje?" de uma comparação contra um horário FIXO (`times`) pra uma comparação
 * contra o horário INDIVIDUAL de cada colaborador, calculado a partir da jornada dele
 * (`shift-schedule.ts`). É SEMPRE modo Individual — nunca lê `consolidated_structure` (uma
 * jornada é de uma pessoa só) — mas aplica o mesmo Filtro Populacional da Agenda de calendário.
 *
 * Organização: a de CADA Workflow (do registro) — "hoje", o horário vencido e a população são resolvidos no fuso e dentro da
 * organização dele, e a matrícula nasce nela.
 */
export async function runScheduleCheck(db: Database, now: Date = new Date()): Promise<{ enrolled: number }> {
  // Só a configuração PUBLICADA (colunas vivas): o rascunho (`draft_*`) nunca é lido aqui —
  // editar o gatilho/Abrangência/população de um Workflow ativo não muda nada até Publicar.
  const workflows = await db.query<ScheduledWorkflowRow>(
    `select w.organization_id, w.id, w.active_version_id version_id, w.scope_type, w.team_id, w.subteam_id,
            w.trigger_config ->> 'mode' mode,
            array(select jsonb_array_elements_text(w.trigger_config -> 'times')) times,
            coalesce((w.trigger_config ->> 'intervalDays')::int, 1) interval_days,
            w.trigger_config ->> 'anchorDate' anchor_date,
            w.trigger_config -> 'frequency' frequency,
            w.trigger_config -> 'relative' relative,
            w.consolidated_structure,
            w.population_filter
     from workflows w
     where w.active and w.active_version_id is not null
       and w.trigger_config ->> 'kind' = 'schedule'`,
  )

  const timezoneByOrganization = new Map<string, string>()
  let enrolled = 0
  for (const workflow of workflows.rows) {
    const organizationId = workflow.organization_id
    let timezone = timezoneByOrganization.get(organizationId)
    if (!timezone) {
      timezone = await resolveOrganizationTimezone(db, organizationId)
      timezoneByOrganization.set(organizationId, timezone)
    }

    const versionResult = await db.query<{ graph: { nodes: { id: string; type: string }[] } }>(
      `select graph from workflow_versions where id = $1`,
      [workflow.version_id],
    )
    const triggerNode = versionResult.rows[0]?.graph.nodes.find((node) => node.type === "trigger")
    if (!triggerNode) continue

    const slots = await planDueScheduleEnrollments(db, organizationId, scheduleConfigurationOf(workflow), { now, timezone })
    enrolled += await enrollScheduledSlots(db, { organizationId, workflowId: workflow.id, versionId: workflow.version_id, triggerNodeId: triggerNode.id, slots })
  }
  return { enrolled }
}

function scheduleConfigurationOf(row: ScheduledWorkflowRow): ScheduleConfiguration {
  return {
    scopeType: row.scope_type,
    teamId: row.team_id,
    subteamId: row.subteam_id,
    mode: row.mode,
    times: row.times ?? [],
    intervalDays: row.interval_days,
    anchorDate: row.anchor_date,
    frequency: row.frequency,
    relative: row.relative,
    consolidatedStructure: row.consolidated_structure,
    populationFilter: row.population_filter,
  }
}

/** Configuração de Agenda + população, no formato que o planejador precisa — vem da linha publicada
 * (checador) ou de uma configuração ainda em RASCUNHO (prévia de impacto da publicação). */
export type ScheduleConfiguration = {
  scopeType: string
  teamId: string | null
  subteamId: string | null
  mode: "CALENDAR" | "RELATIVE_TO_SHIFT" | null | undefined
  times: string[]
  intervalDays: number
  anchorDate: string | null | undefined
  frequency: ScheduleFrequency | null | undefined
  relative: RelativeSchedule | null | undefined
  consolidatedStructure: ConsolidatedStructure | null
  populationFilter: PopulationFilter | null | unknown
}

/** Uma matrícula que o checador criaria: sujeito agendado × instante agendado (o slot do índice único). */
export type DueScheduleSlot = { subjectId: string; scheduledFor: string }

/**
 * O QUE o checador matricularia AGORA para esta configuração — a regra inteira do tick (dia devido,
 * horários `<= agora` de HOJE no fuso da organização, jornada de cada colaborador no modo relativo,
 * Individual × Consolidado), sem gravar nada. É a mesma função que `runScheduleCheck` usa para
 * inserir, e a que a prévia de impacto da publicação/ativação usa para contar o catch-up imediato
 * (go-live-impact.ts) — nunca duas implementações da mesma regra.
 */
export async function planDueScheduleEnrollments(
  db: Database,
  organization: string,
  config: ScheduleConfiguration,
  clock: { now: Date; timezone: string },
): Promise<DueScheduleSlot[]> {
  const { date: today, time: nowHHmm } = localDateParts(clock.now, clock.timezone)
  // Mesma elegibilidade (Abrangência + Filtro Populacional) da ingestão por Flag e do QA Lab.
  const population = { scopeType: config.scopeType, teamId: config.teamId, subteamId: config.subteamId, populationFilter: config.populationFilter }

  if (config.mode === "RELATIVE_TO_SHIFT") {
    if (!config.relative || !isAssumedWorkday(today)) return []
    const operatorIds = await resolveEligibleOperatorIds(db, organization, population)
    if (operatorIds.length === 0) return []
    const shiftByPerson = await loadShiftsOn(db, operatorIds, today)
    const slots: DueScheduleSlot[] = []
    for (const operatorId of operatorIds) {
      const shift = shiftByPerson.get(operatorId)
      if (!shift) continue // sem jornada configurada — nunca inventa horário
      const instant = resolveRelativeInstant(shift, config.relative, today, clock.timezone)
      if (!instant || instant.getTime() > clock.now.getTime()) continue // ainda não venceu, ou configuração incompatível com essa jornada
      slots.push({ subjectId: operatorId, scheduledFor: instant.toISOString() })
    }
    return slots
  }

  // CALENDAR (explícito ou ausente = legado).
  const recurrence: ScheduleRecurrenceConfig = {
    times: config.times,
    intervalDays: config.intervalDays,
    anchorDate: config.anchorDate ?? null,
    frequency: config.frequency ?? undefined,
  }
  if (!isDateDue(recurrence, today)) return []
  const dueTimes = config.times.filter((time) => time <= nowHHmm)
  if (dueTimes.length === 0) return []

  const subjectIds = await resolveScheduleSubjects(db, organization, config)
  return dueTimes.flatMap((time) => {
    const scheduledFor = zonedTimeToIso(today, time, clock.timezone)
    return subjectIds.map((subjectId) => ({ subjectId, scheduledFor }))
  })
}

/**
 * Sujeitos de UMA ocorrência de calendário: modo Individual (ausente = sempre foi o padrão) = um por
 * operador elegível pelo Filtro Populacional (ausente = todos da Abrangência); modo Consolidado = UM
 * só. No Consolidado o "sujeito" agendado é a pessoa-âncora (Supervisor/Coordenador/Gerente/Gerente
 * Sênior/Diretor) ou, pra Subgrupo/Grupo (que não são uma pessoa), um membro operador qualquer do
 * grupo escolhido de forma determinística — só como carregador técnico do vínculo
 * scheduled_subject_id (FK pra people, exigido pela idempotência já existente); a agregação de
 * verdade nunca olha só essa pessoa, ela resolve o CONJUNTO todo de novo em node-handlers.ts na hora
 * de avaliar a Condition. Fan-out pra operadores nunca acontece aqui — é exatamente o que o modo
 * Consolidado existe pra evitar. Estrutura sem nenhum operador = nenhum sujeito (nunca inventado).
 */
export async function resolveScheduleSubjects(db: Database, organization: string, config: ScheduleConfiguration): Promise<string[]> {
  const structure = config.consolidatedStructure
  if (!structure) {
    return resolveEligibleOperatorIds(db, organization, { scopeType: config.scopeType, teamId: config.teamId, subteamId: config.subteamId, populationFilter: config.populationFilter })
  }
  const anchorId = consolidatedStructureAnchorId(structure)
  const memberIds = await resolveStructureAnchorOperatorIds(db, structure, anchorId)
  if (memberIds.length === 0) return []
  return [anchorId ?? [...memberIds].sort()[0]!]
}

/** Jornada vigente de cada colaborador num dia — também usada pela prévia de impacto (próximo disparo no modo relativo). */
export async function loadShiftsOn(db: Database, operatorIds: string[], date: string): Promise<Map<string, EmployeeShift>> {
  const shifts = await db.query<{ person_id: string; start_time: string; work_minutes: number }>(
    `select distinct on (person_id) person_id, start_time, work_minutes
     from employee_work_shifts
     where person_id = any($1::uuid[]) and effective_from <= $2::date and (effective_to is null or effective_to >= $2::date)
     order by person_id, effective_from desc`,
    [operatorIds, date],
  )
  return new Map(shifts.rows.map((row) => [row.person_id, { startTime: row.start_time, workMinutes: row.work_minutes } as EmployeeShift]))
}
