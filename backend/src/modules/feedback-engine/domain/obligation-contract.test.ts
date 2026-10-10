import { describe, expect, it } from "vitest"
import "../testing/no-external-ai.js"
import { argumentScriptSourceOf, normalizeArgumentScriptContent } from "../../argument-scripts/domain/argument-script.js"
import { projectTranscript } from "../../investigation/domain/transcript-projection.js"
import { buildProcedureContext } from "./procedure.js"
import { parseObligationAnalysisResponse, sourceHandleOf, type ModelObligationAnalysis } from "./obligation-analysis.js"
import { LIST_ITEMS_IN_PLAY_LIMIT, listItemsInPlayOf, sectionsOfReference, situationsInPlayOf, verifyObligationAnalysis } from "./obligation-verification.js"
import { decideObligationConfirmation, obligationClaimOf } from "./obligation-review.js"
import { sourceDocuments, TRANSCRIPT } from "../testing/fixtures.js"

/**
 * CONTRATO ORIENTADO AO CASO (`OBLIGATIONS_V1`) — regressões SEM IA (as leituras do modelo são escritas aqui). O código não interpreta
 * o sentido: aplica as consequências das leituras que o próprio modelo declarou e a integridade de sempre. Cada caso reproduz uma
 * falha demonstrada nas rodadas reais (V8/V9) ou na comparação de contratos de 02/10, com outras palavras (fixtures de segunda via).
 */
const projection = projectTranscript(TRANSCRIPT)
const context = buildProcedureContext(sourceDocuments())
const line = (text: string) => [...context.lines.values()].find((entry) => entry.text.includes(text))!.handle
const quote = (turn: string, speaker: "OPERADOR" | "CLIENTE", text: string, role: "CONDUCT" | "DECLARATION" | "INTENTION" | "CONDITION" | "CUSTOMER") => ({ turn, speaker, quote: text, role })
type Obligation = ModelObligationAnalysis["obligations"][number]
const obligation = (overrides: Partial<Obligation>): Obligation => ({ id: "OBL-1", sources: [line("Confirmar nome completo")], action: "Confirmar o nome completo do titular", condition: null, conditionHolds: "NOT_CONDITIONAL", conditionEvidence: [], items: [], itemsMode: "NONE", where: "IN_CONVERSATION", finding: "MET", evidence: [quote("T3", "OPERADOR", "Me confirma seu nome completo?", "CONDUCT")], opportunityTurn: null, materiality: "HIGH", role: "CENTRAL", rationale: "Pediu o nome completo.", guidance: null, ...overrides })
const analysis = (obligations: Obligation[], overrides: Partial<ModelObligationAnalysis> = {}): ModelObligationAnalysis => ({ contract: "OBLIGATIONS_V1", need: { summary: "Segunda via da fatura", conditions: [] }, sources: { primary: "D1", related: [], rationale: "Procedimento da segunda via." }, argumentScripts: [], obligations, notAssessed: [], conduct: { pathTaken: "Validou e confirmou o tipo.", assessment: "UNDETERMINED", rationale: "" }, sourceConflicts: [], limitations: [], contractViolations: [], ...overrides })
const verify = (model: ModelObligationAnalysis, extraContext = context) => verifyObligationAnalysis({ model, context: extraContext, projection, transcriptStatus: "COMPLETE", interactionId: "i1", subjectAnchoredDocumentIds: [] })
const only = (model: ModelObligationAnalysis, extraContext = context) => verify(model, extraContext).criteria.find((criterion) => criterion.origin === "ANALYSIS")!

