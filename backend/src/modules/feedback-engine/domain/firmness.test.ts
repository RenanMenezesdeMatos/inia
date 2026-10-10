import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import type { VerifiedCallAnalysis } from "./call-analysis.js"
import { buildMonitoringBrief, type BriefFinding, type FeedbackBrief } from "./feedback-brief.js"
import { firmnessOf, strongestFirmness } from "./firmness.js"
import { compositionPayloadOf, verificationFactsOf } from "./composition-prompt.js"
import { parseVerdicts, repairInstructionsOf, usefulnessOf, type SentenceDecision } from "./composition.js"
import { createInMemoryFeedbackMemoryStore } from "../infrastructure/in-memory-feedback-memory-store.js"

/**
 * FIRMEZA DO RETORNO (`FEEDBACK_FIRMNESS_V1`) — zero IA. O pedido do produto: o retorno é propositivo, mas "puxa a orelha" quando a
 * pessoa fez errado. Quem decide o tom é o CÓDIGO, só com fatos: regra vigente na data da chamada, impacto, reincidência da mesma
 * prática e orientação anterior entregue. O redator escreve no tom; o verificador confere que a correção não foi amaciada.
 */
const here = dirname(fileURLToPath(import.meta.url))
const fixture = JSON.parse(readFileSync(join(here, "../testing/c07-reviewed-analysis.json"), "utf8")) as { interactionId: string; analysis: VerifiedCallAnalysis; criterionKeys: Record<string, string>; documentTitles: Record<string, string> }
type BriefInput = Parameters<typeof buildMonitoringBrief>[0]
const briefOf = (analysis: VerifiedCallAnalysis, extra: Partial<BriefInput> = {}) => buildMonitoringBrief({ analysis, interactionId: fixture.interactionId, label: "Contestação de cobrança", subjectSource: "CANONICAL", dateLabel: "21/08/2026", selectionReason: "Teste.", criterionKeys: new Map(Object.entries(fixture.criterionKeys)), documentTitles: new Map(Object.entries(fixture.documentTitles)), documentVersions: new Map(), history: new Map(), delivered: new Set(), ...extra })
const inForce = (analysis: VerifiedCallAnalysis, materiality?: "HIGH" | "MEDIUM"): VerifiedCallAnalysis => ({
  ...analysis,
  scenario: { ...analysis.scenario, rulePerspective: "RULE_IN_FORCE_AT_CALL" },
  criteria: analysis.criteria.map((criterion) => (materiality && (criterion.status === "NOT_MET" || criterion.status === "PARTIAL") ? { ...criterion, materiality } : criterion)),
})
const developmentKeys = fixture.analysis.criteria.filter((criterion) => criterion.status === "NOT_MET" || criterion.status === "PARTIAL").map((criterion) => fixture.criterionKeys[criterion.lineKey]!)

describe("firmnessOf — a escada decidida por fatos", () => {
  it("regra publicada depois da chamada: sempre orientação, mesmo com impacto alto, reincidência e orientação anterior", () => {
    const value = firmnessOf({ ruleBasis: "CURRENT_RULE_REEVALUATION", materiality: "HIGH", recurrence: { assessed: 5, notMet: 4 }, priorOrientation: { dateLabel: "01/09/2026" } })
    expect(value.level).toBe("ORIENT")
    expect(value.basis[0]).toMatch(/publicada depois/)
  })
  it("regra vigente: impacto alto ou reincidência (≥ 2) = correção; primeira vez sem impacto alto = orientação", () => {
    expect(firmnessOf({ ruleBasis: "RULE_IN_FORCE_AT_CALL", materiality: "HIGH", recurrence: null, priorOrientation: null }).level).toBe("CORRECT")
    expect(firmnessOf({ ruleBasis: "RULE_IN_FORCE_AT_CALL", materiality: "MEDIUM", recurrence: { assessed: 3, notMet: 2 }, priorOrientation: null }).level).toBe("CORRECT")
    expect(firmnessOf({ ruleBasis: "RULE_IN_FORCE_AT_CALL", materiality: "MEDIUM", recurrence: { assessed: 3, notMet: 1 }, priorOrientation: null }).level).toBe("ORIENT")
    expect(firmnessOf({ ruleBasis: null, materiality: "MEDIUM", recurrence: null, priorOrientation: null }).level).toBe("ORIENT")
  })
  it("já orientado num retorno entregue e voltou a acontecer = insistência, com a data como fato", () => {
    const value = firmnessOf({ ruleBasis: "RULE_IN_FORCE_AT_CALL", materiality: "MEDIUM", recurrence: null, priorOrientation: { dateLabel: "15/09/2026" } })
    expect(value.level).toBe("INSIST")
    expect(value.basis[0]).toBe("Este ponto já foi orientado num retorno entregue em 15/09/2026 e voltou a acontecer.")
  })
  it("período (indicador): a base fala das chamadas analisadas; consolidação fica com o nível mais alto", () => {
    expect(firmnessOf({ ruleBasis: null, materiality: "HIGH", recurrence: { assessed: 6, notMet: 4 }, priorOrientation: null, scope: "PERIOD" }).basis).toEqual(["A regra já valia nas chamadas analisadas do período."])
    expect(strongestFirmness([{ level: "ORIENT", basis: [] }, { level: "INSIST", basis: ["x"] }, undefined])?.level).toBe("INSIST")
    expect(strongestFirmness([undefined])).toBeUndefined()
  })
})

