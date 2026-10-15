import { DomainError } from "../../../shared/domain/domain-error.js"
import { SqlParams } from "../../../shared/infrastructure/sql-params.js"
import { scopedPeopleSql } from "../../access/application/scope-people-reader.js"
import { scopesWithPermission, type AccessContext } from "../../access/domain/access-decision.js"
import type { AccessScope } from "../../access/domain/access-scope.js"
import {
  AI_USAGE_RANKING_LEVEL_LABELS,
  AI_USAGE_RANKING_LEVELS,
  aiUsageRankingQuerySchema,
  LEADER_LEVEL_ROLES,
  shareOf,
  type AiUsageRankingLevel,
  type AiUsageRankingQuery,
  type AiUsageUnlinkedReason,
} from "../domain/ai-usage-ranking.js"
import { formatDecimal, parseDecimal } from "../domain/decimal.js"
import type { AiAdminContext } from "./ai-admin-context.js"
import { resolvePeriod } from "./ai-usage-service.js"

/**
 * RANKING "QUEM MAIS USA" A IA — leitura agregada de `ai_usage_events` (regras de atribuição em domain/ai-usage-ranking.ts).
 *
 * Segurança (a autoridade é este serviço, nunca o filtro do navegador):
 *  - organização = a da sessão; o recorte de PESSOAS = o escopo da permissão `ai.usage_ranking.view` da conta, lido do banco
 *    neste request (`scopedPeopleSql`: organização, Grupo, Subgrupo ou Minha estrutura — cargo nunca entra). Quem não tem
 *    escopo sobre um ramo não recebe linha dele: nem nome, nem número. Cada linha soma SÓ as pessoas do escopo;
 *  - uso sem pessoa identificada (ou de Workflow sem colaborador) não pertence a ramo nenhum: só aparece para quem tem a
 *    permissão na organização inteira e sem recorte de Grupo/Subgrupo;
 *  - filtros validados por zod `.strict()`; Grupo/Subgrupo só ESTREITAM o recorte já decidido.
 *
 * Desempenho: UMA consulta. O bruto do período é lido pelo índice organização × tempo e reduzido a uma linha por chave de
 * atribuição (matrícula × pessoa da sessão) ANTES de qualquer junção; matrícula → colaborador e pessoa → unidade rodam sobre
 * essas chaves. O ranking é o agregado por unidade (limitado ao número de líderes/Grupos do nível, nunca ao histórico): a
 * página sai dele por posição (LIMIT/OFFSET sobre o agregado) e os nomes só entram para as unidades ranqueadas.
 */

export type RankingViewer = { organizationId: string; personId: string; access: AccessContext }

const RANKING_PERMISSION = "ai.usage_ranking.view" as const

type RankingScope = { organizationWide: boolean; scopes: AccessScope[] }

function rankingScope(access: AccessContext): RankingScope {
  const scopes = scopesWithPermission(access, RANKING_PERMISSION)
  // Deny by default — o guard da rota já barrou; aqui é a segunda linha (serviço chamado de outro lugar).
  if (scopes.length === 0) throw new DomainError("Você não tem permissão para ver quem mais usa a IA.", "FORBIDDEN", 403)
  return { organizationWide: scopes.some((scope) => scope.type === "ORGANIZATION"), scopes }
}

export type RankingMetrics = {
  requests: number
  attempts: number
  errors: number
  /** Soma do que o provider INFORMOU (null = nenhum evento informou). */
  tokens: number | null
  tokensReported: number
  unknownCostCalls: number
  costByCurrency: Record<string, string>
  /** Pessoas do escopo com uso atribuído (sem pessoa identificada não conta). */
  people: number
  /** Participação nas chamadas do recorte (inclui "Sem vínculo"), 1 casa. */
  share: number | null
}
export type RankingItem = RankingMetrics & {
  position: number
  key: string
  name: string | null
  jobTitle: string | null
  teamName: string | null
  active: boolean
  requestsBySource: { WORKFLOW: number; REQUEST: number }
}
export type UnlinkedReasonRow = { reason: AiUsageUnlinkedReason; requests: number; tokens: number | null; costByCurrency: Record<string, string> }
export type AiUsageRanking = {
  level: AiUsageRankingLevel
  levelLabel: string
  period: { from: string; to: string; label: string; timezone: string }
  scope: { organizationWide: boolean; unlinkedWithoutPersonVisible: boolean }
  items: RankingItem[]
  total: number
  page: number
  pageSize: number
  unlinked: RankingMetrics & { reasons: UnlinkedReasonRow[] }
  totals: RankingMetrics
}

