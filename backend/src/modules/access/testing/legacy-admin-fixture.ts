/**
 * Apoio a testes de routers administrativos que simulam o banco por SQL (fake `query`). As fixtures antigas descrevem o
 * acesso no formato LEGADO (people.role + linhas de user_role_assignments); este helper responde a consulta de atribuições
 * do modelo novo (`from access_role_assignments`) aplicando EXATAMENTE a regra do backfill da migration 081:
 *   people.role ≠ ADMIN                        → nenhum papel (cargo nunca concede acesso);
 *   ADMIN sem linha ADMIN, ou com ALL_TEAMS    → ADMINISTRADOR_GERAL na organização;
 *   ADMIN com linhas TEAM/SUBTEAM              → ADMINISTRADOR no Grupo/Subgrupo.
 * Assim os testes existentes continuam provando a mesma intenção, agora pelo modelo de papéis.
 */
type LegacyRow = { role?: string; scope_type: string; team_id: string | null; subteam_id: string | null }

export function legacyAccessRows(peopleRole: string, legacyRows: readonly LegacyRow[], accountId = "acc-1") {
  if (peopleRole !== "ADMIN") return []
  const admin = legacyRows.filter((row) => (row.role ?? "ADMIN") === "ADMIN")
  const row = (index: number, roleCode: string, scopeType: string, teamId: string | null, subteamId: string | null) => ({ id: `00000000-0000-4000-8000-0000000a${String(index).padStart(4, "0")}`, user_account_id: accountId, role_code: roleCode, scope_type: scopeType, team_id: teamId, subteam_id: subteamId, subteam_team_id: null, team_name: null, subteam_name: null, source: "MIGRATION_LEGACY_ADMIN", granted_at: new Date(0), granted_by_name: null, revoked_at: null })
  if (admin.length === 0 || admin.some((entry) => entry.scope_type === "ALL_TEAMS")) return [row(0, "ADMINISTRADOR_GERAL", "ORGANIZATION", null, null)]
  return admin.map((entry, index) => (entry.scope_type === "TEAM" ? row(index, "ADMINISTRADOR", "GROUP", entry.team_id, null) : row(index, "ADMINISTRADOR", "SUBGROUP", null, entry.subteam_id)))
}

/** Responde a consulta de atribuições do repositório Postgres de acesso num fake de banco por SQL (undefined = não é ela). */
export function legacyAccessQuery(sql: string, peopleRole: string, legacyRows: readonly LegacyRow[]) {
  if (!sql.includes("from access_role_assignments")) return undefined
  const rows = legacyAccessRows(peopleRole, legacyRows)
  return { rows, rowCount: rows.length }
}
