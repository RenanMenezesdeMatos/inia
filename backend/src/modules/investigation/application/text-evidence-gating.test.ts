import { describe, expect, it, vi } from "vitest"
import { collectSpecialistClaims, collectSpecialistTemporalAuthorization, EVIDENCE_MARKER, extractEvidenceMarker, gateOrchestratorClaims, gateStructuredReply, gateTextReply, renderFactualFallback, renderSpecialistClaims, renderTextEvidenceInstructions } from "./text-evidence-gating.js"
import { TEMPORAL_SAFE_MEANINGS } from "../domain/temporal-semantics.js"
import type { LedgerEntry } from "../domain/evidence-ledger.js"

const entry = (ref: string, tool: string, sampleCount: number | null): LedgerEntry => ({ ref, sequence: 1, round: 1, tool, capability: "x", keyArgs: "", summary: `fato ${ref}`, qualityStatus: "SUFFICIENT", qualityNote: null, sampleCount, periodLabel: null, preflight: false })
const ledger = [entry("F1", "get_indicator_snapshot", 21), entry("F2", "analyze_interactions", 2)]
const context = { ledger, knowledgeAvailable: false, interactionUniverse: 1267, limitations: ["amostra de 2 interações"] }

describe("gating em respostas de texto (chat/voz/especialista)", () => {
  it("extrai a linha EVIDENCE_JSON (nunca mostrada ao usuário) e tolera ausência/JSON inválido", () => {
    const parsed = extractEvidenceMarker(`Resposta ao operador.\n${EVIDENCE_MARKER} {"behavioralClaims":[{"text":"x","evidenceRefs":["F2"],"scope":"INTERACTION_SPECIFIC"}],"limitations":["a"]}`)
    expect(parsed.text).toBe("Resposta ao operador.")
    expect(parsed.present).toBe(true)
    expect(parsed.synthesis.behavioralClaims[0]?.scope).toBe("INTERACTION_SPECIFIC")
    expect(extractEvidenceMarker("sem marcador")).toMatchObject({ text: "sem marcador", present: false, parseStatus: "MISSING" })
    expect(extractEvidenceMarker(`x\n${EVIDENCE_MARKER} {inválido`)).toMatchObject({ text: "x", present: false, parseStatus: "INVALID" })
    // JSON válido mas sem a lista de claims não é envelope (fail-closed): nunca vale como "zero afirmações".
    expect(extractEvidenceMarker(`x\n${EVIDENCE_MARKER} {"limitations":["a"]}`)).toMatchObject({ present: false, parseStatus: "INVALID" })
    expect(renderTextEvidenceInstructions(["F1", "F2"], { transcriptRef: "TRANSCRICAO" })).toContain("Refs válidas: F1, F2 (TRANSCRICAO = a transcrição em foco)")
  })

  it("V1.3.2 (BUG_1 do BENCHMARK_BLIND_V1): SUPPORT_MATERIALS_JSON depois de EVIDENCE_JSON não invalida o envelope e sobrevive no texto para o parser dele", async () => {
    const envelope = `${EVIDENCE_MARKER}\n{"supportedHypotheses":[],"unsupportedHypotheses":[],"limitations":["amostra de 2"],"behavioralClaims":[{"text":"Nas interações analisadas você repetiu a confirmação","evidenceRefs":["F2"],"scope":"INTERACTION_SPECIFIC"}],"recommendationSupport":[]}`
    const materials = `SUPPORT_MATERIALS_JSON:\n[\n {\n "materialId": "M1",\n "reason": "checklist"\n }\n]`
    for (const raw of [`Diagnóstico.\n\n${envelope}\n\n${materials}`, `Diagnóstico.\n${materials}\n${envelope}`]) {
      const parsed = extractEvidenceMarker(raw)
      expect(parsed).toMatchObject({ present: true, parseStatus: "PARSED", markerStatus: "VALID" })
      expect(parsed.text).toContain("SUPPORT_MATERIALS_JSON:")
      expect(parsed.text).toContain("Diagnóstico.")
      expect(parsed.text).not.toContain(EVIDENCE_MARKER)
      const generate = vi.fn().mockResolvedValueOnce(raw)
      const outcome = await gateTextReply(generate, context, "FACTUAL")
      expect(generate).toHaveBeenCalledTimes(1)
      expect(outcome.gating).toMatchObject({ envelopePresent: true, parseStatus: "PARSED", markerStatus: "VALID", fallbackUsed: false, correctionAttempted: false })
    }
    // Duplicado e malformado continuam fail-closed, com o motivo do framing na telemetria.
    expect(extractEvidenceMarker(`x\n${envelope}\n${envelope}`)).toMatchObject({ present: false, parseStatus: "INVALID", markerStatus: "MARKER_DUPLICATE" })
    expect(extractEvidenceMarker(`x\n${EVIDENCE_MARKER} {"behavioralClaims":[`)).toMatchObject({ present: false, parseStatus: "INVALID", markerStatus: "MARKER_BOUNDARY_ERROR" })
  })

  it("claim INTERACTION_SPECIFIC com evidência passa sem correção; EMPLOYEE_PATTERN com 2 de 1.267 é corrigida em UMA re-request", async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce(`Você costuma repetir a confirmação.\n${EVIDENCE_MARKER} {"behavioralClaims":[{"text":"Você costuma repetir a confirmação","evidenceRefs":["F2"],"scope":"EMPLOYEE_PATTERN"}]}`)
      .mockResolvedValueOnce(`Nas duas interações analisadas você repetiu a confirmação.\n${EVIDENCE_MARKER} {"behavioralClaims":[{"text":"Nas duas interações analisadas você repetiu a confirmação","evidenceRefs":["F2"],"scope":"INTERACTION_SPECIFIC"}],"limitations":["amostra de 2"]}`)
    const outcome = await gateTextReply(generate, context, "FACTUAL")
    expect(generate).toHaveBeenCalledTimes(2)
    expect(generate.mock.calls[1]![0]).toContain("CORREÇÃO OBRIGATÓRIA")
    expect(outcome.text).toBe("Nas duas interações analisadas você repetiu a confirmação.")
    expect(outcome.gating).toEqual({ rejectedClaims: [{ kind: "BEHAVIORAL_CLAIM", text: "Você costuma repetir a confirmação", reason: 'escopo EMPLOYEE_PATTERN: evidência anedótica para generalizar como padrão do colaborador — só sustenta "nas interações analisadas"' }], corrected: true, envelopePresent: true, parseStatus: "PARSED", markerStatus: "VALID", firstAttemptMarkerStatus: "VALID", correctionAttempted: true, correctionSucceeded: true, fallbackUsed: false, fallbackReason: null, factPreservation: "NOT_APPLICABLE", correctionCategories: ["SEMANTIC"], persistentCategories: [], salvage: "NONE", claimOutcomes: [{ text: "Nas duas interações analisadas você repetiu a confirmação", status: "ACCEPTED_CORRECTED", reason: null, category: null }], claimsProposed: 1, claimsAcceptedFirstPass: 0, claimsCorrectionRequired: 1, claimsCorrected: 1, claimsDropped: 0, claimsPreservedAfterSiblingFailure: 0, recommendationsDropped: 0, claimCandidatesAvailable: 0, claimCandidatesSelected: 0, claimCandidatesDelivered: 0, textPolarityMismatch: 0, textScopeMismatch: 0, candidateSwapRejected: 0, duplicateCandidateSelection: 0 })
    expect(outcome.replacedByFactual).toBe(false)
    expect(outcome.synthesis.evidenceRepresentativeness).toMatchObject([{ ref: "F2", tool: "analyze_interactions", analyzed: 2, universe: 1267, level: "ANECDOTAL", recordedCoverage: 0.002, operationalCoverage: null, universeRelationship: "UNKNOWN" }])
  })

  it("chat/voz: violação persistente vira resposta FACTUAL (só o ledger + limitações); Workflow: descarta com AGENT_UNSUPPORTED_BEHAVIORAL_CLAIM", async () => {
    const insist = async () => `Você navega lentamente.\n${EVIDENCE_MARKER} {"behavioralClaims":[{"text":"Você navega lentamente","evidenceRefs":["F1"]}]}`
    const factual = await gateTextReply(insist, context, "FACTUAL")
    expect(factual.replacedByFactual).toBe(true)
    expect(factual.text).toContain("limitada aos fatos apurados")
    expect(factual.text).toContain("- fato F1")
    expect(factual.text).not.toContain("navega lentamente")
    expect(factual.text).toContain("amostra de 2 interações")
    expect(factual.synthesis.behavioralClaims).toEqual([])
    expect(factual.gating.rejectedClaims).toHaveLength(2)
    // V1.4.3: a afirmação insiste E continua no texto entregue — resíduo não isolável, fallback inteiro (§9/§11).
    expect(factual.gating).toMatchObject({ corrected: false, envelopePresent: true, correctionAttempted: true, correctionSucceeded: false, fallbackUsed: true, fallbackReason: "UNISOLABLE_TEXT", salvage: "FULL_FALLBACK", claimsDropped: 1, claimsPreservedAfterSiblingFailure: 0 })
    await expect(gateTextReply(insist, context, "THROW")).rejects.toMatchObject({ code: "AGENT_UNSUPPORTED_BEHAVIORAL_CLAIM" })
  })

  // V1.3 — FAIL-CLOSED (§2/3/51): sem envelope a resposta original NUNCA chega ao usuário.
  it("TEXT sem EVIDENCE_JSON: pede o envelope em UMA correção; se o retry vier válido, a resposta corrigida passa", async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce("Você costuma navegar lentamente no sistema.")
      .mockResolvedValueOnce(`Os dados mostram o TMA acima da meta; a amostra de 2 interações não permite afirmar a causa.\n${EVIDENCE_MARKER} {"behavioralClaims":[],"limitations":["amostra de 2"],"recommendationSupport":[]}`)
    const outcome = await gateTextReply(generate, context, "FACTUAL")
    expect(generate).toHaveBeenCalledTimes(2)
    expect(generate.mock.calls[1]![0]).toContain("não trouxe a linha interna EVIDENCE_JSON")
    expect(outcome.text).toContain("Os dados mostram o TMA acima da meta")
    expect(outcome.replacedByFactual).toBe(false)
    expect(outcome.gating).toMatchObject({ envelopePresent: true, parseStatus: "PARSED", correctionAttempted: true, correctionSucceeded: true, fallbackUsed: false })
  })

  it("TEXT sem envelope duas vezes: chat recebe o SAFE FACTUAL FALLBACK (nenhum texto comportamental original vaza); Workflow descarta", async () => {
    const never = async () => "Você costuma navegar lentamente no sistema e demora no fechamento."
    const outcome = await gateTextReply(never, { ...context, knowledgeAvailable: true }, "FACTUAL")
    expect(outcome.replacedByFactual).toBe(true)
    expect(outcome.text).not.toContain("navegar lentamente")
    expect(outcome.text).not.toContain("fechamento")
    expect(outcome.text).toContain("não pôde ser validada contra as evidências")
    expect(outcome.text).toContain("- fato F1")
    expect(outcome.gating).toEqual({ rejectedClaims: [], corrected: false, envelopePresent: false, parseStatus: "MISSING", markerStatus: "MARKER_NOT_FOUND", firstAttemptMarkerStatus: "MARKER_NOT_FOUND", correctionAttempted: true, correctionSucceeded: false, fallbackUsed: true, fallbackReason: "ENVELOPE_MISSING", correctionCategories: ["ENVELOPE"], persistentCategories: ["ENVELOPE"], salvage: "FULL_FALLBACK" })
    expect(outcome.synthesis.behavioralClaims).toEqual([])
    await expect(gateTextReply(never, context, "THROW")).rejects.toMatchObject({ code: "AGENT_EVIDENCE_ENVELOPE_MISSING" })
  })

  it("SAFE FACTUAL FALLBACK é determinístico: só ledger validado, limitações e orientação de base real — nunca claims", () => {
    const synthesis = { supportedHypotheses: ["x"], unsupportedHypotheses: [], limitations: ["cobertura parcial"], behavioralClaims: [{ text: "você demora", evidenceRefs: [] }], recommendationSupport: [{ text: "Consulte o checklist de encerramento (F9)", basis: "KNOWLEDGE_GUIDANCE" as const, evidenceRefs: [] }, { text: "seja mais rápido", basis: "GENERAL_DEVELOPMENT_SUGGESTION" as const, evidenceRefs: [] }] }
    const text = renderFactualFallback(ledger, ["amostra de 2 interações"], { synthesis, knowledgeAvailable: true, reason: "CLAIMS_REJECTED" })
    expect(text).toContain("- fato F1")
    expect(text).toContain("Orientação do procedimento (base de conhecimento): Consulte o checklist de encerramento.")
    expect(text).toContain("Limitações: amostra de 2 interações; cobertura parcial.")
    expect(text).not.toContain("você demora")
    expect(text).not.toContain("seja mais rápido")
    // Sem base real, a orientação de KB não entra (não é validável).
    expect(renderFactualFallback(ledger, [], { synthesis, knowledgeAvailable: false })).not.toContain("Orientação do procedimento")
  })

  it("JSON estruturado (Agent/especialista FEEDBACK): sem os campos internos → correção; persistindo → descarte com AGENT_EVIDENCE_ENVELOPE_MISSING e o gating no erro", async () => {
    const parse = (raw: string) => JSON.parse(raw) as unknown
    const fixed = vi.fn().mockResolvedValueOnce('{"title":"t","recommendation":"você costuma…"}').mockResolvedValueOnce('{"title":"t","recommendation":"os dados mostram…","behavioralClaims":[],"recommendationSupport":[]}')
    const ok = await gateStructuredReply(fixed, parse, context, () => "descartada")
    expect(ok.gating).toMatchObject({ envelopePresent: true, correctionAttempted: true, correctionSucceeded: true, fallbackUsed: false })
    expect(fixed.mock.calls[1]![0]).toContain("não trouxe os campos internos de auditoria")
    const never = async () => '{"title":"t","recommendation":"você costuma…"}'
    await expect(gateStructuredReply(never, parse, context, () => "descartada")).rejects.toMatchObject({ code: "AGENT_EVIDENCE_ENVELOPE_MISSING", gating: { envelopePresent: false, parseStatus: "MISSING", correctionAttempted: true, correctionSucceeded: false, fallbackReason: "ENVELOPE_MISSING" } })
  })
})

