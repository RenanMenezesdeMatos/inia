import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { triageIndicator } from "./closing-triage.js"
import { diagnosticStrategyConfigSchema, emptyStrategyConfig, runtimeParametersOf, signalLabelOf, strategyCapabilities, validateStrategyForPublish, type DiagnosticStrategyConfig } from "./diagnostic-strategy.js"
import { diagnosisMetricOf } from "./indicator-diagnosis.js"
import { fixedStepsOf, parseInvestigationPlan, renderInvestigationPlannerTurn, selectInvestigationSteps, stepAvailabilityOf } from "./investigation-steps.js"
import type { OfficialIndicatorSnapshot, PrvClosing } from "./prv-closing.js"
import { buildIndicatorInvestigation, buildPrvClosingDiagnosis, directDiagnosisIdempotencyKey, DIRECT_DIAGNOSIS_LOGIC_VERSION, prvDiagnosisIdempotencyKey, type InvestigationInput } from "./prv-investigation.js"
import { signalDistributionOf, signalEvolutionOf } from "./signal-population.js"

/**
 * INDICATOR DIAGNOSIS V2 — estratégia configurável + Rechamada V1 (domínio puro, zero modelo). A regra de investigação é DADO
 * (estratégia versionada); o núcleo conhece capacidades (sinal, motivo, processo, grupo), nunca códigos de indicador.
 */

// A estratégia RECALL_V1 exatamente como a homologação publica (a mesma forma que o serviço/API grava).
export const RECALL_V1: DiagnosticStrategyConfig = {
  ...emptyStrategyConfig(),
  segmentation: { enabled: true, dimensions: ["SUBJECT"], minimumSegmentInteractions: 3 },
  interactionInvestigation: { enabled: true, maxInteractions: 10, minimumAnalyzed: 3, minimumCoveragePercent: null, maxRepairInteractions: 5 },
  processAssessment: { enabled: true, population: "LINKED_PREVIOUS_OF_SIGNAL" },
  closingTriage: { enabled: true, developmentQuartiles: ["Q3", "Q4"], belowTarget: true, quartileWorsened: true, recognitionQuartiles: ["Q1"] },
  populationSignal: { kind: "INTERACTION_FLAG", flagName: "rechamada", effect: "ADVERSE" },
  investigation: {
    mode: "AGENT_SELECTED",
    objective: "Entender onde as interações marcadas como rechamada aparecem nos atendimentos do colaborador, sem transformar associação em causa.",
    instructions: "Olhe a situação oficial e a evolução; veja por motivo onde as rechamadas se concentram; os atendimentos anteriores só com vínculo confiável.",
    allowedSteps: ["SIGNAL_DISTRIBUTION", "SIGNAL_EVOLUTION", "REASON_MIX_SHIFT", "PROCESS_ASSESSMENT"],
    prohibitedClaims: ["reduzirá a rechamada"],
  },
}
const FLAGS = [{ name: "rechamada", valueType: "BOOLEAN", active: true }, { name: "nota_ura", valueType: "NUMERIC", active: true }]

const RECALL: OfficialIndicatorSnapshot = { snapshotId: "snap-recall", indicatorId: "ind-recall", indicatorCode: "RECHAMADA", indicatorName: "Rechamada", unit: "PERCENT", direction: "LOWER", referencePeriod: "2026-08", value: 14.6, target: 10, achievementPercent: 68.5, weightPercent: null, quartile: "Q4", subteamId: null }
const closingOf = (snapshot: OfficialIndicatorSnapshot): PrvClosing => ({ contract: "PRV_CLOSING_V1", organizationId: "org", personId: "person", referencePeriod: "2026-08", prv: null, indicators: [snapshot], previous: { referencePeriod: "2026-07", prv: null, indicators: [{ ...snapshot, snapshotId: "snap-prev", referencePeriod: "2026-07", value: 9.8, quartile: "Q2" }] } })

