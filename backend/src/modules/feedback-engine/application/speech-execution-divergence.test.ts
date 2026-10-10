import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import "../testing/no-external-ai.js"
import { compositionPayloadOf, verificationFactsOf } from "../domain/composition-prompt.js"
import { obligationReadingOf } from "../domain/call-review.js"
import type { FeedbackBrief } from "../domain/feedback-brief.js"
import { OBLIGATION_CONFIRMATION_RESPONSE_SCHEMA, OBLIGATION_REVIEW_RESPONSE_SCHEMA, OBLIGATION_REVIEW_SYSTEM_PROMPT } from "../domain/obligation-review.js"
import { STAGE_MAX_OUTPUT_TOKENS } from "./engine-meter.js"
import { createInMemoryFeedbackMemoryStore } from "../infrastructure/in-memory-feedback-memory-store.js"
import { verificationRecordOf } from "../infrastructure/postgres-feedback-memory-store.js"
import { confirmAllObligations, fakeEngineModel, type ObligationLabels, type ObligationReviewPayload } from "../testing/fake-engine-model.js"
import { composeFeedback } from "./compose-feedback.js"
import { generateFeedback, type GenerateFeedbackDeps, type GenerateFeedbackRequest } from "./generate-feedback.js"
import type { AnalyzeCallDeps } from "./analyze-call.js"
import type { EngineModelPort, EngineModelRequest } from "./ports.js"

/**
 * OBRIGAÇÃO × FALA × EXECUÇÃO, DIVERGÊNCIAS E NECESSIDADE CENTRAL (`CALL_ANALYSIS_LOGIC_V13`, revisão V3) — modelo FALSO, memória em RAM,
 * zero IA. Mini-caso SINTÉTICO no formato da C07 (cobrança após cancelamento pendente): reproduz as consequências de CÓDIGO dos defeitos
 * da rodada real V11 e as da correção. Nada aqui prova que um modelo real lê a fonte do jeito certo — só o que o código faz com as
 * leituras que recebe.
 */
const ORG = "00000000-0000-4000-8000-000000000001"
const OPERATOR = "00000000-0000-4000-8000-0000000000aa"
const AGENT = "00000000-0000-4000-8000-00000000a001"
const INTERACTION = "00000000-0000-4000-8000-00000000c007"
const DOC = "00000000-0000-4000-8000-0000000000d1"
const PROCEDURE = `# Procedimento — Contestação de cobrança (sintético)

## 1. Cobrança após cancelamento

Verificar:
- Data da solicitação;
- Falha na conclusão.

Informar ao cliente o status do cancelamento que consta no sistema.

## 2. Análise

Abrir análise de faturamento e informar o prazo de até cinco dias úteis.

## 3. Encerramento

Antes de encerrar, informar:
- O próximo passo e o prazo;
- O número do protocolo.

- Informe o número do protocolo antes de encerrar qualquer chamada.
`
const TRANSCRIPT = [
  "Operador: Bom dia, aqui é a Ana. Com quem eu falo?",
  "Cliente: É a Sônia. Eu cancelei a linha e continuo pagando.",
  "Operador: Encontrei aqui. O pedido de cancelamento está aberto desde o dia 2 de julho, mas não foi concluído.",
  "Cliente: E agora?",
  "Operador: Registrei a contestação. A equipe tem até cinco dias úteis para analisar.",
  "Cliente: Tá bom.",
  "Operador: Ficou alguma dúvida?",
  "Cliente: Não, obrigada.",
].join("\n")

function setup(model: EngineModelPort) {
  const stores = createInMemoryFeedbackMemoryStore()
  const analyze: AnalyzeCallDeps = {
    memory: stores,
    model,
    loadInteraction: async (_org, id) => (id === INTERACTION ? { id: INTERACTION, organizationId: ORG, operatorId: OPERATOR, operatorName: "Ana", startedAt: new Date("2026-08-21T13:00:00Z"), endedAt: new Date("2026-08-21T13:06:00Z"), reason: "Contestação de cobrança", channel: "VOICE", subjectCanonical: null, flags: [], transcript: { content: TRANSCRIPT, checksum: "c07s" }, teamId: "t1", subteamId: null, supervisorId: "s1", timeZone: "America/Fortaleza" } : null),
    loadAgent: async () => ({ id: AGENT, name: "Especialista de Faturamento", objective: "Avaliar contestação", contextPrompt: null, updatedAt: new Date("2026-09-01T00:00:00Z"), businessDomainId: null }),
    loadDocuments: async () => [{ documentId: DOC, title: "Procedimento — Contestação de cobrança", version: 1, content: PROCEDURE, contentHash: "hc", perspective: "RULE_IN_FORCE_AT_CALL" }],
    loadPreviousVersion: async () => null,
    now: () => new Date("2026-09-30T12:00:00Z"),
  }
  const deps: GenerateFeedbackDeps = {
    memory: stores, messages: stores, model, analyze,
    investigate: { memory: stores, data: {} as never, analyze, strategy: async () => { throw new Error("não usado") }, now: analyze.now },
    loadDocumentTitles: async () => new Map([[DOC, "Procedimento — Contestação de cobrança"]]),
    loadAgentConfiguredAt: async () => null,
    now: analyze.now,
  }
  return { stores, deps }
}
const request = (): GenerateFeedbackRequest => ({ organizationId: ORG, enrollmentId: "enr-c07", workflowId: "wf", workflowVersionId: "v", nodeId: "feedback", sourceNodeId: "agent", domain: "MONITORING", sourceNodeOutput: { kind: "monitoring", input: {} }, collaboratorId: OPERATOR, interactionId: INTERACTION, indicatorMeasurementId: null, configuredAgentId: AGENT, selectionReason: "teste", now: new Date("2026-09-30T12:00:00Z") })

