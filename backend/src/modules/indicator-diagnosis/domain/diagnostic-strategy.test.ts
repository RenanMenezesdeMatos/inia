import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { diagnosticStrategyConfigSchema, emptyStrategyConfig, runtimeParametersOf, strategyCapabilities, validateStrategyForPublish, type DiagnosticStrategyConfig } from "./diagnostic-strategy.js"

const DOMAIN = "11111111-1111-4111-8111-111111111111"
const full = (overrides: Partial<DiagnosticStrategyConfig> = {}): DiagnosticStrategyConfig => ({
  ...emptyStrategyConfig(),
  segmentation: { enabled: true, dimensions: ["SUBJECT"], minimumSegmentInteractions: 3 },
  interactionInvestigation: { enabled: true, maxInteractions: 5, minimumAnalyzed: 3, minimumCoveragePercent: null },
  processAssessment: { enabled: true },
  peerComparison: { enabled: true, minimumPopulation: 4, minimumContributors: 4, minimumObservedInteractions: 5 },
  ...overrides,
})
const codes = (config: DiagnosticStrategyConfig, unit = "SECONDS", domains: { id: string; active: boolean; exists: boolean }[] = []) => validateStrategyForPublish(config, { indicatorUnit: unit, domains }).map((issue) => issue.code)

describe("V1.6.2 — catálogo de capacidades (só o que o runtime realmente faz)", () => {
  it("P) indicador em segundos/contagem: só a dimensão MOTIVO; nada de produto, processo, canal ou flag", () => {
    const seconds = strategyCapabilities({ unit: "SECONDS" })
    expect(seconds.indicator).toEqual({ decomposable: true, metric: "INTERACTION_DURATION_SECONDS" })
    expect(seconds.dimensions.map((dimension) => dimension.code)).toEqual(["SUBJECT"])
    expect(seconds.configurableSources.map((source) => source.code)).toEqual(["INTERACTIONS", "PROCESS_ASSESSMENT", "KNOWLEDGE", "PEER_COMPARISON"])
    expect(seconds.configurableSources.find((source) => source.code === "KNOWLEDGE")!.lockedOnWith).toBe("PROCESS_ASSESSMENT")
    expect(strategyCapabilities({ unit: "COUNT" }).indicator.metric).toBe("INTERACTION_COUNT")
    expect(JSON.stringify(seconds)).not.toMatch(/PRODUCT|CHANNEL|FLAG|HISTORY/)
  })
  it("P) indicador não decomponível (ex.: percentual): nenhuma dimensão nem fonte configurável — não finge suporte", () => {
    const percent = strategyCapabilities({ unit: "PERCENT" })
    expect(percent).toMatchObject({ indicator: { decomposable: false, metric: null }, dimensions: [], configurableSources: [] })
    expect(percent.mandatorySources.length).toBeGreaterThan(0)
  })
  it("não existe campo para causa, 'sempre orientar', 'sempre elogiar' ou para desligar guardrails; seleção é sempre determinística", () => {
    expect(diagnosticStrategyConfigSchema.safeParse({ ...full(), allowCausalClaims: true }).success).toBe(false)
    expect(diagnosticStrategyConfigSchema.safeParse({ ...full(), noDiagnosisBehavior: "GENERIC_SUGGESTION" }).success).toBe(false)
    expect(diagnosticStrategyConfigSchema.safeParse({ ...full(), segmentation: { ...full().segmentation, dimensions: ["PRODUCT"] } }).success).toBe(false)
    expect(strategyCapabilities({ unit: "SECONDS" }).sampling.selection).toBe("DETERMINISTIC")
    expect(strategyCapabilities({ unit: "SECONDS" }).noDiagnosisBehaviors.map((behavior) => behavior.code)).toEqual(["FACTUAL_ONLY", "HOLD_FOR_QA", "NO_FEEDBACK"])
  })
})

