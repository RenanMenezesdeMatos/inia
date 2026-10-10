import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { normalizeInvestigationResult, type FeedbackInvestigationResultV1 } from "./feedback-investigation-result.js"
import { buildMonitoringItems, decomposeClaimedEvidence } from "./monitoring-adapter.js"
import { buildIndicatorItems } from "./indicator-adapter.js"
import { canonicalComparison, INDICATOR_CANONICAL_CONTEXT_CONTRACT, type IndicatorCanonicalContext } from "../../indicators/domain/indicator-canonical-context.js"
import { indicatorClaimViolations, targetComparisonConflicts, unsupportedNumbers } from "./indicator-claims.js"
import { artifactDispositionOf, decideReliableItem, RELIABLE_FEEDBACK_AUTONOMOUS_POLICY, RELIABLE_FEEDBACK_PILOT_POLICY, type ReliableFeedbackPolicy, type ReliableItemDraft } from "./reliable-feedback-item.js"
import { buildIndicatorWriterInput, buildMonitoringWriterInput, indicatorFallbackWording, resolveSlots, validateIndicatorWording, validateMonitoringWording, monitoringFallbackWording } from "./reliable-writer.js"
import { assertReliablePayloadSafe, INDICATOR_WRITER_PROMPT_VERSION, projectIndicatorInputForModel, projectMonitoringInputForModel, RELIABLE_WRITER_SYSTEM_PROMPTS, reliableWriterFingerprint, reliableWriterFreezeFile, WORKFLOW_MONITORING_WRITER_PROMPT_VERSION, WORKFLOW_MONITORING_WRITER_PROMPT_VERSION_V2 } from "./reliable-writer-prompts.js"
import { emittedItems, nodeOutputOf, type ReliableFeedbackArtifactV1 } from "./reliable-feedback-artifact.js"
import { FEEDBACK_WRITER_SYSTEM_PROMPT_V2 } from "../../interaction-feedback/domain/feedback-writer-prompt.js"

const ORG = "00000000-0000-4000-8000-000000000001"
const OPERATOR = "11111111-1111-4111-8111-111111111111"
const INTERACTION = "22222222-2222-4222-8222-222222222222"
const MEASUREMENT = "33333333-3333-4333-8333-333333333333"
const TRANSCRIPT = [
  "[00:01–00:04] CLIENTE: Oi, quero saber o prazo da segunda via da fatura.",
  "[00:05–00:09] OPERADOR: Vou verificar aqui, aguarde um momento.",
  "[00:10–00:20] OPERADOR: Pronto, já abri o chamado e o prazo é de até cinco dias úteis.",
  "[00:21–00:25] CLIENTE: Tá, mas você não me explicou como vou receber.",
].join("\n")

const agentOutput = (structured: Record<string, unknown>, overrides: Record<string, unknown> = {}) => ({
  kind: "monitoring",
  input: { organizationId: ORG, operatorId: OPERATOR, teamId: "t", interactionId: INTERACTION, interactionOccurredAt: "2026-09-14T12:00:00Z", flagName: "rechamada", matchedValueText: "verdadeiro", thresholdText: "", structured: { title: "t", summary: "resumo", impactedIndicator: "rechamada", relatedProcedure: "Procedimento X", recommendation: "Você deve explicar o canal.", observedBehavior: "não explicou como o cliente receberia", evidenceFound: "Tá, mas você não me explicou como vou receber.", ...structured }, ...overrides },
})
const normalizeMonitoring = (output: unknown) => normalizeInvestigationResult({ sourceNodeOutput: output, sourceType: "AGENT", sourceNodeId: "agent", domain: "MONITORING", organizationId: ORG, collaboratorId: OPERATOR, enrollment: { interactionId: INTERACTION, indicatorMeasurementId: null }, configuredAgentId: "agent-a" })
const monitoringResult = (structured: Record<string, unknown>): FeedbackInvestigationResultV1 => {
  const normalized = normalizeMonitoring(agentOutput(structured))
  if (!normalized.ok) throw new Error(normalized.reason)
  return normalized.result
}