type Handle = (text: string) => string
type Obligation = Record<string, unknown>
const analysisWith = (handle: Handle, obligations: Obligation[]) => ({
  need: { summary: "A cliente contesta mensalidade cobrada depois de pedir o cancelamento.", conditions: [{ text: "Cancelamento pendente desde 02/07.", evidence: [{ turn: "T3", speaker: "OPERADOR", quote: "Encontrei aqui. O pedido de cancelamento está aberto desde o dia 2 de julho, mas não foi concluído." }] }] },
  sources: { primary: "D1", related: [], rationale: "Procedimento da contestação." },
  argumentScripts: [], notAssessed: [], sourceConflicts: [], limitations: [],
  conduct: { pathTaken: "Identificou o cancelamento pendente, abriu análise e encerrou.", assessment: "UNDETERMINED", rationale: "—" },
  obligations,
})
const obligation = (fields: Partial<Obligation> & { id: string; sources: string[]; action: string; finding: string }): Obligation => ({ condition: null, conditionHolds: "NOT_CONDITIONAL", conditionEvidence: [], items: [], itemsMode: "NONE", where: "IN_CONVERSATION", evidence: [], opportunityTurn: null, materiality: "HIGH", role: "CENTRAL", rationale: "—", guidance: null, ...fields })
// A leitura da ANÁLISE na C07 (V10/V11): "Verificar" posto NA conversa, com o RELATO do resultado como conduta.
const verify = (handle: Handle) => obligation({ id: "OBL-VERIF", sources: [handle("Verificar:"), handle("Data da solicitação"), handle("Falha na conclusão")], action: "Verificar a data da solicitação de cancelamento e se houve falha na conclusão", finding: "MET", evidence: [{ turn: "T3", speaker: "OPERADOR", quote: "Encontrei aqui. O pedido de cancelamento está aberto desde o dia 2 de julho, mas não foi concluído.", role: "CONDUCT" }], rationale: "A operadora consultou o histórico e identificou que o cancelamento não foi concluído." })
const currentAnalysis = (stores: ReturnType<typeof createInMemoryFeedbackMemoryStore>) => stores.assessments.find((entry) => entry.isCurrent)!.analysis
const message = (stores: ReturnType<typeof createInMemoryFeedbackMemoryStore>) => [...stores.messages.values()][0]!
const reviewText = (fake: ReturnType<typeof fakeEngineModel>) => fake.calls.find((call) => call.stage === "CALL_REVIEW")!.contents[0]!.text
const reviewPayload = (fake: ReturnType<typeof fakeEngineModel>) => JSON.parse(reviewText(fake).split("ANÁLISE A REVISAR (JSON):")[1]!) as ObligationReviewPayload
const confirmationPayload = (fake: ReturnType<typeof fakeEngineModel>) => JSON.parse(fake.calls.find((call) => call.stage === "CALL_CONFIRMATION")!.contents[0]!.text.split("CONCLUSÕES A CONFERIR (JSON):")[1]!) as ObligationReviewPayload
/** Revisão padrão com a leitura de UM alvo trocada. */
const reviewing = (overrides: Record<string, Record<string, unknown>>, extra: () => Record<string, unknown> = () => ({})) => (payload: ObligationReviewPayload, labelsOf: (id: string) => ObligationLabels | null) => {
  const review = confirmAllObligations(payload, labelsOf)
  return { ...review, ...extra(), claims: review.claims.map((claim) => ({ ...claim, ...(overrides[claim.id] ?? {}) })) }
}