describe("V2 — estratégia versionada com investigação orientada e sinal de população", () => {
  it("RECALL_V1 é uma configuração válida do mesmo schema (aditivo): publica com a flag booleana do catálogo", () => {
    expect(diagnosticStrategyConfigSchema.safeParse(RECALL_V1).success).toBe(true)
    expect(validateStrategyForPublish(RECALL_V1, { indicatorUnit: "PERCENT", domains: [], flags: FLAGS })).toEqual([])
  })
  it("sinal numérico com condição chega ao runtime com a condição e o efeito; o rótulo é o mesmo em toda superfície", () => {
    const parameters = runtimeParametersOf({ id: "v1", version: 1, config: { ...RECALL_V1, populationSignal: { kind: "INTERACTION_FLAG", flagName: "nota_ura", condition: { operator: "LTE", value: 2 }, effect: "ADVERSE" } } })
    expect(parameters.populationSignal).toEqual({ flagName: "nota_ura", condition: { operator: "LTE", value: 2 }, effect: "ADVERSE" })
    expect(signalLabelOf(parameters.populationSignal!)).toBe("nota_ura ≤ 2")
    expect(signalLabelOf({ flagName: "nota_ura", condition: { operator: "LT", value: 2.5 } })).toBe("nota_ura < 2,5")
    // Versão anterior (sem `effect`): continua válida no schema e roda com o sentido do próprio indicador.
    expect(runtimeParametersOf({ id: "v0", version: 1, config: { ...RECALL_V1, populationSignal: { kind: "INTERACTION_FLAG", flagName: "rechamada" } } }).populationSignal).toEqual({ flagName: "rechamada", condition: null, effect: null })
  })
  it("a estratégia do TMA (v3, sem o bloco novo) continua válida e roda em modo FIXO, sem sinal, com processo no motivo — comportamento homologado", () => {
    const tmaV3: DiagnosticStrategyConfig = { ...emptyStrategyConfig(), segmentation: { enabled: true, dimensions: ["SUBJECT"], minimumSegmentInteractions: 3 }, interactionInvestigation: { enabled: true, maxInteractions: 10, minimumAnalyzed: 3, maxRepairInteractions: 10, minimumCoveragePercent: null }, processAssessment: { enabled: true }, closingTriage: { enabled: true, belowTarget: false, quartileWorsened: true, developmentQuartiles: ["Q3", "Q4"], recognitionQuartiles: ["Q1"] } }
    expect(diagnosticStrategyConfigSchema.safeParse(tmaV3).success).toBe(true)
    const parameters = runtimeParametersOf({ id: "v3", version: 3, config: tmaV3 })
    expect(parameters.investigation.mode).toBe("FIXED")
    expect(parameters.populationSignal).toBeNull()
    expect(parameters.processPopulation).toBe("SEGMENT_INTERACTIONS")
    expect(validateStrategyForPublish(tmaV3, { indicatorUnit: "SECONDS", domains: [] })).toEqual([])
  })
  it("sinal precisa ser flag ativa (sim/não sem condição, numérica com condição) e declarar o que representa; população vinculada exige sinal; IA exige objetivo, instruções e passos compatíveis", () => {
    const codes = (config: DiagnosticStrategyConfig, flags = FLAGS) => validateStrategyForPublish(config, { indicatorUnit: "PERCENT", domains: [], flags }).map((issue) => issue.code)
    // `POPULATION_SIGNAL_V2`: numérica exige a condição declarada; sim/não nunca usa condição; o efeito é sempre declarado.
    expect(codes({ ...RECALL_V1, populationSignal: { kind: "INTERACTION_FLAG", flagName: "nota_ura", effect: "ADVERSE" } })).toContain("STRATEGY_SIGNAL_CONDITION_REQUIRED")
    expect(codes({ ...RECALL_V1, populationSignal: { kind: "INTERACTION_FLAG", flagName: "nota_ura", condition: { operator: "LTE", value: 2 }, effect: "ADVERSE" } })).toEqual([])
    expect(codes({ ...RECALL_V1, populationSignal: { kind: "INTERACTION_FLAG", flagName: "rechamada", condition: { operator: "EQ", value: 1 }, effect: "ADVERSE" } })).toContain("STRATEGY_SIGNAL_CONDITION_NOT_ALLOWED")
    expect(codes({ ...RECALL_V1, populationSignal: { kind: "INTERACTION_FLAG", flagName: "rechamada" } })).toContain("STRATEGY_SIGNAL_EFFECT_REQUIRED")
    expect(codes({ ...RECALL_V1, populationSignal: { kind: "INTERACTION_FLAG", flagName: "inexistente" } })).toContain("STRATEGY_SIGNAL_FLAG_NOT_FOUND")
    const { populationSignal: _signal, ...withoutSignal } = RECALL_V1
    void _signal
    expect(codes(withoutSignal as DiagnosticStrategyConfig)).toEqual(expect.arrayContaining(["STRATEGY_LINKED_POPULATION_WITHOUT_SIGNAL", "STRATEGY_STEP_REQUIRES_SIGNAL"]))
    expect(codes({ ...RECALL_V1, investigation: { ...RECALL_V1.investigation!, objective: " ", instructions: "", allowedSteps: [] } })).toEqual(expect.arrayContaining(["STRATEGY_INVESTIGATION_OBJECTIVE_REQUIRED", "STRATEGY_INVESTIGATION_INSTRUCTIONS_REQUIRED", "STRATEGY_INVESTIGATION_STEPS_REQUIRED"]))
  })
  it("indicador de taxa com sinal declarado passa a ser decomponível (pela estratégia, nunca pelo código); sem sinal continua não decomponível", () => {
    expect(diagnosisMetricOf("PERCENT", { flagName: "rechamada" })).toBe("INTERACTION_SIGNAL_RATE")
    expect(diagnosisMetricOf("PERCENT", null)).toBeNull()
    expect(diagnosisMetricOf("SECONDS", { flagName: "rechamada" })).toBe("INTERACTION_DURATION_SECONDS")
    expect(strategyCapabilities({ unit: "PERCENT" }, { populationSignal: { flagName: "rechamada" } }).indicator.decomposable).toBe(true)
    expect(strategyCapabilities({ unit: "PERCENT" }).indicator.decomposable).toBe(false)
  })
})

