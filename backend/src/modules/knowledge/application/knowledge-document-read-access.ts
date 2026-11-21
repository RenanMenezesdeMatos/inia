import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import type { ManageableScopes } from "../../auth/application/manageable-scopes.js"

/** Alcance de uma base (vínculo em `knowledge_document_org_scopes`). */
export type DocumentScope = { scopeType: string; teamId: string | null; subteamId: string | null }

async function parentTeamsOf(db: Pick<Database, "query">, subteamIds: readonly string[]): Promise<Set<string>> {
  if (subteamIds.length === 0) return new Set()
  const result = await db.query<{ team_id: string }>(`select team_id from subteams where id = any($1::uuid[])`, [[...subteamIds]])
  return new Set(result.rows.map((row) => row.team_id))
}

/**
 * Regra ÚNICA de leitura de uma base por quem administra bases (`knowledge.manage` no alcance): base global, ou ao menos um Grupo
 * ou Subgrupo da base no alcance (Subgrupo administrado lê a base do Grupo-pai). Usada pela tela de bases e pela associação de
 * agentes a partir da base.
 */
export async function canReadDocument(db: Pick<Database, "query">, scopes: ManageableScopes, documentScopes: readonly DocumentScope[]): Promise<boolean> {
  if (scopes.unrestricted || scopes.allTeams) return true
  if (documentScopes.some((scope) => scope.scopeType === "ALL_TEAMS")) return true
  const parentTeams = await parentTeamsOf(db, [...scopes.subteamIds])
  return documentScopes.some((scope) =>
    (scope.teamId !== null && (scopes.teamIds.has(scope.teamId) || (scope.scopeType === "TEAM" && parentTeams.has(scope.teamId)))) ||
    (scope.subteamId !== null && scopes.subteamIds.has(scope.subteamId)))
}

/** Alcances atuais do documento NA organização (null = não existe nela ou foi excluído). */
export async function loadDocumentScopes(db: Pick<Database, "query">, organizationId: string, id: string): Promise<DocumentScope[] | null> {
  if (!z.string().uuid().safeParse(id).success) return null
  const result = await db.query<{ found: boolean; scopes: DocumentScope[] }>(
    `select true found, coalesce((select json_agg(json_build_object('scopeType', os.scope_type, 'teamId', os.team_id, 'subteamId', os.subteam_id))
       from knowledge_document_org_scopes os where os.knowledge_document_id = d.id), '[]') scopes
     from knowledge_documents d where d.id = $1 and d.organization_id = $2 and d.deleted_at is null`,
    [id, organizationId],
  )
  return result.rows[0] ? result.rows[0].scopes : null
}
