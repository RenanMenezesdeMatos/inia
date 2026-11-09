import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { booleanParam, listParam, respondList, searchParam, SqlFilter } from "../../../shared/presentation/list-query.js"
import { canManageScope, coversOrganization, type ManageableScopes } from "../../auth/application/manageable-scopes.js"
import { recordPersonalDataAccess } from "../../data-lifecycle/application/personal-data-access-log.js"
import { hasUnmaskedLongNumber } from "../domain/excerpt-privacy.js"
import { redactEvidentPii } from "../../investigation/domain/peer-privacy-projection.js"
import { nextReviewState, unavailabilityReasonsOf, type PatternState, type ReviewAction } from "../domain/pattern.js"
import { inTransaction } from "../../../shared/infrastructure/database/transaction.js"
import type { AnalysisActor } from "./analysis-service.js"

/**
 * LEITURA E REVISÃO dos padrões. Quem lê: o público do Diagnóstico (lidera alguém ou tem `indicators.view`) e quem administra a
 * configuração. Quem revisa: `configuration.manage` no Grupo do padrão (sintético = organização inteira). A disponibilidade para
 * recomendação é sempre DERIVADA (pattern.ts); a revisão nunca mexe em número nem em evidência.
 */
export const AVAILABLE_SQL = `(p.review_status = 'APPROVED' and (p.obligation_status <> 'UNDETERMINED' or p.obligation_confirmed_by_review) and p.current_strength in ('STRONG', 'MODERATE') and p.data_origin = 'REAL')`

const SELECT_PATTERNS = `
  select p.id, p.data_origin "dataOrigin", p.synthetic_dataset_id "syntheticDatasetId", sd.label "syntheticDatasetLabel",
         p.indicator_definition_id "indicatorId", coalesce(i.code, cf.flag_name) "indicatorCode", coalesce(i.name, nullif(btrim(cf.label), ''), cf.flag_name) "indicatorName",
         p.channel_flag_id "channelFlagId", case when p.channel_flag_id is not null then 'CALL_SIGNAL' else 'INDICATOR' end "outcomeSource", p.team_id "teamId", t.name "teamName", p.subteam_id "subteamId", st.name "subteamName",
         p.name, p.description, p.observable_definition "observableDefinition", p.guidance, p.suggested_phrasing "suggestedPhrasing",
         p.applies_when "appliesWhen", p.not_applicable_when "notApplicableWhen", p.how_it_helps "howItHelps",
         case when p.how_it_helps is null then null when p.how_it_helps is not distinct from v.proposed->>'howItHelps' then 'AI_DRAFT' else 'REVIEWER' end "howItHelpsSource",
         p.review_status "reviewStatus", p.obligation_status "obligationStatus", p.obligation_confirmed_by_review "obligationConfirmedByReview",
         p.current_strength "currentStrength", p.supported_contexts "supportedContexts", p.created_at "createdAt", p.updated_at "updatedAt",
         v.version "currentVersion", to_char(v.period_start, 'YYYY-MM-DD') "periodStart", to_char(v.period_end, 'YYYY-MM-DD') "periodEnd",
         v.calls_analyzed "callsAnalyzed", v.operators_analyzed "operatorsAnalyzed",
         ${AVAILABLE_SQL} "available",
         case when p.review_status = 'PENDING_REVIEW' then 0 when p.review_status = 'APPROVED' then 1 when p.review_status = 'INACTIVE' then 2 else 3 end "statusOrder"
    from best_practice_patterns p
    left join indicator_definitions_all i on i.id = p.indicator_definition_id
    left join channel_flags_all cf on cf.id = p.channel_flag_id
    left join teams t on t.id = p.team_id
    left join subteams st on st.id = p.subteam_id
    left join best_practice_synthetic_datasets sd on sd.id = p.synthetic_dataset_id
    left join best_practice_pattern_versions v on v.id = p.current_version_id
   where p.organization_id = $1`

