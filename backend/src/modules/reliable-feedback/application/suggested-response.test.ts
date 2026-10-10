import { describe, expect, it } from "vitest"
import type { RawCheckpoint } from "../../agents/domain/process-assessment-contract.js"
import { createInMemoryReliableFeedbackStore } from "../infrastructure/in-memory-reliable-feedback-store.js"
import { unsupportedSuggestedContentOf } from "../infrastructure/publish-reliable-feedback.js"
import { generateReliableFeedback, type ReliableGenerationDeps, type ReliableGenerationRequest } from "./generate-reliable-feedback.js"
import { checkReliableHumanEdit, decideReliableReview } from "./decide-reliable-review.js"
import { RELIABLE_FEEDBACK_AUTONOMOUS_POLICY, RELIABLE_FEEDBACK_PILOT_POLICY, type ReliableFeedbackPolicy } from "../domain/reliable-feedback-item.js"
import { emittedItems, SUGGESTED_RESPONSE_LABEL, supportMaterialsOf, type EmittedItem } from "../domain/reliable-feedback-artifact.js"
import { projectMonitoringInputForModel, reliableWriterItemSchemaV3 } from "../domain/reliable-writer-prompts.js"
import { parseWriterResponse } from "../../interaction-feedback/domain/feedback-writer-prompt.js"
import type { MonitoringWriterInput } from "../domain/reliable-writer.js"
import { exampleContentAsFactIn, knowledgeContentKindOf, suggestedResponseScopeOf, suggestedResponseViolations } from "../domain/suggested-response.js"
import type { ReliableFeedbackWriterPort } from "./ports.js"
import {
  SMOKE_CHECKPOINTS,
  SMOKE_CONTENT,
  SMOKE_DETAIL,
  SMOKE_DETAIL_EXAMPLE,
  SMOKE_DOC,
  SMOKE_DOC_TITLE,
  SMOKE_INTERACTION,
  SMOKE_KB_EXAMPLE_PROTOCOL,
  SMOKE_LABEL,
  SMOKE_LINES,
  SMOKE_OPERATOR,
  SMOKE_ORG,
  smokeAssessment,
  smokePresented,
  smokePublished,
  smokeTranscript,
} from "../testing/contestacao-smoke-fixture.js"

/**
 * V1.7.1a — EXEMPLO DE CONDUÇÃO (§27) e teste de qualidade do caso da contestação (§29). Zero modelo: o redator é falso e
 * devolve, por etapa, o texto que cada cenário precisa. O que se testa é o CONTRATO: escopo, fontes, guardas, QA, publicação.
 */
type WriterText = { observed: string; whyItMatters: string | null; whatYouCanDo: string | null; suggestedResponse?: string | null }

/** V1.7.1h — validação por campo do texto do redator. */
const fieldOf = (item: { writerFieldValidation?: { field: string; codes: string[]; action: string }[] }, field: string) => item.writerFieldValidation?.find((entry) => entry.field === field)
const GOOD_EXAMPLE = "Registrei a sua contestação. O prazo da análise é o que aparece aqui na ferramenta, e eu já te informo qual é. Ficou claro como funciona o próximo passo?"
const BASE_TEXT: Record<string, WriterText> = {
  "Explicar prazo": { observed: "Ao orientar sobre a análise da contestação, você não explicou o prazo.", whyItMatters: null, whatYouCanDo: "Ao registrar a contestação, informe o prazo exibido na ferramenta.", suggestedResponse: GOOD_EXAMPLE },
  "Qual cobrança não reconhece": { observed: "Você perguntou qual cobrança não reconhece.", whyItMatters: null, whatYouCanDo: "Continue aplicando a etapa de identificar qual cobrança não reconhece.", suggestedResponse: null },
  "Registrar contestação": { observed: "Você declarou que registraria a contestação.", whyItMatters: null, whatYouCanDo: "Continue aplicando a etapa de registrar contestação.", suggestedResponse: null },
  "Registrar protocolo": { observed: "Você informou o registro do protocolo.", whyItMatters: null, whatYouCanDo: "Continue aplicando a etapa de registrar protocolo.", suggestedResponse: null },
}

