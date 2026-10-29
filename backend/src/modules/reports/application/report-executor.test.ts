import { describe, expect, it } from "vitest"
import type { QueryTableCard } from "../../leadership-analytics/domain/view-models.js"
import { reportAnalysisSchema, reportDefinitionSchema, reportScheduleSchema, reportVisualizationSchema, type ReportAudience } from "../domain/report-definition.js"
import { createFakeRuntime, createMemoryReportStore, testStructure, type FakePerson } from "../testing/memory-report-store.js"
import { analyzeDelivery } from "./report-analysis.js"
import { executeReportRun, scopeKeyOf } from "./report-executor.js"
import { processRun } from "./report-scheduler.js"
import type { ReportStore } from "./report-store.js"

const ORG = "00000000-0000-4000-8000-0000000000aa"
const SARA = testStructure("sara", "Equipe da Sara", ["op1", "op2"])
const SAULO = testStructure("saulo", "Equipe do Saulo", ["op3"])
const NOVA = testStructure("sara-nova", "Equipe da Sara (nova)", ["op1", "op9"])

function person(id: string, name: string, overrides: Partial<FakePerson> = {}): FakePerson {
  return { accountId: `acc-${id}`, personId: `p-${id}`, name, role: "SUPERVISOR", active: true, own: null, reachable: {}, level: "SUPERVISOR", ...overrides }
}

/** Cartão por estrutura e competência (a referência da comparação pede o mês anterior). */
function tableFor(label: string, args: Record<string, unknown>, rows?: Record<string, string>[]): QueryTableCard {
  const month = typeof args.competencia === "string" ? args.competencia : "2026-09"
  const values = month === "2026-08" ? [{ person: "Ana", value: "450 s", achievement: "88%" }] : [{ person: "Ana", value: "420 s", achievement: "95%" }]
  return {
    type: "QUERY_TABLE", generatedAt: "2026-10-16T12:00:00.000Z", structure: { subject: { kind: "SUPERVISOR_TEAM", supervisorId: "x" }, label, description: null }, source: "OFFICIAL",
    title: `Pessoas — TMA (${label})`, scopeNote: `Competência oficial: ${month}`, period: month, indicatorCode: "TMA",
    columns: [{ key: "person", label: "Pessoa", numeric: false }, { key: "value", label: "Valor", numeric: true }, { key: "achievement", label: "Atingimento", numeric: true }],
    rows: (rows ?? values).map((cells) => ({ cells, subject: null, personId: null })), totalRows: (rows ?? values).length, highlights: [], methods: [], limitations: [],
  }
}

async function setup(options: { people: FakePerson[]; owner: string; audience?: ReportAudience; structure?: { mode: "RECIPIENT" } | { mode: "FIXED"; subjectKind: string; subjectId: string; label: string }; rows?: () => Record<string, string>[] | undefined }) {
  const memory = createMemoryReportStore()
  const fake = createFakeRuntime({ people: options.people, card: (label, args) => tableFor(label, args, options.rows?.()) })
  const owner = options.people.find((item) => item.accountId === `acc-${options.owner}`)!
  const report = await memory.store.createReport(
    {
      organizationId: ORG, ownerAccountId: owner.accountId, ownerPersonId: owner.personId, name: "TOP TMA", description: "Quem está pior em TMA", status: "ACTIVE", origin: "SCREEN", timeZone: "America/Sao_Paulo", nextRunAt: null, sourceProposalId: null,
      definition: reportDefinitionSchema.parse({ tool: "INDICATOR_QUERY", structure: options.structure ?? { mode: "RECIPIENT" }, period: { mode: "LAST_CLOSED" }, indicators: ["TMA"], groupBy: "PESSOA", sortBy: "ATINGIMENTO", order: "ASC", limit: 3 }),
      visualization: reportVisualizationSchema.parse({ type: "BAR", metric: "achievement" }),
      schedule: reportScheduleSchema.parse({ frequency: "DAILY", times: ["08:00"] }),
      audience: options.audience ?? { mode: "SELF" },
      analysis: reportAnalysisSchema.parse({}),
    },
    owner.accountId,
  )
  let slot = 0
  const run = async (store: ReportStore = memory.store) => {
    const queued = (await store.enqueueRun({ organizationId: ORG, reportId: report.id, scheduledFor: new Date(Date.UTC(2026, 9, 16 + slot++, 11)).toISOString(), triggerKind: "SCHEDULE", configVersion: 1 }))!
    return { run: queued, result: await executeReportRun({ store, runtime: fake.runtime, now: () => new Date("2026-10-16T12:00:00Z") }, queued) }
  }
  return { memory, fake, report, run }
}

