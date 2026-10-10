import { describe, expect, it } from "vitest"
import "../testing/no-external-ai.js"
import { projectTranscript } from "../../investigation/domain/transcript-projection.js"
import { verifyCallAnalysis, type ModelCriterion } from "./call-analysis.js"
import { parseCallReview, reviewTargetsOf, type CallReview, type ClaimVerdict } from "./call-review.js"
import { criterionKeyOf, effectiveRuleText, reconcileCriteria } from "./criteria-identity.js"
import { buildMonitoringBrief } from "./feedback-brief.js"
import { compositionPayloadOf, verificationFactsOf } from "./composition-prompt.js"
import { buildProcedureContext, listContextOf, transcriptStatusOf } from "./procedure.js"
import { criterionPatternsOf } from "./indicator-investigation.js"
import { memoryRowsOf } from "./memory-queries.js"
import { DOC_ID, fixtureContext, INTERACTION_ID, modelAnalysis, PROCEDURE_V1, sourceDocuments, TRANSCRIPT } from "../testing/fixtures.js"

/**
 * INTEGRIDADE DA EVIDÊNCIA ≠ VALIDADE DA INTERPRETAÇÃO (`CALL_ANALYSIS_LOGIC_V4`) — sem IA: o "analisador" e a "revisora" são
 * respostas SIMULADAS. Isto prova o contrato e a decisão do código; não prova a qualidade de um modelo real.
 */
const criterion = (overrides: Partial<ModelCriterion> & Pick<ModelCriterion, "line" | "status">): ModelCriterion => ({ evidenceKind: null, declaredActionTense: null, evidence: [], opportunityTurn: null, rationale: "proposta da análise", materiality: "HIGH", guidance: null, whyItMatters: null, ...overrides })
const claim = (id: string, overrides: Partial<ClaimVerdict> = {}): [string, ClaimVerdict] => [id, { id, verdict: "CONFIRMED", issues: [], listReading: null, conditionEvidence: [], counterEvidence: [], note: null, ...overrides }]
const review = (claims: [string, ClaimVerdict][], path: CallReview["path"] = null): CallReview => ({ claims: new Map(claims), path, lines: [], violations: [] })

function verify(input: { procedure?: string; transcript?: string; criteria: ModelCriterion[]; review: CallReview | null | "UNAVAILABLE" }) {
  const context = buildProcedureContext(sourceDocuments(input.procedure ?? PROCEDURE_V1))
  const projection = projectTranscript(input.transcript ?? TRANSCRIPT)
  const base = { context, projection, transcriptStatus: transcriptStatusOf(projection), interactionId: INTERACTION_ID, subjectAnchoredDocumentIds: [DOC_ID], repairAttempted: false }
  const model = modelAnalysis({ criteria: input.criteria }, { pathSections: [] })
  const preliminary = verifyCallAnalysis({ ...base, model: { ...model, contractViolations: [] } })
  const targets = reviewTargetsOf({ criteria: preliminary.criteria, lists: listContextOf(context), projection, path: null, missing: [] })
  const final = verifyCallAnalysis({ ...base, model, review: input.review === "UNAVAILABLE" ? { attempted: true, review: null, error: "AI_PROVIDER_DOWN" } : input.review === null ? undefined as never : { attempted: true, review: input.review, error: null } })
  const line = (text: string) => [...context.lines.values()].find((entry) => entry.text.includes(text))!
  return { final, targets, line, context }
}

