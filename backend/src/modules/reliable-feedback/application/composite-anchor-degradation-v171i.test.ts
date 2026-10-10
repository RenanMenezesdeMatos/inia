import { describe, expect, it } from "vitest"
import { createInMemoryReliableFeedbackStore } from "../infrastructure/in-memory-reliable-feedback-store.js"
import { generateReliableFeedback, type ReliableGenerationDeps, type ReliableGenerationRequest } from "./generate-reliable-feedback.js"
import type { ReliableFeedbackWriterPort } from "./ports.js"
import { RELIABLE_FEEDBACK_AUTONOMOUS_POLICY } from "../domain/reliable-feedback-item.js"
import { nodeOutputOf } from "../domain/reliable-feedback-artifact.js"
import { verifyProcessAssessments } from "../domain/process-assessment.js"
import { assessCompleteness, compositeListOf } from "../domain/composite-checkpoint.js"
import { structuredAnchorOf } from "../domain/structured-anchor.js"
import { actionRelationOf, stepActionOf } from "../domain/action-semantics.js"
import { ruleContextOf } from "../domain/verified-omission.js"
import { aggregateProcessPatterns, observationsFrom } from "../../indicator-diagnosis/domain/process-patterns.js"
import { V171H_ASSESSMENT, V171H_COLLABORATOR_NAME, V171H_CONTENT, V171H_DOC_TITLE, V171H_OTHER_OPERATOR_NAMES, V171H_PRESENTED, V171H_PUBLISHED, V171H_SUBJECT, V171H_TRANSCRIPT, V171H_WRITER_RAW } from "../testing/contestacao-v171h-smoke-fixture.js"

/**
 * V1.7.1i — ETAPA COMPOSTA, ÂNCORA SEM DEPENDÊNCIA LÉXICA e DEGRADAÇÃO POR CAMPO DE VERDADE, sobre o smoke REAL da V1.7.1h
 * (saída do especialista e do redator gravadas, sem modelo).
 */
const RECAP = "Antes de encerrar, informar:\n\n- Conta analisada;\n- Lançamento contestado;\n- Valor;\n- Ação realizada;\n- Serviço cancelado, quando aplicável;\n- Conta ajustada;\n- Valor a pagar;\n- Prazo;\n- Canal de retorno;\n- Protocolo."
const operatorTurns = V171H_TRANSCRIPT.split("\n").filter((line) => line.startsWith("Operador:")).map((line) => line.replace(/^Operador:\s*/, ""))
const RECAP_TURN = operatorTurns.find((line) => line.startsWith("Então, resumindo"))!
const statusOf = (completeness: ReturnType<typeof assessCompleteness>) => Object.fromEntries(completeness!.items.map((item) => [item.text, item.status]))