describe("relato do resultado ≠ execução (V11: 'Verificar: data da solicitação; falha na conclusão' confirmado como cumprido)", () => {
  it("a revisão recebe a obrigação SEM os rótulos da análise e lê o ato exigido na fonte: fora da conversa → não confirmado; o relato fica como declaração, com a fala preservada", async () => {
    const fake = fakeEngineModel({ analysis: (handle) => analysisWith(handle, [verify(handle)]), obligationReview: reviewing({ O1: { actPlace: "OUTSIDE_CONVERSATION", evidenceReading: "STATEMENT_ABOUT_ACTION", outsideDependency: true } }) })
    const { deps, stores } = setup(fake.model)
    await generateFeedback(deps, request())
    // O que a revisora recebeu: ação, fontes, falas e a leitura a examinar — nenhum "where"/"role" da análise.
    const sent = reviewPayload(fake).claims.find((claim) => claim.id === "O1")!
    expect(sent).not.toHaveProperty("where")
    expect(sent.evidence.every((quote) => !("role" in quote))).toBe(true)
    expect(sent.analystReading).toMatch(/consultou o histórico/)
    expect(OBLIGATION_REVIEW_SYSTEM_PROMPT).toMatch(/RELATO NÃO É EXECUÇÃO/)
    const criterion = currentAnalysis(stores).criteria.find((entry) => entry.lineHandle === "O1")!
    expect(criterion).toMatchObject({ status: "NOT_OBSERVABLE", confirmation: "UNCONFIRMED", observability: "OUTSIDE_CONVERSATION", executionClaim: "DECLARED", evidenceKind: "DECLARED_ACTION" })
    expect(criterion.confirmationReasons).toContain("EXECUTION_OUTSIDE_CONVERSATION")
    expect(criterion.downgrades).toContain("ACT_PLACE_READ_OUTSIDE_BY_REVIEW")
    expect(criterion.evidence.map((quote) => quote.turn)).toEqual(["T3"])
    expect(verificationRecordOf(criterion).review).toMatchObject({ actPlace: "OUTSIDE_CONVERSATION" })
    // Memória × mensagem: nem acerto nem desvio; a consulta é limite de cobertura (com "o operador disse que fez").
    expect(currentAnalysis(stores).coverage.occurrences).toMatchObject({ metRules: 0 })
    expect(currentAnalysis(stores).scenario.pathTaken).toMatch(/Verificar.*declarada na conversa \(execução em sistema/)
  })

  it("lido FORA da conversa com veredito INCERTO (rodada real V12): a consequência vale do mesmo jeito — nunca fica 'na conversa' com o relato como conduta", async () => {
    const fake = fakeEngineModel({ analysis: (handle) => analysisWith(handle, [verify(handle), inform(handle, "IN_CONVERSATION", "MET")]), obligationReview: reviewing({ O1: { verdict: "UNCERTAIN", issues: ["INTERNAL_ACTION_NOT_OBSERVABLE", "DECLARED_NOT_OBSERVED"], actPlace: "OUTSIDE_CONVERSATION", evidenceReading: "STATEMENT_ABOUT_ACTION", outsideDependency: true } }) })
    const { deps, stores } = setup(fake.model)
    await generateFeedback(deps, request())
    const criterion = currentAnalysis(stores).criteria.find((entry) => entry.lineHandle === "O1")!
    expect(criterion).toMatchObject({ status: "NOT_OBSERVABLE", confirmation: "UNCONFIRMED", observability: "OUTSIDE_CONVERSATION", executionClaim: "DECLARED", evidenceKind: "DECLARED_ACTION" })
    expect(criterion.confirmationReasons).toEqual(["REVIEW_UNCERTAIN"])
    expect(criterion.downgrades).toContain("ACT_PLACE_READ_OUTSIDE_BY_REVIEW")
    expect(message(stores).brief!.coverageLimits!.map((limit) => limit.reason)).toContain("OUTSIDE_CONVERSATION")
    // A redação recebe a fala que RELATOU a verificação junto do limite (rodada real V12: "Ao identificar a pendência…" aprovado sem essa
    // ligação) — para escrever "você informou que…", nunca o conteúdo da fala como fato apurado.
    const brief = message(stores).brief!
    expect(brief.coverageLimits!.find((limit) => limit.title.startsWith("Verificar"))).toMatchObject({ executionClaim: "DECLARED", saidIn: [{ turn: "T3" }] })
    expect(JSON.stringify(verificationFactsOf(brief))).toContain("\"saidIn\":[\"[T3] Encontrei aqui.")
    expect(JSON.stringify(compositionPayloadOf(brief))).toContain("\"saidIn\":[\"[T3] Encontrei aqui.")
  })

  it("resposta sem a leitura do ato exigido (contrato anterior) não confirma nada: a confirmação depende de a revisora ter lido a fonte", () => {
    expect(obligationReadingOf({ status: "MET", evidenceKind: "CONDUCT_OBSERVED", verdict: { evidenceReading: "ACTION_IN_CALL", outsideDependency: false }, requireActPlace: true })).toBe("REVIEW_INCOMPLETE")
    expect(obligationReadingOf({ status: "MET", evidenceKind: "CONDUCT_OBSERVED", verdict: { evidenceReading: "ACTION_IN_CALL", outsideDependency: false, actPlace: "OUTSIDE_CONVERSATION" }, requireActPlace: true })).toBe("EXECUTION_OUTSIDE_CONVERSATION")
    expect(obligationReadingOf({ status: "MET", evidenceKind: "CONDUCT_OBSERVED", verdict: { evidenceReading: "ACTION_IN_CALL", outsideDependency: false, actPlace: "MIXED", judgedPart: null }, requireActPlace: true })).toBe("REVIEW_INCOMPLETE")
    expect(obligationReadingOf({ status: "MET", evidenceKind: "CONDUCT_OBSERVED", verdict: { evidenceReading: "ACTION_IN_CALL", outsideDependency: false, actPlace: "IN_CONVERSATION" }, requireActPlace: true })).toBeNull()
  })
})

const inform = (handle: Handle, where: string, finding: string) => obligation({ id: "OBL-STATUS", sources: [handle("Informar ao cliente o status do cancelamento")], action: "Informar ao cliente o status do cancelamento que consta no sistema", finding, where, evidence: finding === "MET" ? [{ turn: "T3", speaker: "OPERADOR", quote: "Encontrei aqui. O pedido de cancelamento está aberto desde o dia 2 de julho, mas não foi concluído.", role: "CONDUCT" }] : [], rationale: where === "OUTSIDE_CONVERSATION" ? "Depende do sistema." : "Informou o status." })

describe("contrato da revisão e da confirmação (rodada real V12, cenário B)", () => {
  it("o ato exigido e a leitura das partes são obrigatórios nas duas etapas; a confirmação tem teto para raciocinar e responder", () => {
    const required = (schema: Record<string, unknown>) => ((schema as { properties: { claims: { items: { required: string[] } } } }).properties.claims.items.required)
    for (const schema of [OBLIGATION_REVIEW_RESPONSE_SCHEMA, OBLIGATION_CONFIRMATION_RESPONSE_SCHEMA]) expect(required(schema)).toEqual(expect.arrayContaining(["actPlace", "listReading", "evidenceReading", "outsideDependency"]))
    // A confirmação de B raciocinou 7.866 tokens e foi cortada com teto 8.192 (saída + raciocínio).
    expect(STAGE_MAX_OUTPUT_TOKENS.CALL_CONFIRMATION).toBeGreaterThanOrEqual(16_384)
  })
})

describe("sentido inverso: obrigação de INFORMAR que cita um sistema não é descartada por isso", () => {

  it("a análise propõe cumprido e a revisora lê o ato como comunicação: confirmado — o código não decide por 'sistema' no texto", async () => {
    const fake = fakeEngineModel({ analysis: (handle) => analysisWith(handle, [inform(handle, "IN_CONVERSATION", "MET")]) })
    const { deps, stores } = setup(fake.model)
    await generateFeedback(deps, request())
    expect(currentAnalysis(stores).criteria.find((entry) => entry.lineHandle === "O1")).toMatchObject({ status: "MET", confirmation: "CONFIRMED", observability: "IN_CONVERSATION" })
  })

  it("a análise deixou de lado como 'fora da conversa'; a revisão recebe a conclusão não determinada, contesta (mesmas linhas) e a confirmação focal decide: cumprido", async () => {
    const holder: { handle?: Handle } = {}
    const fake = fakeEngineModel({
      analysis: (handle) => {
        holder.handle = handle
        return analysisWith(handle, [inform(handle, "OUTSIDE_CONVERSATION", "NOT_VERIFIABLE")])
      },
      obligationReview: reviewing({}, () => ({ missed: [{ ...inform(holder.handle!, "IN_CONVERSATION", "MET"), id: undefined }] })),
    })
    const { deps, stores } = setup(fake.model)
    await generateFeedback(deps, request())
    expect(reviewPayload(fake).undetermined).toEqual([expect.objectContaining({ id: "O1", analysisConclusion: "NOT_OBSERVABLE", setAsideBecause: expect.stringMatching(/fora da conversa/) })])
    // A confirmação focal recebeu a leitura contestada junto (as duas em disputa, nenhuma vence por ordem).
    expect(confirmationPayload(fake).claims[0]!.contestedReading).toMatchObject({ conclusion: "não verificável pela gravação" })
    const criteria = currentAnalysis(stores).criteria.filter((entry) => entry.titleText?.includes("status do cancelamento") || entry.text.includes("status do cancelamento"))
    expect(criteria).toHaveLength(1)
    expect(criteria[0]).toMatchObject({ lineHandle: "O1", status: "MET", confirmation: "CONFIRMED", observability: "IN_CONVERSATION", divergence: { reviewHandle: "R1", outcome: "REVIEW_READING_CONFIRMED", analysisStatus: "NOT_OBSERVABLE", reviewStatus: "MET" } })
    expect(currentAnalysis(stores).checks.review.discoveries).toMatchObject({ divergences: { found: 1, reviewReadingConfirmed: 1, unresolved: 0 } })
  })
})

describe("obrigação MISTA: só a parte da conversa é julgada; a parte operacional fica como limite, nunca elogio nem cobrança", () => {
  const openAnalysis = (handle: Handle) => obligation({ id: "OBL-ANALISE", sources: [handle("Abrir análise de faturamento")], action: "Abrir análise de faturamento e informar o prazo de até cinco dias úteis", finding: "MET", evidence: [{ turn: "T5", speaker: "OPERADOR", quote: "Registrei a contestação. A equipe tem até cinco dias úteis para analisar.", role: "CONDUCT" }], rationale: "Abriu a análise e informou o prazo." })

  it("confirmada como mista: status vale para 'informar o prazo'; 'abrir a análise' vira limite de cobertura e fato para a redação", async () => {
    const fake = fakeEngineModel({ analysis: (handle) => analysisWith(handle, [openAnalysis(handle)]), obligationReview: reviewing({ O1: { actPlace: "MIXED", judgedPart: "informar o prazo de até cinco dias úteis", outsidePart: "abrir a análise de faturamento", evidenceReading: "ACTION_IN_CALL", outsideDependency: false } }) })
    const { deps, stores } = setup(fake.model)
    await generateFeedback(deps, request())
    const criterion = currentAnalysis(stores).criteria.find((entry) => entry.lineHandle === "O1")!
    expect(criterion).toMatchObject({ status: "MET", confirmation: "CONFIRMED", observability: "IN_CONVERSATION", judgedPart: "informar o prazo de até cinco dias úteis", operationalPart: { text: "abrir a análise de faturamento" } })
    expect(verificationRecordOf(criterion)).toMatchObject({ judgedPart: "informar o prazo de até cinco dias úteis", operationalPart: { text: "abrir a análise de faturamento" } })
    // Caminho vigente (rodada real V12: "Abrir análise quando… — cumprida"): o título da obrigação inteira nunca leva "cumprida" sozinho.
    const path = currentAnalysis(stores).scenario
    expect(path.pathTaken).toContain("— cumprida só na parte da conversa (informar o prazo de até cinco dias úteis); abrir a análise de faturamento: execução em sistema, não verificável pela gravação")
    expect(path.pathRationale).toMatch(/Não verificável pela gravação \(execução em sistema\):.*“abrir a análise de faturamento”/)
    const brief = message(stores).brief!
    const strength = brief.strengths.find((finding) => finding.evaluatedPart)!
    expect(strength.observed).toBe("A parte desta etapa que acontece na conversa foi cumprida nesta chamada; a parte feita em sistema não aparece na gravação.")
    expect(brief.coverageLimits!.map((limit) => limit.title)).toContain("abrir a análise de faturamento")
    const facts = JSON.stringify(verificationFactsOf(brief))
    expect(facts).toContain("\"evaluatedPart\":\"informar o prazo de até cinco dias úteis\"")
    expect(facts).toMatch(/notVerifiableByRecording.*abrir a análise de faturamento/)
  })

  it("mista sem dizer qual parte é da conversa: nada confirmado (leitura incompleta)", async () => {
    const fake = fakeEngineModel({ analysis: (handle) => analysisWith(handle, [openAnalysis(handle)]), obligationReview: reviewing({ O1: { actPlace: "MIXED", judgedPart: null, outsidePart: "abrir a análise", evidenceReading: "ACTION_IN_CALL", outsideDependency: false } }) })
    const { deps, stores } = setup(fake.model)
    await generateFeedback(deps, request())
    expect(currentAnalysis(stores).criteria.find((entry) => entry.lineHandle === "O1")).toMatchObject({ status: "NOT_OBSERVABLE", confirmationReasons: ["REVIEW_INCOMPLETE"] })
  })
})

describe("divergência análise × revisão na MESMA obrigação (V11 B: a acusação do e-mail ficou de fora só por 'duplicidade')", () => {
  const nextStep = (handle: Handle, finding: string) => obligation({ id: "OBL-PROXIMO", sources: [handle("Antes de encerrar, informar"), handle("O próximo passo e o prazo")], action: "Explicar o próximo passo do cancelamento pendente e o prazo antes de encerrar", finding, evidence: [], opportunityTurn: finding === "NOT_MET" ? "T7" : null, rationale: finding === "NOT_MET" ? "Nada foi dito sobre o que acontece com o cancelamento pendente." : "A conversa não permite concluir." })
  const run = async (analysisFinding: string, confirmation: ((payload: ObligationReviewPayload, labelsOf: (id: string) => ObligationLabels | null) => unknown) | "FAIL") => {
    const holder: { handle?: Handle } = {}
    const fake = fakeEngineModel({
      analysis: (handle) => {
        holder.handle = handle
        return analysisWith(handle, [nextStep(handle, analysisFinding)])
      },
      obligationReview: reviewing({}, () => ({ missed: [{ ...nextStep(holder.handle!, "NOT_MET"), id: undefined }] })),
      ...(confirmation === "FAIL" ? { failConfirmation: true } : { obligationConfirmation: confirmation }),
    })
    const { deps, stores } = setup(fake.model)
    await generateFeedback(deps, request())
    return { fake, stores, criteria: currentAnalysis(stores).criteria.filter((entry) => entry.text.includes("O próximo passo e o prazo")) }
  }

  it("a confirmação focal confirma a leitura da revisão: ela substitui a da análise (uma obrigação, uma linha na memória)", async () => {
    const { criteria, stores } = await run("NOT_VERIFIABLE", (payload, labelsOf) => ({ claims: confirmAllObligations(payload, labelsOf).claims }))
    expect(criteria).toHaveLength(1)
    expect(criteria[0]).toMatchObject({ lineHandle: "O1", status: "NOT_MET", confirmation: "CONFIRMED", divergence: { outcome: "REVIEW_READING_CONFIRMED", analysisStatus: "NOT_OBSERVABLE", reviewStatus: "NOT_MET" } })
    expect(message(stores).brief!.developments.map((finding) => finding.title).join(" ")).toMatch(/próximo passo/)
  })

  it("a confirmação refuta a leitura da revisão (fala que cumpre): fica a da análise", async () => {
    const { criteria } = await run("NOT_VERIFIABLE", (payload, labelsOf) => ({ claims: confirmAllObligations(payload, labelsOf).claims.map((claim) => ({ ...claim, verdict: "REFUTED", issues: ["ACTION_FOUND_IN_CALL"], counterEvidence: [{ turn: "T5", speaker: "OPERADOR", quote: "Registrei a contestação. A equipe tem até cinco dias úteis para analisar." }] })) }))
    expect(criteria).toHaveLength(1)
    expect(criteria[0]).toMatchObject({ status: "NOT_OBSERVABLE", divergence: { outcome: "REVIEW_READING_REFUTED" } })
  })

  it("sem decisão (confirmação indisponível): inconclusivo — e uma conclusão da análise já confirmada também deixa de valer", async () => {
    const undetermined = await run("NOT_VERIFIABLE", "FAIL")
    expect(undetermined.criteria[0]).toMatchObject({ status: "NOT_OBSERVABLE", divergence: { outcome: "UNRESOLVED" } })
    expect(undetermined.criteria[0]!.confirmationReasons).toContain("DIVERGENT_READINGS_UNRESOLVED")
    // A análise disse "cumprido" (e a revisão confirmou a CONCLUSÃO dela), mas a mesma revisão listou a obrigação como não cumprida:
    // duas leituras em conflito, sem decisão → nem acerto nem desvio (a primeira não vence por ordem de execução).
    const met = await run("MET", "FAIL")
    expect(met.criteria).toHaveLength(1)
    expect(met.criteria[0]).toMatchObject({ status: "NOT_OBSERVABLE", confirmation: "UNCONFIRMED", divergence: { outcome: "UNRESOLVED", analysisStatus: "MET" } })
    expect(currentAnalysis(met.stores).coverage.occurrences).toMatchObject({ metRules: 0, adverseRules: 0 })
  })
})

describe("necessidade central do cliente tem resposta própria (V11 A: o cancelamento pendente)", () => {
  const holderReview = (status: string, missed: boolean, confirmation: "CONFIRM" | "UNCERTAIN" = "CONFIRM", withConfirmedStatus = true) => {
    const holder: { handle?: Handle } = {}
    return fakeEngineModel({
      analysis: (handle) => {
        holder.handle = handle
        return analysisWith(handle, [verify(handle), ...(withConfirmedStatus ? [inform(handle, "IN_CONVERSATION", "MET")] : [])])
      },
      obligationReview: (payload, labelsOf) => {
        const handle = holder.handle!
        const review = reviewing({ O1: { actPlace: "OUTSIDE_CONVERSATION", evidenceReading: "STATEMENT_ABOUT_ACTION", outsideDependency: true } })(payload, labelsOf)
        return {
          ...review,
          need: { status, requiredGuidance: "Dizer à cliente o que acontece com o cancelamento pendente e o prazo.", sources: [handle("O próximo passo e o prazo")], heard: [{ turn: "T5", speaker: "OPERADOR", quote: "Registrei a contestação. A equipe tem até cinco dias úteis para analisar." }], unknown: "Se o status do cancelamento foi corrigido no sistema." },
          missed: missed ? [{ sources: [handle("Antes de encerrar, informar"), handle("O próximo passo e o prazo")], action: "Explicar à cliente o próximo passo do cancelamento pendente e o prazo", condition: "Cancelamento pendente", conditionHolds: "YES", conditionEvidence: [{ turn: "T3", speaker: "OPERADOR", quote: "Encontrei aqui. O pedido de cancelamento está aberto desde o dia 2 de julho, mas não foi concluído." }], items: [], itemsMode: "NONE", where: "IN_CONVERSATION", finding: "NOT_MET", evidence: [], opportunityTurn: "T7", materiality: "HIGH", role: "CENTRAL", rationale: "A cliente não ouviu o que acontece com o cancelamento pendente.", guidance: { moment: "Antes de encerrar", action: "Diga o que acontece com o cancelamento pendente e em que prazo." } }] : [],
        }
      },
      obligationConfirmation: (payload, labelsOf) => ({ claims: confirmAllObligations(payload, labelsOf).claims.map((claim) => ({ ...claim, ...(confirmation === "UNCERTAIN" ? { verdict: "UNCERTAIN" } : {}), conditionEvidence: [{ turn: "T3", speaker: "OPERADOR", quote: "Encontrei aqui. O pedido de cancelamento está aberto desde o dia 2 de julho, mas não foi concluído." }] })) }),
    })
  }

  it("falta confirmada: a resposta à necessidade fica GAP_CONFIRMED e o ponto chega à mensagem com a orientação", async () => {
    const fake = holderReview("NOT_ADDRESSED", true)
    const { deps, stores } = setup(fake.model)
    await generateFeedback(deps, request())
    const need = currentAnalysis(stores).scenario.centralNeed!
    expect(need).toMatchObject({ status: "NOT_ADDRESSED", resolution: "GAP_CONFIRMED" })
    expect(need.heard.map((quote) => quote.turn)).toEqual(["T5"])
    const brief = message(stores).brief!
    expect(brief.developments[0]).toMatchObject({ status: "NOT_MET", guidance: { action: "Diga o que acontece com o cancelamento pendente e em que prazo." } })
    expect(brief.centralNeedOpen ?? null).toBeNull()
  })

  it("falta não confirmada (confirmação incerta): sem acusação; a resposta fica em aberto — nota ao leitor e fato para a redação", async () => {
    const fake = holderReview("NOT_ADDRESSED", true, "UNCERTAIN")
    const { deps, stores } = setup(fake.model)
    await generateFeedback(deps, request())
    expect(currentAnalysis(stores).scenario.centralNeed).toMatchObject({ resolution: "GAP_UNCONFIRMED" })
    const brief = message(stores).brief!
    expect(brief.developments).toHaveLength(0)
    expect(brief.readerNotes).toContain("A gravação não permitiu concluir se a orientação sobre a necessidade principal do cliente ficou completa: esse ponto não conta como acerto nem como falha neste retorno.")
    expect(JSON.stringify(compositionPayloadOf(brief))).toMatch(/centralNeedOpen.*O próximo passo e o prazo/)
    expect(JSON.stringify(verificationFactsOf(brief))).toMatch(/centralNeedOpen/)
  })

  it("sem nenhuma conclusão determinada na chamada, a falta não confirmada não vira mensagem: abstenção com motivo (a necessidade fica na memória)", async () => {
    const fake = holderReview("NOT_ADDRESSED", true, "UNCERTAIN", false)
    const { deps, stores } = setup(fake.model)
    await generateFeedback(deps, request())
    expect(message(stores)).toMatchObject({ status: "ABSTAINED", brief: null })
    expect(message(stores).abstainReason).toMatch(/^INSUFFICIENT_EVIDENCE/)
    expect(currentAnalysis(stores).scenario.centralNeed).toMatchObject({ resolution: "GAP_UNCONFIRMED" })
  })

  it("não determinável: em aberto; tratada: nada a dizer além do que foi confirmado", async () => {
    const open = holderReview("NOT_DETERMINABLE", false)
    const first = setup(open.model)
    await generateFeedback(first.deps, request())
    expect(currentAnalysis(first.stores).scenario.centralNeed).toMatchObject({ resolution: "NOT_DETERMINABLE" })
    // Só a regra LITERAL situa o assunto (mesmo sem obrigação que use a linha); a leitura da revisora não vira fato para a redação.
    expect(message(first.stores).brief!.centralNeedOpen).toEqual({ rules: [expect.objectContaining({ text: "- O próximo passo e o prazo;", leadIn: "Antes de encerrar, informar:" })] })
    expect(JSON.stringify(compositionPayloadOf(message(first.stores).brief!))).not.toContain("Dizer à cliente o que acontece")
    expect(message(first.stores).brief!.readerNotes).toContain("A gravação não permitiu concluir se a orientação sobre a necessidade principal do cliente ficou completa: esse ponto não conta como acerto nem como falha neste retorno.")
    const addressed = holderReview("ADDRESSED", false)
    const second = setup(addressed.model)
    await generateFeedback(second.deps, request())
    expect(currentAnalysis(second.stores).scenario.centralNeed).toMatchObject({ resolution: "ADDRESSED_REVIEW_ONLY" })
  })
})

describe("ocorrência pela PARTE descumprida (V11 B: 'motivo + protocolo' parcial e 'protocolo' não cumprido)", () => {
  it("a obrigação parcial (o motivo foi dito, o protocolo não) e a do protocolo, ligadas pela revisão no mesmo momento: UMA ocorrência", async () => {
    const holder: { handle?: Handle } = {}
    const fake = fakeEngineModel({
      analysis: (handle) => {
        holder.handle = handle
        return analysisWith(handle, [
          obligation({ id: "OBL-ENC", sources: [handle("Antes de encerrar, informar"), handle("O próximo passo e o prazo"), handle("O número do protocolo.")], action: "Informar o próximo passo, o prazo e o número do protocolo antes de encerrar", finding: "PARTIAL", items: [{ text: "Próximo passo e prazo", line: handle("O próximo passo e o prazo"), status: "DONE" }, { text: "Número do protocolo", line: handle("O número do protocolo."), status: "NOT_DONE" }], itemsMode: "ALL", evidence: [{ turn: "T5", speaker: "OPERADOR", quote: "Registrei a contestação. A equipe tem até cinco dias úteis para analisar.", role: "CONDUCT" }], opportunityTurn: "T7", rationale: "Disse o prazo, faltou o protocolo." }),
          obligation({ id: "OBL-PROT", sources: [handle("Informe o número do protocolo antes de encerrar")], action: "Informar o número do protocolo antes de encerrar", finding: "NOT_MET", opportunityTurn: "T7", role: "ROUTINE", rationale: "Nenhum protocolo foi dito." }),
        ])
      },
      obligationReview: reviewing({ O2: { sameConductAs: "O1" } }),
    })
    const { deps, stores } = setup(fake.model)
    await generateFeedback(deps, request())
    const analysis = currentAnalysis(stores)
    const adverse = analysis.criteria.filter((entry) => entry.status === "NOT_MET" || entry.status === "PARTIAL")
    expect(adverse.map((entry) => entry.status).sort()).toEqual(["NOT_MET", "PARTIAL"])
    expect(new Set(adverse.map((entry) => entry.occurrence?.key)).size).toBe(1)
    expect(adverse.every((entry) => entry.occurrence?.basis === "REVIEW_SAME_CONDUCT")).toBe(true)
    expect(analysis.coverage.occurrences).toMatchObject({ adverseRules: 2, adverseOccurrences: 1 })
    // O que a revisora foi instruída a comparar: o ATO julgado — num desvio, a parte descumprida.
    expect(OBLIGATION_REVIEW_SYSTEM_PROMPT).toMatch(/num desvio, a PARTE que faltou ou foi feita errado/)
    expect(message(stores).brief!.developments).toHaveLength(1)
  })
})

describe("o cartão resume o conjunto FINAL (V11 A: a frase sobre 'localizar no histórico' caiu do corpo e ficou no cartão)", () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const artifact = join(here, "../../../../scripts/feedback-engine/evaluation/larissa/results/round-v11-paid-2026-10-02T18-29-18-162Z.json")
  it("as MESMAS respostas pagas de redação e verificação: o cartão que cita S3 (fora do corpo) é recusado e o resumo sai da frase principal", async () => {
    const paid = JSON.parse(readFileSync(artifact, "utf8")) as { A: { generation: { message: { brief: FeedbackBrief; card: string } } }; responses: { phase: string; stage: string; tag: string | null; text: string }[] }
    const recorded = paid.responses.filter((entry) => entry.phase === "A" && (entry.stage === "COMPOSITION" || entry.stage === "VERIFICATION"))
    expect(recorded.map((entry) => `${entry.stage}:${entry.tag}`)).toEqual(["COMPOSITION:draft", "VERIFICATION:draft", "COMPOSITION:repair", "VERIFICATION:repair", "VERIFICATION:coherence"])
    let index = 0
    const requests: EngineModelRequest[] = []
    const replay: EngineModelPort = { async generate(request) {
      requests.push(request)
      const entry = recorded[index++]!
      return { text: entry.text, model: "replay", usage: null, durationMs: null, costUsd: null, finishReason: "STOP" }
    } }
    // V11: o cartão publicado citava S3 (a consulta interna), cuja frase F4 tinha sido recusada.
    expect(paid.A.generation.message.card).toMatch(/localizou no histórico/)
    const { message: composed, audit } = await composeFeedback(replay, paid.A.generation.message.brief, [], null)
    expect(audit.decisions.find((entry) => entry.id === "CARD")).toMatchObject({ kept: false, reasons: ["CARD_NOT_IN_TEXT"] })
    expect(composed!.card).not.toMatch(/histórico|cancelamento/)
    expect(composed!.card).toBe(composed!.sentences.find((sentence) => sentence.refs.includes("S1"))!.text)
    expect(composed!.communicatedRefs).not.toContain("S3")
    // A reescrita foi pedida com o motivo do cartão quando ele já tinha sido recusado no rascunho? Não: no rascunho o cartão resumia
    // as três frases mantidas (válido); a recusa vem na reescrita, que não tem nova rodada — o cartão cai para a frase principal.
    expect(requests).toHaveLength(5)
  })
})
