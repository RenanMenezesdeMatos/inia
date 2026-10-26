import { describe, expect, it } from "vitest"
import "../testing/no-external-ai.js"
import { projectTranscript } from "../../investigation/domain/transcript-projection.js"
import { verifyCallAnalysis, type VerificationInput } from "./call-analysis.js"
import { criterionKeyOf } from "./criteria-identity.js"
import { buildMonitoringBrief, type FeedbackBrief } from "./feedback-brief.js"
import { analysisClaimsOf, applyVerdicts, assembleMessage, contentLeaksOf, forbiddenContentOf, parseVerdicts, parseWriterDraft, trustedReadingsOf, type Verdict } from "./composition.js"
import { compositionPayloadOf, verificationFactsOf } from "./composition-prompt.js"
import { listContextOf, transcriptStatusOf } from "./procedure.js"
import { composeFeedback } from "../application/compose-feedback.js"
import type { EngineModelPort, ModelCallMetric } from "../application/ports.js"
import { confirmingReview, DOC_ID, fixtureContext, INTERACTION_ID, modelAnalysis, PROCEDURE_V1 } from "../testing/fixtures.js"

/** Integridade + revisão que CONFIRMA (o foco aqui é a composição, não a confirmação). */
const verifyConfirmed = (input: Omit<VerificationInput, "review">, condition?: { turn: string; speaker: string; quote: string }) => {
  const preliminary = verifyCallAnalysis({ ...input, model: { ...input.model, contractViolations: [...input.model.contractViolations] } })
  return verifyCallAnalysis({ ...input, review: { attempted: true, review: confirmingReview(preliminary, condition), error: null } })
}

/**
 * CONTRATO DE CONFIANÇA da composição — regressões do defeito reproduzido na revisão: a regra sustentava confirmar a data de
 * nascimento; a análise trazia a orientação "prometa desconto integral"; o verificador recusou a frase (UNSUPPORTED_ADDITION) e a
 * montagem final a recolocou como frase do SISTEMA. Nada aqui usa lista de palavras proibidas: o que decide é fato × leitura.
 */
const INVENTED = "prometa desconto integral ao cliente para encerrar a ligação"
const INVENTED_WHY = "Isso garante a fidelização do cliente e impede negociações indevidas."

function inventedBrief(): FeedbackBrief {
  const { context, line } = fixtureContext()
  const projection = projectTranscript(fixtureContext().projection.turns.map((turn) => `${turn.speaker === "OPERADOR" ? "Operador" : "Cliente"}: ${turn.text}`).join("\n"))
  const analysis = verifyConfirmed({
    model: modelAnalysis({ criteria: [
      { line: line("data de nascimento").handle, status: "NOT_MET", evidenceKind: "OMISSION", declaredActionTense: null, evidence: [], opportunityTurn: "T4", rationale: "Não confirmou a data de nascimento e ainda deveria ter oferecido desconto integral.", materiality: "HIGH", guidance: { moment: "Logo depois de confirmar o nome", condition: null, action: INVENTED, ruleLines: [line("data de nascimento").handle] }, whyItMatters: null },
      { line: line("Confirmar se a solicitação").handle, status: "MET", evidenceKind: "CONDUCT_OBSERVED", declaredActionTense: null, evidence: [{ turn: "T5", speaker: "OPERADOR", quote: "A segunda via é da fatura ou do parcelamento?" }], opportunityTurn: null, rationale: "Confirmou o tipo de segunda via.", materiality: "HIGH", guidance: null, whyItMatters: INVENTED_WHY },
    ] }, { pathSections: [] }),
    context,
    projection,
    transcriptStatus: transcriptStatusOf(projection),
    interactionId: INTERACTION_ID,
    subjectAnchoredDocumentIds: [DOC_ID],
    repairAttempted: false,
  })
  return buildMonitoringBrief({ analysis, interactionId: INTERACTION_ID, label: "Segunda via", dateLabel: "29/09/2026", selectionReason: "Sinal: nota_ura = 2", criterionKeys: new Map(analysis.criteria.map((criterion) => [criterion.lineKey, criterionKeyOf(criterion.lineKey)])), documentTitles: new Map([[DOC_ID, "Procedimento — Segunda via de conta"]]), documentVersions: new Map([[DOC_ID, 1]]), history: new Map(), delivered: new Set() })
}

