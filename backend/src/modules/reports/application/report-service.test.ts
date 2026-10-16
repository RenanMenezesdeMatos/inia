import { describe, expect, it } from "vitest"
import { DomainError } from "../../../shared/domain/domain-error.js"
import type { ProposalStore } from "./report-proposals.js"
import { createReport, deleteReport, getReportDetail, listReports, previewReport, setReportStatus, updateReport, type ReportServiceDeps } from "./report-service.js"
import { createFakeRuntime, createMemoryReportStore, testStructure, type FakePerson } from "../testing/memory-report-store.js"

const ORG = "00000000-0000-4000-8000-0000000000aa"
const SARA = testStructure("00000000-0000-4000-8000-000000000003", "Equipe da Sara", ["op1"])
const OUTRA = "00000000-0000-4000-8000-000000000099"
const TEAM = "00000000-0000-4000-8000-0000000000a1"
const PERSON_IN_SCOPE = "00000000-0000-4000-8000-0000000000c1"

const people: FakePerson[] = [
  { accountId: "acc-sara", personId: "p-sara", name: "Sara", role: "SUPERVISOR", active: true, own: SARA, reachable: { "00000000-0000-4000-8000-000000000003": SARA } },
  { accountId: "acc-rita", personId: "p-rita", name: "Rita (Report)", role: "OPERATOR", active: true, own: null, reachable: {}, distribution: { organizationWide: false, teamIds: [TEAM], subteamIds: [] } },
  { accountId: "acc-op", personId: PERSON_IN_SCOPE, name: "Caio", role: "OPERATOR", active: true, own: null, reachable: {} },
]
const noProposals = { get: async () => null, decide: async () => undefined } as unknown as ProposalStore

function deps(): ReportServiceDeps & { memory: ReturnType<typeof createMemoryReportStore> } {
  const memory = createMemoryReportStore()
  const fake = createFakeRuntime({ people, card: (label) => ({ type: "QUERY_TABLE", generatedAt: "", structure: { subject: { kind: "SUPERVISOR_TEAM", supervisorId: "x" }, label, description: null }, source: "OFFICIAL", title: "TMA", scopeNote: "", period: "2026-09", indicatorCode: "TMA", columns: [{ key: "person", label: "Pessoa", numeric: false }, { key: "achievement", label: "Atingimento", numeric: true }], rows: [{ cells: { person: "Ana", achievement: "90%" }, subject: null, personId: null }], totalRows: 1, highlights: [], methods: [], limitations: [] }) })
  return { store: memory.store, runtime: fake.runtime, proposals: noProposals, analysisWriter: async () => "", now: () => new Date("2026-10-16T12:00:00Z"), memory }
}
const actor = (id: "sara" | "rita" | "op") => ({ organizationId: ORG, accountId: `acc-${id}`, personId: id === "op" ? PERSON_IN_SCOPE : `p-${id}` })
const config = (overrides: Record<string, unknown> = {}) => ({ name: "TOP TMA", description: "Quem está pior em TMA", definition: { tool: "INDICATOR_QUERY", structure: { mode: "RECIPIENT" }, period: { mode: "LAST_CLOSED" }, indicators: ["TMA"], groupBy: "PESSOA", limit: 3 }, visualization: { type: "BAR" }, schedule: { frequency: "DAILY", times: ["08:00"] }, audience: { mode: "SELF" }, analysis: { enabled: true, comparison: true }, ...overrides })
const code = async (promise: Promise<unknown>) => promise.then(() => "OK", (error: unknown) => (error instanceof DomainError ? error.code : String(error)))

