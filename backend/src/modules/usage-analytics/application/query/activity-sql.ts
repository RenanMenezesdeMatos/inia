import type { SqlParams } from "../../../../shared/infrastructure/sql-params.js"
import { allowedClasses, factStructureSql, scopePeopleSql, type UsabilityContext } from "./usability-context.js"
import { domainActionsSql } from "./domain-actions.js"
import { startOfLocalDate } from "../../domain/usage-time.js"

/**
 * Fragmentos SQL de ATIVIDADE (pessoa ativa, sessões, tempo ativo, elegibilidade) — os MESMOS predicados alimentam o card, a
 * lista de pessoas do drill-down e o CSV, para que os três reconciliem.
 *
 * Janela = [start, end) com datas locais [fromDate, toDate]. `cut` corta o ÚLTIMO dia (comparação alinhada a hoje parcial):
 * a pessoa só conta naquele dia se a primeira atividade dela foi antes do corte.
 */
export type Window = { start: Date; end: Date; fromDate: string; toDate: string; cut: Date | null }

export function windowsOf(ctx: UsabilityContext): { current: Window; previous: Window | null } {
  const current: Window = { start: ctx.period.start, end: ctx.period.end, fromDate: ctx.period.fromDate, toDate: ctx.period.toDate, cut: null }
  const previous: Window | null = ctx.comparison ? { start: ctx.comparison.start, end: ctx.comparison.end, fromDate: ctx.comparison.fromDate, toDate: ctx.comparison.toDate, cut: ctx.comparison.partialAligned ? ctx.comparison.end : null } : null
  return { current, previous }
}

/** CTEs de escopo: `scope_fact` (fatos com vínculo histórico) e `scope_official` (fontes oficiais — estrutura atual). */
export function scopeCtes(p: SqlParams, ctx: UsabilityContext): string {
  return `scope_fact as (${scopePeopleSql(p, ctx, { currentStructure: ctx.filters.structureMode === "CURRENT" })}),
    scope_official as (${scopePeopleSql(p, ctx, { currentStructure: true })})`
}

/** Linhas pessoa × dia ATIVAS na janela (alias `pd`). */
export function activeDaysWhere(p: SqlParams, ctx: UsabilityContext, w: Window, alias = "pd"): string {
  const cut = w.cut ? ` and (${alias}.local_date < ${p.typed(w.toDate, "date")} or ${alias}.first_activity_at < ${p.typed(w.cut, "timestamptz")})` : ""
  return `${alias}.organization_id = ${p.typed(ctx.organizationId, "uuid")} and ${alias}.local_date between ${p.typed(w.fromDate, "date")} and ${p.typed(w.toDate, "date")}
    and (${alias}.active_product or (${p.add(ctx.filters.includeAdmin)}::boolean and ${alias}.active_admin))
    and ${alias}.population_class = any(${p.typed(allowedClasses(ctx.filters), "text[]")}) and ${factStructureSql(p, ctx, alias)}
    and ${alias}.person_id in (select person_id from scope_fact)${cut}`
}

/** Pessoas ATIVAS na janela: atividade observada no navegador ∪ ação de domínio confirmada no servidor. */
export function activePeopleSql(p: SqlParams, ctx: UsabilityContext, w: Window): string {
  const org = p.typed(ctx.organizationId, "uuid")
  return `select pd.person_id from usage_person_days pd where ${activeDaysWhere(p, ctx, w)}
    union select da.person_id from (${domainActionsSql(org)}) da
      where da.occurred_at >= ${p.typed(w.start, "timestamptz")} and da.occurred_at < ${p.typed(w.end, "timestamptz")} and da.person_id in (select person_id from scope_official)`
}

/** Pessoas ENGAJADAS: ao menos uma ação de domínio na janela. */
export function engagedPeopleSql(p: SqlParams, ctx: UsabilityContext, w: Window): string {
  return `select distinct da.person_id from (${domainActionsSql(p.typed(ctx.organizationId, "uuid"))}) da
    where da.occurred_at >= ${p.typed(w.start, "timestamptz")} and da.occurred_at < ${p.typed(w.end, "timestamptz")} and da.person_id in (select person_id from scope_official)`
}

