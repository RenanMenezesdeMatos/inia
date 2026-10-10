import { describe, expect, it } from "vitest"
import { claimSupportOptionsOf, claimSupportSchemaFor, correctionCategoriesOf, factRefsFromBinding, gateSynthesis, normalizeEvidenceRef, parseSynthesisFields, rejectionCategoryOf, renderClaimSupportsLine, renderGatingCorrection, renderSynthesisContract, renderSynthesisRefsLine, representativenessOf, resolveClaimSupport, stripInternalRefs } from "./evidence-gating.js"
import type { LedgerEntry } from "./evidence-ledger.js"

const entry = (ref: string, tool: string, qualityStatus = "SUFFICIENT"): LedgerEntry => ({ ref, sequence: Number(ref.slice(1)), round: 1, tool, capability: "x", keyArgs: "", summary: "s", qualityStatus, qualityNote: null, sampleCount: null, periodLabel: null, preflight: false })
const ledger = [entry("F1", "get_indicator_snapshot"), entry("F2", "compare_population"), entry("F3", "analyze_interactions"), entry("F4", "find_interactions", "NO_DATA")]

describe("evidence gating (V1.1)", () => {
  it("afirmação comportamental exige ref de fato de interação/transcrição com dado; refs de indicador não bastam; ref inexistente ou NO_DATA é rejeitada", () => {
    const synthesis = parseSynthesisFields({
      behavioralClaims: [
        { text: "Você demora no fechamento", evidenceRefs: [] },
        { text: "Você navega lentamente", evidenceRefs: ["F1", "F2"] },
        { text: "Você repete a confirmação", evidenceRefs: ["f3"] },
        { text: "Você faz pausas", evidenceRefs: ["F4"] },
        { text: "Você inventa", evidenceRefs: ["F9"] },
      ],
    })
    const rejected = gateSynthesis(synthesis, { ledger, knowledgeAvailable: false })
    expect(rejected.map((item) => [item.text, item.reason])).toEqual([
      ["Você demora no fechamento", "sem referência a fato do ledger"],
      ["Você navega lentamente", "refs F1, F2 não são evidência de interação/transcrição"],
      ["Você faz pausas", "refs F4 não são evidência de interação/transcrição"],
      ["Você inventa", "sem referência a fato do ledger"],
    ])
  })

  it("V1.3.2: grafias da PRÓPRIA transcrição em foco ('transcrição de I1', 'TRANSCRIPT') resolvem para TRANSCRICAO; um handle solto (I3) ou qualquer outra grafia continua sem evidência (fail-closed)", () => {
    const withTranscript = [{ ...entry("TRANSCRICAO", "get_interaction_context"), preflight: true }, ...ledger]
    const refs = new Set(withTranscript.map((item) => item.ref))
    expect(normalizeEvidenceRef("transcrição de I1", refs)).toBe("TRANSCRICAO")
    expect(normalizeEvidenceRef("Transcrição", refs)).toBe("TRANSCRICAO")
    expect(normalizeEvidenceRef("TRANSCRIPT of I2", refs)).toBe("TRANSCRICAO")
    expect(normalizeEvidenceRef("I3", refs)).toBe("I3")
    expect(normalizeEvidenceRef("transcrição de I1", new Set(["F1"]))).toBe("TRANSCRIÇÃO DE I1")
    const synthesis = parseSynthesisFields({ behavioralClaims: [{ text: "na interação analisada houve pausas", evidenceRefs: ["transcrição de I1"], scope: "INTERACTION_SPECIFIC" }, { text: "na interação I3 houve pausas", evidenceRefs: ["I3"], scope: "INTERACTION_SPECIFIC" }], recommendationSupport: [{ text: "conclua a solicitação antes de ofertas", basis: "OBSERVED_EVIDENCE", evidenceRefs: ["transcrição de I1"] }] })
    const rejected = gateSynthesis(synthesis, { ledger: withTranscript, knowledgeAvailable: false })
    expect(rejected.map((item) => item.text)).toEqual(["na interação I3 houve pausas"])
  })

  it("recomendação: OBSERVED_EVIDENCE exige ref válida; KNOWLEDGE_GUIDANCE exige base real; GENERAL_DEVELOPMENT_SUGGESTION sempre passa", () => {
    const synthesis = parseSynthesisFields({
      recommendationSupport: [
        { text: "Evite pausas silenciosas", basis: "OBSERVED_EVIDENCE", evidenceRefs: [] },
        { text: "Confirme uma vez", basis: "OBSERVED_EVIDENCE", evidenceRefs: ["F3"] },
        { text: "Siga o roteiro de fechamento", basis: "KNOWLEDGE_GUIDANCE", evidenceRefs: [] },
        { text: "Pode ajudar praticar sondagem", basis: "GENERAL_DEVELOPMENT_SUGGESTION", evidenceRefs: [] },
      ],
    })
    expect(gateSynthesis(synthesis, { ledger, knowledgeAvailable: false }).map((item) => item.text)).toEqual(["Evite pausas silenciosas", "Siga o roteiro de fechamento"])
    expect(gateSynthesis(synthesis, { ledger, knowledgeAvailable: true }).map((item) => item.text)).toEqual(["Evite pausas silenciosas"])
  })

  it("V1.4.4: item inválido cai fora, o resto sobrevive — uma string vazia em supportedHypotheses não apaga as afirmações válidas", () => {
    const parsed = parseSynthesisFields({ supportedHypotheses: [""], limitations: ["amostra de 8", ""], behavioralClaims: [{ text: "claim válida", evidenceRefs: ["F3"], candidateRef: "CC1" }, { evidenceRefs: ["F3"] }], recommendationSupport: [{ text: "ação", basis: "OBSERVED_EVIDENCE", evidenceRefs: ["F3"] }, { text: "sem base" }] })
    expect(parsed.supportedHypotheses).toEqual([])
    expect(parsed.limitations).toEqual(["amostra de 8"])
    expect(parsed.behavioralClaims.map((item) => item.text)).toEqual(["claim válida"])
    expect(parsed.behavioralClaims[0]?.candidateRef).toBe("CC1")
    expect(parsed.recommendationSupport.map((item) => item.text)).toEqual(["ação"])
  })

  it("campos ausentes/inválidos viram vazios (o feedback antigo continua parseável) e nunca derrubam a resposta", () => {
    expect(parseSynthesisFields(undefined)).toEqual({ supportedHypotheses: [], unsupportedHypotheses: [], limitations: [], behavioralClaims: [], recommendationSupport: [] })
    expect(parseSynthesisFields({ behavioralClaims: "não é lista" }).behavioralClaims).toEqual([])
  })

  it("correção e contrato citam as refs válidas e a linguagem factual exigida", () => {
    expect(renderGatingCorrection([{ kind: "BEHAVIORAL_CLAIM", text: "Você demora", reason: "sem referência a fato do ledger" }])).toContain('Afirmação comportamental: "Você demora" — sem referência a fato do ledger.')
    expect(renderSynthesisContract(["F1", "F2"])).toContain("refs válidas são somente F1, F2")
    expect(renderSynthesisContract([])).toContain("(nenhum fato disponível)")
  })
})

