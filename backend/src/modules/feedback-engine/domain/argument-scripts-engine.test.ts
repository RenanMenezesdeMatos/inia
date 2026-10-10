import { describe, expect, it } from "vitest"
import "../testing/no-external-ai.js"
import { argumentScriptSourceOf, normalizeArgumentScriptContent, type ArgumentScriptSource } from "../../argument-scripts/domain/argument-script.js"
import { projectTranscript } from "../../investigation/domain/transcript-projection.js"
import { missingCoverageOf, verifyCallAnalysis, type ModelCallAnalysis, type ModelCriterion } from "./call-analysis.js"
import { renderCallAnalysisUserTurn } from "./call-analysis-prompt.js"
import { reviewTargetsOf, type CallReview, type ClaimVerdict } from "./call-review.js"
import { renderCompositionUserTurn } from "./composition-prompt.js"
import { buildMonitoringBrief } from "./feedback-brief.js"
import { buildProcedureContext, listContextOf } from "./procedure.js"

/**
 * ARGUMENTÁRIOS NO MOTOR — testes SIMULADOS (zero IA; leituras do modelo e da revisora escritas aqui). Conteúdo no formato da planilha
 * de argumentários (contas em atraso, bloqueio após pagamento), escrito para exercitar as regras — nunca uma conversa real.
 */
const DOC = "00000000-0000-4000-8000-00000000b001"
const SCRIPT = "00000000-0000-4000-8000-00000000b501"
const OPTIONS = "00000000-0000-4000-8000-00000000b502"
const INTERACTION = "00000000-0000-4000-8000-00000000b0f1"
const PROCEDURE = `# Atendimento geral (teste)

## 1. Encerramento

- Não mencionar nomes de sistemas internos.
- Confirmar se o cliente tem mais alguma dúvida.
`
const SUGGESTED = "Para consultar os valores em aberto e verificar as opções de parcelamento disponíveis, você pode acessar o Vivo em Dia."
const overdue = (version = 1, previous: ArgumentScriptSource["content"] | null = null) =>
  argumentScriptSourceOf({
    scriptId: SCRIPT,
    versionId: `v${version}`,
    version,
    name: "Contas em atraso",
    areaName: "Cobrança",
    scope: { scopeType: "ALL_TEAMS", teamId: null, subteamId: null, teamName: null, subteamName: null },
    subjectName: null,
    conversion: "NATIVE",
    content: normalizeArgumentScriptContent({
      trigger: "O cliente tem contas em atraso no momento da ligação.",
      notApplicableWhen: "A conta já foi paga ou a menção é a uma situação antiga já resolvida.",
      operatorGuidance: [{ key: "g-vivo", text: "Indicar o Vivo em Dia para consultar os valores em aberto.", modality: "MUST" }, { key: "g-parc", text: "Verificar opções de parcelamento, caso o cliente precise.", modality: "MAY" }],
      requiredPoints: [{ key: "rp-1", mode: "ALL", items: [{ key: "p-acesso", text: "Orientar o acesso ao Vivo em Dia e mencionar a possibilidade de consultar débitos e opções de parcelamento.", condition: null }] }],
      avoid: [{ key: "a-garantia", text: "Não garantir condições, quantidade de parcelas ou aprovação antes da consulta." }, { key: "a-sistemas", text: "Não mencionar nomes de sistemas internos." }],
      suggestedScript: SUGGESTED,
      monitoringReference: "A transcrição deve registrar a indicação do Vivo em Dia e a possibilidade de parcelamento.",
    }),
    contentHash: `h${version}`,
    effectiveFrom: new Date("2026-09-01T00:00:00Z"),
    effectiveUntil: null,
    sourceDocumentId: DOC,
    sourceDocumentTitle: "Atendimento geral",
    sourceReference: "Planilha Argumentário · cenário 1",
  }, previous)
const paymentOptions = argumentScriptSourceOf({
  scriptId: OPTIONS,
  versionId: "o1",
  version: 1,
  name: "Bloqueio por falta de pagamento",
  areaName: "Cobrança",
  scope: { scopeType: "TEAM", teamId: "team-1", subteamId: null, teamName: "Retenção", subteamName: null },
  subjectName: null,
  conversion: "NATIVE",
  content: normalizeArgumentScriptContent({
    trigger: "O cliente está com o serviço bloqueado e quer regularizar a fatura.",
    requiredPoints: [{ key: "rp-alt", mode: "ANY", items: [{ key: "alt-cartao", text: "Pagamento com cartão de crédito pelo aplicativo, quando disponível", condition: null }, { key: "alt-boleto", text: "Pagamento por boleto ou código de barras", condition: null }] }],
  }),
  contentHash: "o1",
  effectiveFrom: new Date("2026-09-01T00:00:00Z"),
  effectiveUntil: null,
  sourceDocumentId: null,
  sourceDocumentTitle: null,
  sourceReference: null,
}, null)

