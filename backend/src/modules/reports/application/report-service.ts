import { DomainError } from "../../../shared/domain/domain-error.js"
import { describePeriod, reportAnalysisSchema, reportAudienceSchema, reportDefinitionSchema, reportScheduleSchema, reportVisualizationSchema, toToolCall, type ReportDefinition, type ReportVisualization } from "../domain/report-definition.js"
import { describeSchedule, nextRunAfter, upcomingRuns } from "../domain/report-schedule.js"
import { buildVisualizationData, compatibleVisualizations, describeType, staticCompatibility, suggestVisualization } from "../domain/visualization.js"
import type { AnalysisWriter } from "./report-analysis.js"
import { analyzeDelivery } from "./report-analysis.js"
import type { ProposalStore } from "./report-proposals.js"
import type { DistributionScope, RecipientContext, ReportRuntime } from "./report-runtime.js"
import type { DeliveryRecord, ReportConfig, ReportRecord, ReportStore } from "./report-store.js"

/**
 * Regras de uso dos reports (tela e chat) — todas no backend:
 *  - LÍDER (lidera alguém ou tem `indicators.view`): cria só para si, gerencia só os próprios, só estruturas do próprio escopo;
 *  - PAPEL REPORT (`reports.distribute`): distribui para públicos DENTRO do escopo da atribuição; nunca ganha acesso a dado;
 *  - dono = quem criou; outro dono = 404 (mesma resposta de inexistente);
 *  - entrega: só quem recebeu abre (inclusive o dono de um report distribuído só vê o que ele mesmo recebeu).
 */
export type ReportActor = { organizationId: string; accountId: string; personId: string }
export type ReportServiceDeps = { store: ReportStore; runtime: ReportRuntime; proposals: ProposalStore; analysisWriter: AnalysisWriter; now: () => Date }

export type ReportAccess = { canUse: boolean; canCreateForSelf: boolean; canDistribute: boolean; distribution: DistributionScope | null; context: RecipientContext | null; timeZone: string }

export async function loadReportAccess(deps: ReportServiceDeps, actor: ReportActor): Promise<ReportAccess> {
  const [context, distribution, timeZone] = await Promise.all([deps.runtime.contextFor(actor.organizationId, actor.accountId), deps.runtime.distributionScope(actor.organizationId, actor.accountId), deps.runtime.timeZone(actor.organizationId)])
  return { canUse: context !== null || distribution !== null, canCreateForSelf: context !== null, canDistribute: distribution !== null, distribution, context, timeZone }
}

async function requireAccess(deps: ReportServiceDeps, actor: ReportActor): Promise<ReportAccess> {
  const access = await loadReportAccess(deps, actor)
  if (!access.canUse) throw new DomainError("Reports são para quem lidera uma estrutura ou tem o papel Report.", "REPORTS_ACCESS_REQUIRED", 403)
  return access
}

async function requireOwned(deps: ReportServiceDeps, actor: ReportActor, id: string): Promise<ReportRecord> {
  const report = await deps.store.getReport(id, actor.organizationId)
  if (!report || report.deletedAt || report.ownerAccountId !== actor.accountId) throw new DomainError("Report não encontrado.", "REPORT_NOT_FOUND", 404)
  return report
}

const unprocessable = (message: string, code: string) => new DomainError(message, code, 422)

