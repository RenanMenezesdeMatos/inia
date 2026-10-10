import { describe, expect, it } from "vitest"
import { createInMemoryReliableFeedbackStore } from "../infrastructure/in-memory-reliable-feedback-store.js"
import { generateReliableFeedback, type ReliableGenerationDeps, type ReliableGenerationRequest } from "./generate-reliable-feedback.js"
import type { ReliableFeedbackWriterPort } from "./ports.js"
import { knowledgeQualityBlockers, RELIABLE_FEEDBACK_AUTONOMOUS_POLICY, type ReliableItemDraft } from "../domain/reliable-feedback-item.js"
import { nodeOutputOf } from "../domain/reliable-feedback-artifact.js"
import { verifyProcessAssessments } from "../domain/process-assessment.js"
import { structuredAnchorOf } from "../domain/structured-anchor.js"
import { backfillCheckpointRule } from "../domain/rule-selection.js"
import { ruleContextOf } from "../domain/verified-omission.js"
import { projectDisplayEvidence } from "../../investigation/domain/feedback-display-evidence.js"
import { mentionRoleOf, personMentionRolesOf } from "../../investigation/domain/person-mention-roles.js"
import { summarizeQaDecisionAudit, type QaDecisionRow } from "../../interaction-feedback/application/qa-decision-audit.js"
import { V171F_ASSESSMENT, V171F_COLLABORATOR_NAME, V171F_CONTENT, V171F_DOC_ID, V171F_DOC_TITLE, V171F_OTHER_OPERATOR_NAMES, V171F_PRESENTED, V171F_PUBLISHED, V171F_SUBJECT, V171F_TRANSCRIPT, V171F_WRITER_RAW } from "../testing/contestacao-v171f-smoke-fixture.js"

/**
 * V1.7.1g — BLOQUEADORES FINAIS DA MONITORIA POR FLAG, a partir do smoke REAL da V1.7.1f (saída do especialista e do redator
 * gravadas, sem modelo): papel da pessoa mencionada (cliente homônimo de colega), backfill determinístico da regra da etapa,
 * âncora estruturada da etapa canônica (paráfrase na etapa cumprida e desvio observado na não cumprida) e auditoria de QA.
 */
const RECAP_TURN = "Então, recapitulando, Roberto: abri a contestação das cobranças do Proteção Digital de agosto e setembro e já desativei o serviço. O número do protocolo é 2026 0925 9930."
const display = (quote: string, speaker: string, context: Parameters<typeof projectDisplayEvidence>[2]) => projectDisplayEvidence({ turnRef: "T1", speaker, quote }, { factIndex: 0, evidenceType: "FINDING_EVIDENCE" }, context)
const conversation = V171F_TRANSCRIPT.split("\n").map((line) => line.replace(/^(?:Operador|Cliente):\s*/, ""))
const operatorConversation = V171F_TRANSCRIPT.split("\n").filter((line) => line.startsWith("Operador:")).map((line) => line.replace(/^Operador:\s*/, ""))
const anchorBase = { contentKind: "RULE_CONTENT", documentTitle: V171F_DOC_TITLE, subject: V171F_SUBJECT, conversation, operatorConversation }

