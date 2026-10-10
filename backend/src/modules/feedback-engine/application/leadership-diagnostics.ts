import type { Database } from "../../../infrastructure/database/pool.js"
import { projectTranscript } from "../../investigation/domain/transcript-projection.js"
import { resolveOrganizationTimezone } from "../../workflows/application/organization-timezone.js"
import { effectiveCriterionStatusSql, practiceOfRowSql, reviewSettledSql } from "../infrastructure/postgres-feedback-memory-store.js"

/**
 * DIAGNÓSTICO DA LIDERANÇA — consultas sobre a MEMÓRIA do motor (nunca chama modelo; só dado persistido).
 *
 * Toda consulta recebe o CONJUNTO de pessoas que o leitor pode ver (escopo resolvido na rota: subárvore + permissão) — nada de
 * outra organização, nada fora da hierarquia. Os números são contagens da projeção VIGENTE (um registro por chamada × critério),
 * com o método explícito:
 *   avaliadas      = chamadas × critério com disposição cumprida / não cumprida / parcial (o DENOMINADOR);
 *   desvio         = não cumprida + parcial;  taxa de desvio = desvio / avaliadas;
 *   inconclusivas  = não observável + não avaliada + conclusão NÃO CONFIRMADA pela revisão (fora do denominador, sempre mostradas);
 *   não aplicáveis = a condição da regra não ocorreu (fora do denominador);
 *   fora da conversa = parte das inconclusivas cujo cumprimento acontece em sistema/registro (limite de cobertura da gravação).
 * Todas essas contagens são POR REGRA (uma linha = uma regra numa chamada). À parte, as OCORRÊNCIAS de conduta
 * (`CONDUCT_OCCURRENCE_V1`): quando a revisão ligou duas regras à MESMA conduta no mesmo momento (ex.: o protocolo não dito antes de
 * transferir contraria duas regras), elas contam como UMA ocorrência — sempre dentro da mesma chamada, nunca por texto parecido. A
 * taxa por ocorrência usa só as regras cuja ligação é determinável; registros antigos (sem a ligação) ficam de fora dela e são
 * contados à parte como "sem ligação determinável" — nunca viram ocorrências únicas nem repetidas.
 * Critérios de ARGUMENTÁRIO entram como os da base (a origem aparece no lugar do documento).
 * Estrutura (Grupo/Subgrupo) = a vigente NO MOMENTO DA ANÁLISE de cada chamada (não há histórico organizacional confiável).
 */
type Queryable = Pick<Database, "query">

export type MemoryFilters = {
  from: string
  to: string
  teamId: string | null
  subteamId: string | null
  personId: string | null
  subject: string | null
  documentId: string | null
  criterionKey: string | null
  /** Situação exata (MET, NOT_MET…) ou grupo: DEVIATION = não cumprida + parcial; INCONCLUSIVE = não observável + não avaliada. */
  status: string | null
  /** `PRACTICE_IDENTITY_V1`: só as regras desta prática (a mesma conduta em qualquer linha, seção, documento ou argumentário). */
  practiceKey?: string | null
}
/** `outsideConversation` ⊂ inconclusivas: exigências cujo cumprimento acontece fora da conversa (sistema/registro) — limite de
 * COBERTURA da gravação, nunca erro nem acerto (fora do denominador). */
/** `conversationPartOnly` ⊂ avaliadas: obrigação MISTA cuja conclusão vale só para a parte da conversa (a parte operacional é limite de
 * cobertura) — "cumprida" ali nunca quer dizer que a execução em sistema aconteceu (`OBLIGATION_SPEECH_EXECUTION_V1`). */
export type Stats = { calls: number; assessed: number; met: number; notMet: number; partial: number; inconclusive: number; notApplicable: number; outsideConversation: number; conversationPartOnly: number; deviationRate: number | null; coverageRate: number | null; occurrences: OccurrenceStats }
/**
 * OCORRÊNCIAS de conduta (denominador próprio): `assessed` = condutas distintas avaliadas (cumpridas, não cumpridas, parciais) entre as
 * regras com ligação determinável; `deviations` = condutas distintas em desvio; `deviationRate` = deviations / assessed. `assessedRules`
 * / `deviationRules` = as regras por trás delas; `sharedDeviationRules` = regras em desvio que são a mesma conduta de outra regra.
 * `undeterminedAssessedRules` = regras avaliadas SEM ligação determinável (análises antigas) — fora da taxa por ocorrência.
 * `basis`: FULL (todas determináveis), PARTIAL (só parte), NONE (nenhuma — a taxa não existe), EMPTY (nada avaliado).
 */
export type OccurrenceStats = { basis: "FULL" | "PARTIAL" | "NONE" | "EMPTY"; assessed: number; deviations: number; met: number; assessedRules: number; deviationRules: number; sharedDeviationRules: number; undeterminedAssessedRules: number; deviationRate: number | null }

/**
 * Status EFETIVO para agregação: só conclusão CONFIRMADA conta como acerto/desvio (`CALL_ANALYSIS_LOGIC_V4`). Leitura antiga
 * (V1–V3, sem confirmação registrada) ou hipótese não confirmada conta como inconclusiva — o histórico fica, a contagem não mente.
 */
// Pendência técnica antiga (revisão que não aconteceu, gravada como resultado) fica fora de toda agregação até ser retomada.
// PRÁTICA de cada linha (`PRACTICE_IDENTITY_V1`): a da linha-âncora da regra, organizada pela leitura do modelo; sem decisão ainda, a
// identidade da própria linha (como antes) — nunca semelhança de texto. TEMA e NOME CURTO (`PRACTICE_THEMES_V1`) vêm da prática.
// `point_label` = como o ponto aparece numa lista: nome curto → título da conduta → (ainda não organizado) a ação exigida que a análise
// leu → a primeira linha da regra. Nunca o texto inteiro de várias linhas.
const EFFECTIVE_CRITERIA_SQL = `(select c0.*, ${effectiveCriterionStatusSql("c0")} effective_status,
    coalesce(pm0.practice_key, kc0.criterion_key, c0.criterion_key) practice_key, kp0.title practice_title, kp0.short_title practice_short_title,
    kp0.theme_key practice_theme_key, kt0.title practice_theme_title,
    coalesce(kp0.short_title, kp0.title, nullif(btrim(c0.verification->>'requiredAction'), ''), split_part(c0.criterion_text, E'\n', 1)) point_label
  from call_criterion_assessments c0
  left join knowledge_criteria kc0 on kc0.organization_id = c0.organization_id and kc0.document_id = c0.document_id and kc0.document_version = c0.document_version and kc0.line_key = split_part(c0.verification->>'lineKey', '#', 1)
  left join lateral (${practiceOfRowSql("c0")}) pm0 on true
  left join knowledge_practices kp0 on kp0.organization_id = c0.organization_id and kp0.practice_key = pm0.practice_key
  left join knowledge_practice_themes kt0 on kt0.organization_id = kp0.organization_id and kt0.theme_key = kp0.theme_key
  where ${reviewSettledSql("c0")})`
