import { describe, expect, it, vi } from "vitest"
import { createInMemoryReliableFeedbackStore } from "../infrastructure/in-memory-reliable-feedback-store.js"
import { generateReliableFeedback, type ReliableGenerationDeps } from "./generate-reliable-feedback.js"
import { RELIABLE_FEEDBACK_AUTONOMOUS_POLICY } from "../domain/reliable-feedback-item.js"
import { buildProcessCheckpointCatalog } from "../domain/checkpoint-catalog.js"
import { chunkKnowledgeDocument } from "../../knowledge/domain/knowledge-chunking.js"
import { emittedItems, presentationOf, type EmittedItem } from "../domain/reliable-feedback-artifact.js"
import { compositionViolations, deterministicNarrative, narrativeBriefOf, resolveNarrative, SUPERVISOR_NARRATIVE_VERSION, type NarrativeDraft } from "../domain/supervisor-narrative.js"
import { PROCESS_ASSESSMENT_MODEL_CONTRACT_V5 } from "../../agents/domain/process-assessment-contract.js"
import type { NarrativeWriterResult, ReliableFeedbackWriterPort } from "./ports.js"
import { fakeFactualityVerifier } from "../testing/narrative-factuality-cases.js"

/**
 * MONITORING ARCHITECTURE V2 — FASE 4: UM REDATOR, UMA FONTE FACTUAL. No contrato V5 o redator de itens não existe: o texto de cada
 * ponto (detalhes, QA, fallback) é a projeção determinística do assessment e o redator de COMPOSIÇÃO é o único que escreve para o
 * colaborador. O card deriva do assessment. Os testes cobrem o que o redator pode (parafrasear, contextualizar, compor) e o que não
 * pode (criar força, criar achado, dizer como feito o que é ajuste) — e os três casos reais do smoke (chamadas 3, 4 e 7).
 */
const ORG = "00000000-0000-4000-8000-000000000001"
const OPERATOR = "11111111-1111-4111-8111-111111111111"
const INTERACTION = "22222222-2222-4222-8222-222222222222"
const DOCUMENT = { documentId: "44444444-4444-4444-8444-444444444444", title: "Guia de Abordagem | Atendimento", version: 1, content: [
  "# Guia de Abordagem | Atendimento",
  "## CEN-01 · Informe de pagamento",
  "Orientação ao operador:",
  "- Avaliar se a funcionalidade de informe de pagamento está disponível para o cliente.",
  "- Orientar que a solicitação pode ser realizada pelo aplicativo.",
  "Atenção / frases a evitar:",
  "- Não prometer desbloqueio imediato.",
].join("\n") }
const presented = chunkKnowledgeDocument({ id: DOCUMENT.documentId, title: DOCUMENT.title, content: DOCUMENT.content }).map((chunk) => ({ documentId: chunk.documentId, documentTitle: chunk.documentTitle, heading: chunk.heading, excerpt: chunk.text, chunkIndex: chunk.index }))
const catalog = buildProcessCheckpointCatalog({ excerpts: presented, contentOf: () => DOCUMENT.content, subject: null, coveragePlan: false })
const refOf = (text: string) => catalog.entries.find((entry) => entry.stepText.startsWith(text))!.ref
const CHECK = () => refOf("Avaliar se a funcionalidade")
const ORIENT = () => refOf("Orientar que a solicitação")
const PROMISE = () => refOf("Não prometer")

type Step = { ref: string; status: "FOLLOWED" | "NOT_FOLLOWED"; said: string; role: string; relation: string; summary: string; dependsOn?: string }
const step = (value: Step) => ({ checkpointRef: value.ref, requirement: "x", status: value.status, evidenceType: "OBSERVED", transcriptEvidence: [value.said], knowledgeQuote: null, knowledgeDetailQuote: null, guidance: { source: "OFFICIAL_PROCEDURE", text: null }, uncertainty: null, conductEvidence: { role: value.role, relation: value.relation }, summary: value.summary, ...(value.dependsOn ? { dependsOn: value.dependsOn } : {}) })
function nodeOutput(steps: Step[], contractVersion: string = PROCESS_ASSESSMENT_MODEL_CONTRACT_V5) {
  const processAssessment = { processes: [{ documentTitle: DOCUMENT.title, checkpoints: steps.map(step) }], validation: { contractVersion, completeness: "COMPLETE", invalidItems: [], normalizations: [], checkpointCapacity: [] }, interaction: { customerNeed: "Informar o pagamento e liberar a linha.", situation: "Linha bloqueada depois do pagamento.", path: "Orientação pelo aplicativo." } }
  return { kind: "monitoring", knowledgeExcerpts: presented, input: { organizationId: ORG, operatorId: OPERATOR, interactionId: INTERACTION, structured: { title: "t", summary: "s", impactedIndicator: "i", evidenceFound: steps[0]!.said, observedBehavior: "o", relatedProcedure: "p", recommendation: "r", processAssessment } } }
}

