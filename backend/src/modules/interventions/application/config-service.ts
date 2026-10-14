import type pg from "pg"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import type { Queryable } from "../../people/application/schedule-exception-service.js"
import { competencyInputSchema, PATTERN_KEY, type CompetencyInput } from "../domain/competency.js"
import { emptyInterventionTypeDefinition, interventionTypeDefinitionSchema, validateInterventionType, type ConfigIssue, type InterventionTypeDefinition } from "../domain/intervention-type.js"
import { emptyPolicyDefinition, policyDefinitionSchema, validatePolicyDefinition, type PolicyDefinition } from "../domain/policy-definition.js"
import { loadPolicyHeader, loadValidationCatalog, type PolicyHeader } from "./catalog.js"

/**
 * CONFIGURAÇÃO — tipos de intervenção, competências e políticas. Rascunho é editável e nunca executa; PUBLICAR valida a
 * combinação inteira e congela a versão (imutável no banco); INATIVAR nunca apaga versões referenciadas. Toda escrita audita.
 * Escopo e permissão são decididos pelo router (organização sempre da sessão).
 */
export type ConfigActor = { userAccountId: string; personId: string }

async function inTransaction<T>(db: Database, work: (client: Queryable) => Promise<T>): Promise<T> {
  const client: pg.PoolClient = await db.connect()
  try {
    await client.query("begin")
    const result = await work(client)
    await client.query("commit")
    return result
  } catch (error) {
    await client.query("rollback")
    throw error
  } finally {
    client.release()
  }
}

async function audit(db: Queryable, organizationId: string, actor: ConfigActor, action: string, entityType: string, entityId: string, payload: Record<string, unknown> = {}) {
  await db.query(`insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload) values ($1, $2, $3, $4, $5, $6)`, [organizationId, actor.personId, action, entityType, entityId, JSON.stringify(payload)])
}

const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
const notFound = (what: string, code: string) => new DomainError(`${what} não encontrado(a).`, code, 404)
const invalid = (issues: ConfigIssue[], code: string) => new DomainError(issues[0]!.message, code, 422, { issues })

function parseOrThrow<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } } }, value: unknown, code: string): T {
  const parsed = schema.safeParse(value)
  if (parsed.success) return parsed.data
  const issues = parsed.error.issues.map((issue) => ({ path: issue.path.map(String).join("."), code, message: `${issue.path.map(String).join(".") || "configuração"}: ${issue.message}` }))
  throw new DomainError(issues[0]?.message ?? "Configuração inválida.", code, 422, { issues })
}

// ---------------------------------------------------------------------------------------------
// TIPOS DE INTERVENÇÃO
// ---------------------------------------------------------------------------------------------

type VersionRow = { id: string; version: number; status: "DRAFT" | "PUBLISHED"; definition: unknown; updated_at: Date; published_at: Date | null; effective_from?: Date | null }
export type VersionView<D> = { id: string; version: number; status: "DRAFT" | "PUBLISHED"; definition: D; updatedAt: string; publishedAt: string | null; effectiveFrom?: string | null }

function toVersionView<D>(row: VersionRow, schema: { safeParse(value: unknown): { success: boolean; data?: D } }): VersionView<D> {
  const parsed = schema.safeParse(row.definition)
  return { id: row.id, version: row.version, status: row.status, definition: (parsed.success ? parsed.data : row.definition) as D, updatedAt: row.updated_at.toISOString(), publishedAt: row.published_at?.toISOString() ?? null, ...(row.effective_from !== undefined ? { effectiveFrom: row.effective_from?.toISOString() ?? null } : {}) }
}

export type InterventionTypeView = {
  id: string
  key: string
  active: boolean
  published: VersionView<InterventionTypeDefinition> | null
  draft: VersionView<InterventionTypeDefinition> | null
  versions: VersionView<InterventionTypeDefinition>[]
  usage: { active: number; total: number }
}

export async function listInterventionTypes(db: Queryable | Database, organizationId: string): Promise<InterventionTypeView[]> {
  const [headers, versions, usage] = await Promise.all([
    db.query<{ id: string; key: string; active: boolean }>(`select id, key, active from intervention_types where organization_id = $1 order by key`, [organizationId]),
    db.query<VersionRow & { type_id: string }>(`select id, type_id, version, status, definition, updated_at, published_at from intervention_type_versions where organization_id = $1 order by version desc`, [organizationId]),
    db.query<{ type_id: string; active: number; total: number }>(
      `select type_id, count(*) filter (where status in ('PROPOSED','AWAITING_APPROVAL','IN_PROGRESS'))::int active, count(*)::int total from interventions where organization_id = $1 group by type_id`,
      [organizationId],
    ),
  ])
  const usageOf = new Map(usage.rows.map((row) => [row.type_id, { active: row.active, total: row.total }]))
  return headers.rows.map((header) => {
    const own = versions.rows.filter((row) => row.type_id === header.id).map((row) => toVersionView<InterventionTypeDefinition>(row, interventionTypeDefinitionSchema))
    return { id: header.id, key: header.key, active: header.active, published: own.find((version) => version.status === "PUBLISHED") ?? null, draft: own.find((version) => version.status === "DRAFT") ?? null, versions: own, usage: usageOf.get(header.id) ?? { active: 0, total: 0 } }
  })
}

