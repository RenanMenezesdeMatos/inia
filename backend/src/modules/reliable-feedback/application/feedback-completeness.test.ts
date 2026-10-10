import { describe, expect, it } from "vitest"
import type { RawCheckpoint } from "../../agents/domain/process-assessment-contract.js"
import { createInMemoryReliableFeedbackStore } from "../infrastructure/in-memory-reliable-feedback-store.js"
import { generateReliableFeedback, type ReliableGenerationDeps, type ReliableGenerationRequest } from "./generate-reliable-feedback.js"
import { RELIABLE_FEEDBACK_AUTONOMOUS_POLICY } from "../domain/reliable-feedback-item.js"
import { renderFeedbackDocument, supportMaterialLineageOf, supportMaterialsOf } from "../domain/reliable-feedback-artifact.js"
import { buildProcessItems } from "../domain/process-items.js"
import { verifyProcessAssessments, type PresentedKnowledgeExcerpt, type PublishedKnowledgeDocument } from "../domain/process-assessment.js"
import type { ReliableFeedbackWriterPort } from "./ports.js"

/**
 * V1.7.1a (§28 + ajuste de requisito) — o feedback tem o TAMANHO NECESSÁRIO: nenhum limite editorial esconde achado
 * confiável. Procedimento sintético com 10 etapas em 3 seções; a chamada evidencia todas (5 a desenvolver, 5 cumpridas).
 */
const ORG = "00000000-0000-4000-8000-0000000000aa"
const OPERATOR = "11111111-1111-4111-8111-1111111111aa"
const INTERACTION = "22222222-2222-4222-8222-2222222222aa"
const DOC = "33333333-3333-4333-8333-3333333333aa"
const TITLE = "Procedimento de Atendimento Completo"

const SECTIONS = [
  { heading: "3. Abertura e identificação", steps: ["Confirmar cadastro do titular", "Confirmar endereço de cobrança", "Registrar motivo do contato"] },
  { heading: "7. Tratativa", steps: ["Consultar fatura atual", "Explicar valor cobrado", "Oferecer segunda via", "Registrar solicitação no sistema"] },
  { heading: "9. Encerramento", steps: ["Informar protocolo gerado", "Confirmar entendimento final", "Agradecer pela ligação"] },
]
const SECTION_TEXT = SECTIONS.map((section) => [`## ${section.heading}`, "", "O operador deverá:", "", ...section.steps.map((step, index) => `${index + 1}. ${step}${index === section.steps.length - 1 ? "." : ";"}`)].join("\n"))
const CONTENT = [`# ${TITLE}`, "", ...SECTION_TEXT.flatMap((text) => [text, ""])].join("\n")
const published = new Map<string, PublishedKnowledgeDocument>([[DOC, { documentId: DOC, title: TITLE, content: CONTENT, version: 1 }]])
const presented: PresentedKnowledgeExcerpt[] = SECTIONS.map((section, index) => ({ documentId: DOC, documentTitle: TITLE, heading: section.heading, excerpt: SECTION_TEXT[index]! }))

const OPERATOR_LINES: Record<string, string> = {
  "Confirmar cadastro do titular": "Vou confirmar o cadastro do titular agora.",
  "Confirmar endereço de cobrança": "Preciso confirmar o endereço de cobrança com a senhora.",
  "Registrar motivo do contato": "Vou registrar o motivo do seu contato.",
  "Consultar fatura atual": "Deixa eu consultar a sua fatura atual.",
  "Explicar valor cobrado": "Vou explicar o valor cobrado nesta fatura.",
  "Oferecer segunda via": "Posso oferecer a segunda via da fatura.",
  "Registrar solicitação no sistema": "Vou registrar a solicitação aqui no sistema.",
  "Informar protocolo gerado": "O protocolo gerado fica registrado aqui.",
  "Confirmar entendimento final": "Quero confirmar o seu entendimento final.",
  "Agradecer pela ligação": "Agradeço pela sua ligação.",
}
const ALL_STEPS = SECTIONS.flatMap((section) => section.steps)
const DEVELOPMENT = new Set(["Confirmar endereço de cobrança", "Explicar valor cobrado", "Oferecer segunda via", "Informar protocolo gerado", "Confirmar entendimento final"])
const TRANSCRIPT = ["Operador: Boa tarde, em que posso ajudar?", "Cliente: Quero entender minha conta.", ...ALL_STEPS.flatMap((step) => [`Operador: ${OPERATOR_LINES[step]!}`, "Cliente: Certo."]), "Operador: Tenha uma boa tarde!"].join("\n")

