import type pg from "pg"
import { z } from "zod"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { inTransaction } from "../../../shared/infrastructure/database/transaction.js"
import { canOrganizationWide, type AccessContext } from "../../access/domain/access-decision.js"
import { archiveKnowledge } from "../../knowledge/application/knowledge-versions.js"
import { DELETED_ITEMS, deletedItemsBranch, findDeletedItemDefinition, restoreAssignments, type DeletedItemDefinition, type DeletedItemType } from "../domain/deleted-items.js"
import { UUID } from "../domain/explorer-query.js"
import { recordExplorerAudit } from "./explorer-audit.js"
import type { ExplorerActor, ExplorerDeps } from "./explorer-service.js"
import { toExplorerError, withExplorerSession } from "./read-only-session.js"

const LIST_LIMIT = 100
const notFound = () => new DomainError("Item excluído não encontrado.", "DELETED_ITEM_NOT_FOUND", 404)

const canSeeType = (definition: DeletedItemDefinition, access: AccessContext) => "ownerOnly" in definition.access || definition.access.permissions.every((permission) => canOrganizationWide(access, permission))

/** Os tipos que esta pessoa vê. É o que a tela usa para saber se mostra a lista, sem nenhuma consulta ao banco. */
export const visibleDeletedItemTypes = (access: AccessContext) => DELETED_ITEMS.filter((definition) => canSeeType(definition, access)).map(({ type, label }) => ({ type, label }))

const listSchema = z.object({ type: z.string().max(40).optional(), search: z.string().trim().max(200).optional() }).strict()

export type DeletedItem = { type: DeletedItemType; typeLabel: string; id: string; name: string; deletedAt: string; deletedBy: string | null }

type ItemRow = { item_type: DeletedItemType; item_id: string; item_name: string; deleted_at: Date; deleted_by: string | null }

const toItem = (row: ItemRow, definition: DeletedItemDefinition | undefined): DeletedItem => ({ type: row.item_type, typeLabel: definition?.label ?? row.item_type, id: row.item_id, name: row.item_name, deletedAt: new Date(row.deleted_at).toISOString(), deletedBy: row.deleted_by })

/** Lista só os tipos que a pessoa pode gerenciar, os mais recentes primeiro. Excluídos são poucos: não pagina, e avisa quando há mais do que o teto. O termo buscado não vai para a auditoria. */
export async function listDeletedItems(deps: ExplorerDeps, actor: ExplorerActor, raw: unknown) {
  const startedAt = (deps.now ?? Date.now)()
  const input = listSchema.parse(raw)
  const definitions = DELETED_ITEMS.filter((definition) => canSeeType(definition, actor.access) && (!input.type || definition.type === input.type))
  if (definitions.length === 0) return { items: [] as DeletedItem[], hasMore: false }
  const search = input.search ? input.search : null
  const sql = `select i.item_type, i.item_id, i.item_name, i.deleted_at, coalesce(p.matricula, p.name) deleted_by
      from (${definitions.map(deletedItemsBranch).join("\n union all ")}) i
      left join people p on p.id = i.person_id
     where ($3::text is null or position(lower($3) in lower(i.item_name)) > 0) and $2::uuid is not null
     order by i.deleted_at desc, i.item_type, i.item_id
     limit $4`
  try {
    const rows = await withExplorerSession(deps.db, { kind: "QUERY", organizationId: actor.organizationId, accountId: actor.accountId, limits: deps.limits }, async (client) => (await client.query<ItemRow>(sql, [actor.organizationId, actor.accountId, search, LIST_LIMIT + 1])).rows)
    const page = rows.slice(0, LIST_LIMIT)
    await recordExplorerAudit(deps.db, { organizationId: actor.organizationId, personId: actor.personId, accountId: actor.accountId, action: "DATA_HUB_DELETED_ITEMS_LIST", result: "OK", dataset: null, durationMs: (deps.now ?? Date.now)() - startedAt, rows: page.length, hasMore: rows.length > LIST_LIMIT, searched: search !== null, ...(input.type ? { itemType: input.type } : {}) })
    return { items: page.map((row) => toItem(row, findDeletedItemDefinition(row.item_type))), hasMore: rows.length > LIST_LIMIT }
  } catch (error) {
    throw toExplorerError(error, { kind: "QUERY", limits: deps.limits })
  }
}

/** Tipo inexistente, id inválido e tipo que a pessoa não gerencia dão a mesma resposta de item que não existe. */
function requireDefinition(type: string, id: string, access: AccessContext): DeletedItemDefinition {
  const definition = findDeletedItemDefinition(type)
  if (!definition || !UUID.test(id) || !canSeeType(definition, access)) throw notFound()
  return definition
}

