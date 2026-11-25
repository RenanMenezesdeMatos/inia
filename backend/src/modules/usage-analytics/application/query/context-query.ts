import type { Database } from "../../../../infrastructure/database/pool.js"
import { SqlParams } from "../../../../shared/infrastructure/sql-params.js"
import { systemRoleCatalog } from "../../../access/domain/roles.js"
import type { OptionsReach } from "../../../org-structure/application/scoped-options.js"
import { populationSql } from "../../../people/application/usage-analytics-reader.js"
import { workflowsSql } from "../../../workflows/application/usage-analytics-reader.js"
import { METRIC_DEFINITIONS } from "../../domain/metric-dictionary.js"
import { USAGE_FEATURES } from "../../domain/usage-elements.js"
import { USAGE_AREA_LABELS, USAGE_SCREENS } from "../../domain/usage-screens.js"
import { PERIOD_PRESET_LABELS, PERIOD_PRESETS } from "../../domain/usage-time.js"
import { scopeCtes } from "./activity-sql.js"
import { FEEDBACK_SEGMENT_LABELS } from "./feedback-cohort-sql.js"
import { PEOPLE_SEGMENT_LABELS } from "./people-query.js"
import { FILTER_NOT_APPLICABLE_REASON, TAB_FILTERS } from "./usability-filters.js"
import { familyCoverage, loadCoverageState, loadFreshness, metaOf, type UsabilityContext } from "./usability-context.js"

/**
 * CONTEXTO do painel — permissões efetivas, filtros por aba (e o motivo dos indisponíveis), opções de filtro SEMPRE derivadas
 * do alcance do observador (nunca listam quem está fora dele) e cobertura geral. Pessoas e lideranças só aparecem como opção
 * para quem pode ver pessoas identificadas.
 */
type Queryable = Pick<Database, "query">

export async function contextQuery(db: Queryable, ctx: UsabilityContext) {
  const run = async <T extends Record<string, unknown>>(build: (p: SqlParams) => string) => {
    const p = new SqlParams()
    return (await db.query<T>(build(p), p.values)).rows
  }
  const [jobTitles, devices, versions, environments, workflows] = await Promise.all([
    run<{ job_title: string }>((p) => `with ${scopeCtes(p, ctx)} select distinct pop.job_title from (${populationSql(p, ctx.organizationId)}) pop where pop.job_title is not null and pop.person_id in (select person_id from scope_official) order by 1 limit 300`),
    run<{ device: string }>((p) => `select distinct device from usage_events where organization_id = ${p.typed(ctx.organizationId, "uuid")} and device is not null`),
    run<{ app_version: string }>((p) => `select distinct app_version from usage_events where organization_id = ${p.typed(ctx.organizationId, "uuid")} and app_version is not null order by 1 desc limit 50`),
    run<{ environment: string }>((p) => `select distinct environment from usage_events where organization_id = ${p.typed(ctx.organizationId, "uuid")} order by 1`),
    run<{ workflow_id: string; name: string; active: boolean }>((p) => `select workflow_id, name, active from (${workflowsSql(p.typed(ctx.organizationId, "uuid"))}) w order by name`),
  ])
  const coverageState = await loadCoverageState(db, ctx.organizationId, ctx.now)
  const freshness = await loadFreshness(db, ctx.organizationId, ctx.now)
  return {
    meta: metaOf(ctx, freshness, { coverage: { activity: familyCoverage(coverageState, ["NAVIGATION", "SESSION"], ctx.period.start, ctx.period.end) } }),
    periods: PERIOD_PRESETS.map((preset) => ({ value: preset, label: PERIOD_PRESET_LABELS[preset] })),
    tabs: Object.fromEntries(Object.entries(TAB_FILTERS).map(([tab, filters]) => [tab, filters])),
    notApplicableReasons: FILTER_NOT_APPLICABLE_REASON,
    dictionary: METRIC_DEFINITIONS,
    segments: { people: PEOPLE_SEGMENT_LABELS, feedbacks: FEEDBACK_SEGMENT_LABELS },
    collectionStartedAt: [...coverageState.families.values()].map((family) => family.first).sort((a, b) => a.getTime() - b.getTime())[0]?.toISOString() ?? null,
    options: {
      jobTitles: jobTitles.map((row) => row.job_title),
      accessRoles: systemRoleCatalog.all().map((role) => ({ code: role.code, name: role.name })),
      screens: USAGE_SCREENS.map((screen) => ({ key: screen.key, label: screen.label, area: screen.area, areaLabel: USAGE_AREA_LABELS[screen.area] })),
      features: USAGE_FEATURES.map((feature) => ({ key: feature.key, label: feature.label })),
      devices: devices.map((row) => row.device),
      appVersions: versions.map((row) => row.app_version),
      environments: environments.map((row) => row.environment),
      workflows: workflows.map((row) => ({ id: row.workflow_id, name: row.name, active: row.active })),
    },
  }
}

/**
 * Opções de Grupo, Subgrupo, pessoa e liderança, em lotes e sempre no alcance do observador. Pessoas (e lideranças, `leadersOnly`) só
 * para quem pode ver pessoas identificadas; o nome nunca vai para a URL da tela.
 */
export function usabilityOptionsReach(ctx: UsabilityContext, options: { people: boolean; leadersOnly: boolean }): OptionsReach {
  if (options.people && !ctx.can.people) return { select: "select null::uuid person_id, null::uuid team_id, null::uuid subteam_id where false", params: [] }
  const p = new SqlParams()
  const leaders = options.leadersOnly ? ` and exists (select 1 from (${populationSql(p, ctx.organizationId)}) sub where sub.reports_to_id = pop.person_id and sub.person_active)` : ""
  const select = `select distinct pop.person_id, pop.team_id, pop.subteam_id from (${populationSql(p, ctx.organizationId)}) pop where pop.person_id in (select person_id from scope_official)${leaders}`
  const ctes = `with ${scopeCtes(p, ctx)}`
  return { with: ctes, select, params: p.values }
}
