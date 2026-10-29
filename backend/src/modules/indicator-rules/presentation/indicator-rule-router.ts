import { Router, type NextFunction, type Request, type Response } from "express"
import { canManageScope, coversOrganization, getManageableScopes, normalizeScopedTarget } from "../../auth/application/manageable-scopes.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { strategyDraftPendingSql, strategyStatusSql } from "../../indicator-diagnosis/application/diagnostic-strategy-service.js"
import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { booleanParam, listParam, orgScopeFilterSchema, respondList, searchParam, SqlFilter } from "../../../shared/presentation/list-query.js"
import {
  AGGREGATION_STRATEGY_METADATA,
  DESIRED_DIRECTIONS,
  INDICATOR_UNITS,
  INDICATOR_UNIT_METADATA,
  SUPPORTED_OPERATIONAL_GRANULARITIES,
  describeAggregationStrategy,
} from "../../indicators/domain/indicator-definition.js"
import { OPERATIONAL_AGGREGATION_KINDS } from "../../indicators/domain/operational-aggregation.js"
import { loadVisibleIndicatorDependencies } from "../../indicators/application/indicator-dependencies.js"
import { createIndicatorDefinition, deleteIndicatorDefinition, findIndicatorDefinition, updateIndicatorDefinition } from "../../indicators/application/indicator-definition-service.js"


const ruleSchema = z.object({
  indicatorDefinitionId: z.string().uuid(),
  scopeType: z.enum(["ALL_TEAMS", "TEAM", "SUBTEAM"]),
  teamId: z.string().uuid().optional(),
  subteamId: z.string().uuid().optional(),
  calculationPeriod: z.enum(["DAILY", "WEEKLY", "MONTHLY"]),
  calculationMethod: z.string().trim().min(5),
  attainmentRule: z.string().trim().optional(),
})

const ruleUpdateSchema = z.object({
  calculationPeriod: z.enum(["DAILY", "WEEKLY", "MONTHLY"]).optional(),
  calculationMethod: z.string().trim().min(5).optional(),
  attainmentRule: z.string().trim().optional(),
  active: z.boolean().optional(),
})

const glossaryUpsertSchema = z.object({
  indicatorDefinitionId: z.string().uuid(),
  description: z.string().trim().min(5),
  interpretation: z.string().trim().min(5),
  goodPractices: z.string().trim().min(5),
  feedbackGuidance: z.string().trim().min(5),
})

const listIndicatorsSchema = orgScopeFilterSchema.extend({
  search: searchParam,
  desiredDirection: listParam(z.enum(["HIGHER", "LOWER", "TARGET"])),
  active: booleanParam,
  hasGlossary: booleanParam,
  dailySupported: booleanParam,
  calculationPeriod: listParam(z.enum(["DAILY", "WEEKLY", "MONTHLY"])),
})

// V1.6.2 — status compacto da estratégia de diagnóstico (Configurado | Rascunho | Não configurado | Inativo).
const INDICATOR_SELECT = `
  select
    d.id, d.code, d.name, d.unit, d.desired_direction "desiredDirection", d.active,
    d.operational_aggregation "operationalAggregation", d.daily_supported "dailySupported",
    d.minimum_sample_size "minimumSampleSize", d.minimum_coverage::float "minimumCoverage", d.official_closure_supported "officialClosureSupported", d.proves_work_activity "provesWorkActivity", d.unjustified_absence_policy "unjustifiedAbsencePolicy", d.availability_policy "availabilityPolicy", d.icon_key "iconKey",
    g.description "glossaryDescription", g.interpretation, g.good_practices "goodPractices", g.feedback_guidance "feedbackGuidance",
    ${strategyStatusSql("d")} "diagnosticStrategyStatus",
    ${strategyDraftPendingSql("d")} "diagnosticStrategyDraftPending",
    coalesce((
      select json_agg(json_build_object(
        'id', r.id, 'scopeType', r.scope_type, 'teamId', r.team_id, 'teamName', t.name,
        'subteamId', r.subteam_id, 'subteamName', st.name, 'calculationPeriod', r.calculation_period,
        'calculationMethod', r.calculation_method, 'attainmentRule', r.attainment_rule, 'active', r.active
      ) order by r.scope_type)
      from indicator_calculation_rules r
      left join teams t on t.id = r.team_id
      left join subteams st on st.id = r.subteam_id
      where r.indicator_definition_id = d.id and r.deleted_at is null
    ), '[]') "calculationRules"
  from indicator_definitions d
  left join lateral (
    select * from indicator_glossary ig where ig.indicator_definition_id = d.id and ig.active order by ig.version desc limit 1
  ) g on true
  where d.organization_id = $1
`