function setup(transcript: string, scripts: ArgumentScriptSource[] = [overdue()]) {
  const context = buildProcedureContext([{ documentId: DOC, title: "Atendimento geral", version: 1, content: PROCEDURE, contentHash: "d1", perspective: "RULE_IN_FORCE_AT_CALL", selection: "INCLUDED_ALL", relevance: 0 }], scripts)
  const handle = (text: string) => [...context.lines.values()].find((line) => line.text.includes(text))!.handle
  return { context, projection: projectTranscript(transcript), handle }
}
const criterion = (fields: Partial<ModelCriterion> & Pick<ModelCriterion, "line" | "status">): ModelCriterion => ({ evidenceKind: null, declaredActionTense: null, evidence: [], opportunityTurn: null, rationale: "leitura simulada", materiality: "HIGH", guidance: null, whyItMatters: null, itemNature: "COMMUNICATION", scenarioRole: "CENTRAL", observability: "IN_CONVERSATION", applicability: "APPLIES", ...fields })
const model = (criteria: ModelCriterion[], extra: Partial<ModelCallAnalysis> = {}): ModelCallAnalysis => ({
  scenario: { customerNeed: "Regularizar a situação da conta", conditions: [], procedure: null, procedureRationale: null, pathSections: [], correctPath: "", pathTaken: "", pathAssessment: "UNDETERMINED", pathRationale: "", pathEvidence: [] },
  criteria,
  sectionDispositions: [],
  groupDispositions: [],
  sourceConflicts: [],
  limitations: [],
  contractViolations: [],
  ...extra,
})
const confirm = (id: string, fields: Partial<ClaimVerdict> = {}): [string, ClaimVerdict] => [id, { id, verdict: "CONFIRMED", issues: [], listReading: null, conditionEvidence: [], counterEvidence: [], note: null, ...fields }]
function run(setupResult: ReturnType<typeof setup>, analysis: ModelCallAnalysis, claims: [string, ClaimVerdict][] = []) {
  const review: CallReview = { claims: new Map(claims), path: null, lines: [], exclusions: new Map(), violations: [] }
  return verifyCallAnalysis({ model: analysis, context: setupResult.context, projection: setupResult.projection, transcriptStatus: "COMPLETE", interactionId: INTERACTION, subjectAnchoredDocumentIds: [], repairAttempted: false, review: { attempted: true, review, error: null } })
}
const briefInputOf = (setupResult: ReturnType<typeof setup>, result: ReturnType<typeof run>) => ({ analysis: result, listContext: listContextOf(setupResult.context), interactionId: INTERACTION, label: "Conta em atraso", dateLabel: "01/10/2026", selectionReason: "teste", criterionKeys: new Map(result.criteria.map((entry) => [entry.lineKey, entry.argument?.criterionKey ?? `KC-${entry.lineHandle}`])), documentTitles: new Map([[DOC, "Atendimento geral"]]), documentVersions: new Map([[DOC, 1]]), history: new Map(), delivered: new Set<string>() })
const briefOf = (setupResult: ReturnType<typeof setup>, result: ReturnType<typeof run>) => buildMonitoringBrief(briefInputOf(setupResult, result))

const CURRENT_DEBT = ["Cliente: Estou com duas contas atrasadas e queria resolver.", "Operador: Pelo Vivo em Dia você vê tudo o que está em aberto e pode parcelar, se tiver a opção para a sua linha.", "Cliente: Ótimo, obrigado.", "Operador: Por nada, tenha um bom dia."].join("\n")
const PAID = ["Cliente: Eu tinha uma conta atrasada, mas já paguei semana passada.", "Operador: Certo, então está tudo regularizado.", "Cliente: Isso, era só confirmar.", "Operador: Perfeito, até mais."].join("\n")
const CORRECTED = ["Cliente: Acho que tenho uma conta atrasada.", "Operador: Vou verificar.", "Cliente: Ah, não, desculpa, era a conta do meu irmão. A minha está em dia.", "Operador: Sem problemas, até mais."].join("\n")