const checkpoints: RawCheckpoint[] = ALL_STEPS.map((step, index) => ({
  requirement: step,
  status: DEVELOPMENT.has(step) ? "NOT_FOLLOWED" : "FOLLOWED",
  evidenceType: "OBSERVED",
  transcriptEvidence: [OPERATOR_LINES[step]!],
  knowledgeQuote: `${step}${[2, 6, 9].includes(index) ? "." : ";"}`,
  knowledgeDetailQuote: null,
  guidance: { source: "OFFICIAL_PROCEDURE", text: `Aplique a etapa ${step}.` },
  uncertainty: null,
}))
const assessment = { processes: [{ documentTitle: TITLE, checkpoints }] }

function setup() {
  const writer: ReliableFeedbackWriterPort = {
    writeMonitoring: async (input) => ({
      rawOutput: {
        items: input.items.map((item) => {
          const step = item.checkpoint!.stepTitle!
          return item.section === "STRENGTH"
            ? { slot: item.slot, observed: `Nesta chamada você cumpriu a etapa “${step}”.`, whyItMatters: null, whatYouCanDo: `Continue aplicando a etapa “${step}”.` }
            : { slot: item.slot, observed: `Nesta chamada a etapa “${step}” não foi cumprida como o documento orienta.`, whyItMatters: null, whatYouCanDo: `Nos próximos atendimentos, aplique a etapa “${step}”.` }
        }),
      },
    }),
    writeIndicator: async () => { throw new Error("não usado") },
  }
  const store = createInMemoryReliableFeedbackStore()
  const deps: ReliableGenerationDeps = {
    enabled: true,
    store,
    writer,
    policy: RELIABLE_FEEDBACK_AUTONOMOUS_POLICY,
    loadMonitoringContext: async () => ({ transcript: TRANSCRIPT, label: "Atendimento de 25/09/2026 · Dúvida de fatura", otherOperatorNames: [] }),
    loadIndicatorContext: async () => null,
    loadPublishedKnowledge: async () => published,
    loadIndicatorDiagnosisPlan: async () => null,
    loadPeerPracticeData: async () => ({ peers: [], observations: [] }),
    resolveDiagnosticStrategy: async () => null,
    now: () => new Date("2026-09-25T13:00:00Z"),
  }
  const source = { kind: "monitoring", knowledgeExcerpts: presented, input: { organizationId: ORG, operatorId: OPERATOR, interactionId: INTERACTION, structured: { evidenceFound: OPERATOR_LINES["Confirmar cadastro do titular"], observedBehavior: "o", recommendation: "r", processAssessment: assessment } } }
  const request: ReliableGenerationRequest = { organizationId: ORG, enrollmentId: "enr-ten", workflowId: "wf", workflowVersionId: "v1", nodeId: "gerar-feedback", sourceNodeId: "agente", sourceType: "AGENT", domain: "MONITORING", sourceNodeOutput: source, collaboratorId: OPERATOR, interactionId: INTERACTION, indicatorMeasurementId: null, configuredAgentId: null }
  return { deps, request }
}