type Sentence = NonNullable<NarrativeDraft["sentences"]>[number]
/** Rascunho no formato V6: só frases (o card é do sistema). */
const composition = (sentences: [number, string, Sentence["stance"], string[]][]): NarrativeDraft => {
  const list = sentences.map(([paragraph, text, stance, refs]) => ({ paragraph, text, stance, refs }))
  const paragraphs = [...new Set(list.map((entry) => entry.paragraph))].map((number) => list.filter((entry) => entry.paragraph === number).map((entry) => entry.text).join(" "))
  return { paragraphs, card: "", sentences: list, cardRefs: [] }
}

function setup(transcript: string, narrative: NarrativeDraft | null, verifier: ReliableFeedbackWriterPort["verifyNarrativeFactuality"] = fakeFactualityVerifier()) {
  const calls = { monitoring: 0, narrative: 0, factuality: 0 }
  const writer: ReliableFeedbackWriterPort = {
    writeMonitoring: async () => { calls.monitoring += 1; return { rawOutput: null } },
    writeIndicator: async () => { throw new Error("não usado") },
    writeNarrative: async (): Promise<NarrativeWriterResult> => { calls.narrative += 1; return { draft: narrative, error: narrative ? null : "NARRATIVE_WRITER_ERROR", provenance: null } },
    verifyNarrativeFactuality: async (...args) => { calls.factuality += 1; return verifier!(...args) },
  }
  const deps: ReliableGenerationDeps = {
    enabled: true, store: createInMemoryReliableFeedbackStore(), writer, policy: RELIABLE_FEEDBACK_AUTONOMOUS_POLICY,
    loadMonitoringContext: vi.fn(async () => ({ transcript, label: "Atendimento de 29/09/2026", otherOperatorNames: [] })),
    loadIndicatorContext: async () => null,
    loadPublishedKnowledge: async () => new Map([[DOCUMENT.documentId, DOCUMENT]]),
    loadIndicatorDiagnosisPlan: async () => null, loadPeerPracticeData: async () => ({ peers: [], observations: [] }), resolveDiagnosticStrategy: async () => null,
    now: () => new Date("2026-09-30T12:00:00Z"),
  }
  const run = (steps: Step[], contractVersion?: string) => generateReliableFeedback(deps, { organizationId: ORG, enrollmentId: `enr-${Math.random()}`, workflowId: "wf", workflowVersionId: "v1", nodeId: "gerar", sourceNodeId: "agent", sourceType: "AGENT", domain: "MONITORING", sourceNodeOutput: nodeOutput(steps, contractVersion), collaboratorId: OPERATOR, interactionId: INTERACTION, indicatorMeasurementId: null, configuredAgentId: "agent" })
  return { calls, run }
}
const presentationOfResult = (result: Awaited<ReturnType<ReturnType<typeof setup>["run"]>>) => {
  const artifact = result.record.artifact!
  return presentationOf(artifact, emittedItems(artifact, []))!
}
const lines = (...rows: string[]) => rows.join("\n")
const PRAISE_WORDS = /corretamente|conduziu bem|com clareza|mantenha|continue|parab/iu

