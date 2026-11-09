import type { Database } from "../../../infrastructure/database/pool.js"
import { visibilityOf } from "../../access/application/access-service.js"
import { createPostgresAccessRepository } from "../../access/infrastructure/postgres-access-repository.js"
import type { AuthTokenPayload, PlatformRole } from "../../auth/infrastructure/jwt.js"
import { computeFeedFreshness, type Cadence } from "../../data-hub/domain/freshness.js"
import { resolveOfficialClosure, type OfficialClosureContext } from "../../indicators/application/official-closure.js"
import { loadLeadershipSession, toolDependencies, type LeadershipSession } from "../../leadership-analytics/application/leadership-context.js"
import { executeLeadershipTool, type LeadershipToolResult } from "../../leadership-analytics/application/leadership-toolset.js"
import { resolveIndicatorReference, resolveStructureReference, structureCandidates, type ResolvedStructure } from "../../leadership-analytics/application/references.js"
import { resolveEmploymentStatusFreshness, type EmploymentStatusFreshness } from "../../people/application/employment-status-freshness.js"
import { loadAnalyticsVersion } from "../../performance-analytics/infrastructure/analytics-versions.js"
import { resolveOrganizationTimezone } from "../../workflows/application/organization-timezone.js"
import type { SourceState } from "../domain/delivery-decision.js"
import { requiredSources, type ReportAudience, type ReportDefinition, type ReportSource } from "../domain/report-definition.js"
import { peopleBelow } from "../../leadership-analytics/application/workforce.js"
import { ReportRunReads, type CoverageReads } from "./report-run-reads.js"

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
  /** Pessoas ativas abaixo da âncora da estrutura que o escopo DESTA pessoa alcança (líderes inclusive) — o que as ferramentas
   * leem além dos operadores; entra na chave que junta destinatários numa entrega (achado C15 da 4ª auditoria). */
  visibleBelow(structure: ResolvedStructure): string[]
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

/** Conta de um destinatário e o contexto dela (account null = conta/pessoa inativa; context null = inativa ou sem escopo de liderança). */
export type RecipientLookup = { account: AccountInfo | null; context: RecipientContext | null }
export type RecipientContexts = { lookup(accountId: string): Promise<RecipientLookup> }

export type DistributionScope = { organizationWide: boolean; teamIds: string[]; subteamIds: string[] }
export type RecipientCandidate = { personId: string; accountId: string; name: string }

