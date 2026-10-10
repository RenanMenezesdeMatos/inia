import { describe, expect, it } from "vitest"
import { createInMemoryReliableFeedbackStore } from "../infrastructure/in-memory-reliable-feedback-store.js"
import { generateReliableFeedback, type ReliableGenerationDeps } from "./generate-reliable-feedback.js"
import type { ReliableFeedbackWriterPort } from "./ports.js"
import { RELIABLE_FEEDBACK_AUTONOMOUS_POLICY } from "../domain/reliable-feedback-item.js"
import { emittedItems, nodeOutputOf, presentationOf, renderFeedbackDocument, renderPublishedNarrative, type EmittedItem } from "../domain/reliable-feedback-artifact.js"
import { verifyProcessAssessments } from "../domain/process-assessment.js"
import { supervisorPresentationOf } from "../domain/supervisor-presentation.js"
import { observationsFrom } from "../../indicator-diagnosis/domain/process-patterns.js"
import { V171O_ASSESSMENT, V171O_COLLABORATOR_NAME, V171O_DOC_TITLE, V171O_PRESENTED, V171O_PUBLISHED, V171O_SUBJECT, V171O_TRANSCRIPT, V171O_WRITER_RAW, V171O_WRITER_SLOTS } from "../testing/contestacao-v171o-smoke-fixture.js"

/**
 * V1.7.2 — APRESENTAÇÃO DE SUPERVISOR (só apresentação; diagnóstico, observações, analytics, checkpointRefs e QA intocados).
 * A–E sobre itens sintéticos e o replay do smoke REAL da V1.7.1o (ANTES × DEPOIS).
 */
const LABEL = "Atendimento de 28/09/2026 · Contestação de cobrança"
const DOC = "doc-1"
const BEHAVIOR_TITLE: Record<string, string> = {
  IDENTIFY_CHARGE: "Identificação da cobrança", CHECK_PAYMENT: "Verificação do pagamento", VALIDATE_HOLDER: "Validação do titular", REGISTER_DISPUTE: "Registro da contestação",
  CANCEL_RECURRING_SERVICE: "Cancelamento da recorrência", PROVIDE_PROTOCOL: "Protocolo", CONFIRM_UNDERSTANDING: "Confirmação de entendimento", CONFIRM_SOLUTION: "Confirmação da solução aplicada",
  INFORM_DEADLINE: "Prazo da análise", RECAPITULATE_INTERACTION: "Recapitulação", OPEN_ANALYSIS: "Abertura de análise",
}
let next = 0
function item(section: "STRENGTH" | "OPPORTUNITY", code: string | null, options: { observed?: string; required?: boolean; line?: string; heading?: string; quote?: string } = {}): EmittedItem {
  const index = next++
  return {
    index, domain: "MONITORING", section, sectionLabel: section === "STRENGTH" ? "Ponto forte" : "Ponto de desenvolvimento",
    wording: { observed: options.observed ?? (section === "STRENGTH" ? `Você cumpriu ${code ?? "a etapa"}.` : `Você deixou de ${code ?? "fazer a etapa"} nesta chamada.`), whyItMatters: "", whatYouCanDo: "" },
    wordingSource: "PROPOSED", qaStatus: "NOT_SELECTED_FOR_QA",
    facts: [{ role: "OPERADOR", text: options.line ?? `Fala ${index}.`, truncated: false, masked: false }],
    knowledge: { documentId: DOC, documentTitle: "Procedimento", heading: options.heading ?? `${index}. Seção ${index}`, version: 1, quote: options.quote ?? `O operador deverá fazer a etapa ${index}.`, applicability: "VERIFIED", href: `/materiais/${DOC}`, contentKind: "RULE_CONTENT" },
    grounding: "OFFICIAL_PROCEDURE",
    process: { title: "Procedimento", requirement: `Etapa ${index}`, status: section === "STRENGTH" ? "FOLLOWED" : "NOT_FOLLOWED", checkpointRef: `CP-${index}`, evidenceType: "OBSERVED_ACTION", stepTitle: `Etapa ${index}`, ...(code ? { behavior: { code, title: BEHAVIOR_TITLE[code] ?? code, facets: [], conflict: false, sources: [] } } : {}), sourceCheckpoint: { ref: `CP-${index}`, kind: "LIST_ITEM", coverageRequirement: options.required ? "REQUIRED" : "OPTIONAL", quoteMatch: "EXACT", origin: "MODEL" } },
  }
}
const render = (items: readonly EmittedItem[]) => {
  const presentation = supervisorPresentationOf(items, LABEL)
  const parts = renderFeedbackDocument(items, [], { presentation: { version: "SUPERVISOR_PRESENTATION_V2", greeting: "Olá, Larissa!", introduction: presentation.introduction, closing: presentation.closing, source: "SYSTEM", violations: [], card: presentation.card } })
  return { presentation, parts, text: parts.map((part) => part.markdown).join("\n\n") }
}
const SCOREBOARD = /\d+\s+pontos?\s+(?:fortes?|a desenvolver|corretos?)|\d+\s+etapas?\s+cumpridas?|pontos? fortes|Visão geral/i
const correct = () => [
  item("STRENGTH", "VALIDATE_HOLDER"), item("STRENGTH", "IDENTIFY_CHARGE"), item("STRENGTH", "CHECK_PAYMENT"), item("STRENGTH", "CANCEL_RECURRING_SERVICE"),
  item("STRENGTH", "REGISTER_DISPUTE"), item("STRENGTH", "PROVIDE_PROTOCOL"), item("STRENGTH", "CONFIRM_UNDERSTANDING"), item("STRENGTH", "CONFIRM_SOLUTION"),
]