describe("V1.7.1i — A/B/E/F) etapa COMPOSTA: completude por item, sem acusar o que não é verificável", () => {
  it("só abertura + lista de ações do OPERADOR (informar/verificar) é composta; o que o cliente explica não é", () => {
    expect(compositeListOf(RECAP)).toMatchObject({ family: "INFORM" })
    expect(compositeListOf("Verificar:\n\n- Nome do serviço;\n- Valor;")).toMatchObject({ family: "VERIFY" })
    expect(compositeListOf("O operador deverá permitir que o cliente explique:\n- Qual conta está questionando;\n- Qual cobrança não reconhece;")).toBeNull()
    expect(compositeListOf("5. Explicar prazo;")).toBeNull()
  })

  it("A) todos os itens na recapitulação → COMPLETE", () => {
    const full = "Recapitulando: a conta analisada é a de setembro, o lançamento contestado é o Clube de Jogos, valor de R$ 14,90; a ação realizada foi a contestação; a conta ajustada sai no app, o valor a pagar é R$ 50,00, o prazo é de cinco dias úteis, o canal de retorno é o SMS e o protocolo é 123."
    const complete = assessCompleteness({ quote: RECAP, evidence: [{ turnRef: "T21", text: full }], operatorConversation: [full], windowComplete: true })
    expect(complete).toMatchObject({ status: "COMPLETE", family: "INFORM" })
  })

  it("B/E) recapitulação REAL do smoke (parte dos itens) → PARTIAL: observados e os verificadamente ausentes (prazo, canal de retorno)", () => {
    const partial = assessCompleteness({ quote: RECAP, evidence: [{ turnRef: "T21", text: RECAP_TURN }], operatorConversation: operatorTurns, windowComplete: true })
    expect(partial!.status).toBe("PARTIAL")
    // V1.7.1j — detectores por tipo: "tirei o Clube de Jogos" realiza a ação (item condicional OBSERVADO, sem perder a condição).
    expect(statusOf(partial)).toMatchObject({ "lançamento contestado": "OBSERVED", "ação realizada": "OBSERVED", "serviço cancelado, quando aplicável": "OBSERVED", protocolo: "OBSERVED", prazo: "VERIFIED_ABSENT", "canal de retorno": "VERIFIED_ABSENT", "conta ajustada": "NOT_APPLICABLE", "valor a pagar": "NOT_APPLICABLE" })
  })

  it("F) item desconhecido nunca vira acusação: termo dito em outro momento, item genérico ou transcrição incompleta", () => {
    const partial = assessCompleteness({ quote: RECAP, evidence: [{ turnRef: "T21", text: RECAP_TURN }], operatorConversation: operatorTurns, windowComplete: true })
    // V1.7.1j — o valor foi dito como NÚMERO fora da recapitulação ("R$ 14,90 por mês"): dito na chamada, nunca "ausente".
    expect(statusOf(partial)).toMatchObject({ valor: "OBSERVED_ELSEWHERE", "conta analisada": "OBSERVED_ELSEWHERE" })
    // Transcrição cortada: nenhuma ausência é provada → nada de PARCIAL (completude desconhecida).
    expect(assessCompleteness({ quote: RECAP, evidence: [{ turnRef: "T21", text: RECAP_TURN }], operatorConversation: operatorTurns, windowComplete: false })!.status).toBe("UNKNOWN")
    // Lista de VERIFICAÇÃO: ausência na fala não prova que a conferência não aconteceu.
    const verify = assessCompleteness({ quote: "Verificar:\n\n- Nome do serviço;\n- Valor;\n- Recorrência;", evidence: [{ turnRef: "T9", text: "É o Clube de Jogos, R$ 14,90 por mês." }], operatorConversation: operatorTurns, windowComplete: true })
    expect(verify!.status).toBe("UNKNOWN")
    expect(verify!.counts.VERIFIED_ABSENT).toBe(0)
  })
})

