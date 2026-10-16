import type { Database } from "../../../infrastructure/database/pool.js"
import { visibilityOf } from "../../access/application/access-service.js"
import { createPostgresAccessRepository } from "../../access/infrastructure/postgres-access-repository.js"
import type { AuthTokenPayload, PlatformRole } from "../../auth/infrastructure/jwt.js"
import { computeFreshness } from "../../data-hub/domain/freshness.js"
import { loadLeadershipSession, toolDependencies, type LeadershipSession } from "../../leadership-analytics/application/leadership-context.js"
import { executeLeadershipTool, type LeadershipToolResult } from "../../leadership-analytics/application/leadership-toolset.js"
import { resolveIndicatorReference, resolveStructureReference, structureCandidates, type ResolvedStructure } from "../../leadership-analytics/application/references.js"
import { resolveEmploymentStatusFreshness } from "../../people/application/employment-status-freshness.js"
import { loadAnalyticsVersion } from "../../performance-analytics/infrastructure/analytics-versions.js"
import { resolveOrganizationTimezone } from "../../workflows/application/organization-timezone.js"
import type { SourceState } from "../domain/delivery-decision.js"
import { requiredSources, type ReportAudience, type ReportDefinition, type ReportSource } from "../domain/report-definition.js"

/**
 * O que a execução de um report precisa do resto do sistema — sempre em nome de UMA conta (o responsável ou um destinatário),
 * com o escopo calculado pela conta DELA (`loadLeadershipSession` → `loadViewerScope`): ninguém recebe uma visão mais ampla do
 * que o próprio escopo, e distribuir reports não concede acesso a dado.
 */
export type AccountInfo = { accountId: string; personId: string; name: string; role: PlatformRole }

export type RecipientContext = {
  account: AccountInfo
  /** A estrutura que a pessoa lidera hoje (null = não lidera uma estrutura). */
  ownStructure: ResolvedStructure | null
  /** Uma estrutura fixa, se estiver no escopo ATUAL da pessoa (null = fora do escopo ou inexistente — mesma resposta). */
  resolveFixed(subjectKind: string, subjectId: string): ResolvedStructure | null
  runTool(name: string, args: Record<string, unknown>): Promise<LeadershipToolResult>
  /** Fração das pessoas da estrutura com dado no período para o que a definição pede (null = não se aplica). */
  coverage(structure: ResolvedStructure, definition: ReportDefinition, period: string | null): Promise<number | null>
  sources(structure: ResolvedStructure, definition: ReportDefinition): Promise<SourceState[]>
  indicatorDirection(code: string | null): Promise<"HIGHER" | "LOWER" | "TARGET" | null>
  /** Competência fechada mais recente (para o rótulo do período). */
  lastClosedPeriod: string
  /** Estruturas que o escopo ATUAL alcança (escolha de estrutura fixa no formulário). */
  structureOptions(): { subjectKind: string; subjectId: string; label: string; description: string }[]
  /** Catálogo de indicadores (para o formulário e para guardar CÓDIGOS na definição). */
  indicatorOptions(): Promise<{ code: string; name: string; unit: string; direction: string; active: boolean }[]>
}

/** Tipo e id de um sujeito de estrutura (o formato aceito por `resolveStructureReference`). */
export function subjectParts(subject: Record<string, unknown>): { subjectKind: string; subjectId: string } {
  const id = Object.entries(subject).find(([key, value]) => key !== "kind" && typeof value === "string")?.[1] as string
  return { subjectKind: String(subject.kind), subjectId: id }
}

export type DistributionScope = { organizationWide: boolean; teamIds: string[]; subteamIds: string[] }
export type RecipientCandidate = { personId: string; accountId: string; name: string }

export type ReportRuntime = {
  account(organizationId: string, accountId: string): Promise<AccountInfo | null>
  /** Contexto de liderança da conta (null = conta/pessoa inativa ou sem escopo de liderança). */
  contextFor(organizationId: string, accountId: string): Promise<RecipientContext | null>
  /** Onde a conta pode distribuir reports (null = não tem o papel Report em lugar nenhum). */
  distributionScope(organizationId: string, accountId: string): Promise<DistributionScope | null>
  /** Destinatários ATUAIS de um público (membros de nível/cargo/Grupo/Subgrupo agora), elegíveis e dentro do escopo. */
  resolveRecipients(organizationId: string, audience: Extract<ReportAudience, { mode: "DISTRIBUTION" }>, scope: DistributionScope): Promise<RecipientCandidate[]>
  timeZone(organizationId: string): Promise<string>
  /** Catálogo de indicadores da organização (validação de quem distribui sem estrutura própria). */
  indicatorCatalog(organizationId: string): Promise<{ code: string; name: string; active: boolean }[]>
  /** Opções de público dentro do escopo de distribuição (níveis, cargos, Grupos, Subgrupos) e busca de pessoas. */
  audienceOptions(organizationId: string, scope: DistributionScope): Promise<{ jobTitles: string[]; teams: { id: string; name: string }[]; subteams: { id: string; name: string; teamId: string }[] }>
  searchPeople(organizationId: string, scope: DistributionScope, query: string, ids?: string[]): Promise<{ personId: string; name: string; role: string; jobTitle: string | null }[]>
}

