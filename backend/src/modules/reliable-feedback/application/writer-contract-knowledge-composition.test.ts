import { describe, expect, it, vi } from "vitest"
import type { GatewayRequest, GatewayResponse } from "../../../shared/application/model-routing/llm-gateway.js"
import { classifyExecutionError } from "../../../shared/domain/execution-failure.js"
import { callFeedbackWriterModel } from "../../interaction-feedback/infrastructure/gemini-feedback-writer.js"
import { FeedbackWriterError, writerFailureCategoryOf } from "../../interaction-feedback/domain/feedback-writer-provenance.js"
import { planClosingCoverage } from "../../knowledge/application/retrieve-knowledge.js"
import { chunkKnowledgeDocument } from "../../knowledge/domain/knowledge-chunking.js"
import { createInMemoryReliableFeedbackStore } from "../infrastructure/in-memory-reliable-feedback-store.js"
import { generateReliableFeedback, WriterTransientError, type ReliableGenerationDeps, type ReliableGenerationRequest } from "./generate-reliable-feedback.js"
import type { ReliableFeedbackWriterPort } from "./ports.js"
import { knowledgeQualityBlockers, RELIABLE_FEEDBACK_AUTONOMOUS_POLICY, type ReliableItemDraft } from "../domain/reliable-feedback-item.js"
import { composeDevelopmentBlocks, compositionOf, nodeOutputOf, type EmittedItem } from "../domain/reliable-feedback-artifact.js"
import { stepTitleOf } from "../domain/process-items.js"
import { closingPhaseReached } from "../domain/verified-omission.js"
import { monitoringFallbackWording, type MonitoringWriterItem } from "../domain/reliable-writer.js"
import { RELIABLE_WRITER_RESPONSE_SCHEMA_V4, reliableWriterFingerprint, reliableWriterItemSchemaV3, reliableWriterPresentationSchema, WORKFLOW_MONITORING_WRITER_PROMPT_VERSION } from "../domain/reliable-writer-prompts.js"
import type { PresentedKnowledgeExcerpt, PublishedKnowledgeDocument } from "../domain/process-assessment.js"
import { V171B_LINES, V171B_TRANSCRIPT } from "../testing/contestacao-v171b-smoke-fixture.js"

/**
 * V1.7.1d — o caminho Knowledge → Findings → Writer → Publication endurecido a partir do smoke real da Larissa (V1.7.1b/c):
 * contrato e observabilidade do redator, proveniência por trecho, regra × exemplo × evitar, nome canônico, composição de
 * achados do mesmo momento, texto de segurança específico e cobertura da fase de fechamento. Zero modelo (fakes).
 */
const ORG = "00000000-0000-4000-8000-0000000000d1"
const OPERATOR = "11111111-1111-4111-8111-1111111111d1"
const INTERACTION = "22222222-2222-4222-8222-2222222222d1"
const DOC = "c8f2c818-72db-48dc-8d7d-d8a9fe861c65"
const TITLE = "Procedimento Operacional — Contestação de Contas Móvel"
const RULE_HOW = "O operador deverá informar o prazo exibido na ferramenta."
const EXAMPLE = "“A contestação foi registrada hoje e será analisada em até cinco dias úteis. O retorno será enviado por SMS.”"
const DEADLINE = ["## 35. Prazo da análise", "", RULE_HOW, "", "Sempre informar prazo de forma objetiva:", "", EXAMPLE, "", "Evitar:", "", "- “É só aguardar.”", "- “Logo será resolvido.”", "- “O setor vai verificar.”"].join("\n")
const DIGITAL = ["## 15. Serviços digitais não reconhecidos", "", "Se o cliente não reconhecer:", "", "1. Cancelar a recorrência, quando permitido;", "2. Registrar contestação;"].join("\n")
const CONTENT = [`# ${TITLE}`, "", DEADLINE, "", DIGITAL].join("\n")
const published = new Map<string, PublishedKnowledgeDocument>([[DOC, { documentId: DOC, title: TITLE, content: CONTENT, version: 3 }]])
const presented: PresentedKnowledgeExcerpt[] = [
  { documentId: DOC, documentTitle: TITLE, heading: "35. Prazo da análise", excerpt: DEADLINE, chunkIndex: 7 },
  { documentId: DOC, documentTitle: TITLE, heading: "15. Serviços digitais não reconhecidos", excerpt: DIGITAL, chunkIndex: 4 },
]
const step = (overrides: Record<string, unknown>) => ({ evidenceType: "OBSERVED", knowledgeDetailQuote: null, guidance: { source: "OFFICIAL_PROCEDURE", text: null }, uncertainty: null, ...overrides })
/** Os dois achados do smoke: a MESMA fala ("é só aguardar") para "prazo objetivo" e para "frases a evitar" — e um ponto forte. */
const larissaAssessment = () => ({
  processes: [{
    documentTitle: TITLE,
    checkpoints: [
      step({ requirement: "Informar o prazo de análise da contestação de forma objetiva", status: "NOT_FOLLOWED", transcriptEvidence: [`Operador: ${V171B_LINES.deadline}`], knowledgeQuote: "Sempre informar prazo de forma objetiva:", knowledgeDetailQuote: RULE_HOW }),
      step({ requirement: "Evitar frases vagas como 'É só aguardar'", status: "NOT_FOLLOWED", transcriptEvidence: [`Operador: ${V171B_LINES.deadline}`], knowledgeQuote: "Evitar:\n\n- “É só aguardar.”\n- “Logo será resolvido.”" }),
      step({ requirement: "Cancelar a recorrência do serviço não reconhecido", status: "FOLLOWED", transcriptEvidence: [`Operador: ${V171B_LINES.cancelled}`], knowledgeQuote: "1. Cancelar a recorrência, quando permitido;" }),
    ],
  }],
})