// Chamada 3/7 (positiva): checagem feita com outras palavras ("Pronto, verifiquei"), orientação depois dela e abstenção da promessa.
const POSITIVE_CHECK = "Operador: Deixa eu ver aqui no sistema. Pronto, verifiquei, tá liberado pra sua linha."
const POSITIVE_ORIENT = "Operador: Então você pode informar o pagamento pelo aplicativo, na opção de pagamentos."
const POSITIVE_REFUSE = "Operador: O desbloqueio eu não consigo te prometer na hora, depende do processamento."
const POSITIVE_TRANSCRIPT = lines("Operador: Boa tarde.", "Cliente: Já paguei e a linha continua bloqueada, posso avisar?", POSITIVE_CHECK, "Cliente: E como faço?", POSITIVE_ORIENT, "Cliente: Volta na hora?", POSITIVE_REFUSE, "Cliente: Tá bom, obrigado.")
const positiveSteps = (): Step[] => [
  { ref: CHECK(), status: "FOLLOWED", said: POSITIVE_CHECK, role: "CONDITION_VALIDATED", relation: "EQUIVALENT", summary: "Verificou no sistema que a opção estava liberada antes de orientar." },
  { ref: ORIENT(), status: "FOLLOWED", said: POSITIVE_ORIENT, role: "INFORMATION_PROVIDED", relation: "EQUIVALENT", summary: "Orientou o informe pelo aplicativo depois da verificação.", dependsOn: CHECK() },
  { ref: PROMISE(), status: "FOLLOWED", said: POSITIVE_REFUSE, role: "INFORMATION_PROVIDED", relation: "EQUIVALENT", summary: "Não prometeu o desbloqueio imediato." },
]
// Chamada 4 (desenvolvimento): afirmou a disponibilidade sem checar e prometeu desbloqueio imediato.
const DEV_ASSERT = "Operador: É só informar pelo aplicativo, essa opção está disponível pra você, sim."
const DEV_PROMISE = "Operador: Assim que você informar, o desbloqueio é na hora."
const DEVELOPMENT_TRANSCRIPT = lines("Operador: Boa tarde.", "Cliente: Já paguei e a linha continua bloqueada.", DEV_ASSERT, "Cliente: E volta quando?", DEV_PROMISE, "Cliente: Obrigado.")
const developmentSteps = (): Step[] => [
  { ref: CHECK(), status: "NOT_FOLLOWED", said: DEV_ASSERT, role: "ACTION_PERFORMED", relation: "DIFFERENT", summary: "Afirmou que a opção estava disponível sem checar." },
  { ref: PROMISE(), status: "NOT_FOLLOWED", said: DEV_PROMISE, role: "INFORMATION_PROVIDED", relation: "EQUIVALENT", summary: "Prometeu desbloqueio imediato." },
]

describe("um único redator no V5: o redator de itens não é chamado", () => {
  it("contrato V5 → nenhuma chamada ao redator de itens; cada ponto tem o texto do SISTEMA; uma chamada ao redator de composição", async () => {
    const { calls, run } = setup(POSITIVE_TRANSCRIPT, null)
    const result = await run(positiveSteps())
    const artifact = result.record.artifact!
    expect(calls).toEqual({ monitoring: 0, narrative: 1, factuality: 0 })
    expect(artifact.writer).toMatchObject({ invoked: false, skippedReason: "COMPOSITION_WRITER_ONLY", promptVersion: null })
    expect(artifact.items.length).toBeGreaterThan(0)
    expect(artifact.items.every((item) => item.wordingSource === "SYSTEM" && item.writerViolations.length === 0)).toBe(true)
  })
  it("contrato V4 (histórico) continua pelo redator de itens — nada muda fora do V5", async () => {
    const { calls, run } = setup(POSITIVE_TRANSCRIPT, null)
    await run(positiveSteps(), "PROCESS_ASSESSMENT_MODEL_CONTRACT_V4")
    expect(calls.monitoring).toBe(1)
  })
})

describe("chamada 3 — decidida pela evidência real", () => {
  it("'Pronto, verifiquei' é literal, do operador, no contexto da disponibilidade: a checagem é ponto forte VERIFIED e segue sem QA", async () => {
    const { run } = setup(POSITIVE_TRANSCRIPT, null)
    const result = await run(positiveSteps())
    const check = result.record.artifact!.items.find((item) => item.process?.stepTitle?.startsWith("Avaliar se a funcionalidade"))!
    expect(check).toMatchObject({ section: "STRENGTH", knowledge: { applicability: "VERIFIED", applicabilityBasis: "DECLARED_CONDUCT" }, decision: { disposition: "READY" } })
  })
})

