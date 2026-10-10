import { describe, expect, it } from "vitest"
import { assessConduct, prerequisiteSkipOf, requiredConductOf, semanticConductAnchorOf } from "../domain/evidence-conduct.js"
import { isConditionalStepText, primaryObligationOf, stepSemanticsOf } from "../domain/step-semantics.js"
import { isConditionalStep } from "../domain/verified-omission.js"
import { verifyProcessAssessments, type PresentedKnowledgeExcerpt } from "../domain/process-assessment.js"
import { buildProcessCheckpointCatalog } from "../domain/checkpoint-catalog.js"
import { chunkKnowledgeDocument } from "../../knowledge/domain/knowledge-chunking.js"
import { cleanSectionHeading, itemTopicLabelOf, stepTitleOf } from "../domain/process-items.js"
import { uncoveredCommittedActions } from "../domain/suggested-response.js"
import type { RawProcessAssessment } from "../../agents/domain/process-assessment-contract.js"

/**
 * V1.7.4 — SEMANTIC EVIDENCE CORRECTION (Golden Demo "Argumentário"): a evidência precisa sustentar a CONDUTA da etapa; a etapa é
 * lida por ESTRUTURA (condicionalidade e precedência), nunca por palavra solta; paráfrase só com papel + relação + objeto.
 * Casos genéricos (A–E do pedido) + a verificação completa com uma base e transcrições sintéticas.
 */
const operator = (turnRef: string, text: string) => ({ turnRef, text })

describe("A) resultado afirmado não prova a verificação", () => {
  it("'verificar/avaliar se está disponível' × 'está disponível' → não é ACTION_PERFORMED", () => {
    const conduct = assessConduct({ stepText: "Avaliar se a funcionalidade de informe de pagamento está disponível para o cliente.", status: "FOLLOWED", evidenceType: "OBSERVED", evidence: [operator("T7", "É só você informar o pagamento pelo aplicativo, essa opção está disponível pra você, sim.")], operatorTurns: [operator("T7", "É só você informar o pagamento pelo aplicativo, essa opção está disponível pra você, sim.")] })
    expect(conduct).toMatchObject({ required: "CONDITION_CHECK", verdict: "MISMATCH", failure: "ASSERTED_RESULT_IS_NOT_VALIDATION" })
  })
  it("o ato de checagem na fala citada sustenta a conduta ('vou verificar…', 'verifiquei')", () => {
    const evidence = [operator("T9", "Antes de te passar qualquer caminho, eu vou verificar se a opção de informar o pagamento está liberada pra sua linha."), operator("T11", "Pronto, verifiquei. No seu caso essa opção está disponível.")]
    expect(assessConduct({ stepText: "Avaliar se a funcionalidade de informe de pagamento está disponível para o cliente.", status: "FOLLOWED", evidenceType: "OBSERVED", evidence, operatorTurns: evidence })).toMatchObject({ verdict: "SUPPORTED", cues: { checkActTurns: ["T9", "T11"] } })
  })
  it("'você pode verificar no app' é orientação ao cliente, não checagem do operador", () => {
    const evidence = [operator("T5", "Você pode verificar no aplicativo se a opção está disponível.")]
    expect(assessConduct({ stepText: "Verificar se a opção está disponível para o cliente.", status: "FOLLOWED", evidenceType: "OBSERVED", evidence, operatorTurns: evidence }).verdict).toBe("MISMATCH")
  })
  it("mesmos substantivos + ação errada → não verifica (mesmo rigor no ponto de desenvolvimento)", () => {
    // Ponto forte: substantivos da regra (pagamento, aplicativo, disponível) sem o verbo da etapa.
    const same = [operator("T3", "O pagamento pelo aplicativo está disponível, pode fazer.")]
    expect(assessConduct({ stepText: "Verificar se o pagamento pelo aplicativo está disponível.", status: "FOLLOWED", evidenceType: "OBSERVED", evidence: same, operatorTurns: same }).verdict).toBe("MISMATCH")
    // Ponto de desenvolvimento: "não cumprida" citando justamente a checagem feita.
    const check = [operator("T3", "Deixa eu verificar se o pagamento pelo aplicativo está disponível pra você.")]
    expect(assessConduct({ stepText: "Verificar se o pagamento pelo aplicativo está disponível.", status: "NOT_FOLLOWED", evidenceType: "OBSERVED", evidence: check, operatorTurns: check })).toMatchObject({ verdict: "MISMATCH", failure: "EVIDENCE_ACTION_MISMATCH" })
  })
})