function setup(writer: ReliableFeedbackWriterPort) {
  const store = createInMemoryReliableFeedbackStore({ onReactivate: () => true })
  const deps: ReliableGenerationDeps = {
    enabled: true,
    store,
    writer,
    policy: RELIABLE_FEEDBACK_AUTONOMOUS_POLICY,
    loadMonitoringContext: async () => ({ transcript: V171B_TRANSCRIPT, label: "Atendimento de 25/09/2026 · Contestação de cobrança", otherOperatorNames: [] }),
    loadIndicatorContext: async () => null,
    loadPublishedKnowledge: async () => published,
    loadIndicatorDiagnosisPlan: async () => null,
    loadPeerPracticeData: async () => ({ peers: [], observations: [] }),
    resolveDiagnosticStrategy: async () => null,
    loadRecipient: async () => ({ firstName: "Larissa" }),
    now: () => new Date("2026-09-25T16:29:00Z"),
  }
  const source = { kind: "monitoring", knowledgeExcerpts: presented, input: { organizationId: ORG, operatorId: OPERATOR, interactionId: INTERACTION, structured: { evidenceFound: V171B_LINES.deadline, observedBehavior: "o", relatedProcedure: TITLE, recommendation: "r", processAssessment: larissaAssessment() } } }
  const request: ReliableGenerationRequest = { organizationId: ORG, enrollmentId: "enr-larissa", workflowId: "wf", workflowVersionId: "v1", nodeId: "gerar", sourceNodeId: "orq", sourceType: "AGENT", domain: "MONITORING", sourceNodeOutput: source, collaboratorId: OPERATOR, interactionId: INTERACTION, indicatorMeasurementId: null, configuredAgentId: null }
  return { deps, request, store }
}
const provenanceStub = { responseSha256: "abc", finishReason: "STOP", responseModel: "gemini-3.1-flash-lite", schemaVersion: "RELIABLE_FEEDBACK_WRITER_OUTPUT_V4", validation: { status: "WRITER_MALFORMED_JSON", detail: "resposta não é JSON", itemCount: 0, expectedItemCount: 2 } } as unknown as ConstructorParameters<typeof FeedbackWriterError>[1]
const malformedWriter: ReliableFeedbackWriterPort = {
  writeMonitoring: async () => { throw new FeedbackWriterError("WRITER_MALFORMED_JSON", provenanceStub, "resposta não é JSON", { rejectedResponse: "```json\n{\"items\": [" }) },
  writeIndicator: async () => { throw new Error("não usado") },
}
const approveAll = (artifact: Parameters<typeof nodeOutputOf>[1]) => artifact.items.map((item) => ({ itemIndex: item.index, status: "APPROVED_UNCHANGED" as const, finalWording: null }))