export function payloadForAccount(organizationId: string, account: AccountInfo): AuthTokenPayload {
  return { sub: account.accountId, personId: account.personId, organizationId, role: account.role, name: account.name, email: "", avatarUrl: null, jobTitle: null, teamId: null, teamName: null }
}

const SOURCE_LABELS: Record<ReportSource, string> = {
  OFFICIAL_INDICATOR_PERFORMANCE: "Fechamento oficial dos indicadores",
  PRV_PERFORMANCE: "Fechamento oficial do PRV",
  INDICATOR_MEASUREMENTS: "Medição diária dos indicadores",
  EMPLOYMENT_STATUS: "Situação funcional (colaboradores e ausências)",
  INTERACTIONS: "Interações",
}
const CONTRACT_BY_SOURCE: Record<ReportSource, string[]> = {
  OFFICIAL_INDICATOR_PERFORMANCE: ["OFFICIAL_INDICATOR_PERFORMANCE"],
  PRV_PERFORMANCE: ["PRV_PERFORMANCE"],
  INDICATOR_MEASUREMENTS: ["INDICATOR_MEASUREMENTS"],
  EMPLOYMENT_STATUS: ["EMPLOYEES", "EMPLOYEE_ABSENCES"],
  INTERACTIONS: ["INTERACTIONS"],
}