const STATS_SQL = `count(distinct c.interaction_id)::int calls,
  count(*) filter (where c.effective_status in ('MET','NOT_MET','PARTIAL'))::int assessed,
  count(*) filter (where c.effective_status = 'MET')::int met,
  count(*) filter (where c.effective_status = 'NOT_MET')::int not_met,
  count(*) filter (where c.effective_status = 'PARTIAL')::int partial,
  count(*) filter (where c.effective_status in ('NOT_OBSERVABLE','NOT_ASSESSED'))::int inconclusive,
  count(*) filter (where c.effective_status = 'NOT_APPLICABLE')::int not_applicable,
  count(*) filter (where c.effective_status in ('NOT_OBSERVABLE','NOT_ASSESSED') and c.observability = 'OUTSIDE_CONVERSATION')::int outside_conversation,
  count(*) filter (where c.effective_status in ('MET','NOT_MET','PARTIAL') and nullif(c.verification->>'judgedPart', '') is not null)::int conversation_part_only,
  count(distinct c.interaction_id::text || ':' || c.occurrence_key) filter (where c.effective_status in ('MET','NOT_MET','PARTIAL') and c.occurrence_basis is not null)::int occ_assessed,
  count(distinct c.interaction_id::text || ':' || c.occurrence_key) filter (where c.effective_status in ('NOT_MET','PARTIAL') and c.occurrence_basis is not null)::int occ_deviations,
  count(distinct c.interaction_id::text || ':' || c.occurrence_key) filter (where c.effective_status = 'MET' and c.occurrence_basis is not null)::int occ_met,
  count(*) filter (where c.effective_status in ('MET','NOT_MET','PARTIAL') and c.occurrence_basis is not null)::int occ_assessed_rules,
  count(*) filter (where c.effective_status in ('NOT_MET','PARTIAL') and c.occurrence_basis is not null)::int occ_deviation_rules,
  count(*) filter (where c.effective_status in ('NOT_MET','PARTIAL') and c.occurrence_basis = 'REVIEW_SAME_CONDUCT')::int occ_shared_deviation_rules,
  count(*) filter (where c.effective_status in ('MET','NOT_MET','PARTIAL') and c.occurrence_basis is null)::int occ_undetermined_rules`
type StatsRow = { calls: number; assessed: number; met: number; not_met: number; partial: number; inconclusive: number; not_applicable: number; outside_conversation?: number; conversation_part_only?: number; occ_assessed?: number; occ_deviations?: number; occ_met?: number; occ_assessed_rules?: number; occ_deviation_rules?: number; occ_shared_deviation_rules?: number; occ_undetermined_rules?: number }
const round = (value: number) => Math.round(value * 1000) / 10
export const statsOf = (row: StatsRow): Stats => ({
  calls: row.calls,
  assessed: row.assessed,
  met: row.met,
  notMet: row.not_met,
  partial: row.partial,
  inconclusive: row.inconclusive,
  notApplicable: row.not_applicable,
  outsideConversation: row.outside_conversation ?? 0,
  conversationPartOnly: row.conversation_part_only ?? 0,
  deviationRate: row.assessed > 0 ? round((row.not_met + row.partial) / row.assessed) : null,
  coverageRate: row.assessed + row.inconclusive > 0 ? round(row.assessed / (row.assessed + row.inconclusive)) : null,
  occurrences: occurrenceStatsOf(row),
})
export function occurrenceStatsOf(row: StatsRow): OccurrenceStats {
  const assessedRules = row.occ_assessed_rules ?? 0
  const undetermined = row.occ_undetermined_rules ?? row.assessed - assessedRules
  const assessed = row.occ_assessed ?? 0
  const basis: OccurrenceStats["basis"] = assessedRules + undetermined === 0 ? "EMPTY" : assessedRules === 0 ? "NONE" : undetermined > 0 ? "PARTIAL" : "FULL"
  return {
    basis,
    assessed,
    deviations: row.occ_deviations ?? 0,
    met: row.occ_met ?? 0,
    assessedRules,
    deviationRules: row.occ_deviation_rules ?? 0,
    sharedDeviationRules: row.occ_shared_deviation_rules ?? 0,
    undeterminedAssessedRules: undetermined,
    deviationRate: assessed > 0 ? round((row.occ_deviations ?? 0) / assessed) : null,
  }
}

/** WHERE comum (parâmetros $1..$12): organização, pessoas visíveis, período e filtros. */
function baseWhere(): string {
  return `c.organization_id = $1 and c.is_current and c.person_id = any($2::uuid[]) and c.local_date between $3::date and $4::date
    and ($5::uuid is null or c.team_id = $5) and ($6::uuid is null or c.subteam_id = $6) and ($7::uuid is null or c.person_id = $7)
    and ($8::text is null or coalesce(c.subject_canonical, c.subject_raw) = $8) and ($9::uuid is null or coalesce(c.document_id, c.argument_script_id) = $9)
    and ($10::text is null or c.criterion_key = $10) and ($11::text is null or c.effective_status = $11 or ($11 = 'DEVIATION' and c.effective_status in ('NOT_MET','PARTIAL')) or ($11 = 'INCONCLUSIVE' and c.effective_status in ('NOT_OBSERVABLE','NOT_ASSESSED')))
    and ($12::text is null or c.practice_key = $12)`
}
const params = (organizationId: string, personIds: readonly string[], filters: MemoryFilters) => [organizationId, [...personIds], filters.from, filters.to, filters.teamId, filters.subteamId, filters.personId, filters.subject, filters.documentId, filters.criterionKey, filters.status, filters.practiceKey ?? null]