describe("V2 — passos: disponibilidade real, escolha da IA validada pelo sistema", () => {
  const availability = stepAvailabilityOf({ decomposable: true, segmentationEnabled: true, processEnabled: true, processPopulation: "LINKED_PREVIOUS_OF_SIGNAL", signalConfigured: true, signalFlagValid: true, linkedInteractionsSupported: false })
  it("sem vínculo entre interações no contrato de dados, avaliar os atendimentos anteriores é INDISPONÍVEL (nunca pareado por semelhança)", () => {
    expect(availability.find((entry) => entry.step === "PROCESS_ASSESSMENT")).toEqual({ step: "PROCESS_ASSESSMENT", available: false, reason: "DATA_CONTRACT_NO_INTERACTION_LINK" })
    expect(availability.filter((entry) => entry.available).map((entry) => entry.step)).toEqual(["REASON_MIX_SHIFT", "SIGNAL_DISTRIBUTION", "SIGNAL_EVOLUTION"])
  })
  it("AGENT_SELECTED: só passos permitidos E disponíveis; inexistente, fora da estratégia e indisponível são recusados com motivo", () => {
    const selection = selectInvestigationSteps({
      mode: "AGENT_SELECTED",
      allowed: RECALL_V1.investigation!.allowedSteps,
      fixed: [],
      availability,
      choice: [{ step: "SIGNAL_DISTRIBUTION", purpose: "ver onde o sinal aparece" }, { step: "PROCESS_ASSESSMENT", purpose: "x" }, { step: "TEAM_COMPARISON", purpose: "x" }, { step: "PICK_PEERS_BY_ID", purpose: "x" }, { step: "SIGNAL_DISTRIBUTION", purpose: "de novo" }],
      planner: { status: "SELECTED", agentRunId: "run", attempts: 1, error: null },
    })
    expect(selection.selected).toEqual(["SIGNAL_DISTRIBUTION"])
    expect(selection.notSelected).toEqual(["REASON_MIX_SHIFT", "SIGNAL_EVOLUTION"])
    expect(selection.rejected.map((entry) => [entry.step, entry.reason])).toEqual([["PROCESS_ASSESSMENT", "UNAVAILABLE"], ["TEAM_COMPARISON", "NOT_ALLOWED"], ["PICK_PEERS_BY_ID", "UNKNOWN_STEP"], ["SIGNAL_DISTRIBUTION", "DUPLICATE"]])
    expect(selection.purposes).toEqual([{ step: "SIGNAL_DISTRIBUTION", purpose: "ver onde o sinal aparece" }])
  })
  it("sem escolha válida (planejador falhou) = todos os permitidos e disponíveis; FIXED = chaves da estratégia (TMA)", () => {
    expect(selectInvestigationSteps({ mode: "AGENT_SELECTED", allowed: RECALL_V1.investigation!.allowedSteps, fixed: [], availability, choice: null, planner: { status: "FALLBACK_DEFAULT", agentRunId: null, attempts: 2, error: "PLAN_SCHEMA_INVALID" } }).selected).toEqual(["REASON_MIX_SHIFT", "SIGNAL_DISTRIBUTION", "SIGNAL_EVOLUTION"])
    const tmaAvailability = stepAvailabilityOf({ decomposable: true, segmentationEnabled: true, processEnabled: true, processPopulation: "SEGMENT_INTERACTIONS", signalConfigured: false, signalFlagValid: false, linkedInteractionsSupported: false })
    const fixed = fixedStepsOf({ segmentationEnabled: true, processEnabled: true, signalConfigured: false })
    expect(selectInvestigationSteps({ mode: "FIXED", allowed: [], fixed, availability: tmaAvailability, choice: null, planner: { status: "NOT_APPLICABLE", agentRunId: null, attempts: 0, error: null } }).selected).toEqual(["REASON_MIX_SHIFT", "PROCESS_ASSESSMENT", "TEAM_COMPARISON"])
  })
  it("contrato do planejador: campo fora do contrato (ex.: um id de equipe/pessoa) invalida a resposta inteira; nada de número ou escopo", () => {
    expect(parseInvestigationPlan('{"selectedSteps":[{"step":"SIGNAL_DISTRIBUTION","purpose":"ok"}],"notSelected":[]}')).toEqual({ ok: true, choice: [{ step: "SIGNAL_DISTRIBUTION", purpose: "ok" }] })
    expect(parseInvestigationPlan('{"selectedSteps":[{"step":"TEAM_COMPARISON","purpose":"ok","teamId":"abc"}],"notSelected":[]}').ok).toBe(false)
    expect(parseInvestigationPlan('{"selectedSteps":[],"notSelected":[],"peerIds":["x"]}').ok).toBe(false)
    expect(parseInvestigationPlan("não é json").ok).toBe(false)
  })
  it("o turno do planejador leva a estratégia (objetivo + instruções), os passos com disponibilidade e só fatos do sistema — nenhum id", () => {
    const turn = renderInvestigationPlannerTurn({ objective: RECALL_V1.investigation!.objective, instructions: RECALL_V1.investigation!.instructions, steps: availability, allowed: RECALL_V1.investigation!.allowedSteps, facts: { indicator: { name: "Rechamada", unit: "PERCENT", direction: "LOWER" }, period: "agosto de 2026", official: { value: "14,6%", target: "10,0%", position: "fora da referência", quartile: "Q4", previous: "9,8%" }, triage: "investigar", population: { interactions: 48, reasons: [{ label: "Contestação de cobrança", interactions: 14, signaled: 5 }] }, signal: { label: "rechamada", signaled: 7, previousSignaled: 3 } } })
    expect(turn).toContain(RECALL_V1.investigation!.instructions)
    expect(turn).toContain("PROCESS_ASSESSMENT")
    expect(turn).toContain("INDISPONÍVEL: os dados de interação não trazem vínculo com o atendimento anterior")
    expect(turn).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/)
  })
})

