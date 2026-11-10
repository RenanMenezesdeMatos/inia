import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { CHAT_DISLIKE_REASON_LABELS, CHAT_DISLIKE_REASONS, type ChatDislikeReason } from "../domain/assistant-interaction-rating.js"
import { SUPPORT_SIGNAL_LABELS, SUPPORT_SIGNALS, type SupportSignal } from "../domain/reply-signals.js"
import { CLARIFICATION_TOOL_NAME } from "../../knowledge-clarification/domain/clarification-state.js"

/**
 * FUNIL DAS RESPOSTAS DA INIA (M1–M6, design de Apoio com Anjo seções 4 e 15). Calculado na hora, sobre o chat livre
 * (`origin = USER`), no período em datas civis no fuso da organização (até 92 dias), com o recorte aplicado sobre o Grupo/Subgrupo
 * ATUAL de cada pessoa. Só o painel do apoio chama (D7: Coordenador de Anjos e Administrador geral). Regras de leitura:
 *  - M1 = mensagens da INIA no período, menos as etapas de esclarecimento ainda aguardando escolha (pergunta, não resposta);
 *  - avaliação = a VIGENTE de cada resposta (sem avaliação não é positivo; retirada não conta);
 *  - "motivo não coletado" = descurtida anterior à primeira linha de motivo da organização; "não informado" = depois dela;
 *  - M6 só conta respostas com linha de sinais (anteriores ao corte não entram no denominador); `NO_REPLY` fica na PERGUNTA e
 *    aparece no detalhamento como contagem de perguntas, sem taxa;
 *  - toda taxa leva numerador e denominador; denominador < 5 = taxa oculta (amostra pequena); 0 = sem dados (nunca 0%).
 * M3 mede só a percepção de quem avaliou: nunca é "assertividade".
 */
export const FUNNEL_MAX_DAYS = 92
export const FUNNEL_MIN_SAMPLE = 5

export type FunnelRatio = { numerator: number | null; denominator: number | null; value: number | null; status: "OK" | "SMALL_SAMPLE" | "NO_DATA" }
export type FunnelBreakdownItem = { key: string; label: string; count: number; value?: number | null }
export type FunnelMeasure = { id: "M1" | "M2" | "M3" | "M4" | "M5" | "M6"; kind: "COUNT" | "RATE" | "DISTRIBUTION"; main: FunnelRatio; breakdown?: FunnelBreakdownItem[] }
export type ReplyFunnel = { period: { from: string; to: string }; cutoffs: { dislikeDetailsSince: string | null; signalsSince: string | null }; measures: FunnelMeasure[] }

/** Recorte de quem lê: a organização inteira ou listas de Grupos e Subgrupos (Grupo cobre os Subgrupos dele). Nunca "Minha estrutura". */
export type FunnelPlacement = { kind: "ORGANIZATION" } | { kind: "UNITS"; teamIds: readonly string[]; subteamIds: readonly string[] }
/** Filtro da tela, dentro do recorte. */
export type FunnelFilter = { teamId?: string | null; subteamId?: string | null }

/** Contagens do período (o que o banco devolve). */
export type FunnelCounts = {
  answers: number
  up: number
  down: number
  downWithDetails: number
  stillNeedsHelp: number
  reasons: Partial<Record<ChatDislikeReason, number>>
  downNotCollected: number
  downNotInformed: number
  withSignalRow: number
  withSignal: number
  signals: Partial<Record<SupportSignal, number>>
  noReplyQuestions: number
}

export function funnelRatio(numerator: number, denominator: number): FunnelRatio {
  if (denominator === 0) return { numerator, denominator, value: null, status: "NO_DATA" }
  if (denominator < FUNNEL_MIN_SAMPLE) return { numerator, denominator, value: null, status: "SMALL_SAMPLE" }
  return { numerator, denominator, value: numerator / denominator, status: "OK" }
}

const share = (count: number, denominator: number) => (denominator >= FUNNEL_MIN_SAMPLE ? count / denominator : null)
/** Contagem que é a base de uma distribuição: zero = sem dados; abaixo de 5 = amostra pequena (as parcelas ficam ocultas). */
const baseOf = (count: number): FunnelRatio => ({ numerator: count, denominator: null, value: count, status: count === 0 ? "NO_DATA" : count < FUNNEL_MIN_SAMPLE ? "SMALL_SAMPLE" : "OK" })

