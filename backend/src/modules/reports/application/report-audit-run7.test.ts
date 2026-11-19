import { describe, expect, it } from "vitest"
import { DomainError } from "../../../shared/domain/domain-error.js"
import type { QueryTableCard } from "../../leadership-analytics/domain/view-models.js"
import { cardFingerprint, decideDelivery, legacyCardFingerprint, type SourceState } from "../domain/delivery-decision.js"
import { recordPeriodCovered, type RecordMarks } from "../domain/record-coverage.js"
import { recordPeriodFromArgs, reportAnalysisSchema, reportDefinitionSchema, reportScheduleSchema, reportVisualizationSchema } from "../domain/report-definition.js"
import { createFakeRuntime, createMemoryReportStore, testStructure, type FakePerson } from "../testing/memory-report-store.js"
import { executeReportRun } from "./report-executor.js"
import { draftFromToolCall, type ProposalStore } from "./report-proposals.js"
import { createReport, previewReport } from "./report-service.js"

/** Achados da 10ª auditoria (run-7), parte de reports: DL-08 (trecho sem campo), DL-09 (período sem carga), DL-10 (datas) e DL-06 (impressão digital). */
const ORG = "00000000-0000-4000-8000-0000000000aa"
const OWN = { kind: "SUPERVISOR_TEAM", supervisorId: "00000000-0000-4000-8000-000000000001" }
const SARA = testStructure("sara", "Equipe da Sara", ["op1", "op2"])
const sara: FakePerson = { accountId: "acc-sara", personId: "p-sara", name: "Sara", role: "SUPERVISOR", active: true, own: SARA, reachable: {}, level: "SUPERVISOR" }
const chat = { ownSubject: OWN, lastClosedPeriod: "2026-09", today: "2026-10-16", question: null, indicatorCode: () => null }
const base = { structure: { mode: "RECIPIENT" } }

function card(rows: Record<string, string>[] = [{ group: "Sara", records: "40" }]): QueryTableCard {
  return {
    type: "QUERY_TABLE", generatedAt: "", structure: { subject: OWN as never, label: "Minha equipe", description: null }, source: "OFFICIAL", title: "Atendimentos", scopeNote: "", period: null, indicatorCode: null,
    columns: [{ key: "group", label: "Supervisor", numeric: false }, { key: "records", label: "Registros", numeric: true }],
    rows: rows.map((cells) => ({ cells, subject: null, personId: null })), totalRows: rows.length, highlights: [], methods: [], limitations: [],
  }
}

const interactions = (): SourceState[] => [{ source: "INTERACTIONS", label: "Interações", watermark: `interaction:${Math.random()}`, lastUpdatedAt: null, stale: false, detail: null }]

async function setup(definition: unknown, options: { marks?: () => RecordMarks; cardFor?: (args: Record<string, unknown>) => QueryTableCard | null; raw?: boolean } = {}) {
  const memory = createMemoryReportStore()
  const fake = createFakeRuntime({ people: [sara], card: (_label, args) => (options.cardFor ? options.cardFor(args) : card()), sources: interactions, coverage: () => null, ...(options.marks ? { recordMarks: options.marks } : {}) })
  const report = await memory.store.createReport(
    {
      organizationId: ORG, ownerAccountId: sara.accountId, ownerPersonId: sara.personId, name: "Report", description: null, status: "ACTIVE", origin: "CHAT", timeZone: "America/Sao_Paulo", nextRunAt: null, sourceProposalId: null,
      definition: options.raw ? (definition as never) : reportDefinitionSchema.parse(definition), visualization: reportVisualizationSchema.parse({ type: "TABLE" }), schedule: reportScheduleSchema.parse({ frequency: "DAILY", times: ["07:00"] }), audience: { mode: "SELF" }, analysis: reportAnalysisSchema.parse({}),
    },
    sara.accountId,
  )
  const run = async (now: string) => {
    const queued = (await memory.store.enqueueRun({ organizationId: ORG, reportId: report.id, scheduledFor: now, triggerKind: "SCHEDULE", configVersion: 1 }))!
    return executeReportRun({ store: memory.store, runtime: fake.runtime, now: () => new Date(now) }, queued)
  }
  return { memory, fake, run }
}