export async function getInterventionType(db: Queryable | Database, organizationId: string, typeId: string): Promise<InterventionTypeView> {
  if (!isUuid(typeId)) throw notFound("Tipo de intervenção", "INTERVENTION_TYPE_NOT_FOUND")
  const type = (await listInterventionTypes(db, organizationId)).find((item) => item.id === typeId)
  if (!type) throw notFound("Tipo de intervenção", "INTERVENTION_TYPE_NOT_FOUND")
  return type
}

export async function createInterventionType(db: Database, organizationId: string, actor: ConfigActor, input: { key: string; definition?: unknown }): Promise<InterventionTypeView> {
  const key = String(input.key ?? "").trim()
  if (!/^[A-Z][A-Z0-9_]{1,39}$/.test(key)) throw new DomainError("Chave inválida: use letras maiúsculas, números e _ (2 a 40 caracteres, começando por letra).", "INTERVENTION_TYPE_KEY_INVALID", 422)
  const definition = input.definition === undefined ? emptyInterventionTypeDefinition() : parseOrThrow<InterventionTypeDefinition>(interventionTypeDefinitionSchema, input.definition, "INTERVENTION_TYPE_INVALID")
  const id = await inTransaction(db, async (tx) => {
    const created = (await tx.query<{ id: string }>(`insert into intervention_types (organization_id, key, created_by) values ($1, $2, $3) on conflict (organization_id, key) do nothing returning id`, [organizationId, key, actor.userAccountId])).rows[0]
    if (!created) throw new DomainError(`Já existe um tipo de intervenção com a chave ${key}.`, "INTERVENTION_TYPE_KEY_TAKEN", 409)
    await tx.query(`insert into intervention_type_versions (organization_id, type_id, version, status, definition, created_by) values ($1, $2, 1, 'DRAFT', $3, $4)`, [organizationId, created.id, JSON.stringify(definition), actor.userAccountId])
    await audit(tx, organizationId, actor, "INTERVENTION_TYPE_CREATED", "intervention_type", created.id, { key })
    return created.id
  })
  return getInterventionType(db, organizationId, id)
}

export async function saveInterventionTypeDraft(db: Database, organizationId: string, actor: ConfigActor, typeId: string, rawDefinition: unknown): Promise<InterventionTypeView> {
  const type = await getInterventionType(db, organizationId, typeId)
  const definition = parseOrThrow<InterventionTypeDefinition>(interventionTypeDefinitionSchema, rawDefinition, "INTERVENTION_TYPE_INVALID")
  await inTransaction(db, async (tx) => {
    await tx.query(`select id from intervention_types where id = $1 for update`, [type.id])
    const updated = await tx.query(`update intervention_type_versions set definition = $2, updated_at = now() where type_id = $1 and status = 'DRAFT' returning id`, [type.id, JSON.stringify(definition)])
    if (updated.rowCount === 0) {
      const next = (await tx.query<{ next: number }>(`select coalesce(max(version), 0) + 1 next from intervention_type_versions where type_id = $1`, [type.id])).rows[0]!.next
      await tx.query(`insert into intervention_type_versions (organization_id, type_id, version, status, definition, created_by) values ($1, $2, $3, 'DRAFT', $4, $5)`, [organizationId, type.id, next, JSON.stringify(definition), actor.userAccountId])
    }
    await audit(tx, organizationId, actor, "INTERVENTION_TYPE_DRAFT_SAVED", "intervention_type", type.id, { key: type.key })
  })
  return getInterventionType(db, organizationId, typeId)
}

export async function validateInterventionTypeDraft(db: Queryable | Database, organizationId: string, typeId: string): Promise<ConfigIssue[]> {
  const type = await getInterventionType(db, organizationId, typeId)
  if (!type.draft) return [{ path: "", code: "INTERVENTION_TYPE_DRAFT_NOT_FOUND", message: "Não há rascunho para validar." }]
  const parsed = interventionTypeDefinitionSchema.safeParse(type.draft.definition)
  if (!parsed.success) return parsed.error.issues.map((issue) => ({ path: issue.path.map(String).join("."), code: "INTERVENTION_TYPE_INVALID", message: issue.message }))
  const keys = new Set((await db.query<{ key: string }>(`select key from intervention_types where organization_id = $1`, [organizationId])).rows.map((row) => row.key))
  return validateInterventionType(parsed.data, type.key, keys)
}

export async function publishInterventionTypeDraft(db: Database, organizationId: string, actor: ConfigActor, typeId: string): Promise<InterventionTypeView> {
  const type = await getInterventionType(db, organizationId, typeId)
  if (!type.draft) throw new DomainError("Não há rascunho para publicar.", "INTERVENTION_TYPE_DRAFT_NOT_FOUND", 409)
  const issues = await validateInterventionTypeDraft(db, organizationId, typeId)
  if (issues.length > 0) throw invalid(issues, "INTERVENTION_TYPE_INVALID_FOR_PUBLISH")
  await inTransaction(db, async (tx) => {
    await tx.query(`select id from intervention_types where id = $1 for update`, [type.id])
    const published = await tx.query(`update intervention_type_versions set status = 'PUBLISHED', published_at = now(), published_by = $2, updated_at = now() where id = $1 and status = 'DRAFT'`, [type.draft!.id, actor.userAccountId])
    if (published.rowCount === 0) throw new DomainError("O rascunho mudou durante a publicação. Abra de novo e tente outra vez.", "INTERVENTION_TYPE_CONCURRENT_CHANGE", 409)
    await tx.query(`update intervention_types set updated_at = now() where id = $1`, [type.id])
    await audit(tx, organizationId, actor, "INTERVENTION_TYPE_PUBLISHED", "intervention_type", type.id, { key: type.key, version: type.draft!.version, versionId: type.draft!.id })
  })
  return getInterventionType(db, organizationId, typeId)
}

