import { describe, expect, it } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { createInMemoryReliableFeedbackStore } from "../infrastructure/in-memory-reliable-feedback-store.js"
import { publishReliableFeedbackToFollowUp } from "../infrastructure/publish-reliable-feedback.js"
import { generateReliableFeedback, type ReliableGenerationDeps, type ReliableGenerationRequest } from "./generate-reliable-feedback.js"
import { decideReliableReview } from "./decide-reliable-review.js"
import { toReliableReviewDetail } from "../../interaction-feedback/domain/review-view.js"
import { RELIABLE_FEEDBACK_AUTONOMOUS_POLICY, RELIABLE_FEEDBACK_PILOT_POLICY } from "../domain/reliable-feedback-item.js"
import type { MonitoringWriterInput } from "../domain/reliable-writer.js"
import { projectMonitoringInputForModel } from "../domain/reliable-writer-prompts.js"
import type { ReliableFeedbackWriterPort } from "./ports.js"
import { SMOKE_DETAIL, SMOKE_DOC, SMOKE_DOC_TITLE, SMOKE_INTERACTION, SMOKE_KB_EXAMPLE_PROTOCOL, SMOKE_LABEL, SMOKE_LINES, SMOKE_OPERATOR, SMOKE_ORG, smokeAssessment, smokePresented, smokePublished, smokeTranscript } from "../testing/contestacao-smoke-fixture.js"

/**
 * V1.7.1 (§37) — o caso do smoke real da V1.7.0, reproduzido pela ESTRUTURA (sem modelo, sem banco): Orquestrador com um
 * especialista (Faturamento) em avaliação de processo → "Gerar feedback" (AUTONOMOUS_V1) → QA → publicação. O redator falso
 * devolve textos no nível do smoke, inclusive o "garante" que passou lá.
 */
const orchestratorOutput = () => ({
  text: "Resultado do especialista de Faturamento.",
  orchestratorId: "orch-monitoria",
  orchestratorName: "Orquestrador de Monitoria Operacional",
  agentId: "agent-faturamento",
  calls: [{ toolName: "especialista_faturamento", query: "Avalie a chamada." }],
  results: [{
    agentId: "agent-faturamento",
    toolName: "especialista_faturamento",
    contract: "FEEDBACK",
    text: "…",
    structured: { title: "t", summary: "s", impactedIndicator: "i", evidenceFound: SMOKE_LINES.identify, observedBehavior: "o", relatedProcedure: SMOKE_DOC_TITLE, recommendation: "r", processAssessment: smokeAssessment() },
    knowledge: { mode: "RETRIEVAL", retrieved: smokePresented.map((excerpt) => ({ documentId: excerpt.documentId, documentTitle: excerpt.documentTitle, heading: excerpt.heading, excerpt: excerpt.excerpt })) },
  }],
  structuredResult: null,
  supportMaterialCandidates: [],
  orchestration: { routing: { mode: "DETERMINISTIC", reason: "DECLARED_DOMAINS" }, synthesis: { mode: "PASSTHROUGH", reason: "SINGLE_STRUCTURED_SPECIALIST" } },
})

/** Textos no nível do smoke; ITEM_3 repete o "garante" (whatYouCanDo) que passou na V1.7.0. */
const SMOKE_WRITER_TEXT: Record<string, { observed: string; whyItMatters: string | null; whatYouCanDo: string | null }> = {
  "Explicar prazo": { observed: "Ao orientar sobre a análise da contestação, você não explicou o prazo previsto para a análise.", whyItMatters: null, whatYouCanDo: "Ao registrar a contestação, informe o prazo da análise exibido na ferramenta antes de encerrar a orientação." },
  "Qual cobrança não reconhece": { observed: "Você confirmou o cadastro do cliente e solicitou a identificação da cobrança não reconhecida.", whyItMatters: null, whatYouCanDo: "Mantenha a prática de identificar qual cobrança está sendo contestada." },
  "Registrar contestação": { observed: "Você declarou que registraria a contestação do valor e o cancelamento do serviço.", whyItMatters: null, whatYouCanDo: "Continuar formalizando o registro da contestação garante que a solicitação seja encaminhada conforme o fluxo oficial." },
  "Registrar protocolo": { observed: "Você informou ao cliente o registro do protocolo da contestação.", whyItMatters: null, whatYouCanDo: "Continue aplicando a etapa de registrar protocolo." },
}

