import type { OrgScopeValue } from "@/components/admin/shared/org-scope-select"
import type { PolicyView } from "@/schemas/admin/intervention-policy.schema"

/** Escopo da política (ORGANIZATION | GROUP | SUBGROUP) ↔ o seletor de alcance compartilhado (ALL_TEAMS | TEAM | SUBTEAM). */
export type PolicyScope = { scopeType: PolicyView["scopeType"]; teamId: string | null; subteamId: string | null }

export function toOrgScope(scope: Pick<PolicyView, "scopeType" | "teamId" | "subteamId">): OrgScopeValue {
  if (scope.scopeType === "ORGANIZATION") return { scopeType: "ALL_TEAMS" }
  if (scope.scopeType === "GROUP") return { scopeType: "TEAM", teamId: scope.teamId ?? undefined }
  return { scopeType: "SUBTEAM", teamId: scope.teamId ?? undefined, subteamId: scope.subteamId ?? undefined }
}

export function fromOrgScope(value: OrgScopeValue): PolicyScope {
  if (value.scopeType === "ALL_TEAMS") return { scopeType: "ORGANIZATION", teamId: null, subteamId: null }
  if (value.scopeType === "TEAM") return { scopeType: "GROUP", teamId: value.teamId ?? null, subteamId: null }
  return { scopeType: "SUBGROUP", teamId: value.teamId ?? null, subteamId: value.subteamId ?? null }
}

export const scopeIsComplete = (scope: PolicyScope) => scope.scopeType === "ORGANIZATION" || (scope.teamId !== null && (scope.scopeType === "GROUP" || scope.subteamId !== null))
