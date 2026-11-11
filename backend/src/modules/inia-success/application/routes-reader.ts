import { SqlParams } from "../../../shared/infrastructure/sql-params.js"
import { scopedPeopleSql } from "../../access/application/scope-people-reader.js"
import { SPECIALTY_KIND_LABELS, type SpecialtyKind } from "../../agents/domain/agent-specialty.js"
import { CLARIFICATION_TOOL_NAME } from "../../knowledge-clarification/domain/clarification-state.js"
import { directRouteLabel, NON_ROUTE_TOOLS, rankRoutes, rate, type Rate, type RouteItem, type RouteRow } from "../domain/success-metrics.js"
import { boundsCte, placementFilter, type Queryable, type SuccessQuery, type SuccessViewer } from "./success-query.js"

/**
 * MOTIVOS DE PROCURA À INIA — pela ROTA que a própria INIA escolheu para responder (dado estruturado já gravado; nenhuma IA nova,
 * nenhuma palavra-chave): o Especialista acionado (`assistant_interaction_agents`, papel SPECIALIST executado, com o domínio de
 * negócio do Agent) e as ferramentas diretas do backend (`tool_calls`). É o assunto como a INIA o entendeu, não uma classificação
 * humana; não é o motivo da chamada do cliente nem o motivo de uma avaliação negativa.
 *
 * Base: respostas da INIA no chat livre (`origin = USER`), por texto e voz, no período (data da resposta), no alcance de
 * `assistant_conversations.view` — menos a etapa de esclarecimento ainda aguardando escolha (pergunta, não resposta: a regra do M1).
 * Uma resposta pode ter mais de uma rota: as participações podem somar mais de 100%.
 */
export type RoutesSummary = {
  answers: number
  routes: RouteItem[]
  others: { routes: number; answers: number } | null
  /** Respostas sem especialista executado nem ferramenta direta (o Orquestrador respondeu sozinho). */
  withoutRoute: { answers: number; share: Rate }
  /** Respostas com duas ou mais rotas (por que a soma passa de 100%). */
  multiRoute: number
  byChannel: { chat: number; voice: number }
}

const AWAITING_CHOICE = `$[*] ? (@.toolName == "${CLARIFICATION_TOOL_NAME}" && @.state.status == "OPEN")`

export async function routesSummary(db: Queryable, viewer: SuccessViewer, query: SuccessQuery): Promise<RoutesSummary> {
  const p = new SqlParams()
  const org = p.typed(viewer.organizationId, "uuid")
  const bounds = boundsCte(p, viewer.organizationId, query)
  const scope = scopedPeopleSql(p, { organizationId: viewer.organizationId, viewerPersonId: viewer.personId, permission: "assistant_conversations.view" })
  const placed = placementFilter(p, query)
  const awaiting = p.typed(AWAITING_CHOICE, "jsonpath")
  const nonRoute = p.typed([...NON_ROUTE_TOOLS], "text[]")
  const result = await db.query<{ answers: number; chat: number; voice: number; without_route: number; multi_route: number; specialists: { key: string; label: string; business_domain: string | null; specialty: string | null; answers: number }[] | null; tools: { tool: string; answers: number }[] | null }>(
    `with ${bounds},
     scope as (${scope}),
     answers as (
       select i.id, i.channel, case when jsonb_typeof(i.tool_calls) = 'array' then i.tool_calls else '[]'::jsonb end tool_calls
         from assistant_interactions i
         join assistant_conversations c on c.id = i.conversation_id and c.organization_id = ${org} and c.origin = 'USER'
         join people p on p.id = c.owner_person_id
         left join subteams st on st.id = p.subteam_id
         cross join bounds b
        where i.organization_id = ${org} and i.role = 'assistant' and i.occurred_at >= b.starts and i.occurred_at < b.ends
          and c.owner_person_id in (select person_id from scope) and ${placed}
          and not jsonb_path_exists(case when jsonb_typeof(i.tool_calls) = 'array' then i.tool_calls else '[]'::jsonb end, ${awaiting})
     ),
     specialist as (
       select distinct a.id answer_id, ia.agent_id
         from answers a join assistant_interaction_agents ia on ia.interaction_id = a.id and ia.role = 'SPECIALIST' and ia.outcome = 'EXECUTED'
     ),
     tool as (
       select distinct a.id answer_id, t->>'toolName' tool
         from answers a, jsonb_array_elements(a.tool_calls) t
        where t->>'toolName' is not null and t->>'toolName' <> all(${nonRoute}) and t->>'toolName' !~ '^agent_[0-9a-f]{32}$'
     ),
     routes_per_answer as (
       select a.id, (select count(*) from specialist s where s.answer_id = a.id) + (select count(*) from tool t where t.answer_id = a.id) routes
         from answers a
     )
     select (select count(*)::int from answers) answers,
            (select count(*)::int from answers where channel = 'chat') chat,
            (select count(*)::int from answers where channel = 'voice') voice,
            (select count(*)::int from routes_per_answer where routes = 0) without_route,
            (select count(*)::int from routes_per_answer where routes >= 2) multi_route,
            (select json_agg(x) from (
               select ag.id::text key, ag.name label, bd.name business_domain, ag.specialty, count(*)::int answers
                 from specialist s join agents_all ag on ag.id = s.agent_id
                 left join business_domains_all bd on bd.id = ag.business_domain_id
                group by ag.id, ag.name, bd.name, ag.specialty
            ) x) specialists,
            (select json_agg(y) from (select tool, count(*)::int answers from tool group by tool) y) tools`,
    p.values,
  )
  const row = result.rows[0]!
  const answers = row.answers ?? 0
  const specialtyLabel = (specialty: string | null) => (specialty && specialty in SPECIALTY_KIND_LABELS ? SPECIALTY_KIND_LABELS[specialty as SpecialtyKind] : specialty)
  const rows: RouteRow[] = [
    ...(row.specialists ?? []).map((item): RouteRow => ({ kind: "SPECIALIST", key: `agent:${item.key}`, label: item.label, detail: item.business_domain ?? specialtyLabel(item.specialty), answers: item.answers })),
    ...(row.tools ?? []).map((item): RouteRow => ({ kind: "DIRECT", key: `tool:${item.tool}`, label: directRouteLabel(item.tool), detail: null, answers: item.answers })),
  ]
  const ranked = rankRoutes(rows, answers)
  return {
    answers,
    routes: ranked.items,
    others: ranked.others,
    withoutRoute: { answers: row.without_route ?? 0, share: rate(row.without_route ?? 0, answers) },
    multiRoute: row.multi_route ?? 0,
    byChannel: { chat: row.chat ?? 0, voice: row.voice ?? 0 },
  }
}

