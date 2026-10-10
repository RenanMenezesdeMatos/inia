import { describe, expect, it, vi } from "vitest"
import { verifyProcessAssessments, type PresentedKnowledgeExcerpt } from "../domain/process-assessment.js"
import { buildProcessCheckpointCatalog } from "../domain/checkpoint-catalog.js"
import { chunkKnowledgeDocument } from "../../knowledge/domain/knowledge-chunking.js"
import { PROCESS_ASSESSMENT_INSTRUCTIONS, PROCESS_ASSESSMENT_INSTRUCTIONS_V5, PROCESS_ASSESSMENT_MODEL_CONTRACT_V5, type RawProcessAssessment } from "../../agents/domain/process-assessment-contract.js"
import { checkpointReadinessOf } from "../../indicator-diagnosis/domain/observation-readiness.js"
import { createInMemoryReliableFeedbackStore } from "../infrastructure/in-memory-reliable-feedback-store.js"
import { generateReliableFeedback } from "./generate-reliable-feedback.js"
import { RELIABLE_FEEDBACK_AUTONOMOUS_POLICY } from "../domain/reliable-feedback-item.js"
import { qaExplanationsOf } from "../../interaction-feedback/domain/review-view.js"

/**
 * MONITORING ARCHITECTURE V2 — incerteza propaga incerteza, nunca falha (smoke positivo da chamada 7, `-MW2P4`): o especialista juntou
 * duas falas do operador separadas por uma fala do cliente numa citação só; a checagem literal recusou (certo) e a etapa dependente,
 * com fala válida, caía junto como "pré-requisito NÃO cumprido". Agora: pré-requisito inconclusivo ⇒ a dependente mantém a evidência,
 * não vira conformidade sozinha (QA, fora da analytics). E o contrato V5 pede um item por fala — a verificação literal continua rígida.
 */
const DOCUMENT = { documentId: "55555555-5555-4555-8555-555555555555", title: "Guia de Abordagem | Atendimento", version: 1, content: [
  "# Guia de Abordagem | Atendimento",
  "## CEN-05 · Reparo fixa",
  "Orientação ao operador:",
  "- Realizar o suporte conforme o fluxo aplicável. Caso seja necessário abrir reparo, informar que o status poderá ser acompanhado pelo aplicativo.",
  "- Prestar suporte antes de direcionar o acompanhamento. Mencionar o aplicativo somente se houver abertura de reparo.",
].join("\n") }
const presented: PresentedKnowledgeExcerpt[] = chunkKnowledgeDocument({ id: DOCUMENT.documentId, title: DOCUMENT.title, content: DOCUMENT.content }).map((chunk) => ({ documentId: chunk.documentId, documentTitle: chunk.documentTitle, heading: chunk.heading, excerpt: chunk.text, chunkIndex: chunk.index }))
const catalog = buildProcessCheckpointCatalog({ excerpts: presented, contentOf: () => DOCUMENT.content, subject: null, coveragePlan: false })
const refOf = (text: string) => catalog.entries.find((entry) => entry.stepText.startsWith(text))!.ref
const SUPPORT = () => refOf("Realizar o suporte")
const ORDER = () => refOf("Prestar suporte antes")

// As falas REAIS da chamada 7 (a do meio é do cliente).
const TESTED = "Operador: Pelo que a gente testou, o reinício do modem e a conexão direta não resolveram, e o sinal não chega até o equipamento. Nesse caso é necessário abrir um reparo pra um técnico avaliar."
const CUSTOMER = "Cliente: Técnico? E quando ele vem?"
const OPENED = "Operador: Eu já abri a solicitação de reparo pra você agora. O andamento dessa solicitação você consegue acompanhar pelo aplicativo, e é por lá que aparecem as atualizações do reparo."
const TRANSCRIPT = ["Operador: Vivo, boa tarde.", "Cliente: A internet de casa parou.", "Operador: Vamos fazer um teste: desliga o modem da tomada e liga de novo.", "Cliente: Continua sem internet.", TESTED, CUSTOMER, OPENED, "Cliente: Tá bom."].join("\n")
const STITCHED = `${TESTED} O andamento dessa solicitação você consegue acompanhar pelo aplicativo`