export async function memorySummary(db: Queryable, organizationId: string, personIds: readonly string[], filters: MemoryFilters) {
  const row = (await db.query<StatsRow & { criteria: number; people: number; last_analysis: Date | null }>(
    `select ${STATS_SQL}, count(distinct c.criterion_key)::int criteria, count(distinct c.person_id)::int people, max(c.created_at) last_analysis
     from ${EFFECTIVE_CRITERIA_SQL} c where ${baseWhere()}`,
    params(organizationId, personIds, filters),
  )).rows[0]!
  const calls = (await db.query<{ total: number; usable: number; partial: number; insufficient: number; path_incorrect: number; path_assessed: number }>(
    `select count(*)::int total, count(*) filter (where a.outcome = 'USABLE')::int usable, count(*) filter (where a.outcome = 'PARTIAL')::int partial, count(*) filter (where a.outcome = 'INSUFFICIENT_EVIDENCE')::int insufficient,
            count(*) filter (where a.path_assessment in ('INCORRECT','PARTIALLY_CORRECT'))::int path_incorrect, count(*) filter (where a.path_assessment in ('CORRECT','INCORRECT','PARTIALLY_CORRECT'))::int path_assessed
     from call_assessments a
     where a.organization_id = $1 and a.is_current and ${reviewSettledSql("a")} and a.person_id = any($2::uuid[]) and a.local_date between $3::date and $4::date
       and ($5::uuid is null or a.team_id = $5) and ($6::uuid is null or a.subteam_id = $6) and ($7::uuid is null or a.person_id = $7) and ($8::text is null or coalesce(a.subject_canonical, a.subject_raw) = $8)`,
    [organizationId, [...personIds], filters.from, filters.to, filters.teamId, filters.subteamId, filters.personId, filters.subject],
  )).rows[0]!
  return { stats: statsOf(row), criteria: row.criteria, people: row.people, lastAnalysisAt: row.last_analysis, callOutcomes: calls }
}

/**
 * PONTOS DO PROCESSO por TEMA (`PRACTICE_IDENTITY_V1` + `PRACTICE_THEMES_V1`): o tema é o momento ou assunto do atendimento; dentro dele,
 * um ponto por PRÁTICA — a mesma conduta escrita em outra seção, documento, checklist ou argumentário entra no MESMO ponto, com as
 * fontes listadas. O ponto aparece pelo NOME CURTO e traz a conduta completa como descrição. Ponto ainda sem tema fica num grupo à parte
 * (`themeKey` null); ponto ainda não organizado aparece pela ação exigida que a análise leu (nunca pelo texto de várias linhas).
 * Contagens do tema são da consulta (pessoas e chamadas distintas não se somam). `order`: DEVIATIONS = onde mais se erra (desvios, depois
 * taxa); MET = onde mais se acerta (cumpridas, depois taxa de desvio menor) — vale para os temas e para os pontos dentro de cada um.
 */
export type ProcessOrder = "DEVIATIONS" | "MET" | "ALL"
export type PracticeSource = { documentId: string; documentTitle: string; section: string | null; kind: "KNOWLEDGE" | "ARGUMENT_SCRIPT" }
type PointStatsRow = StatsRow & { people: number; people_with_deviation: number; people_with_met: number }
const PEOPLE_SQL = (alias: string) => `count(distinct ${alias}.person_id)::int people, count(distinct ${alias}.person_id) filter (where ${alias}.effective_status in ('NOT_MET','PARTIAL'))::int people_with_deviation,
  count(distinct ${alias}.person_id) filter (where ${alias}.effective_status = 'MET')::int people_with_met`
const ASSESSED_POINT = "count(*) filter (where c.effective_status in ('MET','NOT_MET','PARTIAL')) > 0"
/** Onde mais se erra (desvios, depois taxa) × onde mais se acerta (cumpridas, depois taxa menor) × todos (mais avaliados); empate pela
 * chave (estável). */