describe("claim scope × representatividade (V1.2)", () => {
  const anecdotal = [entry("F1", "get_indicator_snapshot"), { ...entry("F2", "analyze_interactions"), sampleCount: 2 }]
  const representative = [{ ...entry("F3", "analyze_interactions"), sampleCount: 12 }, { ...entry("F4", "analyze_peer_patterns"), sampleCount: 8 }]

  it("2 interações de 1.267: sustenta INTERACTION_SPECIFIC, rejeita PERIOD/EMPLOYEE_PATTERN (generalização) e POPULATION sem pares", () => {
    const context = { ledger: anecdotal, knowledgeAvailable: false, interactionUniverse: 1267 }
    expect(gateSynthesis(parseSynthesisFields({ behavioralClaims: [{ text: "Nas duas interações analisadas você repetiu a confirmação", evidenceRefs: ["F2"], scope: "INTERACTION_SPECIFIC" }] }), context)).toEqual([])
    const rejected = gateSynthesis(parseSynthesisFields({ behavioralClaims: [
      { text: "Você costuma repetir a confirmação", evidenceRefs: ["F2"], scope: "EMPLOYEE_PATTERN" },
      { text: "No período você repete a confirmação", evidenceRefs: ["F2"], scope: "PERIOD_PATTERN" },
      { text: "Os pares confirmam uma vez", evidenceRefs: ["F2"], scope: "POPULATION_PATTERN" },
    ] }), context)
    expect(rejected.map((item) => item.reason)).toEqual([
      'escopo EMPLOYEE_PATTERN: evidência anedótica para generalizar como padrão do colaborador — só sustenta "nas interações analisadas"',
      'escopo PERIOD_PATTERN: evidência anedótica para generalizar como padrão no período — só sustenta "nas interações analisadas"',
      "escopo POPULATION_PATTERN: padrão de população exige análise representativa de pares (analyze_peer_patterns)",
    ])
  })

  it("amostra representativa sustenta EMPLOYEE_PATTERN; pares representativos sustentam POPULATION_PATTERN; escopo ausente = o mais restrito", () => {
    const context = { ledger: representative, knowledgeAvailable: false, interactionUniverse: 40 }
    expect(gateSynthesis(parseSynthesisFields({ behavioralClaims: [
      { text: "Você costuma repetir a confirmação", evidenceRefs: ["F3"], scope: "EMPLOYEE_PATTERN" },
      { text: "Os pares confirmam uma vez", evidenceRefs: ["F4"], scope: "POPULATION_PATTERN" },
      { text: "Na interação analisada você…", evidenceRefs: ["F3"] },
    ] }), context)).toEqual([])
    expect(representativenessOf(context).map((item) => [item.ref, item.level])).toEqual([["F3", "REPRESENTATIVE"], ["F4", "REPRESENTATIVE"]])
  })
})

describe("stripInternalRefs — refs internas nunca chegam ao colaborador", () => {
  it("remove grupos (F1, F4), (M2), (TRANSCRICAO) do texto e preserva o resto", () => {
    expect(stripInternalRefs("acima do subgrupo (F1, F4). Use o material (M2) e avise (TRANSCRICAO, F3).")).toBe("acima do subgrupo. Use o material e avise.")
    expect(stripInternalRefs("Sem refs (nota entre parênteses) fica igual.")).toBe("Sem refs (nota entre parênteses) fica igual.")
  })
})