describe("chamada 7 — positivo com texto natural fica READY (nenhum GENERIC_WORDING)", () => {
  it("F) narrativa sem frase-modelo, só com refs de força → aceita; artefato READY; o card vem do sistema", async () => {
    const natural = composition([
      [1, "O cliente ligou com a linha bloqueada depois de pagar e queria avisar o pagamento.", "CONTEXT", []],
      [1, "Antes de indicar o caminho, você conferiu no sistema que a opção estava liberada para ele e só então explicou como informar o pagamento pelo aplicativo.", "STRENGTH", ["S1", "S2"]],
      [2, "Quando ele perguntou se a linha voltaria na hora, você deixou claro que não podia prometer isso.", "STRENGTH", ["S3"]],
    ])
    const { run } = setup(POSITIVE_TRANSCRIPT, natural)
    const result = await run(positiveSteps())
    expect(result.nodeOutput.disposition).toBe("READY")
    const reasons = result.record.artifact!.items.flatMap((item) => item.decision.reasons)
    expect(reasons).not.toContain("GENERIC_WORDING")
    expect(reasons.filter((reason) => reason.startsWith("WRITER_"))).toEqual([])
    const presentation = presentationOfResult(result)
    expect(presentation.narrativeResolution).toMatchObject({ source: { narrative: "WRITER", card: "SYSTEM" }, violations: { narrative: [], card: [] } })
    expect(presentation.narrative).toEqual(natural.paragraphs)
  })
  it("V2.1 — a composição passa por UMA verificação semântica; se ela falha, nada do redator é entregue", async () => {
    const natural = composition([[1, "Você conferiu que a opção estava liberada e explicou como informar o pagamento pelo aplicativo.", "STRENGTH", ["S1", "S2"]]])
    const ok = setup(POSITIVE_TRANSCRIPT, natural)
    const verified = await ok.run(positiveSteps())
    expect(ok.calls).toMatchObject({ narrative: 1, factuality: 1 })
    expect(verified.record.artifact!.presentation!.narrative!.factuality).toMatchObject({ status: "VERIFIED", verdicts: [{ id: "F1", status: "SUPPORTED" }] })
    const failing = setup(POSITIVE_TRANSCRIPT, natural, async () => { throw new Error("boom") })
    const failed = await failing.run(positiveSteps())
    expect(failing.calls.factuality).toBe(1)
    expect(failed.nodeOutput.disposition).toBe("READY")
    expect(presentationOfResult(failed).narrativeResolution).toMatchObject({ source: { narrative: "SYSTEM", card: "SYSTEM" }, violations: { narrative: ["NARRATIVE_FACTUALITY_UNVERIFIED"] } })
  })
})

describe("chamada 4 — nenhum elogio e nenhum ajuste dito como feito", () => {
  it("32) finding 'não validou a disponibilidade' × 'após confirmar a disponibilidade' → recusado; o fallback do sistema não elogia", async () => {
    const wrong = composition([
      [1, "Você orientou o informe pelo aplicativo após confirmar a disponibilidade da opção.", "ADJUSTMENT", ["A1"]],
      [1, "Só faltou não prometer o desbloqueio na hora.", "ADJUSTMENT", ["A2"]],
    ])
    // V2.1 — quem decide "ajuste dito como feito" é a verificação semântica (o modelo real devolve CONTRADICTION — caso S4 da avaliação).
    const { run } = setup(DEVELOPMENT_TRANSCRIPT, wrong, fakeFactualityVerifier((claim) => (/após confirmar/.test(claim.text) ? "CONTRADICTION" : "SUPPORTED")))
    const result = await run(developmentSteps())
    const presentation = presentationOfResult(result)
    expect(presentation.narrativeResolution!.source.narrative).toBe("SYSTEM")
    expect(presentation.narrativeResolution!.violations.narrative).toEqual(expect.arrayContaining(["NARRATIVE_GAP_OMITTED", "NARRATIVE_FACTUALITY_REJECTED"]))
    const text = [...presentation.narrative!, presentation.card!].join("\n")
    expect(text).not.toMatch(PRAISE_WORDS)
    expect(text).not.toMatch(/ap[óo]s confirmar|confirmou a disponibilidade/iu)
  })
  it("a mesma regra vale para a proibição violada: 'você não prometeu o desbloqueio' contradiz o achado", () => {
    const items = developmentItems()
    const result = compositionViolations(composition([[1, "Faltou checar a disponibilidade antes de orientar o aplicativo.", "ADJUSTMENT", ["A1"]], [1, "Você não prometeu o desbloqueio imediato.", "ADJUSTMENT", ["A2"]]]), narrativeBriefOf(items, LABEL), items, CONTEXT)
    expect(result.narrative).toContain("NARRATIVE_CONTRADICTS_FINDING")
  })
  it("orientação prospectiva ('só depois de confirmar', 'não prometa') nunca é contradição", () => {
    const items = developmentItems()
    const result = compositionViolations(composition([
      [1, "Você indicou o aplicativo sem checar se a opção estava disponível e disse que o desbloqueio seria imediato.", "ADJUSTMENT", ["A1", "A2"]],
      [2, "Na próxima, oriente o aplicativo só depois de confirmar a disponibilidade e não prometa liberação imediata.", "GUIDANCE", ["A1", "A2"]],
    ]), narrativeBriefOf(items, LABEL), items, CONTEXT)
    expect(result).toEqual({ narrative: [], card: [] })
  })
})

