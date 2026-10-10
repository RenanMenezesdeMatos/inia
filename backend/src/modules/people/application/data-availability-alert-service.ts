import type { Database } from "../../../infrastructure/database/pool.js"
import { personIdsWithOrganizationWidePermission } from "../../access/application/permission-holders.js"
import type { AvailabilitySourceStatus, WorkdayDataAvailability } from "../domain/workday-data-availability.js"

/**
 * ALERTA DE FONTE ATRASADA — "o dado de D-1 ainda não foi recebido" é um problema de DADO/FONTE, nunca
 * "João sem produção" × 2.000. Quando uma fonte relevante (evidência de produção ou situação funcional)
 * passa do seu `expectedAvailableAt` sem entregar o dia, os administradores recebem UM alerta por
 * fonte × dia de referência (dedupe determinístico). Assim que a carga chega (fonte READY para aquele
 * dia), o alerta é RESOLVIDO. Tabela `alerts` — sem notification engine nova; roda no job de reconciliação.
 */
export const DATA_AVAILABILITY_ALERT_TYPE = "DATA_SOURCE_AVAILABILITY_DELAYED"

export function dataAvailabilityDedupeKey(organizationId: string, recipientId: string, sourceKey: string, workDate: string): string {
  return `data_source_availability:${organizationId}:${recipientId}:${sourceKey}:${workDate}`
}

function formatDay(date: string): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}`
}

export function dataAvailabilityAlertText(source: AvailabilitySourceStatus, workDate: string): { title: string; description: string } {
  const group = source.group === "EMPLOYMENT" ? "situação funcional" : "evidência de produção"
  const reason = source.lastErrorCode ? ` Último erro da fonte: ${source.lastErrorCode}.` : source.freshness === "STALE" ? " O feed está atrasado em relação à cadência esperada." : source.freshness === "NEVER" ? " O feed nunca recebeu uma carga bem-sucedida." : ""
  return {
    title: `Dado de ${formatDay(workDate)} ainda não recebido (${source.label})`,
    description: `A fonte de ${group} "${source.label}" deveria conter o dia ${formatDay(workDate)} desde ${source.expectedAt ? new Date(source.expectedAt).toLocaleString("pt-BR", { timeZone: "UTC", hour12: false }).replace(",", "") + " UTC" : "o prazo configurado"} (${source.policyLabel}) e nenhuma carga bem-sucedida chegou depois disso.${reason} Enquanto isso a INIA NÃO conclui ausência de nenhum colaborador nesse dia. Verifique a fonte na Central de Dados.`,
  }
}

export type AvailabilityAlertReport = { created: number; resolved: number; delayedSourceDays: number }

/**
 * Sincroniza os alertas de UMA organização com a disponibilidade por dia (idempotente). `availability`
 * é o mapa data → estado já calculado pelo resolvedor (nunca recalculado por pessoa).
 */
export async function syncDataAvailabilityAlerts(db: Database, organizationId: string, availability: ReadonlyMap<string, WorkdayDataAvailability>, now: Date): Promise<AvailabilityAlertReport> {
  const delayed: { date: string; source: AvailabilitySourceStatus }[] = []
  for (const day of availability.values()) for (const source of day.sources) if (source.state === "DELAYED") delayed.push({ date: day.date, source })
  const report: AvailabilityAlertReport = { created: 0, resolved: 0, delayedSourceDays: delayed.length }
  const keepKeys: string[] = []
  if (delayed.length > 0) {
    // V1.5.8: quem recebe = contas com `data_hub.manage` na organização inteira (papéis), nunca o nível hierárquico "ADMIN".
    const admins = { rows: (await personIdsWithOrganizationWidePermission(db, organizationId, "data_hub.manage")).map((id) => ({ id })) }
    for (const entry of delayed) {
      const text = dataAvailabilityAlertText(entry.source, entry.date)
      for (const admin of admins.rows) {
        const key = dataAvailabilityDedupeKey(organizationId, admin.id, entry.source.key, entry.date)
        keepKeys.push(key)
        const inserted = await db.query(
          `insert into alerts (organization_id, recipient_id, title, description, severity, alert_type, dedupe_key, created_at) values ($1, $2, $3, $4, 'MEDIUM', $5, $6, $7) on conflict (dedupe_key) do nothing`,
          [organizationId, admin.id, text.title, text.description, DATA_AVAILABILITY_ALERT_TYPE, key, now],
        )
        report.created += inserted.rowCount ?? 0
      }
    }
  }
  // Só resolve alertas dos dias avaliados nesta rodada (a janela do job) — dias fora dela não são tocados.
  const dates = [...availability.keys()]
  if (dates.length > 0) {
    const resolved = await db.query(
      `update alerts set status = 'RESOLVED', resolved_at = $5
        where organization_id = $1 and alert_type = $2 and status <> 'RESOLVED' and not (dedupe_key = any($3::text[]))
          and right(dedupe_key, 10) = any($4::text[])`,
      [organizationId, DATA_AVAILABILITY_ALERT_TYPE, keepKeys, dates, now],
    )
    report.resolved = resolved.rowCount ?? 0
  }
  return report
}
