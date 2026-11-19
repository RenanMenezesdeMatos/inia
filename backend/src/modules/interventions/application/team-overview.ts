import type { Database } from "../../../infrastructure/database/pool.js"
import { scopesWithPermission, type AccessContext } from "../../access/domain/access-decision.js"
import type { Permission } from "../../access/domain/permissions.js"
import { isUniverseEnforced, personRuleFor, personUniverse, type PersonUniverseRule } from "../../operating-universe/application/universe-access.js"
import { resolveOrganizationTimezone } from "../../workflows/application/organization-timezone.js"
import { localDateOf } from "../../workflows/application/time-window.js"
import { EFFECTIVENESS_VALUES, INTERVENTION_STATUS_LABELS, OUTCOME_REASON_LABELS, OUTCOME_REASONS, type Effectiveness, type InterventionStatus, type OutcomeReason } from "../domain/intervention-state.js"

/**
 * VISÃO DA EQUIPE — para quem lidera (e para a gestão acima): os acompanhamentos em andamento da estrutura, com o próximo passo
 * e o atraso, e o RESUMÃO do que foi concluído — por formato e indicador: quantos, "deu resultado?" segundo quem conduziu, a
 * medição da INIA e os motivos mais citados.
 *
 * O alcance é o MESMO de abrir uma intervenção (`canViewIntervention`), decidido aqui no servidor: quem é parte dela
 * (responsável, aprovador, destinatário da decisão), quem lidera o colaborador na cadeia de gestão, ou quem tem permissão de
 * intervenções num escopo que alcança o colaborador. Nunca a própria pessoa. O resumão não inclui a avaliação de continuidade
 * (processo restrito, que não tem "deu resultado").
 */
const INTERVENTION_PERMISSIONS: Permission[] = ["interventions.view", "interventions.execute", "interventions.approve", "interventions.sensitive_decide"]
export const TEAM_RESULTS_WINDOW_DAYS = 180
export const MAX_ACTIVE = 200

type Scope = { organizationWide: boolean; teamIds: string[]; subteamIds: string[] }

function permissionScope(access: AccessContext): Scope {
  const scopes = INTERVENTION_PERMISSIONS.flatMap((permission) => scopesWithPermission(access, permission))
  return {
    organizationWide: scopes.some((scope) => scope.type === "ORGANIZATION"),
    teamIds: [...new Set(scopes.flatMap((scope) => (scope.type === "GROUP" ? [scope.teamId] : [])))],
    subteamIds: [...new Set(scopes.flatMap((scope) => (scope.type === "SUBGROUP" ? [scope.subteamId] : [])))],
  }
}

/**
 * Parâmetros fixos: $1 organização, $2 quem vê, $3 organização inteira?, $4 grupos, $5 subgrupos; $6 é a data de cada consulta;
 * $7–$10 = universo de atuação (ver `universeParams`). `i` = interventions, `p` = o colaborador.
 *
 * UNIVERSO DE ATUAÇÃO (decisão de 19/11/2026, POL-03): vale para intervenções a mesma regra de PESSOAS da aba Equipe
 * (`personAllowedByUniverse`) — o universo limita o que vem dos PAPÉIS (permissão na organização, no Grupo ou no Subgrupo), nunca
 * a própria estrutura nem quem é parte da intervenção. Organização sem universos ativados e `operating_universes.all` na
 * organização inteira: $7 verdadeiro, nada muda.
 */
const STRUCTURE_CTE = `structure as (
    with recursive down as (
      select x.id, 1 depth from people x where x.reports_to_id = $2 and x.organization_id = $1
      union all
      select x.id, d.depth + 1 from people x join down d on x.reports_to_id = d.id where d.depth < 12)
    select id from down)`
const IN_SCOPE = `i.organization_id = $1 and i.person_id <> $2
  and ((($3::boolean or p.team_id = any($4::uuid[]) or p.subteam_id = any($5::uuid[]))
        and ($7::boolean or p.operating_universe = $8::text or p.team_id = any($9::uuid[]) or p.subteam_id = any($10::uuid[])))
       or i.person_id in (select id from structure)
       or i.responsible_id = $2 or i.approver_id = $2 or $2 = any(i.approval_recipient_ids))`

/** $7 sem filtro de universo?, $8 universo de quem vê, $9/$10 Grupos e Subgrupos onde a conta tem `operating_universes.all`. */
export function universeParams(rule: PersonUniverseRule): [boolean, string | null, string[], string[]] {
  return [!rule.enforced || rule.cross.organizationWide, rule.own, [...rule.cross.teamIds], [...rule.cross.subteamIds]]
}

