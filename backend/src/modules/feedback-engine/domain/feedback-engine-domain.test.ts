import { describe, expect, it } from "vitest"
import "../testing/no-external-ai.js"
import { projectTranscript } from "../../investigation/domain/transcript-projection.js"
import { canonicalHandle, verifyCallAnalysis, missingCoverageOf, mergeCoverageRepair, parseCallAnalysisResponse, unwrapJsonFence } from "./call-analysis.js"
import { extractionRevisionOf, reconcileCriteria, criterionKeyOf } from "./criteria-identity.js"
import { buildProcedureContext, closingSectionsOf, transcriptStatusOf, renderProcedureForModel } from "./procedure.js"
import { buildMonitoringBrief, consolidateDevelopments, type BriefFinding } from "./feedback-brief.js"
import { applyVerdicts, assembleMessage, localViolationsOf, parseWriterDraft, usefulnessOf, utilityGapsOf, type Verdict } from "./composition.js"
import { compareSegments, concludeInvestigation, criterionPatternsOf, dailyProfileOf, referencePracticesOf, selectFocusSegments, topReferenceMembers, type Localization, type MemoryRow, type OfficialFacts } from "./indicator-investigation.js"
import { CHECKLIST_ID, confirmingReview, DOC_ID, fixtureContext, INTERACTION_ID, modelAnalysis, PROCEDURE_V1, sourceDocuments } from "../testing/fixtures.js"

/** Integridade (código) + revisão que confirma: o status final é a proposta que passou pela integridade. */
const verify = (model: ReturnType<typeof modelAnalysis>, options: { transcript?: string; anchored?: string[] } = {}) => {
  const { context } = fixtureContext()
  const projection = projectTranscript(options.transcript ?? fixtureContext().projection.turns.map((turn) => `${turn.speaker === "OPERADOR" ? "Operador" : "Cliente"}: ${turn.text}`).join("\n"))
  const input = { context, projection, transcriptStatus: transcriptStatusOf(projection), interactionId: INTERACTION_ID, subjectAnchoredDocumentIds: options.anchored ?? [DOC_ID], repairAttempted: false }
  const preliminary = verifyCallAnalysis({ ...input, model: { ...model, contractViolations: [...model.contractViolations] } })
  return verifyCallAnalysis({ ...input, model, review: { attempted: true, review: confirmingReview(preliminary), error: null } })
}

describe("procedimento completo → seções, papéis e linhas", () => {
  it("checklist de encerramento SEM seções (só o título diz o papel) é encerramento e entra na cobertura de qualquer processo", () => {
    const context = buildProcedureContext([
      sourceDocuments()[0]!,
      { ...sourceDocuments()[1]!, content: "Antes de encerrar qualquer chamada: (1) confirme a solução aplicada; (2) informe o número do protocolo; (3) confirme se o cliente tem mais alguma dúvida." },
    ])
    const checklist = context.documents.find((document) => document.documentId === CHECKLIST_ID)!
    expect(checklist.sections[0]).toMatchObject({ closingRole: "CHECKLIST", executable: true })
    const procedure = context.documents.find((document) => document.documentId === DOC_ID)!
    const required = closingSectionsOf(context, procedure.handle).flatMap((section) => section.lines.filter((line) => line.kind === "LIST_ITEM").map((line) => line.text))
    expect(required).toEqual(expect.arrayContaining(["(2) informe o número do protocolo;", "(3) confirme se o cliente tem mais alguma dúvida."]))
  })
  it("o título da seção é só PISTA: toda linha recebe handle [L-n] (quem decide se é exigência é a leitura); enumeração em linha vira um item por ordinal", () => {
    const { context, section } = fixtureContext()
    expect(section("Objetivo").executable).toBe(false)
    expect(section("Validação do titular").executable).toBe(true)
    expect(section("Encerramento").closingRole).toBe("CLOSING")
    const checklist = [...context.lines.values()].filter((line) => line.documentId === CHECKLIST_ID)
    expect(checklist.map((line) => line.kind)).toEqual(["TEXT", "LIST_ITEM", "LIST_ITEM"])
    const rendered = renderProcedureForModel(context)
    // A seção "Objetivo" aparece com a pista do título e a linha dela TEM handle — o título nunca decide sozinho que não é etapa.
    expect(rendered).toContain("o título sugere objetivo do processo — confirme pela leitura se alguma linha é exigência")
    expect(rendered).toMatch(/\[L\d+\] Orientar a emissão/)
  })
  it("identidade da linha é estável entre versões quando o texto não muda e muda quando muda", () => {
    const v1 = buildProcedureContext(sourceDocuments())
    const v2 = buildProcedureContext(sourceDocuments(PROCEDURE_V1.replace("2 dias úteis", "3 dias úteis")))
    const keys = (context: typeof v1) => new Map([...context.lines.values()].map((line) => [line.text, line.lineKey]))
    expect(keys(v2).get("- Confirmar nome completo;")).toBe(keys(v1).get("- Confirmar nome completo;"))
    expect(keys(v2).get("- Informar o prazo de 3 dias úteis para o envio por correio.")).not.toBe(keys(v1).get("- Informar o prazo de 2 dias úteis para o envio por correio."))
  })
  it("transcrição incompleta pela própria fonte ou cortada no fim não permite julgar ausência", () => {
    expect(transcriptStatusOf(projectTranscript("Operador: Oi\nCliente: [inaudível] preciso de ajuda\nOperador: Tchau"))).toBe("INCOMPLETE")
    expect(transcriptStatusOf(projectTranscript("Operador: Oi\nCliente: Então eu queria…"))).toBe("INCOMPLETE")
    expect(transcriptStatusOf(projectTranscript(""))).toBe("UNAVAILABLE")
  })
})

