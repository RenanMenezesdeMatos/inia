import { createHash } from "node:crypto"
import type { ResolvedStructure } from "../../leadership-analytics/application/references.js"
import type { QueryTableCard } from "../../leadership-analytics/domain/view-models.js"
import { longPeriodLabel, previousReferencePeriod } from "../../performance-analytics/domain/reference-period.js"
import { localDateParts } from "../../workflows/application/schedule-recurrence.js"
import { compareCards, compareFirstAndLastMonth, notComparable, type ReportComparison } from "../domain/comparison.js"
import { cardFingerprint, decideDelivery, type DeliveryBaseline } from "../domain/delivery-decision.js"
import { describePeriod, toToolCall, type ReportDefinition } from "../domain/report-definition.js"
import { buildVisualizationData } from "../domain/visualization.js"
import type { RecipientContext, ReportRuntime } from "./report-runtime.js"
import type { DeliveryRecord, Recipient, ReportRecord, ReportStore, RunRecord, RunStatus } from "./report-store.js"

/**
 * EXECUÇÃO de um report (uma `report_run`): (1) configuração vigente e status; (2) permissões do responsável; (3) destinatários
 * ATUAIS e o escopo de cada um; (4) atualização das bases; (5) a ferramenta da liderança; (6) visualização e comparação;
 * (7) entrega ou aviso, uma vez por execução × escopo e por execução × pessoa; (8) estado da execução. A análise da IA roda depois
 * (`analyze`), sem bloquear nem duplicar a entrega.
 */
export type ExecutorDeps = {
  store: ReportStore
  runtime: ReportRuntime
  now: () => Date
  /** Análise da IA de uma entrega recém-gravada (falha fica registrada na entrega; nunca desfaz a entrega). */
  analyze?: (delivery: DeliveryRecord, report: ReportRecord) => Promise<void>
}

export type RecipientOutcome = { personId: string; name: string; reason: "NO_STRUCTURE" | "ACCESS_DENIED" | "INACTIVE" }
export type RunResult = { status: RunStatus; outcome: Record<string, unknown> }

const MAX_RECIPIENTS = 2_000
const MAX_DENIED_LISTED = 50

export function scopeKeyOf(structure: ResolvedStructure): string {
  const members = structure.resolved.members.map((member) => member.id).sort()
  return createHash("sha256").update(JSON.stringify({ subject: structure.subject, members })).digest("hex").slice(0, 32)
}

function shiftMonths(period: string, months: number): string {
  let current = period
  for (let index = 0; index < months; index += 1) current = previousReferencePeriod(current)
  return current
}

function periodKeyOf(definition: ReportDefinition, card: QueryTableCard, now: Date, timeZone: string): string {
  const local = localDateParts(now, timeZone).date
  switch (definition.period.mode) {
    case "TODAY":
      return local
    case "CURRENT":
      // Mês/semana em curso: o mesmo período até virar — a atualização é decidida pela marca d'água da medição diária.
      return definition.period.window === "MES_CORRENTE" ? `MES:${local.slice(0, 7)}` : definition.period.window === "SEMANA_CORRENTE" ? `SEMANA:${weekStart(local)}` : "ULTIMOS_7_DIAS"
    case "LAST_N_CLOSED":
      return `${card.period ?? "—"}x${definition.period.months}`
    default:
      return card.period ?? "—"
  }
}

function weekStart(date: string): string {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay()
  const back = (day + 6) % 7
  return new Date(Date.parse(`${date}T00:00:00Z`) - back * 86_400_000).toISOString().slice(0, 10)
}

function periodLabelOf(definition: ReportDefinition, card: QueryTableCard, now: Date, timeZone: string): string {
  if (definition.period.mode === "TODAY") return `Situação em ${localDateParts(now, timeZone).date.split("-").reverse().join("/")}`
  if (definition.period.mode === "CURRENT") return card.scopeNote || describePeriod(definition.period)
  if (!card.period) return describePeriod(definition.period)
  if (definition.period.mode === "LAST_N_CLOSED") return `${longPeriodLabel(shiftMonths(card.period, definition.period.months - 1))} a ${longPeriodLabel(card.period)}`
  return longPeriodLabel(card.period)
}

