import { z } from "zod"

/**
 * DIAGNÓSTICO DA LIDERANÇA — contrato da memória do motor de feedback (`/api/v1/diagnostics/memory/*`). Números são contagens
 * da projeção vigente (chamada × critério); o denominador é "avaliadas" (cumpridas + não cumpridas + parciais); inconclusivas e
 * não aplicáveis ficam fora e sempre aparecem. Nada aqui é estimado pela tela.
 */
/**
 * OCORRÊNCIAS de conduta — denominador PRÓPRIO, separado das contagens por regra: quando a revisão ligou duas regras à mesma conduta
 * no mesmo momento da mesma chamada, elas contam uma vez. Só regras com ligação determinável entram (`assessedRules`); as de análises
 * antigas aparecem em `undeterminedAssessedRules` e ficam fora da taxa. `basis` NONE = nenhuma ligação determinável: não há taxa.
 */
export const occurrenceStatsSchema = z.object({
  basis: z.enum(["FULL", "PARTIAL", "NONE", "EMPTY"]),
  assessed: z.number(),
  deviations: z.number(),
  met: z.number(),
  assessedRules: z.number(),
  deviationRules: z.number(),
  sharedDeviationRules: z.number(),
  undeterminedAssessedRules: z.number(),
  deviationRate: z.number().nullable(),
})
export type OccurrenceStats = z.infer<typeof occurrenceStatsSchema>

export const memoryStatsSchema = z.object({
  calls: z.number(),
  assessed: z.number(),
  met: z.number(),
  notMet: z.number(),
  partial: z.number(),
  inconclusive: z.number(),
  notApplicable: z.number(),
  deviationRate: z.number().nullable(),
  coverageRate: z.number().nullable(),
  occurrences: occurrenceStatsSchema,
})
export type MemoryStats = z.infer<typeof memoryStatsSchema>

export type MemoryFilters = { from: string; to: string; teamId?: string | null; subteamId?: string | null; personId?: string | null; subject?: string | null; documentId?: string | null; criterionKey?: string | null; practiceKey?: string | null; status?: string | null }

export const memorySummarySchema = z.object({
  filters: z.record(z.string(), z.unknown()),
  method: z.string(),
  stats: memoryStatsSchema,
  criteria: z.number(),
  people: z.number(),
  lastAnalysisAt: z.string().nullable(),
  callOutcomes: z.object({ total: z.number(), usable: z.number(), partial: z.number(), insufficient: z.number(), path_incorrect: z.number(), path_assessed: z.number() }),
})
export type MemorySummary = z.infer<typeof memorySummarySchema>

export const filterOptionsSchema = z.object({
  teams: z.array(z.object({ id: z.string(), name: z.string() })),
  subteams: z.array(z.object({ id: z.string(), name: z.string() })),
  subjects: z.array(z.string()),
  documents: z.array(z.object({ id: z.string(), title: z.string() })),
  people: z.array(z.object({ id: z.string(), name: z.string() })),
})
export type FilterOptions = z.infer<typeof filterOptionsSchema>

const page = <T extends z.ZodTypeAny>(item: T) => z.object({ total: z.number(), items: z.array(item), page: z.number(), pageSize: z.number() })

/** Ponto do processo = PRÁTICA (a mesma conduta em qualquer regra, seção, documento ou argumentário), com as fontes de onde vem. */
export const practiceSourceSchema = z.object({ documentId: z.string(), documentTitle: z.string(), section: z.string().nullable(), kind: z.enum(["KNOWLEDGE", "ARGUMENT_SCRIPT"]) })
export type PracticeSource = z.infer<typeof practiceSourceSchema>
/** `title` = nome curto do ponto (ou, sem organização, a ação que a análise leu); `description` = a conduta completa, quando o nome é curto. */
export const processRowSchema = memoryStatsSchema.extend({ practiceKey: z.string(), title: z.string(), description: z.string().nullable(), organized: z.boolean(), rules: z.number(), sources: z.array(practiceSourceSchema), people: z.number(), peopleWithDeviation: z.number(), peopleWithMet: z.number() })
export type ProcessRow = z.infer<typeof processRowSchema>
/** Visão: onde mais se erra (só pontos com desvio), onde mais se acerta (só pontos com acerto), todos (gráficos). */
export type ProcessOrder = "DEVIATIONS" | "MET" | "ALL"
/**
 * TEMA = momento ou assunto do atendimento que junta os pontos; `themeKey` null = pontos ainda sem tema (sempre por último). As
 * contagens são do tema inteiro (`points` = pontos avaliados nele); `items` = só os pontos da visão.
 */