describe("forma: a linha é referência de origem, a unidade é a obrigação", () => {
  it("handle com documento ('D2:L786') vira a linha; sem fonte reconhecível a obrigação sai, registrada", () => {
    expect(sourceHandleOf("D2:L786")).toBe("L786")
    expect(sourceHandleOf("[L12]")).toBe("L12")
    const parsed = parseObligationAnalysisResponse(JSON.stringify({ need: { summary: "x" }, sources: { primary: "D1", rationale: "x" }, conduct: { pathTaken: "", assessment: "UNDETERMINED", rationale: "" }, obligations: [{ id: "a", sources: ["D1:L3"], action: "x", condition: null, where: "IN_CONVERSATION", finding: "MET", evidence: [], materiality: "LOW", role: "ROUTINE", rationale: "x" }, { id: "b", sources: [], action: "x", condition: null, where: "IN_CONVERSATION", finding: "MET", evidence: [], materiality: "LOW", role: "ROUTINE", rationale: "x" }] }))
    expect(parsed.ok && parsed.value.obligations.map((entry) => entry.sources)).toEqual([["L3"]])
    expect(parsed.ok && parsed.value.contractViolations).toEqual(["obligations[1]:NO_SOURCES"])
  })
  it("obrigação de várias linhas: texto LITERAL das linhas, título literal da abertura com os itens, identidade própria estável", () => {
    const sources = [line("Antes de encerrar qualquer chamada"), line("informe o protocolo")]
    const first = only(analysis([obligation({ sources, action: "Informar o protocolo antes de encerrar", finding: "NOT_MET", evidence: [], opportunityTurn: "T9" })]))
    const again = only(analysis([obligation({ sources: [...sources].reverse(), action: "outra redação da ação", finding: "NOT_MET", evidence: [], opportunityTurn: "T9" })]))
    expect(first.text).toContain("informe o protocolo")
    expect(first.titleText).not.toContain("Informar o protocolo antes de encerrar")
    expect(first.identityKey).toMatch(/^KC-[0-9a-f]{12}$/)
    expect(again.identityKey).toBe(first.identityKey)
  })
})