export async function discardInterventionTypeDraft(db: Database, organizationId: string, actor: ConfigActor, typeId: string): Promise<InterventionTypeView> {
  const type = await getInterventionType(db, organizationId, typeId)
  if (!type.published) throw new DomainError("Um tipo sem versão publicada não tem para onde voltar: edite o rascunho ou inative o tipo.", "INTERVENTION_TYPE_DRAFT_ONLY", 409)
  await inTransaction(db, async (tx) => {
    const discarded = await tx.query(`delete from intervention_type_versions where type_id = $1 and status = 'DRAFT' returning version`, [type.id])
    if (discarded.rowCount) await audit(tx, organizationId, actor, "INTERVENTION_TYPE_DRAFT_DISCARDED", "intervention_type", type.id, { key: type.key })
  })
  return getInterventionType(db, organizationId, typeId)
}

export async function setInterventionTypeActive(db: Database, organizationId: string, actor: ConfigActor, typeId: string, active: boolean): Promise<InterventionTypeView> {
  const type = await getInterventionType(db, organizationId, typeId)
  await inTransaction(db, async (tx) => {
    await tx.query(`update intervention_types set active = $2, updated_at = now() where id = $1`, [type.id, active])
    await audit(tx, organizationId, actor, active ? "INTERVENTION_TYPE_ACTIVATED" : "INTERVENTION_TYPE_DEACTIVATED", "intervention_type", type.id, { key: type.key })
  })
  return getInterventionType(db, organizationId, typeId)
}

// ---------------------------------------------------------------------------------------------
// CATÁLOGO DO EDITOR
// ---------------------------------------------------------------------------------------------

export type EditorCatalogTeam = { id: string; name: string; operationId: string; subteams: { id: string; teamId: string; name: string }[] }
export type EditorCatalog = {
  /** Grupos e subgrupos que o escopo de quem edita cobre; `unrestricted` = pode escolher "toda a organização". */
  teams: EditorCatalogTeam[]
  unrestricted: boolean
  indicators: { code: string; name: string; unit: string; active: boolean; dailySupported: boolean; officialClosureSupported: boolean }[]
  /** Só título e se há versão publicada — o conteúdo continua com a permissão da base de conhecimento. */
  documents: { id: string; title: string; published: boolean }[]
  /** Catálogo de flags por canal (as flags chegam calculadas com cada atendimento). */
  flags: { channel: string; flagName: string; valueType: "BOOLEAN" | "NUMERIC"; description: string | null; active: boolean }[]
}

/**
 * Leituras mínimas de que o editor de políticas precisa (grupos para o escopo, indicadores para as condições, documentos para as
 * competências), servidas pela própria área: quem edita políticas não precisa da permissão de configurar a estrutura, o catálogo
 * de indicadores ou a base de conhecimento para escolher entre eles.
 */
export async function loadEditorCatalog(db: Database, organizationId: string, scope: { unrestricted: boolean; teamIds: ReadonlySet<string>; subteamIds: ReadonlySet<string> }): Promise<EditorCatalog> {
  const [teams, subteams, indicators, documents, flags] = await Promise.all([
    db.query<{ id: string; name: string; operationId: string }>(`select id, name, operation_id "operationId" from teams where organization_id = $1 order by name`, [organizationId]),
    db.query<{ id: string; teamId: string; name: string }>(`select id, team_id "teamId", name from subteams where organization_id = $1 order by name`, [organizationId]),
    db.query<EditorCatalog["indicators"][number]>(
      `select code, name, unit, active, daily_supported "dailySupported", official_closure_supported "officialClosureSupported" from indicator_definitions where organization_id = $1 order by name`,
      [organizationId],
    ),
    db.query<EditorCatalog["documents"][number]>(
      `select d.id, d.title, exists (select 1 from knowledge_versions v where v.document_id = d.id and v.status = 'PUBLISHED') published from knowledge_documents d where d.organization_id = $1 and d.deleted_at is null order by d.title`,
      [organizationId],
    ),
    db.query<EditorCatalog["flags"][number]>(`select channel, flag_name "flagName", value_type "valueType", description, active from channel_flags where organization_id = $1 order by channel, flag_name`, [organizationId]),
  ])
  const visibleTeams = teams.rows
    .map((team) => ({ ...team, subteams: subteams.rows.filter((subteam) => subteam.teamId === team.id && (scope.unrestricted || scope.teamIds.has(team.id) || scope.subteamIds.has(subteam.id))) }))
    .filter((team) => scope.unrestricted || scope.teamIds.has(team.id) || team.subteams.length > 0)
  return { teams: visibleTeams, unrestricted: scope.unrestricted, indicators: indicators.rows, documents: documents.rows, flags: flags.rows }
}

export type PatternOption = { key: string; kind: "PRACTICE" | "CRITERION"; title: string; detail: string | null }