describe("identidade automática dos critérios entre versões (sem aprovação, sem leitura por palavra)", () => {
  const line = (lineKey: string, text: string, heading = "3. Emissão") => ({ lineKey, heading, text })
  const persisted = (lineKey: string, text: string, heading = "3. Emissão") => ({ lineKey, criterionKey: criterionKeyOf(lineKey), heading, text, position: 1 })
  it("linha igual herda a identidade; qualquer outro texto é identidade própria — o código nunca declara 'equivalente' nem 'modificada'", () => {
    const previous = [persisted("aaa000000001", "- Enviar a segunda via pelo canal escolhido pelo cliente;"), persisted("aaa000000002", "- Informar o prazo de 2 dias úteis para o envio por correio.")]
    const result = reconcileCriteria([line("aaa000000001", "- Enviar a segunda via pelo canal escolhido pelo cliente;"), line("bbb000000002", "- Informar o prazo de 3 dias úteis para o envio por correio.")], previous)
    expect(result[0]).toMatchObject({ basis: "UNCHANGED", criterionKey: "KC-aaa000000001" })
    expect(result[1]).toEqual({ lineKey: "bbb000000002", criterionKey: "KC-bbb000000002", basis: "FIRST_SEEN", previousCriterionKey: null })
  })
  it("sinônimo, digitação, flexão, ordem invertida, negação: tudo é texto diferente → identidade própria; se é a MESMA conduta, quem diz é a prática (leitura do modelo)", () => {
    const pairs: [string, string][] = [
      ["Informar o prazo da análise.", "Comunicar o prazo da análise."],
      ["Informar o praso da análise.", "Informar o prazo da análise."],
      ["O operador deve confirmar a data de nascimento.", "O operador deverá confirmar a data de nascimento."],
      ["Validar o titular antes de enviar a segunda via.", "Enviar a segunda via antes de validar o titular."],
      ["Prometer o prazo de envio.", "Não prometer o prazo de envio."],
    ]
    for (const [before, after] of pairs) {
      const result = reconcileCriteria([line("new000000001", after)], [persisted("old000000001", before)])
      expect(result[0]).toEqual({ lineKey: "new000000001", criterionKey: "KC-new000000001", basis: "FIRST_SEEN", previousCriterionKey: null })
    }
  })
  it("revisão da EXTRAÇÃO (mesma versão, lógica nova): correspondência com proveniência e motivo, nunca união das identidades", () => {
    // V2 guardava só o item; V3 guarda a abertura da lista junto (texto efetivo) e gera identidades novas.
    const previous = [
      { lineKey: "aaa000000010", criterionKey: "KC-aaa000000010", heading: "34. Conta já paga", text: "- Estorno;", position: 12 },
      { lineKey: "aaa000000011", criterionKey: "KC-aaa000000011", heading: "34. Conta já paga", text: "- Crédito em conta futura;", position: 13 },
      { lineKey: "aaa000000012", criterionKey: "KC-aaa000000012", heading: "7. Validação", text: "O operador deverá validar o titular.", position: 3 },
    ]
    const current = [
      { lineKey: "bbb000000010", heading: "34. Conta já paga", text: "Quando o cliente já tiver pago a cobrança contestada, avaliar:\n- Estorno;", position: 12 },
      { lineKey: "bbb000000011", heading: "34. Conta já paga", text: "Quando o cliente já tiver pago a cobrança contestada, avaliar:\n- Crédito em conta futura;", position: 13 },
      { lineKey: "bbb000000012", heading: "7. Validação", text: "O operador deverá validar o titular.", position: 3 },
      { lineKey: "bbb000000013", heading: "7. Validação", text: "Nova linha.", position: 4 },
    ]
    const identities = reconcileCriteria(current, null)
    const revision = extractionRevisionOf({ from: "KNOWLEDGE_CRITERIA_V2", to: "KNOWLEDGE_CRITERIA_V3", previous, current, identities })
    expect(revision.correspondences).toEqual([
      { lineKey: "bbb000000010", criterionKey: "KC-bbb000000010", previousCriterionKey: "KC-aaa000000010", relation: "TEXT_CHANGED" },
      { lineKey: "bbb000000011", criterionKey: "KC-bbb000000011", previousCriterionKey: "KC-aaa000000011", relation: "TEXT_CHANGED" },
      { lineKey: "bbb000000012", criterionKey: "KC-bbb000000012", previousCriterionKey: "KC-aaa000000012", relation: "SAME_TEXT" },
    ])
    expect(revision.unmatchedCurrent).toEqual(["bbb000000013"])
    expect(revision.unmatchedPrevious).toEqual([])
    // As identidades novas continuam próprias — o vínculo é só proveniência.
    expect(identities.map((identity) => identity.criterionKey)).toEqual(["KC-bbb000000010", "KC-bbb000000011", "KC-bbb000000012", "KC-bbb000000013"])
  })
})

