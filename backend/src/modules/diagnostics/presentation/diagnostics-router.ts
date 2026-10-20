import { Router } from "express"
import type { Database } from "../../../infrastructure/database/pool.js"
import { recordPersonalDataAccess } from "../../data-lifecycle/application/personal-data-access-log.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { PgAnalyticsReadRepository, type AnalyticsReadRepository } from "../../performance-analytics/application/analytics-read-repository.js"
import { activeDirectReportsOf, hasAccessGrant, loadViewerScope, type ViewerScope } from "../../performance-analytics/application/viewer-scope.js"
import { canViewDiagnostics } from "../domain/diagnostics-access.js"
import { resolveAccessibleKnowledgeMaterials } from "../../knowledge/application/knowledge-material-access.js"
import { buildKnowledgeMaterialHref } from "../../knowledge/domain/material-href.js"
import {
  assessmentDetail,
  assessmentList,
  concentration,
  indicatorInvestigationDetail,
  indicatorInvestigations,
  materialAggregates,
  memorySummary,
  METHOD_NOTE,
  peopleAggregates,
  processAggregates,
  toCsv,
  type Dimension,
  type GroupBy,
  type MemoryFilters,
  type ProcessOrder,
} from "../../feedback-engine/application/leadership-diagnostics.js"

const LEVEL_ORDER = `case pe.current_level when 'MANAGER' then 5 when 'ACTION_PLAN' then 4 when 'COACH' then 3 when 'ORIENT' then 2 else 1 end`

function diagnosticsDenied(): DomainError {
  return new DomainError("Você não tem acesso ao Diagnóstico.", "DIAGNOSTICS_ACCESS_DENIED", 403)
}

/** Escopo da área: organização SEMPRE da sessão; entrada pela regra única; pessoas = conjunto visível (subárvore ∪ escopo). */
async function authorize(repository: AnalyticsReadRepository, user: Parameters<typeof loadViewerScope>[1]): Promise<ViewerScope> {
  const scope = await loadViewerScope(repository, user, "indicators.view")
  const allowed = canViewDiagnostics({ leadsActiveReports: activeDirectReportsOf(scope, scope.viewer.id).length > 0, hasIndicatorsGrant: hasAccessGrant(scope.access) })
  if (!allowed) throw diagnosticsDenied()
  return scope
}