describe("V1.5.12 — normalização da origem (identidade × matrícula, fail-closed)", () => {
  it("Agent de monitoria da MESMA organização/colaborador/interação vira conclusão NÃO confiável (interpretação)", () => {
    const result = monitoringResult({})
    expect(result.claims).toHaveLength(1)
    expect(result.claims[0]).toMatchObject({ claimedEvidence: "Tá, mas você não me explicou como vou receber.", observation: "não explicou como o cliente receberia", claimedProcedureTitle: "Procedimento X" })
    expect(result.provenance.agentId).toBe("agent-a")
  })
  it("organização, colaborador, interação ou tipo divergentes → recusado (nunca aceito como está)", () => {
    expect(normalizeMonitoring(agentOutput({}, { organizationId: "99999999-0000-4000-8000-000000000001" }))).toEqual({ ok: false, reason: "ORGANIZATION_MISMATCH" })
    expect(normalizeMonitoring(agentOutput({}, { operatorId: "someone-else" }))).toEqual({ ok: false, reason: "COLLABORATOR_MISMATCH" })
    expect(normalizeMonitoring(agentOutput({}, { interactionId: "other-interaction" }))).toEqual({ ok: false, reason: "INTERACTION_MISMATCH" })
    expect(normalizeMonitoring({ ...agentOutput({}), kind: "indicator" })).toEqual({ ok: false, reason: "SOURCE_KIND_INCOMPATIBLE" })
    expect(normalizeMonitoring(undefined)).toEqual({ ok: false, reason: "SOURCE_NOT_EXECUTED" })
  })
  it("Orquestrador: só especialistas com contrato FEEDBACK (evidência estruturada) viram conclusão; texto livre/síntese NÃO são evidência", () => {
    const orchestrator = { text: "síntese livre do orquestrador", orchestratorName: "Qualidade", orchestratorId: "orq", agentId: null, calls: [], results: [{ agentId: "spec-1", toolName: "especialista", text: "livre", contract: "TEXT" }, { agentId: "spec-2", toolName: "especialista2", text: "…", contract: "FEEDBACK", structured: agentOutput({}).input.structured }], supportMaterialCandidates: [], structuredResult: null }
    const normalized = normalizeInvestigationResult({ sourceNodeOutput: orchestrator, sourceType: "ORCHESTRATOR", sourceNodeId: "orq", domain: "MONITORING", organizationId: ORG, collaboratorId: OPERATOR, enrollment: { interactionId: INTERACTION, indicatorMeasurementId: null } })
    expect(normalized.ok).toBe(true)
    if (!normalized.ok) return
    expect(normalized.result.claims).toHaveLength(1)
    expect(normalized.result.claims[0]!.origin.specialistAgentId).toBe("spec-2")
    expect(normalized.result.uncertainties).toContain("SPECIALIST_TEXT_WITHOUT_EVIDENCE_CONTRACT_IGNORED")
    const onlyText = normalizeInvestigationResult({ sourceNodeOutput: { ...orchestrator, results: [orchestrator.results[0]] }, sourceType: "ORCHESTRATOR", sourceNodeId: "orq", domain: "MONITORING", organizationId: ORG, collaboratorId: OPERATOR, enrollment: { interactionId: INTERACTION, indicatorMeasurementId: null } })
    expect(onlyText.ok && onlyText.result.claims).toEqual([])
  })
  it("Indicador + Orquestrador não é suportado na V1 (nunca finge suporte)", () => {
    expect(normalizeInvestigationResult({ sourceNodeOutput: { text: "x", orchestratorName: "o", results: [] }, sourceType: "ORCHESTRATOR", sourceNodeId: "orq", domain: "INDICATOR", organizationId: ORG, collaboratorId: OPERATOR, enrollment: { interactionId: null, indicatorMeasurementId: MEASUREMENT } })).toEqual({ ok: false, reason: "INDICATOR_ORCHESTRATOR_UNSUPPORTED" })
  })
})