/**
 * Práticas (KP-…) e critérios (KC-…) da base para ligar uma competência ao diagnóstico — pelo NOME, nunca pela chave digitada.
 * `keys` devolve o rótulo das já escolhidas; `search` busca por título/texto (no máximo 30 de cada).
 */
export async function searchPatternOptions(db: Database, organizationId: string, input: { search?: string; keys?: string[] }): Promise<PatternOption[]> {
  const term = input.search?.trim() ? `%${input.search.trim().replace(/[%_\\]/g, (char) => `\\${char}`)}%` : null
  const keys = (input.keys ?? []).filter(Boolean).slice(0, 100)
  if (!term && keys.length === 0) return []
  const [practices, criteria] = await Promise.all([
    db.query<{ key: string; title: string; short_title: string | null; theme: string | null }>(
      `select p.practice_key key, p.title, p.short_title, t.title theme from knowledge_practices p left join knowledge_practice_themes t on t.organization_id = p.organization_id and t.theme_key = p.theme_key
        where p.organization_id = $1 and (($2::text is not null and (p.title ilike $2 or p.short_title ilike $2)) or p.practice_key = any($3::text[]))
        order by p.title limit 60`,
      [organizationId, term, keys],
    ),
    db.query<{ key: string; text: string; heading: string | null; document: string | null }>(
      `select distinct on (c.criterion_key) c.criterion_key key, c.text, c.section_heading heading, d.title document from knowledge_criteria c left join knowledge_documents d on d.id = c.document_id
        where c.organization_id = $1 and (($2::text is not null and (c.text ilike $2 or c.section_heading ilike $2)) or c.criterion_key = any($3::text[]))
        order by c.criterion_key, c.document_version desc limit 60`,
      [organizationId, term, keys],
    ),
  ])
  return [
    ...practices.rows.map((row): PatternOption => ({ key: row.key, kind: "PRACTICE", title: row.title, detail: row.theme ?? row.short_title })),
    ...criteria.rows.map((row): PatternOption => ({ key: row.key, kind: "CRITERION", title: row.text.length > 160 ? `${row.text.slice(0, 157)}…` : row.text, detail: [row.document, row.heading].filter(Boolean).join(" · ") || null })),
  ]
}

// ---------------------------------------------------------------------------------------------
// COMPETÊNCIAS
// ---------------------------------------------------------------------------------------------

export type CompetencyView = CompetencyInput & { id: string; active: boolean; documents: { id: string; title: string; published: boolean }[]; updatedAt: string }

export async function listCompetencies(db: Queryable | Database, organizationId: string): Promise<CompetencyView[]> {
  const rows = await db.query<{ id: string; key: string; name: string; description: string; knowledge_document_ids: string[]; practice_keys: string[]; criterion_keys: string[]; indicator_codes: string[]; activities: CompetencyInput["activities"]; active: boolean; updated_at: Date }>(
    `select id, key, name, description, knowledge_document_ids, practice_keys, criterion_keys, indicator_codes, activities, active, updated_at from competencies where organization_id = $1 order by name`,
    [organizationId],
  )
  const documentIds = [...new Set(rows.rows.flatMap((row) => row.knowledge_document_ids))]
  const documents = documentIds.length
    ? new Map((await db.query<{ id: string; title: string; published: boolean }>(
        `select d.id, d.title, exists (select 1 from knowledge_versions v where v.document_id = d.id and v.status = 'PUBLISHED') published from knowledge_documents d where d.organization_id = $1 and d.id = any($2::uuid[]) and d.deleted_at is null`,
        [organizationId, documentIds],
      )).rows.map((row) => [row.id, row]))
    : new Map<string, { id: string; title: string; published: boolean }>()
  return rows.rows.map((row) => ({
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    knowledgeDocumentIds: row.knowledge_document_ids,
    practiceKeys: row.practice_keys,
    criterionKeys: row.criterion_keys,
    indicatorCodes: row.indicator_codes,
    activities: row.activities,
    active: row.active,
    documents: row.knowledge_document_ids.map((id) => documents.get(id) ?? { id, title: "Documento removido", published: false }),
    updatedAt: row.updated_at.toISOString(),
  }))
}

