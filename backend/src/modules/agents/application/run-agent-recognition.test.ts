import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { answerAgentVersionQuery } from "../testing/agent-version-fakes.js"

const generateAgentReply = vi.fn()
const usage = { promptTokens: 600, outputTokens: 100, totalTokens: 700, cachedInputTokens: null, reasoningTokens: null }
vi.mock("../infrastructure/gemini-agent-client.js", () => ({
  generateAgentReplyWithUsage: async (...args: unknown[]) => ({ text: await generateAgentReply(...args), usage, durationMs: 40, model: "gemini-test" }),
  AGENT_LLM_MODEL: "test",
}))
vi.mock("../../assistant/infrastructure/gemini-function-calling-client.js", () => ({
  generateWithTools: async (contents: { text?: string }[], systemPrompt: string) => ({ kind: "text", text: await generateAgentReply(systemPrompt, contents[0]?.text ?? ""), usage, durationMs: 40, model: "gemini-test" }),
}))
vi.mock("./build-system-prompt.js", () => ({
  buildSystemPromptWithTrace: async () => ({
    systemPrompt: "PROMPT DO AGENT",
    knowledge: { mode: "NONE", authorizedDocuments: [], retrieved: [], injectedChars: 0, candidates: [] },
    parts: { identity: "PROMPT DO AGENT", expectations: "", restrictions: "", knowledge: "", actionLimits: "" },
  }),
}))
vi.mock("../../workflows/application/organization-timezone.js", () => ({ resolveOrganizationTimezone: async () => "America/Fortaleza", DEFAULT_ORGANIZATION_TIMEZONE: "America/Fortaleza" }))

const { runAgent, STRUCTURED_OUTPUT_INSTRUCTIONS_RECOGNITION } = await import("./run-agent.js")

const recorder = { start: vi.fn(async () => "run-1"), complete: vi.fn(async () => undefined), fail: vi.fn(async () => undefined) }

function fakeDb(): Database {
  const agentRow = { name: "Especialista de Reconhecimento", objective: "obj", description: "desc", context_prompt: "p", active: true, recommend_support_materials: false, investigation_capabilities: [] }
  return {
    query: vi.fn(async (text: string, params?: unknown[]) => {
      const versioned = answerAgentVersionQuery(text, params, () => agentRow)
      if (versioned) return versioned
      if (text.includes("from agents where id")) return { rows: [agentRow], rowCount: 1 }
      return { rows: [], rowCount: 0 }
    }),
  } as unknown as Database
}

const REASON = "Melhor resultado em Atingimento do PRV no Subgrupo Voz (mês anterior): posição 1 entre 12 pessoas com dados."
const REPLY = JSON.stringify({ title: "Melhor PRV do Subgrupo", summary: "Você teve o melhor PRV do seu Subgrupo.", relatedProcedure: "Nenhum procedimento específico cadastrado", recommendation: "Parabéns: seu PRV de 85% foi o melhor do Subgrupo, e ficou abaixo da meta de 100%." })

const workflowInput = (recognition?: { subject: string; reason: string; snapshot: Record<string, unknown> }) => ({
  kind: "indicator_summary" as const,
  operatorId: "gabriel",
  teamId: "grupo",
  periodLabel: "Fechamento 2026-10",
  periodStart: "2026-10-01",
  periodEnd: "2026-10-01",
  evidenceSourceType: "employee_performance" as const,
  indicators: [{ code: "PRV", name: "PRV (atingimento oficial)", unit: recognition ? "PERCENT" : "%", value: 85, targetValue: 100, direction: "HIGHER", measurementIds: ["prv-1"] }],
  ...(recognition ? { recognition } : {}),
})

type IndicatorInput = { observedBehavior: string; impactedIndicator: string; indicatorName: string; evidenceFound: string; contextSnapshot: Record<string, unknown>; structured: { recommendation: string } }
const publicationInput = (outcome: unknown) => (outcome as { workflowResult: { input: IndicatorInput } }).workflowResult.input
const firstSystemPrompt = () => String(generateAgentReply.mock.calls[0]?.[0] ?? "")

beforeEach(() => {
  generateAgentReply.mockReset()
  generateAgentReply.mockResolvedValue(REPLY)
})

describe("runAgent — formato Reconhecimento", () => {
  it("pede um reconhecimento, e o que o sistema sabe vai para o feedback sem passar pela IA", async () => {
    const snapshot = { contractVersion: "RECOGNITION_FEEDBACK_V1", position: 1 }
    const outcome = await runAgent(fakeDb(), { organizationId: "org", agentId: "agente", inputContext: `Motivo do reconhecimento: ${REASON}`, source: "WORKFLOW", recorder, workflow: workflowInput({ subject: "Atingimento do PRV", reason: REASON, snapshot }) })

    expect(firstSystemPrompt()).toContain("Este retorno é um RECONHECIMENTO")
    const input = publicationInput(outcome)
    expect(input.observedBehavior).toBe(REASON)
    expect(input.impactedIndicator).toBe("Atingimento do PRV")
    expect(input.indicatorName).toBe("Atingimento do PRV")
    expect(input.evidenceFound).toBe("Fechamento 2026-10 — PRV (atingimento oficial): 85% (meta: 100%)")
    expect(input.contextSnapshot.recognition).toEqual(snapshot)
    expect(input.structured.recommendation).toContain("abaixo da meta")
  })

  it("sem reconhecimento, o resumo de sempre continua igual", async () => {
    const outcome = await runAgent(fakeDb(), { organizationId: "org", agentId: "agente", inputContext: "Fechamento", source: "WORKFLOW", recorder, workflow: workflowInput() })

    expect(firstSystemPrompt()).not.toContain("Este retorno é um RECONHECIMENTO")
    const input = publicationInput(outcome)
    expect(input.observedBehavior).toBe("Resumo de 1 indicador(es) no período Fechamento 2026-10.")
    expect(input.impactedIndicator).toBe("Resumo geral de indicadores")
    expect(input.evidenceFound).toBe("Fechamento 2026-10 — PRV (atingimento oficial): 85 % (meta: 100 %)")
    expect(input.contextSnapshot.recognition).toBeUndefined()
  })

  it("o contrato não deixa elogiar número abaixo da meta nem explicar a causa", () => {
    expect(STRUCTURED_OUTPUT_INSTRUCTIONS_RECOGNITION).toContain("nunca apresente esse resultado como meta batida")
    expect(STRUCTURED_OUTPUT_INSTRUCTIONS_RECOGNITION).toContain("Não diga de onde o resultado veio")
    expect(STRUCTURED_OUTPUT_INSTRUCTIONS_RECOGNITION).toContain("Escreva 'fora da meta', não 'abaixo' nem 'acima'")
    expect(STRUCTURED_OUTPUT_INSTRUCTIONS_RECOGNITION).toContain("Abra parabenizando a pessoa")
    expect(STRUCTURED_OUTPUT_INSTRUCTIONS_RECOGNITION).toContain("Não diga como melhorar")
    expect(STRUCTURED_OUTPUT_INSTRUCTIONS_RECOGNITION).toContain("mesmo que o resultado tenha ficado abaixo da meta")
  })
})