describe("V1.5.12 — MONITORING ADAPTER: a citação do modelo é conferida na transcrição REAL", () => {
  const items = (structured: Record<string, unknown>) => buildMonitoringItems({ result: monitoringResult(structured), interactionId: INTERACTION, transcript: TRANSCRIPT }).items
  it("trecho literal do OPERADOR → ponto de desenvolvimento do colaborador (dono AGENT), falante vindo da transcrição", () => {
    const [item] = items({ evidenceFound: "Pronto, já abri o chamado e o prazo é de até cinco dias úteis." })
    expect(item).toMatchObject({ section: "OPPORTUNITY", ownership: "AGENT", structuralBlock: null })
    expect(item!.facts).toEqual([{ role: "OPERADOR", text: "Pronto, já abri o chamado e o prazo é de até cinco dias úteis.", truncated: false, masked: false }])
  })
  it("paráfrase → EVIDENCE_NOT_VERIFIED (nunca sustenta feedback)", () => {
    expect(items({ evidenceFound: "O operador disse que o prazo seria de cinco dias" })[0]).toMatchObject({ structuralBlock: "EVIDENCE_NOT_VERIFIED", facts: [] })
  })
  it("fala SÓ do cliente = sinal, nunca causa: não atribuível ao colaborador", () => {
    expect(items({})[0]).toMatchObject({ ownership: "CUSTOMER", section: "NEUTRAL_CONTEXT", structuralBlock: "NOT_ATTRIBUTABLE_TO_COLLABORATOR" })
  })
  it("falante rotulado errado pelo modelo → recusado (WRONG_SPEAKER)", () => {
    const [item] = items({ evidenceFound: "OPERADOR: Tá, mas você não me explicou como vou receber." })
    expect(item!.structuralBlock).toBe("EVIDENCE_NOT_VERIFIED")
    expect(item!.audit.rejectedUnits).toEqual([{ reason: "WRONG_SPEAKER" }])
  })
  it("citação com duas falas é decomposta por falante; ALL: todas precisam existir", () => {
    expect(decomposeClaimedEvidence("Cliente: Tá, mas você não me explicou como vou receber. Operador: Vou verificar aqui, aguarde um momento.")).toEqual([
      { speaker: "CLIENTE", text: "Tá, mas você não me explicou como vou receber." },
      { speaker: "OPERADOR", text: "Vou verificar aqui, aguarde um momento." },
    ])
    const [mixed] = items({ evidenceFound: "Cliente: Tá, mas você não me explicou como vou receber. Operador: Vou verificar aqui, aguarde um momento." })
    expect(mixed).toMatchObject({ ownership: "AGENT", section: "OPPORTUNITY", structuralBlock: null })
    expect(mixed!.facts.map((fact) => fact.role)).toEqual(["CLIENTE", "OPERADOR"])
    const [partlyInvented] = items({ evidenceFound: "Cliente: Tá, mas você não me explicou como vou receber. Operador: Eu nunca explico isso." })
    expect(partlyInvented!.structuralBlock).toBe("EVIDENCE_NOT_VERIFIED")
  })
  it("sem evidência = nenhum item emitível (ausência nunca vira conclusão)", () => {
    expect(items({ evidenceFound: "" })[0]!.structuralBlock).toBe("NO_EVIDENCE")
  })
  it("dado pessoal no trecho: exibido só mascarado pela projeção canônica (identificador longo não mascarável = retido)", () => {
    const transcript = `${TRANSCRIPT}\n[00:30–00:40] OPERADOR: Confirmei aqui, o número 9876543210 está cadastrado na sua conta.`
    const [item] = buildMonitoringItems({ result: monitoringResult({ evidenceFound: "Confirmei aqui, o número 9876543210 está cadastrado na sua conta." }), interactionId: INTERACTION, transcript }).items
    expect(item!.facts).toEqual([])
    expect(item!.withheldFacts).toBe(1)
    expect(item!.structuralBlock).toBe("INSUFFICIENT_DISPLAY_EVIDENCE")
  })
})

