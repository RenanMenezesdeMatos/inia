import { describe, expect, it } from "vitest"
import type { RawCheckpoint, RawProcessAssessment } from "../../agents/domain/process-assessment-contract.js"
import { parseWriterResponse } from "../../interaction-feedback/domain/feedback-writer-prompt.js"
import { normalizeInvestigationResult } from "./feedback-investigation-result.js"
import { verifyKnowledgeQuote, verifyProcessAssessments, type PresentedKnowledgeExcerpt, type PublishedKnowledgeDocument } from "./process-assessment.js"
import { buildProcessItems, PROCESS_ITEM_ORDER_VERSION } from "./process-items.js"
import { decideReliableItem, RELIABLE_FEEDBACK_AUTONOMOUS_POLICY, RELIABLE_FEEDBACK_PILOT_POLICY, type ReliableWriterOutcome } from "./reliable-feedback-item.js"
import { groundingViolations, monitoringFallbackWording, toMonitoringWriterItem, validateMonitoringWording } from "./reliable-writer.js"
import { reliableWriterItemSchemaV2 } from "./reliable-writer-prompts.js"
import { renderEmittedText, renderItemBlocks, supportMaterialsOf, type EmittedItem } from "./reliable-feedback-artifact.js"

const ORG = "00000000-0000-4000-8000-000000000001"
const OPERATOR = "11111111-1111-4111-8111-111111111111"
const INTERACTION = "22222222-2222-4222-8222-222222222222"
const DOC = "44444444-4444-4444-8444-444444444444"
const OTHER_DOC = "55555555-5555-4555-8555-555555555555"

const TRANSCRIPT = [
  "[00:01–00:04] CLIENTE: Oi, quero a segunda via da fatura de setembro.",
  "[00:05–00:09] OPERADOR: Posso enviar a segunda via por SMS ou por e-mail, qual prefere?",
  "[00:10–00:12] CLIENTE: Por e-mail.",
  "[00:13–00:20] OPERADOR: Pronto, enviei a segunda via da fatura para o seu e-mail cadastrado.",
].join("\n")

const TITLE = "Segunda Via de Fatura"
const ENVIO = "Ofereça o envio da segunda via por SMS ou e-mail e confirme o canal escolhido pelo cliente."
const PRAZO = "Informe o prazo de compensação do pagamento de até três dias úteis."
const CONTENT = `## Envio\n${ENVIO}\n\n## Prazo\n${PRAZO}`
const published = new Map<string, PublishedKnowledgeDocument>([[DOC, { documentId: DOC, title: TITLE, content: CONTENT, version: 3 }]])
const presented: PresentedKnowledgeExcerpt[] = [
  { documentId: DOC, documentTitle: TITLE, heading: "Envio", excerpt: ENVIO },
  { documentId: DOC, documentTitle: TITLE, heading: "Prazo", excerpt: PRAZO },
]

const checkpoint = (overrides: Partial<RawCheckpoint> = {}): RawCheckpoint => ({
  requirement: "Oferecer o envio por SMS ou e-mail", evidenceType: "OBSERVED", knowledgeDetailQuote: null,
  status: "FOLLOWED",
  transcriptEvidence: ["Posso enviar a segunda via por SMS ou por e-mail, qual prefere?"],
  knowledgeQuote: ENVIO,
  guidance: { source: "OFFICIAL_PROCEDURE", text: "Continue oferecendo os dois canais." },
  uncertainty: null,
  ...overrides,
})
const assessmentOf = (checkpoints: RawCheckpoint[], documentTitle = TITLE): RawProcessAssessment => ({ processes: [{ documentTitle, checkpoints }] })
const verify = (checkpoints: RawCheckpoint[], options: { presented?: PresentedKnowledgeExcerpt[]; published?: Map<string, PublishedKnowledgeDocument>; documentTitle?: string } = {}) =>
  verifyProcessAssessments({ sources: [{ sourceRef: "AGENT", assessment: assessmentOf(checkpoints, options.documentTitle), presented: options.presented ?? presented }], interactionId: INTERACTION, transcript: TRANSCRIPT, published: options.published ?? published })

const PRAZO_NOT_FOLLOWED = checkpoint({ requirement: "Informar o prazo de compensação", status: "NOT_FOLLOWED", transcriptEvidence: ["Pronto, enviei a segunda via da fatura para o seu e-mail cadastrado."], knowledgeQuote: PRAZO, guidance: { source: "OFFICIAL_PROCEDURE", text: "Informe o prazo de compensação de até três dias úteis." } })

