import { describe, expect, it } from "vitest"
import { createInMemoryReliableFeedbackStore } from "../infrastructure/in-memory-reliable-feedback-store.js"
import { generateReliableFeedback, type ReliableGenerationDeps, type ReliableGenerationRequest } from "./generate-reliable-feedback.js"
import { decideReliableReview } from "./decide-reliable-review.js"
import { RELIABLE_FEEDBACK_PILOT_POLICY } from "../domain/reliable-feedback-item.js"
import { firstNameOf, presentationViolations, systemPresentation } from "../domain/feedback-presentation.js"
import { projectMonitoringInputForModel } from "../domain/reliable-writer-prompts.js"
import type { EmittedItem } from "../domain/reliable-feedback-artifact.js"
import type { MonitoringWriterInput } from "../domain/reliable-writer.js"
import type { ReliableFeedbackWriterPort } from "./ports.js"
import { SMOKE_INTERACTION, SMOKE_LABEL, SMOKE_LINES, SMOKE_OPERATOR, SMOKE_ORG, smokeAssessment, smokePresented, smokePublished, smokeTranscript } from "../testing/contestacao-smoke-fixture.js"

/**
 * V1.7.1b (§25) — APRESENTAÇÃO PESSOAL: saudação com o primeiro nome do CADASTRO (nunca do modelo), abertura e fechamento de
 * supervisor validados contra os itens que realmente saem. Zero modelo: o redator é falso.
 */
const TEXT: Record<string, { observed: string; whyItMatters: string | null; whatYouCanDo: string | null; suggestedResponse?: string | null }> = {
  "Explicar prazo": { observed: "Ao orientar sobre a análise da contestação, você não explicou o prazo.", whyItMatters: null, whatYouCanDo: "Ao registrar a contestação, informe o prazo exibido na ferramenta.", suggestedResponse: "Registrei a sua contestação. O prazo da análise é o que aparece aqui na ferramenta. Ficou claro o próximo passo?" },
  "Qual cobrança não reconhece": { observed: "Você perguntou qual cobrança não reconhece.", whyItMatters: null, whatYouCanDo: "Continue aplicando a etapa “Qual cobrança não reconhece”." },
  "Registrar contestação": { observed: "Você declarou que registraria a contestação.", whyItMatters: null, whatYouCanDo: "Continue aplicando a etapa “Registrar contestação”." },
  "Registrar protocolo": { observed: "Você informou o registro do protocolo.", whyItMatters: null, whatYouCanDo: "Continue aplicando a etapa “Registrar protocolo”." },
}
const GOOD = {
  introduction: "Analisei seu atendimento de contestação de cobrança. Você conduziu bem etapas como identificar qual cobrança não reconhece e registrar a contestação. Também identifiquei uma oportunidade na etapa de explicar o prazo. Vou te mostrar o que aconteceu e como conduzir esse momento nas próximas chamadas.",
  closing: "No geral, você conduziu bem a identificação da cobrança e o registro da contestação. O principal ajuste para os próximos atendimentos é explicar o prazo.",
}