const canonical = (overrides: Partial<{ value: number; target: number | null; direction: "HIGHER" | "LOWER" | "TARGET"; unit: string; start: string; end: string }> = {}): IndicatorCanonicalContext => {
  const value = overrides.value ?? 420
  const target = overrides.target === undefined ? 400 : overrides.target
  const direction = overrides.direction ?? "LOWER"
  return {
    contract: INDICATOR_CANONICAL_CONTEXT_CONTRACT,
    indicator: { id: "ind", code: "TMA", name: "TMA", unit: overrides.unit ?? "SECONDS", direction },
    measurement: { id: MEASUREMENT, subjectId: OPERATOR, value, periodStart: overrides.start ?? "2026-09-01", periodEnd: overrides.end ?? "2026-09-30", granularity: "MONTHLY" },
    target: target === null ? null : { value: target, source: "TEAM", goalId: "goal" },
    ...canonicalComparison(value, target, direction),
    provenance: { source: "indicator_measurements+goals", loadedAt: "2026-10-01T00:00:00Z" },
  }
}
const indicatorResult = (structured: Record<string, unknown>): FeedbackInvestigationResultV1 => {
  const normalized = normalizeInvestigationResult({ sourceNodeOutput: { kind: "indicator", input: { organizationId: ORG, operatorId: OPERATOR, contextSnapshot: { indicatorMeasurementId: MEASUREMENT }, structured: { title: "t", summary: "Seu TMA ficou em 420 s.", relatedProcedure: "x", recommendation: "Procure reduzir o tempo em pausas.", ...structured } } }, sourceType: "AGENT", sourceNodeId: "agent", domain: "INDICATOR", organizationId: ORG, collaboratorId: OPERATOR, enrollment: { interactionId: null, indicatorMeasurementId: MEASUREMENT } })
  if (!normalized.ok) throw new Error(normalized.reason)
  return normalized.result
}

describe("V1.5.12 — INDICATOR ADAPTER: números do SISTEMA, nunca do LLM", () => {
  it("valor/meta/período/comparação vêm do contexto canônico; seção pela comparação oficial (LOWER, 420 > 400 → fora da meta)", () => {
    const [item] = buildIndicatorItems({ result: indicatorResult({}), canonical: canonical() })
    expect(item).toMatchObject({ section: "OPPORTUNITY", kind: "INDICATOR_TARGET_NOT_MET", ownership: "AGENT", structuralBlock: null })
    expect(item!.facts.map((fact) => fact.text)).toEqual(["TMA no período 01/09/2026 a 30/09/2026: 420 s", "Meta vigente: 400 s (quanto menor, melhor)", "Resultado oficial: fora da meta"])
    const [met] = buildIndicatorItems({ result: indicatorResult({}), canonical: canonical({ value: 380 }) })
    expect(met).toMatchObject({ section: "STRENGTH", kind: "INDICATOR_TARGET_MET", polarity: "POSITIVE" })
  })
  it("mudar o texto do Agent NÃO muda o valor oficial; número incompatível na interpretação = descartada + QA", () => {
    const [item] = buildIndicatorItems({ result: indicatorResult({ summary: "Seu TMA ficou em 999 s, muito acima." }), canonical: canonical() })
    expect(item!.facts[0]!.text).toContain("420 s")
    expect(item!.analysis).toBeNull()
    expect(item!.analysisConflicts).toContain("UNSUPPORTED_NUMBER")
    expect(decideReliableItem(item!, { invoked: true, writerError: null, source: "WRITER", violations: [], wording: { observed: "a", whyItMatters: "b", whatYouCanDo: "c" } }, { ...RELIABLE_FEEDBACK_AUTONOMOUS_POLICY, releasedItemKinds: ["INDICATOR_TARGET_NOT_MET"] }).reasons).toContain("SOURCE_INTERPRETATION_CONFLICT")
  })
  it("sem meta canônica vigente → BLOCKED (não há afirmação possível sobre meta)", () => {
    const [item] = buildIndicatorItems({ result: indicatorResult({}), canonical: canonical({ target: null }) })
    expect(item!.structuralBlock).toBe("CANONICAL_TARGET_MISSING")
  })
})