export function createDiagnosticsRouter(db: Database, deps: { repository?: AnalyticsReadRepository } = {}) {
  const router = Router()
  const repository = deps.repository ?? new PgAnalyticsReadRepository(db)

  // Padrões de diagnóstico: agregados da população (motivo × indicador), sem pessoas — abertos a quem abre a área.
  router.get("/", async (request, response) => {
    const scope = await authorize(repository, request.user!)
    const reason = typeof request.query.reason === "string" ? request.query.reason : null
    const indicator = typeof request.query.indicator === "string" ? request.query.indicator : null
    const result = await db.query(`select id,reason,indicator_code "indicator",sample_size "sampleSize",reference_group "referenceGroup",measured_difference "measuredDifference",finding,phrase_example "phraseExample",rhythm_finding "rhythmFinding",confidence,generated_at "generatedAt" from diagnostic_insights where organization_id=$1 and ($2::text is null or reason=$2) and ($3::text is null or indicator_code=$3) order by confidence desc`, [scope.organizationId, reason, indicator])
    response.json({ data: result.rows.map((row) => ({ ...row, confidence: Number(row.confidence) })) })
  })

  // Escalonamentos: SÓ de operadores ativos do conjunto visível — nunca a organização inteira por padrão.
  router.get("/performance", async (request, response) => {
    const scope = await authorize(repository, request.user!)
    const visibleOperators = [...scope.nodes.values()].filter((node) => node.active && node.role === "OPERATOR").map((node) => node.id)
    if (visibleOperators.length === 0) return response.json({ data: [] })
    const result = await db.query(`select pe.id,p.id "operatorId",p.name "operatorName",p.avatar_url "avatarUrl",t.name "teamName",pe.current_level "currentLevel",pe.reason,pe.consecutive_cycles "consecutiveCycles",pe.previous_actions "previousActions",pe.ai_recommendation "aiRecommendation",pe.confidence::float,pe.generated_at "generatedAt" from performance_escalations pe join people p on p.id=pe.operator_id left join teams t on t.id=p.team_id where pe.organization_id=$1 and p.organization_id=$1 and pe.status='ACTIVE' and pe.operator_id = any($2::uuid[]) order by ${LEVEL_ORDER} desc,pe.generated_at desc`, [scope.organizationId, visibleOperators])
    return response.json({ data: result.rows })
  })
  // ---------------------------------------------------------------------------------------------
  // MEMÓRIA DO MOTOR DE FEEDBACK — agregados, drill-down até a evidência e exportação. Só pessoas do escopo do leitor; nenhum
  // agregado chama modelo. Estrutura = a vigente na análise de cada chamada (limitação declarada no método).
  // ---------------------------------------------------------------------------------------------
  const visiblePeople = (scope: ViewerScope) => [...scope.nodes.keys()]
  const DATE = /^\d{4}-\d{2}-\d{2}$/
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const text = (value: unknown) => (typeof value === "string" && value.trim().length > 0 ? value.trim() : null)
  const uuid = (value: unknown) => { const candidate = text(value); return candidate && UUID.test(candidate) ? candidate : null }
  const filtersOf = (query: Record<string, unknown>): MemoryFilters => {
    const today = new Date()
    const defaultTo = today.toISOString().slice(0, 10)
    const defaultFrom = new Date(today.getTime() - 30 * 86_400_000).toISOString().slice(0, 10)
    const from = text(query.from)
    const to = text(query.to)
    // Período limitado a 366 dias (achado U-F13): um intervalo de anos varre a base inteira de avaliações numa requisição.
    const safeFrom = from && DATE.test(from) ? from : defaultFrom
    const safeTo = to && DATE.test(to) ? to : defaultTo
    const spanDays = (Date.parse(`${safeTo}T00:00:00Z`) - Date.parse(`${safeFrom}T00:00:00Z`)) / 86_400_000
    if (!Number.isFinite(spanDays) || spanDays < 0 || spanDays > 366) throw new DomainError("Escolha um período de até 366 dias (início antes do fim).", "DIAGNOSTICS_PERIOD_INVALID", 400)
    return { from: safeFrom, to: safeTo, teamId: uuid(query.teamId), subteamId: uuid(query.subteamId), personId: uuid(query.personId), subject: text(query.subject), documentId: uuid(query.documentId), criterionKey: text(query.criterionKey), status: text(query.status), practiceKey: text(query.practiceKey) }
  }
  const pageOf = (query: Record<string, unknown>) => {
    const size = Math.min(Math.max(Number(query.pageSize) || 25, 1), 200)
    const page = Math.max(Number(query.page) || 1, 1)
    return { limit: size, offset: (page - 1) * size, page, pageSize: size }
  }

  router.get("/memory/summary", async (request, response) => {
    const scope = await authorize(repository, request.user!)
    const filters = filtersOf(request.query)
    response.json({ data: { filters, method: METHOD_NOTE, ...(await memorySummary(db, scope.organizationId, visiblePeople(scope), filters)) } })
  })
  router.get("/memory/filter-options", async (request, response) => {
    const scope = await authorize(repository, request.user!)
    const people = visiblePeople(scope)
    const [teams, subteams, subjects, documents] = await Promise.all([
      db.query<{ id: string; name: string }>(`select distinct t.id, t.name from call_assessments a join teams t on t.id = a.team_id where a.organization_id = $1 and a.person_id = any($2::uuid[]) order by t.name`, [scope.organizationId, people]),
      db.query<{ id: string; name: string }>(`select distinct s.id, s.name from call_assessments a join subteams s on s.id = a.subteam_id where a.organization_id = $1 and a.person_id = any($2::uuid[]) order by s.name`, [scope.organizationId, people]),
      db.query<{ value: string }>(`select distinct coalesce(subject_canonical, subject_raw) value from call_assessments where organization_id = $1 and person_id = any($2::uuid[]) and coalesce(subject_canonical, subject_raw) is not null order by 1`, [scope.organizationId, people]),
      db.query<{ id: string; title: string }>(`select distinct d.id, d.title from call_criterion_assessments c join knowledge_documents d on d.id = c.document_id where c.organization_id = $1 and c.person_id = any($2::uuid[]) order by d.title`, [scope.organizationId, people]),
    ])
    const personOptions = [...scope.nodes.values()].filter((node) => node.role === "OPERATOR").map((node) => ({ id: node.id, name: node.name })).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
    response.json({ data: { teams: teams.rows, subteams: subteams.rows, subjects: subjects.rows.map((row) => row.value), documents: documents.rows, people: personOptions } })
  })
  router.get("/memory/processes", async (request, response) => {
    const scope = await authorize(repository, request.user!)
    const order: ProcessOrder = request.query.order === "MET" || request.query.order === "ALL" ? request.query.order : "DEVIATIONS"
    // Temas com os pontos dentro, inteiros: a leitura é por tema (uma organização tem dezenas de pontos, não milhares).
    response.json({ data: await processAggregates(db, scope.organizationId, visiblePeople(scope), filtersOf(request.query), order) })
  })
  router.get("/memory/people", async (request, response) => {
    const scope = await authorize(repository, request.user!)
    const page = pageOf(request.query)
    const groupBy: GroupBy = request.query.groupBy === "TEAM" || request.query.groupBy === "SUBTEAM" ? request.query.groupBy : "PERSON"
    const result = await peopleAggregates(db, scope.organizationId, visiblePeople(scope), filtersOf(request.query), groupBy, page)
    response.json({ data: { ...result, groupBy, page: page.page, pageSize: page.pageSize } })
  })
  router.get("/memory/concentration", async (request, response) => {
    const scope = await authorize(repository, request.user!)
    const dimension: Dimension = request.query.dimension === "WEEKDAY" || request.query.dimension === "SUBJECT" || request.query.dimension === "HOUR" ? request.query.dimension : "DAY"
    response.json({ data: { dimension, buckets: await concentration(db, scope.organizationId, visiblePeople(scope), filtersOf(request.query), dimension) } })
  })
  router.get("/memory/materials", async (request, response) => {
    const scope = await authorize(repository, request.user!)
    const items = await materialAggregates(db, scope.organizationId, visiblePeople(scope), filtersOf(request.query))
    const accessible = await resolveAccessibleKnowledgeMaterials(db, { organizationId: scope.organizationId, viewer: { personId: scope.viewer.id }, materialIds: items.map((item) => item.documentId) })
    response.json({ data: { items: items.map((item) => ({ ...item, href: accessible.has(item.documentId) ? buildKnowledgeMaterialHref(item.documentId) : null })) } })
  })
  router.get("/memory/indicators", async (request, response) => {
    const scope = await authorize(repository, request.user!)
    const page = pageOf(request.query)
    const result = await indicatorInvestigations(db, scope.organizationId, visiblePeople(scope), filtersOf(request.query), page)
    response.json({ data: { ...result, page: page.page, pageSize: page.pageSize } })
  })
  router.get("/memory/indicators/:id", async (request, response) => {
    const scope = await authorize(repository, request.user!)
    const id = uuid(request.params.id)
    const detail = id ? await indicatorInvestigationDetail(db, scope.organizationId, visiblePeople(scope), id) : null
    if (!detail) throw new DomainError("Investigação não encontrada.", "DIAGNOSTIC_NOT_FOUND", 404)
    response.json({ data: detail })
  })
  router.get("/memory/assessments", async (request, response) => {
    const scope = await authorize(repository, request.user!)
    const page = pageOf(request.query)
    const result = await assessmentList(db, scope.organizationId, visiblePeople(scope), filtersOf(request.query), page)
    response.json({ data: { ...result, page: page.page, pageSize: page.pageSize } })
  })
  router.get("/memory/assessments/:id", async (request, response) => {
    const scope = await authorize(repository, request.user!)
    const id = uuid(request.params.id)
    const detail = id ? await assessmentDetail(db, scope.organizationId, visiblePeople(scope), id) : null
    if (!detail) throw new DomainError("Avaliação não encontrada.", "DIAGNOSTIC_NOT_FOUND", 404)
    // LGPD: quem abriu a transcrição da chamada de outra pessoa (migration 151).
    await recordPersonalDataAccess(db, { organizationId: scope.organizationId, viewerPersonId: scope.viewer.id, subjectPersonId: detail.personId, dataKind: "CALL_TRANSCRIPT", resourceId: id })
    const accessible = await resolveAccessibleKnowledgeMaterials(db, { organizationId: scope.organizationId, viewer: { personId: scope.viewer.id }, materialIds: [...new Set(detail.criteria.map((criterion) => criterion.documentId))] })
    response.json({ data: { ...detail, criteria: detail.criteria.map((criterion) => ({ ...criterion, href: accessible.has(criterion.documentId) ? buildKnowledgeMaterialHref(criterion.documentId) : null })) } })
  })
  router.get("/memory/export.csv", async (request, response) => {
    const scope = await authorize(repository, request.user!)
    const filters = filtersOf(request.query)
    const people = visiblePeople(scope)
    // Visão de uma lista fechada: o valor entra no nome do arquivo e no cabeçalho do CSV (nunca texto livre da URL).
    const view = typeof request.query.view === "string" && ["people", "assessments", "materials", "indicators", "concentration", "processes"].includes(request.query.view) ? request.query.view : "processes"
    const all = { limit: 5_000, offset: 0 }
    const preamble = [`Diagnóstico INIA — ${view}`, `Período: ${filters.from} a ${filters.to}`, `Filtros: ${JSON.stringify(Object.fromEntries(Object.entries(filters).filter(([key, value]) => value !== null && key !== "from" && key !== "to")))}`, METHOD_NOTE, `Gerado em: ${new Date().toISOString()}`]
    const rate = (value: number | null) => (value === null ? "" : `${value}%`)
    // Colunas existentes mantêm nome e significado (contagem POR REGRA — ver o método no cabeçalho). Ocorrências de conduta vêm em colunas
    // NOVAS, com denominador próprio (só regras com ligação determinável).
    const OCCURRENCE_HEAD = ["Ocorrências de desvio (condutas distintas)", "Ocorrências avaliadas", "Taxa de desvio por ocorrência", "Regras avaliadas sem ligação determinável"]
    const occurrenceCells = (stats: { occurrences: { deviations: number; assessed: number; deviationRate: number | null; undeterminedAssessedRules: number; basis: string } }) => [stats.occurrences.basis === "NONE" ? "" : stats.occurrences.deviations, stats.occurrences.basis === "NONE" ? "" : stats.occurrences.assessed, rate(stats.occurrences.deviationRate), stats.occurrences.undeterminedAssessedRules]
    let csv: string
    if (view === "people") {
      const groupBy: GroupBy = request.query.groupBy === "TEAM" || request.query.groupBy === "SUBTEAM" ? request.query.groupBy : "PERSON"
      const result = await peopleAggregates(db, scope.organizationId, people, filters, groupBy, all)
      csv = toCsv(["Grupo/Pessoa", "Chamadas", "Avaliadas", "Cumpridas", "Não cumpridas", "Parciais", "Taxa de desvio", ...OCCURRENCE_HEAD, "Inconclusivas", "Não aplicáveis", "Cobertura", "Principais desvios"], result.items.map((item) => [item.label, item.calls, item.assessed, item.met, item.notMet, item.partial, rate(item.deviationRate), ...occurrenceCells(item), item.inconclusive, item.notApplicable, rate(item.coverageRate), item.topDeviations.map((top) => `${top.title} (${top.deviations}/${top.assessed})`).join(" | ")]), preamble)
    } else if (view === "assessments") {
      const result = await assessmentList(db, scope.organizationId, people, filters, all)
      csv = toCsv(["Data", "Pessoa", "Grupo", "Assunto", "Critério", "Documento", "Status", "Materialidade", "Justificativa", "ID da avaliação", "ID da chamada"], result.items.map((item) => [item.date, item.personName, item.teamName, item.subject, item.criterionText, item.documentTitle, item.status, item.materiality, item.rationale, item.callAssessmentId, item.interactionId]), preamble)
    } else if (view === "materials") {
      const items = await materialAggregates(db, scope.organizationId, people, filters)
      // Uma linha por ITEM do documento (seção), com os números do documento ao lado.
      const rows = items.flatMap((item) => (item.sections.length > 0 ? item.sections : [null]).map((section) => [
        item.title, section?.section ?? "", section?.assessed ?? 0, section?.met ?? 0, section?.deviations ?? 0, section?.recommended ?? 0,
        (section?.points ?? []).map((point) => `${point.title} (${point.assessed})`).join(" | "),
        item.groundedCalls, item.assessed, item.recommended, item.delivered, item.recommendedPeople, item.reasons.join(" | "),
      ]))
      csv = toCsv(["Documento", "Seção", "Avaliações na seção", "Acertos na seção", "Desvios na seção", "Indicações da seção no feedback", "Pontos do processo na seção (avaliações)", "Chamadas em que o documento fundamentou avaliação", "Avaliações do documento", "Indicações do documento (mensagens)", "Entregues", "Pessoas com indicação", "Motivos"], rows, preamble)
    } else if (view === "indicators") {
      const result = await indicatorInvestigations(db, scope.organizationId, people, filters, all)
      csv = toCsv(["Pessoa", "Indicador", "Período", "Conclusão", "Onde mudou", "Padrões nas chamadas", "Referência comparável", "Limitações"], result.items.map((item) => [item.personName, item.indicatorName, item.periodLabel, item.conclusion, item.focus.map((focus) => `${focus.label} (${focus.reason})`).join(" | "), item.patterns.map((pattern) => `${pattern.segment}: ${pattern.text} (${pattern.notMet + pattern.partial}/${pattern.eligible})`).join(" | "), item.reference ? `${item.reference.basis}: ${item.reference.practices.map((practice) => `${practice.text} (${practice.reference.met}/${practice.reference.eligible})`).join(" | ")}` : "", item.limitations.join(" | ")]), preamble)
    } else if (view === "concentration") {
      const dimension: Dimension = request.query.dimension === "WEEKDAY" || request.query.dimension === "SUBJECT" || request.query.dimension === "HOUR" ? request.query.dimension : "DAY"
      const buckets = await concentration(db, scope.organizationId, people, filters, dimension)
      csv = toCsv([dimension, "Chamadas", "Avaliadas", "Cumpridas", "Não cumpridas", "Parciais", "Taxa de desvio", ...OCCURRENCE_HEAD, "Inconclusivas"], buckets.map((bucket) => [bucket.label, bucket.calls, bucket.assessed, bucket.met, bucket.notMet, bucket.partial, rate(bucket.deviationRate), ...occurrenceCells(bucket), bucket.inconclusive]), preamble)
    } else {
      const order: ProcessOrder = request.query.order === "MET" || request.query.order === "ALL" ? request.query.order : "DEVIATIONS"
      const result = await processAggregates(db, scope.organizationId, people, filters, order)
      // Uma linha por PONTO DO PROCESSO (prática), com o tema: as regras de onde ele vem ficam na coluna de fontes.
      const items = result.themes.flatMap((theme) => theme.items.map((item) => ({ ...item, theme: theme.title ?? "Ainda sem tema" })))
      csv = toCsv(["Tema", "Ponto do processo", "Conduta", "Fontes (documento · seção)", "Regras", "Chamadas", "Avaliadas", "Cumpridas", "Não cumpridas", "Parciais", "Taxa de desvio", "Desvios que são a mesma conduta de outra regra", "Avaliadas sem ligação determinável", "Inconclusivas", "Não aplicáveis", "Pessoas com desvio", "Chave do ponto"], items.map((item) => [item.theme, item.title, item.description ?? "", item.sources.map((source) => `${source.kind === "ARGUMENT_SCRIPT" ? "Argumentário: " : ""}${source.documentTitle}${source.section ? ` · ${source.section}` : ""}`).join(" | "), item.rules, item.calls, item.assessed, item.met, item.notMet, item.partial, rate(item.deviationRate), item.occurrences.sharedDeviationRules, item.occurrences.undeterminedAssessedRules, item.inconclusive, item.notApplicable, item.peopleWithDeviation, item.practiceKey]), preamble)
    }
    response.setHeader("content-type", "text/csv; charset=utf-8")
    response.setHeader("content-disposition", `attachment; filename="diagnostico-${view}-${filters.from}-a-${filters.to}.csv"`)
    response.send(csv)
  })
  return router
}