describe("consequências das leituras do próprio modelo (nenhuma palavra decide)", () => {
  it("condição presente ≠ conduta: 'cumprido' sustentado só pela fala do cliente que mostra a situação não vira acerto", () => {
    const criterion = only(analysis([obligation({ sources: [line("Enviar a segunda via")], condition: "O cliente pediu a segunda via", conditionHolds: "YES", evidence: [quote("T2", "CLIENTE", "Preciso da segunda via da conta.", "CONDITION")] })]))
    expect(criterion.proposedStatus).toBe("NOT_OBSERVABLE")
  })
  it("declaração/intenção de execução ≠ execução: na conversa vira declaração; fora da conversa fica não observável com a fala registrada", () => {
    const inConversation = only(analysis([obligation({ sources: [line("Enviar a segunda via")], evidence: [quote("T7", "OPERADOR", "Vou enviar por e-mail agora mesmo.", "INTENTION")] })]))
    expect(inConversation).toMatchObject({ proposedStatus: "NOT_OBSERVABLE", evidenceKind: "DECLARED_ACTION", declaredActionTense: "INTENDED" })
    const outside = only(analysis([obligation({ sources: [line("Enviar a segunda via")], where: "OUTSIDE_CONVERSATION", evidence: [quote("T7", "OPERADOR", "Vou enviar por e-mail agora mesmo.", "CONDUCT")] })]))
    expect(outside).toMatchObject({ proposedStatus: "NOT_OBSERVABLE", observability: "OUTSIDE_CONVERSATION", executionClaim: "DECLARED" })
  })
  it("validação interna desconhecida ≠ acusação: desvio cuja única prova é declaração/intenção não se sustenta", () => {
    const criterion = only(analysis([obligation({ sources: [line("Não prometer envio imediato")], finding: "NOT_MET", evidence: [quote("T7", "OPERADOR", "Vou enviar por e-mail agora mesmo.", "INTENTION")] })]))
    expect(criterion).toMatchObject({ proposedStatus: "NOT_OBSERVABLE" })
    expect(criterion.downgrades).toContain("DECLARATION_DOES_NOT_PROVE_CONDUCT")
  })
  it("'quando possível' sem como saber: aplicabilidade incerta nunca vira 'não cumpriu'", () => {
    const criterion = only(analysis([obligation({ sources: [line("Informar o prazo de 2 dias")], condition: "quando o envio for por correio", conditionHolds: "UNCERTAIN", finding: "NOT_MET", evidence: [], opportunityTurn: "T7" })]))
    expect(criterion.proposedStatus).toBe("NOT_OBSERVABLE")
    expect(criterion.downgrades).toContain("APPLICABILITY_UNCERTAIN")
  })
  it("alternativas com uma feita nunca sustentam parcial; combinação indefinida não sustenta falha por item", () => {
    const items = [{ text: "Fatura", line: null, status: "DONE" as const }, { text: "Parcelamento", line: null, status: "NOT_DONE" as const }]
    expect(only(analysis([obligation({ finding: "PARTIAL", items, itemsMode: "ANY" })])).downgrades).toContain("ALTERNATIVE_DONE")
    expect(only(analysis([obligation({ finding: "PARTIAL", items, itemsMode: "UNCLEAR" })])).downgrades).toContain("ITEMS_COMBINATION_UNCLEAR")
  })
  it("lista cumulativa: 'cumprido' com parte não feita ou não verificável se contradiz (nunca acerto global de partes internas)", () => {
    expect(only(analysis([obligation({ items: [{ text: "Nome", line: null, status: "DONE" }, { text: "Data de nascimento", line: null, status: "NOT_DONE" }], itemsMode: "ALL" })])).downgrades).toContain("ITEMS_CONTRADICT_FINDING")
    expect(only(analysis([obligation({ items: [{ text: "Nome", line: null, status: "DONE" }, { text: "Consulta ao histórico", line: null, status: "NOT_VERIFIABLE" }], itemsMode: "ALL" })])).downgrades).toContain("PART_NOT_VERIFIABLE")
  })
  it("ausência verdadeira continua detectável: omissão na conversa com transcrição completa e oportunidade real fica proposta", () => {
    const criterion = only(analysis([obligation({ sources: [line("Confirmar data de nascimento")], action: "Confirmar a data de nascimento", finding: "NOT_MET", evidence: [], opportunityTurn: "T5" })]))
    expect(criterion).toMatchObject({ proposedStatus: "NOT_MET", evidenceKind: "OMISSION", opportunityTurn: "T5" })
  })
  it("conclusão geral ≤ cobertura: 'caminho correto' com obrigação não verificável não é afirmado", () => {
    const result = verify(analysis([obligation({}), obligation({ id: "OBL-2", sources: [line("Enviar a segunda via")], where: "OUTSIDE_CONVERSATION", finding: "NOT_VERIFIABLE", evidence: [] })], { conduct: { pathTaken: "", assessment: "CORRECT", rationale: "" } }))
    expect(result.scenario.pathAssessment).not.toBe("CORRECT")
  })
})