describe("V2 — população sinalizada (números do sistema; composição, nunca causa)", () => {
  const rows = [
    { key: "contestacao", label: "Contestação de cobrança", interactions: 14, signaled: 5 },
    { key: "segunda_via", label: "Segunda via", interactions: 20, signaled: 1 },
    { key: "plano", label: "Informação sobre plano", interactions: 14, signaled: 1 },
  ]
  it("concentração exige volume de sinal, parte ≥ 50% E taxa no motivo ≥ 1,5× a dos demais", () => {
    const distribution = signalDistributionOf(rows, "rechamada")
    expect(distribution).toMatchObject({ status: "CONCENTRATED", interactions: 48, signaled: 7, signalRatePercent: 14.6, concentration: { key: "contestacao", signaled: 5, shareOfSignalPercent: 71.4, signalRatePercent: 35.7, othersSignalRatePercent: 5.9 } })
  })
  it("motivo grande com a mesma taxa dos demais NÃO concentra (é volume); poucas marcadas = sem base para distribuição", () => {
    expect(signalDistributionOf([{ key: "a", label: "A", interactions: 40, signaled: 4 }, { key: "b", label: "B", interactions: 10, signaled: 1 }, { key: "c", label: "C", interactions: 10, signaled: 1 }], "rechamada").status).toBe("SPREAD")
    expect(signalDistributionOf([{ key: "a", label: "A", interactions: 10, signaled: 3 }], "rechamada").status).toBe("INSUFFICIENT_DATA")
    expect(signalDistributionOf([{ key: "a", label: "A", interactions: 10, signaled: 0 }], "rechamada").status).toBe("NO_SIGNAL")
  })
  it("evolução: composição das marcadas × período anterior, só com base mínima nos dois períodos", () => {
    const previous = [{ key: "contestacao", label: "Contestação de cobrança", interactions: 12, signaled: 1 }, { key: "segunda_via", label: "Segunda via", interactions: 22, signaled: 2 }, { key: "plano", label: "Informação sobre plano", interactions: 10, signaled: 1 }]
    const evolution = signalEvolutionOf(rows, previous)
    expect(evolution.status).toBe("AVAILABLE")
    expect(evolution.shifted).toMatchObject({ key: "contestacao", previousSharePercent: 25, currentSharePercent: 71.4 })
    expect(signalEvolutionOf(rows, previous.slice(0, 1)).status).toBe("INSUFFICIENT_DATA")
  })
})