/** As medidas M1–M6 a partir das contagens (sem banco; testado em `reply-funnel.test.ts`). */
export function funnelMeasures(counts: FunnelCounts): FunnelMeasure[] {
  const rated = counts.up + counts.down
  return [
    { id: "M1", kind: "COUNT", main: { numerator: counts.answers, denominator: null, value: counts.answers, status: "OK" } },
    { id: "M2", kind: "RATE", main: funnelRatio(rated, counts.answers) },
    { id: "M3", kind: "RATE", main: funnelRatio(counts.up, rated) },
    {
      id: "M4",
      kind: "DISTRIBUTION",
      main: baseOf(counts.down),
      breakdown: [
        ...CHAT_DISLIKE_REASONS.map((reason) => ({ key: reason, label: CHAT_DISLIKE_REASON_LABELS[reason], count: counts.reasons[reason] ?? 0, value: share(counts.reasons[reason] ?? 0, counts.down) })),
        { key: "NOT_INFORMED", label: "Motivo não informado", count: counts.downNotInformed, value: share(counts.downNotInformed, counts.down) },
        { key: "NOT_COLLECTED", label: "Motivo não coletado", count: counts.downNotCollected, value: share(counts.downNotCollected, counts.down) },
      ],
    },
    { id: "M5", kind: "RATE", main: funnelRatio(counts.stillNeedsHelp, counts.downWithDetails) },
    {
      id: "M6",
      kind: "RATE",
      main: funnelRatio(counts.withSignal, counts.withSignalRow),
      breakdown: SUPPORT_SIGNALS.map((signal) =>
        signal === "NO_REPLY"
          ? { key: signal, label: SUPPORT_SIGNAL_LABELS[signal], count: counts.noReplyQuestions, value: null }
          : { key: signal, label: SUPPORT_SIGNAL_LABELS[signal], count: counts.signals[signal] ?? 0, value: share(counts.signals[signal] ?? 0, counts.withSignalRow) },
      ),
    },
  ]
}

const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/
const dayNumber = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 86_400_000

/** Período válido: datas civis reais, `from` ≤ `to`, no máximo 92 dias. */
export function assertFunnelPeriod(period: { from: string; to: string }) {
  const valid = (date: string) => CIVIL_DATE.test(date) && new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) === date
  if (!valid(period.from) || !valid(period.to)) throw new DomainError("Informe as datas no formato AAAA-MM-DD.", "FUNNEL_PERIOD_INVALID", 422)
  const days = dayNumber(period.to) - dayNumber(period.from) + 1
  if (days < 1 || days > FUNNEL_MAX_DAYS) throw new DomainError(`Escolha um período de 1 a ${FUNNEL_MAX_DAYS} dias.`, "FUNNEL_PERIOD_INVALID", 422)
}

// Etapa de esclarecimento ainda aguardando escolha: é pergunta da INIA, não resposta (não entra em M1).
const AWAITING_CHOICE = `$[*] ? (@.toolName == "${CLARIFICATION_TOOL_NAME}" && @.state.status == "OPEN")`

type CountsRow = {
  answers: number
  up: number
  down: number
  down_with_details: number
  still_needs_help: number
  reasons: Record<string, number> | null
  down_not_collected: number
  down_not_informed: number
  with_signal_row: number
  with_signal: number
  signals: Record<string, number> | null
  no_reply_questions: number
  dislike_details_since: Date | null
  signals_since: Date | null
}