describe("estrutura preservada no contexto do motor", () => {
  it("campos com significado: condição e exemplo SEM handle; deve × pode; grupo de alternativas como uma exigência; versão e escopo", () => {
    const { context } = setup(CURRENT_DEBT, [overdue(), paymentOptions])
    const rendered = renderCallAnalysisUserTurn({ specialist: null, interaction: { dateLabel: "01/10/2026", channel: "VOICE", subject: null, durationSeconds: null, signals: [], selectionReason: "teste" }, projection: projectTranscript(CURRENT_DEBT), transcriptStatus: "COMPLETE", context })
    expect(rendered).toContain('Argumentário "Contas em atraso" (versão 1 · vigente na data da chamada · área: Cobrança · vale para: todos os grupos)')
    expect(rendered).toContain("CONDIÇÃO / GATILHO (situação a reconhecer na conversa inteira — não é busca de palavras): O cliente tem contas em atraso no momento da ligação.")
    expect(rendered).toMatch(/\[L\d+\] \(deve\) Indicar o Vivo em Dia/)
    expect(rendered).toMatch(/\[L\d+\] \(pode — opcional: não fazer não é falha\) Verificar opções de parcelamento/)
    expect(rendered).toMatch(/\[L\d+\] Pelo menos uma destas alternativas: \(1\) Pagamento com cartão.*; \(2\) Pagamento por boleto/)
    expect(rendered).toContain(`ARGUMENTÁRIO SUGERIDO (EXEMPLO de abordagem — não é texto obrigatório, nunca compare literalmente com a fala, não cria exigência): ${SUGGESTED}`)
    expect(rendered).toContain("Registros operacionais de sistemas não estão integrados.")
    // O exemplo e a referência para a monitoria nunca viram linha avaliável.
    expect([...context.lines.values()].some((line) => line.text.includes("Para consultar os valores em aberto"))).toBe(false)
    expect([...context.lines.values()].filter((line) => line.argument?.scriptId === OPTIONS).map((line) => line.argument!.groupMode)).toEqual(["ANY"])
  })

  it("TEXTO IGUAL ao de uma linha da base NÃO elimina o item antes da análise: os dois ficam avaliáveis; a coincidência fica registrada e anotada", () => {
    const { context } = setup(CURRENT_DEBT)
    const same = [...context.lines.values()].filter((line) => line.text.includes("Não mencionar nomes de sistemas internos."))
    expect(same.map((line) => Boolean(line.argument))).toEqual([false, true])
    expect(context.sameText).toEqual([expect.objectContaining({ scriptId: SCRIPT, itemKey: "a-sistemas", lineHandle: same[1]!.handle, sameAsHandle: same[0]!.handle })])
    const rendered = renderCallAnalysisUserTurn({ specialist: null, interaction: { dateLabel: "01/10/2026", channel: "VOICE", subject: null, durationSeconds: null, signals: [], selectionReason: "teste" }, projection: projectTranscript(CURRENT_DEBT), transcriptStatus: "COMPLETE", context })
    expect(rendered).toContain(`[${same[1]!.handle}] Não mencionar nomes de sistemas internos. — (mesmo texto de [${same[0]!.handle}] na base: texto igual não é a mesma exigência; compare a condição, a finalidade, o escopo e a modalidade das duas fontes)`)
  })

  it("`ARGUMENT_SCRIPTS_ALL_IN_FORCE_V1`: o volume real de argumentários vigentes (36 de ~2,3 mil caracteres) entra inteiro — nenhum fica de fora pela ordem do nome", () => {
    const many = Array.from({ length: 36 }, (_, index) => argumentScriptSourceOf({ ...overdue(), scriptId: `s-${String(index).padStart(2, "0")}`, versionId: `v-${index}`, name: `${String.fromCharCode(65 + (index % 26))} argumentário ${index}`, content: normalizeArgumentScriptContent({ ...overdue().content, monitoringReference: "x".repeat(1_500) }) } as never, null))
    const context = buildProcedureContext([], many)
    expect(context.omittedScripts).toEqual([])
    expect(context.documents.filter((document) => document.kind === "ARGUMENT_SCRIPT")).toHaveLength(36)
  })

  it("conversão antiga sem estrutura nunca entra como critério (não vira obrigação nova)", () => {
    const legacy = argumentScriptSourceOf({ ...overdue(), scriptId: "legacy", conversion: "LEGACY_UNSTRUCTURED", content: normalizeArgumentScriptContent({ operatorGuidance: [{ key: "legacy-1", text: "Informar o número do protocolo antes de encerrar a chamada.", modality: "UNSPECIFIED" }], legacyExpectation: "Informar o número do protocolo antes de encerrar a chamada." }) }, null)
    const { context } = setup(CURRENT_DEBT, [legacy])
    expect(context.documents.filter((document) => document.kind === "ARGUMENT_SCRIPT")).toEqual([])
    expect(context.omittedScripts).toEqual([expect.objectContaining({ scriptId: "legacy", reason: "LEGACY_UNSTRUCTURED" })])
  })
})