const orderBy = <T extends { met: number; notMet: number; partial: number; assessed: number }>(order: ProcessOrder, keyOf: (row: T) => string) => (a: T, b: T) => {
  const deviations = (row: T) => row.notMet + row.partial
  const rate = (row: T) => deviations(row) / Math.max(row.assessed, 1)
  if (order === "MET") return b.met - a.met || rate(a) - rate(b) || keyOf(a).localeCompare(keyOf(b))
  if (order === "ALL") return b.assessed - a.assessed || deviations(b) - deviations(a) || keyOf(a).localeCompare(keyOf(b))
  return deviations(b) - deviations(a) || rate(b) - rate(a) || keyOf(a).localeCompare(keyOf(b))
}
/** O ponto entra na visão: onde se erra = tem desvio; onde se acerta = tem acerto; todos = foi avaliado. */
const inView = (order: ProcessOrder, row: { met: number; notMet: number; partial: number }) => (order === "DEVIATIONS" ? row.notMet + row.partial > 0 : order === "MET" ? row.met > 0 : true)
export async function processAggregates(db: Queryable, organizationId: string, personIds: readonly string[], filters: MemoryFilters, order: ProcessOrder = "DEVIATIONS") {
  const points = (await db.query<PointStatsRow & { practice_key: string; practice_title: string | null; short_title: string | null; theme_key: string | null; point_label: string; sources: PracticeSource[]; rules: number }>(
    `select c.practice_key, max(c.practice_title) practice_title, max(c.practice_short_title) short_title, max(c.practice_theme_key) theme_key,
            (array_agg(c.point_label order by c.created_at desc))[1] point_label,
            (select jsonb_agg(distinct jsonb_build_object('documentId', s.document_id, 'documentTitle', s.document_title, 'section', s.section_heading, 'kind', s.kind))
               from unnest(array_agg(coalesce(c.document_id, c.argument_script_id)), array_agg(coalesce(d.title, asx.name)), array_agg(c.section_heading), array_agg(case when c.argument_script_id is not null then 'ARGUMENT_SCRIPT' else 'KNOWLEDGE' end))
                    s(document_id, document_title, section_heading, kind)) sources,
            count(distinct c.criterion_key)::int rules,
            ${STATS_SQL}, ${PEOPLE_SQL("c")}
     from ${EFFECTIVE_CRITERIA_SQL} c left join knowledge_documents d on d.id = c.document_id left join argument_scripts asx on asx.id = c.argument_script_id
     where ${baseWhere()}
     group by c.practice_key
     having ${ASSESSED_POINT}`,
    params(organizationId, personIds, filters),
  )).rows
  // Contagens do TEMA sobre os mesmos pontos listados (pontos só com leituras inconclusivas ficam fora dos dois).
  const themes = (await db.query<PointStatsRow & { theme_key: string; theme_title: string | null; points: number }>(
    `with base as (select c.* from ${EFFECTIVE_CRITERIA_SQL} c where ${baseWhere()}),
     listed as (select c.practice_key from base c group by c.practice_key having ${ASSESSED_POINT})
     select coalesce(b.practice_theme_key, '') theme_key, max(b.practice_theme_title) theme_title, count(distinct b.practice_key)::int points,
            ${STATS_SQL.replaceAll("c.", "b.")}, ${PEOPLE_SQL("b")}
       from base b join listed l on l.practice_key = b.practice_key
      group by 1`,
    params(organizationId, personIds, filters),
  )).rows
  const pointOf = (row: (typeof points)[number]) => ({
    practiceKey: row.practice_key,
    // Nome curto do ponto; a conduta completa vira a descrição. Não organizado: a ação que a análise leu (ou a 1ª linha da regra).
    title: row.point_label,
    description: row.short_title && row.practice_title ? row.practice_title : null,
    organized: row.practice_title !== null,
    rules: row.rules,
    sources: (row.sources ?? []).sort((a, b) => a.documentTitle.localeCompare(b.documentTitle, "pt-BR") || (a.section ?? "").localeCompare(b.section ?? "", "pt-BR")),
    people: row.people,
    peopleWithDeviation: row.people_with_deviation,
    peopleWithMet: row.people_with_met,
    ...statsOf(row),
  })
  const byPoint = orderBy<ReturnType<typeof pointOf>>(order, (point) => point.practiceKey)
  const byTheme = orderBy<Stats & { themeKey: string | null }>(order, (theme) => theme.themeKey ?? "")
  // As contagens do tema são do tema INTEIRO (todos os pontos avaliados); a lista traz só os pontos da visão. Tema sem ponto na visão sai.
  const grouped = themes.map((row) => ({
    themeKey: row.theme_key || null,
    title: row.theme_title,
    points: row.points,
    people: row.people,
    peopleWithDeviation: row.people_with_deviation,
    peopleWithMet: row.people_with_met,
    ...statsOf(row),
    items: points.filter((point) => (point.theme_key ?? "") === row.theme_key).map(pointOf).filter((point) => inView(order, point)).sort(byPoint),
  }))
    .filter((theme) => theme.items.length > 0)
    // Pontos ainda sem tema vêm por último, qualquer que seja a ordem (não são um tema).
    .sort((a, b) => Number(a.themeKey === null) - Number(b.themeKey === null) || byTheme(a, b))
  return { order, totalPoints: points.length, listedPoints: grouped.reduce((sum, theme) => sum + theme.items.length, 0), themes: grouped }
}

export type GroupBy = "PERSON" | "TEAM" | "SUBTEAM"
export async function peopleAggregates(db: Queryable, organizationId: string, personIds: readonly string[], filters: MemoryFilters, groupBy: GroupBy, page: { limit: number; offset: number }) {
  const key = groupBy === "PERSON" ? "c.person_id" : groupBy === "TEAM" ? "c.team_id" : "c.subteam_id"
  const label = groupBy === "PERSON" ? "(select name from people where id = g.key)" : groupBy === "TEAM" ? "(select name from teams where id = g.key)" : "(select name from subteams where id = g.key)"
  // Principais desvios de cada pessoa/equipe POR PRÁTICA (a mesma conduta em várias regras conta uma vez, com o título da prática).
  const rows = (await db.query<StatsRow & { key: string | null; label: string | null; top: { practiceKey: string; title: string; deviations: number; assessed: number }[] | null; total: number }>(
    `with base as (select c.* from ${EFFECTIVE_CRITERIA_SQL} c where ${baseWhere()}),
     g as (select ${key.replace("c.", "b.")} key, ${STATS_SQL.replaceAll("c.", "b.")} from base b group by 1),
     top as (
       select key, jsonb_agg(jsonb_build_object('practiceKey', practice_key, 'title', title, 'deviations', deviations, 'assessed', assessed) order by deviations desc) filter (where rn <= 3) top
       from (select ${key.replace("c.", "b.")} key, b.practice_key, (array_agg(b.point_label order by b.created_at desc))[1] title,
                    count(*) filter (where b.effective_status in ('NOT_MET','PARTIAL'))::int deviations, count(*) filter (where b.effective_status in ('MET','NOT_MET','PARTIAL'))::int assessed,
                    row_number() over (partition by ${key.replace("c.", "b.")} order by count(*) filter (where b.effective_status in ('NOT_MET','PARTIAL')) desc) rn
             from base b group by 1, 2) ranked where deviations > 0 group by key)
     select g.*, ${label} label, top.top, count(*) over ()::int total from g left join top on top.key is not distinct from g.key
     order by case when g.assessed > 0 then (g.not_met + g.partial)::float / g.assessed else -1 end desc, g.assessed desc
     limit $13 offset $14`,
    [...params(organizationId, personIds, filters), page.limit, page.offset],
  )).rows
  return { total: rows[0]?.total ?? 0, items: rows.map((row) => ({ key: row.key, label: row.label ?? (row.key ? "—" : "Sem registro"), topDeviations: row.top ?? [], ...statsOf(row) })) }
}

export type Dimension = "DAY" | "WEEKDAY" | "SUBJECT" | "HOUR"
const WEEKDAYS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"]
export async function concentration(db: Queryable, organizationId: string, personIds: readonly string[], filters: MemoryFilters, dimension: Dimension) {
  const timeZone = await resolveOrganizationTimezone(db as Database, organizationId)
  const bucket = dimension === "DAY" ? "c.local_date::text" : dimension === "WEEKDAY" ? "extract(dow from c.local_date)::int::text" : dimension === "HOUR" ? `lpad(extract(hour from c.occurred_at at time zone $13)::int::text, 2, '0')` : "coalesce(c.subject_canonical, c.subject_raw, 'Sem assunto')"
  const rows = (await db.query<StatsRow & { bucket: string }>(
    `select ${bucket} bucket, ${STATS_SQL} from ${EFFECTIVE_CRITERIA_SQL} c where ${baseWhere()} group by 1 order by 1`,
    [...params(organizationId, personIds, filters), ...(dimension === "HOUR" ? [timeZone] : [])],
  )).rows
  const subjectNames = dimension === "SUBJECT" ? new Map((await db.query<{ code: string; name: string }>(`select code, name from interaction_subject_definitions where organization_id = $1`, [organizationId])).rows.map((row) => [row.code, row.name])) : new Map<string, string>()
  return rows.map((row) => ({ bucket: row.bucket, label: dimension === "WEEKDAY" ? WEEKDAYS[Number(row.bucket)] ?? row.bucket : dimension === "SUBJECT" ? subjectNames.get(row.bucket) ?? row.bucket : dimension === "HOUR" ? `${row.bucket}h` : row.bucket.split("-").reverse().join("/"), ...statsOf(row) }))
}

