import { describe, expect, it } from "vitest"
import { toReliableReviewDetail } from "../../interaction-feedback/domain/review-view.js"
import { createInMemoryReliableFeedbackStore } from "../infrastructure/in-memory-reliable-feedback-store.js"
import { generateReliableFeedback, type ReliableGenerationDeps, type ReliableGenerationRequest } from "./generate-reliable-feedback.js"
import type { ReliableFeedbackWriterPort } from "./ports.js"
import { RELIABLE_FEEDBACK_AUTONOMOUS_POLICY } from "../domain/reliable-feedback-item.js"
import { nodeOutputOf } from "../domain/reliable-feedback-artifact.js"
import { V171F_ASSESSMENT, V171F_COLLABORATOR_NAME, V171F_DOC_TITLE, V171F_OTHER_OPERATOR_NAMES, V171F_PRESENTED, V171F_PUBLISHED, V171F_SUBJECT, V171F_TRANSCRIPT, V171F_WRITER_RAW } from "../testing/contestacao-v171f-smoke-fixture.js"

/**
 * V1.7.1h — DEGRADAÇÃO POR CAMPO do texto do redator, sobre o smoke REAL da V1.7.1f (sem modelo). Núcleo (`observed`) inválido
 * continua derrubando o item inteiro; campo complementar inválido sai sozinho (ou recebe o texto do sistema para esse campo).
 */
type Wording = { observed?: string; whyItMatters?: string; whatYouCanDo?: string; suggestedResponse?: string }
const REAL = V171F_WRITER_RAW.items
const SLOTS: [RegExp, number][] = [[/Explicar prazo/i, 0], [/Verificar nome/i, 1], [/Registrar contesta/i, 2], [/Confirma/i, 3], [/Cancelar/i, 4], [/protocolo/i, 5]]

/** Redator falso = a resposta REAL do smoke, com campos sobrescritos por etapa quando o teste pede. */
function writer(overrides: Record<string, Wording> = {}): ReliableFeedbackWriterPort {
  return {
    writeMonitoring: async (input) => ({
      rawOutput: {
        items: input.items.flatMap((item) => {
          const hit = SLOTS.find(([pattern]) => pattern.test(item.requirement ?? ""))
          if (!hit) return []
          const override = Object.entries(overrides).find(([key]) => new RegExp(key, "i").test(item.requirement ?? ""))?.[1] ?? {}
          return [{ ...REAL[hit[1]]!, ...override, slot: item.slot }]
        }),
        presentation: V171F_WRITER_RAW.presentation,
      },
    }),
    writeIndicator: async () => { throw new Error("não usado") },
  }
}
async function run(overrides: Record<string, Wording> = {}, presentation?: { introduction: string; closing: string }) {
  const store = createInMemoryReliableFeedbackStore({ onReactivate: () => true })
  const base = writer(overrides)
  const port: ReliableFeedbackWriterPort = presentation ? { ...base, writeMonitoring: async (input) => { const out = await base.writeMonitoring(input); return { rawOutput: { ...(out.rawOutput as object), presentation } } } } : base
  const deps: ReliableGenerationDeps = {
    enabled: true, store, writer: port, policy: RELIABLE_FEEDBACK_AUTONOMOUS_POLICY,
    loadMonitoringContext: async () => ({ transcript: V171F_TRANSCRIPT, label: `Atendimento de 25/09/2026 · ${V171F_SUBJECT}`, otherOperatorNames: V171F_OTHER_OPERATOR_NAMES, subjectOperatorName: V171F_COLLABORATOR_NAME }),
    loadIndicatorContext: async () => null, loadPublishedKnowledge: async () => V171F_PUBLISHED, loadIndicatorDiagnosisPlan: async () => null,
    loadPeerPracticeData: async () => ({ peers: [], observations: [] }), resolveDiagnosticStrategy: async () => null,
    loadRecipient: async () => ({ firstName: "Larissa" }), now: () => new Date("2026-09-25T21:13:00Z"),
  }
  const source = { kind: "monitoring", knowledgeExcerpts: V171F_PRESENTED, input: { organizationId: "org-h", operatorId: "op-h", interactionId: "int-h", structured: { evidenceFound: "x", observedBehavior: "o", relatedProcedure: V171F_DOC_TITLE, recommendation: "r", processAssessment: JSON.parse(JSON.stringify(V171F_ASSESSMENT)) } } }
  const request: ReliableGenerationRequest = { organizationId: "org-h", enrollmentId: "enr-h", workflowId: "wf", workflowVersionId: "v", nodeId: "gerar", sourceNodeId: "orq", sourceType: "AGENT", domain: "MONITORING", sourceNodeOutput: source, collaboratorId: "op-h", interactionId: "int-h", indicatorMeasurementId: null, configuredAgentId: null }
  const result = await generateReliableFeedback(deps, request)
  const artifact = result.record.artifact!
  const deadline = artifact.items.find((item) => /Explicar prazo/.test(item.process?.requirement ?? ""))!
  const text = nodeOutputOf(result.record.id, artifact, artifact.items.map((item) => ({ itemIndex: item.index, status: "APPROVED_UNCHANGED" as const, finalWording: null }))).text
  return { store, artifact, deadline, text }
}
const fieldOf = (item: { writerFieldValidation?: { field: string; codes: string[]; action: string }[] }, field: string) => item.writerFieldValidation?.find((entry) => entry.field === field)

