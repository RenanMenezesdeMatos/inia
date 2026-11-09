import type { Database } from "../../../infrastructure/database/pool.js"
import type { EvidenceStrength } from "../domain/evidence-criteria.js"
import { guidanceItemOf, type GuidanceContext, type GuidanceItem, type GuidancePattern, type OperatorEvidence } from "../domain/guidance.js"
import { isAvailable, type DataOrigin, type PatternState, type ReviewStatus, type StoredObligationStatus } from "../domain/pattern.js"
import { contextMatches, levelsFor, populationMatches, practiceProductOf, productMatches, selectedFromOf, type Placement, type PracticeProductEvidence, type SelectedFrom, type Subject } from "../domain/selection-levels.js"
import type { ContextLevel } from "../domain/sampling.js"

type Queryable = Pick<Database, "query">

/**
 * LEITURA PARA RECOMENDAÇÃO — o único caminho pelo qual um padrão chega a uma pessoa (chat, voz, feedback, diagnóstico). Só
 * padrões DISPONÍVEIS (pattern.ts), do indicador pedido, da população (Grupo) da pessoa e de um contexto sustentado que case com o
 * contexto pedido. Dado sintético só entra quando a chamada pede explicitamente um dataset (pré-visualização de teste, nunca em
 * produção) — nenhum outro caminho consegue misturar.
 */
export type SupportedContext = { cellKey: string; reason: string; subReason: string | null; level?: ContextLevel; label: string; strength: EvidenceStrength; topRatePercent: number | null; referenceRatePercent: number | null; topOperators: number; referenceOperators: number; topCalls: number; referenceCalls: number }
export type PracticeRow = PatternState & {
  id: string
  name: string
  description: string
  guidance: string
  suggestedPhrasing: string | null
  notApplicableWhen: string | null
  /** `BEST_PRACTICE_HOW_IT_HELPS_V1`: como ajuda no resultado, texto vigente da revisão (só conta depois de aprovado). */
  howItHelps: string | null
  /** Resultado do padrão: o indicador ou o sinal da chamada (`outcomeKind`); `indicatorName` é o nome de um ou de outro. */
  indicatorId: string | null
  channelFlagId: string | null
  outcomeKind: "INDICATOR" | "CALL_SIGNAL"
  indicatorName: string
  teamId: string | null
  subteamId: string | null
  supportedContexts: SupportedContext[]
  /** De onde veio a fala sugerida (`BEST_PRACTICE_GUIDANCE_V3`): ANY = escrita/editada na revisão (vale para qualquer contexto);
   * LISTED = os contextos das chamadas de exemplo; UNKNOWN = padrão anterior (não se sabe). */
  phrasingScope: "ANY" | "LISTED" | "UNKNOWN"
  phrasingContexts: string[]
  versionAnalysisId: string | null
  definitionHash: string | null
  periodStart: string | null
  periodEnd: string | null
  additionalBehavior: string | null
}
export type ContextFilter = { reason: string; subReason: string | null }
export type PracticeSource = { origin: "REAL"; teamId: string | null } | { origin: "SYNTHETIC"; datasetId: string }

const dateBr = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "")
const norm = (text: string | null) => (text ?? "").trim().toLowerCase()