describe("DEFEITO REPRODUZIDO — omissão simulada contradita pela transcrição", () => {
  // A transcrição TEM "A segunda via é da fatura ou do parcelamento?" (T5). O analisador simulado diz que a confirmação NÃO aconteceu.
  const { line } = fixtureContext()
  const omission = criterion({ line: line("Confirmar se a solicitação").handle, status: "NOT_MET", evidenceKind: "OMISSION", opportunityTurn: "T5", rationale: "Não confirmou se era fatura ou parcelamento." })

  it("antes da revisão a proposta passa pela integridade (transcrição completa + turno de oportunidade) — e é só PROPOSTA", () => {
    const { final } = verify({ criteria: [omission], review: "UNAVAILABLE" })
    const item = final.criteria.find((entry) => entry.text.includes("Confirmar se a solicitação"))!
    expect(item.proposedStatus).toBe("NOT_MET")
    // Sem revisão: NÃO vira fato — status final inconclusivo, hipótese registrada com o motivo.
    expect(item).toMatchObject({ status: "NOT_OBSERVABLE", confirmation: "UNCONFIRMED", confirmationReasons: ["REVIEW_UNAVAILABLE"] })
    expect(final.outcome).toBe("INSUFFICIENT_EVIDENCE")
    expect(final.outcomeReasons).toEqual(["REVIEW_UNAVAILABLE"])
  })

  it("a revisão recebe a transcrição INTEIRA e a regra completa (sem pista de turnos por palavras); refuta com a fala verificada do operador → REFUTADA, fora de tudo", () => {
    const { final, targets } = verify({ criteria: [omission], review: review([claim(line("Confirmar se a solicitação").handle, { verdict: "REFUTED", issues: ["ACTION_FOUND_IN_CALL"], counterEvidence: [{ turn: "T5", speaker: "OPERADOR", quote: "A segunda via é da fatura ou do parcelamento?" }] })]) })
    const target = targets.claims.find((entry) => entry.rule.text.includes("Confirmar se a solicitação"))!
    expect(target.focus).toContain("OMISSION")
    expect(target).not.toHaveProperty("lookAt")
    const item = final.criteria.find((entry) => entry.text.includes("Confirmar se a solicitação"))!
    expect(item).toMatchObject({ proposedStatus: "NOT_MET", status: "NOT_OBSERVABLE", confirmation: "REFUTED", confirmationReasons: ["REVIEW_REFUTED", "COUNTER_EVIDENCE_VERIFIED"] })
    expect(item.review?.counterEvidence[0]).toMatchObject({ turn: "T5", quote: "A segunda via é da fatura ou do parcelamento?" })
  })

  it("…e a falsa acusação não chega à memória analítica (contagens) nem ao brief/mensagem", () => {
    const { final } = verify({ criteria: [omission], review: review([claim(line("Confirmar se a solicitação").handle, { verdict: "REFUTED", issues: ["ACTION_FOUND_IN_CALL"], counterEvidence: [{ turn: "T5", speaker: "OPERADOR", quote: "A segunda via é da fatura ou do parcelamento?" }] })]) })
    const brief = buildMonitoringBrief({ analysis: final, interactionId: INTERACTION_ID, label: "Segunda via", dateLabel: "20/09/2026", selectionReason: "teste", criterionKeys: new Map(final.criteria.map((entry) => [entry.lineKey, criterionKeyOf(entry.lineKey)])), documentTitles: new Map([[DOC_ID, "Procedimento"]]), documentVersions: new Map([[DOC_ID, 1]]), history: new Map(), delivered: new Set() })
    expect(brief.developments).toEqual([])
    expect(JSON.stringify(compositionPayloadOf(brief))).not.toMatch(/fatura ou do parcelamento.*não cumprida/)
    const snapshot = { assessments: [{ callAssessmentId: "a1", analysisRunId: "r1", interactionId: INTERACTION_ID, personId: "p", occurredAt: new Date(), asOf: new Date(), segmentKey: "SV", pathAssessment: null, outcome: "PARTIAL", logicVersion: final.logicVersion }], criteria: final.criteria.map((entry) => ({ callAssessmentId: "a1", segmentKey: "SV", interactionId: INTERACTION_ID, personId: "p", criterionKey: criterionKeyOf(entry.lineKey), documentId: DOC_ID, documentTitle: "Procedimento", heading: entry.heading, text: entry.text, status: entry.status, localDate: "2026-09-20", evidence: entry.evidence, rationale: entry.rationale, guidance: entry.guidance, materiality: entry.materiality })) }
    const pattern = criterionPatternsOf(memoryRowsOf(snapshot, final.logicVersion, null)).find((entry) => entry.text.includes("Confirmar se a solicitação"))!
    expect(pattern).toMatchObject({ notMet: 0, eligible: 0, inconclusive: 1 })
  })
})