describe("V1.7.1i — G/H/I) âncora pela ETAPA canônica + semântica de ação (sem palavras do título da seção)", () => {
  const conversation = V171H_TRANSCRIPT.split("\n").map((line) => line.replace(/^(?:Operador|Cliente):\s*/, ""))
  const base = { contentKind: "RULE_CONTENT", documentTitle: V171H_DOC_TITLE, subject: V171H_SUBJECT, conversation, operatorConversation: operatorTurns }
  const cancelRule = ruleContextOf(V171H_CONTENT, "1. Cancelar a recorrência, quando permitido;")
  const deadlineRule = ruleContextOf(V171H_CONTENT, "5. Explicar prazo;")

  it("G) 'já tirei a renovação' × 'Cancelar a recorrência' → CHECKPOINT_SELECTION (família CANCEL + objeto recorrência), sem 'serviço' na conversa", () => {
    expect(conversation.join(" ")).not.toMatch(/servi[çc]o|recorr[êe]ncia/i)
    expect(stepActionOf("1. Cancelar a recorrência, quando permitido;")).toMatchObject({ family: "CANCEL", objectClasses: ["RECURRENCE"] })
    expect(structuredAnchorOf({ ...base, status: "FOLLOWED", rule: cancelRule, citedQuote: "1. Cancelar a recorrência, quando permitido;", operatorEvidence: [{ turnRef: "T15", text: "Não, já tirei a renovação dele aqui, a partir de agora não entra mais." }] })).toMatchObject({ anchored: true, basis: "CHECKPOINT_SELECTION", proof: { actionRelation: { verbForms: ["tirei"], objectClasses: ["RECURRENCE"], related: true } } })
  })

  it("H) fala sem relação de ação com a etapa, ou ação sobre OUTRO objeto → não ancora (QA)", () => {
    expect(structuredAnchorOf({ ...base, status: "FOLLOWED", rule: cancelRule, citedQuote: "1. Cancelar a recorrência, quando permitido;", operatorEvidence: [{ turnRef: "T9", text: "Deixa eu localizar aqui." }] })).toMatchObject({ anchored: false, failure: "ACTION_NOT_RELATED" })
    expect(actionRelationOf(stepActionOf("1. Cancelar a portabilidade pendente;"), ["Pronto, cancelei a assinatura."])).toMatchObject({ objectMismatch: true, related: false })
    // Particípio descritivo ("foi ativado no dia…") não é a ação "Ativar".
    expect(actionRelationOf(stepActionOf("4. Ativar bloqueio preventivo;"), ["Aqui mostra que foi ativado no dia 2 de julho."])).toMatchObject({ verbForms: [], related: false })
  })

  it("I) NOT_FOLLOWED com ação observada sem o termo da regra ('eles vão te dar uma posição') → OBSERVED_DEVIATION", () => {
    const deadlineSpeech = operatorTurns.find((line) => line.startsWith("Olha, isso eu não consigo"))!
    expect(structuredAnchorOf({ ...base, status: "NOT_FOLLOWED", declaredEvidenceType: "OBSERVED", rule: deadlineRule, citedQuote: "5. Explicar prazo;", operatorEvidence: [{ turnRef: "T19", text: deadlineSpeech }] })).toMatchObject({ anchored: true, basis: "OBSERVED_DEVIATION" })
  })
})

type Wording = { observed?: string; whyItMatters?: string; whatYouCanDo?: string; suggestedResponse?: string }
const SLOTS: [RegExp, number][] = [[/conta ajustada/i, 0], [/prazo/i, 1], [/explique a cobran/i, 2], [/Registrar contesta/i, 3], [/protocolo/i, 4], [/recapitula/i, 5], [/apresenta/i, 6], [/Verificar nome/i, 7], [/Cancelar/i, 8], [/Confirmar o entendimento/i, 9]]
function writer(overrides: Record<string, Wording> = {}): ReliableFeedbackWriterPort {
  return {
    writeMonitoring: async (input) => ({
      rawOutput: {
        items: input.items.flatMap((item) => {
          const hit = SLOTS.find(([pattern]) => pattern.test(item.requirement ?? ""))
          if (!hit) return []
          const override = Object.entries(overrides).find(([key]) => new RegExp(key, "i").test(item.requirement ?? ""))?.[1] ?? {}
          return [{ ...V171H_WRITER_RAW.items[hit[1]]!, ...override, slot: item.slot }]
        }),
        presentation: V171H_WRITER_RAW.presentation,
      },
    }),
    writeIndicator: async () => { throw new Error("não usado") },
  }
}
async function replay(overrides: Record<string, Wording> = {}) {
  const store = createInMemoryReliableFeedbackStore({ onReactivate: () => true })
  const deps: ReliableGenerationDeps = {
    enabled: true, store, writer: writer(overrides), policy: RELIABLE_FEEDBACK_AUTONOMOUS_POLICY,
    loadMonitoringContext: async () => ({ transcript: V171H_TRANSCRIPT, label: `Atendimento de 25/09/2026 · ${V171H_SUBJECT}`, otherOperatorNames: V171H_OTHER_OPERATOR_NAMES, subjectOperatorName: V171H_COLLABORATOR_NAME }),
    loadIndicatorContext: async () => null, loadPublishedKnowledge: async () => V171H_PUBLISHED, loadIndicatorDiagnosisPlan: async () => null,
    loadPeerPracticeData: async () => ({ peers: [], observations: [] }), resolveDiagnosticStrategy: async () => null,
    loadRecipient: async () => ({ firstName: "Larissa" }), now: () => new Date("2026-09-25T21:59:00Z"),
  }
  const source = { kind: "monitoring", knowledgeExcerpts: V171H_PRESENTED, input: { organizationId: "org-i", operatorId: "op-i", interactionId: "int-i", structured: { evidenceFound: "x", observedBehavior: "o", relatedProcedure: V171H_DOC_TITLE, recommendation: "r", processAssessment: JSON.parse(JSON.stringify(V171H_ASSESSMENT)) } } }
  const request: ReliableGenerationRequest = { organizationId: "org-i", enrollmentId: "enr-v171h", workflowId: "wf", workflowVersionId: "v", nodeId: "gerar", sourceNodeId: "orq", sourceType: "AGENT", domain: "MONITORING", sourceNodeOutput: source, collaboratorId: "op-i", interactionId: "int-i", indicatorMeasurementId: null, configuredAgentId: null }
  const result = await generateReliableFeedback(deps, request)
  const artifact = result.record.artifact!
  const byStep = (pattern: RegExp) => artifact.items.find((item) => pattern.test(item.process?.requirement ?? ""))!
  const text = nodeOutputOf(result.record.id, artifact, artifact.items.map((item) => ({ itemIndex: item.index, status: "APPROVED_UNCHANGED" as const, finalWording: null }))).text
  return { store, artifact, byStep, text }
}
const fieldOf = (item: { writerFieldValidation?: { field: string; codes: string[]; action: string }[] }, field: string) => item.writerFieldValidation?.find((entry) => entry.field === field)

