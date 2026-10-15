import { describe, expect, it } from "vitest"
import type { AuthTokenPayload } from "../../auth/infrastructure/jwt.js"
import { fixtureOrg, IDS } from "../../performance-analytics/testing/fixture-org.js"
import { InMemoryAnalyticsRepository, type InMemoryOrg, ORG, person } from "../../performance-analytics/testing/in-memory-analytics-repository.js"
import type { PersonNode } from "../../performance-analytics/application/analytics-read-repository.js"
import type { EmploymentStatusFreshness } from "../../people/application/employment-status-freshness.js"
import { inMemoryHierarchyReader, type InMemoryPerson } from "../../workflows/testing/in-memory-hierarchy-reader.js"
import type { OrganizationalHierarchyReader } from "../../workflows/application/organizational-recipient.js"
import { computeManagementMetrics, type StructureMemberRow } from "../domain/management-metrics.js"
import type { ManagementMetricsRoot } from "./load-management-metrics.js"
import { buildPersonOrganizationStructure, describeStructureSource, sortDirectReports, type PersonOrganizationStructureDeps } from "./person-organization-structure.js"

/**
 * A MESMA organização de teste da área de analytics (fixture-org.ts) alimenta os dois leitores —
 * escopo (repositório de analytics) e cadeia (leitor de hierarquia do Workflow Engine) — como em
 * produção os dois leem a mesma tabela `people`. Extras desta suíte:
 *   - Eva (inativa) reporta à Vanessa → nunca conta como integrante nem aparece como subordinada;
 *   - Supervisor Inativo (inativo) lidera Fábio → gestor direto INACTIVE, cadeia segue do Gerente B;
 *   - ciclo Gil ⇄ Hugo acima de Ivo → a cadeia termina, nunca trava;
 *   - auto-referência (dado corrompido) como viewer → escopo termina.
 */
const EXTRA = {
  evaInactive: "10000000-0000-4000-8000-000000000021",
  inactiveSupervisor: "10000000-0000-4000-8000-000000000022",
  fabio: "10000000-0000-4000-8000-000000000023",
  gil: "10000000-0000-4000-8000-000000000031",
  hugo: "10000000-0000-4000-8000-000000000032",
  ivo: "10000000-0000-4000-8000-000000000033",
  admin: "10000000-0000-4000-8000-0000000000aa",
} as const

function people(): PersonNode[] {
  return [
    ...fixtureOrg().people,
    person({ id: EXTRA.evaInactive, name: "Eva Inativa", role: "OPERATOR", reportsToId: IDS.vanessa, teamId: IDS.teamA, teamName: "ATENDIMENTO", active: false }),
    person({ id: EXTRA.inactiveSupervisor, name: "Supervisor Inativo", role: "SUPERVISOR", reportsToId: IDS.managerB, teamId: IDS.teamB, teamName: "FATURAS", active: false }),
    person({ id: EXTRA.fabio, name: "Fábio Operador", role: "OPERATOR", reportsToId: EXTRA.inactiveSupervisor, teamId: IDS.teamB, teamName: "FATURAS", jobTitle: "Operador de Faturas" }),
    person({ id: EXTRA.gil, name: "Gil Gerente", role: "MANAGER", reportsToId: EXTRA.hugo }),
    person({ id: EXTRA.hugo, name: "Hugo Gerente", role: "MANAGER", reportsToId: EXTRA.gil }),
    person({ id: EXTRA.ivo, name: "Ivo Operador", role: "OPERATOR", reportsToId: EXTRA.gil }),
    person({ id: EXTRA.admin, name: "Admin", role: "ADMIN" }),
  ]
}

const NO_FEED: EmploymentStatusFreshness = { state: "UNKNOWN", configured: false, feeds: [], consideredFeedIds: [], lastSuccessAt: null, lastDataAt: null, lastSuccessLocalDate: null }

function counting(reader: OrganizationalHierarchyReader, calls: string[]): OrganizationalHierarchyReader {
  return {
    loadPerson: (id) => (calls.push("loadPerson"), reader.loadPerson(id)),
    loadAncestors: (id) => (calls.push("loadAncestors"), reader.loadAncestors(id)),
    loadDescendants: (id) => (calls.push("loadDescendants"), reader.loadDescendants(id)),
    loadGroupOperators: (group) => (calls.push("loadGroupOperators"), reader.loadGroupOperators(group)),
    countActiveOperators: (id, depth) => (calls.push("countActiveOperators"), reader.countActiveOperators(id, depth)),
  }
}

/** Situação funcional atual por pessoa (o que os períodos diriam hoje); quem não está aqui está EM_PRODUCAO presumido. */
/** Fotos escolhidas no perfil (`person_profile_images`) — quem não está aqui fica com a imagem do cadastro, como na apresentação real. */
const PROFILE_AVATARS: Record<string, string> = { [IDS.op1]: "/api/v1/profile-images/foto-ana", [IDS.vanessa]: "/api/v1/profile-images/foto-vanessa" }

const STATUS: Record<string, string> = { [IDS.op2]: "FERIAS", [IDS.op3]: "INSS", [IDS.op4]: "MATERNIDADE", [EXTRA.fabio]: "VACATION" /* legado → FERIAS */, [EXTRA.gil]: "PILOTO" }
const TODAY = "2026-09-17"

