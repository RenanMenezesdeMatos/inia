import { beforeEach, describe, expect, it, vi } from "vitest"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { fakeSemanticReply, fakeWriter, SCENARIO_TRANSCRIPTS, type SemanticScenario } from "../testing/fake-semantic-model.js"

const generateForRoute = vi.fn()
vi.mock("../../../shared/application/model-routing/llm-gateway.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../shared/application/model-routing/llm-gateway.js")>()
  return { ...original, generateForRoute: (...args: unknown[]) => generateForRoute(...args) }
})

const { prepareInteractionForFeedback, PrepareInteractionError } = await import("./prepare-interaction-for-feedback.js")
const { runInteractionFeedbackPipeline } = await import("./interaction-feedback-pipeline.js")
const { createInMemoryInteractionFeedbackStore } = await import("../testing/in-memory-interaction-feedback-store.js")
const { FEEDBACK_AUTONOMOUS_DELIVERY_POLICY } = await import("../domain/feedback-delivery-policy.js")
const { useCaseForPurpose } = await import("../../../shared/application/model-routing/ai-use-cases.js")

const ORG = "10000000-0000-4000-8000-000000000001"
const OPERATOR = "10000000-0000-4000-8000-000000000002"
const OTHER = "10000000-0000-4000-8000-000000000003"
const INTERACTION = "10000000-0000-4000-8000-000000000010"

function fakeDb(options: { transcript?: string | null; operatorId?: string; exists?: boolean } = {}) {
  const queries: string[] = []
  const query = vi.fn(async (sql: string) => {
    queries.push(sql)
    if (sql.includes("from interactions i join people p")) return { rows: options.exists === false ? [] : [{ id: INTERACTION, operator_id: options.operatorId ?? OPERATOR, started_at: new Date("2026-03-14T15:00:00Z"), reason: "segunda_via", team_id: "team-1", subject_code: "segunda_via" }], rowCount: 1 }
    if (sql.includes("from transcripts")) return options.transcript === null ? { rows: [], rowCount: 0 } : { rows: [{ content: options.transcript ?? SCENARIO_TRANSCRIPTS.CLEAR, version: 1, language: "pt-BR", confidence: null }], rowCount: 1 }
    if (sql.includes("from operations")) return { rows: [{ timezone: "America/Sao_Paulo" }], rowCount: 1 }
    if (sql.includes("left join teams")) return { rows: [{ name: "Operadora Teste", team_id: "team-1", team_name: "B2C", subteam_id: null, subteam_name: null }], rowCount: 1 }
    if (sql.includes("from interaction_subject_definitions")) return { rows: [{ name: "Segunda via" }], rowCount: 1 }
    if (sql.includes("from people where organization_id = $1 and team_id")) return { rows: [{ name: "Bruno Colega" }], rowCount: 1 }
    return { rows: [], rowCount: 0 }
  })
  return { db: { query } as unknown as Database, queries }
}

let scenario: SemanticScenario = "CLEAR"
beforeEach(() => {
  scenario = "CLEAR"
  generateForRoute.mockReset()
  generateForRoute.mockImplementation(async (request: { classification?: { phase?: string; tags?: string[] } }) => fakeSemanticReply(request, () => scenario))
})