describe("gating do Orquestrador — nunca eleva o escopo das claims dos especialistas", () => {
  const specialists = [
    { agentName: "Retenção", synthesis: { supportedHypotheses: [], unsupportedHypotheses: [], limitations: ["amostra de 2"], behavioralClaims: [{ text: "Em I1 houve pausa longa", evidenceRefs: ["F2"], scope: "INTERACTION_SPECIFIC" as const }], recommendationSupport: [], evidenceRepresentativeness: [{ ref: "F2", tool: "analyze_interactions", analyzed: 2, universe: 1267, level: "ANECDOTAL" as const }] } },
    { agentName: "Faturamento", synthesis: undefined },
  ]
  const claims = collectSpecialistClaims(specialists)

  it("numera as claims C1..Cn com escopo e representatividade para o prompt da síntese", () => {
    expect(claims).toEqual([{ ref: "C1", text: "Em I1 houve pausa longa", scope: "INTERACTION_SPECIFIC", representativeness: "ANECDOTAL", specialist: "Retenção" }])
    expect(renderSpecialistClaims(claims, ["amostra de 2"])).toContain("C1 [nesta(s) interação(ões) · evidência anecdotal] Em I1 houve pausa longa (Retenção)")
  })

  it("claim do Orquestrador precisa referenciar C-n e manter (ou reduzir) o escopo; 'pausas recorrentes' a partir de uma interação é rejeitada", () => {
    const ok = { supportedHypotheses: [], unsupportedHypotheses: [], limitations: [], behavioralClaims: [{ text: "Na interação analisada houve pausa longa", evidenceRefs: ["C1"], scope: "INTERACTION_SPECIFIC" as const }], recommendationSupport: [] }
    expect(gateOrchestratorClaims(ok, claims)).toEqual([])
    const elevated = { ...ok, behavioralClaims: [{ text: "O colaborador apresenta pausas longas recorrentes", evidenceRefs: ["C1"], scope: "EMPLOYEE_PATTERN" as const }, { text: "Pausas frequentes", evidenceRefs: [], scope: "INTERACTION_SPECIFIC" as const }] }
    expect(gateOrchestratorClaims(elevated, claims).map((item) => item.reason)).toEqual(["escopo EMPLOYEE_PATTERN amplia o que os especialistas sustentaram (C1=INTERACTION_SPECIFIC)", "sem referência a uma afirmação de especialista (C-n)"])
    expect(gateOrchestratorClaims(ok, []).map((item) => item.reason)).toEqual(["nenhum especialista sustentou afirmação comportamental"])
  })

  it("V1.3.4.2 §18: a síntese do Orquestrador não pode escrever 'permaneceu estável' quando o especialista concluiu NO_DIFFERENCE; com STABILITY aceita pelo especialista passa; a formulação segura sempre passa", () => {
    const ok = { supportedHypotheses: [], unsupportedHypotheses: [], limitations: [], behavioralClaims: [{ text: "Na interação analisada houve pausa longa", evidenceRefs: ["C1"], scope: "INTERACTION_SPECIFIC" as const }], recommendationSupport: [] }
    const noDifference = collectSpecialistTemporalAuthorization([{ investigation: { synthesis: specialists[0]!.synthesis, temporal: { conclusion: { kind: "NO_DIFFERENCE_SUPPORTED", safeMeaning: TEMPORAL_SAFE_MEANINGS.NO_DIFFERENCE_SUPPORTED, supportedRelations: [], allowedRelations: [], refs: ["F3"], supportScope: "SAMPLE" } }, evidenceSources: { used: ["INTERACTION_CONTENT"] } } }])
    expect(noDifference).toMatchObject({ acceptedRelations: [], indicatorTemporalFact: false })
    expect(gateOrchestratorClaims(ok, claims, { ...noDifference, text: "Seu comportamento se manteve constante ao longo do trimestre." }).map((item) => item.reason.split(":")[0])).toEqual(["TEMPORAL_CONCLUSION_INCOMPATIBLE"])
    expect(gateOrchestratorClaims({ ...ok, supportedHypotheses: ["O padrão permaneceu estável no período (C1)"] }, claims, { ...noDifference, text: "Não foi encontrada diferença temporal sustentada nas evidências analisadas." }).map((item) => item.reason.split(":")[0])).toEqual(["TEMPORAL_CONCLUSION_INCOMPATIBLE"])
    expect(gateOrchestratorClaims(ok, claims, { ...noDifference, text: "Não foi encontrada diferença temporal sustentada nas evidências analisadas. Na interação analisada houve pausa longa." })).toEqual([])
    const stability = collectSpecialistTemporalAuthorization([{ investigation: { synthesis: { ...specialists[0]!.synthesis!, behavioralClaims: [{ text: "permaneceu estável", evidenceRefs: ["F3"], scope: "INTERACTION_SPECIFIC", temporalRelation: "STABILITY" }] }, temporal: { conclusion: { kind: "SUPPORTED_RELATION", safeMeaning: TEMPORAL_SAFE_MEANINGS.SUPPORTED_RELATION, supportedRelations: [{ ref: "F3", relation: "STABLE", earlierBucket: "B1", laterBucket: "B3", trendSupported: false, supportScope: "RECORDED_UNIVERSE" }], allowedRelations: ["STABILITY"], refs: ["F3"], supportScope: "RECORDED_UNIVERSE" } } } }])
    expect(stability.acceptedRelations).toEqual(["STABILITY"])
    expect(gateOrchestratorClaims(ok, claims, { ...stability, text: "Seu comportamento se manteve constante ao longo do trimestre." })).toEqual([])
    // Sem especialista com comparação (NOT_COMPARED): estabilidade e mudança continuam bloqueadas.
    expect(gateOrchestratorClaims(ok, claims, { conclusions: [], acceptedRelations: [], indicatorTemporalFact: false, text: "Houve uma transição clara de postura e depois permaneceu estável." }).map((item) => item.reason.split(":")[0])).toEqual(["TEMPORAL_CONCLUSION_INCOMPATIBLE", "TEMPORAL_RELATION_UNDECLARED"])
  })
})

