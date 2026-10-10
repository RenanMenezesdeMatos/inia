import { describe, expect, it } from "vitest"
import { createInMemoryReliableFeedbackStore } from "../infrastructure/in-memory-reliable-feedback-store.js"
import { generateReliableFeedback, type ReliableGenerationDeps, type ReliableGenerationRequest } from "./generate-reliable-feedback.js"
import type { ReliableFeedbackWriterPort } from "./ports.js"
import { RELIABLE_FEEDBACK_AUTONOMOUS_POLICY } from "../domain/reliable-feedback-item.js"
import { nodeOutputOf } from "../domain/reliable-feedback-artifact.js"
import { verifyKnowledgeQuote, verifyProcessAssessments, type VerifiedCheckpoint } from "../domain/process-assessment.js"
import { isEligibleProcessCheckpoint } from "../domain/checkpoint-eligibility.js"
import { backfillCheckpointRule } from "../domain/rule-selection.js"
import { ruleContextOf } from "../domain/verified-omission.js"
import { assessCompleteness } from "../domain/composite-checkpoint.js"
import { returnChannelEvidenceOf, subItemMatches } from "../domain/subitem-semantics.js"
import { isUnderstandingCheckQuestion, isUnderstandingCheckStep } from "../domain/action-semantics.js"
import { structuredAnchorOf } from "../domain/structured-anchor.js"
import { checkpointReadinessOf, compositeFactsOf, isObservationEligibleForAnalytics } from "../../indicator-diagnosis/domain/observation-readiness.js"
import { observationsFrom } from "../../indicator-diagnosis/domain/process-patterns.js"
import { sectionProcessRoleIn, sectionProcessRoleOf } from "../../knowledge/domain/section-roles.js"
import { retrieveKnowledgeForAgent } from "../../knowledge/application/retrieve-knowledge.js"
import { checkpointCapacityFor, PROCESS_ASSESSMENT_INSTRUCTIONS } from "../../agents/domain/process-assessment-contract.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import {
  V171K_ASSESSMENT, V171K_CHECKLIST_ID, V171K_COLLABORATOR_NAME, V171K_CONTENT, V171K_DOC_TITLE, V171K_PRESENTED, V171K_PUBLISHED, V171K_SUBJECT, V171K_TRANSCRIPT, V171K_WRITER_RAW,
} from "../testing/contestacao-v171k-smoke-fixture.js"
import { V171J_PRESENTED } from "../testing/contestacao-v171j-smoke-fixture.js"

/**
 * V1.7.1l — PAPEL DA SEÇÃO + ELEGIBILIDADE DE ETAPA EXECUTÁVEL + CANAL DE RETORNO × CONTATO + CONFIRMAÇÃO DE ENTENDIMENTO, sobre o
 * smoke REAL da V1.7.1k (SMOKE-V171K-CONTESTACAO-001; sem modelo).
 */
const CHECKLIST_TITLE = "Checklist de Encerramento de Chamada"
const OBJECTIVE_ITEMS = ["Identificação correta da cobrança questionada;", "Prevenção de novas cobranças indevidas;", "Abertura de análise quando a cobrança depender de investigação;", "Informação sobre valores, prazos e canais de acompanhamento;"]
const RECAP = "Antes de encerrar, informar: - Conta analisada; - Lançamento contestado; - Valor; - Ação realizada; - Serviço cancelado, quando aplicável; - Conta ajustada; - Valor a pagar; - Prazo; - Canal de retorno; - Protocolo."
const operatorTurns = V171K_TRANSCRIPT.split("\n").filter((line) => line.startsWith("Operador:")).map((line) => line.replace(/^Operador:\s*/, ""))
const turn = (pattern: RegExp) => operatorTurns.find((line) => pattern.test(line))!
const PHONE_TURN = turn(/telefone de contato/)
const RECAP_TURN = turn(/recapitulando/)
/** A seção 51 ("Frases que devem ser evitadas", mesmo documento/versão) NÃO entrou no prompt do smoke V1.7.1k; nos casos de
 * "evitar" ela é acrescentada, como no smoke V1.7.1j em que foi apresentada. */
