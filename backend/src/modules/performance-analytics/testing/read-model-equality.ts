import { isDeepStrictEqual } from "node:util"
import type { Database } from "../../../infrastructure/database/pool.js"
import type { AuthTokenPayload, PlatformRole } from "../../auth/infrastructure/jwt.js"
import { countInteractionsByPersonDay, countInteractionsByPersonDayRaw } from "../../indicators/application/operational-measurement-resolver.js"
import { resolveOrganizationTimezone } from "../../workflows/application/organization-timezone.js"
import { resolvePreviousTimeWindow, resolveTimeWindow } from "../../workflows/application/time-window.js"
import { loadMonthSpend, loadMonthSpendRaw } from "../../ai-management/application/ai-runtime-store.js"
import { resolveOfficialClosure } from "../../indicators/application/official-closure.js"
import { PgAnalyticsReadRepository } from "../application/analytics-read-repository.js"
import { buildIndicatorMembers } from "../application/build-indicator-members.js"
import { buildStructureBreakdown, buildStructureDashboard } from "../application/build-structure-dashboard.js"
import { buildTeamMembersPage, buildTeamOverview, type TeamMembersQuery } from "../application/build-team-overview.js"
import { clearOfficialAnalyticsCache } from "../application/official-analytics-cache.js"
import type { StructureAnchor } from "../../workflows/domain/structure-anchor-schema.js"
import { buildIndicatorViewCapabilities } from "../domain/view-capabilities.js"
import { buildStructureOperationalSummary } from "../application/operational-trend.js"
import { loadViewerScope, resolveSubject, type ScopePermission, type ViewerScope } from "../application/viewer-scope.js"
import { buildAnalyticsSubject, type AnalyticsSubject } from "../domain/analytics-subject.js"
import { HIERARCHY_ROLES, STRUCTURE_KIND_BY_ROLE } from "../domain/hierarchy-levels.js"
import { OPERATIONAL_COMPARISONS, operationalComparisonPeriod, type OperationalComparison } from "../domain/operational-comparison.js"
import { loadReadModelIndicatorCodes, readStructureWindows } from "../infrastructure/operational-read-model.js"
import { OrganizationPeopleGraphCache } from "../infrastructure/organization-people-graph.js"

/**
 * PROVA DE IGUALDADE do read model do analytics da liderança (docs/dev/escala-read-model-e-ciclo-de-vida.md): cada caminho
 * novo é comparado com o caminho ANTIGO, que continua no código como referência. Usada pela prova no banco de teste
 * (`INIA_DB_PROOF=1 npx vitest run analytics-read-model-proof`) e pelo script no banco de dev
 * (`npx tsx scripts/dev/analytics-read-model-equality.ts`). Nada aqui escreve no banco.
 */
export type EqualityMismatch = { check: string; key: string; detail: string }

/** Impressão comparável de um escopo: viewer, nós (em ordem) e filhos por gestor (em ordem). */
export function scopeFingerprint(scope: ViewerScope) {
  return {
    viewer: scope.viewer,
    role: scope.role,
    access: scope.access,
    nodes: [...scope.nodes.entries()],
    children: [...scope.children.entries()].map(([managerId, nodes]) => [managerId, nodes.map((node) => node.id)]),
  }
}

export type ScopeSubject = { personId: string; accountId: string; role: PlatformRole }

export async function scopeSubjects(db: Pick<Database, "query">, organizationId: string): Promise<ScopeSubject[]> {
  const result = await db.query<{ person_id: string; account_id: string | null; role: PlatformRole }>(
    `select p.id person_id, a.id account_id, p.role from people p left join user_accounts a on a.person_id = p.id where p.organization_id = $1 order by p.name, p.id`,
    [organizationId],
  )
  // Sem conta: a visibilidade de acesso fica vazia nos dois caminhos — só a subárvore operacional conta.
  return result.rows.map((row) => ({ personId: row.person_id, accountId: row.account_id ?? "00000000-0000-4000-8000-00000000dead", role: row.role }))
}

