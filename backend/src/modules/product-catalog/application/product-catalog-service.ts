import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import {
  APPROVAL_BACKDATE_TOLERANCE_MS,
  approvalIssuesOf,
  criterionContentHashOf,
  criterionContentInputSchema,
  criterionVersionSituation,
  productNodeInputSchema,
  productNodePatchSchema,
  treeIssuesOf,
  type CriterionContent,
  type ProductNodeRecord,
} from "../domain/product-catalog.js"
import { z } from "zod"
import { transactionRunner } from "../../../shared/infrastructure/database/transaction.js"

/**
 * Contrato ÚNICO do cadastro de produtos (`PRODUCT_APPLICABILITY_V1`) — rota admin e prova de banco usam o mesmo serviço.
 *
 *   - Itens (famílias/produtos): catálogo da organização. Código travado quando já foi usado (critério aprovado ou abrangência); exclusão
 *     só sem nenhum uso — senão desativar.
 *   - Critérios de identificação: rascunho → APROVADO (imutável, gatilho no banco) → substituído; vigência [início, fim) nunca retroativa;
 *     encerrar = deixa de valer agora; reativar = nova versão a partir de agora; excluir só se nunca foi usado por uma análise.
 *   - Abrangência por produto das fontes (documento da base ou argumentário): vale A PARTIR DE AGORA; a anterior termina, nunca é
 *     reescrita (análise de uma chamada antiga continua com o que valia na data dela).
 * Tudo auditado em `audit_logs`. O texto de um critério é linguagem natural: nada aqui o transforma em regra executável.
 */
type Queryable = Pick<Database, "query">
export type ProductCatalogActor = { organizationId: string; personId: string | null }

async function audit(db: Queryable, actor: ProductCatalogActor, entityType: string, action: string, entityId: string, payload: Record<string, unknown>) {
  await db.query(`insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload) values ($1, $2, $3, $4, $5, $6)`, [actor.organizationId, actor.personId, action, entityType, entityId, JSON.stringify(payload)])
}

const inTransaction = transactionRunner("product_catalog_tx")

// ---------------------------------------------------------------------------------------------
// Itens do catálogo
// ---------------------------------------------------------------------------------------------
const NODE_USAGE = `
  (select count(*) from product_identification_criterion_versions v where v.organization_id = n.organization_id and v.status in ('APPROVED','SUPERSEDED') and n.id = any(v.target_node_ids))::int "criteriaCount",
  (select count(*) from product_scope_assignments s where s.organization_id = n.organization_id and n.id = any(s.node_ids))::int "scopeCount",
  (select count(*) from product_scope_assignments s where s.organization_id = n.organization_id and s.effective_until is null and n.id = any(s.node_ids))::int "openScopeCount",
  (select count(*) from product_catalog_nodes c where c.parent_id = n.id)::int "childCount"`
type NodeRow = { id: string; kind: "FAMILY" | "PRODUCT"; code: string; name: string; description: string | null; parentId: string | null; active: boolean; archivedAt: Date | null; createdAt: Date; updatedAt: Date; criteriaCount: number; scopeCount: number; openScopeCount: number; childCount: number }
export type ProductNodeListItem = ProductNodeRecord & { criteriaCount: number; scopeCount: number; childCount: number; inUse: boolean }
const nodeOf = (row: NodeRow): ProductNodeListItem => ({ id: row.id, kind: row.kind, code: row.code, name: row.name, description: row.description, parentId: row.parentId, active: row.active, archivedAt: row.archivedAt ? new Date(row.archivedAt).toISOString() : null, createdAt: new Date(row.createdAt).toISOString(), updatedAt: new Date(row.updatedAt).toISOString(), criteriaCount: row.criteriaCount, scopeCount: row.scopeCount, childCount: row.childCount, inUse: row.criteriaCount > 0 || row.scopeCount > 0 })

export async function listProductNodes(db: Queryable, organizationId: string): Promise<ProductNodeListItem[]> {
  const rows = (await db.query<NodeRow>(
    `select n.id, n.kind, n.code, n.name, n.description, n.parent_id "parentId", n.active, n.archived_at "archivedAt", n.created_at "createdAt", n.updated_at "updatedAt", ${NODE_USAGE}
       from product_catalog_nodes n where n.organization_id = $1 order by n.kind, n.name, n.code`,
    [organizationId],
  )).rows
  return rows.map(nodeOf)
}

