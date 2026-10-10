import { describe, expect, it } from "vitest"
import { canonicalComparison, describeTargetGap, INDICATOR_CANONICAL_CONTEXT_CONTRACT, renderIndicatorContextForAgent, type IndicatorCanonicalContext } from "../../indicators/domain/indicator-canonical-context.js"
import { normalizeInvestigationResult } from "./feedback-investigation-result.js"
import { buildIndicatorItems } from "./indicator-adapter.js"
import { buildMonitoringItems } from "./monitoring-adapter.js"
import { decideReliableItem, RELIABLE_FEEDBACK_AUTONOMOUS_POLICY, RELIABLE_FEEDBACK_PILOT_POLICY, type ReliableItemDraft, type ReliableWriterOutcome } from "./reliable-feedback-item.js"
import { toIndicatorWriterItem, validateIndicatorWording } from "./reliable-writer.js"

/**
 * V1.5.12a — AUTONOMIA + CONTEXTO CANÔNICO DO INDICADOR. Fixtures SINTÉTICAS no mesmo formato dos smokes V1.5.12
 * (os dados reais dos smokes ficam só no contrafactual offline, fora do repositório).
 */
const ORG = "00000000-0000-4000-8000-000000000001"
const OPERATOR = "11111111-1111-4111-8111-111111111111"
const INTERACTION = "22222222-2222-4222-8222-222222222222"
const MEASUREMENT = "33333333-3333-4333-8333-333333333333"

const TRANSCRIPT = ["[00:01–00:05] CLIENTE: Queria cancelar a assinatura adicional.", "[00:06–00:12] OPERADOR: Ia registrar o pedido, mas a tela não carregou. Vamos deixar assim por enquanto.", "[00:13–00:15] CLIENTE: Tudo bem."].join("\n")
const monitoringItem = (): ReliableItemDraft => {
  const normalized = normalizeInvestigationResult({
    sourceNodeOutput: { kind: "monitoring", input: { organizationId: ORG, operatorId: OPERATOR, interactionId: INTERACTION, structured: { title: "t", summary: "O pedido ficou sem registro.", impactedIndicator: "Resolução", evidenceFound: "Operador: Ia registrar o pedido, mas a tela não carregou. Vamos deixar assim por enquanto.", observedBehavior: "não concluiu o registro", relatedProcedure: "p", recommendation: "Explique o próximo passo." } } },
    sourceType: "AGENT", sourceNodeId: "agent", domain: "MONITORING", organizationId: ORG, collaboratorId: OPERATOR, enrollment: { interactionId: INTERACTION, indicatorMeasurementId: null }, configuredAgentId: "agent-id",
  })
  if (!normalized.ok) throw new Error(normalized.reason)
  const [item] = buildMonitoringItems({ result: normalized.result, interactionId: INTERACTION, transcript: TRANSCRIPT }).items
  return item!
}
/** Resultado do redator como o do smoke de monitoria: respondeu, sem fallback, validadores PASS, modos de afirmação aplicados. */
const writerPass: ReliableWriterOutcome = {
  invoked: true, writerError: null, source: "WRITER", violations: [],
  wording: { observed: "Ao relatar a falha da tela, você disse ao cliente que ia deixar o pedido assim por enquanto.", whyItMatters: "Isso pode gerar insegurança sobre o andamento do pedido.", whatYouCanDo: "Você pode informar o próximo passo ou uma alternativa de acompanhamento." },
  claimModes: { effect: "POTENTIAL_ONLY", action: "DECLARED_ONLY" },
}

