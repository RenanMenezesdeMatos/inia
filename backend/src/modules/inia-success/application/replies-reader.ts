import { SqlParams } from "../../../shared/infrastructure/sql-params.js"
import { replyFunnel, type FunnelPlacement, type ReplyFunnel } from "../../assistant/application/reply-funnel.js"
import { CLARIFICATION_TOOL_NAME } from "../../knowledge-clarification/domain/clarification-state.js"
import { coordinatorScopesOf } from "../../human-support/application/coverage.js"
import { foldByBucket, rate, type Bucket, type Rate } from "../domain/success-metrics.js"
import { boundsCte, localDay, placementFilter, type Queryable, type SuccessQuery, type SuccessViewer } from "./success-query.js"

/**
 * AVALIAÇÃO DAS RESPOSTAS DA INIA NO CHAT (curtir/descurtir, motivo da descurtida, "ainda precisa de ajuda?") e SINAIS DA RESPOSTA
 * (calculados por código no turno). Os totais vêm do leitor oficial — o funil M1–M6 (`assistant/application/reply-funnel.ts`) —
 * no mesmo alcance do painel do apoio (`human_support.coordinate`, decisão D7: números de avaliação da INIA só para o Coordenador de
 * Anjos e o Administrador geral). A evolução e a divisão por canal saem de uma consulta agrupada por dia com AS MESMAS regras do
 * funil (avaliação vigente; retirada não conta; etapa de esclarecimento aguardando escolha não é resposta) — a prova
 * `inia-success-proof` confere que a soma dos dias bate com o funil.
 *
 * Referência temporal: data da RESPOSTA (coorte = respostas do período, com a avaliação vigente hoje).
 */
export type RepliesSeriesPoint = { bucket: Bucket; answers: number; up: number; down: number; positive: Rate; withSignalRow: number; withSignal: number; signalRate: Rate }
export type RepliesSummary = {
  funnel: ReplyFunnel
  byChannel: { channel: "chat" | "voice"; answers: number; up: number; down: number; positive: Rate; rated: Rate }[]
  series: RepliesSeriesPoint[]
}

const AWAITING_CHOICE = `$[*] ? (@.toolName == "${CLARIFICATION_TOOL_NAME}" && @.state.status == "OPEN")`

export async function placementOfCoordinator(db: Queryable, viewer: SuccessViewer): Promise<FunnelPlacement> {
  const coverage = await coordinatorScopesOf(db, viewer.organizationId, viewer.personId)
  return coverage.organizationWide ? { kind: "ORGANIZATION" } : { kind: "UNITS", teamIds: coverage.teamIds, subteamIds: coverage.subteamIds }
}

/** Recorte do funil (organização ou Grupos/Subgrupos de quem coordena) sobre a pessoa `p` e o Subgrupo `st`. */
function placementScope(p: SqlParams, placement: FunnelPlacement): string {
  if (placement.kind === "ORGANIZATION") return "true"
  const teams = p.typed([...placement.teamIds], "uuid[]")
  return `((p.team_id = any(${teams}) or st.team_id = any(${teams})) or p.subteam_id = any(${p.typed([...placement.subteamIds], "uuid[]")}))`
}

type DayRow = { day: string; channel: "chat" | "voice"; answers: number; up: number; down: number; with_signal_row: number; with_signal: number }

export async function repliesDaily(db: Queryable, viewer: SuccessViewer, query: SuccessQuery, placement: FunnelPlacement): Promise<DayRow[]> {
  const p = new SqlParams()
  const org = p.typed(viewer.organizationId, "uuid")
  const bounds = boundsCte(p, viewer.organizationId, query)
  const scoped = placementScope(p, placement)
  const placed = placementFilter(p, query)
  const awaiting = p.typed(AWAITING_CHOICE, "jsonpath")
  const result = await db.query<DayRow>(
    `with ${bounds},
     answers as (
       select i.id, i.channel, ${localDay("i.occurred_at")} as day
         from assistant_interactions i
         join assistant_conversations c on c.id = i.conversation_id and c.origin = 'USER' and c.organization_id = ${org}
         join people p on p.id = c.owner_person_id
         left join subteams st on st.id = p.subteam_id
         cross join bounds b
        where i.organization_id = ${org} and i.occurred_at >= b.starts and i.occurred_at < b.ends and i.role = 'assistant'
          and ${scoped} and ${placed}
          and not jsonb_path_exists(coalesce(i.tool_calls, '[]'::jsonb), ${awaiting})
     )
     select a.day, a.channel, count(*)::int answers,
            count(*) filter (where r.value = 'UP')::int up, count(*) filter (where r.value = 'DOWN')::int down,
            count(s.interaction_id)::int with_signal_row, count(*) filter (where cardinality(s.signals) > 0)::int with_signal
       from answers a
       left join lateral (
         select v.value from assistant_interaction_ratings v
          where v.interaction_id = a.id and v.organization_id = ${org} and v.superseded_at is null and v.value <> 'NONE'
          order by v.created_at desc, v.id desc limit 1
       ) r on true
       left join assistant_reply_signals s on s.interaction_id = a.id
      group by a.day, a.channel`,
    p.values,
  )
  return result.rows
}

export async function repliesSummary(db: Queryable, viewer: SuccessViewer, query: SuccessQuery): Promise<RepliesSummary> {
  const placement = await placementOfCoordinator(db, viewer)
  const [funnel, days] = await Promise.all([
    replyFunnel(db, viewer.organizationId, { from: query.from, to: query.to }, placement, { teamId: query.teamId ?? null, subteamId: query.subteamId ?? null }),
    repliesDaily(db, viewer, query, placement),
  ])
  const byChannel = (["chat", "voice"] as const).map((channel) => {
    const rows = days.filter((day) => day.channel === channel)
    const answers = rows.reduce((sum, row) => sum + row.answers, 0)
    const up = rows.reduce((sum, row) => sum + row.up, 0)
    const down = rows.reduce((sum, row) => sum + row.down, 0)
    return { channel, answers, up, down, positive: rate(up, up + down), rated: rate(up + down, answers) }
  })
  const series = foldByBucket(days, query, () => ({ answers: 0, up: 0, down: 0, withSignalRow: 0, withSignal: 0 }), (totals, day) => {
    totals.answers += day.answers
    totals.up += day.up
    totals.down += day.down
    totals.withSignalRow += day.with_signal_row
    totals.withSignal += day.with_signal
  }).map(({ bucket, totals }) => ({ bucket, ...totals, positive: rate(totals.up, totals.up + totals.down), signalRate: rate(totals.withSignal, totals.withSignalRow) }))
  return { funnel, byChannel, series }
}