async function requireNode(db: Queryable, organizationId: string, id: string): Promise<ProductNodeListItem> {
  const row = (await db.query<NodeRow>(`select n.id, n.kind, n.code, n.name, n.description, n.parent_id "parentId", n.active, n.archived_at "archivedAt", n.created_at "createdAt", n.updated_at "updatedAt", ${NODE_USAGE} from product_catalog_nodes n where n.id = $1 and n.organization_id = $2`, [id, organizationId])).rows[0]
  if (!row) throw new DomainError("Produto ou categoria não encontrado.", "PRODUCT_NODE_NOT_FOUND", 404)
  return nodeOf(row)
}

const rethrowCode = (error: unknown): never => {
  if ((error as { code?: string }).code === "23505") throw new DomainError("Já existe um produto ou categoria com esse código.", "PRODUCT_CODE_TAKEN", 409)
  throw error
}

export async function createProductNode(db: Database, actor: ProductCatalogActor, body: unknown): Promise<ProductNodeListItem> {
  const input = productNodeInputSchema.parse(body)
  const nodes = await listProductNodes(db, actor.organizationId)
  const issues = treeIssuesOf({ id: null, kind: input.kind, parentId: input.parentId }, nodes)
  if (issues.length > 0) throw new DomainError(issues[0]!, "PRODUCT_TREE_INVALID", 422, { issues })
  if (input.parentId && !nodes.find((node) => node.id === input.parentId)?.active) throw new DomainError("A categoria escolhida está desativada.", "PRODUCT_PARENT_INACTIVE", 422)
  const id = await inTransaction(db, async (client) => {
    const created = (await client.query<{ id: string }>(
      `insert into product_catalog_nodes (organization_id, kind, code, name, description, parent_id, created_by, updated_by) values ($1,$2,$3,$4,$5,$6,$7,$7) returning id`,
      [actor.organizationId, input.kind, input.code, input.name, input.description, input.parentId, actor.personId],
    )).rows[0]!.id
    await audit(client, actor, "product_catalog_node", "PRODUCT_NODE_CREATED", created, { kind: input.kind, code: input.code, name: input.name, parentId: input.parentId })
    return created
  }).catch(rethrowCode)
  return requireNode(db, actor.organizationId, id)
}

export async function updateProductNode(db: Database, actor: ProductCatalogActor, id: string, body: unknown): Promise<ProductNodeListItem> {
  const input = productNodePatchSchema.parse(body)
  const current = await requireNode(db, actor.organizationId, id)
  if (input.code !== undefined && input.code !== current.code && current.inUse) throw new DomainError("O código já é usado por bases ou indícios: crie outro produto em vez de trocar o código.", "PRODUCT_CODE_LOCKED", 409)
  const parentId = input.parentId === undefined ? current.parentId : input.parentId
  if (parentId !== current.parentId) {
    const issues = treeIssuesOf({ id, kind: current.kind, parentId }, await listProductNodes(db, actor.organizationId))
    if (issues.length > 0) throw new DomainError(issues[0]!, "PRODUCT_TREE_INVALID", 422, { issues })
  }
  await inTransaction(db, async (client) => {
    await client.query(
      `update product_catalog_nodes set code = $3, name = $4, description = $5, parent_id = $6, updated_by = $7, updated_at = now() where id = $1 and organization_id = $2`,
      [id, actor.organizationId, input.code ?? current.code, input.name ?? current.name, input.description === undefined ? current.description : input.description, parentId, actor.personId],
    )
    await audit(client, actor, "product_catalog_node", "PRODUCT_NODE_UPDATED", id, { before: { code: current.code, name: current.name, description: current.description, parentId: current.parentId }, after: { code: input.code ?? current.code, name: input.name ?? current.name, parentId } })
  }).catch(rethrowCode)
  return requireNode(db, actor.organizationId, id)
}

