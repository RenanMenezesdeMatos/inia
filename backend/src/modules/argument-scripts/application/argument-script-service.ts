import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { SqlFilter, booleanParam, respondList, searchParam, type PageResult } from "../../../shared/presentation/list-query.js"
import { canManageScope, type ManageableScopes } from "../../auth/application/manageable-scopes.js"
import {
  contentHashOf,
  normalizeArgumentScriptContent,
  publishIssuesOf,
  PUBLISH_BACKDATE_TOLERANCE_MS,
  readStoredContent,
  type ArgumentScriptContent,
  type PublishIssue,
  type ScriptScope,
} from "../domain/argument-script.js"

/**
 * CADASTRO DE ARGUMENTÁRIOS (serviço único — rota admin e provas usam o mesmo). Organização SEMPRE da sessão; permissão
 * `configuration.manage` (a mesma das antigas Regras de chamada) com o ESCOPO das atribuições do usuário:
 *   - administrar (criar, editar, publicar, encerrar) exige que o escopo do usuário COBRA o escopo do argumentário — "todos os
 *     grupos" só com a permissão na organização inteira; Grupo → o Grupo e os Subgrupos dele; Subgrupo → só ele;
 *   - ler: o que o usuário administra + o que vale para o escopo dele vindo de cima (todos os grupos, ou o Grupo dos Subgrupos que
 *     ele administra) — somente leitura (`canEdit = false`).
 * Publicar ≠ aprovar feedback: o argumentário publicado vira fonte do motor; a análise de cada chamada continua automática.
 * Versão publicada é imutável (gatilho no banco); a vigência começa na publicação (ou depois) — nunca retroativa — e termina quando
 * outra versão começa ou o argumentário é desativado (`ARCHIVED`). Excluir de vez só enquanto nenhuma análise o usou.
 */
export type ArgumentScriptActor = { organizationId: string; personId: string | null }

const scopeInputSchema = z.object({ scopeType: z.enum(["ALL_TEAMS", "TEAM", "SUBTEAM"]), teamId: z.string().uuid().nullish(), subteamId: z.string().uuid().nullish() })
export const createInputSchema = z.object({
  name: z.string().trim().min(3).max(160),
  businessDomainId: z.string().uuid().nullish(),
  scope: scopeInputSchema,
  content: z.unknown().optional(),
  sourceDocumentId: z.string().uuid().nullish(),
  sourceReference: z.string().trim().max(400).nullish(),
})
export const updateInputSchema = z.object({
  name: z.string().trim().min(3).max(160).optional(),
  businessDomainId: z.string().uuid().nullish(),
  scope: scopeInputSchema.optional(),
  content: z.unknown().optional(),
  sourceDocumentId: z.string().uuid().nullish(),
  sourceReference: z.string().trim().max(400).nullish(),
})
export const publishInputSchema = z.object({ effectiveFrom: z.coerce.date().optional() })
export const listQuerySchema = z.object({
  search: searchParam,
  status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
  businessDomainId: z.string().uuid().optional(),
  scopeType: z.enum(["ALL_TEAMS"]).optional(),
  teamId: z.string().uuid().optional(),
  subteamId: z.string().uuid().optional(),
  conversion: z.enum(["NATIVE", "LEGACY_UNSTRUCTURED"]).optional(),
  hasDraft: booleanParam,
})

type ScriptRow = {
  id: string
  name: string
  businessDomainId: string | null
  businessDomainName: string | null
  scopeType: ScriptScope["scopeType"]
  teamId: string | null
  teamName: string | null
  subteamId: string | null
  subteamName: string | null
  subjectName: string | null
  status: "ACTIVE" | "ARCHIVED"
  conversion: "NATIVE" | "LEGACY_UNSTRUCTURED"
  currentVersion: number | null
  currentEffectiveFrom: Date | null
  currentEffectiveUntil: Date | null
  draftVersion: number | null
  updatedAt: Date
  createdAt: Date
}

