import { describe, expect, it } from "vitest"
import { z } from "zod"
import { AGENT_RUN_SOURCE_LABELS, agentRunSchema } from "./agent.schema"

function runRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    source: "MANUAL_TEST",
    inputContext: "Transcrição de teste",
    outputText: "Resposta do agente",
    status: "COMPLETED",
    errorMessage: null,
    model: "gemini-2.5-flash",
    caseId: null,
    createdAt: "2026-10-20T13:00:00.000Z",
    completedAt: "2026-10-20T13:00:05.000Z",
    ...overrides,
  }
}

describe("execuções do agente (aba Execuções)", () => {
  it("aceita a lista com execuções de Workflow (inclusive com falha) junto com os testes manuais", () => {
    const rows = [
      runRow({ id: "run-workflow", source: "WORKFLOW", status: "FAILED", outputText: null, errorMessage: "Resposta rejeitada pelo contrato", completedAt: "2026-10-20T13:01:00.000Z" }),
      runRow(),
    ]

    const runs = z.array(agentRunSchema).parse(rows)

    expect(runs.map((run) => AGENT_RUN_SOURCE_LABELS[run.source])).toEqual(["Workflow de automação", "Teste manual"])
  })

  it("toda origem aceita tem rótulo em português", () => {
    for (const source of ["MANUAL_TEST", "TRIGGER", "WORKFLOW", "QA_SIMULATION"]) {
      const { source: parsed } = agentRunSchema.parse(runRow({ source }))
      expect(parsed).toBe(source)
      expect(AGENT_RUN_SOURCE_LABELS[parsed]).toBeTruthy()
    }
  })
})