describe("V1.6.2 — validação para publicar (combinação impossível falha aqui, nunca em runtime)", () => {
  it("configuração completa válida; tudo desligado também é válido (o indicador fica só no fato)", () => {
    expect(codes(full())).toEqual([])
    expect(codes(emptyStrategyConfig(), "PERCENT")).toEqual([])
  })
  it("G) processos sem atendimentos, atendimentos sem processos ou sem segmentação, pares sem processos → rejeitado", () => {
    expect(codes(full({ interactionInvestigation: { ...full().interactionInvestigation, enabled: false } }))).toContain("STRATEGY_PROCESS_WITHOUT_INTERACTIONS")
    expect(codes(full({ processAssessment: { enabled: false }, peerComparison: { ...full().peerComparison, enabled: false } }))).toContain("STRATEGY_INTERACTIONS_WITHOUT_ANALYSIS")
    expect(codes(full({ segmentation: { ...full().segmentation, enabled: false } }))).toContain("STRATEGY_REQUIRES_SEGMENTATION")
    expect(codes(full({ processAssessment: { enabled: false }, interactionInvestigation: { ...full().interactionInvestigation, enabled: false } }))).toContain("STRATEGY_PEER_WITHOUT_PROCESS")
  })
  it("capacidade inexistente para o indicador (segmentar percentual) e dimensão vazia → rejeitado", () => {
    expect(codes(full(), "PERCENT")).toContain("STRATEGY_CAPABILITY_UNAVAILABLE")
    expect(codes(full({ segmentation: { enabled: true, dimensions: [], minimumSegmentInteractions: 3 } }))).toContain("STRATEGY_DIMENSION_REQUIRED")
  })
  it("H) pisos do produto: pode exigir MAIS, nunca menos (privacidade de pares, amostra, cobertura)", () => {
    expect(codes(full({ peerComparison: { ...full().peerComparison, minimumPopulation: 3 } }))).toContain("STRATEGY_BELOW_PRODUCT_MINIMUM")
    expect(codes(full({ peerComparison: { ...full().peerComparison, minimumContributors: 3 } }))).toContain("STRATEGY_BELOW_PRODUCT_MINIMUM")
    expect(codes(full({ peerComparison: { ...full().peerComparison, minimumObservedInteractions: 4 } }))).toContain("STRATEGY_BELOW_PRODUCT_MINIMUM")
    expect(codes(full({ peerComparison: { enabled: true, minimumPopulation: 6, minimumContributors: 5, minimumObservedInteractions: 10 } }))).toEqual([])
    expect(codes(full({ interactionInvestigation: { ...full().interactionInvestigation, minimumAnalyzed: 2 } }))).toContain("STRATEGY_BELOW_PRODUCT_MINIMUM")
    expect(codes(full({ interactionInvestigation: { ...full().interactionInvestigation, maxInteractions: 4, minimumAnalyzed: 5 } }))).toContain("STRATEGY_LIMIT_OUT_OF_RANGE")
    expect(codes(full({ interactionInvestigation: { ...full().interactionInvestigation, maxInteractions: 11 } }))).toContain("STRATEGY_LIMIT_OUT_OF_RANGE")
    expect(codes(full({ interactionInvestigation: { ...full().interactionInvestigation, minimumCoveragePercent: 0 } }))).toContain("STRATEGY_LIMIT_OUT_OF_RANGE")
    expect(codes(full({ segmentation: { ...full().segmentation, minimumSegmentInteractions: 2 } }))).toContain("STRATEGY_LIMIT_OUT_OF_RANGE")
  })
  it("domínio inexistente, inativo ou repetido → rejeitado", () => {
    expect(codes(full({ allowedBusinessDomainIds: [DOMAIN] }), "SECONDS", [{ id: DOMAIN, active: false, exists: true }])).toContain("BUSINESS_DOMAIN_INACTIVE")
    expect(codes(full({ allowedBusinessDomainIds: [DOMAIN] }), "SECONDS", [{ id: DOMAIN, active: false, exists: false }])).toContain("BUSINESS_DOMAIN_NOT_FOUND")
    expect(codes(full({ allowedBusinessDomainIds: [DOMAIN, DOMAIN] }), "SECONDS", [{ id: DOMAIN, active: true, exists: true }])).toContain("STRATEGY_DOMAIN_DUPLICATED")
  })
})