function recallInvestigation(overrides: Partial<InvestigationInput> = {}) {
  const closing = closingOf(RECALL)
  const triage = triageIndicator(RECALL, closing.previous!.indicators[0]!, { versionId: "recall-v1", version: 1, closingTriage: RECALL_V1.closingTriage })
  const current = [{ key: "contestacao", label: "Contestação de cobrança", interactions: 14, signaled: 5 }, { key: "segunda_via", label: "Segunda via", interactions: 20, signaled: 1 }, { key: "plano", label: "Informação sobre plano", interactions: 14, signaled: 1 }]
  const previous = [{ key: "contestacao", label: "Contestação de cobrança", interactions: 12, signaled: 1 }, { key: "segunda_via", label: "Segunda via", interactions: 22, signaled: 2 }, { key: "plano", label: "Informação sobre plano", interactions: 10, signaled: 1 }]
  const availability = stepAvailabilityOf({ decomposable: true, segmentationEnabled: true, processEnabled: true, processPopulation: "LINKED_PREVIOUS_OF_SIGNAL", signalConfigured: true, signalFlagValid: true, linkedInteractionsSupported: false })
  const steps = selectInvestigationSteps({ mode: "AGENT_SELECTED", allowed: RECALL_V1.investigation!.allowedSteps, fixed: [], availability, choice: [{ step: "SIGNAL_DISTRIBUTION", purpose: "onde" }, { step: "SIGNAL_EVOLUTION", purpose: "quando" }], planner: { status: "SELECTED", agentRunId: "run", attempts: 1, error: null } })
  const input: InvestigationInput = {
    closing,
    triage,
    strategy: { versionId: "recall-v1", version: 1 },
    snapshot: { indicatorId: RECALL.indicatorId, indicatorCode: RECALL.indicatorCode, indicatorName: RECALL.indicatorName, unit: RECALL.unit, direction: RECALL.direction, snapshotId: RECALL.snapshotId },
    window: { startDate: "2026-08-01", endDate: "2026-09-01", timeZone: "America/Sao_Paulo" },
    metric: "INTERACTION_SIGNAL_RATE",
    interactionsInPeriod: 48,
    segments: [],
    selectedSegment: { key: "contestacao", label: "Contestação de cobrança", reason: "motivo em que as interações sinalizadas se concentram" },
    overallAverageDurationSeconds: null,
    sample: { eligibleCount: 0, reusableCount: 0, incompatibleCount: 0, unobservedCount: 0, selectedForAssessment: 0, analyzedCount: 0, reusedObservationCount: 0, reanalyzedInteractionCount: 0, newObservationCount: 0, selectionReason: "", sampling: null, discarded: [] },
    minimumAnalyzed: 3,
    mix: null,
    patterns: null,
    team: { status: "NOT_AVAILABLE", contributors: 0, observedInteractions: 0, behaviors: [] },
    planStatus: "EVIDENCE_SOURCE_UNAVAILABLE",
    steps,
    signal: { flagName: "rechamada", distribution: signalDistributionOf(current, "rechamada"), evolution: signalEvolutionOf(current, previous) },
    ...overrides,
  }
  return buildIndicatorInvestigation(input)
}