describe("citação verdadeira com interpretação errada; intenção × declarada × observável", () => {
  const { line } = fixtureContext()
  it("citação LITERAL do operador que não mostra a conduta: a revisão aponta e a conclusão não vira acerto", () => {
    // "Posso ajudar em mais alguma coisa?" é literal (T9), mas o analisador a usa como prova de "Confirmar nome completo".
    const met = criterion({ line: line("Confirmar nome completo").handle, status: "MET", evidenceKind: "CONDUCT_OBSERVED", evidence: [{ turn: "T9", speaker: "OPERADOR", quote: "Posso ajudar em mais alguma coisa?" }] })
    const { final } = verify({ criteria: [met], review: review([claim(line("Confirmar nome completo").handle, { verdict: "REFUTED", issues: ["EVIDENCE_DOES_NOT_SHOW_CONDUCT"] })]) })
    const item = final.criteria.find((entry) => entry.text.includes("nome completo"))!
    expect(item.evidence).toHaveLength(1) // integridade OK: a fala existe, é do operador, daquele turno
    expect(item).toMatchObject({ proposedStatus: "MET", status: "NOT_OBSERVABLE", confirmation: "UNCONFIRMED" })
  })
  it("CONFIRMED com motivo impeditivo é resposta inconsistente — não confirma", () => {
    const met = criterion({ line: line("Confirmar nome completo").handle, status: "MET", evidenceKind: "CONDUCT_OBSERVED", evidence: [{ turn: "T3", speaker: "OPERADOR", quote: "Me confirma seu nome completo?" }] })
    const { final } = verify({ criteria: [met], review: review([claim(line("Confirmar nome completo").handle, { verdict: "CONFIRMED", issues: ["INTENT_ONLY"] })]) })
    expect(final.criteria.find((entry) => entry.text.includes("nome completo"))).toMatchObject({ confirmation: "UNCONFIRMED", confirmationReasons: ["REVIEW_INCONSISTENT"] })
  })
  it("intenção ('vou enviar') nunca é execução (integridade); declaração ('já enviei') também não é a conduta — fica registrada, não vira reconhecimento (V10); conduta observada vira acerto", () => {
    const transcript = `${TRANSCRIPT}\nOperador: Pronto, já enviei a segunda via para o seu e-mail.`
    const { final } = verify({
      transcript,
      criteria: [
        criterion({ line: line("canal escolhido").handle, status: "MET", evidenceKind: "DECLARED_ACTION", declaredActionTense: "INTENDED", evidence: [{ turn: "T7", speaker: "OPERADOR", quote: "Vou enviar por e-mail agora mesmo." }] }),
      ],
      review: review([]),
    })
    expect(final.criteria.find((entry) => entry.text.includes("canal"))).toMatchObject({ proposedStatus: "NOT_OBSERVABLE", status: "NOT_OBSERVABLE", downgrades: ["INTENT_IS_NOT_EXECUTION"], confirmation: "NOT_A_CLAIM" })
    const declared = verify({
      transcript,
      criteria: [
        criterion({ line: line("canal escolhido").handle, status: "MET", evidenceKind: "DECLARED_ACTION", declaredActionTense: "COMPLETED", evidence: [{ turn: "T11", speaker: "OPERADOR", quote: "Pronto, já enviei a segunda via para o seu e-mail." }] }),
        criterion({ line: line("Confirmar nome completo").handle, status: "MET", evidenceKind: "CONDUCT_OBSERVED", evidence: [{ turn: "T3", speaker: "OPERADOR", quote: "Me confirma seu nome completo?" }] }),
      ],
      review: review([claim(fixtureContext().line("canal escolhido").handle), claim(fixtureContext().line("Confirmar nome completo").handle)]),
    }).final
    const brief = buildMonitoringBrief({ analysis: declared, interactionId: INTERACTION_ID, label: "Segunda via", dateLabel: "20/09/2026", selectionReason: "teste", criterionKeys: new Map(declared.criteria.map((entry) => [entry.lineKey, criterionKeyOf(entry.lineKey)])), documentTitles: new Map([[DOC_ID, "Procedimento"]]), documentVersions: new Map([[DOC_ID, 1]]), history: new Map(), delivered: new Set() })
    // `OBLIGATION_READING_V1`: dizer que fez não é fazer — antes, a declaração confirmada virava reconhecimento "você informou que fez".
    expect(declared.criteria.find((entry) => entry.text.includes("canal"))).toMatchObject({ proposedStatus: "NOT_OBSERVABLE", status: "NOT_OBSERVABLE", downgrades: ["DECLARATION_IS_NOT_CONDUCT"], evidenceKind: "DECLARED_ACTION" })
    const name = brief.strengths.find((finding) => finding.title.includes("nome"))!
    expect(name.declaredOnly).toBe(false)
    expect(brief.strengths.some((finding) => finding.title.includes("canal"))).toBe(false)
  })
  it("ação INTERNA de sistema sem fala: 'não fez' não se sustenta — a revisão aponta e fica inconclusivo", () => {
    const internal = criterion({ line: line("canal escolhido").handle, status: "NOT_MET", evidenceKind: "OMISSION", opportunityTurn: "T7" })
    const { final } = verify({ criteria: [internal], review: review([claim(line("canal escolhido").handle, { verdict: "UNCERTAIN", issues: ["INTERNAL_ACTION_NOT_OBSERVABLE"] })]) })
    expect(final.criteria.find((entry) => entry.text.includes("canal"))).toMatchObject({ status: "NOT_OBSERVABLE", confirmation: "UNCONFIRMED", confirmationReasons: ["REVIEW_UNCERTAIN"] })
  })
})

