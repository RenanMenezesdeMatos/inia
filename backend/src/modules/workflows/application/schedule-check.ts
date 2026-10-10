import type { Database } from "../../../infrastructure/database/pool.js"
import { consolidatedStructureAnchorId, type ConsolidatedStructure } from "../domain/consolidated-structure-schema.js"
import type { PopulationFilter } from "../domain/population-filter-schema.js"
import type { RelativeSchedule, ScheduleFrequency } from "../domain/trigger-config-schema.js"
import { resolveStructureAnchorOperatorIds } from "./hierarchy-subjects.js"
import { resolveEligibleOperatorIds } from "./workflow-eligibility.js"
import { resolveOrganizationTimezone } from "./organization-timezone.js"
import { isDateDue, localDateParts, zonedTimeToIso, type ScheduleRecurrenceConfig } from "./schedule-recurrence.js"
import { isAssumedWorkday, resolveRelativeInstant, type EmployeeShift } from "./shift-schedule.js"


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
    const { date: today, time: nowHHmm } = localDateParts(now, timezone)

    const versionResult = await db.query<{ graph: { nodes: { id: string; type: string }[] } }>(
      `select graph from workflow_versions where id = $1`,
      [workflow.version_id],
    )
    const triggerNode = versionResult.rows[0]?.graph.nodes.find((node) => node.type === "trigger")
    if (!triggerNode) continue

    // Mesma elegibilidade (Abrangência + Filtro Populacional) da ingestão por Flag e do QA Lab.
    const population = { scopeType: workflow.scope_type, teamId: workflow.team_id, subteamId: workflow.subteam_id, populationFilter: workflow.population_filter }

    if (workflow.mode === "RELATIVE_TO_SHIFT") {
      if (!workflow.relative || !isAssumedWorkday(today)) continue

      const operatorIds = await resolveEligibleOperatorIds(db, organizationId, population)
      if (operatorIds.length === 0) continue

      const shifts = await db.query<{ person_id: string; start_time: string; work_minutes: number }>(
        `select distinct on (person_id) person_id, start_time, work_minutes
         from employee_work_shifts
         where person_id = any($1::uuid[]) and effective_from <= $2::date and (effective_to is null or effective_to >= $2::date)
         order by person_id, effective_from desc`,
        [operatorIds, today],
      )
      const shiftByPerson = new Map(shifts.rows.map((row) => [row.person_id, { startTime: row.start_time, workMinutes: row.work_minutes } as EmployeeShift]))

      for (const operatorId of operatorIds) {
        const shift = shiftByPerson.get(operatorId)
        if (!shift) continue // sem jornada configurada — nunca inventa horário
        const instant = resolveRelativeInstant(shift, workflow.relative, today, timezone)
        if (!instant || instant.getTime() > now.getTime()) continue // ainda não venceu, ou configuração incompatível com essa jornada

        const result = await db.query(
          `insert into workflow_enrollments(organization_id, workflow_id, version_id, scheduled_subject_id, scheduled_for, current_node_id)
           values ($1,$2,$3,$4,$5,$6)
           on conflict (workflow_id, scheduled_subject_id, scheduled_for) where scheduled_subject_id is not null do nothing`,
          [organizationId, workflow.id, workflow.version_id, operatorId, instant.toISOString(), triggerNode.id],
        )
        enrolled += result.rowCount ?? 0
      }
      continue
    }

    // CALENDAR (explícito ou ausente = legado).
    const recurrence: ScheduleRecurrenceConfig = {
      times: workflow.times,
      intervalDays: workflow.interval_days,
      anchorDate: workflow.anchor_date,
      frequency: workflow.frequency ?? undefined,
    }
    if (!isDateDue(recurrence, today)) continue

    const dueTimes = workflow.times.filter((time) => time <= nowHHmm)
    if (dueTimes.length === 0) continue

    if (!workflow.consolidated_structure) {
      // Modo Individual (ausente = sempre foi o padrão) — uma matrícula por operador elegível
      // pelo Filtro Populacional (ausente = todos da Abrangência).
      const operatorIds = await resolveEligibleOperatorIds(db, organizationId, population)
      for (const time of dueTimes) {
        const scheduledFor = zonedTimeToIso(today, time, timezone)
        for (const operatorId of operatorIds) {
          const result = await db.query(
            `insert into workflow_enrollments(organization_id, workflow_id, version_id, scheduled_subject_id, scheduled_for, current_node_id)
             values ($1,$2,$3,$4,$5,$6)
             on conflict (workflow_id, scheduled_subject_id, scheduled_for) where scheduled_subject_id is not null do nothing`,
            [organizationId, workflow.id, workflow.version_id, operatorId, scheduledFor, triggerNode.id],
          )
          enrolled += result.rowCount ?? 0
        }
      }
      continue
    }

    // Modo Consolidado: UMA matrícula por horário devido, nunca uma por operador — o "sujeito"
    // agendado é a pessoa-âncora (Supervisor/Coordenador/Gerente/Gerente Sênior/Diretor) ou, pra
    // Subgrupo/Grupo (que não são uma pessoa), um membro operador qualquer do grupo escolhido de
    // forma determinística — só como carregador técnico do vínculo scheduled_subject_id (FK pra
    // people, exigido pela idempotência já existente); a agregação de verdade nunca olha só essa
    // pessoa, ela resolve o CONJUNTO todo de novo em node-handlers.ts na hora de avaliar a
    // Condition. Fan-out pra operadores nunca acontece aqui — é exatamente o que o modo
    // Consolidado existe pra evitar.
    const structure = workflow.consolidated_structure
    const anchorId = consolidatedStructureAnchorId(structure)
    const memberIds = await resolveStructureAnchorOperatorIds(db, structure, anchorId)
    if (memberIds.length === 0) continue // estrutura sem nenhum operador — nunca inventa sujeito
    const subjectId = anchorId ?? [...memberIds].sort()[0]!

    for (const time of dueTimes) {
      const scheduledFor = zonedTimeToIso(today, time, timezone)
      const result = await db.query(
        `insert into workflow_enrollments(organization_id, workflow_id, version_id, scheduled_subject_id, scheduled_for, current_node_id)
         values ($1,$2,$3,$4,$5,$6)
         on conflict (workflow_id, scheduled_subject_id, scheduled_for) where scheduled_subject_id is not null do nothing`,
        [organizationId, workflow.id, workflow.version_id, subjectId, scheduledFor, triggerNode.id],
      )
      enrolled += result.rowCount ?? 0
    }
  }
  return { enrolled }
}