export function createPostgresReportRuntime(db: Database, clock: () => Date = () => new Date()): ReportRuntime {
  const account = async (organizationId: string, accountId: string): Promise<AccountInfo | null> => {
    const result = await db.query<{ id: string; person_id: string; name: string; role: PlatformRole }>(
      `select ua.id, ua.person_id, p.name, p.role from user_accounts ua join people p on p.id = ua.person_id
        where ua.organization_id = $1 and ua.id = $2 and ua.active and p.active`,
      [organizationId, accountId],
    )
    const row = result.rows[0]
    return row ? { accountId: row.id, personId: row.person_id, name: row.name, role: row.role } : null
  }

  const feedState = async (organizationId: string, contracts: string[]) => {
    const result = await db.query<{ last_success_at: Date | null; last_data_at: Date | null; cadence: unknown; expected_interval_minutes: number | null }>(
      `select last_success_at, last_data_at, cadence, expected_interval_minutes from data_feeds where organization_id = $1 and contract_key = any($2) and status <> 'DRAFT'`,
      [organizationId, contracts],
    )
    const lastSuccess = result.rows.map((row) => row.last_success_at).filter((value): value is Date => value !== null).sort((a, b) => b.getTime() - a.getTime())[0] ?? null
    const lastData = result.rows.map((row) => row.last_data_at).filter((value): value is Date => value !== null).sort((a, b) => b.getTime() - a.getTime())[0] ?? null
    const staleFeeds = result.rows.filter((row) => computeFreshness(row.last_success_at, row.expected_interval_minutes, clock()) === "STALE").length
    return { configured: result.rows.length > 0, lastSuccess, lastData, staleFeeds }
  }

  const sourceStates = async (session: LeadershipSession, structure: ResolvedStructure, definition: ReportDefinition): Promise<SourceState[]> => {
    const organizationId = session.scope.organizationId
    const memberIds = structure.resolved.members.map((member) => member.id)
    const states: SourceState[] = []
    for (const source of requiredSources(definition)) {
      const feeds = await feedState(organizationId, CONTRACT_BY_SOURCE[source])
      const feedNote = feeds.configured ? (feeds.lastSuccess ? `Última carga pela Central de Dados: ${feeds.lastSuccess.toISOString()}` : "Feed configurado, sem carga concluída") : "Sem feed na Central de Dados (carga por outra via)"
      if (source === "OFFICIAL_INDICATOR_PERFORMANCE" || source === "PRV_PERFORMANCE") {
        const version = await loadAnalyticsVersion(db, organizationId, "OFFICIAL")
        const changed = await db.query<{ changed_at: Date | null }>(`select changed_at from analytics_versions where organization_id = $1 and domain = 'OFFICIAL'`, [organizationId])
        const changedAt = changed.rows[0]?.changed_at ?? null
        states.push({ source, label: SOURCE_LABELS[source], watermark: `official:${version}`, lastUpdatedAt: (changedAt ?? feeds.lastSuccess)?.toISOString() ?? null, stale: false, detail: feedNote })
      } else if (source === "INDICATOR_MEASUREMENTS") {
        const result = await db.query<{ last: Date | null }>(`select max(period_end) last from indicator_measurements where organization_id = $1 and subject_type = 'PERSON' and subject_id = any($2::uuid[])`, [organizationId, memberIds])
        const last = result.rows[0]?.last ?? null
        states.push({ source, label: SOURCE_LABELS[source], watermark: last ? `measured:${last.toISOString()}` : null, lastUpdatedAt: last?.toISOString() ?? null, stale: false, detail: last ? `Medição até ${last.toISOString().slice(0, 10)}. ${feedNote}` : `Sem medição diária para a estrutura. ${feedNote}` })
      } else if (source === "INTERACTIONS") {
        const result = await db.query<{ last: Date | null }>(`select max(started_at) last from interactions where organization_id = $1 and operator_id = any($2::uuid[])`, [organizationId, memberIds])
        const last = result.rows[0]?.last ?? null
        states.push({ source, label: SOURCE_LABELS[source], watermark: last ? `interaction:${last.toISOString()}` : null, lastUpdatedAt: last?.toISOString() ?? null, stale: false, detail: feedNote })
      } else {
        const freshness = await resolveEmploymentStatusFreshness(db, organizationId, session.closure.now, session.closure.timeZone)
        const stamp = freshness.lastSuccessAt ?? freshness.lastDataAt
        states.push({ source, label: SOURCE_LABELS[source], watermark: stamp ? `status:${new Date(stamp).toISOString()}` : null, lastUpdatedAt: stamp ? new Date(stamp).toISOString() : null, stale: freshness.state === "STALE", detail: freshness.state === "UNKNOWN" ? "Sem feed de situação funcional configurado (situação do cadastro)" : freshness.state === "STALE" ? "Carga de situação funcional atrasada pela cadência configurada" : "Situação funcional em dia" })
      }
    }
    return states
  }

  const coverage = async (session: LeadershipSession, structure: ResolvedStructure, definition: ReportDefinition, period: string | null): Promise<number | null> => {
    if (definition.tool === "WORKFORCE" || definition.period.mode === "CURRENT" || !period) return null
    const members = structure.resolved.members
    if (members.length === 0) return null
    const ids = members.map((member) => member.id)
    const organizationId = session.scope.organizationId
    const definitions = await session.repository.loadIndicatorDefinitions(organizationId)
    const wantsPrv = definition.indicators.some((code) => code.toUpperCase() === "PRV") || definition.view === "CONSOLIDADO" || (definition.view === "QUARTIS" && definition.indicators.length === 0)
    const codes = new Set(definition.indicators.filter((code) => code.toUpperCase() !== "PRV").map((code) => (resolveIndicatorReference(definitions, code).kind === "OK" ? (resolveIndicatorReference(definitions, code) as { value: { code: string } }).value.code : code)))
    const withData = new Set<string>()
    if (codes.size > 0 || definition.indicators.length === 0) {
      for (const row of await session.repository.loadIndicatorPerformance(organizationId, ids, [period])) if (codes.size === 0 || codes.has(row.indicatorCode)) withData.add(row.personId)
    }
    if (wantsPrv) for (const row of await session.repository.loadPrvPerformance(organizationId, ids, [period])) withData.add(row.personId)
    return withData.size / members.length
  }

  return {
    account,
    async contextFor(organizationId, accountId) {
      const info = await account(organizationId, accountId)
      if (!info) return null
      const session = await loadLeadershipSession(db, payloadForAccount(organizationId, info), { now: clock() })
      if (!session) return null
      const deps = toolDependencies(session)
      return {
        account: info,
        ownStructure: session.own,
        resolveFixed: (subjectKind, subjectId) => {
          const outcome = resolveStructureReference(session.scope, { subjectKind, subjectId })
          return outcome.kind === "OK" ? outcome.value : null
        },
        runTool: (name, args) => executeLeadershipTool(deps, name, args),
        coverage: (structure, definition, period) => coverage(session, structure, definition, period),
        sources: (structure, definition) => sourceStates(session, structure, definition),
        indicatorDirection: async (code) => {
          if (!code) return null
          const definition = (await session.repository.loadIndicatorDefinitions(organizationId)).find((item) => item.code === code)
          return (definition?.direction as "HIGHER" | "LOWER" | "TARGET" | undefined) ?? null
        },
        lastClosedPeriod: session.closure.lastClosedPeriod,
        structureOptions: () => structureCandidates(session.scope).map((candidate) => ({ ...subjectParts(candidate.subject as unknown as Record<string, unknown>), label: candidate.label, description: candidate.description })),
        indicatorOptions: async () => (await session.repository.loadIndicatorDefinitions(organizationId)).map((definition) => ({ code: definition.code, name: definition.name, unit: definition.unit, direction: definition.direction, active: (definition as { active?: boolean }).active !== false })),
      }
    },
    async distributionScope(organizationId, accountId) {
      const context = await createPostgresAccessRepository(db).loadContext(organizationId, accountId)
      const visibility = visibilityOf(context, "reports.distribute")
      return visibility.organizationWide || visibility.teamIds.length > 0 || visibility.subteamIds.length > 0 ? visibility : null
    },
    async resolveRecipients(organizationId, audience, scope) {
      const result = await db.query<{ person_id: string; account_id: string; name: string }>(
        `select distinct p.id person_id, ua.id account_id, p.name
           from people p join user_accounts ua on ua.person_id = p.id and ua.organization_id = p.organization_id
          where p.organization_id = $1 and p.active and ua.active
            and ($2::boolean or p.team_id = any($3::uuid[]) or p.subteam_id = any($4::uuid[]))
            and ($5::boolean or p.role = any($6::text[]) or p.job_title = any($7::text[]) or p.team_id = any($8::uuid[]) or p.subteam_id = any($9::uuid[]) or p.id = any($10::uuid[]))
          order by p.name`,
        [organizationId, scope.organizationWide, scope.teamIds, scope.subteamIds, audience.everyone, audience.levels, audience.jobTitles, audience.teamIds, audience.subteamIds, audience.personIds],
      )
      return result.rows.map((row) => ({ personId: row.person_id, accountId: row.account_id, name: row.name }))
    },
    timeZone: (organizationId) => resolveOrganizationTimezone(db, organizationId),
    async indicatorCatalog(organizationId) {
      const result = await db.query<{ code: string; name: string; active: boolean }>(`select code, name, active from indicator_definitions where organization_id = $1 order by name`, [organizationId])
      return result.rows
    },
    async audienceOptions(organizationId, scope) {
      const inScope = `($2::boolean or p.team_id = any($3::uuid[]) or p.subteam_id = any($4::uuid[]))`
      const params = [organizationId, scope.organizationWide, scope.teamIds, scope.subteamIds]
      const [titles, teams, subteams] = await Promise.all([
        db.query<{ job_title: string }>(`select distinct p.job_title from people p join user_accounts ua on ua.person_id = p.id and ua.active where p.organization_id = $1 and p.active and p.job_title is not null and btrim(p.job_title) <> '' and ${inScope} order by 1 limit 200`, params),
        db.query<{ id: string; name: string }>(`select t.id, t.name from teams t where t.organization_id = $1 and ($2::boolean or t.id = any($3::uuid[]) or t.id in (select team_id from subteams where id = any($4::uuid[]))) order by t.name`, params),
        db.query<{ id: string; name: string; team_id: string }>(`select s.id, s.name, s.team_id from subteams s where s.organization_id = $1 and ($2::boolean or s.team_id = any($3::uuid[]) or s.id = any($4::uuid[])) order by s.name`, params),
      ])
      return { jobTitles: titles.rows.map((row) => row.job_title), teams: teams.rows, subteams: subteams.rows.map((row) => ({ id: row.id, name: row.name, teamId: row.team_id })) }
    },
    async searchPeople(organizationId, scope, query, ids) {
      const result = await db.query<{ id: string; name: string; role: string; job_title: string | null }>(
        `select p.id, p.name, p.role, p.job_title from people p join user_accounts ua on ua.person_id = p.id and ua.organization_id = p.organization_id
          where p.organization_id = $1 and p.active and ua.active and ($2::boolean or p.team_id = any($3::uuid[]) or p.subteam_id = any($4::uuid[]))
            and (($6::uuid[] is not null and p.id = any($6::uuid[])) or ($6::uuid[] is null and p.name ilike '%' || $5 || '%'))
          order by p.name limit 20`,
        [organizationId, scope.organizationWide, scope.teamIds, scope.subteamIds, query.replace(/[%_]/g, ""), ids && ids.length > 0 ? ids : null],
      )
      return result.rows.map((row) => ({ personId: row.id, name: row.name, role: row.role, jobTitle: row.job_title }))
    },
  }
}