async function buildComparison(context: RecipientContext, report: ReportRecord, card: QueryTableCard, lastValid: DeliveryRecord | null): Promise<ReportComparison> {
  const definition = report.definition
  if (!report.analysis.comparison) return notComparable("DISABLED", "", "Comparação desligada na configuração do report.")
  if (definition.tool === "INDICATOR_DIAGNOSIS") return notComparable("NOT_COMPARABLE", "Diagnóstico do período", "O diagnóstico mostra associações do período analisado; não há comparação equivalente.")
  if (definition.period.mode === "CURRENT") return notComparable("NOT_COMPARABLE", "Período em curso", "Período em curso (parcial): comparar com um período completo não seria equivalente.")
  if (definition.period.mode === "LAST_N_CLOSED" && definition.period.display === "RECORRENCIA") return notComparable("NOT_COMPARABLE", "Recorrência no período", "A recorrência já resume o período inteiro; não há referência equivalente.")
  if (definition.period.mode === "LAST_N_CLOSED" && definition.period.display === "POR_MES") return compareFirstAndLastMonth(card)
  if (definition.tool === "WORKFORCE") {
    if (!lastValid?.dataset) return notComparable("NO_HISTORY", "Situação × entrega anterior", "Ainda não há entrega anterior para comparar.")
    return compareCards(card, lastValid.dataset, { basis: `Situação atual × entrega anterior (${lastValid.createdAt.slice(0, 10).split("-").reverse().join("/")}), mesma definição e escopo`, currentLabel: "Agora", referenceLabel: "Entrega anterior", valueDirection: null, configurationChanged: lastValid.configVersion !== report.configVersion })
  }
  if (!card.period) return notComparable("NOT_COMPARABLE", "", "Sem competência identificada para comparar.")
  const months = definition.period.mode === "LAST_N_CLOSED" ? definition.period.months : 1
  const referencePeriod = shiftMonths(card.period, months)
  const reference = await context.runTool(toToolCall(definition, { month: referencePeriod, months }).name, toToolCall(definition, { month: referencePeriod, months }).args)
  const referenceCard = reference.card && reference.card.type === "QUERY_TABLE" ? reference.card : null
  const currentLabel = longPeriodLabel(card.period)
  const referenceLabel = longPeriodLabel(referencePeriod)
  if (!referenceCard) return { ...notComparable("NO_HISTORY", `${currentLabel} × ${referenceLabel}`, `Sem dados em ${referenceLabel} para comparar.`), currentLabel, referenceLabel }
  return compareCards(card, referenceCard, {
    basis: `${currentLabel} × ${referenceLabel} — ${months > 1 ? `as ${months} competências anteriores` : "competência anterior"}, mesma definição, escopo e filtros (estrutura atual nos dois períodos)`,
    currentLabel,
    referenceLabel,
    valueDirection: await context.indicatorDirection(card.indicatorCode),
  })
}

type ScopeGroup = { key: string; structure: ResolvedStructure; context: RecipientContext; recipients: Recipient[] }