describe("V1.6.0 — regra da base: literal na versão PUBLICADA, dentro de um trecho APRESENTADO nesta execução, e ancorada", () => {
  const knowledge = (quote: string | null, extra: { presented?: PresentedKnowledgeExcerpt[]; published?: Map<string, PublishedKnowledgeDocument>; title?: string; anchors?: string[] } = {}) =>
    verifyKnowledgeQuote({ documentTitle: extra.title ?? TITLE, quote, presented: extra.presented ?? presented, published: extra.published ?? published, anchorTexts: extra.anchors ?? ["Posso enviar a segunda via por SMS ou por e-mail, qual prefere?"] })

  it("VERIFIED: literal, apresentado e com ≥ 2 termos em comum com a fala verificada", () => {
    expect(knowledge(ENVIO)).toMatchObject({ documentId: DOC, version: 3, heading: "Envio", literalInPublished: true, presentedInRun: true, applicability: "VERIFIED", failure: null })
  })
  it("LITERAL_ONLY: literal e apresentado, mas sem âncora na conversa (documento recuperado ≠ aplicável)", () => {
    expect(knowledge(PRAZO)).toMatchObject({ applicability: "LITERAL_ONLY", failure: null })
  })
  it("formatação (aspas, markdown, espaços) não quebra a literalidade; palavras trocadas sim", () => {
    expect(knowledge(`“${ENVIO.replace(/ /g, "  ")}”`).applicability).toBe("VERIFIED")
    expect(knowledge(ENVIO.replace("Ofereça", "Sugira"))).toMatchObject({ applicability: "NOT_VERIFIED", failure: "QUOTE_NOT_LITERAL" })
  })
  it("falhas estruturais nunca viram base: sem citação, curta, documento não apresentado, ambíguo, não publicado", () => {
    expect(knowledge(null).failure).toBe("NO_QUOTE")
    expect(knowledge("Ofereça.").failure).toBe("QUOTE_TOO_SHORT")
    expect(knowledge(ENVIO, { title: "Outro documento" }).failure).toBe("DOCUMENT_NOT_PRESENTED")
    expect(knowledge(ENVIO, { presented: [...presented, { documentId: OTHER_DOC, documentTitle: TITLE, heading: "", excerpt: ENVIO }] }).failure).toBe("DOCUMENT_AMBIGUOUS")
    expect(knowledge(ENVIO, { published: new Map() }).failure).toBe("DOCUMENT_NOT_PUBLISHED")
  })
  it("versão publicada mudou: trecho que o modelo viu mas que não está mais na versão PUBLICADA não é base", () => {
    const changed = new Map([[DOC, { documentId: DOC, title: TITLE, content: `## Prazo\n${PRAZO}`, version: 4 }]])
    expect(knowledge(ENVIO, { published: changed })).toMatchObject({ applicability: "NOT_VERIFIED", failure: "QUOTE_NOT_LITERAL", version: 4 })
  })
  it("literal no documento, mas fora dos trechos que ENTRARAM na execução → não verificado", () => {
    expect(knowledge(PRAZO, { presented: [presented[0]!] })).toMatchObject({ applicability: "NOT_VERIFIED", failure: "QUOTE_NOT_IN_PRESENTED_EXCERPT", literalInPublished: true })
  })
})

