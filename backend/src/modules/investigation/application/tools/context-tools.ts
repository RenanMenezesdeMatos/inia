import { DomainError } from "../../../../shared/domain/domain-error.js"
import { resolveWorkdaysBySubject } from "../../../indicators/application/operational-measurement-resolver.js"
import { EMPLOYMENT_STATUS_LABELS, type EmploymentStatus } from "../../../people/domain/employment-status.js"
import { RESOLVED_WORKDAY_STATE_LABELS, type ResolvedWorkdayState } from "../../../people/domain/workday-resolution.js"
import { SCHEDULE_EXCEPTION_LABELS, type ScheduleExceptionCode } from "../../../people/domain/schedule-exception.js"
import { retrieveKnowledgeForAgent } from "../../../knowledge/application/retrieve-knowledge.js"
import { selectSupportMaterialRecommendations, type SupportMaterialCandidate } from "../../../feedbacks/domain/support-material.js"
import { noData, sufficient, type ToolResult } from "../../domain/tool-output.js"
import { describeWindow, resolvePeriod, type ToolContext } from "../tool-context.js"

/**
 * JORNADA OPERACIONAL — reutiliza o Calendário Operacional V1 (resolvedor único PLANEJADO ×
 * OBSERVADO). A precedência congelada permanece: situação funcional soberana → produção observada
 * → classificação humana → exceção/plano → escala → fallback. Nada aqui reinterpreta INSS/férias
 * nem classifica ausência — só relata.
 */
export async function inspectWorkContext(context: ToolContext, args: { period?: { from: string; to: string } }): Promise<ToolResult> {
  const period = resolvePeriod(context, args.period)
  const resolved = await resolveWorkdaysBySubject(context.db, [context.subject.operatorId], period, context.timeZone, { now: context.now, cache: context.workdayCache })
  const subject = resolved.get(context.subject.operatorId)
  if (!subject) return { data: null, quality: noData("colaborador sem resolução de jornada na janela"), provenance: { period: describeWindow(period), population: "colaborador", filters: [], dataSource: "WORK_CALENDAR" } }

  const byState = new Map<ResolvedWorkdayState, number>()
  const byStatus = new Map<EmploymentStatus, number>()
  const exceptions = new Map<string, number>()
  const classifications = new Map<string, number>()
  let eligibleDays = 0
  let observedDays = 0
  let conflicts = 0
  let workedDespitePlan = 0
  const availability = { waitingForSources: 0, dataSourceDelay: 0, availabilityUnknown: 0 }
  for (const day of subject.days) {
    byState.set(day.state, (byState.get(day.state) ?? 0) + 1)
    if (day.eligible) eligibleDays += 1
    if (day.observed) observedDays += 1
    if (day.conflict) conflicts += 1
    if (day.overridesPlan) workedDespitePlan += 1
    if (day.status) byStatus.set(day.status, (byStatus.get(day.status) ?? 0) + 1)
    if (day.planned.exception) exceptions.set(day.planned.exception.code, (exceptions.get(day.planned.exception.code) ?? 0) + 1)
    if (day.classification) classifications.set(day.classification.classification, (classifications.get(day.classification.classification) ?? 0) + 1)
    if (day.availability === "WAITING_FOR_SOURCES") availability.waitingForSources += 1
    if (day.availability === "DATA_SOURCE_DELAY") availability.dataSourceDelay += 1
    if (day.availability === "AVAILABILITY_UNKNOWN") availability.availabilityUnknown += 1
  }
  const stale = subject.statusConfidence.freshness === "STALE"
  return {
    data: {
      calendarDays: subject.calendarDays,
      scheduledWorkDays: subject.scheduledWorkDays,
      eligibleDays,
      observedWorkedDays: observedDays,
      workedDespitePlanDays: workedDespitePlan,
      days: [...byState.entries()].map(([state, count]) => ({ state, label: RESOLVED_WORKDAY_STATE_LABELS[state], days: count })),
      functionalStatuses: [...byStatus.entries()].map(([status, count]) => ({ status, label: EMPLOYMENT_STATUS_LABELS[status] ?? status, days: count })),
      scheduleExceptions: [...exceptions.entries()].map(([code, count]) => ({ code, label: SCHEDULE_EXCEPTION_LABELS[code as ScheduleExceptionCode] ?? code, days: count })),
      classifications: [...classifications.entries()].map(([kind, count]) => ({ classification: kind, days: count })),
      reconciliation: { missingExpectedProductionDays: byState.get("MISSING_EXPECTED_PRODUCTION") ?? 0, conflicts },
      sourceAvailability: availability,
      schedule: { basis: subject.scheduleConfidence.basis, scheduleType: subject.scheduleConfidence.scheduleType, freshness: subject.scheduleConfidence.freshness },
      statusFreshness: { freshness: subject.statusConfidence.freshness, unconfirmedDays: subject.statusConfidence.unconfirmedDays },
      holidays: { policy: subject.holidayConfidence.policy, applicableHolidayDays: subject.holidayConfidence.applicableHolidayDays },
      note: "dias não elegíveis (férias, INSS, folga, exceção) ficam FORA dos cálculos operacionais — não são performance zero; a precedência é a do Calendário Operacional, nunca reinterpretada",
    },
    quality: { status: stale ? "STALE" : availability.dataSourceDelay > 0 ? "SOURCE_DELAY" : "SUFFICIENT", sampleCount: subject.calendarDays, coverage: subject.calendarDays > 0 ? Math.round((eligibleDays / subject.calendarDays) * 100) / 100 : null, freshness: stale ? "STALE" : subject.statusConfidence.freshness === "FRESH" ? "FRESH" : "UNKNOWN", ...(stale ? { note: "situação funcional não confirmada (fonte de RH desatualizada)" } : {}) },
    provenance: { period: describeWindow(period), population: "colaborador", filters: [], dataSource: "WORK_CALENDAR (situação funcional, escala, exceções, evidência, disponibilidade, classificações)", method: "Calendário Operacional V1 — planejado × observado, precedência congelada" },
  }
}

