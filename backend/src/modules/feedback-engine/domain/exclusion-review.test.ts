import { describe, expect, it } from "vitest"
import "../testing/no-external-ai.js"
import { reviewAnalysis } from "../application/analyze-call.js"
import type { EngineModelPort, EngineModelRequest } from "../application/ports.js"
import { verifyCallAnalysis } from "./call-analysis.js"
import { buildMonitoringBrief } from "./feedback-brief.js"
import { analysis, challenge, confirmAllClaims, context, criterionOf, DOC, GENERIC, INTERACTION, line, projection, T3, T4, verified } from "../testing/cancellation-case.js"

/**
 * DESCARTES NA REVISÃO (`CALL_REVIEW_V2` / `CALL_ANALYSIS_LOGIC_V5`) — zero IA; procedimento e conversa SINTÉTICOS no formato do caso
 * que revelou o ponto cego (C07, 01/10): uma disposição de GRUPO com justificativa genérica descartou itens ligados ao centro do caso
 * (o cancelamento pendente) e a revisão nunca os viu.
 */
describe("a revisão confere os descartes das seções em jogo (mesma chamada)", () => {
  it("o pedido de revisão leva os descartes com a justificativa de grupo e o cenário que a análise descreveu — uma chamada só", async () => {
    const calls: EngineModelRequest[] = []
    const model: EngineModelPort = { async generate(request) {
      calls.push(request)
      return { text: JSON.stringify({ claims: [], path: { verdict: "CONFIRMED", issues: [] }, exclusions: [] }), model: "fake", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, durationMs: 1, costUsd: 0, finishReason: "STOP" }
    } }
    await reviewAnalysis({ model }, { model: analysis(), context, projection, transcriptStatus: "COMPLETE", interactionId: INTERACTION, subject: "Contestação de cobrança", anchored: [DOC] }, [])
    expect(calls.map((call) => call.stage)).toEqual(["CALL_REVIEW"])
    const payload = JSON.parse(calls[0]!.contents[0]!.text.split("PROPOSTAS DA ANÁLISE A REVISAR (JSON):")[1]!) as { scenario: { customerNeed: string; conditions: { turns: string[] }[] }; exclusions: { id: string; excludedAs: string; justification: string; sharedJustification?: { lines: number; sections: number }; rule: { text: string } }[] }
    expect(payload.scenario.conditions.flatMap((condition) => condition.turns)).toEqual(["T3", "T2"])
    const excluded = (text: string) => payload.exclusions.find((entry) => entry.rule.text.includes(text))
    expect(excluded("Próximo passo do pedido")).toMatchObject({ excludedAs: "NOT_APPLICABLE", justification: GENERIC, sharedJustification: { lines: 3, sections: 2 } })
    // "Corrigir o status" (não observável, execução no sistema) também vai — com a leitura de onde acontece: a revisora pode mostrar
    // que a leitura errou (é algo a dizer ao cliente), nunca transformar o silêncio em "não fez".
    expect(excluded("Corrigir o status")).toMatchObject({ excludedAs: "NOT_OBSERVABLE", observability: "OUTSIDE_CONVERSATION" })
    // Seção fora de jogo (nenhuma etapa decidida, fora do caminho): o descarte nem vai à revisão.
    expect(excluded("Emitir conta ajustada")).toBeUndefined()
  })

  it("descarte ERRADO ligado ao centro do caso: contestado com a condição que a própria análise registrou + omissão válida → vira ajuste confirmado", () => {
    const model = analysis()
    const result = verified(model, confirmAllClaims(model, [challenge(line("Próximo passo do pedido"), { proposedStatus: "NOT_MET", itemNature: "COMMUNICATION", scenarioRole: "CENTRAL", issues: ["EXCLUSION_CONTRADICTS_SCENARIO", "GENERIC_GROUP_JUSTIFICATION", "COMMUNICATION_EXPECTED"], listReading: "CUMULATIVE", conditionEvidence: [T3], opportunityTurn: "T6", note: "A cliente perguntou se vai continuar pagando; o fechamento não disse o que acontece com o pedido pendente." })]))
    expect(criterionOf(result, "Próximo passo do pedido")).toMatchObject({ origin: "REVIEW_CHALLENGE", declaredStatus: "NOT_APPLICABLE", status: "NOT_MET", confirmation: "CONFIRMED", confirmationReasons: ["EXCLUSION_REVERSED"], scenarioRole: "CENTRAL", evidenceKind: "OMISSION", opportunityTurn: "T6" })
    expect(result.checks.review.exclusions).toMatchObject({ challenged: 1, reversedConfirmed: 1 })
    // Chega ao brief como AJUSTE central (antes da recapitulação de rotina), com a regra literal.
    const brief = buildMonitoringBrief({ analysis: result, interactionId: INTERACTION, label: "Contestação de cobrança", dateLabel: "21/08/2026", selectionReason: "teste", criterionKeys: new Map(result.criteria.map((criterion) => [criterion.lineKey, `KC-${criterion.lineHandle}`])), documentTitles: new Map([[DOC, "Procedimento"]]), documentVersions: new Map(), history: new Map(), delivered: new Set() })
    expect(brief.developments[0]).toMatchObject({ role: "CENTRAL" })
    expect(brief.developments[0]!.rules.map((rule) => rule.text)).toContainEqual(expect.stringContaining("Próximo passo do pedido"))
  })

  it("descarte LEGÍTIMO permanece: fora de jogo nem é contestável; contestação sem fala verificável é ignorada; não contestado fica", () => {
    const model = analysis()
    const result = verified(model, confirmAllClaims(model, [
      challenge(line("Emitir conta ajustada"), { proposedStatus: "NOT_MET", itemNature: "COMMUNICATION", conditionEvidence: [T3], opportunityTurn: "T6" }),
      challenge(line("Serviço cancelado"), { proposedStatus: "NOT_MET", itemNature: "COMMUNICATION", conditionEvidence: [{ turn: "T5", speaker: "OPERADOR", quote: "Cancelei o serviço da cliente agora." }] }),
    ]))
    expect(criterionOf(result, "Emitir conta ajustada")).toMatchObject({ status: "NOT_APPLICABLE", origin: "GROUP" })
    expect(criterionOf(result, "Serviço cancelado")).toMatchObject({ status: "NOT_APPLICABLE", origin: "GROUP" })
    expect(criterionOf(result, "Próximo passo do pedido")).toMatchObject({ status: "NOT_APPLICABLE", origin: "GROUP" })
    expect(result.checks.review.exclusions).toMatchObject({ challenged: 1, ignored: 1, reversedConfirmed: 0 })
  })

  it("ação INTERNA nunca vira 'não cumprida' por silêncio: a contestação reabre como incerto; a análise que propõe omissão de ação interna é rebaixada", () => {
    const model = analysis()
    const result = verified(model, confirmAllClaims(model, [
      challenge(line("Corrigir o status"), { proposedStatus: "NOT_MET", itemNature: "INTERNAL_ACTION", scenarioRole: "CENTRAL", conditionEvidence: [T3], opportunityTurn: "T6" }),
      challenge(line("Serviço cancelado"), { proposedStatus: "NOT_OBSERVABLE", itemNature: "COMMUNICATION", scenarioRole: "CENTRAL", issues: ["DEPENDS_ON_INTERNAL_ACTION"], conditionEvidence: [T3], note: "Só se aplica se o status foi corrigido no sistema — a conversa não mostra." }),
    ]))
    expect(criterionOf(result, "Corrigir o status")).toMatchObject({ status: "NOT_OBSERVABLE", origin: "REVIEW_CHALLENGE", confirmation: "NOT_A_CLAIM" })
    expect(criterionOf(result, "Serviço cancelado")).toMatchObject({ status: "NOT_OBSERVABLE", origin: "REVIEW_CHALLENGE", confirmationReasons: ["EXCLUSION_REOPENED"] })
    expect(result.checks.review.exclusions).toMatchObject({ reopened: 2, reversedConfirmed: 0 })
    // O que a conversa não permite concluir: a ETAPA DA CONVERSA ligada ao caso vira ponto em aberto (nunca acusação nem acerto); a
    // execução no sistema vira LIMITE DE COBERTURA — fora do redator (sem "se você ainda não corrigiu…").
    const brief = buildMonitoringBrief({ analysis: result, interactionId: INTERACTION, label: "Contestação de cobrança", dateLabel: "21/08/2026", selectionReason: "teste", criterionKeys: new Map(), documentTitles: new Map([[DOC, "Procedimento"]]), documentVersions: new Map(), history: new Map(), delivered: new Set() })
    expect(brief.developments.map((finding) => finding.title)).not.toContain("Corrigir o status")
    expect(brief.openPoints!.map((point) => point.title)).toEqual(["Serviço cancelado, quando aplicável"])
    expect(brief.coverageLimits!.map((limit) => limit.title)).toContain("Corrigir o status")
    expect(criterionOf(result, "Corrigir o status")).toMatchObject({ observability: "OUTSIDE_CONVERSATION" })

    const proposedOmission = analysis({ criteria: [...analysis().criteria.filter((criterion) => criterion.line !== line("Corrigir o status")), { line: line("Corrigir o status"), status: "NOT_MET", evidenceKind: "OMISSION", evidence: [], opportunityTurn: "T6", rationale: "Não corrigiu o status.", materiality: "HIGH", guidance: null, whyItMatters: null, itemNature: "INTERNAL_ACTION", scenarioRole: "CENTRAL" }] })
    const preliminary = verifyCallAnalysis({ model: proposedOmission, context, projection, transcriptStatus: "COMPLETE", interactionId: INTERACTION, subjectAnchoredDocumentIds: [DOC], repairAttempted: false })
    expect(preliminary.criteria.find((criterion) => criterion.text.includes("Corrigir o status"))).toMatchObject({ proposedStatus: "NOT_OBSERVABLE", observability: "OUTSIDE_CONVERSATION", executionClaim: "NONE", downgrades: ["EXECUTION_NOT_VERIFIABLE_BY_TRANSCRIPT"] })
  })

  it("contestação que só a revisora sustenta (a condição citada não é a que a análise registrou) fica hipótese — fora das contagens e da mensagem", () => {
    const model = analysis()
    const result = verified(model, confirmAllClaims(model, [challenge(line("Próximo passo do pedido"), { proposedStatus: "NOT_MET", itemNature: "COMMUNICATION", scenarioRole: "CENTRAL", conditionEvidence: [T4], opportunityTurn: "T6" })]))
    expect(criterionOf(result, "Próximo passo do pedido")).toMatchObject({ status: "NOT_OBSERVABLE", confirmation: "UNCONFIRMED", confirmationReasons: ["EXCLUSION_CHALLENGE_UNCONVERGED"] })
    expect(result.checks.review.exclusions).toMatchObject({ reversedUnconfirmed: 1 })
  })

  it("notas técnicas da revisão vão para a auditoria, não para as limitações que o colaborador vê", () => {
    const model = analysis()
    const review = confirmAllClaims(model)
    review.claims.set(line("Informar prazo"), { id: line("Informar prazo"), verdict: "UNCERTAIN", issues: [], listReading: null, conditionEvidence: [], counterEvidence: [], note: null })
    const result = verified(model, review)
    expect(result.auditNotes!.join(" ")).toMatch(/não foram confirmadas pela revisão/)
    expect(result.limitations.join(" ")).not.toMatch(/revisão/)
    const brief = buildMonitoringBrief({ analysis: result, interactionId: INTERACTION, label: "x", dateLabel: "21/08/2026", selectionReason: "teste", criterionKeys: new Map(), documentTitles: new Map(), documentVersions: new Map(), history: new Map(), delivered: new Set() })
    // Nada da revisão chega ao colaborador; a única nota é neutra: o que acontece em sistemas não está na gravação (nunca "faltou").
    expect(brief.readerNotes).toEqual(["O que é feito em sistemas, fora da conversa, não aparece na gravação e não foi avaliado neste retorno."])
  })
})

