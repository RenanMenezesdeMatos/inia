import type { Database } from "../../../infrastructure/database/pool.js"
import { subjectKeySql } from "../../interactions/domain/interaction-subject.js"
import { feedbackBestPracticesOf, isFeedbackBestPractices, MAX_FEEDBACK_PRACTICES, type FeedbackBestPractices } from "../domain/feedback-section.js"
import type { Placement, Subject } from "../domain/selection-levels.js"
import { AVAILABLE_SQL } from "./pattern-service.js"
import { leveledPracticesFor, type LeveledPractice } from "./recommendations.js"

type Queryable = Pick<Database, "query">

/**
 * Seção de boas práticas de um feedback (motor de feedback, depois da redação — o texto do feedback não muda). 1 a 2 práticas pelo
 * recuo (`BEST_PRACTICE_SELECTION_V1`: subgrupo + submotivo → grupo + submotivo → subgrupo + motivo → grupo + motivo):
 *  - INDICADOR: práticas do indicador investigado, nos assuntos onde a investigação localizou o problema (na ordem dela); sem
 *    assunto localizado, nos assuntos das chamadas da pessoa no período;
 *  - MONITORIA: no assunto da chamada (motivo + submotivo), pelas melhores CHAMADAS do sinal que disparou o feedback (ex.: nota da
 *    URA boa × ruim); sem prática do sinal, pelos melhores no indicador relacionado ao sinal (cadastro do sinal); sem sinal no
 *    gatilho, práticas de qualquer resultado no assunto.
 * Só dados reais da população da pessoa (Grupo/Subgrupo do cadastro). Falha aqui nunca derruba o feedback (quem chama ignora).
 * `BEST_PRACTICE_SELECTION_V2` (`PRODUCT_IN_FEEDBACK_V1`): com `products` (os produtos estabelecidos no caso), a prática vista só nas
 * chamadas de um produto só entra quando o caso é daquele produto; sem produto estabelecido, só as gerais.
 */
export type FeedbackPracticeInput = {
  organizationId: string
  personId: string
  domain: "MONITORING" | "INDICATOR"
  interactionId: string | null
  /** MONITORIA: nome do sinal que disparou o Workflow (`workflow_enrollments.matched_flag_name`); nulo = sem sinal no gatilho. */
  signalFlagName?: string | null
  /** `subjectKeys`: chaves de assunto (`subjectKeySql`) onde a investigação localizou o problema, da mais à menos importante. */
  indicators: readonly { indicatorId: string; periodStart: string; periodEnd: string; subjectKeys?: readonly string[] }[]
  /** Produtos ESTABELECIDOS no caso (nomes do cadastro): os da chamada na monitoria, os das chamadas do problema no indicador. */
  products?: readonly string[]
}

async function placementOf(db: Queryable, organizationId: string, personId: string): Promise<Placement | null> {
  const row = (await db.query<{ team_id: string | null; team_name: string | null; subteam_id: string | null; subteam_name: string | null }>(
    `select p.team_id, t.name team_name, p.subteam_id, s.name subteam_name
       from people p left join teams t on t.id = p.team_id left join subteams s on s.id = p.subteam_id
      where p.id = $1 and p.organization_id = $2`,
    [personId, organizationId],
  )).rows[0]
  return row?.team_id ? { teamId: row.team_id, teamName: row.team_name ?? "", subteamId: row.subteam_id, subteamName: row.subteam_name } : null
}

/** Assuntos (motivo + submotivo) das chamadas da pessoa no período, do mais frequente ao menos — no máximo 12. */
async function subjectsInPeriod(db: Queryable, organizationId: string, personId: string, start: string, end: string): Promise<Subject[]> {
  return (await db.query<{ reason: string; sub_reason: string | null }>(
    `select reason, nullif(btrim(sub_reason), '') sub_reason, count(*) total from interactions
      where organization_id = $1 and operator_id = $2 and started_at >= $3::date and started_at < $4::date + 1
      group by 1, 2 order by total desc, 1, 2 limit 12`,
    [organizationId, personId, start, end],
  )).rows.map((row) => ({ reason: row.reason, subReason: row.sub_reason }))
}