export async function replyFunnel(db: Pick<Database, "query">, organizationId: string, period: { from: string; to: string }, placement: FunnelPlacement, filter: FunnelFilter = {}): Promise<ReplyFunnel> {
  assertFunnelPeriod(period)
  const params: unknown[] = [organizationId, period.from, period.to, AWAITING_CHOICE]
  const add = (value: unknown) => {
    params.push(value)
    return `$${params.length}`
  }
  // Grupo/Subgrupo ATUAL da pessoa dona da conversa; quem está num Subgrupo pertence ao Grupo dele.
  const inTeam = (param: string) => `(p.team_id = any(${param}::uuid[]) or st.team_id = any(${param}::uuid[]))`
  const clauses: string[] = []
  if (placement.kind === "UNITS") clauses.push(`(${inTeam(add([...placement.teamIds]))} or p.subteam_id = any(${add([...placement.subteamIds])}::uuid[]))`)
  if (filter.teamId) clauses.push(inTeam(add([filter.teamId])))
  if (filter.subteamId) clauses.push(`p.subteam_id = ${add(filter.subteamId)}::uuid`)
  const placed = clauses.length > 0 ? clauses.join(" and ") : "true"
  const row = (
    await db.query<CountsRow>(
      `with bounds as (
         select ($2::date)::timestamp at time zone analytics_org_timezone($1) starts, ($3::date + 1)::timestamp at time zone analytics_org_timezone($1) ends
       ),
       cutoffs as (
         select (select min(r.created_at) from assistant_interaction_rating_details d join assistant_interaction_ratings r on r.id = d.rating_id where d.organization_id = $1) dislike_details_since,
                (select min(s.created_at) from assistant_reply_signals s where s.organization_id = $1) signals_since
       ),
       placed as (
         select i.id, i.role, i.tool_calls
           from assistant_interactions i
           join assistant_conversations c on c.id = i.conversation_id and c.origin = 'USER' and c.organization_id = $1
           join people p on p.id = c.owner_person_id
           left join subteams st on st.id = p.subteam_id
           cross join bounds b
          where i.organization_id = $1 and i.occurred_at >= b.starts and i.occurred_at < b.ends and ${placed}
       ),
       answers as (
         select id from placed where role = 'assistant' and not jsonb_path_exists(coalesce(tool_calls, '[]'::jsonb), $4::jsonpath)
       ),
       rated as (
         select r.value, r.created_at, d.reason, d.still_needs_help
           from answers a
           join assistant_interaction_ratings r on r.interaction_id = a.id and r.organization_id = $1 and r.superseded_at is null and r.value <> 'NONE'
           left join assistant_interaction_rating_details d on d.rating_id = r.id
       ),
       signaled as (
         select s.signals from answers a join assistant_reply_signals s on s.interaction_id = a.id
       )
       select (select count(*)::int from answers) answers,
              (select count(*)::int from rated where value = 'UP') up,
              (select count(*)::int from rated where value = 'DOWN') down,
              (select count(*)::int from rated where value = 'DOWN' and reason is not null) down_with_details,
              (select count(*)::int from rated where value = 'DOWN' and still_needs_help) still_needs_help,
              (select jsonb_object_agg(reason, n) from (select reason, count(*)::int n from rated where value = 'DOWN' and reason is not null group by reason) g) reasons,
              (select count(*)::int from rated, cutoffs k where value = 'DOWN' and reason is null and (k.dislike_details_since is null or created_at < k.dislike_details_since)) down_not_collected,
              (select count(*)::int from rated, cutoffs k where value = 'DOWN' and reason is null and k.dislike_details_since is not null and created_at >= k.dislike_details_since) down_not_informed,
              (select count(*)::int from signaled) with_signal_row,
              (select count(*)::int from signaled where cardinality(signals) > 0) with_signal,
              (select jsonb_object_agg(signal, n) from (select signal, count(*)::int n from signaled, unnest(signals) signal group by signal) g) signals,
              (select count(*)::int from placed q join assistant_reply_signals s on s.interaction_id = q.id where q.role = 'user' and 'NO_REPLY' = any(s.signals)) no_reply_questions,
              k.dislike_details_since, k.signals_since
         from cutoffs k`,
      params,
    )
  ).rows[0]!
  const counts: FunnelCounts = {
    answers: row.answers,
    up: row.up,
    down: row.down,
    downWithDetails: row.down_with_details,
    stillNeedsHelp: row.still_needs_help,
    reasons: (row.reasons ?? {}) as FunnelCounts["reasons"],
    downNotCollected: row.down_not_collected,
    downNotInformed: row.down_not_informed,
    withSignalRow: row.with_signal_row,
    withSignal: row.with_signal,
    signals: (row.signals ?? {}) as FunnelCounts["signals"],
    noReplyQuestions: row.no_reply_questions,
  }
  return {
    period: { from: period.from, to: period.to },
    cutoffs: { dislikeDetailsSince: row.dislike_details_since?.toISOString() ?? null, signalsSince: row.signals_since?.toISOString() ?? null },
    measures: funnelMeasures(counts),
  }
}