/**
 * MATERIAIS: três coisas que nunca se misturam — base usada como FUNDAMENTO das avaliações (chamadas em que o documento sustentou
 * um critério), material RECOMENDADO para desenvolvimento (mensagens que o indicaram) e ENTREGUE (a mensagem foi publicada).
 * Recomendação nunca é contada como leitura nem como melhoria.
 */
/**
 * MATERIAIS por DOCUMENTO (o processo): quanto ele sustentou avaliações (acertos e desvios, chamadas, pessoas), quanto foi indicado no
 * feedback e entregue, e os ITENS que mais aparecem dele — as SEÇÕES, cada uma com as avaliações que sustentou, as indicações e os
 * pontos do processo (práticas) avaliados nela. Contagens por regra avaliada (somáveis entre seções); pessoas e chamadas só no documento.
 */
export async function materialAggregates(db: Queryable, organizationId: string, personIds: readonly string[], filters: MemoryFilters) {
  const assessedSql = "c.effective_status in ('MET','NOT_MET','PARTIAL')"
  const grounded = (await db.query<PointStatsRow & { document_id: string; title: string; grounded_calls: number; grounded_people: number }>(
    `select c.document_id, d.title, count(distinct c.interaction_id) filter (where ${assessedSql})::int grounded_calls, count(distinct c.person_id) filter (where ${assessedSql})::int grounded_people,
            ${STATS_SQL}, ${PEOPLE_SQL("c")}
     from ${EFFECTIVE_CRITERIA_SQL} c join knowledge_documents d on d.id = c.document_id where ${baseWhere()} group by 1, 2 having count(*) filter (where ${assessedSql}) > 0`,
    params(organizationId, personIds, filters),
  )).rows
  // Itens do documento: seção × ponto (contagens de regras avaliadas — somam por seção).
  const items = (await db.query<{ document_id: string; section: string; practice_key: string; point_label: string; assessed: number; met: number; deviations: number }>(
    `select c.document_id, coalesce(c.section_heading, '') section, c.practice_key, (array_agg(c.point_label order by c.created_at desc))[1] point_label,
            count(*) filter (where ${assessedSql})::int assessed, count(*) filter (where c.effective_status = 'MET')::int met, count(*) filter (where c.effective_status in ('NOT_MET','PARTIAL'))::int deviations
     from ${EFFECTIVE_CRITERIA_SQL} c where ${baseWhere()} and c.document_id is not null group by 1, 2, 3 having count(*) filter (where ${assessedSql}) > 0`,
    params(organizationId, personIds, filters),
  )).rows
  const recommended = (await db.query<{ document_id: string; title: string; recommended: number; delivered: number; people: number; reasons: string[]; criterion_keys: string[] }>(
    `select r.document_id, d.title, count(distinct r.message_id)::int recommended, count(distinct r.message_id) filter (where r.delivered_feedback_id is not null)::int delivered,
            count(distinct r.person_id)::int people, (array_agg(distinct r.reason))[1:5] reasons, array_agg(distinct k) criterion_keys
     from feedback_material_recommendations r join knowledge_documents d on d.id = r.document_id
     left join lateral unnest(r.criterion_keys) k on true
     where r.organization_id = $1 and r.person_id = any($2::uuid[]) and (r.created_at at time zone 'UTC')::date between $3::date and $4::date and ($5::uuid is null or r.person_id in (select id from people where team_id = $5)) and ($6::uuid is null or r.person_id = $6) and ($7::uuid is null or r.document_id = $7)
     group by 1, 2`,
    [organizationId, [...personIds], filters.from, filters.to, filters.teamId, filters.personId, filters.documentId],
  )).rows
  // Cada recomendação aponta regras; a regra leva à PRÁTICA (título) e à SEÇÃO do documento — o que se indica, por conduta e por seção.
  const keys = [...new Set(recommended.flatMap((row) => row.criterion_keys ?? []).filter(Boolean))]
  const byCriterion = keys.length > 0
    ? new Map((await db.query<{ criterion_key: string; practice_key: string; title: string; section: string | null }>(
        // A recomendação guarda a regra (monitoria) ou a prática (padrão do indicador): as duas levam à prática e à seção.
        `select distinct on (m.key) m.key criterion_key, m.practice_key, m.title, m.section
           from (select case when c.criterion_key = any($2::text[]) then c.criterion_key else c.practice_key end key, c.practice_key, c.point_label title, c.section_heading section, c.created_at
                   from ${EFFECTIVE_CRITERIA_SQL} c where c.organization_id = $1 and (c.criterion_key = any($2::text[]) or c.practice_key = any($2::text[]))) m
          order by m.key, m.created_at desc`,
        [organizationId, keys],
      )).rows.map((row) => [row.criterion_key, row]))
    : new Map<string, { criterion_key: string; practice_key: string; title: string; section: string | null }>()
  const recommendationKeys = (await db.query<{ document_id: string; criterion_keys: string[] }>(
    `select r.document_id, r.criterion_keys from feedback_material_recommendations r
     where r.organization_id = $1 and r.person_id = any($2::uuid[]) and (r.created_at at time zone 'UTC')::date between $3::date and $4::date and ($5::uuid is null or r.person_id in (select id from people where team_id = $5)) and ($6::uuid is null or r.person_id = $6) and ($7::uuid is null or r.document_id = $7)`,
    [organizationId, [...personIds], filters.from, filters.to, filters.teamId, filters.personId, filters.documentId],
  )).rows
  const tally = (documentId: string, pick: (row: { practice_key: string; title: string; section: string | null }) => { key: string; label: string } | null) => {
    const counts = new Map<string, { label: string; recommended: number }>()
    for (const recommendation of recommendationKeys.filter((row) => row.document_id === documentId)) {
      const seen = new Set<string>()
      for (const key of recommendation.criterion_keys ?? []) {
        const mapped = byCriterion.get(key)
        const picked = mapped ? pick(mapped) : null
        if (!picked || seen.has(picked.key)) continue
        seen.add(picked.key)
        counts.set(picked.key, { label: picked.label, recommended: (counts.get(picked.key)?.recommended ?? 0) + 1 })
      }
    }
    return [...counts.entries()].map(([key, value]) => ({ key, ...value })).sort((a, b) => b.recommended - a.recommended || a.label.localeCompare(b.label, "pt-BR"))
  }
  const ids = [...new Set([...grounded.map((row) => row.document_id), ...recommended.map((row) => row.document_id)])]
  const empty: PointStatsRow = { calls: 0, assessed: 0, met: 0, not_met: 0, partial: 0, inconclusive: 0, not_applicable: 0, people: 0, people_with_deviation: 0, people_with_met: 0 }
  return ids.map((documentId) => {
    const ground = grounded.find((row) => row.document_id === documentId)
    const recommendation = recommended.find((row) => row.document_id === documentId)
    const recommendedSections = new Map(tally(documentId, (row) => (row.section ? { key: row.section, label: row.section } : null)).map((entry) => [entry.key, entry.recommended]))
    const sections = new Map<string, { section: string | null; assessed: number; met: number; deviations: number; recommended: number; points: { practiceKey: string; title: string; assessed: number; met: number; deviations: number }[] }>()
    const sectionOf = (key: string) => {
      const existing = sections.get(key)
      if (existing) return existing
      const created = { section: key || null, assessed: 0, met: 0, deviations: 0, recommended: recommendedSections.get(key) ?? 0, points: [] as { practiceKey: string; title: string; assessed: number; met: number; deviations: number }[] }
      sections.set(key, created)
      return created
    }
    for (const row of items.filter((entry) => entry.document_id === documentId)) {
      const section = sectionOf(row.section)
      section.assessed += row.assessed
      section.met += row.met
      section.deviations += row.deviations
      section.points.push({ practiceKey: row.practice_key, title: row.point_label, assessed: row.assessed, met: row.met, deviations: row.deviations })
    }
    for (const key of recommendedSections.keys()) sectionOf(key)
    const stats = ground ?? empty
    return {
      documentId,
      title: ground?.title ?? recommendation?.title ?? "Documento",
      groundedCalls: ground?.grounded_calls ?? 0,
      groundedPeople: ground?.grounded_people ?? 0,
      peopleWithDeviation: stats.people_with_deviation,
      ...statsOf(stats),
      recommended: recommendation?.recommended ?? 0,
      delivered: recommendation?.delivered ?? 0,
      recommendedPeople: recommendation?.people ?? 0,
      reasons: recommendation?.reasons ?? [],
      practices: tally(documentId, (row) => ({ key: row.practice_key, label: row.title })).map((entry) => ({ practiceKey: entry.key, title: entry.label, recommended: entry.recommended })),
      // Os itens que mais aparecem: seções por avaliações sustentadas (depois indicações); dentro, os pontos mais avaliados.
      sections: [...sections.values()]
        .map((section) => ({ ...section, points: section.points.sort((a, b) => b.assessed - a.assessed || b.deviations - a.deviations || a.title.localeCompare(b.title, "pt-BR")) }))
        .sort((a, b) => b.assessed - a.assessed || b.recommended - a.recommended || (a.section ?? "").localeCompare(b.section ?? "", "pt-BR")),
    }
  }).sort((a, b) => b.assessed - a.assessed || b.recommended - a.recommended || a.title.localeCompare(b.title, "pt-BR"))
}