function setup(freshness: EmploymentStatusFreshness = NO_FEED, nodes: PersonNode[] = people(), statusFreshness: { state: "FRESH" | "STALE" | "UNKNOWN"; lastSuccessLocalDate: string | null } = { state: "FRESH", lastSuccessLocalDate: TODAY }, access: InMemoryOrg["access"] = {}) {
  const analytics = new InMemoryAnalyticsRepository({ people: nodes, access })
  const hierarchyCalls: string[] = []
  const emailCalls: string[][] = []
  const avatarCalls: string[][] = []
  /** Cada chamada do carregador de métricas = UM lote de raízes (número de chamadas = número de consultas em lote). */
  const metricsCalls: string[][] = []
  const below = (personId: string): PersonNode[] => {
    const result: PersonNode[] = []
    const queue = nodes.filter((node) => node.reportsToId === personId)
    const seen = new Set<string>()
    while (queue.length > 0) {
      const node = queue.shift()!
      if (seen.has(node.id)) continue
      seen.add(node.id)
      result.push(node)
      queue.push(...nodes.filter((entry) => entry.reportsToId === node.id))
    }
    return result
  }
  const hierarchy = counting(inMemoryHierarchyReader(nodes.map<InMemoryPerson>((node) => ({ id: node.id, name: node.name, role: node.role, reportsToId: node.reportsToId, jobTitle: node.jobTitle, avatarUrl: node.avatarUrl, teamId: node.teamId, subteamId: node.subteamId, active: node.active }))), hierarchyCalls)
  // O mesmo que o carregador Postgres faz, em memória: população ativa abaixo de cada raiz com a
  // situação vigente (legado traduzido), referência do Grupo por (cargo, Grupo) e a função pura do domínio.
  const canonical = (node: PersonNode) => ({ VACATION: "FERIAS" }[STATUS[node.id] ?? ""] ?? STATUS[node.id] ?? "EM_PRODUCAO") as StructureMemberRow["status"]
  const deps: PersonOrganizationStructureDeps = {
    analytics,
    hierarchy,
    corporateEmails: async (ids) => (emailCalls.push(ids), new Map(ids.map((id) => [id, `${nodes.find((node) => node.id === id)?.name.split(" ")[0]?.toLowerCase() ?? id}@inia.com`]))),
    personAvatars: async (_organizationId, ids) => (avatarCalls.push(ids), new Map(ids.map((id) => [id, PROFILE_AVATARS[id] ?? nodes.find((node) => node.id === id)?.avatarUrl ?? null]))),
    structureFreshness: async () => freshness,
    managementMetrics: async (_organizationId, roots: ManagementMetricsRoot[]) => {
      metricsCalls.push(roots.map((root) => root.id))
      return new Map(
        roots.map((root) => {
          const members = below(root.id).filter((node) => node.active).map<StructureMemberRow>((node) => ({ id: node.id, role: node.role, reportsToId: node.reportsToId, status: canonical(node), confirmed: STATUS[node.id] !== undefined }))
          const peers = root.teamId ? nodes.filter((node) => node.active && node.role === root.role && node.teamId === root.teamId) : []
          const spanOf = (id: string) => nodes.filter((node) => node.active && node.reportsToId === id).length
          const groupBenchmark = root.teamId && peers.length > 0 ? { groupId: root.teamId, groupName: peers[0]!.teamName ?? "", peerRole: root.role, peerCount: peers.length, averageDirectSpan: Math.round((peers.reduce((sum, peer) => sum + spanOf(peer.id), 0) / peers.length) * 10) / 10 } : null
          return [root.id, computeManagementMetrics({ root: { id: root.id, role: root.role }, members, statusFreshness, today: TODAY, groupBenchmark })]
        }),
      )
    },
    now: () => new Date(`${TODAY}T12:00:00.000Z`),
  }
  return { deps, analytics, hierarchyCalls, emailCalls, avatarCalls, metricsCalls }
}

function user(personId: string, role: AuthTokenPayload["role"]): AuthTokenPayload {
  return { sub: "acc", personId, organizationId: ORG, role, name: "x", email: "x@inia.com", avatarUrl: null, jobTitle: null, teamId: null, teamName: null }
}

describe("Estrutura — cadeia de liderança real", () => {
  it("colaborador com cadeia completa: gestor imediato → topo, na ordem real e com rótulo por nível", async () => {
    const { deps } = setup()
    const result = await buildPersonOrganizationStructure(deps, user(IDS.op1, "OPERATOR"), IDS.op1)
    expect(result.subject).toMatchObject({ personId: IDS.op1, name: "Ana Operadora", role: "OPERATOR", roleLabel: "Operador", isViewer: true, email: "ana@inia.com" })
    expect(result.managementChain.map((entry) => [entry.level, entry.name, entry.roleLabel])).toEqual([
      [1, "Vanessa Supervisora", "Supervisor"],
      [2, "Patrícia Coordenadora", "Coordenador"],
      [3, "Roberto Gerente", "Gerente"],
      [4, "Fernanda Sênior", "Gerente Sênior"],
      [5, "Paulo Diretor", "Diretor"],
    ])
    expect(result.organizationalContext.directManagerStatus).toBe("PRESENT")
  })

  it("foto: a escolhida no perfil vence a imagem do cadastro em todo nó (focal, cadeia e subordinados), lida num lote só", async () => {
    const { deps, avatarCalls } = setup(NO_FEED, people().map((node) => (node.id === IDS.op2 ? { ...node, avatarUrl: "https://cdn.cliente/bia.jpg" } : node)))
    const asOperator = await buildPersonOrganizationStructure(deps, user(IDS.op1, "OPERATOR"), IDS.op1)
    expect(asOperator.subject.avatarUrl).toBe("/api/v1/profile-images/foto-ana")
    expect(asOperator.managementChain[0]).toMatchObject({ personId: IDS.vanessa, avatarUrl: "/api/v1/profile-images/foto-vanessa" })
    expect(asOperator.managementChain[1]!.avatarUrl).toBeNull()
    const asSupervisor = await buildPersonOrganizationStructure(deps, user(IDS.vanessa, "SUPERVISOR"), IDS.vanessa)
    const reports = new Map(asSupervisor.directReports.map((report) => [report.personId, report.avatarUrl]))
    expect(reports.get(IDS.op1)).toBe("/api/v1/profile-images/foto-ana")
    expect(reports.get(IDS.op2)).toBe("https://cdn.cliente/bia.jpg")
    expect(avatarCalls).toHaveLength(2)
  })

  it("cadeia parcial (sem Coordenador): renderiza exatamente os níveis existentes — nenhum nível fictício", async () => {
    const { deps } = setup()
    const result = await buildPersonOrganizationStructure(deps, user(IDS.op3, "OPERATOR"), IDS.op3)
    expect(result.managementChain.map((entry) => entry.roleLabel)).toEqual(["Supervisor", "Gerente", "Gerente Sênior", "Diretor"])
  })

  it("sem gestor: cadeia vazia, contexto imediato nulo e estado legítimo 'não informado'", async () => {
    const { deps } = setup()
    const result = await buildPersonOrganizationStructure(deps, user(IDS.director, "DIRECTOR"), IDS.director)
    expect(result.managementChain).toEqual([])
    expect(result.organizationalContext).toMatchObject({ team: null, directManagerStatus: "NOT_INFORMED", group: null, subgroup: null })
  })

  it("gestor direto inativo: a cadeia começa no próximo nível ativo e o estado diz INACTIVE (nunca 'não informado')", async () => {
    const { deps } = setup()
    const result = await buildPersonOrganizationStructure(deps, user(EXTRA.fabio, "OPERATOR"), EXTRA.fabio)
    expect(result.organizationalContext.directManagerStatus).toBe("INACTIVE")
    expect(result.managementChain[0]).toMatchObject({ name: "Roberta Gerente", roleLabel: "Gerente", level: 1 })
  })

  it("ciclo em reports_to acima (Gil ⇄ Hugo): a cadeia termina e a resposta sai — nunca loop infinito", async () => {
    const { deps } = setup()
    const result = await buildPersonOrganizationStructure(deps, user(EXTRA.ivo, "OPERATOR"), EXTRA.ivo)
    expect(result.managementChain.map((entry) => entry.name)).toEqual(["Gil Gerente", "Hugo Gerente"])
  })

  it("viewer dentro de um ciclo (Gil ⇄ Hugo): loadDescendants termina, Hugo aparece uma vez como subordinado, e a cadeia acima também termina", async () => {
    // Um ciclo só é alcançável de cima quando o próprio ponto de partida está nele (cada pessoa tem
    // um único `reports_to_id`): é exatamente o caso que fazia `union all` girar para sempre.
    const { deps } = setup()
    const result = await buildPersonOrganizationStructure(deps, user(EXTRA.gil, "MANAGER"), EXTRA.gil)
    expect(result.directReports.map((report) => report.name)).toEqual(["Hugo Gerente", "Ivo Operador"])
    expect(result.managementChain.map((entry) => entry.name)).toEqual(["Hugo Gerente"])
    // Hugo é navegável (está na "subárvore"); o viewer nunca é listado abaixo de si mesmo.
    const hugo = await buildPersonOrganizationStructure(deps, user(EXTRA.gil, "MANAGER"), EXTRA.hugo)
    expect(hugo.directReports).toEqual([])
  })

  it("auto-referência (viewer reporta a si mesmo, dado corrompido): escopo e cadeia terminam, sem gestor e sem subordinados", async () => {
    const self = "10000000-0000-4000-8000-000000000047"
    const nodes = [...people(), person({ id: self, name: "Auto Referente", role: "SUPERVISOR", reportsToId: self })]
    const { deps } = setup(NO_FEED, nodes)
    const result = await buildPersonOrganizationStructure(deps, user(self, "SUPERVISOR"), self)
    expect(result.managementChain).toEqual([])
    expect(result.directReports).toEqual([])
    expect(result.organizationalContext.directManagerStatus).toBe("INACTIVE")
  })
})

