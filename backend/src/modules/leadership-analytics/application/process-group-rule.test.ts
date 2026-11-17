import { describe, expect, it } from "vitest"
import type { InteractiveOrchestratorScope } from "../../assistant/application/resolve-orchestrator.js"
import type { OrchestratedReply } from "../../assistant/application/run-orchestrated-reply.js"
import { applyProcessGroupRule } from "../../realtime/presentation/realtime-router.js"
import { buildProcessConsultationToolset, groupChoiceText, groupNamedByAsker, PROCESS_TOOL, type ProcessConsultation } from "./process-consultation.js"

/**
 * PROCESS_GROUP_RULE_V1 — gerente com 5 Grupos, cada um com o próprio procedimento de reparo. A bateria paga de 17/11 mostrou o modelo
 * escolhendo 2 Grupos sozinho e respondendo como se fosse tudo; agora o CÓDIGO decide: Grupo só vale se a pessoa disse; sem Grupo, a
 * resposta é a pergunta (com TODOS os Grupos); Grupo que passou do limite é dito na resposta.
 */
const GROUPS = ["Residencial", "Empresarial", "Fibra", "Móvel", "Ouvidoria"].map((name, index) => ({ teamId: `team-${index + 1}`, name }))
const NAMES = GROUPS.map((group) => group.name)
const OWN: InteractiveOrchestratorScope[] = GROUPS.map((group, index) => ({ id: `orch-${index + 1}`, name: `INIA ${group.name}`, scopeType: "TEAM", teamId: group.teamId }))
const SHARED: InteractiveOrchestratorScope[] = [{ id: "orch-all", name: "INIA Todos", scopeType: "ALL_TEAMS", teamId: null }]

function toolset(askerTexts: string[], orchestrators = OWN) {
  const consulted: ProcessConsultation[] = []
  const built = buildProcessConsultationToolset({
    scope: { groups: GROUPS, groupsOfStructure: () => ({ kind: "NOT_FOUND", message: "Não encontrei." }) },
    orchestrators,
    askerTexts,
    consult: async (consultation) => {
      consulted.push(consultation)
      return { text: `Procedimento de ${consultation.groupNames.join("+") || "todos"}.`, trace: {} }
    },
  })!
  return { built, consulted }
}
const reply = (text: string) => ({ text }) as OrchestratedReply

describe("regra do Grupo na consulta de processo (código, não o modelo)", () => {
  it("sem Grupo dito e bases diferentes: nada é consultado, e a resposta é a pergunta com os 5 Grupos — mesmo que o modelo tenha escrito um procedimento", async () => {
    const { built, consulted } = toolset(["Como abro um reparo?"])
    const result = await built.execute(PROCESS_TOOL, { pergunta: "Como abrir um reparo?" })
    expect(result.text).toContain("GRUPO NECESSÁRIO")
    expect(consulted).toEqual([])
    const final = applyProcessGroupRule(reply("Na Fibra, rode o teste de linha…"), built.outcome!())
    expect(final.text).toBe(groupChoiceText(NAMES))
    expect(final.text).toContain("Residencial, Empresarial, Fibra, Móvel ou Ouvidoria")
  })

  it("o modelo escolheu Grupos que a pessoa NÃO disse: a escolha é ignorada e vira a pergunta do Grupo", async () => {
    const { built, consulted } = toolset(["Como abro um reparo?"])
    await built.execute(PROCESS_TOOL, { pergunta: "Como abrir um reparo?", grupo: "Fibra" })
    await built.execute(PROCESS_TOOL, { pergunta: "Como abrir um reparo?", grupo: "Residencial" })
    expect(consulted).toEqual([])
    expect(applyProcessGroupRule(reply("Fibra: … Residencial: …"), built.outcome!()).text).toBe(groupChoiceText(NAMES))
  })

  it("Grupo dito pela pessoa (agora ou numa fala anterior): consulta só ele e a resposta do modelo segue", async () => {
    const now = toolset(["Como a equipe de Fibra abre um reparo?"])
    await now.built.execute(PROCESS_TOOL, { pergunta: "reparo", grupo: "Fibra" })
    expect(now.consulted.map((item) => item.groupNames)).toEqual([["Fibra"]])
    expect(applyProcessGroupRule(reply("Na Fibra: …"), now.built.outcome!()).text).toBe("Na Fibra: …")
    const before = toolset(["Quero falar da Ouvidoria", "E como abre um reparo?"])
    await before.built.execute(PROCESS_TOOL, { pergunta: "reparo", grupo: "Ouvidoria" })
    expect(before.consulted.map((item) => item.groupNames)).toEqual([["Ouvidoria"]])
  })

  it("três Grupos ditos e limite de 2 consultas: a resposta diz qual ficou de fora", async () => {
    const { built, consulted } = toolset(["Como Fibra, Móvel e Ouvidoria abrem reparo?"])
    for (const grupo of ["Fibra", "Móvel", "Ouvidoria"]) await built.execute(PROCESS_TOOL, { pergunta: "reparo", grupo })
    expect(consulted.map((item) => item.groupNames[0])).toEqual(["Fibra", "Móvel"])
    const final = applyProcessGroupRule(reply("Fibra: … Móvel: …"), built.outcome!())
    expect(final.text).toContain("Fibra: … Móvel: …")
    expect(final.text).toContain("Não consultei o Grupo Ouvidoria nesta resposta")
  })

  it("todos os Grupos no mesmo Orquestrador: uma consulta, sem pergunta de Grupo", async () => {
    const { built, consulted } = toolset(["Como abro um reparo?"], SHARED)
    await built.execute(PROCESS_TOOL, { pergunta: "Como abrir um reparo?" })
    expect(consulted).toHaveLength(1)
    expect(applyProcessGroupRule(reply("Procedimento geral: …"), built.outcome!()).text).toBe("Procedimento geral: …")
  })

  it("Grupo citado pelas palavras que o distinguem; palavra comum a vários Grupos não escolhe nenhum", () => {
    const names = ["B2C · Faturamento", "B2C · Atendimento Geral"]
    expect(groupNamedByAsker("B2C · Faturamento", names, ["e no faturamento?"])).toBe(true)
    expect(groupNamedByAsker("B2C · Faturamento", names, ["como funciona no B2C?"])).toBe(false)
    expect(groupNamedByAsker("B2C · Faturamento", names, ["segunda via da fatura"])).toBe(false)
  })
})