const verdict = (id: string, kind: Verdict["verdict"], specific: boolean | null = null): [string, Verdict] => [id, { id, verdict: kind, specific, repeats: null, note: kind === "SUPPORTED" ? null : "não está na regra" }]
/** Todas as superfícies entregáveis: texto, card, parágrafos, detalhes (a mensagem inteira, sem o brief de auditoria). */
const surfaces = (message: ReturnType<typeof assembleMessage>) => (message ? JSON.stringify({ card: message.card, paragraphs: message.paragraphs, text: message.text, view: message.view, sentences: message.sentences.map((sentence) => sentence.text) }) : "")

function compose(brief: FeedbackBrief, draft: object, verdicts: [string, Verdict][]) {
  const parsed = parseWriterDraft(JSON.stringify(draft))
  if (!parsed.ok) throw new Error(parsed.error)
  const decisions = applyVerdicts(parsed.draft, brief, new Map(verdicts))
  const trusted = trustedReadingsOf(brief, [decisions])
  const forbidden = forbiddenContentOf(brief, [decisions], trusted)
  return { decisions, message: assembleMessage(brief, decisions, { trusted, forbidden }), trusted, forbidden }
}

describe("contrato de confiança — leitura do modelo nunca vira fato", () => {
  it("o brief separa FATO (status verificado, regra literal, falas) de LEITURA (justificativa, orientação, porquê) e o verificador só recebe fatos", () => {
    const brief = inventedBrief()
    const development = brief.developments[0]!
    expect(development.observed).toBe("Esta etapa não aparece nesta chamada.")
    expect(development.reading).toContain("desconto integral")
    expect(development.guidance?.action).toBe(INVENTED)
    const facts = JSON.stringify(verificationFactsOf(brief))
    expect(facts).not.toContain("desconto")
    expect(facts).not.toContain("fidelização")
    const writer = compositionPayloadOf(brief)
    expect(JSON.stringify(writer.facts)).not.toContain("desconto")
    expect(JSON.stringify(writer.analysisReading)).toContain("desconto")
    // A orientação é conferida como qualquer frase, na forma exata em que o sistema a usaria.
    expect(analysisClaimsOf(brief).map((claim) => claim.id)).toEqual(["G-A1", "W-S1"])
  })

  it("DEFEITO REPRODUZIDO: orientação inventada na análise, recusada pelo verificador → não volta como frase do sistema, card nem detalhes", () => {
    const brief = inventedBrief()
    const { message, trusted } = compose(brief, {
      sentences: [
        { text: "Você confirmou se era fatura ou parcelamento antes de enviar.", stance: "RECOGNITION", refs: ["S1"], paragraph: 1 },
        { text: "Na próxima vez, logo depois de confirmar o nome, prometa desconto integral ao cliente.", stance: "GUIDANCE", refs: ["A1"], paragraph: 2 },
      ],
      card: { text: "Prometa desconto integral ao confirmar os dados.", refs: ["A1"] },
    }, [verdict("F1", "SUPPORTED", true), verdict("F2", "UNSUPPORTED_ADDITION", true), verdict("CARD", "UNSUPPORTED_ADDITION"), verdict("G-A1", "UNSUPPORTED_ADDITION", true), verdict("W-S1", "UNSUPPORTED_ADDITION")])
    expect(trusted).toEqual({ guidance: {}, why: {} })
    expect(surfaces(message)).not.toMatch(/desconto/i)
    expect(surfaces(message)).not.toMatch(/fideliza|negociações indevidas/i)
    // V3: nada de frase do sistema tapando a lacuna; o card recusado vira a frase VERIFICADA do redator.
    expect(message!.sentences.every((sentence) => sentence.source === "WRITER")).toBe(true)
    expect(message!.card).toBe("Você confirmou se era fatura ou parcelamento antes de enviar.")
    expect(message!.text).not.toMatch(/Ponto principal|O procedimento orienta|não aparece a etapa/)
    // O desvio não foi comunicado → não aparece nos detalhes e não conta como entregue.
    expect(message!.communicatedRefs).toEqual(["S1"])
    expect(message!.view.developments).toEqual([])
    expect(message!.leaksRemoved).toEqual([])
  })

  it("orientação recusada que o redator nem usou: o complemento nunca a recupera (antes: `systemSentencesFor` usava guidance.action)", () => {
    const brief = inventedBrief()
    const { message } = compose(brief, {
      sentences: [{ text: "Você não confirmou a data de nascimento antes de enviar a segunda via.", stance: "ADJUSTMENT", refs: ["A1"], paragraph: 1 }],
      card: { text: "Confirme a data de nascimento do titular.", refs: ["A1"] },
    }, [verdict("F1", "SUPPORTED", false), verdict("CARD", "SUPPORTED"), verdict("G-A1", "UNSUPPORTED_ADDITION", true), verdict("W-S1", "SUPPORTED")])
    expect(surfaces(message)).not.toMatch(/desconto/i)
    expect(message!.sentences.filter((sentence) => sentence.source === "SYSTEM")).toEqual([])
  })

  it("orientação APROVADA pelo verificador nunca é colada na conversa nem nos detalhes (`LITERAL_QUOTES_V1`); ajuste específico do redator basta", () => {
    const brief = inventedBrief()
    brief.developments[0]!.guidance = { moment: "Logo depois de confirmar o nome", condition: null, action: "confirme a data de nascimento do titular" }
    const approved = compose(brief, {
      sentences: [{ text: "Faltou a confirmação da data de nascimento.", stance: "ADJUSTMENT", refs: ["A1"], paragraph: 1 }],
      card: { text: "Confirme a data de nascimento do titular.", refs: ["A1"] },
    }, [verdict("F1", "SUPPORTED", false), verdict("CARD", "SUPPORTED"), verdict("G-A1", "SUPPORTED", true)])
    expect(approved.message!.sentences.filter((sentence) => sentence.source === "SYSTEM")).toEqual([])
    expect(approved.message!.view.developments[0]!.howToApply).toBeNull()
    const specific = compose(brief, {
      sentences: [{ text: "Logo depois de confirmar o nome, faltou pedir a data de nascimento antes de enviar a segunda via.", stance: "ADJUSTMENT", refs: ["A1"], paragraph: 1 }],
      card: { text: "Confirme a data de nascimento do titular.", refs: ["A1"] },
    }, [verdict("F1", "SUPPORTED", true), verdict("CARD", "SUPPORTED"), verdict("G-A1", "SUPPORTED", true)])
    expect(specific.message!.sentences.filter((sentence) => sentence.source === "SYSTEM")).toEqual([])
  })

  it("'por que importa' da análise não aparece em 'o que manter' nem nos detalhes — recusado ou aprovado, fica a afirmação do sistema", () => {
    const brief = inventedBrief()
    const refused = compose(brief, { sentences: [{ text: "Você confirmou se era fatura ou parcelamento antes de enviar.", stance: "RECOGNITION", refs: ["S1"], paragraph: 1 }, { text: "Faltou a data de nascimento; peça logo depois do nome.", stance: "GUIDANCE", refs: ["A1"], paragraph: 2 }], card: { text: "Peça a data de nascimento logo depois do nome.", refs: ["A1"] } }, [verdict("F1", "SUPPORTED", true), verdict("F2", "SUPPORTED", true), verdict("CARD", "SUPPORTED"), verdict("G-A1", "UNSUPPORTED_ADDITION"), verdict("W-S1", "UNSUPPORTED_ADDITION")])
    expect(refused.message!.view.maintain!.evidence[0]!.statement).toBe("Esta etapa foi cumprida nesta chamada.")
    expect(surfaces(refused.message)).not.toMatch(/fideliza|negociações indevidas/i)
    const approvedWhy = compose(brief, { sentences: [{ text: "Você confirmou se era fatura ou parcelamento antes de enviar.", stance: "RECOGNITION", refs: ["S1"], paragraph: 1 }, { text: "Faltou a data de nascimento; peça logo depois do nome.", stance: "GUIDANCE", refs: ["A1"], paragraph: 2 }], card: { text: "Peça a data de nascimento logo depois do nome.", refs: ["A1"] } }, [verdict("F1", "SUPPORTED", true), verdict("F2", "SUPPORTED", true), verdict("CARD", "SUPPORTED"), verdict("W-S1", "SUPPORTED")])
    expect(approvedWhy.message!.view.maintain!.evidence[0]!.statement).toBe("Esta etapa foi cumprida nesta chamada.")
  })

  it("reescrita do verificador que REMOVE uma negação ou condição nunca é aceita: a frase recusada sai inteira", () => {
    const brief = inventedBrief()
    const parsed = parseVerdicts(JSON.stringify({ verdicts: [{ id: "F1", verdict: "OVERREACH", specific: true, rewrite: "Envie a segunda via e confirme a data de nascimento.", note: "exagero" }, { id: "CARD", verdict: "SUPPORTED" }] }), ["F1", "CARD"])
    expect(parsed.ok).toBe(true)
    const draft = parseWriterDraft(JSON.stringify({ sentences: [{ text: "Nunca envie a segunda via sem antes confirmar a data de nascimento — isso sempre evita fraude.", stance: "GUIDANCE", refs: ["A1"], paragraph: 1 }], card: { text: "Confirme a data de nascimento antes de enviar.", refs: ["A1"] } }))
    const decisions = applyVerdicts(draft.ok ? draft.draft : (null as never), brief, parsed.ok ? parsed.verdicts : new Map())
    expect(decisions.sentences[0]).toMatchObject({ kept: false, finalText: null, reasons: ["OVERREACH"] })
    const message = assembleMessage(brief, decisions, { trusted: trustedReadingsOf(brief, [decisions]), forbidden: forbiddenContentOf(brief, [decisions], trustedReadingsOf(brief, [decisions])) })
    expect(surfaces(message)).not.toContain("Envie a segunda via e confirme")
    expect(surfaces(message)).not.toMatch(/fraude/i)
  })

  it("a trava final pega conteúdo recusado reintroduzido em QUALQUER superfície — inclusive a regra invertida com as mesmas palavras", () => {
    const brief = inventedBrief()
    const inverted = "Enviar a segunda via antes de confirmar a data de nascimento."
    const forbidden = { rejected: [inverted, `Na próxima vez, logo depois de confirmar o nome: ${INVENTED}.`], untrusted: [INVENTED] }
    const base = compose(brief, { sentences: [{ text: "Faltou pedir a data de nascimento.", stance: "ADJUSTMENT", refs: ["A1"], paragraph: 1 }], card: { text: "Confirme a data de nascimento.", refs: ["A1"] } }, [verdict("F1", "SUPPORTED", true), verdict("CARD", "SUPPORTED")]).message!
    const tampered = { ...base, view: { ...base.view, developments: base.view.developments.map((detail) => ({ ...detail, howToApply: "Ofereça desconto integral para encerrar." })) } }
    expect(contentLeaksOf(tampered, brief, forbidden).map((leak) => leak.surface)).toContain("view.developments.0.howToApply")
    // Se algum caminho voltasse a injetar frase do SISTEMA, a trava a pegaria (a regra invertida com as mesmas palavras).
    const reordered = { ...base, sentences: [...base.sentences, { text: inverted, stance: "GUIDANCE" as const, refs: ["A1"], paragraph: 9, source: "SYSTEM" as const, basis: "RULE_LITERAL" as const }] }
    expect(contentLeaksOf(reordered, brief, forbidden).map((leak) => leak.kind)).toContain("REJECTED")
    expect(contentLeaksOf(base, brief, forbidden)).toEqual([])
  })

  it("falha do redator OU do verificador (fluxo real de composição): SEM mensagem, com motivo — nunca um feedback de template; nada inventado é entregue", async () => {
    const brief = inventedBrief()
    const writerBroken: EngineModelPort = { async generate() { return { text: "{ não é json", model: "fake", usage: null, durationMs: 1, costUsd: null, finishReason: "STOP" } } }
    const verifierBroken: EngineModelPort = {
      async generate(request) {
        if (request.stage === "COMPOSITION") return { text: JSON.stringify({ sentences: [{ text: "Na próxima vez, prometa desconto integral ao cliente.", stance: "GUIDANCE", refs: ["A1"], paragraph: 1 }], card: { text: "Prometa desconto integral.", refs: ["A1"] } }), model: "fake", usage: null, durationMs: 1, costUsd: null, finishReason: "STOP" }
        return { text: "{ não é json", model: "fake", usage: null, durationMs: 1, costUsd: null, finishReason: "STOP" }
      },
    }
    for (const [model, reason] of [[writerBroken, "WRITER_OUTPUT_INVALID"], [verifierBroken, "VERIFIER_UNAVAILABLE"]] as const) {
      const metrics: ModelCallMetric[] = []
      const { message, audit } = await composeFeedback(model, inventedBrief(), metrics)
      expect(message).toBeNull()
      expect(audit).toMatchObject({ outcome: "NO_MESSAGE", reason })
      expect(audit.trusted).toEqual({ guidance: {}, why: {} })
    }
    expect(brief.developments[0]!.guidance?.action).toBe(INVENTED)
  })

  it("repetição: a mesma orientação dita duas vezes fica uma vez só — quem decide é o verificador (`repeats`), nunca palavras em comum", () => {
    const brief = inventedBrief()
    const draft = {
      sentences: [
        { text: "Logo depois de confirmar o nome, peça a data de nascimento antes de enviar a segunda via.", stance: "GUIDANCE", refs: ["A1"], paragraph: 1 },
        { text: "Peça a data de nascimento logo depois de confirmar o nome, antes de enviar a segunda via.", stance: "GUIDANCE", refs: ["A1"], paragraph: 2 },
      ],
      card: { text: "Confirme a data de nascimento antes de enviar.", refs: ["A1"] },
    }
    const said = compose(brief, draft, [verdict("F1", "SUPPORTED", true), ["F2", { ...verdict("F2", "SUPPORTED", true)[1], repeats: "F1" }], verdict("CARD", "SUPPORTED")])
    expect(said.decisions.sentences[1]!.reasons).toContain("REDUNDANT")
    expect(said.message!.paragraphs).toHaveLength(1)
    // Sem o julgamento do verificador, palavras parecidas não tiram a frase.
    const notSaid = compose(brief, draft, [verdict("F1", "SUPPORTED", true), verdict("F2", "SUPPORTED", true), verdict("CARD", "SUPPORTED")])
    expect(notSaid.decisions.sentences[1]!.reasons).not.toContain("REDUNDANT")
  })
})