describe("execução — líder (report para si)", () => {
  it("'minha equipe' = a estrutura atual do líder; entrega única com visualização e comparação com a competência anterior", async () => {
    const { memory, fake, run } = await setup({ people: [person("sara", "Sara", { own: SARA })], owner: "sara" })
    const { result } = await run()
    expect(result.status).toBe("COMPLETED")
    expect(memory.deliveries).toHaveLength(1)
    const delivery = memory.deliveries[0]!
    expect(delivery).toMatchObject({ kind: "DELIVERY", structureLabel: "Equipe da Sara", periodKey: "2026-09", empty: false, analysisStatus: "PENDING" })
    expect(delivery.visualization).toMatchObject({ type: "BAR", categories: ["Ana"], series: [{ values: [95] }] })
    // Comparação: consulta de referência com a competência anterior; TMA (menor é melhor) caindo = melhora.
    expect(fake.calls.map((call) => call.args.competencia ?? null)).toEqual([null, "2026-08"])
    expect(delivery.comparison).toMatchObject({ status: "COMPARED", currentLabel: "Setembro 2026", referenceLabel: "Agosto 2026" })
    expect(delivery.comparison!.changes.find((change) => change.column === "value")).toMatchObject({ delta: -30, assessment: "IMPROVED" })
    expect(memory.recipients.map((row) => row.personId)).toEqual(["p-sara"])
  })

  it("bases sem atualização no mesmo período: NÃO encaminha, preserva a última entrega válida e não repete o aviso", async () => {
    const { memory, run } = await setup({ people: [person("sara", "Sara", { own: SARA })], owner: "sara" })
    await run()
    const second = await run()
    expect(second.result.status).toBe("NOT_FORWARDED")
    const third = await run()
    expect(third.result.status).toBe("NOT_FORWARDED")
    expect(memory.deliveries.map((item) => item.kind)).toEqual(["DELIVERY", "NOT_FORWARDED"])
    expect(memory.deliveries[1]).toMatchObject({ reason: "STALE_SOURCES", occurrences: 2 })
    expect(memory.deliveries[0]!.kind).toBe("DELIVERY")
  })

  it("base atualizada com dados iguais = sem mudança (não encaminhado); dados novos = nova entrega", async () => {
    const data: { rows?: Record<string, string>[] } = {}
    const { memory, fake, run } = await setup({ people: [person("sara", "Sara", { own: SARA })], owner: "sara", rows: () => data.rows })
    await run()
    fake.state.sources = () => [{ source: "OFFICIAL_INDICATOR_PERFORMANCE", label: "Fechamento oficial", watermark: "official:2", lastUpdatedAt: null, stale: false, detail: null }]
    expect((await run()).result.status).toBe("NOT_FORWARDED")
    expect(memory.deliveries.at(-1)).toMatchObject({ kind: "NOT_FORWARDED", reason: "NO_CHANGE" })
    data.rows = [{ person: "Ana", value: "400 s", achievement: "100%" }]
    fake.state.sources = () => [{ source: "OFFICIAL_INDICATOR_PERFORMANCE", label: "Fechamento oficial", watermark: "official:3", lastUpdatedAt: null, stale: false, detail: null }]
    expect((await run()).result.status).toBe("COMPLETED")
    expect(memory.deliveries.filter((item) => item.kind === "DELIVERY")).toHaveLength(2)
  })

  it("cobertura insuficiente não encaminha; resultado legitimamente vazio É entrega (vazio ≠ zero)", async () => {
    const low = await setup({ people: [person("sara", "Sara", { own: SARA })], owner: "sara" })
    low.fake.state.coverage = () => 0.4
    expect((await low.run()).result.status).toBe("NOT_FORWARDED")
    expect(low.memory.deliveries[0]).toMatchObject({ kind: "NOT_FORWARDED", reason: "INSUFFICIENT_COVERAGE" })
    const empty = await setup({ people: [person("sara", "Sara", { own: SARA })], owner: "sara", rows: () => [] })
    expect((await empty.run()).result.status).toBe("COMPLETED")
    expect(empty.memory.deliveries[0]).toMatchObject({ kind: "DELIVERY", empty: true })
  })

  it("líder trocou de equipe: a execução seguinte usa a equipe NOVA (nova chave de escopo, entrega própria)", async () => {
    const sara = person("sara", "Sara", { own: SARA })
    const { memory, fake, run } = await setup({ people: [sara], owner: "sara" })
    await run()
    fake.state.people = [{ ...sara, own: NOVA }]
    expect((await run()).result.status).toBe("COMPLETED")
    expect(memory.deliveries.map((item) => item.structureLabel)).toEqual(["Equipe da Sara", "Equipe da Sara (nova)"])
  })

  it("responsável inativo bloqueia; estrutura fixa fora do escopo do responsável bloqueia; report inativo agendado é ignorado", async () => {
    const inactive = await setup({ people: [person("sara", "Sara", { own: SARA, active: false })], owner: "sara" })
    expect((await inactive.run()).result).toMatchObject({ status: "BLOCKED", outcome: { reason: "OWNER_INACTIVE" } })
    const fixed = await setup({ people: [person("sara", "Sara", { own: SARA })], owner: "sara", structure: { mode: "FIXED", subjectKind: "SUPERVISOR_TEAM", subjectId: "00000000-0000-4000-8000-000000000123", label: "Outra equipe" } })
    expect((await fixed.run()).result).toMatchObject({ status: "BLOCKED", outcome: { reason: "STRUCTURE_OUT_OF_SCOPE" } })
    const off = await setup({ people: [person("sara", "Sara", { own: SARA })], owner: "sara" })
    await off.memory.store.updateReport(off.report.id, ORG, 0, { status: "INACTIVE", nextRunAt: null, bumpVersion: false }, "acc-sara")
    expect((await off.run()).result.status).toBe("SKIPPED")
  })
})