describe("itens de argumentário aplicável sempre têm destino (nunca somem)", () => {
  it("argumentário que se aplica sem obrigação que cubra os itens → lacuna explícita, que vai à revisão", () => {
    const script = argumentScriptSourceOf({ scriptId: "00000000-0000-4000-8000-00000000c501", versionId: "v1", version: 1, name: "Segunda via (teste)", areaName: "Faturamento", scope: { scopeType: "ALL_TEAMS", teamId: null, subteamId: null, teamName: null, subteamName: null }, subjectName: null, conversion: "NATIVE", content: normalizeArgumentScriptContent({ trigger: "O cliente pede a segunda via da conta.", notApplicableWhen: null, operatorGuidance: [{ key: "g1", text: "Orientar a consulta pelo aplicativo.", modality: "MUST" }], requiredPoints: [], avoid: [], suggestedScript: null, monitoringReference: null }), contentHash: "s1", effectiveFrom: new Date("2026-09-01T00:00:00Z"), effectiveUntil: null, sourceDocumentId: null, sourceDocumentTitle: null, sourceReference: null }, null)
    const withScript = buildProcedureContext(sourceDocuments(), [script])
    const scriptHandle = withScript.documents.find((document) => document.kind === "ARGUMENT_SCRIPT")!.handle
    const result = verify(analysis([obligation({})], { argumentScripts: [{ script: scriptHandle, applies: "APPLIES", evidence: [{ turn: "T2", speaker: "CLIENTE", quote: "Preciso da segunda via da conta." }], rationale: "Pediu a segunda via." }] }), withScript)
    const gap = result.criteria.find((criterion) => criterion.origin === "COVERAGE_GAP" && criterion.downgrades.includes("NOT_ASSESSED_BY_ANALYSIS"))
    expect(gap).toMatchObject({ status: "NOT_ASSESSED", downgrades: ["NOT_ASSESSED_BY_ANALYSIS"] })
    expect(gap!.text).toContain("Orientar a consulta pelo aplicativo")
    // `LIST_COVERAGE_V2`: o irmão da MESMA lista ("data de nascimento") NÃO vira um "não avaliado" por estrutura — vai à revisão
    // como contexto da obrigação (ela aponta em `missed` se valia e faltou). A cobertura conta o item; só o argumentário fica sem avaliação.
    expect(result.criteria.some((criterion) => criterion.text.includes("Confirmar data de nascimento"))).toBe(false)
    expect(result.coverage).toMatchObject({ status: "PARTIAL", byStatus: { notAssessed: 1 }, listItems: { found: 1, shownToReview: 0, raisedByReview: 0 } })
  })
})

describe("decisão sobre uma obrigação revisada", () => {
  const base = only(analysis([obligation({ finding: "PARTIAL", items: [{ text: "Recapitular", line: null, status: "DONE" }, { text: "Informar o protocolo", line: null, status: "NOT_DONE" }], itemsMode: "ALL", evidence: [quote("T9", "OPERADOR", "Posso ajudar em mais alguma coisa?", "CONDUCT")] })]))
  const verdict = (listReading: string) => ({ id: base.lineHandle, verdict: "CONFIRMED" as const, issues: [], listReading: listReading as never, evidenceReading: "ACTION_IN_CALL" as const, outsideDependency: false, conditionEvidence: [], counterEvidence: [], note: null })
  it("leituras independentes da MESMA lista que divergem (todas × alternativas) → não confirmada", () => {
    expect(decideObligationConfirmation({ claim: obligationClaimOf(base), verdict: verdict("ALTERNATIVES"), reviewAvailable: true, verifiedConditionEvidence: [], verifiedCounterEvidence: [], evidenceKind: base.evidenceKind })).toEqual({ confirmation: "UNCONFIRMED", reasons: ["LIST_READING_UNCLEAR"] })
    expect(decideObligationConfirmation({ claim: obligationClaimOf(base), verdict: verdict("CUMULATIVE"), reviewAvailable: true, verifiedConditionEvidence: [], verifiedCounterEvidence: [], evidenceKind: base.evidenceKind })).toEqual({ confirmation: "CONFIRMED", reasons: [] })
  })
})

