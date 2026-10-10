/**
 * CHECKPOINT REGISTRY — ESCOPO (puro). Onde uma definição se aplica é ASSOCIAÇÃO (domínio de negócio, Grupo, Subgrupo) — a mesma
 * regra lógica atende várias equipes sem ser duplicada. Sem nenhuma associação = vale onde a própria base vale.
 */
export type CheckpointScope = { scopeType: "BUSINESS_DOMAIN" | "TEAM" | "SUBTEAM"; businessDomainId: string | null; teamId: string | null; subteamId: string | null }
export type CheckpointScopeContext = { businessDomainId: string | null; teamId: string | null; subteamId: string | null; known: boolean }

/** `known = false` (colaborador/Agent não identificados): não dá para avaliar — a regra continua valendo (nunca some em silêncio). */
export function isInCheckpointScope(scopes: readonly CheckpointScope[], context: CheckpointScopeContext): boolean {
  if (scopes.length === 0 || !context.known) return true
  return scopes.some((scope) =>
    (scope.scopeType === "BUSINESS_DOMAIN" && scope.businessDomainId !== null && scope.businessDomainId === context.businessDomainId)
    || (scope.scopeType === "TEAM" && scope.teamId !== null && scope.teamId === context.teamId)
    || (scope.scopeType === "SUBTEAM" && scope.subteamId !== null && scope.subteamId === context.subteamId))
}