describe("V1.7.2 — A18) composição de supervisor", () => {
  it("A) 1 ajuste + 8 corretos → 1 bloco detalhado + \"O que manter\" em um parágrafo (nunca 8 blocos)", () => {
    const gap = item("OPPORTUNITY", "INFORM_DEADLINE", { observed: "Você disse que a análise dependia da área, sem informar o prazo.", quote: "O operador deverá informar o prazo exibido na ferramenta.", line: "Aí é só aguardar a análise." })
    const { text, parts, presentation } = render([gap, ...correct()])
    expect([...text.matchAll(/^### (.+)$/gm)].map((match) => match[1])).toEqual(["Prazo da análise"])
    expect(text).toContain("## O que ajustar")
    expect(text).toContain("**Na chamada**\n\n> Você disse: “Aí é só aguardar a análise.”")
    const maintain = parts.find((part) => part.label === "O que manter")!
    expect(maintain.itemIndexes).toHaveLength(8)
    expect(maintain.markdown).toBe("Na investigação do caso, você validou o titular da linha, identificou a cobrança que o cliente não reconhecia e verificou se a conta já tinha sido paga. Na tratativa, você cancelou a recorrência do serviço e registrou a contestação. No encerramento, você informou o protocolo, verificou se o cliente tinha dúvidas e retomou a solução aplicada.")
    expect(text).not.toMatch(SCOREBOARD)
    expect(text).not.toContain("**O que você fez bem**")
    // A4/A5 — a abertura diz O QUE aconteceu (frase validada do ponto) e o que o processo esperava (regra oficial).
    expect(presentation.introduction).toBe("Seu atendimento de 28/09/2026 sobre contestação de cobrança foi bem conduzido na investigação do caso e na tratativa.\n\nO principal ajuste está em “Prazo da análise”. Você disse que a análise dependia da área, sem informar o prazo. O procedimento orienta: “O operador deverá informar o prazo exibido na ferramenta.”")
    // A14 — card curto, 2 frases, a partir dos achados reais.
    expect(presentation.card).toBe("Seu atendimento foi bem conduzido na investigação do caso e na tratativa, mas o prazo da análise não foi informado ao cliente. No feedback completo você encontra a evidência, a orientação do processo e como ajustar.")
    // A15 — fechamento sem contagem, priorizando o ajuste.
    expect(presentation.closing).toBe("No geral, a tratativa foi bem conduzida. Para as próximas chamadas, o ajuste é em “Prazo da análise”.")
  })

  it("B) 0 ajustes + 10 corretos → feedback curto de conformidade, sem \"10 pontos fortes\"", () => {
    const { text, presentation } = render([...correct(), item("STRENGTH", "INFORM_DEADLINE"), item("STRENGTH", "RECAPITULATE_INTERACTION")])
    expect(text).not.toContain("## O que ajustar")
    expect(text.match(/^### /gm)).toBeNull()
    expect(text).not.toMatch(SCOREBOARD)
    expect(presentation.introduction).toBe("Seu atendimento de 28/09/2026 sobre contestação de cobrança foi conduzido conforme o procedimento, na investigação do caso, na tratativa e no encerramento. Abaixo está o que manter nas próximas chamadas.")
    expect(presentation.closing).toBe("Continue conduzindo os atendimentos dessa forma.")
    expect(presentation.card.split(/(?<=\.)\s+/)).toHaveLength(2)
  })

  it("C) 4 ajustes + 7 corretos → os 4 ajustes detalhados (nada escondido) + corretos resumidos; fechamento prioriza", () => {
    const gaps = [
      item("OPPORTUNITY", "INFORM_DEADLINE", { observed: "Você não informou o prazo." }),
      item("OPPORTUNITY", "PROVIDE_PROTOCOL", { observed: "Você não informou o protocolo." }),
      item("OPPORTUNITY", "CONFIRM_UNDERSTANDING", { observed: "Você encerrou sem perguntar se havia dúvidas." }),
      item("OPPORTUNITY", null, { observed: "Você não conferiu o endereço.", heading: "9. Confirmação de endereço" }),
    ]
    const { text, presentation } = render([...gaps, ...correct().slice(0, 7)])
    expect([...text.matchAll(/^### (.+)$/gm)].map((match) => match[1])).toEqual(["Prazo da análise", "Protocolo", "Confirmação de entendimento", "Confirmação de endereço"])
    expect(presentation.introduction).toContain("Também vale ajustar “Protocolo”, “Confirmação de entendimento” e “Confirmação de endereço”, detalhados abaixo.")
    expect(presentation.closing).toBe("No geral, a tratativa foi bem conduzida. Para as próximas chamadas, concentre-se primeiro em “Prazo da análise” e, depois, nos demais ajustes acima.")
    expect(presentation.card).toBe("Seu atendimento foi bem conduzido na investigação do caso e na tratativa, mas o prazo da análise não foi informado ao cliente, o protocolo não foi informado e há outros ajustes. No feedback completo você encontra a evidência, a orientação do processo e como ajustar.")
    expect(text).not.toMatch(SCOREBOARD)
  })

  it("D) ponto cumprido CRÍTICO (etapa obrigatória da análise) mantém bloco individual; os comuns continuam resumidos", () => {
    const recap = item("STRENGTH", "RECAPITULATE_INTERACTION", { required: true, observed: "Você recapitulou o atendimento com todos os itens previstos.", line: "Resumindo: …" })
    const { text, parts } = render([recap, ...correct()])
    expect([...text.matchAll(/^### (.+)$/gm)].map((match) => match[1])).toEqual(["Recapitulação"])
    expect(text).toContain("### Recapitulação\n\n**O que você fez bem**\n\nVocê recapitulou o atendimento com todos os itens previstos.")
    expect(parts.find((part) => part.label === "O que manter")!.markdown).not.toContain("recapitulou")
  })

  it("cauda longa: ponto cumprido sem comportamento canônico usa a frase já validada dele (nenhum código novo por regra)", () => {
    const longTail = item("STRENGTH", null, { observed: "Você confirmou se haveria uma pessoa maior de idade no endereço para receber o técnico." })
    const { parts } = render([longTail])
    expect(parts.find((part) => part.label === "O que manter")!.markdown).toBe("Você confirmou se haveria uma pessoa maior de idade no endereço para receber o técnico.")
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// A19 — replay REAL (V1.7.1o): ANTES × DEPOIS, só a apresentação muda
// ---------------------------------------------------------------------------------------------------------------------
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
async function replay() {
  const store = createInMemoryReliableFeedbackStore({ onReactivate: () => true })
  const bySlot = new Map(V171O_WRITER_RAW.items.map((entry) => [entry.slot, entry]))
  const writer: ReliableFeedbackWriterPort = {
    writeMonitoring: async (input) => ({ rawOutput: { items: input.items.flatMap((entry) => { const original = bySlot.get(V171O_WRITER_SLOTS[entry.requirement ?? ""] ?? ""); return original ? [{ ...original, slot: entry.slot }] : [] }), presentation: V171O_WRITER_RAW.presentation } }),
    writeIndicator: async () => { throw new Error("não usado") },
  }
  const deps: ReliableGenerationDeps = {
    enabled: true, store, writer, policy: RELIABLE_FEEDBACK_AUTONOMOUS_POLICY,
    loadMonitoringContext: async () => ({ transcript: V171O_TRANSCRIPT, label: `Atendimento de 28/09/2026 · ${V171O_SUBJECT}`, otherOperatorNames: [], subjectOperatorName: V171O_COLLABORATOR_NAME }),
    loadIndicatorContext: async () => null, loadPublishedKnowledge: async () => V171O_PUBLISHED, loadIndicatorDiagnosisPlan: async () => null,
    loadPeerPracticeData: async () => ({ peers: [], observations: [] }), resolveDiagnosticStrategy: async () => null,
    loadRecipient: async () => ({ firstName: "Larissa" }), now: () => new Date("2026-09-28T12:00:00Z"),
  }
  const source = { kind: "monitoring", knowledgeExcerpts: V171O_PRESENTED, input: { organizationId: "org", operatorId: "op", interactionId: "int", structured: { evidenceFound: "x", observedBehavior: "o", relatedProcedure: V171O_DOC_TITLE, recommendation: "r", processAssessment: clone(V171O_ASSESSMENT) } } }
  const result = await generateReliableFeedback(deps, { organizationId: "org", enrollmentId: "enr", workflowId: "wf", workflowVersionId: "v1", nodeId: "gerar", sourceNodeId: "orq", sourceType: "AGENT", domain: "MONITORING", sourceNodeOutput: source, collaboratorId: "op", interactionId: "int", indicatorMeasurementId: null, configuredAgentId: null })
  return { result, artifact: result.record.artifact!, store }
}

describe("V1.7.2 — A19) replay REAL do smoke V1.7.1o: ANTES × DEPOIS", () => {
  it("só a apresentação muda: diagnóstico, observações, analytics, checkpointRefs e QA idênticos", async () => {
    const { result, artifact, store } = await replay()
    const frozen = JSON.stringify(artifact)
    const items = emittedItems(artifact, [])
    const before = renderPublishedNarrative(items, [], { presentation: presentationOf(artifact, items, { legacy: true }), legacyComposition: true })
    const output = nodeOutputOf(result.record.id, artifact, [])
    // A composição V1.7.2 continua disponível para comparação (a de produção agora é a narrativa V2 — feedback-view-v2.test.ts).
    const v172 = presentationOf(artifact, output.items, { supervisorV172: true })
    const after = renderPublishedNarrative(output.items, [], { presentation: v172 })
    // ANTES: placar e um bloco por ponto forte; DEPOIS: abertura concreta, 2 ajustes, "O que manter", card.
    expect(before).toMatch(/Visão geral:.*2 pontos a desenvolver e 8 pontos fortes/)
    expect(before.match(/^### /gm)).toHaveLength(10)
    expect(after).not.toMatch(SCOREBOARD)
    expect([...after.matchAll(/^### (.+)$/gm)].map((match) => match[1])).toEqual(["Prazo da análise", "Recapitulação obrigatória"])
    expect(after).toContain("## O que manter\n\nNa investigação do caso, você identificou a cobrança que o cliente não reconhecia, verificou se a conta já tinha sido paga e conferiu dados como data de ativação e cobranças anteriores. Na tratativa, você informou ao cliente o cancelamento da recorrência e o registro da contestação. No encerramento, você verificou se o cliente tinha dúvidas, retomou a solução aplicada e informou o protocolo.")
    expect(v172).toMatchObject({ version: "SUPERVISOR_PRESENTATION_V2", greeting: "Olá, Larissa!", source: "SYSTEM" })
    expect(v172!.introduction).toContain("O principal ajuste está em “Prazo da análise”. Você informou ao cliente que não era possível fornecer um prazo específico para a análise, dependendo da avaliação da área. O procedimento orienta: “O operador deverá informar o prazo exibido na ferramenta.”")
    expect(v172!.card).toBe("Seu atendimento foi bem conduzido na investigação do caso e na tratativa, mas o prazo da análise não foi informado ao cliente e a recapitulação não trouxe todos os pontos previstos. No feedback completo você encontra a evidência, a orientação do processo e como ajustar.")
    // Renderizar (antes e depois) nunca muda o artefato.
    expect(JSON.stringify(artifact)).toBe(frozen)
    // Diagnóstico, QA e analytics: os mesmos da V1.7.1p.
    expect(artifact.findings).toMatchObject({ detected: 10, reliable: 10, inFeedback: 10, heldForQa: 0, blocked: 0 })
    expect(store.reviews).toEqual([])
    const verified = verifyProcessAssessments({ sources: [{ sourceRef: "S", assessment: clone(V171O_ASSESSMENT), presented: V171O_PRESENTED }], interactionId: "int", transcript: V171O_TRANSCRIPT, published: V171O_PUBLISHED, subject: V171O_SUBJECT, coveragePlan: true })
    const observations = observationsFrom("op", [{ interactionId: "int", assessment: verified }])
    expect(observations.map((observation) => [observation.canonicalBehavior, observation.checkpointRef, observation.status, observation.analyticsStatus, observation.completeness ?? null])).toEqual([
      ["IDENTIFY_CHARGE", "CP-4a48ba4db9", "FOLLOWED", "VERIFIED", null],
      ["CHECK_PAYMENT", "CP-8651ee6f0b", "FOLLOWED", "VERIFIED", null],
      ["CANCEL_RECURRING_SERVICE", "CP-b9a41387af", "FOLLOWED", "VERIFIED", null],
      ["REGISTER_DISPUTE", "CP-a91b89a0e2", "FOLLOWED", "VERIFIED", null],
      ["INFORM_DEADLINE", "CP-a60913570d", "NOT_FOLLOWED", "VERIFIED", null],
      ["RECAPITULATE_INTERACTION", "CP-08ba2d72ba", "NOT_FOLLOWED", "VERIFIED", "PARTIAL"],
      ["CONFIRM_UNDERSTANDING", "CP-c8acf59578", "FOLLOWED", "VERIFIED", null],
      ["CONFIRM_SOLUTION", "CP-b9db6af3ba", "FOLLOWED", "VERIFIED", null],
      ["PROVIDE_PROTOCOL", "CP-8eaac52713", "FOLLOWED", "VERIFIED", null],
    ])
    // E) cada ponto continua com a sua evidência e proveniência no item (o agrupamento é só do texto).
    for (const entry of output.items) expect(entry.facts.length + (entry.knowledge ? 1 : 0)).toBeGreaterThan(0)
    expect(output.items.map((entry) => entry.process!.checkpointRef)).toEqual(artifact.items.map((entry) => entry.process!.checkpointRef))
  })
})