export type ReportRuntime = {
  account(organizationId: string, accountId: string): Promise<AccountInfo | null>
  /** Contexto de liderança da conta (null = conta/pessoa inativa ou sem escopo de liderança). */
  contextFor(organizationId: string, accountId: string): Promise<RecipientContext | null>
  /**
   * Contextos dos destinatários de UMA execução: contas, atribuições de papel, grafo de pessoas e fechamento lidos uma vez para o
   * lote; a sessão de cada conta é montada sob demanda (`lookup`) pelo MESMO `loadLeadershipSession`, sem consulta por pessoa. As
   * contas consultadas precisam estar em `accountIds`.
   */
  contextsFor(organizationId: string, accountIds: readonly string[]): Promise<RecipientContexts>
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

type FeedRow = { contract_key: string; last_success_at: Date | null; last_data_at: Date | null; cadence: Cadence; expected_interval_minutes: number | null }
type OrganizationSourceState = { feeds: FeedRow[]; timeZone: string; official: { version: string; changedAt: Date | null } | null; employment: EmploymentStatusFreshness | null }

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

  const accounts = async (organizationId: string, accountIds: readonly string[]): Promise<Map<string, AccountInfo>> => {
    const result = await db.query<{ id: string; person_id: string; name: string; role: PlatformRole }>(
      `select ua.id, ua.person_id, p.name, p.role from user_accounts ua join people p on p.id = ua.person_id
        where ua.organization_id = $1 and ua.id = any($2::uuid[]) and ua.active and p.active`,
      [organizationId, accountIds],
    )
    return new Map(result.rows.map((row) => [row.id, { accountId: row.id, personId: row.person_id, name: row.name, role: row.role }]))
  }

  const feedState = (rows: FeedRow[], timeZone: string) => {
    const lastSuccess = rows.map((row) => row.last_success_at).filter((value): value is Date => value !== null).sort((a, b) => b.getTime() - a.getTime())[0] ?? null
    const lastData = rows.map((row) => row.last_data_at).filter((value): value is Date => value !== null).sort((a, b) => b.getTime() - a.getTime())[0] ?? null
    const staleFeeds = rows.filter((row) => computeFeedFreshness({ lastSuccessAt: row.last_success_at, cadence: row.cadence, expectedIntervalMinutes: row.expected_interval_minutes }, clock(), timeZone) === "STALE").length
    return { configured: rows.length > 0, lastSuccess, lastData, staleFeeds }
  }

  /** O que não depende da estrutura: os feeds de TODAS as fontes da definição numa consulta, a versão do fechamento oficial e o frescor da situação funcional. */
  const organizationSourceState = async (organizationId: string, sources: readonly ReportSource[], closure: OfficialClosureContext): Promise<OrganizationSourceState> => {
    const contracts = [...new Set(sources.flatMap((source) => CONTRACT_BY_SOURCE[source]))]
    const official = sources.includes("OFFICIAL_INDICATOR_PERFORMANCE") || sources.includes("PRV_PERFORMANCE")
    const [feeds, version, changed, employment] = await Promise.all([
      contracts.length > 0
        ? db.query<FeedRow>(`select contract_key, last_success_at, last_data_at, cadence, expected_interval_minutes from data_feeds where organization_id = $1 and contract_key = any($2) and status <> 'DRAFT'`, [organizationId, contracts])
        : null,
      official ? loadAnalyticsVersion(db, organizationId, "OFFICIAL") : null,
      official ? db.query<{ changed_at: Date | null }>(`select changed_at from analytics_versions where organization_id = $1 and domain = 'OFFICIAL'`, [organizationId]) : null,
      sources.includes("EMPLOYMENT_STATUS") ? resolveEmploymentStatusFreshness(db, organizationId, closure.now, closure.timeZone) : null,
    ])
    return { feeds: feeds?.rows ?? [], timeZone: closure.timeZone, official: version === null ? null : { version, changedAt: changed?.rows[0]?.changed_at ?? null }, employment }
  }

  const sourceStates = async (organizationId: string, structure: ResolvedStructure, definition: ReportDefinition, organization: OrganizationSourceState): Promise<SourceState[]> => {
    const memberIds = structure.resolved.members.map((member) => member.id)
    const states: SourceState[] = []
    for (const source of requiredSources(definition)) {
      const feeds = feedState(organization.feeds.filter((row) => CONTRACT_BY_SOURCE[source].includes(row.contract_key)), organization.timeZone)
      const feedNote = feeds.configured ? (feeds.lastSuccess ? `Última carga pela Central de Dados: ${feeds.lastSuccess.toISOString()}` : "Feed configurado, sem carga concluída") : "Sem feed na Central de Dados (carga por outra via)"
      if (source === "OFFICIAL_INDICATOR_PERFORMANCE" || source === "PRV_PERFORMANCE") {
        const { version, changedAt } = organization.official!
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
        const freshness = organization.employment!
        const stamp = freshness.lastSuccessAt ?? freshness.lastDataAt
        states.push({ source, label: SOURCE_LABELS[source], watermark: stamp ? `status:${new Date(stamp).toISOString()}` : null, lastUpdatedAt: stamp ? new Date(stamp).toISOString() : null, stale: freshness.state === "STALE", detail: freshness.state === "UNKNOWN" ? "Sem feed de situação funcional configurado (situação do cadastro)" : freshness.state === "STALE" ? "Carga de situação funcional atrasada pela cadência configurada" : "Situação funcional em dia" })
      }
    }
    return states
  }

  const coverage = async (reads: CoverageReads, organizationId: string, structure: ResolvedStructure, definition: ReportDefinition, period: string | null): Promise<number | null> => {
    if (definition.tool === "WORKFORCE" || definition.period.mode === "CURRENT" || !period) return null
    const members = structure.resolved.members
    if (members.length === 0) return null
    const ids = members.map((member) => member.id)
    const definitions = await reads.loadIndicatorDefinitions(organizationId)
    const wantsPrv = definition.indicators.some((code) => code.toUpperCase() === "PRV") || definition.view === "CONSOLIDADO" || (definition.view === "QUARTIS" && definition.indicators.length === 0)
    const codes = new Set(definition.indicators.filter((code) => code.toUpperCase() !== "PRV").map((code) => (resolveIndicatorReference(definitions, code).kind === "OK" ? (resolveIndicatorReference(definitions, code) as { value: { code: string } }).value.code : code)))
    const withData = new Set<string>()
    if (codes.size > 0 || definition.indicators.length === 0) {
      for (const row of await reads.loadIndicatorPerformance(organizationId, ids, [period])) if (codes.size === 0 || codes.has(row.indicatorCode)) withData.add(row.personId)
    }
    if (wantsPrv) for (const row of await reads.loadPrvPerformance(organizationId, ids, [period])) withData.add(row.personId)
    return withData.size / members.length
  }

  /** O contexto de uma conta sobre a sessão dela — o mesmo nas duas formas de carregar (uma conta ou o lote de uma execução). */
  const contextOf = (organizationId: string, info: AccountInfo, session: LeadershipSession, reads: CoverageReads, organizationSources: (definition: ReportDefinition) => Promise<OrganizationSourceState>): RecipientContext => {
    const deps = toolDependencies(session)
    return {
      account: info,
      ownStructure: session.own,
      resolveFixed: (subjectKind, subjectId) => {
        const outcome = resolveStructureReference(session.scope, { subjectKind, subjectId })
        return outcome.kind === "OK" ? outcome.value : null
      },
      runTool: (name, args) => executeLeadershipTool(deps, name, args),
      coverage: (structure, definition, period) => coverage(reads, organizationId, structure, definition, period),
      sources: async (structure, definition) => sourceStates(organizationId, structure, definition, await organizationSources(definition)),
      visibleBelow: (structure) => peopleBelow(session.scope, structure).map((person) => person.id),
      indicatorDirection: async (code) => {
        if (!code) return null
        const definition = (await reads.loadIndicatorDefinitions(organizationId)).find((item) => item.code === code)
        return (definition?.direction as "HIGHER" | "LOWER" | "TARGET" | undefined) ?? null
      },
      lastClosedPeriod: session.closure.lastClosedPeriod,
      structureOptions: () => structureCandidates(session.scope).map((candidate) => ({ ...subjectParts(candidate.subject as unknown as Record<string, unknown>), label: candidate.label, description: candidate.description })),
      indicatorOptions: async () => (await session.repository.loadIndicatorDefinitions(organizationId)).map((definition) => ({ code: definition.code, name: definition.name, unit: definition.unit, direction: definition.direction, active: (definition as { active?: boolean }).active !== false })),
    }
  }

  return {
    account,
    async contextFor(organizationId, accountId) {
      const info = await account(organizationId, accountId)
      if (!info) return null
      const session = await loadLeadershipSession(db, payloadForAccount(organizationId, info), { now: clock() })
      if (!session) return null
      return contextOf(organizationId, info, session, session.repository, (definition) => organizationSourceState(organizationId, requiredSources(definition), session.closure))
    },
    async contextsFor(organizationId, accountIds) {
      const ids = [...new Set(accountIds)]
      const batch = new Set(ids)
      if (ids.length === 0) return { lookup: async () => ({ account: null, context: null }) }
      const [infos, reads, closure] = await Promise.all([accounts(organizationId, ids), ReportRunReads.forAccounts(db, organizationId, ids), resolveOfficialClosure(db, organizationId, clock())])
      const coverageReads = reads.coverageReads()
      // Estado das fontes da organização: um por execução (a definição é a mesma para todos os grupos).
      const organizationStates = new Map<string, Promise<OrganizationSourceState>>()
      const organizationSources = (definition: ReportDefinition) => {
        const sources = requiredSources(definition)
        const key = sources.join(",")
        let state = organizationStates.get(key)
        if (!state) {
          state = organizationSourceState(organizationId, sources, closure)
          organizationStates.set(key, state)
          state.catch(() => organizationStates.delete(key))
        }
        return state
      }
      return {
        async lookup(accountId) {
          if (!batch.has(accountId)) throw new Error(`Conta fora do lote de destinatários: ${accountId}`)
          const info = infos.get(accountId) ?? null
          if (!info) return { account: null, context: null }
          const session = await loadLeadershipSession(db, payloadForAccount(organizationId, info), { repository: reads, closure })
          return { account: info, context: session ? contextOf(organizationId, info, session, coverageReads, organizationSources) : null }
        },
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