// ---------------------------------------------------------------------------------------------
// Redator: contrato, observabilidade e retry (A, B, C)
// ---------------------------------------------------------------------------------------------
const WRITER_INPUT = { systemPrompt: "SYS", buildUserTurn: () => "USER", expectedRefs: ["ITEM_1"], fingerprint: reliableWriterFingerprint(WORKFLOW_MONITORING_WRITER_PROMPT_VERSION), itemSchema: reliableWriterItemSchemaV3, presentationSchema: reliableWriterPresentationSchema, responseSchema: { version: "RELIABLE_FEEDBACK_WRITER_RESPONSE_SCHEMA_V4", schema: RELIABLE_WRITER_RESPONSE_SCHEMA_V4 } }
const answering = (text: string, finishReason = "STOP") => vi.fn<(request: GatewayRequest) => Promise<GatewayResponse>>(async () => ({ kind: "text", text, usage: { promptTokens: 10, outputTokens: 5, totalTokens: 15, cachedInputTokens: null, reasoningTokens: null }, durationMs: 3, model: "gemini-3.1-flash-lite", provider: "GEMINI", finishReason, cache: { mode: "NONE" }, cost: { status: "NOT_CONFIGURED" } }) as unknown as GatewayResponse)

describe("V1.7.1d — contrato do redator (A/B)", () => {
  it("A) saída válida: o schema estruturado vai ao provedor (mesmas chaves do parser) e a proveniência registra o schema e o término", async () => {
    const generate = answering(JSON.stringify({ items: [{ itemRef: "ITEM_1", observed: "Nesta chamada…", whyItMatters: null, whatYouCanDo: null, suggestedResponse: null }], presentation: { introduction: "Analisei.", closing: "Fim." } }))
    const result = await callFeedbackWriterModel(generate, WRITER_INPUT)
    expect(generate).toHaveBeenCalledTimes(1)
    expect(generate.mock.calls[0]![0]).toMatchObject({ structuredOutput: true, responseSchema: RELIABLE_WRITER_RESPONSE_SCHEMA_V4, transport: { retries: 0 } })
    expect(result.provenance).toMatchObject({ responseSchema: "RELIABLE_FEEDBACK_WRITER_RESPONSE_SCHEMA_V4", finishReason: "STOP", validation: { status: "VALID" } })
    // Fonte única: as chaves do schema enviado são exatamente as do parser.
    const itemKeys = Object.keys(((RELIABLE_WRITER_RESPONSE_SCHEMA_V4.properties as Record<string, { items?: { properties: object } }>).items!.items!.properties))
    expect(itemKeys.sort()).toEqual(Object.keys(reliableWriterItemSchemaV3.shape).sort())
    expect(Object.keys((RELIABLE_WRITER_RESPONSE_SCHEMA_V4.properties as Record<string, { properties?: object }>).presentation!.properties!).sort()).toEqual(Object.keys(reliableWriterPresentationSchema.shape).sort())
  })

  it.each([
    ["markdown em volta", "```json\n{\"items\": []}\n```", "STOP", "WRITER_MALFORMED_JSON", "resposta não é JSON"],
    ["JSON truncado (limite de saída)", "{\"items\": [{\"itemRef\": \"ITEM_1\", \"observed\": \"Nesta", "MAX_TOKENS", "WRITER_MALFORMED_JSON", "MAX_TOKENS"],
    ["JSON inválido", "{items: [}", "STOP", "WRITER_MALFORMED_JSON", "resposta não é JSON"],
    ["envelope incompleto", "{\"presentation\": {\"introduction\": \"a\", \"closing\": \"b\"}}", "STOP", "WRITER_SCHEMA_INVALID", "items"],
  ])("B) %s → erro de contrato categorizado, resposta guardada, UMA chamada (sem retry cego)", async (_case, text, finishReason, code, detail) => {
    const generate = answering(text, finishReason)
    const error = await callFeedbackWriterModel(generate, WRITER_INPUT).then(() => null, (caught: unknown) => caught)
    expect(error).toBeInstanceOf(FeedbackWriterError)
    const writerError = error as FeedbackWriterError
    expect(writerError.code).toBe(code)
    expect(writerError.provenance!.validation.detail).toContain(detail)
    expect(writerError.rejectedResponse).toBe(text)
    expect(writerFailureCategoryOf(writerError)).toBe("WRITER_OUTPUT_CONTRACT_INVALID")
    expect(generate).toHaveBeenCalledTimes(1)
  })
})