describe("V1.4.0 — suporte do pattern (§17–§20) e conclusão procedimental (§31–§35)", () => {
  const semantic = (ref: string, patterns: { kind: "STRENGTH" | "RISK" | "PROCEDURAL" | "MIXED" | "NEUTRAL"; supportLevel: "OBSERVED" | "REPEATED_IN_SAMPLE" | "RECURRENT_IN_SAMPLE" | "EMPLOYEE_PATTERN_SUPPORTED"; matched: number }[], analyzed = 8, universe = 30): LedgerEntry => ({ ...entry(ref, "analyze_interactions"), sampleCount: analyzed, signals: { interactionAnalysis: { analyzedTranscriptCount: analyzed, recordedUniverseCount: universe, universeRelationship: "PARTIAL_COVERAGE", findings: patterns.length, verifiedExcerpts: patterns.reduce((sum, item) => sum + item.matched, 0), patterns: patterns.map((item, index) => ({ ref: `P${index + 1}`, kind: item.kind, supportLevel: item.supportLevel, matchedTranscriptCount: item.matched, analyzedTranscriptCount: analyzed })), findingRefs: [{ ref: "I1/F1", kind: (patterns[0]?.kind === "PROCEDURAL" ? "PROCEDURAL_QUESTION" : "FRICTION") as never }] } } })

  it("§20/§57 amostra REPRESENTATIVA (8 de 30) mas pattern REPEATED_IN_SAMPLE (2 de 8): EMPLOYEE_PATTERN e PERIOD_PATTERN rejeitados por suporte; INTERACTION_SPECIFIC passa; EMPLOYEE_PATTERN_SUPPORTED libera", () => {
    const weak = [semantic("F3", [{ kind: "RISK", supportLevel: "REPEATED_IN_SAMPLE", matched: 2 }])]
    const synthesis = parseSynthesisFields({ behavioralClaims: [
      { text: "você costuma registrar sem responder", evidenceRefs: ["F3"], scope: "EMPLOYEE_PATTERN", patternRef: "F3/P1", polarity: "NEGATIVE" },
      { text: "no período você registra sem responder", evidenceRefs: ["F3"], scope: "PERIOD_PATTERN", patternRef: "F3/P1", polarity: "NEGATIVE" },
      { text: "em duas das oito interações analisadas você registrou sem responder", evidenceRefs: ["F3"], scope: "INTERACTION_SPECIFIC", findingRef: "I1/F1", polarity: "NEGATIVE" },
    ] })
    const rejected = gateSynthesis(synthesis, { ledger: weak, knowledgeAvailable: false, interactionUniverse: 30 })
    // V1.4.4: o escopo declarado acima do teto do objeto é rejeitado explicitamente (nunca reduzido em silêncio).
    expect(rejected.map((item) => item.text)).toEqual(["você costuma registrar sem responder", "no período você registra sem responder"])
    expect(rejected[0]!.reason).toContain("CLAIM_SCOPE_EXCEEDED: escopo declarado EMPLOYEE_PATTERN excede o teto INTERACTION_SPECIFIC")
    expect(rejected[1]!.reason).toContain("CLAIM_SCOPE_EXCEEDED: escopo declarado PERIOD_PATTERN excede o teto INTERACTION_SPECIFIC")
    // Com teto EMPLOYEE_PATTERN o mesmo texto forte passa (o objeto autoriza) — uma afirmação por candidato (§26), então a
    // segunda claim sobre o MESMO pattern é a duplicata, não um problema de escopo.
    const strong = [semantic("F3", [{ kind: "RISK", supportLevel: "EMPLOYEE_PATTERN_SUPPORTED", matched: 5 }, { kind: "STRENGTH", supportLevel: "EMPLOYEE_PATTERN_SUPPORTED", matched: 5 }])]
    expect(gateSynthesis(synthesis, { ledger: strong, knowledgeAvailable: false, interactionUniverse: 30 }).map((item) => item.reason.split(":")[0])).toEqual(["DUPLICATE_CANDIDATE_SELECTION"])
    // RECURRENT_IN_SAMPLE (teto PERIOD): "no período" passa; "costuma" (EMPLOYEE declarado) continua bloqueado.
    const recurrent = [semantic("F3", [{ kind: "RISK", supportLevel: "RECURRENT_IN_SAMPLE", matched: 4 }])]
    expect(gateSynthesis(synthesis, { ledger: recurrent, knowledgeAvailable: false, interactionUniverse: 30 }).map((item) => item.text)).toEqual(["você costuma registrar sem responder"])
  })

  it("fatos SEM camada semântica (runs antigos, get_interaction_flags) seguem a regra de representatividade de sempre — nunca mais permissivo, nunca quebra o legado", () => {
    const legacy = [{ ...entry("F3", "analyze_interactions"), sampleCount: 8 }]
    const synthesis = parseSynthesisFields({ behavioralClaims: [{ text: "você costuma registrar sem responder", evidenceRefs: ["F3"], scope: "EMPLOYEE_PATTERN", patternRef: "F3/P1", polarity: "NEGATIVE" }] })
    expect(gateSynthesis(synthesis, { ledger: legacy, knowledgeAvailable: false, interactionUniverse: 30 })).toEqual([])
    // Fato semântico SEM patterns (só findings por interação): escopo de padrão não é sustentado.
    const noPatterns = [semantic("F3", [])]
    expect(gateSynthesis(synthesis, { ledger: noPatterns, knowledgeAvailable: false, interactionUniverse: 30 })[0]!.reason).toContain("não têm padrão entre interações")
  })

  it("§56/§32 conclusão procedimental ('diverge do procedimento', 'orientação incorreta') exige ref da base (query_knowledge com trecho) além da interação; sem base → PROCEDURAL_CLAIM rejeitada; com base referenciada → aceita; KB só no prompt (sem Tool consultada) também vale", () => {
    const knowledge = { ...entry("F5", "query_knowledge"), sampleCount: 2 }
    const emptyKnowledge = entry("F6", "query_knowledge", "NO_DATA")
    const interaction = semantic("F3", [{ kind: "PROCEDURAL", supportLevel: "OBSERVED", matched: 1 }])
    const divergence = { text: "na interação analisada a orientação sobre documento diverge do procedimento", evidenceRefs: ["F3"], scope: "INTERACTION_SPECIFIC" as const, findingRef: "I1/F1", polarity: "NEGATIVE" as const }
    // Sem nenhuma base: rejeitada com o motivo e a reformulação sugerida.
    const withoutKb = gateSynthesis(parseSynthesisFields({ behavioralClaims: [divergence] }), { ledger: [interaction], knowledgeAvailable: false })
    expect(withoutKb).toHaveLength(1)
    expect(withoutKb[0]).toMatchObject({ kind: "PROCEDURAL_CLAIM" })
    expect(withoutKb[0]!.reason).toContain("PROCEDURAL_CONCLUSION_WITHOUT_KNOWLEDGE")
    expect(withoutKb[0]!.reason).toContain("questão procedimental")
    // Tool consultada mas sem trecho (NO_DATA) — KB insuficiente: continua rejeitada mesmo com knowledgeAvailable.
    expect(gateSynthesis(parseSynthesisFields({ behavioralClaims: [{ ...divergence, evidenceRefs: ["F3", "F6"] }] }), { ledger: [interaction, emptyKnowledge], knowledgeAvailable: true })).toHaveLength(1)
    // Base referenciada na claim: aceita.
    expect(gateSynthesis(parseSynthesisFields({ behavioralClaims: [{ ...divergence, evidenceRefs: ["F3", "F5"] }] }), { ledger: [interaction, knowledge], knowledgeAvailable: false })).toEqual([])
    // Base recuperada no prompt (feedback de chamada) sem query_knowledge na execução: aceita.
    expect(gateSynthesis(parseSynthesisFields({ behavioralClaims: [divergence] }), { ledger: [interaction], knowledgeAvailable: true })).toEqual([])
    // Questão procedimental (sem conclusão) nunca exige base.
    expect(gateSynthesis(parseSynthesisFields({ behavioralClaims: [{ text: "na interação analisada você afirmou que não é necessário enviar documento — ponto a verificar contra o procedimento", evidenceRefs: ["F3"], scope: "INTERACTION_SPECIFIC", findingRef: "I1/F1", polarity: "NEUTRAL" }] }), { ledger: [interaction], knowledgeAvailable: false })).toEqual([])
  })

  it("transversal: hipótese sustentada ou texto entregue que conclui divergência do procedimento sem NENHUMA base na execução é rejeitado; com base na execução passa (o léxico é rede de segurança)", () => {
    const interaction = semantic("F3", [{ kind: "PROCEDURAL", supportLevel: "OBSERVED", matched: 1 }])
    const synthesis = parseSynthesisFields({ supportedHypotheses: ["a orientação dada contraria o procedimento de titularidade (F3)"], behavioralClaims: [] })
    const text = "Na chamada analisada você orientou de forma incorreta sobre o envio do documento."
    const rejected = gateSynthesis(synthesis, { ledger: [interaction], knowledgeAvailable: false }, text)
    expect(rejected.map((item) => [item.kind, item.text])).toEqual([["PROCEDURAL_CLAIM", "a orientação dada contraria o procedimento de titularidade (F3)"], ["PROCEDURAL_CLAIM", "orientou de forma incorreta"]])
    expect(gateSynthesis(synthesis, { ledger: [interaction, { ...entry("F5", "query_knowledge"), sampleCount: 1 }], knowledgeAvailable: false }, text)).toEqual([])
    // Frases que NÃO são conclusão procedimental não disparam: "verificar o procedimento", "o procedimento prevê", "diverge do combinado".
    expect(gateSynthesis(parseSynthesisFields({ supportedHypotheses: ["vale verificar o procedimento de segunda via (F3)"], behavioralClaims: [] }), { ledger: [interaction], knowledgeAvailable: false }, "O procedimento prevê confirmação; a resposta diverge do combinado com o cliente.")).toEqual([])
  })

  it("a correção enviada ao modelo e o contrato COMPACT explicam suporte do padrão e conclusão procedimental", async () => {
    const { renderSynthesisContractRules } = await import("./evidence-gating.js")
    expect(renderSynthesisContractRules().rules).toContain("EMPLOYEE_PATTERN_SUPPORTED")
    expect(renderSynthesisContractRules().rules).toContain("CONCLUSÃO PROCEDIMENTAL")
    const correction = renderGatingCorrection([{ kind: "PROCEDURAL_CLAIM", text: "x", reason: "y" }])
    expect(correction).toContain("Conclusão procedimental")
    expect(correction).toContain("(8) ESCOPO DO PADRÃO")
    expect(correction).toContain("(9) CONCLUSÃO PROCEDIMENTAL")
    // O contrato CURRENT (braço de controle V1.2) continua byte a byte sem a regra nova.
    expect(renderSynthesisContract(["F1"])).not.toContain("EMPLOYEE_PATTERN_SUPPORTED")
  })
})