describe("V1.6.0 — etapa de processo: evidência da transcrição e dono da conduta", () => {
  it("FOLLOWED com fala literal do operador e regra verificada permanece FOLLOWED (dono = operador)", () => {
    const [verified] = verify([checkpoint()]).checkpoints
    expect(verified).toMatchObject({ status: "FOLLOWED", statusDowngradeReason: null, ownership: "AGENT", knowledge: { applicability: "VERIFIED" }, guidance: { grounding: "OFFICIAL_PROCEDURE", downgradeReason: null } })
    expect(verified!.transcriptEvidence[0]).toMatchObject({ speaker: "OPERADOR" })
  })
  it("paráfrase, só fala do cliente ou nenhuma evidência → NOT_OBSERVABLE (ausência de evidência nunca vira cumpriu/descumpriu)", () => {
    const summary = verify([
      checkpoint({ transcriptEvidence: ["Ofereci SMS e e-mail ao cliente."] }),
      checkpoint({ status: "NOT_FOLLOWED", transcriptEvidence: ["Por e-mail."] }),
      checkpoint({ transcriptEvidence: [] }),
    ])
    expect(summary.checkpoints.map((entry) => [entry.status, entry.statusDowngradeReason])).toEqual([
      ["NOT_OBSERVABLE", "EVIDENCE_NOT_VERIFIED"],
      ["NOT_OBSERVABLE", "NO_OPERATOR_EVIDENCE"],
      ["NOT_OBSERVABLE", "NO_EVIDENCE"],
    ])
    expect(summary.summary).toMatchObject({ NOT_OBSERVABLE: 3, statusDowngrades: 3 })
  })
  it("regra ALL: uma parte não verificada contamina a etapa", () => {
    const [verified] = verify([checkpoint({ transcriptEvidence: ["Posso enviar a segunda via por SMS ou por e-mail, qual prefere?", "Vou mandar agora mesmo pelo WhatsApp."] })]).checkpoints
    expect(verified).toMatchObject({ status: "NOT_OBSERVABLE", statusDowngradeReason: "EVIDENCE_NOT_VERIFIED" })
  })
  it("orientação: oficial sem base verificada e padrão de pares DECLARADO pelo modelo são rebaixados a NO_GROUNDED_GUIDANCE (pares só vêm do sistema)", () => {
    const [noBase, peer] = verify([checkpoint({ knowledgeQuote: "Trecho que não existe no documento publicado." }), checkpoint({ guidance: { source: "VERIFIED_PEER_PATTERN", text: "Os colegas fazem assim." } })]).checkpoints
    expect(noBase!.guidance).toEqual({ declared: "OFFICIAL_PROCEDURE", grounding: "NO_GROUNDED_GUIDANCE", text: null, downgradeReason: "GUIDANCE_WITHOUT_VERIFIED_KNOWLEDGE" })
    expect(peer!.guidance).toMatchObject({ grounding: "NO_GROUNDED_GUIDANCE", text: null, downgradeReason: "PEER_EVIDENCE_NOT_SUPPORTED" })
  })
  it("Orquestrador: cada especialista é verificado contra os trechos que ELE viu", () => {
    const result = verifyProcessAssessments({
      sources: [
        { sourceRef: "especialista_a", assessment: assessmentOf([checkpoint()]), presented },
        { sourceRef: "especialista_b", assessment: assessmentOf([checkpoint()]), presented: [] },
      ],
      interactionId: INTERACTION, transcript: TRANSCRIPT, published,
    })
    expect(result.checkpoints.map((entry) => entry.knowledge?.failure ?? null)).toEqual([null, "DOCUMENT_NOT_PRESENTED"])
  })
})

describe("V1.6.0 — itens: ponto forte, ponto de desenvolvimento, bloqueio e materialidade", () => {
  it("FOLLOWED → PONTO FORTE e NOT_FOLLOWED → PONTO DE DESENVOLVIMENTO, com a regra, o link e a etapa", () => {
    const { items } = buildProcessItems(verify([checkpoint(), PRAZO_NOT_FOLLOWED]))
    expect(items.map((item) => [item.section, item.kind, item.polarity])).toEqual([["OPPORTUNITY", "MONITORING_DEVELOPMENT_POINT", "NEGATIVE"], ["STRENGTH", "MONITORING_STRENGTH", "POSITIVE"]])
    expect(items[1]).toMatchObject({ structuralBlock: null, grounding: "OFFICIAL_PROCEDURE", knowledge: { documentId: DOC, documentTitle: TITLE, quote: ENVIO, applicability: "VERIFIED", href: `/materiais/${DOC}` }, process: { requirement: "Oferecer o envio por SMS ou e-mail", status: "FOLLOWED" } })
    expect(items[0]!.knowledge).toMatchObject({ applicability: "LITERAL_ONLY" })
  })
  it("só ponto forte, sem desenvolvimento: nenhuma seção é obrigatória", () => {
    const { items } = buildProcessItems(verify([checkpoint(), checkpoint({ status: "NOT_APPLICABLE", transcriptEvidence: [] })]))
    expect(items.map((item) => item.section)).toEqual(["STRENGTH"])
  })
  it("etapa evidenciada sem regra verificada vira item BLOQUEADO (auditoria), nunca feedback sem base", () => {
    const { items } = buildProcessItems(verify([checkpoint({ knowledgeQuote: null })]))
    expect(items[0]).toMatchObject({ structuralBlock: "KNOWLEDGE_NOT_VERIFIED", knowledge: null, grounding: "NO_GROUNDED_GUIDANCE", analysis: null })
  })
  it("V1.7.1a — sem limite editorial: todas as etapas evidenciadas viram item, na ordem de prioridade; etapas IGUAIS são fundidas com linhagem", () => {
    // C1–C4 = o MESMO desenvolvimento (regra só LITERAL_ONLY); C5 = desenvolvimento com regra VERIFIED; C6–C8 = o MESMO ponto forte.
    const devVerified = { ...PRAZO_NOT_FOLLOWED, knowledgeQuote: ENVIO }
    const assessment = verify([PRAZO_NOT_FOLLOWED, PRAZO_NOT_FOLLOWED, PRAZO_NOT_FOLLOWED, PRAZO_NOT_FOLLOWED, devVerified, checkpoint(), checkpoint(), checkpoint()])
    const { items, excludedForMateriality } = buildProcessItems(assessment)
    expect(items.map((item) => [item.section, item.claimRef])).toEqual([["OPPORTUNITY", "P1.C5"], ["OPPORTUNITY", "P1.C1"], ["STRENGTH", "P1.C6"]])
    expect(items.find((item) => item.claimRef === "P1.C1")!.collapsedCheckpoints).toEqual(["P1.C2", "P1.C3", "P1.C4"])
    expect(items.find((item) => item.claimRef === "P1.C6")!.collapsedCheckpoints).toEqual(["P1.C7", "P1.C8"])
    expect(items.map((item) => item.priority!.rank)).toEqual([1, 2, 3])
    expect(items[0]!.priority).toMatchObject({ policy: PROCESS_ITEM_ORDER_VERSION, basis: ["DEVELOPMENT_FIRST", "RULE_VERIFIED", "PROCEDURE_ORDER"] })
    expect(excludedForMateriality).toEqual([])
  })
})