describe("Estrutura — Grupo, Subgrupo e contexto imediato (contagem com significado real)", () => {
  it("Grupo + Subgrupo quando existem; Equipe de Supervisor conta operadores ativos DIRETOS com rótulo 'Operadores da equipe'", async () => {
    const { deps, hierarchyCalls } = setup()
    const result = await buildPersonOrganizationStructure(deps, user(IDS.op1, "OPERATOR"), IDS.op1)
    expect(result.organizationalContext.group).toEqual({ id: IDS.teamA, name: "ATENDIMENTO" })
    expect(result.organizationalContext.subgroup).toEqual({ id: IDS.subteamA1, name: "Chat" })
    // Ana + Bia; Eva é inativa e fica de fora — mesma regra de população do Workflow Engine.
    expect(result.organizationalContext.team).toMatchObject({ label: "Equipe de Vanessa Supervisora", memberCount: 2, memberCountKind: "DIRECT_OPERATORS", memberCountLabel: "Operadores da equipe", leader: { personId: IDS.vanessa, roleLabel: "Supervisor" } })
    // Contagem, nunca a subárvore carregada só pra contar.
    expect(hierarchyCalls).toContain("countActiveOperators")
    expect(hierarchyCalls).not.toContain("loadDescendants")
  })

  it("sem Subgrupo → null; estrutura de Coordenador conta operadores em qualquer profundidade com rótulo 'Operadores na estrutura'", async () => {
    const { deps } = setup()
    const result = await buildPersonOrganizationStructure(deps, user(IDS.vanessa, "SUPERVISOR"), IDS.vanessa)
    expect(result.organizationalContext.subgroup).toBeNull()
    expect(result.organizationalContext.team).toMatchObject({ label: "Estrutura de Patrícia Coordenadora", memberCount: 2, memberCountKind: "OPERATORS_BELOW", memberCountLabel: "Operadores na estrutura" })
  })
})

