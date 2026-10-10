import { describe, expect, it } from "vitest"
import { createInMemoryReliableFeedbackStore } from "../infrastructure/in-memory-reliable-feedback-store.js"
import { generateReliableFeedback, type ReliableGenerationDeps, type ReliableGenerationRequest } from "./generate-reliable-feedback.js"
import type { ReliableFeedbackWriterPort } from "./ports.js"
import { RELIABLE_FEEDBACK_AUTONOMOUS_POLICY } from "../domain/reliable-feedback-item.js"
import { nodeOutputOf } from "../domain/reliable-feedback-artifact.js"
import { verifyProcessAssessments } from "../domain/process-assessment.js"
import { DEGRADABLE_CODES, guidancePatternLanguage, monitoringFallbackOf, validateMonitoringWording, type MonitoringWriterItem } from "../domain/reliable-writer.js"
import { behaviorWordingOf } from "../domain/behavior-presentation.js"
import { slotPatternLanguage } from "../../investigation/domain/interaction-feedback-writer.js"
import { observationsFrom } from "../../indicator-diagnosis/domain/process-patterns.js"
import { isObservationEligibleForAnalytics } from "../../indicator-diagnosis/domain/observation-readiness.js"
import { V171O_ASSESSMENT, V171O_COLLABORATOR_NAME, V171O_DOC_TITLE, V171O_PRESENTED, V171O_PUBLISHED, V171O_SUBJECT, V171O_TRANSCRIPT, V171O_WRITER_RAW, V171O_WRITER_SLOTS } from "../testing/contestacao-v171o-smoke-fixture.js"

/**
 * V1.7.1p — última correção antes de congelar a Monitoria por Flag, sobre o smoke REAL da V1.7.1o (SMOKE-V171O-CONTESTACAO-001;
 * sem modelo). Os dois pontos em QA daquele smoke não tinham dúvida humana real:
 *   - Confirmação de entendimento: "Você questionou se o cliente tinha alguma dúvida…" não repetia a palavra "entendimento"
 *     (GENERIC_WORDING no núcleo → texto inteiro no fallback → QA);
 *   - Protocolo: "Continue informando o protocolo sempre ao final…" — orientação FUTURA lida como padrão passado
 *     (PATTERN_LANGUAGE, que não degradava só o campo → QA).
 * E o texto de segurança da confirmação saía "Continue perguntando as informações ficaram claras.".
 */
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const verified = () => verifyProcessAssessments({ sources: [{ sourceRef: "S", assessment: clone(V171O_ASSESSMENT), presented: V171O_PRESENTED }], interactionId: "int-p", transcript: V171O_TRANSCRIPT, published: V171O_PUBLISHED, subject: V171O_SUBJECT, coveragePlan: true })