describe("DL-08 — trecho (`termo`) só com o campo onde procurar", () => {
  it("proposta do chat: sem `termo_em` não há oferta; com ele, a leitura escolhida fica na definição", () => {
    expect(draftFromToolCall("leadership_interactions", { termo: "contestação", agrupar_por: "SUPERVISOR" }, card(), chat)).toBeNull()
    expect(draftFromToolCall("leadership_interactions", { termo: "contestação", termo_em: ["NAO_EXISTE"] }, card(), chat)).toBeNull()
    const draft = draftFromToolCall("leadership_interactions", { termo: "contestação", termo_em: ["SUBMOTIVO"], agrupar_por: "SUPERVISOR" }, card(), chat)!
    expect(draft.definition.queryArgs).toEqual({ termo: "contestação", termo_em: ["SUBMOTIVO"], agrupar_por: "SUPERVISOR" })
  })

  it("formulário e prévia: gravação recusada com 422 e código estável", async () => {
    const memory = createMemoryReportStore()
    const fake = createFakeRuntime({ people: [sara], card: () => card() })
    const deps = { store: memory.store, runtime: fake.runtime, proposals: { get: async () => null, decide: async () => undefined } as unknown as ProposalStore, analysisWriter: async () => "", now: () => new Date("2026-10-16T12:00:00Z") }
    const actor = { organizationId: ORG, accountId: sara.accountId, personId: sara.personId }
    const definition = { tool: "INTERACTIONS", ...base, period: { mode: "LAST_CLOSED" }, queryArgs: { termo: "contestação" } }
    const refusal = async (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => (error instanceof DomainError ? [error.statusCode, error.code] : String(error)))
    const config = { name: "Contestação", definition, visualization: { type: "TABLE" }, schedule: { frequency: "DAILY", times: ["08:00"] }, audience: { mode: "SELF" }, analysis: {} }
    expect(await refusal(createReport(deps, actor, { config, activate: false }))).toEqual([422, "REPORT_TERM_FIELD_REQUIRED"])
    expect(await refusal(previewReport(deps, actor, { definition }))).toEqual([422, "REPORT_TERM_FIELD_REQUIRED"])
    expect(memory.reports).toHaveLength(0)
    expect(await refusal(createReport(deps, actor, { config: { ...config, definition: { ...definition, queryArgs: { termo: "contestação", termo_em: ["MOTIVO", "SUBMOTIVO"] } } }, activate: false }))).toBeNull()
  })

  it("execução de definição antiga sem o campo: bloqueada antes de consultar — sem cartão de escolha nem troca de leitura", async () => {
    const { memory, fake, run } = await setup({ tool: "INTERACTIONS", ...base, period: { mode: "LAST_CLOSED" }, indicators: [], limit: 20, queryArgs: { termo: "contestação" } }, { raw: true })
    const result = await run("2026-10-16T11:00:00Z")
    expect(result).toMatchObject({ status: "BLOCKED", outcome: { reason: "DEFINITION_NOT_REPRODUCIBLE" } })
    expect(fake.calls).toHaveLength(0)
    expect(memory.deliveries).toHaveLength(0)
  })
})