describe("V1.5.12 — fronteiras de afirmação do indicador (IA nunca calcula)", () => {
  const ctx = canonical()
  it("CANONICAL_METRIC_ONLY/NO_METRIC_RECALC: só valor/meta/datas do período; conversão, diferença e percentual violam", () => {
    expect(unsupportedNumbers("Seu TMA foi de 420 s, com meta de 400 s, em 01/09/2026 a 30/09/2026.", ctx)).toEqual([])
    expect(unsupportedNumbers("Seu TMA foi de 7 minutos.", ctx)).toEqual(["7"])
    // V1.5.12a: a distância até a meta é dado CANÔNICO (420 × 400, menor é melhor → 20); outra distância, não.
    expect(ctx.gapToTarget).toBe(20)
    expect(unsupportedNumbers("Faltam 20 s para a meta.", ctx)).toEqual([])
    expect(unsupportedNumbers("Faltam 21 s para a meta.", ctx)).toEqual(["21"])
    expect(unsupportedNumbers("Você ficou 5% acima.", ctx)).toEqual(["5"])
    // Arredondamento de exibição do próprio formato é aceito (85,47% → 85,5%); outra conta, não.
    expect(unsupportedNumbers("Taxa de 85,5%.", canonical({ value: 85.47, target: 90, unit: "PERCENT", direction: "HIGHER" }))).toEqual([])
  })
  it("TARGET_COMPARISON: 'atingiu/dentro da meta' e 'acima/abaixo' precisam bater com a comparação OFICIAL", () => {
    expect(targetComparisonConflicts("Você atingiu a meta.", ctx)).toEqual(["atingiu a meta"])
    expect(targetComparisonConflicts("Seu resultado ficou abaixo da meta.", ctx)).toEqual(["abaixo da meta"])
    expect(targetComparisonConflicts("Você não atingiu a meta e ficou acima da meta.", ctx)).toEqual([])
  })
  it("TREND e PERIOD: evolução sem histórico canônico e mês fora do período violam; sugestão prospectiva não", () => {
    expect(indicatorClaimViolations("Seu TMA melhorou em relação ao mês anterior.", ctx, "observed")).toContain("TREND_WITHOUT_CANONICAL_HISTORY")
    expect(indicatorClaimViolations("Em agosto seu TMA foi 420 s.", ctx, "observed")).toContain("PERIOD_MISMATCH")
    expect(indicatorClaimViolations("Em setembro seu TMA foi 420 s.", ctx, "observed")).toEqual([])
    expect(indicatorClaimViolations("Você pode buscar melhorar o tempo das pausas.", ctx, "whatYouCanDo")).toEqual([])
  })
})

const draft = (overrides: Partial<ReliableItemDraft> = {}): ReliableItemDraft => ({ index: 0, claimRef: "C1", domain: "MONITORING", section: "OPPORTUNITY", kind: "MONITORING_DEVELOPMENT_POINT", polarity: "NEGATIVE", ownership: "AGENT", safeMeaning: "m", guidanceSource: "COACHING_SUGGESTION", facts: [{ role: "OPERADOR", text: "Vou verificar aqui, aguarde um momento.", truncated: false, masked: false }], withheldFacts: 0, analysis: null, analysisConflicts: [], structuralBlock: null, grounding: "NO_GROUNDED_GUIDANCE", knowledge: null, process: null, audit: { evidence: [], rejectedUnits: [] }, ...overrides })
const writerOk = { invoked: true, writerError: null, source: "WRITER" as const, violations: [], wording: { observed: "Você disse que ia verificar.", whyItMatters: "Pode ajudar o cliente.", whatYouCanDo: "Você pode explicar o próximo passo." }, claimModes: { effect: "POTENTIAL_ONLY", action: "DECLARED_ONLY" } }
const releasing: ReliableFeedbackPolicy = { ...RELIABLE_FEEDBACK_AUTONOMOUS_POLICY, releasedItemKinds: ["MONITORING_DEVELOPMENT_POINT", "INDICATOR_TARGET_MET", "INDICATOR_TARGET_NOT_MET"] }

