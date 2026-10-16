import { describe, expect, it } from "vitest"
import { orchestratorForTeam, type InteractiveOrchestratorScope } from "../../assistant/application/resolve-orchestrator.js"
import { loadViewerScope } from "../../performance-analytics/application/viewer-scope.js"
import { InMemoryAnalyticsRepository } from "../../performance-analytics/testing/in-memory-analytics-repository.js"
import { L, leaderUser, leadershipOrg } from "../testing/leadership-fixture.js"
import { buildProcessConsultationToolset, PROCESS_TOOL, processScopeOf, structureGroupsOf, type ProcessConsultation, type ProcessScope } from "./process-consultation.js"
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
    expect(consulted).toEqual([{ orchestrator: ORCH_FAT, groupNames: ["B2C · Faturamento"], question: "Como orientar a equipe na contestação de fatura?" }])
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

  it("nenhum Orquestrador do chat para os Grupos (nem 'Todos os grupos'): a ferramenta não é oferecida; pergunta vazia é recusada", async () => {
    expect(toolsetFor([ATENDIMENTO], [ORCH_FAT]).toolset).toBeNull()
    expect(toolsetFor([], []).toolset).toBeNull()
    const { toolset } = toolsetFor([], [ORCH_ALL])
    expect((await toolset!.execute(PROCESS_TOOL, { pergunta: "  " })).issue?.kind).toBe("INVALID")
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