export async function indicatorInvestigations(db: Queryable, organizationId: string, personIds: readonly string[], filters: MemoryFilters, page: { limit: number; offset: number }) {
  const rows = (await db.query<{ id: string; person_id: string; person_name: string; indicator_code: string; period_start: string; period_end: string; reference_period: string | null; conclusion: string; official: Record<string, unknown>; localization: Record<string, unknown>; evidence: unknown[]; reference_group: Record<string, unknown> | null; questions: unknown[]; limitations: string[]; created_at: Date; total: number }>(
    `select i.id, i.person_id, p.name person_name, i.indicator_code, i.period_start::text, i.period_end::text, i.reference_period, i.conclusion, i.official, i.localization, i.evidence, i.reference_group, i.questions, i.limitations, i.created_at, count(*) over ()::int total
     from indicator_investigations i join people p on p.id = i.person_id
     where i.organization_id = $1 and i.is_current and i.person_id = any($2::uuid[]) and i.period_end >= $3::date and i.period_start <= $4::date and ($5::uuid is null or i.team_id = $5) and ($6::uuid is null or i.person_id = $6)
     order by i.period_end desc, i.created_at desc limit $7 offset $8`,
    [organizationId, [...personIds], filters.from, filters.to, filters.teamId, filters.personId, page.limit, page.offset],
  )).rows
  return {
    total: rows[0]?.total ?? 0,
    items: rows.map((row) => {
      const evidence = row.evidence as { segmentLabel: string; analyzedCalls: number; universe: number; patterns: { criterionKey: string; text: string; classification: string; eligible: number; notMet: number; partial: number; met: number }[] }[]
      const reference = row.reference_group as { basis?: string; members?: number; practices?: { criterionKey: string; text: string; reference: { eligible: number; met: number; contributors: number }; person: { eligible: number; met: number; notMet: number }; contrast: string }[]; limitations?: string[] } | null
      return {
        id: row.id,
        personId: row.person_id,
        personName: row.person_name,
        indicatorCode: row.indicator_code,
        indicatorName: String((row.official as { name?: unknown }).name ?? row.indicator_code),
        periodLabel: String((row.official as { periodLabel?: unknown }).periodLabel ?? `${row.period_start} a ${row.period_end}`),
        official: row.official,
        conclusion: row.conclusion,
        focus: ((row.localization as { focus?: { label: string; reason: string }[] }).focus ?? []),
        patterns: evidence.flatMap((entry) => entry.patterns.filter((pattern) => pattern.classification === "DEVELOPMENT_PATTERN" || pattern.classification === "STRENGTH_PATTERN").map((pattern) => ({ segment: entry.segmentLabel, ...pattern }))),
        evidence: evidence.map((entry) => ({ segment: entry.segmentLabel, analyzedCalls: entry.analyzedCalls, universe: entry.universe })),
        reference: reference ? { basis: reference.basis ?? "UNAVAILABLE", members: reference.members ?? 0, practices: reference.practices ?? [], limitations: reference.limitations ?? [] } : null,
        questions: row.questions,
        limitations: row.limitations,
        createdAt: row.created_at,
      }
    }),
  }
}