export const processThemeSchema = memoryStatsSchema.extend({ themeKey: z.string().nullable(), title: z.string().nullable(), points: z.number(), people: z.number(), peopleWithDeviation: z.number(), peopleWithMet: z.number(), items: z.array(processRowSchema) })
export type ProcessTheme = z.infer<typeof processThemeSchema>
export const processThemesSchema = z.object({ order: z.enum(["DEVIATIONS", "MET", "ALL"]), totalPoints: z.number(), listedPoints: z.number(), themes: z.array(processThemeSchema) })

export const peopleRowSchema = memoryStatsSchema.extend({ key: z.string().nullable(), label: z.string(), topDeviations: z.array(z.object({ practiceKey: z.string(), title: z.string(), deviations: z.number(), assessed: z.number() })) })
export type PeopleRow = z.infer<typeof peopleRowSchema>
export const peoplePageSchema = page(peopleRowSchema).extend({ groupBy: z.enum(["PERSON", "TEAM", "SUBTEAM"]) })

export const concentrationSchema = z.object({ dimension: z.enum(["DAY", "WEEKDAY", "SUBJECT", "HOUR"]), buckets: z.array(memoryStatsSchema.extend({ bucket: z.string(), label: z.string() })) })
export type Concentration = z.infer<typeof concentrationSchema>

/** Item do documento = SEÇÃO: avaliações que sustentou (acertos/desvios), indicações no feedback e os pontos avaliados nela. */
export const materialSectionSchema = z.object({
  section: z.string().nullable(),
  assessed: z.number(),
  met: z.number(),
  deviations: z.number(),
  recommended: z.number(),
  points: z.array(z.object({ practiceKey: z.string(), title: z.string(), assessed: z.number(), met: z.number(), deviations: z.number() })),
})
export type MaterialSection = z.infer<typeof materialSectionSchema>
export const materialRowSchema = memoryStatsSchema.extend({
  documentId: z.string(),
  title: z.string(),
  href: z.string().nullable(),
  groundedCalls: z.number(),
  groundedPeople: z.number(),
  peopleWithDeviation: z.number(),
  recommended: z.number(),
  delivered: z.number(),
  recommendedPeople: z.number(),
  reasons: z.array(z.string()),
  practices: z.array(z.object({ practiceKey: z.string(), title: z.string(), recommended: z.number() })),
  sections: z.array(materialSectionSchema),
})
export type MaterialRow = z.infer<typeof materialRowSchema>
export const materialsSchema = z.object({ items: z.array(materialRowSchema) })

const practiceSchema = z.object({ criterionKey: z.string(), text: z.string(), reference: z.object({ eligible: z.number(), met: z.number(), contributors: z.number() }), person: z.object({ eligible: z.number(), met: z.number(), notMet: z.number() }), contrast: z.string() }).passthrough()
export const indicatorRowSchema = z.object({
  id: z.string(),
  personId: z.string(),
  personName: z.string(),
  indicatorCode: z.string(),
  indicatorName: z.string(),
  periodLabel: z.string(),
  official: z.record(z.string(), z.unknown()),
  conclusion: z.string(),
  focus: z.array(z.object({ label: z.string(), reason: z.string() }).passthrough()),
  patterns: z.array(z.object({ segment: z.string(), criterionKey: z.string(), text: z.string(), classification: z.string(), eligible: z.number(), notMet: z.number(), partial: z.number(), met: z.number() }).passthrough()),
  evidence: z.array(z.object({ segment: z.string(), analyzedCalls: z.number(), universe: z.number() })),
  reference: z.object({ basis: z.string(), members: z.number(), practices: z.array(practiceSchema), limitations: z.array(z.string()) }).nullable(),
  questions: z.array(z.object({ id: z.string(), question: z.string(), answered: z.boolean(), summary: z.string() })),
  limitations: z.array(z.string()),
  createdAt: z.string(),
})
export type IndicatorRow = z.infer<typeof indicatorRowSchema>
export const indicatorPageSchema = page(indicatorRowSchema)