describe("proibições: abstenção explícita × ausência de falha", () => {
  const step = "Não prometer desbloqueio imediato."
  it("cumprida só com abstenção explícita; não ter prometido não é ponto forte", () => {
    const abstention = [operator("T13", "Isso eu não consigo te prometer, e eu não tenho como garantir que o desbloqueio seja imediato.")]
    expect(assessConduct({ stepText: step, status: "FOLLOWED", evidenceType: "OBSERVED", evidence: abstention, operatorTurns: abstention }).verdict).toBe("SUPPORTED")
    const neutral = [operator("T13", "Depois que você informar, a solicitação segue o processamento normal.")]
    expect(assessConduct({ stepText: step, status: "FOLLOWED", evidenceType: "OBSERVED", evidence: neutral, operatorTurns: neutral })).toMatchObject({ verdict: "MISMATCH", failure: "PROHIBITION_COMPLIANCE_NOT_PROVEN" })
  })
  it("descumprida só quando a fala FAZ o proibido; a abstenção citada contradiz a acusação", () => {
    const promise = [operator("T9", "Assim que você informar o pagamento no aplicativo, o desbloqueio é imediato, volta na hora.")]
    expect(assessConduct({ stepText: step, status: "NOT_FOLLOWED", evidenceType: "OBSERVED", evidence: promise, operatorTurns: promise }).verdict).toBe("SUPPORTED")
    const abstention = [operator("T9", "Eu não consigo te garantir que o desbloqueio seja imediato.")]
    expect(assessConduct({ stepText: step, status: "NOT_FOLLOWED", evidenceType: "OBSERVED", evidence: abstention, operatorTurns: abstention })).toMatchObject({ verdict: "MISMATCH", failure: "EVIDENCE_ACTION_MISMATCH" })
  })
  it("'…sem realizar as validações': a acusação cai se houve checagem antes da fala", () => {
    const stepText = "Não afirmar que a falta de conexão está relacionada ao fim da franquia sem realizar as validações cabíveis."
    const claim = operator("T9", "Isso é porque a sua franquia acabou.")
    expect(assessConduct({ stepText, status: "NOT_FOLLOWED", evidenceType: "OBSERVED", evidence: [claim], operatorTurns: [operator("T5", "A linha está no seu nome?"), claim] }).verdict).toBe("SUPPORTED")
    expect(assessConduct({ stepText, status: "NOT_FOLLOWED", evidenceType: "OBSERVED", evidence: [claim], operatorTurns: [operator("T5", "Vou consultar as informações da sua linha."), claim] }).failure).toBe("EVIDENCE_ACTION_MISMATCH")
  })
})

describe("B/C) condicionalidade por estrutura, nunca por palavra solta", () => {
  it("B) 'confirmar se é fatura ou parcelamento' é seletor de ramo: obrigatória", () => {
    const step = "Confirmar se a solicitação é de segunda via da fatura ou do parcelamento antes de orientar o acesso pelo aplicativo."
    expect(isConditionalStep(step)).toBe(false)
    expect(stepSemanticsOf(step)).toMatchObject({ obligatory: true, successors: ["orientar o acesso pelo aplicativo"] })
    expect(stepSemanticsOf(step).primary?.branchSelector).toBe(true)
    expect(requiredConductOf(step).required).toBe("CONDITION_CHECK")
  })
  it("C) 'se houver reparo, orientar o acompanhamento' é condicional; o suporte antes continua obrigatório", () => {
    expect(isConditionalStepText("Se houver abertura de reparo, orientar o acompanhamento pelo aplicativo.")).toBe(true)
    const step = "Realizar o suporte conforme o fluxo aplicável. Caso seja necessário abrir reparo, informar que o status poderá ser acompanhado pelo aplicativo."
    expect(isConditionalStep(step)).toBe(false)
    expect(primaryObligationOf(step)).toBe("Realizar o suporte conforme o fluxo aplicável")
    expect(stepSemanticsOf(step).clauses.map((clause) => clause.conditional)).toEqual([false, true])
  })
  it("mantém o que já era condicional (condição final sem coordenação) e trata conteúdo e coordenação", () => {
    expect(isConditionalStep("Cancelar a recorrência, quando permitido;")).toBe(true)
    expect(isConditionalStep("Ativar bloqueio preventivo, se disponível e autorizado;")).toBe(true)
    expect(isConditionalStep("serviço cancelado, quando aplicável")).toBe(true)
    expect(isConditionalStep("Explicar prazo;")).toBe(false)
    expect(isConditionalStep("Informar que, quando a opção estiver disponível, o pagamento pode ser feito com cartão.")).toBe(false)
    expect(isConditionalStep("Indicar o canal para consultar os débitos e verificar opções de parcelamento, caso necessário.")).toBe(false)
    expect(isConditionalStep("Certificar-se de que o cliente entendeu.")).toBe(false)
  })
})