describe("Orquestrador preserva a semântica de parada dos especialistas (V1.3.1 — §34)", () => {
  it("INSUFFICIENT_DATA de um especialista entra no bloco de evidência com a regra de nunca virar causa provável", () => {
    const block = renderSpecialistClaims([], ["amostra de 2"], [{ specialist: "Performance", stopReason: "INSUFFICIENT_DATA", status: "INSUFFICIENT_DATA" }, { specialist: "Faturamento", stopReason: "ANSWER_SUFFICIENT", status: "SUFFICIENT" }])
    expect(block).toContain("Performance = INSUFFICIENT_DATA")
    expect(block).toContain("ATENÇÃO: Performance terminou SEM evidência suficiente")
    expect(block).toContain('nunca vira "provavelmente a causa é X"')
    expect(renderSpecialistClaims([], [], [])).toBe("")
  })
})

// ---------------------------------------------------------------------------------------------
// V1.4.3 — CLAIM SALVAGE (§2–§12, §48–§52): uma afirmação inválida não apaga as válidas da mesma síntese.
// ---------------------------------------------------------------------------------------------
describe("V1.4.3 — claim salvage", () => {
  const semanticFact = (): LedgerEntry => ({
    ...entry("F3", "analyze_interactions", 8),
    signals: {
      interactionAnalysis: {
        analyzedTranscriptCount: 8,
        recordedUniverseCount: 20,
        universeRelationship: "PARTIAL_COVERAGE",
        findings: 2,
        verifiedExcerpts: 10,
        patterns: [
          { ref: "P1", handle: "SP1", kind: "STRENGTH", supportLevel: "RECURRENT_IN_SAMPLE", supportScope: "PERIOD", maximumClaimScope: "PERIOD_PATTERN", matchedTranscriptCount: 4, analyzedTranscriptCount: 8 },
          { ref: "P2", handle: "SP2", kind: "RISK", supportLevel: "REPEATED_IN_SAMPLE", supportScope: "SAMPLE", maximumClaimScope: "INTERACTION_SPECIFIC", matchedTranscriptCount: 2, analyzedTranscriptCount: 8 },
        ],
        findingRefs: [{ ref: "I2/F1", handle: "SF1", kind: "STRENGTH" as never }],
      },
    },
  })
  const semanticContext = { ledger: [entry("F1", "get_indicator_snapshot", 21), semanticFact()], knowledgeAvailable: false, interactionUniverse: 20, limitations: ["amostra de 8 interações"] }
  const claim = (text: string, extra: Record<string, unknown>) => ({ text, evidenceRefs: ["F3"], ...extra })
  const envelope = (claims: unknown[], recommendations: unknown[] = []) => `${EVIDENCE_MARKER} ${JSON.stringify({ behavioralClaims: claims, recommendationSupport: recommendations, limitations: ["amostra de 8"] })}`

  it("§48 A válida · B inválida · C válida → A e C sobrevivem, B é descartada, sem fallback inteiro", async () => {
    const valid = [
      claim("No período analisado você informou o protocolo ao encerrar", { scope: "PERIOD_PATTERN", support: { type: "PATTERN", patternRef: "SP1" }, polarity: "POSITIVE" }),
      claim("Nas interações analisadas houve interrupção da fala do cliente", { scope: "INTERACTION_SPECIFIC", support: { type: "PATTERN", patternRef: "SP2" }, polarity: "NEGATIVE" }),
    ]
    const invalid = claim("Há falha recorrente ao informar o protocolo", { scope: "PERIOD_PATTERN", support: { type: "PATTERN", patternRef: "SP1" }, polarity: "NEGATIVE" })
    const generate = vi.fn()
      .mockResolvedValueOnce(`Você informou o protocolo; houve interrupções; há falha recorrente ao informar o protocolo.\n${envelope([valid[0], invalid, valid[1]])}`)
      // Correção local: o modelo mantém as duas válidas e REMOVE a inválida do texto e do JSON.
      .mockResolvedValueOnce(`Você informou o protocolo ao encerrar e houve interrupções da fala do cliente.\n${envelope(valid)}`)
    const outcome = await gateTextReply(generate, semanticContext, "FACTUAL")
    expect(generate).toHaveBeenCalledTimes(2)
    // A correção é LOCAL: cita só a rejeitada, com o support congelado e a polaridade permitida (§5/§6).
    const correction = generate.mock.calls[1]![0] as string
    expect(correction).toContain("AFIRMAÇÃO REJEITADA: \"Há falha recorrente ao informar o protocolo\"")
    expect(correction).toContain("candidato CONGELADO: CC1 (suporte SP1)")
    expect(correction).toContain("polaridade do candidato: POSITIVE · escopo máximo: PERIOD_PATTERN")
    expect(correction).toContain("AFIRMAÇÕES ACEITAS")
    expect(correction).not.toContain("houve interrupção da fala do cliente\" — motivo")
    expect(outcome.replacedByFactual).toBe(false)
    expect(outcome.synthesis.behavioralClaims.map((item) => item.text)).toEqual(valid.map((item) => item.text))
    expect(outcome.gating).toMatchObject({ salvage: "NONE", claimsProposed: 3, claimsAcceptedFirstPass: 2, claimsCorrectionRequired: 1, claimsCorrected: 0, claimsDropped: 0, fallbackUsed: false })
  })

  it("§7/§8 afirmação que insiste inválida é DESCARTADA (não derruba as irmãs) quando sai do texto entregue", async () => {
    const valid = claim("No período analisado você informou o protocolo ao encerrar", { scope: "PERIOD_PATTERN", support: { type: "PATTERN", patternRef: "SP1" }, polarity: "POSITIVE" })
    const invalid = claim("Há falha recorrente ao informar o protocolo", { scope: "PERIOD_PATTERN", support: { type: "PATTERN", patternRef: "SP1" }, polarity: "NEGATIVE" })
    const generate = vi.fn()
      .mockResolvedValueOnce(`Você informou o protocolo; há falha recorrente ao informar o protocolo.\n${envelope([valid, invalid])}`)
      // O modelo insiste no JSON, mas o texto entregue já não contém a afirmação inválida.
      .mockResolvedValueOnce(`Você informou o protocolo ao encerrar as interações analisadas.\n${envelope([valid, invalid])}`)
    const outcome = await gateTextReply(generate, semanticContext, "FACTUAL")
    expect(outcome.replacedByFactual).toBe(false)
    expect(outcome.synthesis.behavioralClaims.map((item) => item.text)).toEqual([valid.text])
    expect(outcome.gating).toMatchObject({ salvage: "PARTIAL", claimsDropped: 1, claimsPreservedAfterSiblingFailure: 1, fallbackUsed: false })
    expect(outcome.gating.claimOutcomes).toEqual([
      { text: valid.text, status: "ACCEPTED", reason: null, category: null },
      { text: invalid.text, status: "DROPPED", reason: expect.stringContaining("CLAIM_POLARITY_MISMATCH"), category: "SEMANTIC" },
    ])
  })

  it("§6 a correção não pode trocar o suporte para a afirmação passar", async () => {
    const swapped = claim("Há falha recorrente ao informar o protocolo", { scope: "INTERACTION_SPECIFIC", support: { type: "PATTERN", patternRef: "SP2" }, polarity: "NEGATIVE" })
    const original = claim("Há falha recorrente ao informar o protocolo", { scope: "PERIOD_PATTERN", support: { type: "PATTERN", patternRef: "SP1" }, polarity: "NEGATIVE" })
    const generate = vi.fn()
      .mockResolvedValueOnce(`Há falha recorrente ao informar o protocolo.\n${envelope([original])}`)
      .mockResolvedValueOnce(`Os dados apurados não sustentam afirmações comportamentais adicionais.\n${envelope([swapped])}`)
    const outcome = await gateTextReply(generate, semanticContext, "FACTUAL")
    expect(outcome.gating.claimOutcomes?.[0]).toMatchObject({ status: "DROPPED", reason: expect.stringContaining("CLAIM_SUPPORT_SWAPPED") })
    expect(outcome.gating).toMatchObject({ salvage: "FULL_FALLBACK", fallbackReason: "NO_SAFE_CLAIM" })
    expect(outcome.replacedByFactual).toBe(true)
  })

  it("§49/§50 recomendação que depende só da afirmação descartada cai; a que depende da aceita sobrevive; o resumo não repete a descartada", async () => {
    const valid = claim("No período analisado você informou o protocolo ao encerrar", { scope: "PERIOD_PATTERN", support: { type: "PATTERN", patternRef: "SP1" }, polarity: "POSITIVE" })
    const invalid = claim("Há falha recorrente ao informar o protocolo", { scope: "PERIOD_PATTERN", support: { type: "PATTERN", patternRef: "SP1" }, polarity: "NEGATIVE" })
    const recommendations = [
      { text: "Mantenha o registro do protocolo ao encerrar", basis: "OBSERVED_EVIDENCE", evidenceRefs: ["F3"] },
      { text: "Corrija a falha recorrente ao informar o protocolo", basis: "OBSERVED_EVIDENCE", evidenceRefs: ["F3"] },
    ]
    const generate = vi.fn()
      .mockResolvedValueOnce(`Você informou o protocolo; há falha recorrente ao informar o protocolo.\n${envelope([valid, invalid], recommendations)}`)
      .mockResolvedValueOnce(`Você informou o protocolo ao encerrar as interações analisadas.\n${envelope([valid, invalid], recommendations)}`)
    const outcome = await gateTextReply(generate, semanticContext, "FACTUAL")
    expect(outcome.synthesis.recommendationSupport.map((item) => item.text)).toEqual(["Mantenha o registro do protocolo ao encerrar"])
    expect(outcome.gating).toMatchObject({ recommendationsDropped: 1, salvage: "PARTIAL" })
    // O texto entregue não repete a afirmação descartada (se repetisse, seria fallback inteiro — §11/§12).
    expect(outcome.text).not.toContain("falha recorrente")
  })

  it("§51 claim temporal inválida é isolada: as não temporais válidas sobrevivem", async () => {
    const valid = claim("No período analisado você informou o protocolo ao encerrar", { scope: "PERIOD_PATTERN", support: { type: "PATTERN", patternRef: "SP1" }, polarity: "POSITIVE" })
    const temporal = claim("Você passou a informar o protocolo com mais frequência", { scope: "PERIOD_PATTERN", support: { type: "PATTERN", patternRef: "SP1" }, polarity: "POSITIVE", temporalRelation: "CHANGE", evidenceBuckets: ["B1", "B3"] })
    const generate = vi.fn()
      .mockResolvedValueOnce(`Você informou o protocolo e passou a informar com mais frequência.\n${envelope([valid, temporal])}`)
      .mockResolvedValueOnce(`Você informou o protocolo ao encerrar as interações analisadas.\n${envelope([valid, temporal])}`)
    const outcome = await gateTextReply(generate, semanticContext, "FACTUAL")
    expect(outcome.synthesis.behavioralClaims.map((item) => item.text)).toEqual([valid.text])
    expect(outcome.gating.claimOutcomes?.[1]).toMatchObject({ status: "DROPPED", category: "TEMPORAL" })
    expect(outcome.gating).toMatchObject({ salvage: "PARTIAL", fallbackUsed: false })
  })

  it("§52 nenhuma afirmação segura sobrevive → fallback factual determinístico continua funcionando; no Workflow, descarte", async () => {
    const invalid = claim("Há falha recorrente ao informar o protocolo", { scope: "PERIOD_PATTERN", support: { type: "PATTERN", patternRef: "SP1" }, polarity: "NEGATIVE" })
    const generate = vi.fn().mockResolvedValue(`Resumo factual.\n${envelope([invalid])}`)
    const outcome = await gateTextReply(generate, semanticContext, "FACTUAL")
    expect(outcome.replacedByFactual).toBe(true)
    expect(outcome.text).toContain("limitada aos fatos apurados")
    expect(outcome.gating).toMatchObject({ salvage: "FULL_FALLBACK", fallbackReason: "NO_SAFE_CLAIM", claimsDropped: 1, claimsPreservedAfterSiblingFailure: 0 })
    await expect(gateTextReply(generate, semanticContext, "THROW")).rejects.toMatchObject({ code: "AGENT_UNSUPPORTED_BEHAVIORAL_CLAIM" })
  })

  it("§9/§11 afirmação descartada que CONTINUA no texto entregue derruba a resposta inteira (resíduo não isolável)", async () => {
    const valid = claim("No período analisado você informou o protocolo ao encerrar", { scope: "PERIOD_PATTERN", support: { type: "PATTERN", patternRef: "SP1" }, polarity: "POSITIVE" })
    const invalid = claim("Há falha recorrente ao informar o protocolo nas interações analisadas", { scope: "PERIOD_PATTERN", support: { type: "PATTERN", patternRef: "SP1" }, polarity: "NEGATIVE" })
    const generate = vi.fn().mockResolvedValue(`Você informou o protocolo, mas há falha recorrente ao informar o protocolo nas interações analisadas.\n${envelope([valid, invalid])}`)
    const outcome = await gateTextReply(generate, semanticContext, "FACTUAL")
    expect(outcome.gating).toMatchObject({ salvage: "FULL_FALLBACK", fallbackReason: "UNISOLABLE_TEXT" })
    expect(outcome.replacedByFactual).toBe(true)
  })

  it("§8 estruturado (Workflow): a resposta corrigida é publicada com as afirmações válidas; só descarta quando nada seguro sobra", async () => {
    const valid = claim("No período analisado você informou o protocolo ao encerrar", { scope: "PERIOD_PATTERN", support: { type: "PATTERN", patternRef: "SP1" }, polarity: "POSITIVE" })
    const invalid = claim("Há falha recorrente ao informar o protocolo", { scope: "PERIOD_PATTERN", support: { type: "PATTERN", patternRef: "SP1" }, polarity: "NEGATIVE" })
    const json = (claims: unknown[], summary: string) => JSON.stringify({ title: "t", summary, observedBehavior: "o", recommendation: "r", behavioralClaims: claims, recommendationSupport: [], limitations: ["amostra de 8"] })
    const generate = vi.fn()
      .mockResolvedValueOnce(json([valid, invalid], "Você informou o protocolo; há falha recorrente."))
      .mockResolvedValueOnce(json([valid, invalid], "Você informou o protocolo ao encerrar."))
    const outcome = await gateStructuredReply(generate, (raw) => JSON.parse(raw) as unknown, semanticContext, () => "descartada")
    expect(outcome.synthesis.behavioralClaims.map((item) => item.text)).toEqual([valid.text])
    expect(outcome.gating).toMatchObject({ salvage: "PARTIAL", claimsDropped: 1, claimsPreservedAfterSiblingFailure: 1 })
  })
})