describe("V1.7.1i — C/D) etapa parcial nunca é ponto forte nem histórico de 'cumpriu'", () => {
  it("C) recapitulação parcial → ponto de desenvolvimento com texto do sistema (observados + ausentes verificados + regra completa)", async () => {
    const { byStep, artifact } = await replay()
    const recap = byStep(/recapitula/i)
    expect(recap).toMatchObject({ section: "OPPORTUNITY", process: { status: "NOT_FOLLOWED", completeness: { status: "PARTIAL", observed: ["lançamento contestado", "ação realizada", "serviço cancelado, quando aplicável", "protocolo"], absent: ["prazo", "canal de retorno"], elsewhere: ["conta analisada", "valor"] } }, wordingSource: "SYSTEM", decision: { disposition: "READY" } })
    expect(recap.proposedWording).toEqual({ observed: "Em “Recapitulação obrigatória”, você fez parte do que o procedimento prevê, incluindo “Lançamento contestado”, “Ação realizada”, “Serviço cancelado” e “Protocolo”, mas não todos os itens previstos. Nesta chamada não apareceram “Prazo” e “Canal de retorno”. “Conta ajustada” e “Valor a pagar” não se aplicavam neste momento, porque o resultado ainda estava pendente.", whyItMatters: "", whatYouCanDo: "Na próxima chamada, antes de encerrar, informe também o prazo e por onde o cliente receberá o retorno.", suggestedResponse: "Vamos recapitular o que foi realizado." })
    // O exemplo de condução é a fala-modelo DA BASE (passa nas mesmas validações do exemplo do redator), rotulado como sugestão.
    expect(artifact.items.filter((item) => item.section === "STRENGTH" && /recapitula/i.test(item.process?.requirement ?? ""))).toEqual([])
    expect(artifact.processAssessment!.checkpoints.find((checkpoint) => /recapitula/i.test(checkpoint.requirement))).toMatchObject({ declaredStatus: "FOLLOWED", status: "NOT_FOLLOWED", statusDowngradeReason: "COMPOSITE_PARTIAL" })
  })

  it("D) persistido como NÃO cumprida + PARTIAL com subitens; composta sem completude provada fica fora de 'cumpriu' (observação e padrão)", async () => {
    const verified = verifyProcessAssessments({ sources: [{ sourceRef: "S", assessment: JSON.parse(JSON.stringify(V171H_ASSESSMENT)), presented: V171H_PRESENTED }], interactionId: "int-i", transcript: V171H_TRANSCRIPT, published: V171H_PUBLISHED, subject: V171H_SUBJECT })
    const observations = observationsFrom("op-i", [{ interactionId: "int-i", assessment: verified }])
    const recap = observations.find((observation) => /recapitula/i.test(observation.requirement))!
    expect(recap).toMatchObject({ status: "NOT_FOLLOWED", completeness: "PARTIAL", analyticsStatus: "VERIFIED", subItems: expect.arrayContaining([{ text: "prazo", status: "VERIFIED_ABSENT" }, { text: "protocolo", status: "OBSERVED" }, { text: "valor", status: "OBSERVED_ELSEWHERE" }, { text: "serviço cancelado, quando aplicável", status: "OBSERVED", conditional: true, agency: "OPERATOR_ACTION" }]) })
    expect(observations.some((observation) => observation.status === "FOLLOWED" && observation.completeness && observation.completeness !== "COMPLETE")).toBe(false)
    // A lista de verificação "cumprida" com completude desconhecida não é contada como cumprida no agrupamento do diagnóstico.
    const patterns = aggregateProcessPatterns([{ handle: "I1", interactionId: "int-i", label: "x", assessment: verified, otherOperatorNames: [] }])
    const verifyPattern = patterns.find((pattern) => /Verificar nome/.test(pattern.requirement))!
    expect(verifyPattern).toMatchObject({ followed: [], notObservable: ["I1"] })
    expect(patterns.find((pattern) => /recapitula/i.test(pattern.requirement))).toMatchObject({ followed: [], notFollowed: ["I1"] })
  })
})

