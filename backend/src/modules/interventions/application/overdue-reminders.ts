import type { Database } from "../../../infrastructure/database/pool.js"
import type { Queryable } from "../../people/application/schedule-exception-service.js"
import { resolveOrganizationTimezone } from "../../workflows/application/organization-timezone.js"
import { localDateOf } from "../../workflows/application/time-window.js"

/** Intervalo mínimo entre dois lembretes da mesma intervenção ao mesmo responsável (janela MÓVEL, não a semana do calendário). */
export const OVERDUE_REMINDER_INTERVAL_DAYS = 7

/**
 * LEMBRETE DE PRAZO VENCIDO — para o responsável: recomendação sem resposta depois do prazo, ou execução com o prazo (ou algum
 * passo) vencido. O atraso continua sendo derivado do prazo, nunca um status; isto só AVISA (sino e Acompanhamento) — a
 * pendência já existia.
 *
 * Repetição (QA-04): no máximo um lembrete a cada 7 dias por intervenção × responsável, contados do último lembrete — janela
 * móvel. Com a semana ISO na chave, um lembrete no domingo e outro na segunda eram "semanas diferentes". A chave continua
 * única (leva o dia civil da organização), então duas rodadas no mesmo dia nunca duplicam.
 */
export async function sendOverdueReminders(db: Database, now: Date = new Date()): Promise<{ sent: number }> {
  const organizations = await db.query<{ organization_id: string }>(`select distinct organization_id from interventions where status in ('PROPOSED', 'IN_PROGRESS')`)
  let sent = 0
  for (const { organization_id: organizationId } of organizations.rows) {
    const today = localDateOf(now, await resolveOrganizationTimezone(db, organizationId))
    const inserted = await db.query(
      `insert into alerts (organization_id, case_id, recipient_id, title, description, severity, alert_type, dedupe_key)
       select i.organization_id, i.case_id, i.responsible_id,
              'Prazo vencido: ' || coalesce(v.definition->>'name', i.type_key),
              case when i.status = 'PROPOSED'
                   then '“' || coalesce(v.definition->>'name', i.type_key) || '” de ' || p.name || ' está sem resposta e o prazo venceu em ' || to_char(i.due_at, 'DD/MM/YYYY') || '. Aceite ou descarte no caso.'
                   when i.due_at < $2::date
                   then '“' || coalesce(v.definition->>'name', i.type_key) || '” de ' || p.name || ' passou do prazo (' || to_char(i.due_at, 'DD/MM/YYYY') || '). Registre o andamento ou conclua no caso.'
                   else '“' || coalesce(v.definition->>'name', i.type_key) || '” de ' || p.name || ' tem ' || late.items || ' passo(s) vencido(s). Registre o andamento no caso.' end,
              'MEDIUM', 'INTERVENTION_OVERDUE',
              'intervention:' || i.id || ':OVERDUE:' || i.responsible_id || ':' || $2::text
         from interventions i
         join people p on p.id = i.person_id
         left join intervention_type_versions v on v.id = i.type_version_id
         cross join lateral (select count(*)::int items from intervention_items it where it.intervention_id = i.id and it.status = 'PENDING' and it.due_at < $2::date) late
        where i.organization_id = $1 and not i.sensitive
          and ((i.status = 'PROPOSED' and i.due_at < $2::date) or (i.status = 'IN_PROGRESS' and (i.due_at < $2::date or late.items > 0)))
          and not exists (
            select 1 from alerts a
             where a.organization_id = i.organization_id and a.recipient_id = i.responsible_id and a.alert_type = 'INTERVENTION_OVERDUE'
               and a.dedupe_key like 'intervention:' || i.id || ':OVERDUE:%'
               and a.created_at > $3::timestamptz - make_interval(days => ${OVERDUE_REMINDER_INTERVAL_DAYS}))
       on conflict (dedupe_key) do nothing`,
      [organizationId, today, now],
    )
    sent += inserted.rowCount ?? 0
  }
  return { sent }
}

/**
 * O passo foi registrado (por quem conduz ou pelo colaborador): se não sobrou passo vencido e o prazo da intervenção não passou,
 * o lembrete aberto deixa de ter o que cobrar e é resolvido (QA-04). Com atraso restante, continua aberto.
 */
export async function resolveOverdueIfSettled(tx: Queryable, organizationId: string, interventionId: string, today: string): Promise<void> {
  await tx.query(
    `update alerts set status = 'RESOLVED', resolved_at = now()
      where organization_id = $1 and dedupe_key like $2 and status in ('OPEN','SEEN','ACKNOWLEDGED')
        and not exists (select 1 from interventions i where i.id = $3 and i.due_at < $4::date)
        and not exists (select 1 from intervention_items it where it.intervention_id = $3 and it.status = 'PENDING' and it.due_at < $4::date)`,
    [organizationId, `intervention:${interventionId}:OVERDUE:%`, interventionId, today],
  )
}