/** Valida e normaliza uma configuração (formulário guiado → contrato). */
export async function validateConfig(deps: ReportServiceDeps, actor: ReportActor, access: ReportAccess, input: unknown): Promise<ReportConfig> {
  const body = (input ?? {}) as Record<string, unknown>
  const parse = <T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false; error: { issues: { message: string; path: PropertyKey[] }[] } } }, value: unknown, what: string): T => {
    const parsed = schema.safeParse(value)
    if (!parsed.success) throw unprocessable(`${what}: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`, "REPORT_CONFIG_INVALID")
    return parsed.data
  }
  const name = typeof body.name === "string" ? body.name.trim() : ""
  if (!name || name.length > 120) throw unprocessable("Dê um nome ao report (até 120 caracteres).", "REPORT_CONFIG_INVALID")
  const description = typeof body.description === "string" && body.description.trim() ? body.description.trim().slice(0, 1_000) : null
  const definition = parse(reportDefinitionSchema, body.definition, "Consulta")
  const visualization = parse(reportVisualizationSchema, body.visualization, "Visualização")
  const schedule = parse(reportScheduleSchema, body.schedule, "Periodicidade")
  const audience = parse(reportAudienceSchema, body.audience ?? { mode: "SELF" }, "Destinatários")
  const analysis = parse(reportAnalysisSchema, body.analysis ?? {}, "Análise")

  if (audience.mode === "SELF" && !access.canCreateForSelf) throw new DomainError("Para criar um report para você é preciso liderar uma estrutura (ou ter acesso de consulta).", "REPORT_SELF_NOT_ALLOWED", 403)
  if (audience.mode === "DISTRIBUTION") {
    if (!access.distribution) throw new DomainError("Só o papel Report escolhe outros destinatários.", "REPORT_DISTRIBUTION_NOT_ALLOWED", 403)
    const scope = access.distribution
    if (!scope.organizationWide) {
      const options = await deps.runtime.audienceOptions(actor.organizationId, scope)
      const teams = new Set(options.teams.map((team) => team.id))
      const subteams = new Set(options.subteams.map((subteam) => subteam.id))
      if (audience.everyone && scope.teamIds.length === 0 && scope.subteamIds.length === 0) throw new DomainError("Público fora do seu escopo de distribuição.", "AUDIENCE_OUT_OF_SCOPE", 403)
      if (audience.teamIds.some((id) => !teams.has(id) || !scope.teamIds.includes(id)) || audience.subteamIds.some((id) => !subteams.has(id))) throw new DomainError("Há Grupos ou Subgrupos fora do seu escopo de distribuição.", "AUDIENCE_OUT_OF_SCOPE", 403)
    }
    if (audience.personIds.length > 0) {
      const found = await deps.runtime.searchPeople(actor.organizationId, scope, "", audience.personIds)
      if (found.length !== new Set(audience.personIds).size) throw new DomainError("Há pessoas fora do seu escopo de distribuição (ou sem conta ativa).", "AUDIENCE_OUT_OF_SCOPE", 403)
    }
  }
  if (definition.structure.mode === "FIXED") {
    if (!access.context?.resolveFixed(definition.structure.subjectKind, definition.structure.subjectId)) throw new DomainError("A estrutura escolhida não está no seu escopo.", "STRUCTURE_OUT_OF_SCOPE", 403)
  }
  const catalog = await deps.runtime.indicatorCatalog(actor.organizationId)
  const known = new Set(catalog.map((item) => item.code.toUpperCase()))
  const unknown = definition.indicators.filter((code) => code.toUpperCase() !== "PRV" && !known.has(code.toUpperCase()))
  if (unknown.length > 0) throw unprocessable(`Indicador inexistente: ${unknown.join(", ")}.`, "REPORT_INDICATOR_NOT_FOUND")
  if (!staticCompatibility(definition).includes(visualization.type)) throw unprocessable(`A visualização "${describeType(visualization.type)}" não é compatível com esta consulta (ex.: evolução exige várias competências mês a mês).`, "VISUALIZATION_INCOMPATIBLE")
  return { name, description, definition, visualization, schedule, audience, analysis }
}

const sameConfig = (a: ReportConfig, b: ReportConfig) => JSON.stringify([a.definition, a.visualization, a.schedule, a.audience, a.analysis]) === JSON.stringify([b.definition, b.visualization, b.schedule, b.audience, b.analysis])

export function summarizeReport(report: ReportRecord, now: Date) {
  return {
    id: report.id,
    name: report.name,
    description: report.description,
    status: report.status,
    origin: report.origin,
    audienceMode: report.audience.mode,
    tool: report.definition.tool,
    structure: report.definition.structure.mode === "FIXED" ? report.definition.structure.label : "Estrutura de quem recebe",
    period: describePeriod(report.definition.period),
    schedule: describeSchedule(report.schedule, report.timeZone),
    timeZone: report.timeZone,
    visualization: report.visualization.type,
    nextRunAt: report.nextRunAt,
    upcomingRuns: report.status === "ACTIVE" ? upcomingRuns(report.schedule, report.timeZone, now, 3).map((date) => date.toISOString()) : [],
    lastRunAt: report.lastRunAt,
    lastRunStatus: report.lastRunStatus,
    lastValidDeliveryAt: report.lastValidDeliveryAt,
    configVersion: report.configVersion,
    revision: report.revision,
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
  }
}

export async function listReports(deps: ReportServiceDeps, actor: ReportActor) {
  const access = await requireAccess(deps, actor)
  const reports = await deps.store.listReports(actor.organizationId, actor.accountId)
  return { capabilities: { canCreateForSelf: access.canCreateForSelf, canDistribute: access.canDistribute, timeZone: access.timeZone }, items: reports.map((report) => summarizeReport(report, deps.now())) }
}

