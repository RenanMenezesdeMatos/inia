import { canAnywhere, canOrganizationWide, type AccessContext } from "../../access/domain/access-decision.js"

/**
 * PERMISSÕES DE IA (§57–§59), agora DERIVADAS do modelo geral de acesso (V1.5.7) — nunca do cargo nem de `people.role`:
 *  - `ai.manage` com escopo de ORGANIZAÇÃO (Administrador geral): conexões, segredos, roteamento, preços e orçamentos são da
 *    organização inteira;
 *  - `ai.view` (Administrador, em qualquer escopo): só leitura de configuração e de uso/custo.
 *  - Nenhum papel enxerga outra organização: toda consulta filtra pela organização da sessão.
 */
export const AI_PERMISSIONS = ["AI_CONFIG_READ", "AI_CONFIG_WRITE", "AI_SECRETS_WRITE", "AI_USAGE_READ", "AI_BUDGET_WRITE"] as const
export type AiPermission = (typeof AI_PERMISSIONS)[number]

export function aiPermissionsFor(access: AccessContext): AiPermission[] {
  if (canOrganizationWide(access, "ai.manage")) return [...AI_PERMISSIONS]
  if (canAnywhere(access, "ai.view") || canAnywhere(access, "ai.manage")) return ["AI_CONFIG_READ", "AI_USAGE_READ"]
  return []
}
