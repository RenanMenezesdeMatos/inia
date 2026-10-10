import { describe, expect, it } from "vitest"
import type { RawCheckpoint } from "../../agents/domain/process-assessment-contract.js"
import { verifyProcessAssessments } from "./process-assessment.js"
import { buildProcessItems } from "./process-items.js"
import { decideReliableItem, RELIABLE_FEEDBACK_AUTONOMOUS_POLICY, type ReliableWriterOutcome } from "./reliable-feedback-item.js"
import { effectViolations, genericWordingViolations, monitoringFallbackWording, resolveSlots, ruleTextsOf, toMonitoringWriterItem, validateIndicatorWording, validateMonitoringWording } from "./reliable-writer.js"
import { detectUnsupportedEffectClaims, effectClaimsInContent } from "./effect-claims.js"
import { renderEmittedText, supportMaterialsOf, type EmittedItem } from "./reliable-feedback-artifact.js"
import { isConditionalStep, ruleContextOf } from "./verified-omission.js"
import { canonicalComparison, INDICATOR_CANONICAL_CONTEXT_CONTRACT, type IndicatorCanonicalContext } from "../../indicators/domain/indicator-canonical-context.js"
import { SMOKE_CHECKPOINTS, SMOKE_CONTENT, SMOKE_DETAIL, SMOKE_DETAIL_EXAMPLE, SMOKE_DOC, SMOKE_INTERACTION, SMOKE_LABEL, SMOKE_LINES, smokeAssessment, smokePresented, smokePublished, smokeTranscript } from "../testing/contestacao-smoke-fixture.js"

const verify = (checkpoints: RawCheckpoint[] = Object.values(SMOKE_CHECKPOINTS), options: { transcript?: string; subject?: string | null } = {}) =>
  verifyProcessAssessments({ sources: [{ sourceRef: "SPECIALIST", assessment: smokeAssessment(checkpoints), presented: smokePresented }], interactionId: SMOKE_INTERACTION, transcript: options.transcript ?? smokeTranscript(), published: smokePublished, subject: options.subject === undefined ? "Contestação de cobrança" : options.subject })
const deadlineOf = (assessment: ReturnType<typeof verify>) => assessment.checkpoints.find((checkpoint) => checkpoint.requirement === "Explicar prazo")!
const ok: ReliableWriterOutcome = { invoked: true, writerError: null, source: "WRITER", violations: [], wording: { observed: "Na orientação sobre a análise, você não explicou o prazo.", whyItMatters: "", whatYouCanDo: "Informe o prazo exibido na ferramenta ao registrar a contestação." }, claimModes: { effect: "POTENTIAL_ONLY", action: "DECLARED_ONLY" } }

describe("V1.7.1 — contexto da regra no documento publicado", () => {
  it("etapa numa lista ordenada: seção, frase de abertura, posição; linha condicional é reconhecida", () => {
    expect(ruleContextOf(SMOKE_CONTENT, "Explicar prazo;")).toMatchObject({ heading: "15. Serviços digitais não reconhecidos", leadIn: "Se o cliente não reconhecer:", listKind: "ORDERED", stepPosition: 5, stepText: "Explicar prazo;" })
    expect(ruleContextOf(SMOKE_CONTENT, "Qual cobrança não reconhece;")).toMatchObject({ heading: "6. Escuta e identificação da solicitação", listKind: "UNORDERED", stepPosition: 2 })
    expect(isConditionalStep("Ativar bloqueio preventivo, se disponível e autorizado;")).toBe(true)
    expect(isConditionalStep("Cancelar a recorrência, quando permitido;")).toBe(true)
    expect(isConditionalStep("Explicar prazo;")).toBe(false)
  })
})