function userOf(organizationId: string, subject: ScopeSubject): AuthTokenPayload {
  return { sub: subject.accountId, personId: subject.personId, organizationId, role: subject.role, name: "", email: "", avatarUrl: null, jobTitle: null, teamId: null, teamName: null }
}

/** Escopo derivado do grafo em memória × escopo das consultas originais, para cada pessoa e permissão pedidas. */
export async function compareViewerScopes(db: Database, organizationId: string, subjects: ScopeSubject[], permissions: ScopePermission[] = ["indicators.view"]): Promise<{ compared: number; mismatches: EqualityMismatch[] }> {
  const sql = new PgAnalyticsReadRepository(db, { peopleSource: "sql" })
  const graph = new PgAnalyticsReadRepository(db, { peopleSource: "graph", peopleGraphCache: new OrganizationPeopleGraphCache() })
  const mismatches: EqualityMismatch[] = []
  let compared = 0
  for (const subject of subjects) {
    for (const permission of permissions) {
      const user = userOf(organizationId, subject)
      const [expected, actual] = await Promise.all([loadViewerScope(sql, user, permission).then(scopeFingerprint, errorOf), loadViewerScope(graph, user, permission).then(scopeFingerprint, errorOf)])
      compared += 1
      if (!isDeepStrictEqual(expected, actual)) mismatches.push({ check: "viewer-scope", key: `${subject.personId}:${permission}`, detail: describeDifference(expected, actual) })
    }
  }
  return { compared, mismatches }
}

function errorOf(error: unknown) {
  return { error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }
}

export function describeDifference(expected: unknown, actual: unknown): string {
  const left = JSON.stringify(expected)
  const right = JSON.stringify(actual)
  let index = 0
  while (index < left.length && left[index] === right[index]) index += 1
  return `primeira diferença no caractere ${index}: antigo …${left.slice(Math.max(0, index - 80), index + 120)}… novo …${right.slice(Math.max(0, index - 80), index + 120)}…`
}

/**
 * `person_daily_activity` × contagem bruta: (1) a tabela inteira contra o GROUP BY das interações da organização, no fuso dela;
 * (2) a leitura da evidência (`countInteractionsByPersonDay`) contra a consulta original, por lotes de pessoas, na janela pedida.
 */
export async function compareInteractionDayCounts(db: Database, organizationId: string, window: { firstDate: string; lastDate: string }, batchSize = 500): Promise<{ compared: number; mismatches: EqualityMismatch[] }> {
  const mismatches: EqualityMismatch[] = []
  const table = await db.query<{ person_id: string; local_date: string; raw: number | null; rollup: number | null }>(
    `select coalesce(raw.person_id, a.person_id) person_id, to_char(coalesce(raw.local_date, a.local_date), 'YYYY-MM-DD') local_date, raw.n raw, a.interaction_count rollup
       from (select operator_id person_id, (started_at at time zone analytics_org_timezone(organization_id))::date local_date, count(*)::int n
               from interactions where organization_id = $1 and operator_id is not null group by 1, 2) raw
       full outer join (select * from person_daily_activity where organization_id = $1) a on a.person_id = raw.person_id and a.local_date = raw.local_date
      where raw.n is distinct from a.interaction_count`,
    [organizationId],
  )
  for (const row of table.rows) mismatches.push({ check: "person-daily-activity", key: `${row.person_id}:${row.local_date}`, detail: `bruto ${row.raw ?? 0} × tabela ${row.rollup ?? 0}` })
  const timeZone = await resolveOrganizationTimezone(db, organizationId)
  const people = await db.query<{ id: string }>(`select id from people where organization_id = $1 order by id`, [organizationId])
  const ids = people.rows.map((row) => row.id)
  const normalize = (rows: { operator_id: string; local_date: string; total: number }[]) =>
    rows.filter((row) => row.local_date >= window.firstDate && row.local_date <= window.lastDate).map((row) => `${row.operator_id}|${row.local_date}|${Number(row.total)}`).sort()
  let compared = table.rowCount ?? 0
  for (let index = 0; index < ids.length; index += batchSize) {
    const batch = ids.slice(index, index + batchSize)
    const [expected, actual] = await Promise.all([countInteractionsByPersonDayRaw(db, batch, window.firstDate, window.lastDate, timeZone), countInteractionsByPersonDay(db, batch, window.firstDate, window.lastDate, timeZone)])
    const left = normalize(expected.rows)
    const right = normalize(actual.rows)
    compared += left.length
    if (!isDeepStrictEqual(left, right)) mismatches.push({ check: "interaction-evidence", key: `lote ${index / batchSize + 1}`, detail: describeDifference(left, right) })
  }
  return { compared, mismatches }
}