const SELECT_SCRIPTS = `
  select s.id, s.name, s.business_domain_id "businessDomainId", bd.name "businessDomainName",
         s.scope_type "scopeType", s.team_id "teamId", t.name "teamName", s.subteam_id "subteamId", st.name "subteamName", sub.name "subjectName",
         s.status, s.conversion, cur.version "currentVersion", cur.effective_from "currentEffectiveFrom", cur.effective_until "currentEffectiveUntil",
         dr.version "draftVersion", s.updated_at "updatedAt", s.created_at "createdAt"
  from argument_scripts s
  left join business_domains bd on bd.id = s.business_domain_id
  left join teams t on t.id = s.team_id
  left join subteams st on st.id = s.subteam_id
  left join subjects sub on sub.id = s.subject_id
  left join lateral (select version, effective_from, effective_until from argument_script_versions v where v.script_id = s.id and v.status = 'PUBLISHED' limit 1) cur on true
  left join lateral (select version from argument_script_versions v where v.script_id = s.id and v.status = 'DRAFT' limit 1) dr on true
  where s.organization_id = $1
`

const scopeOf = (row: Pick<ScriptRow, "scopeType" | "teamId" | "subteamId">): ScriptScope => ({ scopeType: row.scopeType, teamId: row.teamId, subteamId: row.subteamId })

async function audit(db: Pick<Database, "query">, actor: ArgumentScriptActor, action: string, entityId: string, payload: Record<string, unknown>) {
  await db.query(`insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload) values ($1, $2, $3, 'argument_script', $4, $5)`, [actor.organizationId, actor.personId, action, entityId, JSON.stringify(payload)])
}

/** Teams dos Subgrupos que o usuário administra (para mostrar, somente leitura, o que vale para eles vindo do Grupo). */
async function parentTeamsOf(db: Pick<Database, "query">, scopes: ManageableScopes): Promise<string[]> {
  if (scopes.unrestricted || scopes.allTeams || scopes.subteamIds.size === 0) return []
  return (await db.query<{ team_id: string }>(`select distinct team_id from subteams where id = any($1::uuid[])`, [[...scopes.subteamIds]])).rows.map((row) => row.team_id)
}

function visibilityClause(filter: SqlFilter, scopes: ManageableScopes, parentTeams: readonly string[]) {
  if (scopes.unrestricted || scopes.allTeams) return
  const teams = filter.param([...scopes.teamIds, ...parentTeams])
  const subteams = filter.param([...scopes.subteamIds])
  filter.add(`(q."scopeType" = 'ALL_TEAMS' or (q."scopeType" = 'TEAM' and q."teamId" = any(${teams}::uuid[])) or (q."scopeType" = 'SUBTEAM' and q."subteamId" = any(${subteams}::uuid[])))`)
}

export async function listArgumentScripts(db: Database, organizationId: string, scopes: ManageableScopes, query: Record<string, unknown>) {
  const input = listQuerySchema.parse(query)
  const filter = new SqlFilter([organizationId])
    .search(input.search, ["q.name", 'q."businessDomainName"', 'q."teamName"', 'q."subteamName"'])
    .equals("q.status", input.status)
    .equals('q."businessDomainId"', input.businessDomainId)
    .equals("q.conversion", input.conversion)
    .orgScope("q", input)
  if (input.hasDraft !== undefined) filter.add(input.hasDraft ? `q."draftVersion" is not null` : `q."draftVersion" is null`)
  visibilityClause(filter, scopes, await parentTeamsOf(db, scopes))
  const data = await respondList<ScriptRow>(db, query, { select: SELECT_SCRIPTS, filter, orderBy: `q.status, q."updatedAt" desc, q.id` })
  const decorate = (row: ScriptRow) => ({ ...row, canEdit: canManageScope(scopes, scopeOf(row)) })
  return Array.isArray(data) ? data.map(decorate) : ({ ...data, items: data.items.map(decorate) } satisfies PageResult<ReturnType<typeof decorate>>)
}