export type TeamIntervention = {
  id: string
  caseId: string
  person: { id: string; name: string; teamName: string | null }
  typeName: string
  sensitive: boolean
  indicatorName: string | null
  status: InterventionStatus
  statusLabel: string
  dueAt: string
  overdue: boolean
  responsible: { id: string; name: string }
  createdAt: string
  progress: { done: number; total: number }
  /** O primeiro passo ainda pendente (pela ordem do plano). */
  nextStep: { title: string; dueAt: string | null; overdue: boolean; ownerName: string | null } | null
}

export type FormatResult = {
  typeKey: string
  typeName: string
  indicatorName: string | null
  completed: number
  /** "Deu resultado?" segundo quem conduziu. `unanswered` = concluídas antes da pergunta existir ou formato que não pergunta. */
  worked: Record<Lowercase<Effectiveness>, number> & { unanswered: number }
  /** A medição da INIA desde o início (antes × depois). `notComparable` = sem medição suficiente ou sem indicador. */
  measured: { improved: number; unchanged: number; worsened: number; notComparable: number }
  reasons: { reason: OutcomeReason; label: string; worked: Effectiveness; count: number }[]
}

/** `activeTotal` = contagem REAL dos acompanhamentos em andamento no alcance; `active` traz no máximo `MAX_ACTIVE` (ARQ-13). */
export type TeamOverview = { active: TeamIntervention[]; activeTotal: number; activeTruncated: boolean; results: FormatResult[]; windowDays: number }