export async function setProductNodeActive(db: Queryable, actor: ProductCatalogActor, id: string, active: boolean, now: Date = new Date()): Promise<ProductNodeListItem> {
  const current = await requireNode(db, actor.organizationId, id)
  if (current.active === active) return current
  if (!active) {
    const activeChildren = (await db.query<{ count: number }>(`select count(*)::int count from product_catalog_nodes where parent_id = $1 and active`, [id])).rows[0]!.count
    if (activeChildren > 0) throw new DomainError("Desative primeiro os produtos desta categoria.", "PRODUCT_NODE_HAS_ACTIVE_CHILDREN", 409)
  } else if (current.parentId) {
    const parent = await requireNode(db, actor.organizationId, current.parentId)
    if (!parent.active) throw new DomainError("Reative primeiro a categoria deste item.", "PRODUCT_PARENT_INACTIVE", 409)
  }
  await db.query(`update product_catalog_nodes set active = $3, archived_at = $4, updated_by = $5, updated_at = now() where id = $1 and organization_id = $2`, [id, actor.organizationId, active, active ? null : now, actor.personId])
  await audit(db, actor, "product_catalog_node", active ? "PRODUCT_NODE_REACTIVATED" : "PRODUCT_NODE_DEACTIVATED", id, { at: now.toISOString() })
  return requireNode(db, actor.organizationId, id)
}

export async function deleteProductNode(db: Queryable, actor: ProductCatalogActor, id: string): Promise<void> {
  const current = await requireNode(db, actor.organizationId, id)
  const drafts = (await db.query<{ count: number }>(`select count(*)::int count from product_identification_criterion_versions where organization_id = $1 and $2 = any(target_node_ids)`, [actor.organizationId, id])).rows[0]!.count
  if (current.inUse || current.childCount > 0 || drafts > 0) throw new DomainError("Este item já é usado (por bases, indícios ou produtos dentro dele): desative em vez de excluir.", "PRODUCT_NODE_IN_USE", 409, { criteria: current.criteriaCount, scopes: current.scopeCount, children: current.childCount, drafts })
  await db.query(`delete from product_catalog_nodes where id = $1 and organization_id = $2`, [id, actor.organizationId])
  await audit(db, actor, "product_catalog_node", "PRODUCT_NODE_DELETED", id, { code: current.code, name: current.name, kind: current.kind })
}

// ---------------------------------------------------------------------------------------------
// Critérios de identificação (versionados)
// ---------------------------------------------------------------------------------------------
type VersionRow = { id: string; version: number; status: "DRAFT" | "APPROVED" | "SUPERSEDED"; statement: string; target_node_ids: string[]; context: string | null; limitations: string | null; strength: "CONCLUSIVE" | "INDICATIVE"; conclusive_when: string | null; source_document_id: string | null; source_title: string | null; source_reference: string | null; content_hash: string; effective_from: Date | null; effective_until: Date | null; approved_at: Date | null; approved_by_name: string | null; created_at: Date; updated_at: Date }
const versionOf = (row: VersionRow, now: Date) => ({
  id: row.id,
  version: row.version,
  status: row.status,
  situation: criterionVersionSituation({ status: row.status, effectiveFrom: row.effective_from ? new Date(row.effective_from).toISOString() : null, effectiveUntil: row.effective_until ? new Date(row.effective_until).toISOString() : null }, now),
  content: { statement: row.statement, targetNodeIds: row.target_node_ids, context: row.context, limitations: row.limitations, strength: row.strength, conclusiveWhen: row.conclusive_when, sourceDocumentId: row.source_document_id, sourceReference: row.source_reference } satisfies CriterionContent,
  sourceDocumentTitle: row.source_title,
  contentHash: row.content_hash,
  effectiveFrom: row.effective_from ? new Date(row.effective_from).toISOString() : null,
  effectiveUntil: row.effective_until ? new Date(row.effective_until).toISOString() : null,
  approvedAt: row.approved_at ? new Date(row.approved_at).toISOString() : null,
  approvedByName: row.approved_by_name,
  updatedAt: new Date(row.updated_at).toISOString(),
})
const VERSION_SELECT = `select v.id, v.version, v.status, v.statement, v.target_node_ids, v.context, v.limitations, v.strength, v.conclusive_when, v.source_document_id, d.title source_title, v.source_reference, v.content_hash,
       v.effective_from, v.effective_until, v.approved_at, p.name approved_by_name, v.created_at, v.updated_at
  from product_identification_criterion_versions v
  left join knowledge_documents d on d.id = v.source_document_id and d.organization_id = v.organization_id
  left join people p on p.id = v.approved_by`

/** Uso por análises gravadas (fotografia em `call_assessments.product_identification`). */
const CRITERION_USED_SQL = `select exists (select 1 from call_assessments a where a.organization_id = $1 and a.product_identification is not null and jsonb_path_exists(a.product_identification, '$.catalog.criteria[*] ? (@.criterionId == $id)', jsonb_build_object('id', $2::text))) used`