/** Motivo + submotivo de cada assunto localizado (a chave pode ser o código canônico de vários textos), na ordem das chaves. */
async function subjectsOfKeys(db: Queryable, organizationId: string, personId: string, start: string, end: string, keys: readonly string[]): Promise<Subject[]> {
  const rows = (await db.query<{ reason: string; sub_reason: string | null; subject_key: string; total: number }>(
    `select i.reason, nullif(btrim(i.sub_reason), '') sub_reason, ${subjectKeySql("i")} subject_key, count(*)::int total from interactions i
      where i.organization_id = $1 and i.operator_id = $2 and i.started_at >= $3::date and i.started_at < $4::date + 1 and ${subjectKeySql("i")} = any($5::text[])
      group by 1, 2, 3`,
    [organizationId, personId, start, end, [...keys]],
  )).rows
  return keys.flatMap((key) => rows.filter((row) => row.subject_key === key).sort((a, b) => b.total - a.total).map((row) => ({ reason: row.reason, subReason: row.sub_reason })))
}

export async function buildFeedbackBestPractices(db: Queryable, input: FeedbackPracticeInput): Promise<FeedbackBestPractices | null> {
  const placement = await placementOf(db, input.organizationId, input.personId)
  if (!placement) return null
  const found: LeveledPractice[] = []
  const take = async (outcome: { indicatorId: string | null; channelFlagId?: string | null }, subjects: readonly Subject[]) => {
    if (subjects.length === 0 || found.length >= MAX_FEEDBACK_PRACTICES) return
    for (const practice of await leveledPracticesFor(db, { organizationId: input.organizationId, ...outcome, placement, subjects, who: { personId: input.personId }, limit: MAX_FEEDBACK_PRACTICES, ...(input.products ? { products: input.products } : {}) })) {
      if (found.length < MAX_FEEDBACK_PRACTICES && !found.some((entry) => entry.row.id === practice.row.id)) found.push(practice)
    }
  }
  if (input.domain === "MONITORING") {
    if (!input.interactionId) return null
    const call = (await db.query<{ reason: string; sub_reason: string | null; channel: string | null }>(`select reason, nullif(btrim(sub_reason), '') sub_reason, channel from interactions where id = $1 and organization_id = $2`, [input.interactionId, input.organizationId])).rows[0]
    if (!call) return null
    const subjects = [{ reason: call.reason, subReason: call.sub_reason }]
    const signal = input.signalFlagName
      ? (await db.query<{ id: string; related_indicator_definition_id: string | null }>(`select id, related_indicator_definition_id from channel_flags where organization_id = $1 and flag_name = $2 and channel = coalesce($3, channel) order by (channel = $3) desc limit 1`, [input.organizationId, input.signalFlagName, call.channel])).rows[0] ?? null
      : null
    if (signal) {
      await take({ indicatorId: null, channelFlagId: signal.id }, subjects)
      if (found.length === 0 && signal.related_indicator_definition_id) await take({ indicatorId: signal.related_indicator_definition_id }, subjects)
    } else await take({ indicatorId: null }, subjects)
  } else {
    for (const indicator of input.indicators) {
      const located = indicator.subjectKeys && indicator.subjectKeys.length > 0 ? await subjectsOfKeys(db, input.organizationId, input.personId, indicator.periodStart, indicator.periodEnd, indicator.subjectKeys) : []
      await take({ indicatorId: indicator.indicatorId }, located.length > 0 ? located : await subjectsInPeriod(db, input.organizationId, input.personId, indicator.periodStart, indicator.periodEnd))
    }
  }
  return feedbackBestPracticesOf(found.map((practice) => ({ item: practice.item, indicatorName: practice.row.indicatorName, from: practice.from, product: practice.product ?? null })))
}

/** LEITURA de um feedback publicado: some o item cujo padrão não está mais disponível (uma consulta para a página inteira). */
export async function withCurrentBestPractices<T extends { bestPractices?: unknown }>(db: Queryable, organizationId: string, views: readonly (T | null)[]): Promise<(T | null)[]> {
  const ids = [...new Set(views.flatMap((view) => (view && isFeedbackBestPractices(view.bestPractices) ? view.bestPractices.items.map((item) => item.patternId) : [])))]
  if (ids.length === 0) return [...views]
  const available = new Set((await db.query<{ id: string }>(`select p.id from best_practice_patterns p where p.organization_id = $1 and p.id = any($2::uuid[]) and ${AVAILABLE_SQL}`, [organizationId, ids])).rows.map((row) => row.id))
  return views.map((view) => {
    if (!view || !isFeedbackBestPractices(view.bestPractices)) return view
    const items = view.bestPractices.items.filter((item) => available.has(item.patternId))
    return { ...view, bestPractices: items.length > 0 ? { ...view.bestPractices, items } : null }
  })
}
