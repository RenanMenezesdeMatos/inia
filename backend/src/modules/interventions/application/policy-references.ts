import type { Database } from "../../../infrastructure/database/pool.js"

/**
 * Políticas de acompanhamento ativas cuja versão publicada mais recente cita o indicador ou a flag. Sem o objeto, a condição viraria "dado insuficiente" para sempre, sem ninguém ver o motivo.
 * A citação fica na definição versionada, sem chave estrangeira.
 */
export async function loadPoliciesCiting(db: Pick<Database, "query">, organizationId: string, citation: { key: "indicatorCode" | "flagName"; value: string }): Promise<string[]> {
  const path = citation.key === "indicatorCode" ? "$.** ? (@.indicatorCode == $value)" : "$.** ? (@.flagName == $value)"
  const rows = await db.query<{ name: string }>(
    `select p.name from intervention_policies p
       join lateral (select v.definition from intervention_policy_versions v where v.policy_id = p.id and v.status = 'PUBLISHED' order by v.version desc limit 1) current on true
      where p.organization_id = $1 and p.active and jsonb_path_exists(current.definition, $2::jsonpath, jsonb_build_object('value', $3::text))
      order by p.name`,
    [organizationId, path, citation.value],
  )
  return rows.rows.map((row) => row.name)
}