describe("V1.7.1i — J/K/L/M) degradação por campo de verdade", () => {
  it("J) efeito garantido no NÚCLEO → item inteiro no texto de segurança", async () => {
    const { byStep } = await replay({ "Registrar contesta": { observed: "Você registrou a contestação, e isso garante que o cliente receba o valor de volta." } })
    expect(byStep(/Registrar contesta/)).toMatchObject({ wordingSource: "FALLBACK", writerFieldValidation: [{ field: "observed", action: "INVALIDATED_ITEM" }] })
  })

  it("K) 'para garantir' só no 'Como aplicar' → só o campo vem do sistema; o ponto segue sem QA (escuta e protocolo do smoke real)", async () => {
    const { byStep } = await replay()
    for (const pattern of [/explique a cobran/i, /protocolo/i]) {
      const item = byStep(pattern)
      expect(fieldOf(item, "whatYouCanDo")).toMatchObject({ codes: ["GUARANTEED_EFFECT"], action: "FALLBACK_FIELD" })
      expect(item).toMatchObject({ wordingSource: "WRITER", decision: { disposition: "READY" } })
      expect(item.proposedWording!.whatYouCanDo).not.toMatch(/garant/i)
    }
  })

  it("L) efeito garantido só no exemplo de condução → só o exemplo sai", async () => {
    const { byStep } = await replay({ "conta ajustada": { suggestedResponse: "Vou emitir a conta ajustada, e isso garante que você não pague nada a mais." } })
    const item = byStep(/conta ajustada/)
    // O campo recebe o exemplo DA BASE para esse ponto (passa nas validações); o do redator com "garante" some.
    expect(fieldOf(item, "suggestedResponse")).toMatchObject({ codes: expect.arrayContaining(["GUARANTEED_EFFECT"]), action: "FALLBACK_FIELD" })
    expect(item).toMatchObject({ wordingSource: "WRITER", decision: { disposition: "READY" } })
    expect(item.proposedWording!.suggestedResponse).toBe("Vou verificar se é possível emitir uma conta ajustada.")
  })

  it("M) evidência inventada (citação que não é da chamada) em qualquer campo continua invalidando o item", async () => {
    const { byStep } = await replay({ "Registrar contesta": { whatYouCanDo: "Continue dizendo “já está tudo resolvido” ao registrar a contestação." } })
    expect(byStep(/Registrar contesta/)).toMatchObject({ wordingSource: "FALLBACK", writerFieldValidation: expect.arrayContaining([expect.objectContaining({ field: "whatYouCanDo", codes: expect.arrayContaining(["EVIDENCE_ALTERATION"]), action: "INVALIDATED_ITEM" })]) })
  })
})