describe("execução — papel Report (distribuição)", () => {
  const reporter = () => person("rh", "Rita (Report)", { role: "OPERATOR", level: "OPERATOR", distribution: { organizationWide: true, teamIds: [], subteamIds: [] } })

  it("cada destinatário recebe só a PRÓPRIA equipe (versões por escopo); quem distribui não recebe; sem estrutura = não atendido", async () => {
    const people = [reporter(), person("sara", "Sara", { own: SARA }), person("saulo", "Saulo", { own: SAULO }), person("sem", "Sem Equipe")]
    const { memory, run } = await setup({ people, owner: "rh", audience: { mode: "DISTRIBUTION", everyone: false, levels: ["SUPERVISOR"], jobTitles: [], teamIds: [], subteamIds: [], personIds: [] } })
    const { result } = await run()
    expect(result.status).toBe("PARTIAL")
    expect(memory.deliveries.map((item) => item.structureLabel).sort()).toEqual(["Equipe da Sara", "Equipe do Saulo"])
    const byPerson = Object.fromEntries(memory.recipients.map((row) => [row.personId, memory.deliveries.find((item) => item.id === row.deliveryId)!.structureLabel]))
    expect(byPerson).toEqual({ "p-sara": "Equipe da Sara", "p-saulo": "Equipe do Saulo" })
    expect(result.outcome.denied).toEqual([{ personId: "p-sem", name: "Sem Equipe", reason: "NO_STRUCTURE" }])
  })

  it("estrutura fixa: só quem alcança a estrutura recebe; os outros ficam como acesso negado (nunca uma visão mais ampla)", async () => {
    const fixedId = "00000000-0000-4000-8000-000000000777"
    const shared = testStructure(fixedId, "Equipe da Sara", ["op1", "op2"])
    const people = [reporter(), person("rh2", "Coord", { reachable: { [fixedId]: shared } }), person("sara", "Sara", { own: SARA, reachable: { [fixedId]: shared } }), person("saulo", "Saulo", { own: SAULO })]
    people[0]!.reachable = { [fixedId]: shared }
    const { memory, run } = await setup({ people, owner: "rh", structure: { mode: "FIXED", subjectKind: "SUPERVISOR_TEAM", subjectId: fixedId, label: "Equipe da Sara" }, audience: { mode: "DISTRIBUTION", everyone: false, levels: ["SUPERVISOR"], jobTitles: [], teamIds: [], subteamIds: [], personIds: [] } })
    const { result } = await run()
    expect(memory.recipients.map((row) => row.personId).sort()).toEqual(["p-rh2", "p-sara"])
    expect(result.outcome.denied).toEqual([{ personId: "p-saulo", name: "Saulo", reason: "ACCESS_DENIED" }])
  })

  it("estrutura fixa: quem enxerga mais gente abaixo da âncora (líderes) nunca divide a entrega com quem enxerga menos (C15, 4ª auditoria)", async () => {
    const fixedId = "00000000-0000-4000-8000-000000000778"
    const shared = testStructure(fixedId, "Gerência do Marcos", ["op1", "op2"])
    // Mesmos operadores; a Coordenadora também alcança uma supervisora sem operadores ativos (só ela vê essa pessoa).
    const people = [reporter(), person("ana", "Ana Coordenadora", { reachable: { [fixedId]: shared }, visibleBelow: ["p-sup-sem-equipe"] }), person("sara", "Sara", { own: SARA, reachable: { [fixedId]: shared } })]
    people[0]!.reachable = { [fixedId]: shared }
    const { memory, run } = await setup({ people, owner: "rh", structure: { mode: "FIXED", subjectKind: "SUPERVISOR_TEAM", subjectId: fixedId, label: "Gerência do Marcos" }, audience: { mode: "DISTRIBUTION", everyone: false, levels: ["SUPERVISOR"], jobTitles: [], teamIds: [], subteamIds: [], personIds: [] } })
    await run()
    const deliveries = memory.deliveries.filter((item) => item.kind === "DELIVERY")
    expect(deliveries).toHaveLength(2)
    const byDelivery = new Map<string, string[]>()
    for (const row of memory.recipients) byDelivery.set(row.deliveryId, [...(byDelivery.get(row.deliveryId) ?? []), row.personId])
    expect([...byDelivery.values()].map((ids) => ids.sort()).sort()).toEqual([["p-ana"], ["p-sara"]])
  })

  it("chave de escopo: sem ninguém além dos operadores, é a mesma de antes (o histórico das entregas não muda)", () => {
    const structure = testStructure("00000000-0000-4000-8000-000000000779", "Equipe", ["op1", "op2"])
    const operators = structure.resolved.members.map((member) => member.id)
    expect(scopeKeyOf(structure, operators)).toBe(scopeKeyOf(structure))
    expect(scopeKeyOf(structure, [...operators, "lider"])).not.toBe(scopeKeyOf(structure))
  })

  it("seleções combinadas (todos + pessoa específica) não geram entrega duplicada para a mesma pessoa", async () => {
    const people = [reporter(), person("sara", "Sara", { own: SARA })]
    const { memory, run } = await setup({ people, owner: "rh", audience: { mode: "DISTRIBUTION", everyone: true, levels: ["SUPERVISOR"], jobTitles: [], teamIds: [], subteamIds: [], personIds: ["p-sara"] } })
    await run()
    expect(memory.recipients.filter((row) => row.personId === "p-sara")).toHaveLength(1)
  })

  it("papel Report revogado: a execução é bloqueada e nada é entregue", async () => {
    const people = [{ ...reporter(), distribution: null }, person("sara", "Sara", { own: SARA })]
    const { memory, run } = await setup({ people, owner: "rh", audience: { mode: "DISTRIBUTION", everyone: true, levels: [], jobTitles: [], teamIds: [], subteamIds: [], personIds: [] } })
    expect((await run()).result).toMatchObject({ status: "BLOCKED", outcome: { reason: "DISTRIBUTION_REVOKED" } })
    expect(memory.deliveries).toHaveLength(0)
  })

  it("destinatário que perdeu o vínculo (conta/pessoa inativa) sai na hora da execução", async () => {
    const people = [reporter(), person("sara", "Sara", { own: SARA }), person("saulo", "Saulo", { own: SAULO, active: false })]
    const { memory, run } = await setup({ people, owner: "rh", audience: { mode: "DISTRIBUTION", everyone: false, levels: ["SUPERVISOR"], jobTitles: [], teamIds: [], subteamIds: [], personIds: [] } })
    await run()
    expect(memory.recipients.map((row) => row.personId)).toEqual(["p-sara"])
  })
})

