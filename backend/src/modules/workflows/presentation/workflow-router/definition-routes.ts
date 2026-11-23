import { Router } from "express"
import { z } from "zod"
import type { Database } from "../../../../infrastructure/database/pool.js"
import { DomainError } from "../../../../shared/domain/domain-error.js"
import { canManageScope, getManageableScopes, scopesAreCompatible } from "../../../auth/application/manageable-scopes.js"
import { loadResourceScopeLinks, resolveResourceScopeForWrite } from "../../../org-structure/application/resource-scope-links.js"
import { assertScopeLinksInUniverse } from "../../../org-structure/application/scope-unit-admission.js"
import type { ResourceScope } from "../../../../shared/domain/scope-links/resource-scope.js"
import { linkKey, sortLinks } from "../../../../shared/domain/scope-links/scope-links.js"
import { resourceScopeFields, resourceScopeTypeSchema, scopeLinksInputSchema } from "../../../../shared/presentation/scope-links-schema.js"
import { workflowReachOf, workflowReachParams, workflowReachSql, workflowResourceScope, workflowScopedTarget, workflowScopeKey } from "../../domain/workflow-scope.js"
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
import { assertPublishedWorkflowMatchesIndicatorCatalog } from "../../application/indicator-graph-guard.js"
import { writeDraftConfiguration } from "../../application/workflow-configuration-store.js"
import type { WorkflowConfiguration } from "../../domain/workflow-configuration.js"
import { NOT_FOUND, WORKFLOW_LIST_SELECT, assertAnchorInScope, canManageWorkflow, fetchScopedRow, triggerAllowsConsolidatedMode, triggerAllowsPopulationFilter } from "./shared.js"
import { sessionUser } from "../../../auth/presentation/session-user.js"
import { operatingUniverseSchema, optionalOperatingUniverseSchema } from "../../../operating-universe/domain/operating-universe.js"
import { assertUniverseRequiredFor } from "../../../operating-universe/application/universe-access.js"

const createWorkflowSchema = z.object({
  name: z.string().trim().min(2),
  description: z.string().trim().optional(),
  /** Abrangência (249): ALL_TEAMS ou GROUPS + `scopeLinks` (o formato antigo TEAM/SUBTEAM + ids continua aceito e vira um vínculo). */
  ...resourceScopeFields,
  scopeType: resourceScopeTypeSchema.default("ALL_TEAMS"),
  trigger: triggerConfigSchema,
  /** Universo de atuação (B2B/B2C/B2X). Obrigatório depois que a organização ativa a exigência (checado no servidor). */
  operatingUniverse: optionalOperatingUniverseSchema,
})

const updateWorkflowSchema = z.object({
  name: z.string().trim().min(2).optional(),
  description: z.string().trim().optional(),
  /** Abrangência do RASCUNHO (só vale ao Publicar): ALL_TEAMS ou GROUPS + `scopeLinks`. */
  ...resourceScopeFields,
  scopeType: resourceScopeTypeSchema.optional(),
  trigger: triggerConfigSchema.optional(),
  /** Universo de atuação: vai para o RASCUNHO (como a Abrangência) e só vale ao Publicar. */
  operatingUniverse: operatingUniverseSchema.nullable().optional(),
  active: z.boolean().optional(),
  /** Ativar uma Agenda publicada pode exigir confirmação do impacto (go-live-impact.ts): o `fingerprint` que a pessoa viu. */
  confirmation: z.string().trim().min(1).max(64).optional(),
})

