import { describe, expect, it } from "vitest"
import "../testing/no-external-ai.js"
import { investigationOf, request, setup, strategyWith } from "../testing/investigation-world.js"
import { investigateIndicator } from "./investigate-indicator.js"
import type { CallAnalysisPersist } from "./ports.js"

/**
 * `CURRENT_RULES_AFTER_ANALYSIS_V1` (06/10/2026) — zero IA. As análises de chamada que a PRÓPRIA investigação faz organizam práticas
 * novas (`PRACTICE_IDENTITY_V1`). As regras em vigor eram lidas no início da investigação, antes dessas práticas existirem: o padrão
 * agregado por elas parecia "regra que mudou na base" e era descartado (Reincidência da Larissa, dev: recapitulação ausente em 3 de 4
 * retornos → conclusão "sem causa"). Agora as regras em vigor são lidas depois das análises.
 */
describe("regras em vigor lidas depois das análises da execução", () => {
  it("prática organizada durante a investigação continua EM VIGOR no padrão (nunca 'mudou na base')", async () => {
    const world = setup({ subjects: "LOCATED", strategy: strategyWith({ segmentation: true, sample: true }) })
    const memory = world.investigate.memory
    const complete = memory.completeCallAnalysis.bind(memory)
    let organized = 0
    // Simula a organização de práticas que acontece ao fim de cada análise de chamada (produção: `organizePracticesOfAnalysis`).
    memory.completeCallAnalysis = async (organizationId: string, runId: string, data: CallAnalysisPersist, now: Date) => {
      const result = await complete(organizationId, runId, data, now)
      const lines = data.analysis.criteria.map((criterion) => criterion.lineKey.split("#")[0]!)
      const fresh = [...new Set(lines)]
      await memory.savePracticeAssignments(organizationId, {
        practices: fresh.map((lineKey) => ({ practiceKey: `KP-${lineKey}`, title: `Prática ${lineKey}` })),
        members: fresh.map((lineKey) => ({ line: { lineKey, sourceTitle: "Procedimento", heading: "", text: lineKey }, practiceKey: `KP-${lineKey}`, basis: "NEW_PRACTICE" as const })),
        unassigned: [],
      } as never, { identityVersion: "PRACTICE_IDENTITY_V1", model: "fake" }, now)
      organized += fresh.length
      return result
    }
    const result = await investigateIndicator(world.investigate, request())
    const investigation = await investigationOf(memory, result.investigations[0]!.runId)
    expect(organized).toBeGreaterThan(0)
    const practicePatterns = investigation.evidence.flatMap((entry) => entry.patterns).filter((pattern) => pattern.criterionKey.startsWith("KP-"))
    expect(practicePatterns.length).toBeGreaterThan(0)
    expect(practicePatterns.map((pattern) => pattern.currentRule)).toEqual(practicePatterns.map(() => "IN_FORCE"))
  })
})