/** `tokens` chega como número do jsonb (soma de inteiros informados — bem abaixo de 2^53). */
type MetricJson = { requests: number; attempts: number; errors: number; tokens: number | null; tokens_n: number; unknown_cost: number; people: number }
type ItemJson = MetricJson & { entity_id: string; position: number; name: string | null; job_title: string | null; team_name: string | null; active: boolean | null; workflow_requests: number; request_requests: number }
type UnlinkedJson = MetricJson & { reason: AiUsageUnlinkedReason }
type CostJson = { entity_id: string | null; reason: string | null; currency: string; amount: string }
type RankingRow = { total: number; items: ItemJson[]; unlinked: UnlinkedJson[]; totals: MetricJson | null; costs: CostJson[] }

const SORT_SQL: Record<AiUsageRankingQuery["sort"], string> = {
  REQUESTS: "r.requests desc, r.tokens desc nulls last",
  TOKENS: "r.tokens desc nulls last, r.requests desc",
  PEOPLE: "r.people desc, r.requests desc",
}

/** Unidade do nível para cada pessoa do recorte (colunas person_id, entity_id). */
function entityOfSql(p: SqlParams, org: string, level: AiUsageRankingLevel): string {
  const role = LEADER_LEVEL_ROLES[level]
  if (!role) {
    const column = level === "TEAM" ? "team_id" : "subteam_id"
    return `entity_of as (select ps.person_id, ps.${column} entity_id from persons ps where ps.${column} is not null)`
  }
  // Líder mais próximo com o cargo, subindo por reports_to_id (a própria pessoa conta). Para de subir ao achar; anticiclo
  // por profundidade, como as demais CTEs de hierarquia.
  const rolePlaceholder = p.add(role)
  return `chain as (
      select ps.person_id, ps.person_id node_id, ps.role, ps.reports_to_id, 0 depth from persons ps
      union all
      select c.person_id, m.id, m.role, m.reports_to_id, c.depth + 1
        from chain c join people m on m.id = c.reports_to_id and m.organization_id = ${org}
       where c.role <> ${rolePlaceholder} and c.depth < 32
    ),
    entity_of as (select distinct on (person_id) person_id, node_id entity_id from chain where role = ${rolePlaceholder} order by person_id, depth)`
}

function namesSql(org: string, level: AiUsageRankingLevel): string {
  if (LEADER_LEVEL_ROLES[level]) {
    return `select x.id entity_id, x.name, x.job_title, t.name team_name, x.active from people x left join teams t on t.id = x.team_id
             where x.organization_id = ${org} and x.id in (select entity_id from ranking)`
  }
  if (level === "TEAM") return `select t.id entity_id, t.name, null::text job_title, null::text team_name, true active from teams t where t.organization_id = ${org} and t.id in (select entity_id from ranking)`
  return `select s.id entity_id, s.name, null::text job_title, t.name team_name, true active from subteams s join teams t on t.id = s.team_id
           where s.organization_id = ${org} and s.id in (select entity_id from ranking)`
}

const METRIC_SUMS = `coalesce(sum(requests), 0)::int requests, coalesce(sum(attempts), 0)::int attempts, coalesce(sum(errors), 0)::int errors,
  sum(tokens)::bigint tokens, coalesce(sum(tokens_n), 0)::int tokens_n, coalesce(sum(unknown_cost), 0)::int unknown_cost`

