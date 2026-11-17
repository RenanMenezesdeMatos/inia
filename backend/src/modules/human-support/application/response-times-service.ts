import { DomainError } from "../../../shared/domain/domain-error.js"
import type { TransactionSource } from "../../../shared/infrastructure/database/transaction.js"
import { ANJO_UNRESPONSIVE_LIMITS, type AnjoUnresponsive, type ResponseTimes } from "../domain/catalogs.js"
import { planGroupResponseTimes } from "../domain/group-response-times.js"
import { responseTimesProblem } from "../domain/request-lifecycle.js"
import { recordHumanSupportAudit } from "./audit.js"
import { coordinatorScopesOf, type CoordinatorScopes } from "./coverage.js"
import { dispatchAfterCommand } from "./dispatch.js"
import { loadSettings } from "./eligibility.js"
import { withOrganizationLock, type Queryable } from "./locks.js"
import type { Viewer } from "./request-service.js"

/**
 * TEMPOS DE RESPOSTA (migrations 193 e 194; pedidos do responsável em 2026-11-16). Três tempos decidem o que acontece quando um lado
 * fica sem responder (regra em `domain/request-lifecycle.ts` → `silentSide`; execução na distribuição):
 *  - PADRÃO DA ORGANIZAÇÃO (`human_support_settings`): vale para todo Grupo sem tempos próprios. Só quem acompanha a organização
 *    inteira (Administrador geral ou Coordenador de Anjos com escopo de organização) muda.
 *  - DE UM GRUPO (`human_support_group_response_times`): o Coordenador de Anjos muda os do PRÓPRIO Grupo (escopo de Grupo); quem
 *    acompanha a organização muda os de qualquer Grupo. Coordenador só de Subgrupo vê os tempos do Grupo dele, sem mudar. Subgrupo
 *    segue o Grupo. "Usar o padrão" marca a linha do Grupo `custom = false` (migration 203) — nunca a apaga, para a versão só crescer.
 * O pedido usa o Grupo congelado nele. Versão otimista (a do padrão é a da configuração; a do Grupo, a da linha — 0 = sem tempos
 * próprios; regra em `domain/group-response-times.ts`), histórico em `human_support_setting_events` e auditoria. A distribuição seguinte já usa os tempos novos.
 */
export type ResponseTimesGroup = { teamId: string; teamName: string; custom: boolean; times: ResponseTimes; version: number; canEdit: boolean }
export type ResponseTimesPanel = { organization: { times: ResponseTimes; anjoUnresponsive: AnjoUnresponsive; version: number; canEdit: boolean }; groups: ResponseTimesGroup[] }

type GroupRow = { team_id: string; operator_requeue_minutes: number; operator_close_minutes: number; anjo_requeue_minutes: number; version: number; custom: boolean }
const timesOf = (row: Pick<GroupRow, "operator_requeue_minutes" | "operator_close_minutes" | "anjo_requeue_minutes">): ResponseTimes => ({ operatorRequeueMinutes: Number(row.operator_requeue_minutes), operatorCloseMinutes: Number(row.operator_close_minutes), anjoRequeueMinutes: Number(row.anjo_requeue_minutes) })

/** Grupos que quem lê vê e os que pode mudar. */
async function reachableGroups(db: Queryable, organizationId: string, coverage: CoordinatorScopes): Promise<{ id: string; name: string; canEdit: boolean }[]> {
  const teams = (await db.query<{ id: string; name: string; subteam_ids: string[] }>(`select t.id, t.name, coalesce(array_agg(st.id) filter (where st.id is not null), '{}') subteam_ids from teams t left join subteams st on st.team_id = t.id where t.organization_id = $1 group by t.id, t.name order by t.name`, [organizationId])).rows
  return teams.flatMap((team) => {
    const canEdit = coverage.organizationWide || coverage.teamIds.includes(team.id)
    const sees = canEdit || team.subteam_ids.some((id) => coverage.subteamIds.includes(id))
    return sees ? [{ id: team.id, name: team.name, canEdit }] : []
  })
}

export async function getResponseTimesPanel(db: Queryable, viewer: Viewer): Promise<ResponseTimesPanel> {
  const coverage = await coordinatorScopesOf(db, viewer.organizationId, viewer.personId)
  const [settings, groups, rows] = await Promise.all([
    loadSettings(db, viewer.organizationId),
    reachableGroups(db, viewer.organizationId, coverage),
    db.query<GroupRow>(`select * from human_support_group_response_times where organization_id = $1`, [viewer.organizationId]),
  ])
  const own = new Map(rows.rows.map((row) => [row.team_id, row]))
  return {
    organization: { times: settings.responseTimes, anjoUnresponsive: settings.anjoUnresponsive, version: settings.version, canEdit: coverage.organizationWide },
    groups: groups.map((group) => {
      const row = own.get(group.id)
      const custom = row?.custom === true
      return { teamId: group.id, teamName: group.name, custom, times: custom ? timesOf(row!) : settings.responseTimes, version: row ? Number(row.version) : 0, canEdit: group.canEdit }
    }),
  }
}