// --- testes A–G sobre o brief (sem pipeline) ---
const LABEL = "Atendimento de 29/09/2026 · Bloqueio por inadimplência"
const CONTEXT = { domain: "MONITORING" as const, label: LABEL, firstName: "Larissa" }
let next = 1
function item(section: "STRENGTH" | "OPPORTUNITY", title: string, observed: string, quote: string, line: string): EmittedItem {
  const index = next++
  return {
    index, domain: "MONITORING", section, sectionLabel: section === "STRENGTH" ? "Ponto forte" : "Ponto de desenvolvimento",
    wording: { observed, whyItMatters: "", whatYouCanDo: "" }, wordingSource: "PROPOSED", qaStatus: "NOT_SELECTED_FOR_QA",
    facts: [{ role: "OPERADOR", text: line, truncated: false, masked: false }],
    knowledge: { documentId: "doc", documentTitle: DOCUMENT.title, heading: "Informe de pagamento", version: 1, quote, applicability: "VERIFIED", href: "/materiais/doc", contentKind: "RULE_CONTENT" },
    grounding: "OFFICIAL_PROCEDURE",
    process: { title: DOCUMENT.title, requirement: quote, status: section === "STRENGTH" ? "FOLLOWED" : "NOT_FOLLOWED", checkpointRef: `CP-${index}`, evidenceType: "OBSERVED_ACTION" as never, stepTitle: title },
  } as EmittedItem
}
const developmentItems = () => [
  item("OPPORTUNITY", "Informe de pagamento", "Nesse momento da chamada, faltou avaliar se a funcionalidade de informe de pagamento está disponível para o cliente.", "Avaliar se a funcionalidade de informe de pagamento está disponível para o cliente.", "É só informar pelo aplicativo, essa opção está disponível."),
  item("OPPORTUNITY", "Não prometer desbloqueio imediato", "Nesta chamada, o que o procedimento orienta em “Informe de pagamento” não foi seguido.", "Não prometer desbloqueio imediato.", "Assim que você informar, o desbloqueio é imediato."),
]
const mixedItems = () => [
  item("STRENGTH", "Negociação", "Você orientou a consulta dos débitos pelo Vivo em Dia.", "Orientar o Vivo em Dia para consultar débitos.", "Pelo Vivo em Dia você consulta os débitos e as opções de parcelamento."),
  item("OPPORTUNITY", "Promessas", "Nesta chamada, o que o procedimento orienta em “Negociação” não foi seguido.", "Não garantir aprovação antes da consulta.", "Ele vai ser aprovado na hora, isso eu te garanto."),
]
const check = (items: EmittedItem[], value: NarrativeDraft) => compositionViolations(value, narrativeBriefOf(items, LABEL), items, CONTEXT)