describe("V1.5.10 — PrepareInteractionForFeedback (caminho semântico DIRETO, sem Planner)", () => {
  it("interação → Fase A + Fase B (só SEMANTIC_ANALYSIS, nenhuma request de planejamento) → InteractionFeedback V1 com rótulo exibível", async () => {
    const { db } = fakeDb()
    const prepared = await prepareInteractionForFeedback(db, { organizationId: ORG, collaboratorId: OPERATOR, interactionId: INTERACTION, now: new Date("2026-03-15T12:00:00Z") })
    expect(prepared.kind).toBe("PREPARED")
    if (prepared.kind !== "PREPARED") return
    const requests = generateForRoute.mock.calls.map((call) => call[0] as { classification: { phase: string; purpose: string; source: string; tags: string[] }; tools: unknown[] })
    // Planner ausente: toda request é de análise semântica (extração/síntese), com a etiqueta do fluxo e SEM ferramentas.
    expect(requests.map((request) => request.classification.phase)).toEqual(["SEMANTIC_ANALYSIS", "SEMANTIC_ANALYSIS"])
    expect(requests.map((request) => request.classification.tags)).toEqual([["stage:EXTRACTION", "flow:INTERACTION_FEEDBACK"], ["stage:SYNTHESIS", "flow:INTERACTION_FEEDBACK"]])
    expect(requests.every((request) => request.classification.purpose === "ANALYZE_INTERACTIONS" && request.tools.length === 0)).toBe(true)
    expect(prepared.requests.map((request) => request.phase)).not.toContain("PLANNING")
    // Use Cases de custo: extração e síntese semânticas — nunca INVESTIGATION_PLANNING (o Planner 3.8-flash).
    expect(requests.map((request) => useCaseForPurpose(request.classification.purpose, request.classification as never))).toEqual(["SEMANTIC_EXTRACTION", "PATTERN_SYNTHESIS"])
    // O modelo leu a transcrição por turnos, com handle — nunca o UUID da interação.
    const firstInput = (generateForRoute.mock.calls[0]![0] as { contents: { text: string }[] }).contents[0]!.text
    expect(firstInput).toContain("OPERADOR: O prazo de entrega")
    expect(firstInput).not.toContain(INTERACTION)
    expect(prepared.feedback).toMatchObject({ contract: "INTERACTION_FEEDBACK_V1", status: "HAS_POINTS", interaction: { label: "Atendimento de 14/03/2026 · Segunda via" } })
    expect(prepared.feedback.items.map((item) => item.section)).toEqual(["STRENGTH"])
    expect(prepared.runContext).toEqual({ organizationId: ORG, collaboratorId: OPERATOR, teamId: "team-1", interactionId: INTERACTION, occurredAt: new Date("2026-03-14T15:00:00Z") })
  })

  it("serviço direto → InteractionFeedback → redator falso → política AUTÔNOMA: força clara vira AUTO_DELIVER sem QA", async () => {
    const { db } = fakeDb()
    const prepared = await prepareInteractionForFeedback(db, { organizationId: ORG, collaboratorId: OPERATOR, interactionId: INTERACTION, now: new Date() })
    if (prepared.kind !== "PREPARED") throw new Error(prepared.kind)
    const { store } = createInMemoryInteractionFeedbackStore()
    const writer = fakeWriter()
    const result = await runInteractionFeedbackPipeline({ enabled: true, writer, store, now: () => new Date(), deliveryPolicy: FEEDBACK_AUTONOMOUS_DELIVERY_POLICY }, prepared.feedback, prepared.runContext)
    expect(result.status).toBe("RECORDED")
    expect(result.status === "RECORDED" ? result.decisions.map((entry) => entry.decision.disposition) : null).toEqual(["AUTO_DELIVER"])
    expect(writer.calls).toHaveLength(1)
    // O redator recebe só o slot genérico e a evidência exibível — nada de UUID/handle da preparação.
    expect(JSON.stringify(writer.calls[0])).not.toMatch(new RegExp(`${INTERACTION}|${OPERATOR}|"I1"`))
  })

  it("máscara da transcrição desligada (decisão do DPO): evidência só com número longo → item retido → BLOCKED (sem redator, sem QA)", async () => {
    // Com a máscara ligada (padrão, `SUBJECT_PII_MASK_V2`) o número já chega à IA mascarado; a retenção na exibição é a defesa em
    // profundidade para quando ela estiver desligada.
    scenario = "BLOCKED"
    const masking = env.INIA_MODEL_PII_MASKING
    ;(env as { INIA_MODEL_PII_MASKING: string }).INIA_MODEL_PII_MASKING = "OFF"
    const { db } = fakeDb({ transcript: SCENARIO_TRANSCRIPTS.BLOCKED })
    const prepared = await prepareInteractionForFeedback(db, { organizationId: ORG, collaboratorId: OPERATOR, interactionId: INTERACTION, now: new Date() }).finally(() => {
      ;(env as { INIA_MODEL_PII_MASKING: string }).INIA_MODEL_PII_MASKING = masking
    })
    if (prepared.kind !== "PREPARED") throw new Error(prepared.kind)
    const writer = fakeWriter()
    const result = await runInteractionFeedbackPipeline({ enabled: true, writer, store: createInMemoryInteractionFeedbackStore().store, now: () => new Date(), deliveryPolicy: FEEDBACK_AUTONOMOUS_DELIVERY_POLICY }, prepared.feedback, prepared.runContext)
    expect(result.status).toBe("RECORDED_WITHOUT_WRITER")
    expect(result.status === "RECORDED_WITHOUT_WRITER" ? result.decisions.map((entry) => [entry.decision.disposition, entry.decision.reasons]) : null).toEqual([["BLOCKED", ["INSUFFICIENT_DISPLAY_EVIDENCE"]]])
    expect(writer.calls).toHaveLength(0)
  })

  it("segurança: interação de outra organização/inexistente ou de outro colaborador é recusada ANTES de qualquer request", async () => {
    await expect(prepareInteractionForFeedback(fakeDb({ exists: false }).db, { organizationId: ORG, collaboratorId: OPERATOR, interactionId: INTERACTION, now: new Date() })).rejects.toMatchObject({ code: "INTERACTION_NOT_FOUND" })
    await expect(prepareInteractionForFeedback(fakeDb({ operatorId: OTHER }).db, { organizationId: ORG, collaboratorId: OPERATOR, interactionId: INTERACTION, now: new Date() })).rejects.toBeInstanceOf(PrepareInteractionError)
    expect(generateForRoute).not.toHaveBeenCalled()
  })

  it("sem transcrição = NOT_ANALYZABLE (resultado funcional, zero request); modelo sem contrato = falha técnica", async () => {
    expect(await prepareInteractionForFeedback(fakeDb({ transcript: null }).db, { organizationId: ORG, collaboratorId: OPERATOR, interactionId: INTERACTION, now: new Date() })).toEqual({ kind: "NOT_ANALYZABLE", reason: "NO_TRANSCRIPT", requests: [] })
    expect(generateForRoute).not.toHaveBeenCalled()
    generateForRoute.mockReset()
    generateForRoute.mockResolvedValue({ kind: "text", text: "não é json", usage: { promptTokens: 1, outputTokens: 1, totalTokens: 2, cachedInputTokens: null, reasoningTokens: null }, durationMs: 1, model: "m", provider: "GEMINI", cache: { mode: "NONE" }, cost: { status: "NOT_CONFIGURED" } })
    await expect(prepareInteractionForFeedback(fakeDb().db, { organizationId: ORG, collaboratorId: OPERATOR, interactionId: INTERACTION, now: new Date() })).rejects.toMatchObject({ code: "SEMANTIC_ANALYSIS_FAILED" })
  })
})