describe("V1.7.1i — fixture do smoke REAL da V1.7.1h (§13): QA só por incerteza real", () => {
  it("A–G: recapitulação parcial; cancelamento e prazo ancorados; escuta/protocolo/confirmação só perdem o campo; exemplo continua bloqueado", async () => {
    const { artifact, byStep, text } = await replay()
    // V1.7.1k — a lista "Verificar:" sai do QA: 4 itens reconhecidos na fala (texto do sistema só com eles); 7 prontos, 3 em QA.
    expect(artifact.findings).toMatchObject({ detected: 10, reliable: 10, blocked: 0, inFeedback: 7, heldForQa: 3 })
    expect(byStep(/Cancelar/)).toMatchObject({ knowledge: { applicability: "VERIFIED", structuredAnchorBasis: "CHECKPOINT_SELECTION" }, decision: { disposition: "READY" } })
    // Prazo: a âncora passa (desvio observado); o QA que resta é do REDATOR — núcleo e "Como aplicar" usaram fato que só existe no
    // exemplo da base ("retorno … por SMS").
    expect(byStep(/prazo/i)).toMatchObject({ knowledge: { applicability: "VERIFIED", structuredAnchorBasis: "OBSERVED_DEVIATION", operativeRule: { heading: "35. Prazo da análise" } }, wordingSource: "FALLBACK", decision: { reasons: ["WRITER_FALLBACK_USED", "WRITER_VALIDATION_FAILED"] } })
    expect(byStep(/prazo/i).proposedWording!.whatYouCanDo).toBe("Na próxima chamada, informe o prazo exibido na ferramenta.")
    // Confirmação e apresentação: a base citada é só EXEMPLO (incerteza real); a confirmação já não perde o texto do redator.
    expect(byStep(/Confirmar o entendimento/)).toMatchObject({ wordingSource: "WRITER", decision: { reasons: expect.arrayContaining(["KNOWLEDGE_RULE_IS_EXAMPLE"]) } })
    expect(byStep(/apresenta/i).decision.reasons).toContain("KNOWLEDGE_RULE_IS_EXAMPLE")
    // Lista de verificação (V1.7.1k): conferências internas não aparecem na fala → completude continua DESCONHECIDA, mas os itens
    // reconhecidos por detector tipado ancoram a etapa e o ponto fala só deles (texto do sistema) — sem QA por isso.
    expect(byStep(/Verificar nome/)).toMatchObject({ process: { status: "FOLLOWED", completeness: { status: "UNKNOWN", observed: ["valor", "data de ativação", "recorrência", "cobranças anteriores"] } }, knowledge: { applicability: "VERIFIED", structuredAnchorBasis: "COMPOSITE_ITEMS_OBSERVED" }, wordingSource: "SYSTEM", decision: { disposition: "READY" } })
    expect(byStep(/Verificar nome/).proposedWording!.observed).toBe("Em “Serviços digitais não reconhecidos”, a sua fala mostra a conferência de “Valor”, “Data de ativação”, “Recorrência” e “Cobranças anteriores”. Os demais itens da lista não puderam ser confirmados pela gravação e não foram avaliados.")
    // Privacidade: a fala com o nome do cliente (4 colegas "Sérgio") aparece.
    expect(text).toContain("resumindo, Sérgio")
    expect(text).not.toMatch(/5 dias|cinco dias|garant/i)
    expect(text).not.toMatch(/SMS(?!\.”)/)
  })
})
