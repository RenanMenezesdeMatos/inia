import { describe, expect, it } from "vitest"
import { orchestratorForTeam, type InteractiveOrchestratorScope } from "../../assistant/application/resolve-orchestrator.js"
import { loadViewerScope } from "../../performance-analytics/application/viewer-scope.js"
import { InMemoryAnalyticsRepository } from "../../performance-analytics/testing/in-memory-analytics-repository.js"
import { L, leaderUser, leadershipOrg, operatorsOf } from "../testing/leadership-fixture.js"
import { buildProcessConsultationToolset, parseProcessClarificationScope, PROCESS_CLARIFICATION_NOTE, PROCESS_TOOL, processOrchestratorUniverses, processScopeOf, reachableProcessOrchestrators, structureGroupsOf, type ProcessConsultation, type ProcessScope } from "./process-consultation.js"
import type { PersonUniverseRule } from "../../operating-universe/application/universe-access.js"
import { resolveStructureReference } from "./references.js"

/**
 * CONSULTA DE PROCESSO POR GRUPO: quem lidera equipes de Grupos diferentes consulta processos no Orquestrador do Grupo da dúvida —
 * nunca no do Grupo do próprio cadastro, nunca num palpite quando os Grupos têm bases diferentes.
 */
const FATURAMENTO = { teamId: "team-fat", name: "B2C · Faturamento" }
const ATENDIMENTO = { teamId: "team-atd", name: "B2C · Atendimento Geral" }
const ORCH_FAT: InteractiveOrchestratorScope = { id: "orch-fat", name: "INIA Faturamento", scopeType: "TEAM", teamId: "team-fat" }
const ORCH_ALL: InteractiveOrchestratorScope = { id: "orch-all", name: "INIA Geral", scopeType: "ALL_TEAMS", teamId: null }

function toolsetFor(groups: ProcessScope["groups"], orchestrators: InteractiveOrchestratorScope[], groupsOfStructure: ProcessScope["groupsOfStructure"] = () => ({ kind: "NOT_FOUND", message: "Não encontrei." })) {
  const consulted: ProcessConsultation[] = []
  const toolset = buildProcessConsultationToolset({
    scope: { groups, groupsOfStructure },
    orchestrators,
    consult: async (consultation) => {
      consulted.push(consultation)
      return { text: `Procedimento segundo ${consultation.orchestrator.name}.`, trace: { specialists: ["agent_kb"] } }
    },
  })
  return { toolset, consulted }
}

describe("orquestrador de um Grupo — a mesma regra do chat de quem atende", () => {
  it("o do próprio Grupo antes do de 'Todos os grupos'; sem Grupo (ou sem o dele) = 'Todos os grupos'; nenhum = null", () => {
    const scopes = [ORCH_FAT, ORCH_ALL]
    expect(orchestratorForTeam(scopes, "team-fat")?.id).toBe("orch-fat")
    expect(orchestratorForTeam(scopes, "team-atd")?.id).toBe("orch-all")
    expect(orchestratorForTeam(scopes, null)?.id).toBe("orch-all")
    expect(orchestratorForTeam([ORCH_FAT], "team-atd")).toBeNull()
  })
})