describe("DL-09 — período que a carga não cobriu nunca é zero nem queda", () => {
  const yesterday = { tool: "INTERACTIONS", ...base, period: { mode: "RELATIVE_DAYS", fromOffset: -1, toOffset: -1 }, queryArgs: { agrupar_por: "SUPERVISOR" } }

  it("\"atendimentos de ontem\" antes da carga D-1: não encaminhado, \"sem dados no período\", sem comparação", async () => {
    // 16/10 às 07h (São Paulo): o último atendimento carregado é de 14/10 e a última carga concluída foi em 15/10.
    const { memory, fake, run } = await setup(yesterday, { marks: () => ({ firstDay: "2026-01-02", lastDay: "2026-10-14", loadedThroughDay: "2026-10-15" }) })
    expect((await run("2026-10-16T10:00:00Z")).status).toBe("NOT_FORWARDED")
    expect(memory.deliveries).toHaveLength(1)
    expect(memory.deliveries[0]).toMatchObject({ kind: "NOT_FORWARDED", reason: "STALE_SOURCES", periodKey: "2026-10-15..2026-10-15", dataset: null, comparison: null })
    expect(memory.deliveries[0]!.sources[0]!.detail).toContain("Sem dados no período")
    // Nenhuma consulta de referência (a comparação não é montada).
    expect(fake.calls).toHaveLength(1)
  })

  it("depois da carga (ou com atendimento até o fim do período) entrega; dia sem operação com a carga concluída é zero legítimo", async () => {
    let marks: RecordMarks = { firstDay: "2026-01-02", lastDay: "2026-10-15", loadedThroughDay: null }
    const { memory, run } = await setup(yesterday, { marks: () => marks })
    expect((await run("2026-10-16T13:00:00Z")).status).toBe("COMPLETED")
    marks = { firstDay: "2026-01-02", lastDay: "2026-10-15", loadedThroughDay: "2026-10-17" }
    expect((await run("2026-10-17T13:00:00Z")).status).toBe("COMPLETED")
    expect(memory.deliveries.map((item) => item.kind)).toEqual(["DELIVERY", "DELIVERY"])
  })

  it("referência anterior ao primeiro atendimento carregado: entrega sem comparar (NO_HISTORY), sem \"aumento desde zero\"", async () => {
    const { memory, fake, run } = await setup(yesterday, { marks: () => ({ firstDay: "2026-10-15", lastDay: "2026-10-15", loadedThroughDay: null }) })
    expect((await run("2026-10-16T13:00:00Z")).status).toBe("COMPLETED")
    expect(memory.deliveries[0]!.comparison).toMatchObject({ status: "NO_HISTORY", referenceLabel: "14/10/2026" })
    expect(fake.calls).toHaveLength(1)
  })

  it("regra de cobertura: estrutura sem atendimento, período em curso e período encerrado", () => {
    const marks = (lastDay: string | null, loadedThroughDay: string | null = null): RecordMarks => ({ firstDay: lastDay ? "2026-01-02" : null, lastDay, loadedThroughDay })
    const today = "2026-10-16"
    expect(recordPeriodCovered(marks(null, "2026-10-16"), { month: "2026-09" }, today)).toBe(false)
    expect(recordPeriodCovered(marks("2026-09-30"), { month: "2026-09" }, today)).toBe(true)
    expect(recordPeriodCovered(marks("2026-09-28"), { month: "2026-09" }, today)).toBe(false)
    expect(recordPeriodCovered(marks("2026-09-28", "2026-10-01"), { month: "2026-09" }, today)).toBe(true)
    // Em curso: basta haver atendimento dentro do período; a carga concluída sozinha não prova nada.
    expect(recordPeriodCovered(marks("2026-10-15"), { month: "2026-10" }, today)).toBe(true)
    expect(recordPeriodCovered(marks("2026-09-30", "2026-10-16"), { month: "2026-10" }, today)).toBe(false)
    // Antes do primeiro atendimento (implantação/retenção) não há dado; a referência exige dado desde o início.
    expect(recordPeriodCovered(marks("2026-10-15"), { dates: { from: "2025-12-01", to: "2025-12-31" } }, today)).toBe(false)
    expect(recordPeriodCovered(marks("2026-10-15"), { dates: { from: "2025-12-29", to: "2026-01-04" } }, today)).toBe(true)
    expect(recordPeriodCovered(marks("2026-10-15"), { dates: { from: "2025-12-29", to: "2026-01-04" } }, today, { fromStart: true })).toBe(false)
  })
})