/** Retrieval nas bases AUTORIZADAS para o Agent (o mesmo retrieval do prompt) — acumula candidatos reais. */
export async function queryKnowledge(context: ToolContext, args: { query: string }): Promise<ToolResult> {
  if (!context.agentId) throw new DomainError("Consulta à base indisponível: esta análise não tem um Agent com bases autorizadas.", "TOOL_KNOWLEDGE_UNAVAILABLE", 422)
  const result = await retrieveKnowledgeForAgent(context.db, context.agentId, args.query)
  const trace = result.trace
  for (const excerpt of trace.retrieved) {
    context.knowledgeCandidates.set(excerpt.documentId, { materialId: excerpt.documentId, title: excerpt.documentTitle })
    // V1.4.5: o TEXTO recuperado fica disponível para a avaliação procedimental (regra da base com trecho literal).
    context.knowledgeExcerpts?.set(`${excerpt.documentId}#${excerpt.heading}`, { documentId: excerpt.documentId, documentTitle: excerpt.documentTitle, heading: excerpt.heading, excerpt: excerpt.excerpt })
  }
  const documents = new Map<string, { documentId: string; documentTitle: string; excerpts: { heading: string; excerpt: string; score: number }[] }>()
  for (const excerpt of trace.retrieved) {
    const entry = documents.get(excerpt.documentId) ?? { documentId: excerpt.documentId, documentTitle: excerpt.documentTitle, excerpts: [] }
    entry.excerpts.push({ heading: excerpt.heading, excerpt: excerpt.excerpt, score: Math.round(excerpt.score * 100) / 100 })
    documents.set(excerpt.documentId, entry)
  }
  const status = trace.mode === "NONE" ? "nenhuma base autorizada para este Agent" : trace.mode === "NO_MATCH" ? "bases autorizadas sem trecho pertinente à consulta" : null
  return {
    data: { mode: trace.mode, authorizedDocuments: trace.authorizedDocuments.map((document) => ({ documentId: document.id, title: document.title })), knowledgeEvidence: [...documents.values()], note: "cite documentos só pelo título exato; documentId serve para recommend_support_materials" },
    quality: status ? noData(status) : sufficient(trace.retrieved.length, null),
    provenance: { population: `${trace.authorizedDocuments.length} base(s) autorizada(s)`, filters: [`consulta: ${args.query.slice(0, 120)}`], dataSource: "KNOWLEDGE_BASE (versões publicadas)", method: `retrieval lexical (BM25) por seção; modo ${trace.mode}` },
  }
}

/** Reutiliza a seleção validada de Materiais de Apoio V1 — só ids entre os candidatos desta investigação. */
export function recommendSupportMaterials(context: ToolContext, args: { selections: { materialId: string; reason: string }[] }): ToolResult {
  const candidates: SupportMaterialCandidate[] = [...context.knowledgeCandidates.values()]
  if (candidates.length === 0) return { data: { accepted: [], rejected: [] }, quality: noData("nenhum candidato real — consulte a Base de Conhecimento antes (query_knowledge)"), provenance: { population: "candidatos desta investigação", filters: [], dataSource: "KNOWLEDGE_BASE" } }
  const selection = selectSupportMaterialRecommendations(args.selections, candidates)
  return {
    data: { accepted: selection.accepted.map((item) => ({ materialId: item.materialId, title: item.title, reason: item.reason })), rejected: selection.rejected, candidates: candidates.map((candidate) => ({ materialId: candidate.materialId, title: candidate.title })) },
    quality: selection.accepted.length > 0 ? sufficient(selection.accepted.length, null) : noData("nenhuma seleção válida (id fora dos candidatos, motivo genérico/curto ou duplicado)"),
    provenance: { population: `${candidates.length} candidato(s) consultado(s)`, filters: [], dataSource: "KNOWLEDGE_BASE (candidatos desta investigação)", method: "validação por código: id candidato, motivo específico 20–280, sem duplicata, máx. 3" },
  }
}

/** Organiza o que já foi coletado — nunca calcula nada novo. */
export function synthesizeEvidence(context: ToolContext, args: { supportedHypotheses?: string[]; unsupportedHypotheses?: string[]; limitations?: string[] }): ToolResult {
  const facts = context.collectedFacts.map((fact, index) => ({ ref: `F${index + 1}`, tool: fact.tool, label: fact.label, fact: fact.summary, provenance: fact.provenance ? { period: fact.provenance.period?.label ?? null, population: fact.provenance.population, dataSource: fact.provenance.dataSource } : null }))
  return {
    data: {
      facts,
      supportedHypotheses: args.supportedHypotheses ?? [],
      unsupportedHypotheses: args.unsupportedHypotheses ?? [],
      limitations: args.limitations ?? [],
      evidenceReferences: facts.map((fact) => fact.ref),
      note: "use somente os fatos acima na resposta final; hipótese sem fato de apoio é interpretação, não conclusão",
    },
    quality: facts.length > 0 ? sufficient(facts.length, null) : noData("nenhum fato coletado ainda"),
    provenance: { population: "resultados das Tools desta investigação", filters: [], dataSource: "TOOL_RESULTS (organização, sem cálculo novo)" },
  }
}