export async function listIdentificationCriteria(db: Queryable, organizationId: string, now: Date = new Date()) {
  const rows = (await db.query<{ id: string; title: string; status: "ACTIVE" | "ARCHIVED"; updated_at: Date } & { current: VersionRow | null; draft: VersionRow | null }>(
    `select c.id, c.title, c.status, c.updated_at,
            (select row_to_json(x) from (${VERSION_SELECT} where v.criterion_id = c.id and v.status in ('APPROVED','SUPERSEDED') order by v.version desc limit 1) x) current,
            (select row_to_json(x) from (${VERSION_SELECT} where v.criterion_id = c.id and v.status = 'DRAFT' limit 1) x) draft
       from product_identification_criteria c where c.organization_id = $1 order by c.title`,
    [organizationId],
  )).rows
  return rows.map((row) => ({ id: row.id, title: row.title, status: row.status, updatedAt: new Date(row.updated_at).toISOString(), current: row.current ? versionOf(row.current, now) : null, draft: row.draft ? versionOf(row.draft, now) : null }))
}

export async function getIdentificationCriterion(db: Queryable, organizationId: string, id: string, now: Date = new Date()) {
  const row = (await db.query<{ id: string; title: string; status: "ACTIVE" | "ARCHIVED"; updated_at: Date }>(`select id, title, status, updated_at from product_identification_criteria where id = $1 and organization_id = $2`, [id, organizationId])).rows[0]
  if (!row) throw new DomainError("Indício não encontrado.", "PRODUCT_CRITERION_NOT_FOUND", 404)
  const versions = (await db.query<VersionRow>(`${VERSION_SELECT} where v.criterion_id = $1 order by v.version desc`, [id])).rows.map((version) => versionOf(version, now))
  const used = (await db.query<{ used: boolean }>(CRITERION_USED_SQL, [organizationId, id])).rows[0]!.used
  return { id: row.id, title: row.title, status: row.status, updatedAt: new Date(row.updated_at).toISOString(), versions, usedByAnalyses: used }
}

const createCriterionSchema = z.object({ title: z.string().trim().min(3).max(160), content: z.unknown().optional().transform((value) => criterionContentInputSchema.parse(value ?? {})) })
const updateCriterionSchema = z.object({ title: z.string().trim().min(3).max(160).optional(), content: criterionContentInputSchema.optional() })
// `null` (a tela sem data) = agora — nunca `new Date(null)` (1970), que seria recusado como retroativo.
const approveSchema = z.object({ effectiveFrom: z.coerce.date().nullish() })

async function requireTargetsAndSource(db: Queryable, organizationId: string, content: CriterionContent) {
  if (content.targetNodeIds.length > 0) {
    const found = (await db.query<{ id: string }>(`select id from product_catalog_nodes where organization_id = $1 and id = any($2::uuid[])`, [organizationId, content.targetNodeIds])).rows
    if (found.length !== new Set(content.targetNodeIds).size) throw new DomainError("Um dos produtos indicados não existe nesta organização.", "PRODUCT_CRITERION_TARGET_INVALID", 422)
  }
  if (content.sourceDocumentId) {
    const document = (await db.query(`select 1 from knowledge_documents where id = $1 and organization_id = $2 and deleted_at is null`, [content.sourceDocumentId, organizationId])).rows[0]
    if (!document) throw new DomainError("Documento de origem não encontrado na base desta organização.", "PRODUCT_CRITERION_SOURCE_INVALID", 422)
  }
}

export async function createIdentificationCriterion(db: Database, actor: ProductCatalogActor, body: unknown) {
  const input = createCriterionSchema.parse(body)
  await requireTargetsAndSource(db, actor.organizationId, input.content)
  const id = await inTransaction(db, async (client) => {
    const created = (await client.query<{ id: string }>(`insert into product_identification_criteria (organization_id, title, created_by, updated_by) values ($1,$2,$3,$3) returning id`, [actor.organizationId, input.title, actor.personId])).rows[0]!.id
    await insertDraft(client, actor, created, 1, input.content)
    await audit(client, actor, "product_identification_criterion", "PRODUCT_CRITERION_CREATED", created, { title: input.title })
    return created
  })
  return getIdentificationCriterion(db, actor.organizationId, id)
}