function setup(options: { text?: Partial<Record<string, Partial<WriterText>>>; checkpoints?: RawCheckpoint[]; policy?: ReliableFeedbackPolicy } = {}) {
  const inputs: MonitoringWriterInput[] = []
  const writer: ReliableFeedbackWriterPort = {
    writeMonitoring: async (input) => {
      inputs.push(input)
      return { rawOutput: { items: input.items.map((item) => { const step = item.checkpoint!.stepTitle!; return { slot: item.slot, ...BASE_TEXT[step]!, ...(options.text?.[step] ?? {}) } }) } }
    },
    writeIndicator: async () => { throw new Error("não usado") },
  }
  const store = createInMemoryReliableFeedbackStore({ onReactivate: () => true })
  const deps: ReliableGenerationDeps = {
    enabled: true,
    store,
    writer,
    policy: options.policy ?? RELIABLE_FEEDBACK_AUTONOMOUS_POLICY,
    loadMonitoringContext: async (organizationId, interactionId, collaboratorId) => (organizationId === SMOKE_ORG && interactionId === SMOKE_INTERACTION && collaboratorId === SMOKE_OPERATOR ? { transcript: smokeTranscript(), label: SMOKE_LABEL, otherOperatorNames: [] } : null),
    loadIndicatorContext: async () => null,
    loadPublishedKnowledge: async (organizationId, ids) => new Map(organizationId === SMOKE_ORG ? [...smokePublished].filter(([id]) => ids.includes(id)) : []),
    loadIndicatorDiagnosisPlan: async () => null,
    loadPeerPracticeData: async () => ({ peers: [], observations: [] }),
    resolveDiagnosticStrategy: async () => null,
    now: () => new Date("2026-09-25T13:00:00Z"),
  }
  const source = {
    kind: "monitoring",
    knowledgeExcerpts: smokePresented,
    input: { organizationId: SMOKE_ORG, operatorId: SMOKE_OPERATOR, interactionId: SMOKE_INTERACTION, structured: { evidenceFound: SMOKE_LINES.identify, observedBehavior: "o", recommendation: "r", processAssessment: smokeAssessment(options.checkpoints) } },
  }
  const request: ReliableGenerationRequest = { organizationId: SMOKE_ORG, enrollmentId: "enr-example", workflowId: "wf", workflowVersionId: "v1", nodeId: "gerar-feedback", sourceNodeId: "agente", sourceType: "AGENT", domain: "MONITORING", sourceNodeOutput: source, collaboratorId: SMOKE_OPERATOR, interactionId: SMOKE_INTERACTION, indicatorMeasurementId: null, configuredAgentId: null }
  return { deps, request, store, inputs }
}
const run = async (options: Parameters<typeof setup>[0] = {}) => {
  const context = setup(options)
  const result = await generateReliableFeedback(context.deps, context.request)
  const byStep = (step: string) => result.record.artifact!.items.find((item) => item.process?.stepTitle === step)!
  return { ...context, result, byStep }
}
/** O caso inteiro liberado: os itens retidos (registro declarado e protocolo com regra só literal) aprovados no QA. */
const released = async (options: Parameters<typeof setup>[0] = {}) => {
  const context = await run(options)
  for (const review of context.store.reviews) await decideReliableReview({ store: context.store, now: context.deps.now }, { organizationId: SMOKE_ORG, reviewId: review.id, reviewerId: "qa-1", decision: "APPROVED_UNCHANGED" })
  const ready = await generateReliableFeedback(context.deps, context.request)
  expect(ready.nodeOutput.disposition).toBe("READY")
  return { ...context, result: ready }
}