describe("Estrutura — navegação progressiva: sujeitos gestores, subordinados diretos e trilha", () => {
  it("Supervisor como pessoa focal (aberto pelo Coordenador): subordinados diretos ativos, gestores primeiro, sem inativos", async () => {
    const { deps } = setup()
    const result = await buildPersonOrganizationStructure(deps, user(IDS.coordinator, "COORDINATOR"), IDS.vanessa)
    expect(result.subject).toMatchObject({ personId: IDS.vanessa, roleLabel: "Supervisor", isViewer: false })
    expect(result.directReports.map((report) => report.name)).toEqual(["Ana Operadora", "Bia Operadora"])
    expect(result.breadcrumb.map((entry) => [entry.name, entry.isViewer])).toEqual([
      ["Patrícia Coordenadora", true],
      ["Vanessa Supervisora", false],
    ])
  })

  it("Coordenador e Gerente como pessoa focal (drill-down do Gerente): trilha real Gerente › Coordenadora", async () => {
    const { deps } = setup()
    const coordinator = await buildPersonOrganizationStructure(deps, user(IDS.managerA, "MANAGER"), IDS.coordinator)
    expect(coordinator.directReports.map((report) => report.name)).toEqual(["Vanessa Supervisora"])
    expect(coordinator.breadcrumb.map((entry) => entry.name)).toEqual(["Roberto Gerente", "Patrícia Coordenadora"])
    const manager = await buildPersonOrganizationStructure(deps, user(IDS.managerA, "MANAGER"), IDS.managerA)
    expect(manager.directReports.map((report) => report.name)).toEqual(["Patrícia Coordenadora"])
    expect(manager.breadcrumb).toEqual([{ personId: IDS.managerA, name: "Roberto Gerente", roleLabel: "Gerente", isViewer: true }])
  })

  it("sortDirectReports: cargos na ordem real da cadeia, operadores depois, nome dentro de cada grupo", () => {
    const sorted = sortDirectReports([
      { role: "OPERATOR", name: "Zara" },
      { role: "SUPERVISOR", name: "Bia" },
      { role: "OPERATOR", name: "Ana" },
      { role: "COORDINATOR", name: "Caio" },
    ])
    expect(sorted.map((entry) => entry.name)).toEqual(["Caio", "Bia", "Ana", "Zara"])
  })

  it("folha: operador sem subordinados tem directReports vazio, hasReports=false e directReportCount=0", async () => {
    const { deps } = setup()
    const result = await buildPersonOrganizationStructure(deps, user(IDS.vanessa, "SUPERVISOR"), IDS.op1)
    expect(result.directReports).toEqual([])
    expect(result.subject.capabilities).toEqual({ canViewProfile: true, canViewStructure: true, hasReports: false })
    expect(result.subject.directReportCount).toBe(0)
  })

  it("directReportCount e capital operacional: conhecidos na subárvore (contagem de ativos de qualquer cargo); acima do viewer, null/ausente", async () => {
    const nodes = people()
    nodes.find((node) => node.id === IDS.op1)!.operationalCapitalCode = "FORTALEZA"
    const { deps } = setup(NO_FEED, nodes)
    const result = await buildPersonOrganizationStructure(deps, user(IDS.managerA, "MANAGER"), IDS.op1)
    expect(result.subject.operationalCapital).toMatchObject({ code: "FORTALEZA", stateCode: "CE", label: "Fortaleza / CE" })
    const byId = new Map(result.managementChain.map((entry) => [entry.personId, entry]))
    // Vanessa lidera Ana e Bia (Eva é inativa); a Coordenadora lidera só a Vanessa; acima do Gerente, desconhecido.
    expect(byId.get(IDS.vanessa)?.directReportCount).toBe(2)
    expect(byId.get(IDS.coordinator)?.directReportCount).toBe(1)
    expect(byId.get(IDS.senior)?.directReportCount).toBeNull()
    expect(byId.get(IDS.senior)).not.toHaveProperty("operationalCapital")
    expect(byId.get(IDS.vanessa)?.operationalCapital).toBeNull()
  })

  it("pessoa fora da hierarquia (nível legado ADMIN, sem papel): navega o organograma aberto como todo mundo; trilha começa no topo (não é ancestral de ninguém)", async () => {
    const { deps } = setup()
    const result = await buildPersonOrganizationStructure(deps, user(EXTRA.admin, "ADMIN"), IDS.vanessa)
    expect(result.breadcrumb.map((entry) => entry.name)).toEqual(["Paulo Diretor", "Fernanda Sênior", "Roberto Gerente", "Patrícia Coordenadora", "Vanessa Supervisora"])
    expect(result.directReports.map((report) => report.name)).toEqual(["Ana Operadora", "Bia Operadora"])
    await expect(buildPersonOrganizationStructure(deps, user(EXTRA.admin, "ADMIN"), EXTRA.evaInactive)).rejects.toMatchObject({ code: "STRUCTURE_ACCESS_DENIED" })
  })
})

describe("Estrutura — capabilities por pessoa (backend decide; ancestrais navegáveis, ficha só na subárvore)", () => {
  it("Operador olhando para cima: os ancestrais reais aparecem na cadeia com hasReports e canViewStructure=true (subir é permitido), canViewProfile=false", async () => {
    const { deps } = setup()
    const result = await buildPersonOrganizationStructure(deps, user(IDS.op1, "OPERATOR"), IDS.op1)
    for (const entry of result.managementChain) expect(entry.capabilities).toEqual({ canViewProfile: false, canViewStructure: true, hasReports: true })
    expect(result.subject.capabilities).toEqual({ canViewProfile: false, canViewStructure: true, hasReports: false })
  })

  it("Gerente olhando a estrutura: Supervisor subordinado tem canViewStructure=true e canViewProfile=false (capabilities independentes); acima do Gerente, os ancestrais dele também são navegáveis", async () => {
    const { deps } = setup()
    const result = await buildPersonOrganizationStructure(deps, user(IDS.managerA, "MANAGER"), IDS.coordinator)
    const vanessa = result.directReports.find((report) => report.personId === IDS.vanessa)!
    expect(vanessa.capabilities).toEqual({ canViewProfile: false, canViewStructure: true, hasReports: true })
    const byId = new Map(result.managementChain.map((entry) => [entry.personId, entry]))
    expect(byId.get(IDS.managerA)?.capabilities.canViewStructure).toBe(true)
    expect(byId.get(IDS.senior)?.capabilities.canViewStructure).toBe(true)
    expect(byId.get(IDS.director)?.capabilities.canViewStructure).toBe(true)
  })

  it("Supervisor: operadores da equipe têm canViewProfile=true, canViewStructure=true e hasReports=false (folha → sem botão)", async () => {
    const { deps } = setup()
    const result = await buildPersonOrganizationStructure(deps, user(IDS.vanessa, "SUPERVISOR"), IDS.vanessa)
    expect(result.directReports.map((report) => [report.name, report.capabilities])).toEqual([
      ["Ana Operadora", { canViewProfile: true, canViewStructure: true, hasReports: false }],
      ["Bia Operadora", { canViewProfile: true, canViewStructure: true, hasReports: false }],
    ])
  })
})

