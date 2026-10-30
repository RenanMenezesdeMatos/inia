import { Router } from "express"
import { z } from "zod"
import type { Database } from "../../../../infrastructure/database/pool.js"
import { DomainError } from "../../../../shared/domain/domain-error.js"
import { canManageScope, getManageableScopes, normalizeScopedTarget, scopesAreCompatible } from "../../../auth/application/manageable-scopes.js"
import type { FlowGraph } from "../../domain/graph-schema.js"
import { normalizeManualTrigger, validateManualTrigger, validateScheduleTrigger } from "../../application/validate-workflow-for-publish.js"
import { triggerConfigSchema, type TriggerConfig } from "../../domain/trigger-config-schema.js"
import { resolveOrganizationTimezone } from "../../application/organization-timezone.js"
import { isDateDue, localDateParts, nextOccurrences, zonedTimeToIso } from "../../application/schedule-recurrence.js"
import { isAssumedWorkday, resolveRelativeInstant, type EmployeeShift } from "../../application/shift-schedule.js"
import { consolidatedStructureAnchorId } from "../../domain/consolidated-structure-schema.js"
import { populationFilterAnchorId, populationFilterGroupRef } from "../../domain/population-filter-schema.js"
import { structureAnchorGroupRef } from "../../domain/structure-anchor-schema.js"
import { assertGoLiveConfirmed, computeGoLiveImpact } from "../../application/go-live-impact.js"
import { writeDraftConfiguration } from "../../application/workflow-configuration-store.js"
import { NOT_FOUND, WORKFLOW_LIST_SELECT, assertAnchorInScope, canManageWorkflow, fetchScopedRow, triggerAllowsConsolidatedMode, triggerAllowsPopulationFilter } from "./shared.js"
import { sessionUser } from "../../../auth/presentation/session-user.js"

const createWorkflowSchema = z.object({
  name: z.string().trim().min(2),
  description: z.string().trim().optional(),
  scopeType: z.enum(["ALL_TEAMS", "TEAM", "SUBTEAM"]).default("ALL_TEAMS"),
  teamId: z.string().uuid().optional(),
  subteamId: z.string().uuid().optional(),
  trigger: triggerConfigSchema,
})

const updateWorkflowSchema = z.object({
  name: z.string().trim().min(2).optional(),
  description: z.string().trim().optional(),
  scopeType: z.enum(["ALL_TEAMS", "TEAM", "SUBTEAM"]).optional(),
  teamId: z.string().uuid().nullable().optional(),
  subteamId: z.string().uuid().nullable().optional(),
  trigger: triggerConfigSchema.optional(),
  active: z.boolean().optional(),
  /** Ativar uma Agenda publicada pode exigir confirmação do impacto (go-live-impact.ts): o `fingerprint` que a pessoa viu. */
  confirmation: z.string().trim().min(1).max(64).optional(),
})

const schedulePreviewSchema = z.object({
  trigger: triggerConfigSchema,
  // Só usado (e necessário) quando trigger.mode === "RELATIVE_TO_SHIFT" — o cálculo depende de
  // QUEM está no escopo do Workflow, algo que a Agenda de calendário nunca precisou saber.
  scope: z.object({ scopeType: z.enum(["ALL_TEAMS", "TEAM", "SUBTEAM"]), teamId: z.string().uuid().nullable().optional() }).optional(),
})