const SECTION_51 = V171J_PRESENTED.find((excerpt) => excerpt.heading === "51. Frases que devem ser evitadas")!
const PRESENTED_WITH_51 = [...V171K_PRESENTED, SECTION_51]
const verify = (quote: string, title = V171K_DOC_TITLE) => verifyKnowledgeQuote({ documentTitle: title, quote, presented: PRESENTED_WITH_51, published: V171K_PUBLISHED, anchorTexts: [] })
const eligibilityOf = (quote: string, title = V171K_DOC_TITLE) => {
  const knowledge = verify(quote, title)
  return isEligibleProcessCheckpoint({ content: V171K_PUBLISHED.get(knowledge.documentId!)!.content, heading: knowledge.heading, documentTitle: knowledge.documentTitle, documentId: knowledge.documentId, version: knowledge.version, contentKind: knowledge.contentKind })
}

describe("V1.7.1l — A/B/C) papel da SEÇÃO × papel do SEGMENTO", () => {
  it("A) a lista de “1. Objetivo” é REGRA como texto, mas NÃO é etapa executável", () => {
    for (const item of OBJECTIVE_ITEMS) {
      const knowledge = verify(item)
      expect(knowledge).toMatchObject({ literalInPublished: true, heading: "1. Objetivo", contentKind: "RULE_CONTENT" })
      expect(eligibilityOf(item)).toMatchObject({ eligible: false, reason: "NON_EXECUTABLE_SECTION", sectionRole: "OBJECTIVE", segmentRole: "RULE", documentVersion: 1 })
    }
  })

  it("B) CHECKLIST é elegível: seção 55, o documento de checklist sem seções e os critérios de qualidade", () => {
    expect(eligibilityOf("- [ ] Informei prazo e canal de retorno?")).toMatchObject({ eligible: true, sectionRole: "CHECKLIST" })
    expect(eligibilityOf("(3) explique o próximo passo e o prazo;", CHECKLIST_TITLE)).toMatchObject({ eligible: true, sectionRole: "CHECKLIST", documentId: V171K_CHECKLIST_ID })
    expect(sectionProcessRoleIn(V171K_CONTENT, "52. Critérios de qualidade", V171K_DOC_TITLE)).toBe("CHECKLIST")
  })

  it("C) etapa de procedimento, regra e “evitar” são elegíveis; objetivo, abrangência, conceitos, resultado esperado, referência e exemplos não", () => {
    expect(eligibilityOf(RECAP)).toMatchObject({ eligible: true, sectionRole: "PROCEDURE_STEP" })
    expect(eligibilityOf("Perguntar: - “As informações ficaram claras?”")).toMatchObject({ eligible: true, sectionRole: "PROCEDURE_STEP" })
    expect(eligibilityOf("- “É só aguardar.”")).toMatchObject({ eligible: true, sectionRole: "WARNING", segmentRole: "AVOID" })
    // Título sem papel reconhecido continua elegível (comportamento anterior; nunca descarta em silêncio).
    expect(isEligibleProcessCheckpoint({ content: V171K_CONTENT, heading: "15. Serviços digitais não reconhecidos", documentTitle: V171K_DOC_TITLE, contentKind: "RULE_CONTENT" })).toMatchObject({ eligible: true, sectionRole: "UNKNOWN" })
    const role = (heading: string) => sectionProcessRoleIn(V171K_CONTENT, heading, V171K_DOC_TITLE)
    expect([role("2. Abrangência"), role("3. Conceitos"), role("3.5 Conta ajustada"), role("57. Resultado esperado"), role("54. Indicadores operacionais"), role("50. Frases recomendadas")]).toEqual(["SCOPE", "CONTEXT", "CONTEXT", "RESULT_EXPECTATION", "REFERENCE", "EXAMPLE_SECTION"])
    // Mesmo título limpo, seções diferentes: "3.5 Conta ajustada" (Conceitos) ≠ "32. Conta ajustada" (procedimento).
    expect(role("32. Conta ajustada")).toBe("UNKNOWN")
    expect([role("49. Condutas proibidas"), role("51. Frases que devem ser evitadas"), role("28.4 Contestação pendente de análise")]).toEqual(["WARNING", "WARNING", "DECISION_RULE"])
    expect(sectionProcessRoleOf("Perguntas recomendadas")).toBe("EXAMPLE_SECTION")
    expect(sectionProcessRoleOf("Expressões não recomendadas")).toBe("WARNING")
  })
})