describe("permissões dos reports (backend)", () => {
  it("líder cria para si; ativar calcula o próximo horário no fuso; quem não lidera nem distribui não usa reports", async () => {
    const d = deps()
    const created = await createReport(d, actor("sara"), { config: config(), activate: true })
    expect(created).toMatchObject({ status: "ACTIVE", nextRunAt: "2026-10-17T11:00:00.000Z", timeZone: "America/Sao_Paulo" })
    expect(await code(listReports(d, actor("op")))).toBe("REPORTS_ACCESS_REQUIRED")
  })

  it("líder comum NÃO escolhe outros destinatários (nem por instrução): distribuição é do papel Report", async () => {
    expect(await code(createReport(deps(), actor("sara"), { config: config({ audience: { mode: "DISTRIBUTION", everyone: true } }), activate: false }))).toBe("REPORT_DISTRIBUTION_NOT_ALLOWED")
  })

  it("papel Report: público só dentro do escopo da atribuição; sem estrutura própria não cria 'para si'", async () => {
    const d = deps()
    expect(await code(createReport(d, actor("rita"), { config: config({ audience: { mode: "DISTRIBUTION", teamIds: [TEAM] } }), activate: false }))).toBe("OK")
    expect(await code(createReport(d, actor("rita"), { config: config({ audience: { mode: "DISTRIBUTION", teamIds: ["00000000-0000-4000-8000-0000000000a9"] } }), activate: false }))).toBe("AUDIENCE_OUT_OF_SCOPE")
    expect(await code(createReport(d, actor("rita"), { config: config({ audience: { mode: "DISTRIBUTION", personIds: ["00000000-0000-4000-8000-0000000000ff"] } }), activate: false }))).toBe("AUDIENCE_OUT_OF_SCOPE")
    expect(await code(createReport(d, actor("rita"), { config: config(), activate: false }))).toBe("REPORT_SELF_NOT_ALLOWED")
  })

  it("estrutura fixa fora do escopo, indicador inexistente e visualização incompatível são recusados", async () => {
    const d = deps()
    expect(await code(createReport(d, actor("sara"), { config: config({ definition: { ...config().definition, structure: { mode: "FIXED", subjectKind: "SUPERVISOR_TEAM", subjectId: OUTRA, label: "Outra" } } }), activate: false }))).toBe("STRUCTURE_OUT_OF_SCOPE")
    expect(await code(createReport(d, actor("sara"), { config: config({ definition: { ...config().definition, indicators: ["XYZ"] } }), activate: false }))).toBe("REPORT_INDICATOR_NOT_FOUND")
    // Ranking da competência atual não tem dimensão temporal: evolução (linha) não cabe.
    expect(await code(createReport(d, actor("sara"), { config: config({ visualization: { type: "LINE" } }), activate: false }))).toBe("VISUALIZATION_INCOMPATIBLE")
    expect(await code(createReport(d, actor("sara"), { config: config({ visualization: { type: "LINE" }, definition: { ...config().definition, period: { mode: "LAST_N_CLOSED", months: 3, display: "POR_MES" } } }), activate: false }))).toBe("OK")
  })

  it("só o dono vê e gerencia (outro usuário = não encontrado); desativar cancela a agenda; editar recalcula e versiona; excluir é lógico", async () => {
    const d = deps()
    const created = await createReport(d, actor("sara"), { config: config(), activate: true })
    expect(await code(getReportDetail(d, actor("rita"), created.id))).toBe("REPORT_NOT_FOUND")
    const off = await setReportStatus(d, actor("sara"), created.id, { revision: created.revision, status: "INACTIVE" })
    expect(off).toMatchObject({ status: "INACTIVE", nextRunAt: null })
    const on = await setReportStatus(d, actor("sara"), created.id, { revision: off.revision, status: "ACTIVE" })
    const edited = await updateReport(d, actor("sara"), created.id, { revision: on.revision, config: config({ schedule: { frequency: "WEEKLY", times: ["07:30"], weekdays: ["MON"] } }) })
    expect(edited).toMatchObject({ nextRunAt: "2026-10-19T10:30:00.000Z", configVersion: 2 })
    expect(await code(updateReport(d, actor("sara"), created.id, { revision: on.revision, config: config() }))).toBe("REPORT_REVISION_CONFLICT")
    await deleteReport(d, actor("sara"), created.id)
    expect(d.memory.reports.get(created.id)).toMatchObject({ status: "INACTIVE", nextRunAt: null })
    expect(d.memory.reports.get(created.id)!.deletedAt).not.toBeNull()
    expect((await listReports(d, actor("sara"))).items).toHaveLength(0)
  })

  it("prévia mostra a consulta na visão de quem configura, marcada como prévia, sem gravar entrega", async () => {
    const d = deps()
    const preview = await previewReport(d, actor("sara"), { definition: config().definition })
    expect(preview).toMatchObject({ preview: true, structure: "Equipe da Sara", compatible: ["TABLE", "BAR"] })
    expect(d.memory.deliveries).toHaveLength(0)
    expect(await code(previewReport(d, actor("rita"), { definition: config().definition }))).toBe("REPORT_PREVIEW_UNAVAILABLE")
  })
})
