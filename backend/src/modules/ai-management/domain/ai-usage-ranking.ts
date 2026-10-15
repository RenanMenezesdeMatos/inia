import { z } from "zod"
import type { HierarchyRole } from "../../performance-analytics/domain/hierarchy-levels.js"

/**
 * RANKING "QUEM MAIS USA" A IA (Administração › IA / Modelos) — vocabulário e contrato da consulta.
 *
 * Cada evento de uso é atribuído a UMA pessoa, por fato gravado, nunca por heurística:
 *  - `WORKFLOW`: a execução de Workflow que fez a chamada (`enrollment_id`, migration 084) → o colaborador da matrícula
 *    (agenda/fan-out/execução manual, interação ou medição individual) — a IA trabalhou PARA aquela pessoa;
 *  - `REQUEST`: fora de Workflow, a pessoa da sessão que fez o request (`requester_person_id`, migration 143);
 *  - `OTHER`: nenhum dos dois (job sem sessão, evento anterior à migration 143) — fica em "Sem vínculo".
 * A pessoa é então levada à unidade do NÍVEL escolhido pela estrutura ATUAL: Grupo/Subgrupo do cadastro, ou o líder mais
 * próximo daquele cargo subindo por `reports_to_id` (a própria pessoa, se ela tem o cargo). Cada linha soma a pessoa e toda a
 * estrutura abaixo dela. O que não chega a uma unidade vira a linha própria "Sem vínculo" (com o motivo) — nunca some e nunca
 * é atribuído a alguém.
 */
export const AI_USAGE_RANKING_LEVELS = ["DIRECTOR", "SENIOR_MANAGER", "MANAGER", "TEAM", "SUBTEAM", "SUPERVISOR"] as const
export type AiUsageRankingLevel = (typeof AI_USAGE_RANKING_LEVELS)[number]

/** Níveis que são um CARGO da cadeia (`people.role`); Grupo e Subgrupo vêm do cadastro da pessoa. */
export const LEADER_LEVEL_ROLES: Partial<Record<AiUsageRankingLevel, HierarchyRole>> = {
  DIRECTOR: "DIRECTOR",
  SENIOR_MANAGER: "SENIOR_MANAGER",
  MANAGER: "MANAGER",
  SUPERVISOR: "SUPERVISOR",
}

export const AI_USAGE_RANKING_LEVEL_LABELS: Record<AiUsageRankingLevel, string> = {
  DIRECTOR: "Diretoria",
  SENIOR_MANAGER: "Gerência Sênior",
  MANAGER: "Gerência",
  TEAM: "Grupo",
  SUBTEAM: "Subgrupo",
  SUPERVISOR: "Supervisor",
}

export const AI_USAGE_SOURCES = ["WORKFLOW", "REQUEST", "OTHER"] as const
export type AiUsageSource = (typeof AI_USAGE_SOURCES)[number]

/** Por que um uso caiu em "Sem vínculo". */
export const AI_USAGE_UNLINKED_REASONS = ["NO_PERSON", "WORKFLOW_WITHOUT_PERSON", "OUTSIDE_LEVEL"] as const
export type AiUsageUnlinkedReason = (typeof AI_USAGE_UNLINKED_REASONS)[number]

export const AI_USAGE_RANKING_SORTS = ["REQUESTS", "TOKENS", "PEOPLE"] as const
export type AiUsageRankingSort = (typeof AI_USAGE_RANKING_SORTS)[number]

export const AI_USAGE_RANKING_MAX_PAGE_SIZE = 100

const code = (max: number) => z.string().regex(new RegExp(`^[A-Z][A-Z0-9_]{1,${max - 1}}$`))

/**
 * Filtros da consulta — validados aqui (servidor), `.strict()`: parâmetro desconhecido é recusado, nunca ignorado. Nenhum
 * filtro carrega nome, e-mail ou texto livre: Grupo/Subgrupo vão por id opaco e SÓ ESTREITAM o recorte que o servidor já
 * decidiu pelo escopo da conta (um id fora dele devolve vazio, nunca amplia).
 */
export const aiUsageRankingQuerySchema = z
  .object({
    level: z.enum(AI_USAGE_RANKING_LEVELS).default("DIRECTOR"),
    period: z.enum(["TODAY", "7D", "30D", "MONTH", "CUSTOM"]).default("30D"),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    providerKey: code(60).optional(),
    modelId: z.uuid().optional(),
    useCase: code(40).optional(),
    source: z.enum(AI_USAGE_SOURCES).optional(),
    teamId: z.uuid().optional(),
    subteamId: z.uuid().optional(),
    sort: z.enum(AI_USAGE_RANKING_SORTS).default("REQUESTS"),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(AI_USAGE_RANKING_MAX_PAGE_SIZE).default(20),
  })
  .strict()
export type AiUsageRankingQuery = z.infer<typeof aiUsageRankingQuerySchema>

/** Participação (%) com 1 casa — calculada no servidor; total zero = null (nunca 0%). */
export function shareOf(part: number, total: number): number | null {
  if (total <= 0) return null
  return Math.round((part / total) * 1000) / 10
}
