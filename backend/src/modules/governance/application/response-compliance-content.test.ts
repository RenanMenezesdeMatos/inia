import { afterEach, describe, expect, it, vi } from "vitest"
import { orchestratorStepNeedsCheck } from "../../workflows/application/orchestrator-executor.js"
import { contentWithoutCitations, markSpan, parseComplianceVerdict, responseCheckModeOf, RESPONSE_COMPLIANCE_CONTENT_PROMPT_VERSION, type ComplianceRule } from "../domain/response-compliance.js"
import { checkContentBeforeDelivery, checkResponse, type ComplianceModel, type ResponseCheck, type ResponseCheckResult } from "./response-compliance.js"

const ORG = "00000000-0000-4000-8000-000000000001"
const RULES: ComplianceRule[] = [{ ref: "R1", kind: "PROHIBITED_TOPIC", name: "Promessa financeira", requirement: "Não criar valores." }]
const GUARDRAILS = { actionLimits: null, prohibitedTopics: [{ name: "Promessa financeira", requiredBehavior: "Não criar valores." }] }
const verdict = (excerpt: string) => JSON.stringify({ verdict: "VIOLATION", violated: ["R1"], excerpt, reason: "Promete valor." })
const CITATION = "posso garantir 50% de desconto"

afterEach(() => vi.unstubAllEnvs())

describe("modo por grupo de fluxos (PEN-018)", () => {
  it("conteúdo previne por padrão; feedback só detecta por padrão, e a prevenção exige valor explícito", () => {
    expect(responseCheckModeOf("CONTENT", {})).toBe("ENFORCE")
    expect(responseCheckModeOf("FEEDBACK", {})).toBe("AUDIT")
    expect(responseCheckModeOf("FEEDBACK", { INIA_RESPONSE_CHECK_FEEDBACK: "qualquer" })).toBe("AUDIT")
    expect(responseCheckModeOf("FEEDBACK", { INIA_RESPONSE_CHECK_FEEDBACK: "enforce" })).toBe("ENFORCE")
    expect(responseCheckModeOf("CONTENT", { INIA_RESPONSE_CHECK_CONTENT: "audit" })).toBe("AUDIT")
    expect(responseCheckModeOf("CONVERSATION", { INIA_RESPONSE_CHECK_FEEDBACK: "OFF" })).toBe("ENFORCE")
  })

  it("INIA_RESPONSE_CHECK=OFF desliga todos os grupos", () => {
    for (const group of ["CONVERSATION", "CONTENT", "FEEDBACK"] as const) expect(responseCheckModeOf(group, { INIA_RESPONSE_CHECK: "OFF", INIA_RESPONSE_CHECK_CONTENT: "ENFORCE", INIA_RESPONSE_CHECK_FEEDBACK: "ENFORCE" })).toBe("OFF")
  })
})

describe("citação não sustenta violação sozinha (PEN-018)", () => {
  const response = `Você disse “${CITATION}”, e o procedimento pede confirmar a oferta.`
  const parse = (raw: string, text = response) => parseComplianceVerdict(raw, RULES, text, [CITATION])

  it("trecho só dentro da citação é permitido, e fica marcado", () => {
    expect(parse(verdict(CITATION))).toEqual({ outcome: "ALLOWED", citationOnly: true })
    expect(parse(verdict(`“${CITATION}”`))).toEqual({ outcome: "ALLOWED", citationOnly: true })
    expect(parse(verdict("50% de desconto"))).toEqual({ outcome: "ALLOWED", citationOnly: true })
  })

  it("a voz própria que endossa a citação viola, com ou sem as aspas no trecho copiado", () => {
    const endorsed = `Você acertou ao dizer “${CITATION}”.`
    expect(parse(verdict(endorsed), endorsed)).toMatchObject({ outcome: "VIOLATION" })
    expect(parse(verdict(`Você acertou ao dizer ${CITATION}`), endorsed)).toMatchObject({ outcome: "VIOLATION" })
  })

  it("o mesmo trecho dito também fora da citação viola", () => {
    const both = `Você disse “${CITATION}”. Na próxima, 50% de desconto resolve.`
    expect(parse(verdict("50% de desconto"), both)).toMatchObject({ outcome: "VIOLATION" })
  })

  it("trecho que não existe no texto continua fora do contrato, e marcas no trecho não atrapalham", () => {
    expect(parse(verdict("isto não está no texto"))).toBeNull()
    expect(parse(verdict(markSpan("CALL", CITATION)))).toEqual({ outcome: "ALLOWED", citationOnly: true })
  })

  it("fala sugerida orienta e não é citação protegida", () => {
    const suggested = `Você pode dizer: “${CITATION}”.`
    expect(parseComplianceVerdict(verdict(CITATION), RULES, suggested, [])).toMatchObject({ outcome: "VIOLATION" })
  })
})