const RESPONSE_FIELDS = [
  ["operatorRequeueMinutes", "OPERATOR_REQUEUE_MINUTES"],
  ["operatorCloseMinutes", "OPERATOR_CLOSE_MINUTES"],
  ["anjoRequeueMinutes", "ANJO_REQUEUE_MINUTES"],
] as const

const changesOf = (from: ResponseTimes, to: ResponseTimes) => RESPONSE_FIELDS.filter(([key]) => from[key] !== to[key]).map(([key, field]) => ({ field, from: String(from[key]), to: String(to[key]) }))
const conflict = (current: unknown) => new DomainError("Os tempos mudaram enquanto você editava. Recarregue e tente de novo.", "HUMAN_SUPPORT_CONCURRENT_CHANGE", 409, { current })
function assertValid(times: ResponseTimes) {
  const problem = responseTimesProblem(times)
  if (problem) throw new DomainError(problem, "VALIDATION_ERROR", 400)
}

async function recordChanges(client: Queryable, viewer: Viewer, target: { teamId: string | null }, changes: { field: string; from: string | null; to: string | null }[], payload: Record<string, unknown>) {
  for (const change of changes) {
    await client.query(
      `insert into human_support_setting_events (organization_id, target_type, team_id, field, from_value, to_value, actor_person_id, occurred_at) values ($1, $2, $3, $4, $5, $6, $7, statement_timestamp())`,
      [viewer.organizationId, target.teamId ? "GROUP" : "ORGANIZATION", target.teamId, change.field, change.from, change.to, viewer.personId],
    )
  }
  await recordHumanSupportAudit(client, { organizationId: viewer.organizationId, actorPersonId: viewer.personId, action: "HUMAN_SUPPORT_RESPONSE_TIMES_CHANGED", entityType: target.teamId ? "team" : "organization", entityId: target.teamId ?? viewer.organizationId, payload: { ...payload, changes } })
}

const UNRESPONSIVE_FIELDS = [
  ["pauseAfterMinutes", "anjo_unresponsive_minutes", "ANJO_UNRESPONSIVE_MINUTES"],
  ["offlineAfterMinutes", "disconnection_pause_minutes", "DISCONNECTION_PAUSE_MINUTES"],
] as const

/** Padrão da organização e o "Anjo sem responder ninguém" (195) — só quem acompanha a organização inteira. */
export async function updateOrganizationResponseTimes(db: TransactionSource & Queryable, viewer: Viewer, input: ResponseTimes & { anjoUnresponsive: AnjoUnresponsive; version: number }): Promise<ResponseTimesPanel> {
  assertValid(input)
  const { pauseAfterMinutes, offlineAfterMinutes } = input.anjoUnresponsive
  if (![pauseAfterMinutes, offlineAfterMinutes].every(Number.isInteger) || pauseAfterMinutes < 1 || pauseAfterMinutes > ANJO_UNRESPONSIVE_LIMITS.pauseAfterMax || offlineAfterMinutes < 1 || offlineAfterMinutes > ANJO_UNRESPONSIVE_LIMITS.offlineAfterMax)
    throw new DomainError("A pausa por falta de resposta vai de 1 a 240 minutos e o tempo nela, de 1 a 120.", "VALIDATION_ERROR", 400)
  const coverage = await coordinatorScopesOf(db, viewer.organizationId, viewer.personId)
  if (!coverage.organizationWide) throw new DomainError("Só quem acompanha a organização inteira muda o padrão. Ajuste os tempos do seu Grupo.", "HUMAN_SUPPORT_RESPONSE_TIMES_ORGANIZATION_ONLY", 403)
  await withOrganizationLock(db, viewer.organizationId, async (client) => {
    await client.query(`insert into human_support_settings (organization_id) values ($1) on conflict (organization_id) do nothing`, [viewer.organizationId])
    const current = (await client.query<GroupRow & { anjo_unresponsive_minutes: number; disconnection_pause_minutes: number }>(`select operator_requeue_minutes, operator_close_minutes, anjo_requeue_minutes, anjo_unresponsive_minutes, disconnection_pause_minutes, version from human_support_settings where organization_id = $1 for update`, [viewer.organizationId])).rows[0]!
    if (Number(current.version) !== input.version) throw conflict({ times: timesOf(current), version: Number(current.version) })
    const currentUnresponsive: AnjoUnresponsive = { pauseAfterMinutes: Number(current.anjo_unresponsive_minutes), offlineAfterMinutes: Number(current.disconnection_pause_minutes) }
    const changes = [
      ...changesOf(timesOf(current), input),
      ...UNRESPONSIVE_FIELDS.filter(([key]) => currentUnresponsive[key] !== input.anjoUnresponsive[key]).map(([key, , field]) => ({ field, from: String(currentUnresponsive[key]), to: String(input.anjoUnresponsive[key]) })),
    ]
    if (changes.length === 0) return
    await client.query(
      `update human_support_settings set operator_requeue_minutes = $2, operator_close_minutes = $3, anjo_requeue_minutes = $4, anjo_unresponsive_minutes = $6, disconnection_pause_minutes = $7, version = version + 1, updated_by_person_id = $5, updated_at = statement_timestamp() where organization_id = $1`,
      [viewer.organizationId, input.operatorRequeueMinutes, input.operatorCloseMinutes, input.anjoRequeueMinutes, viewer.personId, pauseAfterMinutes, offlineAfterMinutes],
    )
    await recordChanges(client, viewer, { teamId: null }, changes, {})
  })
  await dispatchAfterCommand(db, viewer.organizationId)
  return getResponseTimesPanel(db, viewer)
}