describe("V1.4.1/V1.4.2 — CLAIM ↔ PATTERN BINDING canônico (§2–§7, §10, §14, §21–§26)", () => {
  type Level = "OBSERVED" | "REPEATED_IN_SAMPLE" | "RECURRENT_IN_SAMPLE" | "EMPLOYEE_PATTERN_SUPPORTED"
  type P = { handle: string; kind: "STRENGTH" | "RISK" | "PROCEDURAL" | "MIXED" | "NEUTRAL" | "INTERACTION_FRICTION"; supportLevel: Level; matched: number; maximumClaimScope?: "INTERACTION_SPECIFIC" | "PERIOD_PATTERN" | "EMPLOYEE_PATTERN"; supportScope?: "SAMPLE" | "PERIOD" | "RECORDED_UNIVERSE" | "EMPLOYEE_PATTERN" }
  const semanticFact = (ref: string, patterns: P[], findings: { handle: string; ref: string; kind: string }[] = [], analyzed = 8, universe = 30): LedgerEntry => ({ ...entry(ref, "analyze_interactions"), sampleCount: analyzed, signals: { interactionAnalysis: { analyzedTranscriptCount: analyzed, recordedUniverseCount: universe, universeRelationship: "PARTIAL_COVERAGE", findings: patterns.length, verifiedExcerpts: 10, patterns: patterns.map((item, index) => ({ ref: `P${index + 1}`, handle: item.handle, kind: item.kind, supportLevel: item.supportLevel, ...(item.supportScope ? { supportScope: item.supportScope } : {}), ...(item.maximumClaimScope ? { maximumClaimScope: item.maximumClaimScope } : {}), matchedTranscriptCount: item.matched, analyzedTranscriptCount: analyzed })), findingRefs: findings.map((item) => ({ ref: item.ref, handle: item.handle, kind: item.kind as never })) } } })
  const gate = (claims: unknown[], ledger: LedgerEntry[], knowledgeAvailable = false) => gateSynthesis(parseSynthesisFields({ behavioralClaims: claims }), { ledger, knowledgeAvailable, interactionUniverse: 30 }).map((item) => `${item.kind}:${item.reason.split(":")[0]}`)
  const pattern = (patternRef: string) => ({ type: "PATTERN", patternRef })
  const finding = (findingRef: string) => ({ type: "FINDING", findingRef })

  it("§21 ref canônica: com SP1/SP2 no ledger o schema dinâmico aceita SP1 e recusa F3, F3/F-I24, SP99, P1 e listas — sem reparo fuzzy", () => {
    const ledger = [semanticFact("F3", [{ handle: "SP1", kind: "RISK", supportLevel: "RECURRENT_IN_SAMPLE", matched: 4, supportScope: "PERIOD", maximumClaimScope: "PERIOD_PATTERN" }, { handle: "SP2", kind: "STRENGTH", supportLevel: "REPEATED_IN_SAMPLE", matched: 2, supportScope: "SAMPLE", maximumClaimScope: "INTERACTION_SPECIFIC" }], [{ handle: "SF1", ref: "I1/F1", kind: "FRICTION" }, { handle: "SF2", ref: "I4/F1", kind: "STRENGTH" }])]
    const options = claimSupportOptionsOf(ledger)
    expect(options.patterns.map((item) => item.handle)).toEqual(["SP1", "SP2"])
    expect(options.findings.map((item) => item.handle)).toEqual(["SF1", "SF2"])
    const schema = claimSupportSchemaFor(options)
    expect(schema.safeParse(pattern("SP1")).success).toBe(true)
    expect(schema.safeParse(finding("SF2")).success).toBe(true)
    for (const bad of ["F3", "F3/F-I24", "SP99", "P1", "SP1, SP2", "F3/P1", "N/A"]) expect(schema.safeParse(pattern(bad)).success).toBe(false)
    expect(schema.safeParse(finding("I1/F1")).success).toBe(false)
    expect(schema.safeParse({ type: "OBSERVATION", observationRef: "O1" }).success).toBe(false)
    // Resolução: handle desconhecido/forma composta = rejeição com a lista dos handles válidos (nunca "closest ref").
    expect(resolveClaimSupport({ support: pattern("SP99") }, options)).toMatchObject({ ok: false, reason: expect.stringContaining("CLAIM_SUPPORT_REF_UNKNOWN") })
    expect((resolveClaimSupport({ support: pattern("SP99") }, options) as { reason: string }).reason).toContain("patternRef válidos: SP1, SP2")
    expect(resolveClaimSupport({ support: { type: "PATTERN", patternRef: "F3/F-I24" } }, options)).toMatchObject({ ok: false, reason: expect.stringContaining("CLAIM_SUPPORT_REF_UNKNOWN") })
    expect(resolveClaimSupport({ support: { type: "EVIDENCE", patternRef: "SP1" } }, options)).toMatchObject({ ok: false, reason: expect.stringContaining("CLAIM_SUPPORT_FORMAT") })
    expect(resolveClaimSupport({ patternRef: "F3" }, options)).toMatchObject({ ok: false, reason: expect.stringContaining("CLAIM_SUPPORT_FORMAT") })
    expect(resolveClaimSupport({ patternRef: "P1" }, options)).toMatchObject({ ok: false, reason: expect.stringContaining("CLAIM_SUPPORT_FORMAT") })
    expect(resolveClaimSupport({ findingRef: "I4, I6/F1" }, options)).toMatchObject({ ok: false, reason: expect.stringContaining("CLAIM_SUPPORT_FORMAT") })
    // Legado 100 % inequívoco: handle canônico solto ou forma V1.4.1 exata resolvem por lookup exato (marcados `legacy`).
    expect(resolveClaimSupport({ patternRef: "SP1" }, options)).toMatchObject({ ok: true, support: { type: "PATTERN", legacy: true, pattern: { handle: "SP1" } } })
    expect(resolveClaimSupport({ patternRef: "F3/P2" }, options)).toMatchObject({ ok: true, support: { type: "PATTERN", legacy: true, pattern: { handle: "SP2" } } })
    expect(resolveClaimSupport({ findingRef: "I4/F1" }, options)).toMatchObject({ ok: true, support: { type: "FINDING", legacy: true, finding: { handle: "SF2" } } })
    expect(resolveClaimSupport({ findingRef: "I9/F1" }, options)).toMatchObject({ ok: false, reason: expect.stringContaining("CLAIM_SUPPORT_REF_UNKNOWN") })
    expect(resolveClaimSupport({}, options)).toEqual({ ok: true, support: null })
    // Refs de fato implícitas no suporte (lineage): o fato que contém o pattern/finding.
    expect(factRefsFromBinding({ text: "x", evidenceRefs: [], support: pattern("SP1") }, ledger)).toEqual(["F3"])
    expect(factRefsFromBinding({ text: "x", evidenceRefs: [], support: finding("SF2") }, ledger)).toEqual(["F3"])
    expect(factRefsFromBinding({ text: "x", evidenceRefs: [], patternRef: "F3" }, ledger)).toEqual([])
  })

  it("§6 model context: a linha dinâmica lista SÓ handles existentes com kind, nível, escopo, teto e findings — o modelo seleciona, não constrói", () => {
    const ledger = [semanticFact("F3", [{ handle: "SP1", kind: "STRENGTH", supportLevel: "RECURRENT_IN_SAMPLE", matched: 4, supportScope: "PERIOD", maximumClaimScope: "PERIOD_PATTERN" }], [{ handle: "SF1", ref: "I2/F1", kind: "STRENGTH" }, { handle: "SF2", ref: "I5/F1", kind: "STRENGTH" }])]
    const line = renderSynthesisRefsLine(["F1", "F3"], claimSupportOptionsOf(ledger))
    expect(line).toContain("refs válidas são somente F1, F3")
    expect(line).toContain("support.patternRef só entre: SP1")
    expect(line).toContain("support.findingRef só entre: SF1, SF2")
    expect(line).toContain("SP1 — STRENGTH — nível RECURRENT_IN_SAMPLE — escopo PERIOD — claim até PERIOD_PATTERN — polarity permitida: POSITIVE|NEUTRAL (4 de 8 analisadas)")
    expect(line).toContain("SF1 (STRENGTH, I2 — polarity permitida: POSITIVE|NEUTRAL)")
    expect(renderClaimSupportsLine(claimSupportOptionsOf([entry("F1", "get_indicator_snapshot")]))).toContain("nenhum pattern nem finding semântico")
  })

  it("§22 omissão: claim INTERACTION_SPECIFIC sem support válido sobre fato semântico → REJECT (nada é inventado); com SF-n ou SP-n → passa; PERIOD/EMPLOYEE sem pattern → CLAIM_BINDING_MISSING", () => {
    const ledger = [semanticFact("F3", [{ handle: "SP1", kind: "RISK", supportLevel: "REPEATED_IN_SAMPLE", matched: 2, supportScope: "SAMPLE", maximumClaimScope: "INTERACTION_SPECIFIC" }], [{ handle: "SF1", ref: "I1/F1", kind: "FRICTION" }])]
    expect(gate([{ text: "na interação analisada você registrou sem responder", evidenceRefs: ["F3"], scope: "INTERACTION_SPECIFIC", polarity: "NEGATIVE" }], ledger)).toEqual(["CLAIM_BINDING:CLAIM_BINDING_MISSING"])
    expect(gate([{ text: "na interação analisada você registrou sem responder", evidenceRefs: ["F3"], scope: "INTERACTION_SPECIFIC", support: finding("SF1"), polarity: "NEGATIVE" }], ledger)).toEqual([])
    expect(gate([{ text: "em duas das oito interações analisadas você registrou sem responder", evidenceRefs: ["F3"], scope: "INTERACTION_SPECIFIC", support: pattern("SP1"), polarity: "NEGATIVE" }], ledger)).toEqual([])
    expect(gate([{ text: "na interação analisada você registrou sem responder", evidenceRefs: ["F3"], scope: "INTERACTION_SPECIFIC", support: finding("SF9"), polarity: "NEGATIVE" }], ledger)).toEqual(["CLAIM_BINDING:CLAIM_SUPPORT_REF_UNKNOWN"])
    // V1.4.4: o escopo declarado acima do teto do objeto é rejeitado como CLAIM_SCOPE_EXCEEDED (motivo mais preciso).
    expect(gate([{ text: "no período você registra sem responder", evidenceRefs: ["F3"], scope: "PERIOD_PATTERN", support: finding("SF1"), polarity: "NEGATIVE" }], ledger)).toEqual(["CLAIM_BINDING:CLAIM_SCOPE_EXCEEDED"])
    // Claim sem evidenceRefs mas com suporte válido: o fato implícito entra (nunca "sem referência"); "F3" solto morre por formato.
    const rejected = gateSynthesis(parseSynthesisFields({ behavioralClaims: [{ text: "na interação analisada você registrou sem responder", evidenceRefs: [], scope: "INTERACTION_SPECIFIC", support: finding("SF1"), polarity: "NEGATIVE" }, { text: "você registrou sem responder", evidenceRefs: [], scope: "INTERACTION_SPECIFIC", patternRef: "F3", polarity: "NEGATIVE" }] }), { ledger, knowledgeAvailable: false, interactionUniverse: 30 })
    expect(rejected.map((item) => item.reason.split(":")[0])).toEqual(["sem referência a fato do ledger"])
    // Fatos sem camada semântica seguem as regras de sempre (sem binding exigido).
    expect(gate([{ text: "você costuma fazer pausas", evidenceRefs: ["F4"], scope: "INTERACTION_SPECIFIC" }], [{ ...entry("F4", "get_interaction_flags"), sampleCount: 30 }])).toEqual([])
  })

  it("§23 PERIOD × EMPLOYEE: pattern RECURRENT_IN_SAMPLE com teto PERIOD_PATTERN — claim PERIOD passa, claim EMPLOYEE → CLAIM_SCOPE_EXCEEDED; teto EMPLOYEE_PATTERN libera EMPLOYEE; sinal antigo sem teto deriva do nível", () => {
    const period = [semanticFact("F3", [{ handle: "SP1", kind: "RISK", supportLevel: "RECURRENT_IN_SAMPLE", matched: 4, supportScope: "PERIOD", maximumClaimScope: "PERIOD_PATTERN" }])]
    expect(gate([{ text: "no período analisado você registra sem responder", evidenceRefs: ["F3"], scope: "PERIOD_PATTERN", support: pattern("SP1"), polarity: "NEGATIVE" }], period)).toEqual([])
    expect(gate([{ text: "você registra sem responder", evidenceRefs: ["F3"], scope: "EMPLOYEE_PATTERN", support: pattern("SP1"), polarity: "NEGATIVE" }], period)).toEqual(["CLAIM_BINDING:CLAIM_SCOPE_EXCEEDED"])
    // O teto do fato (patternSupportAllowedBy) e o teto do pattern (bindClaim) concordam: quando o fato tem outro pattern mais forte, a claim ligada ao fraco ainda excede.
    const mixed = [semanticFact("F3", [{ handle: "SP1", kind: "RISK", supportLevel: "RECURRENT_IN_SAMPLE", matched: 4, supportScope: "PERIOD", maximumClaimScope: "PERIOD_PATTERN" }, { handle: "SP2", kind: "STRENGTH", supportLevel: "EMPLOYEE_PATTERN_SUPPORTED", matched: 6, supportScope: "EMPLOYEE_PATTERN", maximumClaimScope: "EMPLOYEE_PATTERN" }])]
    expect(gate([{ text: "você registra sem responder", evidenceRefs: ["F3"], scope: "EMPLOYEE_PATTERN", support: pattern("SP1"), polarity: "NEGATIVE" }], mixed)).toEqual(["CLAIM_BINDING:CLAIM_SCOPE_EXCEEDED"])
    expect(gate([{ text: "você informa o protocolo com clareza", evidenceRefs: ["F3"], scope: "EMPLOYEE_PATTERN", support: pattern("SP2"), polarity: "POSITIVE" }], mixed)).toEqual([])
    const legacySignal = [semanticFact("F3", [{ handle: "SP1", kind: "RISK", supportLevel: "RECURRENT_IN_SAMPLE", matched: 4 }])]
    expect(gate([{ text: "no período analisado você registra sem responder", evidenceRefs: ["F3"], scope: "PERIOD_PATTERN", support: pattern("SP1"), polarity: "NEGATIVE" }], legacySignal)).toEqual([])
    expect(gate([{ text: "você registra sem responder", evidenceRefs: ["F3"], scope: "EMPLOYEE_PATTERN", support: pattern("SP1"), polarity: "NEGATIVE" }], legacySignal)).toEqual(["CLAIM_BINDING:CLAIM_SCOPE_EXCEEDED"])
    // POPULATION exige pattern (com teto ≥ PERIOD) e pares representativos.
    expect(gate([{ text: "comparado aos pares você registra mais sem responder", evidenceRefs: ["F3"], scope: "POPULATION_PATTERN", support: pattern("SP1"), polarity: "NEGATIVE" }], period)).toEqual(["BEHAVIORAL_CLAIM:escopo POPULATION_PATTERN"])
  })

  it("§26 linguagem × escopo: teto PERIOD aceita 'nas interações analisadas…' e recusa 'o colaborador costuma…'/'apresenta como característica'; teto EMPLOYEE aceita 'o colaborador apresenta…'", () => {
    const period = [semanticFact("F3", [{ handle: "SP1", kind: "RISK", supportLevel: "RECURRENT_IN_SAMPLE", matched: 4, supportScope: "RECORDED_UNIVERSE", maximumClaimScope: "PERIOD_PATTERN" }])]
    expect(gate([{ text: "nas interações analisadas você usou termos técnicos sem explicar", evidenceRefs: ["F3"], scope: "PERIOD_PATTERN", support: pattern("SP1"), polarity: "NEGATIVE" }], period)).toEqual([])
    expect(gate([{ text: "o colaborador costuma usar termos técnicos sem explicar", evidenceRefs: ["F3"], scope: "PERIOD_PATTERN", support: pattern("SP1"), polarity: "NEGATIVE" }], period)).toEqual(["CLAIM_BINDING:TEXT_SCOPE_MISMATCH"])
    expect(gate([{ text: "o colaborador apresenta como característica o uso de jargão", evidenceRefs: ["F3"], scope: "PERIOD_PATTERN", support: pattern("SP1"), polarity: "NEGATIVE" }], period)).toEqual(["CLAIM_BINDING:TEXT_SCOPE_MISMATCH"])
    const employee = [semanticFact("F3", [{ handle: "SP1", kind: "RISK", supportLevel: "EMPLOYEE_PATTERN_SUPPORTED", matched: 5, supportScope: "EMPLOYEE_PATTERN", maximumClaimScope: "EMPLOYEE_PATTERN" }])]
    expect(gate([{ text: "o colaborador apresenta como característica o uso de jargão sem explicação", evidenceRefs: ["F3"], scope: "EMPLOYEE_PATTERN", support: pattern("SP1"), polarity: "NEGATIVE" }], employee)).toEqual([])
    expect(gate([{ text: "você costuma usar termos técnicos sem explicar", evidenceRefs: ["F3"], scope: "EMPLOYEE_PATTERN", support: pattern("SP1"), polarity: "NEGATIVE" }], employee)).toEqual([])
  })

  it("§15/§50 polaridade preservada: STRENGTH não vira falha; RISK não vira ponto forte; MIXED aceita ambas; INTERACTION_FRICTION não aceita culpa do operador; léxico contradizendo a declarada rejeita", () => {
    const facts = [semanticFact("F3", [{ handle: "SP1", kind: "STRENGTH", supportLevel: "EMPLOYEE_PATTERN_SUPPORTED", matched: 6, maximumClaimScope: "EMPLOYEE_PATTERN" }, { handle: "SP2", kind: "RISK", supportLevel: "EMPLOYEE_PATTERN_SUPPORTED", matched: 5, maximumClaimScope: "EMPLOYEE_PATTERN" }, { handle: "SP3", kind: "MIXED", supportLevel: "EMPLOYEE_PATTERN_SUPPORTED", matched: 5, maximumClaimScope: "EMPLOYEE_PATTERN" }, { handle: "SP4", kind: "INTERACTION_FRICTION", supportLevel: "EMPLOYEE_PATTERN_SUPPORTED", matched: 5, maximumClaimScope: "EMPLOYEE_PATTERN" }])]
    expect(gate([{ text: "há falha recorrente ao informar o protocolo", evidenceRefs: ["F3"], scope: "EMPLOYEE_PATTERN", support: pattern("SP1"), polarity: "NEGATIVE" }], facts)).toEqual(["CLAIM_BINDING:CLAIM_POLARITY_MISMATCH"])
    expect(gate([{ text: "é um ponto forte interromper o cliente", evidenceRefs: ["F3"], scope: "EMPLOYEE_PATTERN", support: pattern("SP2"), polarity: "POSITIVE" }], facts)).toEqual(["CLAIM_BINDING:CLAIM_POLARITY_MISMATCH"])
    expect(gate([{ text: "você informa o protocolo com clareza", evidenceRefs: ["F3"], scope: "EMPLOYEE_PATTERN", support: pattern("SP1"), polarity: "POSITIVE" }], facts)).toEqual([])
    expect(gate([{ text: "você interrompe o cliente", evidenceRefs: ["F3"], scope: "EMPLOYEE_PATTERN", support: pattern("SP2"), polarity: "NEGATIVE" }], facts)).toEqual([])
    expect(gate([{ text: "você informa prazos, com falhas pontuais", evidenceRefs: ["F3"], scope: "EMPLOYEE_PATTERN", support: pattern("SP3"), polarity: "MIXED" }], facts)).toEqual([])
    expect(gate([{ text: "você deixa de resolver as insatisfações dos clientes", evidenceRefs: ["F3"], scope: "EMPLOYEE_PATTERN", support: pattern("SP4"), polarity: "NEGATIVE" }], facts)).toEqual(["CLAIM_BINDING:TEXT_POLARITY_MISMATCH"])
    expect(gate([{ text: "os clientes chegam insatisfeitos por atendimentos anteriores", evidenceRefs: ["F3"], scope: "EMPLOYEE_PATTERN", support: pattern("SP4"), polarity: "NEUTRAL" }], facts)).toEqual([])
    expect(gate([{ text: "nas interações analisadas ocorreu interrupção da fala do cliente em 2 de 8", evidenceRefs: ["F3"], scope: "EMPLOYEE_PATTERN", support: pattern("SP4"), polarity: "NEGATIVE" }], facts)).toEqual([])
    expect(gate([{ text: "o colaborador interrompeu a fala do cliente em 2 de 8", evidenceRefs: ["F3"], scope: "EMPLOYEE_PATTERN", support: pattern("SP4"), polarity: "NEGATIVE" }], facts)).toEqual(["CLAIM_BINDING:TEXT_POLARITY_MISMATCH"])
    expect(gate([{ text: "falha ao informar o protocolo", evidenceRefs: ["F3"], scope: "EMPLOYEE_PATTERN", support: pattern("SP1"), polarity: "POSITIVE" }], facts)).toEqual(["CLAIM_BINDING:TEXT_POLARITY_MISMATCH"])
  })

  it("§51/§33 procedural: conclusão sem pattern PROCEDURAL/finding PROCEDURAL_QUESTION → REJECT mesmo com KB no dossiê; com lineage + query_knowledge com trecho → passa; sem KB → questão procedimental", () => {
    const knowledge = { ...entry("F5", "query_knowledge"), sampleCount: 2 }
    const withoutLineage = [semanticFact("F3", [{ handle: "SP1", kind: "RISK", supportLevel: "OBSERVED", matched: 1 }], [{ handle: "SF1", ref: "I1/F1", kind: "FRICTION" }]), knowledge]
    expect(gate([{ text: "na interação analisada a orientação sobre documento diverge do procedimento", evidenceRefs: ["F3", "F5"], scope: "INTERACTION_SPECIFIC", support: finding("SF1"), polarity: "NEGATIVE" }], withoutLineage)).toEqual(["PROCEDURAL_CLAIM:PROCEDURAL_CONCLUSION_WITHOUT_LINEAGE"])
    const withLineage = [semanticFact("F3", [{ handle: "SP1", kind: "PROCEDURAL", supportLevel: "OBSERVED", matched: 1 }], [{ handle: "SF1", ref: "I1/F1", kind: "PROCEDURAL_QUESTION" }]), knowledge]
    expect(gate([{ text: "na interação analisada a orientação sobre documento diverge do procedimento", evidenceRefs: ["F3", "F5"], scope: "INTERACTION_SPECIFIC", support: finding("SF1"), polarity: "NEGATIVE" }], withLineage)).toEqual([])
    expect(gate([{ text: "na interação analisada a orientação sobre documento diverge do procedimento", evidenceRefs: ["F3"], scope: "INTERACTION_SPECIFIC", support: pattern("SP1"), polarity: "NEGATIVE" }], withLineage.slice(0, 1))).toEqual(["PROCEDURAL_CLAIM:PROCEDURAL_CONCLUSION_WITHOUT_KNOWLEDGE"])
    expect(gate([{ text: "na interação analisada você afirmou que não é necessário enviar documento — ponto a verificar contra o procedimento", evidenceRefs: ["F3"], scope: "INTERACTION_SPECIFIC", support: finding("SF1"), polarity: "NEUTRAL" }], withLineage.slice(0, 1))).toEqual([])
  })

  it("§20 categorias de correção: formato/handle/omissão do suporte = BINDING_FORMAT; escopo, polaridade, evidência, procedimento = SEMANTIC; relação temporal = TEMPORAL", () => {
    const item = (kind: "CLAIM_BINDING" | "BEHAVIORAL_CLAIM" | "TEMPORAL_CLAIM" | "PROCEDURAL_CLAIM" | "CRITICAL_FACT" | "RECOMMENDATION", reason: string) => ({ kind, text: "x", reason })
    expect(rejectionCategoryOf(item("CLAIM_BINDING", "CLAIM_SUPPORT_FORMAT: patternRef \"F3\"…"))).toBe("BINDING_FORMAT")
    expect(rejectionCategoryOf(item("CLAIM_BINDING", "CLAIM_SUPPORT_REF_UNKNOWN: …"))).toBe("BINDING_FORMAT")
    expect(rejectionCategoryOf(item("CLAIM_BINDING", "CLAIM_BINDING_MISSING: …"))).toBe("BINDING_FORMAT")
    expect(rejectionCategoryOf(item("CLAIM_BINDING", "CLAIM_SCOPE_EXCEEDED: …"))).toBe("SEMANTIC")
    expect(rejectionCategoryOf(item("CLAIM_BINDING", "CLAIM_POLARITY_MISMATCH: …"))).toBe("SEMANTIC")
    expect(rejectionCategoryOf(item("CLAIM_BINDING", "CLAIM_SUPPORT_INSUFFICIENT: …"))).toBe("SEMANTIC")
    expect(rejectionCategoryOf(item("BEHAVIORAL_CLAIM", "sem referência a fato do ledger"))).toBe("SEMANTIC")
    expect(rejectionCategoryOf(item("TEMPORAL_CLAIM", "TEMPORAL_SUPPORT_SCOPE: …"))).toBe("TEMPORAL")
    expect(correctionCategoriesOf([item("CLAIM_BINDING", "CLAIM_SUPPORT_FORMAT: x"), item("CLAIM_BINDING", "CLAIM_BINDING_MISSING: y"), item("TEMPORAL_CLAIM", "z")])).toEqual(["BINDING_FORMAT", "TEMPORAL"])
  })

  it("§36 stripInternalRefs remove '(Interação I10)', '(interações I9 e I10)', '(ref I3)', '(pattern F3/P2)', '(finding I6/F1)', '(SP1)', '(suporte SF3)' e mantém o resto", () => {
    expect(stripInternalRefs('Você informou o protocolo (Interação I10) e registrou tudo (Interações I9 e I10). Veja (ref I3), (pattern F3/P2) e (finding I6/F1). O horário (das 9 às 18) continua.')).toBe("Você informou o protocolo e registrou tudo. Veja, e. O horário (das 9 às 18) continua.")
    expect(stripInternalRefs("Você informa prazos completos (SP1) e confirmou o protocolo (suporte SF3).")).toBe("Você informa prazos completos e confirmou o protocolo.")
    expect(stripInternalRefs("Sem refs aqui (2 de 8).")).toBe("Sem refs aqui (2 de 8).")
  })
})