describe("DL-10 — datas e competência impossíveis, teto de 12 meses", () => {
  const messages = (period: unknown) => {
    const parsed = reportDefinitionSchema.safeParse({ tool: "INTERACTIONS", ...base, period })
    return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message)
  }
  it("data que não existe e competência 13 são recusadas com mensagem clara", () => {
    expect(messages({ mode: "FIXED_DATES", from: "2026-02-01", to: "2026-02-31" })).toEqual(["Data inválida: use AAAA-MM-DD com um dia que exista no calendário."])
    expect(messages({ mode: "FIXED_DATES", from: "2026-13-01", to: "2026-13-05" })[0]).toContain("Data inválida")
    expect(messages({ mode: "FIXED_MONTH", month: "2026-13" })).toEqual(["Competência inválida: use AAAA-MM, com o mês de 01 a 12."])
    expect(messages({ mode: "FIXED_DATES", from: "2024-02-29", to: "2024-02-29" })).toEqual([])
  })
  it("datas fixas e dias relativos têm teto de 12 meses", () => {
    expect(messages({ mode: "FIXED_DATES", from: "2025-01-01", to: "2026-06-30" })).toEqual(["Período de datas maior que 12 meses."])
    expect(messages({ mode: "FIXED_DATES", from: "2025-10-16", to: "2026-10-16" })).toEqual([])
    expect(messages({ mode: "RELATIVE_DAYS", fromOffset: -366, toOffset: 0 })).toEqual(["Período de datas maior que 12 meses."])
    expect(messages({ mode: "RELATIVE_DAYS", fromOffset: -365, toOffset: 0 })).toEqual([])
  })
  it("proposta do chat: data impossível ou período longo demais não vira report (nem lança erro)", () => {
    const input = { today: "2026-10-16", lastClosedPeriod: "2026-09" }
    expect(recordPeriodFromArgs({ data_inicio: "2026-02-01", data_fim: "2026-02-31" }, input)).toBeNull()
    expect(recordPeriodFromArgs({ data_inicio: "2026-13-01", data_fim: "2026-13-05" }, input)).toBeNull()
    expect(recordPeriodFromArgs({ data_inicio: "2024-01-01", data_fim: "2025-06-30" }, input)).toBeNull()
  })
  it("execução de definição antiga com data impossível: bloqueada, sem RangeError", async () => {
    const { run } = await setup({ tool: "INTERACTIONS", ...base, period: { mode: "FIXED_DATES", from: "2026-13-01", to: "2026-13-05" }, indicators: [], limit: 20 }, { raw: true })
    expect(await run("2026-10-16T11:00:00Z")).toMatchObject({ status: "BLOCKED", outcome: { reason: "DEFINITION_NOT_REPRODUCIBLE" } })
  })
})

describe("DL-06 — impressão digital estável", () => {
  const a = { group: "Ana", records: "10" }
  const b = { group: "Bia", records: "10" }
  it("as mesmas linhas em outra ordem (e as chaves em outra ordem) dão a mesma assinatura; dado diferente, outra", () => {
    expect(cardFingerprint(card([a, b]))).toBe(cardFingerprint(card([b, a])))
    expect(cardFingerprint(card([a, b]))).toBe(cardFingerprint(card([{ records: "10", group: "Ana" }, b])))
    expect(cardFingerprint(card([a, b]))).not.toBe(cardFingerprint(card([a, { ...b, records: "11" }])))
    expect(cardFingerprint(card([a]))).not.toBe(cardFingerprint(card([a, a])))
  })
  it("a última entrega gravada com a assinatura antiga continua reconhecida (sem entrega repetida na virada)", () => {
    const current = card([b, a])
    const sources: SourceState[] = [{ source: "INTERACTIONS", label: "Interações", watermark: "interaction:2", lastUpdatedAt: null, stale: false, detail: null }]
    const baseline = { periodKey: "2026-09", fingerprint: legacyCardFingerprint(current), watermarks: { INTERACTIONS: "interaction:1" } }
    expect(decideDelivery({ coverage: null, sources, periodKey: "2026-09", fingerprint: cardFingerprint(current), legacyFingerprint: legacyCardFingerprint(current), baseline })).toMatchObject({ kind: "NOT_FORWARDED", reason: "NO_CHANGE" })
  })
})