describe("Estrutura — permissão (backend é a autoridade)", () => {
  it("todo papel vê a própria estrutura", async () => {
    const { deps } = setup()
    for (const [id, role] of [[IDS.op2, "OPERATOR"], [IDS.bruno, "SUPERVISOR"], [IDS.director, "DIRECTOR"], [EXTRA.admin, "ADMIN"]] as const) {
      const result = await buildPersonOrganizationStructure(deps, user(id, role), id)
      expect(result.subject.isViewer).toBe(true)
    }
  })

  it("qualquer pessoa ATIVA da organização é focável (outra gerência inclusive); inexistente ou inativa → STRUCTURE_ACCESS_DENIED, indistinguíveis", async () => {
    const { deps } = setup()
    const other = await buildPersonOrganizationStructure(deps, user(IDS.vanessa, "SUPERVISOR"), IDS.bruno)
    expect(other.subject).toMatchObject({ personId: IDS.bruno, isViewer: false, group: { name: "FATURAS" }, capabilities: { canViewProfile: false, canViewStructure: true, hasReports: true } })
    expect(other.directReports.map((report) => [report.name, report.capabilities])).toEqual([
      ["Caio Operador", { canViewProfile: false, canViewStructure: true, hasReports: false }],
      ["Dora Sem Dados", { canViewProfile: false, canViewStructure: true, hasReports: false }],
    ])
    // Trilha fora da própria cadeia: a ancestralidade real do sujeito, do topo até ele.
    expect(other.breadcrumb.map((entry) => entry.name)).toEqual(["Paulo Diretor", "Fernanda Sênior", "Roberta Gerente", "Bruno Supervisor"])
    expect((await buildPersonOrganizationStructure(deps, user(IDS.managerA, "MANAGER"), IDS.managerB)).subject.personId).toBe(IDS.managerB)
    expect((await buildPersonOrganizationStructure(deps, user(IDS.op1, "OPERATOR"), IDS.op4)).subject.personId).toBe(IDS.op4)
    await expect(buildPersonOrganizationStructure(deps, user(IDS.vanessa, "SUPERVISOR"), "10000000-0000-4000-8000-0000000000ff")).rejects.toMatchObject({ code: "STRUCTURE_ACCESS_DENIED", statusCode: 403 })
    await expect(buildPersonOrganizationStructure(deps, user(IDS.managerB, "MANAGER"), EXTRA.inactiveSupervisor)).rejects.toMatchObject({ code: "STRUCTURE_ACCESS_DENIED" })
    await expect(buildPersonOrganizationStructure(deps, user(IDS.op1, "OPERATOR"), EXTRA.evaInactive)).rejects.toMatchObject({ code: "STRUCTURE_ACCESS_DENIED" })
  })

  it("cada resposta continua enxuta: só cadeia ACIMA, subordinados DIRETOS e contagens — nunca netos nem a árvore inteira", async () => {
    const { deps } = setup()
    const own = JSON.stringify(await buildPersonOrganizationStructure(deps, user(IDS.op1, "OPERATOR"), IDS.op1))
    for (const name of ["Bia Operadora", "Bruno Supervisor", "Roberta Gerente", "Eva Inativa"]) expect(own).not.toContain(name)
    const manager = JSON.stringify(await buildPersonOrganizationStructure(deps, user(IDS.managerA, "MANAGER"), IDS.managerA))
    for (const name of ["Vanessa Supervisora", "Ana Operadora", "Roberta Gerente"]) expect(manager).not.toContain(name)
  })
})