describe("a situação do argumentário é reconhecida pela LEITURA, não por palavras (simulado)", () => {
  const T1_DEBT = { turn: "T1", speaker: "CLIENTE", quote: "Estou com duas contas atrasadas e queria resolver." }

  it("dívida ATUAL: o argumentário se aplica (fala verificada) e os pontos dele entram na cobertura; paráfrase cumpre; o exemplo não é exigido", () => {
    const s = setup(CURRENT_DEBT)
    const point = s.handle("Orientar o acesso ao Vivo em Dia")
    const speech = { turn: "T2", speaker: "OPERADOR", quote: "Pelo Vivo em Dia você vê tudo o que está em aberto e pode parcelar, se tiver a opção para a sua linha." }
    const analysis = model([criterion({ line: point, status: "MET", evidenceKind: "CONDUCT_OBSERVED", evidence: [speech] })], { argumentScripts: [{ script: "G1", applicability: "APPLIES", situation: "Contas em atraso hoje", evidence: [T1_DEBT], rationale: "A cliente disse que está com contas atrasadas." }] })
    // Sem disposição para os outros itens avaliáveis, a cobertura os pede à revisão (o "pode" não é cobrado).
    // `DUPLICATE_BY_MEANING_V1`: o item "evitar" com o mesmo texto da base não é mais descartado antes da análise — também deve
    // disposição (ou uma duplicidade declarada por sentido).
    expect(missingCoverageOf(analysis, s.context, "COMPLETE", s.projection).map((line) => line.text)).toEqual(["Indicar o Vivo em Dia para consultar os valores em aberto.", "Não garantir condições, quantidade de parcelas ou aprovação antes da consulta.", "Não mencionar nomes de sistemas internos."])
    const result = run(s, analysis, [confirm(point, { conditionEvidence: [T1_DEBT] })])
    expect(result.argumentScripts).toEqual([expect.objectContaining({ applicability: "APPLIES", declaredApplicability: "APPLIES" })])
    expect(result.criteria.find((entry) => entry.lineHandle === point)).toMatchObject({ status: "MET", confirmation: "CONFIRMED", argument: expect.objectContaining({ scriptId: SCRIPT, field: "REQUIRED_POINT" }) })
    // Na revisão: a situação do argumentário é a CONDIÇÃO (cadastro), a leitura da lista é a declarada; o exemplo não vai.
    const targets = reviewTargetsOf({ criteria: result.criteria, lists: listContextOf(s.context), projection: s.projection, path: null, missing: [] })
    expect(targets.claims[0]!.rule).toMatchObject({ conditional: true, declaredReading: "CUMULATIVE", source: expect.objectContaining({ kind: "ARGUMENT_SCRIPT", trigger: "O cliente tem contas em atraso no momento da ligação." }) })
    expect(JSON.stringify(targets)).not.toContain("Para consultar os valores em aberto")
    // Na composição: a regra vai com a origem; o argumentário sugerido nunca chega ao redator; argumentário não vira material da base.
    const brief = briefOf(s, result)
    expect(brief.strengths[0]!.rules[0]).toMatchObject({ documentTitle: "Argumentário: Contas em atraso", sourceKind: "ARGUMENT_SCRIPT" })
    expect(renderCompositionUserTurn(brief, null)).not.toContain("Para consultar os valores em aberto")
    expect(brief.materials).toEqual([])
  })

  it("dívida JÁ PAGA (menção antiga): não se aplica — nenhum ponto do argumentário vira desvio nem acerto", () => {
    const s = setup(PAID)
    const point = s.handle("Orientar o acesso ao Vivo em Dia")
    const analysis = model([criterion({ line: point, status: "NOT_MET", evidenceKind: "OMISSION", opportunityTurn: "T2" })], { argumentScripts: [{ script: "G1", applicability: "DOES_NOT_APPLY", situation: "Conta já paga", evidence: [{ turn: "T1", speaker: "CLIENTE", quote: "Eu tinha uma conta atrasada, mas já paguei semana passada." }], rationale: "A conta já foi paga: a menção ao atraso é a uma situação resolvida." }] })
    const result = run(s, analysis, [confirm(point)])
    expect(result.criteria.find((entry) => entry.lineHandle === point)).toMatchObject({ status: "NOT_APPLICABLE", applicability: "DOES_NOT_APPLY", downgrades: ["SCRIPT_DOES_NOT_APPLY"] })
    expect(missingCoverageOf(analysis, s.context, "COMPLETE", s.projection)).toEqual([])
    expect(briefOf(s, result).developments).toEqual([])
  })

  it("situação CORRIGIDA pela cliente durante a conversa: a leitura da conversa inteira vale (não se aplica)", () => {
    const s = setup(CORRECTED)
    const point = s.handle("Orientar o acesso ao Vivo em Dia")
    const result = run(s, model([criterion({ line: point, status: "NOT_MET", evidenceKind: "OMISSION", opportunityTurn: "T4" })], { argumentScripts: [{ script: "G1", applicability: "DOES_NOT_APPLY", situation: "Corrigido: a conta atrasada era de outra pessoa", evidence: [{ turn: "T3", speaker: "CLIENTE", quote: "Ah, não, desculpa, era a conta do meu irmão. A minha está em dia." }], rationale: "A cliente corrigiu a informação." }] }), [confirm(point)])
    expect(result.criteria.find((entry) => entry.lineHandle === point)!.status).toBe("NOT_APPLICABLE")
  })

  it("'se aplica' sem fala verificada (citação inventada) não se sustenta: situação incerta — o 'não cumpriu' cai", () => {
    const s = setup(CORRECTED)
    const point = s.handle("Orientar o acesso ao Vivo em Dia")
    const result = run(s, model([criterion({ line: point, status: "NOT_MET", evidenceKind: "OMISSION", opportunityTurn: "T4" })], { argumentScripts: [{ script: "G1", applicability: "APPLIES", situation: "Contas em atraso", evidence: [{ turn: "T1", speaker: "CLIENTE", quote: "Estou devendo três faturas." }], rationale: "x" }] }), [confirm(point)])
    expect(result.argumentScripts![0]).toMatchObject({ applicability: "UNCERTAIN", downgrade: "SCRIPT_APPLIES_WITHOUT_VERIFIED_EVIDENCE" })
    expect(result.criteria.find((entry) => entry.lineHandle === point)).toMatchObject({ status: "NOT_OBSERVABLE", downgrades: ["SCRIPT_SITUATION_NOT_ESTABLISHED"] })
  })

  it("ponto obrigatório AUSENTE com a situação estabelecida e oportunidade: desvio confirmado só com a fala da situação na revisão", () => {
    const transcript = ["Cliente: Estou com duas contas atrasadas e queria resolver.", "Operador: Entendi, vou anotar aqui.", "Cliente: Tá bom.", "Operador: Mais alguma coisa? Tenha um bom dia."].join("\n")
    const s = setup(transcript)
    const point = s.handle("Orientar o acesso ao Vivo em Dia")
    const analysis = model([criterion({ line: point, status: "NOT_MET", evidenceKind: "OMISSION", opportunityTurn: "T2" })], { argumentScripts: [{ script: "G1", applicability: "APPLIES", situation: "Contas em atraso", evidence: [T1_DEBT], rationale: "x" }] })
    expect(run(s, analysis, [confirm(point)]).criteria.find((entry) => entry.lineHandle === point)).toMatchObject({ confirmation: "UNCONFIRMED", confirmationReasons: ["CONDITION_NOT_EVIDENCED"] })
    expect(run(s, analysis, [confirm(point, { conditionEvidence: [T1_DEBT] })]).criteria.find((entry) => entry.lineHandle === point)).toMatchObject({ status: "NOT_MET", confirmation: "CONFIRMED" })
  })

  it("`ARGUMENT_PHRASING_V1`: a fraseologia sugerida do argumentário chega ao redator como FATO do ponto de desenvolvimento (base do exemplo de como dizer), nunca como critério", () => {
    const transcript = ["Cliente: Estou com duas contas atrasadas e queria resolver.", "Operador: Entendi, vou anotar aqui.", "Cliente: Tá bom.", "Operador: Mais alguma coisa? Tenha um bom dia."].join("\n")
    const s = setup(transcript)
    const point = s.handle("Orientar o acesso ao Vivo em Dia")
    const analysis = model([criterion({ line: point, status: "NOT_MET", evidenceKind: "OMISSION", opportunityTurn: "T2" })], { argumentScripts: [{ script: "G1", applicability: "APPLIES", situation: "Contas em atraso", evidence: [T1_DEBT], rationale: "x" }] })
    const result = run(s, analysis, [confirm(point, { conditionEvidence: [T1_DEBT] })])
    const withPhrasing = buildMonitoringBrief({ ...briefInputOf(s, result), argumentPhrasings: new Map([[SCRIPT, { name: "Contas em atraso", text: SUGGESTED }]]) })
    const development = withPhrasing.developments.find((finding) => finding.rules.some((rule) => rule.sourceKind === "ARGUMENT_SCRIPT"))!
    expect(development.rules[0]!.phrasing).toEqual({ scriptName: "Contas em atraso", text: SUGGESTED })
    expect(renderCompositionUserTurn(withPhrasing, null)).toContain(`"suggestedPhrasing"`)
    expect(renderCompositionUserTurn(withPhrasing, null)).toContain(SUGGESTED)
    // A fraseologia nunca vira critério: o mesmo ponto, as mesmas regras; sem a fraseologia lida, nada muda no texto do ponto.
    const without = briefOf(s, result)
    expect(without.developments.map((finding) => finding.rules.map((rule) => rule.text))).toEqual(withPhrasing.developments.map((finding) => finding.rules.map((rule) => rule.text)))
    expect(renderCompositionUserTurn(without, null)).not.toContain("suggestedPhrasing")
  })

  it("orientação 'pode' não feita nunca é desvio; ALTERNATIVA escolhida cumpre o grupo inteiro (sem obrigação de citar a outra)", () => {
    const transcript = ["Cliente: Minha linha está bloqueada e eu quero pagar.", "Operador: A senhora pode pagar por boleto, com o código de barras que eu te envio.", "Cliente: Pode ser.", "Operador: Enviado. Até mais."].join("\n")
    const s = setup(transcript, [overdue(), paymentOptions])
    const optional = s.handle("Verificar opções de parcelamento")
    const alternatives = s.handle("Pelo menos uma destas alternativas")
    const analysis = model([
      criterion({ line: optional, status: "NOT_MET", evidenceKind: "OMISSION", opportunityTurn: "T2" }),
      criterion({ line: alternatives, status: "MET", evidenceKind: "CONDUCT_OBSERVED", evidence: [{ turn: "T2", speaker: "OPERADOR", quote: "A senhora pode pagar por boleto, com o código de barras que eu te envio." }] }),
    ], { argumentScripts: [{ script: "G1", applicability: "APPLIES", situation: "x", evidence: [{ turn: "T1", speaker: "CLIENTE", quote: "Minha linha está bloqueada e eu quero pagar." }], rationale: "x" }, { script: "G2", applicability: "APPLIES", situation: "Bloqueio e quer regularizar", evidence: [{ turn: "T1", speaker: "CLIENTE", quote: "Minha linha está bloqueada e eu quero pagar." }], rationale: "x" }] })
    const result = run(s, analysis, [confirm(alternatives, { conditionEvidence: [{ turn: "T1", speaker: "CLIENTE", quote: "Minha linha está bloqueada e eu quero pagar." }] })])
    expect(result.notRequirements).toContain(optional)
    expect(result.criteria.find((entry) => entry.lineHandle === alternatives)).toMatchObject({ status: "MET", confirmation: "CONFIRMED" })
  })

  it("CONFLITO entre argumentário e procedimento: registrado, nunca usado para acusar; o resto continua avaliado", () => {
    const s = setup(CURRENT_DEBT)
    const point = s.handle("Orientar o acesso ao Vivo em Dia")
    const guidance = s.handle("Indicar o Vivo em Dia para consultar")
    const analysis = model([criterion({ line: point, status: "NOT_MET", evidenceKind: "OMISSION", opportunityTurn: "T2" }), criterion({ line: guidance, status: "MET", evidenceKind: "CONDUCT_OBSERVED", evidence: [{ turn: "T2", speaker: "OPERADOR", quote: "Pelo Vivo em Dia você vê tudo o que está em aberto e pode parcelar, se tiver a opção para a sua linha." }] })], {
      argumentScripts: [{ script: "G1", applicability: "APPLIES", situation: "x", evidence: [T1_DEBT], rationale: "x" }],
      sourceConflicts: [{ lines: [point, s.handle("Confirmar se o cliente tem mais alguma dúvida")], description: "Prazo/condição divergente entre as fontes." }],
    })
    const result = run(s, analysis, [confirm(guidance, { conditionEvidence: [T1_DEBT] })])
    expect(result.criteria.find((entry) => entry.lineHandle === point)).toMatchObject({ ruleConflict: true })
    expect(briefOf(s, result).developments).toEqual([])
    expect(result.criteria.find((entry) => entry.lineHandle === guidance)).toMatchObject({ status: "MET", confirmation: "CONFIRMED" })
  })

  it("duplicidade declarada SEM a equivalência por dimensão (só 'mesma exigência') é recusada: a linha do argumentário continua avaliada", () => {
    const s = setup(CURRENT_DEBT)
    const point = s.handle("Orientar o acesso ao Vivo em Dia")
    const docLine = s.handle("Confirmar se o cliente tem mais alguma dúvida")
    const analysis = model([criterion({ line: point, status: "NOT_MET", evidenceKind: "OMISSION", opportunityTurn: "T2" }), criterion({ line: docLine, status: "NOT_OBSERVABLE" })], { argumentScripts: [{ script: "G1", applicability: "APPLIES", situation: "x", evidence: [T1_DEBT], rationale: "x" }], duplicates: [{ line: point, sameAs: docLine, rationale: "mesma exigência" }] })
    const result = run(s, analysis)
    expect(result.criteria.some((entry) => entry.lineHandle === point)).toBe(true)
    expect(result.duplicates).toEqual([expect.objectContaining({ line: point, sameAs: docLine, origin: "ANALYSIS", accepted: false, rejectedBecause: ["NOT_DECLARED_SAME_CONDITION", "NOT_DECLARED_SAME_PURPOSE", "NOT_DECLARED_SAME_SCOPE", "NOT_DECLARED_SAME_MODALITY"] })])
  })
})

