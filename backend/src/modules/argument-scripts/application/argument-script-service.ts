import { assertNewScopeLinksAdmissible } from "../../org-structure/application/scope-unit-admission.js"
import { z } from "zod"
import { universeFromBody } from "../../operating-universe/application/universe-access.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { SqlFilter, booleanParam, respondList, searchParam, type PageResult } from "../../../shared/presentation/list-query.js"
import { canManageAllLinks, canSeeAnyLink, resolveScopeLinksForWrite, SCOPE_LINK_FAILURE_MESSAGE, type ManageableScopes } from "../../auth/application/manageable-scopes.js"
import { scopeLinksInputSchema } from "../../../shared/presentation/scope-links-schema.js"
import { linkKey, type ScopeLink } from "../../../shared/domain/scope-links/scope-links.js"
import { argumentScriptLinksSql } from "../infrastructure/argument-script-loaders.js"
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
import { applyUniverseListFilter, universeListParam } from "../../operating-universe/application/universe-list-filter.js"
import { transactionRunner } from "../../../shared/infrastructure/database/transaction.js"

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

/**
 * Escopo pedido (223): todos os Grupos, ou os Grupos/Subgrupos dos vínculos. Aceita também a forma antiga de escopo único
 * (`TEAM`/`SUBTEAM` + `teamId`/`subteamId`, ex.: importação de configuração e roteiros de dev) — convertida em um vínculo.
 */
const scopeInputSchema = z.preprocess(
  (value) => {
    if (!value || typeof value !== "object") return value
    const legacy = value as { scopeType?: unknown; teamId?: unknown; subteamId?: unknown }
    if (legacy.scopeType === "TEAM") return { scopeType: "GROUPS", links: [{ teamId: legacy.teamId ?? null }] }
    if (legacy.scopeType === "SUBTEAM") return { scopeType: "GROUPS", links: [{ teamId: legacy.teamId ?? null, subteamId: legacy.subteamId ?? null }] }
    // Forma antiga sem `links`; com `links`, vale a forma nova (e "todos" com Grupos é recusado abaixo, nunca descartado em silêncio).
    if (legacy.scopeType === "ALL_TEAMS" && !("links" in legacy)) return { scopeType: "ALL_TEAMS", links: [] }
    return value
  },
  z
    .object({ scopeType: z.enum(["ALL_TEAMS", "GROUPS"]), links: scopeLinksInputSchema.default([]) })
    .strict()
    .refine((scope) => scope.scopeType !== "ALL_TEAMS" || scope.links.length === 0, { message: "Todos os Grupos não leva Grupos vinculados.", path: ["links"] }),
)
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
  operatingUniverse: universeListParam,
})

type ScriptRow = {
  id: string
  name: string
  businessDomainId: string | null
  businessDomainName: string | null
  /** Escopo da versão que governa (publicada; sem publicada, a última que valeu; nunca publicado, o rascunho). */
  scopeType: ScriptScope["scopeType"]
  scopeLinks: ScriptScope["links"]
  /** Escopo do rascunho (null = sem rascunho). Muda a partir da publicação dele. */
  draftScope: ScriptScope | null
  subjectName: string | null
  status: "ACTIVE" | "ARCHIVED"
  conversion: "NATIVE" | "LEGACY_UNSTRUCTURED"
  currentVersion: number | null
  currentEffectiveFrom: Date | null
  currentEffectiveUntil: Date | null
  draftVersion: number | null
  operatingUniverse: string | null
  updatedAt: Date
  createdAt: Date
}

