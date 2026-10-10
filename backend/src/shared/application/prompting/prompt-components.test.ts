import { describe, expect, it } from "vitest"
import { assemblePrompt, composeUserTurn, staticCacheKeyVersion, type PromptComponent } from "./prompt-components.js"

const components: PromptComponent[] = [
  { id: "agent.identity", version: 1, phases: "ALL", static: true, content: "Você é X." },
  { id: "investigation.policy", version: 2, phases: ["PLANNING", "INVESTIGATION_NOTES"], static: true, content: "REGRAS" },
  { id: "synthesis.contract", version: 1, phases: ["AGENT_SYNTHESIS"], static: true, content: "JSON" },
  { id: "knowledge.retrieved", version: 1, phases: ["AGENT_SYNTHESIS"], static: false, content: "### Doc" },
  { id: "investigation.subject", version: 1, phases: "ALL", static: false, content: "Colaborador: Mariana" },
]

// V1.3 — §15/§54: composição explícita por fase; estático × dinâmico; versão de cache por hash.
describe("prompt component registry", () => {
  it("cada fase recebe só os componentes aplicáveis: planejamento não recebe o contrato de síntese; síntese não recebe a política de investigação", () => {
    const planning = assemblePrompt("PLANNING", components, "COMPACT")
    expect(planning.components.map((item) => item.id)).toEqual(["agent.identity", "investigation.policy", "investigation.subject"])
    const synthesis = assemblePrompt("AGENT_SYNTHESIS", components, "COMPACT")
    expect(synthesis.components.map((item) => item.id)).toEqual(["agent.identity", "synthesis.contract", "knowledge.retrieved", "investigation.subject"])
    expect(synthesis.system).not.toContain("REGRAS")
  })

  it("COMPACT: estático no sistema (cacheável), dinâmico no turno do usuário; CURRENT: tudo no sistema na ordem dada", () => {
    const compact = assemblePrompt("AGENT_SYNTHESIS", components, "COMPACT")
    expect(compact.system).toBe("Você é X.\n\nJSON")
    expect(compact.userPreamble).toBe("### Doc\n\nColaborador: Mariana")
    expect(compact.system).not.toContain("Mariana")
    expect(composeUserTurn(compact, "TAREFA")).toBe("### Doc\n\nColaborador: Mariana\n\nTAREFA")
    expect(compact.staticChars).toBe("Você é X.".length + "JSON".length)
    const current = assemblePrompt("AGENT_SYNTHESIS", components, "CURRENT")
    expect(current.system).toBe("Você é X.\n\nJSON\n\n### Doc\n\nColaborador: Mariana")
    expect(current.userPreamble).toBe("")
  })

  it("a versão de cache depende só dos componentes ESTÁTICOS: mudar texto/versão estática invalida; mudar o dinâmico não", () => {
    const base = assemblePrompt("PLANNING", components, "COMPACT").cacheKeyVersion
    const otherSubject = assemblePrompt("PLANNING", components.map((item) => (item.id === "investigation.subject" ? { ...item, content: "Colaborador: Rafael" } : item)), "COMPACT").cacheKeyVersion
    expect(otherSubject).toBe(base)
    const policyChanged = assemblePrompt("PLANNING", components.map((item) => (item.id === "investigation.policy" ? { ...item, content: "REGRAS v3" } : item)), "COMPACT").cacheKeyVersion
    expect(policyChanged).not.toBe(base)
    const versionBumped = assemblePrompt("PLANNING", components.map((item) => (item.id === "investigation.policy" ? { ...item, version: 3 } : item)), "COMPACT").cacheKeyVersion
    expect(versionBumped).not.toBe(base)
    expect(staticCacheKeyVersion(components)).toHaveLength(12)
  })
})
