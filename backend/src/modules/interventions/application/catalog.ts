import type { Queryable } from "../../people/application/schedule-exception-service.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { interventionTypeDefinitionSchema, type InterventionTypeDefinition } from "../domain/intervention-type.js"
import { flagCatalogKey, policyDefinitionSchema, type PolicyDefinition, type PolicyValidationCatalog } from "../domain/policy-definition.js"
import type { CatalogType } from "../domain/policy-evaluation.js"

/**
 * Leitura do catálogo para validação e avaliação — sempre da organização da sessão/execução. Tipo "em vigor" = a versão
 * PUBLICADA mais recente (o cabeçalho diz se está ativo). Política "em vigor" num instante = a publicada de maior
 * `effective_from` até ele (`policyVersionInForceAt`).
 */
type Db = Queryable | Database

export type PublishedType = CatalogType & { active: boolean; version: number }

export async function loadPublishedTypes(db: Db, organizationId: string): Promise<Map<string, PublishedType>> {
  const rows = await db.query<{ type_id: string; key: string; active: boolean; version_id: string; version: number; definition: unknown }>(
    `select distinct on (t.id) t.id type_id, t.key, t.active, v.id version_id, v.version, v.definition
       from intervention_types t join intervention_type_versions v on v.type_id = t.id and v.status = 'PUBLISHED'
      where t.organization_id = $1 order by t.id, v.version desc`,
    [organizationId],
  )
  const types = new Map<string, PublishedType>()
  for (const row of rows.rows) {
    const parsed = interventionTypeDefinitionSchema.safeParse(row.definition)
    if (parsed.success) types.set(row.key, { typeId: row.type_id, versionId: row.version_id, key: row.key, definition: parsed.data, active: row.active, version: row.version })
  }
  return types
}

/** Uma versão específica (publicada) de um tipo — o que uma intervenção aberta usa para sempre. */
export async function loadTypeVersion(db: Db, organizationId: string, versionId: string): Promise<{ key: string; version: number; definition: InterventionTypeDefinition } | null> {
  const row = (await db.query<{ key: string; version: number; definition: unknown }>(
    `select t.key, v.version, v.definition from intervention_type_versions v join intervention_types t on t.id = v.type_id where v.id = $1 and v.organization_id = $2`,
    [versionId, organizationId],
  )).rows[0]
  const parsed = row ? interventionTypeDefinitionSchema.safeParse(row.definition) : null
  return row && parsed?.success ? { key: row.key, version: row.version, definition: parsed.data } : null
}

export async function loadValidationCatalog(db: Db, organizationId: string): Promise<PolicyValidationCatalog> {
  const [types, allTypes, competencies, indicators, flags] = await Promise.all([
    loadPublishedTypes(db, organizationId),
    db.query<{ key: string }>(`select key from intervention_types where organization_id = $1`, [organizationId]),
    db.query<{ key: string }>(`select key from competencies where organization_id = $1`, [organizationId]),
    db.query<{ code: string; active: boolean }>(`select code, active from indicator_definitions where organization_id = $1`, [organizationId]),
    db.query<{ channel: string; flag_name: string; value_type: "BOOLEAN" | "NUMERIC"; active: boolean }>(`select channel, flag_name, value_type, active from channel_flags where organization_id = $1`, [organizationId]),
  ])
  return {
    types: new Map([...types].map(([key, type]) => [key, { active: type.active, definition: type.definition }])),
    allTypeKeys: new Set(allTypes.rows.map((row) => row.key)),
    competencyKeys: new Set(competencies.rows.map((row) => row.key)),
    indicators: new Map(indicators.rows.map((row) => [row.code, { active: row.active }])),
    flags: new Map(flags.rows.map((row) => [flagCatalogKey(row.channel, row.flag_name), { valueType: row.value_type, active: row.active }])),
  }
}

export type PolicyHeader = { id: string; key: string; name: string; scopeType: "ORGANIZATION" | "GROUP" | "SUBGROUP"; teamId: string | null; subteamId: string | null; active: boolean }
export type PolicyVersion = { id: string; version: number; effectiveFrom: string; definition: PolicyDefinition }

export async function loadPolicyHeader(db: Db, organizationId: string, policyId: string): Promise<PolicyHeader | null> {
  if (!/^[0-9a-f-]{36}$/i.test(policyId)) return null
  const row = (await db.query<{ id: string; key: string; name: string; scope_type: PolicyHeader["scopeType"]; team_id: string | null; subteam_id: string | null; active: boolean }>(
    `select id, key, name, scope_type, team_id, subteam_id, active from intervention_policies where id = $1 and organization_id = $2`,
    [policyId, organizationId],
  )).rows[0]
  return row ? { id: row.id, key: row.key, name: row.name, scopeType: row.scope_type, teamId: row.team_id, subteamId: row.subteam_id, active: row.active } : null
}

function toVersion(row: { id: string; version: number; effective_from: Date; definition: unknown }): PolicyVersion | null {
  const parsed = policyDefinitionSchema.safeParse(row.definition)
  return parsed.success ? { id: row.id, version: row.version, effectiveFrom: row.effective_from.toISOString(), definition: parsed.data } : null
}

/** Versão em vigor da política num instante (nunca muda para instantes passados: `effective_from` >= publicação). */
export async function policyVersionInForceAt(db: Db, organizationId: string, policyId: string, at: Date): Promise<PolicyVersion | null> {
  const row = (await db.query<{ id: string; version: number; effective_from: Date; definition: unknown }>(
    `select id, version, effective_from, definition from intervention_policy_versions
      where policy_id = $1 and organization_id = $2 and status = 'PUBLISHED' and effective_from <= $3
      order by effective_from desc, version desc limit 1`,
    [policyId, organizationId, at],
  )).rows[0]
  return row ? toVersion(row) : null
}

export async function loadPolicyVersion(db: Db, organizationId: string, versionId: string): Promise<(PolicyVersion & { policyId: string }) | null> {
  const row = (await db.query<{ id: string; policy_id: string; version: number; effective_from: Date; definition: unknown }>(
    `select id, policy_id, version, effective_from, definition from intervention_policy_versions where id = $1 and organization_id = $2 and status = 'PUBLISHED'`,
    [versionId, organizationId],
  )).rows[0]
  const version = row ? toVersion(row) : null
  return row && version ? { ...version, policyId: row.policy_id } : null
}

/** A pessoa está dentro do escopo organizacional da política? (Organização inteira, Grupo ou Subgrupo.) */
export function personInPolicyScope(policy: Pick<PolicyHeader, "scopeType" | "teamId" | "subteamId">, person: { teamId: string | null; subteamId: string | null }): boolean {
  if (policy.scopeType === "ORGANIZATION") return true
  if (policy.scopeType === "GROUP") return person.teamId === policy.teamId
  return person.subteamId === policy.subteamId
}