describe("brief de monitoria: cada ponto de desenvolvimento leva a prática e o tom", () => {
  it("C07 real (regra publicada depois da chamada): orientação, nunca cobrança", () => {
    const brief = briefOf(fixture.analysis)
    expect(brief.developments.length).toBeGreaterThan(0)
    for (const finding of brief.developments) expect(finding.firmness?.level).toBe("ORIENT")
  })
  it("a mesma chamada com a regra vigente: reincidência na prática (não na chave da obrigação) vira correção", () => {
    const practices = new Map(developmentKeys.map((key) => [key, { practiceKey: "KC-recap", priorOrientation: null }]))
    const history = new Map(developmentKeys.map((key) => [key, { assessed: 4, notMet: 3, met: 1 }]))
    const brief = briefOf(inForce(fixture.analysis), { practices, history })
    const point = brief.developments[0]!
    expect(point.firmness?.level).toBe("CORRECT")
    expect(point.practiceKeys).toEqual(["KC-recap"])
    expect(point.history).toBe("Nas 4 chamadas anteriores analisadas em que esta etapa se aplicava, ela não foi cumprida em 3.")
  })
  it("orientação anterior entregue na mesma prática = insistência (o ponto consolidado fica com o nível mais alto)", () => {
    const [first, ...rest] = developmentKeys
    type Practice = { practiceKey: string; priorOrientation: { dateLabel: string } | null }
    const practices = new Map<string, Practice>([[first!, { practiceKey: "KC-recap", priorOrientation: { dateLabel: "10/09/2026" } }], ...rest.map((key): [string, Practice] => [key, { practiceKey: "KC-recap", priorOrientation: null }])])
    const brief = briefOf(inForce(fixture.analysis), { practices })
    expect(brief.developments[0]!.firmness?.level).toBe("INSIST")
    expect(brief.developments[0]!.firmness?.basis[0]).toMatch(/10\/09\/2026/)
  })
  it("o redator e o verificador recebem o tom e a base; reconhecimento não tem firmeza", () => {
    const brief = briefOf(inForce(fixture.analysis, "HIGH"))
    const payload = compositionPayloadOf(brief)
    expect(payload.facts.developments[0]).toMatchObject({ firmness: { level: "CORRECT", basis: ["A regra já valia na data da chamada."] } })
    expect(verificationFactsOf(brief).developments[0]).toHaveProperty("firmness")
    for (const strength of verificationFactsOf(brief).strengths) expect(strength).not.toHaveProperty("firmness")
  })
})

