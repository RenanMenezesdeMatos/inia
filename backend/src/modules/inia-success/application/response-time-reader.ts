import { SqlParams } from "../../../shared/infrastructure/sql-params.js"
import { scopedPeopleSql } from "../../access/application/scope-people-reader.js"
import { RESPONSE_CHECK_TOOL_NAME } from "../../governance/application/response-compliance.js"
import { foldByBucket, rate, SUCCESS_MIN_SAMPLE, weightedAverage, type Average, type Bucket, type Rate } from "../domain/success-metrics.js"
import { boundsCte, localDay, placementFilter, type Queryable, type SuccessQuery, type SuccessViewer } from "./success-query.js"

/**
 * TEMPO DE RESPOSTA DA INIA NO CHAT DE TEXTO (chat livre, `origin = USER`), no alcance de `assistant_conversations.view`.
 *
 * O que mede: do instante em que o servidor RECEBEU a pergunta (gravada antes de gerar a resposta) ao instante em que GRAVOU a resposta
 * completa (depois do streaming e da conferência) — "tempo até a resposta completa", medido no servidor. Não é o tempo até o primeiro
 * trecho aparecer na tela (esse não fica gravado) e não inclui a rede até o navegador.
 *
 * Vínculo pergunta → resposta COMPROVADO pela chave idempotente do cliente: a resposta do turno é gravada com
 * `client_message_id = <chave da pergunta> || ':reply'` na mesma conversa (`realtime-router.ts`, rota `/messages`). Nunca por
 * vizinhança de mensagens. Pergunta sem resposta pareada não entra na média (nunca vale zero) e aparece na cobertura.
 * Texto digitado com a VOZ ligada (gravado pelo turno da voz, chave `<turno>:user`) é respondido pelo fluxo da voz: fica fora da base
 * do texto e aparece contado à parte.
 *
 * Voz: pergunta e resposta são gravadas quando o turno termina (o horário da fala vem do navegador e a resposta inclui a própria fala),
 * sem marca de início e fim da geração — não há medida confiável; a tela mostra só quantas respostas por voz houve.
 *
 * Referência temporal: data da PERGUNTA (coorte = perguntas feitas no período; numerador e denominador do mesmo conjunto).
 */
export type ResponseTimeSeriesPoint = { bucket: Bucket; questions: number; measured: number; average: Average }
export type ResponseTimeSummary = {
  text: {
    average: Average
    medianSeconds: number | null
    p90Seconds: number | null
    /** Perguntas por texto enviadas pelo chat (base da cobertura). */
    questions: number
    measured: number
    coverage: Rate
    /** Registros antigos sem chave do cliente: sem como provar o vínculo, ficam sem medida. */
    noKey: number
    /** Perguntas cujo turno terminou em erro (sinal `NO_REPLY`): a INIA não respondeu. */
    noReply: number
    /** Perguntas sem resposta pareada pela chave e sem `NO_REPLY` (turno cancelado, gravação antiga sem chave, resposta não gravada). */
    unpaired: number
    /** Pareadas com horário da resposta anterior ao da pergunta (relógio inconsistente): fora da média. */
    invalid: number
    /** Das medidas, respostas trocadas pela conferência (texto fixo no lugar do gerado): o tempo inclui a conferência. */
    replacedByCheck: number
  }
  voice: { status: "NOT_MEASURED"; answers: number; typedQuestions: number }
  series: ResponseTimeSeriesPoint[]
}

type DayRow = { day: string; questions: number; measured: number; sum_seconds: number | null; no_reply: number; invalid: number; replaced: number; no_key: number; typed_in_voice: number }

