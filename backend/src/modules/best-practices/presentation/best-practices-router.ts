import { Router, type Request } from "express"
import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { getManageableScopes, coversOrganization, type ManageableScopes } from "../../auth/application/manageable-scopes.js"
import { canViewDiagnostics } from "../../diagnostics/domain/diagnostics-access.js"
import { PgAnalyticsReadRepository, type AnalyticsReadRepository } from "../../performance-analytics/application/analytics-read-repository.js"
import { activeDirectReportsOf, hasAccessGrant, loadViewerScope, type ViewerScope } from "../../performance-analytics/application/viewer-scope.js"
import { createAnalysis, isProductionEnvironment, type AnalysisActor } from "../application/analysis-service.js"
import { getPatternDetail, listPatterns, reviewPattern } from "../application/pattern-service.js"
import { relevantPracticesFor } from "../application/recommendations.js"
import { callOutcomeLabelsOf, callOutcomeSchema } from "../../channel-flags/domain/call-outcome.js"
import { COMPARISON_LABELS, COMPARISON_MODES } from "../domain/comparison.js"
import { EVIDENCE_METHOD, OUTCOME_LABELS, STRENGTH_LABELS } from "../domain/evidence-criteria.js"
import { guidanceTextOf } from "../domain/guidance.js"
import { OBLIGATION_STATUS_LABELS } from "../domain/obligation-check.js"
import { REVIEW_STATUS_LABELS } from "../domain/pattern.js"
import { syntheticCorpusSchema } from "../domain/synthetic-corpus.js"
import { recordPersonalDataAccess } from "../../data-lifecycle/application/personal-data-access-log.js"
import { projectPeerTranscript } from "../../investigation/domain/peer-privacy-projection.js"
import { projectTranscript } from "../../investigation/domain/transcript-projection.js"

/**
 * /api/v1/best-practices — base de boas práticas. LEITURA: o público do Diagnóstico (lidera alguém ativo ou tem `indicators.view`)
 * ou quem tem `configuration.manage` em algum escopo. GESTÃO (pedir análise, revisar): `configuration.manage` no Grupo do padrão
 * ou da análise; dataset sintético só com a organização inteira e nunca em produção. Organização sempre a da sessão.
 */
type Reader = { scope: ViewerScope | null; scopes: ManageableScopes; visiblePeople: Set<string>; actor: AnalysisActor; canManage: boolean }

const hasManageScope = (scopes: ManageableScopes) => scopes.unrestricted || scopes.allTeams || scopes.teamIds.size > 0 || scopes.subteamIds.size > 0

async function readerOf(db: Database, repository: AnalyticsReadRepository, request: Request): Promise<Reader> {
  const user = request.user!
  const scopes = await getManageableScopes(db, user, "configuration.manage")
  let scope: ViewerScope | null = null
  try {
    scope = await loadViewerScope(repository, user, "indicators.view")
  } catch (error) {
    if (!(error instanceof DomainError && error.code === "PERSON_NOT_FOUND")) throw error
  }
  const diagnostics = scope !== null && canViewDiagnostics({ leadsActiveReports: activeDirectReportsOf(scope, scope.viewer.id).length > 0, hasIndicatorsGrant: hasAccessGrant(scope.access) })
  const canManage = hasManageScope(scopes)
  if (!diagnostics && !canManage) throw new DomainError("Você não tem acesso à base de boas práticas.", "BEST_PRACTICES_ACCESS_DENIED", 403)
  return { scope, scopes, visiblePeople: new Set(diagnostics && scope ? scope.nodes.keys() : []), actor: { organizationId: user.organizationId, personId: user.personId, accountId: user.sub }, canManage }
}

const uuid = z.string().uuid()