describe("V1.6.0 — política: ponto forte liberado; regra só literal (sem âncora) vai a QA", () => {
  const { items } = buildProcessItems(verify([checkpoint(), PRAZO_NOT_FOLLOWED]))
  const strength = items.find((item) => item.section === "STRENGTH")!
  const development = items.find((item) => item.section === "OPPORTUNITY")!
  const writer: ReliableWriterOutcome = { invoked: true, writerError: null, source: "WRITER", violations: [], wording: { observed: "Você ofereceu SMS ou e-mail.", whyItMatters: "", whatYouCanDo: "" }, claimModes: { effect: "POTENTIAL_ONLY", action: "DECLARED_ONLY" } }
  it("MONITORING_STRENGTH com regra VERIFIED sob AUTONOMOUS_V1 → READY; sob PILOT_V1 → HOLD_FOR_QA", () => {
    expect(decideReliableItem(strength, writer, RELIABLE_FEEDBACK_AUTONOMOUS_POLICY)).toMatchObject({ disposition: "READY", reasons: ["AUTONOMY_CRITERIA_MET"] })
    expect(decideReliableItem(strength, writer, RELIABLE_FEEDBACK_PILOT_POLICY).disposition).toBe("HOLD_FOR_QA")
  })
  it("regra LITERAL_ONLY nunca é autônoma (KNOWLEDGE_APPLICABILITY_UNVERIFIED)", () => {
    expect(decideReliableItem(development, writer, RELIABLE_FEEDBACK_AUTONOMOUS_POLICY)).toMatchObject({ disposition: "HOLD_FOR_QA", reasons: ["KNOWLEDGE_APPLICABILITY_UNVERIFIED"] })
  })
  it("BLOCKED por base não verificada: nenhuma política libera", () => {
    const [blocked] = buildProcessItems(verify([checkpoint({ knowledgeQuote: null })])).items
    expect(decideReliableItem(blocked!, writer, RELIABLE_FEEDBACK_AUTONOMOUS_POLICY)).toMatchObject({ disposition: "BLOCKED", reasons: ["KNOWLEDGE_NOT_VERIFIED"] })
  })
})

