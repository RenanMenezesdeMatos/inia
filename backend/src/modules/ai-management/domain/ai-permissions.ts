import { canAnywhere, canOrganizationWide, type AccessContext } from "../../access/domain/access-decision.js"

/**
 * PERMISSÕES DE IA (§57–§59), agora DERIVADAS do modelo geral de acesso (V1.5.7) — nunca do cargo nem de `people.role`:
 *  - `ai.manage` com escopo de ORGANIZAÇÃO (Administrador geral): conexões, segredos, roteamento, preços e orçamentos são da
 *    organização inteira;
 *  - `ai.view` (Administrador, em qualquer escopo): só leitura de configuração e de uso/custo.
 *  - Nenhum papel enxerga outra organização: toda consulta filtra pela organização da sessão.
 */
export const AI_PERMISSIONS = ["AI_CONFIG_READ", "AI_CONFIG_WRITE", "AI_SECRETS_WRITE", "AI_USAGE_READ", "AI_BUDGET_WRITE", "AI_USAGE_RANKING_READ"] as const
export type AiPermission = (typeof AI_PERMISSIONS)[number]

const MANAGE_PERMISSIONS: readonly AiPermission[] = ["AI_CONFIG_READ", "AI_CONFIG_WRITE", "AI_SECRETS_WRITE", "AI_USAGE_READ", "AI_BUDGET_WRITE"]

/**
 * `AI_USAGE_RANKING_READ` ("Quem mais usa", com nomes de líderes e estruturas) só vem da concessão EXPLÍCITA
 * `ai.usage_ranking.view` — nunca de `ai.manage`/`ai.view` — e exige também a entrada na área de uso de IA. O recorte (quem
 * aparece) é decidido no servidor pelo escopo dessa mesma permissão (ai-usage-ranking-service.ts).
 */
export function aiPermissionsFor(access: AccessContext): AiPermission[] {
  const permissions: AiPermission[] = canOrganizationWide(access, "ai.manage") ? [...MANAGE_PERMISSIONS] : canAnywhere(access, "ai.view") || canAnywhere(access, "ai.manage") ? ["AI_CONFIG_READ", "AI_USAGE_READ"] : []
  if (permissions.includes("AI_USAGE_READ") && canAnywhere(access, "ai.usage_ranking.view")) permissions.push("AI_USAGE_RANKING_READ")
  return permissions
}