describe("A–G — o que o único redator pode e não pode", () => {
  it("A) strengths = [] e o redator elogia → recusado", () => {
    const result = check(developmentItems(), composition([[1, "Você explicou o caminho pelo aplicativo com clareza.", "CONTEXT", []], [1, "Faltou checar a disponibilidade.", "ADJUSTMENT", ["A1"]], [1, "O desbloqueio não é imediato.", "ADJUSTMENT", ["A2"]]]))
    expect(result.narrative).toContain("NARRATIVE_UNSUPPORTED_STRENGTH")
  })
  it("B) achado A no assessment; o redator cria o achado B → recusado", () => {
    const result = check(developmentItems(), composition([[1, "Faltou checar a disponibilidade.", "ADJUSTMENT", ["A1"]], [1, "O desbloqueio não é imediato.", "ADJUSTMENT", ["A2"]], [1, "Também faltou validar o titular.", "ADJUSTMENT", ["A3"]]]))
    expect(result.narrative).toContain("NARRATIVE_REF_UNKNOWN")
  })
  it("C) paráfrase do achado → aceita", () => {
    expect(check(developmentItems(), composition([[1, "O caminho pelo aplicativo foi indicado sem conferir se a opção existia para esse cliente.", "ADJUSTMENT", ["A1"]], [1, "E a liberação da linha foi dada como imediata.", "ADJUSTMENT", ["A2"]]]))).toEqual({ narrative: [], card: [] })
  })
  it("D) contexto da necessidade do cliente + o achado → aceito", () => {
    expect(check(developmentItems(), composition([[1, "O cliente queria avisar um pagamento já feito para liberar a linha.", "CONTEXT", []], [1, "Nesse cenário, a opção do aplicativo foi indicada sem checar a disponibilidade, e o desbloqueio foi prometido para a hora.", "ADJUSTMENT", ["A1", "A2"]]]))).toEqual({ narrative: [], card: [] })
  })
  it("E) DEVELOPMENT sem forças: o fallback do sistema tem zero elogio", () => {
    const brief = narrativeBriefOf(developmentItems(), LABEL)
    const fallback = deterministicNarrative(brief)
    expect([...fallback.paragraphs, fallback.card].join("\n")).not.toMatch(PRAISE_WORDS)
  })
  it("G) MIXED com força e achado independentes → aceito; força disfarçada no ajuste → recusada", () => {
    expect(check(mixedItems(), composition([[1, "Você indicou o Vivo em Dia para ele consultar os débitos e as opções de parcelamento.", "STRENGTH", ["S1"]], [1, "O ajuste é que a aprovação do parcelamento foi garantida antes da consulta.", "ADJUSTMENT", ["A1"]]]))).toEqual({ narrative: [], card: [] })
    expect(check(mixedItems(), composition([[1, "Você orientou corretamente e garantiu a aprovação.", "ADJUSTMENT", ["S1", "A1"]]])).narrative).toContain("NARRATIVE_UNSUPPORTED_STRENGTH")
  })
})

describe("card e fallback derivam do assessment", () => {
  it("rascunho V6 (sem card): o card é SEMPRE o do sistema, com o principal ajuste", () => {
    const items = developmentItems()
    const draft = composition([[1, "Faltou checar a disponibilidade.", "ADJUSTMENT", ["A1"]], [1, "O desbloqueio não é imediato.", "ADJUSTMENT", ["A2"]]])
    const brief = narrativeBriefOf(items, LABEL)
    const resolved = resolveNarrative({ version: SUPERVISOR_NARRATIVE_VERSION, promptVersion: "SUPERVISOR_FEEDBACK_NARRATIVE_PROMPT_V6", itemsKey: brief.itemsKey, draft, violations: { narrative: [], card: [] }, error: null }, items, CONTEXT)
    expect(resolved.source).toEqual({ narrative: "WRITER", card: "SYSTEM" })
    expect(resolved.card).toBe(deterministicNarrative(brief).card)
  })
  it("dois ajustes com o mesmo assunto são ditos uma vez só no fallback e no card", () => {
    const items = [item("OPPORTUNITY", "Reparo fixa", "Nesse momento da chamada, faltou realizar o suporte.", "Realizar o suporte conforme o fluxo aplicável.", "Vou abrir o reparo."), item("OPPORTUNITY", "Reparo fixa", "Nesse momento da chamada, faltou prestar suporte antes.", "Prestar suporte antes de direcionar o acompanhamento.", "Acompanhe pelo aplicativo.")]
    for (const entry of items) entry.knowledge!.heading = "Reparo fixa"
    const fallback = deterministicNarrative(narrativeBriefOf(items, LABEL))
    const text = [...fallback.paragraphs, fallback.card].join("\n")
    expect(text.match(/“Reparo fixa” precisa de ajuste/g)?.length ?? 0).toBeLessThanOrEqual(2)
    expect(fallback.card).not.toMatch(/“Reparo fixa” precisa de ajuste e o ponto “Reparo fixa”/)
  })
})