describe("V1.7.1 — VERIFIED OMISSION (§32)", () => {
  it("A) processo aplicável + etapa obrigatória + janela completa + oportunidade + ausência → VERIFIED_OMISSION", () => {
    const deadline = deadlineOf(verify())
    expect(deadline).toMatchObject({ status: "NOT_FOLLOWED", evidenceType: "VERIFIED_OMISSION", ownership: "AGENT", knowledge: { applicability: "VERIFIED", applicabilityBasis: "VERIFIED_OMISSION", leadIn: "Se o cliente não reconhecer:" }, knowledgeDetail: { quote: SMOKE_DETAIL } })
    expect(deadline.omission).toMatchObject({ verified: true, failure: null, checks: { processApplicable: true, checkpointRequired: true, windowComplete: true, opportunity: true, noMatchingAction: true }, signals: { siblingFollowedVerified: true, successorPerformed: true, matchingTurns: [] } })
    expect(deadline.omission!.signals.sectionAnchorTerms).toEqual(expect.arrayContaining(["servi", "recon"]))
  })
  it("B) transcrição incompleta/cortada → não verifica omissão (NOT_OBSERVABLE)", () => {
    for (const tail of [[`Operador: ${SMOKE_LINES.analysis}`, "Cliente: Tá bom.", "Operador: [transcrição interrompida]"], [`Operador: ${SMOKE_LINES.analysis}`, "Cliente: E o prazo…"]]) {
      const deadline = deadlineOf(verify(undefined, { transcript: smokeTranscript({ tail }) }))
      expect(deadline).toMatchObject({ status: "NOT_OBSERVABLE", statusDowngradeReason: "OMISSION_NOT_OBSERVABLE", evidenceType: null, omission: { verified: false, failure: "TRANSCRIPT_INCOMPLETE" } })
    }
  })
  it("C) a chamada termina antes da oportunidade (queda logo depois da etapa anterior) → NOT_OBSERVABLE", () => {
    const transcript = smokeTranscript({ tail: ["Evento: [ligação caiu]"] })
    const deadline = deadlineOf(verify([SMOKE_CHECKPOINTS.identify, SMOKE_CHECKPOINTS.register, { ...SMOKE_CHECKPOINTS.deadline, transcriptEvidence: [SMOKE_LINES.register] }], { transcript }))
    expect(deadline).toMatchObject({ status: "NOT_OBSERVABLE", omission: { failure: "NO_OPPORTUNITY" } })
    expect(buildProcessItems(verify([SMOKE_CHECKPOINTS.identify, SMOKE_CHECKPOINTS.register, { ...SMOKE_CHECKPOINTS.deadline, transcriptEvidence: [SMOKE_LINES.register] }], { transcript })).items.every((item) => item.section === "STRENGTH")).toBe(true)
  })
  it("D) etapa condicional: NOT_APPLICABLE declarado continua NOT_APPLICABLE; omissão proposta vira NOT_OBSERVABLE (nunca descumprimento)", () => {
    const declared = verify().checkpoints.find((checkpoint) => checkpoint.requirement.startsWith("Ativar bloqueio"))!
    expect(declared).toMatchObject({ status: "NOT_APPLICABLE", evidenceType: null })
    const proposed = verify([SMOKE_CHECKPOINTS.identify, SMOKE_CHECKPOINTS.register, { ...SMOKE_CHECKPOINTS.block, status: "NOT_FOLLOWED", evidenceType: "OMISSION", transcriptEvidence: [SMOKE_LINES.analysis] }]).checkpoints.find((checkpoint) => checkpoint.requirement.startsWith("Ativar bloqueio"))!
    expect(proposed).toMatchObject({ status: "NOT_OBSERVABLE", omission: { failure: "CHECKPOINT_CONDITIONAL", checks: { checkpointRequired: false } } })
  })
  it("E) paráfrase válida presente na janela → NÃO marca omissão (contraprova; vai ao QA, nunca autônomo)", () => {
    const paraphrase = "A área responsável analisa a contestação e o retorno sai em até cinco dias úteis, conforme a ferramenta."
    const deadline = deadlineOf(verify([SMOKE_CHECKPOINTS.identify, SMOKE_CHECKPOINTS.register, { ...SMOKE_CHECKPOINTS.deadline, transcriptEvidence: [paraphrase], knowledgeDetailQuote: SMOKE_DETAIL }], { transcript: smokeTranscript({ analysis: paraphrase }) }))
    expect(deadline).toMatchObject({ status: "NOT_FOLLOWED", evidenceType: "UNVERIFIED_OMISSION", knowledge: { applicability: "LITERAL_ONLY" }, omission: { verified: false, failure: "MATCHING_ACTION_FOUND" } })
    const exampleParaphrase = "Pode ficar tranquila: a análise leva até cinco dias úteis."
    const byExample = deadlineOf(verify([SMOKE_CHECKPOINTS.identify, SMOKE_CHECKPOINTS.register, { ...SMOKE_CHECKPOINTS.deadline, knowledgeDetailQuote: SMOKE_DETAIL_EXAMPLE }], { transcript: smokeTranscript({ tail: [`Operador: ${SMOKE_LINES.analysis}`, `Operador: ${exampleParaphrase}`, "Cliente: Obrigada.", "Operador: A Conecta agradece a sua ligação."] }) }))
    expect(byExample.omission).toMatchObject({ verified: false, failure: "MATCHING_ACTION_FOUND" })
    const [item] = buildProcessItems(verify([SMOKE_CHECKPOINTS.identify, SMOKE_CHECKPOINTS.register, { ...SMOKE_CHECKPOINTS.deadline, transcriptEvidence: [paraphrase] }], { transcript: smokeTranscript({ analysis: paraphrase }) })).items
    expect(decideReliableItem(item!, ok, RELIABLE_FEEDBACK_AUTONOMOUS_POLICY)).toMatchObject({ disposition: "HOLD_FOR_QA", reasons: ["KNOWLEDGE_APPLICABILITY_UNVERIFIED"] })
  })
  it("F) processo incerto (nenhuma outra etapa cumprida com regra ancorada) → não verifica omissão", () => {
    // V1.7.1j — o irmão precisa continuar SEM âncora: "Registrar protocolo" com uma fala que não trata de protocolo nem realiza a ação
    // (a fala original do protocolo passou a ancorar pelo próprio objeto desde que o conflito exige ação + objeto).
    const unrelated = { ...SMOKE_CHECKPOINTS.protocol, transcriptEvidence: [SMOKE_LINES.identify] }
    const deadline = deadlineOf(verify([unrelated, SMOKE_CHECKPOINTS.deadline], { subject: null }))
    expect(deadline).toMatchObject({ status: "NOT_FOLLOWED", evidenceType: "UNVERIFIED_OMISSION", omission: { failure: "PROCESS_APPLICABILITY_UNVERIFIED", signals: { siblingFollowedVerified: false } } })
  })
  it("G) omissão verificada + regra verificada + redator válido → READY sob AUTONOMOUS_V1 (omissão não vai ao QA só por ser omissão)", () => {
    const { items } = buildProcessItems(verify())
    const deadline = items.find((item) => item.process?.stepTitle === "Explicar prazo")!
    expect(deadline).toMatchObject({ section: "OPPORTUNITY", kind: "MONITORING_DEVELOPMENT_POINT", process: { evidenceType: "VERIFIED_OMISSION", stepTitle: "Explicar prazo" }, knowledge: { applicabilityBasis: "VERIFIED_OMISSION", detail: { quote: SMOKE_DETAIL } } })
    expect(decideReliableItem(deadline, ok, RELIABLE_FEEDBACK_AUTONOMOUS_POLICY)).toMatchObject({ disposition: "READY", reasons: ["AUTONOMY_CRITERIA_MET"] })
  })
  it("tipos de evidência distintos: ação observada, ação declarada, omissão verificada", () => {
    const assessment = verify()
    const types = Object.fromEntries(assessment.checkpoints.map((checkpoint) => [checkpoint.requirement, checkpoint.evidenceType]))
    expect(types).toMatchObject({ "Qual cobrança não reconhece": "OBSERVED_ACTION", "Registrar contestação": "OBSERVED_DECLARATION", "Explicar prazo": "VERIFIED_OMISSION", "Registrar protocolo": "OBSERVED_DECLARATION" })
    expect(assessment.summary).toMatchObject({ verifiedOmissions: 1, unverifiedOmissions: 0 })
  })
  it("NOT_FOLLOWED OBSERVED (sem evidenceType OMISSION) nunca usa a omissão verificada; V1.7.1g: vale a âncora estruturada do desvio observado", () => {
    const observed = deadlineOf(verify([SMOKE_CHECKPOINTS.identify, SMOKE_CHECKPOINTS.register, { ...SMOKE_CHECKPOINTS.deadline, evidenceType: "OBSERVED" }]))
    expect(observed).toMatchObject({ status: "NOT_FOLLOWED", evidenceType: "OBSERVED_ACTION", omission: null, knowledge: { applicability: "VERIFIED", applicabilityBasis: "STRUCTURED_ANCHOR", structuredAnchor: { basis: "OBSERVED_DEVIATION" } } })
  })
})