const SELECT_SCRIPTS = `
  select s.id, s.name, s.business_domain_id "businessDomainId", bd.name "businessDomainName",
         coalesce(gov.scope_type, dr.scope_type) "scopeType", coalesce(gov.links, dr.links) "scopeLinks",
         case when dr.id is null then null else json_build_object('scopeType', dr.scope_type, 'links', dr.links) end "draftScope",
         (select string_agg(concat_ws(' ', lt.name, lst.name), ' ') from argument_script_version_scopes l join teams lt on lt.id = l.team_id left join subteams lst on lst.id = l.subteam_id
           where l.version_id in (gov.id, dr.id)) "scopeSearch",
         sub.name "subjectName",
         s.status, s.conversion, cur.version "currentVersion", cur.effective_from "currentEffectiveFrom", cur.effective_until "currentEffectiveUntil",
         dr.version "draftVersion", s.operating_universe "operatingUniverse", s.updated_at "updatedAt", s.created_at "createdAt"
  from argument_scripts s
  left join business_domains bd on bd.id = s.business_domain_id
  left join subjects sub on sub.id = s.subject_id
  left join lateral (select version, effective_from, effective_until from argument_script_versions v where v.script_id = s.id and v.status = 'PUBLISHED' limit 1) cur on true
  left join lateral (select v.id, v.scope_type, ${argumentScriptLinksSql("v")} links from argument_script_versions v where v.script_id = s.id and v.status <> 'DRAFT' order by (v.status = 'PUBLISHED') desc, v.version desc limit 1) gov on true
  left join lateral (select v.id, v.version, v.scope_type, ${argumentScriptLinksSql("v")} links from argument_script_versions v where v.script_id = s.id and v.status = 'DRAFT' limit 1) dr on true
  where s.organization_id = $1
`

/** Escopos que governam o argumentário agora: o vigente e o do rascunho (os dois contam para quem pode alterá-lo). */
const governingScopesOf = (row: Pick<ScriptRow, "scopeType" | "scopeLinks" | "draftScope">): ScriptScope[] => [{ scopeType: row.scopeType, links: row.scopeLinks ?? [] }, ...(row.draftScope ? [row.draftScope] : [])]

/**
 * Política de ESCRITA (a mesma da Base de Conhecimento): alterar texto, vínculos, publicar ou encerrar exige que TODOS os vínculos —
 * do vigente e do rascunho — estejam no escopo de quem altera; "todos os grupos" só com escopo de organização. Um gestor de parte dos
 * Grupos de um argumentário compartilhado o VÊ (somente leitura), mas não o altera.
 */
const canEditScopes = (scopes: ManageableScopes, governing: readonly ScriptScope[]) =>
  governing.every((scope) => (scope.scopeType === "ALL_TEAMS" ? scopes.unrestricted || scopes.allTeams : canManageAllLinks(scopes, scope.links)))
const canEditRow = (scopes: ManageableScopes, row: Pick<ScriptRow, "scopeType" | "scopeLinks" | "draftScope">) => canEditScopes(scopes, governingScopesOf(row))

async function audit(db: Pick<Database, "query">, actor: ArgumentScriptActor, action: string, entityId: string, payload: Record<string, unknown>) {
  await db.query(`insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload) values ($1, $2, $3, 'argument_script', $4, $5)`, [actor.organizationId, actor.personId, action, entityId, JSON.stringify(payload)])
}

/** Teams dos Subgrupos que o usuário administra (para mostrar, somente leitura, o que vale para eles vindo do Grupo). */
async function parentTeamsOf(db: Pick<Database, "query">, scopes: ManageableScopes): Promise<string[]> {
  if (scopes.unrestricted || scopes.allTeams || scopes.subteamIds.size === 0) return []
  return (await db.query<{ team_id: string }>(`select distinct team_id from subteams where id = any($1::uuid[])`, [[...scopes.subteamIds]])).rows.map((row) => row.team_id)
}