export const assessmentRowSchema = z.object({ id: z.string(), callAssessmentId: z.string(), interactionId: z.string(), personId: z.string(), personName: z.string(), teamName: z.string().nullable(), date: z.string(), subject: z.string().nullable(), status: z.string(), criterionKey: z.string(), criterionText: z.string(), practiceKey: z.string().optional(), practiceTitle: z.string().optional(), rationale: z.string().nullable(), materiality: z.string().nullable(), documentTitle: z.string(),
  section: z.string().nullable().optional(), evidence: z.array(z.object({ turn: z.string(), speaker: z.string().nullable(), quote: z.string() })).default([]) })
export type AssessmentRow = z.infer<typeof assessmentRowSchema>
export const assessmentPageSchema = page(assessmentRowSchema)

const quoteSchema = z.object({ turn: z.string(), speaker: z.string().nullable(), quote: z.string(), timestamp: z.string().nullable().optional() })
/** `PRODUCT_APPLICABILITY_V1` — efeito do produto numa regra: independente, estabelecida, de outro produto ou suspensa (sem avaliação). */
export const criterionProductApplicabilitySchema = z.object({ effect: z.enum(["INDEPENDENT", "ESTABLISHED", "OTHER_PRODUCT", "SUSPENDED"]), request: z.string().nullable().catch(null), requestLabel: z.string().nullable().catch(null), products: z.array(z.string()).catch([]), reason: z.string().nullable().catch(null) })
/** O que foi identificado em cada pedido da chamada, com as evidências (trechos com números mascarados) e o que ficou sem avaliação. */
export const productIdentificationSchema = z.object({
  requests: z.array(z.object({
    ref: z.string(),
    summary: z.string(),
    object: z.object({ kind: z.string(), description: z.string().nullable().catch(null) }).catch({ kind: "UNKNOWN", description: null }),
    status: z.enum(["IDENTIFIED", "FAMILY_ONLY", "MULTIPLE_POSSIBLE", "NOT_IDENTIFIED", "CONFLICTING"]),
    label: z.string(),
    possible: z.array(z.string()).catch([]),
    reviewConfirmed: z.boolean().nullable().catch(null),
    evidence: z.array(z.object({ reader: z.string(), origin: z.string(), kind: z.string(), turn: z.string().nullable(), speaker: z.string().nullable(), quote: z.string().nullable(), metadata: z.string().nullable(), criterion: z.object({ title: z.string(), version: z.number(), conclusive: z.boolean() }).nullable(), points: z.array(z.string()).catch([]), role: z.string(), roleLabel: z.string(), reason: z.string().nullable() })).catch([]),
    limitations: z.array(z.string()).catch([]),
  })),
  rules: z.array(z.object({ lineHandle: z.string(), title: z.string(), request: z.string().nullable(), products: z.array(z.string()).catch([]), effect: z.string(), reason: z.string().nullable() })).catch([]),
  counts: z.object({ independent: z.number(), established: z.number(), otherProduct: z.number(), suspended: z.number() }).partial().catch({}),
})
export type ProductIdentification = z.infer<typeof productIdentificationSchema>
export const assessmentDetailSchema = z.object({
  id: z.string(),
  interactionId: z.string(),
  externalId: z.string(),
  personId: z.string(),
  personName: z.string(),
  occurredAt: z.string(),
  date: z.string(),
  subject: z.string().nullable(),
  channel: z.string().nullable(),
  selectionReason: z.string(),
  transcriptStatus: z.string(),
  procedure: z.object({ documentId: z.string(), title: z.string().nullable(), version: z.number().nullable(), perspective: z.string().nullable() }).nullable(),
  scenario: z.object({ customerNeed: z.string(), correctPath: z.string(), pathTaken: z.string(), pathRationale: z.string(), declaredPathAssessment: z.string().optional(), conditions: z.array(z.object({ text: z.string(), evidence: z.array(quoteSchema) })).optional(), pathEvidence: z.array(quoteSchema).optional() }).passthrough(),
  pathAssessment: z.string(),
  coverage: z.object({ status: z.string(), missing: z.array(z.string()).optional(), requiredLines: z.array(z.string()).optional() }).passthrough(),
  outcome: z.string(),
  limitations: z.array(z.string()),
  isCurrent: z.boolean(),
  structureBasis: z.string(),
  criteria: z.array(z.object({
    id: z.string(),
    criterionKey: z.string(),
    text: z.string(),
    section: z.string().nullable(),
    documentId: z.string(),
    documentTitle: z.string(),
    documentVersion: z.number(),
    status: z.string(),
    evidenceKind: z.string().nullable(),
    evidence: z.array(quoteSchema),
    opportunityTurn: z.string().nullable(),
    rationale: z.string().nullable(),
    guidance: z.object({ moment: z.string(), condition: z.string().nullable(), action: z.string() }).passthrough().nullable(),
    whyItMatters: z.string().nullable(),
    materiality: z.string().nullable(),
    ruleConflict: z.boolean(),
    onPath: z.boolean(),
    identityBasis: z.string(),
    href: z.string().nullable(),
    /** Mesma conduta julgada por outras regras nesta chamada (ligação da revisão); null = não determinável (análise antiga). */
    occurrence: z.object({ basis: z.string(), sameConductAs: z.array(z.object({ criterionKey: z.string(), text: z.string(), documentTitle: z.string().nullable() })) }).nullable().optional(),
    productApplicability: criterionProductApplicabilitySchema.nullable().optional().catch(null),
  })),
  productIdentification: productIdentificationSchema.nullable().optional().catch(null),
  transcript: z.array(z.object({ turn: z.string(), speaker: z.string().nullable(), text: z.string(), timestamp: z.string().nullable() })),
})
export type AssessmentDetail = z.infer<typeof assessmentDetailSchema>