export async function getReportDetail(deps: ReportServiceDeps, actor: ReportActor, id: string) {
  const report = await requireOwned(deps, actor, id)
  const runs = await deps.store.listRuns(report.id, 30)
  return { report: { ...summarizeReport(report, deps.now()), config: { name: report.name, description: report.description, definition: report.definition, visualization: report.visualization, schedule: report.schedule, audience: report.audience, analysis: report.analysis } }, runs }
}

export async function createReport(deps: ReportServiceDeps, actor: ReportActor, input: { config: unknown; activate: boolean; proposalId?: string | null | undefined }) {
  const access = await requireAccess(deps, actor)
  const config = await validateConfig(deps, actor, access, input.config)
  const proposal = input.proposalId ? await deps.proposals.get(actor.organizationId, actor.accountId, input.proposalId) : null
  const report = await deps.store.createReport(
    { ...config, organizationId: actor.organizationId, ownerAccountId: actor.accountId, ownerPersonId: actor.personId, status: input.activate ? "ACTIVE" : "INACTIVE", origin: proposal ? "CHAT" : "SCREEN", timeZone: access.timeZone, nextRunAt: input.activate ? (nextRunAfter(config.schedule, access.timeZone, deps.now())?.toISOString() ?? null) : null, sourceProposalId: proposal?.id ?? null },
    actor.accountId,
  )
  if (proposal) await deps.proposals.decide(proposal.id, "ACCEPTED", report.id)
  return summarizeReport(report, deps.now())
}

export async function updateReport(deps: ReportServiceDeps, actor: ReportActor, id: string, input: { revision: number; config: unknown }) {
  const access = await requireAccess(deps, actor)
  const report = await requireOwned(deps, actor, id)
  const config = await validateConfig(deps, actor, access, input.config)
  const changed = !sameConfig(config, report)
  // Editar a agenda recalcula o próximo horário (só quando ativo).
  const nextRunAt = report.status === "ACTIVE" ? (nextRunAfter(config.schedule, report.timeZone, deps.now())?.toISOString() ?? null) : null
  const updated = await deps.store.updateReport(report.id, actor.organizationId, input.revision, { ...config, nextRunAt, bumpVersion: changed }, actor.accountId)
  if (!updated) throw new DomainError("O report foi alterado em outra tela. Recarregue e tente de novo.", "REPORT_REVISION_CONFLICT", 409)
  return summarizeReport(updated, deps.now())
}

export async function setReportStatus(deps: ReportServiceDeps, actor: ReportActor, id: string, input: { revision: number; status: "ACTIVE" | "INACTIVE" }) {
  const access = await requireAccess(deps, actor)
  const report = await requireOwned(deps, actor, id)
  if (input.status === "ACTIVE") await validateConfig(deps, actor, access, { name: report.name, description: report.description, definition: report.definition, visualization: report.visualization, schedule: report.schedule, audience: report.audience, analysis: report.analysis })
  const nextRunAt = input.status === "ACTIVE" ? (nextRunAfter(report.schedule, report.timeZone, deps.now())?.toISOString() ?? null) : null
  const updated = await deps.store.updateReport(report.id, actor.organizationId, input.revision, { status: input.status, nextRunAt, bumpVersion: false }, actor.accountId)
  if (!updated) throw new DomainError("O report foi alterado em outra tela. Recarregue e tente de novo.", "REPORT_REVISION_CONFLICT", 409)
  return summarizeReport(updated, deps.now())
}

export async function deleteReport(deps: ReportServiceDeps, actor: ReportActor, id: string) {
  await requireOwned(deps, actor, id)
  await deps.store.softDeleteReport(id, actor.organizationId, actor.accountId)
}

/** "Executar agora": uma execução MANUAL (mesmas regras da agendada; o worker processa). */
export async function runReportNow(deps: ReportServiceDeps, actor: ReportActor, id: string) {
  const report = await requireOwned(deps, actor, id)
  const run = await deps.store.enqueueRun({ organizationId: actor.organizationId, reportId: report.id, scheduledFor: deps.now().toISOString(), triggerKind: "MANUAL", configVersion: report.configVersion })
  return { runId: run?.id ?? null }
}