describe("verificação da análise da chamada (o sistema sustenta ou restringe)", () => {
  const { line, section } = fixtureContext()
  it("citação literal do operador sustenta MET; citação inventada ou só do cliente não prova conduta", () => {
    const analysis = verify(modelAnalysis({ criteria: [
      { line: line("Confirmar nome completo").handle, status: "MET", evidenceKind: "CONDUCT_OBSERVED", declaredActionTense: null, evidence: [{ turn: "T3", speaker: "OPERADOR", quote: "Me confirma seu nome completo?" }], opportunityTurn: null, rationale: "Pediu o nome.", materiality: "HIGH", guidance: null, whyItMatters: null },
      { line: line("Confirmar se a solicitação").handle, status: "MET", evidenceKind: "CONDUCT_OBSERVED", declaredActionTense: null, evidence: [{ turn: "T5", speaker: "OPERADOR", quote: "a segunda via é da fatura ou do boleto?" }], opportunityTurn: null, rationale: "x", materiality: "MEDIUM", guidance: null, whyItMatters: null },
      { line: line("canal escolhido").handle, status: "MET", evidenceKind: "CONDUCT_OBSERVED", declaredActionTense: null, evidence: [{ turn: "T2", speaker: "CLIENTE", quote: "Preciso da segunda via da conta." }], opportunityTurn: null, rationale: "x", materiality: "MEDIUM", guidance: null, whyItMatters: null },
    ] }))
    const byText = (text: string) => analysis.criteria.find((criterion) => criterion.text.includes(text))!
    expect(byText("nome completo").status).toBe("MET")
    expect(byText("Confirmar se a solicitação")).toMatchObject({ status: "NOT_OBSERVABLE", downgrades: ["NO_VERIFIED_OPERATOR_EVIDENCE"] })
    expect(byText("Confirmar se a solicitação").rejectedEvidence[0]!.reason).toBe("NOT_LITERAL")
    expect(byText("canal escolhido")).toMatchObject({ status: "NOT_OBSERVABLE", downgrades: ["CUSTOMER_SPEECH_DOES_NOT_PROVE_CONDUCT"] })
  })
  it("“vou enviar” é intenção, nunca execução; troca de falante é rejeitada", () => {
    const analysis = verify(modelAnalysis({ criteria: [
      { line: line("canal escolhido").handle, status: "MET", evidenceKind: "DECLARED_ACTION", declaredActionTense: "INTENDED", evidence: [{ turn: "T7", speaker: "OPERADOR", quote: "Vou enviar por e-mail agora mesmo." }], opportunityTurn: null, rationale: "x", materiality: "HIGH", guidance: null, whyItMatters: null },
      { line: line("Confirmar nome completo").handle, status: "MET", evidenceKind: "CONDUCT_OBSERVED", declaredActionTense: null, evidence: [{ turn: "T3", speaker: "CLIENTE", quote: "Me confirma seu nome completo?" }], opportunityTurn: null, rationale: "x", materiality: "HIGH", guidance: null, whyItMatters: null },
    ] }))
    expect(analysis.criteria.find((criterion) => criterion.text.includes("canal"))).toMatchObject({ status: "NOT_OBSERVABLE", downgrades: ["INTENT_IS_NOT_EXECUTION"] })
    expect(analysis.criteria.find((criterion) => criterion.text.includes("nome completo"))!.rejectedEvidence[0]!.reason).toBe("WRONG_SPEAKER")
  })
  it("omissão só com transcrição completa E oportunidade real; incompleta vira não observável", () => {
    const criterion = { line: line("data de nascimento").handle, status: "NOT_MET" as const, evidenceKind: "OMISSION" as const, declaredActionTense: null, evidence: [], opportunityTurn: "T4", rationale: "Não confirmou a data de nascimento antes de enviar.", materiality: "HIGH" as const, guidance: { moment: "depois do nome", condition: null, action: "confirme a data de nascimento", ruleLines: [line("data de nascimento").handle] }, whyItMatters: null }
    expect(verify(modelAnalysis({ criteria: [criterion] })).criteria[0]).toMatchObject({ status: "NOT_MET", guidance: { action: "confirme a data de nascimento" } })
    const cut = verify(modelAnalysis({ criteria: [criterion] }), { transcript: "Operador: Me confirma seu nome completo?\nCliente: Carlos [inaudível]\nOperador: Vou enviar por e-mail agora mesmo." })
    expect(cut.criteria[0]).toMatchObject({ status: "NOT_OBSERVABLE", downgrades: ["OMISSION_ON_INCOMPLETE_TRANSCRIPT"] })
    expect(verify(modelAnalysis({ criteria: [{ ...criterion, opportunityTurn: "T99" }] })).criteria[0]!.downgrades).toEqual(["OMISSION_WITHOUT_OPPORTUNITY"])
  })
  it("omissão de encerramento: a oportunidade é a que a LEITURA indica (o código não a preenche pelo título da seção) — só com transcrição completa", () => {
    const protocol = line("informe o protocolo")
    // Sem turno indicado, nada é presumido (antes o título "encerramento" preenchia o último turno — heurística que decidia sozinha).
    const unindicated = modelAnalysis({ criteria: [{ line: protocol.handle, status: "NOT_MET", evidenceKind: "OMISSION", declaredActionTense: null, evidence: [], opportunityTurn: null, rationale: "Encerrou sem informar o protocolo.", materiality: "HIGH", guidance: null, whyItMatters: null }] })
    expect(verify(unindicated).criteria.find((criterion) => criterion.text.includes("protocolo"))).toMatchObject({ status: "NOT_OBSERVABLE", downgrades: ["OMISSION_WITHOUT_OPPORTUNITY"] })
    const model = modelAnalysis({ criteria: [{ line: protocol.handle, status: "NOT_MET", evidenceKind: "OMISSION", declaredActionTense: null, evidence: [], opportunityTurn: "T9", rationale: "Encerrou sem informar o protocolo.", materiality: "HIGH", guidance: null, whyItMatters: null }] })
    expect(verify(model).criteria.find((criterion) => criterion.text.includes("protocolo"))).toMatchObject({ status: "NOT_MET", opportunityTurn: "T9" })
    const cut = verify(model, { transcript: `${fixtureContext().projection.turns.slice(0, 8).map((turn) => `${turn.speaker === "OPERADOR" ? "Operador" : "Cliente"}: ${turn.text}`).join("\n")}\n[gravação interrompida]` })
    expect(cut.criteria.find((criterion) => criterion.text.includes("protocolo"))!.status).toBe("NOT_OBSERVABLE")
    // Exigência que NÃO é de encerramento continua exigindo o turno da oportunidade.
    const birth = verify(modelAnalysis({ criteria: [{ line: line("data de nascimento").handle, status: "NOT_MET", evidenceKind: "OMISSION", declaredActionTense: null, evidence: [], opportunityTurn: null, rationale: "x", materiality: "HIGH", guidance: null, whyItMatters: null }] }))
    expect(birth.criteria.find((criterion) => criterion.text.includes("nascimento"))!.status).toBe("NOT_OBSERVABLE")
  })
  it("proibição respeitada vale por ausência só com transcrição completa; regra em conflito nunca vira acusação", () => {
    const analysis = verify(modelAnalysis({
      criteria: [
        { line: line("Não prometer envio imediato").handle, status: "MET", evidenceKind: "COMPLIANCE_BY_ABSENCE", declaredActionTense: null, evidence: [], opportunityTurn: null, rationale: "Não prometeu.", materiality: "MEDIUM", guidance: null, whyItMatters: null },
        { line: line("prazo de 2 dias").handle, status: "NOT_MET", evidenceKind: "OMISSION", declaredActionTense: null, evidence: [], opportunityTurn: "T7", rationale: "Não informou prazo.", materiality: "HIGH", guidance: null, whyItMatters: null },
      ],
      sourceConflicts: [{ lines: [line("prazo de 2 dias").handle], description: "Outra base diz 3 dias." }],
    }))
    expect(analysis.criteria.find((criterion) => criterion.text.includes("envio imediato"))!.status).toBe("MET")
    expect(analysis.criteria.find((criterion) => criterion.text.includes("prazo"))).toMatchObject({ status: "NOT_MET", ruleConflict: true })
  })
  it("caminho inadequado sem evidência não se sustenta; cobertura: item do caminho sem disposição = não avaliado e análise PARCIAL", () => {
    const analysis = verify(modelAnalysis({ criteria: [] }, { pathAssessment: "INCORRECT", pathSections: [section("Validação do titular").handle] }))
    expect(analysis.scenario.pathAssessment).toBe("UNDETERMINED")
    expect(analysis.coverage.status).toBe("PARTIAL")
    expect(analysis.criteria.filter((criterion) => criterion.status === "NOT_ASSESSED").map((criterion) => criterion.text)).toEqual(expect.arrayContaining(["- Confirmar nome completo;", "- Confirmar data de nascimento.", "- Confirmar se o cliente tem mais alguma dúvida."]))
    expect(analysis.outcome).toBe("INSUFFICIENT_EVIDENCE")
  })
  it("disposições agrupadas cobrem o caminho; o reparo só acrescenta, nunca sobrescreve", () => {
    const { context, projection } = fixtureContext()
    const model = modelAnalysis({ criteria: [{ line: line("nome completo").handle, status: "MET", evidenceKind: "CONDUCT_OBSERVED", declaredActionTense: null, evidence: [{ turn: "T3", speaker: "OPERADOR", quote: "Me confirma seu nome completo?" }], opportunityTurn: null, rationale: "ok", materiality: "HIGH", guidance: null, whyItMatters: null }] }, { pathSections: [section("Validação do titular").handle] })
    const missing = missingCoverageOf(model, context, transcriptStatusOf(projection))
    // Checklist transversal de encerramento (documento que É um roteiro de encerramento pelo título) também é cobrado.
    expect(missing.map((entry) => entry.text)).toEqual(["- Confirmar data de nascimento.", "- Confirmar se o cliente tem mais alguma dúvida.", "(1) recapitule o que foi feito;", "(2) informe o protocolo."])
    const repaired = mergeCoverageRepair(model, modelAnalysis({ criteria: [{ line: line("nome completo").handle, status: "NOT_MET", evidenceKind: "OMISSION", declaredActionTense: null, evidence: [], opportunityTurn: "T3", rationale: "tentativa de sobrescrever", materiality: "HIGH", guidance: null, whyItMatters: null }], groupDispositions: [{ lines: missing.map((entry) => entry.handle), status: "NOT_OBSERVABLE", rationale: "Não aparece na conversa." }] }), missing.map((entry) => entry.handle))
    const analysis = verify(repaired)
    expect(analysis.coverage).toMatchObject({ status: "COMPLETE", missing: [] })
    expect(analysis.criteria.find((criterion) => criterion.text.includes("nome completo"))!.status).toBe("MET")
  })
  it("procedimento diferente do indicado pelo assunto sem justificativa é registrado (checagem de correção diagnóstica)", () => {
    const criteria = [{ line: fixtureContext().line("nome completo").handle, status: "MET" as const, evidenceKind: "CONDUCT_OBSERVED" as const, declaredActionTense: null, evidence: [{ turn: "T3", speaker: "OPERADOR", quote: "Me confirma seu nome completo?" }], opportunityTurn: null, rationale: "ok", materiality: "HIGH" as const, guidance: null, whyItMatters: null }]
    const analysis = verify(modelAnalysis({ criteria }), { anchored: [CHECKLIST_ID] })
    expect(analysis.checks.procedureSelection).toBe("DIFFERENT_FROM_SUBJECT_UNEXPLAINED")
    expect(analysis.outcome).toBe("PARTIAL")
    expect(verify(modelAnalysis({ criteria }, { procedureRationale: "O assunto registrado estava errado; a conversa é sobre 2ª via." }), { anchored: [CHECKLIST_ID] }).checks.procedureSelection).toBe("DIFFERENT_FROM_SUBJECT_EXPLAINED")
  })
  it("formato: JSON cercado por um bloco de código é a mesma resposta; identificadores com colchete/hífen/zero à esquerda viram a forma canônica (nunca o mais parecido)", () => {
    expect(unwrapJsonFence('```json\n{"a":1}\n```')).toBe('{"a":1}')
    expect(unwrapJsonFence('{"a":1}')).toBe('{"a":1}')
    expect(unwrapJsonFence('texto ```json {"a":1}```')).toBe('texto ```json {"a":1}```')
    expect(["[D1]", "D-1", "d1", "D1 · Procedimento", "(S03)", "T07", " L12 — texto"].map(canonicalHandle)).toEqual(["D1", "D1", "D1", "D1", "S3", "T7", "L12"])
    expect(canonicalHandle("Procedimento de segunda via")).toBe("PROCEDIMENTO DE SEGUNDA VIA")
    const { context, projection, line } = fixtureContext()
    const fenced = "```json\n" + JSON.stringify({ scenario: { customerNeed: "Segunda via", conditions: [], procedure: "[D1]", pathSections: [], correctPath: "x", pathTaken: "y", pathAssessment: "CORRECT", pathRationale: "z", pathEvidence: [] }, criteria: [{ line: `[${line("nome completo").handle}]`, status: "MET", evidenceKind: "CONDUCT_OBSERVED", evidence: [{ turn: "T03", speaker: "OPERADOR", quote: "Me confirma seu nome completo?" }], rationale: "ok", materiality: "HIGH" }] }) + "\n```"
    const parsed = parseCallAnalysisResponse(fenced)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const analysis = verifyCallAnalysis({ model: parsed.value, context, projection, transcriptStatus: transcriptStatusOf(projection), interactionId: INTERACTION_ID, subjectAnchoredDocumentIds: [DOC_ID], repairAttempted: false })
    expect(analysis.scenario.procedureTitle).toContain("Segunda via")
    // Sem revisão, a proposta passa pela integridade mas não vira conclusão (final "não observável", hipótese registrada).
    expect(analysis.criteria.find((criterion) => criterion.text.includes("nome completo"))).toMatchObject({ proposedStatus: "MET", status: "NOT_OBSERVABLE", confirmation: "UNCONFIRMED" })
  })
  it("leitura tolerante por item: critério malformado sai registrado; envelope inválido é erro de contrato", () => {
    const parsed = parseCallAnalysisResponse(JSON.stringify({ scenario: { customerNeed: "x", procedure: "D1", pathSections: [], correctPath: "", pathTaken: "", pathAssessment: "CORRECT", pathRationale: "" }, criteria: [{ line: "L1", status: "WHATEVER" }, { line: "L2", status: "MET" }] }))
    expect(parsed.ok && parsed.value.criteria.map((criterion) => criterion.line)).toEqual(["L2"])
    expect(parsed.ok && parsed.value.contractViolations).toEqual(["criteria[0]:CRITERION_INVALID"])
    expect(parseCallAnalysisResponse("{\"criteria\": []}").ok).toBe(false)
    expect(parseCallAnalysisResponse("não é json").ok).toBe(false)
  })
})