describe("`LIST_COVERAGE_V2`: itens das listas em jogo como contexto da revisão (puro)", () => {
  it("acima do teto, o rodízio entre listas garante que toda lista apareça (na V10 a ordem cortou a do encerramento)", () => {
    const long = Array.from({ length: 70 }, (_, index) => `- Item de verificação ${index + 1};`).join("\n")
    const procedure = `# Procedimento\n\n## 1. Verificação\n\nVerificar:\n${long}\n\n## 2. Encerramento\n\nAntes de encerrar, informar:\n- Valor;\n- Serviço cancelado, quando aplicável;\n- Protocolo.\n`
    const context = buildProcedureContext(sourceDocuments(procedure))
    const handle = (text: string) => [...context.lines.values()].find((entry) => entry.text.includes(text))!.handle
    const model = { obligations: [{ id: "OBL-1", action: "Verificar", sources: [handle("Verificar:"), handle("Item de verificação 1;")] }, { id: "OBL-2", action: "Informar antes de encerrar", sources: [handle("Antes de encerrar, informar:"), handle("Valor;")] }], notAssessed: [] } as unknown as ModelObligationAnalysis
    // Sem critérios avaliados (só a leitura estrutural): todos os itens das duas listas estão em jogo.
    const { groups, found } = listItemsInPlayOf(model, context, [])
    expect(found).toBe(73)
    expect(groups.reduce((sum, group) => sum + group.items.length, 0)).toBe(LIST_ITEMS_IN_PLAY_LIMIT)
    expect(groups.find((group) => group.obligation === "O2")!.items.map((item) => item.text)).toEqual([expect.stringContaining("Valor"), expect.stringContaining("Serviço cancelado, quando aplicável"), expect.stringContaining("Protocolo")])
    expect(groups.find((group) => group.obligation === "O1")!.opening?.text).toBe("Verificar:")
  })
})

describe("SITUATION_SECTIONS_V1 — seção acionada por situação que aconteceu vai à revisão como foco", () => {
  const emission = [...context.sections.values()].find((section) => section.heading?.includes("Emissão"))!
  const interactions = new Map([["I1", { interactionRef: "I1", interactionId: "i1", projection }]])
  const inPlay = (model: ModelObligationAnalysis) => situationsInPlayOf(model, context, verify(model).criteria.filter((criterion) => criterion.origin === "ANALYSIS"), interactions, projection)

  it("a seção é resolvida pela identidade: handles no texto (como o modelo escreveu na V14) ou o título apresentado sem numeração; ambíguo/ausente = nada", () => {
    const sections = [...context.sections.values()]
    const emissionSection = sections.find((section) => section.heading?.includes("Emissão"))!
    const handle = emissionSection.handle
    expect(sectionsOfReference(`D1:${handle}`, context).map((section) => section.handle)).toEqual([handle])
    expect(sectionsOfReference(`D1 ${handle} (Emissão)`, context).map((section) => section.handle)).toEqual([handle])
    expect(sectionsOfReference(`${handle} / S9999 (outra)`, context).map((section) => section.handle)).toEqual([handle])
    expect(sectionsOfReference("3. Emissão", context).map((section) => section.handle)).toEqual([handle])
    expect(sectionsOfReference("D1 · 3 Emissão", context).map((section) => section.handle)).toEqual([handle])
    expect(sectionsOfReference("Emissão de boletos", context)).toEqual([])
    expect(sectionsOfReference("SMS e mensagens", context)).toEqual([])
  })
  it("a análise declara as situações como dado (como escritas); sem o campo, lista vazia", () => {
    const parsed = parseObligationAnalysisResponse(JSON.stringify({ need: { summary: "x" }, sources: { primary: "D1", rationale: "x" }, situations: [{ section: "[S3]", happened: "YES", evidence: [{ turn: "T7", speaker: "OPERADOR", quote: "Vou enviar por e-mail agora mesmo." }] }, { section: "S9", happened: "TALVEZ" }], conduct: { pathTaken: "", assessment: "UNDETERMINED", rationale: "" }, obligations: [] }))
    expect(parsed.ok && parsed.value.situations).toEqual([{ section: "[S3]", happened: "YES", evidence: [{ turn: "T7", speaker: "OPERADOR", quote: "Vou enviar por e-mail agora mesmo." }] }])
    const without = parseObligationAnalysisResponse(JSON.stringify({ need: { summary: "x" }, sources: { primary: "D1", rationale: "x" }, conduct: { pathTaken: "", assessment: "UNDETERMINED", rationale: "" }, obligations: [] }))
    expect(without.ok && without.value.situations).toEqual([])
  })

  it("situação que aconteceu, com fala verificada: as linhas da seção que ninguém avaliou vão à revisão (as cobertas não)", () => {
    const model = analysis([obligation({ sources: [line("Confirmar se a solicitação é da fatura")], action: "Confirmar fatura ou parcelamento", evidence: [quote("T5", "OPERADOR", "A segunda via é da fatura ou do parcelamento?", "CONDUCT")] })], { situations: [{ section: emission.handle, happened: "YES", evidence: [{ turn: "T7", speaker: "OPERADOR", quote: "Vou enviar por e-mail agora mesmo." }] }] })
    const value = inPlay(model)
    expect(value.happened).toBe(1)
    expect(value.groups).toHaveLength(1)
    expect(value.groups[0]!.evidence[0]!.quote).toBe("Vou enviar por e-mail agora mesmo.")
    const texts = value.groups[0]!.lines.map((entry) => entry.text)
    expect(texts.some((text) => text.includes("prazo de 2 dias úteis"))).toBe(true)
    expect(texts.some((text) => text.includes("Confirmar se a solicitação é da fatura"))).toBe(false)
    expect(verify(model).coverage.situations).toMatchObject({ declared: 1, happened: 1, shownToReview: 0, raisedByReview: 0 })
  })

  it("situação só lida (sem fala verificada), que não aconteceu ou incerta: nada vai à revisão", () => {
    const situation = (happened: "YES" | "NO" | "UNCLEAR", quoteText: string) => analysis([], { situations: [{ section: emission.handle, happened, evidence: [{ turn: "T7", speaker: "OPERADOR", quote: quoteText }] }] })
    expect(inPlay(situation("YES", "Vou mandar pelo correio amanhã.")).groups).toEqual([])
    expect(inPlay(situation("NO", "Vou enviar por e-mail agora mesmo.")).groups).toEqual([])
    expect(inPlay(situation("UNCLEAR", "Vou enviar por e-mail agora mesmo.")).groups).toEqual([])
  })
})