// ---------------------------------------------------------------------------------------------
// V1.4.4 — CLAIM CANDIDATES no fluxo completo (§12/§15/§40/§41/§42).
// ---------------------------------------------------------------------------------------------
describe("V1.4.4 — projeção determinística no gating de texto", () => {
  const candidateFact = (): LedgerEntry => ({
    ...entry("F3", "analyze_interactions", 8),
    signals: {
      interactionAnalysis: {
        analyzedTranscriptCount: 8,
        recordedUniverseCount: 20,
        universeRelationship: "PARTIAL_COVERAGE",
        findings: 2,
        verifiedExcerpts: 10,
        patterns: [
          { ref: "P1", handle: "SP1", kind: "STRENGTH", supportLevel: "RECURRENT_IN_SAMPLE", supportScope: "PERIOD", maximumClaimScope: "PERIOD_PATTERN", matchedTranscriptCount: 5, analyzedTranscriptCount: 8 },
          { ref: "P2", handle: "SP2", kind: "RISK", supportLevel: "REPEATED_IN_SAMPLE", supportScope: "SAMPLE", maximumClaimScope: "INTERACTION_SPECIFIC", matchedTranscriptCount: 2, analyzedTranscriptCount: 8 },
        ],
        findingRefs: [{ ref: "I2/F1", handle: "SF1", kind: "STRENGTH" as never }],
      },
    },
  })
  const context = { ledger: [entry("F1", "get_indicator_snapshot", 21), candidateFact()], knowledgeAvailable: false, interactionUniverse: 20, limitations: ["amostra de 8 interações"] }
  const envelope = (claims: unknown[], recommendations: unknown[] = []) => `${EVIDENCE_MARKER} ${JSON.stringify({ behavioralClaims: claims, recommendationSupport: recommendations, limitations: ["amostra de 8"] })}`
  const good = { candidateRef: "CC1", text: "No período analisado você informou o protocolo com clareza", evidenceRefs: [] }
  const badText = { candidateRef: "CC1", text: "Há falha recorrente ao informar o protocolo", evidenceRefs: [] }

  it("§41/§42 o modelo seleciona candidatos materiais e a telemetria conta disponíveis × selecionados × entregues", async () => {
    const generate = vi.fn().mockResolvedValueOnce(`Você informou o protocolo com clareza.\n${envelope([good])}`)
    const outcome = await gateTextReply(generate, context, "FACTUAL")
    expect(generate).toHaveBeenCalledTimes(1)
    expect(outcome.gating).toMatchObject({ salvage: "NONE", claimCandidatesAvailable: 3, claimCandidatesSelected: 1, claimCandidatesDelivered: 1, textPolarityMismatch: 0, textScopeMismatch: 0 })
  })

  it("§12/§40 a correção congela o CANDIDATO: trocar CC1 por CC2 para passar é rejeitado", async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce(`Há falha recorrente ao informar o protocolo.\n${envelope([badText])}`)
      .mockResolvedValueOnce(`Há falha recorrente ao informar o protocolo.\n${envelope([{ ...badText, candidateRef: "CC2" }])}`)
    const outcome = await gateTextReply(generate, context, "FACTUAL")
    const correction = generate.mock.calls[1]![0] as string
    expect(correction).toContain("candidato CONGELADO: CC1")
    expect(correction).toContain("significado autorizado:")
    expect(correction).toContain("TEXT_POLARITY_MISMATCH")
    expect(outcome.gating.claimOutcomes?.[0]).toMatchObject({ status: "DROPPED", reason: expect.stringContaining("CLAIM_CANDIDATE_SWAPPED") })
    expect(outcome.gating).toMatchObject({ candidateSwapRejected: 1, salvage: "FULL_FALLBACK" })
  })

  it("§15/§30 claim irmã válida sobrevive quando outra é descartada, e a recomendação presa à descartada cai", async () => {
    const recommendations = [
      { text: "Mantenha o registro do protocolo ao encerrar", basis: "OBSERVED_EVIDENCE", evidenceRefs: ["F3"] },
      { text: "Corrija a falha recorrente ao informar o protocolo", basis: "OBSERVED_EVIDENCE", evidenceRefs: ["F3"] },
    ]
    const other = { candidateRef: "CC2", text: "Nas interações analisadas houve interrupção da fala do cliente", evidenceRefs: [] }
    const generate = vi.fn()
      .mockResolvedValueOnce(`Você informou o protocolo; há falha recorrente ao informar o protocolo; houve interrupções.\n${envelope([good, badText, other], recommendations)}`)
      .mockResolvedValueOnce(`Você informou o protocolo com clareza e houve interrupções da fala do cliente.\n${envelope([good, badText, other], recommendations)}`)
    const outcome = await gateTextReply(generate, context, "FACTUAL")
    expect(outcome.replacedByFactual).toBe(false)
    expect(outcome.synthesis.behavioralClaims.map((item) => item.candidateRef)).toEqual(["CC1", "CC2"])
    expect(outcome.synthesis.recommendationSupport.map((item) => item.text)).toEqual(["Mantenha o registro do protocolo ao encerrar"])
    expect(outcome.gating).toMatchObject({ salvage: "PARTIAL", claimsDropped: 1, claimsPreservedAfterSiblingFailure: 2, claimCandidatesDelivered: 2, recommendationsDropped: 1 })
  })
})