export async function loadPracticeRows(db: Queryable, input: { organizationId: string; indicatorId: string | null; channelFlagId?: string | null; source: PracticeSource }): Promise<PracticeRow[]> {
  const rows = (await db.query<{ id: string; name: string; description: string; guidance: string; suggested_phrasing: string | null; not_applicable_when: string | null; indicator_definition_id: string | null; channel_flag_id: string | null; indicator_name: string; how_it_helps: string | null; team_id: string | null; subteam_id: string | null; review_status: ReviewStatus; obligation_status: StoredObligationStatus; obligation_confirmed_by_review: boolean; current_strength: EvidenceStrength; data_origin: DataOrigin; supported_contexts: SupportedContext[]; phrasing_scope: PracticeRow["phrasingScope"]; phrasing_contexts: string[]; analysis_id: string | null; definition_hash: string | null; period_start: string | null; period_end: string | null; additional_behavior: string | null }>(
    `select p.id, p.name, p.description, p.guidance, p.suggested_phrasing, p.not_applicable_when, p.indicator_definition_id, p.channel_flag_id, coalesce(i.name, nullif(btrim(cf.label), ''), cf.flag_name) indicator_name, p.how_it_helps, p.team_id, p.subteam_id, p.review_status, p.obligation_status, p.obligation_confirmed_by_review, p.current_strength, p.data_origin, p.supported_contexts,
            case when p.suggested_phrasing is distinct from v.proposed->>'suggestedPhrasing' then 'ANY' when jsonb_typeof(v.proposed->'phrasingContexts') = 'array' then 'LISTED' else 'UNKNOWN' end phrasing_scope,
            array(select jsonb_array_elements_text(case when jsonb_typeof(v.proposed->'phrasingContexts') = 'array' then v.proposed->'phrasingContexts' else '[]'::jsonb end)) phrasing_contexts,
            v.analysis_id, v.definition_hash, to_char(v.period_start, 'YYYY-MM-DD') period_start, to_char(v.period_end, 'YYYY-MM-DD') period_end,
            case when p.obligation_status = 'DIFFERENTIATED_EXECUTION' then v.obligation_check->>'additionalBehavior' end additional_behavior
       from best_practice_patterns p
       left join indicator_definitions i on i.id = p.indicator_definition_id
       left join channel_flags cf on cf.id = p.channel_flag_id
       left join best_practice_pattern_versions v on v.id = p.current_version_id
      where p.organization_id = $1 and ($2::uuid is null or p.indicator_definition_id = $2) and ($4::uuid is null or p.channel_flag_id = $4)
        and (p.indicator_definition_id is null or i.id is not null) and (p.channel_flag_id is null or cf.id is not null)
        and ${input.source.origin === "REAL" ? `p.data_origin = 'REAL' and ($3::uuid is null or p.team_id = $3)` : `p.data_origin = 'SYNTHETIC' and p.synthetic_dataset_id = $3`}
      order by p.updated_at desc, p.id`,
    [input.organizationId, input.indicatorId, input.source.origin === "REAL" ? input.source.teamId : input.source.datasetId, input.channelFlagId ?? null],
  )).rows
  return rows.map((row) => ({ id: row.id, name: row.name, description: row.description, guidance: row.guidance, suggestedPhrasing: row.suggested_phrasing, notApplicableWhen: row.not_applicable_when, indicatorId: row.indicator_definition_id, channelFlagId: row.channel_flag_id, outcomeKind: row.channel_flag_id ? "CALL_SIGNAL" : "INDICATOR", indicatorName: row.indicator_name, howItHelps: row.how_it_helps ?? null, teamId: row.team_id, subteamId: row.subteam_id, reviewStatus: row.review_status, obligationStatus: row.obligation_status, obligationConfirmedByReview: row.obligation_confirmed_by_review, currentStrength: row.current_strength, dataOrigin: row.data_origin, supportedContexts: row.supported_contexts ?? [], phrasingScope: row.phrasing_scope ?? "UNKNOWN", phrasingContexts: row.phrasing_contexts ?? [], versionAnalysisId: row.analysis_id, definitionHash: row.definition_hash, periodStart: row.period_start, periodEnd: row.period_end, additionalBehavior: row.additional_behavior }))
}

/** O contexto pedido casa com um contexto sustentado: mesmo motivo; submotivo só restringe quando o padrão é por submotivo. */
export function matchingContexts(row: Pick<PracticeRow, "supportedContexts">, filters: readonly ContextFilter[] | null): SupportedContext[] {
  if (!filters) return row.supportedContexts
  return row.supportedContexts.filter((context) => filters.some((filter) => norm(filter.reason) === norm(context.reason) && (context.subReason === null || filter.subReason === null || norm(filter.subReason) === norm(context.subReason))))
}

/**
 * A fala sugerida só aparece para o assunto de onde ela saiu (`BEST_PRACTICE_GUIDANCE_V3`): editada na revisão = qualquer assunto;
 * com os contextos das chamadas de exemplo = só nesses; padrão anterior (origem desconhecida) = só quando ele vale para um assunto só.
 */
export function phrasingFor(row: Pick<PracticeRow, "suggestedPhrasing" | "phrasingScope" | "phrasingContexts" | "supportedContexts">, contexts: readonly Pick<SupportedContext, "cellKey">[]): string | null {
  if (!row.suggestedPhrasing) return null
  if (row.phrasingScope === "ANY") return row.suggestedPhrasing
  if (row.phrasingScope === "LISTED" && row.phrasingContexts.length > 0) return contexts.some((context) => row.phrasingContexts.includes(context.cellKey)) ? row.suggestedPhrasing : null
  return row.supportedContexts.length === 1 ? row.suggestedPhrasing : null
}

export function guidancePatternOf(row: PracticeRow, contexts: readonly SupportedContext[]): GuidancePattern {
  const toContext = (context: SupportedContext): GuidanceContext => ({ label: context.label, topRatePercent: context.topRatePercent, referenceRatePercent: context.referenceRatePercent, topOperators: context.topOperators, referenceOperators: context.referenceOperators, topCalls: context.topCalls, referenceCalls: context.referenceCalls, strength: context.strength })
  return { id: row.id, name: row.name, description: row.description, guidance: row.guidance, suggestedPhrasing: phrasingFor(row, contexts), notApplicableWhen: row.notApplicableWhen, additionalBehavior: row.additionalBehavior, howItHelps: row.howItHelps, indicatorName: row.indicatorName, outcomeKind: row.outcomeKind, strength: row.currentStrength, periodLabel: row.periodStart && row.periodEnd ? `${dateBr(row.periodStart)} a ${dateBr(row.periodEnd)}` : "período da análise", contexts: contexts.map(toContext), dataOrigin: row.dataOrigin }
}

