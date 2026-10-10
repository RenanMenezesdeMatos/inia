import type { Database } from "../../../infrastructure/database/pool.js"
import { coveringStatusPeriodSql } from "../../people/application/employment-status-service.js"
import { resolveEmploymentStatusFreshness } from "../../people/application/employment-status-freshness.js"
import { toCanonicalEmploymentStatus } from "../../people/domain/employment-status.js"
import { localDateOf } from "../../workflows/application/time-window.js"
import { resolveOrganizationTimezone } from "../../workflows/application/organization-timezone.js"
import { computeManagementMetrics, type GroupBenchmark, type ManagementMetrics, type StructureMemberRow } from "../domain/management-metrics.js"

export type ManagementMetricsRoot = { id: string; role: string; teamId: string | null }

/** Métricas gerenciais de N líderes em LOTE — assinatura do port injetado no builder da estrutura. */
export type ManagementMetricsLoader = (organizationId: string, roots: ManagementMetricsRoot[], now: Date) => Promise<Map<string, ManagementMetrics>>

type MemberRow = { root_id: string; id: string; role: string; reports_to_id: string | null; status: string | null; confirmed: boolean }
type BenchmarkRow = { role: string; team_id: string; group_name: string; peer_count: string; average: string }

/**
 * Carrega as métricas gerenciais de vários líderes com um número FIXO de consultas (4), qualquer
 * que seja a quantidade de líderes visíveis ou o tamanho das estruturas — nunca uma por node:
 *  1. fuso da organização → data local de hoje;
 *  2. freshness dos feeds de situação funcional (EMPLOYEES / EMPLOYEE_ABSENCES);
 *  3. UMA CTE recursiva multi-raiz (`union` = anticiclo) com a população ativa abaixo de cada
 *     raiz, filtrada pela organização — a travessia passa por cadastros inativos e conta só os
 *     ativos, exatamente como `loadDescendants`/`operatorsBelow` —, já com a situação vigente
 *     HOJE resolvida pelo MESMO fragmento SQL da projeção diária (período cobrindo a data, senão
 *     presumido);
 *  4. referência do Grupo: pares de mesmo cargo e mesmo Grupo na organização, com a média do span.
 * As definições (span, abrangência, camadas, buckets, privacidade) ficam na função pura do domínio.
 */
export async function loadManagementMetrics(db: Database, organizationId: string, roots: ManagementMetricsRoot[], now: Date): Promise<Map<string, ManagementMetrics>> {
  if (roots.length === 0) return new Map()
  const timeZone = await resolveOrganizationTimezone(db, organizationId)
  const today = localDateOf(now, timeZone)
  const freshness = await resolveEmploymentStatusFreshness(db, organizationId, now, timeZone)

  const rootIds = roots.map((root) => root.id)
  const members = await db.query<MemberRow>(
    `with recursive subtree as (
       select r.root_id, p.id
         from unnest($2::uuid[]) r(root_id)
         join people p on p.reports_to_id = r.root_id and p.organization_id = $1
       union
       select s.root_id, p.id
         from subtree s join people p on p.reports_to_id = s.id and p.organization_id = $1
     )
     select s.root_id, p.id, p.role, p.reports_to_id, covering.status, (covering.status is not null) confirmed
       from subtree s
       join people p on p.id = s.id
       left join lateral (select ${coveringStatusPeriodSql("p", "$3")} status) covering on true
      where p.active`,
    [organizationId, rootIds, today],
  )

  const benchmarkRoots = roots.filter((root) => root.teamId !== null)
  const benchmarks = new Map<string, GroupBenchmark>()
  if (benchmarkRoots.length > 0) {
    const result = await db.query<BenchmarkRow>(
      `select p.role, p.team_id, t.name group_name, count(*)::text peer_count, coalesce(avg(d.direct), 0)::text average
         from people p
         join teams t on t.id = p.team_id
         left join lateral (select count(*)::int direct from people c where c.organization_id = $1 and c.active and c.reports_to_id = p.id) d on true
        where p.organization_id = $1 and p.active
          and (p.role, p.team_id) in (select role, team_id from people where id = any($2::uuid[]) and team_id is not null)
        group by p.role, p.team_id, t.name`,
      [organizationId, benchmarkRoots.map((root) => root.id)],
    )
    for (const row of result.rows) {
      benchmarks.set(`${row.role}|${row.team_id}`, { groupId: row.team_id, groupName: row.group_name, peerRole: row.role, peerCount: Number(row.peer_count), averageDirectSpan: Math.round(Number(row.average) * 10) / 10 })
    }
  }

  const byRoot = new Map<string, StructureMemberRow[]>()
  for (const row of members.rows) {
    const list = byRoot.get(row.root_id) ?? []
    list.push({ id: row.id, role: row.role, reportsToId: row.reports_to_id, status: row.status === null ? "EM_PRODUCAO" : toCanonicalEmploymentStatus(row.status), confirmed: row.confirmed })
    byRoot.set(row.root_id, list)
  }

  const statusFreshness = { state: freshness.state, lastSuccessLocalDate: freshness.lastSuccessLocalDate }
  return new Map(
    roots.map((root) => [
      root.id,
      computeManagementMetrics({ root: { id: root.id, role: root.role }, members: byRoot.get(root.id) ?? [], statusFreshness, today, groupBenchmark: root.teamId ? (benchmarks.get(`${root.role}|${root.teamId}`) ?? null) : null }),
    ]),
  )
}