describe("brief e composição (utilidade ≠ factualidade)", () => {
  const { line } = fixtureContext()
  const analysis = verify(modelAnalysis({ criteria: [
    { line: line("data de nascimento").handle, status: "NOT_MET", evidenceKind: "OMISSION", declaredActionTense: null, evidence: [], opportunityTurn: "T4", rationale: "Não confirmou a data de nascimento antes de enviar a segunda via.", materiality: "HIGH", guidance: { moment: "Depois de confirmar o nome", condition: null, action: "confirme a data de nascimento antes de enviar", ruleLines: [line("data de nascimento").handle] }, whyItMatters: null },
    { line: line("Confirmar se a solicitação").handle, status: "MET", evidenceKind: "CONDUCT_OBSERVED", declaredActionTense: null, evidence: [{ turn: "T5", speaker: "OPERADOR", quote: "A segunda via é da fatura ou do parcelamento?" }], opportunityTurn: null, rationale: "Confirmou o tipo de segunda via antes de enviar.", materiality: "HIGH", guidance: null, whyItMatters: "Evita enviar o documento errado, como pede a etapa de emissão." },
  ] }, { pathSections: [] }))
  const keys = new Map(analysis.criteria.map((criterion) => [criterion.lineKey, criterionKeyOf(criterion.lineKey)]))
  const brief = (delivered = new Set<string>(), history = new Map<string, { assessed: number; notMet: number; met: number }>()) => buildMonitoringBrief({ analysis, interactionId: INTERACTION_ID, label: "Segunda via", dateLabel: "29/09/2026", selectionReason: "Sinal: nota_ura = 2", criterionKeys: keys, documentTitles: new Map([[DOC_ID, "Procedimento — Segunda via de conta"]]), documentVersions: new Map([[DOC_ID, 1]]), history, delivered })
  it("desvio verificado vira ajuste com regra e orientação; acerto verificado vira reconhecimento; material recomendado explica o porquê", () => {
    const value = brief()
    expect(value.tone).toBe("MIXED")
    expect(value.developments[0]).toMatchObject({ ref: "A1", title: "Confirmar data de nascimento", absence: { opportunity: null }, guidance: { action: "confirme a data de nascimento antes de enviar" } })
    // A conduta (fala do operador) e, como a regra é condicional e a condição aconteceu nesta chamada, a fala que a mostra
    // (`STRENGTH_SELECTION_V2`): o redator pode dizer o que a conduta significou NESTE caso.
    expect(value.strengths[0]).toMatchObject({ ref: "S1", situational: true, quotes: [{ speaker: "OPERATOR" }, { speaker: "CUSTOMER", turn: "T2" }] })
    expect(value.materials[0]).toMatchObject({ documentId: DOC_ID, usedIn: ["Confirmar data de nascimento"] })
  })
  it("achado já entregue é suprimido (a observação continua na memória); histórico só com denominador", () => {
    const key = `CALL:${INTERACTION_ID}:${keys.get(analysis.criteria.find((criterion) => criterion.text.includes("nascimento"))!.lineKey)}`
    const history = new Map([[keys.get(analysis.criteria.find((criterion) => criterion.text.includes("nascimento"))!.lineKey)!, { assessed: 4, notMet: 3, met: 1 }]])
    expect(brief(new Set([key])).suppressed).toEqual([{ findingKey: key, title: "Confirmar data de nascimento", reason: "ALREADY_DELIVERED" }])
    expect(brief(new Set(), history).developments[0]!.history).toBe("Nas 4 chamadas anteriores analisadas em que esta etapa se aplicava, ela não foi cumprida em 3.")
    // Sem reincidência: o fato é que ela costuma ser cumprida — dito como o número mostra (antes saía "não foi cumprida em 0").
    const clean = new Map([[keys.get(analysis.criteria.find((criterion) => criterion.text.includes("nascimento"))!.lineKey)!, { assessed: 4, notMet: 0, met: 4 }]])
    expect(brief(new Set(), clean).developments[0]!.history).toBe("Nas 4 chamadas anteriores analisadas em que esta etapa se aplicava, ela foi cumprida em todas.")
  })
  it("checagens locais: código interno, número sem fonte e stance × ref", () => {
    const value = brief()
    const grounding = "Nas 4 chamadas"
    expect(localViolationsOf({ text: "Veja A1 e L3.", stance: "CONTEXT", refs: [] }, value, grounding)).toContain("INTERNAL_REFERENCE")
    expect(localViolationsOf({ text: "Em 7 chamadas você esqueceu.", stance: "ADJUSTMENT", refs: ["A1"] }, value, grounding)).toContain("UNGROUNDED_NUMBER")
    expect(localViolationsOf({ text: "Parabéns pela condução.", stance: "RECOGNITION", refs: ["A1"] }, value, grounding)).toContain("STANCE_REF_MISMATCH")
  })
  it("orientação genérica é recusada pela especificidade; o sistema NÃO completa a lacuna com frase pronta (nem regra literal): o ponto principal fica sem entrega útil e a composição se abstém", () => {
    const value = brief()
    const draft = parseWriterDraft(JSON.stringify({ sentences: [{ text: "Você confirmou se era fatura ou parcelamento antes de enviar.", stance: "RECOGNITION", refs: ["S1"], paragraph: 1 }, { text: "Seja mais atenta nas próximas chamadas.", stance: "GUIDANCE", refs: ["A1"], paragraph: 2 }], card: { text: "Confirme a data de nascimento antes de enviar a segunda via.", refs: ["A1"] } }))
    expect(draft.ok).toBe(true)
    const verdicts = new Map<string, Verdict>([["F1", { id: "F1", verdict: "SUPPORTED", specific: true, repeats: null, note: null }], ["F2", { id: "F2", verdict: "SUPPORTED", specific: false, repeats: null, note: "genérico" }], ["CARD", { id: "CARD", verdict: "SUPPORTED", specific: null, repeats: null, note: null }]])
    const decisions = applyVerdicts(draft.ok ? draft.draft : (null as never), value, verdicts)
    expect(decisions.sentences[1]).toMatchObject({ kept: false, reasons: ["GENERIC"] })
    expect(utilityGapsOf(value, decisions.sentences.filter((entry) => entry.kept))).toEqual({ missingGuidance: ["A1"], missingRecognition: false })
    expect(usefulnessOf(value, decisions.sentences.filter((entry) => entry.kept))).toMatchObject({ primaryRef: "A1", primaryCovered: false })
    const message = assembleMessage(value, decisions)!
    expect(message.source).toBe("WRITER")
    expect(message.sentences.every((sentence) => sentence.source === "WRITER")).toBe(true)
    expect(message.text).not.toMatch(/O procedimento orienta|Ponto principal|não aparece a etapa/)
    expect(message.text).not.toMatch(/\bA1\b|\bS1\b/)
    expect(message.view.developments[0]?.howToApply ?? null).toBeNull()
  })
})