export type StructureSubjectCase = { label: string; subject: AnalyticsSubject; memberIds: string[] }

/** Quem enxerga a organização toda nas provas: o líder do topo (o escopo dele é a árvore inteira). */
async function topViewer(db: Database, organizationId: string): Promise<AuthTokenPayload | null> {
  const graph = await new OrganizationPeopleGraphCache().get(db, organizationId)
  const leaders = graph.people.filter((person) => person.active && (HIERARCHY_ROLES as readonly string[]).includes(person.role))
  const top = leaders.find((person) => person.role === "DIRECTOR") ?? leaders[0]
  if (!top) return null
  const account = await db.query<{ id: string }>(`select id from user_accounts where person_id = $1`, [top.id])
  return { sub: account.rows[0]?.id ?? "00000000-0000-4000-8000-00000000dead", personId: top.id, organizationId, role: top.role as PlatformRole, name: "", email: "", avatarUrl: null, jobTitle: null, teamId: null, teamName: null }
}

/**
 * Todas as estruturas da organização vistas por quem enxerga tudo (escopo de acesso da organização inteira): cada líder
 * ativo como âncora (o tipo de estrutura do cargo dele) + cada Grupo e Subgrupo — com os membros resolvidos pela MESMA
 * regra das telas (`resolveSubject`).
 */
export async function structureSubjectCases(db: Database, organizationId: string): Promise<StructureSubjectCase[]> {
  const repository = new PgAnalyticsReadRepository(db)
  const graph = await new OrganizationPeopleGraphCache().get(db, organizationId)
  const leaders = graph.people.filter((person) => person.active && (HIERARCHY_ROLES as readonly string[]).includes(person.role))
  const viewer = await topViewer(db, organizationId)
  if (!viewer) return []
  const top = graph.byId.get(viewer.personId)!
  const scope = await loadViewerScope(repository, viewer)
  // O escopo do topo é a árvore dele; Grupos/Subgrupos entram pelo que ela alcança.
  const cases: StructureSubjectCase[] = []
  for (const leader of leaders) {
    if (leader.id !== top.id && !scope.nodes.has(leader.id)) continue
    const subject = buildAnalyticsSubject(STRUCTURE_KIND_BY_ROLE[leader.role as (typeof HIERARCHY_ROLES)[number]], leader.id)
    cases.push({ label: `${leader.role} ${leader.name}`, subject, memberIds: resolveSubject(scope, subject).members.map((member) => member.id) })
  }
  const teams = new Map<string, string>()
  const subteams = new Map<string, string>()
  for (const node of scope.nodes.values()) {
    if (node.teamId) teams.set(node.teamId, node.teamName ?? node.teamId)
    if (node.subteamId) subteams.set(node.subteamId, node.subteamName ?? node.subteamId)
  }
  for (const [id, name] of teams) {
    const subject = buildAnalyticsSubject("TEAM", id)
    try {
      cases.push({ label: `TEAM ${name}`, subject, memberIds: resolveSubject(scope, subject).members.map((member) => member.id) })
    } catch {
      // Grupo sem operador ativo visível: a tela também recusa.
    }
  }
  for (const [id, name] of subteams) {
    const subject = buildAnalyticsSubject("SUBTEAM", id)
    try {
      cases.push({ label: `SUBTEAM ${name}`, subject, memberIds: resolveSubject(scope, subject).members.map((member) => member.id) })
    } catch {
      // idem
    }
  }
  return cases.filter((entry) => entry.memberIds.length > 0)
}

export type StructureSummaryComparison = { compared: number; mismatches: EqualityMismatch[]; readModelUsed: number; fallbacks: number; liveMembers: number; rawMs: number; readModelMs: number; slowest: { label: string; comparison: string; rawMs: number; readModelMs: number }[] }

