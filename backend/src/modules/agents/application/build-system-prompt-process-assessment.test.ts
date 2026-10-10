import { describe, expect, it, vi } from "vitest"

vi.mock("../../knowledge/application/retrieve-knowledge.js", () => ({
  retrieveKnowledgeForAgent: async () => ({ trace: { mode: "NONE", authorizedDocuments: [], retrieved: [], injectedChars: 0 }, promptBlock: "" }),
}))

import { buildSystemPromptWithTrace } from "./build-system-prompt.js"
import type { Database } from "../../../infrastructure/database/pool.js"

const EXPECTATION = "Informar o número do protocolo do atendimento antes de encerrar a chamada."

/** Banco falso: registra se a tabela de Regras de chamada foi consultada e devolve uma regra genérica da organização. */
function fakeDb() {
  const queried: string[] = []
  const db = {
    query: async (sql: string) => {
      queried.push(sql)
      if (sql.includes("argument_scripts")) return { rows: [{ name: "Regra antiga", scope_type: "ALL_TEAMS", conversion: "LEGACY_UNSTRUCTURED", content: { legacyExpectation: EXPECTATION, operatorGuidance: [{ key: "legacy-1", text: EXPECTATION, modality: "UNSPECIFIED" }] }, team_name: null, subteam_name: null, subject_name: null }] }
      return { rows: [] }
    },
  } as unknown as Database
  return { db, queried }
}

const AGENT = { organization_id: "org-1", name: "Monitoria", objective: "Avaliar", description: "Especialista", context_prompt: "Avalie a chamada." }

describe("V1.7.4 — Regras de chamada genéricas fora da avaliação de processo da monitoria", () => {
  it("avaliação de processo: a regra genérica da organização não entra no prompt; a régua é só a base aplicável", async () => {
    const { db, queried } = fakeDb()
    const built = await buildSystemPromptWithTrace(db, "agent", AGENT, { query: "transcrição", processAssessment: true })
    expect(built.systemPrompt).not.toContain(EXPECTATION)
    expect(built.parts.expectations).toMatch(/únicas regras avaliáveis são as etapas marcadas \[CP-…\]/)
    expect(queried.some((sql) => sql.includes("argument_scripts"))).toBe(false)
  })
  it("fora da avaliação de processo (feedback de monitoria legado, diagnóstico de indicador) nada muda: a regra continua no prompt", async () => {
    const { db } = fakeDb()
    const built = await buildSystemPromptWithTrace(db, "agent", AGENT, { query: "transcrição", markProcessRoles: true })
    expect(built.systemPrompt).toContain(EXPECTATION)
    expect(built.parts.expectations).toMatch(/^Expectativas de chamada cadastradas/)
  })
})
