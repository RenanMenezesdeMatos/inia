import { describe, expect, it } from "vitest"
import { createInMemoryReliableFeedbackStore } from "../infrastructure/in-memory-reliable-feedback-store.js"
import { generateReliableFeedback, type ReliableGenerationDeps, type ReliableGenerationRequest } from "./generate-reliable-feedback.js"
import type { ReliableFeedbackWriterPort } from "./ports.js"
import { RELIABLE_FEEDBACK_AUTONOMOUS_POLICY } from "../domain/reliable-feedback-item.js"
import { emittedItems, nodeOutputOf, type ReliableFeedbackArtifactV1 } from "../domain/reliable-feedback-artifact.js"
import { verifyProcessAssessments } from "../domain/process-assessment.js"
import { canonicalBehaviorOf } from "../domain/canonical-behavior.js"
import { hasSuggestedResponsePlaceholder, suggestedResponseViolations } from "../domain/suggested-response.js"
import { leadingVerbOf } from "../domain/action-semantics.js"
import { infinitiveOfConjugated } from "../domain/portuguese-verbs.js"
import { structuredAnchorOf } from "../domain/structured-anchor.js"
import { ruleContextOf } from "../domain/verified-omission.js"
import { aggregateProcessPatterns, observationsFrom } from "../../indicator-diagnosis/domain/process-patterns.js"
import { compositeFactsOf, isObservationEligibleForAnalytics, summarizeObservations } from "../../indicator-diagnosis/domain/observation-readiness.js"
import { selectPrimaryProcessDocument } from "../../knowledge/domain/primary-process.js"
import { chunkKnowledgeDocument } from "../../knowledge/domain/knowledge-chunking.js"
import { planClosingCoverage } from "../../knowledge/application/retrieve-knowledge.js"
import {
  V171L_ASSESSMENT, V171L_CHECKLIST_ID, V171L_CHECKLIST_TITLE, V171L_COLLABORATOR_NAME, V171L_CONTENT, V171L_DOC_ID, V171L_DOC_TITLE, V171L_JEITO_VIVO_ID, V171L_JEITO_VIVO_TITLE,
  V171L_PRESENTED, V171L_PUBLISHED, V171L_RANKED_SCORES, V171L_SUBJECT, V171L_TRANSCRIPT, V171L_WRITER_RAW,
} from "../testing/contestacao-v171l-smoke-fixture.js"

/**
 * V1.7.1m — COBERTURA PELO PROCESSO PRIMÁRIO + IDENTIDADE CANÔNICA DO COMPORTAMENTO + MORFOLOGIA DO CHECKLIST + LACUNA NO EXEMPLO,
 * sobre o smoke REAL da V1.7.1l (SMOKE-V171L-CONTESTACAO-001; sem modelo).
 */
const operatorTurns = V171L_TRANSCRIPT.split("\n").filter((line) => line.startsWith("Operador:")).map((line) => line.replace(/^Operador:\s*/, ""))
const turn = (pattern: RegExp) => operatorTurns.find((line) => pattern.test(line))!
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
type Assessment = typeof V171L_ASSESSMENT
const verified = (assessment: Assessment = V171L_ASSESSMENT, interactionId = "int-m", presented = V171L_PRESENTED) => verifyProcessAssessments({ sources: [{ sourceRef: "S", assessment: clone(assessment) as never, presented }], interactionId, transcript: V171L_TRANSCRIPT, published: V171L_PUBLISHED, subject: V171L_SUBJECT })
const byRequirement = (assessment: ReturnType<typeof verified>, pattern: RegExp) => assessment.checkpoints.find((checkpoint) => pattern.test(checkpoint.requirement))!

// ---------------------------------------------------------------------------------------------------------------------
// A/B — documento primário × transversal (cobertura do fechamento)
// ---------------------------------------------------------------------------------------------------------------------
const DOCUMENTS = [V171L_DOC_ID, V171L_JEITO_VIVO_ID, V171L_CHECKLIST_ID].map((id) => V171L_PUBLISHED.get(id)!)
const CHUNKS = DOCUMENTS.flatMap((document) => chunkKnowledgeDocument({ id: document.documentId, title: document.title, content: document.content }))
/** O ranking lexical REAL do smoke (score > 0; score 0 = trecho acrescentado pela cobertura). */
const RANKED = V171L_RANKED_SCORES.filter((entry) => entry.score > 0).map((entry) => ({ ...CHUNKS.find((chunk) => chunk.documentId === entry.documentId && chunk.index === entry.chunkIndex)!, score: entry.score }))