/** Pessoas ELEGÍVEIS em pelo menos parte da janela (intervalos registrados). */
export function eligiblePeopleSql(p: SqlParams, ctx: UsabilityContext, w: Window): string {
  return `select distinct ep.person_id from usage_eligibility_periods ep
    where ep.organization_id = ${p.typed(ctx.organizationId, "uuid")} and ep.eligible_from < ${p.typed(w.end, "timestamptz")}
      and coalesce(ep.eligible_until, 'infinity'::timestamptz) > ${p.typed(w.start, "timestamptz")} and ep.person_id in (select person_id from scope_official)`
}

/** Sessões INICIADAS na janela (alias `s`). */
export function sessionsStartedWhere(p: SqlParams, ctx: UsabilityContext, w: Window, alias = "s"): string {
  const admin = ctx.filters.includeAdmin ? "true" : `${alias}.has_product_activity`
  return `${alias}.organization_id = ${p.typed(ctx.organizationId, "uuid")} and ${alias}.started_at >= ${p.typed(w.start, "timestamptz")} and ${alias}.started_at < ${p.typed(w.end, "timestamptz")}
    and ${admin} and ${alias}.population_class = any(${p.typed(allowedClasses(ctx.filters), "text[]")}) and ${factStructureSql(p, ctx, alias)}
    and ${alias}.person_id in (select person_id from scope_fact)${ctx.filters.device ? ` and ${alias}.device = ${p.add(ctx.filters.device)}` : ""}`
}

/** Tempo ativo observado por pessoa na janela (dias inteiros pelos fatos; último dia cortado pela união dos intervalos brutos). Colunas: person_id, seconds. */
export function activeSecondsByPersonSql(p: SqlParams, ctx: UsabilityContext, w: Window): string {
  const column = ctx.filters.includeAdmin ? "active_seconds" : "active_seconds_product"
  if (!w.cut) return `select pd.person_id, sum(pd.${column})::bigint seconds from usage_person_days pd where ${activeDaysWhere(p, ctx, w)} group by pd.person_id`
  const lastDayStart = p.typed(startOfLocalDate(w.toDate, ctx.settings.timezone), "timestamptz")
  const cut = p.typed(w.cut, "timestamptz")
  const admin = ctx.filters.includeAdmin ? "" : ` and coalesce(e.area, '') not in ('ADMINISTRATION', 'USABILITY_PANEL')`
  return `select person_id, sum(seconds)::bigint seconds from (
      select pd.person_id, pd.${column}::bigint seconds from usage_person_days pd where ${activeDaysWhere(p, ctx, { ...w, cut: null })} and pd.local_date < ${p.typed(w.toDate, "date")}
      union all
      select u.actor_person_id, coalesce(sum(extract(epoch from (upper(u.r) - lower(u.r)))), 0)::bigint from (
        select e.actor_person_id, unnest(range_agg(tstzrange(greatest((e.properties->>'spanStart')::timestamptz, ${lastDayStart}), least((e.properties->>'spanEnd')::timestamptz, ${cut})))) r
        from usage_events e
        where e.organization_id = ${p.typed(ctx.organizationId, "uuid")} and e.event_name = 'activity.heartbeat' and e.source = 'CLIENT'
          and (e.properties->>'spanEnd')::timestamptz > ${lastDayStart} and (e.properties->>'spanStart')::timestamptz < ${cut}${admin}
          and e.actor_person_id in (select person_id from scope_fact) and e.population_class = any(${p.typed(allowedClasses(ctx.filters), "text[]")})
          and ${factStructureSql(p, ctx, "e")}
        group by e.actor_person_id) u
      group by u.actor_person_id
    ) parts group by person_id`
}