describe("V1.6.0 — redação com grounding: vazio = sem fundamento; nunca dica genérica", () => {
  const { items } = buildProcessItems(verify([checkpoint(), PRAZO_NOT_FOLLOWED]))
  it("whatYouCanDo só com orientação oficial; whyItMatters só com regra da base", () => {
    expect(groundingViolations({ observed: "o", whyItMatters: "Importa.", whatYouCanDo: "Faça X." }, { grounding: "NO_GROUNDED_GUIDANCE", hasKnowledge: false })).toEqual(["UNGROUNDED_GUIDANCE", "UNGROUNDED_RELEVANCE"])
    expect(groundingViolations({ observed: "o", whyItMatters: "", whatYouCanDo: "" }, { grounding: "NO_GROUNDED_GUIDANCE", hasKnowledge: false })).toEqual([])
    expect(groundingViolations({ observed: "o", whyItMatters: "Importa.", whatYouCanDo: "Faça X." }, { grounding: "OFFICIAL_PROCEDURE", hasKnowledge: true })).toEqual([])
  })
  it("o item com regra vai ao redator como KB_RULE (documento + trecho), com a etapa e o grounding", () => {
    const writerItem = toMonitoringWriterItem(items[1]!, "ITEM_2")
    expect(writerItem).toMatchObject({ grounding: "OFFICIAL_PROCEDURE", requirement: "Oferecer o envio por SMS ou e-mail", guidance: { source: "KB_RULE", knowledge: { documentTitle: TITLE, ruleText: ENVIO } } })
    expect(validateMonitoringWording({ observed: "Nesta interação você ofereceu a segunda via por SMS ou e-mail.", whyItMatters: "", whatYouCanDo: "" }, writerItem, "Atendimento")).toEqual([])
  })
  it("fallback determinístico (V1.7.1e): específico — fala do ASSUNTO do ponto (nunca \"a etapa …\"); fala e regra ficam com a renderização do sistema; sem regra, só o fato", () => {
    const writerItem = toMonitoringWriterItem(items[1]!, "ITEM_2")
    const withRule = monitoringFallbackWording(writerItem)
    // A regra está no imperativo ("Ofereça…"): sem ação no infinitivo, a formulação conservadora cita o assunto (seção).
    expect(withRule.observed).toBe("Nesta chamada você conduziu bem “Envio”, como o procedimento orienta.")
    expect(withRule.observed).not.toContain("etapa")
    expect(withRule.whyItMatters).toBe("")
    expect(validateMonitoringWording(withRule, writerItem, "Atendimento")).toEqual([])
    const [blocked] = buildProcessItems(verify([checkpoint({ knowledgeQuote: null })])).items
    const bare = monitoringFallbackWording(toMonitoringWriterItem({ ...blocked!, section: "OPPORTUNITY" }, "ITEM_1"))
    expect(bare.whyItMatters).toBe("")
    expect(bare.whatYouCanDo).toBe("")
  })
  it("schema V2 do redator: null vira \"\" (sem fundamento) e observed continua obrigatório", () => {
    const ok = parseWriterResponse(JSON.stringify({ items: [{ itemRef: "ITEM_1", observed: "Você ofereceu os canais.", whyItMatters: null, whatYouCanDo: null }] }), ["ITEM_1"], reliableWriterItemSchemaV2)
    expect(ok).toMatchObject({ ok: true, output: { items: [{ slot: "ITEM_1", whyItMatters: "", whatYouCanDo: "" }] } })
    expect(parseWriterResponse(JSON.stringify({ items: [{ itemRef: "ITEM_1", observed: null, whyItMatters: null, whatYouCanDo: null }] }), ["ITEM_1"], reliableWriterItemSchemaV2)).toMatchObject({ ok: false, error: "WRITER_SCHEMA_INVALID" })
  })
})