/** Tempos de um Grupo (`times = null` = voltar ao padrão da organização) — Coordenador do próprio Grupo ou quem acompanha a organização. */
export async function updateGroupResponseTimes(db: TransactionSource & Queryable, viewer: Viewer, teamId: string, input: { times: ResponseTimes | null; version: number }): Promise<ResponseTimesPanel> {
  if (input.times) assertValid(input.times)
  const coverage = await coordinatorScopesOf(db, viewer.organizationId, viewer.personId)
  const group = (await reachableGroups(db, viewer.organizationId, coverage)).find((item) => item.id === teamId)
  if (!group) throw new DomainError("Grupo não encontrado.", "HUMAN_SUPPORT_SCOPE_NOT_FOUND", 404)
  if (!group.canEdit) throw new DomainError("Só o Coordenador de Anjos do Grupo ou quem acompanha a organização muda estes tempos.", "HUMAN_SUPPORT_RESPONSE_TIMES_GROUP_ONLY", 403)
  await withOrganizationLock(db, viewer.organizationId, async (client) => {
    const current = (await client.query<GroupRow>(`select * from human_support_group_response_times where organization_id = $1 and team_id = $2 for update`, [viewer.organizationId, teamId])).rows[0]
    const orgTimes = (await loadSettings(client, viewer.organizationId)).responseTimes
    const plan = planGroupResponseTimes(current ? { custom: current.custom, version: Number(current.version), times: timesOf(current) } : null, input, orgTimes)
    if (plan.kind === "CONFLICT") throw conflict(plan.current)
    if (plan.kind === "NONE") return
    if (plan.kind === "USE_DEFAULT") {
      // A linha fica (versão monotônica): só deixa de valer.
      await client.query(`update human_support_group_response_times set custom = false, version = $3, updated_by_person_id = $4, updated_at = statement_timestamp() where organization_id = $1 and team_id = $2`, [viewer.organizationId, teamId, plan.nextVersion, viewer.personId])
      await recordChanges(client, viewer, { teamId }, changesOf(plan.from, orgTimes), { useDefault: true })
      return
    }
    await client.query(
      `insert into human_support_group_response_times (organization_id, team_id, operator_requeue_minutes, operator_close_minutes, anjo_requeue_minutes, custom, version, updated_by_person_id, updated_at)
       values ($1, $2, $3, $4, $5, true, $6, $7, statement_timestamp())
       on conflict (organization_id, team_id) do update set operator_requeue_minutes = excluded.operator_requeue_minutes, operator_close_minutes = excluded.operator_close_minutes,
         anjo_requeue_minutes = excluded.anjo_requeue_minutes, custom = true, version = excluded.version, updated_by_person_id = excluded.updated_by_person_id, updated_at = excluded.updated_at`,
      [viewer.organizationId, teamId, plan.times.operatorRequeueMinutes, plan.times.operatorCloseMinutes, plan.times.anjoRequeueMinutes, plan.nextVersion, viewer.personId],
    )
    await recordChanges(client, viewer, { teamId }, changesOf(plan.from, plan.times), { custom: true })
  })
  await dispatchAfterCommand(db, viewer.organizationId)
  return getResponseTimesPanel(db, viewer)
}
