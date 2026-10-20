import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"

const createApprovedFeedback = vi.fn(async () => ({ caseId: "case-1", feedbackId: "feedback-1" }))
vi.mock("./create-approved-feedback.js", () => ({ createApprovedFeedback: (...args: unknown[]) => createApprovedFeedback(...(args as [])) }))
const { createOrchestratorFeedback } = await import("./create-orchestrator-feedback.js")

const base = { organizationId: "org-1", operatorId: "op-1", teamId: "team-1", sourceType: "INTERACTION", sourceId: "int-1", occurredAt: "2026-10-17T12:00:00.000Z", orchestratorName: "Monitoria Geral" }
type Published = { evidence: { description: string }; feedback: { evidenceFound: string; recommendation: string; contextSnapshot: Record<string, unknown> } }
const published = () => (createApprovedFeedback.mock.calls[0] as unknown as [Database, Published])[1]

describe("feedback publicado a partir do Orquestrador — texto de IA nunca é evidência (auditoria 17/10/2026, AI-02)", () => {
  beforeEach(() => createApprovedFeedback.mockClear())

  it("evidência = as citações literais já conferidas pelos especialistas FEEDBACK; a síntese fica como recomendação", async () => {
    await createOrchestratorFeedback({} as Database, {
      ...base,
      reply: {
        text: "O atendente não confirmou os dados e deveria ter feito a validação positiva.",
        results: [
          { contract: "FEEDBACK", structured: { evidenceFound: "cliente: pode mudar o endereço agora?" } },
          { contract: "TEXT" },
          { contract: "FEEDBACK", structured: { evidenceFound: "cliente: pode mudar o endereço agora?" } },
        ],
      },
    })
    const record = published()
    expect(record.feedback.evidenceFound).toBe('"cliente: pode mudar o endereço agora?"')
    expect(record.evidence.description).toBe(record.feedback.evidenceFound)
    expect(record.feedback.recommendation).toBe("O atendente não confirmou os dados e deveria ter feito a validação positiva.")
    expect(record.feedback.contextSnapshot.evidenceVerified).toBe(true)
  })

  it("sem citação conferida: a síntese NÃO vira evidência e o feedback sai marcado como não verificado", async () => {
    await createOrchestratorFeedback({} as Database, { ...base, reply: { text: "Diga que o atendente não confirmou os dados.", results: [{ contract: "TEXT" }, { contract: "FEEDBACK", structured: { evidenceFound: "   " } }] } })
    const record = published()
    expect(record.feedback.evidenceFound).not.toContain("não confirmou")
    expect(record.feedback.evidenceFound).toMatch(/Sem trecho literal verificado/)
    expect(record.evidence.description).toBe(record.feedback.evidenceFound)
    expect(record.feedback.contextSnapshot.evidenceVerified).toBe(false)
  })
})