const smokeLikeCanonical = (): IndicatorCanonicalContext => ({
  contract: INDICATOR_CANONICAL_CONTEXT_CONTRACT,
  indicator: { id: "ind", code: "TMA", name: "Tempo Médio de Atendimento", unit: "SECONDS", direction: "LOWER" },
  measurement: { id: MEASUREMENT, subjectId: OPERATOR, value: 708, periodStart: "2026-09-21", periodEnd: "2026-09-21", granularity: "DAILY" },
  target: { value: 600, source: "TEAM", goalId: "goal" },
  ...canonicalComparison(708, 600, "LOWER"),
  provenance: { source: "indicator_measurements+goals", loadedAt: "2026-09-24T12:00:00Z" },
})
const indicatorItemWith = (summary: string, canonical = smokeLikeCanonical()) => {
  const normalized = normalizeInvestigationResult({
    sourceNodeOutput: { kind: "indicator", input: { organizationId: ORG, operatorId: OPERATOR, contextSnapshot: { indicatorMeasurementId: MEASUREMENT }, structured: { title: "t", summary, relatedProcedure: "p", recommendation: "Você pode revisar as pausas." } } },
    sourceType: "AGENT", sourceNodeId: "agent", domain: "INDICATOR", organizationId: ORG, collaboratorId: OPERATOR, enrollment: { interactionId: null, indicatorMeasurementId: MEASUREMENT }, configuredAgentId: "agent-id",
  })
  if (!normalized.ok) throw new Error(normalized.reason)
  return buildIndicatorItems({ result: normalized.result, canonical })[0]!
}
const wordingWith = (whyItMatters: string, observed = "No período de 21/09/2026, o indicador Tempo Médio de Atendimento apresentou o valor de 708 s, ficando fora da meta de 600 s.") => ({ observed, whyItMatters, whatYouCanDo: "Você pode buscar formas de simplificar as etapas do atendimento." })

describe("V1.5.12a — política de autonomia: claro segue, duvidoso vai a QA, inseguro é BLOCKED", () => {
  it("AUTONOMOUS_V1 libera os tipos produzidos pela camada (V1.6.0: + MONITORING_STRENGTH; V1.6.1: padrões do diagnóstico) — e PILOT_V1 nenhum", () => {
    expect(RELIABLE_FEEDBACK_AUTONOMOUS_POLICY.releasedItemKinds).toEqual(["MONITORING_DEVELOPMENT_POINT", "MONITORING_STRENGTH", "INDICATOR_TARGET_MET", "INDICATOR_TARGET_NOT_MET", "INDICATOR_DEVELOPMENT_PATTERN", "INDICATOR_STRENGTH_PATTERN"])
    expect(RELIABLE_FEEDBACK_PILOT_POLICY.releasedItemKinds).toEqual([])
  })
  it("A) monitoria segura (literal verificado, dono operador, redator PASS) sob AUTONOMOUS_V1 → READY", () => {
    const item = monitoringItem()
    expect(item).toMatchObject({ structuralBlock: null, ownership: "AGENT", section: "OPPORTUNITY" })
    expect(decideReliableItem(item, writerPass, RELIABLE_FEEDBACK_AUTONOMOUS_POLICY)).toMatchObject({ disposition: "READY", reasons: ["AUTONOMY_CRITERIA_MET"], autonomyEligible: true })
  })
  it("B) o mesmo caso sob PILOT_V1 → HOLD_FOR_QA", () => {
    expect(decideReliableItem(monitoringItem(), writerPass, RELIABLE_FEEDBACK_PILOT_POLICY)).toMatchObject({ disposition: "HOLD_FOR_QA", reasons: ["PILOT_HOLD_ALL_FOR_QA", "FEEDBACK_KIND_NOT_RELEASED_FOR_AUTONOMY"], autonomyEligible: true })
  })
  it("G) fallback do redator nunca é READY (mesmo com o tipo liberado)", () => {
    const decision = decideReliableItem(monitoringItem(), { ...writerPass, source: "FALLBACK" }, RELIABLE_FEEDBACK_AUTONOMOUS_POLICY)
    expect(decision.disposition).toBe("HOLD_FOR_QA")
    expect(decision.reasons).toContain("WRITER_FALLBACK_USED")
  })
  it("H) conflito real da interpretação da origem com o dado oficial nunca é READY", () => {
    const item = indicatorItemWith("Seu TMA ficou em 999 s.")
    expect(item.analysisConflicts).toContain("UNSUPPORTED_NUMBER")
    const decision = decideReliableItem(item, { ...writerPass, claimModes: { effect: "POTENTIAL_ONLY", action: null } }, RELIABLE_FEEDBACK_AUTONOMOUS_POLICY)
    expect(decision).toMatchObject({ disposition: "HOLD_FOR_QA", reasons: ["SOURCE_INTERPRETATION_CONFLICT"] })
  })
  it("o tipo sozinho nunca libera: validador, redator sem resposta, dono, privacidade e modos de afirmação seguram em QA; estrutura = BLOCKED", () => {
    const item = monitoringItem()
    const policy = RELIABLE_FEEDBACK_AUTONOMOUS_POLICY
    expect(decideReliableItem(item, { ...writerPass, violations: ["GUARANTEED_EFFECT"] }, policy).reasons).toEqual(["WRITER_VALIDATION_FAILED"])
    expect(decideReliableItem(item, { ...writerPass, invoked: false }, policy).reasons).toEqual(["WRITER_NOT_PASSED"])
    expect(decideReliableItem({ ...item, ownership: "CUSTOMER" }, writerPass, policy).reasons).toEqual(["OWNERSHIP_NOT_ALLOWED"])
    expect(decideReliableItem(item, { ...writerPass, wording: { ...writerPass.wording, observed: "Ligue para 11 98765-4321." } }, policy).reasons).toEqual(["WORDING_PRIVACY_FLAG"])
    expect(decideReliableItem(item, { ...writerPass, claimModes: null }, policy).reasons).toEqual(["CLAIM_BOUNDARY_NOT_ENFORCED"])
    expect(decideReliableItem({ ...item, structuralBlock: "EVIDENCE_NOT_VERIFIED" }, writerPass, policy)).toMatchObject({ disposition: "BLOCKED", autonomyEligible: null })
  })
  it("indicador claro (canônico, redator PASS, sem conflito) sob AUTONOMOUS_V1 → READY", () => {
    const item = indicatorItemWith("Seu TMA ficou fora da meta.")
    const writerItem = toIndicatorWriterItem(item, "ITEM_1", smokeLikeCanonical())
    // V1.6.0: sem base de conhecimento o indicador é SÓ o fato — "por que importa"/"o que fazer" ficam vazios.
    const wording = { ...wordingWith(""), whatYouCanDo: "" }
    expect(validateIndicatorWording(wording, writerItem, smokeLikeCanonical())).toEqual([])
    expect(decideReliableItem(item, { ...writerPass, wording, claimModes: { effect: "POTENTIAL_ONLY", action: null } }, RELIABLE_FEEDBACK_AUTONOMOUS_POLICY).disposition).toBe("READY")
  })
})