function writer(): ReliableFeedbackWriterPort & { inputs: MonitoringWriterItem[] } {
  const inputs: MonitoringWriterItem[] = []
  const bySlot = new Map(V171O_WRITER_RAW.items.map((item) => [item.slot, item]))
  return {
    inputs,
    writeMonitoring: async (input) => {
      inputs.push(...input.items)
      return { rawOutput: { items: input.items.flatMap((item) => { const original = bySlot.get(V171O_WRITER_SLOTS[item.requirement ?? ""] ?? ""); return original ? [{ ...original, slot: item.slot }] : [] }), presentation: V171O_WRITER_RAW.presentation } }
    },
    writeIndicator: async () => { throw new Error("não usado") },
  }
}
async function replay() {
  const store = createInMemoryReliableFeedbackStore({ onReactivate: () => true })
  const port = writer()
  const deps: ReliableGenerationDeps = {
    enabled: true, store, writer: port, policy: RELIABLE_FEEDBACK_AUTONOMOUS_POLICY,
    loadMonitoringContext: async () => ({ transcript: V171O_TRANSCRIPT, label: `Atendimento de 28/09/2026 · ${V171O_SUBJECT}`, otherOperatorNames: [], subjectOperatorName: V171O_COLLABORATOR_NAME }),
    loadIndicatorContext: async () => null, loadPublishedKnowledge: async () => V171O_PUBLISHED, loadIndicatorDiagnosisPlan: async () => null,
    loadPeerPracticeData: async () => ({ peers: [], observations: [] }), resolveDiagnosticStrategy: async () => null,
    loadRecipient: async () => ({ firstName: "Larissa" }), now: () => new Date("2026-09-28T12:00:00Z"),
  }
  const source = { kind: "monitoring", knowledgeExcerpts: V171O_PRESENTED, input: { organizationId: "org-p", operatorId: "op-p", interactionId: "int-p", structured: { evidenceFound: "x", observedBehavior: "o", relatedProcedure: V171O_DOC_TITLE, recommendation: "r", processAssessment: clone(V171O_ASSESSMENT) } } }
  const request: ReliableGenerationRequest = { organizationId: "org-p", enrollmentId: "enr-p", workflowId: "wf", workflowVersionId: "v1", nodeId: "gerar", sourceNodeId: "orq", sourceType: "AGENT", domain: "MONITORING", sourceNodeOutput: source, collaboratorId: "op-p", interactionId: "int-p", indicatorMeasurementId: null, configuredAgentId: null }
  const result = await generateReliableFeedback(deps, request)
  const artifact = result.record.artifact!
  const text = nodeOutputOf(result.record.id, artifact, artifact.items.map((item) => ({ itemIndex: item.index, status: "APPROVED_UNCHANGED" as const, finalWording: null }))).text
  return { store, artifact, text, inputs: port.inputs }
}
const itemOf = (artifact: Awaited<ReturnType<typeof replay>>["artifact"], code: string) => artifact.items.find((item) => item.process?.behavior?.code === code)!