async function competencyIssues(db: Queryable | Database, organizationId: string, input: CompetencyInput): Promise<ConfigIssue[]> {
  const issues: ConfigIssue[] = []
  const [documents, practices, criteria, indicators] = await Promise.all([
    db.query<{ id: string }>(`select id from knowledge_documents where organization_id = $1 and id = any($2::uuid[]) and deleted_at is null`, [organizationId, input.knowledgeDocumentIds]),
    db.query<{ practice_key: string }>(`select practice_key from knowledge_practices where organization_id = $1 and practice_key = any($2::text[])`, [organizationId, input.practiceKeys.filter((key) => key.startsWith("KP-"))]),
    db.query<{ criterion_key: string }>(`select distinct criterion_key from knowledge_criteria where organization_id = $1 and criterion_key = any($2::text[])`, [organizationId, input.criterionKeys]),
    db.query<{ code: string }>(`select code from indicator_definitions where organization_id = $1 and code = any($2::text[])`, [organizationId, input.indicatorCodes]),
  ])
  const known = { documents: new Set(documents.rows.map((row) => row.id)), practices: new Set(practices.rows.map((row) => row.practice_key)), criteria: new Set(criteria.rows.map((row) => row.criterion_key)), indicators: new Set(indicators.rows.map((row) => row.code)) }
  input.knowledgeDocumentIds.forEach((id, index) => { if (!known.documents.has(id)) issues.push({ path: `knowledgeDocumentIds.${index}`, code: "COMPETENCY_DOCUMENT_NOT_FOUND", message: "Um dos documentos escolhidos não existe mais na base de conhecimento." }) })
  input.practiceKeys.forEach((key, index) => { if (key.startsWith("KP-") && !known.practices.has(key)) issues.push({ path: `practiceKeys.${index}`, code: "COMPETENCY_PRACTICE_NOT_FOUND", message: `A prática ${key} não existe nesta organização.` }) })
  input.criterionKeys.forEach((key, index) => { if (!known.criteria.has(key)) issues.push({ path: `criterionKeys.${index}`, code: "COMPETENCY_CRITERION_NOT_FOUND", message: `O critério ${key} não existe nesta organização.` }) })
  input.indicatorCodes.forEach((code, index) => { if (!known.indicators.has(code)) issues.push({ path: `indicatorCodes.${index}`, code: "COMPETENCY_INDICATOR_NOT_FOUND", message: `O indicador ${code} não existe nesta organização.` }) })
  input.activities.forEach((activity, index) => { if (activity.documentId && !known.documents.has(activity.documentId) && !input.knowledgeDocumentIds.includes(activity.documentId)) issues.push({ path: `activities.${index}.documentId`, code: "COMPETENCY_DOCUMENT_NOT_FOUND", message: `A atividade "${activity.title}" aponta para um documento que não existe.` }) })
  const activityKeys = new Set<string>()
  input.activities.forEach((activity, index) => { if (activityKeys.has(activity.key)) issues.push({ path: `activities.${index}.key`, code: "COMPETENCY_ACTIVITY_DUPLICATED", message: `A chave de atividade ${activity.key} está repetida.` }); activityKeys.add(activity.key) })
  if (input.practiceKeys.some((key) => !PATTERN_KEY.test(key))) issues.push({ path: "practiceKeys", code: "COMPETENCY_PRACTICE_INVALID", message: "Chave de prática inválida." })
  return issues
}

export async function createCompetency(db: Database, organizationId: string, actor: ConfigActor, raw: unknown): Promise<CompetencyView> {
  const input = parseOrThrow<CompetencyInput>(competencyInputSchema, raw, "COMPETENCY_INVALID")
  const issues = await competencyIssues(db, organizationId, input)
  if (issues.length > 0) throw invalid(issues, "COMPETENCY_INVALID")
  const id = await inTransaction(db, async (tx) => {
    const row = (await tx.query<{ id: string }>(
      `insert into competencies (organization_id, key, name, description, knowledge_document_ids, practice_keys, criterion_keys, indicator_codes, activities, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict (organization_id, key) do nothing returning id`,
      [organizationId, input.key, input.name, input.description, input.knowledgeDocumentIds, input.practiceKeys, input.criterionKeys, input.indicatorCodes, JSON.stringify(input.activities), actor.userAccountId],
    )).rows[0]
    if (!row) throw new DomainError(`Já existe uma competência com a chave ${input.key}.`, "COMPETENCY_KEY_TAKEN", 409)
    await audit(tx, organizationId, actor, "COMPETENCY_CREATED", "competency", row.id, { key: input.key })
    return row.id
  })
  return (await listCompetencies(db, organizationId)).find((item) => item.id === id)!
}

export async function updateCompetency(db: Database, organizationId: string, actor: ConfigActor, competencyId: string, raw: unknown): Promise<CompetencyView> {
  if (!isUuid(competencyId)) throw notFound("Competência", "COMPETENCY_NOT_FOUND")
  const input = parseOrThrow<CompetencyInput>(competencyInputSchema, raw, "COMPETENCY_INVALID")
  const issues = await competencyIssues(db, organizationId, input)
  if (issues.length > 0) throw invalid(issues, "COMPETENCY_INVALID")
  await inTransaction(db, async (tx) => {
    const current = (await tx.query<{ key: string }>(`select key from competencies where id = $1 and organization_id = $2 for update`, [competencyId, organizationId])).rows[0]
    if (!current) throw notFound("Competência", "COMPETENCY_NOT_FOUND")
    // A chave é a identidade usada por políticas publicadas: nunca muda (como a do tipo e a da política).
    if (current.key !== input.key) throw new DomainError("A chave da competência não muda depois de criada.", "COMPETENCY_KEY_LOCKED", 409)
    await tx.query(
      `update competencies set name = $3, description = $4, knowledge_document_ids = $5, practice_keys = $6, criterion_keys = $7, indicator_codes = $8, activities = $9, updated_at = now() where id = $1 and organization_id = $2`,
      [competencyId, organizationId, input.name, input.description, input.knowledgeDocumentIds, input.practiceKeys, input.criterionKeys, input.indicatorCodes, JSON.stringify(input.activities)],
    )
    await audit(tx, organizationId, actor, "COMPETENCY_UPDATED", "competency", competencyId, { key: input.key })
  })
  return (await listCompetencies(db, organizationId)).find((item) => item.id === competencyId)!
}

