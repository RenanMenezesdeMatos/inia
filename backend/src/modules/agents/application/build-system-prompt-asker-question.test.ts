import { describe, expect, it, vi } from "vitest"

const retrievals = vi.fn<(query: string, presentation: unknown) => void>()
vi.mock("../../knowledge/application/retrieve-knowledge.js", () => ({
  retrieveKnowledgeForAgent: async (_db: unknown, _agentId: string, query: string, _budget: unknown, _coverage: unknown, presentation: unknown) => {
    retrievals(query, presentation)
    return { trace: { mode: "NONE", authorizedDocuments: [], retrieved: [], injectedChars: 0 }, promptBlock: "" }
  },
}))

import { buildSystemPromptWithTrace } from "./build-system-prompt.js"
import type { Database } from "../../../infrastructure/database/pool.js"

const db = { query: async () => ({ rows: [] }) } as unknown as Database
const AGENT = { organization_id: "org-1", name: "Agente de Processos", objective: "Orientar", description: "Especialista", context_prompt: "Responda pelas bases." }
const PERSON = "Como faço para registrar a contestação da fatura de um cliente?"

describe("ASKER_QUESTION_RETRIEVAL_V1 — a pergunta da pessoa só chega à busca na conversa", () => {
  it("conversa com o colaborador: a busca recebe a pergunta do roteamento e a da pessoa", async () => {
    await buildSystemPromptWithTrace(db, "agent", AGENT, { query: "Como registrar a contestação? Passo a passo.", collaboratorConversation: true, askerQuestion: PERSON })
    expect(retrievals).toHaveBeenLastCalledWith("Como registrar a contestação? Passo a passo.", expect.objectContaining({ askerQuestion: PERSON }))
  })

  it("fora da conversa (Workflow, avaliação de processo, QA Lab) ela é ignorada", async () => {
    await buildSystemPromptWithTrace(db, "agent", AGENT, { query: "transcrição", askerQuestion: PERSON })
    expect(retrievals).toHaveBeenLastCalledWith("transcrição", expect.objectContaining({ askerQuestion: null }))
    await buildSystemPromptWithTrace(db, "agent", AGENT, { query: "transcrição", processAssessment: true, markProcessRoles: true, askerQuestion: PERSON })
    expect(retrievals).toHaveBeenLastCalledWith("transcrição", expect.objectContaining({ askerQuestion: null, markProcessRoles: true }))
  })
})