function setup() {
  const inputs: MonitoringWriterInput[] = []
  const writer: ReliableFeedbackWriterPort = {
    writeMonitoring: async (input) => {
      inputs.push(input)
      return { rawOutput: { items: input.items.map((item) => ({ slot: item.slot, ...SMOKE_WRITER_TEXT[item.checkpoint!.stepTitle!]! })) } }
    },
    writeIndicator: async () => { throw new Error("não usado") },
  }
  const reactivations: unknown[] = []
  const store = createInMemoryReliableFeedbackStore({ onReactivate: (input) => { reactivations.push(input); return true } })
  const deps: ReliableGenerationDeps = {
    enabled: true,
    store,
    writer,
    policy: RELIABLE_FEEDBACK_AUTONOMOUS_POLICY,
    loadMonitoringContext: async (organizationId, interactionId, collaboratorId) => (organizationId === SMOKE_ORG && interactionId === SMOKE_INTERACTION && collaboratorId === SMOKE_OPERATOR ? { transcript: smokeTranscript(), label: SMOKE_LABEL, otherOperatorNames: [] } : null),
    loadIndicatorContext: async () => null,
    loadPublishedKnowledge: async (organizationId, ids) => new Map(organizationId === SMOKE_ORG ? [...smokePublished].filter(([id]) => ids.includes(id)) : []),
    loadIndicatorDiagnosisPlan: async () => null,
    loadPeerPracticeData: async () => ({ peers: [], observations: [] }),
    resolveDiagnosticStrategy: async () => null,
    now: () => new Date("2026-09-25T13:00:00Z"),
  }
  const request: ReliableGenerationRequest = { organizationId: SMOKE_ORG, enrollmentId: "enr-smoke", workflowId: "wf", workflowVersionId: "v1", nodeId: "gerar-feedback", sourceNodeId: "orquestrador", sourceType: "ORCHESTRATOR", domain: "MONITORING", sourceNodeOutput: orchestratorOutput(), collaboratorId: SMOKE_OPERATOR, interactionId: SMOKE_INTERACTION, indicatorMeasurementId: null, configuredAgentId: null }
  return { deps, request, store, inputs, reactivations }
}