const schedulePreviewSchema = z.object({
  trigger: triggerConfigSchema,
  // Só usado (e necessário) quando trigger.mode === "RELATIVE_TO_SHIFT" — o cálculo depende de
  // QUEM está no escopo do Workflow, algo que a Agenda de calendário nunca precisou saber.
  scope: z
    .object({ scopeType: resourceScopeTypeSchema, teamId: z.string().uuid().nullish(), subteamId: z.string().uuid().nullish(), scopeLinks: scopeLinksInputSchema.optional() })
    .optional(),
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

/**
 * Alcance que o Workflow JÁ tinha (publicado ∪ rascunho): vínculos dele continuam aceitos numa edição mesmo que hoje não sejam elegíveis;
 * e "Todos" que já era "Todos" (num dos dois) se mantém sem exigir mais do que a gestão do próprio Workflow.
 */
function previousScopeOf(current: { scopeType: string; scopeLinks: { teamId: string; subteamId: string | null }[]; teamId?: string | null; subteamId?: string | null; live: WorkflowConfiguration }, requestedType: string): ResourceScope {
  const draft = workflowResourceScope(current)
  const live = workflowResourceScope(current.live)
  if (requestedType === "ALL_TEAMS" && (draft.scopeType === "ALL_TEAMS" || live.scopeType === "ALL_TEAMS")) return { scopeType: "ALL_TEAMS", links: [] }
  const byKey = new Map([...draft.links, ...live.links].map((link) => [linkKey(link), link]))
  return { scopeType: "GROUPS", links: sortLinks([...byKey.values()]) }
}

/** Criar Workflow, prévia da agenda e alterar os dados do Workflow. Registradas na ordem original (ver workflow-router.ts). */
export function registerWorkflowDefinitionRoutes(router: Router, db: Database): void {

  router.post("/", async (request, response) => {
    const organizationId = sessionUser(request).organizationId
    const input = createWorkflowSchema.parse(request.body)

    const scopes = await getManageableScopes(db, sessionUser(request), "workflows.manage")
    await assertUniverseRequiredFor(db, organizationId, input.operatingUniverse, "do Workflow")
    // Abrangência: ALL_TEAMS só com escopo de organização; vínculos no escopo de quem cria, do universo do Workflow e com operador em
    // produção (resolveResourceScopeForWrite — a mesma regra de Agentes e Orquestradores).
    const scope = await resolveResourceScopeForWrite(db, organizationId, scopes, input, {
      codePrefix: "WORKFLOW",
      universe: input.operatingUniverse,
      allTeamsMessage: "Você não tem permissão para criar workflows nesse escopo: só quem administra a organização inteira escolhe “Todos os Grupos e Subgrupos”.",
    })

    validateScheduleTrigger(input.trigger)
    await validateTriggerExists(db, organizationId, input.trigger)
    const trigger = normalizeManualTrigger(input.trigger)

    // Nunca publicado: rascunho e configuração viva nascem iguais (não há runtime sem versão publicada) — inclusive os vínculos
    // (`workflow_scope_links` = publicados; `draft_scope_links` = rascunho), no mesmo comando.
    const result = await db.query<{ id: string }>(
      `with created as (
         insert into workflows(organization_id, name, description, scope_type, trigger_config, draft_graph, created_by,
                               draft_scope_type, draft_scope_links, draft_trigger_config, operating_universe, draft_operating_universe)
         values ($1,$2,$3,$4,$5,$6,$7,$4,$8::jsonb,$5,$9,$9) returning id, organization_id
       ), links as (
         insert into workflow_scope_links (workflow_id, organization_id, team_id, subteam_id)
         select c.id, c.organization_id, l.t, l.s from created c cross join unnest($10::uuid[], $11::uuid[]) as l(t, s)
       )
       select id from created`,
      [
        organizationId,
        input.name,
        input.description ?? null,
        scope.scopeType,
        JSON.stringify(withScheduleAnchor(trigger)),
        JSON.stringify(starterGraph()),
        request.user?.personId ?? null,
        JSON.stringify(scope.links),
        input.operatingUniverse,
        scope.links.map((link) => link.teamId),
        scope.links.map((link) => link.subteamId),
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
      const requested = input.scope ?? { scopeType: "ALL_TEAMS" as const }
      const scope = { scopeType: requested.scopeType, teamId: requested.teamId ?? null, subteamId: requested.subteamId ?? null, scopeLinks: (requested.scopeLinks ?? []).flatMap((link) => (link.teamId ? [{ teamId: link.teamId, subteamId: link.subteamId }] : [])) }
      // A prévia lista nomes de operadores do escopo: só de um escopo que quem pede administra (achado A-F09) — com vários Grupos,
      // todos eles.
      if (!canManageScope(await getManageableScopes(db, sessionUser(request), "workflows.manage"), workflowScopedTarget(scope))) {
        throw new DomainError("Você só pode pré-visualizar a agenda de Grupos do seu escopo.", "FORBIDDEN", 403)
      }
      const operators = await db.query<{ id: string; name: string }>(
        `select p.id, p.name from people p where p.organization_id = $1 and p.role = 'OPERATOR' and p.active
            and ${workflowReachSql("p", { all: "$2", wholeTeamIds: "$3", subteamIds: "$4" })}`,
        [organizationId, ...workflowReachParams(workflowReachOf(scope))],
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

    // Abrangência nova (do RASCUNHO): mesma validação da criação, preservando os vínculos que o Workflow já tinha (publicados ou no
    // rascunho) mesmo que hoje não seriam elegíveis; só os NOVOS precisam ser do universo do rascunho e ter operador em produção.
    const draftUniverse = input.operatingUniverse !== undefined ? input.operatingUniverse : current.operatingUniverse
    const nextScope: ResourceScope | null =
      input.scopeType !== undefined
        ? await resolveResourceScopeForWrite(db, organizationId, scopes, input, {
            codePrefix: "WORKFLOW",
            previous: previousScopeOf(current, input.scopeType),
            universe: draftUniverse,
            allTeamsMessage: "Você não tem permissão para mover o workflow para esse escopo: só quem administra a organização inteira escolhe “Todos os Grupos e Subgrupos”.",
          })
        : null
    const nextScopeInput = nextScope ? { scopeType: nextScope.scopeType, scopeLinks: nextScope.links } : current
    // Universo do rascunho mudou: TODOS os vínculos que ficam (não só os novos) precisam ser do universo novo (run-10 SEA-04).
    if (draftUniverse && draftUniverse !== current.operatingUniverse) {
      await assertScopeLinksInUniverse(db, organizationId, nextScope ? nextScope.links : workflowResourceScope(current).links, draftUniverse)
    }

    // Trocar a Abrangência não pode deixar uma referência cross-group inválida silenciosamente
    // pra trás (Parte 9 do pedido) — reavalia todo Orchestrator já referenciado no RASCUNHO contra o
    // escopo NOVO antes de aceitar a troca. A versão publicada continua rodando com a Abrangência
    // publicada até a próxima publicação (que valida o rascunho inteiro de novo).
    const scopeIsChanging = nextScope !== null && workflowScopeKey(nextScopeInput) !== workflowScopeKey(current)
    if (scopeIsChanging) {
      const referencedOrchestratorIds = new Set<string>()
      for (const node of (current.draftGraph as FlowGraph | null)?.nodes ?? []) {
        // Etapa de rascunho ainda sem orquestrador escolhido não tem o que conferir.
        if (node.type === "orchestrator" && node.config.orchestratorId) referencedOrchestratorIds.add(node.config.orchestratorId)
      }
      const nextTarget = workflowScopedTarget(nextScopeInput)
      if (referencedOrchestratorIds.size > 0) {
        const orchestratorRows = await db.query<{ id: string; name: string; scopeType: string; teamId: string | null; subteamId: string | null }>(
          `select id, name, scope_type "scopeType", team_id "teamId", subteam_id "subteamId" from assistant_orchestrators where id = any($1::uuid[])`,
          [[...referencedOrchestratorIds]],
        )
        const linksById = await loadResourceScopeLinks(db, "ORCHESTRATOR", orchestratorRows.rows.flatMap((orchestrator) => (orchestrator.scopeType === "GROUPS" ? [orchestrator.id] : [])))
        for (const orchestrator of orchestratorRows.rows) {
          if (!(await scopesAreCompatible(db, nextTarget, workflowScopedTarget({ ...orchestrator, scopeLinks: linksById.get(orchestrator.id) ?? [] })))) {
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
          nextScopeInput,
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
          nextScopeInput,
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
      // A estratégia de um indicador pode ter sido corrigida enquanto o Workflow estava pausado: a versão publicada não muda sozinha.
      await assertPublishedWorkflowMatchesIndicatorCatalog(db, organizationId, request.params.id!)
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

    if (input.operatingUniverse === null) await assertUniverseRequiredFor(db, organizationId, null, "do Workflow")
    if (input.trigger || nextScope || input.operatingUniverse !== undefined) {
      await writeDraftConfiguration(db, organizationId, request.params.id!, {
        ...(input.operatingUniverse !== undefined ? { universe: { operatingUniverse: input.operatingUniverse } } : {}),
        ...(input.trigger ? { trigger: withScheduleAnchor(normalizeManualTrigger(input.trigger), current.triggerConfig, current.live.triggerConfig) } : {}),
        ...(nextScope ? { scope: { scopeType: nextScope.scopeType, scopeLinks: nextScope.links } } : {}),
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
