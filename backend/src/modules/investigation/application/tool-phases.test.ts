import { describe, expect, it } from "vitest"
import { toolsForCapabilities } from "../domain/tool-catalog.js"
import type { LedgerEntry } from "../domain/evidence-ledger.js"
import { pruneToolsForRound } from "./tool-phases.js"

const all = toolsForCapabilities(["INDICATOR_ANALYSIS", "SEGMENTATION", "OPERATIONAL_COMPARISON", "INTERACTION_ANALYSIS", "WORK_CONTEXT", "KNOWLEDGE", "SUPPORT_MATERIALS"])
const subject = { operatorId: "op", operatorName: "X", teamId: null, teamName: null, subteamId: null, subteamName: null, interactionId: null, indicatorCode: "TMA" }
const fact = (tool: string, qualityStatus = "SUFFICIENT"): LedgerEntry => ({ ref: "F1", sequence: 1, round: 1, tool, capability: "x", keyArgs: "", summary: "", qualityStatus, qualityNote: null, sampleCount: null, periodLabel: null, preflight: false })
const names = (result: { declared: { key: string }[] }) => result.declared.map((tool) => tool.key)

describe("tool schema pruning por rodada", () => {
  it("sem preflight e sem ledger (ex.: chat sem indicador): tudo que não depende de pré-requisito é declarado; síntese/materiais nunca", () => {
    const result = pruneToolsForRound(all, { subject: { ...subject, indicatorCode: null }, ledger: [], preflight: { indicatorPreflighted: false, interactionsInPeriod: null, availableDimensions: null } })
    expect(names(result)).toEqual(["get_indicator_snapshot", "compare_periods", "get_available_dimensions", "segment_indicator", "compare_population", "inspect_indicator_composition", "validate_data_quality", "detect_anomalies", "get_employee_history", "find_interactions", "get_interaction_flags", "inspect_work_context", "query_knowledge"])
    expect(result.pruned.map((item) => item.tool)).toEqual(["get_interaction_context", "find_comparable_interactions", "analyze_interactions", "analyze_peer_patterns", "recommend_support_materials", "synthesize_evidence"])
  })

  it("após o preflight do indicador: snapshot/qualidade/dimensões saem; sem dimensão disponível, segment_indicator sai", () => {
    const result = pruneToolsForRound(all, { subject, ledger: [], preflight: { indicatorPreflighted: true, interactionsInPeriod: 5, availableDimensions: [] } })
    expect(names(result)).not.toContain("get_indicator_snapshot")
    expect(names(result)).not.toContain("validate_data_quality")
    expect(names(result)).not.toContain("get_available_dimensions")
    expect(names(result)).not.toContain("segment_indicator")
    expect(names(result)).toContain("compare_periods")
  })

  it("sem interações no período: nenhuma Tool de interação (exceto contexto da interação em foco)", () => {
    const none = pruneToolsForRound(all, { subject, ledger: [], preflight: { indicatorPreflighted: true, interactionsInPeriod: 0, availableDimensions: ["DAY"] } })
    expect(names(none).filter((key) => ["find_interactions", "get_interaction_flags", "analyze_interactions", "analyze_peer_patterns", "find_comparable_interactions", "get_interaction_context"].includes(key))).toEqual([])
    const focus = pruneToolsForRound(all, { subject: { ...subject, interactionId: "i1" }, ledger: [], preflight: { indicatorPreflighted: false, interactionsInPeriod: 0, availableDimensions: null } })
    expect(names(focus)).toContain("get_interaction_context")
    expect(names(focus)).toContain("analyze_interactions")
  })

  it("pré-requisitos progressivos: analyze_interactions/get_interaction_context após ids conhecidos; peer/comparáveis após assunto conhecido; NO_DATA não conta", () => {
    const base = { subject, preflight: { indicatorPreflighted: true, interactionsInPeriod: 5, availableDimensions: ["SUBJECT"] } }
    expect(names(pruneToolsForRound(all, { ...base, ledger: [fact("find_interactions", "NO_DATA")] }))).not.toContain("analyze_interactions")
    const afterFind = names(pruneToolsForRound(all, { ...base, ledger: [fact("find_interactions")] }))
    expect(afterFind).toEqual(expect.arrayContaining(["analyze_interactions", "get_interaction_context", "analyze_peer_patterns", "find_comparable_interactions"]))
    const afterSegment = names(pruneToolsForRound(all, { ...base, ledger: [fact("segment_indicator")] }))
    expect(afterSegment).toContain("find_comparable_interactions")
    expect(afterSegment).not.toContain("analyze_interactions")
  })

  it("nunca declara Tool fora das capacidades efetivas (a entrada já é o conjunto permitido)", () => {
    const onlyIndicator = toolsForCapabilities(["INDICATOR_ANALYSIS"])
    const result = pruneToolsForRound(onlyIndicator, { subject, ledger: [fact("find_interactions")], preflight: { indicatorPreflighted: false, interactionsInPeriod: 9, availableDimensions: null } })
    expect(names(result).some((key) => key.includes("interaction"))).toBe(false)
  })
})

describe("pruning V1.3 — Tools de período único já executadas saem das rodadas seguintes", () => {
  it("inspect_work_context executada no período padrão não volta a ser declarada; com outro período continua disponível", async () => {
    const { pruneToolsForRound } = await import("./tool-phases.js")
    const { toolsForCapabilities } = await import("../domain/tool-catalog.js")
    const tools = toolsForCapabilities(["WORK_CONTEXT", "INDICATOR_ANALYSIS"])
    const entry = (periodLabel: string) => ({ ref: "F1", sequence: 1, round: 1, tool: "inspect_work_context", capability: "WORK_CONTEXT", keyArgs: "", summary: "21 dias", qualityStatus: "SUFFICIENT", qualityNote: null, sampleCount: null, periodLabel, preflight: false })
    const state = { subject: { operatorId: "o", operatorName: null, teamId: null, teamName: null, subteamId: null, subteamName: null, interactionId: null, indicatorCode: "TMA" }, preflight: { indicatorPreflighted: false, interactionsInPeriod: null, availableDimensions: null }, defaultPeriodLabel: "agosto" }
    expect(pruneToolsForRound(tools, { ...state, ledger: [entry("agosto")] }).pruned).toContainEqual({ tool: "inspect_work_context", reason: "já executada no período padrão (resultado no ledger)" })
    expect(pruneToolsForRound(tools, { ...state, ledger: [entry("julho")] }).declared.map((tool) => tool.key)).toContain("inspect_work_context")
  })
})