describe("consulta de processo por Grupo", () => {
  it("um Grupo só: implícito — vai ao Orquestrador dele e devolve a resposta marcada como conhecimento do Grupo, com o registro", async () => {
    const { toolset, consulted } = toolsetFor([FATURAMENTO], [ORCH_FAT, ORCH_ALL])
    expect(toolset!.declarations[0]!.parameters!.properties).not.toHaveProperty("grupo")
    const result = await toolset!.execute(PROCESS_TOOL, { pergunta: "Como orientar a equipe na contestação de fatura?" })
    // Os Grupos consultados vão junto: os alinhamentos e comunicados da resposta são os dos públicos deles (LEADER_STRUCTURE_CONTEXT_V1).
    expect(consulted).toEqual([{ orchestrator: ORCH_FAT, groupNames: ["B2C · Faturamento"], teamIds: ["team-fat"], question: "Como orientar a equipe na contestação de fatura?" }])
    expect(result.text).toContain('Orquestrador "INIA Faturamento" (Grupo B2C · Faturamento)')
    expect(result.text).toContain("Procedimento segundo INIA Faturamento.")
    expect(result.trace).toEqual({ groups: ["B2C · Faturamento"], orchestratorId: "orch-fat", orchestratorName: "INIA Faturamento", specialists: ["agent_kb"] })
  })

  it("vários Grupos no MESMO Orquestrador (todos em 'Todos os grupos'): implícito, sem perguntar", async () => {
    const { toolset, consulted } = toolsetFor([ATENDIMENTO, FATURAMENTO], [ORCH_ALL])
    expect(toolset!.declarations[0]!.description).toContain("Todos os Grupos da estrutura usam a mesma base (INIA Geral): não passe grupo")
    await toolset!.execute(PROCESS_TOOL, { pergunta: "Qual o procedimento de segunda via?" })
    expect(consulted[0]!.orchestrator.id).toBe("orch-all")
    expect(consulted[0]!.groupNames).toEqual(["B2C · Atendimento Geral", "B2C · Faturamento"])
  })

  it("Grupos com bases diferentes e nenhuma pista: pergunta de volta (com as opções), nunca consulta por palpite", async () => {
    const { toolset, consulted } = toolsetFor([ATENDIMENTO, FATURAMENTO], [ORCH_FAT, ORCH_ALL])
    expect(toolset!.declarations[0]!.description).toContain("Grupos com bases diferentes: B2C · Atendimento Geral → INIA Geral; B2C · Faturamento → INIA Faturamento.")
    expect(toolset!.declarations[0]!.parameters!.properties).toMatchObject({ grupo: { enum: ["B2C · Atendimento Geral", "B2C · Faturamento"] } })
    const result = await toolset!.execute(PROCESS_TOOL, { pergunta: "Como funciona a contestação?" })
    expect(consulted).toHaveLength(0)
    expect(result.issue).toMatchObject({ kind: "AMBIGUOUS", candidates: ["B2C · Atendimento Geral", "B2C · Faturamento"] })
    expect(result.text).toContain("Pergunte ao usuário qual")
  })

  it("Grupo citado (nome parcial) → o Orquestrador DELE; Grupo fora da estrutura → não encontrado, com os Grupos válidos", async () => {
    const { toolset, consulted } = toolsetFor([ATENDIMENTO, FATURAMENTO], [ORCH_FAT, ORCH_ALL])
    await toolset!.execute(PROCESS_TOOL, { pergunta: "Como funciona a contestação?", grupo: "faturamento" })
    expect(consulted[0]!.orchestrator.id).toBe("orch-fat")
    const outside = await toolset!.execute(PROCESS_TOOL, { pergunta: "x", grupo: "B2B · Grandes Contas" })
    expect(outside.issue?.kind).toBe("NOT_FOUND")
    expect(outside.text).toContain("Grupos: B2C · Atendimento Geral, B2C · Faturamento")
  })

  it("equipe citada → os Grupos dela decidem o Orquestrador", async () => {
    const { toolset, consulted } = toolsetFor([ATENDIMENTO, FATURAMENTO], [ORCH_FAT, ORCH_ALL], (name) => (name === "Ana" ? { kind: "OK", teamIds: ["team-atd"] } : { kind: "NOT_FOUND", message: `Não encontrei "${name}".` }))
    await toolset!.execute(PROCESS_TOOL, { pergunta: "Como orientar a equipe em segunda via?", estrutura: "Ana" })
    expect(consulted[0]).toMatchObject({ orchestrator: { id: "orch-all" }, groupNames: ["B2C · Atendimento Geral"] })
    expect((await toolset!.execute(PROCESS_TOOL, { pergunta: "x", estrutura: "Zé" })).issue?.kind).toBe("NOT_FOUND")
  })

  it("falha na consulta ao Orquestrador do Grupo vira aviso (com o registro), nunca derruba a resposta", async () => {
    const toolset = buildProcessConsultationToolset({ scope: { groups: [FATURAMENTO], groupsOfStructure: () => ({ kind: "NOT_FOUND", message: "x" }) }, orchestrators: [ORCH_FAT], consult: async () => { throw new Error("evidência não literal") } })
    const result = await toolset!.execute(PROCESS_TOOL, { pergunta: "Como funciona a contestação?" })
    expect(result.issue?.kind).toBe("NOT_FOUND")
    expect(result.text).toContain('A consulta ao Orquestrador "INIA Faturamento" falhou agora')
    expect(result.trace).toMatchObject({ orchestratorId: "orch-fat", failed: true })
  })

  it("consulta respondida pelo esclarecimento pelas bases: o texto vai como está, com a nota de que aparece na tela (o modelo não o reescreve)", async () => {
    const toolset = buildProcessConsultationToolset({ scope: { groups: [FATURAMENTO], groupsOfStructure: () => ({ kind: "NOT_FOUND", message: "x" }) }, orchestrators: [ORCH_FAT], consult: async () => ({ text: "Qual cenário?\n\nOpções encontradas nas bases consultadas: A · B.", clarification: true, trace: { knowledgeClarification: "OPEN" } }) })
    const result = await toolset!.execute(PROCESS_TOOL, { pergunta: "Como funciona a contestação?" })
    expect(result.text).toBe(`[Consulta de processo — Orquestrador "INIA Faturamento" (Grupo B2C · Faturamento): ${PROCESS_CLARIFICATION_NOTE}]\nQual cenário?\n\nOpções encontradas nas bases consultadas: A · B.`)
    expect(result.text).not.toContain("Use como fonte do procedimento")
    expect(result.trace).toEqual({ groups: ["B2C · Faturamento"], orchestratorId: "orch-fat", orchestratorName: "INIA Faturamento", knowledgeClarification: "OPEN" })
  })

  it("nenhum Orquestrador do chat para os Grupos (nem 'Todos os grupos'): a ferramenta não é oferecida; pergunta vazia é recusada", async () => {
    expect(toolsetFor([ATENDIMENTO], [ORCH_FAT]).toolset).toBeNull()
    expect(toolsetFor([], []).toolset).toBeNull()
    const { toolset } = toolsetFor([], [ORCH_ALL])
    expect((await toolset!.execute(PROCESS_TOOL, { pergunta: "  " })).issue?.kind).toBe("INVALID")
  })
})