describe("V1.7.1l — D) o objetivo continua como CONTEXTO para o especialista (espaço de candidatos)", () => {
  const DOC = "# Procedimento X\n\n## 1. Objetivo\n\nGarantir:\n\n- Informação sobre prazos;\n- Prevenção de cobranças.\n\n## 2. Checklist do operador\n\n- [ ] Informei o prazo?\n- [ ] Forneci protocolo?"
  const fakeDb = { query: async () => ({ rows: [{ id: "doc-x", title: "Procedimento X", content: DOC }] }) } as unknown as Database
  it("o conteúdo do objetivo chega ao prompt rotulado como contexto; o checklist sai como antes; sem a opção nada muda", async () => {
    const marked = await retrieveKnowledgeForAgent(fakeDb, "agent-x", "prazo", undefined, null, { markProcessRoles: true })
    expect(marked.trace.mode).toBe("FULL")
    expect(marked.promptBlock).toContain("[Seção: 1. Objetivo · CONTEXTO DO PROCEDIMENTO (objetivo do procedimento) — explica o processo, não é etapa avaliável]\nGarantir:")
    expect(marked.promptBlock).toContain("- Informação sobre prazos;")
    // V1.7.1n — as etapas avaliáveis saem marcadas com o código do catálogo; o contexto (objetivo) nunca recebe código.
    expect(marked.promptBlock).toMatch(/\[Seção: 2\. Checklist do operador\]\n\[CP-[0-9a-f]{10}\] - \[ \] Informei o prazo\?/)
    expect(marked.promptBlock).not.toMatch(/\[CP-[0-9a-f]{10}\] - Informação sobre prazos/)
    const plain = await retrieveKnowledgeForAgent(fakeDb, "agent-x", "prazo")
    expect(plain.promptBlock).not.toContain("CONTEXTO DO PROCEDIMENTO")
    expect(plain.promptBlock).toContain("[Seção: 1. Objetivo]\nGarantir:")
  })
  it("o teto de etapas conta só as seções executáveis; a instrução diz que contexto nunca é etapa", () => {
    const presented = [{ documentTitle: "Procedimento X", heading: "1. Objetivo", excerpt: "- Informação sobre prazos;\n- Prevenção de cobranças." }, { documentTitle: "Procedimento X", heading: "2. Checklist do operador", excerpt: "- [ ] Informei o prazo?\n- [ ] Forneci protocolo?" }]
    expect(checkpointCapacityFor("Procedimento X", presented).presentedSteps).toBe(2)
    expect(PROCESS_ASSESSMENT_INSTRUCTIONS).toContain("Trechos marcados como CONTEXTO DO PROCEDIMENTO (objetivo, abrangência, conceitos, resultado esperado, referência, exemplos) explicam o processo")
  })
})