describe("V1.5.12a — correção A: comparação com a meta ciente do campo", () => {
  const canonical = smokeLikeCanonical()
  const writerItem = toIndicatorWriterItem(indicatorItemWith("Seu TMA ficou fora da meta."), "ITEM_1", canonical)
  it("C) fora da meta + \"Seu indicador ficou dentro da meta\" → TARGET_COMPARISON_MISMATCH (em qualquer campo)", () => {
    expect(validateIndicatorWording(wordingWith("Isso importa para a fila.", "Seu indicador ficou dentro da meta."), writerItem, canonical)).toContain("TARGET_COMPARISON_MISMATCH")
    expect(validateIndicatorWording(wordingWith("Seu indicador ficou dentro da meta e isso ajuda a fila."), writerItem, canonical)).toContain("TARGET_COMPARISON_MISMATCH")
    expect(validateIndicatorWording(wordingWith("Você atingiu a meta, e isso pode ajudar a fila."), writerItem, canonical)).toContain("TARGET_COMPARISON_MISMATCH")
  })
  it("D) fora da meta + \"Manter o indicador dentro da meta…\" (objetivo) NÃO é afirmação de estado", () => {
    expect(validateIndicatorWording(wordingWith("Manter o indicador dentro da meta pode ajudar a tornar o fluxo de trabalho mais fluido."), writerItem, canonical)).not.toContain("TARGET_COMPARISON_MISMATCH")
    expect(validateIndicatorWording({ ...wordingWith("Isso pode ajudar a fila."), whatYouCanDo: "Para que seu TMA fique dentro da meta, você pode revisar as pausas." }, writerItem, canonical)).not.toContain("TARGET_COMPARISON_MISMATCH")
  })
  it("observed continua ESTRITO: a mesma frase de objetivo no resultado do período conta como afirmação", () => {
    expect(validateIndicatorWording(wordingWith("Isso pode ajudar a fila.", "Manter o indicador dentro da meta foi o resultado de 21/09/2026."), writerItem, canonical)).toContain("TARGET_COMPARISON_MISMATCH")
  })
  it("posição coerente com o dado não é conflito (\"está acima da meta\" com 708 > 600)", () => {
    expect(validateIndicatorWording(wordingWith("Seu resultado está acima da meta, o que pode impactar a fila."), writerItem, canonical)).not.toContain("TARGET_COMPARISON_MISMATCH")
    expect(validateIndicatorWording(wordingWith("Seu resultado está abaixo da meta."), writerItem, canonical)).toContain("TARGET_COMPARISON_MISMATCH")
  })
  it("efeito garantido também é recusado no indicador (EFFECT_CLAIM_MODE = POTENTIAL_ONLY)", () => {
    expect(validateIndicatorWording(wordingWith("Reduzir o tempo garante que o cliente fique satisfeito."), writerItem, canonical)).toContain("GUARANTEED_EFFECT")
  })
})