describe("V1.5.12 — RELIABILITY CORE: disposição por item e do artefato", () => {
  it("BLOCKED = estrutura (nenhuma política libera); HOLD_FOR_QA = política/critério; READY só com tudo atendido", () => {
    expect(decideReliableItem(draft({ structuralBlock: "EVIDENCE_NOT_VERIFIED" }), writerOk, releasing)).toMatchObject({ disposition: "BLOCKED", reasons: ["EVIDENCE_NOT_VERIFIED"] })
    expect(decideReliableItem(draft(), writerOk, RELIABLE_FEEDBACK_PILOT_POLICY).reasons).toEqual(["PILOT_HOLD_ALL_FOR_QA", "FEEDBACK_KIND_NOT_RELEASED_FOR_AUTONOMY"])
    expect(decideReliableItem(draft(), writerOk, releasing)).toMatchObject({ disposition: "READY", reasons: ["AUTONOMY_CRITERIA_MET"] })
    // Modos de afirmação não aplicados (ausentes, efeito não potencial, ação da monitoria não declarada) → QA.
    expect(decideReliableItem(draft(), { ...writerOk, claimModes: null }, releasing).reasons).toEqual(["CLAIM_BOUNDARY_NOT_ENFORCED"])
    expect(decideReliableItem(draft(), { ...writerOk, claimModes: { effect: "POTENTIAL_ONLY", action: "OBSERVED_EVENT_ALLOWED" } }, releasing).reasons).toEqual(["CLAIM_BOUNDARY_NOT_ENFORCED"])
    expect(decideReliableItem(draft({ domain: "INDICATOR", kind: "INDICATOR_TARGET_NOT_MET" }), { ...writerOk, claimModes: { effect: "POTENTIAL_ONLY", action: null } }, releasing).disposition).toBe("READY")
    expect(decideReliableItem(draft(), { ...writerOk, source: "FALLBACK" }, releasing).reasons).toEqual(["WRITER_FALLBACK_USED"])
    expect(decideReliableItem(draft(), { ...writerOk, wording: { ...writerOk.wording, observed: "Ligue para 11 98765-4321." } }, releasing).reasons).toContain("WORDING_PRIVACY_FLAG")
  })
  it("artefato: pendente → HOLD_FOR_QA; emitível → READY (bloqueados/rejeitados nunca saem); só rejeitado → REJECTED; nada → BLOCKED", () => {
    expect(artifactDispositionOf([{ disposition: "READY", qa: null }, { disposition: "HOLD_FOR_QA", qa: "PENDING_REVIEW" }])).toBe("HOLD_FOR_QA")
    expect(artifactDispositionOf([{ disposition: "READY", qa: null }, { disposition: "BLOCKED", qa: null }])).toBe("READY")
    expect(artifactDispositionOf([{ disposition: "HOLD_FOR_QA", qa: "APPROVED_EDITED" }])).toBe("READY")
    expect(artifactDispositionOf([{ disposition: "HOLD_FOR_QA", qa: "REJECTED" }, { disposition: "BLOCKED", qa: null }])).toBe("REJECTED")
    expect(artifactDispositionOf([{ disposition: "BLOCKED", qa: null }])).toBe("BLOCKED")
  })
  it("texto emitido: editado pelo QA quando APPROVED_EDITED; só itens emitíveis; texto legível sem ref interna", () => {
    const item = { ...draft(), analysisUsed: false, slot: "ITEM_1", proposedWording: writerOk.wording, wordingSource: "WRITER" as const, writerViolations: [], decision: decideReliableItem(draft(), writerOk, RELIABLE_FEEDBACK_PILOT_POLICY) }
    const artifact: ReliableFeedbackArtifactV1 = { contract: "RELIABLE_FEEDBACK_ARTIFACT_V1", domain: "MONITORING", sourceNodeId: "agent", sourceType: "AGENT", subject: { collaboratorId: OPERATOR, interactionId: INTERACTION, indicatorMeasurementId: null }, label: "Atendimento de 14/09/2026", items: [item], uncertainties: [], blockedReason: null, policyVersion: "P", writer: { invoked: true, skippedReason: null, error: null, promptVersion: "V" } }
    expect(nodeOutputOf("art", artifact, [{ itemIndex: 0, status: "PENDING_REVIEW", finalWording: null }])).toMatchObject({ disposition: "HOLD_FOR_QA", items: [], text: "" })
    const edited = { observed: "Texto editado.", whyItMatters: "Por quê.", whatYouCanDo: "O quê." }
    const [emitted] = emittedItems(artifact, [{ itemIndex: 0, status: "APPROVED_EDITED", finalWording: edited }])
    expect(emitted).toMatchObject({ wording: edited, wordingSource: "HUMAN_EDITED", qaStatus: "APPROVED_EDITED" })
    const output = nodeOutputOf("art", artifact, [{ itemIndex: 0, status: "APPROVED_UNCHANGED", finalWording: null }])
    expect(output.disposition).toBe("READY")
    expect(output.text).toContain("Você disse que ia verificar.")
    expect(output.text).not.toMatch(/\b(?:I|SF|SP|CC|F|K)\d+\b/)
  })
})