describe("V1.7.1m — A/B) documento primário do processo × transversal", () => {
  it("A) o procedimento ESPECÍFICO (título ancorado no assunto) é o primário — nunca o maior score do ranking", () => {
    // O ranking real deu mais relevância somada ao "Jeito Vivo" (5 trechos) — era o que a cobertura escolhia.
    const relevance = (id: string) => RANKED.filter((chunk) => chunk.documentId === id).reduce((sum, chunk) => sum + chunk.score, 0)
    expect(relevance(V171L_JEITO_VIVO_ID)).toBeGreaterThan(relevance(V171L_DOC_ID))
    const selection = selectPrimaryProcessDocument(DOCUMENTS.map((document) => ({ documentId: document.documentId, documentTitle: document.title })), V171L_SUBJECT)
    expect(selection).toMatchObject({ basis: "SUBJECT_TITLE_ANCHOR", primaryDocumentId: V171L_DOC_ID, candidates: [{ documentId: V171L_DOC_ID, sharedTerms: ["contes"] }] })
    expect(selection.supplemental.map((document) => document.documentTitle).sort()).toEqual([V171L_CHECKLIST_TITLE, V171L_JEITO_VIVO_TITLE].sort())
    const { trace } = planClosingCoverage(CHUNKS, RANKED, { phases: ["CLOSING"], subject: V171L_SUBJECT })
    expect(trace.processDocument).toEqual({ documentId: V171L_DOC_ID, documentTitle: V171L_DOC_TITLE })
    // Ordem: fechamento do processo primeiro (46, 47, 48 — a 55 já veio do ranking), depois as checklists transversais.
    expect(trace.added.map((entry) => `${entry.reason}:${entry.heading || entry.documentTitle}`)).toEqual([
      "PROCESS_CLOSING_SECTION:46. Recapitulação obrigatória",
      "PROCESS_CLOSING_SECTION:47. Confirmação de entendimento",
      "PROCESS_CLOSING_SECTION:48. Encerramento",
      "PROCESS_CLOSING_SECTION:55. Checklist do operador",
      "TRANSVERSAL_CHECKLIST:28 Checklist rápido do operador",
      "TRANSVERSAL_CHECKLIST:Checklist de Encerramento de Chamada",
    ].filter((entry) => !RANKED.some((chunk) => `PROCESS_CLOSING_SECTION:${chunk.heading}` === entry || `TRANSVERSAL_CHECKLIST:${chunk.heading || chunk.documentTitle}` === entry)))
    // As seções de fechamento do Jeito Vivo (20 Recapitulação, 21, 22) não substituem mais as do procedimento específico.
    expect(trace.added.some((entry) => entry.documentId === V171L_JEITO_VIVO_ID && entry.reason === "PROCESS_CLOSING_SECTION")).toBe(false)
  })

  it("B) transversal continua como SUPLEMENTO; ambíguo nunca é escolhido em silêncio; sem assunto, nenhum primário", () => {
    const { trace } = planClosingCoverage(CHUNKS, RANKED, { phases: ["CLOSING"], subject: V171L_SUBJECT })
    expect(trace.added.filter((entry) => entry.reason === "TRANSVERSAL_CHECKLIST").map((entry) => entry.documentId).sort()).toEqual([V171L_CHECKLIST_ID, V171L_JEITO_VIVO_ID].sort())
    const twoProcesses = [{ documentId: "a", documentTitle: "Contestação de Contas Fixo" }, { documentId: "b", documentTitle: "Contestação de Contas Móvel" }, { documentId: "c", documentTitle: "Jeito de Atender" }]
    expect(selectPrimaryProcessDocument(twoProcesses, "Contestação de cobrança")).toMatchObject({ basis: "AMBIGUOUS_SUBJECT_ANCHOR", primaryDocumentId: null, candidates: [{ documentId: "a" }, { documentId: "b" }] })
    expect(selectPrimaryProcessDocument(twoProcesses, null)).toMatchObject({ basis: "NO_SUBJECT", primaryDocumentId: null })
    expect(selectPrimaryProcessDocument(twoProcesses, "Portabilidade")).toMatchObject({ basis: "NO_SUBJECT_ANCHOR", primaryDocumentId: null })
    // Palavras genéricas de título não ancoram ("Procedimento Operacional…", "Atendimento").
    expect(selectPrimaryProcessDocument([{ documentId: "x", documentTitle: "Procedimento Operacional de Atendimento" }], "Atendimento geral")).toMatchObject({ basis: "NO_SUBJECT_ANCHOR" })
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// C–I — identidade canônica do comportamento
// ---------------------------------------------------------------------------------------------------------------------
describe("V1.7.1m — C–H) fontes do mesmo comportamento convergem", () => {
  it("C) a lista COMPOSTA é autoritativa: “Recapitulei as ações?” não transforma PARCIAL em cumprida", () => {
    // Replay: o especialista só citou o checklist genérico; a lista literal da seção 46 (mesmo documento/versão) avalia a fala.
    const recap = byRequirement(verified(), /^Recapitulei/)
    expect(recap).toMatchObject({ status: "NOT_FOLLOWED", statusDowngradeReason: "COMPOSITE_PARTIAL", completeness: { status: "PARTIAL" }, knowledge: { heading: "46. Recapitulação obrigatória", applicability: "VERIFIED", structuredAnchor: { basis: "COMPOSITE_ITEMS_OBSERVED" } }, canonical: { behavior: "RECAPITULATE_INTERACTION", role: "PRIMARY", compositeResolution: { fromQuote: "Recapitulei as ações?", fromHeading: "55. Checklist do operador" } } })
    // Quando o especialista cita as duas: a composta avalia, o checklist reforça (sem conflito, sem segundo ponto).
    const both = clone(V171L_ASSESSMENT)
    both.processes[0]!.checkpoints.push({ status: "FOLLOWED", guidance: { text: null, source: "OFFICIAL_PROCEDURE" }, requirement: "Recapitulação obrigatória", uncertainty: null, evidenceType: "OBSERVED", knowledgeQuote: "Antes de encerrar, informar: - Conta analisada; - Lançamento contestado; - Valor; - Ação realizada; - Serviço cancelado, quando aplicável; - Conta ajustada; - Valor a pagar; - Prazo; - Canal de retorno; - Protocolo.", transcriptEvidence: [`Operador: ${turn(/só pra fechar/)}`], knowledgeDetailQuote: null } as never)
    // Com a cobertura corrigida, a seção 46 entra no prompt (aqui acrescentada como a cobertura nova a traria).
    const section46 = CHUNKS.find((chunk) => chunk.documentId === V171L_DOC_ID && chunk.heading === "46. Recapitulação obrigatória")!
    const withBoth = verified(both as Assessment, "int-m", [...V171L_PRESENTED, { documentId: section46.documentId, documentTitle: section46.documentTitle, heading: section46.heading, excerpt: section46.text, chunkIndex: section46.index }])
    const composite = byRequirement(withBoth, /^Recapitulação obrigatória/)
    expect(composite).toMatchObject({ status: "NOT_FOLLOWED", completeness: { status: "PARTIAL" }, canonical: { role: "PRIMARY", conflict: false } })
    expect(byRequirement(withBoth, /^Recapitulei/)).toMatchObject({ status: "FOLLOWED", canonical: { role: "SUPPORTING", primaryRef: composite.ref } })
  })

  it("D/E/F) protocolo, confirmação de entendimento e prazo: duas fontes cada → UM comportamento (a mais específica avalia)", () => {
    const assessment = verified()
    const group = (behavior: string) => assessment.behaviors!.find((entry) => entry.behavior === behavior)!
    expect(group("PROVIDE_PROTOCOL")).toMatchObject({ refs: ["P1.C8", "P2.C2"], primaryRef: "P1.C8", status: "FOLLOWED", conflict: false })
    expect(group("CONFIRM_UNDERSTANDING")).toMatchObject({ refs: ["P1.C10", "P2.C4"], primaryRef: "P1.C10", status: "FOLLOWED", conflict: false })
    expect(group("INFORM_DEADLINE")).toMatchObject({ refs: ["P1.C6", "P2.C3"], primaryRef: "P1.C6", status: "NOT_FOLLOWED", facets: ["DEADLINE", "RETURN_CHANNEL", "NEXT_STEP"] })
    // Precedência: documento do processo específico antes da checklist transversal (auditoria da escolha).
    expect(byRequirement(assessment, /^Forneci protocolo/).canonical!.precedence).toEqual(expect.arrayContaining(["PROCESS_SPECIFIC_DOCUMENT"]))
    expect(byRequirement(assessment, /número do protocolo/).canonical).toMatchObject({ role: "SUPPORTING", primaryRef: "P1.C8" })
    // Registrar protocolo NÃO é fornecer protocolo; "evitar" não tem comportamento canônico (é outra conduta).
    expect(canonicalBehaviorOf({ step: "7. Registrar protocolo.", quote: null, heading: null })).toBeNull()
    expect(byRequirement(assessment, /evitadas/).canonical ?? null).toBeNull()
  })

  it("G) faceta distinta é preservada: “próximo passo” continua visível como apoio no mesmo ponto (e o documento no material)", async () => {
    const { byStep, text } = await replay()
    const deadline = byStep(/^Informei prazo/)!
    expect(deadline.process!.behavior).toMatchObject({ code: "INFORM_DEADLINE", title: "Prazo da análise", facets: ["DEADLINE", "RETURN_CHANNEL", "NEXT_STEP"], sources: [{ checkpointRef: "P2.C3", role: "SUPPORTING", documentId: V171L_CHECKLIST_ID, addsFacets: ["NEXT_STEP"] }] })
    const block = text.slice(text.indexOf("### Prazo da análise"), text.indexOf("## Pontos fortes"))
    expect(block).toContain("> “Antes de finalizar: … Informei prazo e canal de retorno?”\n>\n> “Antes de encerrar qualquer chamada: … explique o próximo passo e o prazo;”")
    expect(block).toContain(`_${V171L_CHECKLIST_TITLE}_ — [Abrir processo ↗](/materiais/${V171L_CHECKLIST_ID})`)
    expect(text).toMatch(new RegExp(`\\[${V171L_CHECKLIST_TITLE} ↗\\]\\(/materiais/${V171L_CHECKLIST_ID}\\) — utilizado em: [^\\n]*Prazo da análise`))
  })

  it("H) fontes do mesmo comportamento com conclusões OPOSTAS → conflito: QA e observação NEEDS_REVIEW (nada escolhido em silêncio)", async () => {
    const conflicting = clone(V171L_ASSESSMENT)
    const other = conflicting.processes[1]!.checkpoints.find((checkpoint) => /número do protocolo/.test(checkpoint.requirement))!
    Object.assign(other, { status: "NOT_FOLLOWED", evidenceType: "OBSERVED" })
    const assessment = verified(conflicting as Assessment)
    expect(assessment.behaviors!.find((group) => group.behavior === "PROVIDE_PROTOCOL")).toMatchObject({ conflict: true, primaryRef: "P1.C8" })
    expect(byRequirement(assessment, /número do protocolo/).canonical).toMatchObject({ role: "CONFLICTING", conflict: true })
    const observation = observationsFrom("op-m", [{ interactionId: "int-m", assessment }]).find((entry) => entry.canonicalBehavior === "PROVIDE_PROTOCOL")!
    expect(observation).toMatchObject({ analyticsStatus: "NEEDS_REVIEW", analyticsReasons: expect.arrayContaining(["CANONICAL_BEHAVIOR_CONFLICT"]) })
    expect(isObservationEligibleForAnalytics(observation)).toBe(false)
    const { artifact } = await replay(conflicting as Assessment)
    const items = artifact.items.filter((item) => item.process?.behavior?.code === "PROVIDE_PROTOCOL")
    expect(items).toHaveLength(2)
    for (const item of items) expect(item.decision).toMatchObject({ disposition: "HOLD_FOR_QA", reasons: expect.arrayContaining(["CANONICAL_BEHAVIOR_CONFLICT"]) })
  })
})

describe("V1.7.1m — I/J) analytics por comportamento canônico", () => {
  it("I) uma observação por atendimento × comportamento, com a linhagem de TODAS as fontes", () => {
    const observations = observationsFrom("op-m", [{ interactionId: "int-m", assessment: verified() }])
    const keys = observations.map((observation) => observation.practiceKey)
    expect(new Set(keys).size).toBe(keys.length)
    const protocol = observations.find((observation) => observation.practiceKey === "BEHAVIOR:PROVIDE_PROTOCOL")!
    expect(protocol).toMatchObject({ canonicalBehavior: "PROVIDE_PROTOCOL", status: "FOLLOWED", analyticsStatus: "VERIFIED" })
    expect(protocol.sourceLineages!.map((lineage) => [lineage.checkpointRef, lineage.role, lineage.documentId])).toEqual([["P1.C8", "PRIMARY", V171L_DOC_ID], ["P2.C2", "SUPPORTING", V171L_CHECKLIST_ID]])
    expect(observations.filter((observation) => /protocolo/i.test(observation.requirement))).toHaveLength(1)
    expect(observations.filter((observation) => observation.canonicalBehavior === "CONFIRM_UNDERSTANDING")).toHaveLength(1)
    expect(observations.filter((observation) => observation.canonicalBehavior === "INFORM_DEADLINE")).toHaveLength(1)
  })

  it("J) INDICATOR SAFETY — 5 interações × 2 fontes de protocolo: denominador 5, nunca 10 (o mesmo para o gap de prazo)", () => {
    const interactions = [1, 2, 3, 4, 5].map((n) => ({ interactionId: `int-${n}`, handle: `I${n}`, assessment: verified(V171L_ASSESSMENT, `int-${n}`), label: `Atendimento ${n}`, otherOperatorNames: [] }))
    const observations = observationsFrom("op-m", interactions)
    const summary = summarizeObservations(observations.map((observation) => ({ ...observation, practiceKey: observation.practiceKey })))
    expect(summary.find((entry) => entry.practiceKey === "BEHAVIOR:PROVIDE_PROTOCOL")).toEqual({ practiceKey: "BEHAVIOR:PROVIDE_PROTOCOL", followed: 5, notFollowed: 0, partial: 0, excluded: 0 })
    expect(summary.find((entry) => entry.practiceKey === "BEHAVIOR:INFORM_DEADLINE")).toEqual({ practiceKey: "BEHAVIOR:INFORM_DEADLINE", followed: 0, notFollowed: 5, partial: 0, excluded: 0 })
    expect(summary.find((entry) => entry.practiceKey === "BEHAVIOR:RECAPITULATE_INTERACTION")).toMatchObject({ followed: 0, notFollowed: 5, partial: 5 })
    const patterns = aggregateProcessPatterns(interactions)
    expect(patterns.find((pattern) => pattern.practiceKey === "BEHAVIOR:PROVIDE_PROTOCOL")).toMatchObject({ analyzed: 5, followed: ["I1", "I2", "I3", "I4", "I5"], notFollowed: [], knowledgeIdentity: true })
    expect(patterns.find((pattern) => pattern.practiceKey === "BEHAVIOR:INFORM_DEADLINE")).toMatchObject({ analyzed: 5, notFollowed: ["I1", "I2", "I3", "I4", "I5"] })
    expect(patterns.filter((pattern) => /protocolo/i.test(pattern.requirement))).toHaveLength(1)
  })
})

describe("V1.7.1m — K/L) checklist é autoavaliação gramatical; ação + objeto continuam exigidos", () => {
  it("K) 1ª/3ª pessoa do pretérito e imperativo de verbos CONHECIDOS → o infinitivo", () => {
    for (const [form, infinitive] of [["validei", "validar"], ["validou", "validar"], ["valide", "validar"], ["identifiquei", "identificar"], ["identificou", "identificar"], ["identifique", "identificar"], ["verifiquei", "verificar"], ["verificou", "verificar"], ["verifique", "verificar"], ["abri", "abrir"], ["abriu", "abrir"], ["forneci", "fornecer"], ["cancelei", "cancelar"], ["recapitulei", "recapitular"]] as const) expect(infinitiveOfConjugated(form)).toBe(infinitive)
    expect(infinitiveOfConjugated("nomei")).toBeNull()
    expect([leadingVerbOf("Validei o titular?"), leadingVerbOf("Identifiquei lançamento, valor e período?"), leadingVerbOf("Verifiquei se a conta foi paga?"), leadingVerbOf("Abri análise quando necessário?")]).toEqual(["validar", "identificar", "verificar", "abrir"])
    // Replay: as quatro etapas deixam de ir ao QA só pela forma do verbo.
    const assessment = verified()
    for (const pattern of [/^Validei/, /^Identifiquei/, /^Verifiquei/, /^Abri/]) expect(byRequirement(assessment, pattern)).toMatchObject({ status: "FOLLOWED", knowledge: { applicability: "VERIFIED", structuredAnchor: { basis: "CHECKPOINT_SELECTION" } } })
  })

  it("L) a forma do verbo não basta: a fala precisa realizar a AÇÃO ou tratar do OBJETO da etapa", () => {
    const rule = ruleContextOf(V171L_CONTENT, "Validei o titular?", "55. Checklist do operador")
    const anchor = (step: string, speech: string) => structuredAnchorOf({ status: "FOLLOWED", declaredEvidenceType: "OBSERVED", contentKind: "RULE_CONTENT", rule: ruleContextOf(V171L_CONTENT, step, "55. Checklist do operador"), citedQuote: step, documentTitle: V171L_DOC_TITLE, subject: V171L_SUBJECT, operatorEvidence: [{ turnRef: "T9", text: speech }], conversation: operatorTurns, operatorConversation: operatorTurns })
    expect(rule).toMatchObject({ stepText: "Validei o titular?" })
    expect(anchor("Validei o titular?", turn(/três últimos dígitos/))).toMatchObject({ anchored: true, basis: "CHECKPOINT_SELECTION" })
    expect(anchor("Validei o titular?", turn(/Vou deixar registrada/))).toMatchObject({ anchored: false })
    expect(anchor("Verifiquei se a conta foi paga?", turn(/Você já pagou/))).toMatchObject({ anchored: true })
    expect(anchor("Verifiquei se a conta foi paga?", turn(/Qual é a cobrança/))).toMatchObject({ anchored: false })
  })
})

describe("V1.7.1m — M/N/O) lacuna no exemplo", () => {
  it("M/N) reticências, [prazo], <valor> e X são LACUNA — do redator, da base ou do texto de segurança", () => {
    for (const text of ["O prazo de análise é de...", "O prazo de análise é de…", "Seu protocolo é [...]", "O prazo é de <prazo>.", "Em X dias você recebe."]) expect(hasSuggestedResponsePlaceholder(text)).toBe(true)
    expect(hasSuggestedResponsePlaceholder("A sua contestação foi registrada e o prazo aparece aqui na ferramenta.")).toBe(false)
    const scope = { allowed: true, stepTitle: "Prazo da análise", ruleTexts: ["O operador deverá informar o prazo exibido na ferramenta."], evidenceTexts: [], exampleTexts: [] } as never
    expect(suggestedResponseViolations("O prazo de análise é de...", scope)).toContain("SUGGESTED_RESPONSE_PLACEHOLDER")
  })

  it("O) o ponto válido sobrevive sem exemplo: só o exemplo sai (sem QA por isso); artefato antigo com lacuna também não emite o exemplo", async () => {
    const { byStep, text, artifact } = await replay()
    const deadline = byStep(/^Informei prazo/)!
    expect(deadline).toMatchObject({ section: "OPPORTUNITY", decision: { disposition: "READY" } })
    expect(deadline.proposedWording!.suggestedResponse ?? "").toBe("")
    expect(deadline.writerFieldValidation).toEqual(expect.arrayContaining([expect.objectContaining({ field: "suggestedResponse", action: "DROPPED" })]))
    expect(deadline.proposedWording!.whatYouCanDo).toContain("informe o prazo")
    expect(text).not.toMatch(/é de\.\.\.|Seu protocolo é\.\.\./)
    // Defesa na emissão: um artefato gravado antes, com o exemplo-lacuna, emite o ponto inteiro MENOS o exemplo.
    const legacy = clone(artifact) as ReliableFeedbackArtifactV1
    const index = legacy.items.findIndex((item) => item.index === deadline.index)
    legacy.items[index] = { ...legacy.items[index]!, proposedWording: { ...legacy.items[index]!.proposedWording!, suggestedResponse: "O prazo de análise é de..." } }
    const emitted = emittedItems(legacy, []).find((item) => item.index === deadline.index)!
    expect(emitted.suggestedResponse).toBeNull()
    expect(emitted.wording.suggestedResponse).toBeUndefined()
    expect(emitted.wording.observed).toBe(deadline.proposedWording!.observed)
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// P — replay do smoke REAL da V1.7.1l
// ---------------------------------------------------------------------------------------------------------------------
/** O redator real respondeu por slot (ordem dos itens daquela execução): mapeia pelo requisito. */
const SLOTS: [RegExp, number][] = [[/^Informei prazo/, 0], [/próximo passo/, 1], [/evitadas/, 2], [/^Cancelei/, 3], [/^Forneci/, 4], [/^Confirmei se restaram/, 5], [/solução aplicada/, 6], [/número do protocolo/, 7], [/mais alguma dúvida/, 8], [/^Validei/, 9], [/^Identifiquei/, 10], [/^Verifiquei/, 11], [/^Abri/, 12], [/^Recapitulei/, 13]]
function writer(): ReliableFeedbackWriterPort & { requested: string[] } {
  const requested: string[] = []
  return {
    requested,
    writeMonitoring: async (input) => {
      requested.push(...input.items.map((item) => item.requirement ?? ""))
      return { rawOutput: { items: input.items.flatMap((item) => { const hit = SLOTS.find(([pattern]) => pattern.test(item.requirement ?? "")); return hit ? [{ ...V171L_WRITER_RAW.items[hit[1]]!, slot: item.slot }] : [] }), presentation: V171L_WRITER_RAW.presentation } }
    },
    writeIndicator: async () => { throw new Error("não usado") },
  }
}
async function replay(assessment: Assessment = V171L_ASSESSMENT) {
  const store = createInMemoryReliableFeedbackStore({ onReactivate: () => true })
  const port = writer()
  const deps: ReliableGenerationDeps = {
    enabled: true, store, writer: port, policy: RELIABLE_FEEDBACK_AUTONOMOUS_POLICY,
    loadMonitoringContext: async () => ({ transcript: V171L_TRANSCRIPT, label: `Atendimento de 25/09/2026 · ${V171L_SUBJECT}`, otherOperatorNames: [], subjectOperatorName: V171L_COLLABORATOR_NAME }),
    loadIndicatorContext: async () => null, loadPublishedKnowledge: async () => V171L_PUBLISHED, loadIndicatorDiagnosisPlan: async () => null,
    loadPeerPracticeData: async () => ({ peers: [], observations: [] }), resolveDiagnosticStrategy: async () => null,
    loadRecipient: async () => ({ firstName: "Larissa" }), now: () => new Date("2026-09-26T02:30:00Z"),
  }
  const source = { kind: "monitoring", knowledgeExcerpts: V171L_PRESENTED, input: { organizationId: "org-m", operatorId: "op-m", interactionId: "int-m", structured: { evidenceFound: "x", observedBehavior: "o", relatedProcedure: V171L_DOC_TITLE, recommendation: "r", processAssessment: clone(assessment) } } }
  const request: ReliableGenerationRequest = { organizationId: "org-m", enrollmentId: "enr-m", workflowId: "wf", workflowVersionId: "v1", nodeId: "gerar", sourceNodeId: "orq", sourceType: "AGENT", domain: "MONITORING", sourceNodeOutput: source, collaboratorId: "op-m", interactionId: "int-m", indicatorMeasurementId: null, configuredAgentId: null }
  const result = await generateReliableFeedback(deps, request)
  const artifact = result.record.artifact!
  const byStep = (pattern: RegExp) => artifact.items.find((item) => pattern.test(item.process?.requirement ?? ""))
  const text = nodeOutputOf(result.record.id, artifact, artifact.items.map((item) => ({ itemIndex: item.index, status: "APPROVED_UNCHANGED" as const, finalWording: null }))).text
  return { store, result, artifact, byStep, text, requested: port.requested }
}

describe("V1.7.1m — P) replay do smoke REAL da V1.7.1l (A–K)", () => {
  it("comportamento uma vez, recapitulação composta parcial, sem QA por flexão, sem exemplo-lacuna", async () => {
    const { artifact, byStep, text, requested, store } = await replay()
    // Antes: 14 itens, 6 em QA, 14 itens ao redator. Agora: 11 comportamentos (3 fontes fundidas), 1 em QA ("evitar" por paráfrase).
    expect(artifact.findings).toMatchObject({ detected: 11, reliable: 11, inFeedback: 10, heldForQa: 1, blocked: 0, collapsedDuplicates: 3 })
    expect(requested).toHaveLength(10)
    // C/D) recapitulação: a lista composta avaliou a fala; parcial = ponto de desenvolvimento (texto do sistema), nunca força.
    const recap = byStep(/^Recapitulei/)!
    expect(recap).toMatchObject({ section: "OPPORTUNITY", wordingSource: "SYSTEM", decision: { disposition: "READY" }, process: { behavior: { code: "RECAPITULATE_INTERACTION", title: "Recapitulação obrigatória" }, completeness: { status: "PARTIAL", observed: ["lançamento contestado", "valor", "ação realizada", "serviço cancelado, quando aplicável", "protocolo"], absent: ["prazo", "canal de retorno"] } } })
    expect(artifact.items.filter((item) => item.section === "STRENGTH").some((item) => item.process?.behavior?.code === "RECAPITULATE_INTERACTION")).toBe(false)
    // E/F/G/H) uma vez cada; títulos comportamentais, nunca "Checklist do operador".
    const titles = [...text.matchAll(/^### (.+)$/gm)].map((match) => match[1])
    // V1.7.2 — só os pontos a ajustar têm bloco; os cumpridos, uma vez cada, em "O que manter".
    expect(titles).toEqual(["Recapitulação obrigatória", "Prazo da análise"])
    const maintain = text.slice(text.indexOf("## O que manter"), text.indexOf("**Materiais utilizados**"))
    // Feedback Experience V2 — "O que manter" são as evidências: cada comportamento aparece UMA vez (título único).
    const maintainTitles = [...maintain.matchAll(/^- \*\*(.+?)\*\*/gm)].map((match) => match[1])
    expect(maintainTitles.length).toBeGreaterThanOrEqual(6)
    expect(new Set(maintainTitles).size).toBe(maintainTitles.length)
    expect(titles).not.toContain("Checklist do operador")
    // Prazo: UM coaching (a regra, a faceta do próximo passo e o "evitar" do mesmo momento) — não 3.
    expect(text.split("### Prazo da análise").length - 1).toBe(1)
    expect(byStep(/evitadas/)).toMatchObject({ decision: { disposition: "HOLD_FOR_QA", reasons: ["KNOWLEDGE_APPLICABILITY_UNVERIFIED"] } })
    // J) nenhuma etapa vai ao QA só pela 1ª pessoa do checklist.
    expect(store.reviews.map((review) => artifact.items[review.itemIndex]!.process!.requirement)).toEqual(["Frases que devem ser evitadas: É só aguardar. / Não sei quando resolve."])
    // K) a fala-modelo com lacuna não aparece como exemplo publicável nem como exemplo do material.
    expect(text).not.toContain("O prazo de análise é de...")
    expect(text).not.toContain("Seu protocolo é...")
  })

  it("visão analítica: FONTES → COMPORTAMENTO → OBSERVAÇÃO; uma contribuição por comportamento", () => {
    const assessment = verified()
    const observations = observationsFrom("op-m", [{ interactionId: "int-m", assessment }])
    expect(observations.map((observation) => [observation.canonicalBehavior ?? null, observation.status, observation.completeness, observation.analyticsStatus, observation.sourceLineages?.length ?? 0])).toEqual([
      ["VALIDATE_HOLDER", "FOLLOWED", null, "VERIFIED", 1],
      ["IDENTIFY_CHARGE", "FOLLOWED", null, "VERIFIED", 1],
      ["CHECK_PAYMENT", "FOLLOWED", null, "VERIFIED", 1],
      ["CANCEL_RECURRING_SERVICE", "FOLLOWED", null, "VERIFIED", 1],
      ["OPEN_ANALYSIS", "FOLLOWED", null, "VERIFIED", 1],
      ["INFORM_DEADLINE", "NOT_FOLLOWED", null, "VERIFIED", 2],
      // "evitar" (sem comportamento canônico): só literal — fora do analytics.
      [null, "NOT_FOLLOWED", null, "NEEDS_REVIEW", 0],
      ["PROVIDE_PROTOCOL", "FOLLOWED", null, "VERIFIED", 2],
      ["RECAPITULATE_INTERACTION", "NOT_FOLLOWED", "PARTIAL", "VERIFIED", 1],
      ["CONFIRM_UNDERSTANDING", "FOLLOWED", null, "VERIFIED", 2],
      ["CONFIRM_SOLUTION", "FOLLOWED", null, "VERIFIED", 1],
    ])
    const recap = observations.find((observation) => observation.canonicalBehavior === "RECAPITULATE_INTERACTION")!
    expect(compositeFactsOf(recap.subItems)).toEqual({ informed: ["conta analisada", "lançamento contestado", "valor", "ação realizada", "serviço cancelado, quando aplicável", "protocolo"], notInformed: ["prazo", "canal de retorno"], notEvaluated: [], notApplicable: ["conta ajustada", "valor a pagar"] })
  })
})