describe("V2 — Rechamada V1: conclusão pela evidência disponível", () => {
  it("rechamada sem vínculo com o atendimento anterior: composição (mudança do sinal) sem nenhum padrão comportamental — nada de crítica individual", () => {
    const investigation = recallInvestigation()
    expect(investigation.conclusion).toMatchObject({ type: "MIX_SHIFT", developmentPatterns: [], strengthPatterns: [], signalShift: true })
    expect(investigation.evidenceGap).toEqual({ step: "PROCESS_ASSESSMENT", reason: "DATA_CONTRACT_NO_INTERACTION_LINK" })
    expect(investigation.supportedFindings).toEqual(expect.arrayContaining([
      "Em agosto de 2026, 7 de 48 interações atendidas vieram marcadas como rechamada (14,6%).",
      "Contestação de cobrança reuniu 5 das 7 interações marcadas como rechamada (71,4%); nesse motivo, 5 de 14 interações vieram marcadas (35,7%), contra 5,9% nos demais motivos.",
    ]))
    expect(investigation.unsupportedHypotheses.join(" ")).toContain("o vínculo com o atendimento anterior não existe nos dados")
    expect(investigation.limitations.join(" ")).toContain("não informam qual atendimento anterior originou cada uma")
  })
  it("sem mudança de composição: INSUFFICIENT_EVIDENCE (a evidência comportamental pedida não existe nos dados) — nunca um vínculo inventado", () => {
    const investigation = recallInvestigation({ steps: { ...recallInvestigation().steps!, selected: ["SIGNAL_DISTRIBUTION"] } })
    expect(investigation.conclusion.type).toBe("INSUFFICIENT_EVIDENCE")
    expect(investigation.supportedFindings.some((finding) => finding.includes("passou de"))).toBe(false)
  })
  it("passo não escolhido pela IA não entra no diagnóstico (a escolha tem efeito)", () => {
    const investigation = recallInvestigation({ steps: { ...recallInvestigation().steps!, selected: [] } })
    expect(investigation.supportedFindings.filter((finding) => finding.includes("marcadas"))).toEqual([])
  })
})