/** Codificações DAS CHAMADAS DA PRÓPRIA PESSOA na análise vigente do padrão (pessoa real por id; operador sintético pela referência). */
export async function operatorEvidenceOf(db: Queryable, organizationId: string, row: Pick<PracticeRow, "versionAnalysisId" | "definitionHash">, who: { personId: string } | { operatorRef: string }, contexts: readonly SupportedContext[]): Promise<OperatorEvidence | null> {
  if (!row.versionAnalysisId || !row.definitionHash) return null
  const byPerson = "personId" in who
  const counts = (await db.query<{ status: string; total: number }>(
    `select status, count(*)::int total from best_practice_call_codings
      where organization_id = $1 and analysis_id = $2 and definition_hash = $3 and ${byPerson ? "person_id = $4::uuid" : "operator_ref = $4"} and cell_key = any($5::text[])
      group by status`,
    [organizationId, row.versionAnalysisId, row.definitionHash, byPerson ? who.personId : who.operatorRef, contexts.map((context) => context.cellKey)],
  )).rows
  const of = (status: string) => counts.find((entry) => entry.status === status)?.total ?? 0
  const analyzed = counts.reduce((sum, entry) => sum + entry.total, 0)
  return analyzed === 0 ? null : { callsAnalyzed: analyzed, callsWithSituation: of("PRESENT") + of("ABSENT"), present: of("PRESENT") }
}

/** Contextos (motivo › submotivo) das chamadas da pessoa nos últimos 90 dias, do mais frequente ao menos — no máximo 12. */
export async function recentContextsOf(db: Queryable, organizationId: string, personId: string, now: Date): Promise<ContextFilter[]> {
  const rows = (await db.query<{ reason: string; sub_reason: string | null }>(
    `select reason, nullif(btrim(sub_reason), '') sub_reason, count(*) total from interactions
      where organization_id = $1 and operator_id = $2 and started_at >= $3::timestamptz - interval '90 days' and started_at < $3::timestamptz
      group by 1, 2 order by total desc, 1, 2 limit 12`,
    [organizationId, personId, now],
  )).rows
  return rows.map((row) => ({ reason: row.reason, subReason: row.sub_reason }))
}

/**
 * Evidência de PRODUTO do padrão (`BEST_PRACTICE_SELECTION_V2`): nas chamadas da análise vigente em que o comportamento apareceu
 * (PRESENTE, nos contextos que casaram), os produtos que a análise da chamada do motor de feedback ESTABELECEU (`product_identification`
 * da avaliação vigente: solicitação identificada ou só a família). Chamada sem essa análise conta como "sem produto estabelecido".
 */
export async function practiceProductEvidenceOf(db: Queryable, organizationId: string, row: Pick<PracticeRow, "versionAnalysisId" | "definitionHash">, contexts: readonly Pick<SupportedContext, "cellKey">[]): Promise<PracticeProductEvidence> {
  if (!row.versionAnalysisId || !row.definitionHash || contexts.length === 0) return { presentCalls: 0, callsWithProduct: 0, products: [] }
  const rows = (await db.query<{ call_ref: string; names: string[] | null }>(
    `select c.call_ref, (
        select array_agg(distinct n.node->>'name') from call_assessments a
         cross join lateral jsonb_array_elements(case when jsonb_typeof(a.product_identification->'requests') = 'array' then a.product_identification->'requests' else '[]'::jsonb end) r(request)
         cross join lateral jsonb_array_elements(case when jsonb_typeof(a.product_identification->'catalog'->'nodes') = 'array' then a.product_identification->'catalog'->'nodes' else '[]'::jsonb end) n(node)
         where a.organization_id = c.organization_id and a.interaction_id = c.interaction_id and a.is_current
           and r.request->>'status' in ('IDENTIFIED', 'FAMILY_ONLY') and n.node->>'handle' = r.request->>'identified' and nullif(btrim(n.node->>'name'), '') is not null
      ) names
       from best_practice_call_codings c
      where c.organization_id = $1 and c.analysis_id = $2 and c.definition_hash = $3 and c.status = 'PRESENT' and c.cell_key = any($4::text[])`,
    [organizationId, row.versionAnalysisId, row.definitionHash, contexts.map((context) => context.cellKey)],
  )).rows
  const withProduct = rows.filter((entry) => (entry.names ?? []).length > 0)
  return { presentCalls: new Set(rows.map((entry) => entry.call_ref)).size, callsWithProduct: new Set(withProduct.map((entry) => entry.call_ref)).size, products: withProduct.flatMap((entry) => entry.names ?? []) }
}