describe("V1.4.1 — fallback factual sem handles: a linha do ledger é sanitizada para o colaborador", () => {
  it("remove '; findings: I6/F1 [STRENGTH] …', prefixos P1 e legendas de suporte; preserva o fato", async () => {
    const { sanitizeLedgerSummaryForCollaborator } = await import("./evidence-gating.js")
    const line = '8 transcrição(ões) analisada(s) de 24 registradas no período (33.30%) · SEMÂNTICA: 8 frame(s), 7 com finding — 1 força(s), 2 risco(s); findings: I24/F1 [STRENGTH] Operador fornece prazo… | I23/F1 [INTERACTION_FRICTION] Cliente relata…: 1 pattern(s) com evidência — P1 "Fornecimento de prazos claros" (STRENGTH; trecho verificado em ≥2 de 8 analisadas; suporte REPEATED_IN_SAMPLE) [contagem = transcrições analisadas com trecho citado] [suporte: OBSERVED/REPEATED_IN_SAMPLE sustentam só "nas interações analisadas"; claims citam o pattern por F-n/P-n]'
    const out = sanitizeLedgerSummaryForCollaborator(line)
    expect(out).not.toMatch(/I\d+\/F\d+|\bP\d\b|findings:|suporte:|F-n\/P-n/)
    expect(out).toContain('1 pattern(s) com evidência — "Fornecimento de prazos claros" (STRENGTH; trecho verificado em ≥2 de 8 analisadas; suporte REPEATED_IN_SAMPLE)')
    expect(out).toContain("8 frame(s), 7 com finding — 1 força(s), 2 risco(s)")
    // V1.4.2: linha com handles canônicos (SP-n/SF-n, escopo/teto e legenda nova) também sai limpa.
    const canonical = '8 transcrição(ões) analisada(s) de 24 registradas no período (33.30%) · SEMÂNTICA: 8 frame(s), 7 com finding — 1 força(s), 2 risco(s); findings: SF1 [STRENGTH] I24: Operador fornece prazo… | SF2 [INTERACTION_FRICTION] I23: Cliente relata…: 1 pattern(s) com evidência — SP1 "Fornecimento de prazos claros" (STRENGTH; trecho verificado em ≥4 de 8 analisadas; nível RECURRENT_IN_SAMPLE; escopo PERIOD → claim até PERIOD_PATTERN; findings SF1, SF3) [contagem = transcrições analisadas com trecho citado] [nível = quanto se repetiu; escopo = até onde generalizar: SAMPLE só "nas interações analisadas"]'
    const cleaned = sanitizeLedgerSummaryForCollaborator(canonical)
    expect(cleaned).not.toMatch(/S[PF]\d|findings|escopo|claim até|nível =/)
    expect(cleaned).toContain('1 pattern(s) com evidência — "Fornecimento de prazos claros" (STRENGTH; trecho verificado em ≥4 de 8 analisadas; nível RECURRENT_IN_SAMPLE)')
  })
})