describe("V1.7.1p — 7) replay do smoke REAL da V1.7.1o", () => {
  it("Confirmação de entendimento e Protocolo prontos com o texto do redator; 10 prontos, 0 QA, 0 bloqueados", async () => {
    const { artifact, store } = await replay()
    expect(artifact.findings).toMatchObject({ detected: 10, reliable: 10, inFeedback: 10, heldForQa: 0, blocked: 0 })
    expect(store.reviews).toEqual([])
    expect(artifact.items.map((item) => [item.process?.behavior?.code ?? item.process?.stepTitle, item.process?.status, item.decision?.disposition])).toEqual([
      ["INFORM_DEADLINE", "NOT_FOLLOWED", "READY"],
      ["RECAPITULATE_INTERACTION", "NOT_FOLLOWED", "READY"],
      ["IDENTIFY_CHARGE", "FOLLOWED", "READY"],
      ["CHECK_PAYMENT", "FOLLOWED", "READY"],
      ["Serviços digitais não reconhecidos", "FOLLOWED", "READY"],
      ["CANCEL_RECURRING_SERVICE", "FOLLOWED", "READY"],
      ["REGISTER_DISPUTE", "FOLLOWED", "READY"],
      ["CONFIRM_UNDERSTANDING", "FOLLOWED", "READY"],
      ["CONFIRM_SOLUTION", "FOLLOWED", "READY"],
      ["PROVIDE_PROTOCOL", "FOLLOWED", "READY"],
    ])
    const understanding = itemOf(artifact, "CONFIRM_UNDERSTANDING")
    expect(understanding.wordingSource).toBe("WRITER")
    expect(understanding.proposedWording?.observed).toBe("Você questionou se o cliente tinha alguma dúvida sobre o que foi conversado durante o atendimento.")
    const protocol = itemOf(artifact, "PROVIDE_PROTOCOL")
    expect(protocol.wordingSource).toBe("WRITER")
    expect(protocol.proposedWording?.whatYouCanDo).toBe("Continue informando o protocolo sempre ao final, logo após a recapitulação da solução.")
    expect(protocol.writerFieldValidation?.some((field) => field.action === "INVALIDATED_ITEM")).toBe(false)
  })

  it("nada mais muda: checkpointRefs, convergência e as 9 observações VERIFIED continuam iguais", async () => {
    const { text, inputs } = await replay()
    // O que vai ao modelo não mudou: o código do comportamento é só do validador (a projeção do payload lista os campos).
    expect(inputs.map((item) => item.checkpoint?.behavior ?? null)).toEqual(["INFORM_DEADLINE", "IDENTIFY_CHARGE", "CHECK_PAYMENT", "CANCEL_RECURRING_SERVICE", "REGISTER_DISPUTE", "CONFIRM_UNDERSTANDING", "CONFIRM_SOLUTION", "PROVIDE_PROTOCOL"])
    const titles = [...text.matchAll(/^### (.+)$/gm)].map((found) => found[1])
    expect(new Set(titles).size).toBe(titles.length)
    const observations = observationsFrom("op-p", [{ interactionId: "int-p", assessment: verified() }])
    expect(observations.map((observation) => [observation.canonicalBehavior, observation.checkpointRef, observation.status, observation.analyticsStatus])).toEqual([
      ["IDENTIFY_CHARGE", "CP-4a48ba4db9", "FOLLOWED", "VERIFIED"],
      ["CHECK_PAYMENT", "CP-8651ee6f0b", "FOLLOWED", "VERIFIED"],
      ["CANCEL_RECURRING_SERVICE", "CP-b9a41387af", "FOLLOWED", "VERIFIED"],
      ["REGISTER_DISPUTE", "CP-a91b89a0e2", "FOLLOWED", "VERIFIED"],
      ["INFORM_DEADLINE", "CP-a60913570d", "NOT_FOLLOWED", "VERIFIED"],
      ["RECAPITULATE_INTERACTION", "CP-08ba2d72ba", "NOT_FOLLOWED", "VERIFIED"],
      ["CONFIRM_UNDERSTANDING", "CP-c8acf59578", "FOLLOWED", "VERIFIED"],
      ["CONFIRM_SOLUTION", "CP-b9db6af3ba", "FOLLOWED", "VERIFIED"],
      ["PROVIDE_PROTOCOL", "CP-8eaac52713", "FOLLOWED", "VERIFIED"],
    ])
    expect(observations.every(isObservationEligibleForAnalytics)).toBe(true)
  })
})

describe("V1.7.1p — 1) especificidade pelo comportamento canônico", () => {
  const baseItem = async () => { const { inputs } = await replay(); return inputs.find((item) => item.checkpoint?.behavior === "CONFIRM_UNDERSTANDING")! }
  const wording = (observed: string, whatYouCanDo = "") => ({ observed, whyItMatters: "", whatYouCanDo })

  it("CONFIRM_UNDERSTANDING + pergunta de confirmação verificada: \"dúvida\" nomeia o comportamento (sem repetir \"entendimento\")", async () => {
    const item = await baseItem()
    expect(validateMonitoringWording(wording("Você questionou se o cliente tinha alguma dúvida sobre o que foi conversado durante o atendimento."), item, "x")).not.toContain("GENERIC_WORDING")
    expect(validateMonitoringWording(wording("Você perguntou se tudo tinha ficado claro para o cliente."), item, "x")).not.toContain("GENERIC_WORDING")
  })

  it("texto que não fala do comportamento continua genérico", async () => {
    const item = await baseItem()
    expect(validateMonitoringWording(wording("Você conduziu bem o atendimento até o final da ligação."), item, "x")).toContain("GENERIC_WORDING")
  })

  it("o vocabulário só vale com o comportamento canônico E a evidência de confirmação de entendimento", async () => {
    const item = await baseItem()
    const text = wording("Você questionou se o cliente tinha alguma dúvida sobre o que foi conversado durante o atendimento.")
    expect(validateMonitoringWording(text, { ...item, checkpoint: { ...item.checkpoint!, behavior: "PROVIDE_PROTOCOL" } }, "x")).toContain("GENERIC_WORDING")
    expect(validateMonitoringWording(text, { ...item, checkpoint: { ...item.checkpoint!, behavior: null } }, "x")).toContain("GENERIC_WORDING")
    const notAQuestion = { ...item, evidence: item.evidence.map((entry) => ({ ...entry, text: "Então é isso, obrigada por ligar." })) }
    expect(validateMonitoringWording(text, notAQuestion, "x")).toContain("GENERIC_WORDING")
  })

  it("o texto ainda não pode contradizer o achado (polaridade negativa num ponto forte continua recusada)", async () => {
    const item = await baseItem()
    expect(validateMonitoringWording(wording("Você não confirmou se o cliente tinha alguma dúvida e deixou de verificar o entendimento."), item, "x").length).toBeGreaterThan(0)
  })
})

describe("V1.7.1p — 2/3) \"sempre\" em orientação futura × afirmação sobre o histórico", () => {
  it("orientação futura em whatYouCanDo não é padrão passado", () => {
    expect(guidancePatternLanguage("whatYouCanDo", "Continue informando o protocolo sempre ao final, logo após a recapitulação da solução.")).toEqual([])
    expect(guidancePatternLanguage("whatYouCanDo", "Na próxima chamada, informe sempre o prazo exibido na ferramenta.")).toEqual([])
    expect(guidancePatternLanguage("whatYouCanDo", "Mantenha sempre a recapitulação antes de encerrar.")).toEqual([])
  })

  it("afirmação sobre o histórico continua padrão — em qualquer campo", () => {
    expect(guidancePatternLanguage("observed", "Você sempre informa o protocolo ao cliente.").length).toBeGreaterThan(0)
    expect(guidancePatternLanguage("whyItMatters", "Informar sempre o protocolo é importante.").length).toBeGreaterThan(0)
    expect(guidancePatternLanguage("whatYouCanDo", "Continue fazendo o que você sempre faz.").length).toBeGreaterThan(0)
    expect(guidancePatternLanguage("whatYouCanDo", "Você sempre informa o protocolo; continue assim.").length).toBeGreaterThan(0)
    expect(guidancePatternLanguage("whatYouCanDo", "Continue como você costuma fazer.").length).toBeGreaterThan(0)
    expect(guidancePatternLanguage("whatYouCanDo", "Continue informando o protocolo, como frequentemente faz.").length).toBeGreaterThan(0)
  })

  it("o Writer V2 do feedback direto não mudou (checagem comum intacta)", () => {
    expect(slotPatternLanguage("whatYouCanDo", "Continue informando o protocolo sempre ao final.").length).toBeGreaterThan(0)
  })

  it("padrão só em whatYouCanDo degrada o CAMPO; o achado continua pronto", async () => {
    expect(DEGRADABLE_CODES.whatYouCanDo.has("PATTERN_LANGUAGE")).toBe(true)
    expect(DEGRADABLE_CODES.whyItMatters.has("PATTERN_LANGUAGE")).toBe(false)
    const raw = clone(V171O_WRITER_RAW)
    raw.items.find((item) => item.slot === "ITEM_8")!.whatYouCanDo = "Continue fazendo o que você sempre faz ao final da chamada."
    const store = createInMemoryReliableFeedbackStore({ onReactivate: () => true })
    const bySlot = new Map(raw.items.map((item) => [item.slot, item]))
    const port: ReliableFeedbackWriterPort = {
      writeMonitoring: async (input) => ({ rawOutput: { items: input.items.flatMap((item) => { const original = bySlot.get(V171O_WRITER_SLOTS[item.requirement ?? ""] ?? ""); return original ? [{ ...original, slot: item.slot }] : [] }), presentation: raw.presentation } }),
      writeIndicator: async () => { throw new Error("não usado") },
    }
    const deps: ReliableGenerationDeps = {
      enabled: true, store, writer: port, policy: RELIABLE_FEEDBACK_AUTONOMOUS_POLICY,
      loadMonitoringContext: async () => ({ transcript: V171O_TRANSCRIPT, label: "x", otherOperatorNames: [], subjectOperatorName: V171O_COLLABORATOR_NAME }),
      loadIndicatorContext: async () => null, loadPublishedKnowledge: async () => V171O_PUBLISHED, loadIndicatorDiagnosisPlan: async () => null,
      loadPeerPracticeData: async () => ({ peers: [], observations: [] }), resolveDiagnosticStrategy: async () => null,
      loadRecipient: async () => ({ firstName: "Larissa" }), now: () => new Date("2026-09-28T12:00:00Z"),
    }
    const source = { kind: "monitoring", knowledgeExcerpts: V171O_PRESENTED, input: { organizationId: "org-p", operatorId: "op-p", interactionId: "int-p", structured: { evidenceFound: "x", observedBehavior: "o", relatedProcedure: V171O_DOC_TITLE, recommendation: "r", processAssessment: clone(V171O_ASSESSMENT) } } }
    const result = await generateReliableFeedback(deps, { organizationId: "org-p", enrollmentId: "enr-q", workflowId: "wf", workflowVersionId: "v1", nodeId: "gerar", sourceNodeId: "orq", sourceType: "AGENT", domain: "MONITORING", sourceNodeOutput: source, collaboratorId: "op-p", interactionId: "int-p", indicatorMeasurementId: null, configuredAgentId: null })
    const protocol = result.record.artifact!.items.find((item) => item.process?.behavior?.code === "PROVIDE_PROTOCOL")!
    expect(protocol.decision?.disposition).toBe("READY")
    expect(protocol.wordingSource).toBe("WRITER")
    expect(protocol.proposedWording?.observed).toBe("Você finalizou o resumo informando ao cliente o número do protocolo do atendimento.")
    expect(protocol.writerFieldValidation?.find((field) => field.field === "whatYouCanDo")).toMatchObject({ codes: ["PATTERN_LANGUAGE"], action: "FALLBACK_FIELD" })
    expect(protocol.proposedWording?.whatYouCanDo).not.toMatch(/sempre/)
  })
})

describe("V1.7.1p — 4) texto de segurança de item que é pergunta direta da base", () => {
  const knowledge = { quote: "- “As informações ficaram claras?”", step: "“As informações ficaram claras?”", heading: "47. Confirmação de entendimento", leadIn: "Perguntar:", contentKind: "RULE_CONTENT" }

  it("ponto forte: \"Continue perguntando se as informações ficaram claras.\"", () => {
    const wording = behaviorWordingOf({ section: "STRENGTH", process: { evidenceType: "OBSERVED_ACTION" }, knowledge }, ["Ficou alguma dúvida sobre o que a gente conversou?"], true)
    expect(wording.whatYouCanDo).toBe("Continue perguntando se as informações ficaram claras.")
  })

  it("pergunta com palavra interrogativa fica indireta sem \"se\"; lista comum não muda", () => {
    const wh = behaviorWordingOf({ section: "STRENGTH", process: { evidenceType: "OBSERVED_ACTION" }, knowledge: { ...knowledge, quote: "- “Qual cobrança você não reconhece?”", step: "“Qual cobrança você não reconhece?”" } }, [], true)
    expect(wh.whatYouCanDo).toBe("Continue perguntando qual cobrança você não reconhece.")
    const list = behaviorWordingOf({ section: "STRENGTH", process: { evidenceType: "OBSERVED_ACTION" }, knowledge: { quote: "O operador deverá permitir que o cliente explique:\n\n- Qual cobrança não reconhece;\n- Se a conta já foi paga;", heading: "6. Escuta", contentKind: "RULE_CONTENT" } }, ["Qual cobrança você não está reconhecendo?"], true)
    expect(list.whatYouCanDo).toBe("Continue permitindo que o cliente explique qual cobrança não reconhece e se a conta já foi paga.")
  })

  it("ponto de desenvolvimento: \"Na próxima chamada, pergunte se as informações ficaram claras.\"", () => {
    const wording = behaviorWordingOf({ section: "OPPORTUNITY", process: { evidenceType: "VERIFIED_OMISSION" }, knowledge }, [], true)
    expect(wording.whatYouCanDo).toBe("Na próxima chamada, pergunte se as informações ficaram claras.")
    expect(wording.observed).toBe("Nesta chamada, faltou perguntar se as informações ficaram claras: no momento mostrado abaixo, isso não apareceu.")
  })

  it("o \"Para manter\" do fallback do item real do smoke é gramatical e passa nos mesmos validadores", async () => {
    const { inputs } = await replay()
    const item = inputs.find((entry) => entry.checkpoint?.behavior === "CONFIRM_UNDERSTANDING")!
    const fallback = monitoringFallbackOf(item)
    expect(fallback.wording.whatYouCanDo).toBe("Continue perguntando se as informações ficaram claras.")
    const observed = "Você questionou se o cliente tinha alguma dúvida sobre o que foi conversado durante o atendimento."
    expect(validateMonitoringWording({ observed, whyItMatters: "", whatYouCanDo: fallback.wording.whatYouCanDo }, item, "x")).toEqual([])
  })
})