export type RelevantPractice = { row: PracticeRow; contexts: SupportedContext[]; item: GuidanceItem }

/** Padrões disponíveis e relevantes para a pessoa, com a evidência das chamadas dela (quando houver) — no máximo `limit`. */
export async function relevantPracticesFor(db: Queryable, input: { organizationId: string; indicatorId: string | null; source: PracticeSource; contexts: readonly ContextFilter[] | null; who: { personId: string } | { operatorRef: string } | null; limit?: number }): Promise<RelevantPractice[]> {
  const rank = (strength: EvidenceStrength) => (strength === "STRONG" ? 2 : strength === "MODERATE" ? 1 : 0)
  const rows = (await loadPracticeRows(db, input)).sort((a, b) => rank(b.currentStrength) - rank(a.currentStrength))
  const allowSynthetic = input.source.origin === "SYNTHETIC"
  const out: RelevantPractice[] = []
  for (const row of rows) {
    if (!isAvailable(row, { allowSynthetic })) continue
    const contexts = matchingContexts(row, input.contexts)
    if (contexts.length === 0) continue
    const evidence = input.who ? await operatorEvidenceOf(db, input.organizationId, row, input.who, contexts) : null
    out.push({ row, contexts, item: guidanceItemOf(guidancePatternOf(row, contexts), evidence) })
    if (out.length >= (input.limit ?? 3)) break
  }
  return out
}

/** `product`: o produto da prática quando ela é "deste produto" (`BEST_PRACTICE_SELECTION_V2`, só calculado quando quem pede informa os produtos). */
export type LeveledPractice = RelevantPractice & { from: SelectedFrom; product?: string | null }

/**
 * Práticas para a pessoa pelo RECUO (`BEST_PRACTICE_SELECTION_V1`, selection-levels.ts): assuntos em ordem de prioridade; em cada
 * um, o primeiro nível (subgrupo + submotivo → grupo + submotivo → subgrupo + motivo → grupo + motivo) com prática disponível vence
 * e o assunto para ali — níveis nunca se misturam num assunto. Só dados REAIS da população da pessoa; no máximo `limit`.
 */
/**
 * `products` (`BEST_PRACTICE_SELECTION_V2`, feedback): os produtos ESTABELECIDOS no caso. Informado, a prática "deste produto" só entra
 * quando o produto dela está entre eles (lista vazia = só as gerais); omitido (chat, voz, liderança), nada muda.
 */
export async function leveledPracticesFor(db: Queryable, input: { organizationId: string; indicatorId: string | null; channelFlagId?: string | null; placement: Placement; subjects: readonly Subject[]; who: { personId: string } | null; limit: number; products?: readonly string[] }): Promise<LeveledPractice[]> {
  const rank = (strength: EvidenceStrength) => (strength === "STRONG" ? 2 : strength === "MODERATE" ? 1 : 0)
  const rows = (await loadPracticeRows(db, { organizationId: input.organizationId, indicatorId: input.indicatorId, channelFlagId: input.channelFlagId ?? null, source: { origin: "REAL", teamId: input.placement.teamId } }))
    .filter((row) => isAvailable(row))
    .sort((a, b) => rank(b.currentStrength) - rank(a.currentStrength))
  const out: LeveledPractice[] = []
  for (const subject of input.subjects) {
    if (out.length >= input.limit) break
    for (const level of levelsFor(input.placement)) {
      const matched = rows.flatMap((row) => {
        if (!populationMatches(row, input.placement, level.population)) return []
        const contexts = row.supportedContexts.filter((context) => contextMatches(context, subject, level.context))
        return contexts.length > 0 ? [{ row, contexts }] : []
      })
      // Prática de outro produto (ou de um produto, num caso sem produto estabelecido) não conta para o nível: o recuo segue.
      const found: { row: PracticeRow; contexts: SupportedContext[]; product: string | null }[] = []
      for (const entry of matched) {
        const product = input.products ? practiceProductOf(await practiceProductEvidenceOf(db, input.organizationId, entry.row, entry.contexts)) : null
        if (productMatches(product, input.products ?? [])) found.push({ ...entry, product })
      }
      if (found.length === 0) continue
      for (const { row, contexts, product } of found) {
        if (out.length >= input.limit) break
        if (out.some((entry) => entry.row.id === row.id)) continue
        const evidence = input.who ? await operatorEvidenceOf(db, input.organizationId, row, input.who, contexts) : null
        out.push({ row, contexts, item: guidanceItemOf(guidancePatternOf(row, contexts), evidence), from: selectedFromOf({ level, placement: input.placement, subject, outcomeName: row.indicatorName, outcomeKind: row.outcomeKind }), ...(input.products ? { product } : {}) })
      }
      break
    }
  }
  return out
}