async function insertDraft(db: Queryable, actor: ProductCatalogActor, criterionId: string, version: number, content: CriterionContent) {
  await db.query(
    `insert into product_identification_criterion_versions (organization_id, criterion_id, version, status, statement, target_node_ids, context, limitations, strength, conclusive_when, source_document_id, source_reference, content_hash, created_by)
     values ($1,$2,$3,'DRAFT',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [actor.organizationId, criterionId, version, content.statement, content.targetNodeIds, content.context, content.limitations, content.strength, content.conclusiveWhen, content.sourceDocumentId, content.sourceReference, criterionContentHashOf(content), actor.personId],
  )
}

async function requireCriterion(db: Queryable, organizationId: string, id: string) {
  const row = (await db.query<{ id: string; title: string; status: "ACTIVE" | "ARCHIVED" }>(`select id, title, status from product_identification_criteria where id = $1 and organization_id = $2`, [id, organizationId])).rows[0]
  if (!row) throw new DomainError("Indício não encontrado.", "PRODUCT_CRITERION_NOT_FOUND", 404)
  return row
}

/** Título muda a qualquer momento (rótulo); o conteúdo vai sempre para o RASCUNHO (criado a partir da versão aprovada mais recente). */
export async function updateIdentificationCriterion(db: Database, actor: ProductCatalogActor, id: string, body: unknown) {
  const input = updateCriterionSchema.parse(body)
  const current = await requireCriterion(db, actor.organizationId, id)
  if (input.content) await requireTargetsAndSource(db, actor.organizationId, input.content)
  await inTransaction(db, async (client) => {
    if (input.title && input.title !== current.title) await client.query(`update product_identification_criteria set title = $2, updated_by = $3, updated_at = now() where id = $1`, [id, input.title, actor.personId])
    if (input.content) {
      const draft = (await client.query<{ id: string }>(`select id from product_identification_criterion_versions where criterion_id = $1 and status = 'DRAFT'`, [id])).rows[0]
      if (draft) {
        await client.query(
          `update product_identification_criterion_versions set statement = $2, target_node_ids = $3, context = $4, limitations = $5, strength = $6, conclusive_when = $7, source_document_id = $8, source_reference = $9, content_hash = $10, updated_at = now() where id = $1`,
          [draft.id, input.content.statement, input.content.targetNodeIds, input.content.context, input.content.limitations, input.content.strength, input.content.conclusiveWhen, input.content.sourceDocumentId, input.content.sourceReference, criterionContentHashOf(input.content)],
        )
      } else {
        const next = (await client.query<{ next: number }>(`select coalesce(max(version), 0) + 1 next from product_identification_criterion_versions where criterion_id = $1`, [id])).rows[0]!.next
        await insertDraft(client, actor, id, next, input.content)
      }
    }
    await audit(client, actor, "product_identification_criterion", "PRODUCT_CRITERION_UPDATED", id, { title: input.title ?? null, contentChanged: Boolean(input.content) })
  })
  return getIdentificationCriterion(db, actor.organizationId, id)
}

export async function discardIdentificationDraft(db: Database, actor: ProductCatalogActor, id: string) {
  await requireCriterion(db, actor.organizationId, id)
  const approved = (await db.query<{ count: number }>(`select count(*)::int count from product_identification_criterion_versions where criterion_id = $1 and status <> 'DRAFT'`, [id])).rows[0]!.count
  if (approved === 0) throw new DomainError("O indício nunca foi aprovado: exclua o indício em vez de descartar o único rascunho.", "PRODUCT_CRITERION_ONLY_DRAFT", 409)
  await db.query(`delete from product_identification_criterion_versions where criterion_id = $1 and status = 'DRAFT'`, [id])
  await audit(db, actor, "product_identification_criterion", "PRODUCT_CRITERION_DRAFT_DISCARDED", id, {})
  return getIdentificationCriterion(db, actor.organizationId, id)
}

/** APROVAR: o rascunho passa a valer a partir de `effectiveFrom` (nunca antes de agora); a versão aprovada anterior termina ali. */
export async function approveIdentificationCriterion(db: Database, actor: ProductCatalogActor, id: string, body: unknown, now: Date = new Date()) {
  const input = approveSchema.parse(body ?? {})
  const criterion = await requireCriterion(db, actor.organizationId, id)
  if (criterion.status === "ARCHIVED") throw new DomainError("Indício encerrado: reative-o para aprovar uma nova versão.", "PRODUCT_CRITERION_ARCHIVED", 409)
  const effectiveFrom = input.effectiveFrom ?? now
  if (effectiveFrom.getTime() < now.getTime() - APPROVAL_BACKDATE_TOLERANCE_MS) throw new DomainError("A vigência não pode começar antes da aprovação: um indício aprovado agora nunca vale para chamadas anteriores.", "PRODUCT_CRITERION_RETROACTIVE", 422)
  await inTransaction(db, async (client) => {
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [`product-criterion:${id}`])
    const draft = (await client.query<VersionRow>(`${VERSION_SELECT} where v.criterion_id = $1 and v.status = 'DRAFT'`, [id])).rows[0]
    if (!draft) throw new DomainError("Não há rascunho para aprovar.", "PRODUCT_CRITERION_NO_DRAFT", 409)
    const active = new Set((await client.query<{ id: string }>(`select id from product_catalog_nodes where organization_id = $1 and active`, [actor.organizationId])).rows.map((row) => row.id))
    const content = versionOf(draft, now).content
    const issues = approvalIssuesOf(content, active)
    if (issues.length > 0) throw new DomainError("O rascunho ainda não pode ser aprovado.", "PRODUCT_CRITERION_NOT_READY", 422, { issues })
    const current = (await client.query<{ id: string; effective_from: Date }>(`select id, effective_from from product_identification_criterion_versions where criterion_id = $1 and status = 'APPROVED'`, [id])).rows[0]
    if (current && effectiveFrom.getTime() <= new Date(current.effective_from).getTime()) throw new DomainError("A nova vigência precisa começar depois do início da versão vigente.", "PRODUCT_CRITERION_EFFECTIVE_ORDER", 422)
    if (current) await client.query(`update product_identification_criterion_versions set status = 'SUPERSEDED', effective_until = case when effective_until is null or effective_until > $2 then $2 else effective_until end, updated_at = now() where id = $1`, [current.id, effectiveFrom])
    await client.query(`update product_identification_criterion_versions set status = 'APPROVED', effective_from = $2, approved_at = $3, approved_by = $4, updated_at = now() where id = $1`, [draft.id, effectiveFrom, now, actor.personId])
    await client.query(`update product_identification_criteria set updated_by = $2, updated_at = now() where id = $1`, [id, actor.personId])
    await audit(client, actor, "product_identification_criterion", "PRODUCT_CRITERION_APPROVED", id, { version: draft.version, effectiveFrom: effectiveFrom.toISOString(), supersededVersionId: current?.id ?? null, contentHash: draft.content_hash })
  })
  return getIdentificationCriterion(db, actor.organizationId, id)
}

/** ENCERRAR: deixa de valer agora (análises de chamadas anteriores continuam com a versão da época). */
export async function archiveIdentificationCriterion(db: Database, actor: ProductCatalogActor, id: string, now: Date = new Date()) {
  const criterion = await requireCriterion(db, actor.organizationId, id)
  if (criterion.status === "ARCHIVED") return getIdentificationCriterion(db, actor.organizationId, id)
  await inTransaction(db, async (client) => {
    const current = (await client.query<{ id: string; effective_from: Date }>(`select id, effective_from from product_identification_criterion_versions where criterion_id = $1 and status = 'APPROVED'`, [id])).rows[0]
    if (current && new Date(current.effective_from).getTime() > now.getTime()) throw new DomainError("A versão aprovada ainda não começou a valer: aguarde o início ou aprove outra data.", "PRODUCT_CRITERION_NOT_STARTED", 409)
    if (current) await client.query(`update product_identification_criterion_versions set effective_until = $2, updated_at = now() where id = $1 and (effective_until is null or effective_until > $2)`, [current.id, now])
    await client.query(`update product_identification_criteria set status = 'ARCHIVED', updated_by = $2, updated_at = now() where id = $1`, [id, actor.personId])
    await audit(client, actor, "product_identification_criterion", "PRODUCT_CRITERION_ARCHIVED", id, { at: now.toISOString() })
  })
  return getIdentificationCriterion(db, actor.organizationId, id)
}

/** REATIVAR: volta a valer a partir de agora com o conteúdo da última versão aprovada (nova versão; a lacuna fica na história). */
export async function reactivateIdentificationCriterion(db: Database, actor: ProductCatalogActor, id: string, now: Date = new Date()) {
  const criterion = await requireCriterion(db, actor.organizationId, id)
  if (criterion.status === "ACTIVE") return getIdentificationCriterion(db, actor.organizationId, id)
  await inTransaction(db, async (client) => {
    const last = (await client.query<VersionRow>(`${VERSION_SELECT} where v.criterion_id = $1 and v.status in ('APPROVED','SUPERSEDED') order by v.version desc limit 1`, [id])).rows[0]
    await client.query(`update product_identification_criteria set status = 'ACTIVE', updated_by = $2, updated_at = now() where id = $1`, [id, actor.personId])
    if (last) {
      const active = new Set((await client.query<{ id: string }>(`select id from product_catalog_nodes where organization_id = $1 and active`, [actor.organizationId])).rows.map((row) => row.id))
      const content = versionOf(last, now).content
      const issues = approvalIssuesOf(content, active)
      if (issues.length > 0) throw new DomainError("A última versão não pode voltar a valer como está (um produto indicado foi desativado?). Edite e aprove uma nova versão.", "PRODUCT_CRITERION_NOT_READY", 422, { issues })
      await client.query(`delete from product_identification_criterion_versions where criterion_id = $1 and status = 'DRAFT'`, [id])
      await client.query(`update product_identification_criterion_versions set status = 'SUPERSEDED', updated_at = now() where id = $1 and status = 'APPROVED'`, [last.id])
      const next = (await client.query<{ next: number }>(`select coalesce(max(version), 0) + 1 next from product_identification_criterion_versions where criterion_id = $1`, [id])).rows[0]!.next
      await client.query(
        `insert into product_identification_criterion_versions (organization_id, criterion_id, version, status, statement, target_node_ids, context, limitations, strength, conclusive_when, source_document_id, source_reference, content_hash, effective_from, approved_at, approved_by, created_by)
         values ($1,$2,$3,'APPROVED',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13,$14,$14)`,
        [actor.organizationId, id, next, content.statement, content.targetNodeIds, content.context, content.limitations, content.strength, content.conclusiveWhen, content.sourceDocumentId, content.sourceReference, criterionContentHashOf(content), now, actor.personId],
      )
    }
    await audit(client, actor, "product_identification_criterion", "PRODUCT_CRITERION_REACTIVATED", id, { at: now.toISOString() })
  })
  return getIdentificationCriterion(db, actor.organizationId, id)
}

/** EXCLUIR: só se nenhuma análise usou o critério (a fotografia de uma análise é histórico). Usado → encerrar. */
export async function deleteIdentificationCriterion(db: Database, actor: ProductCatalogActor, id: string) {
  const criterion = await getIdentificationCriterion(db, actor.organizationId, id)
  if (criterion.usedByAnalyses) throw new DomainError("Este indício já foi usado na análise de chamadas: encerre-o em vez de excluir.", "PRODUCT_CRITERION_IN_USE", 409)
  await inTransaction(db, async (client) => {
    await audit(client, actor, "product_identification_criterion", "PRODUCT_CRITERION_DELETED", id, { title: criterion.title, lastVersion: criterion.versions[0] ?? null })
    await client.query(`delete from product_identification_criteria where id = $1 and organization_id = $2`, [id, actor.organizationId])
  })
}

// ---------------------------------------------------------------------------------------------
// Abrangência por produto das fontes
// ---------------------------------------------------------------------------------------------
export const SOURCE_KINDS = ["KNOWLEDGE_DOCUMENT", "ARGUMENT_SCRIPT"] as const
export type SourceKind = (typeof SOURCE_KINDS)[number]
const scopeInputSchema = z.object({ nodeIds: z.array(z.string().uuid()).max(40) })

/** Fontes (documentos da base e argumentários) com a abrangência por produto vigente agora. */
export async function listProductScopeSources(db: Queryable, organizationId: string) {
  const rows = (await db.query<{ source_kind: SourceKind; source_id: string; title: string; status: string | null; assignment_id: string | null; node_ids: string[] | null; effective_from: Date | null }>(
    `select src.source_kind, src.source_id, src.title, src.status, s.id assignment_id, s.node_ids, s.effective_from
       from (
         select 'KNOWLEDGE_DOCUMENT'::text source_kind, d.id source_id, d.title, null::text status from knowledge_documents d where d.organization_id = $1 and d.deleted_at is null
         union all
         select 'ARGUMENT_SCRIPT'::text, a.id, a.name, a.status from argument_scripts a where a.organization_id = $1
       ) src
       left join product_scope_assignments s on s.organization_id = $1 and s.source_id = src.source_id and s.effective_until is null
      order by src.source_kind, src.title`,
    [organizationId],
  )).rows
  return rows.map((row) => ({ sourceKind: row.source_kind, sourceId: row.source_id, title: row.title, status: row.status, scope: row.assignment_id ? { assignmentId: row.assignment_id, nodeIds: row.node_ids ?? [], since: new Date(row.effective_from!).toISOString() } : null }))
}

async function requireSource(db: Queryable, organizationId: string, kind: SourceKind, id: string): Promise<string> {
  const row = kind === "KNOWLEDGE_DOCUMENT"
    ? (await db.query<{ title: string }>(`select title from knowledge_documents where id = $1 and organization_id = $2 and deleted_at is null`, [id, organizationId])).rows[0]
    : (await db.query<{ title: string }>(`select name title from argument_scripts where id = $1 and organization_id = $2`, [id, organizationId])).rows[0]
  if (!row) throw new DomainError("Base não encontrada nesta organização.", "PRODUCT_SCOPE_SOURCE_NOT_FOUND", 404)
  return row.title
}

export async function productScopeHistory(db: Queryable, organizationId: string, kind: SourceKind, id: string) {
  const title = await requireSource(db, organizationId, kind, id)
  const history = (await db.query<{ id: string; node_ids: string[]; effective_from: Date; effective_until: Date | null; created_by_name: string | null }>(
    `select s.id, s.node_ids, s.effective_from, s.effective_until, p.name created_by_name from product_scope_assignments s left join people p on p.id = s.created_by
      where s.organization_id = $1 and s.source_kind = $2 and s.source_id = $3 order by s.effective_from desc`,
    [organizationId, kind, id],
  )).rows
  return { sourceKind: kind, sourceId: id, title, history: history.map((row) => ({ assignmentId: row.id, nodeIds: row.node_ids, effectiveFrom: new Date(row.effective_from).toISOString(), effectiveUntil: row.effective_until ? new Date(row.effective_until).toISOString() : null, createdByName: row.created_by_name })) }
}

/**
 * Define a abrangência da fonte A PARTIR DE AGORA (lista vazia = vale para qualquer produto). A anterior termina agora — nunca é apagada
 * nem reescrita: a análise de uma chamada anterior usa a que valia na data da chamada.
 */
export async function setProductScope(db: Database, actor: ProductCatalogActor, kind: SourceKind, id: string, body: unknown, now: Date = new Date()) {
  const input = scopeInputSchema.parse(body)
  await requireSource(db, actor.organizationId, kind, id)
  const nodeIds = [...new Set(input.nodeIds)].sort()
  if (nodeIds.length > 0) {
    const active = (await db.query<{ id: string }>(`select id from product_catalog_nodes where organization_id = $1 and active and id = any($2::uuid[])`, [actor.organizationId, nodeIds])).rows
    if (active.length !== nodeIds.length) throw new DomainError("Escolha só produtos ou categorias ativos.", "PRODUCT_SCOPE_TARGET_INVALID", 422)
  }
  await inTransaction(db, async (client) => {
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [`product-scope:${id}`])
    const open = (await client.query<{ id: string; node_ids: string[] }>(`select id, node_ids from product_scope_assignments where organization_id = $1 and source_kind = $2 and source_id = $3 and effective_until is null`, [actor.organizationId, kind, id])).rows[0]
    if (open && [...open.node_ids].sort().join(",") === nodeIds.join(",")) return
    if (!open && nodeIds.length === 0) return
    if (open) await client.query(`update product_scope_assignments set effective_until = $2, ended_by = $3 where id = $1`, [open.id, now, actor.personId])
    let assignmentId: string | null = null
    if (nodeIds.length > 0) assignmentId = (await client.query<{ id: string }>(`insert into product_scope_assignments (organization_id, source_kind, source_id, node_ids, effective_from, created_by) values ($1,$2,$3,$4,$5,$6) returning id`, [actor.organizationId, kind, id, nodeIds, now, actor.personId])).rows[0]!.id
    await audit(client, actor, "product_scope_assignment", "PRODUCT_SCOPE_SET", assignmentId ?? open!.id, { sourceKind: kind, sourceId: id, before: open?.node_ids ?? [], after: nodeIds, at: now.toISOString() })
  })
  return productScopeHistory(db, actor.organizationId, kind, id)
}
