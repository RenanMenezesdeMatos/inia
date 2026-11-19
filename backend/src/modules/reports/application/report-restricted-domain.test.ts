import { describe, expect, it } from "vitest"
import type { DomainAccess } from "../../leadership-analytics/application/data-domains.js"
import type { QueryTableCard } from "../../leadership-analytics/domain/view-models.js"
import { reportAnalysisSchema, reportDefinitionSchema, reportScheduleSchema, reportVisualizationSchema } from "../domain/report-definition.js"
import { createFakeRuntime, createMemoryReportStore, testStructure, type FakePerson } from "../testing/memory-report-store.js"
import { executeReportRun, scopeKeyOf } from "./report-executor.js"

/**
 * DC-02 — reports de "Uso da INIA" e "Apoio com Anjo": a permissão da tela de origem entra no agrupamento dos destinatários. Quem
 * não tem a permissão fica como acesso negado; quem tem um recorte menor nunca recebe a entrega calculada para quem tem mais.
 */
const ORG = "00000000-0000-4000-8000-0000000000aa"
const FIXED = "00000000-0000-4000-8000-000000000777"
const TEAM_A = "00000000-0000-4000-8000-00000000a001"
const TEAM_B = "00000000-0000-4000-8000-00000000b001"
const ALL = { organizationWide: true, teamIds: [], subteamIds: [] }
const NONE = { organizationWide: false, teamIds: [], subteamIds: [] }

function sharedStructure() {
  const structure = testStructure(FIXED, "Gerência do Marcos", ["op1", "op2"])
  const members = structure.resolved.members as unknown as { id: string; teamId: string | null; subteamId: string | null }[]
  members[0]!.teamId = TEAM_A
  members[1]!.teamId = TEAM_B
  for (const member of members) member.subteamId = null
  return structure
}

const card = (label: string): QueryTableCard => ({
  type: "QUERY_TABLE", generatedAt: "", structure: { subject: { kind: "SUPERVISOR_TEAM", supervisorId: FIXED } as never, label, description: null }, source: "OFFICIAL", title: "Uso da INIA", scopeNote: "", period: null, indicatorCode: null,
  columns: [{ key: "group", label: "Pessoa", numeric: false }, { key: "records", label: "Perguntas", numeric: true }],
  rows: [{ cells: { group: "op1", records: "12" }, subject: null, personId: null }], totalRows: 1, highlights: [], methods: [], limitations: [],
})

async function runFor(tool: "INIA_USAGE" | "SUPPORT" | "INTERACTIONS", access: Record<string, DomainAccess | undefined>) {
  const shared = sharedStructure()
  const person = (id: string, name: string, extra: Partial<FakePerson> = {}): FakePerson => ({ accountId: `acc-${id}`, personId: `p-${id}`, name, role: "SUPERVISOR", active: true, own: null, reachable: { [FIXED]: shared }, level: "SUPERVISOR", ...(access[id] ? { domainAccess: access[id] } : {}), ...extra })
  const people = [person("rh", "Rita (Report)", { role: "OPERATOR", level: "OPERATOR", distribution: ALL }), person("ana", "Ana"), person("bia", "Bia"), person("caio", "Caio")]
  const memory = createMemoryReportStore()
  const fake = createFakeRuntime({ people, card: (label) => card(label), sources: () => [{ source: "PLATFORM_RECORDS", label: "Registros da plataforma", watermark: "records:1", lastUpdatedAt: null, stale: false, detail: null }], coverage: () => null })
  const report = await memory.store.createReport(
    {
      organizationId: ORG, ownerAccountId: "acc-rh", ownerPersonId: "p-rh", name: "Uso da INIA", description: null, status: "ACTIVE", origin: "SCREEN", timeZone: "America/Sao_Paulo", nextRunAt: null, sourceProposalId: null,
      definition: reportDefinitionSchema.parse({ tool, structure: { mode: "FIXED", subjectKind: "SUPERVISOR_TEAM", subjectId: FIXED, label: "Gerência do Marcos" }, period: { mode: "LAST_CLOSED" }, queryArgs: {} }),
      visualization: reportVisualizationSchema.parse({ type: "TABLE" }), schedule: reportScheduleSchema.parse({ frequency: "DAILY", times: ["07:00"] }),
      audience: { mode: "DISTRIBUTION", everyone: false, levels: ["SUPERVISOR"], jobTitles: [], teamIds: [], subteamIds: [], personIds: [] }, analysis: reportAnalysisSchema.parse({ enabled: false, comparison: false }),
    },
    "acc-rh",
  )
  const queued = (await memory.store.enqueueRun({ organizationId: ORG, reportId: report.id, scheduledFor: "2026-10-16T11:00:00Z", triggerKind: "SCHEDULE", configVersion: 1 }))!
  const result = await executeReportRun({ store: memory.store, runtime: fake.runtime, now: () => new Date("2026-10-16T11:00:00Z") }, queued)
  const byDelivery = new Map<string, string[]>()
  for (const row of memory.recipients) byDelivery.set(row.deliveryId, [...(byDelivery.get(row.deliveryId) ?? []), row.personId])
  return { result, fake, groups: [...byDelivery.values()].map((ids) => ids.sort()).sort() }
}

describe("DC-02 — report de domínio restrito × permissão da tela de origem", () => {
  it("mesma estrutura, permissão diferente: quem não tem fica como acesso negado e nunca na entrega de quem tem", async () => {
    const { result, fake, groups } = await runFor("INIA_USAGE", { rh: { INIA_USAGE: ALL }, ana: { INIA_USAGE: ALL }, bia: { INIA_USAGE: NONE }, caio: undefined })
    expect(groups).toEqual([["p-ana"]])
    expect(result.outcome.denied).toEqual([{ personId: "p-bia", name: "Bia", reason: "ACCESS_DENIED" }, { personId: "p-caio", name: "Caio", reason: "ACCESS_DENIED" }])
    expect(fake.calls.map((call) => call.account)).toEqual(["acc-ana"])
  })

  it("recorte menor (só um Grupo) tem entrega própria, calculada com a própria conta", async () => {
    const { result, fake, groups } = await runFor("SUPPORT", { rh: { SUPPORT: ALL }, ana: { SUPPORT: ALL }, bia: { SUPPORT: { organizationWide: false, teamIds: [TEAM_A], subteamIds: [] } }, caio: { SUPPORT: ALL } })
    expect(groups).toEqual([["p-ana", "p-caio"], ["p-bia"]])
    expect(result.outcome.deniedCount).toBe(0)
    expect(fake.calls.map((call) => call.account).sort()).toEqual(["acc-ana", "acc-bia"])
  })

  it("ferramenta sem permissão própria não muda: todos na mesma entrega", async () => {
    const { groups } = await runFor("INTERACTIONS", {})
    expect(groups).toEqual([["p-ana", "p-bia", "p-caio"]])
  })

  it("chave de escopo: permissão que cobre a estrutura inteira mantém a chave de sempre (histórico das entregas)", () => {
    const structure = sharedStructure()
    expect(scopeKeyOf(structure, [], ["op1", "op2"])).toBe(scopeKeyOf(structure))
    expect(scopeKeyOf(structure, [], ["op1"])).not.toBe(scopeKeyOf(structure))
    expect(scopeKeyOf(structure, [], [])).not.toBe(scopeKeyOf(structure, [], ["op1"]))
  })
})
