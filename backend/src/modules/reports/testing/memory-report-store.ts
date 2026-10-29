import { randomUUID } from "node:crypto"
import type { ResolvedStructure } from "../../leadership-analytics/application/references.js"
import type { QueryTableCard } from "../../leadership-analytics/domain/view-models.js"
import type { SourceState } from "../domain/delivery-decision.js"
import type { AccountInfo, DistributionScope, RecipientCandidate, RecipientContext, ReportRuntime } from "../application/report-runtime.js"
import type { DeliveryRecord, ReportRecord, ReportStore, RunRecord } from "../application/report-store.js"

/** Armazenamento em memória com as MESMAS chaves únicas do banco (report × horário, execução × escopo, execução × pessoa). */
export function createMemoryReportStore() {
  const reports = new Map<string, ReportRecord>()
  const runs = new Map<string, RunRecord>()
  const deliveries: DeliveryRecord[] = []
  const recipients: { deliveryId: string; runId: string; personId: string; accountId: string | null }[] = []
  let tick = 0
  const stamp = () => new Date(Date.UTC(2026, 9, 16, 12, 0, tick++)).toISOString()

  const store: ReportStore = {
    async createReport(input) {
      const report: ReportRecord = { ...input, id: randomUUID(), configVersion: 1, lastRunAt: null, lastRunStatus: null, lastValidDeliveryAt: null, revision: 0, createdAt: stamp(), updatedAt: stamp(), deletedAt: null }
      reports.set(report.id, report)
      return report
    },
    async updateReport(id, organizationId, revision, patch) {
      const report = reports.get(id)
      if (!report || report.organizationId !== organizationId || report.revision !== revision || report.deletedAt) return null
      const { bumpVersion, ...rest } = patch
      const next: ReportRecord = { ...report, ...Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined)), configVersion: report.configVersion + (bumpVersion ? 1 : 0), revision: report.revision + 1, updatedAt: stamp() }
      reports.set(id, next)
      if (next.status === "INACTIVE") for (const run of runs.values()) if (run.reportId === id && run.status === "QUEUED") runs.set(run.id, { ...run, status: "SKIPPED" })
      return next
    },
    async getReport(id, organizationId) {
      const report = reports.get(id)
      return report && report.organizationId === organizationId ? report : null
    },
    async listReports(organizationId, ownerAccountId) {
      return [...reports.values()].filter((report) => report.organizationId === organizationId && report.ownerAccountId === ownerAccountId && !report.deletedAt)
    },
    async softDeleteReport(id, organizationId) {
      const report = reports.get(id)
      if (!report || report.organizationId !== organizationId || report.deletedAt) return false
      reports.set(id, { ...report, deletedAt: stamp(), status: "INACTIVE", nextRunAt: null })
      for (const run of runs.values()) if (run.reportId === id && run.status === "QUEUED") runs.set(run.id, { ...run, status: "SKIPPED" })
      return true
    },
    async enqueueRun(input) {
      if ([...runs.values()].some((run) => run.reportId === input.reportId && run.scheduledFor === input.scheduledFor)) return null
      const run: RunRecord = { id: randomUUID(), organizationId: input.organizationId, reportId: input.reportId, scheduledFor: input.scheduledFor, triggerKind: input.triggerKind, configVersion: input.configVersion, status: "QUEUED", attempts: 0, outcome: null, errorCode: null, errorMessage: null, startedAt: null, finishedAt: null }
      runs.set(run.id, run)
      return run
    },
    async finishRun(runId, status, outcome, error) {
      const run = runs.get(runId)!
      runs.set(runId, { ...run, status, outcome, errorCode: error?.code ?? null, errorMessage: error?.message ?? null, finishedAt: stamp() })
    },
    async requeueRun(runId, _next, error) {
      const run = runs.get(runId)!
      runs.set(runId, { ...run, status: "QUEUED", errorCode: error.code, errorMessage: error.message })
    },
    async markReportRun(reportId, status, at, validDeliveryAt) {
      const report = reports.get(reportId)!
      reports.set(reportId, { ...report, lastRunAt: at, lastRunStatus: status, lastValidDeliveryAt: validDeliveryAt ?? report.lastValidDeliveryAt })
    },
    async listRuns(reportId) {
      return [...runs.values()].filter((run) => run.reportId === reportId)
    },
    async lastValidDelivery(reportId, scopeKey) {
      return [...deliveries].reverse().find((delivery) => delivery.reportId === reportId && delivery.scopeKey === scopeKey && delivery.kind === "DELIVERY") ?? null
    },
    async latestRecord(reportId, scopeKey) {
      return [...deliveries].reverse().find((delivery) => delivery.reportId === reportId && delivery.scopeKey === scopeKey) ?? null
    },
    async insertDelivery(input) {
      const existing = deliveries.find((delivery) => delivery.runId === input.runId && delivery.scopeKey === input.scopeKey)
      if (existing) return { delivery: existing, created: false }
      const delivery: DeliveryRecord = { ...input, id: randomUUID(), analysisText: null, analysisAttempts: 0, analysisError: null, occurrences: 1, lastCheckedAt: stamp(), createdAt: stamp() }
      deliveries.push(delivery)
      return { delivery, created: true }
    },
    async bumpNotice(deliveryId, at) {
      const index = deliveries.findIndex((delivery) => delivery.id === deliveryId)
      deliveries[index] = { ...deliveries[index]!, occurrences: deliveries[index]!.occurrences + 1, lastCheckedAt: at }
    },
    async addRecipients(deliveryId, runId, _organizationId, _reportId, list) {
      let added = 0
      for (const recipient of list) {
        if (recipients.some((row) => (row.deliveryId === deliveryId || row.runId === runId) && row.personId === recipient.personId)) continue
        recipients.push({ deliveryId, runId, personId: recipient.personId, accountId: recipient.accountId })
        added += 1
      }
      return added
    },
    async setAnalysis(deliveryId, status, text, error) {
      const index = deliveries.findIndex((delivery) => delivery.id === deliveryId)
      const current = deliveries[index]!
      deliveries[index] = { ...current, analysisStatus: status, analysisText: text ?? current.analysisText, analysisError: error, analysisAttempts: current.analysisAttempts + (status === "READY" || status === "FAILED" ? 1 : 0) }
    },
    async getDelivery(id, organizationId) {
      return deliveries.find((delivery) => delivery.id === id && delivery.organizationId === organizationId) ?? null
    },
    async isRecipient(deliveryId, personId) {
      return recipients.some((row) => row.deliveryId === deliveryId && row.personId === personId)
    },
  }
  return { store, reports, runs, deliveries, recipients }
}