describe("etapa pulada observada ('X antes de Y': Y feito sem X)", () => {
  const turns = [operator("T1", "Boa tarde, com quem eu falo?"), operator("T3", "Em que posso ajudar?"), operator("T5", "A linha está no seu nome?"), operator("T7", "A segunda via você baixa pelo aplicativo, na parte de faturas.")]
  it("prova quando a fala citada realiza Y e nada antes dela realiza X", () => {
    expect(prerequisiteSkipOf({ stepText: "Confirmar se a solicitação é de segunda via da fatura ou do parcelamento antes de orientar o acesso pelo aplicativo.", evidence: [turns[3]!], operatorTurns: turns, contextTexts: [] })).toMatchObject({ proven: true, successorTurns: ["T7"] })
  })
  it("não prova quando X aconteceu antes (pergunta sobre fatura × parcelamento)", () => {
    const asked = [...turns.slice(0, 3), operator("T5", "Você precisa da segunda via da fatura ou do parcelamento?"), turns[3]!]
    expect(prerequisiteSkipOf({ stepText: "Confirmar se a solicitação é de segunda via da fatura ou do parcelamento antes de orientar o acesso pelo aplicativo.", evidence: [turns[3]!], operatorTurns: asked, contextTexts: [] })).toMatchObject({ proven: false, failure: "OBLIGATION_TERMS_BEFORE" })
  })
  it("não prova quando houve ato de checagem antes (o suporte pode ter acontecido)", () => {
    const supported = [operator("T3", "Vou verificar a sua conexão."), operator("T7", "Abra o reparo pelo aplicativo e acompanhe por lá.")]
    expect(prerequisiteSkipOf({ stepText: "Realizar o suporte conforme o fluxo aplicável. Caso seja necessário abrir reparo, informar que o status poderá ser acompanhado pelo aplicativo.", evidence: [supported[1]!], operatorTurns: supported, contextTexts: [] })).toMatchObject({ proven: false, failure: "CHECK_ACT_BEFORE" })
  })
})