describe("regra condicional, alternativas × obrigações cumulativas", () => {
  const PAID = `${PROCEDURE_V1}
## 6. Conta já paga

Quando o cliente já tiver pago a cobrança contestada, avaliar:

- Crédito em conta futura;
- Estorno;
- Compensação.

## 7. Encerramento da contestação

Antes de encerrar, informar:

- O protocolo da contestação;
- O prazo de análise de 5 dias úteis.
`
  const transcript = [
    "Operador: Bom dia, meu nome é Ana. Com quem eu falo?",
    "Cliente: Bom dia, é a Sônia. Quero contestar uma cobrança.",
    "Operador: Se a contestação for aprovada, o valor volta como crédito na próxima fatura. Seu protocolo é 2026-555.",
    "Cliente: Certo.",
    "Operador: Posso ajudar em mais alguma coisa?",
    "Cliente: Não, obrigada.",
  ].join("\n")
  const credit = (line: (text: string) => { handle: string }) => criterion({ line: line("Crédito em conta futura").handle, status: "MET", evidenceKind: "CONDUCT_OBSERVED", evidence: [{ turn: "T3", speaker: "OPERADOR", quote: "Se a contestação for aprovada, o valor volta como crédito na próxima fatura." }] })

  it("obrigação CONDICIONAL sem comprovação da condição: a revisão confirmou, mas sem fala que mostre a condição → não confirmado", () => {
    const { line } = verify({ procedure: PAID, transcript, criteria: [], review: review([]) })
    // A condição é a LEITURA da análise (semântica) — nunca detectada por "quando/se/caso" no texto da regra.
    const estorno = criterion({ line: line("- Estorno").handle, status: "NOT_MET", evidenceKind: "OMISSION", opportunityTurn: "T3", condition: "o cliente já ter pago a cobrança contestada" })
    const { final, targets } = verify({ procedure: PAID, transcript, criteria: [estorno], review: review([claim(line("- Estorno").handle, { listReading: "CUMULATIVE" })]) })
    expect(targets.claims[0]!.rule).toMatchObject({ conditional: true, condition: "o cliente já ter pago a cobrança contestada", leadIn: "Quando o cliente já tiver pago a cobrança contestada, avaliar:" })
    expect(targets.claims[0]!.focus).toEqual(expect.arrayContaining(["OMISSION", "CONDITIONAL_RULE"]))
    expect(final.criteria.find((entry) => entry.text === "- Estorno;")).toMatchObject({ status: "NOT_OBSERVABLE", confirmation: "UNCONFIRMED", confirmationReasons: ["CONDITION_NOT_EVIDENCED"] })
    // A cliente nunca disse que já tinha pago: uma "condição" inventada (fala que não existe) também não vale.
    const invented = verify({ procedure: PAID, transcript, criteria: [estorno], review: review([claim(line("- Estorno").handle, { listReading: "CUMULATIVE", conditionEvidence: [{ turn: "T2", speaker: "CLIENTE", quote: "Já paguei a fatura." }] })]) }).final
    expect(invented.criteria.find((entry) => entry.text === "- Estorno;")!.confirmationReasons).toEqual(["CONDITION_NOT_EVIDENCED"])
    // Sem leitura de condição, as palavras "Quando…" do texto não decidem nada: a regra vai sem marca de condicional e quem aponta a
    // condição que não ocorreu é a REVISORA (semântica) — com esse motivo, a confirmação não vale.
    const unread = criterion({ line: line("- Estorno").handle, status: "NOT_MET", evidenceKind: "OMISSION", opportunityTurn: "T3" })
    const lexicalFree = verify({ procedure: PAID, transcript, criteria: [unread], review: review([claim(line("- Estorno").handle, { listReading: "CUMULATIVE", issues: ["CONDITION_NOT_ESTABLISHED"] })]) })
    expect(lexicalFree.targets.claims[0]!.rule.conditional).toBe(false)
    expect(lexicalFree.final.criteria.find((entry) => entry.text === "- Estorno;")).toMatchObject({ status: "NOT_OBSERVABLE", confirmation: "UNCONFIRMED", confirmationReasons: ["REVIEW_INCONSISTENT"] })
  })

  it("ALTERNATIVA permitida tratada como obrigação (o caso do estorno da Larissa): outra alternativa cumprida + leitura ALTERNATIVES → REFUTADA", () => {
    const paidTranscript = transcript.replace("Quero contestar uma cobrança.", "Já paguei a fatura com a cobrança errada.")
    const { line } = verify({ procedure: PAID, transcript: paidTranscript, criteria: [], review: review([]) })
    const estorno = criterion({ line: line("- Estorno").handle, status: "NOT_MET", evidenceKind: "CONDUCT_OBSERVED", evidence: [{ turn: "T3", speaker: "OPERADOR", quote: "Se a contestação for aprovada, o valor volta como crédito na próxima fatura." }] })
    const condition = [{ turn: "T2", speaker: "CLIENTE", quote: "Já paguei a fatura com a cobrança errada." }]
    const { final, targets } = verify({ procedure: PAID, transcript: paidTranscript, criteria: [credit(line), estorno], review: review([claim(line("Crédito em conta futura").handle, { listReading: "ALTERNATIVES", conditionEvidence: condition }), claim(line("- Estorno").handle, { verdict: "REFUTED", issues: ["ALTERNATIVE_NOT_REQUIRED"], listReading: "ALTERNATIVES", conditionEvidence: condition })]) })
    expect(targets.claims.find((entry) => entry.rule.text === "- Estorno;")!.focus).toEqual(expect.arrayContaining(["LIST_ITEM_WITH_MET_SIBLING", "SAME_EVIDENCE_AS_SIBLING"]))
    expect(final.criteria.find((entry) => entry.text === "- Estorno;")).toMatchObject({ status: "NOT_OBSERVABLE", confirmation: "REFUTED", confirmationReasons: ["REVIEW_REFUTED", "ALTERNATIVE_SATISFIED"] })
    expect(final.criteria.find((entry) => entry.text.includes("Crédito em conta futura"))).toMatchObject({ status: "MET", confirmation: "CONFIRMED" })
  })

  it("lista CUMULATIVA: a fala que comprova uma obrigação NÃO elimina a falha da outra (a regra V3 'mesma fala prova o irmão' não esconde mais)", () => {
    const { line } = verify({ procedure: PAID, transcript, criteria: [], review: review([]) })
    const protocol = criterion({ line: line("O protocolo da contestação").handle, status: "MET", evidenceKind: "CONDUCT_OBSERVED", evidence: [{ turn: "T3", speaker: "OPERADOR", quote: "Se a contestação for aprovada, o valor volta como crédito na próxima fatura. Seu protocolo é 2026-555." }] })
    const deadline = criterion({ line: line("O prazo de análise").handle, status: "NOT_MET", evidenceKind: "CONDUCT_OBSERVED", evidence: [{ turn: "T3", speaker: "OPERADOR", quote: "Se a contestação for aprovada, o valor volta como crédito na próxima fatura. Seu protocolo é 2026-555." }] })
    const { final, targets } = verify({ procedure: PAID, transcript, criteria: [protocol, deadline], review: review([claim(line("O protocolo da contestação").handle, { listReading: "CUMULATIVE" }), claim(line("O prazo de análise").handle, { listReading: "CUMULATIVE" })]) })
    expect(targets.claims.find((entry) => entry.rule.text.includes("prazo"))!.focus).toEqual(expect.arrayContaining(["SAME_EVIDENCE_AS_SIBLING", "LIST_ITEM_WITH_MET_SIBLING"]))
    expect(final.criteria.find((entry) => entry.text.includes("prazo de análise"))).toMatchObject({ status: "NOT_MET", confirmation: "CONFIRMED" })
    // Sem a leitura da lista, a mesma proposta fica sem confirmação (nunca é escondida nem afirmada por palpite).
    const unclear = verify({ procedure: PAID, transcript, criteria: [protocol, deadline], review: review([claim(line("O protocolo da contestação").handle), claim(line("O prazo de análise").handle, { listReading: "UNCLEAR" })]) }).final
    expect(unclear.criteria.find((entry) => entry.text.includes("prazo de análise"))).toMatchObject({ status: "NOT_OBSERVABLE", confirmationReasons: ["LIST_READING_UNCLEAR"] })
  })

  it("leitura da revisão tolera formato (id com colchete) e descarta item malformado sem derrubar os demais", () => {
    const parsed = parseCallReview(JSON.stringify({ claims: [{ id: "[L3]", verdict: "CONFIRMED", issues: ["NOT_AN_ISSUE"], counterEvidence: [{ turn: "T05", speaker: "OPERADOR", quote: "x" }] }, { id: "L4", verdict: "TALVEZ" }], linesToAssess: [{ id: "L9", status: "NOT_APPLICABLE", rationale: "sem correio" }] }))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect([...parsed.review.claims.keys()]).toEqual(["L3"])
    expect(parsed.review.claims.get("L3")).toMatchObject({ issues: [], counterEvidence: [{ turn: "T5" }] })
    expect(parsed.review.violations).toEqual(["claims[1]:INVALID"])
    expect(parsed.review.lines[0]).toMatchObject({ id: "L9", status: "NOT_APPLICABLE" })
    expect(parseCallReview("não é json").ok).toBe(false)
  })
})