describe("Orquestradores ao alcance de quem lidera (continuar um esclarecimento da consulta de processo)", () => {
  it("o de cada Grupo da estrutura (ou o de 'Todos os grupos' no lugar); sem Grupos, o de 'Todos os grupos'; nenhum = vazio", () => {
    const scope = (groups: ProcessScope["groups"]): ProcessScope => ({ groups, groupsOfStructure: () => ({ kind: "NOT_FOUND", message: "x" }) })
    expect(reachableProcessOrchestrators(scope([ATENDIMENTO, FATURAMENTO]), [ORCH_FAT, ORCH_ALL]).map((item) => item.id).sort()).toEqual(["orch-all", "orch-fat"])
    expect(reachableProcessOrchestrators(scope([FATURAMENTO]), [ORCH_FAT, ORCH_ALL]).map((item) => item.id)).toEqual(["orch-fat"])
    expect(reachableProcessOrchestrators(scope([]), [ORCH_FAT, ORCH_ALL]).map((item) => item.id)).toEqual(["orch-all"])
    expect(reachableProcessOrchestrators(scope([ATENDIMENTO]), [ORCH_FAT])).toEqual([])
  })

  it("onde o esclarecimento foi feito: lido defensivamente do que foi gravado", () => {
    const scope = { kind: "LEADERSHIP_PROCESS", orchestratorId: "orch-fat", orchestratorName: "INIA Faturamento", groupNames: ["B2C · Faturamento"] }
    expect(parseProcessClarificationScope(scope)).toEqual(scope)
    expect(parseProcessClarificationScope({ ...scope, kind: "OUTRO" })).toBeNull()
    expect(parseProcessClarificationScope(null)).toBeNull()
  })
})

describe("Grupos da estrutura de quem lidera", () => {
  it("os Grupos dos operadores da estrutura própria; estrutura citada resolve contra o escopo da sessão", async () => {
    const repository = new InMemoryAnalyticsRepository(leadershipOrg())
    const scope = await loadViewerScope(repository, leaderUser(L.gabriel, "MANAGER"))
    const own = resolveStructureReference(scope, {})
    expect(own.kind).toBe("OK")
    expect(structureGroupsOf(scope, own.kind === "OK" ? own.value : null)).toEqual([{ teamId: L.team, name: "Atendimento" }])
    const processScope = processScopeOf(scope, own.kind === "OK" ? own.value : null)
    expect(processScope.groupsOfStructure("Sônia")).toEqual({ kind: "OK", teamIds: [L.team] })
    // A equipe de outra gerência não está no escopo de Gabriel: mesma resposta de inexistente.
    expect(processScope.groupsOfStructure("Hugo").kind).toBe("NOT_FOUND")
  })
})