export async function usageRanking(context: AiAdminContext, viewer: RankingViewer, rawQuery: unknown): Promise<AiUsageRanking> {
  const query = aiUsageRankingQuerySchema.parse(rawQuery)
  const scope = rankingScope(viewer.access)
  const period = await resolvePeriod(context, viewer.organizationId, query)

  const p = new SqlParams()
  const org = p.typed(viewer.organizationId, "uuid")
  const eventWhere = [`u.organization_id = ${org}`, `u.occurred_at >= ${p.typed(period.from, "timestamptz")}`, `u.occurred_at <= ${p.typed(period.to, "timestamptz")}`]
  if (query.providerKey) eventWhere.push(`u.provider_key = ${p.add(query.providerKey)}`)
  if (query.modelId) eventWhere.push(`u.model_id = ${p.typed(query.modelId, "uuid")}`)
  if (query.useCase) eventWhere.push(`u.use_case = ${p.add(query.useCase)}`)
  const personWhere = [`p.organization_id = ${org}`, `p.id in (select person_id from attributed where person_id is not null)`]
  if (!scope.organizationWide) personWhere.push(`p.id in (${scopedPeopleSql(p, { organizationId: viewer.organizationId, viewerPersonId: viewer.personId, permission: RANKING_PERMISSION })})`)
  if (query.teamId) personWhere.push(`p.team_id = ${p.typed(query.teamId, "uuid")}`)
  if (query.subteamId) personWhere.push(`p.subteam_id = ${p.typed(query.subteamId, "uuid")}`)
  const unlinkedWithoutPersonVisible = scope.organizationWide && !query.teamId && !query.subteamId
  const includeUnlinked = p.typed(unlinkedWithoutPersonVisible, "boolean")
  const sourceWhere = query.source ? ` and a.source = ${p.add(query.source)}` : ""
  const entityOf = entityOfSql(p, org, query.level)
  const offset = p.typed((query.page - 1) * query.pageSize, "int")
  const limit = p.typed(query.pageSize, "int")

  const sql = `
    with recursive ev as not materialized (
      select coalesce(u.enrollment_id::text, '') || '|' || coalesce(u.requester_person_id::text, '') akey,
             u.enrollment_id, u.requester_person_id, u.correlation_id, u.status, u.total_tokens, u.cost, u.currency, u.cost_status
        from ai_usage_events u
       where ${eventWhere.join(" and ")}
    ),
    keys as (
      select akey, enrollment_id, requester_person_id,
             count(distinct correlation_id)::int requests, count(*)::int attempts, count(*) filter (where status = 'ERROR')::int errors,
             sum(total_tokens)::bigint tokens, count(total_tokens)::int tokens_n,
             count(*) filter (where status = 'SUCCESS' and cost_status = 'UNKNOWN')::int unknown_cost
        from ev group by akey, enrollment_id, requester_person_id
    ),
    key_costs as (select akey, currency, sum(cost) amount from ev where cost is not null group by akey, currency),
    subjects as (
      select e.id enrollment_id, coalesce(e.scheduled_subject_id, i.operator_id, m.subject_id) person_id
        from workflow_enrollments e
        left join interactions i on i.id = e.interaction_id
        left join indicator_measurements m on m.id = e.indicator_measurement_id and m.subject_type = 'PERSON'
       where e.organization_id = ${org} and e.id in (select enrollment_id from keys where enrollment_id is not null)
    ),
    attributed as (
      select k.*,
             case when k.enrollment_id is not null then 'WORKFLOW' when k.requester_person_id is not null then 'REQUEST' else 'OTHER' end source,
             case when k.enrollment_id is not null then s.person_id else k.requester_person_id end person_id
        from keys k left join subjects s on s.enrollment_id = k.enrollment_id
    ),
    persons as (
      select p.id person_id, p.team_id, p.subteam_id, p.role, p.reports_to_id from people p where ${personWhere.join(" and ")}
    ),
    ${entityOf},
    assigned as (
      select a.akey, a.source, a.requests, a.attempts, a.errors, a.tokens, a.tokens_n, a.unknown_cost,
             case when ps.person_id is not null then a.person_id end person_id,
             case when ps.person_id is not null then eo.entity_id end entity_id,
             case when ps.person_id is not null and eo.entity_id is not null then null
                  when ps.person_id is not null then 'OUTSIDE_LEVEL'
                  when a.source = 'WORKFLOW' and a.person_id is null then 'WORKFLOW_WITHOUT_PERSON'
                  else 'NO_PERSON' end reason
        from attributed a
        left join persons ps on ps.person_id = a.person_id
        left join entity_of eo on eo.person_id = a.person_id
       where (ps.person_id is not null or ${includeUnlinked})${sourceWhere}
    ),
    ranking as (
      select entity_id, ${METRIC_SUMS},
             count(distinct person_id)::int people,
             coalesce(sum(requests) filter (where source = 'WORKFLOW'), 0)::int workflow_requests,
             coalesce(sum(requests) filter (where source = 'REQUEST'), 0)::int request_requests
        from assigned where entity_id is not null group by entity_id
    ),
    names as (${namesSql(org, query.level)}),
    page_items as (
      select * from (
        select r.*, n.name, n.job_title, n.team_name, n.active,
               row_number() over (order by ${SORT_SQL[query.sort]}, n.name nulls last, r.entity_id)::int position
          from ranking r left join names n on n.entity_id = r.entity_id
      ) ranked order by position offset ${offset} limit ${limit}
    )
    select
      (select count(*)::int from ranking) total,
      (select coalesce(jsonb_agg(to_jsonb(pi) order by pi.position), '[]'::jsonb) from page_items pi) items,
      (select coalesce(jsonb_agg(to_jsonb(u) order by u.reason), '[]'::jsonb)
         from (select reason, ${METRIC_SUMS}, count(distinct person_id)::int people from assigned where entity_id is null group by reason) u) unlinked,
      (select to_jsonb(t) from (select ${METRIC_SUMS}, count(distinct person_id)::int people from assigned) t) totals,
      (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) from (
         select a.entity_id, a.reason, kc.currency, sum(kc.amount)::text amount
           from assigned a join key_costs kc on kc.akey = a.akey
          where a.entity_id is null or a.entity_id in (select entity_id from page_items)
          group by a.entity_id, a.reason, kc.currency
      ) c) costs`

  const result = await context.db.query<RankingRow>(sql, p.values)
  const row = result.rows[0]!
  const totalsBase = row.totals ?? { requests: 0, attempts: 0, errors: 0, tokens: null, tokens_n: 0, unknown_cost: 0, people: 0 }
  const scopeRequests = totalsBase.requests

  const costsOf = (match: (cost: CostJson) => boolean): Record<string, string> => {
    const sums = new Map<string, bigint>()
    for (const cost of row.costs.filter(match)) sums.set(cost.currency, (sums.get(cost.currency) ?? 0n) + parseDecimal(cost.amount))
    return Object.fromEntries([...sums.entries()].map(([currency, amount]) => [currency, formatDecimal(amount, 6)]))
  }
  const metricsOf = (json: MetricJson, costByCurrency: Record<string, string>): RankingMetrics => ({
    requests: json.requests,
    attempts: json.attempts,
    errors: json.errors,
    tokens: json.tokens_n > 0 && json.tokens !== null ? Number(json.tokens) : null,
    tokensReported: json.tokens_n,
    unknownCostCalls: json.unknown_cost,
    costByCurrency,
    people: json.people,
    share: shareOf(json.requests, scopeRequests),
  })

  const unlinkedRows = row.unlinked
  const unlinkedSum = unlinkedRows.reduce<MetricJson>(
    (sum, item) => ({
      requests: sum.requests + item.requests,
      attempts: sum.attempts + item.attempts,
      errors: sum.errors + item.errors,
      tokens: item.tokens === null ? sum.tokens : (sum.tokens ?? 0) + Number(item.tokens),
      tokens_n: sum.tokens_n + item.tokens_n,
      unknown_cost: sum.unknown_cost + item.unknown_cost,
      people: sum.people + item.people,
    }),
    { requests: 0, attempts: 0, errors: 0, tokens: null, tokens_n: 0, unknown_cost: 0, people: 0 },
  )

  return {
    level: query.level,
    levelLabel: AI_USAGE_RANKING_LEVEL_LABELS[query.level],
    period: { from: period.from.toISOString(), to: period.to.toISOString(), label: period.label, timezone: period.timezone },
    scope: { organizationWide: scope.organizationWide, unlinkedWithoutPersonVisible },
    items: row.items.map((item) => ({
      ...metricsOf(item, costsOf((cost) => cost.entity_id === item.entity_id)),
      position: item.position,
      key: item.entity_id,
      name: item.name,
      jobTitle: item.job_title,
      teamName: item.team_name,
      active: item.active ?? false,
      requestsBySource: { WORKFLOW: item.workflow_requests, REQUEST: item.request_requests },
    })),
    total: row.total,
    page: query.page,
    pageSize: query.pageSize,
    unlinked: {
      ...metricsOf(unlinkedSum, costsOf((cost) => cost.entity_id === null)),
      reasons: unlinkedRows.map((item) => ({
        reason: item.reason,
        requests: item.requests,
        tokens: item.tokens_n > 0 && item.tokens !== null ? Number(item.tokens) : null,
        costByCurrency: costsOf((cost) => cost.entity_id === null && cost.reason === item.reason),
      })),
    },
    totals: metricsOf(totalsBase, costsOf(() => true)),
  }
}