/** Vê: "todos os grupos" (vigente ou rascunho), ou ALGUM vínculo no escopo (Grupo inteiro do Subgrupo administrado incluído). */
function visibilityClause(filter: SqlFilter, scopes: ManageableScopes, parentTeams: readonly string[]) {
  if (scopes.unrestricted || scopes.allTeams) return
  const teams = filter.param([...scopes.teamIds])
  const subteams = filter.param([...scopes.subteamIds])
  const parents = filter.param([...parentTeams])
  filter.add(`(q."scopeType" = 'ALL_TEAMS' or (q."draftScope"->>'scopeType') = 'ALL_TEAMS' or exists (select 1 from argument_script_versions vv join argument_script_version_scopes l on l.version_id = vv.id
    where vv.script_id = q.id and (vv.status = 'DRAFT' or vv.id = (select g.id from argument_script_versions g where g.script_id = q.id and g.status <> 'DRAFT' order by (g.status = 'PUBLISHED') desc, g.version desc limit 1))
      and (l.team_id = any(${teams}::uuid[]) or l.subteam_id = any(${subteams}::uuid[]) or (l.subteam_id is null and l.team_id = any(${parents}::uuid[])))))`)
}

/** Filtro de Grupo/Subgrupo da lista: argumentários com algum vínculo (vigente ou rascunho) naquele Grupo/Subgrupo; "todos os grupos" à parte. */
function linkFilterClause(filter: SqlFilter, input: { scopeType?: "ALL_TEAMS" | undefined; teamId?: string | undefined; subteamId?: string | undefined }) {
  if (input.scopeType === "ALL_TEAMS") return void filter.add(`q."scopeType" = 'ALL_TEAMS'`)
  if (!input.teamId && !input.subteamId) return
  const column = input.subteamId ? "l.subteam_id" : "l.team_id"
  const value = filter.param(input.subteamId ?? input.teamId)
  filter.add(`exists (select 1 from argument_script_versions vv join argument_script_version_scopes l on l.version_id = vv.id where vv.script_id = q.id and vv.status in ('DRAFT', 'PUBLISHED') and ${column} = ${value}::uuid)`)
}

export async function listArgumentScripts(db: Database, organizationId: string, scopes: ManageableScopes, query: Record<string, unknown>) {
  const input = listQuerySchema.parse(query)
  const filter = new SqlFilter([organizationId])
    .search(input.search, ["q.name", 'q."businessDomainName"', 'q."scopeSearch"'])
    .equals("q.status", input.status)
    .equals('q."businessDomainId"', input.businessDomainId)
    .equals("q.conversion", input.conversion)
  applyUniverseListFilter(filter, 'q."operatingUniverse"', input.operatingUniverse)
  linkFilterClause(filter, input)
  if (input.hasDraft !== undefined) filter.add(input.hasDraft ? `q."draftVersion" is not null` : `q."draftVersion" is null`)
  visibilityClause(filter, scopes, await parentTeamsOf(db, scopes))
  const data = await respondList<ScriptRow>(db, query, { select: SELECT_SCRIPTS, filter, orderBy: `q.status, q."updatedAt" desc, q.id` })
  const decorate = (row: ScriptRow) => ({ ...publicRow(row), canEdit: canEditRow(scopes, row) })
  return Array.isArray(data) ? data.map(decorate) : ({ ...data, items: data.items.map(decorate) } satisfies PageResult<ReturnType<typeof decorate>>)
}