type Raw = RawProcessAssessment["processes"][number]["checkpoints"][number]
const step = (ref: string, evidence: string[], extra: Partial<Raw> = {}): Raw => ({ checkpointRef: ref, requirement: "x", status: "FOLLOWED", evidenceType: "OBSERVED", transcriptEvidence: evidence, knowledgeQuote: null, knowledgeDetailQuote: null, guidance: { source: "OFFICIAL_PROCEDURE", text: null }, uncertainty: null, conductEvidence: { role: "ACTION_PERFORMED", relation: "EQUIVALENT" }, ...extra }) as Raw
const assessment = (checkpoints: Raw[]) => ({ processes: [{ documentTitle: DOCUMENT.title, checkpoints }], validation: { contractVersion: PROCESS_ASSESSMENT_MODEL_CONTRACT_V5, completeness: "COMPLETE", invalidItems: [], normalizations: [], checkpointCapacity: [] } })
const verify = (checkpoints: Raw[]) => verifyProcessAssessments({ sources: [{ sourceRef: "agent", assessment: assessment(checkpoints) as never, presented }], interactionId: "i-7", transcript: TRANSCRIPT, published: new Map([[DOCUMENT.documentId, DOCUMENT]]) })
const byStep = (result: ReturnType<typeof verify>, prefix: string) => result.checkpoints.find((checkpoint) => (checkpoint.checkpointStep ?? checkpoint.requirement).startsWith(prefix))!

describe("verificação literal continua rígida — e aceita trechos independentes", () => {
  it("duas falas separadas por uma fala do cliente, juntadas num trecho só → não literal (EVIDENCE_NOT_VERIFIED)", () => {
    expect(byStep(verify([step(SUPPORT(), [STITCHED])]), "Realizar o suporte")).toMatchObject({ status: "NOT_OBSERVABLE", statusDowngradeReason: "EVIDENCE_NOT_VERIFIED" })
  })
  it("as mesmas duas falas como DOIS trechos independentes → cada um conferido no seu turno → cumprida", () => {
    const verified = byStep(verify([step(SUPPORT(), [TESTED, OPENED])]), "Realizar o suporte")
    expect(verified.status).toBe("FOLLOWED")
    expect(verified.transcriptEvidence.map((unit) => unit.speaker)).toEqual(["OPERADOR", "OPERADOR"])
    expect(new Set(verified.transcriptEvidence.map((unit) => unit.turnRef)).size).toBe(2)
  })
  it("o contrato V5 pede um item por fala (nunca juntar falas separadas por outro interlocutor); o V4 não muda", () => {
    expect(PROCESS_ASSESSMENT_INSTRUCTIONS_V5).toContain("cada item é um trecho contínuo de UMA única fala (um turno) de UM interlocutor")
    expect(PROCESS_ASSESSMENT_INSTRUCTIONS_V5).toContain("inclusive por uma fala do cliente no meio")
    expect(PROCESS_ASSESSMENT_INSTRUCTIONS).not.toContain("trechos independentes")
  })
})

describe("pré-requisito INCONCLUSIVO ≠ NÃO cumprido", () => {
  it("pré-requisito com fala não verificada: a dependente MANTÉM status e evidência, marcada UNVERIFIED (nunca PREREQUISITE_NOT_MET)", () => {
    const result = verify([step(SUPPORT(), [STITCHED]), step(ORDER(), [TESTED], { dependsOn: SUPPORT() })])
    const dependent = byStep(result, "Prestar suporte antes")
    expect(dependent).toMatchObject({ status: "FOLLOWED", statusDowngradeReason: null, dependency: { kind: "DECLARED", state: "UNVERIFIED", gateStatus: "NOT_OBSERVABLE", gateReason: "EVIDENCE_NOT_VERIFIED" } })
    expect(dependent.transcriptEvidence.map((unit) => unit.quote)).toEqual([TESTED.replace(/^Operador:\s*/u, "")].map((quote) => expect.stringContaining(quote.slice(0, 40))))
    // Fora da analytics: não é conformidade verificada.
    expect(checkpointReadinessOf(dependent)).toMatchObject({ status: "NEEDS_REVIEW", reasons: expect.arrayContaining(["PREREQUISITE_UNVERIFIED"]) })
  })
  it("pré-requisito DESCUMPRIDO continua derrubando a dependente (PREREQUISITE_NOT_MET) — e a queda em cascata também é falha", () => {
    const result = verify([step(SUPPORT(), [TESTED], { status: "NOT_FOLLOWED", conductEvidence: { role: "ACTION_PERFORMED", relation: "DIFFERENT" } }), step(ORDER(), [OPENED], { dependsOn: SUPPORT() })])
    expect(byStep(result, "Prestar suporte antes")).toMatchObject({ status: "NOT_OBSERVABLE", statusDowngradeReason: "PREREQUISITE_NOT_MET", dependency: { state: "NOT_MET" } })
  })
  it("pré-requisito cumprido: a dependente segue como sempre (sem marca)", () => {
    const dependent = byStep(verify([step(SUPPORT(), [TESTED, OPENED]), step(ORDER(), [TESTED], { dependsOn: SUPPORT() })]), "Prestar suporte antes")
    expect(dependent.status).toBe("FOLLOWED")
    expect(dependent.dependency ?? null).toBeNull()
  })
})