async function loadItem(client: pg.ClientBase, definition: DeletedItemDefinition, id: string, actor: ExplorerActor, lock: boolean): Promise<DeletedItem> {
  const owner = "ownerOnly" in definition.access ? " and t.owner_account_id = $3::uuid" : ""
  const row = (await client.query<ItemRow>(
    `select '${definition.type}'::text item_type, t.id::text item_id, (${definition.nameSql})::text item_name, t.deleted_at, coalesce(p.matricula, p.name) deleted_by
       from ${definition.from} left join people p on p.id = ${definition.deletedByPersonSql}
      where t.id = $1 and ${definition.organizationSql} = $2 and t.deleted_at is not null${owner}${lock ? " for update of t" : ""}`,
    owner ? [id, actor.organizationId, actor.accountId] : [id, actor.organizationId],
  )).rows[0]
  if (!row) throw notFound()
  return toItem(row, definition)
}

async function findProblems(client: pg.ClientBase, definition: DeletedItemDefinition, id: string) {
  const problems: { code: string; message: string }[] = []
  for (const check of definition.checks) {
    const labels = (await client.query<{ label: string }>(check.sql, [id])).rows.map((row) => row.label)
    if (labels.length > 0) problems.push({ code: check.code, message: check.message(labels) })
  }
  return problems
}

/** O que acontece se restaurar. Nada é alterado, e a confirmação confere tudo de novo. */
export async function previewRestoration(deps: ExplorerDeps, actor: ExplorerActor, type: string, id: string) {
  const definition = requireDefinition(type, id, actor.access)
  try {
    const { item, problems } = await withExplorerSession(deps.db, { kind: "QUERY", organizationId: actor.organizationId, accountId: actor.accountId, limits: deps.limits }, async (client) => ({ item: await loadItem(client, definition, id, actor, false), problems: await findProblems(client, definition, id) }))
    await recordExplorerAudit(deps.db, { organizationId: actor.organizationId, personId: actor.personId, accountId: actor.accountId, action: "DATA_HUB_DELETED_ITEM_RESTORE_PREVIEW", result: "OK", dataset: null, durationMs: null, itemType: definition.type, itemId: id })
    return { item, problems, notices: definition.notices, canRestore: problems.length === 0 }
  } catch (error) {
    throw toExplorerError(error, { kind: "QUERY", limits: deps.limits })
  }
}

/** Numa transação só, com a linha travada e a auditoria junto: sem auditoria, nada volta. Duas pessoas ao mesmo tempo: a segunda recebe "não encontrado", porque o item já não está excluído. */
export async function restoreDeletedItem(deps: ExplorerDeps, actor: ExplorerActor, type: string, id: string) {
  const definition = requireDefinition(type, id, actor.access)
  try {
    return await inTransaction(deps.db, async (client) => {
      await client.query(`select set_config('statement_timeout', $1, true), set_config('lock_timeout', $2, true)`, [String(deps.limits.cancelTimeoutMs), String(deps.limits.cancelLockTimeoutMs)])
      const item = await loadItem(client, definition, id, actor, true)
      for (const lock of definition.lockParentsSql ?? []) await client.query(lock, [id])
      const problems = await findProblems(client, definition, id)
      if (problems.length > 0) throw new DomainError(problems[0]!.message, "DELETED_ITEM_RESTORE_BLOCKED", 409, { problems })
      for (const statement of definition.restoreChildrenSql ?? []) await client.query(statement, [id])
      await client.query(`update ${definition.table} set ${restoreAssignments(definition)} where id = $1`, [id])
      // Restaurar uma base nunca a põe em uso sozinho: passa pelo mesmo arquivamento da tela, que também cancela atualização em andamento.
      if (definition.type === "KNOWLEDGE_DOCUMENT") await archiveKnowledge(client, id, { organizationId: actor.organizationId, personId: actor.personId, name: null })
      await recordExplorerAudit(client, { organizationId: actor.organizationId, personId: actor.personId, accountId: actor.accountId, action: "DATA_HUB_DELETED_ITEM_RESTORED", result: "OK", dataset: null, durationMs: null, itemType: definition.type, itemId: id, itemName: item.name })
      return { type: definition.type, id, name: item.name, notices: definition.notices }
    })
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw new DomainError("Outro registro ativo já usa este nome ou código. Renomeie ou exclua o atual antes de restaurar.", "DELETED_ITEM_RESTORE_BLOCKED", 409)
    throw toExplorerError(error, { kind: "QUERY", limits: deps.limits })
  }
}