describe("identidade e versão na memória", () => {
  it("item igual entre versões = mesma identidade; texto/condição/modo mudados = critério novo com o anterior registrado", () => {
    const v1 = overdue(1)
    const v2Content = normalizeArgumentScriptContent({ ...v1.content, requiredPoints: [{ key: "rp-1", mode: "ALL", items: [{ key: "p-acesso", text: "Orientar o acesso ao Vivo em Dia e mencionar a consulta de débitos e o parcelamento disponível.", condition: null }] }] })
    const v2 = overdue(2, v1.content)
    const v2Changed = argumentScriptSourceOf({ ...v2, content: v2Content }, v1.content)
    expect(v2.identities.get("p-acesso")).toMatchObject({ basis: "UNCHANGED", criterionKey: v1.identities.get("p-acesso")!.criterionKey })
    expect(v2Changed.identities.get("p-acesso")).toMatchObject({ basis: "MODIFIED", previousCriterionKey: v1.identities.get("p-acesso")!.criterionKey })
    expect(v2Changed.identities.get("p-acesso")!.criterionKey).toMatch(/^AG-[0-9a-f]{12}$/)
  })
})

/**
 * DUPLICIDADE POR SENTIDO (`DUPLICATE_BY_MEANING_V1`, defeito reproduzido em 01/10): a base diz "Informe o prazo de até 24 horas" para
 * o envio da SEGUNDA VIA; um argumentário diz a mesma frase para o DESBLOQUEIO APÓS PAGAMENTO. O motor descartava o item do
 * argumentário por igualdade de texto — a obrigação do desbloqueio sumia. Zero IA: as leituras do modelo são escritas aqui.
 */