describe("seleção dos pontos: o mesmo comportamento vira UM ponto, com rastreabilidade", () => {
  const finding = (key: string, origin: BriefFinding["origin"], section: string, extra: Partial<BriefFinding> = {}): BriefFinding => ({ ref: "", findingKey: `CALL:x:${key}`, kind: "DEVELOPMENT", origin, title: key, materiality: "HIGH", status: origin === "PATH" ? "PATH_INCORRECT" : "NOT_MET", observed: "Esta etapa não aparece nesta chamada.", reading: null, quotes: [], absence: { opportunity: null }, declaredOnly: false, rules: [{ text: `Regra ${key}`, section, documentId: "doc", documentTitle: "Procedimento" }], guidance: null, whyItMatters: null, history: null, criterionKeys: [key], stats: [], ...extra })
  it("caminho inadequado absorve as etapas do próprio caminho; etapas da mesma seção viram um ponto; nenhum achado some", () => {
    const path = finding("PATH", "PATH", "Regra geral", { criterionKeys: ["KC-a", "KC-b"] })
    const a = finding("KC-a", "CRITERION", "Regra geral")
    const b = finding("KC-b", "CRITERION", "Regra geral")
    const c = finding("KC-c", "CRITERION", "Encerramento")
    const d = finding("KC-d", "CRITERION", "Encerramento")
    const e = finding("KC-e", "CRITERION", "Validação")
    const out = consolidateDevelopments([path, a, b, c, d, e])
    expect(out.map((entry) => entry.title)).toEqual(["PATH", "Encerramento", "KC-e"])
    expect(out[0]!.criterionKeys).toEqual(expect.arrayContaining(["KC-a", "KC-b"]))
    expect(out[0]!.memberFindingKeys).toEqual(["CALL:x:KC-a", "CALL:x:KC-b"])
    expect(out[1]).toMatchObject({ criterionKeys: ["KC-c", "KC-d"], memberFindingKeys: ["CALL:x:KC-d"], observed: "Estas etapas não aparecem nesta chamada." })
    expect(out[1]!.rules.map((rule) => rule.text)).toEqual(["Regra KC-c", "Regra KC-d"])
    const keys = out.flatMap((entry) => [entry.findingKey, ...(entry.memberFindingKeys ?? [])])
    expect(new Set(keys)).toEqual(new Set([path, a, b, c, d, e].map((entry) => entry.findingKey)))
  })
})