describe("V1.7.1d — falha do redator no Gerar feedback (C)", () => {
  it("C) resposta fora do contrato: guardada no artefato (administrativo) com código/término/hash; itens com texto de segurança ESPECÍFICO e QA", async () => {
    const { deps, request, store } = setup(malformedWriter)
    const complete = vi.spyOn(store, "complete")
    const result = await generateReliableFeedback(deps, request)
    expect(complete.mock.calls[0]![2].writerRawOutput).toMatchObject({ kind: "REJECTED_WRITER_OUTPUT", code: "WRITER_MALFORMED_JSON", category: "WRITER_OUTPUT_CONTRACT_INVALID", responseSha256: "abc", finishReason: "STOP", text: "```json\n{\"items\": [", attempt: 1 })
    expect(result.record.artifact!.writer).toMatchObject({ error: "WRITER_MALFORMED_JSON", failureCategory: "WRITER_OUTPUT_CONTRACT_INVALID" })
    expect(result.nodeOutput.disposition).toBe("HOLD_FOR_QA")
    // O QA vê o item, nunca a resposta bruta.
    for (const review of result.reviews) expect(JSON.stringify(review.reviewItem)).not.toContain("```json")
  })

  it("C′) falha TRANSITÓRIA do redator: nada é gravado como pronto; o nó falha com categoria transitória (retry pela política do motor)", async () => {
    const transient: ReliableFeedbackWriterPort = { writeMonitoring: async () => { throw new FeedbackWriterError("WRITER_TIMEOUT", null, undefined, { transient: true }) }, writeIndicator: async () => { throw new Error("não usado") } }
    const { deps, request, store } = setup(transient)
    const error = await generateReliableFeedback(deps, request).then(() => null, (caught: unknown) => caught)
    expect(error).toBeInstanceOf(WriterTransientError)
    expect(classifyExecutionError(error).category).toBe("TRANSIENT_PROVIDER_ERROR")
    // Retentativa: o artefato falhado é retomado (não há artefato concluído com texto de segurança).
    const again = await generateReliableFeedback({ ...deps, writer: malformedWriter }, request)
    expect(again.reused).toBe(false)
    expect(await store.claim({ organizationId: ORG, artifactKey: "x", enrollmentId: "e", workflowId: "w", workflowVersionId: "v", nodeId: "n", sourceNodeId: "s", sourceType: "AGENT", domain: "MONITORING", collaboratorId: OPERATOR, interactionId: INTERACTION, indicatorMeasurementId: null, contractVersion: "c" }, new Date(), 10)).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------------------------
// Conhecimento: proveniência, regra × exemplo × evitar, nome canônico (D, E, F, G)
// ---------------------------------------------------------------------------------------------
describe("V1.7.1d — conhecimento (D/E/F/G)", () => {
  const base: Pick<ReliableItemDraft, "knowledge" | "process"> = {
    knowledge: { documentId: DOC, documentTitle: TITLE, heading: "35. Prazo da análise", version: 3, quote: "Sempre informar prazo de forma objetiva:", applicability: "LITERAL_ONLY", href: `/materiais/${DOC}`, contentKind: "RULE_CONTENT", detail: { quote: RULE_HOW, heading: "35. Prazo da análise", contentKind: "RULE_CONTENT", documentId: DOC, version: 3 } },
    process: { title: TITLE, requirement: "r", status: "NOT_FOLLOWED", checkpointRef: "P1.C1", evidenceType: "OBSERVED_ACTION", stepTitle: "Sempre informar prazo de forma objetiva" },
  }

  it("D) detalhe de outro documento/versão ou etapa sem nome → portão de qualidade (QA), nunca publicação automática", () => {
    expect(knowledgeQualityBlockers(base)).toEqual([])
    expect(knowledgeQualityBlockers({ ...base, knowledge: { ...base.knowledge!, detail: { ...base.knowledge!.detail!, documentId: "outro-doc" } } })).toEqual(["KNOWLEDGE_PROVENANCE_INCONSISTENT"])
    expect(knowledgeQualityBlockers({ ...base, knowledge: { ...base.knowledge!, detail: { ...base.knowledge!.detail!, version: 2 } } })).toEqual(["KNOWLEDGE_PROVENANCE_INCONSISTENT"])
    expect(knowledgeQualityBlockers({ ...base, process: { ...base.process!, stepTitle: null } })).toEqual(["CHECKPOINT_LABEL_UNRESOLVED"])
  })

  it("E) exemplo da base não vira regra: regra-exemplo vai ao QA; no texto o exemplo aparece como EXEMPLO (e 'evitar' como evitar), cada trecho com a sua seção", async () => {
    expect(knowledgeQualityBlockers({ ...base, knowledge: { ...base.knowledge!, contentKind: "EXAMPLE_CONTENT" } })).toEqual(["KNOWLEDGE_RULE_IS_EXAMPLE"])
    const { deps, request } = setup(malformedWriter)
    const result = await generateReliableFeedback(deps, request)
    const approved = nodeOutputOf(result.record.id, result.record.artifact!, approveAll(result.record.artifact!))
    const text = approved.text
    // V1.7.1e — regras primeiro (a normativa mais específica antes da abertura), com documento · seção no próprio bloco; o que
    // evitar como complemento, frase a frase; cada bloco com a sua seção.
    expect(text).toContain(`**O processo orienta**\n\n> “${RULE_HOW}”\n>\n> “Sempre informar prazo de forma objetiva:”`)
    expect(text).toContain(`_${TITLE} · Seção: Prazo da análise_ — [Abrir processo ↗](/materiais/${DOC})`)
    expect(text).toContain("**O procedimento pede evitar**\n\n> “É só aguardar.” · “Logo será resolvido.”")
    // V1.7.2 — o cancelamento cumprido está em "O que manter"; a regra e a seção continuam no item.
    const cancel = approved.items.find((item) => item.knowledge?.quote.includes("Cancelar a recorrência"))!
    expect(cancel.knowledge!.quote).toContain("1. Cancelar a recorrência, quando permitido;")
    expect(cancel.knowledge!.heading).toContain("Serviços digitais não reconhecidos")
    expect(cancel.knowledge!.href).toBe(`/materiais/${DOC}`)
    expect(text).toContain("## O que manter")
    // O exemplo com "cinco dias úteis"/SMS nunca aparece como orientação nem como exemplo de condução.
    expect(text).not.toContain("cinco dias úteis")
    expect(text).not.toContain("SMS")
  })

  it("F/G) nome canônico da etapa: sem numeração editorial, sem cláusula condicional, título da seção para abertura de lista", () => {
    expect(stepTitleOf("r", "1. Cancelar a recorrência, quando permitido;", "15. Serviços digitais não reconhecidos")).toBe("Cancelar a recorrência")
    expect(stepTitleOf("r", "- [ ] Recapitulei as ações?", "55. Checklist do operador")).toBe("Recapitulei as ações")
    expect(stepTitleOf("r", "Evitar:\n\n- “É só aguardar.”", "35. Prazo da análise")).toBe("Prazo da análise")
    expect(stepTitleOf("r", "O operador deverá permitir que o cliente explique:\n\n- Qual conta está questionando;\n- Qual cobrança não reconhece;", "6. Escuta e identificação da solicitação")).toBe("Escuta e identificação da solicitação")
    expect(stepTitleOf("r", "Sempre informar prazo de forma objetiva:", "35. Prazo da análise")).toBe("Sempre informar prazo de forma objetiva")
    expect(stepTitleOf("Explicar prazo", "Explicar prazo;", null)).toBe("Explicar prazo")
  })
})

// ---------------------------------------------------------------------------------------------
// Composição, texto de segurança e evidência preservada (H, I, J, K, M)
// ---------------------------------------------------------------------------------------------
describe("V1.7.1d — composição de achados e texto de segurança (H/I/J/K/M)", () => {
  it("H/M) as duas etapas do MESMO momento ('é só aguardar') viram UM bloco de coaching; os dois achados continuam existindo com evidência, regra e QA próprios", async () => {
    const { deps, request } = setup(malformedWriter)
    const result = await generateReliableFeedback(deps, request)
    const artifact = result.record.artifact!
    expect(artifact.items.filter((item) => item.section === "OPPORTUNITY")).toHaveLength(2)
    expect(result.reviews).toHaveLength(3)
    const approved = nodeOutputOf(result.record.id, artifact, approveAll(artifact))
    expect(approved.items).toHaveLength(3)
    expect(approved.composition).toEqual({ version: "FINDING_COMPOSITION_V1", blocks: [{ label: "Prazo da análise", itemIndexes: [0, 1], basis: ["SAME_CALL_MOMENT", "SAME_DOCUMENT_SECTION"] }] })
    const text = approved.text
    // V1.7.1e — um bloco com o ASSUNTO como título (sem numeração editorial).
    // V1.7.2 — um bloco de ajuste; o ponto cumprido vai para "O que manter".
    expect(text.match(/^### /gm)).toHaveLength(1)
    expect(text).toContain("## O que precisa ser ajustado\n\n### Prazo da análise")
    // A fala aparece UMA vez no bloco; os dois achados aparecem como observações do bloco.
    expect(text.split(`> Você disse: “${V171B_LINES.deadline}”`).length - 1).toBe(1)
    // Feedback Experience V2 — a fala está nos detalhes: "O que aconteceu" não repete a narrativa. O texto de cada item continua no
    // artefato (QA, auditoria).
    expect(text).not.toContain("**O que aconteceu**")
    // Cada item mantém a própria evidência e a própria regra (composição ≠ perda de dado).
    const [first, second] = approved.items
    expect(first!.facts).toEqual(second!.facts)
    expect(first!.knowledge!.quote).not.toBe(second!.knowledge!.quote)
    // J) Como aplicar específico (ação da regra operacional, no lugar da formulação evitada) — nunca "siga o documento".
    expect(text).toContain("**Como melhorar:** Na próxima chamada, informe o prazo exibido na ferramenta, em vez de dizer “É só aguardar”.")
    expect(text).not.toMatch(/siga o que orienta o documento|Procure|Seja mais/)
    // Feedback por Flag V2 — narrativa de supervisor: nome do cadastro, o que foi bem conduzido, o principal ajuste (com a
    // regra curta do processo) e o que fazer na próxima — sem o nome interno do bloco entre aspas.
    expect(text).toMatch(/Larissa, você conduziu bem a tratativa/)
    expect(text).toContain("O principal ajuste está no encerramento: o prazo da análise não foi informado ao cliente. O procedimento orienta: “O operador deverá informar o prazo exibido na ferramenta.”")
    expect(text).toContain("Na próxima chamada, informe o prazo exibido na ferramenta, em vez de dizer “É só aguardar”.")
    expect(text).not.toMatch(/ em as | de a etapa/)
  })

  it("I) etapas sem unidade pedagógica NÃO se fundem: mesma seção com falas diferentes, ou mesma fala em seções diferentes", () => {
    const item = (index: number, fact: string, heading: string): EmittedItem => ({ index, section: "OPPORTUNITY", sectionLabel: "Ponto de desenvolvimento", wording: { observed: `o${index}`, whyItMatters: "", whatYouCanDo: "" }, wordingSource: "PROPOSED", qaStatus: "NOT_SELECTED_FOR_QA", facts: [{ role: "OPERADOR", text: fact, truncated: false, masked: false }], knowledge: { documentId: DOC, documentTitle: TITLE, heading, version: 3, quote: `regra ${index}`, applicability: "VERIFIED", href: `/materiais/${DOC}` }, grounding: "OFFICIAL_PROCEDURE", process: { title: TITLE, requirement: "r", status: "NOT_FOLLOWED", checkpointRef: `P1.C${index}`, evidenceType: "OBSERVED_ACTION", stepTitle: `Etapa ${index}` } })
    expect(composeDevelopmentBlocks([item(0, "fala A", "35. Prazo"), item(1, "fala B", "35. Prazo")])).toHaveLength(2)
    expect(composeDevelopmentBlocks([item(0, "fala A", "35. Prazo"), item(1, "fala A", "46. Recapitulação")])).toHaveLength(2)
    expect(compositionOf([item(0, "fala A", "35. Prazo"), item(1, "fala A", "35. Prazo")]).blocks).toHaveLength(1)
  })

  it("K) sem regra verificada ou sem orientação oficial: o texto de segurança não inventa orientação (e não traz exemplo)", () => {
    const writerItem = { slot: "ITEM_1", section: "OPPORTUNITY", interpretation: { kind: "X", polarity: "NEGATIVE", scope: "INTERACTION_SPECIFIC", safeMeaning: "s" }, guidance: { source: "COACHING_SUGGESTION", mandatory: false, knowledge: null }, evidence: [], evidenceWithheld: 0, actionClaimMode: "DECLARED_ONLY", analysis: null, grounding: "NO_GROUNDED_GUIDANCE", requirement: "r", checkpoint: { stepTitle: "Informar prazo", evidenceType: "OBSERVED_ACTION" }, knowledgeContext: null, suggestedResponse: null } as unknown as MonitoringWriterItem
    // V1.7.1e — sem regra para derivar o comportamento: formulação conservadora com o ASSUNTO (nunca "a etapa …").
    expect(monitoringFallbackWording(writerItem)).toEqual({ observed: "Nesta chamada, o que o procedimento orienta em “Informar prazo” não foi seguido.", whyItMatters: "", whatYouCanDo: "" })
  })
})

// ---------------------------------------------------------------------------------------------
// Cobertura da base (L)
// ---------------------------------------------------------------------------------------------
describe("V1.7.1d — cobertura da fase de fechamento (L)", () => {
  const process = chunkKnowledgeDocument({ id: DOC, title: TITLE, content: [`# ${TITLE}`, "", DEADLINE, "", "## 46. Recapitulação obrigatória", "", "Antes de encerrar, informar a conta analisada e o prazo.", "", "## 47. Confirmação de entendimento", "", "Perguntar: “As informações ficaram claras?”", "", "## 48. Encerramento", "", "Encerrar com o protocolo.", "", "## 55. Checklist do operador", "", "- [ ] Recapitulei as ações?", "- [ ] Confirmei se restaram dúvidas?"].join("\n") })
  const transversal = chunkKnowledgeDocument({ id: "doc-checklist", title: "Checklist de Encerramento de Chamada", content: "Antes de encerrar qualquer chamada: (1) confirme a solução; (2) informe o protocolo." })
  const manual = chunkKnowledgeDocument({ id: "doc-manual", title: "Jeito de Atender", content: "## 20 Recapitulação\n\nRecapitule.\n\n## 28 Checklist rápido do operador\n\n- [ ] Recapitulei?" })
  const all = [...process, ...transversal, ...manual]

  it("chamada que chegou ao fim: o plano acrescenta recapitulação, confirmação, encerramento e checklist do PROCESSO + checklists transversais — sem repetir o que o ranking trouxe", () => {
    const ranked = [{ ...process[0]!, score: 5 }, { ...manual[0]!, score: 1 }]
    // V1.7.1m — o processo vem do ASSUNTO da interação (não do ranking).
    const { chunks, trace } = planClosingCoverage(all, ranked, { phases: ["CLOSING"], subject: "Contestação de cobrança" })
    expect(trace.processDocument).toEqual({ documentId: DOC, documentTitle: TITLE })
    expect(trace.added.map((entry) => `${entry.reason}:${entry.role}:${entry.heading || entry.documentTitle}`)).toEqual([
      "PROCESS_CLOSING_SECTION:RECAP:46. Recapitulação obrigatória",
      "PROCESS_CLOSING_SECTION:UNDERSTANDING_CHECK:47. Confirmação de entendimento",
      "PROCESS_CLOSING_SECTION:CLOSING:48. Encerramento",
      "PROCESS_CLOSING_SECTION:CHECKLIST:55. Checklist do operador",
      "TRANSVERSAL_CHECKLIST:CHECKLIST:Checklist de Encerramento de Chamada",
      "TRANSVERSAL_CHECKLIST:CHECKLIST:28 Checklist rápido do operador",
    ])
    expect(chunks).toHaveLength(6)
    // Orçamento próprio: nunca a base inteira.
    const tight = planClosingCoverage(all, ranked, { phases: ["CLOSING"], subject: "Contestação de cobrança" }, { maxChunks: 2, maxChars: 6000 })
    expect(tight.chunks).toHaveLength(2)
    expect(tight.trace.skippedForBudget).toBe(4)
  })

  it("a fase de fechamento só entra quando a transcrição chega ao fim (sem corte)", () => {
    expect(closingPhaseReached(V171B_TRANSCRIPT)).toBe(true)
    expect(closingPhaseReached("Operador: Boa tarde, em que posso ajudar?\nCliente: Quero contestar uma cobran…")).toBe(false)
    expect(closingPhaseReached("Operador: Boa tarde.\n[trecho cortado]\nCliente: Obrigada.")).toBe(false)
    expect(closingPhaseReached("")).toBe(false)
  })
})