describe("sem duplicidade e falhas", () => {
  it("reprocessar a MESMA execução (retry) não duplica entrega nem destinatário", async () => {
    const { memory, fake, report } = await setup({ people: [person("sara", "Sara", { own: SARA })], owner: "sara" })
    const queued = (await memory.store.enqueueRun({ organizationId: ORG, reportId: report.id, scheduledFor: "2026-10-16T11:00:00.000Z", triggerKind: "SCHEDULE", configVersion: 1 }))!
    expect(await memory.store.enqueueRun({ organizationId: ORG, reportId: report.id, scheduledFor: "2026-10-16T11:00:00.000Z", triggerKind: "SCHEDULE", configVersion: 1 })).toBeNull()
    const deps = { store: memory.store, runtime: fake.runtime, now: () => new Date("2026-10-16T12:00:00Z") }
    await executeReportRun(deps, queued)
    await executeReportRun(deps, queued)
    expect(memory.deliveries).toHaveLength(1)
    expect(memory.recipients).toHaveLength(1)
  })

  it("falha técnica volta para a fila e, depois das tentativas, fica FAILED (sem entrega)", async () => {
    const { memory, fake, report } = await setup({ people: [person("sara", "Sara", { own: SARA })], owner: "sara" })
    const broken = { ...fake.runtime, contextFor: async () => { throw new Error("banco indisponível") } }
    const deps = { store: memory.store, runtime: broken, now: () => new Date("2026-10-16T12:00:00Z") }
    const queued = (await memory.store.enqueueRun({ organizationId: ORG, reportId: report.id, scheduledFor: "2026-10-16T11:00:00.000Z", triggerKind: "SCHEDULE", configVersion: 1 }))!
    expect(await processRun(deps, { ...queued, attempts: 1 })).toBe("QUEUED")
    expect(await processRun(deps, { ...queued, attempts: 3 })).toBe("FAILED")
    expect(memory.runs.get(queued.id)!.errorCode).toBe("REPORT_RUN_TECHNICAL_FAILURE")
    expect(memory.deliveries).toHaveLength(0)
  })

  it("consulta inválida (ex.: indicador removido) é falha da execução, nunca uma entrega com zeros", async () => {
    const memory = createMemoryReportStore()
    const fake = createFakeRuntime({ people: [person("sara", "Sara", { own: SARA })], card: () => null })
    const report = await memory.store.createReport({ organizationId: ORG, ownerAccountId: "acc-sara", ownerPersonId: "p-sara", name: "x", description: null, status: "ACTIVE", origin: "SCREEN", timeZone: "America/Sao_Paulo", nextRunAt: null, sourceProposalId: null, definition: reportDefinitionSchema.parse({ tool: "INDICATOR_QUERY", structure: { mode: "RECIPIENT" }, period: { mode: "LAST_CLOSED" }, indicators: ["XYZ"] }), visualization: { type: "TABLE" }, schedule: reportScheduleSchema.parse({ frequency: "DAILY", times: ["08:00"] }), audience: { mode: "SELF" }, analysis: reportAnalysisSchema.parse({}) }, "acc-sara")
    const queued = (await memory.store.enqueueRun({ organizationId: ORG, reportId: report.id, scheduledFor: "2026-10-16T11:00:00.000Z", triggerKind: "SCHEDULE", configVersion: 1 }))!
    const result = await executeReportRun({ store: memory.store, runtime: fake.runtime, now: () => new Date() }, queued)
    expect(result.status).toBe("FAILED")
    expect(memory.deliveries).toHaveLength(0)
  })

  it("falha da IA preserva a entrega com análise indisponível; nova tentativa completa a MESMA entrega", async () => {
    const { memory, report, run } = await setup({ people: [person("sara", "Sara", { own: SARA })], owner: "sara" })
    await run()
    const delivery = memory.deliveries[0]!
    await analyzeDelivery(memory.store, async () => { throw new Error("429") }, delivery, report)
    expect(memory.deliveries[0]).toMatchObject({ kind: "DELIVERY", analysisStatus: "FAILED", analysisAttempts: 1 })
    await analyzeDelivery(memory.store, async (input) => (input.user.includes("melhora") ? "**Resumo** TMA melhorou." : ""), memory.deliveries[0]!, report)
    expect(memory.deliveries).toHaveLength(1)
    expect(memory.deliveries[0]).toMatchObject({ analysisStatus: "READY", analysisText: "**Resumo** TMA melhorou." })
  })
})
