import type { Database } from "../../../infrastructure/database/pool.js"
import { visibleInFollowUpSql } from "../../feedbacks/application/follow-up-visibility.js"
import { CALL_ALREADY_MONITORED, indicatorPeriodKey, PERIOD_ALREADY_DELIVERED, type DeliveredMonitoring, type DeliverySkip } from "../domain/delivery-guards.js"

/**
 * Consultas das REGRAS DE ENTREGA ÚNICA (`domain/delivery-guards.ts`) — usadas pelo armazenamento do motor (checagem antes de pagar
 * análise/investigação) e pela publicação (dentro da transação, depois da trava). Aceitam o pool ou o cliente da transação.
 */
type Queryable = Pick<Database, "query">

/** Mensagem do motor publicada num feedback OCULTO do Acompanhamento (artefato de desenvolvimento, migration 095): não conta como entrega
 * para nenhuma regra — entrega única, pontos já entregues e orientação anterior (`HIDDEN_ARTIFACT_NOT_DELIVERED_V1`). */
export const engineMessageHiddenSql = (alias: string) =>
  `exists (select 1 from feedbacks hf join feedback_follow_up_hides fh on fh.feedback_id = hf.id and fh.restored_at is null
           where hf.organization_id = ${alias}.organization_id and hf.context_snapshot -> 'feedbackEngine' ->> 'messageId' = ${alias}.id::text)`

/**
 * `ONE_MONITORING_PER_CALL_V1` — as DUAS fontes de monitoria entregue de UMA chamada, sempre a partir da chamada (run-9, DADOS-01: antes,
 * cada consulta partia de TODAS as mensagens e de TODOS os feedbacks de monitoria da organização — 4 varreduras completas por chamada).
 * `interaction` = expressão uuid da chamada (parâmetro, ou a coluna da consulta que a usa, ex. `i.id`); `exclude` = expressão uuid da
 * mensagem a desconsiderar, ou null. Uma definição só: a consulta da entrega (`deliveredMonitoringOfSql`) e o sorteio da monitoria
 * aleatória (`notMonitoredSql`) usam estes mesmos ramos.
 *
 * Índices usados: `feedback_analysis_runs_interaction_idx` (análises da chamada), GIN parcial em `feedback_engine_messages.analysis_run_ids`
 * (mensagens entregues dessas análises), expressão `feedbacks(context_snapshot -> 'feedbackEngine' ->> 'messageId')` (mensagem oculta),
 * `idx_evidences_source` (evidências da chamada) e `feedbacks(case_id)` (feedbacks do caso) — os três últimos novos (migration 248).
 */
const engineMonitoringFromSql = (organization: string, interaction: string, exclude: string | null) => `from feedback_analysis_runs r
         join feedback_engine_messages m on m.organization_id = r.organization_id and m.analysis_run_ids && array[r.id]
              and m.domain = 'MONITORING' and m.status = 'PUBLISHABLE' and m.delivered_at is not null
        where r.organization_id = ${organization} and r.interaction_id = ${interaction}
          ${exclude ? `and (${exclude} is null or m.id <> ${exclude})` : ""} and not ${engineMessageHiddenSql("m")}`
const publishedMonitoringFromSql = (organization: string, interaction: string, exclude: string | null) => `from evidences e
         join feedbacks f on f.case_id = e.case_id
        where e.organization_id = ${organization} and e.source_type = 'interaction' and e.source_id = (${interaction})::text
          and f.organization_id = ${organization} and f.feedback_kind = 'MONITORING' and f.status = 'PUBLISHED' and ${visibleInFollowUpSql("f")}
          ${exclude ? `and (${exclude} is null or coalesce(f.context_snapshot -> 'feedbackEngine' ->> 'messageId', '') <> (${exclude})::text)` : ""}`

/** A chamada ainda NÃO tem monitoria entregue (predicado para o `where` de uma consulta sobre chamadas, ex. o sorteio). */
export const notMonitoredSql = (organization: string, interaction: string) =>
  `(not exists (select 1 ${engineMonitoringFromSql(organization, interaction, null)})
    and not exists (select 1 ${publishedMonitoringFromSql(organization, interaction, null)}))`

