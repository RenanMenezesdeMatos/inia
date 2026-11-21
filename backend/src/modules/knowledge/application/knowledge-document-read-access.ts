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

/**
 * A mesma regra de `canReadDocument` em SQL, para filtrar listas — a de Bases e a do seletor de bases do agente (run-8, ARQ-03): `null` = quem pede lê todas as bases. `param` guarda
 * um valor como parâmetro da consulta e devolve o marcador dele (`SqlFilter.param`).
 */
export function readableDocumentSql(documentId: string, scopes: ManageableScopes, param: (value: unknown) => string): string | null {
  if (scopes.unrestricted || scopes.allTeams) return null
  const teamIds = param([...scopes.teamIds])
  const subteamIds = param([...scopes.subteamIds])
  return `exists (select 1 from knowledge_document_org_scopes read_os where read_os.knowledge_document_id = ${documentId} and (
    read_os.scope_type = 'ALL_TEAMS' or read_os.team_id = any(${teamIds}::uuid[]) or read_os.subteam_id = any(${subteamIds}::uuid[])
    or (read_os.scope_type = 'TEAM' and read_os.team_id in (select read_st.team_id from subteams read_st where read_st.id = any(${subteamIds}::uuid[])))))`
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