describe("V1.6.2 — tradução única para o runtime", () => {
  it("sem estratégia → não configurado (o diagnóstico não roda); com estratégia → parâmetros da versão, pisos reaplicados", () => {
    expect(runtimeParametersOf(null)).toMatchObject({ configured: false, strategyVersionId: null, segmentation: { enabled: false }, sample: { enabled: false }, peer: { enabled: false }, noDiagnosisBehavior: "FACTUAL_ONLY" })
    const parameters = runtimeParametersOf({ id: "v1", version: 1, config: full({ interactionInvestigation: { enabled: true, maxInteractions: 8, minimumAnalyzed: 1, minimumCoveragePercent: 25 }, peerComparison: { enabled: true, minimumPopulation: 2, minimumContributors: 9, minimumObservedInteractions: 1 }, noDiagnosisBehavior: "HOLD_FOR_QA" }) })
    expect(parameters).toMatchObject({ configured: true, strategyVersionId: "v1", strategyVersion: 1, sample: { enabled: true, maxInteractions: 8, minimumAnalyzed: 3, minimumCoveragePercent: 25 }, peer: { minimumPopulation: 4, minimumContributors: 9, minimumObservedInteractions: 5 }, noDiagnosisBehavior: "HOLD_FOR_QA" })
  })
  it("J) duas estratégias diferentes para dois indicadores → parâmetros diferentes pela MESMA função (sem ramo por código)", () => {
    const tma = runtimeParametersOf({ id: "a", version: 1, config: full() })
    const other = runtimeParametersOf({ id: "b", version: 3, config: full({ peerComparison: { ...full().peerComparison, enabled: false }, interactionInvestigation: { enabled: true, maxInteractions: 10, minimumAnalyzed: 6, minimumCoveragePercent: null }, noDiagnosisBehavior: "NO_FEEDBACK" }) })
    expect([tma.peer.enabled, other.peer.enabled]).toEqual([true, false])
    expect([tma.sample.maxInteractions, other.sample.maxInteractions]).toEqual([5, 10])
    expect([tma.noDiagnosisBehavior, other.noDiagnosisBehavior]).toEqual(["FACTUAL_ONLY", "NO_FEEDBACK"])
  })
  it("K) nenhum código de indicador no runtime da estratégia (comportamento por metadado, nunca `if (code === ...)`)", () => {
    const root = resolve(__dirname, "..")
    const files: string[] = []
    const walk = (dir: string) => { for (const name of readdirSync(dir)) { const path = join(dir, name); if (statSync(path).isDirectory()) walk(path); else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) files.push(path) } }
    walk(root)
    for (const file of files) expect(readFileSync(file, "utf8"), file).not.toMatch(/["'`](?:TMA|NPS|FCR|NOTA_URA|MONITORIA_QUALIDADE|ATENDIMENTOS)["'`]/)
  })
})

describe("V1.0.1 — limite de revisões da avaliação (reparo único por chamada)", () => {
  const investigating = (maxRepairInteractions?: number): DiagnosticStrategyConfig => ({ ...emptyStrategyConfig(), segmentation: { enabled: true, dimensions: ["SUBJECT"], minimumSegmentInteractions: 3 }, interactionInvestigation: { enabled: true, maxInteractions: 10, minimumAnalyzed: 3, minimumCoveragePercent: null, ...(maxRepairInteractions === undefined ? {} : { maxRepairInteractions }) }, processAssessment: { enabled: true } })
  const strategy = (config: DiagnosticStrategyConfig) => ({ id: "00000000-0000-4000-8000-00000000000a", version: 1, config })
  it("versão anterior sem o campo = até o tamanho da amostra; configurado = o valor, nunca acima da amostra", () => {
    expect(runtimeParametersOf(strategy(investigating())).sample.maxRepairInteractions).toBe(10)
    expect(runtimeParametersOf(strategy(investigating(4))).sample.maxRepairInteractions).toBe(4)
    expect(runtimeParametersOf(strategy({ ...investigating(10), interactionInvestigation: { ...investigating(10).interactionInvestigation, maxInteractions: 5 } })).sample.maxRepairInteractions).toBe(5)
    expect(runtimeParametersOf(strategy(investigating(0))).sample.maxRepairInteractions).toBe(0)
    expect(diagnosticStrategyConfigSchema.safeParse(investigating()).success).toBe(true)
  })
  it("fora da faixa não publica", () => {
    const issues = validateStrategyForPublish(investigating(11), { indicatorUnit: "SECONDS", domains: [] })
    expect(issues.map((issue) => issue.field)).toContain("interactionInvestigation.maxRepairInteractions")
  })
})
