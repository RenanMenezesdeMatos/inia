import { describe, expect, it } from "vitest"
import "../testing/no-external-ai.js"
import type { InvestigationCapability } from "../../investigation/domain/capabilities.js"
import { fakeEngineModel } from "../testing/fake-engine-model.js"
import { catalogRunner, investigationOf, ok, request, setup } from "../testing/investigation-world.js"
import { investigateIndicator } from "./investigate-indicator.js"

/**
 * CONFIGURAÇÃO DAS FERRAMENTAS ≠ INTEGRAÇÃO IMPLEMENTADA — zero IA, nenhum dado real.
 *
 * Estado real em 01/10 (lido do banco dev, somente leitura): o "Especialista de Faturamento" (o Agent dos Workflows de fechamento
 * da Larissa) tem `investigation_capabilities = {}`; a estratégia publicada do TMA (v3) liga segmentação por ASSUNTO, avaliação de
 * até 10 chamadas (mínimo 3) e avaliação de processos, e DESLIGA a comparação com pares; não declara modo de investigação. Com a
 * lista vazia, o planejador de ferramentas NÃO roda para indicador — só o plano do contrato da estratégia. Isto é configuração, não
 * defeito da integração: os testes abaixo usam uma CÓPIA isolada dessa configuração e mostram o que muda com o mínimo necessário.
 * Nenhum Agent compartilhado é alterado e nenhum Workflow é disparado.
 */
const TMA_V3 = {
  id: "s-tma-v3-copy",
  version: 3,
  config: {
    segmentation: { enabled: true, dimensions: ["SUBJECT" as const], minimumSegmentInteractions: 3 },
    interactionInvestigation: { enabled: true, maxInteractions: 10, minimumAnalyzed: 3, minimumCoveragePercent: null },
    processAssessment: { enabled: true },
    allowedBusinessDomainIds: [],
    peerComparison: { enabled: false, minimumPopulation: 4, minimumContributors: 4, minimumObservedInteractions: 5 },
    noDiagnosisBehavior: "FACTUAL_ONLY" as const,
  },
} as never
const REAL_AGENT_CAPABILITIES: InvestigationCapability[] = []
/** Mínimo para o planejador investigar um indicador com chamadas: fatos do indicador (anomalias abrem recortes de dia) + chamadas. */
const MINIMUM_FOR_INDICATOR: InvestigationCapability[] = ["INDICATOR_ANALYSIS", "INTERACTION_ANALYSIS"]
const tools = { detect_anomalies: () => ok({ anomalies: [] }), get_interaction_flags: () => ok({ interactions: [] }), segment_indicator: () => ok({ dimension: "SUBJECT", buckets: [] }), compare_population: () => ok({ performance: "WORSE_THAN_REFERENCE" }) }
const stopAtOnce = () => fakeEngineModel({ planner: () => ({ calls: [], stop: { reason: "NO_USEFUL_TOOL", note: "teste de configuração" } }) })

async function run(capabilities: InvestigationCapability[]) {
  const runner = catalogRunner(tools)
  const model = stopAtOnce()
  const { investigate, memory } = setup({ model: model.model, tools: runner.runner, agentCapabilities: capabilities, strategy: TMA_V3, subjects: "STABLE" })
  const investigation = await investigationOf(memory, (await investigateIndicator(investigate, request())).investigations[0]!.runId)
  return { investigation, plannerCalls: model.calls.filter((call) => call.stage === "INVESTIGATION_PLANNING").length, available: investigation.tools!.availability.filter((entry) => entry.available).map((entry) => entry.tool), reasons: new Map(investigation.tools!.availability.map((entry) => [entry.tool, entry.reason])) }
}

describe("configuração REAL (cópia isolada): especialista sem capacidades + TMA v3", () => {
  it("nenhuma ferramenta e nenhum planejador; só o plano do contrato (localizar por assunto e analisar a amostra); pares desligados", async () => {
    const real = await run(REAL_AGENT_CAPABILITIES)
    expect(real.investigation.tools!.capabilities).toMatchObject({ capabilities: [], source: "NONE_CONFIGURED" })
    expect(real.available).toEqual([])
    expect(real.plannerCalls).toBe(0)
    expect(real.investigation.tools!).toMatchObject({ plan: "CONTRACT", planReason: "NO_INVESTIGATION_CAPABILITIES" })
    expect(real.investigation.tools!.contract).toMatchObject({ localization: { allowed: true }, callAnalysis: { allowed: true }, reference: { allowed: false, reason: "comparação com pares desligada na estratégia" } })
  })
})

describe("configuração mínima para o planejador investigar o indicador (só documentada — não aplicada ao Agent real)", () => {
  it("INDICATOR_ANALYSIS + INTERACTION_ANALYSIS: o planejador roda; anomalias diárias, sinais e análise de chamadas ficam disponíveis; pares continuam fora pela estratégia", async () => {
    const minimum = await run(MINIMUM_FOR_INDICATOR)
    expect(minimum.plannerCalls).toBeGreaterThan(0)
    expect(minimum.available).toEqual(expect.arrayContaining(["detect_anomalies", "get_indicator_snapshot", "find_interactions", "get_interaction_flags", "read_call_memory", "analyze_calls"]))
    // Segmentação é capacidade própria: sem ela o planejador não segmenta (a localização por assunto do CONTRATO continua).
    expect(minimum.reasons.get("segment_indicator")).toBe("capacidade SEGMENTATION não permitida nesta execução")
    expect(minimum.investigation.tools!.contract!.localization.allowed).toBe(true)
    // Comparação: nem a capacidade foi dada nem a estratégia permite — a estratégia nunca concede, a capacidade sozinha não basta.
    expect(minimum.available).not.toContain("compare_population")
    expect(minimum.available).not.toContain("reference_practices")
  })

  it("com SEGMENTATION a segmentação entra, limitada às dimensões da estratégia; com OPERATIONAL_COMPARISON os pares continuam fora (estratégia desligou)", async () => {
    const wider = await run([...MINIMUM_FOR_INDICATOR, "SEGMENTATION", "OPERATIONAL_COMPARISON"])
    expect(wider.available).toContain("segment_indicator")
    expect(wider.reasons.get("compare_population")).toBe("comparação com pares desligada na estratégia")
    expect(wider.reasons.get("reference_practices")).toBe("comparação com pares desligada na estratégia")
  })
})