export async function setCompetencyActive(db: Database, organizationId: string, actor: ConfigActor, competencyId: string, active: boolean): Promise<CompetencyView> {
  if (!isUuid(competencyId)) throw notFound("Competência", "COMPETENCY_NOT_FOUND")
  await inTransaction(db, async (tx) => {
    const updated = await tx.query(`update competencies set active = $3, updated_at = now() where id = $1 and organization_id = $2`, [competencyId, organizationId, active])
    if (updated.rowCount === 0) throw notFound("Competência", "COMPETENCY_NOT_FOUND")
    await audit(tx, organizationId, actor, active ? "COMPETENCY_ACTIVATED" : "COMPETENCY_DEACTIVATED", "competency", competencyId)
  })
  return (await listCompetencies(db, organizationId)).find((item) => item.id === competencyId)!
}

// ---------------------------------------------------------------------------------------------
// POLÍTICAS
// ---------------------------------------------------------------------------------------------

export type PolicyScopeInput = { scopeType: "ORGANIZATION" | "GROUP" | "SUBGROUP"; teamId: string | null; subteamId: string | null }

export type PolicyView = PolicyHeader & {
  draft: VersionView<PolicyDefinition> | null
  /** Em vigor agora (a publicada de maior vigência até agora). */
  inForce: VersionView<PolicyDefinition> | null
  /** Publicadas com vigência futura (ainda não em vigor). */
  scheduled: VersionView<PolicyDefinition>[]
  versions: VersionView<PolicyDefinition>[]
  scopeLabel: string
  evaluations: { last30Days: number }
}

export async function listPolicies(db: Queryable | Database, organizationId: string, now: Date = new Date()): Promise<PolicyView[]> {
  const [headers, versions, counts] = await Promise.all([
    db.query<{ id: string; key: string; name: string; scope_type: PolicyHeader["scopeType"]; team_id: string | null; subteam_id: string | null; active: boolean; team_name: string | null; subteam_name: string | null }>(
      `select p.id, p.key, p.name, p.scope_type, p.team_id, p.subteam_id, p.active, t.name team_name, s.name subteam_name
         from intervention_policies p left join teams t on t.id = p.team_id left join subteams s on s.id = p.subteam_id
        where p.organization_id = $1 order by p.name`,
      [organizationId],
    ),
    db.query<VersionRow & { policy_id: string }>(`select id, policy_id, version, status, definition, updated_at, published_at, effective_from from intervention_policy_versions where organization_id = $1 order by version desc`, [organizationId]),
    db.query<{ policy_id: string; count: number }>(`select policy_id, count(*)::int count from intervention_policy_evaluations where organization_id = $1 and evaluated_at >= $2 group by policy_id`, [organizationId, new Date(now.getTime() - 30 * 86_400_000)]),
  ])
  const countOf = new Map(counts.rows.map((row) => [row.policy_id, row.count]))
  return headers.rows.map((header) => {
    const own = versions.rows.filter((row) => row.policy_id === header.id).map((row) => toVersionView<PolicyDefinition>(row, policyDefinitionSchema))
    const published = own.filter((version) => version.status === "PUBLISHED")
    const inForce = published.filter((version) => new Date(version.effectiveFrom!).getTime() <= now.getTime()).sort((a, b) => b.effectiveFrom!.localeCompare(a.effectiveFrom!) || b.version - a.version)[0] ?? null
    return {
      id: header.id,
      key: header.key,
      name: header.name,
      scopeType: header.scope_type,
      teamId: header.team_id,
      subteamId: header.subteam_id,
      active: header.active,
      scopeLabel: header.scope_type === "ORGANIZATION" ? "Organização inteira" : header.scope_type === "GROUP" ? `Grupo ${header.team_name ?? ""}`.trim() : `Subgrupo ${header.subteam_name ?? ""}`.trim(),
      draft: own.find((version) => version.status === "DRAFT") ?? null,
      inForce,
      scheduled: published.filter((version) => new Date(version.effectiveFrom!).getTime() > now.getTime()),
      versions: own,
      evaluations: { last30Days: countOf.get(header.id) ?? 0 },
    }
  })
}

export async function getPolicy(db: Queryable | Database, organizationId: string, policyId: string, now: Date = new Date()): Promise<PolicyView> {
  if (!isUuid(policyId)) throw notFound("Política", "INTERVENTION_POLICY_NOT_FOUND")
  const policy = (await listPolicies(db, organizationId, now)).find((item) => item.id === policyId)
  if (!policy) throw notFound("Política", "INTERVENTION_POLICY_NOT_FOUND")
  return policy
}

async function validateScopeInput(db: Queryable | Database, organizationId: string, scope: PolicyScopeInput): Promise<void> {
  if (scope.scopeType === "ORGANIZATION") return
  const team = scope.teamId && isUuid(scope.teamId) ? (await db.query(`select 1 from teams where id = $1 and organization_id = $2`, [scope.teamId, organizationId])).rowCount : 0
  if (!team) throw new DomainError("Grupo não encontrado.", "INTERVENTION_POLICY_SCOPE_INVALID", 422)
  if (scope.scopeType === "SUBGROUP") {
    const subteam = scope.subteamId && isUuid(scope.subteamId) ? (await db.query(`select 1 from subteams where id = $1 and team_id = $2 and organization_id = $3`, [scope.subteamId, scope.teamId, organizationId])).rowCount : 0
    if (!subteam) throw new DomainError("Subgrupo não encontrado neste Grupo.", "INTERVENTION_POLICY_SCOPE_INVALID", 422)
  }
}