type VersionRow = { id: string; version: number; status: "DRAFT" | "PUBLISHED" | "SUPERSEDED"; scope_type: ScriptScope["scopeType"]; scope_links: ScriptScope["links"]; content: unknown; content_hash: string; source_document_id: string | null; source_document_title: string | null; source_reference: string | null; effective_from: Date | null; effective_until: Date | null; published_at: Date | null; published_by_name: string | null; created_at: Date; updated_at: Date }
const toVersion = (row: VersionRow) => ({
  id: row.id,
  version: row.version,
  status: row.status,
  scope: { scopeType: row.scope_type, links: row.scope_links ?? [] } satisfies ScriptScope,
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
  if (canEditRow(scopes, row)) return row
  const parentTeams = new Set(await parentTeamsOf(db, scopes))
  const visible = !scopes.unrestricted && governingScopesOf(row).some((scope) => scope.scopeType === "ALL_TEAMS" || canSeeAnyLink(scopes, scope.links, parentTeams))
  if (!visible) throw new DomainError("Argumentário não encontrado.", "ARGUMENT_SCRIPT_NOT_FOUND", 404)
  return row
}
async function requireEditable(db: Database, organizationId: string, scopes: ManageableScopes, id: string): Promise<ScriptRow> {
  const row = await requireVisible(db, organizationId, scopes, id)
  if (!canEditRow(scopes, row)) throw new DomainError("Este argumentário vale para Grupos fora do seu escopo de administração: só quem administra todos eles pode alterá-lo.", "ARGUMENT_SCRIPT_SCOPE_FORBIDDEN", 403)
  return row
}

export async function getArgumentScript(db: Database, organizationId: string, scopes: ManageableScopes, id: string) {
  const row = await requireVisible(db, organizationId, scopes, id)
  const versions = (await db.query<VersionRow>(
    `select v.id, v.version, v.status, v.scope_type, ${argumentScriptLinksSql("v")} scope_links, v.content, v.content_hash, v.source_document_id, kd.title source_document_title, v.source_reference, v.effective_from, v.effective_until, v.published_at, p.name published_by_name, v.created_at, v.updated_at
     from argument_script_versions v
     left join knowledge_documents kd on kd.id = v.source_document_id
     left join people p on p.id = v.published_by
     where v.script_id = $1 and v.organization_id = $2 order by v.version desc`,
    [id, organizationId],
  )).rows.map(toVersion)
  const draft = versions.find((version) => version.status === "DRAFT") ?? null
  const current = versions.find((version) => version.status === "PUBLISHED") ?? null
  return {
    ...publicRow(row),
    canEdit: canEditRow(scopes, row),
    current,
    draft,
    history: versions.filter((version) => version.status !== "DRAFT"),
    draftIssues: draft ? publishIssuesOf(draft.content, { name: row.name, businessDomainId: row.businessDomainId, conversion: row.conversion }) : ([] as PublishIssue[]),
    everPublished: versions.some((version) => version.status !== "DRAFT"),
  }
}

/** Escopo pedido: todos os Grupos (só com escopo de organização) ou vínculos válidos da organização, todos no escopo de quem administra. */
async function resolveScope(db: Pick<Database, "query">, organizationId: string, scopes: ManageableScopes, input: z.infer<typeof scopeInputSchema>, admission: { previous: readonly ScopeLink[]; universe: string | null } = { previous: [], universe: null }): Promise<ScriptScope> {
  if (input.scopeType === "ALL_TEAMS") {
    if (!(scopes.unrestricted || scopes.allTeams)) throw new DomainError("Só quem administra a organização inteira pode criar um argumentário para todos os grupos.", "ARGUMENT_SCRIPT_SCOPE_FORBIDDEN", 403)
    return { scopeType: "ALL_TEAMS", links: [] }
  }
  const resolved = await resolveScopeLinksForWrite(db, organizationId, scopes, input.links)
  if (!resolved.ok) throw new DomainError(SCOPE_LINK_FAILURE_MESSAGE[resolved.reason], resolved.reason === "FORBIDDEN" ? "ARGUMENT_SCRIPT_SCOPE_FORBIDDEN" : "ARGUMENT_SCRIPT_SCOPE_INVALID", resolved.reason === "FORBIDDEN" ? 403 : 422)
  // Vínculo novo: do universo do argumentário e com operador em produção (a regra do seletor); o já salvo continua aceito.
  await assertNewScopeLinksAdmissible(db, organizationId, resolved.links, admission)
  return { scopeType: "GROUPS", links: resolved.links.map((link) => ({ ...link, teamName: null, subteamName: null })) }
}

const sameScope = (a: Pick<ScriptScope, "scopeType" | "links">, b: Pick<ScriptScope, "scopeType" | "links">) =>
  a.scopeType === b.scopeType && a.links.length === b.links.length && a.links.map(linkKey).sort().join("|") === b.links.map(linkKey).sort().join("|")

/** Grava o escopo de uma versão em RASCUNHO (vínculos substituídos inteiros, na mesma transação do rascunho). */
async function writeVersionScope(db: Pick<Database, "query">, organizationId: string, versionId: string, scope: Pick<ScriptScope, "scopeType" | "links">) {
  await db.query(`update argument_script_versions set scope_type = $2 where id = $1`, [versionId, scope.scopeType])
  await db.query(`delete from argument_script_version_scopes where version_id = $1`, [versionId])
  const links: ScopeLink[] = scope.scopeType === "ALL_TEAMS" ? [] : scope.links
  if (links.length > 0) {
    await db.query(
      `insert into argument_script_version_scopes (version_id, organization_id, team_id, subteam_id) select $1, $2, t, s from unnest($3::uuid[], $4::uuid[]) as u(t, s)`,
      [versionId, organizationId, links.map((link) => link.teamId), links.map((link) => link.subteamId)],
    )
  }
}

/** Escopo no `audit_logs`: tipo + vínculos (ids), sem nomes. */
const auditScope = (scope: Pick<ScriptScope, "scopeType" | "links">) => ({ scopeType: scope.scopeType, links: scope.links.map((link) => ({ teamId: link.teamId, subteamId: link.subteamId })) })

/** Resposta sem o campo interno de busca. */
function publicRow(row: ScriptRow) {
  const { scopeSearch, ...rest } = row as ScriptRow & { scopeSearch?: string | null }
  void scopeSearch
  return rest
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
  // Argumentário pertence a um universo; a área (domínio de negócio) precisa ser do mesmo universo (conferido abaixo).
  const universe = await universeFromBody(db, actor.organizationId, body, "do argumentário")
  const scope = await resolveScope(db, actor.organizationId, scopes, input.scope, { previous: [], universe })
  const businessDomainId = await requireBusinessDomain(db, actor.organizationId, input.businessDomainId, null)
  if (!businessDomainId) throw new DomainError("Informe a área responsável.", "ARGUMENT_SCRIPT_AREA_REQUIRED")
  const sourceDocumentId = await requireSourceDocument(db, actor.organizationId, input.sourceDocumentId)
  const content = normalizeArgumentScriptContent(input.content ?? {})
  const domainUniverse = (await db.query<{ operating_universe: string | null }>(`select operating_universe from business_domains where id = $1`, [businessDomainId])).rows[0]?.operating_universe ?? null
  if (universe && domainUniverse && universe !== domainUniverse) throw new DomainError(`A área escolhida é do universo ${domainUniverse}; o argumentário é ${universe}. Universos não se misturam.`, "OPERATING_UNIVERSE_LINK_CONFLICT", 409)
  const id = await inTransaction(db, async (client) => {
    const scriptId = (await client.query<{ id: string }>(
      `insert into argument_scripts (organization_id, name, business_domain_id, created_by, updated_by, operating_universe) values ($1,$2,$3,$4,$4,$5) returning id`,
      [actor.organizationId, input.name, businessDomainId, actor.personId, universe],
    )).rows[0]!.id
    const versionId = (await client.query<{ id: string }>(
      `insert into argument_script_versions (organization_id, script_id, version, status, content, content_hash, source_document_id, source_reference, created_by, scope_type) values ($1,$2,1,'DRAFT',$3,$4,$5,$6,$7,$8) returning id`,
      [actor.organizationId, scriptId, JSON.stringify(content), contentHashOf(content), sourceDocumentId, input.sourceReference ?? null, actor.personId, scope.scopeType],
    )).rows[0]!.id
    await writeVersionScope(client, actor.organizationId, versionId, scope)
    await audit(client, actor, "ARGUMENT_SCRIPT_CREATED", scriptId, { name: input.name, scope: auditScope(scope) })
    return scriptId
  })
  return getArgumentScript(db, actor.organizationId, scopes, id)
}

/** Edição: nome e área a qualquer momento; conteúdo, fonte e ESCOPO (vínculos) sempre num RASCUNHO (criado a partir da versão vigente
 * quando não existe) — valem a partir da publicação; a história de a quem a regra valia nunca muda (o escopo é da versão, 223). */
export async function updateArgumentScript(db: Database, actor: ArgumentScriptActor, scopes: ManageableScopes, id: string, body: unknown) {
  const input = updateInputSchema.parse(body)
  const row = await requireEditable(db, actor.organizationId, scopes, id)
  const changes: Record<string, unknown> = {}
  // Vínculos novos: TODOS no escopo de quem altera (e os atuais já passaram em `requireEditable`). Mudam no RASCUNHO e valem a partir da
  // publicação dele — a versão publicada (e a quem ela valeu) nunca muda.
  const requestedScope = input.scope ? await resolveScope(db, actor.organizationId, scopes, input.scope, { previous: [...(row.scopeLinks ?? []), ...(row.draftScope?.links ?? [])], universe: row.operatingUniverse ?? null }) : null
  const draftTarget = row.draftScope ?? { scopeType: row.scopeType, links: row.scopeLinks ?? [] }
  const scopeChanged = requestedScope !== null && !sameScope(requestedScope, draftTarget)
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
  if (scopeChanged || input.content !== undefined || input.sourceDocumentId !== undefined || input.sourceReference !== undefined) {
    const draft = (await db.query<{ id: string; content: unknown; source_document_id: string | null; source_reference: string | null }>(`select id, content, source_document_id, source_reference from argument_script_versions where script_id = $1 and status = 'DRAFT'`, [id])).rows[0]
    const base = draft ?? (await db.query<{ id: string; content: unknown; source_document_id: string | null; source_reference: string | null }>(`select id, content, source_document_id, source_reference from argument_script_versions where script_id = $1 and status in ('PUBLISHED','SUPERSEDED') order by version desc limit 1`, [id])).rows[0]
    const content = input.content !== undefined ? normalizeArgumentScriptContent(input.content) : readStoredContent(base?.content)
    const sourceDocumentId = input.sourceDocumentId !== undefined ? await requireSourceDocument(db, actor.organizationId, input.sourceDocumentId) : base?.source_document_id ?? null
    const sourceReference = input.sourceReference !== undefined ? input.sourceReference ?? null : base?.source_reference ?? null
    // O texto do cadastro antigo nunca se perde ao estruturar: continua guardado na versão (auditoria da conversão).
    const legacy = readStoredContent(base?.content).legacyExpectation
    const finalContent: ArgumentScriptContent = legacy && !content.legacyExpectation ? { ...content, legacyExpectation: legacy } : content
    const scope = scopeChanged ? requestedScope! : draftTarget
    await inTransaction(db, async (client) => {
      let draftId = draft?.id
      if (draftId) await client.query(`update argument_script_versions set content = $2, content_hash = $3, source_document_id = $4, source_reference = $5, updated_at = now() where id = $1`, [draftId, JSON.stringify(finalContent), contentHashOf(finalContent), sourceDocumentId, sourceReference])
      else {
        const next = (await client.query<{ next: number }>(`select coalesce(max(version), 0) + 1 next from argument_script_versions where script_id = $1`, [id])).rows[0]!.next
        draftId = (await client.query<{ id: string }>(`insert into argument_script_versions (organization_id, script_id, version, status, content, content_hash, source_document_id, source_reference, created_by, scope_type) values ($1,$2,$3,'DRAFT',$4,$5,$6,$7,$8,$9) returning id`, [actor.organizationId, id, next, JSON.stringify(finalContent), contentHashOf(finalContent), sourceDocumentId, sourceReference, actor.personId, scope.scopeType])).rows[0]!.id
      }
      // Rascunho novo herda o escopo vigente; pedido de mudança substitui os vínculos do rascunho.
      if (scopeChanged || !draft) await writeVersionScope(client, actor.organizationId, draftId, scope)
    })
    changes.draft = true
    if (scopeChanged) changes.scope = { before: auditScope(draftTarget), after: auditScope(requestedScope!) }
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

/**
 * EXCLUIR (exclusão lógica, migration 177). Versões continuam guardadas e o conteúdo da última vai para `audit_logs`. Análise já feita não muda: os diagnósticos leem o nome em
 * `argument_scripts_all`, e análise nova deixa de considerá-lo. Encerra antes de esconder: restaurar pela Central de Dados nunca faz o argumentário voltar a valer sozinho.
 */
export async function deleteArgumentScript(db: Database, actor: ArgumentScriptActor, scopes: ManageableScopes, id: string) {
  const row = await requireEditable(db, actor.organizationId, scopes, id)
  await inTransaction(db, async (client) => {
    await client.query(`select 1 from argument_scripts where id = $1 for update`, [id])
    const last = (await client.query<{ version: number; status: string; content: unknown }>(`select version, status, content from argument_script_versions where script_id = $1 order by version desc limit 1`, [id])).rows[0]
    await client.query(`update argument_script_versions set effective_until = greatest(effective_from + interval '1 second', now()), updated_at = now() where script_id = $1 and status = 'PUBLISHED' and (effective_until is null or effective_until > now())`, [id])
    await client.query(`update argument_scripts_all set status = 'ARCHIVED', deleted_at = now(), deleted_by_person_id = $3, updated_by = $3, updated_at = now() where id = $1 and organization_id = $2`, [id, actor.organizationId, actor.personId])
    await audit(client, actor, "ARGUMENT_SCRIPT_DELETED", id, { name: row.name, status: row.status, lastVersion: last ?? null })
  })
}

/** Com o POOL, conexão dedicada (begin/commit); com um CLIENT já em transação (provas, QA Lab), savepoint — nunca um commit de fora. */
const inTransaction = transactionRunner("argument_script_tx")

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
    const last = (await client.query<{ id: string; content: unknown; content_hash: string; source_document_id: string | null; source_reference: string | null; scope_type: string }>(`select id, content, content_hash, source_document_id, source_reference, scope_type from argument_script_versions where script_id = $1 and status in ('PUBLISHED','SUPERSEDED') order by version desc limit 1`, [id])).rows[0]
    await client.query(`update argument_scripts set status = 'ACTIVE', updated_by = $2, updated_at = now() where id = $1`, [id, actor.personId])
    if (last) {
      await client.query(`delete from argument_script_versions where script_id = $1 and status = 'DRAFT'`, [id])
      await client.query(`update argument_script_versions set status = 'SUPERSEDED', updated_at = now() where id = $1 and status = 'PUBLISHED'`, [last.id])
      const next = (await client.query<{ next: number }>(`select coalesce(max(version), 0) + 1 next from argument_script_versions where script_id = $1`, [id])).rows[0]!.next
      // Nasce como rascunho para receber os vínculos da última versão (vínculo de versão publicada é imutável) e é publicada em seguida.
      const reborn = (await client.query<{ id: string }>(
        `insert into argument_script_versions (organization_id, script_id, version, status, content, content_hash, source_document_id, source_reference, created_by, scope_type) values ($1,$2,$3,'DRAFT',$4,$5,$6,$7,$8,$9) returning id`,
        [actor.organizationId, id, next, JSON.stringify(last.content), last.content_hash, last.source_document_id, last.source_reference, actor.personId, last.scope_type],
      )).rows[0]!.id
      await client.query(`insert into argument_script_version_scopes (version_id, organization_id, team_id, subteam_id) select $1, organization_id, team_id, subteam_id from argument_script_version_scopes where version_id = $2`, [reborn, last.id])
      await client.query(`update argument_script_versions set status = 'PUBLISHED', effective_from = $2, published_at = $2, published_by = $3 where id = $1`, [reborn, now, actor.personId])
    }
    await audit(client, actor, "ARGUMENT_SCRIPT_REACTIVATED", id, { at: now.toISOString() })
  })
  return getArgumentScript(db, actor.organizationId, scopes, id)
}