describe("composição: correção comunicada sem frase de ajuste ou amaciada é lacuna pedida na reescrita", () => {
  const brief = (): FeedbackBrief => {
    const value = briefOf(inForce(fixture.analysis, "HIGH"))
    value.developments.forEach((finding, index) => (finding.ref = `A${index + 1}`))
    return value
  }
  const kept = (stance: SentenceDecision["stance"], refs: string[]) => ({ stance, refs, verdict: { id: "F1", verdict: "SUPPORTED" as const, specific: true, repeats: null, note: null } })

  it("só orientação para um ponto CORRECT → missingCorrection; com frase de ajuste, sem lacuna", () => {
    const value = brief()
    expect(usefulnessOf(value, [kept("GUIDANCE", ["A1"])]).missingCorrection).toEqual(["A1"])
    expect(usefulnessOf(value, [kept("ADJUSTMENT", ["A1"]), kept("GUIDANCE", ["A1"])]).missingCorrection).toBeUndefined()
  })
  it("ponto não comunicado não vira lacuna de firmeza (a IA decide o que dizer)", () => {
    expect(usefulnessOf(brief(), [kept("CONTEXT", [])]).missingCorrection).toBeUndefined()
  })
  it("o verificador diz que a correção ficou amaciada → reescrita pede correção direta, sem julgar a pessoa", () => {
    const value = brief()
    const parsed = parseVerdicts(JSON.stringify({ verdicts: [{ id: "F1", verdict: "SUPPORTED" }, { id: "CARD", verdict: "SUPPORTED" }], message: { conveysPrimary: true, valueBeyondNarration: true, firmnessRespected: false, note: "virou sugestão" } }), ["F1", "CARD"])
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const usefulness = usefulnessOf(value, [kept("ADJUSTMENT", ["A1"])], parsed.message)
    expect(usefulness.softenedCorrection).toBe("virou sugestão")
    const reasons = repairInstructionsOf([], usefulness, value, { guidance: {}, why: {} })
    expect(reasons.join(" ")).toMatch(/amaciada/)
    expect(reasons.join(" ")).toMatch(/nunca|sem julgar a pessoa/)
  })
  it("tudo ORIENT: o verificador pode dizer null e nada é pedido", () => {
    const value = briefOf(fixture.analysis)
    value.developments.forEach((finding: BriefFinding, index) => (finding.ref = `A${index + 1}`))
    const usefulness = usefulnessOf(value, [kept("GUIDANCE", ["A1"])], { conveysPrimary: true, valueBeyondNarration: true, note: null, firmnessRespected: false })
    expect(usefulness.missingCorrection).toBeUndefined()
    expect(usefulness.softenedCorrection).toBeUndefined()
  })
})

describe("memória: orientação anterior por prática", () => {
  it("só conta mensagem ENTREGUE antes da data que COMUNICOU um ponto daquela prática", async () => {
    const store = createInMemoryFeedbackMemoryStore()
    const at = (iso: string) => new Date(iso)
    const finding = (findingKey: string, practiceKeys: string[]) => ({ findingKey, practiceKeys }) as unknown as BriefFinding
    const put = (id: string, deliveredAt: Date | null, findingKeys: string[], developments: BriefFinding[]) =>
      store.messages.set(id, { id, organizationId: "org", messageKey: id, enrollmentId: null, workflowId: null, workflowVersionId: null, nodeId: null, sourceNodeId: null, personId: "p1", domain: "MONITORING", status: "PUBLISHABLE", analysisRunIds: [], abstainReason: null, findingKeys, brief: { developments } as unknown as FeedbackBrief, message: null, composition: null, suppressed: [], metrics: {}, completedAt: deliveredAt, deliveredAt, claimedUntil: null })
    put("m1", at("2026-09-10T15:00:00Z"), ["F1"], [finding("F1", ["KC-a"])])
    put("m2", at("2026-09-20T15:00:00Z"), ["F2"], [finding("F2", ["KC-a"])])
    put("m3", at("2026-09-05T15:00:00Z"), [], [finding("F3", ["KC-b"])]) // ponto não comunicado
    put("m4", null, ["F4"], [finding("F4", ["KC-c"])]) // não entregue
    const result = await store.deliveredPractices("org", "p1", ["KC-a", "KC-b", "KC-c"], at("2026-09-15T00:00:00Z"))
    expect(result).toEqual([{ practiceKey: "KC-a", deliveredAt: at("2026-09-10T15:00:00Z") }])
  })
})