describe("V1.7.1a — todos os achados confiáveis entram no feedback (§28, sem limite editorial)", () => {
  const verified = verifyProcessAssessments({ sources: [{ sourceRef: "AGENT", assessment, presented }], interactionId: INTERACTION, transcript: TRANSCRIPT, published })

  it("A) 10 achados confiáveis → 10 itens (nenhum corte), todos com regra verificada", () => {
    const { items, excludedForMateriality } = buildProcessItems(verified)
    expect(items).toHaveLength(10)
    expect(items.every((item) => item.structuralBlock === null && item.knowledge?.applicability === "VERIFIED")).toBe(true)
    expect(excludedForMateriality).toEqual([])
  })

  it("B/C/D) o feedback mostra TODOS — desenvolvimento primeiro (na ordem do procedimento), depois os pontos fortes; nada fica escondido nem some", async () => {
    const { deps, request } = setup()
    const result = await generateReliableFeedback(deps, request)
    expect(result.nodeOutput.disposition).toBe("READY")
    expect(result.nodeOutput.items).toHaveLength(10)
    expect(result.nodeOutput.findings).toEqual({ detected: 10, reliable: 10, inFeedback: 10, blocked: 0, heldForQa: 0, rejected: 0, collapsedDuplicates: 0, notObservable: 0, notApplicable: 0 })
    expect(result.nodeOutput.items.map((item) => item.process!.stepTitle)).toEqual([
      "Confirmar endereço de cobrança", "Explicar valor cobrado", "Oferecer segunda via", "Informar protocolo gerado", "Confirmar entendimento final",
      "Confirmar cadastro do titular", "Registrar motivo do contato", "Consultar fatura atual", "Registrar solicitação no sistema", "Agradecer pela ligação",
    ])
    expect(result.nodeOutput.items.map((item) => item.priority!.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    const text = result.nodeOutput.text
    // V1.7.2 — nada escondido: os 5 pontos a ajustar detalhados e os 5 cumpridos em "O que manter" (a parte registra os 5 itens).
    for (const item of result.nodeOutput.items.filter((entry) => entry.section === "OPPORTUNITY")) expect(text).toContain(item.process!.stepTitle!)
    const parts = renderFeedbackDocument(result.nodeOutput.items)
    const maintain = parts.find((part) => part.label === "O que manter")!
    expect(maintain.itemIndexes.sort()).toEqual(result.nodeOutput.items.filter((item) => item.section === "STRENGTH").map((item) => item.index).sort())
    expect(text).not.toMatch(/Visão geral|pontos fortes|pontos a desenvolver/)
    // V1.7.1e — cada achado pelo ASSUNTO (ordem de prioridade preservada), sem numeração editorial.
    const titles = [...text.matchAll(/^### (.+)$/gm)].map((match) => match[1])
    // V1.7.1m — etapa com comportamento canônico leva o título comportamental (protocolo, confirmação de entendimento).
    expect(titles.slice(0, 5)).toEqual(["Confirmação de endereço de cobrança", "Explicação de valor cobrado", "Oferta de segunda via", "Protocolo", "Confirmação de entendimento"])
    // V1.7.2 — pontos cumpridos não viram bloco próprio; o documento aparece em "Materiais utilizados".
    expect(titles.slice(5)).toEqual([])
    expect(text).toContain(`[${TITLE} ↗](/materiais/${DOC})`)
    expect(result.record.artifact!.excludedForMateriality).toEqual([])
  })

  it("E/F) material de apoio: lineage POR achado preservada; a UI deduplica o documento (um material, todas as etapas)", async () => {
    const { deps, request } = setup()
    const result = await generateReliableFeedback(deps, request)
    const lineage = supportMaterialLineageOf(result.nodeOutput.items)
    expect(lineage).toHaveLength(1)
    expect(lineage[0]!.usedIn.map((use) => use.itemIndex)).toEqual(result.nodeOutput.items.map((item) => item.index))
    expect(lineage[0]!.usedIn).toHaveLength(10)
    const [material] = supportMaterialsOf(result.nodeOutput.items)
    expect(material).toMatchObject({ materialId: DOC, title: TITLE })
    // V1.7.1e — o motivo fala dos ASSUNTOS dos achados (rótulo de apresentação), nunca do texto cru da etapa.
    expect(material!.reason.startsWith("Utilizado em: Confirmação de endereço de cobrança · Explicação de valor cobrado")).toBe(true)
    expect(material!.reason.length).toBeLessThanOrEqual(280)
    // Um documento usado em 3 achados → um material só, com as 3 etapas.
    expect(supportMaterialsOf(result.nodeOutput.items.slice(0, 3))).toEqual([{ materialId: DOC, title: TITLE, reason: "Utilizado em: Confirmação de endereço de cobrança · Explicação de valor cobrado · Oferta de segunda via" }])
    expect(result.nodeOutput.text.match(/\/materiais\//g)!.length).toBeGreaterThan(1)
    expect(result.nodeOutput.text).toContain(`**Materiais utilizados**\n\n- [${TITLE} ↗](/materiais/${DOC}) — utilizado em: Confirmação de endereço de cobrança`)
  })
})