describe("regra atual reavaliando chamada anterior à publicação: orientação daqui para frente, nunca culpa histórica", () => {
  it("o brief marca a perspectiva; redator e verificador recebem ruleBasis (a regra não valia na época)", () => {
    const docs = sourceDocuments().map((document) => ({ ...document, perspective: "CURRENT_RULE_REEVALUATION" as const }))
    const context = buildProcedureContext(docs)
    const projection = projectTranscript(TRANSCRIPT)
    const line = (text: string) => [...context.lines.values()].find((entry) => entry.text.includes(text))!
    const model = modelAnalysis({ criteria: [criterion({ line: line("data de nascimento").handle, status: "NOT_MET", evidenceKind: "OMISSION", opportunityTurn: "T4" })] }, { pathSections: [] })
    const base = { context, projection, transcriptStatus: transcriptStatusOf(projection), interactionId: INTERACTION_ID, subjectAnchoredDocumentIds: [DOC_ID], repairAttempted: false }
    const final = verifyCallAnalysis({ ...base, model, review: { attempted: true, review: review([claim(line("data de nascimento").handle, { listReading: "CUMULATIVE" })]), error: null } })
    expect(final.scenario.rulePerspective).toBe("CURRENT_RULE_REEVALUATION")
    const brief = buildMonitoringBrief({ analysis: final, interactionId: INTERACTION_ID, label: "Segunda via", dateLabel: "20/09/2026", selectionReason: "teste", criterionKeys: new Map(final.criteria.map((entry) => [entry.lineKey, criterionKeyOf(entry.lineKey)])), documentTitles: new Map([[DOC_ID, "Procedimento"]]), documentVersions: new Map([[DOC_ID, 1]]), history: new Map(), delivered: new Set() })
    expect(brief.rulePerspective).toBe("CURRENT_RULE_REEVALUATION")
    expect(brief.developments[0]!.ruleBasis).toBe("CURRENT_RULE_REEVALUATION")
    expect(brief.context.join(" ")).toMatch(/publicada depois desta chamada/)
    expect(compositionPayloadOf(brief)).toMatchObject({ ruleBasis: "CURRENT_RULE_REEVALUATION" })
    expect(verificationFactsOf(brief)).toMatchObject({ ruleBasis: "CURRENT_RULE_REEVALUATION" })
  })
})