describe("V1.5.12 — redatores: contratos versionados, payload seguro, validação e fallback", () => {
  it("freeze: prompts/schema/config congelados por versão; o Writer V2 do feedback direto NÃO mudou", () => {
    // V1.7.1: a monitoria atual é o V3; o V2 continua congelado byte a byte.
    for (const version of [WORKFLOW_MONITORING_WRITER_PROMPT_VERSION, WORKFLOW_MONITORING_WRITER_PROMPT_VERSION_V2, INDICATOR_WRITER_PROMPT_VERSION]) {
      const frozen = JSON.parse(readFileSync(new URL(`./${reliableWriterFreezeFile(version)}`, import.meta.url), "utf8")) as Record<string, unknown>
      expect({ ...reliableWriterFingerprint(version), systemPrompt: RELIABLE_WRITER_SYSTEM_PROMPTS[version] }).toEqual(frozen)
      expect(frozen.config).toMatchObject({ model: "gemini-3.1-flash-lite", timeoutMs: 30_000, retries: 0, modelFallback: false, escalation: false })
    }
    const v2 = JSON.parse(readFileSync(new URL("../../interaction-feedback/domain/feedback-writer-prompt.v2.freeze.json", import.meta.url), "utf8")) as { systemPrompt: string }
    expect(v2.systemPrompt).toBe(FEEDBACK_WRITER_SYSTEM_PROMPT_V2)
  })
  it("monitoria: payload com a evidência exibível + a interpretação da origem SANITIZADA (sem ref interna/UUID/link); defesa estrutural", () => {
    const input = buildMonitoringWriterInput("Atendimento de 14/09/2026", [{ item: draft({ analysis: { observation: "Não explicou o canal (F3, I1). Veja /materiais/abc 11111111-1111-4111-8111-111111111111", summary: null, recommendation: "Explique o canal." } }), slot: "ITEM_1" }])
    const payload = projectMonitoringInputForModel(input)
    expect(() => assertReliablePayloadSafe(payload)).not.toThrow()
    const serialized = JSON.stringify(payload)
    expect(serialized).not.toMatch(/F3|I1\b|\/materiais\/|11111111-1111/)
    expect(serialized).toContain("Explique o canal.")
    expect(() => assertReliablePayloadSafe({ ...payload, items: [{ ...payload.items[0]!, safeMeaning: `x ${"11111111-1111-4111-8111-111111111111"}` }] })).toThrow(/UUID/)
  })
  it("monitoria: validadores do Writer V2 (a interpretação NUNCA é fonte literal de número/aspas); violação → fallback do item inteiro", () => {
    const input = buildMonitoringWriterInput("Atendimento de 14/09/2026", [{ item: draft({ analysis: { observation: null, summary: null, recommendation: "O prazo correto é 3 dias." } }), slot: "ITEM_1" }])
    const item = input.items[0]!
    expect(validateMonitoringWording({ observed: "Você disse que o prazo era 3 dias.", whyItMatters: "Pode ajudar.", whatYouCanDo: "Você pode explicar." }, item, input.interactionLabel)).toContain("UNSUPPORTED_NUMBER")
    expect(validateMonitoringWording({ observed: "Você costuma não explicar.", whyItMatters: "Pode ajudar.", whatYouCanDo: "Você pode explicar." }, item, input.interactionLabel)).toContain("PATTERN_LANGUAGE")
    const [resolved] = resolveSlots(input.items, { items: [{ slot: "ITEM_1", observed: "Você deve sempre explicar.", whyItMatters: "x", whatYouCanDo: "y" }] }, (wording, entry) => validateMonitoringWording(wording, entry, input.interactionLabel), monitoringFallbackWording)
    expect(resolved!.source).toBe("FALLBACK")
  })
  it("indicador: fatos canônicos no payload; validação contra o CANÔNICO (recalcular número, errar a comparação ou falar de tendência → fallback)", () => {
    const ctx = canonical()
    const [item] = buildIndicatorItems({ result: indicatorResult({}), canonical: ctx })
    const input = buildIndicatorWriterInput([{ item: item!, slot: "ITEM_1" }], ctx)
    const payload = projectIndicatorInputForModel(input)
    expect(() => assertReliablePayloadSafe(payload)).not.toThrow()
    expect(payload.items[0]!.officialData).toMatchObject({ indicatorName: "TMA", value: "420 s", target: "400 s", comparison: "fora da meta", period: "01/09/2026 a 30/09/2026" })
    const writerItem = input.items[0]!
    const good = { observed: "No período de 01/09/2026 a 30/09/2026, seu TMA foi 420 s, fora da meta de 400 s.", whyItMatters: "", whatYouCanDo: "" }
    expect(validateIndicatorWording(good, writerItem, ctx)).toEqual([])
    // V1.6.0: sem base, orientação e relevância são proibidas (nada de dica genérica a partir do número).
    expect(validateIndicatorWording({ ...good, whyItMatters: "Acompanhar este indicador pode ajudar.", whatYouCanDo: "Você pode revisar o tempo das pausas." }, writerItem, ctx)).toEqual(expect.arrayContaining(["UNGROUNDED_GUIDANCE", "UNGROUNDED_RELEVANCE"]))
    expect(validateIndicatorWording({ ...good, observed: "Seu TMA foi 7 minutos, 20 s acima da meta." }, writerItem, ctx)).toContain("UNSUPPORTED_NUMBER")
    expect(validateIndicatorWording({ ...good, observed: "Você atingiu a meta com 420 s." }, writerItem, ctx)).toContain("TARGET_COMPARISON_MISMATCH")
    expect(validateIndicatorWording({ ...good, observed: "Seu TMA melhorou e ficou em 420 s." }, writerItem, ctx)).toContain("TREND_WITHOUT_CANONICAL_HISTORY")
    const fallback = indicatorFallbackWording(writerItem)
    expect(fallback.observed).toBe("No período de 01/09/2026 a 30/09/2026, o resultado oficial de TMA foi 420 s, fora da meta de 400 s (quanto menor, melhor).")
    expect(validateIndicatorWording(fallback, writerItem, ctx)).toEqual([])
  })
})

describe("V1.5.12 — estrutura: o caminho novo nunca reanalisa a interação", () => {
  it("\"Gerar feedback\" e a camada de confiabilidade não chamam a análise semântica direta (V1.5.10), o Planner nem o Agent", async () => {
    const { readdirSync, readFileSync: read, statSync } = await import("node:fs")
    const { join, resolve } = await import("node:path")
    const moduleRoot = resolve(__dirname, "..")
    const files: string[] = [resolve(moduleRoot, "../workflows/application/generate-feedback-action.ts")]
    const walk = (dir: string) => { for (const name of readdirSync(dir)) { const path = join(dir, name); if (statSync(path).isDirectory()) walk(path); else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) files.push(path) } }
    walk(moduleRoot)
    for (const path of files) expect(read(path, "utf8"), path).not.toMatch(/prepareInteractionForFeedback\(|analyzeInteractionSemantics\(|runInvestigation\(|runAgent\(|runOrchestratedReply\(|generateInteractionFeedback\(/)
  })
})