/** Estrutura de teste: sujeito + membros (o suficiente para a chave de escopo e o rótulo). */
export function testStructure(id: string, label: string, memberIds: string[]): ResolvedStructure {
  return {
    subject: { kind: "SUPERVISOR_TEAM", supervisorId: id },
    resolved: { descriptor: {} as never, members: memberIds.map((member) => ({ id: member }) as never), anchor: null },
    ref: { subject: { kind: "SUPERVISOR_TEAM", supervisorId: id }, label, description: "Equipe" },
  } as unknown as ResolvedStructure
}

export type FakePerson = AccountInfo & {
  active: boolean
  /** A estrutura que a pessoa lidera hoje (null = não lidera). */
  own: ResolvedStructure | null
  /** Estruturas fixas que o escopo dela alcança, por id do sujeito. */
  reachable: Record<string, ResolvedStructure>
  /** Pessoas além dos operadores que o escopo dela alcança abaixo da âncora (líderes) — padrão: nenhuma. */
  visibleBelow?: string[]
  distribution?: DistributionScope | null
  level?: string
}

/** Adaptador falso: pessoas, escopos, cartões por estrutura e estado das bases — tudo mutável entre execuções. */
export function createFakeRuntime(options: { people: FakePerson[]; card: (structureLabel: string, args: Record<string, unknown>) => QueryTableCard | null; sources?: () => SourceState[]; coverage?: () => number | null }) {
  const calls: { account: string; name: string; args: Record<string, unknown> }[] = []
  const state = { people: options.people, sources: options.sources ?? (() => [{ source: "OFFICIAL_INDICATOR_PERFORMANCE" as const, label: "Fechamento oficial", watermark: "official:1", lastUpdatedAt: "2026-10-01T00:00:00.000Z", stale: false, detail: null }]), coverage: options.coverage ?? (() => 1) }
  const find = (accountId: string) => state.people.find((person) => person.accountId === accountId) ?? null
  const runtime: ReportRuntime = {
    async account(_organizationId, accountId) {
      const person = find(accountId)
      return person && person.active ? { accountId: person.accountId, personId: person.personId, name: person.name, role: person.role } : null
    },
    async contextFor(_organizationId, accountId) {
      const person = find(accountId)
      if (!person || !person.active || (!person.own && Object.keys(person.reachable).length === 0)) return null
      const context: RecipientContext = {
        account: person,
        ownStructure: person.own,
        resolveFixed: (_kind, id) => person.reachable[id] ?? null,
        visibleBelow: (structure) => [...structure.resolved.members.map((member) => member.id), ...(person.visibleBelow ?? [])],
        runTool: async (name, args) => {
          calls.push({ account: accountId, name, args })
          const fixedId = typeof args.subject_id === "string" ? args.subject_id : null
          const structure = fixedId ? person.reachable[fixedId] : person.own
          const card = structure ? options.card(structure.ref.label, args) : null
          return card ? { text: "", card } : { text: "Ambiguidade", card: null, issue: { kind: "NOT_FOUND", message: "Indicador não encontrado.", candidates: [] } }
        },
        coverage: async () => state.coverage(),
        sources: async () => state.sources(),
        indicatorDirection: async () => "LOWER",
        lastClosedPeriod: "2026-09",
        structureOptions: () => Object.entries(person.reachable).map(([id, structure]) => ({ subjectKind: "SUPERVISOR_TEAM", subjectId: id, label: structure.ref.label, description: "Equipe" })),
        indicatorOptions: async () => [{ code: "TMA", name: "Tempo Médio de Atendimento", unit: "SECONDS", direction: "LOWER", active: true }],
      }
      return context
    },
    async distributionScope(_organizationId, accountId) {
      return find(accountId)?.distribution ?? null
    },
    async resolveRecipients(_organizationId, audience): Promise<RecipientCandidate[]> {
      return state.people
        .filter((person) => person.active && (audience.everyone || audience.levels.includes(person.level as never) || audience.personIds.includes(person.personId)))
        .map((person) => ({ personId: person.personId, accountId: person.accountId, name: person.name }))
    },
    async timeZone() {
      return "America/Sao_Paulo"
    },
    async indicatorCatalog() {
      return [{ code: "TMA", name: "Tempo Médio de Atendimento", active: true }]
    },
    async audienceOptions(_organizationId, scope) {
      return { jobTitles: ["Supervisor de Atendimento"], teams: scope.teamIds.map((id) => ({ id, name: "Grupo" })), subteams: scope.subteamIds.map((id) => ({ id, name: "Subgrupo", teamId: scope.teamIds[0] ?? id })) }
    },
    async searchPeople(_organizationId, _scope, query, ids) {
      return state.people.filter((person) => (ids && ids.length > 0 ? ids.includes(person.personId) : person.name.toLowerCase().includes(query.toLowerCase()))).map((person) => ({ personId: person.personId, name: person.name, role: person.role, jobTitle: null }))
    },
  }
  return { runtime, calls, state }
}