describe("V1.7.1g — A/B/C/D) privacidade por PAPEL da pessoa mencionada, não por colisão de nome", () => {
  const roles = personMentionRolesOf(V171F_TRANSCRIPT, V171F_COLLABORATOR_NAME)
  const context = { otherOperatorNames: V171F_OTHER_OPERATOR_NAMES, mentionRoles: roles }

  it("A) cliente 'Roberto' + colegas 'Roberto Serra'/'Roberto Queiroz' → a fala que chama o cliente pelo nome permanece (antes: oculta)", () => {
    expect(roles).toMatchObject({ customerNames: ["roberto"], subjectOperatorNames: ["larissa"], thirdPartyReferencedNames: [] })
    expect(mentionRoleOf("Roberto", roles)).toBe("CUSTOMER")
    expect(display(RECAP_TURN, "OPERADOR", { otherOperatorNames: V171F_OTHER_OPERATOR_NAMES })).toMatchObject({ status: "WITHHELD", reason: "OPERATOR_IDENTITY" })
    expect(display(RECAP_TURN, "OPERADOR", context)).toMatchObject({ status: "DISPLAYED", text: expect.stringContaining("recapitulando, Roberto:") })
    expect(display("Oi, boa tarde. Meu nome é Roberto, sou o titular.", "CLIENTE", context)).toMatchObject({ status: "DISPLAYED" })
  })

  it("B) referência real a OUTRO colaborador continua protegida (inclusive quando o cliente é homônimo) e nome completo de colega sempre", () => {
    const transfer = "Operador: Boa tarde.\nCliente: Oi, aqui é a Carla.\nOperador: Vou transferir você para o Roberto do suporte, tá?"
    const other = personMentionRolesOf(transfer, V171F_COLLABORATOR_NAME)
    expect(mentionRoleOf("Roberto", other)).toBe("OTHER_EMPLOYEE")
    expect(display("Vou transferir você para o Roberto do suporte, tá?", "OPERADOR", { otherOperatorNames: V171F_OTHER_OPERATOR_NAMES, mentionRoles: other })).toMatchObject({ status: "WITHHELD", reason: "OPERATOR_IDENTITY" })
    const homonym = "Operador: Boa tarde.\nCliente: Meu nome é Roberto.\nOperador: Certo, Roberto. Vou passar para o Roberto da retenção."
    const both = personMentionRolesOf(homonym, V171F_COLLABORATOR_NAME)
    expect(mentionRoleOf("Roberto", both)).toBe("OTHER_EMPLOYEE")
    expect(display("Certo, Roberto.", "OPERADOR", { otherOperatorNames: V171F_OTHER_OPERATOR_NAMES, mentionRoles: both })).toMatchObject({ status: "WITHHELD" })
    expect(display("Quem te atendeu antes foi o Roberto Serra.", "OPERADOR", context)).toMatchObject({ status: "WITHHELD", reason: "OPERATOR_IDENTITY" })
  })

  it("C) papel desconhecido + colisão → conservador (protegido); sem papéis calculados → comportamento de sempre", () => {
    const unknown = personMentionRolesOf("Operador: Boa tarde.\nCliente: Oi, quero falar da conta.\nOperador: Então, Roberto, vamos ver.", V171F_COLLABORATOR_NAME)
    expect(mentionRoleOf("Roberto", unknown)).toBe("UNKNOWN_PERSON")
    expect(display("Então, Roberto, vamos ver.", "OPERADOR", { otherOperatorNames: V171F_OTHER_OPERATOR_NAMES, mentionRoles: unknown })).toMatchObject({ status: "WITHHELD" })
    expect(display("Então, Roberto, vamos ver.", "OPERADOR", { otherOperatorNames: V171F_OTHER_OPERATOR_NAMES })).toMatchObject({ status: "WITHHELD" })
  })

  it("D) o operador sujeito nunca é tratado como terceiro (colega homônima só pelo nome completo)", () => {
    const own = personMentionRolesOf("Operador: Conecta, boa tarde, Larissa falando.\nCliente: Oi, Larissa.", V171F_COLLABORATOR_NAME)
    expect(mentionRoleOf("Larissa", own)).toBe("SUBJECT_OPERATOR")
    const colleagues = ["Larissa Souza", ...V171F_OTHER_OPERATOR_NAMES]
    expect(display("Conecta, boa tarde, Larissa falando.", "OPERADOR", { otherOperatorNames: colleagues, mentionRoles: own })).toMatchObject({ status: "DISPLAYED" })
    expect(display("Conecta, boa tarde, Larissa falando.", "OPERADOR", { otherOperatorNames: colleagues })).toMatchObject({ status: "WITHHELD" })
    expect(display("Vou chamar a Larissa Souza.", "OPERADOR", { otherOperatorNames: colleagues, mentionRoles: own })).toMatchObject({ status: "WITHHELD" })
  })
})