/** `ONE_MONITORING_PER_CALL_V1`: a primeira monitoria entregue da chamada (mensagem do motor ou feedback publicado), ou null. */
export async function deliveredMonitoringOfSql(db: Queryable, organizationId: string, interactionId: string, excludeMessageId: string | null = null): Promise<DeliveredMonitoring | null> {
  const row = (await db.query<{ source: DeliveredMonitoring["source"]; id: string; at: Date }>(
    `select * from (
       (select 'ENGINE_MESSAGE' source, m.id, m.delivered_at at ${engineMonitoringFromSql("$1", "$2::uuid", "$3::uuid")} order by m.delivered_at limit 1)
       union all
       (select 'PUBLISHED_FEEDBACK' source, f.id, coalesce(f.published_at, f.updated_at) at ${publishedMonitoringFromSql("$1", "$2::uuid", "$3::uuid")} order by coalesce(f.published_at, f.updated_at) limit 1)
     ) delivered order by at limit 1`,
    [organizationId, interactionId, excludeMessageId],
  )).rows[0]
  return row ? { source: row.source, id: row.id, deliveredAt: new Date(row.at) } : null
}

/** `ONE_INDICATOR_FEEDBACK_PER_PERIOD_V1`: indicador × período (chave `CODE|início|fim`) já entregues à pessoa pelo motor. */
export async function deliveredIndicatorPeriodsSql(db: Queryable, organizationId: string, personId: string, excludeMessageId: string | null = null): Promise<Set<string>> {
  const rows = (await db.query<{ indicator_code: string; period_start: string; period_end: string }>(
    `select distinct i.indicator_code, i.period_start::text period_start, i.period_end::text period_end
       from feedback_engine_messages m
       join indicator_investigations i on i.organization_id = m.organization_id and i.analysis_run_id = any(m.analysis_run_ids)
      where m.organization_id = $1 and m.person_id = $2 and m.domain = 'INDICATOR' and m.status = 'PUBLISHABLE' and m.delivered_at is not null
        and ($3::uuid is null or m.id <> $3::uuid) and not ${engineMessageHiddenSql("m")}`,
    [organizationId, personId, excludeMessageId],
  )).rows
  return new Set(rows.map((row) => indicatorPeriodKey(row.indicator_code, row.period_start, row.period_end)))
}

/** O que uma mensagem do motor entrega: as chamadas (monitoria) e os indicadores × períodos (indicador) das análises dela. */
export async function deliveryKeysOfRunsSql(db: Queryable, organizationId: string, analysisRunIds: readonly string[]): Promise<{ interactionIds: string[]; periods: string[] }> {
  if (analysisRunIds.length === 0) return { interactionIds: [], periods: [] }
  const interactions = (await db.query<{ interaction_id: string }>(
    `select distinct interaction_id::text interaction_id from feedback_analysis_runs where organization_id = $1 and id = any($2::uuid[]) and interaction_id is not null`,
    [organizationId, [...analysisRunIds]],
  )).rows.map((row) => row.interaction_id)
  const periods = (await db.query<{ indicator_code: string; period_start: string; period_end: string }>(
    `select distinct indicator_code, period_start::text period_start, period_end::text period_end from indicator_investigations where organization_id = $1 and analysis_run_id = any($2::uuid[])`,
    [organizationId, [...analysisRunIds]],
  )).rows.map((row) => indicatorPeriodKey(row.indicator_code, row.period_start, row.period_end))
  return { interactionIds: interactions, periods }
}

/** Trava da transação por chave de entrega (duas publicações da mesma chamada/período nunca passam juntas). */
export async function lockDeliveryKey(db: Queryable, key: string): Promise<void> {
  await db.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [`feedback-delivery:${key}`])
}

/**
 * Por que ESTA mensagem não pode ser entregue (null = pode). `lock = true` dentro da transação de publicação: trava cada chave antes
 * de conferir — a segunda publicação concorrente da mesma chamada/período espera a primeira e então a vê entregue.
 */
export async function deliverySkipOfMessage(db: Queryable, message: { organizationId: string; id: string; domain: "MONITORING" | "INDICATOR"; personId: string; analysisRunIds: readonly string[] }, options: { lock: boolean }): Promise<DeliverySkip | null> {
  const keys = await deliveryKeysOfRunsSql(db, message.organizationId, message.analysisRunIds)
  if (message.domain === "MONITORING") {
    for (const interactionId of [...keys.interactionIds].sort()) {
      if (options.lock) await lockDeliveryKey(db, `call:${message.organizationId}:${interactionId}`)
      const existing = await deliveredMonitoringOfSql(db, message.organizationId, interactionId, message.id)
      if (existing) return { reason: CALL_ALREADY_MONITORED, interactionId, existing }
    }
    return null
  }
  if (options.lock) for (const period of [...keys.periods].sort()) await lockDeliveryKey(db, `indicator:${message.organizationId}:${message.personId}:${period}`)
  const delivered = await deliveredIndicatorPeriodsSql(db, message.organizationId, message.personId, message.id)
  const overlap = keys.periods.filter((period) => delivered.has(period))
  return overlap.length > 0 ? { reason: PERIOD_ALREADY_DELIVERED, periods: overlap } : null
}