function starterGraph(): FlowGraph {
  return {
    nodes: [
      { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
      { id: "end", type: "end", label: "Fim", position: { x: 0, y: 160 }, config: {} },
    ],
    edges: [{ id: "e-trigger-end", source: "trigger", sourceHandle: "always", target: "end" }],
  }
}

// Carimba a data de hoje como âncora do gatilho por agenda na primeira vez que ele é
// definido — fica estável em edições seguintes (reaproveita a âncora anterior se o gatilho já
// era "schedule"), pra não reiniciar o ciclo de "a cada N dias" só por editar horário/intervalo.
function withScheduleAnchor(trigger: TriggerConfig, ...previous: (TriggerConfig | undefined)[]): TriggerConfig {
  if (trigger.kind !== "schedule" || trigger.anchorDate) return trigger
  const previousAnchor = previous.map((candidate) => (candidate?.kind === "schedule" ? candidate.anchorDate : undefined)).find(Boolean)
  return { ...trigger, anchorDate: previousAnchor ?? new Date().toISOString().slice(0, 10) }
}

async function validateTriggerExists(db: Database, organizationId: string, trigger: TriggerConfig): Promise<void> {
  if (trigger.kind === "channel_flag") {
    const flag = await db.query(`select id from channel_flags where id = $1 and organization_id = $2`, [trigger.channelFlagId, organizationId])
    if (!flag.rows[0]) throw new DomainError("Flag não encontrada.", "CHANNEL_FLAG_NOT_FOUND", 404)
    return
  }
  if (trigger.kind === "schedule") return // lista de horários já validada pelo schema, nada externo pra checar
  if (trigger.kind === "manual") {
    validateManualTrigger(trigger)
    if (trigger.context !== "INDICATOR_MEASUREMENT") return // colaborador/interação são escolhidos a cada disparo
  }
  const indicator = await db.query(`select id from indicator_definitions where code = $1 and organization_id = $2`, [
    trigger.indicatorCode ?? null,
    organizationId,
  ])
  if (!indicator.rows[0]) throw new DomainError("Indicador não encontrado.", "INDICATOR_NOT_FOUND", 404)
}

/** Criar Workflow, prévia da agenda e alterar os dados do Workflow. Registradas na ordem original (ver workflow-router.ts). */
export function registerWorkflowDefinitionRoutes(router: Router, db: Database): void {

  router.post("/", async (request, response) => {
    const organizationId = sessionUser(request).organizationId
    const input = createWorkflowSchema.parse(request.body)

    const scopes = await getManageableScopes(db, sessionUser(request), "workflows.manage")
    const scope = await normalizeScopedTarget(db, organizationId, { scopeType: input.scopeType, teamId: input.teamId ?? null, subteamId: input.subteamId ?? null })
    if (!scope || !canManageScope(scopes, scope)) {
      throw new DomainError("Você não tem permissão para criar workflows nesse escopo.", "WORKFLOW_SCOPE_FORBIDDEN", 403)
    }

    validateScheduleTrigger(input.trigger)
    await validateTriggerExists(db, organizationId, input.trigger)
    const trigger = normalizeManualTrigger(input.trigger)

    // Nunca publicado: rascunho e configuração viva nascem iguais (não há runtime sem versão publicada).
    const result = await db.query<{ id: string }>(
      `insert into workflows(organization_id, name, description, scope_type, team_id, subteam_id, trigger_config, draft_graph, created_by,
                             draft_scope_type, draft_team_id, draft_subteam_id, draft_trigger_config)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$4,$5,$6,$7) returning id`,
      [
        organizationId,
        input.name,
        input.description ?? null,
        scope.scopeType,
        scope.teamId,
        scope.subteamId,
        JSON.stringify(withScheduleAnchor(trigger)),
        JSON.stringify(starterGraph()),
        request.user?.personId ?? null,
      ],
    )
    const listResult = await db.query(`${WORKFLOW_LIST_SELECT} and w.id = $2`, [organizationId, result.rows[0]!.id])
    response.status(201).json({ data: listResult.rows[0] })
  })

  // Preview de próximas execuções do Trigger "Por agenda" (Parte 10 do pedido; Parte 19 da
  // evolução relativa ao expediente) — reaproveita a MESMA calculadora que o checador real usa
  // (nextOccurrences/isDateDue pro calendário, resolveRelativeInstant pro relativo — ambas em
  // schedule-recurrence.ts/shift-schedule.ts), nunca uma implementação divergente no frontend.
  // Funciona sem workflow criado ainda (usado no diálogo de criação).
  router.post("/schedule-preview", async (request, response) => {
    const organizationId = sessionUser(request).organizationId
    const input = schedulePreviewSchema.parse(request.body)
    if (input.trigger.kind !== "schedule") {
      throw new DomainError("Preview só está disponível para o Trigger por agenda.", "WORKFLOW_INVALID_TRIGGER", 422)
    }
    validateScheduleTrigger(input.trigger)
    const timezone = await resolveOrganizationTimezone(db, organizationId)

    if (input.trigger.mode === "RELATIVE_TO_SHIFT") {
      const relative = input.trigger.relative!
      const scope = input.scope ?? { scopeType: "ALL_TEAMS" as const, teamId: null }
      // A prévia lista nomes de operadores do escopo: só de um escopo que quem pede administra (achado A-F09).
      if (!canManageScope(await getManageableScopes(db, sessionUser(request), "workflows.manage"), { scopeType: scope.scopeType, teamId: scope.teamId ?? null, subteamId: null })) {
        throw new DomainError("Você só pode pré-visualizar a agenda de Grupos do seu escopo.", "FORBIDDEN", 403)
      }
      const operators = await db.query<{ id: string; name: string }>(
        `select id, name from people where organization_id = $1 and role = 'OPERATOR' and active and ($2 = 'ALL_TEAMS' or team_id = $3)`,
        [organizationId, scope.scopeType, scope.teamId ?? null],
      )

      // Próximo dia útil assumido (Segunda a Sexta — ver isAssumedWorkday) a partir de hoje, pra
      // sempre ter algo pra mostrar na prévia mesmo se hoje for fim de semana.
      let previewDate = localDateParts(new Date(), timezone).date
      for (let guard = 0; guard < 7 && !isAssumedWorkday(previewDate); guard++) {
        previewDate = new Date(new Date(`${previewDate}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10)
      }

      const shifts = await db.query<{ person_id: string; start_time: string; work_minutes: number }>(
        `select distinct on (person_id) person_id, start_time, work_minutes
         from employee_work_shifts
         where person_id = any($1::uuid[]) and effective_from <= $2::date and (effective_to is null or effective_to >= $2::date)
         order by person_id, effective_from desc`,
        [operators.rows.map((operator) => operator.id), previewDate],
      )
      const shiftByPerson = new Map(shifts.rows.map((row) => [row.person_id, { startTime: row.start_time, workMinutes: row.work_minutes } as EmployeeShift]))

      const examples: { name: string; iso: string }[] = []
      let eligibleWithShift = 0
      for (const operator of operators.rows) {
        const shift = shiftByPerson.get(operator.id)
        if (!shift) continue
        const instant = resolveRelativeInstant(shift, relative, previewDate, timezone)
        if (!instant) continue
        eligibleWithShift += 1
        if (examples.length < 5) examples.push({ name: operator.name, iso: instant.toISOString() })
      }

      response.json({
        data: {
          mode: "RELATIVE_TO_SHIFT",
          previewDate,
          examples,
          totalEligible: operators.rows.length,
          withoutValidShift: operators.rows.length - eligibleWithShift,
          timezone,
        },
      })
      return
    }

    const recurrence = { times: input.trigger.times ?? [], intervalDays: input.trigger.intervalDays, anchorDate: input.trigger.anchorDate ?? null, frequency: input.trigger.frequency }
    const now = new Date()
    const occurrences = nextOccurrences(recurrence, { timezone, from: now, count: 5 })
    // Horários de HOJE que já passaram: o checador recupera o dia corrente (catch-up), então entrar no ar
    // agora (publicar/ativar) os dispararia em até 1 minuto — a prévia nunca esconde isso (incidente 2026-10-05).
    const { date: today, time: nowHHmm } = localDateParts(now, timezone)
    const catchUpToday = isDateDue(recurrence, today) ? [...recurrence.times].sort().filter((time) => time <= nowHHmm).map((time) => zonedTimeToIso(today, time, timezone)) : []
    response.json({ data: { mode: "CALENDAR", occurrences: occurrences.map((occurrence) => occurrence.iso), catchUpToday, timezone } })
  })

  // Nome/descrição/ativo valem na hora. Abrangência e Gatilho vão para o RASCUNHO da configuração —
  // num Workflow publicado nada que o runtime lê muda até Publicar (ver domain/workflow-configuration.ts).
  router.patch("/:id", async (request, response) => {
    const organizationId = sessionUser(request).organizationId
    const input = updateWorkflowSchema.parse(request.body)
    const current = await fetchScopedRow(db, organizationId, request.params.id!)
    if (!current) return response.status(404).json(NOT_FOUND)

    const scopes = await getManageableScopes(db, sessionUser(request), "workflows.manage")
    if (!canManageWorkflow(scopes, current)) return response.status(404).json(NOT_FOUND)

    const movedScope = input.scopeType !== undefined ? await normalizeScopedTarget(db, organizationId, { scopeType: input.scopeType, teamId: input.teamId ?? null, subteamId: input.subteamId ?? null }) : null
    if (input.scopeType !== undefined && (!movedScope || !canManageScope(scopes, movedScope))) {
      throw new DomainError("Você não tem permissão para mover o workflow para esse escopo.", "WORKFLOW_SCOPE_FORBIDDEN", 403)
    }
    const nextScopeType = movedScope?.scopeType ?? current.scopeType
    const nextTeamId = movedScope ? movedScope.teamId : current.teamId
    const nextSubteamId = movedScope ? movedScope.subteamId : current.subteamId

    // Trocar a Abrangência não pode deixar uma referência cross-group inválida silenciosamente
    // pra trás (Parte 9 do pedido) — reavalia todo Orchestrator já referenciado no RASCUNHO contra o
    // escopo NOVO antes de aceitar a troca. A versão publicada continua rodando com a Abrangência
    // publicada até a próxima publicação (que valida o rascunho inteiro de novo).
    const scopeIsChanging =
      input.scopeType !== undefined && (nextScopeType !== current.scopeType || nextTeamId !== current.teamId || nextSubteamId !== current.subteamId)
    if (scopeIsChanging) {
      const referencedOrchestratorIds = new Set<string>()
      for (const node of (current.draftGraph as FlowGraph | null)?.nodes ?? []) {
        if (node.type === "orchestrator") referencedOrchestratorIds.add(node.config.orchestratorId)
      }
      const nextScope = { scopeType: nextScopeType, teamId: nextTeamId, subteamId: nextSubteamId }
      if (referencedOrchestratorIds.size > 0) {
        const orchestratorRows = await db.query<{ id: string; name: string; scopeType: string; teamId: string | null; subteamId: string | null }>(
          `select id, name, scope_type "scopeType", team_id "teamId", subteam_id "subteamId" from assistant_orchestrators where id = any($1::uuid[])`,
          [[...referencedOrchestratorIds]],
        )
        for (const orchestrator of orchestratorRows.rows) {
          if (!(await scopesAreCompatible(db, nextScope, orchestrator))) {
            throw new DomainError(
              `Não é possível mover para esse escopo: o Orchestrator "${orchestrator.name}", já usado neste workflow, não está disponível para o grupo de destino.`,
              "WORKFLOW_ORCHESTRATOR_SCOPE_FORBIDDEN",
              409,
            )
          }
        }
      }

      // Mesma revalidação pra Estrutura Consolidada e Filtro Populacional: a pessoa-âncora ou o
      // Subgrupo/Grupo já configurados também precisam continuar dentro do escopo de destino.
      const structure = current.consolidatedStructure
      if (structure) {
        await assertAnchorInScope(
          db,
          organizationId,
          consolidatedStructureAnchorId(structure),
          structureAnchorGroupRef(structure),
          nextScope,
          "Não é possível mover para esse escopo: a Estrutura Consolidada já configurada ficaria fora do grupo de destino.",
          "WORKFLOW_CONSOLIDATED_STRUCTURE_OUT_OF_SCOPE",
          409,
        )
      }
      const filter = current.populationFilter
      if (filter && filter.kind !== "ALL") {
        await assertAnchorInScope(
          db,
          organizationId,
          populationFilterAnchorId(filter),
          populationFilterGroupRef(filter),
          nextScope,
          "Não é possível mover para esse escopo: o Filtro Populacional já configurado ficaria fora do grupo de destino.",
          "WORKFLOW_POPULATION_FILTER_OUT_OF_SCOPE",
          409,
        )
      }
    }

    if (input.trigger) {
      validateScheduleTrigger(input.trigger)
      await validateTriggerExists(db, organizationId, input.trigger)

      // Trocar só o Trigger não pode deixar pra trás uma Estrutura Consolidada/Filtro
      // Populacional numa combinação que `PUT /:id/analysis-config` nunca aceitaria criar do
      // zero (Parte 26/28 do pedido — nunca apagar configuração silenciosamente, sempre
      // bloquear e explicar o que precisa mudar primeiro).
      if (current.consolidatedStructure && !triggerAllowsConsolidatedMode(input.trigger)) {
        throw new DomainError(
          input.trigger.kind !== "schedule"
            ? `Não é possível trocar o gatilho: este workflow tem uma Estrutura Consolidada configurada, que só é válida para Agenda de calendário${input.trigger.kind === "manual" ? " (o Manual executa para um colaborador por vez)" : ""}. Troque o Alvo da avaliação para Individual antes.`
            : "Agendamentos relativos ao expediente são sempre executados individualmente por colaborador — troque o Alvo da avaliação para Individual antes.",
          "WORKFLOW_TRIGGER_CONSOLIDATED_MODE_CONFLICT",
          422,
        )
      }
      if (current.populationFilter && current.populationFilter.kind !== "ALL" && !triggerAllowsPopulationFilter(input.trigger)) {
        throw new DomainError(
          'Não é possível trocar o gatilho: este workflow tem um Filtro Populacional configurado, que só é válido para Agenda. Troque o filtro para "Todos os colaboradores elegíveis" antes.',
          "WORKFLOW_TRIGGER_POPULATION_FILTER_CONFLICT",
          422,
        )
      }
    }

    // Ativar faz a configuração PUBLICADA valer de novo na hora — uma Agenda publicada pode recuperar
    // horários de hoje já vencidos ou atingir uma população grande: exige a confirmação do impacto,
    // como a publicação (go-live-impact.ts). Desativar nunca precisa.
    if (input.active === true && !current.active && current.published) {
      const impact = await computeGoLiveImpact(db, organizationId, {
        workflowId: request.params.id!,
        reason: "ACTIVATE",
        configuration: current.live,
        published: current.live,
        active: true,
        now: new Date(),
      })
      assertGoLiveConfirmed(impact, input.confirmation)
    }

    if (input.trigger || input.scopeType !== undefined) {
      await writeDraftConfiguration(db, organizationId, request.params.id!, {
        ...(input.trigger ? { trigger: withScheduleAnchor(normalizeManualTrigger(input.trigger), current.triggerConfig, current.live.triggerConfig) } : {}),
        ...(input.scopeType !== undefined ? { scope: { scopeType: nextScopeType, teamId: nextTeamId, subteamId: nextSubteamId } } : {}),
      })
    }
    const updated = await db.query<{ id: string }>(
      `update workflows set
         name = coalesce($1, name),
         description = case when $2::boolean then $3 else description end,
         active = coalesce($4, active),
         updated_at = now()
       where id = $5 and organization_id = $6
       returning id`,
      [input.name ?? null, input.description !== undefined, input.description ?? null, input.active ?? null, request.params.id, organizationId],
    )
    if (!updated.rows[0]) return response.status(404).json(NOT_FOUND)
    const listResult = await db.query(`${WORKFLOW_LIST_SELECT} and w.id = $2`, [organizationId, request.params.id])
    response.json({ data: listResult.rows[0] })
  })
}