export function createBestPracticesRouter(db: Database, deps: { repository?: AnalyticsReadRepository } = {}) {
  const router = Router()
  const repository = deps.repository ?? new PgAnalyticsReadRepository(db)

  router.get("/meta", async (request, response) => {
    const reader = await readerOf(db, repository, request)
    const organizationId = reader.actor.organizationId
    const indicators = (await db.query(`select id, code, name, unit, desired_direction "direction" from indicator_definitions where organization_id = $1 and active order by name`, [organizationId])).rows
    const teams = (await db.query<{ id: string; name: string; subteams: { id: string; name: string }[] }>(
      `select t.id, t.name, coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) order by s.name) from subteams s where s.team_id = t.id), '[]'::jsonb) subteams
         from teams t where t.organization_id = $1 order by t.name`,
      [organizationId],
    )).rows
    const scopes = reader.scopes
    // Quem administra só um Subgrupo vê o Grupo dele com apenas os Subgrupos que administra (pede análise só do Subgrupo).
    const manageableTeams = scopes.unrestricted || scopes.allTeams
      ? teams.map((team) => ({ ...team, wholeTeam: true }))
      : teams
          .filter((team) => scopes.teamIds.has(team.id) || team.subteams.some((subteam) => scopes.subteamIds.has(subteam.id)))
          .map((team) => ({ ...team, wholeTeam: scopes.teamIds.has(team.id), subteams: scopes.teamIds.has(team.id) ? team.subteams : team.subteams.filter((subteam) => scopes.subteamIds.has(subteam.id)) }))
    const production = isProductionEnvironment()
    const datasets = production ? [] : (await db.query(`select id, dataset_key "key", label, description, version, answer_key is not null "hasAnswerKey", jsonb_array_length(corpus->'calls') "calls", jsonb_array_length(corpus->'operators') "operators", corpus->'operators' "operatorList", (select coalesce(jsonb_agg(distinct r->>'referencePeriod'), '[]'::jsonb) from jsonb_array_elements(corpus->'results') r) "periods", updated_at "updatedAt" from best_practice_synthetic_datasets where organization_id = $1 order by label`, [organizationId])).rows
    // Sinais da chamada com "chamada boa × ruim" cadastrado: podem ser o resultado de uma análise (BEST_PRACTICE_ANALYSIS_V3).
    const signals = (await db.query<{ id: string; flag_name: string; label: string | null; call_outcome: unknown }>(`select id, flag_name, label, call_outcome from channel_flags where organization_id = $1 and active and call_outcome is not null order by coalesce(label, flag_name)`, [organizationId])).rows.flatMap((row) => {
      const outcome = callOutcomeSchema.safeParse(row.call_outcome)
      if (!outcome.success) return []
      const name = row.label?.trim() || row.flag_name
      return [{ id: row.id, name, ...callOutcomeLabelsOf(name, outcome.data) }]
    })
    const periods = (await db.query<{ reference_period: string }>(`select distinct reference_period from employee_indicator_performance where organization_id = $1 order by reference_period desc limit 12`, [organizationId])).rows.map((row) => row.reference_period)
    response.json({
      data: {
        indicators,
        signals,
        teams,
        manageableTeams,
        datasets,
        periods,
        capabilities: { canManage: reader.canManage, canRunSynthetic: !production && coversOrganization(reader.scopes) },
        comparisonModes: COMPARISON_MODES.map((mode) => ({ mode, ...COMPARISON_LABELS[mode] })),
        method: EVIDENCE_METHOD,
        labels: { outcome: OUTCOME_LABELS, strength: STRENGTH_LABELS, obligation: OBLIGATION_STATUS_LABELS, review: REVIEW_STATUS_LABELS },
      },
    })
  })

  router.get("/patterns", async (request, response) => {
    const reader = await readerOf(db, repository, request)
    response.json({ data: await listPatterns(db, reader.actor.organizationId, request.query as Record<string, unknown>) })
  })

  router.get("/patterns/:id", async (request, response) => {
    const reader = await readerOf(db, repository, request)
    const id = uuid.parse(request.params.id)
    response.json({ data: await getPatternDetail(db, reader.actor.organizationId, id, { personId: reader.actor.personId, visiblePeople: reader.visiblePeople, scopes: reader.canManage ? reader.scopes : null }) })
  })

  router.post("/patterns/:id/review", async (request, response) => {
    const reader = await readerOf(db, repository, request)
    if (!reader.canManage) throw new DomainError("Você não pode revisar padrões.", "BEST_PRACTICE_SCOPE_DENIED", 403)
    response.json({ data: await reviewPattern(db, reader.actor, reader.scopes, uuid.parse(request.params.id), request.body) })
  })

  router.get("/analyses", async (request, response) => {
    const reader = await readerOf(db, repository, request)
    const rows = (await db.query(
      `select a.id, a.data_origin "dataOrigin", sd.label "datasetLabel", a.indicator_definition_id "indicatorId", coalesce(i.name, nullif(btrim(cf.label), ''), cf.flag_name) "indicatorName", a.channel_flag_id "channelFlagId", a.team_id "teamId", t.name "teamName", a.subteam_id "subteamId", st.name "subteamName",
              a.reference_periods "referencePeriods", a.context_level "contextLevel", a.comparison, a.model_mode "modelMode", a.status, a.outcome, a.error_code "errorCode", a.error_message "errorMessage",
              a.report->>'summary' summary, (a.provenance->'usage'->>'calls')::int "modelCalls", (a.provenance->'usage'->>'costUsd')::float "costUsd",
              a.created_at "createdAt", a.started_at "startedAt", a.finished_at "finishedAt", pe.name "requestedBy"
         from best_practice_analyses a left join indicator_definitions i on i.id = a.indicator_definition_id left join channel_flags cf on cf.id = a.channel_flag_id
         left join teams t on t.id = a.team_id left join subteams st on st.id = a.subteam_id left join best_practice_synthetic_datasets sd on sd.id = a.synthetic_dataset_id left join people pe on pe.id = a.requested_by_person_id
        where a.organization_id = $1 order by a.created_at desc limit 50`,
      [reader.actor.organizationId],
    )).rows
    response.json({ data: rows })
  })

  router.get("/analyses/:id", async (request, response) => {
    const reader = await readerOf(db, repository, request)
    const row = (await db.query(`select id, data_origin "dataOrigin", status, outcome, model_mode "modelMode", report, provenance, error_code "errorCode", error_message "errorMessage", created_at "createdAt", finished_at "finishedAt" from best_practice_analyses where id = $1 and organization_id = $2`, [uuid.parse(request.params.id), reader.actor.organizationId])).rows[0]
    if (!row) throw new DomainError("Análise não encontrada.", "BEST_PRACTICE_ANALYSIS_NOT_FOUND", 404)
    response.json({ data: row })
  })

  router.post("/analyses", async (request, response) => {
    const reader = await readerOf(db, repository, request)
    if (!reader.canManage) throw new DomainError("Você não pode pedir análises de boas práticas.", "BEST_PRACTICE_SCOPE_DENIED", 403)
    response.status(201).json({ data: await createAnalysis(db, reader.actor, reader.scopes, request.body) })
  })

  // A chamada de uma evidência, para ler o trecho no contexto: transcrição com PII e nome de operador mascarados, o turno citado
  // marcado. Real: só se a pessoa estiver no escopo de quem lê (senão, o mesmo 404 de inexistente) e o acesso é registrado (LGPD).
  router.get("/evidence/:id/call", async (request, response) => {
    const reader = await readerOf(db, repository, request)
    const row = (await db.query<{ call_ref: string; interaction_id: string | null; person_id: string | null; operator_label: string; reason: string | null; sub_reason: string | null; occurred_at: Date | null; turn_ref: string; excerpt: string; data_origin: string; synthetic_dataset_id: string | null }>(
      `select e.call_ref, e.interaction_id, e.person_id, e.operator_label, e.reason, e.sub_reason, e.occurred_at, e.turn_ref, e.excerpt, p.data_origin, p.synthetic_dataset_id
         from best_practice_evidence e join best_practice_pattern_versions v on v.id = e.pattern_version_id join best_practice_patterns p on p.id = v.pattern_id
        where e.id = $1 and e.organization_id = $2`,
      [uuid.parse(request.params.id), reader.actor.organizationId],
    )).rows[0]
    const notFound = () => new DomainError("Chamada não encontrada.", "BEST_PRACTICE_EVIDENCE_NOT_FOUND", 404)
    if (!row) throw notFound()
    let transcript: string | null = null
    let operatorName: string | null = null
    if (row.data_origin === "SYNTHETIC") {
      const dataset = (await db.query<{ corpus: unknown }>(`select corpus from best_practice_synthetic_datasets where id = $1 and organization_id = $2`, [row.synthetic_dataset_id, reader.actor.organizationId])).rows[0]
      const corpus = dataset ? syntheticCorpusSchema.parse(dataset.corpus) : null
      const call = corpus?.calls.find((item) => item.ref === row.call_ref)
      transcript = call?.transcript ?? null
      operatorName = corpus?.operators.find((operator) => operator.ref === call?.operatorRef)?.name ?? null
    } else {
      if (!row.interaction_id || !row.person_id || !reader.visiblePeople.has(row.person_id)) throw notFound()
      transcript = (await db.query<{ content: string }>(`select t.content from transcripts t join interactions i on i.id = t.interaction_id and i.organization_id = $2 where t.interaction_id = $1 order by t.version desc limit 1`, [row.interaction_id, reader.actor.organizationId])).rows[0]?.content ?? null
      operatorName = reader.scope?.nodes.get(row.person_id)?.name ?? null
      await recordPersonalDataAccess(db, { organizationId: reader.actor.organizationId, viewerPersonId: reader.actor.personId, subjectPersonId: row.person_id, dataKind: "CALL_TRANSCRIPT", resourceId: row.interaction_id })
    }
    if (!transcript) throw notFound()
    const masked = projectPeerTranscript({ sourceInteractionId: row.call_ref, transcript, peer: { personId: row.person_id ?? row.call_ref, fullName: operatorName ?? "Operador" } }).projected
    response.json({ data: { operatorLabel: row.operator_label, context: row.sub_reason ? `${row.reason} › ${row.sub_reason}` : row.reason, occurredAt: row.occurred_at, turnRef: row.turn_ref, excerpt: row.excerpt, synthetic: row.data_origin === "SYNTHETIC", turns: projectTranscript(masked).turns.map((turn) => ({ handle: turn.handle, speaker: turn.speaker, text: turn.text })) } })
  })

  // Orientações relevantes para um caso (Diagnóstico/feedback): indicador + contexto; com `personId` visível, a evidência das
  // chamadas dessa pessoa. Só padrões disponíveis de dados reais.
  router.get("/relevant", async (request, response) => {
    const reader = await readerOf(db, repository, request)
    const query = z.object({ indicatorId: uuid.optional(), reason: z.string().trim().min(1).max(200).optional(), subReason: z.string().trim().min(1).max(200).optional(), personId: uuid.optional(), teamId: uuid.optional(), interactionId: uuid.optional() }).parse(request.query)
    // Uma chamada: o contexto é o motivo/submotivo registrado nela e a pessoa é quem atendeu — só se estiver no escopo de quem lê.
    const call = query.interactionId ? (await db.query<{ operator_id: string; reason: string; sub_reason: string | null }>(`select operator_id, reason, nullif(btrim(sub_reason), '') sub_reason from interactions where id = $1 and organization_id = $2`, [query.interactionId, reader.actor.organizationId])).rows[0] ?? null : null
    if (query.interactionId && (!call || !reader.visiblePeople.has(call.operator_id))) return response.json({ data: [] })
    const personId = call?.operator_id ?? query.personId
    const person = personId && reader.visiblePeople.has(personId) ? reader.scope?.nodes.get(personId) ?? null : null
    const contexts = call ? [{ reason: call.reason, subReason: call.sub_reason }] : query.reason ? [{ reason: query.reason, subReason: query.subReason ?? null }] : null
    const practices = await relevantPracticesFor(db, { organizationId: reader.actor.organizationId, indicatorId: query.indicatorId ?? null, source: { origin: "REAL", teamId: person?.teamId ?? query.teamId ?? null }, contexts, who: person ? { personId: person.id } : null, limit: 3 })
    response.json({ data: practices.map((practice) => ({ ...practice.item, indicatorName: practice.row.indicatorName })) })
  })

  // Pré-visualização (dataset SINTÉTICO, fora de produção): a MESMA orientação que a INIA daria a um operador do dataset.
  router.get("/preview", async (request, response) => {
    const reader = await readerOf(db, repository, request)
    if (isProductionEnvironment()) throw new DomainError("Pré-visualização sintética indisponível em produção.", "BEST_PRACTICE_SYNTHETIC_DISABLED", 403)
    const query = z.object({ datasetId: uuid, operatorRef: z.string().trim().min(1).max(40), indicatorId: uuid, reason: z.string().trim().min(1).max(200).optional() }).parse(request.query)
    const indicator = (await db.query<{ name: string }>(`select name from indicator_definitions where id = $1 and organization_id = $2`, [query.indicatorId, reader.actor.organizationId])).rows[0]
    if (!indicator) throw new DomainError("Indicador não encontrado.", "BEST_PRACTICE_INDICATOR_NOT_FOUND", 422)
    const practices = await relevantPracticesFor(db, { organizationId: reader.actor.organizationId, indicatorId: query.indicatorId, source: { origin: "SYNTHETIC", datasetId: query.datasetId }, contexts: query.reason ? [{ reason: query.reason, subReason: null }] : null, who: { operatorRef: query.operatorRef }, limit: 3 })
    const items = practices.map((practice) => practice.item)
    response.json({ data: { items, text: guidanceTextOf({ indicatorName: indicator.name, contextsLabel: query.reason ?? null, items, noPatternReason: null }) } })
  })

  return router
}