describe("V1.7.1a — exemplo de condução: escopo, fontes e guardas (§27)", () => {
  it("A) regra + ação fundamentada + número da regra → exemplo válido", () => {
    const rule = "Informe que a análise da contestação é concluída em até 5 dias úteis."
    const scope = suggestedResponseScopeOf({
      domain: "MONITORING",
      section: "OPPORTUNITY",
      grounding: "OFFICIAL_PROCEDURE",
      process: { title: "P", requirement: "Informar prazo da análise", status: "NOT_FOLLOWED", checkpointRef: "P1.C1", evidenceType: "VERIFIED_OMISSION", stepTitle: "Informar prazo da análise" },
      knowledge: { documentId: SMOKE_DOC, documentTitle: SMOKE_DOC_TITLE, heading: "Prazo", version: 1, quote: rule, applicability: "VERIFIED", href: `/materiais/${SMOKE_DOC}` },
      facts: [{ role: "OPERADOR", text: "A área responsável analisa a contestação.", truncated: false, masked: false }],
    })
    expect(scope).toMatchObject({ allowed: true, notAllowedReason: null, ruleTexts: [rule] })
    expect(suggestedResponseViolations("Registrei a sua contestação, e a análise é concluída em até 5 dias úteis. Ficou claro como funciona o próximo passo?", scope)).toEqual([])
  })

  it("B) prazo que não está na fonte: o redator tenta → só o EXEMPLO sai (V1.7.1h: o resto do texto do redator fica)", async () => {
    const { byStep } = await run({ text: { "Explicar prazo": { suggestedResponse: "Registrei a sua contestação e o prazo da análise é de 5 dias úteis." } } })
    const deadline = byStep("Explicar prazo")
    expect(deadline).toMatchObject({ wordingSource: "WRITER", writerViolations: [], writerFieldValidation: expect.arrayContaining([{ field: "suggestedResponse", codes: expect.arrayContaining(["EXAMPLE_CONTENT_AS_FACT"]), action: "DROPPED" }]) })
    expect(deadline.proposedWording!.suggestedResponse ?? "").toBe("")
  })

  it("C) canal (SMS) e retorno que a regra não traz → rejeitados", async () => {
    const { byStep } = await run({ text: { "Explicar prazo": { suggestedResponse: "Registrei a sua contestação; o prazo aparece aqui na ferramenta e o retorno chega por SMS." } } })
    // V1.7.1g — o backfill traz a seção 35 (regra + falas-modelo): "SMS" passa a ser reconhecido como fato que só existe no EXEMPLO.
    expect(byStep("Explicar prazo")).toMatchObject({ wordingSource: "WRITER", writerFieldValidation: expect.arrayContaining([{ field: "suggestedResponse", codes: expect.arrayContaining(["EXAMPLE_CONTENT_AS_FACT"]), action: "DROPPED" }]) })
    expect(byStep("Explicar prazo").proposedWording!.suggestedResponse ?? "").not.toMatch(/SMS/)
  })

  it("D) promessa/efeito garantido no exemplo → rejeitado", async () => {
    const { byStep } = await run({ text: { "Explicar prazo": { suggestedResponse: "Registrei a sua contestação, e isso garante que o prazo da análise seja cumprido." } } })
    // V1.7.1i — efeito garantido só no EXEMPLO sai com o exemplo; o núcleo do redator fica.
    expect(fieldOf(byStep("Explicar prazo"), "suggestedResponse")).toMatchObject({ codes: expect.arrayContaining(["GUARANTEED_EFFECT"]), action: "DROPPED" })
    expect(byStep("Explicar prazo").proposedWording!.suggestedResponse ?? "").not.toMatch(/garante/)
    const promise = await run({ text: { "Explicar prazo": { suggestedResponse: "Registrei a contestação; o prazo aparece na ferramenta e o valor vai ser estornado." } } })
    // Promessa de estorno só no exemplo também derruba só o exemplo.
    expect(fieldOf(promise.byStep("Explicar prazo"), "suggestedResponse")).toMatchObject({ codes: expect.arrayContaining(["UNSUPPORTED_FACT"]), action: "DROPPED" })
  })

  it("E) exemplo da base (fala-modelo com número/canal/protocolo) nunca vira fato da chamada — em nenhum campo", async () => {
    expect(knowledgeContentKindOf(SMOKE_CONTENT, SMOKE_DETAIL_EXAMPLE)).toBe("EXAMPLE_CONTENT")
    expect(knowledgeContentKindOf(SMOKE_CONTENT, SMOKE_DETAIL)).toBe("RULE_CONTENT")
    expect(knowledgeContentKindOf(SMOKE_CONTENT, "Explicar prazo;")).toBe("RULE_CONTENT")
    // O especialista cita a FALA-MODELO do documento como "como cumprir": ela é verificada (literal), mas é EXEMPLO.
    const withExample = { ...SMOKE_CHECKPOINTS.deadline, knowledgeDetailQuote: SMOKE_DETAIL_EXAMPLE }
    const { byStep, inputs } = await run({ checkpoints: [SMOKE_CHECKPOINTS.identify, SMOKE_CHECKPOINTS.register, withExample, SMOKE_CHECKPOINTS.protocol], text: { "Explicar prazo": { suggestedResponse: "Registrei a sua contestação e ela será analisada em até cinco dias úteis." } } })
    const deadline = byStep("Explicar prazo")
    expect(deadline.knowledge).toMatchObject({ detail: { quote: SMOKE_DETAIL_EXAMPLE, contentKind: "EXAMPLE_CONTENT" } })
    expect(fieldOf(deadline, "suggestedResponse")).toMatchObject({ codes: expect.arrayContaining(["EXAMPLE_CONTENT_AS_FACT"]), action: "DROPPED" })
    expect(deadline.proposedWording!.suggestedResponse ?? "").not.toMatch(/cinco dias/)
    // O redator é avisado de que o detalhe é exemplo (ilustração, nunca fato).
    expect(projectMonitoringInputForModel(inputs[0]!).items.find((item) => (item.step as { topic: string }).topic === "Prazo da análise")).toMatchObject({ knowledge: { detailIsExample: true } })
    // Qualquer campo: o número do exemplo da base (protocolo do §48) nunca vira o protocolo desta chamada.
    const scope = { ruleTexts: ["Registrar protocolo."], exampleTexts: [`Seu protocolo é ${SMOKE_KB_EXAMPLE_PROTOCOL}.`], evidenceTexts: [SMOKE_LINES.protocol] }
    expect(exampleContentAsFactIn([`Você informou o protocolo ${SMOKE_KB_EXAMPLE_PROTOCOL} ao cliente.`, "", ""], scope)).toBe(true)
    expect(exampleContentAsFactIn(["Você informou o protocolo ao cliente.", "", ""], scope)).toBe(false)
  })

  it("F) VERIFIED_OMISSION com fundamento completo → exemplo aceito, AUTÔNOMO, rotulado como sugestão (não fala, não texto oficial)", async () => {
    const { byStep, result, inputs } = await released()
    const deadline = byStep("Explicar prazo")
    expect(deadline).toMatchObject({ process: { evidenceType: "VERIFIED_OMISSION" }, wordingSource: "WRITER", proposedWording: { suggestedResponse: GOOD_EXAMPLE }, decision: { disposition: "READY" } })
    expect(projectMonitoringInputForModel(inputs[0]!).items[0]).toMatchObject({ step: { topic: "Prazo da análise" }, conductExample: { allowed: true } })
    const emitted = result.nodeOutput.items.find((item) => item.process?.stepTitle === "Explicar prazo")!
    expect(emitted.suggestedResponse).toMatchObject({ text: GOOD_EXAMPLE, provenance: { generatedBy: "WRITER", groundingSources: expect.arrayContaining(["KNOWLEDGE_RULE", "KNOWLEDGE_DETAIL", "CHECKPOINT"]), knowledgeRuleRefs: [{ documentId: SMOKE_DOC }, { documentId: SMOKE_DOC, heading: "35. Prazo da análise" }], supportedFacts: ["prazo"] } })
    expect(result.nodeOutput.text).toContain(`**${SUGGESTED_RESPONSE_LABEL}** _(sugestão de como dizer — não é fala desta chamada nem texto oficial)_`)
    expect(result.nodeOutput.text).toContain("_“Registrei a sua contestação. O prazo da análise é o que aparece aqui na ferramenta")
  })

  it("G) sem fundamento suficiente → sem exemplo: ponto forte, sem orientação oficial, filler ou marcador de lacuna", async () => {
    // Ponto forte não tem exemplo (Para manter basta): o redator tenta → rejeitado.
    const strength = await run({ text: { "Qual cobrança não reconhece": { suggestedResponse: "Qual cobrança a senhora não reconhece na conta?" } } })
    expect(strength.byStep("Qual cobrança não reconhece")).toMatchObject({ wordingSource: "WRITER", writerFieldValidation: expect.arrayContaining([{ field: "suggestedResponse", codes: ["SUGGESTED_RESPONSE_NOT_ALLOWED"], action: "DROPPED" }]) })
    // Sem orientação oficial (NO_GROUNDED_GUIDANCE): o escopo não permite exemplo; o redator não o recebe como permitido.
    const noGuidance = { ...SMOKE_CHECKPOINTS.deadline, guidance: { source: "NO_GROUNDED_GUIDANCE" as const, text: null } }
    const ungrounded = await run({ checkpoints: [SMOKE_CHECKPOINTS.identify, SMOKE_CHECKPOINTS.register, noGuidance, SMOKE_CHECKPOINTS.protocol], text: { "Explicar prazo": { whatYouCanDo: null, suggestedResponse: null } } })
    expect(projectMonitoringInputForModel(ungrounded.inputs[0]!).items.find((item) => (item.step as { topic: string }).topic === "Prazo da análise")).toMatchObject({ conductExample: { allowed: false } })
    expect(ungrounded.byStep("Explicar prazo").proposedWording!.suggestedResponse ?? "").toBe("")
    // Filler no lugar da fala e marcador de lacuna são recusados.
    const filler = await run({ text: { "Explicar prazo": { suggestedResponse: "Procure explicar melhor o prazo da análise ao cliente." } } })
    expect(fieldOf(filler.byStep("Explicar prazo"), "suggestedResponse")!.codes).toEqual(expect.arrayContaining(["SUGGESTED_RESPONSE_NOT_SPEECH"]))
    const placeholder = await run({ text: { "Explicar prazo": { suggestedResponse: "Registrei a sua contestação e o prazo da análise é de [prazo]." } } })
    expect(fieldOf(placeholder.byStep("Explicar prazo"), "suggestedResponse")!.codes).toEqual(expect.arrayContaining(["SUGGESTED_RESPONSE_PLACEHOLDER"]))
  })

  it("H) QA não insere informação sem fonte no exemplo: bloqueado; exemplo fundamentado passa e fica com proveniência HUMAN_QA", async () => {
    // Sob PILOT_V1 o item vai ao QA com o exemplo proposto.
    const { store, deps, result } = await run({ policy: RELIABLE_FEEDBACK_PILOT_POLICY })
    const review = store.reviews.find((entry) => entry.reviewItem.process?.stepTitle === "Explicar prazo")!
    expect(review.proposedWording.suggestedResponse).toBe(GOOD_EXAMPLE)
    const base = { observed: review.proposedWording.observed, whyItMatters: "", whatYouCanDo: review.proposedWording.whatYouCanDo }
    for (const [example, code] of [
      // TYPED_NUMBER_GROUNDING_V1: "5 dias úteis" é o prazo do EXEMPLO da base ("cinco dias úteis") — atribuído a ele.
      ["Registrei a sua contestação; o prazo é de 5 dias úteis e o retorno vem por SMS.", "EXAMPLE_CONTENT_AS_FACT"],
      ["Registrei a sua contestação e o prazo aparece aqui; o crédito vem na próxima conta com desconto.", "UNSUPPORTED_FACT"],
      ["Registrei a sua contestação e isso garante o prazo da análise.", "GUARANTEED_EFFECT"],
    ] as const) {
      expect(checkReliableHumanEdit({ ...base, suggestedResponse: example }, review).blocking).toContain(code)
      const blocked = await decideReliableReview({ store, now: deps.now }, { organizationId: SMOKE_ORG, reviewId: review.id, reviewerId: "qa-1", decision: "APPROVED_EDITED", reasonCategory: "TOO_GENERIC", comment: "exemplo", finalWording: { ...base, suggestedResponse: example } })
      expect(blocked).toMatchObject({ ok: false, error: "EDIT_VIOLATES_CONTRACT" })
    }
    const edited = "Antes de encerrar: registrei a sua contestação e o prazo da análise é o que aparece aqui na ferramenta. Posso te passar agora?"
    const approved = await decideReliableReview({ store, now: deps.now }, { organizationId: SMOKE_ORG, reviewId: review.id, reviewerId: "qa-1", decision: "APPROVED_EDITED", reasonCategory: "TONE", comment: "fala mais natural", finalWording: { ...base, suggestedResponse: edited } })
    expect(approved).toMatchObject({ ok: true })
    // Só o exemplo mudou: o QA pode editar apenas ele (não é "igual ao proposto").
    expect(store.reviews.find((entry) => entry.id === review.id)!.finalWording).toMatchObject({ suggestedResponse: edited })
    const states = store.reviews.map((entry) => ({ itemIndex: entry.itemIndex, status: entry.reviewStatus, finalWording: entry.finalWording }))
    const emitted = emittedItems(result.record.artifact!, states).find((item) => item.process?.stepTitle === "Explicar prazo")!
    expect(emitted).toMatchObject({ wordingSource: "HUMAN_EDITED", suggestedResponse: { text: edited, provenance: { generatedBy: "HUMAN_QA" } } })
  })

  it("saída V3 do redator: a chave do exemplo pode faltar ou vir null (= sem exemplo); quando vem, chega ao pipeline", () => {
    const base = { itemRef: "ITEM_1", observed: "Você não explicou o prazo.", whyItMatters: null, whatYouCanDo: null }
    expect(parseWriterResponse(JSON.stringify({ items: [base] }), ["ITEM_1"], reliableWriterItemSchemaV3)).toMatchObject({ ok: true, output: { items: [{ slot: "ITEM_1", suggestedResponse: "" }] } })
    expect(parseWriterResponse(JSON.stringify({ items: [{ ...base, suggestedResponse: null }] }), ["ITEM_1"], reliableWriterItemSchemaV3)).toMatchObject({ ok: true, output: { items: [{ suggestedResponse: "" }] } })
    expect(parseWriterResponse(JSON.stringify({ items: [{ ...base, suggestedResponse: GOOD_EXAMPLE }] }), ["ITEM_1"], reliableWriterItemSchemaV3)).toMatchObject({ ok: true, output: { items: [{ suggestedResponse: GOOD_EXAMPLE }] } })
    expect(parseWriterResponse(JSON.stringify({ items: [{ ...base, extra: "x" }] }), ["ITEM_1"], reliableWriterItemSchemaV3)).toMatchObject({ ok: false, error: "WRITER_SCHEMA_INVALID" })
  })

  it("publicação: defesa final recusa exemplo sem fonte que chegou ao artefato (nada reescrito em silêncio)", async () => {
    const { result } = await released()
    const emitted = result.nodeOutput.items
    expect(unsupportedSuggestedContentOf(emitted)).toEqual([])
    const tampered: EmittedItem[] = emitted.map((item) => (item.process?.stepTitle === "Explicar prazo" ? { ...item, wording: { ...item.wording, suggestedResponse: "O prazo é de 5 dias úteis e o retorno vem por SMS." } } : item))
    expect(unsupportedSuggestedContentOf(tampered)).toEqual(expect.arrayContaining(["EXAMPLE_CONTENT_AS_FACT"]))
  })
})

