import { randomUUID } from "node:crypto"
import type { Database } from "../../../infrastructure/database/pool.js"

/**
 * Versões por organização que invalidam os caches do analytics da liderança (migrations 128 e 141). Quem sobe a versão é
 * o BANCO, por trigger, na mesma transação da escrita — nenhum gravador precisa lembrar. A versão vem de uma sequência:
 * "mesma versão" significa "mesmos dados", então um cache em memória com a versão na chave nunca serve dado velho, mesmo
 * com várias instâncias da API.
 *   STRUCTURE — pessoas (colunas do PersonNode), Grupos e Subgrupos.
 *   OFFICIAL  — fechamento oficial (indicador e PRV) e catálogo de indicadores.
 * Organização sem linha (nenhuma escrita desde a migration) = versão "0".
 *
 * A versão sobe NO COMMIT (141): até lá, a escrita fica anotada em `analytics_version_pending`, visível só para a própria
 * transação. Para ela, o domínio com pendência devolve uma versão única a cada leitura, que nunca coincide com outra.
 * Assim, quem grava e lê o analytics na mesma transação nunca recebe um cache anterior à própria escrita. E o que ela
 * carregar (com dados que os outros ainda não veem) nunca fica guardado sob a versão de todos.
 */
export type AnalyticsVersionDomain = "STRUCTURE" | "OFFICIAL"
export type AnalyticsVersions = Record<AnalyticsVersionDomain, string>

const UNCOMMITTED = "uncommitted:"

/** Versão de um domínio com escrita pendente NESTA transação: o cache carrega sem guardar. */
export function isUncommittedVersion(version: string): boolean {
  return version.startsWith(UNCOMMITTED)
}

export async function loadAnalyticsVersions(db: Pick<Database, "query">, organizationId: string): Promise<AnalyticsVersions> {
  const result = await db.query<{ domain: AnalyticsVersionDomain; version: string | null }>(
    `select domain, version::text version from analytics_versions where organization_id = $1
     union all
     select domain, null from analytics_version_pending where xact_id = pg_current_xact_id_if_assigned() and organization_id = $1`,
    [organizationId],
  )
  const versions: AnalyticsVersions = { STRUCTURE: "0", OFFICIAL: "0" }
  for (const row of result.rows) if (row.version !== null) versions[row.domain] = row.version
  for (const row of result.rows) if (row.version === null) versions[row.domain] = `${UNCOMMITTED}${randomUUID()}`
  return versions
}

export async function loadAnalyticsVersion(db: Pick<Database, "query">, organizationId: string, domain: AnalyticsVersionDomain): Promise<string> {
  return (await loadAnalyticsVersions(db, organizationId))[domain]
}
