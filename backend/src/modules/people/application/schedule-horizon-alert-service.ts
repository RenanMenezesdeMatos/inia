import type { Database } from "../../../infrastructure/database/pool.js"
import { personIdsWithOrganizationWidePermission } from "../../access/application/permission-holders.js"
import { systemClock, type Clock } from "../../../shared/domain/clock.js"
import { DEFAULT_ORGANIZATION_TIMEZONE } from "../../workflows/application/organization-timezone.js"
import { localDateOf } from "../../workflows/application/time-window.js"
import { resolveWorkScheduleHorizon, type WorkScheduleHorizon } from "./work-schedule-service.js"

/**
 * ALERTA DE HORIZONTE DA ESCALA — transforma `endingSoon` em ação operacional, sem IA: quando o
 * calendário conhecido (WORK_SCHEDULE_DAYS) termina dentro de `schedule_horizon_warning_days`, os
 * administradores da organização recebem um alerta administrativo no sino:
 *   "Escalas de trabalho disponíveis somente até 20/09. Restam 4 dias de calendário conhecido."
 * Idempotência: um alerta por organização × destinatário × coverageUntil (dedupe_key determinístico);
 * quando um calendário novo chega e o horizonte AVANÇA (coverageUntil maior) ou o aviso deixa de
 * valer, os alertas anteriores deste tipo são RESOLVIDOS — sem notification engine nova (tabela `alerts`).
 * Roda no ticker do servidor (mesma cadência da projeção de situação funcional).
 */
export const SCHEDULE_HORIZON_ALERT_TYPE = "WORK_SCHEDULE_HORIZON"

export function scheduleHorizonDedupeKey(organizationId: string, recipientId: string, coverageUntil: string): string {
  return `work_schedule_horizon:${organizationId}:${recipientId}:${coverageUntil}`
}

export function scheduleHorizonAlertText(horizon: WorkScheduleHorizon): { title: string; description: string } {
  const until = horizon.coverageUntil ? `${horizon.coverageUntil.slice(8, 10)}/${horizon.coverageUntil.slice(5, 7)}` : "?"
  const remaining = horizon.daysRemaining ?? 0
  return {
    title: "Escalas de trabalho perto do fim do calendário conhecido",
    description: `Escalas de trabalho disponíveis somente até ${until}. ${remaining === 1 ? "Resta 1 dia" : `Restam ${remaining} dias`} de calendário conhecido (limite de aviso: ${horizon.warningDays} dias). Envie o próximo período pela Central de Dados (contrato Escalas de trabalho).`,
  }
}

export type HorizonAlertReport = { organizations: number; created: number; resolved: number }

export async function runScheduleHorizonAlerts(db: Database, clock: Clock | Date = systemClock): Promise<HorizonAlertReport> {
  const now = clock instanceof Date ? clock : clock.now()
  const organizations = await db.query<{ id: string; timezone: string | null }>(`select o.id, (select op.timezone from operations op where op.organization_id = o.id order by op.created_at limit 1) timezone from organizations o`)
  const report: HorizonAlertReport = { organizations: 0, created: 0, resolved: 0 }
  for (const organization of organizations.rows) {
    const today = localDateOf(now, organization.timezone ?? DEFAULT_ORGANIZATION_TIMEZONE)
    const partial = await syncScheduleHorizonAlerts(db, organization.id, today, now)
    report.organizations += 1
    report.created += partial.created
    report.resolved += partial.resolved
  }
  return report
}

/** Sincroniza os alertas de UMA organização com o horizonte atual (idempotente; testável com data fixa). */
export async function syncScheduleHorizonAlerts(db: Database, organizationId: string, today: string, now: Date = systemClock.now()): Promise<{ created: number; resolved: number; horizon: WorkScheduleHorizon }> {
  const horizon = await resolveWorkScheduleHorizon(db, organizationId, today)
  const keepKeys: string[] = []
  let created = 0
  if (horizon.configured && horizon.endingSoon && horizon.coverageUntil) {
    // V1.5.8: quem recebe = contas com `data_hub.manage` na organização inteira (papéis), nunca o nível hierárquico "ADMIN".
    const admins = { rows: (await personIdsWithOrganizationWidePermission(db, organizationId, "data_hub.manage")).map((id) => ({ id })) }
    const text = scheduleHorizonAlertText(horizon)
    for (const admin of admins.rows) {
      const key = scheduleHorizonDedupeKey(organizationId, admin.id, horizon.coverageUntil)
      keepKeys.push(key)
      const inserted = await db.query(
        `insert into alerts (organization_id, recipient_id, title, description, severity, alert_type, dedupe_key, created_at) values ($1, $2, $3, $4, 'MEDIUM', $5, $6, $7) on conflict (dedupe_key) do nothing`,
        [organizationId, admin.id, text.title, text.description, SCHEDULE_HORIZON_ALERT_TYPE, key, now],
      )
      created += inserted.rowCount ?? 0
    }
  }
  // Horizonte avançou (ou o aviso deixou de valer): encerra os avisos anteriores — nunca acumula.
  const resolved = await db.query(
    `update alerts set status = 'RESOLVED', resolved_at = $4 where organization_id = $1 and alert_type = $2 and status <> 'RESOLVED' and not (dedupe_key = any($3::text[]))`,
    [organizationId, SCHEDULE_HORIZON_ALERT_TYPE, keepKeys, now],
  )
  return { created, resolved: resolved.rowCount ?? 0, horizon }
}