describe("V1.7.1 — smoke da contestação reproduzido pela estrutura (§37)", () => {
  it("omissão verificada vira ponto de desenvolvimento AUTÔNOMO; 'garante' é barrado; nada de exemplo inventado no texto", async () => {
    const { deps, request, inputs } = setup()
    const result = await generateReliableFeedback(deps, request)
    const artifact = result.record.artifact!
    const byStep = (step: string) => artifact.items.find((item) => item.process?.stepTitle === step)!

    // Omissão verificada: READY (não vai ao QA só por ser omissão), com a regra e o detalhe da base.
    expect(byStep("Explicar prazo")).toMatchObject({ section: "OPPORTUNITY", process: { evidenceType: "VERIFIED_OMISSION" }, knowledge: { applicability: "VERIFIED", applicabilityBasis: "VERIFIED_OMISSION", detail: { quote: SMOKE_DETAIL } }, wordingSource: "WRITER", decision: { disposition: "READY", reasons: ["AUTONOMY_CRITERIA_MET"] } })
    expect(byStep("Qual cobrança não reconhece")).toMatchObject({ section: "STRENGTH", process: { evidenceType: "OBSERVED_ACTION" }, decision: { disposition: "READY" } })
    // "garante" no "Como aplicar" (campo complementar) → V1.7.1i: só esse campo sai (texto do sistema); o núcleo do redator fica.
    expect(byStep("Registrar contestação")).toMatchObject({ process: { evidenceType: "OBSERVED_DECLARATION" }, wordingSource: "WRITER", writerViolations: [], writerFieldValidation: expect.arrayContaining([expect.objectContaining({ field: "whatYouCanDo", codes: expect.arrayContaining(["GUARANTEED_EFFECT"]) })]) })
    expect(byStep("Registrar contestação").proposedWording!.whatYouCanDo).not.toMatch(/garant/i)
    expect(artifact.processAssessment).toMatchObject({ summary: { verifiedOmissions: 1 } })

    // O redator recebe a etapa, o tipo da evidência e o contexto literal da regra; o exemplo do §48 fica só na análise.
    const payload = projectMonitoringInputForModel(inputs[0]!)
    // V1.7.1e — contrato V6: o ASSUNTO do ponto (nunca o nome interno da etapa) vai ao redator.
    expect(payload.contract).toBe("WORKFLOW_MONITORING_FEEDBACK_WRITER_INPUT_V6")
    expect(payload.items[0]).toMatchObject({ step: { topic: "Prazo da análise", evidenceType: "VERIFIED_OMISSION" }, knowledge: { section: "15. Serviços digitais não reconhecidos", leadIn: "Se o cliente não reconhecer:", quote: "Explicar prazo;", detail: SMOKE_DETAIL } })
    const everything = JSON.stringify(artifact.items.map((item) => [item.proposedWording, item.facts]))
    expect(everything).not.toContain(SMOKE_KB_EXAMPLE_PROTOCOL)
  })

  it("QA não desliga guarda: edição com 'garante' é bloqueada; aprovação libera o Workflow com o formato de supervisor (fala + base + documento + link)", async () => {
    // V1.7.1j — neste fixture nenhum ponto vai mais ao QA pela política autônoma (protocolo ancora pelo próprio objeto); a guarda da
    // edição humana é provada com a política PILOTO (todo ponto em QA).
    const { deps: autonomous, request, store, reactivations } = setup()
    const deps = { ...autonomous, policy: RELIABLE_FEEDBACK_PILOT_POLICY }
    await generateReliableFeedback(deps, request)
    const review = store.reviews.find((entry) => entry.reviewItem.process?.stepTitle === "Registrar protocolo")!
    const detail = toReliableReviewDetail(review, { collaborator: { id: SMOKE_OPERATOR, name: "Operador", jobTitle: null }, team: null, occurredAt: null, createdAt: new Date("2026-09-25T13:00:00Z"), reviewerName: null, selection: { decision: { disposition: "HOLD_FOR_QA", structural: "STRUCTURALLY_EMITTABLE", reasons: [], policyVersion: "P", autonomyEligible: false }, deliveredAt: null } as never })
    expect(detail.processBasis).toMatchObject({ stepTitle: "Registrar protocolo", leadIn: "Se o cliente não reconhecer:", heading: "15. Serviços digitais não reconhecidos" })

    const blocked = await decideReliableReview({ store, now: deps.now }, { organizationId: SMOKE_ORG, reviewId: review.id, reviewerId: "qa-1", decision: "APPROVED_EDITED", reasonCategory: "TONE", comment: "ajuste", finalWording: { observed: "Você informou o protocolo ao cliente.", whyItMatters: "", whatYouCanDo: "Informar o protocolo assegura o encaminhamento correto." } })
    expect(blocked).toMatchObject({ ok: false, error: "EDIT_VIOLATES_CONTRACT", violations: expect.arrayContaining(["GUARANTEED_EFFECT"]) })

    // V1.7.1a — todas as etapas entram (sem limite editorial): o protocolo (regra só literal) também está no QA.
    expect(store.reviews.map((entry) => entry.reviewItem.process?.stepTitle)).toContain("Registrar protocolo")
    for (const pending of store.reviews.slice(0, -1)) expect(await decideReliableReview({ store, now: deps.now }, { organizationId: SMOKE_ORG, reviewId: pending.id, reviewerId: "qa-1", decision: "APPROVED_UNCHANGED" })).toMatchObject({ ok: true, resolution: null })
    const approved = await decideReliableReview({ store, now: deps.now }, { organizationId: SMOKE_ORG, reviewId: store.reviews.at(-1)!.id, reviewerId: "qa-1", decision: "APPROVED_UNCHANGED" })
    expect(approved).toMatchObject({ ok: true, resolution: { disposition: "READY", reactivated: true } })
    expect(reactivations).toHaveLength(1)

    const ready = await generateReliableFeedback(deps, request)
    expect(ready).toMatchObject({ reused: true, nodeOutput: { disposition: "READY" } })
    const text = ready.nodeOutput.text
    // V1.7.2 — sem placar: a abertura diz o que foi bem conduzido e o principal ajuste.
    expect(text).not.toMatch(/Visão geral|pontos fortes|ponto a desenvolver/)
    // Feedback por Flag V2 — narrativa de supervisor: o principal ajuste dito em linguagem humana, detalhes abaixo.
    expect(text).toMatch(/O principal ajuste está [^.]*prazo da análise/)
    expect(text).toContain("## O que precisa ser ajustado")
    // V1.7.1e — título = ASSUNTO do comportamento; nada de numeração editorial nem de "Ponto de desenvolvimento · <etapa>".
    expect(text).toContain("### Prazo da análise")
    expect(text).not.toMatch(/Ponto (?:de desenvolvimento|forte) ·/)
    expect(text).toContain(`> Você disse: “${SMOKE_LINES.analysis}”`)
    // V1.7.1d — cada trecho com a PRÓPRIA seção: a regra da etapa (seção 15) e o detalhe de como cumprir (seção 35).
    expect(text).toContain("> “Se o cliente não reconhecer: … Explicar prazo;”")
    expect(text).toContain(`> _Seção “Prazo da análise”:_ “${SMOKE_DETAIL}”`)
    // V1.7.1e — o link do processo em CADA achado (documento · seção · Abrir processo ↗).
    expect(text).toContain(`_${SMOKE_DOC_TITLE} · Seção: Serviços digitais não reconhecidos_ — [Abrir processo ↗](/materiais/${SMOKE_DOC})`)
    expect(text).toContain(`[Procedimento Operacional — Contestação de Contas Móvel ↗](/materiais/${SMOKE_DOC})`)
    expect(text).toContain("**Como melhorar:** Ao registrar a contestação, informe o prazo da análise exibido na ferramenta antes de encerrar a orientação.")
    // V1.7.1m — título COMPORTAMENTAL quando a etapa tem comportamento canônico ("Qual cobrança não reconhece" → identificação da
    // cobrança; "Registrar contestação" → registro da contestação); sem comportamento, o nome da etapa (Registro de protocolo).
    // V1.7.2 — os cumpridos em "O que manter" (vocabulário do comportamento; sem bloco por ponto nem "O que você fez bem").
    const maintain = text.slice(text.indexOf("## O que manter"), text.indexOf("**Materiais utilizados**"))
    expect(maintain).toContain("**Identificação da cobrança**")
    expect(maintain).toMatch(/registr/)
    expect(text).not.toContain("**O que você fez bem**")
    expect(text).toContain(`- [${SMOKE_DOC_TITLE} ↗](/materiais/${SMOKE_DOC}) — utilizado em: Prazo da análise · Identificação da cobrança · Registro da contestação · Registro de protocolo`)
    expect(text).not.toMatch(/garant|assegur/i)
    expect(text).not.toContain(SMOKE_KB_EXAMPLE_PROTOCOL)
  })

  it("publicação: defesa final recusa efeito garantido que chegou ao artefato (ex.: artefato gerado antes da V1.7.1) — nada é publicado", async () => {
    const { deps, request, store } = setup()
    const result = await generateReliableFeedback(deps, request)
    // Simula o artefato do smoke da V1.7.0: item READY com "garante" no texto (sem a guarda nova).
    const stored = store.artifacts.get(result.artifactId)!
    const legacy = stored.artifact!.items.find((item) => item.process?.stepTitle === "Qual cobrança não reconhece")!
    legacy.proposedWording = { ...legacy.proposedWording!, whatYouCanDo: "Continuar identificando a cobrança garante que a solicitação seja encaminhada." }
    for (const item of stored.artifact!.items) if (item.decision.disposition === "HOLD_FOR_QA") item.decision = { ...item.decision, disposition: "BLOCKED" }
    for (const review of store.reviews) review.reviewStatus = "REJECTED"
    const untouched = new Proxy({}, { get: () => { throw new Error("o banco não pode ser tocado") } }) as Database
    await expect(publishReliableFeedbackToFollowUp(untouched, store, { organizationId: SMOKE_ORG, enrollmentId: "enr-smoke", nodeId: "output", recipientId: SMOKE_OPERATOR, artifactId: result.artifactId })).rejects.toMatchObject({ name: "RELIABLE_FEEDBACK_UNSUPPORTED_EFFECT" })
  })
})