/**
 * POLÍTICA DE EVIDÊNCIA ÚNICA (`CALL_REVIEW_V5` / `CALL_ANALYSIS_LOGIC_V8`) — defeito reproduzido em 01/10: a análise lê uma execução
 * interna como não observável; a revisão contesta mantendo itemNature = INTERNAL_ACTION e propondo CUMPRIDO ou PARCIAL; só "não
 * cumprido" era barrado, e a conclusão chegava CONFIRMADA (fora da conversa + "conduta observada") — elogio de execução não
 * comprovada ou "esta etapa foi feita só em parte". Zero IA: as leituras são escritas aqui.
 */
describe("conclusões alteradas pela revisão respeitam a mesma política de evidência", () => {
  const T5 = { turn: "T5", speaker: "OPERADOR", quote: "Registrei a contestação da mensalidade de agosto." }
  const briefFor = (result: ReturnType<typeof verified>) => buildMonitoringBrief({ analysis: result, interactionId: INTERACTION, label: "Contestação de cobrança", dateLabel: "21/08/2026", selectionReason: "teste", criterionKeys: new Map(result.criteria.map((criterion) => [criterion.lineKey, `KC-${criterion.lineHandle}`])), documentTitles: new Map([[DOC, "Procedimento"]]), documentVersions: new Map(), history: new Map(), delivered: new Set() })

  it("CUMPRIDO proposto pela revisão para ação interna (com a fala do operador e convergência) NÃO vira acerto confirmado: reaberto, fala = declaração", () => {
    const model = analysis()
    const result = verified(model, confirmAllClaims(model, [challenge(line("Corrigir o status"), { proposedStatus: "MET", itemNature: "INTERNAL_ACTION", scenarioRole: "CENTRAL", listReading: "CUMULATIVE", conditionEvidence: [T3], evidence: [T3] })]))
    const fixed = criterionOf(result, "Corrigir o status")!
    expect(fixed).toMatchObject({ origin: "REVIEW_CHALLENGE", status: "NOT_OBSERVABLE", confirmation: "NOT_A_CLAIM", observability: "OUTSIDE_CONVERSATION", executionClaim: "DECLARED", evidenceKind: "DECLARED_ACTION" })
    expect(fixed.confirmationReasons).toEqual(["EXCLUSION_REOPENED", "EXECUTION_OUTSIDE_CONVERSATION"])
    expect(result.checks.review.exclusions).toMatchObject({ challenged: 1, reopened: 1, reversedConfirmed: 0 })
    const brief = briefFor(result)
    expect(brief.strengths.map((finding) => finding.title)).not.toContain("Corrigir o status")
    expect(brief.coverageLimits).toContainEqual(expect.objectContaining({ title: "Corrigir o status", reason: "OUTSIDE_CONVERSATION", executionClaim: "DECLARED" }))
  })

  it("PARCIAL proposto pela revisão para ação interna nunca vira 'feita só em parte'", () => {
    const model = analysis()
    const result = verified(model, confirmAllClaims(model, [challenge(line("Corrigir o status"), { proposedStatus: "PARTIAL", itemNature: "INTERNAL_ACTION", listReading: "CUMULATIVE", conditionEvidence: [T3], evidence: [T5] })]))
    expect(criterionOf(result, "Corrigir o status")).toMatchObject({ status: "NOT_OBSERVABLE", confirmation: "NOT_A_CLAIM", observability: "OUTSIDE_CONVERSATION", executionClaim: "DECLARED" })
    const brief = briefFor(result)
    expect(brief.developments.map((finding) => finding.observed)).not.toContain("Esta etapa foi feita só em parte nesta chamada.")
    expect(brief.developments.map((finding) => finding.title)).not.toContain("Corrigir o status")
  })

  it("revisora sem natureza: vale a leitura da análise (fora da conversa) — cumprido continua não verificável; intenção fica intenção", () => {
    const model = analysis()
    const result = verified(model, confirmAllClaims(model, [challenge(line("Corrigir o status"), { proposedStatus: "MET", itemNature: null, issues: ["INTENT_ONLY"], listReading: "CUMULATIVE", conditionEvidence: [T3], evidence: [T5] })]))
    expect(criterionOf(result, "Corrigir o status")).toMatchObject({ status: "NOT_OBSERVABLE", observability: "OUTSIDE_CONVERSATION", executionClaim: "INTENDED", declaredActionTense: "INTENDED" })
  })

  it("a revisora PODE corrigir a leitura semântica (é algo a comunicar na conversa): aí a conclusão segue as regras da conversa", () => {
    const misread = analysis({ criteria: analysis().criteria.map((criterion) => (criterion.line === line("Ação realizada") ? { ...criterion, status: "NOT_OBSERVABLE" as const, evidenceKind: "NONE" as const, evidence: [], itemNature: "INTERNAL_ACTION" as const, observability: "OUTSIDE_CONVERSATION" as const } : criterion)) })
    const T6 = { turn: "T6", speaker: "OPERADOR", quote: "Resumindo: contestação registrada, protocolo 4455." }
    const result = verified(misread, confirmAllClaims(misread, [challenge(line("Ação realizada"), { proposedStatus: "MET", itemNature: "COMMUNICATION", issues: ["COMMUNICATION_EXPECTED"], listReading: "CUMULATIVE", conditionEvidence: [T3], evidence: [T6] })]))
    expect(criterionOf(result, "Ação realizada")).toMatchObject({ status: "MET", confirmation: "CONFIRMED", observability: "IN_CONVERSATION", evidenceKind: "CONDUCT_OBSERVED", executionClaim: null })
  })

  it("defesa final: qualquer conclusão determinada que chegue com 'fora da conversa' (por outro caminho) sai não observável e fora das contagens confirmadas", () => {
    const model = analysis()
    const review = confirmAllClaims(model)
    // A análise propôs 'Contestar cobranças posteriores' como CUMPRIDA (ação interna declarada) e a revisão CONFIRMOU a proposta.
    const result = verified(model, review)
    const contest = criterionOf(result, "Contestar cobranças posteriores")!
    expect(contest).toMatchObject({ status: "NOT_OBSERVABLE", observability: "OUTSIDE_CONVERSATION", executionClaim: "DECLARED" })
    expect(contest.confirmation).not.toBe("CONFIRMED")
    expect(result.criteria.filter((criterion) => criterion.observability === "OUTSIDE_CONVERSATION" && (["MET", "NOT_MET", "PARTIAL"].includes(criterion.status) || criterion.confirmation === "CONFIRMED"))).toEqual([])
  })
})