const listQuerySchema = z.object({
  search: searchParam,
  indicatorId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
  subteamId: z.string().uuid().optional(),
  origin: z.enum(["REAL", "SYNTHETIC"]).optional(),
  reviewStatus: listParam(z.enum(["PENDING_REVIEW", "APPROVED", "REJECTED", "INACTIVE"])),
  obligationStatus: listParam(z.enum(["OPTIONAL", "DIFFERENTIATED_EXECUTION", "UNDETERMINED"])),
  available: booleanParam,
  context: searchParam,
})

export async function listPatterns(db: Database, organizationId: string, query: Record<string, unknown>) {
  const input = listQuerySchema.parse(query)
  const filter = new SqlFilter([organizationId])
    .search(input.search, ["q.name", "q.description"])
    .equals(`q."indicatorId"`, input.indicatorId)
    .equals(`q."teamId"`, input.teamId)
    .equals(`q."subteamId"`, input.subteamId)
    .equals(`q."dataOrigin"`, input.origin)
    .in(`q."reviewStatus"`, input.reviewStatus)
    .in(`q."obligationStatus"`, input.obligationStatus)
    .search(input.context, [`q."supportedContexts"::text`])
  if (input.available !== undefined) filter.add(input.available ? `q.available` : `not q.available`)
  return respondList(db, query, { select: SELECT_PATTERNS, filter, orderBy: `q."statusOrder", q."updatedAt" desc, q.id` })
}

type PatternRow = Record<string, unknown> & PatternState & { id: string; teamId: string | null; subteamId: string | null; dataOrigin: "REAL" | "SYNTHETIC" }

async function loadPattern(db: Pick<Database, "query">, organizationId: string, id: string): Promise<PatternRow> {
  const row = (await db.query<PatternRow>(`select q.* from (${SELECT_PATTERNS}) q where q.id = $2`, [organizationId, id])).rows[0]
  if (!row) throw new DomainError("Padrão não encontrado.", "BEST_PRACTICE_PATTERN_NOT_FOUND", 404)
  return row
}

/** Revisa quem administra a população do padrão: o Grupo (que inclui os Subgrupos dele) ou, no padrão de Subgrupo, o próprio Subgrupo. */
export const canManagePattern = (scopes: ManageableScopes, pattern: { dataOrigin: string; teamId: string | null; subteamId?: string | null }) =>
  pattern.dataOrigin === "SYNTHETIC"
    ? coversOrganization(scopes)
    : pattern.subteamId
      ? canManageScope(scopes, { scopeType: "SUBTEAM", teamId: pattern.teamId, subteamId: pattern.subteamId })
      : canManageScope(scopes, { scopeType: "TEAM", teamId: pattern.teamId, subteamId: null })