export type AiUsageRankingContext = {
  levels: { key: AiUsageRankingLevel; label: string }[]
  scope: { organizationWide: boolean; labels: string[] }
  teams: { id: string; name: string; subteams: { id: string; name: string }[] }[]
}

/**
 * O que a tela precisa para montar os filtros: níveis, a descrição do escopo da conta e os Grupos/Subgrupos onde ela PODE
 * ver uso (organização inteira = todos; senão, os do cadastro das pessoas do escopo). Nunca lista pessoas.
 */
export async function usageRankingContext(context: AiAdminContext, viewer: RankingViewer): Promise<AiUsageRankingContext> {
  const scope = rankingScope(viewer.access)
  const p = new SqlParams()
  const org = p.typed(viewer.organizationId, "uuid")
  const teamsSql = scope.organizationWide
    ? `select t.id team_id, t.name team_name, s.id subteam_id, s.name subteam_name from teams t left join subteams s on s.team_id = t.id and s.organization_id = t.organization_id where t.organization_id = ${org}`
    : `select distinct t.id team_id, t.name team_name, s.id subteam_id, s.name subteam_name
         from people pe join teams t on t.id = pe.team_id and t.organization_id = pe.organization_id
         left join subteams s on s.id = pe.subteam_id and s.organization_id = pe.organization_id
        where pe.organization_id = ${org} and pe.id in (${scopedPeopleSql(p, { organizationId: viewer.organizationId, viewerPersonId: viewer.personId, permission: RANKING_PERMISSION })})`
  const teamIds = scope.scopes.flatMap((item) => (item.type === "GROUP" ? [item.teamId] : []))
  const subteamIds = scope.scopes.flatMap((item) => (item.type === "SUBGROUP" ? [item.subteamId] : []))
  const [teamRows, scopeNames] = await Promise.all([
    context.db.query<{ team_id: string; team_name: string; subteam_id: string | null; subteam_name: string | null }>(teamsSql, p.values),
    context.db.query<{ id: string; name: string }>(
      `select id, name from teams where organization_id = $1 and id = any($2::uuid[]) union all select id, name from subteams where organization_id = $1 and id = any($3::uuid[])`,
      [viewer.organizationId, teamIds, subteamIds],
    ),
  ])
  const teams = new Map<string, { id: string; name: string; subteams: Map<string, string> }>()
  for (const row of teamRows.rows) {
    const team = teams.get(row.team_id) ?? { id: row.team_id, name: row.team_name, subteams: new Map<string, string>() }
    if (row.subteam_id && row.subteam_name) team.subteams.set(row.subteam_id, row.subteam_name)
    teams.set(row.team_id, team)
  }
  const nameOf = new Map(scopeNames.rows.map((row) => [row.id, row.name]))
  const labels = scope.organizationWide
    ? ["Organização inteira"]
    : [...new Set(scope.scopes.map((item) => (item.type === "GROUP" ? `Grupo ${nameOf.get(item.teamId) ?? "—"}` : item.type === "SUBGROUP" ? `Subgrupo ${nameOf.get(item.subteamId) ?? "—"}` : "Minha estrutura")))]
  const byName = (left: { name: string }, right: { name: string }) => left.name.localeCompare(right.name, "pt-BR")
  return {
    levels: AI_USAGE_RANKING_LEVELS.map((key) => ({ key, label: AI_USAGE_RANKING_LEVEL_LABELS[key] })),
    scope: { organizationWide: scope.organizationWide, labels },
    teams: [...teams.values()].map((team) => ({ id: team.id, name: team.name, subteams: [...team.subteams.entries()].map(([id, name]) => ({ id, name })).sort(byName) })).sort(byName),
  }
}