export async function createPolicy(db: Database, organizationId: string, actor: ConfigActor, input: { key: string; name: string } & PolicyScopeInput): Promise<PolicyView> {
  const key = String(input.key ?? "").trim()
  const name = String(input.name ?? "").trim()
  if (!/^[A-Z][A-Z0-9_]{1,39}$/.test(key)) throw new DomainError("Chave inválida: use letras maiúsculas, números e _ (2 a 40 caracteres, começando por letra).", "INTERVENTION_POLICY_KEY_INVALID", 422)
  if (name.length === 0 || name.length > 120) throw new DomainError("Dê um nome à política (até 120 caracteres).", "INTERVENTION_POLICY_NAME_INVALID", 422)
  await validateScopeInput(db, organizationId, input)
  const id = await inTransaction(db, async (tx) => {
    const created = (await tx.query<{ id: string }>(
      `insert into intervention_policies (organization_id, key, name, scope_type, team_id, subteam_id, created_by) values ($1,$2,$3,$4,$5,$6,$7) on conflict (organization_id, key) do nothing returning id`,
      [organizationId, key, name, input.scopeType, input.scopeType === "ORGANIZATION" ? null : input.teamId, input.scopeType === "SUBGROUP" ? input.subteamId : null, actor.userAccountId],
    )).rows[0]
    if (!created) throw new DomainError(`Já existe uma política com a chave ${key}.`, "INTERVENTION_POLICY_KEY_TAKEN", 409)
    await tx.query(`insert into intervention_policy_versions (organization_id, policy_id, version, status, definition, created_by) values ($1, $2, 1, 'DRAFT', $3, $4)`, [organizationId, created.id, JSON.stringify(emptyPolicyDefinition()), actor.userAccountId])
    await audit(tx, organizationId, actor, "INTERVENTION_POLICY_CREATED", "intervention_policy", created.id, { key, scopeType: input.scopeType })
    return created.id
  })
  return getPolicy(db, organizationId, id)
}

/** Nome muda a qualquer momento; o ESCOPO só enquanto nada foi publicado (mudar depois mudaria quem as versões alcançam). */
export async function updatePolicyHeader(db: Database, organizationId: string, actor: ConfigActor, policyId: string, input: { name?: string | undefined; scopeType?: PolicyScopeInput["scopeType"] | undefined; teamId?: string | null | undefined; subteamId?: string | null | undefined }): Promise<PolicyView> {
  const policy = await getPolicy(db, organizationId, policyId)
  const name = input.name !== undefined ? String(input.name).trim() : policy.name
  if (name.length === 0 || name.length > 120) throw new DomainError("Dê um nome à política (até 120 caracteres).", "INTERVENTION_POLICY_NAME_INVALID", 422)
  const scopeChanged = input.scopeType !== undefined && (input.scopeType !== policy.scopeType || (input.teamId ?? null) !== policy.teamId || (input.subteamId ?? null) !== policy.subteamId)
  if (scopeChanged) {
    if (policy.versions.some((version) => version.status === "PUBLISHED")) throw new DomainError("O escopo não muda depois da primeira publicação: crie outra política para outro escopo.", "INTERVENTION_POLICY_SCOPE_LOCKED", 409)
    await validateScopeInput(db, organizationId, { scopeType: input.scopeType!, teamId: input.teamId ?? null, subteamId: input.subteamId ?? null })
  }
  await inTransaction(db, async (tx) => {
    await tx.query(
      `update intervention_policies set name = $3, scope_type = $4, team_id = $5, subteam_id = $6, updated_at = now() where id = $1 and organization_id = $2`,
      [policyId, organizationId, name, scopeChanged ? input.scopeType : policy.scopeType, scopeChanged ? (input.scopeType === "ORGANIZATION" ? null : input.teamId) : policy.teamId, scopeChanged ? (input.scopeType === "SUBGROUP" ? input.subteamId : null) : policy.subteamId],
    )
    await audit(tx, organizationId, actor, "INTERVENTION_POLICY_UPDATED", "intervention_policy", policyId, { name, ...(scopeChanged ? { scopeType: input.scopeType } : {}) })
  })
  return getPolicy(db, organizationId, policyId)
}

export async function savePolicyDraft(db: Database, organizationId: string, actor: ConfigActor, policyId: string, rawDefinition: unknown): Promise<PolicyView> {
  const policy = await getPolicy(db, organizationId, policyId)
  const definition = parseOrThrow<PolicyDefinition>(policyDefinitionSchema, rawDefinition, "INTERVENTION_POLICY_INVALID")
  await inTransaction(db, async (tx) => {
    await tx.query(`select id from intervention_policies where id = $1 for update`, [policy.id])
    const updated = await tx.query(`update intervention_policy_versions set definition = $2, updated_at = now() where policy_id = $1 and status = 'DRAFT'`, [policy.id, JSON.stringify(definition)])
    if (updated.rowCount === 0) {
      const next = (await tx.query<{ next: number }>(`select coalesce(max(version), 0) + 1 next from intervention_policy_versions where policy_id = $1`, [policy.id])).rows[0]!.next
      await tx.query(`insert into intervention_policy_versions (organization_id, policy_id, version, status, definition, created_by) values ($1, $2, $3, 'DRAFT', $4, $5)`, [organizationId, policy.id, next, JSON.stringify(definition), actor.userAccountId])
    }
    await audit(tx, organizationId, actor, "INTERVENTION_POLICY_DRAFT_SAVED", "intervention_policy", policy.id, { key: policy.key })
  })
  return getPolicy(db, organizationId, policyId)
}