describe("V1.7.1 — efeito garantido em TODOS os campos (§33)", () => {
  const { items } = buildProcessItems(verify())
  const register = toMonitoringWriterItem(items.find((item) => item.process?.stepTitle === "Registrar contestação")!, "ITEM_1")
  const base = { observed: "Você informou que registraria a contestação.", whyItMatters: "", whatYouCanDo: "Continue registrando a contestação nos próximos atendimentos." }
  it("'garante' é bloqueado em observed, whyItMatters e whatYouCanDo (o caso real do smoke estava em whatYouCanDo)", () => {
    expect(validateMonitoringWording(base, register, SMOKE_LABEL)).toEqual([])
    for (const slot of ["observed", "whyItMatters", "whatYouCanDo"] as const) {
      const wording = { ...base, [slot]: `${slot === "observed" ? "Você informou que registraria a contestação, o que" : "Registrar a contestação"} garante que a solicitação seja encaminhada conforme o fluxo oficial.` }
      expect(validateMonitoringWording(wording, register, SMOKE_LABEL), slot).toContain("GUARANTEED_EFFECT")
    }
    expect(validateMonitoringWording({ ...base, whatYouCanDo: "Continuar formalizando o registro da contestação garante que a solicitação seja encaminhada conforme o fluxo oficial." }, register, SMOKE_LABEL)).toContain("GUARANTEED_EFFECT")
  })
  it("todas as formas: assegura, faz com que, vai evitar, elimina, necessariamente, sempre resulta, causa — e o que é permitido", () => {
    for (const text of ["Isso assegura o encaminhamento.", "Isso faz com que o pedido ande.", "Isso vai evitar novas ligações.", "Isso elimina retrabalho.", "Necessariamente o cliente volta.", "Isso sempre resulta em crédito.", "A falta do prazo causa novas ligações."]) expect(detectUnsupportedEffectClaims(text), text).not.toEqual([])
    for (const text of ["Isso pode ajudar o cliente a acompanhar.", "Informar o prazo pode evitar novas ligações.", "Informe o prazo para evitar dúvidas.", "A causa da cobrança foi explicada.", "A garantia do aparelho foi citada.", "“garante que sim”, disse o cliente."]) expect(detectUnsupportedEffectClaims(text), text).toEqual([])
    // Permitido quando a PRÓPRIA regra oficial sustenta a relação.
    expect(detectUnsupportedEffectClaims("Isso garante o registro.", ["O protocolo garante o registro da contestação."])).toEqual([])
  })
  it("projeção normalizada: qualquer campo de texto (inclusive um campo novo) é checado", () => {
    expect(effectClaimsInContent({ observed: "ok", nested: { strength: "Isso garante tudo." }, recommendation: "Isso vai reduzir o retrabalho." })).toHaveLength(2)
    expect(effectViolations({ title: "Garante o atendimento" }, [])).toEqual(["GUARANTEED_EFFECT"])
  })
  it("fallback: nenhum fallback de monitoria afirma efeito", () => {
    for (const item of items) {
      const writerItem = toMonitoringWriterItem(item, "ITEM_1")
      expect(effectClaimsInContent(monitoringFallbackWording(writerItem), ruleTextsOf(writerItem)), item.claimRef).toEqual([])
    }
  })
  it("indicador: efeito garantido também em whatYouCanDo", () => {
    const canonical: IndicatorCanonicalContext = { contract: INDICATOR_CANONICAL_CONTEXT_CONTRACT, indicator: { id: "i", code: "TMA", name: "TMA", unit: "SECONDS", direction: "LOWER" }, measurement: { id: "m", subjectId: "p", value: 420, periodStart: "2026-09-01", periodEnd: "2026-09-30", granularity: "MONTHLY" }, target: { value: 400, source: "TEAM", goalId: "g" }, ...canonicalComparison(420, 400, "LOWER"), provenance: { source: "indicator_measurements+goals", loadedAt: "2026-10-01T00:00:00Z" } }
    const item = { slot: "ITEM_1", section: "OPPORTUNITY" as const, polarity: "NEGATIVE" as const, safeMeaning: "s", guidanceSource: "COACHING_SUGGESTION" as const, grounding: "OFFICIAL_PROCEDURE" as const, canonical: { indicatorName: "TMA", value: "420", target: "400", direction: "menor é melhor", comparison: "fora da meta", period: "setembro de 2026" }, analysis: null, diagnosis: null }
    expect(validateIndicatorWording({ observed: "No período de setembro de 2026, o resultado oficial de TMA foi 420.", whyItMatters: "", whatYouCanDo: "Seguir o roteiro garante um atendimento mais curto." }, item, canonical)).toContain("GUARANTEED_EFFECT")
  })
})