/** Resumo operacional da estrutura: caminho original × read model, mesmo `now`, igualdade profunda do view model. */
export async function compareStructureSummaries(db: Database, organizationId: string, now: Date, cases: StructureSubjectCase[], comparisons: readonly OperationalComparison[] = OPERATIONAL_COMPARISONS): Promise<StructureSummaryComparison> {
  const timeZone = await resolveOrganizationTimezone(db, organizationId)
  const codes = await loadReadModelIndicatorCodes(db, organizationId)
  const out: StructureSummaryComparison = { compared: 0, mismatches: [], readModelUsed: 0, fallbacks: 0, liveMembers: 0, rawMs: 0, readModelMs: 0, slowest: [] }
  for (const entry of cases) {
    for (const comparison of comparisons) {
      const input = { organizationId, personIds: entry.memberIds, now, timeZone, comparison }
      let started = performance.now()
      const expected = await buildStructureOperationalSummary(db, input, { source: "raw" })
      const rawMs = performance.now() - started
      started = performance.now()
      const actual = await buildStructureOperationalSummary(db, input, { source: "read-model" })
      const readModelMs = performance.now() - started
      out.rawMs += rawMs
      out.readModelMs += readModelMs
      out.slowest.push({ label: entry.label, comparison, rawMs: Math.round(rawMs), readModelMs: Math.round(readModelMs) })
      const period = operationalComparisonPeriod(comparison)
      const model = await readStructureWindows(db, { organizationId, personIds: entry.memberIds, comparison, window: resolveTimeWindow(period, now, timeZone), previousWindow: resolvePreviousTimeWindow(period, now, timeZone), now, timeZone, indicatorCodes: codes })
      if (model) {
        out.readModelUsed += 1
        out.liveMembers += model.liveMembers
      } else out.fallbacks += 1
      out.compared += 1
      if (!isDeepStrictEqual(expected, actual)) out.mismatches.push({ check: "structure-operational-summary", key: `${entry.label} · ${comparison}`, detail: describeDifference(expected, actual) })
    }
  }
  out.slowest = out.slowest.sort((a, b) => b.rawMs - a.rawMs).slice(0, 5)
  return out
}

/**
 * Camada OFICIAL (Equipe, Indicadores da estrutura, membros de um indicador, "Agrupar por"): repositório com cache × sem
 * cache, o mesmo viewer (o topo), cada estrutura. Com cache, cada visão é pedida duas vezes (cálculo e acerto do cache) e
 * as duas têm de ser iguais à sem cache. Paginação/ordem/busca/filtros variados sobre o MESMO valor guardado.
 */