describe("investigação de indicador (localização, evidência, referência, conclusão)", () => {
  const official = (overrides: Partial<OfficialFacts> = {}): OfficialFacts => ({ indicatorId: "i", code: "TMA", name: "TMA", unit: "SECONDS", direction: "LOWER", sourceKind: "OFFICIAL_CLOSING", sourceRef: "s", value: 400, target: 420, withinTarget: true, gapToTarget: null, periodStart: "2026-08-01", periodEnd: "2026-08-31", periodLabel: "agosto/2026", referencePeriod: "2026-08", previous: { value: 420, periodLabel: "julho/2026", withinTarget: true }, movement: "IMPROVED", quartile: null, previousQuartile: null, ...overrides })
  it("TMA geral melhor escondendo piora num assunto: o assunto que piorou vira foco (piora escondida)", () => {
    const compared = compareSegments([
      { key: "segunda_via", label: "Segunda via", current: { n: 40, value: 250 }, previous: { n: 30, value: 300 } },
      { key: "contestacao", label: "Contestação", current: { n: 12, value: 620 }, previous: { n: 14, value: 480 } },
    ], "LOWER", "DURATION_SECONDS", 3)
    const focus = selectFocusSegments(compared.segments, official(), compared.overall.direction)
    expect(focus).toEqual([{ key: "contestacao", label: "Contestação", reason: "HIDDEN_DETERIORATION" }])
    expect(compared.segments.find((segment) => segment.key === "contestacao")!.changeDirection).toBe("WORSE")
  })
  it("variação explicada pelo MIX (mesmos tempos por assunto, mais chamadas longas) não aponta assunto que piorou", () => {
    const compared = compareSegments([
      { key: "curto", label: "Curto", current: { n: 10, value: 200 }, previous: { n: 30, value: 200 } },
      { key: "longo", label: "Longo", current: { n: 30, value: 600 }, previous: { n: 10, value: 600 } },
    ], "LOWER", "DURATION_SECONDS", 3)
    expect(compared.decomposition?.dominant).toBe("MIX")
    expect(compared.overall.direction).toBe("WORSE")
    const focus = selectFocusSegments(compared.segments, official({ movement: "WORSENED", withinTarget: false }), compared.overall.direction)
    expect(focus).toEqual([])
    const localization = { proxy: { kind: "DURATION_SECONDS", label: "", description: "" }, windows: { current: { start: "", end: "", label: "" }, previous: { start: "", end: "", label: "" } }, overall: compared.overall, officialAgreement: "AGREES", decomposition: compared.decomposition, segments: compared.segments, daily: { available: false, points: [], outliers: [], weekdays: [] }, focus, limitations: [] } as Localization
    expect(concludeInvestigation({ official: official({ movement: "WORSENED", withinTarget: false }), localization, evidence: [], reference: null }).conclusion).toBe("MIX_EFFECT")
  })
  it("volume insuficiente num dos períodos: nada de variação nem decomposição", () => {
    const compared = compareSegments([{ key: "a", label: "A", current: { n: 13, value: 600 }, previous: { n: 1, value: 1385 } }], "LOWER", "DURATION_SECONDS", 3)
    expect(compared.overall.direction).toBe("UNKNOWN")
    expect(compared.decomposition).toBeNull()
  })
  it("dias fora do padrão só com medição diária; direção decide o que é ruim", () => {
    const points = [300, 310, 305, 295, 300, 700, 302].map((value, index) => ({ date: `2026-08-0${index + 1}`, value }))
    expect(dailyProfileOf(points, "LOWER").outliers.map((point) => point.date)).toEqual(["2026-08-06"])
    expect(dailyProfileOf(points, "HIGHER").outliers).toEqual([])
  })
  const row = (interactionId: string, status: MemoryRow["status"], personId = "p1", criterionKey = "KC-000000000001"): MemoryRow => ({ interactionId, personId, criterionKey, documentId: DOC_ID, documentTitle: "Doc", heading: "3. Emissão", text: "- Confirmar o tipo", status, localDate: "2026-08-10", evidence: [], rationale: "r", guidance: null, materiality: "HIGH" })
  it("padrão só com denominador: 2 de 3 não cumprido = padrão; 1 de 3 = desvio isolado; inconclusivos à parte", () => {
    expect(criterionPatternsOf([row("i1", "NOT_MET"), row("i2", "NOT_MET"), row("i3", "MET"), row("i4", "NOT_OBSERVABLE")])[0]).toMatchObject({ classification: "DEVELOPMENT_PATTERN", eligible: 3, notMet: 2, inconclusive: 1 })
    expect(criterionPatternsOf([row("i1", "NOT_MET"), row("i2", "MET"), row("i3", "MET")])[0]!.classification).toBe("ISOLATED_DEVIATION")
  })
  it("grupo de referência: quartil superior pela direção, mínimo de população (privacidade); prática só com contribuintes suficientes", () => {
    expect(topReferenceMembers([{ personId: "a", value: 300, n: 5 }, { personId: "b", value: 500, n: 5 }, { personId: "c", value: 350, n: 5 }], "LOWER", 3)).toEqual({ members: [], population: 3 })
    const ranked = topReferenceMembers(["a", "b", "c", "d", "e", "f"].map((personId, index) => ({ personId, value: 300 + index * 50, n: 5 })), "LOWER", 3)
    expect(ranked.members).toEqual(["a", "b", "c"])
    const personPatterns = criterionPatternsOf([row("i1", "NOT_MET"), row("i2", "NOT_MET"), row("i3", "MET")])
    const reference = [row("r1", "MET", "a"), row("r2", "MET", "b"), row("r3", "MET", "c"), row("r4", "MET", "a"), row("r5", "MET", "b")]
    expect(referencePracticesOf(reference, personPatterns)[0]).toMatchObject({ contrast: "REFERENCE_FOLLOWS_PERSON_MISSES", reference: { eligible: 5, met: 5, contributors: 3 } })
    expect(referencePracticesOf(reference.slice(0, 4), personPatterns)).toEqual([])
  })
})