/** Detalhe: padrão, versão vigente (contextos, critérios, obrigação, limitações), evidências, histórico de versões e de revisão. */
export async function getPatternDetail(db: Database, organizationId: string, id: string, viewer: { personId: string; visiblePeople: ReadonlySet<string>; scopes: ManageableScopes | null }) {
  const pattern = await loadPattern(db, organizationId, id)
  const current = (await db.query<{ id: string; version: number; analysis_id: string; contexts: unknown; strength: string; obligation_check: unknown; limitations: string[]; proposed: unknown; period_start: string; period_end: string; reference_periods: string[]; calls_analyzed: number; operators_analyzed: number; created_at: Date }>(
    `select v.id, v.version, v.analysis_id, v.contexts, v.strength, v.obligation_check, v.limitations, v.proposed, to_char(v.period_start, 'YYYY-MM-DD') period_start, to_char(v.period_end, 'YYYY-MM-DD') period_end, v.reference_periods, v.calls_analyzed, v.operators_analyzed, v.created_at
       from best_practice_pattern_versions v join best_practice_patterns p on p.current_version_id = v.id where p.id = $1 and p.organization_id = $2`,
    [id, organizationId],
  )).rows[0] ?? null
  const evidenceRows = current
    ? (await db.query<{ id: string; call_ref: string; interaction_id: string | null; person_id: string | null; operator_label: string; cell_key: string; reason: string | null; sub_reason: string | null; occurred_at: Date | null; turn_ref: string; excerpt: string }>(
        `select id, call_ref, interaction_id, person_id, operator_label, cell_key, reason, sub_reason, occurred_at, turn_ref, excerpt from best_practice_evidence where pattern_version_id = $1 and organization_id = $2 order by position`,
        [current.id, organizationId],
      )).rows
    : []
  // Defesa em profundidade: o trecho já foi gravado mascarado; se algo escapou, não é exibido.
  const evidence = evidenceRows.flatMap((row) => {
    const text = redactEvidentPii(row.excerpt).text
    if (hasUnmaskedLongNumber(text)) return []
    return [{ id: row.id, callRef: pattern.dataOrigin === "SYNTHETIC" ? row.call_ref : null, interactionId: row.interaction_id && row.person_id && viewer.visiblePeople.has(row.person_id) ? row.interaction_id : null, operatorLabel: row.operator_label, context: row.sub_reason ? `${row.reason} › ${row.sub_reason}` : row.reason, occurredAt: row.occurred_at, turnRef: row.turn_ref, excerpt: text }]
  })
  const people = [...new Set(evidenceRows.flatMap((row) => (row.person_id ? [row.person_id] : [])))]
  for (const subjectPersonId of people) await recordPersonalDataAccess(db, { organizationId, viewerPersonId: viewer.personId, subjectPersonId, dataKind: "CALL_TRANSCRIPT", resourceId: id })
  const versions = (await db.query(
    `select v.id, v.version, v.analysis_id "analysisId", v.strength, v.supported, v.created_at "createdAt", to_char(v.period_start, 'YYYY-MM-DD') "periodStart", to_char(v.period_end, 'YYYY-MM-DD') "periodEnd", v.calls_analyzed "callsAnalyzed", a.model_mode "modelMode"
       from (select *, (select count(*)::int from jsonb_array_elements(contexts) c where c->'assessment'->>'outcome' = 'SUPPORTED') supported from best_practice_pattern_versions where pattern_id = $1 and organization_id = $2) v
       join best_practice_analyses a on a.id = v.analysis_id order by v.version desc`,
    [id, organizationId],
  )).rows
  const reviews = (await db.query(
    `select r.id, r.action, r.from_status "fromStatus", r.to_status "toStatus", r.reason, r.changes, r.analysis_id "analysisId", r.created_at "createdAt", pe.name "actorName"
       from best_practice_pattern_reviews r left join people pe on pe.id = r.actor_person_id where r.pattern_id = $1 and r.organization_id = $2 order by r.created_at desc, r.id desc`,
    [id, organizationId],
  )).rows
  return {
    ...pattern,
    unavailabilityReasons: unavailabilityReasonsOf(pattern),
    canManage: viewer.scopes ? canManagePattern(viewer.scopes, pattern) : false,
    current: current ? { id: current.id, version: current.version, analysisId: current.analysis_id, contexts: current.contexts, strength: current.strength, obligationCheck: current.obligation_check, limitations: current.limitations, proposed: current.proposed, periodStart: current.period_start, periodEnd: current.period_end, referencePeriods: current.reference_periods, callsAnalyzed: current.calls_analyzed, operatorsAnalyzed: current.operators_analyzed, createdAt: current.created_at } : null,
    evidence,
    versions,
    reviews,
  }
}

const text = (min: number, max: number) => z.string().trim().min(min).max(max)
export const reviewSchema = z.object({
  action: z.enum(["APPROVE", "REJECT", "DEACTIVATE", "REACTIVATE", "CONFIRM_NOT_OBLIGATION", "EDIT"]),
  reason: z.string().trim().max(1000).nullish(),
  changes: z.object({ name: text(3, 160).optional(), description: text(3, 2000).optional(), guidance: text(3, 2000).optional(), suggestedPhrasing: z.string().trim().max(600).nullable().optional(), notApplicableWhen: z.string().trim().max(600).nullable().optional(), howItHelps: z.string().trim().max(1000).nullable().optional().refine((value) => !value || value.length >= 3, "Escreva ao menos 3 caracteres ou deixe vazio.") }).optional(),
})