export async function loadTeamOverview(db: Database, viewer: { organizationId: string; personId: string; access: AccessContext }, now: Date = new Date()): Promise<TeamOverview> {
  const scope = permissionScope(viewer.access)
  const params = [viewer.organizationId, viewer.personId, scope.organizationWide, scope.teamIds, scope.subteamIds]
  const today = localDateOf(now, await resolveOrganizationTimezone(db, viewer.organizationId))
  const [enforced, own] = await Promise.all([isUniverseEnforced(db, viewer.organizationId), personUniverse(db, viewer.organizationId, viewer.personId)])
  const universe = universeParams(personRuleFor(viewer.access, enforced, own))

  const active = await db.query<{ id: string; case_id: string; person_id: string; person_name: string; team_name: string | null; type_name: string; sensitive: boolean; indicator_name: string | null; status: InterventionStatus; due_at: string; responsible_id: string; responsible_name: string; created_at: Date; done: number; total: number; next_title: string | null; next_due: string | null; next_owner: string | null; active_total: number }>(
    `with ${STRUCTURE_CTE}
     select i.id, i.case_id, i.person_id, p.name person_name, t.name team_name, coalesce(v.definition->>'name', i.type_key) type_name, i.sensitive,
            coalesce(d.name, i.indicator_code) indicator_name, i.status, i.due_at::text, i.responsible_id, r.name responsible_name, i.created_at,
            (select count(*) filter (where it.status <> 'PENDING')::int from intervention_items it where it.intervention_id = i.id) done,
            (select count(*)::int from intervention_items it where it.intervention_id = i.id) total,
            nx.title next_title, nx.due_at::text next_due, nx.owner_name next_owner,
            -- Total do alcance ANTES do corte: a tela diz quantos existem, não quantos vieram.
            count(*) over ()::int active_total
       from interventions i
       join people p on p.id = i.person_id
       left join teams t on t.id = p.team_id
       join people r on r.id = i.responsible_id
       left join intervention_type_versions v on v.id = i.type_version_id
       left join indicator_definitions d on d.organization_id = i.organization_id and d.code = i.indicator_code
       left join lateral (
         select it.title, it.due_at, o.name owner_name from intervention_items it left join people o on o.id = it.owner_id
          where it.intervention_id = i.id and it.status = 'PENDING' order by it.position limit 1) nx on true
      where ${IN_SCOPE} and i.status in ('PROPOSED', 'AWAITING_APPROVAL', 'IN_PROGRESS')
      order by (i.due_at < $6::date) desc, i.due_at, i.created_at
      limit ${MAX_ACTIVE}`,
    [...params, today, ...universe],
  )

  const since = new Date(now.getTime() - TEAM_RESULTS_WINDOW_DAYS * 86_400_000)
  const [totals, reasons] = await Promise.all([
    db.query<{ type_key: string; type_name: string; indicator_code: string | null; indicator_name: string | null; completed: number; yes: number; partial: number; no: number; improved: number; unchanged: number; worsened: number }>(
      `with ${STRUCTURE_CTE}
       select i.type_key, max(coalesce(v.definition->>'name', i.type_key)) type_name, i.indicator_code, max(coalesce(d.name, i.indicator_code)) indicator_name, count(*)::int completed,
              count(*) filter (where i.outcome->>'worked' = 'YES')::int yes, count(*) filter (where i.outcome->>'worked' = 'PARTIAL')::int partial, count(*) filter (where i.outcome->>'worked' = 'NO')::int no,
              count(*) filter (where i.outcome#>>'{measured,status}' = 'IMPROVED')::int improved, count(*) filter (where i.outcome#>>'{measured,status}' = 'UNCHANGED')::int unchanged,
              count(*) filter (where i.outcome#>>'{measured,status}' = 'WORSENED')::int worsened
         from interventions i
         join people p on p.id = i.person_id
         left join intervention_type_versions v on v.id = i.type_version_id
         left join indicator_definitions d on d.organization_id = i.organization_id and d.code = i.indicator_code
        where ${IN_SCOPE} and i.status = 'COMPLETED' and not i.sensitive and i.completed_at >= $6
        group by i.type_key, i.indicator_code
        order by completed desc, type_name`,
      [...params, since, ...universe],
    ),
    db.query<{ type_key: string; indicator_code: string | null; worked: string; reason: string; count: number }>(
      `with ${STRUCTURE_CTE}
       -- "cited(code)": interventions tem uma coluna reason (o motivo da abertura); o motivo do RESULTADO nunca pode se confundir com ela.
       select i.type_key, i.indicator_code, i.outcome->>'worked' worked, cited.code reason, count(*)::int count
         from interventions i
         join people p on p.id = i.person_id
         cross join lateral jsonb_array_elements_text(case when jsonb_typeof(i.outcome->'reasons') = 'array' then i.outcome->'reasons' else '[]'::jsonb end) cited(code)
        where ${IN_SCOPE} and i.status = 'COMPLETED' and not i.sensitive and i.completed_at >= $6 and i.outcome->>'worked' is not null
        group by i.type_key, i.indicator_code, i.outcome->>'worked', cited.code
        order by count desc, cited.code`,
      [...params, since, ...universe],
    ),
  ])

  const activeTotal = Math.max(active.rows[0]?.active_total ?? 0, active.rows.length)
  const isReason = (value: string): value is OutcomeReason => (OUTCOME_REASONS as readonly string[]).includes(value)
  const isWorked = (value: string): value is Effectiveness => (EFFECTIVENESS_VALUES as readonly string[]).includes(value)
  return {
    windowDays: TEAM_RESULTS_WINDOW_DAYS,
    activeTotal,
    activeTruncated: activeTotal > active.rows.length,
    active: active.rows.map((row) => ({
      id: row.id,
      caseId: row.case_id,
      person: { id: row.person_id, name: row.person_name, teamName: row.team_name },
      typeName: row.sensitive ? "Avaliação de continuidade" : row.type_name,
      sensitive: row.sensitive,
      indicatorName: row.indicator_name,
      status: row.status,
      statusLabel: row.sensitive && row.status === "AWAITING_APPROVAL" ? "Aguardando decisão humana" : INTERVENTION_STATUS_LABELS[row.status],
      dueAt: row.due_at,
      overdue: row.due_at < today,
      responsible: { id: row.responsible_id, name: row.responsible_name },
      createdAt: row.created_at.toISOString(),
      progress: { done: row.done, total: row.total },
      nextStep: row.next_title ? { title: row.next_title, dueAt: row.next_due, overdue: row.next_due !== null && row.next_due < today, ownerName: row.next_owner } : null,
    })),
    results: totals.rows.map((row) => ({
      typeKey: row.type_key,
      typeName: row.type_name,
      indicatorName: row.indicator_name,
      completed: row.completed,
      worked: { yes: row.yes, partial: row.partial, no: row.no, unanswered: row.completed - row.yes - row.partial - row.no },
      measured: { improved: row.improved, unchanged: row.unchanged, worsened: row.worsened, notComparable: row.completed - row.improved - row.unchanged - row.worsened },
      reasons: reasons.rows
        .filter((reason) => reason.type_key === row.type_key && reason.indicator_code === row.indicator_code)
        .flatMap((reason) => (isReason(reason.reason) && isWorked(reason.worked) ? [{ reason: reason.reason, label: OUTCOME_REASON_LABELS[reason.reason], worked: reason.worked, count: reason.count }] : [])),
    })),
  }
}