function setup(presentation: { introduction: string; closing: string } | null = GOOD, options: { firstName?: string | null } = {}) {
  const inputs: MonitoringWriterInput[] = []
  const writer: ReliableFeedbackWriterPort = {
    writeMonitoring: async (input) => {
      inputs.push(input)
      return { rawOutput: { items: input.items.map((item) => ({ slot: item.slot, ...TEXT[item.checkpoint!.stepTitle!]! })), ...(presentation ? { presentation } : {}) } }
    },
    writeIndicator: async () => { throw new Error("não usado") },
  }
  const deps: ReliableGenerationDeps = {
    enabled: true,
    store: createInMemoryReliableFeedbackStore({ onReactivate: () => true }),
    writer,
    policy: RELIABLE_FEEDBACK_PILOT_POLICY,
    loadMonitoringContext: async () => ({ transcript: smokeTranscript(), label: SMOKE_LABEL, otherOperatorNames: [] }),
    loadIndicatorContext: async () => null,
    loadPublishedKnowledge: async () => smokePublished,
    loadIndicatorDiagnosisPlan: async () => null,
    loadPeerPracticeData: async () => ({ peers: [], observations: [] }),
    resolveDiagnosticStrategy: async () => null,
    loadRecipient: async (organizationId, collaboratorId) => (options.firstName === null ? null : organizationId === SMOKE_ORG && collaboratorId === SMOKE_OPERATOR ? { firstName: options.firstName ?? "Rafael" } : null),
    now: () => new Date("2026-09-25T13:00:00Z"),
  }
  const source = { kind: "monitoring", knowledgeExcerpts: smokePresented, input: { organizationId: SMOKE_ORG, operatorId: SMOKE_OPERATOR, interactionId: SMOKE_INTERACTION, structured: { evidenceFound: SMOKE_LINES.identify, observedBehavior: "o", recommendation: "r", processAssessment: smokeAssessment() } } }
  const request: ReliableGenerationRequest = { organizationId: SMOKE_ORG, enrollmentId: "enr-pres", workflowId: "wf", workflowVersionId: "v1", nodeId: "gerar", sourceNodeId: "agente", sourceType: "AGENT", domain: "MONITORING", sourceNodeOutput: source, collaboratorId: SMOKE_OPERATOR, interactionId: SMOKE_INTERACTION, indicatorMeasurementId: null, configuredAgentId: null }
  return { deps, request, inputs }
}
/** Gera e aprova no QA (piloto) o que for indicado — o resto é rejeitado; devolve a saída READY. */
async function released(context: ReturnType<typeof setup>, reject: (step: string | null) => boolean = () => false) {
  const first = await generateReliableFeedback(context.deps, context.request)
  for (const review of first.reviews) {
    const step = review.reviewItem.process?.stepTitle ?? null
    await decideReliableReview({ store: context.deps.store, now: context.deps.now }, reject(step) ? { organizationId: SMOKE_ORG, reviewId: review.id, reviewerId: "qa", decision: "REJECTED", reasonCategory: "OTHER" } : { organizationId: SMOKE_ORG, reviewId: review.id, reviewerId: "qa", decision: "APPROVED_UNCHANGED" })
  }
  return generateReliableFeedback(context.deps, context.request)
}