type VersionRow = { id: string; version: number; status: "DRAFT" | "PUBLISHED" | "SUPERSEDED"; content: unknown; content_hash: string; source_document_id: string | null; source_document_title: string | null; source_reference: string | null; effective_from: Date | null; effective_until: Date | null; published_at: Date | null; published_by_name: string | null; created_at: Date; updated_at: Date }
const toVersion = (row: VersionRow) => ({
  id: row.id,
  version: row.version,
  status: row.status,
  content: readStoredContent(row.content),
  contentHash: row.content_hash,
  sourceDocumentId: row.source_document_id,
  sourceDocumentTitle: row.source_document_title,
  sourceReference: row.source_reference,
  effectiveFrom: row.effective_from,
  effectiveUntil: row.effective_until,
  publishedAt: row.published_at,
  publishedByName: row.published_by_name,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

async function loadRow(db: Pick<Database, "query">, organizationId: string, id: string): Promise<ScriptRow | null> {
  return (await db.query<ScriptRow>(`${SELECT_SCRIPTS} and s.id = $2`, [organizationId, id])).rows[0] ?? null
}

/** Lê se o usuário VÊ o argumentário (administra, ou vale para o escopo dele vindo de cima); fora = 404 sem distinguir. */
async function requireVisible(db: Database, organizationId: string, scopes: ManageableScopes, id: string): Promise<ScriptRow> {
  const row = await loadRow(db, organizationId, id)
  if (!row) throw new DomainError("Argumentário não encontrado.", "ARGUMENT_SCRIPT_NOT_FOUND", 404)
  if (canManageScope(scopes, scopeOf(row))) return row
  const parentTeams = await parentTeamsOf(db, scopes)
  const visible = !scopes.unrestricted && (row.scopeType === "ALL_TEAMS" || (row.scopeType === "TEAM" && row.teamId !== null && (scopes.teamIds.has(row.teamId) || parentTeams.includes(row.teamId))) || (row.scopeType === "SUBTEAM" && row.subteamId !== null && scopes.subteamIds.has(row.subteamId)))
  if (!visible) throw new DomainError("Argumentário não encontrado.", "ARGUMENT_SCRIPT_NOT_FOUND", 404)
  return row
}
async function requireEditable(db: Database, organizationId: string, scopes: ManageableScopes, id: string): Promise<ScriptRow> {
  const row = await requireVisible(db, organizationId, scopes, id)
  if (!canManageScope(scopes, scopeOf(row))) throw new DomainError("Seu escopo de administração não cobre o escopo deste argumentário.", "ARGUMENT_SCRIPT_SCOPE_FORBIDDEN", 403)
  return row
}

export async function getArgumentScript(db: Database, organizationId: string, scopes: ManageableScopes, id: string) {
  const row = await requireVisible(db, organizationId, scopes, id)
  const versions = (await db.query<VersionRow>(
    `select v.id, v.version, v.status, v.content, v.content_hash, v.source_document_id, kd.title source_document_title, v.source_reference, v.effective_from, v.effective_until, v.published_at, p.name published_by_name, v.created_at, v.updated_at
     from argument_script_versions v
     left join knowledge_documents kd on kd.id = v.source_document_id
     left join people p on p.id = v.published_by
     where v.script_id = $1 and v.organization_id = $2 order by v.version desc`,
    [id, organizationId],
  )).rows.map(toVersion)
  const draft = versions.find((version) => version.status === "DRAFT") ?? null
  const current = versions.find((version) => version.status === "PUBLISHED") ?? null
  return {
    ...row,
    canEdit: canManageScope(scopes, scopeOf(row)),
    current,
    draft,
    history: versions.filter((version) => version.status !== "DRAFT"),
    draftIssues: draft ? publishIssuesOf(draft.content, { name: row.name, businessDomainId: row.businessDomainId, conversion: row.conversion }) : ([] as PublishIssue[]),
    everPublished: versions.some((version) => version.status !== "DRAFT"),
  }
}

/** Escopo pedido: Grupo/Subgrupo da organização (Subgrupo grava o Grupo dele) e coberto pelo escopo de quem administra. */
async function resolveScope(db: Pick<Database, "query">, organizationId: string, scopes: ManageableScopes, input: z.infer<typeof scopeInputSchema>): Promise<ScriptScope> {
  let scope: ScriptScope
  if (input.scopeType === "ALL_TEAMS") scope = { scopeType: "ALL_TEAMS", teamId: null, subteamId: null }
  else if (input.scopeType === "TEAM") {
    if (!input.teamId) throw new DomainError("Escolha o grupo.", "ARGUMENT_SCRIPT_SCOPE_INVALID")
    const team = (await db.query(`select 1 from teams where id = $1 and organization_id = $2`, [input.teamId, organizationId])).rows[0]
    if (!team) throw new DomainError("Grupo não encontrado.", "ARGUMENT_SCRIPT_SCOPE_INVALID")
    scope = { scopeType: "TEAM", teamId: input.teamId, subteamId: null }
  } else {
    if (!input.subteamId) throw new DomainError("Escolha o subgrupo.", "ARGUMENT_SCRIPT_SCOPE_INVALID")
    const subteam = (await db.query<{ team_id: string }>(`select st.team_id from subteams st join teams t on t.id = st.team_id where st.id = $1 and t.organization_id = $2`, [input.subteamId, organizationId])).rows[0]
    if (!subteam || (input.teamId && input.teamId !== subteam.team_id)) throw new DomainError("Subgrupo não encontrado neste grupo.", "ARGUMENT_SCRIPT_SCOPE_INVALID")
    scope = { scopeType: "SUBTEAM", teamId: subteam.team_id, subteamId: input.subteamId }
  }
  // A restrição vale inclusive para "todos": só quem administra a organização inteira escolhe todos os grupos.
  if (!canManageScope(scopes, scope)) throw new DomainError(scope.scopeType === "ALL_TEAMS" ? "Só quem administra a organização inteira pode criar um argumentário para todos os grupos." : "Seu escopo de administração não cobre este grupo/subgrupo.", "ARGUMENT_SCRIPT_SCOPE_FORBIDDEN", 403)
  return scope
}

async function requireBusinessDomain(db: Pick<Database, "query">, organizationId: string, id: string | null | undefined, previous: string | null) {
  if (!id) return null
  const row = (await db.query<{ active: boolean }>(`select active from business_domains where id = $1 and organization_id = $2`, [id, organizationId])).rows[0]
  if (!row) throw new DomainError("Área responsável não encontrada.", "BUSINESS_DOMAIN_NOT_FOUND")
  if (!row.active && id !== previous) throw new DomainError("Área responsável inativa.", "BUSINESS_DOMAIN_INACTIVE")
  return id
}
async function requireSourceDocument(db: Pick<Database, "query">, organizationId: string, id: string | null | undefined) {
  if (!id) return null
  const row = (await db.query(`select 1 from knowledge_documents where id = $1 and organization_id = $2 and deleted_at is null`, [id, organizationId])).rows[0]
  if (!row) throw new DomainError("Documento de origem não encontrado.", "ARGUMENT_SCRIPT_SOURCE_NOT_FOUND")
  return id
}

export async function createArgumentScript(db: Database, actor: ArgumentScriptActor, scopes: ManageableScopes, body: unknown) {
  const input = createInputSchema.parse(body)
  const scope = await resolveScope(db, actor.organizationId, scopes, input.scope)
  const businessDomainId = await requireBusinessDomain(db, actor.organizationId, input.businessDomainId, null)
  if (!businessDomainId) throw new DomainError("Informe a área responsável.", "ARGUMENT_SCRIPT_AREA_REQUIRED")
  const sourceDocumentId = await requireSourceDocument(db, actor.organizationId, input.sourceDocumentId)
  const content = normalizeArgumentScriptContent(input.content ?? {})
  const id = (await db.query<{ id: string }>(
    `insert into argument_scripts (organization_id, name, business_domain_id, scope_type, team_id, subteam_id, created_by, updated_by) values ($1,$2,$3,$4,$5,$6,$7,$7) returning id`,
    [actor.organizationId, input.name, businessDomainId, scope.scopeType, scope.teamId, scope.subteamId, actor.personId],
  )).rows[0]!.id
  await db.query(
    `insert into argument_script_versions (organization_id, script_id, version, status, content, content_hash, source_document_id, source_reference, created_by) values ($1,$2,1,'DRAFT',$3,$4,$5,$6,$7)`,
    [actor.organizationId, id, JSON.stringify(content), contentHashOf(content), sourceDocumentId, input.sourceReference ?? null, actor.personId],
  )
  await audit(db, actor, "ARGUMENT_SCRIPT_CREATED", id, { name: input.name, scope })
  return getArgumentScript(db, actor.organizationId, scopes, id)
}

/** Edição: nome e área a qualquer momento; escopo só antes da primeira publicação (a história de quem a regra valia não muda);
 * conteúdo e fonte sempre num RASCUNHO (criado a partir da versão vigente quando não existe). */
export async function updateArgumentScript(db: Database, actor: ArgumentScriptActor, scopes: ManageableScopes, id: string, body: unknown) {
  const input = updateInputSchema.parse(body)
  const row = await requireEditable(db, actor.organizationId, scopes, id)
  const everPublished = Boolean((await db.query(`select 1 from argument_script_versions where script_id = $1 and status <> 'DRAFT' limit 1`, [id])).rows[0])
  const changes: Record<string, unknown> = {}
  if (input.scope) {
    const scope = await resolveScope(db, actor.organizationId, scopes, input.scope)
    const same = scope.scopeType === row.scopeType && scope.teamId === row.teamId && scope.subteamId === row.subteamId
    if (!same) {
      if (everPublished) throw new DomainError("O escopo de um argumentário já publicado não muda (preserva a quem a regra valia). Encerre este e crie outro.", "ARGUMENT_SCRIPT_SCOPE_LOCKED", 409)
      await db.query(`update argument_scripts set scope_type = $2, team_id = $3, subteam_id = $4 where id = $1`, [id, scope.scopeType, scope.teamId, scope.subteamId])
      changes.scope = scope
    }
  }
  if (input.name !== undefined && input.name !== row.name) {
    await db.query(`update argument_scripts set name = $2 where id = $1`, [id, input.name])
    changes.name = input.name
  }
  if (input.businessDomainId !== undefined && input.businessDomainId !== row.businessDomainId) {
    const businessDomainId = await requireBusinessDomain(db, actor.organizationId, input.businessDomainId, row.businessDomainId)
    if (!businessDomainId && row.conversion === "NATIVE") throw new DomainError("Informe a área responsável.", "ARGUMENT_SCRIPT_AREA_REQUIRED")
    await db.query(`update argument_scripts set business_domain_id = $2 where id = $1`, [id, businessDomainId])
    changes.businessDomainId = businessDomainId
  }
  if (input.content !== undefined || input.sourceDocumentId !== undefined || input.sourceReference !== undefined) {
    const draft = (await db.query<{ id: string; content: unknown; source_document_id: string | null; source_reference: string | null }>(`select id, content, source_document_id, source_reference from argument_script_versions where script_id = $1 and status = 'DRAFT'`, [id])).rows[0]
    const base = draft ?? (await db.query<{ id: string; content: unknown; source_document_id: string | null; source_reference: string | null }>(`select id, content, source_document_id, source_reference from argument_script_versions where script_id = $1 and status in ('PUBLISHED','SUPERSEDED') order by version desc limit 1`, [id])).rows[0]
    const content = input.content !== undefined ? normalizeArgumentScriptContent(input.content) : readStoredContent(base?.content)
    const sourceDocumentId = input.sourceDocumentId !== undefined ? await requireSourceDocument(db, actor.organizationId, input.sourceDocumentId) : base?.source_document_id ?? null
    const sourceReference = input.sourceReference !== undefined ? input.sourceReference ?? null : base?.source_reference ?? null
    // O texto do cadastro antigo nunca se perde ao estruturar: continua guardado na versão (auditoria da conversão).
    const legacy = readStoredContent(base?.content).legacyExpectation
    const finalContent: ArgumentScriptContent = legacy && !content.legacyExpectation ? { ...content, legacyExpectation: legacy } : content
    if (draft) await db.query(`update argument_script_versions set content = $2, content_hash = $3, source_document_id = $4, source_reference = $5, updated_at = now() where id = $1`, [draft.id, JSON.stringify(finalContent), contentHashOf(finalContent), sourceDocumentId, sourceReference])
    else {
      const next = (await db.query<{ next: number }>(`select coalesce(max(version), 0) + 1 next from argument_script_versions where script_id = $1`, [id])).rows[0]!.next
      await db.query(`insert into argument_script_versions (organization_id, script_id, version, status, content, content_hash, source_document_id, source_reference, created_by) values ($1,$2,$3,'DRAFT',$4,$5,$6,$7,$8)`, [actor.organizationId, id, next, JSON.stringify(finalContent), contentHashOf(finalContent), sourceDocumentId, sourceReference, actor.personId])
    }
    changes.draft = true
  }
  if (Object.keys(changes).length > 0) {
    await db.query(`update argument_scripts set updated_by = $2, updated_at = now() where id = $1`, [id, actor.personId])
    await audit(db, actor, "ARGUMENT_SCRIPT_UPDATED", id, changes)
  }
  return getArgumentScript(db, actor.organizationId, scopes, id)
}

export async function discardArgumentScriptDraft(db: Database, actor: ArgumentScriptActor, scopes: ManageableScopes, id: string) {
  await requireEditable(db, actor.organizationId, scopes, id)
  const removed = (await db.query(`delete from argument_script_versions where script_id = $1 and status = 'DRAFT' returning version`, [id])).rows[0]
  if (!removed) throw new DomainError("Não há rascunho para descartar.", "ARGUMENT_SCRIPT_NO_DRAFT", 409)
  await audit(db, actor, "ARGUMENT_SCRIPT_DRAFT_DISCARDED", id, {})
  return getArgumentScript(db, actor.organizationId, scopes, id)
}

/** Argumentário NUNCA publicado (só rascunho) pode ser excluído; o publicado só é encerrado (história preservada). */
/**
 * Alguma análise do motor já USOU o argumentário: rodada (proveniência), análise da chamada (todos os vigentes no escopo entram,
 * apliquem-se ou não) ou critério avaliado. Usado = origem de feedbacks e diagnósticos — nunca se apaga, só se desativa.
 */
const ARGUMENT_SCRIPT_IN_USE_SQL = `select exists(select 1 from call_criterion_assessments where organization_id = $1 and argument_script_id = $2)
    or exists(select 1 from call_assessments where organization_id = $1 and argument_scripts @> jsonb_build_array(jsonb_build_object('scriptId', $2::text)))
    or exists(select 1 from feedback_analysis_runs where organization_id = $1 and provenance -> 'argumentScripts' @> jsonb_build_array(jsonb_build_object('scriptId', $2::text))) used`

export const ARGUMENT_SCRIPT_IN_USE_MESSAGE = "Este argumentário já foi usado em análises de chamada: excluí-lo apagaria a origem de feedbacks e diagnósticos. Desative-o — ele deixa de valer e o histórico continua consultável."

/**
 * EXCLUIR de vez (versões + cadastro), só enquanto nenhuma análise o usou — rascunho nunca publicado ou publicado sem uso. O
 * conteúdo da última versão vai para `audit_logs`. Com uso, 409 `ARGUMENT_SCRIPT_IN_USE`: o caminho é desativar.
 */
export async function deleteArgumentScript(db: Database, actor: ArgumentScriptActor, scopes: ManageableScopes, id: string) {
  const row = await requireEditable(db, actor.organizationId, scopes, id)
  await inTransaction(db, async (client) => {
    await client.query(`select 1 from argument_scripts where id = $1 for update`, [id])
    if ((await client.query<{ used: boolean }>(ARGUMENT_SCRIPT_IN_USE_SQL, [actor.organizationId, id])).rows[0]?.used) throw new DomainError(ARGUMENT_SCRIPT_IN_USE_MESSAGE, "ARGUMENT_SCRIPT_IN_USE", 409)
    const last = (await client.query<{ version: number; status: string; content: unknown }>(`select version, status, content from argument_script_versions where script_id = $1 order by version desc limit 1`, [id])).rows[0]
    // As versões saem pela cascata: o gatilho de imutabilidade (migration 105) só deixa apagar versão publicada por ela.
    await client.query(`delete from argument_scripts where id = $1 and organization_id = $2`, [id, actor.organizationId])
    await audit(client, actor, "ARGUMENT_SCRIPT_DELETED", id, { name: row.name, status: row.status, lastVersion: last ?? null })
  })
}

/** Com o POOL, conexão dedicada (begin/commit); com um CLIENT já em transação (provas, QA Lab), savepoint — nunca um commit de fora. */
async function inTransaction<T>(db: Database, work: (client: Pick<Database, "query">) => Promise<T>): Promise<T> {
  if (typeof (db as unknown as { release?: unknown }).release === "function") {
    await db.query("savepoint argument_script_tx")
    try {
      const result = await work(db)
      await db.query("release savepoint argument_script_tx")
      return result
    } catch (error) {
      await db.query("rollback to savepoint argument_script_tx").catch(() => undefined)
      throw error
    }
  }
  const client = await db.connect()
  try {
    await client.query("begin")
    const result = await work(client)
    await client.query("commit")
    return result
  } catch (error) {
    await client.query("rollback").catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

/**
 * PUBLICAR o rascunho. Vigência começa em `effectiveFrom` (padrão: agora) — nunca antes da publicação (tolerância de relógio de 5
 * min) nem antes do início da versão vigente; a versão anterior passa a SUPERSEDED e termina quando esta começa.
 */
export async function publishArgumentScript(db: Database, actor: ArgumentScriptActor, scopes: ManageableScopes, id: string, body: unknown, now: Date = new Date()) {
  const input = publishInputSchema.parse(body ?? {})
  const row = await requireEditable(db, actor.organizationId, scopes, id)
  if (row.status === "ARCHIVED") throw new DomainError("Argumentário encerrado: reative-o para publicar.", "ARGUMENT_SCRIPT_ARCHIVED", 409)
  const effectiveFrom = input.effectiveFrom ?? now
  if (effectiveFrom.getTime() < now.getTime() - PUBLISH_BACKDATE_TOLERANCE_MS) throw new DomainError("A vigência não pode começar antes da publicação: uma regra publicada agora nunca vale para chamadas anteriores.", "ARGUMENT_SCRIPT_RETROACTIVE", 422)
  await inTransaction(db, async (client) => {
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [`argument-script:${id}`])
    const draft = (await client.query<{ id: string; version: number; content: unknown }>(`select id, version, content from argument_script_versions where script_id = $1 and status = 'DRAFT'`, [id])).rows[0]
    if (!draft) throw new DomainError("Não há rascunho para publicar.", "ARGUMENT_SCRIPT_NO_DRAFT", 409)
    const content = readStoredContent(draft.content)
    const issues = publishIssuesOf(content, { name: row.name, businessDomainId: row.businessDomainId, conversion: row.conversion })
    if (issues.length > 0) throw new DomainError("O rascunho ainda não pode ser publicado.", "ARGUMENT_SCRIPT_NOT_READY", 422, { issues })
    const current = (await client.query<{ id: string; effective_from: Date; effective_until: Date | null }>(`select id, effective_from, effective_until from argument_script_versions where script_id = $1 and status = 'PUBLISHED'`, [id])).rows[0]
    if (current && effectiveFrom.getTime() <= new Date(current.effective_from).getTime()) throw new DomainError("A nova vigência precisa começar depois do início da versão vigente.", "ARGUMENT_SCRIPT_EFFECTIVE_ORDER", 422)
    if (current) await client.query(`update argument_script_versions set status = 'SUPERSEDED', effective_until = case when effective_until is null or effective_until > $2 then $2 else effective_until end, updated_at = now() where id = $1`, [current.id, effectiveFrom])
    await client.query(`update argument_script_versions set status = 'PUBLISHED', effective_from = $2, published_at = $3, published_by = $4, updated_at = now() where id = $1`, [draft.id, effectiveFrom, now, actor.personId])
    await client.query(`update argument_scripts set updated_by = $2, updated_at = now() where id = $1`, [id, actor.personId])
    await audit(client, actor, "ARGUMENT_SCRIPT_PUBLISHED", id, { version: draft.version, effectiveFrom: effectiveFrom.toISOString(), supersededVersionId: current?.id ?? null })
  })
  return getArgumentScript(db, actor.organizationId, scopes, id)
}

/** ENCERRAR: deixa de valer a partir de agora (chamadas anteriores continuam avaliadas pela versão da época). */
export async function archiveArgumentScript(db: Database, actor: ArgumentScriptActor, scopes: ManageableScopes, id: string, now: Date = new Date()) {
  const row = await requireEditable(db, actor.organizationId, scopes, id)
  if (row.status === "ARCHIVED") return getArgumentScript(db, actor.organizationId, scopes, id)
  await inTransaction(db, async (client) => {
    const current = (await client.query<{ id: string; effective_from: Date }>(`select id, effective_from from argument_script_versions where script_id = $1 and status = 'PUBLISHED'`, [id])).rows[0]
    if (current && new Date(current.effective_from).getTime() > now.getTime()) throw new DomainError("A versão publicada ainda não começou a valer: publique outra data ou aguarde o início para encerrar.", "ARGUMENT_SCRIPT_NOT_STARTED", 409)
    if (current) await client.query(`update argument_script_versions set effective_until = $2, updated_at = now() where id = $1 and (effective_until is null or effective_until > $2)`, [current.id, now])
    await client.query(`update argument_scripts set status = 'ARCHIVED', updated_by = $2, updated_at = now() where id = $1`, [id, actor.personId])
    await audit(client, actor, "ARGUMENT_SCRIPT_ARCHIVED", id, { at: now.toISOString() })
  })
  return getArgumentScript(db, actor.organizationId, scopes, id)
}

/** REATIVAR: volta a valer a partir de agora com o conteúdo da última versão publicada (nova versão — a lacuna fica na história). */
export async function reactivateArgumentScript(db: Database, actor: ArgumentScriptActor, scopes: ManageableScopes, id: string, now: Date = new Date()) {
  const row = await requireEditable(db, actor.organizationId, scopes, id)
  if (row.status === "ACTIVE") return getArgumentScript(db, actor.organizationId, scopes, id)
  await inTransaction(db, async (client) => {
    const last = (await client.query<{ id: string; content: unknown; content_hash: string; source_document_id: string | null; source_reference: string | null }>(`select id, content, content_hash, source_document_id, source_reference from argument_script_versions where script_id = $1 and status in ('PUBLISHED','SUPERSEDED') order by version desc limit 1`, [id])).rows[0]
    await client.query(`update argument_scripts set status = 'ACTIVE', updated_by = $2, updated_at = now() where id = $1`, [id, actor.personId])
    if (last) {
      await client.query(`delete from argument_script_versions where script_id = $1 and status = 'DRAFT'`, [id])
      await client.query(`update argument_script_versions set status = 'SUPERSEDED', updated_at = now() where id = $1 and status = 'PUBLISHED'`, [last.id])
      const next = (await client.query<{ next: number }>(`select coalesce(max(version), 0) + 1 next from argument_script_versions where script_id = $1`, [id])).rows[0]!.next
      await client.query(
        `insert into argument_script_versions (organization_id, script_id, version, status, content, content_hash, source_document_id, source_reference, effective_from, published_at, published_by, created_by) values ($1,$2,$3,'PUBLISHED',$4,$5,$6,$7,$8,$8,$9,$9)`,
        [actor.organizationId, id, next, JSON.stringify(last.content), last.content_hash, last.source_document_id, last.source_reference, now, actor.personId],
      )
    }
    await audit(client, actor, "ARGUMENT_SCRIPT_REACTIVATED", id, { at: now.toISOString() })
  })
  return getArgumentScript(db, actor.organizationId, scopes, id)
}