describe("V1.7.1 — feedback específico e com evidência (§34/§35)", () => {
  const { items } = buildProcessItems(verify())
  it("texto genérico num item de etapa é rejeitado (GENERIC_WORDING) e o fallback descreve o comportamento (V1.7.1e)", () => {
    const deadline = toMonitoringWriterItem(items.find((item) => item.process?.stepTitle === "Explicar prazo")!, "ITEM_1")
    const generic = { observed: "Procure ser mais claro nas orientações.", whyItMatters: "", whatYouCanDo: "Busque confirmar as informações antes do encerramento." }
    expect(genericWordingViolations(generic, deadline)).toEqual(["GENERIC_WORDING"])
    const [resolved] = resolveSlots([deadline], { items: [{ slot: "ITEM_1", ...generic }] }, (wording, item) => validateMonitoringWording(wording, item, SMOKE_LABEL), monitoringFallbackWording)
    expect(resolved).toMatchObject({ source: "FALLBACK", violations: expect.arrayContaining(["GENERIC_WORDING"]) })
    // V1.7.1e — BEHAVIOR-FIRST: o que faltou nesta chamada (ação literal da regra), nunca "a etapa “Explicar prazo”".
    expect(resolved!.wording.observed).toBe("Nesta chamada, faltou explicar prazo: no momento mostrado abaixo, isso não apareceu.")
    // O "como aplicar" vem da regra de COMO cumprir (detalhe verificado da base), em forma de ação — nunca "siga o procedimento".
    expect(resolved!.wording.whatYouCanDo).toBe("Na próxima chamada, informe o prazo exibido na ferramenta.")
    expect(validateMonitoringWording(resolved!.wording, deadline, SMOKE_LABEL)).toEqual([])
  })
  it("a publicação carrega a evidência da chamada, o trecho da base (com abertura e detalhe), o documento, a seção e o link — a partir da ESTRUTURA", () => {
    const emitted: EmittedItem[] = items.filter((item) => item.section === "OPPORTUNITY" || item.section === "STRENGTH").map((item) => ({ index: item.index, section: item.section as "STRENGTH" | "OPPORTUNITY", sectionLabel: item.section === "STRENGTH" ? "Ponto forte" : "Ponto de desenvolvimento", wording: { observed: "Procure ser mais claro.", whyItMatters: "", whatYouCanDo: "" }, wordingSource: "PROPOSED", qaStatus: "NOT_SELECTED_FOR_QA", facts: item.facts, knowledge: item.knowledge, grounding: item.grounding, process: item.process }))
    const text = renderEmittedText(SMOKE_LABEL, emitted)
    // Mesmo com o texto mais pobre possível do redator, a evidência não some: é renderizada pelo sistema.
    // V1.7.1e — título = ASSUNTO do comportamento (nunca "1. Ponto de desenvolvimento · <etapa>").
    expect(text).toContain("### Prazo da análise")
    expect(text).not.toMatch(/\*\*\d+\. Ponto de desenvolvimento/)
    expect(text).toContain("_Na chamada analisada, isto não apareceu. No momento em que caberia:_")
    expect(text).toContain(`> Você disse: “${SMOKE_LINES.analysis}”`)
    // V1.7.1d — PROVENIÊNCIA POR TRECHO: a regra é da seção 15 e o detalhe é da seção 35 (antes os dois apareciam como 15).
    expect(text).toContain("> “Se o cliente não reconhecer: … Explicar prazo;”")
    expect(text).toContain(`> _Seção “Prazo da análise”:_ “${SMOKE_DETAIL}”`)
    // V1.7.1e — o LINK do processo no próprio achado: documento · seção · "Abrir processo ↗".
    expect(text).toContain(`**O processo orienta**`)
    expect(text).toContain(`_Procedimento Operacional — Contestação de Contas Móvel · Seção: Serviços digitais não reconhecidos_ — [Abrir processo ↗](/materiais/${SMOKE_DOC})`)
    // V1.7.1m — título comportamental ("Qual cobrança não reconhece" → identificação da cobrança).
    // V1.7.2 — o ponto cumprido vai para "O que manter"; a pergunta verificada continua no item (evidência).
    expect(text).toContain("identificou a cobrança que o cliente não reconhecia")
    expect(emitted.find((item) => item.process?.behavior?.code === "IDENTIFY_CHARGE")!.facts.map((fact) => fact.text)).toContain(SMOKE_LINES.identify)
    expect(text).not.toContain("Trecho da conversa")
    expect(supportMaterialsOf(emitted)).toEqual([expect.objectContaining({ materialId: SMOKE_DOC, title: "Procedimento Operacional — Contestação de Contas Móvel" })])
  })
  it("citação dentro do Markdown é escapada: fala com * _ [ ] nunca vira formatação", () => {
    const item = items[0]!
    const emitted: EmittedItem = { index: 0, section: "OPPORTUNITY", sectionLabel: "Ponto de desenvolvimento", wording: { observed: "o", whyItMatters: "", whatYouCanDo: "" }, wordingSource: "PROPOSED", qaStatus: "NOT_SELECTED_FOR_QA", facts: [{ role: "OPERADOR", text: "valor *promocional* [link](x)", truncated: false, masked: false }], knowledge: item.knowledge, grounding: item.grounding, process: item.process }
    expect(renderEmittedText("L", [emitted])).toContain("> Você disse: “valor \\*promocional\\* \\[link\\](x)”")
  })
})