describe("V1.7.1b — apresentação pessoal (§25)", () => {
  // V1.7.2 — na monitoria de PROCESSO a abertura/fechamento exibidos são os de supervisor (compostos dos itens que saem); o rascunho
  // do redator continua guardado no artefato (auditoria) e o validador continua o mesmo — ele só não é mais a abertura exibida.
  const contextOf = (firstName: string | null = "Rafael") => ({ domain: "MONITORING" as const, label: SMOKE_LABEL, firstName })
  it("A) o primeiro nome do CADASTRO abre o feedback; o nome nunca vai ao modelo; o rascunho do redator fica só na auditoria", async () => {
    const context = setup()
    const result = await released(context)
    // Feedback por Flag V2 — narrativa de supervisor (sem redator de narrativa neste teste = versão do sistema); o nome do CADASTRO.
    expect(result.nodeOutput.presentation).toMatchObject({ greeting: "Olá, Rafael!", source: "SYSTEM", version: "NATURAL_SUPERVISOR_FEEDBACK_V1", firstName: "Rafael" })
    expect(result.record.artifact!.presentation).toMatchObject({ recipient: { firstName: "Rafael" }, writerDraft: GOOD })
    const text = result.nodeOutput.text
    expect(text.indexOf("Rafael")).toBeLessThan(text.indexOf("## O que precisa ser ajustado"))
    expect(text.indexOf("Entenda este feedback")).toBeLessThan(text.indexOf("**Materiais utilizados**"))
    expect(text).not.toContain(GOOD.introduction)
    expect(JSON.stringify(projectMonitoringInputForModel(context.inputs[0]!))).not.toContain("Rafael")
    expect(context.inputs[0]!.presentation).toMatchObject({ developmentSteps: ["Prazo da análise"], strengthSteps: ["Identificação da cobrança", "Registro da contestação", "Registro de protocolo"], attentionPoints: 0 })
    expect(firstNameOf("Rafael Souza Lima")).toBe("Rafael")
    expect(firstNameOf("  ")).toBeNull()
    // Sem nome no cadastro: saudação neutra, nunca um nome inventado.
    const anonymous = await released(setup(GOOD, { firstName: null }))
    expect(anonymous.nodeOutput.presentation!.greeting).toBe("Olá!")
  })

  it("B) nome (ou tratamento com gênero) no rascunho do redator: o validador recusa e o texto nunca chega ao colaborador", async () => {
    for (const introduction of ["Olá, Rodrigo! Analisei seu atendimento de contestação de cobrança.", "Prezado, analisei seu atendimento de contestação de cobrança.", "Analisei o atendimento que Rodrigo conduziu sobre a contestação de cobrança."]) {
      const result = await released(setup({ introduction, closing: GOOD.closing }))
      expect(result.nodeOutput.presentation).toMatchObject({ greeting: "Olá, Rafael!", source: "SYSTEM" })
      expect(presentationViolations({ introduction, closing: GOOD.closing }, result.nodeOutput.items, contextOf()).some((code) => code === "PRESENTATION_NAME" || code === "PRESENTATION_TREATMENT")).toBe(true)
      expect(result.nodeOutput.text).not.toContain("Rodrigo")
    }
  })

  it("C) ponto forte inexistente ou elogio a uma etapa a desenvolver: recusado pelo validador; a abertura exibida só fala do que saiu", async () => {
    const result = await released(setup())
    expect(presentationViolations({ introduction: "Analisei seu atendimento. Você conduziu bem a portabilidade do número.", closing: GOOD.closing }, result.nodeOutput.items, contextOf())).toContain("PRESENTATION_UNSUPPORTED_CLAIM")
    expect(presentationViolations({ introduction: "Analisei seu atendimento de contestação de cobrança. Você explicou bem o prazo.", closing: GOOD.closing }, result.nodeOutput.items, contextOf())).toContain("PRESENTATION_POLARITY_MISMATCH")
    // O QA rejeitou o protocolo: a abertura, o "O que manter" e o card do supervisor não falam dele.
    const rejected = await released(setup(), (step) => step === "Registrar protocolo")
    expect(rejected.nodeOutput.presentation!.introduction).not.toMatch(/protocolo/i)
    expect(rejected.nodeOutput.presentation!.card).not.toMatch(/protocolo/i)
    expect(rejected.nodeOutput.text.slice(rejected.nodeOutput.text.indexOf("## O que manter"))).not.toMatch(/informou o protocolo/i)
  })

  it("D) causa/efeito (TMA, garante) ou culpa no fechamento do redator: recusado; o fechamento exibido é o do supervisor", async () => {
    const result = await released(setup())
    for (const [closing, code] of [
      ["Com isso, você vai reduzir o seu TMA nos próximos atendimentos.", "CAUSAL_CLAIM"],
      ["Registrar a contestação garante o encaminhamento correto.", "GUARANTEED_EFFECT"],
      ["O erro no prazo precisa de atenção.", "PRESENTATION_BLAME"],
    ] as const) expect(presentationViolations({ introduction: GOOD.introduction, closing }, result.nodeOutput.items, contextOf())).toContain(code)
    expect(result.nodeOutput.presentation!.closing).not.toMatch(/TMA|garante|erro/)
  })

  it("E) sem ponto de desenvolvimento, o fechamento do sistema é só positivo e factual (nada de 'ajuste')", () => {
    const strength = (index: number, step: string): EmittedItem => ({ index, section: "STRENGTH", sectionLabel: "Ponto forte", wording: { observed: `Você cumpriu a etapa “${step}”.`, whyItMatters: "", whatYouCanDo: "" }, wordingSource: "PROPOSED", qaStatus: "NOT_SELECTED_FOR_QA", facts: [], knowledge: null, grounding: "OFFICIAL_PROCEDURE", process: { title: "P", requirement: step, status: "FOLLOWED", checkpointRef: `P1.C${index}`, evidenceType: "OBSERVED_ACTION", stepTitle: step } })
    const items = [strength(0, "Registrar contestação"), strength(1, "Registrar protocolo")]
    const context = { domain: "MONITORING" as const, label: SMOKE_LABEL, firstName: "Rafael" }
    const system = systemPresentation(items, context)
    // V1.7.1d — frases naturais, sem listar trechos crus. V1.7.1e — fala de PONTOS, não de "etapas".
    expect(system.introduction).toBe("Analisei seu atendimento de 25/09/2026 sobre contestação de cobrança. Você conduziu bem 2 pontos da tratativa. Abaixo estão as evidências da chamada, o que o procedimento orienta e como aplicar nas próximas chamadas.")
    expect(system.closing).toBe("No geral, você conduziu bem 2 pontos da tratativa. Continue aplicando o procedimento nos próximos atendimentos.")
    expect(system.closing).not.toMatch(/ajuste|oportunidade/)
    expect(presentationViolations(system, items, context)).toEqual([])
  })
})