export async function assessmentList(db: Queryable, organizationId: string, personIds: readonly string[], filters: MemoryFilters, page: { limit: number; offset: number }) {
  // Cada linha já traz o que a liderança lê primeiro na lista: o que aconteceu (justificativa), as falas da chamada (até duas, literais)
  // e de onde vem a regra (documento · seção). O resto fica no detalhe da chamada.
  const rows = (await db.query<{ id: string; call_assessment_id: string; interaction_id: string; person_id: string; person_name: string; team_name: string | null; local_date: string; subject: string | null; status: string; criterion_key: string; criterion_text: string; practice_key: string; practice_title: string | null; rationale: string | null; materiality: string | null; document_title: string; section_heading: string | null; evidence: { turn: string; speaker: string | null; quote: string }[] | null; total: number }>(
    `select c.id, c.call_assessment_id, c.interaction_id, c.person_id, p.name person_name, t.name team_name, c.local_date::text, coalesce(c.subject_canonical, c.subject_raw) subject, c.effective_status status, c.criterion_key, c.criterion_text, c.practice_key, c.point_label practice_title, c.rationale, c.materiality, coalesce(d.title, 'Argumentário: ' || asx.name) document_title,
            c.section_heading, case when jsonb_typeof(c.evidence) = 'array' then (select jsonb_agg(e) from (select e from jsonb_array_elements(c.evidence) e limit 2) x) end evidence, count(*) over ()::int total
     from ${EFFECTIVE_CRITERIA_SQL} c join people p on p.id = c.person_id left join teams t on t.id = c.team_id left join knowledge_documents d on d.id = c.document_id left join argument_scripts asx on asx.id = c.argument_script_id
     where ${baseWhere()} order by c.local_date desc, c.created_at desc limit $13 offset $14`,
    [...params(organizationId, personIds, filters), page.limit, page.offset],
  )).rows
  return { total: rows[0]?.total ?? 0, items: rows.map((row) => ({ id: row.id, callAssessmentId: row.call_assessment_id, interactionId: row.interaction_id, personId: row.person_id, personName: row.person_name, teamName: row.team_name, date: row.local_date, subject: row.subject, status: row.status, practiceKey: row.practice_key, practiceTitle: row.practice_title ?? row.criterion_text, criterionKey: row.criterion_key, criterionText: row.criterion_text, rationale: row.rationale, materiality: row.materiality, documentTitle: row.document_title, section: row.section_heading, evidence: (row.evidence ?? []).map((quote) => ({ turn: quote.turn, speaker: quote.speaker ?? null, quote: quote.quote })) })) }
}

/** A AVALIAÇÃO de uma chamada com as fontes: cenário, caminho, critérios (regra + evidência + justificativa), transcrição. */
export async function assessmentDetail(db: Queryable, organizationId: string, personIds: readonly string[], callAssessmentId: string) {
  const row = (await db.query<{ id: string; interaction_id: string; person_id: string; person_name: string; occurred_at: Date; local_date: string; subject_raw: string | null; subject_canonical: string | null; channel: string | null; selection_reason: string; transcript_status: string; procedure_document_id: string | null; procedure_title: string | null; procedure_document_version: number | null; rule_perspective: string | null; scenario: Record<string, unknown>; path_assessment: string; coverage: Record<string, unknown>; outcome: string; limitations: string[]; is_current: boolean; structure_basis: string; external_id: string }>(
    `select a.id, a.interaction_id, a.person_id, p.name person_name, a.occurred_at, a.local_date::text, a.subject_raw, a.subject_canonical, a.channel, a.selection_reason, a.transcript_status, a.procedure_document_id, d.title procedure_title, a.procedure_document_version, a.rule_perspective, a.scenario, a.path_assessment, a.coverage, a.outcome, a.limitations, a.is_current, a.structure_basis, i.external_id
     from call_assessments a join people p on p.id = a.person_id join interactions i on i.id = a.interaction_id left join knowledge_documents d on d.id = a.procedure_document_id
     where a.id = $1 and a.organization_id = $2 and a.person_id = any($3::uuid[])`,
    [callAssessmentId, organizationId, [...personIds]],
  )).rows[0]
  if (!row) return null
  const criteria = (await db.query<{ id: string; criterion_key: string; criterion_text: string; section_heading: string | null; document_id: string; document_title: string; document_version: number; status: string; evidence_kind: string | null; evidence: { turn: string; speaker: string | null; quote: string; timestamp: string | null }[]; opportunity_turn: string | null; rationale: string | null; guidance: { moment: string; condition: string | null; action: string } | null; why_it_matters: string | null; materiality: string | null; rule_conflict: boolean; on_path: boolean; verification: Record<string, unknown>; identity_basis: string; source_kind: string; applicability: string | null; observability: string | null; execution_claim: string | null; obligation: Record<string, unknown> | null; expected: string | null; occurrence_key: string | null; occurrence_basis: string | null }>(
    `select c.id, c.criterion_key, c.criterion_text, c.section_heading, coalesce(c.document_id, c.argument_script_id) document_id, coalesce(d.title, 'Argumentário: ' || asx.name) document_title, c.document_version, c.status, c.evidence_kind, c.evidence, c.opportunity_turn, c.rationale, c.guidance, c.why_it_matters, c.materiality, c.rule_conflict, c.on_path, c.verification, c.identity_basis,
            c.source_kind, c.applicability, c.observability, c.execution_claim, c.obligation, c.expected, c.occurrence_key, c.occurrence_basis
     from call_criterion_assessments c left join knowledge_documents d on d.id = c.document_id left join argument_scripts asx on asx.id = c.argument_script_id where c.call_assessment_id = $1
     order by case c.status when 'NOT_MET' then 0 when 'PARTIAL' then 1 when 'MET' then 2 when 'NOT_OBSERVABLE' then 3 when 'NOT_ASSESSED' then 4 else 5 end, c.criterion_text`,
    [row.id],
  )).rows
  const transcript = (await db.query<{ content: string }>(`select content from transcripts where interaction_id = $1 order by version desc limit 1`, [row.interaction_id])).rows[0]
  return {
    id: row.id,
    interactionId: row.interaction_id,
    externalId: row.external_id,
    personId: row.person_id,
    personName: row.person_name,
    occurredAt: row.occurred_at,
    date: row.local_date,
    subject: row.subject_canonical ?? row.subject_raw,
    channel: row.channel,
    selectionReason: row.selection_reason,
    transcriptStatus: row.transcript_status,
    procedure: row.procedure_document_id ? { documentId: row.procedure_document_id, title: row.procedure_title, version: row.procedure_document_version, perspective: row.rule_perspective } : null,
    scenario: row.scenario,
    pathAssessment: row.path_assessment,
    coverage: row.coverage,
    outcome: row.outcome,
    limitations: row.limitations,
    isCurrent: row.is_current,
    structureBasis: row.structure_basis,
    criteria: criteria.map((criterion) => ({ id: criterion.id, criterionKey: criterion.criterion_key, text: criterion.criterion_text, section: criterion.section_heading, documentId: criterion.document_id, documentTitle: criterion.document_title, documentVersion: criterion.document_version, status: criterion.status, evidenceKind: criterion.evidence_kind, evidence: criterion.evidence, opportunityTurn: criterion.opportunity_turn, rationale: criterion.rationale, guidance: criterion.guidance, whyItMatters: criterion.why_it_matters, materiality: criterion.materiality, ruleConflict: criterion.rule_conflict, onPath: criterion.on_path, verification: criterion.verification, identityBasis: criterion.identity_basis, sourceKind: criterion.source_kind, applicability: criterion.applicability, observability: criterion.observability, executionClaim: criterion.execution_claim, obligation: criterion.obligation, ruleText: criterion.expected,
      // Mesma conduta julgada por outras regras NESTA chamada (ligação da revisão conferida pela estrutura); null = não determinável.
      occurrence: criterion.occurrence_basis ? { basis: criterion.occurrence_basis, sameConductAs: criteria.filter((other) => other.id !== criterion.id && other.occurrence_key === criterion.occurrence_key).map((other) => ({ criterionKey: other.criterion_key, text: other.criterion_text, documentTitle: other.document_title })) } : null })),
    transcript: transcript ? projectTranscript(transcript.content).turns.map((turn) => ({ turn: turn.handle, speaker: turn.speaker, text: turn.text, timestamp: turn.audit.timestamp })) : [],
  }
}