describe("universo de atuação na consulta de processo (U4-01)", () => {
  const NO_CROSS = { organizationWide: false, teamIds: [], subteamIds: [] }
  /** Gabriel (B2B) lidera Sara, cujos operadores passam a atuar no Grupo "B2C · Cobrança" (B2C); os demais são B2B do "Atendimento". */
  async function scopeWith(rule: PersonUniverseRule | undefined) {
    const repository = new InMemoryAnalyticsRepository(leadershipOrg())
    const scope = await loadViewerScope(repository, leaderUser(L.gabriel, "MANAGER"))
    const sara = new Set(operatorsOf(1))
    for (const node of scope.nodes.values()) {
      if (node.role !== "OPERATOR") continue
      if (sara.has(node.id)) Object.assign(node, { teamId: "team-b2c", teamName: "B2C · Cobrança", operatingUniverse: "B2C" })
      else node.operatingUniverse = "B2B"
    }
    return rule ? { ...scope, universe: rule } : scope
  }

  it("liderança consulta os universos que LIDERA (própria estrutura), mesmo de outro universo do cadastro — nunca um universo que não alcança", async () => {
    // Gabriel (B2B) lidera a equipe B2C da Sara: supervisor/gerente pode liderar B2C e B2B (decisão do usuário, 16/11/2026).
    const scope = await scopeWith({ enforced: true, own: "B2B", cross: NO_CROSS, crossInStructure: false })
    expect(structureGroupsOf(scope, null).map((group) => [group.name, group.universes])).toEqual([["Atendimento", ["B2B"]], ["B2C · Cobrança", ["B2C"]]])
    expect(processScopeOf(scope, null).orchestratorUniverses).toEqual(["B2B", "B2C"])
    // B2X não é liderado nem é do cadastro: o Orquestrador B2X não é alcançável.
    const orchestrators: InteractiveOrchestratorScope[] = [{ id: "orch-b2x", name: "INIA B2X", scopeType: "ALL_TEAMS", teamId: null, operatingUniverse: "B2X" }]
    expect(reachableProcessOrchestrators(processScopeOf(scope, null), orchestrators)).toEqual([])
  })

  it("quem alcança todos os universos vê os dois Grupos, e cada Grupo cai no Orquestrador do SEU universo", async () => {
    const scope = await scopeWith({ enforced: true, own: "B2B", cross: NO_CROSS, crossInStructure: true })
    const processScope = processScopeOf(scope, null)
    expect(processScope.groups.map((group) => [group.name, group.universes])).toEqual([["Atendimento", ["B2B"]], ["B2C · Cobrança", ["B2C"]]])
    expect(processScope.orchestratorUniverses).toEqual(["B2B", "B2C", "B2X"])
    const orchestrators: InteractiveOrchestratorScope[] = [
      { id: "orch-b2c", name: "INIA B2C", scopeType: "ALL_TEAMS", teamId: null, operatingUniverse: "B2C" },
      { id: "orch-b2b", name: "INIA B2B", scopeType: "ALL_TEAMS", teamId: null, operatingUniverse: "B2B" },
    ]
    expect(reachableProcessOrchestrators(processScope, orchestrators).map((item) => item.id).sort()).toEqual(["orch-b2b", "orch-b2c"])
    const consulted: ProcessConsultation[] = []
    const toolset = buildProcessConsultationToolset({ scope: processScope, orchestrators, consult: async (consultation) => (consulted.push(consultation), { text: "ok", trace: {} }) })
    await toolset!.execute(PROCESS_TOOL, { pergunta: "Como funciona a segunda via?", grupo: "Atendimento" })
    expect(consulted[0]!.orchestrator.id).toBe("orch-b2b")
  })

  it("sem a exigência: sem filtro; liderança sem universo no cadastro: os universos que lidera", async () => {
    const off = await scopeWith(undefined)
    expect(structureGroupsOf(off, null).map((group) => group.name)).toEqual(["Atendimento", "B2C · Cobrança"])
    expect(structureGroupsOf(off, null)[0]).not.toHaveProperty("universes")
    expect(processOrchestratorUniverses(off)).toBeNull()
    expect(processOrchestratorUniverses(await scopeWith({ enforced: false, own: "B2B", cross: NO_CROSS, crossInStructure: false }))).toBeNull()
    // Liderança não precisa de universo no cadastro: alcança os universos que lidera.
    expect(processOrchestratorUniverses(await scopeWith({ enforced: true, own: null, cross: NO_CROSS, crossInStructure: false }))).toEqual(["B2B", "B2C"])
    expect(processOrchestratorUniverses(await scopeWith({ enforced: true, own: "B2C", cross: { organizationWide: false, teamIds: ["x"], subteamIds: [] }, crossInStructure: false }))).toEqual(["B2B", "B2C", "B2X"])
  })
})
