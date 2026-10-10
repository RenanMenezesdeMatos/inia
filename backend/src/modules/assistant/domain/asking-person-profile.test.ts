import { describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { renderAskingPersonProfile } from "./asking-person-profile.js"

describe("perfil de quem pergunta (contexto, nunca permissão)", () => {
  it("operador: cargo + grupo e orientação de operador", () => {
    const text = renderAskingPersonProfile({ name: "Larissa Monteiro", teamName: "B2C · Atendimento Geral", jobTitle: "Operadora de Atendimento", level: "OPERATOR", directReports: 0 })
    expect(text).toContain("Colaborador que está perguntando: Larissa Monteiro — Operadora de Atendimento")
    expect(text).toContain("Perfil de OPERADOR")
    expect(text).not.toContain("LIDERANÇA")
  })

  it("liderança: diz quantas pessoas lidera e que os dados enviados são individuais (nunca inventar números da equipe)", () => {
    const text = renderAskingPersonProfile({ name: "Daniela Rocha", teamName: "B2C", jobTitle: "Supervisora de Atendimento", level: "SUPERVISOR", directReports: 25 })
    expect(text).toContain("lidera 25 pessoas diretamente")
    expect(text).toContain("Perfil de LIDERANÇA")
    expect(text).toContain("nunca invente números da equipe")
  })

  it("cargo que já diz o nível não repete; sem cargo, mostra o nível", () => {
    expect(renderAskingPersonProfile({ name: "A", teamName: null, jobTitle: "Gerente de Operações", level: "MANAGER", directReports: 3 })).not.toContain("nível Gerente")
    expect(renderAskingPersonProfile({ name: "B", teamName: null, jobTitle: null, level: "COORDINATOR", directReports: 2 })).toContain("— nível Coordenador")
  })
})

vi.mock("../../knowledge/application/retrieve-knowledge.js", () => ({
  retrieveKnowledgeForAgent: async () => ({ promptBlock: "", trace: { mode: "NONE", authorizedDocuments: [], retrieved: [], injectedChars: 0, estimatedTokens: 0, authorizedChars: 0, budget: { maxChunks: 8, maxTotalChars: 9000, minRelativeScore: 0.2 } } }),
}))
const { buildSystemPromptWithTrace } = await import("../../agents/application/build-system-prompt.js")

describe("Regras de chamada × conversa com o colaborador", () => {
  const db = {
    query: async (sql: string) => {
      if (sql.includes("from prohibited_topics")) return { rows: [] }
      if (sql.includes("from argument_scripts")) return { rows: [{ name: "Regra antiga", scope_type: "ALL_TEAMS", conversion: "LEGACY_UNSTRUCTURED", content: { legacyExpectation: "Informar o número do protocolo do atendimento antes de encerrar a chamada.", operatorGuidance: [{ key: "legacy-1", text: "Informar o número do protocolo do atendimento antes de encerrar a chamada.", modality: "UNSPECIFIED" }] }, team_name: null, subteam_name: null, subject_name: null }] }
      return { rows: [] }
    },
  } as unknown as Database
  const agent = { organization_id: "org-1", name: "AGENTE DE RH", objective: "o", description: "d", context_prompt: "c" }

  it("chat/voz: as Regras de chamada ficam de fora e o prompt proíbe protocolo inventado", async () => {
    const { systemPrompt } = await buildSystemPromptWithTrace(db, "agent-1", agent, { query: "reembolso", collaboratorConversation: true })
    expect(systemPrompt).not.toContain("Informar o número do protocolo")
    expect(systemPrompt).toContain("nunca informe protocolo")
  })

  it("avaliação (Workflow/monitoria): as regras continuam, descritas como ações do OPERADOR com o cliente", async () => {
    const { systemPrompt } = await buildSystemPromptWithTrace(db, "agent-1", agent, { query: "transcrição" })
    expect(systemPrompt).toContain("Informar o número do protocolo")
    expect(systemPrompt).toContain("não são ações suas")
  })
})