describe("identidade das regras — abertura da lista faz parte da linha; sentido é da prática", () => {
  it("trocar a ABERTURA da lista ('avaliar:' → 'informar todas as opções:') muda a linha dos itens → identidade própria; abertura e item iguais = a mesma", () => {
    const before = `## 6. Conta já paga\n\nQuando a cobrança estiver paga, avaliar:\n\n- Estorno;\n- Crédito na próxima fatura.\n`
    const after = `## 6. Conta já paga\n\nQuando a cobrança estiver paga, informar todas as opções:\n\n- Estorno;\n- Crédito na próxima fatura.\n`
    const lines = (content: string, version: number) => [...buildProcedureContext([{ documentId: DOC_ID, title: "Procedimento", version, content, contentHash: String(version), perspective: "RULE_IN_FORCE_AT_CALL", selection: "INCLUDED_ALL", relevance: 0 }]).lines.values()]
    const v1 = lines(before, 1)
    const v2 = lines(after, 2)
    const estorno1 = v1.find((line) => line.text === "- Estorno;")!
    const estorno2 = v2.find((line) => line.text === "- Estorno;")!
    expect(estorno1.leadIn).toBe("Quando a cobrança estiver paga, avaliar:")
    expect(estorno2.lineKey).not.toBe(estorno1.lineKey)
    const persisted = v1.map((line) => ({ lineKey: line.lineKey, criterionKey: criterionKeyOf(line.lineKey), heading: line.heading, text: effectiveRuleText(line), position: line.position }))
    const identities = reconcileCriteria(v2.map((line) => ({ lineKey: line.lineKey, heading: line.heading, text: effectiveRuleText(line) })), persisted)
    expect(identities[v2.indexOf(estorno2)]).toMatchObject({ basis: "FIRST_SEEN", criterionKey: criterionKeyOf(estorno2.lineKey) })
    const same = reconcileCriteria(v1.map((line) => ({ lineKey: line.lineKey, heading: line.heading, text: effectiveRuleText(line) })), persisted)
    expect(same.every((identity) => identity.basis === "UNCHANGED")).toBe(true)
  })
})