describe("Estrutura — navegação ascendente (política 2026-09-17: ancestrais reais são focáveis)", () => {
  it("Operador → o próprio Supervisor ancestral: permitido; a focal é a Supervisora, o gestor dela vem na cadeia e os colegas aparecem como subordinados diretos SEM ficha nem estrutura", async () => {
    const { deps, analytics } = setup()
    const result = await buildPersonOrganizationStructure(deps, user(IDS.op1, "OPERATOR"), IDS.vanessa)
    expect(result.subject).toMatchObject({ personId: IDS.vanessa, isViewer: false, directReportCount: 2, group: { name: "ATENDIMENTO" }, capabilities: { canViewProfile: false, canViewStructure: true, hasReports: true } })
    expect(result.managementChain[0]).toMatchObject({ personId: IDS.coordinator, capabilities: { canViewStructure: true } })
    expect(result.directReports.map((report) => [report.name, report.capabilities, report.directReportCount])).toEqual([
      ["Ana Operadora", { canViewProfile: false, canViewStructure: true, hasReports: false }, 0], // a própria viewer
      ["Bia Operadora", { canViewProfile: false, canViewStructure: true, hasReports: false }, 0], // colega: dados profissionais, nunca a ficha
    ])
    expect(JSON.stringify(result)).not.toContain("Eva Inativa")
    expect(result.breadcrumb.map((entry) => entry.name)).toEqual(["Ana Operadora", "Vanessa Supervisora"])
    // Leituras pontuais, nunca a subárvore da Supervisora.
    // (+ as duas leituras de acesso da conta: indicators.view — ficha — e structure.metrics.view — dados de gestão.)
    expect(analytics.calls).toEqual(["loadPerson", "loadAccessVisibility", "loadAccessVisibility", "loadDescendants", "loadPeopleInVisibility", "loadPerson", "loadDirectReports", "countActiveDirectReports"])
  })

  it("Operador → Supervisor de OUTRA gerência: permitido (organograma aberto), sem ficha de ninguém e sem métricas gerenciais; a trilha é a ancestralidade real", async () => {
    const { deps, metricsCalls } = setup()
    const result = await buildPersonOrganizationStructure(deps, user(IDS.op1, "OPERATOR"), IDS.bruno)
    expect(result.subject.personId).toBe(IDS.bruno)
    expect(result.subject.managementMetrics).toBeNull()
    expect(metricsCalls).toEqual([])
    expect(result.directReports.every((report) => !report.capabilities.canViewProfile)).toBe(true)
    expect(result.breadcrumb.map((entry) => entry.name)).toEqual(["Paulo Diretor", "Fernanda Sênior", "Roberta Gerente", "Bruno Supervisor"])
  })

  it("Supervisor → Coordenadora ancestral: permitido, vê os outros Supervisores da Coordenação (hasReports real, sem Abrir estrutura) e a trilha sobe 'Minha estrutura › Coordenadora'", async () => {
    const nodes = [...people(), person({ id: "10000000-0000-4000-8000-000000000041", name: "Zélia Supervisora", role: "SUPERVISOR", reportsToId: IDS.coordinator, teamId: IDS.teamA, teamName: "ATENDIMENTO" }), person({ id: "10000000-0000-4000-8000-000000000042", name: "Yan Operador", role: "OPERATOR", reportsToId: "10000000-0000-4000-8000-000000000041", teamId: IDS.teamA, teamName: "ATENDIMENTO" })]
    const { deps } = setup(NO_FEED, nodes)
    const result = await buildPersonOrganizationStructure(deps, user(IDS.vanessa, "SUPERVISOR"), IDS.coordinator)
    expect(result.breadcrumb.map((entry) => [entry.name, entry.isViewer])).toEqual([["Vanessa Supervisora", true], ["Patrícia Coordenadora", false]])
    expect(result.directReports.map((report) => [report.name, report.directReportCount, report.capabilities])).toEqual([
      ["Vanessa Supervisora", 2, { canViewProfile: false, canViewStructure: true, hasReports: true }],
      ["Zélia Supervisora", 1, { canViewProfile: false, canViewStructure: true, hasReports: true }],
    ])
    expect(JSON.stringify(result)).not.toContain("Yan Operador")
    // A estrutura da colega Zélia também é navegável — mas a ficha do operador dela, não.
    const zelia = await buildPersonOrganizationStructure(deps, user(IDS.vanessa, "SUPERVISOR"), "10000000-0000-4000-8000-000000000041")
    expect(zelia.directReports.map((report) => [report.name, report.capabilities.canViewProfile])).toEqual([["Yan Operador", false]])
  })

  it("subir mais de um nível: Coordenadora → Gerente ancestral → Gerente Sênior → Diretor, com a trilha acumulando os níveis; Coordenador de OUTRA árvore: 403", async () => {
    const { deps } = setup()
    const manager = await buildPersonOrganizationStructure(deps, user(IDS.coordinator, "COORDINATOR"), IDS.managerA)
    expect(manager.breadcrumb.map((entry) => entry.name)).toEqual(["Patrícia Coordenadora", "Roberto Gerente"])
    expect(manager.directReports.map((report) => report.name)).toEqual(["Patrícia Coordenadora"])
    const senior = await buildPersonOrganizationStructure(deps, user(IDS.coordinator, "COORDINATOR"), IDS.senior)
    expect(senior.breadcrumb.map((entry) => entry.name)).toEqual(["Patrícia Coordenadora", "Roberto Gerente", "Fernanda Sênior"])
    expect(senior.directReports.map((report) => [report.name, report.capabilities.canViewStructure])).toEqual([["Roberta Gerente", true], ["Roberto Gerente", true]])
    const director = await buildPersonOrganizationStructure(deps, user(IDS.coordinator, "COORDINATOR"), IDS.director)
    expect(director.managementChain).toEqual([])
    expect(director.organizationalContext.directManagerStatus).toBe("NOT_INFORMED")
    expect((await buildPersonOrganizationStructure(deps, user(IDS.coordinator, "COORDINATOR"), IDS.managerB)).subject.personId).toBe(IDS.managerB)
  })

  it("pessoa abaixo autorizada continua permitida (isolamento entre organizações é provado contra o banco em structure-scope-proof.test.ts)", async () => {
    const { deps } = setup()
    const below = await buildPersonOrganizationStructure(deps, user(IDS.coordinator, "COORDINATOR"), IDS.vanessa)
    expect(below.breadcrumb.map((entry) => entry.name)).toEqual(["Patrícia Coordenadora", "Vanessa Supervisora"])
  })

  it("pessoa fora da hierarquia: qualquer pessoa ativa da organização é focável; o nível legado ADMIN não pula nenhuma leitura (V1.5.8: sem caminho especial)", async () => {
    const { deps, hierarchyCalls } = setup()
    const result = await buildPersonOrganizationStructure(deps, user(EXTRA.admin, "ADMIN"), IDS.director)
    expect(result.subject.personId).toBe(IDS.director)
    // Ancestrais do viewer (nenhum — não tem gestor) + do sujeito: a mesma regra de qualquer pessoa.
    expect(hierarchyCalls.filter((call) => call === "loadAncestors")).toHaveLength(2)
  })

  it("gestor inativo entre o viewer e o topo nunca é focável (loadAncestors só devolve ativos)", async () => {
    const { deps } = setup()
    await expect(buildPersonOrganizationStructure(deps, user(EXTRA.fabio, "OPERATOR"), EXTRA.inactiveSupervisor)).rejects.toMatchObject({ code: "STRUCTURE_ACCESS_DENIED" })
    const managerB = await buildPersonOrganizationStructure(deps, user(EXTRA.fabio, "OPERATOR"), IDS.managerB)
    expect(managerB.subject.personId).toBe(IDS.managerB)
  })
})