export async function indicatorInvestigationDetail(db: Queryable, organizationId: string, personIds: readonly string[], investigationId: string) {
  const row = (await db.query<{ id: string; person_id: string; person_name: string; official: unknown; localization: unknown; evidence: unknown; reference_group: unknown; questions: unknown; conclusion: string; limitations: string[]; analysis_run_id: string; created_at: Date }>(
    `select i.id, i.person_id, p.name person_name, i.official, i.localization, i.evidence, i.reference_group, i.questions, i.conclusion, i.limitations, i.analysis_run_id, i.created_at
     from indicator_investigations i join people p on p.id = i.person_id where i.id = $1 and i.organization_id = $2 and i.person_id = any($3::uuid[])`,
    [investigationId, organizationId, [...personIds]],
  )).rows[0]
  if (!row) return null
  // Chamadas que sustentam os padrões (só da própria pessoa) — o caminho do agregado até a avaliação.
  const exampleIds = ((row.evidence as { patterns: { examples: { interactionId: string }[] }[] }[]) ?? []).flatMap((entry) => entry.patterns.flatMap((pattern) => pattern.examples.map((example) => example.interactionId)))
  const assessments = exampleIds.length > 0 ? (await db.query<{ id: string; interaction_id: string }>(`select id, interaction_id from call_assessments where organization_id = $1 and interaction_id = any($2::uuid[]) and is_current and person_id = $3`, [organizationId, exampleIds, row.person_id])).rows : []
  return { id: row.id, personId: row.person_id, personName: row.person_name, official: row.official, localization: row.localization, evidence: row.evidence, reference: row.reference_group, questions: row.questions, conclusion: row.conclusion, limitations: row.limitations, createdAt: row.created_at, callAssessments: Object.fromEntries(assessments.map((entry) => [entry.interaction_id, entry.id])) }
}

// ---------------------------------------------------------------------------------------------
// Exportação
// ---------------------------------------------------------------------------------------------
// Texto que começa com = + - @ TAB ou CR vira fórmula ao abrir na planilha (CSV injection — achado U-F16): assuntos vêm de
// dados ingeridos e justificativas são texto da IA. Neutralizado com apóstrofo; números (tipo number) ficam como estão.
const csvCell = (value: unknown) => {
  const raw = value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value)
  const text = typeof value === "string" && /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw
  return /[";\n\r]/.test(text) || text !== raw ? `"${text.replaceAll('"', '""')}"` : text
}
export function toCsv(header: string[], rows: unknown[][], preamble: string[]): string {
  return `\uFEFF${[...preamble.map((line) => `# ${line}`), header.map(csvCell).join(";"), ...rows.map((row) => row.map(csvCell).join(";"))].join("\r\n")}\r\n`
}
export const METHOD_NOTE = "Método: contagem da projeção vigente (uma linha por chamada × critério; numa regra composta, uma linha por parte). Contagens POR REGRA. Denominador = avaliadas (cumpridas + não cumpridas + parciais, só confirmadas); taxa de desvio por regra = (não cumpridas + parciais) / avaliadas. Inconclusivas (não observável/não avaliada — inclusive o que acontece em sistemas, fora da conversa) e não aplicáveis ficam fora do denominador. OCORRÊNCIAS de conduta: quando a revisão ligou duas regras à mesma conduta no mesmo momento da mesma chamada, elas contam uma vez; taxa por ocorrência = condutas distintas em desvio / condutas distintas avaliadas, só entre as regras com ligação determinável — análises antigas, sem essa ligação, ficam fora dela e aparecem como \"sem ligação determinável\". Estrutura = a vigente no momento da análise de cada chamada."