describe("V1.7.1h — degradação por campo do texto do redator", () => {
  it("G) fixture REAL do prazo: bom texto + exemplo com '5 dias úteis' → só o exemplo sai; diagnóstico, regra e 'Como aplicar' ficam; sem QA por isso", async () => {
    const { deadline, text } = await run()
    expect(REAL[0]!.suggestedResponse).toMatch(/5 dias úteis/)
    expect(deadline).toMatchObject({
      wordingSource: "WRITER", writerViolations: [],
      proposedWording: { observed: REAL[0]!.observed, whyItMatters: REAL[0]!.whyItMatters, whatYouCanDo: REAL[0]!.whatYouCanDo },
      knowledge: { applicability: "VERIFIED", operativeRule: { quote: "O operador deverá informar o prazo exibido na ferramenta." } },
      decision: { disposition: "READY", reasons: ["AUTONOMY_CRITERIA_MET"] },
    })
    expect(deadline.proposedWording!.suggestedResponse).toBeUndefined()
    expect(fieldOf(deadline, "suggestedResponse")).toEqual({ field: "suggestedResponse", codes: ["EXAMPLE_CONTENT_AS_FACT"], action: "DROPPED" })
    expect(text).toContain(REAL[0]!.whatYouCanDo)
    expect(text).not.toMatch(/5 dias|cinco dias|SMS/)
  })

  it("A) só o exemplo de condução inválido → item preservado e autônomo", async () => {
    const { deadline } = await run({ "Explicar prazo": { suggestedResponse: "Sua contestação foi registrada e o valor vai ser estornado na próxima conta." } })
    expect(deadline).toMatchObject({ wordingSource: "WRITER", decision: { disposition: "READY" }, proposedWording: { observed: REAL[0]!.observed } })
    expect(fieldOf(deadline, "suggestedResponse")).toMatchObject({ codes: expect.arrayContaining(["UNSUPPORTED_FACT"]), action: "DROPPED" })
  })

  it("B) 'Como aplicar' genérico com texto determinístico seguro → só esse campo vem do sistema", async () => {
    const { deadline } = await run({ "Explicar prazo": { whatYouCanDo: "Siga o procedimento nas próximas chamadas." } })
    expect(fieldOf(deadline, "whatYouCanDo")).toEqual({ field: "whatYouCanDo", codes: ["GENERIC_WORDING"], action: "FALLBACK_FIELD" })
    expect(deadline).toMatchObject({ wordingSource: "WRITER", decision: { disposition: "READY" }, proposedWording: { observed: REAL[0]!.observed, whyItMatters: REAL[0]!.whyItMatters, whatYouCanDo: "Na próxima chamada, informe o prazo exibido na ferramenta." } })
  })

  it("C) núcleo inválido ou afirmação central em qualquer campo → o item INTEIRO cai no texto de segurança (nada enfraquecido)", async () => {
    // Afirmação principal com efeito garantido.
    const core = await run({ "Explicar prazo": { observed: "Você deixou de informar o prazo, e isso garante que o cliente volte a ligar." } })
    expect(core.deadline).toMatchObject({ wordingSource: "FALLBACK", writerFieldValidation: [{ field: "observed", action: "INVALIDATED_ITEM" }], decision: { disposition: "HOLD_FOR_QA", reasons: expect.arrayContaining(["WRITER_FALLBACK_USED"]) } })
    // V1.7.1i — efeito garantido só no "por que importa" (complementar) sai com o campo; o núcleo fica (ver v171i).
    const effect = await run({ "Explicar prazo": { whyItMatters: "Informar o prazo garante que o cliente não reclame depois." } })
    expect(fieldOf(effect.deadline, "whyItMatters")).toMatchObject({ codes: ["GUARANTEED_EFFECT"], action: "DROPPED" })
    expect(effect.deadline.wordingSource).toBe("WRITER")
    // Número inventado no "Como aplicar" é regra inventada (não é exemplo rotulado) → item inteiro.
    const rule = await run({ "Explicar prazo": { whatYouCanDo: "Na próxima chamada, informe que a análise leva 10 dias." } })
    expect(fieldOf(rule.deadline, "whatYouCanDo")).toMatchObject({ codes: ["UNSUPPORTED_NUMBER"], action: "INVALIDATED_ITEM" })
    expect(rule.deadline.wordingSource).toBe("FALLBACK")
    // Ponto forte virando crítica no núcleo.
    const polarity = await run({ "Cancelar": { observed: "Você errou ao cancelar a recorrência sem necessidade." } })
    const cancel = polarity.artifact.items.find((item) => /Cancelar/.test(item.process?.requirement ?? ""))!
    expect(cancel).toMatchObject({ wordingSource: "FALLBACK", writerFieldValidation: [{ field: "observed", action: "INVALIDATED_ITEM" }] })
  })

  it("D) vários campos complementares inválidos com núcleo íntegro → núcleo do redator + campos do sistema/omitidos", async () => {
    const { deadline } = await run({ "Explicar prazo": { whatYouCanDo: "Procure ser mais claro nas orientações.", suggestedResponse: "O retorno chega por SMS em 5 dias úteis." } })
    expect(deadline.writerFieldValidation).toEqual([
      { field: "observed", codes: [], action: "KEPT" },
      { field: "whyItMatters", codes: [], action: "KEPT" },
      { field: "whatYouCanDo", codes: ["GENERIC_WORDING"], action: "FALLBACK_FIELD" },
      { field: "suggestedResponse", codes: expect.arrayContaining(["EXAMPLE_CONTENT_AS_FACT"]), action: "DROPPED" },
    ])
    expect(deadline).toMatchObject({ wordingSource: "WRITER", decision: { disposition: "READY" }, proposedWording: { observed: REAL[0]!.observed, whatYouCanDo: "Na próxima chamada, informe o prazo exibido na ferramenta." } })
  })

  it("E) fato que só existe em EXEMPLO nunca vaza: no exemplo sai o campo; no núcleo sai o item", async () => {
    const example = await run({ "Explicar prazo": { suggestedResponse: "A contestação foi registrada hoje e o retorno será enviado por SMS." } })
    expect(example.text).not.toMatch(/SMS/)
    const core = await run({ "Explicar prazo": { observed: "Você não informou que o retorno seria enviado por SMS." } })
    expect(core.deadline).toMatchObject({ wordingSource: "FALLBACK", writerFieldValidation: [{ field: "observed", codes: expect.arrayContaining(["EXAMPLE_CONTENT_AS_FACT"]), action: "INVALIDATED_ITEM" }] })
    expect(core.text).not.toMatch(/SMS/)
  })

  it("F) ações registradas por campo; o QA vê nos detalhes técnicos, o colaborador nunca", async () => {
    const { store, artifact, text } = await run()
    const review = store.reviews[0]!
    const context = { collaborator: { id: "op-h", name: "Larissa Monteiro", jobTitle: null }, team: null, occurredAt: null, createdAt: new Date("2026-09-25T21:13:00Z"), reviewerName: null, selection: { decision: artifact.items.find((item) => item.index === review.itemIndex)!.decision, deliveredAt: null } } as never
    const detail = toReliableReviewDetail(review, context, { artifact, reviews: store.reviews })
    const deadline = detail.feedbackPreview!.items.find((item) => item.technical.internalStep === "Explicar prazo")!
    expect(deadline.technical.fieldValidation).toEqual([{ field: "Exemplo de condução", action: "Removido (o ponto seguiu sem este campo)", reasons: [expect.any(String)] }])
    expect(text).not.toMatch(/Exemplo de condução|Removido|FALLBACK_FIELD|DROPPED|INVALIDATED/)
  })

  it("abertura/fechamento do redator inválidos → versão do sistema, sem levar pontos válidos ao QA", async () => {
    const { artifact } = await run({}, { introduction: "Analisei seu atendimento: você garante sempre o melhor acolhimento da demanda.", closing: "Parabéns, Roberto Serra!" })
    expect(artifact.presentation!.writerViolations.length).toBeGreaterThan(0)
    const ready = artifact.items.filter((item) => item.decision.disposition === "READY").length
    // V1.7.1k — 7: a lista "Verificar" também é pronta (texto do sistema só com os itens reconhecidos na fala).
    expect(ready).toBe(7)
  })
})