const ACTION_AUDIT: Record<ReviewAction, string> = { APPROVE: "BEST_PRACTICE_PATTERN_APPROVED", REJECT: "BEST_PRACTICE_PATTERN_REJECTED", DEACTIVATE: "BEST_PRACTICE_PATTERN_DEACTIVATED", REACTIVATE: "BEST_PRACTICE_PATTERN_REACTIVATED", CONFIRM_NOT_OBLIGATION: "BEST_PRACTICE_PATTERN_OBLIGATION_CONFIRMED", EDIT: "BEST_PRACTICE_PATTERN_EDITED" }

export async function reviewPattern(db: Database, actor: AnalysisActor, scopes: ManageableScopes, id: string, body: unknown) {
  const input = reviewSchema.parse(body)
  return inTransaction(db, async (client) => {
    const pattern = await loadPattern(client, actor.organizationId, id)
    if (!canManagePattern(scopes, pattern)) throw new DomainError("Você não administra a população deste padrão.", "BEST_PRACTICE_SCOPE_DENIED", 403)
    const next = nextReviewState(pattern, input.action, input.reason ?? null)
    const changes: Record<string, string | null> = {}
    if (input.action === "EDIT") {
      for (const [key, value] of Object.entries(input.changes ?? {})) if (value !== undefined) changes[key] = value === "" ? null : value
      if (Object.keys(changes).length === 0) throw new DomainError("Nada a editar.", "BEST_PRACTICE_EDIT_EMPTY", 422)
      const phrasing = changes.suggestedPhrasing
      if (phrasing && (redactEvidentPii(phrasing).redactions.length > 0 || hasUnmaskedLongNumber(phrasing))) throw new DomainError("A sugestão de fala não pode ter dado pessoal nem número de identificação.", "BEST_PRACTICE_PHRASING_PERSONAL_DATA", 422)
      const howItHelps = changes.howItHelps
      if (howItHelps && (redactEvidentPii(howItHelps).redactions.length > 0 || hasUnmaskedLongNumber(howItHelps))) throw new DomainError("\"Como isso ajuda no resultado\" não pode ter dado pessoal nem número de identificação.", "BEST_PRACTICE_HOW_IT_HELPS_PERSONAL_DATA", 422)
    }
    const columns: Record<string, string> = { name: "name", description: "description", guidance: "guidance", suggestedPhrasing: "suggested_phrasing", notApplicableWhen: "not_applicable_when", howItHelps: "how_it_helps" }
    const sets = Object.keys(changes).map((key, index) => `${columns[key]} = $${index + 6}`)
    const updated = await client.query(
      `update best_practice_patterns set review_status = $3, obligation_confirmed_by_review = $4, updated_at = now()${sets.length > 0 ? `, ${sets.join(", ")}` : ""}
        where id = $1 and organization_id = $2 and review_status = $5`,
      [id, actor.organizationId, next.reviewStatus, next.obligationConfirmedByReview, pattern.reviewStatus, ...Object.values(changes)],
    )
    if (updated.rowCount !== 1) throw new DomainError("O padrão mudou enquanto você revisava. Atualize e tente de novo.", "BEST_PRACTICE_REVIEW_CONFLICT", 409)
    await client.query(
      `insert into best_practice_pattern_reviews (organization_id, pattern_id, action, from_status, to_status, reason, changes, actor_person_id) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [actor.organizationId, id, input.action, pattern.reviewStatus, next.reviewStatus, input.reason?.trim() || null, Object.keys(changes).length > 0 ? JSON.stringify(changes) : null, actor.personId],
    )
    await client.query(`insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload) values ($1, $2, $3, 'best_practice_pattern', $4, $5)`, [actor.organizationId, actor.personId, ACTION_AUDIT[input.action], id, JSON.stringify({ from: pattern.reviewStatus, to: next.reviewStatus, reason: input.reason ?? null, changes })])
    return { id, reviewStatus: next.reviewStatus, obligationConfirmedByReview: next.obligationConfirmedByReview }
  })
}