describe("V1.7.1g — C/D/E) backfill DETERMINÍSTICO da regra da etapa canônica", () => {
  const backfill = (quote: string, content = V171F_CONTENT) => backfillCheckpointRule({ content, rule: ruleContextOf(content, quote), citedKind: "RULE_CONTENT" })

  it("C) '5. Explicar prazo' → regra da seção 35 do MESMO documento; '6. Orientar sobre conta ajustada' → seção 32 (a 3.5, conceito, não tem regra)", () => {
    expect(backfill("5. Explicar prazo;")).toMatchObject({ audit: { status: "BACKFILLED", objectTerms: ["prazo"], candidateSections: ["Prazo da análise"] }, operativeRule: { quote: "O operador deverá informar o prazo exibido na ferramenta.", heading: "35. Prazo da análise", basis: "CHECKPOINT_RULE_BACKFILL", replaced: "LIST_STEP_WITHOUT_RULE" } })
    expect(backfill("6. Orientar sobre conta ajustada;")).toMatchObject({ audit: { status: "BACKFILLED", candidateSections: ["Conta ajustada"] }, operativeRule: { heading: "32. Conta ajustada", quote: expect.stringMatching(/^O operador deverá informar:\n- Valor original;/) } })
  })

  it("ambíguo não escolhe em silêncio; sem seção dedicada não inventa; texto de lista/abertura não é etapa", () => {
    expect(backfill("2. Registrar contestação;")).toMatchObject({ operativeRule: null, audit: { status: "AMBIGUOUS_SECTION" } })
    expect(backfill("7. Registrar protocolo.")).toMatchObject({ operativeRule: null, audit: { status: "NO_MATCHING_SECTION" } })
    // V1.7.1k — abertura + UM item escolhe o item ("Conta analisada"): sem seção própria, nada é inventado.
    expect(backfill("Antes de encerrar, informar:\n\n- Conta analisada;")).toMatchObject({ operativeRule: null, audit: { status: "NO_MATCHING_SECTION" } })
    // A citação de lista começa por uma linha curta que também existe em outras seções ("- Valor;"): o contexto é o da seção citada.
    expect(ruleContextOf(V171F_CONTENT, "Verificar:\n\n- Nome do serviço;\n- Valor;")).toMatchObject({ heading: "15. Serviços digitais não reconhecidos" })
  })

  it("D) nunca atravessa para outro documento e a regra com proveniência de outro documento/versão é recusada (QA)", () => {
    const withoutDeadline = V171F_CONTENT.replace(/## 35\. Prazo da análise[\s\S]*?(?=## 36\.)/, "")
    expect(backfill("5. Explicar prazo;", withoutDeadline)).toMatchObject({ operativeRule: null, audit: { status: "NO_MATCHING_SECTION" } })
    const knowledge = { documentId: V171F_DOC_ID, documentTitle: V171F_DOC_TITLE, heading: "15. Serviços digitais não reconhecidos", version: 1, quote: "5. Explicar prazo;", applicability: "VERIFIED" as const, href: "/materiais/x" }
    const rule = { quote: "O operador deverá informar o prazo exibido na ferramenta.", heading: "35. Prazo da análise", basis: "CHECKPOINT_RULE_BACKFILL" as const, replaced: "LIST_STEP_WITHOUT_RULE" as const, selection: "CHECKPOINT_RULE_BACKFILL_V1" }
    const item = (operativeRule: Record<string, unknown>) => ({ knowledge: { ...knowledge, operativeRule }, process: null }) as unknown as Pick<ReliableItemDraft, "knowledge" | "process">
    expect(knowledgeQualityBlockers(item({ ...rule, documentId: V171F_DOC_ID, version: 1 }))).toEqual([])
    expect(knowledgeQualityBlockers(item({ ...rule, documentId: "outro-documento", version: 1 }))).toEqual(["KNOWLEDGE_PROVENANCE_INCONSISTENT"])
    expect(knowledgeQualityBlockers(item({ ...rule, documentId: V171F_DOC_ID, version: 2 }))).toEqual(["KNOWLEDGE_PROVENANCE_INCONSISTENT"])
  })

  it("E) EXEMPLO nunca vira regra do backfill (fala-modelo entre aspas, com verbo de obrigação, é ignorada)", () => {
    const content = "# Doc\n\n## 1. Atendimento\n\nSe o cliente pedir:\n\n1. Explicar multa;\n2. Registrar pedido.\n\n## 2. Multa contratual\n\n**Exemplo:**\n\n“O operador deverá informar a multa de R$ 300,00 hoje.”"
    expect(backfill("1. Explicar multa;", content)).toMatchObject({ operativeRule: null, audit: { status: "NO_MATCHING_SECTION" } })
  })
})

describe("V1.7.1g — F/G/H/I) âncora da ETAPA CANÔNICA (sem exigir a mesma palavra; ambíguo continua QA)", () => {
  const cancelRule = ruleContextOf(V171F_CONTENT, "1. Cancelar a recorrência, quando permitido;")
  const deadlineRule = ruleContextOf(V171F_CONTENT, "5. Explicar prazo;")
  const registerRule = ruleContextOf(V171F_CONTENT, "2. Registrar contestação;")

  it("F) FOLLOWED com paráfrase ('desativei o Proteção Digital' × 'Cancelar a recorrência') → VERIFIED pela escolha da etapa canônica", () => {
    const anchor = structuredAnchorOf({ ...anchorBase, status: "FOLLOWED", rule: cancelRule, citedQuote: "1. Cancelar a recorrência, quando permitido;", operatorEvidence: [{ turnRef: "T17", text: "Posso já tirar esse serviço da sua linha pra parar de cobrar. Quer que eu faça isso?" }, { turnRef: "T19", text: "Feito, desativei o Proteção Digital agora." }] })
    expect(anchor).toMatchObject({ anchored: true, basis: "CHECKPOINT_SELECTION", checkpoint: { heading: "15. Serviços digitais não reconhecidos", stepPosition: 1, stepText: "Cancelar a recorrência, quando permitido" }, proof: { processAnchor: "SUBJECT", otherStepStems: [] } })
    expect(anchor.checkpoint!.identity).toMatch(/^CP:[0-9a-f]{16}$/)
  })

  it("G) NOT_FOLLOWED com ação observada ('aí é aguardar' × 'Explicar prazo') → VERIFIED pelo desvio observado", () => {
    expect(structuredAnchorOf({ ...anchorBase, status: "NOT_FOLLOWED", declaredEvidenceType: "OBSERVED", rule: deadlineRule, citedQuote: "5. Explicar prazo;", operatorEvidence: [{ turnRef: "T23", text: "Não sei te dizer certinho, agora fica com o pessoal da análise, aí é aguardar que eles resolvem." }] })).toMatchObject({ anchored: true, basis: "OBSERVED_DEVIATION", proof: { stepTermsInSpeech: [] } })
  })

  it("H) omissão NÃO usa este caminho (segue a omissão verificada, mais forte)", () => {
    expect(structuredAnchorOf({ ...anchorBase, status: "NOT_FOLLOWED", declaredEvidenceType: "OMISSION", rule: deadlineRule, citedQuote: "5. Explicar prazo;", operatorEvidence: [{ turnRef: "T25", text: RECAP_TURN }] })).toMatchObject({ anchored: false, failure: "OMISSION_PATH" })
  })

  it("I) ambíguo continua QA: outra etapa na fala, etapa condicional não cumprida, termo da etapa dito em outro momento, várias etapas citadas", () => {
    const deviation = { ...anchorBase, status: "NOT_FOLLOWED", declaredEvidenceType: "OBSERVED" }
    expect(structuredAnchorOf({ ...anchorBase, status: "FOLLOWED", rule: registerRule, citedQuote: "2. Registrar contestação;", operatorEvidence: [{ turnRef: "T19", text: "Feito, cancelei a assinatura agora." }] })).toMatchObject({ anchored: false, failure: "OBJECT_MISMATCH" })
    expect(structuredAnchorOf({ ...anchorBase, status: "FOLLOWED", rule: registerRule, citedQuote: "2. Registrar contestação;", operatorEvidence: [{ turnRef: "T19", text: "Feito, cancelei tudo e já analisei aqui." }] })).toMatchObject({ anchored: false, failure: "ACTION_NOT_RELATED" })
    // V1.7.1j — conflito com OUTRA etapa exige ação + objeto dela ("cancelei a renovação" = etapa 1), não o verbo solto.
    expect(structuredAnchorOf({ ...anchorBase, status: "FOLLOWED", rule: registerRule, citedQuote: "2. Registrar contestação;", operatorEvidence: [{ turnRef: "T19", text: "Registrei a contestação e cancelei a recorrência." }] })).toMatchObject({ anchored: true, basis: "ACTION_STEP" })
    expect(structuredAnchorOf({ ...deviation, rule: cancelRule, citedQuote: "1. Cancelar a recorrência, quando permitido;", operatorEvidence: [{ turnRef: "T19", text: "Isso eu não consigo fazer." }] })).toMatchObject({ anchored: false, failure: "CONDITIONAL_STEP" })
    expect(structuredAnchorOf({ ...deviation, rule: deadlineRule, citedQuote: "5. Explicar prazo;", operatorEvidence: [{ turnRef: "T23", text: "Aí é aguardar." }], operatorConversation: [...operatorConversation, "O prazo da análise é de até cinco dias úteis."] })).toMatchObject({ anchored: false, failure: "STEP_TERMS_IN_OPERATOR_SPEECH", proof: { stepTermsInSpeech: ["prazo"] } })
    expect(structuredAnchorOf({ ...anchorBase, status: "FOLLOWED", rule: registerRule, citedQuote: "2. Registrar contestação;\n3. Analisar valores atuais e anteriores elegíveis;", operatorEvidence: [{ turnRef: "T15", text: "Vou registrar a contestação." }] })).toMatchObject({ anchored: false, failure: "MULTIPLE_CHECKPOINTS" })
  })

  it("I) a MESMA etapa canônica escolhida como cumprida e não cumprida → nenhuma fica verificada só pela estrutura", () => {
    const assessment = JSON.parse(JSON.stringify(V171F_ASSESSMENT)) as { processes: { checkpoints: Record<string, unknown>[] }[] }
    const cancel = assessment.processes[0]!.checkpoints.find((checkpoint) => /Cancelar/.test(String(checkpoint.requirement)))!
    assessment.processes[0]!.checkpoints.push({ ...cancel, requirement: "Cancelar a recorrência (repetida)", status: "NOT_FOLLOWED", evidenceType: "OBSERVED", transcriptEvidence: ["Operador: Feito, desativei o Proteção Digital agora."] })
    const verified = verifyProcessAssessments({ sources: [{ sourceRef: "S", assessment: assessment as never, presented: V171F_PRESENTED }], interactionId: "i", transcript: V171F_TRANSCRIPT, published: V171F_PUBLISHED, subject: V171F_SUBJECT })
    const cancels = verified.checkpoints.filter((checkpoint) => /Cancelar/.test(checkpoint.requirement))
    // A cumprida perdia só para a estrutura; a não cumprida (condicional) nunca foi verificada — nenhuma das duas fica VERIFIED.
    expect(cancels.map((checkpoint) => [checkpoint.knowledge?.applicability, checkpoint.knowledge?.structuredAnchor?.failure])).toEqual([["LITERAL_ONLY", "CHECKPOINT_CONFLICT"], ["LITERAL_ONLY", "CONDITIONAL_STEP"]])
  })
})

describe("V1.7.1g — J) auditoria (somente leitura) das decisões de QA", () => {
  const row = (overrides: Partial<QaDecisionRow>): QaDecisionRow => ({ origin: "WORKFLOW", reviewId: "r", artifactId: "a", itemIndex: 0, decision: "APPROVED_UNCHANGED", reviewedAt: new Date("2026-09-25T21:10:04Z"), reviewerId: "u", reviewerName: "Revisor", reasonCategory: null, hasComment: false, edited: false, enrollmentId: "e", workflowName: "W", resolvedEventAt: null, auditLogCount: 0, ...overrides })
  it("reconstrói quem decidiu o quê, em ordem, e declara as lacunas de auditabilidade (sem audit log, sessão, request, endpoint, origem)", () => {
    const report = summarizeQaDecisionAudit([row({ reviewId: "r2", reviewedAt: new Date("2026-09-25T21:11:02Z"), decision: "REJECTED", reasonCategory: "OTHER", resolvedEventAt: new Date("2026-09-25T21:11:02Z") }), row({ reviewId: "r1" })], { from: "a", to: "b" })
    expect(report.decisions.map((decision) => decision.reviewId)).toEqual(["r1", "r2"])
    expect(report.totals).toEqual({ decisions: 2, byDecision: { APPROVED_UNCHANGED: 1, REJECTED: 1 }, byReviewer: { Revisor: 2 }, artifactsClosed: 1 })
    expect(report.explicitHumanSignals).toEqual(["REJECTED_WITH_REASON:r2"])
    expect(report.gaps).toEqual(["NO_AUDIT_LOG", "NO_SESSION_ID", "NO_REQUEST_ID", "NO_ENDPOINT", "NO_CLIENT_ORIGIN"])
    expect(summarizeQaDecisionAudit([row({ auditLogCount: 1 })], { from: "a", to: "b" }).gaps).not.toContain("NO_AUDIT_LOG")
  })
})

/** Redator falso = a resposta REAL do smoke V1.7.1f, entregue pelo conteúdo da etapa (itens novos não tinham texto do redator). */
function smokeWriter(): ReliableFeedbackWriterPort {
  const map: [RegExp, number][] = [[/Explicar prazo/i, 0], [/Verificar nome/i, 1], [/Registrar contesta/i, 2], [/Confirma/i, 3], [/Cancelar/i, 4], [/protocolo/i, 5]]
  return {
    writeMonitoring: async (input) => ({ rawOutput: { items: input.items.flatMap((item) => { const hit = map.find(([pattern]) => pattern.test(item.requirement ?? "")); return hit ? [{ ...V171F_WRITER_RAW.items[hit[1]]!, slot: item.slot }] : [] }), presentation: V171F_WRITER_RAW.presentation } }),
    writeIndicator: async () => { throw new Error("não usado") },
  }
}
async function replay() {
  const deps: ReliableGenerationDeps = {
    enabled: true, store: createInMemoryReliableFeedbackStore({ onReactivate: () => true }), writer: smokeWriter(), policy: RELIABLE_FEEDBACK_AUTONOMOUS_POLICY,
    loadMonitoringContext: async () => ({ transcript: V171F_TRANSCRIPT, label: `Atendimento de 25/09/2026 · ${V171F_SUBJECT}`, otherOperatorNames: V171F_OTHER_OPERATOR_NAMES, subjectOperatorName: V171F_COLLABORATOR_NAME }),
    loadIndicatorContext: async () => null, loadPublishedKnowledge: async () => V171F_PUBLISHED, loadIndicatorDiagnosisPlan: async () => null,
    loadPeerPracticeData: async () => ({ peers: [], observations: [] }), resolveDiagnosticStrategy: async () => null,
    loadRecipient: async () => ({ firstName: "Larissa" }), now: () => new Date("2026-09-25T21:13:00Z"),
  }
  const source = { kind: "monitoring", knowledgeExcerpts: V171F_PRESENTED, input: { organizationId: "org-g", operatorId: "op-g", interactionId: "int-g", structured: { evidenceFound: "x", observedBehavior: "o", relatedProcedure: V171F_DOC_TITLE, recommendation: "r", processAssessment: JSON.parse(JSON.stringify(V171F_ASSESSMENT)) } } }
  const request: ReliableGenerationRequest = { organizationId: "org-g", enrollmentId: "enr-v171f", workflowId: "wf", workflowVersionId: "v", nodeId: "gerar", sourceNodeId: "orq", sourceType: "AGENT", domain: "MONITORING", sourceNodeOutput: source, collaboratorId: "op-g", interactionId: "int-g", indicatorMeasurementId: null, configuredAgentId: null }
  const result = await generateReliableFeedback(deps, request)
  const artifact = result.record.artifact!
  const byStep = (pattern: RegExp) => artifact.items.find((item) => pattern.test(item.process?.requirement ?? ""))!
  const approved = nodeOutputOf(result.record.id, artifact, artifact.items.map((item) => ({ itemIndex: item.index, status: "APPROVED_UNCHANGED" as const, finalWording: null })))
  return { artifact, byStep, text: approved.text }
}

describe("V1.7.1g — fixture do smoke REAL da V1.7.1f (§10): QA volta a ser exceção, sem afrouxar nada", () => {
  it("recapitulação volta ao feedback; prazo com a regra concreta; cancelamento e protocolo autônomos; exemplo continua bloqueado", async () => {
    const { artifact, byStep, text } = await replay()
    // Antes: recapitulação e conta ajustada BLOQUEADAS (colisão cliente × colega); cancelamento, protocolo e prazo em QA por âncora.
    // V1.7.1h — o prazo não vai mais ao QA só pelo exemplo inválido (degradação por campo): 6 prontos, 2 em QA.
    // V1.7.1k — a lista "Verificar" também sai do QA (texto do sistema só com os itens reconhecidos na fala): 7 prontos, 1 em QA.
    expect(artifact.findings).toMatchObject({ detected: 8, reliable: 8, blocked: 0, heldForQa: 1, inFeedback: 7 })
    const recap = byStep(/Recapitula/i)
    expect(recap).toMatchObject({ section: "OPPORTUNITY", decision: { structural: "STRUCTURALLY_EMITTABLE" }, facts: [{ role: "OPERADOR", text: expect.stringContaining("recapitulando, Roberto:") }] })
    // Recapitulação parcial (V1.7.1i — etapa COMPOSTA): texto do sistema com só os itens observados e os verificadamente ausentes.
    expect(recap).toMatchObject({ wordingSource: "SYSTEM", process: { completeness: { status: "PARTIAL", absent: ["prazo", "canal de retorno"], elsewhere: ["conta analisada", "valor"] } }, decision: { disposition: "READY" } })
    expect(recap.proposedWording!.observed).toBe("Em “Recapitulação obrigatória”, você fez parte do que o procedimento prevê, incluindo “Lançamento contestado”, “Ação realizada”, “Serviço cancelado” e “Protocolo”, mas não todos os itens previstos. Nesta chamada não apareceram “Prazo” e “Canal de retorno”. “Conta ajustada” e “Valor a pagar” não se aplicavam neste momento, porque o resultado ainda estava pendente.")
    const deadline = byStep(/Explicar prazo/)
    expect(deadline).toMatchObject({ knowledge: { applicability: "VERIFIED", applicabilityBasis: "STRUCTURED_ANCHOR", structuredAnchorBasis: "OBSERVED_DEVIATION", operativeRule: { quote: "O operador deverá informar o prazo exibido na ferramenta.", heading: "35. Prazo da análise", basis: "CHECKPOINT_RULE_BACKFILL", documentId: V171F_DOC_ID, version: 1 } } })
    // O redator do smoke inventou "5 dias úteis" (só existe no EXEMPLO da seção 35) no exemplo de condução: continua recusado —
    // V1.7.1h: só o exemplo sai; diagnóstico, relevância e "Como aplicar" do redator ficam; o item segue sem QA.
    expect(deadline).toMatchObject({ wordingSource: "WRITER", writerViolations: [], writerFieldValidation: expect.arrayContaining([{ field: "suggestedResponse", codes: ["EXAMPLE_CONTENT_AS_FACT"], action: "DROPPED" }]), decision: { disposition: "READY", reasons: ["AUTONOMY_CRITERIA_MET"] } })
    expect(deadline.proposedWording).toEqual({ observed: V171F_WRITER_RAW.items[0]!.observed, whyItMatters: V171F_WRITER_RAW.items[0]!.whyItMatters, whatYouCanDo: V171F_WRITER_RAW.items[0]!.whatYouCanDo })
    expect(byStep(/Cancelar/)).toMatchObject({ knowledge: { structuredAnchorBasis: "CHECKPOINT_SELECTION" }, wordingSource: "WRITER", decision: { disposition: "READY", reasons: ["AUTONOMY_CRITERIA_MET"] } })
    expect(byStep(/protocolo/i)).toMatchObject({ knowledge: { structuredAnchorBasis: "CHECKPOINT_SELECTION" }, decision: { disposition: "READY" } })
    // Omissão proposta continua no caminho forte: não verificada → QA (e agora com a regra da seção 32 no "Como aplicar").
    expect(byStep(/conta ajustada/)).toMatchObject({ process: { evidenceType: "UNVERIFIED_OMISSION" }, knowledge: { applicability: "LITERAL_ONLY", operativeRule: { heading: "32. Conta ajustada" } }, decision: { disposition: "HOLD_FOR_QA", reasons: expect.arrayContaining(["KNOWLEDGE_APPLICABILITY_UNVERIFIED"]) } })
    expect(text).toContain("### Recapitulação obrigatória")
    expect(text).toContain("_Seção “Prazo da análise”:_ “O operador deverá informar o prazo exibido na ferramenta.”")
    expect(text).not.toMatch(/SMS|5 dias|cinco dias|explique prazo/)
  })
})