describe("texto igual não comprova obrigação equivalente", () => {
  const KB = "00000000-0000-4000-8000-00000000c001"
  const UNBLOCK = "00000000-0000-4000-8000-00000000c501"
  const KB_TEXT = `# Segunda via (teste)

## 1. Envio da segunda via

Quando o cliente pedir a segunda via da conta:
- Enviar a segunda via pelo canal escolhido.
- Informe o prazo de até 24 horas.

## 2. Encerramento

- Informe o protocolo ao final do atendimento.
`
  const unblock = (items: { key: string; text: string }[]) => argumentScriptSourceOf({
    scriptId: UNBLOCK, versionId: "u1", version: 1, name: "Desbloqueio após pagamento", areaName: "Cobrança",
    scope: { scopeType: "ALL_TEAMS", teamId: null, subteamId: null, teamName: null, subteamName: null }, subjectName: null, conversion: "NATIVE",
    content: normalizeArgumentScriptContent({ trigger: "O cliente pagou a conta em atraso e quer saber quando a linha volta a funcionar.", requiredPoints: [{ key: "rp", mode: "ALL", items: items.map((item) => ({ ...item, condition: null })) }] }),
    contentHash: "u1", effectiveFrom: new Date("2026-09-01T00:00:00Z"), effectiveUntil: null, sourceDocumentId: null, sourceDocumentTitle: null, sourceReference: null,
  }, null)
  const CALL = ["Cliente: Paguei a conta atrasada hoje cedo, quando a minha linha volta?", "Operador: Certo, o pagamento já aparece aqui.", "Cliente: E volta quando?", "Operador: Assim que o sistema processar. Mais alguma coisa?", "Cliente: Não, obrigada."].join("\n")
  const T1 = { turn: "T1", speaker: "CLIENTE", quote: "Paguei a conta atrasada hoje cedo, quando a minha linha volta?" }
  function setupUnblock(items: { key: string; text: string }[]) {
    const context = buildProcedureContext([{ documentId: KB, title: "Segunda via", version: 1, content: KB_TEXT, contentHash: "k1", perspective: "RULE_IN_FORCE_AT_CALL", selection: "INCLUDED_ALL", relevance: 0 }], [unblock(items)])
    const lineOf = (text: string, fromScript: boolean) => [...context.lines.values()].find((line) => line.text.includes(text) && Boolean(line.argument) === fromScript)!.handle
    return { context, projection: projectTranscript(CALL), handle: (text: string) => lineOf(text, false), lineOf }
  }
  const runWith = (s: ReturnType<typeof setupUnblock>, analysis: ModelCallAnalysis, claims: [string, ClaimVerdict][] = []) => {
    const review: CallReview = { claims: new Map(claims), path: null, lines: [], exclusions: new Map(), violations: [] }
    return verifyCallAnalysis({ model: analysis, context: s.context, projection: s.projection, transcriptStatus: "COMPLETE", interactionId: INTERACTION, subjectAnchoredDocumentIds: [], repairAttempted: false, review: { attempted: true, review, error: null } })
  }

  it("frase igual, obrigações diferentes: o item do desbloqueio continua com handle e é avaliado na SUA situação (a linha da segunda via não se aplica)", () => {
    const s = setupUnblock([{ key: "prazo", text: "Informe o prazo de até 24 horas." }])
    const kbLine = s.lineOf("Informe o prazo de até 24 horas", false)
    const scriptLine = s.lineOf("Informe o prazo de até 24 horas", true)
    expect(scriptLine).not.toBe(kbLine)
    expect(s.context.sameText).toEqual([expect.objectContaining({ lineHandle: scriptLine, sameAsHandle: kbLine })])
    const analysis = model([
      criterion({ line: kbLine, status: "NOT_APPLICABLE", applicability: "DOES_NOT_APPLY", rationale: "Não houve pedido de segunda via." }),
      criterion({ line: scriptLine, status: "NOT_MET", evidenceKind: "OMISSION", opportunityTurn: "T3", applicabilityEvidence: [T1], rationale: "A cliente perguntou quando a linha volta e o prazo não foi informado." }),
    ], { argumentScripts: [{ script: "G1", applicability: "APPLIES", situation: "Pagou a conta em atraso e quer saber quando a linha volta.", evidence: [T1], rationale: "x" }] })
    const result = runWith(s, analysis, [confirm(scriptLine, { conditionEvidence: [T1] })])
    expect(result.criteria.find((entry) => entry.lineHandle === kbLine)).toMatchObject({ status: "NOT_APPLICABLE" })
    expect(result.criteria.find((entry) => entry.lineHandle === scriptLine)).toMatchObject({ status: "NOT_MET", confirmation: "CONFIRMED", argument: expect.objectContaining({ scriptName: "Desbloqueio após pagamento" }) })
    expect(result.duplicates ?? []).toEqual([])
  })

  it("frase igual declarada como duplicata com condição DIFERENTE: recusada — as duas continuam avaliadas (na dúvida, as fontes ficam)", () => {
    const s = setupUnblock([{ key: "prazo", text: "Informe o prazo de até 24 horas." }])
    const kbLine = s.lineOf("Informe o prazo de até 24 horas", false)
    const scriptLine = s.lineOf("Informe o prazo de até 24 horas", true)
    const analysis = model([
      criterion({ line: kbLine, status: "NOT_APPLICABLE", applicability: "DOES_NOT_APPLY", rationale: "Não houve pedido de segunda via." }),
      criterion({ line: scriptLine, status: "NOT_MET", evidenceKind: "OMISSION", opportunityTurn: "T3", applicabilityEvidence: [T1] }),
    ], { argumentScripts: [{ script: "G1", applicability: "APPLIES", situation: "x", evidence: [T1], rationale: "x" }], duplicates: [{ line: scriptLine, sameAs: kbLine, sameCondition: false, samePurpose: false, sameScope: true, sameModality: true, rationale: "Mesma frase, mas uma vale para a segunda via e a outra para o desbloqueio." }] })
    const result = runWith(s, analysis, [confirm(scriptLine, { conditionEvidence: [T1] })])
    expect(result.duplicates).toEqual([expect.objectContaining({ accepted: false, sameText: true, rejectedBecause: ["NOT_DECLARED_SAME_CONDITION", "NOT_DECLARED_SAME_PURPOSE"] })])
    expect(result.criteria.find((entry) => entry.lineHandle === scriptLine)).toMatchObject({ status: "NOT_MET" })
  })

  it("duplicidade VERDADEIRA (mesma obrigação com outras palavras): avaliada uma vez, na linha da base, com as duas origens — sem contagem dupla", () => {
    const s = setupUnblock([{ key: "proto", text: "Antes de desligar, passe o número do protocolo ao cliente." }])
    const kbLine = s.lineOf("Informe o protocolo ao final do atendimento", false)
    const scriptLine = s.lineOf("passe o número do protocolo", true)
    const analysis = model([
      criterion({ line: kbLine, status: "NOT_MET", evidenceKind: "OMISSION", opportunityTurn: "T4", rationale: "Encerrou sem informar o protocolo." }),
      criterion({ line: scriptLine, status: "NOT_MET", evidenceKind: "OMISSION", opportunityTurn: "T4" }),
    ], { argumentScripts: [{ script: "G1", applicability: "APPLIES", situation: "x", evidence: [T1], rationale: "x" }], duplicates: [{ line: scriptLine, sameAs: kbLine, sameCondition: true, samePurpose: true, sameScope: true, sameModality: true, rationale: "As duas pedem informar o protocolo antes de encerrar, em qualquer atendimento." }] })
    const result = runWith(s, analysis, [confirm(kbLine)])
    expect(result.criteria.some((entry) => entry.lineHandle === scriptLine)).toBe(false)
    expect(result.criteria.filter((entry) => entry.status === "NOT_MET")).toHaveLength(1)
    expect(result.criteria.find((entry) => entry.lineHandle === kbLine)).toMatchObject({ status: "NOT_MET", alsoRequiredBy: [expect.objectContaining({ scriptName: "Desbloqueio após pagamento", itemKey: "proto", lineHandle: scriptLine })] })
    expect(result.duplicates).toEqual([expect.objectContaining({ line: scriptLine, sameAs: kbLine, accepted: true, sameText: false, equivalence: { condition: true, purpose: true, scope: true, modality: true } })])
  })

  it("duplicidade VERDADEIRA com frase IGUAL também conta uma vez — mas só pela leitura (o texto sozinho nunca decidiu)", () => {
    const s = setupUnblock([{ key: "proto", text: "Informe o protocolo ao final do atendimento." }])
    const kbLine = s.lineOf("Informe o protocolo ao final do atendimento", false)
    const scriptLine = s.lineOf("Informe o protocolo ao final do atendimento", true)
    const analysis = model([criterion({ line: kbLine, status: "NOT_MET", evidenceKind: "OMISSION", opportunityTurn: "T4" })], { argumentScripts: [{ script: "G1", applicability: "APPLIES", situation: "x", evidence: [T1], rationale: "x" }], duplicates: [{ line: scriptLine, sameAs: kbLine, sameCondition: true, samePurpose: true, sameScope: true, sameModality: true, rationale: "Mesma frase e mesma situação: informar o protocolo antes de encerrar qualquer atendimento." }] })
    const result = runWith(s, analysis, [confirm(kbLine)])
    expect(result.criteria.filter((entry) => entry.status === "NOT_MET").map((entry) => entry.lineHandle)).toEqual([kbLine])
    expect(result.duplicates).toEqual([expect.objectContaining({ accepted: true, sameText: true })])
    // Sem a declaração do modelo, o item do argumentário (que se aplica) fica devendo disposição: pedido de cobertura, nunca descartado.
    const silent = model([criterion({ line: kbLine, status: "NOT_MET", evidenceKind: "OMISSION", opportunityTurn: "T4" })], { argumentScripts: [{ script: "G1", applicability: "APPLIES", situation: "x", evidence: [T1], rationale: "x" }] })
    expect(missingCoverageOf(silent, s.context, "COMPLETE", s.projection, INTERACTION).map((line) => line.handle)).toContain(scriptLine)
  })

  it("duplicata cuja linha da base não foi avaliada é recusada (a avaliação se perderia)", () => {
    const s = setupUnblock([{ key: "proto", text: "Antes de desligar, passe o número do protocolo ao cliente." }])
    const kbLine = s.lineOf("Informe o protocolo ao final do atendimento", false)
    const scriptLine = s.lineOf("passe o número do protocolo", true)
    const analysis = model([criterion({ line: scriptLine, status: "NOT_MET", evidenceKind: "OMISSION", opportunityTurn: "T4" })], { argumentScripts: [{ script: "G1", applicability: "APPLIES", situation: "x", evidence: [T1], rationale: "x" }], duplicates: [{ line: scriptLine, sameAs: kbLine, sameCondition: true, samePurpose: true, sameScope: true, sameModality: true, rationale: "mesma obrigação" }] })
    const result = runWith(s, analysis)
    expect(result.duplicates).toEqual([expect.objectContaining({ accepted: false, rejectedBecause: ["KNOWLEDGE_LINE_NOT_ASSESSED"] })])
    expect(result.criteria.some((entry) => entry.lineHandle === scriptLine)).toBe(true)
  })
})