describe("V1.5.12a — correção B: UM contexto canônico para o Agent e para a validação", () => {
  it("708 × meta 600, menor é melhor → fora da meta, distância 108 calculada pelo sistema", () => {
    expect(canonicalComparison(708, 600, "LOWER")).toEqual({ withinTarget: false, position: "ABOVE", gapToTarget: 108 })
    expect(canonicalComparison(580, 600, "LOWER")).toEqual({ withinTarget: true, position: "BELOW", gapToTarget: null })
    expect(canonicalComparison(80, 90, "HIGHER")).toEqual({ withinTarget: false, position: "BELOW", gapToTarget: 10 })
    expect(canonicalComparison(95.5, 90, "HIGHER").gapToTarget).toBeNull()
    expect(canonicalComparison(10, null, "HIGHER")).toEqual({ withinTarget: null, position: null, gapToTarget: null })
  })
  it("o Agent recebe a MESMA distância que a validação aceita (texto derivado da projeção)", () => {
    const text = renderIndicatorContextForAgent(smokeLikeCanonical())
    expect(text).toContain("Valor medido: 708 s")
    expect(text).toContain("Meta vigente: 600 s")
    expect(text).toContain("Precisa reduzir 108 s para atingir a meta.")
    expect(describeTargetGap(80, 90, "HIGHER", "PERCENT")).toMatch(/^Faltam .*10.* para atingir a meta\.$/)
    expect(describeTargetGap(580, 600, "LOWER", "SECONDS")).toBe("Está dentro da meta.")
    expect(describeTargetGap(10, null, "LOWER", "SECONDS")).toBe("")
  })
  it("E) o Agent cita 108 → aceito (dado canônico); F) inventa 109 → rejeitado", () => {
    const accepted = indicatorItemWith("Seu TMA foi 708 s; é preciso reduzir 108 s para atingir a meta de 600 s.")
    expect(accepted.analysisConflicts).toEqual([])
    expect(accepted.analysis).not.toBeNull()
    const invented = indicatorItemWith("Seu TMA foi 708 s; é preciso reduzir 109 s para atingir a meta de 600 s.")
    expect(invented.analysisConflicts).toContain("UNSUPPORTED_NUMBER")
    expect(invented.analysis).toBeNull()
  })
  it("dentro da meta não há distância a citar: qualquer 'diferença' vira número não sustentado", () => {
    const within = { ...smokeLikeCanonical(), measurement: { ...smokeLikeCanonical().measurement, value: 580 }, ...canonicalComparison(580, 600, "LOWER") }
    expect(indicatorItemWith("Você ficou 20 s abaixo da meta.", within).analysisConflicts).toContain("UNSUPPORTED_NUMBER")
  })
})