export async function responseTimeSummary(db: Queryable, viewer: SuccessViewer, query: SuccessQuery): Promise<ResponseTimeSummary> {
  const p = new SqlParams()
  const org = p.typed(viewer.organizationId, "uuid")
  const bounds = boundsCte(p, viewer.organizationId, query)
  const scope = scopedPeopleSql(p, { organizationId: viewer.organizationId, viewerPersonId: viewer.personId, permission: "assistant_conversations.view" })
  const placed = placementFilter(p, query)
  const replaced = p.typed(`$[*] ? (@.toolName == "${RESPONSE_CHECK_TOOL_NAME}")`, "jsonpath")
  const result = await db.query<{ days: DayRow[] | null; median: number | null; p90: number | null; voice_answers: number }>(
    `with ${bounds},
     scope as (${scope}),
     conversations as (
       select c.id from assistant_conversations c
         join people p on p.id = c.owner_person_id and p.organization_id = c.organization_id
         left join subteams st on st.id = p.subteam_id
        where c.organization_id = ${org} and c.origin = 'USER' and c.owner_person_id in (select person_id from scope) and ${placed}
     ),
     questions as (
       select q.id, q.conversation_id, q.client_message_id, q.occurred_at, ${localDay("q.occurred_at")} as day,
              coalesce(q.client_message_id like '%:user', false) typed_in_voice
         from assistant_interactions q cross join bounds b
        where q.organization_id = ${org} and q.conversation_id in (select id from conversations)
          and q.role = 'user' and q.channel = 'chat' and q.occurred_at >= b.starts and q.occurred_at < b.ends
     ),
     paired as (
       select q.day, q.typed_in_voice, q.client_message_id is null no_key, r.id reply_id, extract(epoch from r.occurred_at - q.occurred_at)::float8 seconds,
              coalesce(jsonb_path_exists(case when jsonb_typeof(r.tool_calls) = 'array' then r.tool_calls else '[]'::jsonb end, ${replaced}), false) replaced,
              exists (select 1 from assistant_reply_signals s where s.interaction_id = q.id and 'NO_REPLY' = any(s.signals)) no_reply
         from questions q
         left join assistant_interactions r on q.client_message_id is not null and r.conversation_id = q.conversation_id
              and r.client_message_id = q.client_message_id || ':reply' and r.role = 'assistant'
     ),
     by_day as (
       select day, count(*) filter (where not typed_in_voice)::int questions,
              count(*) filter (where typed_in_voice)::int typed_in_voice,
              count(*) filter (where no_key)::int no_key,
              count(*) filter (where reply_id is not null and seconds >= 0)::int measured,
              sum(seconds) filter (where reply_id is not null and seconds >= 0)::float8 sum_seconds,
              count(*) filter (where not typed_in_voice and reply_id is null and no_reply)::int no_reply,
              count(*) filter (where reply_id is not null and seconds < 0)::int invalid,
              count(*) filter (where reply_id is not null and seconds >= 0 and replaced)::int replaced
         from paired group by day
     )
     select (select json_agg(by_day order by day) from by_day) days,
            (select percentile_disc(0.5) within group (order by seconds) from paired where reply_id is not null and seconds >= 0)::float8 median,
            (select percentile_disc(0.9) within group (order by seconds) from paired where reply_id is not null and seconds >= 0)::float8 p90,
            (select count(*)::int from assistant_interactions v cross join bounds b
              where v.organization_id = ${org} and v.conversation_id in (select id from conversations) and v.role = 'assistant' and v.channel = 'voice'
                and v.occurred_at >= b.starts and v.occurred_at < b.ends) voice_answers`,
    p.values,
  )
  const row = result.rows[0]!
  const days = row.days ?? []
  const total = (key: keyof Omit<DayRow, "day" | "sum_seconds">) => days.reduce((sum, day) => sum + Number(day[key] ?? 0), 0)
  const questions = total("questions")
  const measured = total("measured")
  const noReply = total("no_reply")
  const invalid = total("invalid")
  const noKey = total("no_key")
  const average = weightedAverage(days.map((day) => ({ sum: Number(day.sum_seconds ?? 0), count: Number(day.measured) })))
  const series = foldByBucket(days, query, () => ({ questions: 0, measured: 0, sum: 0 }), (totals, day) => {
    totals.questions += Number(day.questions)
    totals.measured += Number(day.measured)
    totals.sum += Number(day.sum_seconds ?? 0)
  }).map(({ bucket, totals }) => ({ bucket, questions: totals.questions, measured: totals.measured, average: weightedAverage([{ sum: totals.sum, count: totals.measured }]) }))
  const percentile = (value: number | null) => (measured >= SUCCESS_MIN_SAMPLE && value !== null ? Number(value) : null)
  return {
    text: {
      average,
      medianSeconds: percentile(row.median),
      p90Seconds: percentile(row.p90),
      questions,
      measured,
      coverage: rate(measured, questions),
      noReply,
      noKey,
      unpaired: questions - measured - noReply - invalid - noKey,
      invalid,
      replacedByCheck: total("replaced"),
    },
    voice: { status: "NOT_MEASURED", answers: row.voice_answers ?? 0, typedQuestions: total("typed_in_voice") },
    series,
  }
}
