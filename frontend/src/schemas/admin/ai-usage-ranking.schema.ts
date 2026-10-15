import { z } from "zod"

/**
 * "Quem mais usa" a IA (`/admin/ai?tab=ranking`) — espelho do contrato de `backend/src/modules/ai-management`
 * (domain/ai-usage-ranking.ts + application/ai-usage-ranking-service.ts). O backend é a autoridade: decide o escopo (quem
 * aparece), valida os filtros e calcula participação e totais. A tela só escolhe a visão e os filtros (ids opacos, nunca
 * nome nem texto livre na URL) e mostra o que voltou.
 *
 *  - Cada linha soma a pessoa e toda a estrutura abaixo dela (líderes) ou as pessoas do Grupo/Subgrupo — SÓ as do escopo.
 *  - "Sem vínculo" é uma linha própria, fora da paginação: aparece em toda página e nunca é atribuída a alguém.
 *  - Custo continua por moeda (string decimal); token `null` = não informado pelo provider.
 */

export const AI_USAGE_RANKING_LEVELS = ["DIRECTOR", "SENIOR_MANAGER", "MANAGER", "TEAM", "SUBTEAM", "SUPERVISOR"] as const
export type AiUsageRankingLevel = (typeof AI_USAGE_RANKING_LEVELS)[number]

export const AI_USAGE_RANKING_LEVEL_LABELS: Record<AiUsageRankingLevel, string> = {
  DIRECTOR: "Diretoria",
  SENIOR_MANAGER: "Gerência Sênior",
  MANAGER: "Gerência",
  TEAM: "Grupo",
  SUBTEAM: "Subgrupo",
  SUPERVISOR: "Supervisor",
}

/** Nome da coluna principal por visão (o que cada linha é). */
export const AI_USAGE_RANKING_ENTITY_LABELS: Record<AiUsageRankingLevel, string> = {
  DIRECTOR: "Diretor(a)",
  SENIOR_MANAGER: "Gerente sênior",
  MANAGER: "Gerente",
  TEAM: "Grupo",
  SUBTEAM: "Subgrupo",
  SUPERVISOR: "Supervisor(a)",
}

export const AI_USAGE_SOURCES = ["WORKFLOW", "REQUEST", "OTHER"] as const
export type AiUsageSource = (typeof AI_USAGE_SOURCES)[number]
export const AI_USAGE_SOURCE_LABELS: Record<AiUsageSource, string> = {
  WORKFLOW: "Execução de Workflow",
  REQUEST: "Pedido de uma pessoa",
  OTHER: "Sem origem identificada",
}

export const AI_USAGE_UNLINKED_REASONS = ["NO_PERSON", "WORKFLOW_WITHOUT_PERSON", "OUTSIDE_LEVEL"] as const
export type AiUsageUnlinkedReason = (typeof AI_USAGE_UNLINKED_REASONS)[number]

export const AI_USAGE_RANKING_SORTS = ["REQUESTS", "TOKENS", "PEOPLE"] as const
export type AiUsageRankingSort = (typeof AI_USAGE_RANKING_SORTS)[number]
export const AI_USAGE_RANKING_SORT_LABELS: Record<AiUsageRankingSort, string> = {
  REQUESTS: "Mais chamadas",
  TOKENS: "Mais tokens",
  PEOPLE: "Mais pessoas usando",
}

/** Motivo do "Sem vínculo" — o de "fora do nível" depende da visão escolhida. */
export function unlinkedReasonLabel(reason: AiUsageUnlinkedReason, level: AiUsageRankingLevel): string {
  if (reason === "NO_PERSON") return "Sem pessoa identificada"
  if (reason === "WORKFLOW_WITHOUT_PERSON") return "Workflow sem colaborador"
  if (level === "TEAM" || level === "SUBTEAM") return `Pessoa sem ${AI_USAGE_RANKING_LEVEL_LABELS[level]} no cadastro`
  return `Pessoa sem ${AI_USAGE_RANKING_ENTITY_LABELS[level].replace("(a)", "")} acima na estrutura`
}

const costByCurrencySchema = z.record(z.string(), z.string())

const rankingMetricsSchema = z.object({
  requests: z.number().int().nonnegative(),
  attempts: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
  tokens: z.number().nullable(),
  tokensReported: z.number().int().nonnegative(),
  unknownCostCalls: z.number().int().nonnegative(),
  costByCurrency: costByCurrencySchema,
  people: z.number().int().nonnegative(),
  share: z.number().nullable(),
})
export type AiUsageRankingMetrics = z.infer<typeof rankingMetricsSchema>

export const aiUsageRankingItemSchema = rankingMetricsSchema.extend({
  position: z.number().int().positive(),
  key: z.string(),
  name: z.string().nullable(),
  jobTitle: z.string().nullable(),
  teamName: z.string().nullable(),
  active: z.boolean(),
  requestsBySource: z.object({ WORKFLOW: z.number().int().nonnegative(), REQUEST: z.number().int().nonnegative() }),
})
export type AiUsageRankingItem = z.infer<typeof aiUsageRankingItemSchema>

export const aiUsageRankingSchema = z.object({
  level: z.enum(AI_USAGE_RANKING_LEVELS),
  levelLabel: z.string(),
  period: z.object({ from: z.string(), to: z.string(), label: z.string(), timezone: z.string() }),
  scope: z.object({ organizationWide: z.boolean(), unlinkedWithoutPersonVisible: z.boolean() }),
  items: z.array(aiUsageRankingItemSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  unlinked: rankingMetricsSchema.extend({
    reasons: z.array(z.object({ reason: z.enum(AI_USAGE_UNLINKED_REASONS), requests: z.number().int().nonnegative(), tokens: z.number().nullable(), costByCurrency: costByCurrencySchema })),
  }),
  totals: rankingMetricsSchema,
})
export type AiUsageRanking = z.infer<typeof aiUsageRankingSchema>

export const aiUsageRankingContextSchema = z.object({
  levels: z.array(z.object({ key: z.enum(AI_USAGE_RANKING_LEVELS), label: z.string() })),
  scope: z.object({ organizationWide: z.boolean(), labels: z.array(z.string()) }),
  teams: z.array(z.object({ id: z.string(), name: z.string(), subteams: z.array(z.object({ id: z.string(), name: z.string() })) })),
})
export type AiUsageRankingContext = z.infer<typeof aiUsageRankingContextSchema>