/** PRÉVIA: a consulta na visão de quem configura — nada é gravado, nenhuma entrega recorrente é criada. */
export async function previewReport(deps: ReportServiceDeps, actor: ReportActor, input: { definition: unknown; visualization?: unknown }) {
  const access = await requireAccess(deps, actor)
  const parsed = reportDefinitionSchema.safeParse(input.definition)
  if (!parsed.success) throw unprocessable(`Consulta: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`, "REPORT_CONFIG_INVALID")
  const definition: ReportDefinition = parsed.data
  if (!access.context) throw unprocessable("A prévia mostra os dados na SUA visão, e você não lidera uma estrutura. Cada destinatário receberá a própria estrutura.", "REPORT_PREVIEW_UNAVAILABLE")
  const structure = definition.structure.mode === "RECIPIENT" ? access.context.ownStructure : access.context.resolveFixed(definition.structure.subjectKind, definition.structure.subjectId)
  if (!structure) throw new DomainError("A estrutura escolhida não está no seu escopo.", "STRUCTURE_OUT_OF_SCOPE", 403)
  const call = toToolCall(definition)
  const result = await access.context.runTool(call.name, call.args)
  const card = result.card && result.card.type === "QUERY_TABLE" ? result.card : null
  if (!card) throw unprocessable(result.issue?.message ?? "A consulta não devolveu uma tabela.", "REPORT_PREVIEW_FAILED")
  const requested = reportVisualizationSchema.safeParse(input.visualization)
  const visualization: ReportVisualization = requested.success ? requested.data : suggestVisualization(card)
  const [sources, coverage] = await Promise.all([access.context.sources(structure, definition), access.context.coverage(structure, definition, card.period)])
  return {
    preview: true,
    structure: structure.ref.label,
    period: describePeriod(definition.period),
    card,
    compatible: compatibleVisualizations(card).filter((type) => staticCompatibility(definition).includes(type)),
    suggested: suggestVisualization(card),
    visualization: buildVisualizationData(card, visualization),
    sources,
    coverage,
  }
}

export async function reportOptions(deps: ReportServiceDeps, actor: ReportActor) {
  const access = await requireAccess(deps, actor)
  const catalog = await deps.runtime.indicatorCatalog(actor.organizationId)
  return {
    capabilities: { canCreateForSelf: access.canCreateForSelf, canDistribute: access.canDistribute },
    timeZone: access.timeZone,
    ownStructure: access.context?.ownStructure ? access.context.ownStructure.ref.label : null,
    structures: access.context?.structureOptions() ?? [],
    indicators: [{ code: "PRV", name: "PRV (resultado geral)", active: true }, ...catalog.filter((item) => item.active)],
    audience: access.distribution ? { scope: access.distribution, ...(await deps.runtime.audienceOptions(actor.organizationId, access.distribution)) } : null,
  }
}

export async function searchAudiencePeople(deps: ReportServiceDeps, actor: ReportActor, query: string) {
  const access = await requireAccess(deps, actor)
  if (!access.distribution) throw new DomainError("Só o papel Report escolhe outros destinatários.", "REPORT_DISTRIBUTION_NOT_ALLOWED", 403)
  return deps.runtime.searchPeople(actor.organizationId, access.distribution, query.slice(0, 80))
}

/** Rascunho de uma proposta do chat (só do dono). Abrir = aceitar a oferta; ativar exige salvar. */
export async function openProposal(deps: ReportServiceDeps, actor: ReportActor, proposalId: string) {
  await requireAccess(deps, actor)
  const proposal = await deps.proposals.get(actor.organizationId, actor.accountId, proposalId)
  if (!proposal) throw new DomainError("Proposta não encontrada.", "REPORT_PROPOSAL_NOT_FOUND", 404)
  if (proposal.status === "OFFERED") await deps.proposals.decide(proposal.id, "ACCEPTED")
  return { id: proposal.id, status: proposal.status === "OFFERED" ? "ACCEPTED" : proposal.status, reportId: proposal.reportId, draft: proposal.draft }
}

export async function requireDeliveryForRecipient(deps: ReportServiceDeps, actor: ReportActor, deliveryId: string): Promise<DeliveryRecord> {
  const delivery = await deps.store.getDelivery(deliveryId, actor.organizationId)
  if (!delivery || !(await deps.store.isRecipient(delivery.id, actor.personId))) throw new DomainError("Entrega não encontrada.", "REPORT_DELIVERY_NOT_FOUND", 404)
  return delivery
}

export async function retryDeliveryAnalysis(deps: ReportServiceDeps, actor: ReportActor, deliveryId: string) {
  const delivery = await requireDeliveryForRecipient(deps, actor, deliveryId)
  if (delivery.kind !== "DELIVERY" || delivery.analysisStatus !== "FAILED") return { analysisStatus: delivery.analysisStatus }
  const report = await deps.store.getReport(delivery.reportId, actor.organizationId)
  if (report) await analyzeDelivery(deps.store, deps.analysisWriter, delivery, report)
  const updated = await deps.store.getDelivery(delivery.id, actor.organizationId)
  return { analysisStatus: updated?.analysisStatus ?? delivery.analysisStatus }
}