describe("Estrutura — métricas gerenciais (cargos de gestão ou structure.metrics.view no escopo)", () => {
  it("Supervisora na própria estrutura: população ativa abaixo por situação (Bia de férias; Eva inativa não conta), span = 2 diretos, abrangência = 2 operadores; legado VACATION vira FERIAS na estrutura do Gerente B", async () => {
    const { deps, metricsCalls } = setup()
    const own = await buildPersonOrganizationStructure(deps, user(IDS.vanessa, "SUPERVISOR"), IDS.vanessa)
    const metrics = own.subject.managementMetrics!
    expect(metrics.structuralPopulation).toBe(2)
    expect(metrics.directSpan).toBe(2)
    expect(metrics.operatorReach).toBe(2)
    // Estrutura pequena (< 5): INSS/maternidade/paternidade só somados.
    expect(metrics.privacy.sensitiveBreakdownSuppressed).toBe(true)
    expect(metrics.statusDistribution).toEqual([
      { bucket: "EM_PRODUCAO", count: 1, percent: 50 },
      { bucket: "FERIAS", count: 1, percent: 50 },
      { bucket: "SENSITIVE_LEAVE", count: 0, percent: 0 },
    ])
    expect(metrics.groupBenchmark).toEqual({ groupId: IDS.teamA, groupName: "ATENDIMENTO", peerRole: "SUPERVISOR", peerCount: 1, averageDirectSpan: 2 })
    // Operadores (folhas) não recebem métricas: null, e nem entram no lote.
    expect(own.directReports.map((report) => report.managementMetrics)).toEqual([null, null])
    expect(metricsCalls).toEqual([[IDS.vanessa]])

    const managerB = await buildPersonOrganizationStructure(deps, user(IDS.managerB, "MANAGER"), IDS.managerB)
    // Bruno (produção) + Caio (INSS) + Dora (maternidade) + Fábio (VACATION legado → férias); Supervisor Inativo não conta.
    expect(managerB.subject.managementMetrics).toMatchObject({ structuralPopulation: 4, directSpan: 1, operatorReach: 3, roleCounts: [{ role: "SUPERVISOR", count: 1 }, { role: "OPERATOR", count: 3 }] })
    expect(managerB.subject.managementMetrics?.statusDistribution).toEqual([
      { bucket: "EM_PRODUCAO", count: 1, percent: 25 },
      { bucket: "FERIAS", count: 1, percent: 25 },
      { bucket: "SENSITIVE_LEAVE", count: 2, percent: 50 },
    ])
    // Bruno (subordinado direto que lidera) recebe as próprias métricas no MESMO lote.
    expect(managerB.directReports.find((report) => report.personId === IDS.bruno)?.managementMetrics).toMatchObject({ structuralPopulation: 2, directSpan: 2 })
    expect(metricsCalls.at(-1)).toEqual([IDS.managerB, IDS.bruno])
  })

  it("todos os cargos de gestão e a conta com structure.metrics.view na organização recebem as métricas da estrutura FOCAL (não só da própria), inclusive de outra árvore; outras situações somam em OTHER", async () => {
    const { deps } = setup(NO_FEED, people(), undefined, { acc: { "structure.metrics.view": { organizationWide: true } } })
    for (const [id, role] of [[IDS.coordinator, "COORDINATOR"], [IDS.managerA, "MANAGER"], [IDS.senior, "SENIOR_MANAGER"], [IDS.director, "DIRECTOR"], [EXTRA.admin, "ADMIN"], [IDS.bruno, "SUPERVISOR"]] as const) {
      const result = await buildPersonOrganizationStructure(deps, user(id, role), IDS.vanessa)
      expect(result.subject.managementMetrics).toMatchObject({ structuralPopulation: 2, directSpan: 2 })
      // …mas a ficha continua independente: ninguém fora da subárvore abre a ficha das operadoras.
      if (id === IDS.bruno) expect(result.directReports.every((report) => !report.capabilities.canViewProfile)).toBe(true)
    }
    // Gil (PILOTO) está numa árvore à parte (ciclo Gil ⇄ Hugo): aparece em OTHER na estrutura do Hugo.
    const hugo = await buildPersonOrganizationStructure(deps, user(EXTRA.admin, "ADMIN"), EXTRA.hugo)
    expect(hugo.subject.managementMetrics?.statusDistribution.find((share) => share.bucket === "OTHER")?.count).toBe(1)
    const top = await buildPersonOrganizationStructure(deps, user(IDS.director, "DIRECTOR"), IDS.director)
    const director = top.subject.managementMetrics!
    expect(director.structuralPopulation).toBeGreaterThan(8)
    expect(director.layerMetrics).toEqual([
      { managerRole: "SENIOR_MANAGER", reportRole: "MANAGER", managers: 1, reports: 2, average: 2 },
      { managerRole: "MANAGER", reportRole: "COORDINATOR", managers: 2, reports: 1, average: 0.5 },
      { managerRole: "MANAGER", reportRole: "SUPERVISOR", managers: 2, reports: 1, average: 0.5 },
      { managerRole: "COORDINATOR", reportRole: "SUPERVISOR", managers: 1, reports: 1, average: 1 },
      { managerRole: "SUPERVISOR", reportRole: "OPERATOR", managers: 2, reports: 4, average: 2 },
    ])
  })

  it("V1.5.8: nível legado ADMIN SEM papel não recebe métricas de ninguém (nem a consulta é feita)", async () => {
    const { deps, metricsCalls } = setup()
    const result = await buildPersonOrganizationStructure(deps, user(EXTRA.admin, "ADMIN"), IDS.vanessa)
    expect(result.subject.managementMetrics).toBeNull()
    expect(metricsCalls).toEqual([])
  })

  it("V1.5.8: structure.metrics.view com escopo GROUP B — métricas dos líderes do Grupo B, nunca dos do Grupo A", async () => {
    const { deps, metricsCalls } = setup(NO_FEED, people(), undefined, { acc: { "structure.metrics.view": { teamIds: [IDS.teamB] } } })
    const vanessa = await buildPersonOrganizationStructure(deps, user(EXTRA.admin, "ADMIN"), IDS.vanessa)
    expect(vanessa.subject.managementMetrics).toBeNull()
    expect(metricsCalls).toEqual([])
    const managerB = await buildPersonOrganizationStructure(deps, user(EXTRA.admin, "ADMIN"), IDS.managerB)
    expect(managerB.subject.managementMetrics).toMatchObject({ structuralPopulation: 4 })
    expect(managerB.directReports.find((report) => report.personId === IDS.bruno)?.managementMetrics).toMatchObject({ structuralPopulation: 2 })
  })

  it("V1.5.8: Supervisor sem papel continua recebendo as métricas (regra operacional de quem lidera pessoas)", async () => {
    const { deps } = setup()
    expect((await buildPersonOrganizationStructure(deps, user(IDS.bruno, "SUPERVISOR"), IDS.vanessa)).subject.managementMetrics).toMatchObject({ structuralPopulation: 2 })
  })

  it("fonte de situação atrasada: presumidos viram NÃO CONFIRMADO no payload (nunca 'Em produção')", async () => {
    const { deps } = setup(NO_FEED, people(), { state: "STALE", lastSuccessLocalDate: "2026-09-10" })
    const result = await buildPersonOrganizationStructure(deps, user(IDS.vanessa, "SUPERVISOR"), IDS.vanessa)
    expect(result.subject.managementMetrics?.statusDistribution).toEqual([
      { bucket: "EM_PRODUCAO", count: 0, percent: 0 },
      { bucket: "FERIAS", count: 1, percent: 50 },
      { bucket: "SENSITIVE_LEAVE", count: 0, percent: 0 },
      { bucket: "UNCONFIRMED", count: 1, percent: 50 },
    ])
    expect(result.subject.managementMetrics?.confidence).toEqual({ statusFreshness: "STALE", unconfirmed: 1 })
  })

  it("Operador nunca recebe métricas — nem da própria estrutura, nem de um gestor, nem de outra árvore: `managementMetrics` é null em todo node e a consulta não é feita", async () => {
    const { deps, metricsCalls } = setup()
    for (const focal of [IDS.op1, IDS.vanessa, IDS.director, IDS.managerB]) {
      const result = await buildPersonOrganizationStructure(deps, user(IDS.op1, "OPERATOR"), focal)
      expect(result.subject.managementMetrics).toBeNull()
      expect(result.directReports.every((report) => report.managementMetrics === null)).toBe(true)
      expect(JSON.stringify(result)).not.toContain("statusDistribution")
    }
    expect(metricsCalls).toEqual([])
  })

  it("UM lote por request, sempre: focal + subordinados diretos que lideram, nunca uma chamada por node (Diretor com 1 Sênior; Sênior com 2 Gerentes)", async () => {
    const { deps, metricsCalls } = setup()
    await buildPersonOrganizationStructure(deps, user(IDS.director, "DIRECTOR"), IDS.director)
    await buildPersonOrganizationStructure(deps, user(IDS.director, "DIRECTOR"), IDS.senior)
    expect(metricsCalls).toEqual([
      [IDS.director, IDS.senior],
      [IDS.senior, IDS.managerB, IDS.managerA],
    ])
  })
})