describe("chamada 7 no pipeline: incerteza vai ao QA, nunca bloqueia o feedback", () => {
  const run = async (checkpoints: Raw[]) => {
    const deps = {
      enabled: true, store: createInMemoryReliableFeedbackStore(), policy: RELIABLE_FEEDBACK_AUTONOMOUS_POLICY,
      writer: { writeMonitoring: async () => { throw new Error("redator de itens não existe no V5") }, writeIndicator: async () => { throw new Error("não usado") }, writeNarrative: async () => ({ draft: null, error: "OFFLINE", provenance: null }) },
      loadMonitoringContext: vi.fn(async () => ({ transcript: TRANSCRIPT, label: "Atendimento de 29/09/2026", otherOperatorNames: [] })),
      loadIndicatorContext: async () => null, loadPublishedKnowledge: async () => new Map([[DOCUMENT.documentId, DOCUMENT]]),
      loadIndicatorDiagnosisPlan: async () => null, loadPeerPracticeData: async () => ({ peers: [], observations: [] }), resolveDiagnosticStrategy: async () => null,
      now: () => new Date("2026-09-30T12:00:00Z"),
    }
    const ORG = "00000000-0000-4000-8000-000000000001", OP = "11111111-1111-4111-8111-111111111111", INT = "22222222-2222-4222-8222-222222222222"
    const output = { kind: "monitoring", knowledgeExcerpts: presented, input: { organizationId: ORG, operatorId: OP, interactionId: INT, structured: { title: "t", summary: "s", impactedIndicator: "i", evidenceFound: TESTED, observedBehavior: "o", relatedProcedure: "p", recommendation: "r", processAssessment: assessment(checkpoints) } } }
    return generateReliableFeedback(deps, { organizationId: ORG, enrollmentId: "enr-7", workflowId: "wf", workflowVersionId: "v1", nodeId: "gerar", sourceNodeId: "agent", sourceType: "AGENT", domain: "MONITORING", sourceNodeOutput: output, collaboratorId: OP, interactionId: INT, indicatorMeasurementId: null, configuredAgentId: "agent" })
  }
  it("a avaliação REAL do smoke (trecho costurado + dependsOn) → HOLD_FOR_QA com a fala válida da dependente, nunca BLOCKED", async () => {
    const result = await run([step(SUPPORT(), [STITCHED]), step(ORDER(), [TESTED], { dependsOn: SUPPORT() })])
    expect(result.nodeOutput.disposition).toBe("HOLD_FOR_QA")
    const item = result.record.artifact!.items[0]!
    expect(item).toMatchObject({ section: "STRENGTH", process: { prerequisite: { state: "UNVERIFIED", gateStatus: "NOT_OBSERVABLE" } }, decision: { disposition: "HOLD_FOR_QA", reasons: expect.arrayContaining(["PREREQUISITE_UNVERIFIED"]) } })
    expect(item.facts.some((fact) => fact.role === "OPERADOR")).toBe(true)
    expect(qaExplanationsOf(item.decision.reasons).join(" ")).toContain("depende de uma etapa anterior que não pôde ser confirmada")
  })
  it("com o contrato corrigido (dois trechos independentes) → as duas etapas são pontos fortes e o feedback segue READY", async () => {
    const result = await run([step(SUPPORT(), [TESTED, OPENED]), step(ORDER(), [TESTED], { dependsOn: SUPPORT() })])
    expect(result.nodeOutput.disposition).toBe("READY")
    expect(result.record.artifact!.items.map((item) => [item.section, item.decision.disposition])).toEqual([["STRENGTH", "READY"], ["STRENGTH", "READY"]])
  })
})