/** Uma investigação de indicador do motor (a mesma forma na memória da liderança e no "Testar diagnóstico"). */
export const investigationSchema = z.object({
  official: z.record(z.string(), z.unknown()),
  localization: z.object({
    proxy: z.object({ kind: z.string().nullable(), label: z.string(), description: z.string() }),
    windows: z.object({ current: z.object({ label: z.string() }), previous: z.object({ label: z.string() }) }),
    overall: z.object({ current: z.object({ n: z.number(), value: z.number() }).nullable(), previous: z.object({ n: z.number(), value: z.number() }).nullable(), direction: z.string() }).passthrough(),
    decomposition: z.object({ mixEffect: z.number(), withinEffect: z.number(), dominant: z.string() }).nullable(),
    segments: z.array(z.object({ key: z.string(), label: z.string(), current: z.object({ n: z.number(), value: z.number() }).nullable(), previous: z.object({ n: z.number(), value: z.number() }).nullable(), changeDirection: z.string(), sufficient: z.boolean() }).passthrough()),
    daily: z.object({ available: z.boolean(), outliers: z.array(z.object({ date: z.string(), value: z.number() }).passthrough()) }).passthrough(),
    focus: z.array(z.object({ key: z.string(), label: z.string(), reason: z.string() })),
    limitations: z.array(z.string()),
  }).passthrough(),
  evidence: z.array(z.object({ segmentLabel: z.string(), analyzedCalls: z.number(), universe: z.number(), sampleNote: z.string(), patterns: z.array(z.object({ criterionKey: z.string(), text: z.string(), classification: z.string(), eligible: z.number(), met: z.number(), notMet: z.number(), partial: z.number(), inconclusive: z.number(), examples: z.array(z.object({ interactionId: z.string(), localDate: z.string(), rationale: z.string().nullable() }).passthrough()) }).passthrough()) }).passthrough()),
  reference: z.object({ basis: z.string(), segmentLabel: z.string().nullable(), members: z.number(), population: z.number(), practices: z.array(practiceSchema), limitations: z.array(z.string()) }).nullable(),
  questions: z.array(z.object({ id: z.string(), question: z.string(), answered: z.boolean(), summary: z.string() })),
  conclusion: z.string(),
  limitations: z.array(z.string()),
}).passthrough()
export type Investigation = z.infer<typeof investigationSchema>

export const indicatorDetailSchema = investigationSchema.extend({
  id: z.string(),
  personId: z.string(),
  personName: z.string(),
  createdAt: z.string(),
  callAssessments: z.record(z.string(), z.string()),
})
export type IndicatorDetail = z.infer<typeof indicatorDetailSchema>