describe("V1.7.1a — qualidade: o operador sabe COMO deveria ter conduzido (§29/§30: SAFE ≠ GOOD ENOUGH)", () => {
  it("contestação com VERIFIED_OMISSION em 'Explicar prazo': etapa, evidência da chamada, trecho da base, documento, orientação, exemplo e material", async () => {
    const { result } = await released()
    const deadline = result.nodeOutput.items.find((item) => item.process?.stepTitle === "Explicar prazo")!
    // Estrutura (não uma frase exata): cada peça que um supervisor mostraria está no item publicado.
    expect(deadline.process).toMatchObject({ stepTitle: "Explicar prazo", evidenceType: "VERIFIED_OMISSION" })
    expect(deadline.facts.some((fact) => fact.role === "OPERADOR" && fact.text === SMOKE_LINES.analysis)).toBe(true)
    expect(deadline.knowledge).toMatchObject({ documentTitle: SMOKE_DOC_TITLE, quote: "Explicar prazo;", leadIn: "Se o cliente não reconhecer:", detail: { quote: SMOKE_DETAIL }, href: `/materiais/${SMOKE_DOC}` })
    expect(deadline.grounding).toBe("OFFICIAL_PROCEDURE")
    expect(deadline.wording.whatYouCanDo.length).toBeGreaterThan(0)
    expect(deadline.suggestedResponse?.text.length ?? 0).toBeGreaterThan(0)
    expect(supportMaterialsOf(result.nodeOutput.items)).toEqual([expect.objectContaining({ materialId: SMOKE_DOC, reason: expect.stringContaining("Prazo da análise") })])
    // Evidência rica no artefato NUNCA some no texto que vai ao colaborador.
    const text = result.nodeOutput.text
    for (const piece of [`> Você disse: “${SMOKE_LINES.analysis}”`, "> “Se o cliente não reconhecer: … Explicar prazo;”", `> _Seção “Prazo da análise”:_ “${SMOKE_DETAIL}”`, `[Abrir processo ↗](/materiais/${SMOKE_DOC})`, "**Como melhorar:**", `**${SUGGESTED_RESPONSE_LABEL}**`]) expect(text).toContain(piece)
    expect(text).not.toContain(SMOKE_KB_EXAMPLE_PROTOCOL)
  })
})
