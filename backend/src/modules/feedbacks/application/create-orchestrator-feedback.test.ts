import { describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { createOrchestratorFeedback } from "./create-orchestrator-feedback.js"

vi.mock("./publish-feedback.js", () => ({
  PublishFeedback: class {
    async execute() {
      return undefined
    }
  },
}))

type Call = { sql: string; params: unknown[] }

/** `supervision_cases.indicator_code/indicator_value/indicator_target` são NOT NULL sem default
 * (ver migration 001) — regressão real encontrada na validação ao vivo dos Workflows
 * operacionais (Fechamento do Workflow Engine): todo Output(FOLLOW_UP, CURRENT_OPERATOR)
 * alimentado por um node Orchestrator falhava com "null value in column indicator_code"
 * porque o INSERT nunca preenchia essas 3 colunas. O teste de output-executor.test.ts não pegava
 * isso porque mocka createOrchestratorFeedback inteiro — este teste exercita o INSERT de verdade. */
function fakeDb(): { db: Database; calls: Call[] } {
  const calls: Call[] = []
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params })
      if (sql.includes("as owned")) return { rows: [{ owned: 1 }] }
      if (sql.includes("insert into supervision_cases")) return { rows: [{ id: "case-1" }] }
      if (sql.includes("insert into feedbacks")) return { rows: [{ id: "feedback-1" }] }
      return { rows: [] }
    },
    release: () => {},
  }
  const db = { connect: async () => client } as unknown as Database
  return { db, calls }
}

describe("createOrchestratorFeedback", () => {
  it("preenche indicator_code/indicator_value/indicator_target (NOT NULL) com a identificação do Orchestrator, nunca um indicador inventado", async () => {
    const { db, calls } = fakeDb()

    const result = await createOrchestratorFeedback(db, {
      organizationId: "org-1",
      operatorId: "operator-1",
      teamId: "team-1",
      sourceType: "scheduled_subject",
      sourceId: "person-1",
      occurredAt: "2026-09-14T12:00:00.000Z",
      orchestratorName: "TESTE - Orquestrador Indicadores",
      reply: { text: "síntese do orquestrador", structuredResult: null },
    })

    expect(result).toEqual({ caseId: "case-1", feedbackId: "feedback-1" })

    const caseInsert = calls.find((call) => call.sql.includes("insert into supervision_cases"))
    expect(caseInsert).toBeDefined()
    expect(caseInsert!.sql).toMatch(/indicator_code/)
    expect(caseInsert!.sql).toMatch(/indicator_value/)
    expect(caseInsert!.sql).toMatch(/indicator_target/)
    // Nenhum dos 3 parâmetros correspondentes pode ser null/undefined — é exatamente isso que
    // violava a constraint NOT NULL em produção.
    const params = caseInsert!.params
    expect(params).toContain("TESTE - Orquestrador Indicadores")
    for (const value of params) {
      expect(value === null || value === undefined).toBe(false)
    }
  })
})