describe("D/E) paráfrase: papel + relação declarada + objeto, nunca só sobreposição léxica", () => {
  const stepText = "Não prometer prazo ou solução sem respaldo."
  const evidence = [operator("T9", "Com certeza. Abriu pelo aplicativo, amanhã até o meio-dia está resolvido.")]
  it("D) paráfrase equivalente com pouca sobreposição: verifica (prazo concreto × 'prazo')", () => {
    const conduct = assessConduct({ stepText, status: "NOT_FOLLOWED", evidenceType: "OBSERVED", evidence, operatorTurns: evidence, declared: { role: "PROMISE_MADE", relation: "EQUIVALENT" } })
    expect(semanticConductAnchorOf({ conduct, stepText, evidence })).toMatchObject({ anchored: true, objectClasses: ["DEADLINE"] })
  })
  it("E) sem relação declarada, relação INFERRED ou objeto em comum ausente: não verifica", () => {
    const undeclared = assessConduct({ stepText, status: "NOT_FOLLOWED", evidenceType: "OBSERVED", evidence, operatorTurns: evidence })
    expect(semanticConductAnchorOf({ conduct: undeclared, stepText, evidence }).anchored).toBe(false)
    const inferred = assessConduct({ stepText, status: "NOT_FOLLOWED", evidenceType: "OBSERVED", evidence, operatorTurns: evidence, declared: { role: "PROMISE_MADE", relation: "INFERRED" } })
    expect(inferred).toMatchObject({ verdict: "MISMATCH", failure: "DECLARED_RELATION_INCOMPATIBLE" })
    // Descumprimento: a fala mostra a conduta CONTRÁRIA — DIFFERENT é a relação correta (achado real da Golden Demo V1.7.4).
    const different = assessConduct({ stepText, status: "NOT_FOLLOWED", evidenceType: "OBSERVED", evidence, operatorTurns: evidence, declared: { role: "PROMISE_MADE", relation: "DIFFERENT" } })
    expect(different.verdict).toBe("SUPPORTED")
    expect(semanticConductAnchorOf({ conduct: different, stepText, evidence }).anchored).toBe(true)
    // Cumprida com fala de outra conduta nunca se sustenta.
    const followedDifferent = assessConduct({ stepText: "Orientar o acompanhamento do consumo pelo aplicativo.", status: "FOLLOWED", evidenceType: "OBSERVED", evidence, operatorTurns: evidence, declared: { role: "INFORMATION_PROVIDED", relation: "DIFFERENT" } })
    expect(followedDifferent.failure).toBe("DECLARED_RELATION_INCOMPATIBLE")
    const unrelated = [operator("T9", "Pode ficar tranquila, o técnico é muito bom.")]
    const conduct = assessConduct({ stepText, status: "NOT_FOLLOWED", evidenceType: "OBSERVED", evidence: unrelated, operatorTurns: unrelated, declared: { role: "PROMISE_MADE", relation: "EQUIVALENT" } })
    expect(semanticConductAnchorOf({ conduct, stepText, evidence: unrelated })).toMatchObject({ anchored: false, reason: "NO_SHARED_OBJECT" })
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// Verificação completa (base + transcrição sintéticas; o motor é o de produção)
// ---------------------------------------------------------------------------------------------------------------------
const DOCUMENT = { documentId: "doc-arg", title: "Guia de Abordagem | Atendimento", version: 1, content: [
  "# Guia de Abordagem | Atendimento",
  "## CEN-01 · Informe de pagamento",
  "Condição / gatilho: o cliente está bloqueado e já pagou.",
  "Orientação ao operador:",
  "- Avaliar se a funcionalidade de informe de pagamento está disponível para o cliente. Em caso positivo, orientar que a solicitação pode ser realizada pelo aplicativo.",
  "Atenção / frases a evitar:",
  "- Não prometer desbloqueio imediato.",
  "## CEN-02 · Segunda via",
  "Ponto obrigatório na fala:",
  "- Confirmar se a solicitação é de segunda via da fatura ou do parcelamento antes de orientar o acesso pelo aplicativo.",
].join("\n") }
const published = new Map([[DOCUMENT.documentId, DOCUMENT]])
const presented: PresentedKnowledgeExcerpt[] = chunkKnowledgeDocument({ id: DOCUMENT.documentId, title: DOCUMENT.title, content: DOCUMENT.content }).map((chunk) => ({ documentId: chunk.documentId, documentTitle: chunk.documentTitle, heading: chunk.heading, excerpt: chunk.text, chunkIndex: chunk.index }))
const catalog = buildProcessCheckpointCatalog({ excerpts: presented, contentOf: () => DOCUMENT.content, subject: null, coveragePlan: false })
const refOf = (text: string) => catalog.entries.find((entry) => entry.stepText.startsWith(text))!.ref
const checkpoint = (ref: string, status: "FOLLOWED" | "NOT_FOLLOWED", evidenceType: "OBSERVED" | "OMISSION", evidence: string[], extra: Record<string, unknown> = {}) => ({ checkpointRef: ref, requirement: "x", status, evidenceType, transcriptEvidence: evidence, knowledgeQuote: null, knowledgeDetailQuote: null, guidance: { source: "OFFICIAL_PROCEDURE" as const, text: null }, uncertainty: null, ...extra })
const verify = (transcript: string, checkpoints: RawProcessAssessment["processes"][number]["checkpoints"]) => verifyProcessAssessments({ sources: [{ sourceRef: "agent", assessment: { processes: [{ documentTitle: DOCUMENT.title, checkpoints }], validation: { contractVersion: "PROCESS_ASSESSMENT_MODEL_CONTRACT_V4", completeness: "COMPLETE", invalidItems: [], normalizations: [], checkpointCapacity: [] } }, presented }], interactionId: "i-1", transcript, published })

describe("verificação completa — P0, gaps condicionais e fala compartilhada", () => {
  it("P0: 'essa opção está disponível' nunca vira 'você verificou a disponibilidade' (nem observação analítica)", () => {
    const transcript = ["Operador: Boa tarde, com quem eu falo?", "Cliente: Aqui é a Rosa. Minha linha foi bloqueada e eu já paguei.", "Operador: É só você informar o pagamento pelo aplicativo, essa opção está disponível pra você, sim.", "Cliente: E volta quando?", "Operador: Assim que você informar, o desbloqueio é imediato, volta na hora."].join("\n")
    const result = verify(transcript, [
      checkpoint(refOf("Avaliar se a funcionalidade"), "FOLLOWED", "OBSERVED", ["Operador: É só você informar o pagamento pelo aplicativo, essa opção está disponível pra você, sim."]),
      checkpoint(refOf("Não prometer"), "NOT_FOLLOWED", "OBSERVED", ["Operador: Assim que você informar, o desbloqueio é imediato, volta na hora."]),
    ])
    const [avaliar, prometer] = result.checkpoints
    expect(avaliar).toMatchObject({ status: "NOT_OBSERVABLE", statusDowngradeReason: "EVIDENCE_ACTION_MISMATCH", conduct: { failure: "ASSERTED_RESULT_IS_NOT_VALIDATION" } })
    expect(prometer).toMatchObject({ status: "NOT_FOLLOWED", knowledge: { applicability: "VERIFIED" } })
  })
  it("gap 'confirmar se…' proposto como OMISSÃO não é descartado por conter 'se': vira etapa pulada observada", () => {
    const transcript = ["Operador: Boa tarde, com quem eu falo?", "Cliente: Aqui é a Paula. Fiz um parcelamento e preciso da segunda via.", "Operador: A linha está no seu nome?", "Cliente: Está.", "Operador: A segunda via você baixa pelo aplicativo, na parte de faturas.", "Cliente: Tá bom, obrigada."].join("\n")
    const result = verify(transcript, [checkpoint(refOf("Confirmar se a solicitação"), "NOT_FOLLOWED", "OMISSION", ["Operador: A segunda via você baixa pelo aplicativo, na parte de faturas."])])
    expect(result.checkpoints[0]).toMatchObject({ status: "NOT_FOLLOWED", evidenceType: "OBSERVED_ACTION", omission: null, prerequisite: { proven: true }, knowledge: { applicability: "VERIFIED", structuredAnchor: { basis: "PREREQUISITE_SKIPPED" } } })
  })
  it("a mesma fala que prova a violação na mesma seção não sustenta ponto forte", () => {
    const transcript = ["Operador: Boa tarde.", "Cliente: Minha linha foi bloqueada e eu já paguei.", "Operador: Informe o pagamento pelo aplicativo, que o desbloqueio é imediato, volta na hora.", "Cliente: Obrigada."].join("\n")
    const line = "Operador: Informe o pagamento pelo aplicativo, que o desbloqueio é imediato, volta na hora."
    const result = verify(transcript, [
      checkpoint(refOf("Avaliar se a funcionalidade"), "FOLLOWED", "OBSERVED", [line], { conductEvidence: { role: "ACTION_PERFORMED", relation: "EQUIVALENT" } }),
      checkpoint(refOf("Não prometer"), "NOT_FOLLOWED", "OBSERVED", [line]),
    ])
    expect(result.checkpoints.map((entry) => [entry.status, entry.statusDowngradeReason])).toEqual([["NOT_OBSERVABLE", "EVIDENCE_ACTION_MISMATCH"], ["NOT_FOLLOWED", null]])
  })
})

describe("linguagem para o operador", () => {
  it("código interno da base nunca vira título; fragmento pendurado não é nome da etapa", () => {
    expect(cleanSectionHeading("ARG-001 · Negociação")).toBe("Negociação")
    expect(cleanSectionHeading("35. Prazo da análise")).toBe("Prazo da análise")
    expect(stepTitleOf("x", null, "ARG-006 · Reparo móvel", "Informar que o consumo da franquia pode ser acompanhado pelo aplicativo e que, caso precise, o cliente pode comprar um pacote")).toBeNull()
  })
  it("item com rótulo próprio vira o assunto ('Promessas'); abertura de lista nunca é rótulo; nota longa do título sai", () => {
    expect(itemTopicLabelOf("4. Promessas: Não garanta desbloqueio imediato, prazo, parcelamento, aprovação ou solução quando essas condições dependerem de validação.")).toBe("Promessas")
    expect(itemTopicLabelOf("3. Validação prévia: Sempre valide disponibilidade antes de oferecer.")).toBe("Validação prévia")
    expect(itemTopicLabelOf("Antes de encerrar, informar: lançamento contestado; ação realizada")).toBeNull()
    expect(itemTopicLabelOf("Perguntar: se a conta já foi paga")).toBeNull()
    expect(cleanSectionHeading("Orientações para uso do argumentário (diretrizes transversais — valem para todos os atendimentos)")).toBe("Orientações para uso do argumentário")
  })
  it("exemplo de condução não promete ação que a regra não cobre (verbos de fala são a própria condução)", () => {
    expect(uncoveredCommittedActions("Débora, vou verificar agora no sistema as opções de parcelamento.", ["Não garantir condições, quantidade de parcelas ou aprovação antes da consulta."])).toEqual(["verificar"])
    expect(uncoveredCommittedActions("Vou te informar o prazo exibido na ferramenta.", ["O operador deverá informar o prazo exibido na ferramenta."])).toEqual([])
    expect(uncoveredCommittedActions("Vou registrar a sua contestação agora.", ["Registrar a contestação."])).toEqual([])
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// Reparo semântico ÚNICO (no mesmo passo do reparo de cobertura)
// ---------------------------------------------------------------------------------------------------------------------
import { completeAssessmentCoverage } from "../../agents/application/assessment-coverage-repair.js"
import { semanticRepairTargetsOf } from "../../agents/domain/assessment-semantic-repair.js"
import { deterministicNarrative } from "../domain/supervisor-narrative.js"
import { vi } from "vitest"

describe("reparo semântico único (V1.7.4)", () => {
  const transcript = ["Operador: Boa tarde.", "Cliente: Estou bloqueada e já paguei.", "Operador: É só informar o pagamento pelo aplicativo, essa opção está disponível pra você.", "Cliente: Obrigada."].join("\n")
  const assessment = (): RawProcessAssessment => ({ processes: [{ documentTitle: DOCUMENT.title, checkpoints: [checkpoint(refOf("Avaliar se a funcionalidade"), "FOLLOWED", "OBSERVED", ["Operador: É só informar o pagamento pelo aplicativo, essa opção está disponível pra você."])] }], validation: { contractVersion: "PROCESS_ASSESSMENT_MODEL_CONTRACT_V4", completeness: "COMPLETE", invalidItems: [], normalizations: [], checkpointCapacity: [] } })
  const excerpts = presented.map((excerpt) => ({ documentTitle: excerpt.documentTitle, excerpt: excerpt.excerpt, heading: excerpt.heading }))
  it("só a etapa inconsistente vai ao reparo, com a conduta exigida; UMA chamada; a reavaliação substitui só ela", async () => {
    expect(semanticRepairTargetsOf(assessment(), catalog, transcript).map((target) => [target.reason, target.failure])).toEqual([["CONDUCT_NOT_EVIDENCED", "ASSERTED_RESULT_IS_NOT_VALIDATION"]])
    const prompts: { system: string; user: string }[] = []
    const call = vi.fn(async (prompt: { system: string; user: string }) => { prompts.push(prompt); return JSON.stringify({ assessments: [{ checkpointRef: refOf("Avaliar se a funcionalidade"), requirement: "x", status: "NOT_OBSERVABLE", evidenceType: null, transcriptEvidence: [], knowledgeQuote: null, knowledgeDetailQuote: null, guidance: { source: "NO_GROUNDED_GUIDANCE", text: null }, uncertainty: "A fala afirma o resultado, não mostra a verificação.", conductEvidence: null }] }) })
    const repaired = await completeAssessmentCoverage({ assessment: assessment(), catalog, presented: excerpts, conversation: transcript, call })
    expect(call).toHaveBeenCalledTimes(1)
    expect(prompts[0]!.user).toContain("Conduta exigida")
    expect(prompts[0]!.user).toContain("Afirmar o resultado")
    expect(repaired.processes[0]!.checkpoints[0]!.status).toBe("NOT_OBSERVABLE")
    expect((repaired.validation as { semanticRepair?: unknown }).semanticRepair).toMatchObject({ repaired: [{ from: "FOLLOWED", to: "NOT_OBSERVABLE" }], error: null })
    // Nunca um segundo reparo.
    expect(semanticRepairTargetsOf(repaired, catalog, transcript)).toEqual([])
  })
  it("falha do reparo fica registrada e a disposição original segue para a verificação (que a derruba)", async () => {
    const repaired = await completeAssessmentCoverage({ assessment: assessment(), catalog, presented: excerpts, conversation: transcript, call: async () => { throw new Error("rede") } })
    expect((repaired.validation as { semanticRepair?: { error?: string } }).semanticRepair?.error).toMatch(/^REPAIR_CALL_FAILED/)
    expect(verify(transcript, repaired.processes[0]!.checkpoints).checkpoints[0]).toMatchObject({ status: "NOT_OBSERVABLE", statusDowngradeReason: "EVIDENCE_ACTION_MISMATCH" })
  })
})

describe("texto de segurança da narrativa", () => {
  const positive = (clause: string) => ({ phase: "OTHER" as const, clause, claim: "ACTION" as const, behavior: null, mention: [], itemIndexes: [0] })
  it("um ponto só: reconhecimento no singular, nunca 'Outros pontos…' sem um primeiro", () => {
    const draft = deterministicNarrative({ version: "SUPERVISOR_FEEDBACK_NARRATIVE_V1", about: { date: null, subject: null }, positives: [positive("orientou a consulta dos débitos no canal indicado")], gaps: [], attention: [], itemsKey: "k" })
    expect(draft.paragraphs.join(" ")).not.toMatch(/Outros pontos/)
    expect(draft.paragraphs[0]).toBe("Você conduziu bem este atendimento: orientou a consulta dos débitos no canal indicado.")
  })
})

import { detectUnsupportedEffectClaims } from "../domain/effect-claims.js"
describe("validadores do texto do redator — falsos positivos do run final", () => {
  it("efeito NEGADO ('não poderia prometer ou garantir') é a abstenção, não afirmação de efeito; garantia real continua recusada", () => {
    expect(detectUnsupportedEffectClaims("Você comunicou ao cliente que não poderia prometer ou garantir o desbloqueio imediato.")).toEqual([])
    expect(detectUnsupportedEffectClaims("Isso garante que o cliente seja desbloqueado.").length).toBeGreaterThan(0)
  })
  it("etapa pulada sem fala citada: o sistema localiza a ação seguinte na conversa (e continua recusando se houve checagem antes)", () => {
    const step = "Realizar o suporte conforme o fluxo aplicável. Caso seja necessário abrir reparo, informar que o status poderá ser acompanhado pelo aplicativo."
    const direct = [operator("T3", "Em que posso ajudar?"), operator("T5", "O serviço está no seu nome?"), operator("T7", "Isso você resolve pelo aplicativo. Lá você abre o reparo e acompanha por lá mesmo.")]
    expect(prerequisiteSkipOf({ stepText: step, evidence: [], operatorTurns: direct, contextTexts: [] })).toMatchObject({ proven: true, successorTurns: ["T7"], successorSource: "CONVERSATION" })
    const supported = [operator("T3", "Vou realizar uma verificação na sua linha."), operator("T9", "Abri o reparo; o andamento você acompanha pelo aplicativo.")]
    expect(prerequisiteSkipOf({ stepText: step, evidence: [], operatorTurns: supported, contextTexts: [] })).toMatchObject({ proven: false })
  })
})