/**
 * ESCOPO (achado A-F04): definições de indicador e glossário valem para a organização inteira (mudam cálculo, metas e o
 * texto que a IA usa em todos os Grupos) — só `configuration.manage` com escopo de organização. Regra de cálculo de um
 * Grupo/Subgrupo pode ser mantida por quem administra aquele Grupo/Subgrupo; regra "todos os Grupos", só pela organização.
 */
const ORGANIZATION_REQUIRED = () => new DomainError("Indicadores e glossário valem para a organização inteira: só quem administra toda a organização pode alterá-los.", "ORGANIZATION_SCOPE_REQUIRED", 403)
const RULE_SCOPE_FORBIDDEN = () => new DomainError("Esta regra vale para Grupos fora do seu escopo.", "INDICATOR_RULE_SCOPE_FORBIDDEN", 403)

export function createIndicatorRuleRouter(db: Database) {
  const router = Router()
  const scopesOf = (request: Request) => getManageableScopes(db, request.user!, "configuration.manage")
  const organizationOnly = async (request: Request, _response: Response, next: NextFunction) => {
    try {
      if (!coversOrganization(await scopesOf(request))) return next(ORGANIZATION_REQUIRED())
      return next()
    } catch (error) {
      return next(error)
    }
  }
  /** Regra existente dentro do escopo de quem pede (fora = 404, não revela). */
  const ruleInScope = async (request: Request, ruleId: string) => {
    if (!z.string().uuid().safeParse(ruleId).success) return false
    const rule = await db.query<{ scope_type: string; team_id: string | null; subteam_id: string | null }>(`select scope_type, team_id, subteam_id from indicator_calculation_rules where id = $1 and organization_id = $2 and deleted_at is null`, [ruleId, request.user!.organizationId])
    const row = rule.rows[0]
    return Boolean(row && canManageScope(await scopesOf(request), { scopeType: row.scope_type, teamId: row.team_id, subteamId: row.subteam_id }))
  }

  router.get("/", async (request, response) => {
    const organizationId = request.user!.organizationId
    const input = listIndicatorsSchema.parse(request.query)
    const filter = new SqlFilter([organizationId])
      .search(input.search, ["q.code", "q.name", "q.unit"])
      .in('q."desiredDirection"', input.desiredDirection)
      .equals("q.active", input.active)
    if (input.hasGlossary !== undefined) filter.add(`q."glossaryDescription" is ${input.hasGlossary ? "not null" : "null"}`)
    // Periodicidade e grupo são atributos das regras de cálculo (1:n) — o indicador entra se
    // tiver ao menos uma regra viva que bata.
    if (input.calculationPeriod?.length) {
      filter.add(`exists (select 1 from indicator_calculation_rules r where r.indicator_definition_id = q.id and r.deleted_at is null and r.calculation_period = any(${filter.param(input.calculationPeriod)}::text[]))`)
    }
    if (input.subteamId) {
      filter.add(`exists (select 1 from indicator_calculation_rules r where r.indicator_definition_id = q.id and r.deleted_at is null and r.subteam_id = ${filter.param(input.subteamId)}::uuid)`)
    } else if (input.teamId) {
      filter.add(`exists (select 1 from indicator_calculation_rules r where r.indicator_definition_id = q.id and r.deleted_at is null and r.team_id = ${filter.param(input.teamId)}::uuid)`)
    } else if (input.scopeType === "ALL_TEAMS") {
      filter.add(`exists (select 1 from indicator_calculation_rules r where r.indicator_definition_id = q.id and r.deleted_at is null and r.scope_type = 'ALL_TEAMS')`)
    }
    if (input.dailySupported !== undefined) filter.equals('q."dailySupported"', input.dailySupported)
    const data = await respondList<{ operationalAggregation: string; unit: string }>(db, request.query, { select: INDICATOR_SELECT, filter, orderBy: "q.name, q.id" })
    // Texto funcional do cálculo derivado de estratégia + unidade (nunca por código) — o frontend
    // não repete a derivação. Vale pra lista completa (editor de Workflow) e paginada (tela).
    const decorate = (row: { operationalAggregation: string; unit: string }) => ({ ...row, calculation: describeAggregationStrategy(row.operationalAggregation as keyof typeof AGGREGATION_STRATEGY_METADATA, row.unit) })
    response.json({ data: Array.isArray(data) ? data.map(decorate) : { ...data, items: data.items.map(decorate) } })
  })

  /** Catálogo de COMPORTAMENTOS que a engine conhece — o formulário de indicador é dirigido por isto. */
  router.get("/catalog", (_request, response) => {
    response.json({
      data: {
        units: INDICATOR_UNITS.map((unit) => ({ value: unit, ...INDICATOR_UNIT_METADATA[unit] })),
        directions: DESIRED_DIRECTIONS,
        granularities: SUPPORTED_OPERATIONAL_GRANULARITIES,
        strategies: OPERATIONAL_AGGREGATION_KINDS.map((kind) => ({ value: kind, ...AGGREGATION_STRATEGY_METADATA[kind] })),
      },
    })
  })

  router.get("/definitions/:id/dependencies", async (request, response) => {
    const organizationId = request.user!.organizationId
    const definition = await findIndicatorDefinition(db, organizationId, request.params.id)
    if (!definition) return response.status(404).json({ error: { code: "INDICATOR_NOT_FOUND", message: "Indicador não encontrado." } })
    response.json({ data: await loadVisibleIndicatorDependencies(db, organizationId, definition, await getManageableScopes(db, request.user!, "workflows.manage")) })
  })

  router.post("/definitions", organizationOnly, async (request, response) => {
    const organizationId = request.user!.organizationId
    const definition = await createIndicatorDefinition(db, organizationId, request.body)
    response.status(201).json({ data: definition })
  })

  router.patch("/definitions/:id", organizationOnly, async (request, response) => {
    const organizationId = request.user!.organizationId
    const { definition } = await updateIndicatorDefinition(db, organizationId, String(request.params.id), request.body)
    response.json({ data: definition })
  })

  router.delete("/definitions/:id", organizationOnly, async (request, response) => {
    const organizationId = request.user!.organizationId
    const deleted = await deleteIndicatorDefinition(db, organizationId, String(request.params.id))
    if (!deleted) return response.status(404).json({ error: { code: "INDICATOR_NOT_FOUND", message: "Indicador não encontrado." } })
    return response.status(204).send()
  })

  router.post("/", async (request, response) => {
    const organizationId = request.user!.organizationId
    const input = ruleSchema.parse(request.body)
    const scope = await normalizeScopedTarget(db, organizationId, { scopeType: input.scopeType, teamId: input.teamId ?? null, subteamId: input.subteamId ?? null })
    if (!scope || !canManageScope(await scopesOf(request), scope)) throw RULE_SCOPE_FORBIDDEN()
    const result = await db.query<{ id: string }>(
      `insert into indicator_calculation_rules
         (organization_id, indicator_definition_id, scope_type, team_id, subteam_id, calculation_period, calculation_method, attainment_rule)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (organization_id, indicator_definition_id, scope_type, coalesce(team_id,'00000000-0000-0000-0000-000000000000'), coalesce(subteam_id,'00000000-0000-0000-0000-000000000000'))
       do update set
         calculation_period = excluded.calculation_period,
         calculation_method = excluded.calculation_method,
         attainment_rule = excluded.attainment_rule,
         active = true,
         deleted_at = null,
         updated_at = now()
       returning id`,
      [
        organizationId,
        input.indicatorDefinitionId,
        scope.scopeType,
        scope.teamId,
        scope.subteamId,
        input.calculationPeriod,
        input.calculationMethod,
        input.attainmentRule ?? null,
      ],
    )
    response.status(201).json({ data: { id: result.rows[0]!.id } })
  })

  router.patch("/:ruleId", async (request, response) => {
    const organizationId = request.user!.organizationId
    const input = ruleUpdateSchema.parse(request.body)
    if (!(await ruleInScope(request, String(request.params.ruleId)))) return response.status(404).json({ error: { code: "RULE_NOT_FOUND", message: "Regra não encontrada." } })
    const result = await db.query(
      `update indicator_calculation_rules set
         calculation_period = coalesce($1, calculation_period),
         calculation_method = coalesce($2, calculation_method),
         attainment_rule = coalesce($3, attainment_rule),
         active = coalesce($4, active),
         updated_at = now()
       where id = $5 and organization_id = $6
       returning id`,
      [input.calculationPeriod ?? null, input.calculationMethod ?? null, input.attainmentRule ?? null, input.active ?? null, request.params.ruleId, organizationId],
    )
    if (!result.rows[0]) return response.status(404).json({ error: { code: "RULE_NOT_FOUND", message: "Regra não encontrada." } })
    response.json({ data: { id: result.rows[0]!.id } })
  })

  router.delete("/:ruleId", async (request, response) => {
    if (!(await ruleInScope(request, String(request.params.ruleId)))) return response.status(404).json({ error: { code: "RULE_NOT_FOUND", message: "Regra não encontrada." } })
    const organizationId = request.user!.organizationId
    const result = await db.query(
      `update indicator_calculation_rules set deleted_at = now() where id = $1 and organization_id = $2 and deleted_at is null returning id`,
      [request.params.ruleId, organizationId],
    )
    if (!result.rows[0]) return response.status(404).json({ error: { code: "RULE_NOT_FOUND", message: "Regra não encontrada." } })
    response.status(204).send()
  })

  router.put("/glossary", organizationOnly, async (request, response) => {
    const organizationId = request.user!.organizationId
    const input = glossaryUpsertSchema.parse(request.body)
    const client = await db.connect()
    try {
      await client.query("begin")
      await client.query(
        `update indicator_glossary set active = false where indicator_definition_id = $1 and organization_id = $2`,
        [input.indicatorDefinitionId, organizationId],
      )
      const nextVersion = await client.query<{ next: number }>(
        `select coalesce(max(version), 0) + 1 next from indicator_glossary where indicator_definition_id = $1`,
        [input.indicatorDefinitionId],
      )
      await client.query(
        `insert into indicator_glossary(organization_id, indicator_definition_id, description, interpretation, good_practices, feedback_guidance, version, active)
         values ($1,$2,$3,$4,$5,$6,$7,true)`,
        [
          organizationId,
          input.indicatorDefinitionId,
          input.description,
          input.interpretation,
          input.goodPractices,
          input.feedbackGuidance,
          nextVersion.rows[0]!.next,
        ],
      )
      await client.query("commit")
    } catch (error) {
      await client.query("rollback")
      throw error
    } finally {
      client.release()
    }
    response.status(201).json({ data: { indicatorDefinitionId: input.indicatorDefinitionId } })
  })

  return router
}