export async function validatePolicyDraft(db: Queryable | Database, organizationId: string, policyId: string): Promise<ConfigIssue[]> {
  const policy = await getPolicy(db, organizationId, policyId)
  if (!policy.draft) return [{ path: "", code: "INTERVENTION_POLICY_DRAFT_NOT_FOUND", message: "Não há rascunho para validar." }]
  const parsed = policyDefinitionSchema.safeParse(policy.draft.definition)
  if (!parsed.success) return parsed.error.issues.map((issue) => ({ path: issue.path.map(String).join("."), code: "INTERVENTION_POLICY_INVALID", message: issue.message }))
  return validatePolicyDefinition(parsed.data, await loadValidationCatalog(db, organizationId))
}

export async function publishPolicyDraft(db: Database, organizationId: string, actor: ConfigActor, policyId: string, input: { effectiveFrom?: string | null | undefined } = {}, now: Date = new Date()): Promise<PolicyView> {
  const policy = await getPolicy(db, organizationId, policyId, now)
  if (!policy.draft) throw new DomainError("Não há rascunho para publicar.", "INTERVENTION_POLICY_DRAFT_NOT_FOUND", 409)
  // Vigência nunca retroativa: o que estava em vigor num instante passado continua sendo o que estava (reprodutibilidade).
  const effectiveFrom = input.effectiveFrom ? new Date(input.effectiveFrom) : now
  if (Number.isNaN(effectiveFrom.getTime())) throw new DomainError("Data de vigência inválida.", "INTERVENTION_POLICY_EFFECTIVE_FROM_INVALID", 422)
  if (effectiveFrom.getTime() < now.getTime() - 60_000) throw new DomainError("A vigência não pode começar no passado.", "INTERVENTION_POLICY_EFFECTIVE_FROM_PAST", 422)
  const issues = await validatePolicyDraft(db, organizationId, policyId)
  if (issues.length > 0) throw invalid(issues, "INTERVENTION_POLICY_INVALID_FOR_PUBLISH")
  await inTransaction(db, async (tx) => {
    await tx.query(`select id from intervention_policies where id = $1 for update`, [policy.id])
    const published = await tx.query(
      `update intervention_policy_versions set status = 'PUBLISHED', published_at = $3, published_by = $2, effective_from = greatest($4::timestamptz, $3::timestamptz), updated_at = now() where id = $1 and status = 'DRAFT'`,
      [policy.draft!.id, actor.userAccountId, now, effectiveFrom],
    )
    if (published.rowCount === 0) throw new DomainError("O rascunho mudou durante a publicação. Abra de novo e tente outra vez.", "INTERVENTION_POLICY_CONCURRENT_CHANGE", 409)
    await tx.query(`update intervention_policies set updated_at = now() where id = $1`, [policy.id])
    await audit(tx, organizationId, actor, "INTERVENTION_POLICY_PUBLISHED", "intervention_policy", policy.id, { key: policy.key, version: policy.draft!.version, versionId: policy.draft!.id, effectiveFrom: effectiveFrom.toISOString() })
  })
  return getPolicy(db, organizationId, policyId, now)
}

export async function discardPolicyDraft(db: Database, organizationId: string, actor: ConfigActor, policyId: string): Promise<PolicyView> {
  const policy = await getPolicy(db, organizationId, policyId)
  if (!policy.versions.some((version) => version.status === "PUBLISHED")) throw new DomainError("Uma política sem versão publicada não tem para onde voltar: edite o rascunho ou inative a política.", "INTERVENTION_POLICY_DRAFT_ONLY", 409)
  await inTransaction(db, async (tx) => {
    const discarded = await tx.query(`delete from intervention_policy_versions where policy_id = $1 and status = 'DRAFT'`, [policy.id])
    if (discarded.rowCount) await audit(tx, organizationId, actor, "INTERVENTION_POLICY_DRAFT_DISCARDED", "intervention_policy", policy.id, { key: policy.key })
  })
  return getPolicy(db, organizationId, policyId)
}

/** Inativar = novas avaliações respondem "política não aplicável"; intervenções já abertas seguem com as versões delas. */
export async function setPolicyActive(db: Database, organizationId: string, actor: ConfigActor, policyId: string, active: boolean): Promise<PolicyView> {
  const policy = await getPolicy(db, organizationId, policyId)
  await inTransaction(db, async (tx) => {
    await tx.query(`update intervention_policies set active = $2, updated_at = now() where id = $1`, [policy.id, active])
    await audit(tx, organizationId, actor, active ? "INTERVENTION_POLICY_ACTIVATED" : "INTERVENTION_POLICY_DEACTIVATED", "intervention_policy", policy.id, { key: policy.key })
  })
  return getPolicy(db, organizationId, policyId)
}

export async function loadPolicyOrThrow(db: Queryable | Database, organizationId: string, policyId: string): Promise<PolicyHeader> {
  const header = await loadPolicyHeader(db, organizationId, policyId)
  if (!header) throw notFound("Política", "INTERVENTION_POLICY_NOT_FOUND")
  return header
}