describe("SITUATION_SECTIONS_V1 — a revisão recebe as situações", () => {
  it("o pedido de revisão leva situationsInPlay com a fala que mostra a situação e as linhas sem avaliação", async () => {
    const { reviewObligationAnalysis } = await import("../application/review-obligations.js")
    const { confirmAllObligations, obligationReviewPayloadOf } = await import("../testing/fake-engine-model.js")
    const emission = [...context.sections.values()].find((section) => section.heading?.includes("Emissão"))!
    const prazo = line("prazo de 2 dias úteis")
    const model = analysis([obligation({})], { situations: [{ section: emission.handle, happened: "YES", evidence: [{ turn: "T7", speaker: "OPERADOR", quote: "Vou enviar por e-mail agora mesmo." }] }] })
    const sent: string[] = []
    const port = {
      generate: async (request: { contents: { text: string }[] }) => {
        sent.push(request.contents[0]!.text)
        const payload = obligationReviewPayloadOf(request as never)
        const answer = { ...confirmAllObligations(payload), missed: request.contents[0]!.text.includes("CONCLUSÕES A CONFERIR") ? undefined : [] }
        return { text: JSON.stringify(answer), model: "fake", inputTokens: 1, outputTokens: 1 }
      },
    }
    await reviewObligationAnalysis({ model: port as never }, { model, context, projection, transcriptStatus: "COMPLETE", interactionId: "i1", subject: null, anchored: [] }, [])
    const payload = JSON.parse(sent[0]!.split("ANÁLISE A REVISAR (JSON):")[1]!) as { situationsInPlay?: { section: string; situationShownBy: { quote: string }[]; lines: { line: string }[] }[] }
    expect(payload.situationsInPlay?.[0]).toMatchObject({ section: emission.handle, situationShownBy: [{ quote: "Vou enviar por e-mail agora mesmo." }] })
    expect(payload.situationsInPlay![0]!.lines.map((entry) => entry.line)).toContain(prazo)
  })
})
