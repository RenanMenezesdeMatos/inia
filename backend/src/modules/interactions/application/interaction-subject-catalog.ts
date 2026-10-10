import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { INTERACTION_SUBJECT_CODE_PATTERN, normalizeRawSubject, type CanonicalSubject, type SubjectResolution } from "../domain/interaction-subject.js"

export type InteractionSubjectDefinitionInput = { id?: string; code: string; name: string; description?: string | null; active?: boolean }
export type InteractionSubjectAliasInput = { id?: string; code: string; rawSubject: string }
export type InteractionSubjectCatalogInput = { definitions: readonly InteractionSubjectDefinitionInput[]; aliases: readonly InteractionSubjectAliasInput[] }
export type InteractionSubjectCatalogReport = { definitions: number; aliases: number; ambiguousRejected: string[] }

/**
 * Grava o catálogo por chave natural (organização + código; organização + bruto normalizado) —
 * idempotente. Um mesmo bruto apontando para DOIS códigos no input é AMBIGUIDADE: nenhum alias é
 * gravado para ele (e ele volta em `ambiguousRejected`) — nunca se escolhe arbitrariamente.
 */
export async function upsertInteractionSubjectCatalog(db: Database, organizationId: string, catalog: InteractionSubjectCatalogInput): Promise<InteractionSubjectCatalogReport> {
  for (const definition of catalog.definitions) {
    if (!INTERACTION_SUBJECT_CODE_PATTERN.test(definition.code)) throw new DomainError(`Código de assunto inválido: "${definition.code}".`, "INTERACTION_SUBJECT_CODE_INVALID", 422)
  }
  const codes = new Set(catalog.definitions.map((definition) => definition.code))
  const byRaw = new Map<string, Set<string>>()
  for (const alias of catalog.aliases) {
    if (!codes.has(alias.code)) throw new DomainError(`Alias "${alias.rawSubject}" aponta para código desconhecido "${alias.code}".`, "INTERACTION_SUBJECT_ALIAS_UNKNOWN_CODE", 422)
    const key = normalizeRawSubject(alias.rawSubject)
    byRaw.set(key, new Set([...(byRaw.get(key) ?? []), alias.code]))
  }
  const ambiguousRejected = [...byRaw].filter(([, targets]) => targets.size > 1).map(([raw]) => raw)
  const ambiguous = new Set(ambiguousRejected)
  let definitions = 0
  let aliases = 0
  for (const definition of catalog.definitions) {
    const result = await db.query<{ id: string }>(
      `insert into interaction_subject_definitions (id, organization_id, code, name, description, active)
       values (coalesce($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6)
       on conflict (organization_id, code) do update set name = excluded.name, description = excluded.description, active = excluded.active, updated_at = now()
       returning id`,
      [definition.id ?? null, organizationId, definition.code, definition.name, definition.description ?? null, definition.active ?? true],
    )
    if (result.rowCount) definitions += 1
  }
  for (const alias of catalog.aliases) {
    if (ambiguous.has(normalizeRawSubject(alias.rawSubject))) continue
    const result = await db.query(
      `insert into interaction_subject_aliases (id, organization_id, subject_definition_id, raw_subject)
       select coalesce($1::uuid, gen_random_uuid()), $2, d.id, $4 from interaction_subject_definitions d where d.organization_id = $2 and d.code = $3
       on conflict (organization_id, lower(btrim(raw_subject))) do update set subject_definition_id = excluded.subject_definition_id, raw_subject = excluded.raw_subject`,
      [alias.id ?? null, organizationId, alias.code, alias.rawSubject],
    )
    if (result.rowCount) aliases += 1
  }
  return { definitions, aliases, ambiguousRejected }
}

/**
 * Resolve o assunto pedido (pelo modelo ou por uma tela) para o canônico da organização: código
 * canônico ativo, ou alias exato do bruto. Sem alias = comparação por igualdade exata do bruto
 * (`RAW_EXACT`). Determinístico — nunca aproxima, nunca chama IA.
 */
export async function resolveCanonicalSubject(db: Database, organizationId: string, requested: string): Promise<SubjectResolution> {
  const normalized = normalizeRawSubject(requested)
  const byCode = await db.query<CanonicalSubject>(`select code, name from interaction_subject_definitions where organization_id = $1 and code = $2 and active`, [organizationId, normalized])
  if (byCode.rows[0]) return { requested, canonical: byCode.rows[0], mode: "CANONICAL" }
  const byAlias = await db.query<CanonicalSubject>(
    `select d.code, d.name from interaction_subject_aliases a join interaction_subject_definitions d on d.id = a.subject_definition_id and d.active
     where a.organization_id = $1 and lower(btrim(a.raw_subject)) = $2`,
    [organizationId, normalized],
  )
  if (byAlias.rows[0]) return { requested, canonical: byAlias.rows[0], mode: "CANONICAL" }
  return { requested, canonical: null, mode: "RAW_EXACT" }
}