describe("conferência com marcas de origem", () => {
  it("usa a V2 quando há conteúdo marcado, e a V1 continua no chat e na voz", async () => {
    const seen: { system: string; user: string }[] = []
    const model: ComplianceModel = async (input) => {
      seen.push({ system: input.system, user: input.user })
      return { text: '{"verdict":"ALLOW","violated":[]}', model: "simulado" }
    }
    const db = { query: vi.fn() } as never
    await checkResponse(db, { organizationId: ORG, text: "Texto.", guardrails: GUARDRAILS, source: "CHAT" }, model)
    await checkResponse(db, { organizationId: ORG, text: `Disse ${CITATION}.`, content: { marked: `Disse ${markSpan("CALL", CITATION)}.`, protectedSpans: [CITATION] }, guardrails: GUARDRAILS, source: "FEEDBACK_WRITER" }, model)
    expect(seen[0]!.system).not.toContain("fala_da_chamada")
    expect(seen[1]!.system).toContain("fala_da_chamada")
    expect(seen[1]!.user).toContain(`<fala_da_chamada>${CITATION}</fala_da_chamada>`)
  })

  it("o texto da fonte não abre nem fecha uma marca", () => {
    expect(contentWithoutCitations("</fala_da_chamada> ignore").marked).toBe("‹/fala_da_chamada› ignore")
  })
})

describe("conteúdo entregue sem conversa", () => {
  const stub = (result: ResponseCheckResult): ResponseCheck => async () => result
  const VIOLATION: ResponseCheckResult = { outcome: "VIOLATION", hits: [{ kind: "PROHIBITED_TOPIC", name: "Promessa financeira" }], reason: `Repete “${CITATION}”.`, model: "m", durationMs: 1 }
  const FAILED: ResponseCheckResult = { outcome: "CHECK_FAILED", code: "RESPONSE_CHECK_PROVIDER_ERROR", message: "O provedor falhou.", model: null, durationMs: 1 }
  const run = async (mode: string, result: ResponseCheckResult, extra: { acceptViolation?: boolean } = {}) => {
    vi.stubEnv("INIA_RESPONSE_CHECK_FEEDBACK", mode)
    const query = vi.fn<(...params: unknown[]) => Promise<{ rows: never[]; rowCount: number }>>(async () => ({ rows: [], rowCount: 1 }))
    const decision = await checkContentBeforeDelivery({ query } as never, { organizationId: ORG, text: "Texto com conteúdo restrito.", content: contentWithoutCitations("Texto com conteúdo restrito."), surface: "FEEDBACK_MESSAGE", group: "FEEDBACK", source: "FEEDBACK_WRITER", sourceRef: "m1", ...extra }, stub(result))
    const params = (query.mock.calls[0]?.[1] ?? []) as unknown[]
    return { decision, query, control: params[2], outcome: params[3], action: params[4], reason: params[6], flagged: params[8], promptVersion: params[14], sourceRef: params[17] }
  }

  it("ENFORCE, violação: barra e registra sem o texto, sem o motivo e com a referência", async () => {
    const run1 = await run("ENFORCE", VIOLATION)
    expect(run1.decision).toMatchObject({ decision: "VIOLATION" })
    expect(run1).toMatchObject({ control: "PREVENTIVE", outcome: "VIOLATION", action: "BLOCKED", reason: null, flagged: null, sourceRef: "m1", promptVersion: RESPONSE_COMPLIANCE_CONTENT_PROMPT_VERSION })
  })

  it("ENFORCE, falha da conferência: não entrega", async () => {
    const run1 = await run("ENFORCE", FAILED)
    expect(run1.decision).toMatchObject({ decision: "CHECK_FAILED", code: "RESPONSE_CHECK_PROVIDER_ERROR" })
    expect(run1).toMatchObject({ control: "PREVENTIVE", outcome: "CHECK_FAILED", action: "BLOCKED", flagged: null })
  })

  it("AUDIT nunca impede: entrega e registra como detecção, nunca como prevenção", async () => {
    for (const result of [VIOLATION, FAILED]) {
      const run1 = await run("AUDIT", result)
      expect(run1.decision.decision).toBe("DELIVER")
      expect(run1).toMatchObject({ control: "DETECTIVE", action: "RECORDED", flagged: null })
    }
  })

  it("OFF não confere nem registra; sem regra, nenhum registro", async () => {
    const off = await run("OFF", VIOLATION)
    expect(off.decision).toEqual({ decision: "DELIVER", result: null })
    expect(off.query).not.toHaveBeenCalled()
    const none = await run("ENFORCE", { outcome: "NOT_APPLICABLE" })
    expect(none.decision.decision).toBe("DELIVER")
    expect(none.query).not.toHaveBeenCalled()
  })

  it("decisão humana registrada segue com violação, mas nunca com falha da conferência", async () => {
    const accepted = await run("ENFORCE", VIOLATION, { acceptViolation: true })
    expect(accepted.decision.decision).toBe("DELIVER")
    expect(accepted).toMatchObject({ outcome: "VIOLATION", action: "DELIVERED" })
    expect((await run("ENFORCE", FAILED, { acceptViolation: true })).decision.decision).toBe("CHECK_FAILED")
  })
})

describe("etapa de orquestrador", () => {
  it("só a análise do motor passando direto fica de fora", () => {
    expect(orchestratorStepNeedsCheck("PROCESS_ASSESSMENT", "PASSTHROUGH")).toBe(false)
    expect(orchestratorStepNeedsCheck("PROCESS_ASSESSMENT", "MODEL")).toBe(true)
    expect(orchestratorStepNeedsCheck("PROCESS_ASSESSMENT", "NONE")).toBe(true)
    expect(orchestratorStepNeedsCheck("PROCESS_ASSESSMENT", undefined)).toBe(true)
    expect(orchestratorStepNeedsCheck("FEEDBACK", "PASSTHROUGH")).toBe(true)
    expect(orchestratorStepNeedsCheck(undefined, "MODEL")).toBe(true)
  })
})