describe("consolidação: etapa reincidente é ponto próprio; o ponto do caminho mantém o histórico e o tom do que absorve", () => {
  const finding = (overrides: Partial<BriefFinding>): BriefFinding => ({ ref: "", findingKey: "k", kind: "DEVELOPMENT", origin: "CRITERION", title: "t", materiality: "MEDIUM", status: "NOT_MET", observed: "x", reading: null, quotes: [], absence: null, declaredOnly: false, rules: [], guidance: null, whyItMatters: null, history: null, criterionKeys: [], stats: [], ...overrides })
  const path = () => finding({ findingKey: "CALL:i:PATH:d", origin: "PATH", title: "Caminho do atendimento", status: "PATH_INCORRECT", materiality: "HIGH", criterionKeys: ["KC-prazo", "KC-recap", "KC-conf"], firmness: { level: "CORRECT", basis: ["A regra já valia na data da chamada."] } })
  it("validação V14C (L09): recapitulação não cumprida em 7 de 8 chamadas anteriores NÃO é absorvida pelo caminho — fica ponto próprio, com o histórico", async () => {
    const { consolidateDevelopments } = await import("./feedback-brief.js")
    const prazo = finding({ findingKey: "CALL:i:KC-prazo", title: "Conta já paga", criterionKeys: ["KC-prazo"], practiceKeys: ["KC-34"], firmness: { level: "CORRECT", basis: [] } })
    const recap = finding({ findingKey: "CALL:i:KC-recap", title: "Recapitulação obrigatória", criterionKeys: ["KC-recap"], practiceKeys: ["KC-46"], recurrence: { assessed: 8, notMet: 7 }, history: "Nas 8 chamadas anteriores analisadas em que esta etapa se aplicava, ela não foi cumprida em 7.", firmness: { level: "CORRECT", basis: [] } })
    const points = consolidateDevelopments([path(), prazo, recap])
    expect(points.map((point) => point.title)).toEqual(["Caminho do atendimento", "Recapitulação obrigatória"])
    expect(points[1]!.history).toMatch(/não foi cumprida em 7/)
    expect(points[0]!.memberFindingKeys).toEqual(["CALL:i:KC-prazo"])
  })
  it("orientada antes e repetida (INSIST) também é ponto próprio; etapa com 1 falha anterior é absorvida e o caminho diz o histórico dela", async () => {
    const { consolidateDevelopments } = await import("./feedback-brief.js")
    const recap = finding({ findingKey: "CALL:i:KC-recap", title: "Recapitulação obrigatória", criterionKeys: ["KC-recap"], practiceKeys: ["KC-46"], firmness: { level: "INSIST", basis: ["Este ponto já foi orientado num retorno entregue em 10/09/2026 e voltou a acontecer."] } })
    const conf = finding({ findingKey: "CALL:i:KC-conf", title: "Confirmação de entendimento", criterionKeys: ["KC-conf"], practiceKeys: ["KC-47"], recurrence: { assessed: 3, notMet: 1 }, history: "Nas 3 chamadas anteriores analisadas em que esta etapa se aplicava, ela não foi cumprida em 1.", firmness: { level: "ORIENT", basis: [] } })
    const points = consolidateDevelopments([path(), recap, conf])
    expect(points.map((point) => point.title)).toEqual(["Caminho do atendimento", "Recapitulação obrigatória"])
    expect(points[1]!.firmness?.level).toBe("INSIST")
    expect(points[0]!.history).toBe("Sobre “Confirmação de entendimento”: nas 3 chamadas anteriores analisadas em que esta etapa se aplicava, ela não foi cumprida em 1.")
    expect(points[0]!.practiceKeys).toEqual(["KC-47"])
    expect(points[0]!.firmness?.level).toBe("CORRECT")
  })
})

describe("por que o tom subiu (dueTo) chega ao redator e ao verificador", () => {
  it("impacto alto, reincidência e orientação anterior são motivos distintos", () => {
    expect(firmnessOf({ ruleBasis: null, materiality: "HIGH", recurrence: null, priorOrientation: null }).dueTo).toEqual(["HIGH_IMPACT"])
    expect(firmnessOf({ ruleBasis: null, materiality: "MEDIUM", recurrence: { assessed: 8, notMet: 7 }, priorOrientation: null }).dueTo).toEqual(["RECURRENCE"])
    expect(firmnessOf({ ruleBasis: null, materiality: "HIGH", recurrence: { assessed: 8, notMet: 7 }, priorOrientation: null }).dueTo).toEqual(["HIGH_IMPACT", "RECURRENCE"])
    expect(firmnessOf({ ruleBasis: null, materiality: "MEDIUM", recurrence: { assessed: 3, notMet: 2 }, priorOrientation: { dateLabel: "10/09/2026" } }).dueTo).toEqual(["PRIOR_ORIENTATION", "RECURRENCE"])
    expect(firmnessOf({ ruleBasis: null, materiality: "MEDIUM", recurrence: null, priorOrientation: null }).dueTo).toBeUndefined()
  })
  it("a reincidência vai nos fatos do ponto (com o histórico) para o redator e o verificador", () => {
    const practices = new Map(developmentKeys.map((key) => [key, { practiceKey: "KC-recap", priorOrientation: null }]))
    const history = new Map(developmentKeys.map((key) => [key, { assessed: 8, notMet: 7, met: 1 }]))
    const brief = briefOf(inForce(fixture.analysis), { practices, history })
    const facts = verificationFactsOf(brief).developments[0] as { firmness?: { dueTo?: string[] }; history?: string }
    expect(facts.firmness?.dueTo).toContain("RECURRENCE")
    expect(facts.history).toMatch(/não foi cumprida em 7/)
  })
})