describe("V1.6.0 — formato editorial e material de apoio", () => {
  const knowledge = { documentId: DOC, documentTitle: TITLE, heading: "Envio", version: 3, quote: ENVIO, applicability: "VERIFIED" as const, href: `/materiais/${DOC}` }
  const item = (overrides: Partial<EmittedItem> = {}): EmittedItem => ({ index: 0, section: "STRENGTH", sectionLabel: "Ponto forte", wording: { observed: "Você ofereceu os dois canais.", whyItMatters: "", whatYouCanDo: "" }, wordingSource: "PROPOSED", qaStatus: "NOT_SELECTED_FOR_QA", facts: [{ role: "OPERADOR", text: "Posso enviar…", truncated: false, masked: false }], knowledge, grounding: "OFFICIAL_PROCEDURE", process: null, ...overrides })
  it("seção vazia é omitida (nunca preenchida para completar o formato); a base aparece citada", () => {
    // V1.7.1e — a base no PRÓPRIO ponto: trecho, documento · seção e o link do processo.
    expect(renderItemBlocks(item())).toEqual(["**Ponto forte**", "Você ofereceu os dois canais.", `**Base:** “${ENVIO}” — _${TITLE} · Seção: Envio_ — [Abrir processo ↗](/materiais/${DOC})`])
    expect(renderItemBlocks(item({ section: "OPPORTUNITY", sectionLabel: "Ponto de desenvolvimento", wording: { observed: "o", whyItMatters: "p", whatYouCanDo: "f" }, knowledge: null }))).toEqual(["**Ponto de desenvolvimento**", "o", "**Por que importa:** p", "**O que fazer nos próximos casos:** f"])
  })
  it("material de apoio: um por documento, VERIFIED primeiro, motivo = em que ASSUNTOS foi usado (V1.7.1e); nunca documentos só recuperados", () => {
    const literal = { ...knowledge, documentId: OTHER_DOC, documentTitle: "Outro", heading: "Confirmação de dados", applicability: "LITERAL_ONLY" as const }
    const step = (title: string) => ({ title: TITLE, requirement: title, status: "FOLLOWED" as const, checkpointRef: "P1.C1", stepTitle: title })
    const materials = supportMaterialsOf([item({ knowledge: literal, process: step("Confirmar dados") }), item({ process: step("Oferecer canais") }), item({ index: 2, knowledge: { ...knowledge, heading: "Protocolo" }, process: step("Registrar protocolo") }), item({ knowledge: null })])
    expect(materials).toEqual([{ materialId: DOC, title: TITLE, reason: "Utilizado em: Envio · Protocolo" }, { materialId: OTHER_DOC, title: "Outro", reason: "Utilizado em: Confirmação de dados" }])
    expect(renderEmittedText("Atendimento", [item()])).toContain(`**Material de apoio:** ${TITLE}`)
  })
})

describe("V1.6.0 — normalização: avaliação de processo e trechos APRESENTADOS vêm do rastro da execução", () => {
  const assessment = assessmentOf([checkpoint()])
  it("Agent: avaliação da saída estruturada + trechos de KB do rastro da execução", () => {
    const normalized = normalizeInvestigationResult({
      sourceNodeOutput: { kind: "monitoring", knowledgeExcerpts: presented, input: { organizationId: ORG, operatorId: OPERATOR, interactionId: INTERACTION, structured: { evidenceFound: "Posso enviar a segunda via por SMS ou por e-mail, qual prefere?", observedBehavior: "ofereceu", recommendation: "r", processAssessment: assessment } } },
      sourceType: "AGENT", sourceNodeId: "agent", domain: "MONITORING", organizationId: ORG, collaboratorId: OPERATOR, enrollment: { interactionId: INTERACTION, indicatorMeasurementId: null }, configuredAgentId: "a",
    })
    if (!normalized.ok) throw new Error(normalized.reason)
    // V1.7.1b — o parse preenche os campos novos com o padrão (sem produto, sem aplicabilidade declarada).
    const parsed = { applicability: [], processes: assessment.processes.map((process) => ({ ...process, product: null })) }
    expect(normalized.result.processAssessments).toEqual([{ sourceRef: "AGENT", assessment: parsed, presented }])
  })
  it("Orquestrador: uma fonte por especialista FEEDBACK, com o rastro de KB DELE; avaliação malformada é ignorada", () => {
    const normalized = normalizeInvestigationResult({
      sourceNodeOutput: { text: "síntese", orchestratorName: "Qualidade", orchestratorId: "o", agentId: null, calls: [], supportMaterialCandidates: [], structuredResult: null, results: [
        { agentId: "s1", toolName: "faturamento", contract: "FEEDBACK", structured: { evidenceFound: "x", observedBehavior: "y", recommendation: "z", processAssessment: assessment }, knowledge: { retrieved: [presented[0]] } },
        { agentId: "s2", toolName: "retencao", contract: "FEEDBACK", structured: { evidenceFound: "x", observedBehavior: "y", recommendation: "z", processAssessment: { processes: "inválido" } }, knowledge: { retrieved: presented } },
      ] },
      sourceType: "ORCHESTRATOR", sourceNodeId: "orq", domain: "MONITORING", organizationId: ORG, collaboratorId: OPERATOR, enrollment: { interactionId: INTERACTION, indicatorMeasurementId: null }, configuredAgentId: null,
    })
    if (!normalized.ok) throw new Error(normalized.reason)
    expect(normalized.result.processAssessments).toEqual([{ sourceRef: "faturamento", assessment: { applicability: [], processes: assessment.processes.map((process) => ({ ...process, product: null })) }, presented: [presented[0]] }])
  })
})