export async function executeReportRun(deps: ExecutorDeps, run: RunRecord): Promise<RunResult> {
  const now = deps.now()
  const report = await deps.store.getReport(run.reportId, run.organizationId)
  if (!report || report.deletedAt) return { status: "SKIPPED", outcome: { reason: "REPORT_DELETED" } }
  if (report.status !== "ACTIVE" && run.triggerKind === "SCHEDULE") return { status: "SKIPPED", outcome: { reason: "REPORT_INACTIVE" } }
  const definition = report.definition
  const timeZone = report.timeZone

  // Responsável: conta e pessoa ativas; distribuição ainda permitida; estrutura fixa ainda no escopo dele.
  const owner = await deps.runtime.account(report.organizationId, report.ownerAccountId)
  if (!owner) return { status: "BLOCKED", outcome: { reason: "OWNER_INACTIVE", message: "A conta ou o cadastro do responsável não está mais ativo." } }
  let recipients: { personId: string; accountId: string; name: string }[]
  if (report.audience.mode === "DISTRIBUTION") {
    const scope = await deps.runtime.distributionScope(report.organizationId, report.ownerAccountId)
    if (!scope) return { status: "BLOCKED", outcome: { reason: "DISTRIBUTION_REVOKED", message: "O responsável não tem mais o papel Report para distribuir este report." } }
    recipients = (await deps.runtime.resolveRecipients(report.organizationId, report.audience, scope)).slice(0, MAX_RECIPIENTS)
  } else {
    recipients = [{ personId: owner.personId, accountId: owner.accountId, name: owner.name }]
  }
  if (definition.structure.mode === "FIXED") {
    const ownerContext = await deps.runtime.contextFor(report.organizationId, report.ownerAccountId)
    if (!ownerContext || !ownerContext.resolveFixed(definition.structure.subjectKind, definition.structure.subjectId)) return { status: "BLOCKED", outcome: { reason: "STRUCTURE_OUT_OF_SCOPE", message: "A estrutura do report saiu do escopo do responsável." } }
  }
  if (recipients.length === 0) return { status: "NOT_FORWARDED", outcome: { reason: "NO_RECIPIENTS", message: "Nenhum destinatário elegível no público configurado." } }

  // Destinatários agrupados pela chave de escopo — cada um só com o que o escopo DELE alcança.
  const groups = new Map<string, ScopeGroup>()
  const denied: RecipientOutcome[] = []
  for (const recipient of recipients) {
    const context = await deps.runtime.contextFor(report.organizationId, recipient.accountId)
    if (!context) {
      // Conta/pessoa inativa × ativa sem escopo de liderança (não lidera ninguém nem tem acesso ampliado).
      const active = await deps.runtime.account(report.organizationId, recipient.accountId)
      denied.push({ personId: recipient.personId, name: recipient.name, reason: !active ? "INACTIVE" : definition.structure.mode === "RECIPIENT" ? "NO_STRUCTURE" : "ACCESS_DENIED" })
      continue
    }
    const structure = definition.structure.mode === "RECIPIENT" ? context.ownStructure : context.resolveFixed(definition.structure.subjectKind, definition.structure.subjectId)
    if (!structure) {
      denied.push({ personId: recipient.personId, name: recipient.name, reason: definition.structure.mode === "RECIPIENT" ? "NO_STRUCTURE" : "ACCESS_DENIED" })
      continue
    }
    const key = scopeKeyOf(structure)
    const group = groups.get(key) ?? { key, structure, context, recipients: [] }
    group.recipients.push({ personId: recipient.personId, accountId: recipient.accountId })
    groups.set(key, group)
  }

  const delivered: { key: string; deliveryId: string; recipients: number }[] = []
  const notForwarded: { key: string; reason: string; structure: string; pendingSources: { label: string; lastUpdatedAt: string | null; detail: string | null }[] }[] = []
  const failed: { key: string; structure: string; message: string }[] = []
  const created: DeliveryRecord[] = []
  for (const group of groups.values()) {
    const call = toToolCall(definition)
    // Estrutura "de quem recebe": a ferramenta usa a estrutura própria da conta do grupo (mesma chave de escopo).
    const result = await group.context.runTool(call.name, call.args)
    const card = result.card && result.card.type === "QUERY_TABLE" ? result.card : null
    if (!card) {
      failed.push({ key: group.key, structure: group.structure.ref.label, message: result.issue?.message ?? "A consulta não devolveu uma tabela." })
      continue
    }
    const periodKey = periodKeyOf(definition, card, now, timeZone)
    const lastValid = await deps.store.lastValidDelivery(report.id, group.key)
    const baseline: DeliveryBaseline | null = lastValid ? { periodKey: lastValid.periodKey, fingerprint: lastValid.fingerprint, watermarks: Object.fromEntries(lastValid.sources.map((source) => [source.source, source.watermark])) } : null
    const sources = await group.context.sources(group.structure, definition)
    const coverage = await group.context.coverage(group.structure, definition, card.period)
    const fingerprint = cardFingerprint(card)
    const decision = decideDelivery({ coverage, sources, periodKey, fingerprint, baseline })
    const periodLabel = periodLabelOf(definition, card, now, timeZone)
    if (decision.kind === "NOT_FORWARDED") {
      // Aviso repetido (mesmo motivo e período) não vira outro item: conta a ocorrência no aviso que já existe.
      const latest = await deps.store.latestRecord(report.id, group.key)
      if (latest && latest.kind === "NOT_FORWARDED" && latest.reason === decision.reason && latest.periodKey === periodKey && latest.runId !== run.id) {
        await deps.store.bumpNotice(latest.id, now.toISOString())
      } else {
        const notice = await deps.store.insertDelivery({ organizationId: report.organizationId, reportId: report.id, runId: run.id, configVersion: report.configVersion, scopeKey: group.key, kind: "NOT_FORWARDED", reason: decision.reason, structureLabel: group.structure.ref.label, periodKey, periodLabel, sources: decision.pendingSources.length > 0 ? decision.pendingSources : sources, dataset: null, visualization: null, comparison: null, fingerprint: null, empty: false, analysisStatus: "NOT_APPLICABLE" })
        await deps.store.addRecipients(notice.delivery.id, run.id, report.organizationId, report.id, group.recipients)
      }
      notForwarded.push({ key: group.key, reason: decision.reason, structure: group.structure.ref.label, pendingSources: decision.pendingSources.map((source) => ({ label: source.label, lastUpdatedAt: source.lastUpdatedAt, detail: source.detail })) })
      continue
    }
    const comparison = await buildComparison(group.context, report, card, lastValid)
    const visualization = buildVisualizationData(card, report.visualization)
    const saved = await deps.store.insertDelivery({ organizationId: report.organizationId, reportId: report.id, runId: run.id, configVersion: report.configVersion, scopeKey: group.key, kind: "DELIVERY", reason: null, structureLabel: group.structure.ref.label, periodKey, periodLabel, sources, dataset: card, visualization, comparison, fingerprint, empty: card.rows.length === 0, analysisStatus: report.analysis.enabled ? "PENDING" : "DISABLED" })
    await deps.store.addRecipients(saved.delivery.id, run.id, report.organizationId, report.id, group.recipients)
    delivered.push({ key: group.key, deliveryId: saved.delivery.id, recipients: group.recipients.length })
    if (saved.created) created.push(saved.delivery)
  }

  for (const delivery of created) if (delivery.analysisStatus === "PENDING" && deps.analyze) await deps.analyze(delivery, report).catch(() => undefined)

  const status: RunStatus =
    delivered.length > 0 ? (notForwarded.length > 0 || failed.length > 0 || denied.length > 0 ? "PARTIAL" : "COMPLETED") : failed.length > 0 && notForwarded.length === 0 ? "FAILED" : notForwarded.length > 0 ? "NOT_FORWARDED" : "NOT_FORWARDED"
  return {
    status,
    outcome: {
      recipients: recipients.length,
      delivered: delivered.reduce((sum, item) => sum + item.recipients, 0),
      deliveries: delivered.length,
      notForwarded,
      failed,
      denied: denied.slice(0, MAX_DENIED_LISTED),
      deniedCount: denied.length,
      ...(groups.size === 0 ? { reason: "NO_ACCESSIBLE_RECIPIENTS", message: "Nenhum destinatário tem acesso à estrutura deste report agora." } : {}),
    },
  }
}