describe("V2 — idempotência do diagnóstico direto", () => {
  const base = { organizationId: "org", personId: "person", referencePeriod: "2026-08", indicatorCode: "RECHAMADA", strategyVersionId: "recall-v1", snapshot: { snapshotId: "snap", value: 14.6, target: 10, achievementPercent: 68.5, quartile: "Q4" } }
  it("mesma fonte + mesma versão = mesma chave; outra versão publicada ou valor oficial corrigido = outra chave; nunca colide com a do PRV", () => {
    const key = directDiagnosisIdempotencyKey(base)
    expect(key).toMatch(new RegExp(`^${DIRECT_DIAGNOSIS_LOGIC_VERSION}:2026-08:`))
    expect(directDiagnosisIdempotencyKey({ ...base })).toBe(key)
    expect(directDiagnosisIdempotencyKey({ ...base, strategyVersionId: "recall-v2" })).not.toBe(key)
    expect(directDiagnosisIdempotencyKey({ ...base, snapshot: { ...base.snapshot, value: 13.9 } })).not.toBe(key)
    expect(prvDiagnosisIdempotencyKey({ organizationId: "org", personId: "person", referencePeriod: "2026-08", strategies: [{ indicatorCode: "RECHAMADA", strategyVersionId: "recall-v1" }] })).not.toBe(key)
  })
  it("o artefato registra a origem direta, a versão lógica e a versão da estratégia de cada investigação", () => {
    const investigation = recallInvestigation()
    const closing = closingOf(RECALL)
    const diagnosis = buildPrvClosingDiagnosis({ closing, triage: { version: "CLOSING_TRIAGE_V1", referencePeriod: "2026-08", decisions: [investigation.triage] }, investigations: [investigation], idempotencyKey: directDiagnosisIdempotencyKey(base), generatedAt: "2026-09-29T12:00:00Z", source: { kind: "DIRECT_INDICATOR", indicatorCode: "RECHAMADA" } })
    expect(diagnosis).toMatchObject({ version: DIRECT_DIAGNOSIS_LOGIC_VERSION, source: { kind: "DIRECT_INDICATOR", indicatorCode: "RECHAMADA", periodLabel: "agosto de 2026" }, prv: null })
    expect(diagnosis.investigations[0]!.strategy).toEqual({ versionId: "recall-v1", version: 1 })
  })
})

describe("V2 — núcleo genérico: nenhum branch por código de indicador", () => {
  const root = join(fileURLToPath(new URL(".", import.meta.url)), "../..")
  const CORE = [
    "indicator-diagnosis/domain",
    "indicator-diagnosis/application",
    "reliable-feedback/application/prv-closing-step.ts",
    "reliable-feedback/application/generate-prv-closing-feedback.ts",
    "reliable-feedback/domain/prv-closing-items.ts",
    "reliable-feedback/domain/prv-closing-views.ts",
    "workflows/application/prv-closing-agent-action.ts",
  ]
  const files = CORE.flatMap((entry) => {
    const path = join(root, entry)
    return statSync(path).isDirectory() ? readdirSync(path).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts")).map((name) => join(path, name)) : [path]
  })
  const code = (path: string) => readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
  it("o motor (plano, passos, agregação, conclusão, itens, projeções, nó do Workflow) não compara nem lista códigos de indicador", () => {
    expect(files.length).toBeGreaterThan(10)
    for (const path of files) {
      const source = code(path)
      expect(source, path).not.toMatch(/["'`](?:TMA|RECHAMADA|REINCIDENCIA_7D|NOTA_URA|ADERENCIA|TDNA|FCR|TMT)["'`]/)
      expect(source, path).not.toMatch(/indicatorCode\s*===\s*["'`]/)
    }
  })
})