describe("argumentário em REAVALIAÇÃO pela regra atual (chamada anterior à publicação)", () => {
  it("o prompt diz que NÃO estava vigente na data da chamada e o desvio vira orientação daqui para frente (nunca culpa da época)", () => {
    const T1_DEBT = { turn: "T1", speaker: "CLIENTE", quote: "Estou com duas contas atrasadas e queria resolver." }
    const reevaluated = { ...overdue(), perspective: "CURRENT_RULE_REEVALUATION" as const }
    const s = setup(CURRENT_DEBT, [reevaluated])
    const rendered = renderCallAnalysisUserTurn({ specialist: null, interaction: { dateLabel: "01/10/2026", channel: "VOICE", subject: null, durationSeconds: null, signals: [], selectionReason: "teste" }, projection: s.projection, transcriptStatus: "COMPLETE", context: s.context })
    expect(rendered).toContain('Argumentário "Contas em atraso" (versão 1 · versão atual — REAVALIAÇÃO: não estava vigente na data da chamada')
    expect(rendered).not.toContain('Argumentário "Contas em atraso" (versão 1 · vigente na data da chamada')
    const point = s.handle("Orientar o acesso ao Vivo em Dia")
    const analysis = model([criterion({ line: point, status: "NOT_MET", evidenceKind: "OMISSION", opportunityTurn: "T2", applicabilityEvidence: [T1_DEBT] })], { argumentScripts: [{ script: "G1", applicability: "APPLIES", situation: "Contas atrasadas hoje.", evidence: [T1_DEBT], rationale: "x" }] })
    const result = run(s, analysis, [confirm(point, { conditionEvidence: [T1_DEBT] })])
    expect(result.criteria.find((entry) => entry.lineHandle === point)).toMatchObject({ status: "NOT_MET", argument: expect.objectContaining({ perspective: "CURRENT_RULE_REEVALUATION" }) })
    const brief = briefOf(s, result)
    expect(brief.developments[0]).toMatchObject({ ruleBasis: "CURRENT_RULE_REEVALUATION" })
    expect(brief.context.join(" ")).toContain("Argumentários usados numa REAVALIAÇÃO pela regra atual")
  })
})