describe("Estrutura — caminho organizacional do viewer (metadata do 'caminho até você')", () => {
  it("Operadora: cadeia real topo → viewer por reports_to_id, igual em qualquer focal (própria, ancestral ou outra árvore) — sem nível inventado", async () => {
    const { deps } = setup()
    const expected = ["Paulo Diretor", "Fernanda Sênior", "Roberto Gerente", "Patrícia Coordenadora", "Vanessa Supervisora", "Ana Operadora"]
    for (const focal of [IDS.op1, IDS.director, IDS.bruno]) {
      const result = await buildPersonOrganizationStructure(deps, user(IDS.op1, "OPERATOR"), focal)
      expect(result.viewerOrganizationPath.map((entry) => entry.name)).toEqual(expected)
      expect(result.viewerOrganizationPath.at(-1)).toEqual({ personId: IDS.op1, name: "Ana Operadora", roleLabel: "Operador" })
    }
    // Cadeia com nível pulado (Caio: Supervisor → Gerente, sem Coordenador): só os níveis reais.
    expect((await buildPersonOrganizationStructure(deps, user(IDS.op3, "OPERATOR"), IDS.op3)).viewerOrganizationPath.map((entry) => entry.roleLabel)).toEqual(["Diretor", "Gerente Sênior", "Gerente", "Supervisor", "Operador"])
    // Gestor inativo no meio (Fábio → Supervisor Inativo → Gerente B): o inativo não faz parte do caminho.
    expect((await buildPersonOrganizationStructure(deps, user(EXTRA.fabio, "OPERATOR"), EXTRA.fabio)).viewerOrganizationPath.map((entry) => entry.name)).toEqual(["Paulo Diretor", "Fernanda Sênior", "Roberta Gerente", "Fábio Operador"])
    // Topo e quem está fora da hierarquia: só a própria pessoa.
    expect((await buildPersonOrganizationStructure(deps, user(IDS.director, "DIRECTOR"), IDS.director)).viewerOrganizationPath.map((entry) => entry.name)).toEqual(["Paulo Diretor"])
    expect((await buildPersonOrganizationStructure(deps, user(EXTRA.admin, "ADMIN"), IDS.vanessa)).viewerOrganizationPath.map((entry) => entry.name)).toEqual(["Admin"])
  })
})

describe("Estrutura — consultas e origem", () => {
  it("número FIXO de leituras por request, independente da cadeia e dos subordinados (nenhum N+1; e-mails em UM lote)", async () => {
    for (const [id, role] of [[IDS.op1, "OPERATOR"], [IDS.managerA, "MANAGER"], [IDS.director, "DIRECTOR"]] as const) {
      const { deps, analytics, hierarchyCalls, emailCalls } = setup()
      const result = await buildPersonOrganizationStructure(deps, user(id, role), id)
      expect(analytics.calls).toEqual(["loadPerson", "loadAccessVisibility", "loadAccessVisibility", "loadDescendants", "loadPeopleInVisibility"])
      expect(hierarchyCalls.filter((call) => call === "loadAncestors")).toHaveLength(1)
      expect(hierarchyCalls.filter((call) => call === "countActiveOperators").length).toBeLessThanOrEqual(1)
      expect(hierarchyCalls).not.toContain("loadDescendants")
      expect(emailCalls).toHaveLength(1)
      expect(emailCalls[0]).toEqual(expect.arrayContaining([id, ...result.directReports.map((report) => report.personId)]))
    }
  })

  it("origem só quando há feed ORGANIZATIONAL_STRUCTURE configurado (fonte, feed, última carga); senão null", async () => {
    expect(describeStructureSource(NO_FEED)).toBeNull()
    const feed = { feedId: "f1", feedName: "Hierarquia RH", sourceId: "s1", sourceName: "SAP RH", sourceKind: "API_PULL", contractKey: "ORGANIZATIONAL_STRUCTURE", sourceNamespace: "sap", authoritative: true, status: "ACTIVE", cadenceLabel: "Diária", expectedIntervalMinutes: 1440, lastSuccessAt: "2026-09-15T03:00:00.000Z", lastDataAt: "2026-09-15T03:00:00.000Z", freshness: "FRESH" as const }
    const configured: EmploymentStatusFreshness = { state: "FRESH", configured: true, feeds: [feed], consideredFeedIds: ["f1"], lastSuccessAt: feed.lastSuccessAt, lastDataAt: feed.lastDataAt, lastSuccessLocalDate: "2026-09-15" }
    expect(describeStructureSource(configured)).toEqual({ sourceName: "SAP RH", feedName: "Hierarquia RH", lastUpdatedAt: "2026-09-15T03:00:00.000Z", freshness: "FRESH" })
    const { deps } = setup(configured)
    const result = await buildPersonOrganizationStructure(deps, user(IDS.op1, "OPERATOR"), IDS.op1)
    expect(result.sourceMetadata?.sourceName).toBe("SAP RH")
  })
})