describe("regra lida no CONTEXTO da lista (defeito visto na validação focal: 'Estorno' tratado como obrigação)", () => {
  // Mesmo formato do §34 real: a abertura pede para AVALIAR alternativas; a operadora escolheu crédito em conta futura.
  const PAID = `${PROCEDURE_V1}
## 6. Conta já paga

Quando o cliente já tiver pago a cobrança contestada, avaliar:

- Crédito em conta futura;
- Estorno;
- Compensação;
- Transferência bancária, quando prevista.
`
  const transcript = [
    "Operador: Bom dia, meu nome é Ana. Com quem eu falo?",
    "Cliente: Bom dia, é a Sônia. Já paguei a fatura com a cobrança errada.",
    "Operador: Como a fatura já foi paga, se a contestação for aprovada o valor volta como crédito na próxima fatura.",
    "Cliente: Certo.",
    "Operador: Posso ajudar em mais alguma coisa?",
    "Cliente: Não, obrigada.",
  ].join("\n")
  function paidBrief(estornoEvidence: "SAME_AS_SIBLING" | "OMISSION" = "OMISSION") {
    const { context, line } = fixtureContext(PAID)
    const projection = projectTranscript(transcript)
    const quote = { turn: "T3", speaker: "OPERADOR", quote: "Como a fatura já foi paga, se a contestação for aprovada o valor volta como crédito na próxima fatura." }
    const analysis = verifyConfirmed({
      model: modelAnalysis({ criteria: [
        { line: line("Crédito em conta futura").handle, status: "MET", evidenceKind: "CONDUCT_OBSERVED", declaredActionTense: null, evidence: [quote], opportunityTurn: null, rationale: "Ofereceu crédito na próxima fatura.", materiality: "MEDIUM", guidance: null, whyItMatters: null },
        estornoEvidence === "SAME_AS_SIBLING"
          ? { line: line("- Estorno").handle, status: "NOT_MET", evidenceKind: "CONDUCT_OBSERVED", declaredActionTense: null, evidence: [quote], opportunityTurn: null, rationale: "Ofereceu crédito em vez de estorno.", materiality: "HIGH", guidance: { moment: "Quando a conta já estiver paga", condition: null, action: "realize o estorno", ruleLines: [line("- Estorno").handle] }, whyItMatters: null }
          : { line: line("- Estorno").handle, status: "NOT_MET", evidenceKind: "OMISSION", declaredActionTense: null, evidence: [], opportunityTurn: "T3", rationale: "Não avaliou o estorno.", materiality: "HIGH", guidance: { moment: "Quando a conta já estiver paga", condition: null, action: "avalie o estorno", ruleLines: [line("- Estorno").handle] }, whyItMatters: null },
      ] }, { pathSections: [] }),
      context, projection, transcriptStatus: transcriptStatusOf(projection), interactionId: INTERACTION_ID, subjectAnchoredDocumentIds: [DOC_ID], repairAttempted: false,
    }, { turn: "T2", speaker: "CLIENTE", quote: "Já paguei a fatura com a cobrança errada." })
    return { analysis, brief: buildMonitoringBrief({ analysis, interactionId: INTERACTION_ID, label: "Contestação", dateLabel: "20/08/2026", selectionReason: "teste", criterionKeys: new Map(analysis.criteria.map((criterion) => [criterion.lineKey, criterionKeyOf(criterion.lineKey)])), documentTitles: new Map([[DOC_ID, "Procedimento"]]), documentVersions: new Map([[DOC_ID, 1]]), history: new Map(), delivered: new Set(), listContext: listContextOf(context) }) }
  }

  it("omissão real continua ponto — e a regra vai com a frase que ABRE a lista e com as alternativas avaliadas (redator, verificador, detalhes)", () => {
    const { brief } = paidBrief("OMISSION")
    const estorno = brief.developments.find((finding) => finding.title === "Estorno")!
    expect(estorno.rules[0]).toMatchObject({ text: "- Estorno;", leadIn: "Quando o cliente já tiver pago a cobrança contestada, avaliar:" })
    expect(estorno.sameList).toEqual(expect.arrayContaining([{ text: "- Crédito em conta futura;", status: "MET" }]))
    const facts = JSON.stringify(verificationFactsOf(brief))
    expect(facts).toContain("Quando o cliente já tiver pago a cobrança contestada, avaliar: … - Estorno;")
    expect(facts).toContain("Crédito em conta futura")
    expect(facts).toContain("cumprida")
    const message = assembleMessage(brief, applyVerdicts({ sentences: [{ text: "Como a conta já estava paga, vale avaliar também o estorno com o cliente.", stance: "GUIDANCE", refs: ["A1"], paragraph: 1 }], card: { text: "Avalie as opções para conta paga.", refs: ["A1"] } }, brief, new Map([verdict("F1", "SUPPORTED", true), verdict("CARD", "SUPPORTED")])))!
    expect(message.view.developments.find((detail) => detail.title === "Estorno")!.guidance.rules[0]!.text).toBe("Quando o cliente já tiver pago a cobrança contestada, avaliar:\n- Estorno;")
  })
})