/**
 * V1.4.5 — PROCEDURAL & SEMANTIC INTERPRETATION: a avaliação procedimental da execução passa a ser evidência normativa
 * (regra com trecho LITERAL da base), e a linguagem de aderência INTEGRAL é rejeitada enquanto a cobertura for PARCIAL.
 */
describe("V1.4.5 §16/§19 — evidência normativa verificada e cobertura procedimental", () => {
  const base = (ref: string, tool: string): LedgerEntry => ({ ref, sequence: Number(ref.slice(1)), round: 1, tool, capability: "x", keyArgs: "", summary: "s", qualityStatus: "SUFFICIENT", qualityNote: null, sampleCount: 8, periodLabel: null, preflight: false })
  const proceduralFact = (ref: string, rulesVerified: number, kind: string): LedgerEntry => ({
    ...base(ref, "analyze_interactions"),
    signals: { interactionAnalysis: { analyzedTranscriptCount: 8, recordedUniverseCount: 30, universeRelationship: "PARTIAL_COVERAGE", findings: 1, verifiedExcerpts: 4, patterns: [{ ref: "P1", handle: "SP1", kind: "PROCEDURAL", supportLevel: "OBSERVED", matchedTranscriptCount: 1, analyzedTranscriptCount: 8 }], findingRefs: [{ ref: "I1/FP1", handle: "SF1", kind: kind as never, procedural: { status: "CONTRADICTED", hasRule: true } }], procedural: { assertions: 1, quantitiesParsed: 1, excerptsAvailable: 2, rulesDeclared: rulesVerified, rulesVerified, rulesRejected: 0, knowledgeSource: "TOOL_RESULTS", evaluations: 1, byStatus: { CONSISTENT: 0, POTENTIAL_DIVERGENCE: 0, CONTRADICTED: 1, INSUFFICIENT_KNOWLEDGE: 0, NOT_APPLICABLE: 0 }, coverage: "PARTIAL" } } },
  })
  const gate = (claims: unknown[], ledger: LedgerEntry[]) => gateSynthesis(parseSynthesisFields({ behavioralClaims: claims }), { ledger, knowledgeAvailable: false, interactionUniverse: 30 }).map((item) => `${item.kind}:${item.reason.split(":")[0]}`)

  it("§16 divergência verificada pela aplicação (regra com trecho literal) sustenta a conclusão procedimental sem um fato query_knowledge separado", () => {
    const claim = { text: "na interação analisada a orientação sobre documento diverge do procedimento", evidenceRefs: ["F3"], scope: "INTERACTION_SPECIFIC", findingRef: "SF1", polarity: "NEGATIVE" }
    expect(gate([claim], [proceduralFact("F3", 2, "PROCEDURAL_DIVERGENCE")])).toEqual([])
    // Sem NENHUMA regra verificada, a mesma frase volta a ser uma conclusão sem base (fail-closed preservado).
    expect(gate([claim], [proceduralFact("F3", 0, "PROCEDURAL_DIVERGENCE")])).toEqual(["PROCEDURAL_CLAIM:PROCEDURAL_CONCLUSION_WITHOUT_KNOWLEDGE"])
  })

  it("§19/§41 aderência PARCIAL não vira 'aderência integral' — na claim e nas superfícies transversais", () => {
    const ledger = [proceduralFact("F3", 2, "STRENGTH")]
    expect(gate([{ text: "o colaborador seguiu integralmente o procedimento de segunda via", evidenceRefs: ["F3"], scope: "INTERACTION_SPECIFIC", findingRef: "SF1", polarity: "POSITIVE" }], ledger)).toEqual(["PROCEDURAL_CLAIM:PROCEDURAL_COVERAGE_OVERSTATED"])
    expect(gate([{ text: "os requisitos verificados do procedimento foram cumpridos na interação analisada", evidenceRefs: ["F3"], scope: "INTERACTION_SPECIFIC", findingRef: "SF1", polarity: "POSITIVE" }], ledger)).toEqual([])
    const transversal = gateSynthesis(parseSynthesisFields({ behavioralClaims: [] }), { ledger, knowledgeAvailable: false, interactionUniverse: 30 }, "Houve aderência integral ao procedimento em todas as chamadas.")
    expect(transversal.some((item) => item.reason.startsWith("PROCEDURAL_COVERAGE_OVERSTATED (texto entregue)"))).toBe(true)
  })
})