describe("V1.7.1l — E/F) prontidão analítica e backfill respeitam a elegibilidade", () => {
  it("E) observação derivada de seção não executável nunca é VERIFIED, mesmo literal, ancorada e com regra válida", () => {
    const knowledge = { ...verify(OBJECTIVE_ITEMS[2]!), applicability: "VERIFIED" as const, applicabilityBasis: "LEXICAL_ANCHOR" as const }
    const checkpoint = { knowledge, evidenceType: "OBSERVED_DECLARATION" as const, checkpointEligibility: eligibilityOf(OBJECTIVE_ITEMS[2]!) } as Pick<VerifiedCheckpoint, "knowledge" | "evidenceType" | "checkpointEligibility">
    expect(checkpointReadinessOf(checkpoint)).toEqual({ status: "REJECTED", reasons: ["NOT_A_PROCESS_CHECKPOINT"] })
    expect(isObservationEligibleForAnalytics({ status: "FOLLOWED", analyticsStatus: "REJECTED" })).toBe(false)
    // Sem a elegibilidade negativa, a mesma prova continua VERIFIED (nada mais mudou na regra).
    expect(checkpointReadinessOf({ knowledge, evidenceType: "OBSERVED_DECLARATION" })).toEqual({ status: "VERIFIED", reasons: [] })
  })

  it("F) o backfill da regra de COMO cumprir nunca busca em objetivo (nem abrangência, conceitos, resultado esperado, exemplos)", () => {
    const doc = "# P\n\n## 1. Objetivo do prazo\n\nO operador deverá garantir que o cliente conheça o prazo.\n\n## 5. Registro\n\nSe o cliente não reconhecer:\n\n1. Registrar contestação;\n2. Explicar prazo;\n\n## 9. Prazo da análise\n\nO operador deverá informar o prazo exibido na ferramenta."
    const rule = ruleContextOf(doc, "2. Explicar prazo;", "5. Registro")
    expect(backfillCheckpointRule({ content: doc, rule, citedKind: "RULE_CONTENT" })).toMatchObject({ operativeRule: { quote: "O operador deverá informar o prazo exibido na ferramenta.", heading: "9. Prazo da análise" }, audit: { status: "BACKFILLED", candidateSections: ["Prazo da análise"] } })
    const onlyObjective = doc.replace(/## 9\. Prazo da análise[\s\S]*$/, "")
    expect(backfillCheckpointRule({ content: onlyObjective, rule: ruleContextOf(onlyObjective, "2. Explicar prazo;", "5. Registro"), citedKind: "RULE_CONTENT" })).toMatchObject({ operativeRule: null, audit: { status: "NO_MATCHING_SECTION" } })
  })
})

describe("V1.7.1l — G/H/I/J) canal de retorno ≠ dado de contato", () => {
  const fold = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()
  const composite = (extra: string[] = []) => assessCompleteness({ quote: RECAP, evidence: [{ turnRef: "T21", text: RECAP_TURN }], operatorConversation: [...operatorTurns, ...extra], windowComplete: true })!
  const channel = (result: ReturnType<typeof composite>) => result.items.find((item) => /canal de retorno/i.test(item.text))!

  it("G) “o seu telefone de contato continua sendo…” confirma cadastro — não é canal de retorno", () => {
    expect(returnChannelEvidenceOf(fold(PHONE_TURN))).toBe("CONTACT_INFORMATION")
    expect(subItemMatches("RETURN_CHANNEL", PHONE_TURN)).toBe(false)
    // Na chamada real, nenhuma fala liga canal a retorno: a ausência continua comprovada (transcrição completa, detector confiável).
    expect(channel(composite())).toMatchObject({ kind: "RETURN_CHANNEL", status: "VERIFIED_ABSENT" })
  })
  it("H) retorno por SMS é canal de retorno", () => {
    expect(subItemMatches("RETURN_CHANNEL", "Você receberá o retorno por SMS.")).toBe(true)
    expect(subItemMatches("RETURN_CHANNEL", "O retorno será feito por ligação.")).toBe(true)
    expect(subItemMatches("RETURN_CHANNEL", "Acompanhe pelo aplicativo.")).toBe(true)
    expect(channel(composite(["A contestação foi registrada e o retorno será enviado por SMS."]))).toMatchObject({ status: "OBSERVED_ELSEWHERE" })
  })
  it("I) envio por e-mail é canal de retorno", () => {
    expect(subItemMatches("RETURN_CHANNEL", "Vamos enviar por e-mail.")).toBe(true)
    expect(subItemMatches("RETURN_CHANNEL", "Vamos te ligar quando sair o resultado.")).toBe(true)
  })
  it("J) número de telefone solto, canal de contratação e retorno sem canal não são canal de retorno; canal + retorno sem relação = dúvida", () => {
    for (const text of ["(85) 99999-0000", "Seu telefone continua sendo 85 99999-0000?", "Foi contratada pelo aplicativo no dia 2 de agosto.", "Agora é só aguardar o retorno da análise, eles olham e depois te avisam."]) expect(subItemMatches("RETURN_CHANNEL", text)).toBe(false)
    // Dúvida nunca vira OBSERVADO e impede afirmar a ausência (UNKNOWN).
    expect(returnChannelEvidenceOf(fold("Você recebeu algum SMS?"))).toBe("AMBIGUOUS")
    expect(channel(composite(["Você recebeu algum SMS?"]))).toMatchObject({ status: "UNKNOWN" })
  })
})

describe("V1.7.1l — K/L/M) confirmação de entendimento pela ação canônica", () => {
  const knowledge = verify("Perguntar: - “As informações ficaram claras?”")
  const anchor = (speech: string) => structuredAnchorOf({ status: "FOLLOWED", declaredEvidenceType: "OBSERVED", contentKind: knowledge.contentKind, rule: ruleContextOf(V171K_CONTENT, knowledge.quote!, knowledge.heading), citedQuote: knowledge.quote, documentTitle: knowledge.documentTitle, subject: V171K_SUBJECT, operatorEvidence: [{ turnRef: "T23", text: speech }], conversation: operatorTurns, operatorConversation: operatorTurns })

  it("K) “Ficou claro?” / “Ficou claro pra você…?” confirma entendimento (flexão não manda ao QA)", () => {
    for (const text of ["Ficou claro?", "Ficou claro pra você?", "Conseguiu entender?", "Ficou alguma dúvida?", "Alguma dúvida?"]) expect(isUnderstandingCheckQuestion(text)).toBe(true)
    expect(anchor(turn(/Ficou claro/))).toMatchObject({ anchored: true, basis: "UNDERSTANDING_CHECK", failure: null })
  })
  it("L) “As informações ficaram claras?” idem — e a etapa de checklist que pede confirmar dúvidas é a mesma ação", () => {
    expect(isUnderstandingCheckQuestion("As informações ficaram claras?")).toBe(true)
    expect(anchor("As informações ficaram claras?")).toMatchObject({ anchored: true, basis: "UNDERSTANDING_CHECK" })
    for (const step of ["(4) confirme se o cliente tem mais alguma dúvida.", "- [ ] Confirmei se restaram dúvidas?", "- Confirmar o entendimento;"]) expect(isUnderstandingCheckStep(step)).toBe(true)
  })
  it("M) outra pergunta não é confirmação de entendimento (intenção + objeto, não formato interrogativo)", () => {
    for (const text of ["Certo. Qual é a cobrança que você não reconhece?", PHONE_TURN, "Posso te ajudar em mais alguma coisa?", "Ficou claro."]) expect(isUnderstandingCheckQuestion(text)).toBe(false)
    expect(anchor(turn(/Qual é a cobrança/))).toMatchObject({ anchored: false })
    expect(anchor(turn(/mais alguma coisa/))).toMatchObject({ anchored: false })
    expect(isUnderstandingCheckStep("(2) informe o número do protocolo;")).toBe(false)
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// N/O — replay do smoke REAL da V1.7.1k
// ---------------------------------------------------------------------------------------------------------------------

/** O redator real respondeu por slot (ordem dos itens daquela execução): mapeia pelo requisito. */
const SLOTS: [RegExp, number][] = [[/prazos e canais/i, 0], [/Abertura de análise/i, 1], [/Identificação correta/i, 2], [/Prevenção/i, 3], [/Confirmação de entendimento/i, 4]]
function writer(): ReliableFeedbackWriterPort & { requested: string[] } {
  const requested: string[] = []
  return {
    requested,
    writeMonitoring: async (input) => {
      requested.push(...input.items.map((item) => item.requirement ?? ""))
      return { rawOutput: { items: input.items.flatMap((item) => { const hit = SLOTS.find(([pattern]) => pattern.test(item.requirement ?? "")); return hit ? [{ ...V171K_WRITER_RAW.items[hit[1]]!, slot: item.slot }] : [] }), presentation: V171K_WRITER_RAW.presentation } }
    },
    writeIndicator: async () => { throw new Error("não usado") },
  }
}
async function replay(assessment: unknown = V171K_ASSESSMENT) {
  const store = createInMemoryReliableFeedbackStore({ onReactivate: () => true })
  const port = writer()
  const deps: ReliableGenerationDeps = {
    enabled: true, store, writer: port, policy: RELIABLE_FEEDBACK_AUTONOMOUS_POLICY,
    loadMonitoringContext: async () => ({ transcript: V171K_TRANSCRIPT, label: `Atendimento de 25/09/2026 · ${V171K_SUBJECT}`, otherOperatorNames: [], subjectOperatorName: V171K_COLLABORATOR_NAME }),
    loadIndicatorContext: async () => null, loadPublishedKnowledge: async () => V171K_PUBLISHED, loadIndicatorDiagnosisPlan: async () => null,
    loadPeerPracticeData: async () => ({ peers: [], observations: [] }), resolveDiagnosticStrategy: async () => null,
    loadRecipient: async () => ({ firstName: "Larissa" }), now: () => new Date("2026-09-26T01:10:00Z"),
  }
  const source = { kind: "monitoring", knowledgeExcerpts: V171K_PRESENTED, input: { organizationId: "org-l", operatorId: "op-l", interactionId: "int-l", structured: { evidenceFound: "x", observedBehavior: "o", relatedProcedure: V171K_DOC_TITLE, recommendation: "r", processAssessment: JSON.parse(JSON.stringify(assessment)) } } }
  const request: ReliableGenerationRequest = { organizationId: "org-l", enrollmentId: "enr-l", workflowId: "wf", workflowVersionId: "v1", nodeId: "gerar", sourceNodeId: "orq", sourceType: "AGENT", domain: "MONITORING", sourceNodeOutput: source, collaboratorId: "op-l", interactionId: "int-l", indicatorMeasurementId: null, configuredAgentId: null }
  const result = await generateReliableFeedback(deps, request)
  const artifact = result.record.artifact!
  const byStep = (pattern: RegExp) => artifact.items.find((item) => pattern.test(item.process?.requirement ?? ""))
  const text = nodeOutputOf(result.record.id, artifact, artifact.items.map((item) => ({ itemIndex: item.index, status: "APPROVED_UNCHANGED" as const, finalWording: null }))).text
  return { store, result, artifact, byStep, text, requested: port.requested }
}
const verified = (assessment: unknown = V171K_ASSESSMENT, presented = V171K_PRESENTED) => verifyProcessAssessments({ sources: [{ sourceRef: "S", assessment: JSON.parse(JSON.stringify(assessment)) as never, presented }], interactionId: "int-l", transcript: V171K_TRANSCRIPT, published: V171K_PUBLISHED, subject: V171K_SUBJECT })

describe("V1.7.1l — N) replay do smoke REAL da V1.7.1k (A–H)", () => {
  it("objetivo deixa de ser etapa; recapitulação parcial correta; confirmação sem QA por flexão", async () => {
    const { artifact, byStep, text, requested } = await replay()
    // Antes: 6 detectadas, 2 prontas, 4 em QA. Agora: as 4 citações de "1. Objetivo" ficam como contexto (fora de "detectadas").
    expect(artifact.findings).toMatchObject({ detected: 2, reliable: 2, inFeedback: 2, heldForQa: 0, blocked: 0, notApplicable: 0, notCheckpoint: 4 })
    // A/B) nenhum ponto a partir do Objetivo: nem item, nem redator, nem título "Objetivo".
    expect(artifact.items.map((item) => item.process?.requirement)).toEqual(["Recapitulação obrigatória e fornecimento de protocolo", "Confirmação de entendimento"])
    expect(requested).toEqual(["Confirmação de entendimento"])
    expect(text).not.toMatch(/### Objetivo|faltou definir o processo|não deverá presumir|Informação sobre valores, prazos e canais|Abertura de análise/)
    const cited = artifact.processAssessment!.checkpoints.filter((checkpoint) => /^P1\.C[1-4]$/.test(checkpoint.ref))
    expect(cited.map((checkpoint) => [checkpoint.status, checkpoint.statusDowngradeReason, checkpoint.checkpointEligibility?.sectionRole])).toEqual(Array(4).fill(["NOT_APPLICABLE", "NOT_A_PROCESS_CHECKPOINT", "OBJECTIVE"]))
    // D/F/G) o gap de prazo fica sustentado pela etapa procedural REAL (recapitulação, seção 46): prazo e canal de retorno
    // comprovadamente ausentes; o telefone de contato não vira canal; valor informado.
    const recap = byStep(/Recapitula/)!
    expect(recap).toMatchObject({ section: "OPPORTUNITY", wordingSource: "SYSTEM", decision: { disposition: "READY" }, process: { completeness: { status: "PARTIAL", observed: ["lançamento contestado", "valor", "serviço cancelado, quando aplicável", "protocolo"], absent: ["prazo", "canal de retorno"], elsewhere: ["conta analisada", "ação realizada"] } } })
    expect(recap.proposedWording!.observed).toBe("Em “Recapitulação obrigatória”, você fez parte do que o procedimento prevê, incluindo “Lançamento contestado”, “Valor”, “Serviço cancelado” e “Protocolo”, mas não todos os itens previstos. Nesta chamada não apareceram “Prazo” e “Canal de retorno”. “Conta ajustada” e “Valor a pagar” não se aplicavam neste momento, porque o resultado ainda estava pendente.")
    // H) confirmação de entendimento: âncora pela ação canônica; nenhum QA.
    expect(byStep(/Confirmação de entendimento/)).toMatchObject({ section: "STRENGTH", knowledge: { applicability: "VERIFIED", structuredAnchorBasis: "UNDERSTANDING_CHECK" }, wordingSource: "WRITER", decision: { disposition: "READY" } })
    // V1.7.2 — ponto cumprido em "O que manter"; a pergunta real continua no item (evidência).
    expect(text).toContain("verificou se o cliente tinha dúvidas")
    expect(byStep(/Confirmação de entendimento/)!.facts.map((fact) => fact.text)).toContain("Ficou claro pra você como vai funcionar daqui pra frente?")
    // Exemplo continua rotulado; SMS (só da fala-modelo) nunca aparece.
    expect(text).not.toMatch(/SMS/)
  })

  it("E) controlado — com o espaço de candidatos corrigido, o especialista cita etapas REAIS: prazo pelo checklist e “é só aguardar” pelo evitar", async () => {
    // Contrafactual CONTROLADO (não é saída do modelo): as mesmas falas reais, citando o que o prompt corrigido oferece como etapa.
    const assessment = JSON.parse(JSON.stringify(V171K_ASSESSMENT))
    assessment.processes.push({ documentTitle: CHECKLIST_TITLE, product: null, checkpoints: [{ status: "NOT_FOLLOWED", evidenceType: "OBSERVED", requirement: "explique o próximo passo e o prazo", transcriptEvidence: ["Operador: Olha, não tenho como te dizer exatamente, depende da equipe."], knowledgeQuote: "(3) explique o próximo passo e o prazo;", knowledgeDetailQuote: null, guidance: { source: "OFFICIAL_PROCEDURE", text: null }, uncertainty: null }] })
    assessment.processes[0].checkpoints.push({ status: "NOT_FOLLOWED", evidenceType: "OBSERVED", requirement: "Evitar a frase É só aguardar", transcriptEvidence: ["Operador: Agora é só aguardar o retorno da análise, eles olham e depois te avisam."], knowledgeQuote: "- “É só aguardar.”", knowledgeDetailQuote: null, guidance: { source: "OFFICIAL_PROCEDURE", text: null }, uncertainty: null })
    const assessmentResult = verified(assessment, PRESENTED_WITH_51)
    const prazo = assessmentResult.checkpoints.find((checkpoint) => checkpoint.requirement === "explique o próximo passo e o prazo")!
    const avoid = assessmentResult.checkpoints.find((checkpoint) => /É só aguardar/.test(checkpoint.requirement))!
    expect(prazo).toMatchObject({ status: "NOT_FOLLOWED", checkpointEligibility: { eligible: true, sectionRole: "CHECKLIST" }, knowledge: { applicability: "VERIFIED", structuredAnchor: { basis: "OBSERVED_DEVIATION" } } })
    expect(avoid).toMatchObject({ status: "NOT_FOLLOWED", checkpointEligibility: { eligible: true, sectionRole: "WARNING", segmentRole: "AVOID" }, knowledge: { applicability: "VERIFIED", structuredAnchor: { basis: "AVOIDED_PHRASE_OBSERVED" } } })
    expect(checkpointReadinessOf(prazo).status).toBe("VERIFIED")
    expect(checkpointReadinessOf(avoid).status).toBe("VERIFIED")
  })
})

describe("V1.7.1l — O) visão analítica e o futuro Chat", () => {
  it("todas as observações × elegíveis: nada vindo de “Objetivo”; recapitulação parcial com canal de retorno não informado", () => {
    const observations = observationsFrom("op-l", [{ interactionId: "int-l", assessment: verified() }])
    expect(observations.map((observation) => [observation.requirement, observation.status, observation.completeness, observation.analyticsStatus])).toEqual([
      ["Recapitulação obrigatória e fornecimento de protocolo", "NOT_FOLLOWED", "PARTIAL", "VERIFIED"],
      ["Confirmação de entendimento", "FOLLOWED", null, "VERIFIED"],
    ])
    const eligible = observations.filter(isObservationEligibleForAnalytics)
    expect(eligible).toHaveLength(2)
    expect(eligible.some((observation) => /Objetivo|Abertura de análise|valores, prazos e canais|Identificação correta|Prevenção/.test(observation.requirement))).toBe(false)
    const facts = compositeFactsOf(eligible.find((observation) => /Recapitula/.test(observation.requirement))!.subItems)
    expect(facts.informed).toEqual(["conta analisada", "lançamento contestado", "valor", "ação realizada", "serviço cancelado, quando aplicável", "protocolo"])
    expect(facts.notInformed).toEqual(["prazo", "canal de retorno"])
    expect(facts.notEvaluated).toEqual([])
    // SUBITEM_APPLICABILITY_V1 — a análise ficou pendente: conta ajustada e valor a pagar não se aplicavam (nunca "não informou").
    expect(facts.notApplicable).toEqual(["conta ajustada", "valor a pagar"])
  })

  it("QA: nenhum item fica pendente — as quatro dúvidas do smoke eram objetivo tomado como etapa e flexão verbal", async () => {
    const { store, artifact, result } = await replay()
    expect(store.reviews).toHaveLength(0)
    expect(result.record.disposition).toBe("READY")
    expect(artifact.items.every((item) => item.decision.disposition === "READY")).toBe(true)
  })
})