export async function compareOfficialViews(db: Database, organizationId: string, now: Date, cases: StructureSubjectCase[], options: { clearCache?: boolean } = {}): Promise<{ compared: number; mismatches: EqualityMismatch[]; uncachedMs: number; cachedMs: number }> {
  if (options.clearCache ?? true) clearOfficialAnalyticsCache()
  const viewer = await topViewer(db, organizationId)
  const out = { compared: 0, mismatches: [] as EqualityMismatch[], uncachedMs: 0, cachedMs: 0 }
  if (!viewer) return out
  const reference = new PgAnalyticsReadRepository(db, { officialCache: false })
  const cached = new PgAnalyticsReadRepository(db)
  const [referenceScope, cachedScope] = await Promise.all([loadViewerScope(reference, viewer), loadViewerScope(cached, viewer)])
  const closure = await resolveOfficialClosure(db, organizationId, now)
  const period = closure.lastClosedPeriod
  const memberQueries: TeamMembersQuery[] = [
    { sort: "situation", order: "asc", page: 1, pageSize: 20 },
    { sort: "prv", order: "desc", page: 2, pageSize: 10 },
    { sort: "name", order: "asc", page: 1, pageSize: 50, search: "a" },
    { sort: "achievement", order: "desc", page: 1, pageSize: 20, directOnly: true },
    { sort: "delta", order: "asc", page: 1, pageSize: 20, situation: "BELOW_REFERENCE" },
  ]
  for (const entry of cases) {
    const subject = entry.subject as StructureAnchor
    const views: [string, (repository: PgAnalyticsReadRepository, scope: ViewerScope) => Promise<unknown>][] = [
      ["dashboard", (repository, scope) => buildStructureDashboard(repository, scope, subject, period, now)],
      ["team", (repository, scope) => buildTeamOverview(repository, scope, subject, period)],
      ...memberQueries.map((query, index) => [`team-members#${index}`, (repository: PgAnalyticsReadRepository, scope: ViewerScope) => buildTeamMembersPage(repository, scope, subject, period, query)] as [string, (repository: PgAnalyticsReadRepository, scope: ViewerScope) => Promise<unknown>]),
      ...buildIndicatorViewCapabilities(viewer.role, subject.kind).groupingOptions.map((groupBy) => [`breakdown:${groupBy}`, (repository: PgAnalyticsReadRepository, scope: ViewerScope) => buildStructureBreakdown(repository, scope, subject, period, groupBy)] as [string, (repository: PgAnalyticsReadRepository, scope: ViewerScope) => Promise<unknown>]),
    ]
    const dashboard = (await buildStructureDashboard(reference, referenceScope, subject, period, now)) as { indicators: { code: string }[] }
    for (const indicator of dashboard.indicators.slice(0, 2)) {
      views.push([`indicator-members:${indicator.code}:achievement`, (repository, scope) => buildIndicatorMembers(repository, scope, subject, period, indicator.code, { sort: "achievement", order: "desc", page: 1, pageSize: 20 })])
      views.push([`indicator-members:${indicator.code}:name`, (repository, scope) => buildIndicatorMembers(repository, scope, subject, period, indicator.code, { sort: "name", order: "asc", page: 2, pageSize: 5, search: "e" })])
    }
    for (const [name, build] of views) {
      let started = performance.now()
      const expected = await build(reference, referenceScope).catch(errorOf)
      out.uncachedMs += performance.now() - started
      started = performance.now()
      const first = await build(cached, cachedScope).catch(errorOf)
      const second = await build(cached, cachedScope).catch(errorOf)
      out.cachedMs += performance.now() - started
      out.compared += 1
      if (!isDeepStrictEqual(expected, first) || !isDeepStrictEqual(expected, second)) out.mismatches.push({ check: "official-view", key: `${entry.label} · ${name}`, detail: describeDifference(expected, isDeepStrictEqual(expected, first) ? second : first) })
    }
  }
  return out
}

/** Gasto do mês de IA: resumo diário (`ai_usage_daily`) × soma original sobre `ai_usage_events`, em vários instantes. */
/**
 * `useCases`: compara só esses Use Cases. No banco de teste COMPARTILHADO outras provas gravam e depois apagam eventos brutos
 * da mesma organização; o resumo diário guarda o que já somou (de propósito: é o registro que fica quando a retenção apagar o
 * bruto), então a organização inteira só fecha num banco limpo. A prova confere as linhas que ela mesma gravou.
 */
export async function compareAiMonthSpend(db: Database, organizationId: string, instants: Date[], options: { useCases?: readonly string[] } = {}): Promise<{ compared: number; mismatches: EqualityMismatch[] }> {
  const mismatches: EqualityMismatch[] = []
  const normalize = (rows: { use_case: string; provider_key: string; currency: string | null; amount: string | null; unknown_calls: number }[]) =>
    rows.filter((row) => !options.useCases || options.useCases.includes(row.use_case)).map((row) => `${row.use_case}|${row.provider_key}|${row.currency}|${row.amount}|${row.unknown_calls}`).sort()
  for (const instant of instants) {
    const [expected, actual] = await Promise.all([loadMonthSpendRaw(db, organizationId, instant), loadMonthSpend(db, organizationId, instant)])
    if (!isDeepStrictEqual(normalize(expected), normalize(actual))) mismatches.push({ check: "ai-month-spend", key: instant.toISOString(), detail: describeDifference(normalize(expected), normalize(actual)) })
  }
  return { compared: instants.length, mismatches }
}
