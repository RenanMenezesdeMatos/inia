import { z } from "zod"

/**
 * Indicator Diagnosis V1 — VISÃO TÉCNICA do diagnóstico do fechamento do PRV (projeção para a LIDERANÇA da mesma verdade
 * diagnóstica que gera o feedback do colaborador). Só chega na leitura de quem lidera (nunca na do próprio colaborador): população,
 * mix, amostra e reuso, padrões com denominadores, distribuição por dia, agregado do Subgrupo, processos, evidências, interpretação
 * e limitações. Tudo pronto do backend — a tela não calcula nada.
 */
const patternSchema = z.object({
  title: z.string(),
  classification: z.string(),
  attribution: z.string(),
  eligible: z.number(),
  followed: z.number(),
  notFollowed: z.number(),
  partial: z.number(),
  notObservable: z.number(),
  notApplicable: z.number(),
  ineligible: z.number(),
  notFollowedRatePercent: z.number().nullable(),
  concentration: z.string().nullable(),
  byWeekday: z.array(z.object({ label: z.string(), eligible: z.number(), notFollowed: z.number() })),
})

/** Indicator Diagnosis V2 — passos escolhidos (estratégia × IA × disponibilidade) e população sinalizada (flag da estratégia). */
const stepsSchema = z.object({
  mode: z.string(),
  planner: z.string(),
  selected: z.array(z.object({ label: z.string(), purpose: z.string().nullable() })),
  notSelected: z.array(z.string()),
  unavailable: z.array(z.object({ label: z.string(), reason: z.string() })),
  rejected: z.array(z.object({ step: z.string(), reason: z.string() })),
})
const signalSchema = z.object({
  label: z.string(),
  status: z.string(),
  interactions: z.number(),
  signaled: z.number(),
  signalRatePercent: z.number().nullable(),
  concentration: z.string().nullable(),
  reasons: z.array(z.object({ label: z.string(), interactions: z.number(), signaled: z.number(), signalRatePercent: z.number().nullable(), shareOfSignalPercent: z.number().nullable() })),
  evolution: z.object({ status: z.string(), previous: z.object({ interactions: z.number(), signaled: z.number(), signalRatePercent: z.number().nullable() }), shifted: z.string().nullable() }).nullable(),
})

export const prvSupervisorViewSchema = z.object({
  version: z.literal("PRV_SUPERVISOR_VIEW_V1"),
  /** V2 — origem do diagnóstico (ausente = fechamento do PRV). */
  source: z.object({ kind: z.enum(["PRV_CLOSING", "DIRECT_INDICATOR"]), label: z.string() }).optional(),
  cycle: z.string(),
  prv: z.object({ achievementPercent: z.number(), quartile: z.string(), previous: z.object({ achievementPercent: z.number(), quartile: z.string() }).nullable() }).nullable(),
  interpretation: z.array(z.string()),
  triage: z.array(z.object({ indicator: z.string(), decision: z.string(), reasons: z.array(z.string()) })),
  indicators: z.array(z.object({
    name: z.string(),
    conclusion: z.string(),
    official: z.array(z.string()),
    population: z.object({ interactionsInPeriod: z.number(), selectedSegment: z.string().nullable(), selectionReason: z.string().nullable(), segments: z.array(z.object({ label: z.string(), interactions: z.number(), sharePercent: z.number(), averageDurationSeconds: z.number().nullable() })) }),
    sample: z.object({ eligible: z.number(), analyzed: z.number(), reused: z.number(), reanalyzed: z.number(), newObservations: z.number(), reusedObservations: z.number(), selectionReason: z.string() }),
    /** V1.0.1 — cobertura da avaliação (primeira resposta × revisão única por chamada). Ausente/null em diagnósticos anteriores. */
    coverage: z.object({
      status: z.string(),
      interactionCount: z.number(),
      mustAssessPlanned: z.number(),
      missingInitial: z.number(),
      inconsistentInitial: z.number(),
      repairInteractions: z.number(),
      repairTargets: z.number(),
      missingAfterRepair: z.number(),
      inconsistentAfterRepair: z.number(),
      budgetSkipped: z.number(),
      interactions: z.array(z.object({ planned: z.number(), returned: z.number(), missingInitial: z.number(), inconsistentInitial: z.number(), repaired: z.boolean(), accepted: z.number(), missingAfter: z.number(), inconsistentAfter: z.number(), status: z.string() })),
    }).nullable().optional(),
    mix: z.object({ status: z.string(), statement: z.string().nullable(), rows: z.array(z.object({ label: z.string(), previousSharePercent: z.number().nullable(), currentSharePercent: z.number(), averageDurationSeconds: z.number().nullable() })) }).nullable(),
    patterns: z.array(patternSchema),
    team: z.object({ status: z.string(), contributors: z.number(), behaviors: z.array(z.object({ title: z.string(), classification: z.string(), notFollowed: z.number(), eligible: z.number() })) }),
    processes: z.array(z.object({ documentTitle: z.string(), eligible: z.number(), notFollowed: z.number() })),
    evidence: z.array(z.object({ title: z.string(), date: z.string(), text: z.string() })),
    findings: z.array(z.string()),
    unsupportedHypotheses: z.array(z.string()),
    limitations: z.array(z.string()),
    strategy: z.object({ versionId: z.string().nullable(), version: z.number().nullable() }).optional(),
    steps: stepsSchema.nullable().optional(),
    signal: signalSchema.nullable().optional(),
    evidenceGap: z.string().nullable().optional(),
  })),
})

export type PrvSupervisorView = z.infer<typeof prvSupervisorViewSchema>
