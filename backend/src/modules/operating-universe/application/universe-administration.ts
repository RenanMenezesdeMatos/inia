import type { Database } from "../../../infrastructure/database/pool.js"
import { inTransaction } from "../../../shared/infrastructure/database/transaction.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { canManageScope, getManageableScopes, type ManageableScopes } from "../../auth/application/manageable-scopes.js"
import { loadPersonFieldControl } from "../../data-hub/application/person-field-control.js"
import { OPERATING_UNIVERSES, type OperatingUniverse } from "../domain/operating-universe.js"
import { isUniverseEnforced } from "./universe-access.js"
import { existingUniverseConflicts } from "./universe-links.js"
import { linkedResources, resourceConflictError, resourceLinkConflicts, UNIVERSE_RESOURCE_KINDS, UNIVERSE_RESOURCES, type UniverseResourceKind } from "./resource-universe.js"

/**
 * REGULARIZAÇÃO E ATIVAÇÃO — o fluxo administrativo do universo de atuação:
 *  1. prontidão: quantos colaboradores e recursos estão pendentes e quais vínculos atravessam universos (o que ficaria fora da operação);
 *  2. classificação: recurso a recurso (na tela de cada um ou aqui) e pessoas em lote — sempre decisão de quem administra, nunca palpite;
 *  3. ativação: a partir dela o backend exige universo nos cadastros novos e as consultas operacionais filtram por universo.
 */
type Actor = { organizationId: string; sub: string; personId: string }

export async function loadReadiness(db: Database, organizationId: string) {
  const counts = await Promise.all(
    UNIVERSE_RESOURCE_KINDS.map(async (kind) => {
      const def = UNIVERSE_RESOURCES[kind]
      const row = (await db.query<{ total: string; pending: string }>(
        `select count(*)::text total, count(*) filter (where operating_universe is null)::text pending from ${def.read} where organization_id = $1${def.where ? ` and ${def.where}` : ""}`,
        [organizationId],
      )).rows[0]!
      return { kind, label: def.label, total: Number(row.total), pending: Number(row.pending) }
    }),
  )
  const people = (await db.query<{ total: string; pending: string; operators_pending: string }>(
    `select count(*)::text total, count(*) filter (where operating_universe is null)::text pending,
            count(*) filter (where operating_universe is null and role = 'OPERATOR')::text operators_pending
       from people where organization_id = $1 and active`,
    [organizationId],
  )).rows[0]!
  const byUniverse = (await db.query<{ operating_universe: string | null; count: string }>(`select operating_universe, count(*)::text from people where organization_id = $1 and active group by 1`, [organizationId])).rows
  const pendingByGroup = (await db.query<{ team_id: string | null; team_name: string | null; count: string }>(
    `select p.team_id, t.name team_name, count(*)::text from people p left join teams t on t.id = p.team_id
      where p.organization_id = $1 and p.active and p.operating_universe is null group by 1, 2 order by count(*) desc, t.name limit 50`,
    [organizationId],
  )).rows
  const conflicts = await allConflicts(db, organizationId)
  const enforcement = (await db.query<{ enforced_at: Date | null; enforced_by: string | null }>(
    `select o.operating_universe_enforced_at enforced_at, p.name enforced_by from organizations o left join people p on p.id = o.operating_universe_enforced_by where o.id = $1`,
    [organizationId],
  )).rows[0]
  return {
    enforced: Boolean(enforcement?.enforced_at),
    enforcedAt: enforcement?.enforced_at ?? null,
    enforcedBy: enforcement?.enforced_by ?? null,
    people: { total: Number(people.total), pending: Number(people.pending), operatorsPending: Number(people.operators_pending), byUniverse: Object.fromEntries(byUniverse.map((row) => [row.operating_universe ?? "PENDING", Number(row.count)])) },
    pendingPeopleByGroup: pendingByGroup.map((row) => ({ teamId: row.team_id, teamName: row.team_name, pending: Number(row.count) })),
    resources: counts,
    conflicts,
    /** O que fica indisponível na operação se ativar agora — texto explicativo derivado das contagens. */
    impact: impactOf(Number(people.pending), Number(people.operators_pending), counts, conflicts.length),
  }
}

function impactOf(peoplePending: number, operatorsPending: number, counts: readonly { label: string; pending: number }[], conflicts: number): string[] {
  const lines: string[] = []
  if (operatorsPending > 0) lines.push(`${operatorsPending} operador(es) sem universo ficariam sem bases, produtos e Workflows segmentados até serem classificados (a INIA avisa que o cadastro está pendente).`)
  if (peoplePending > operatorsPending) lines.push(`${peoplePending - operatorsPending} liderança(s) sem universo veriam apenas quem a permissão de todos os universos alcança.`)
  for (const count of counts) if (count.pending > 0) lines.push(`${count.pending} ${count.label.toLowerCase()}(s) sem universo sairiam das consultas e execuções operacionais (continuam na Administração para classificar).`)
  if (conflicts > 0) lines.push(`${conflicts} vínculo(s) entre universos diferentes precisam ser desfeitos ou reclassificados.`)
  if (lines.length === 0) lines.push("Nada pendente: ativar não deixa ninguém nem nenhum recurso fora da operação.")
  return lines
}

/** Todos os vínculos atuais entre universos diferentes (produto × base/argumentário e os vínculos do registro de recursos). */
export async function allConflicts(db: Database, organizationId: string) {
  const productLinks = (await existingUniverseConflicts(db, organizationId)).map((conflict) => ({
    from: { kind: conflict.sourceKind, id: conflict.sourceId, name: conflict.sourceName, operatingUniverse: conflict.sourceUniverse },
    to: { kind: "PRODUCT" as const, id: conflict.productId, name: conflict.productName, operatingUniverse: conflict.productUniverse },
    viaCategory: conflict.viaCategoryId !== null,
  }))
  const others: { from: { kind: UniverseResourceKind; id: string; name: string; operatingUniverse: string | null }; to: { kind: string; id: string; name: string; operatingUniverse: string | null }; viaCategory: boolean }[] = []
  // Do lado "quem usa": agentes, orquestradores e Workflows classificados (cada vínculo aparece uma vez).
  for (const kind of ["AGENT", "ORCHESTRATOR", "WORKFLOW"] as const) {
    const def = UNIVERSE_RESOURCES[kind]
    const items = (await db.query<{ id: string; name: string; operating_universe: string }>(`select id, ${def.name} name, operating_universe from ${def.read} where organization_id = $1 and operating_universe is not null`, [organizationId])).rows
    for (const item of items) {
      for (const linked of await linkedResources(db, organizationId, kind, item.id)) {
        if (linked.operatingUniverse === null || linked.operatingUniverse === item.operating_universe) continue
        if (kind === "AGENT" && (linked.kind === "ORCHESTRATOR" || linked.kind === "WORKFLOW")) continue
        if (kind === "ORCHESTRATOR" && linked.kind === "WORKFLOW") continue
        others.push({ from: { kind, id: item.id, name: item.name, operatingUniverse: item.operating_universe }, to: linked, viaCategory: false })
      }
    }
  }
  return [...productLinks, ...others]
}

async function scopesFor(db: Database, actor: Actor, kind: UniverseResourceKind): Promise<ManageableScopes> {
  return getManageableScopes(db, actor, UNIVERSE_RESOURCES[kind].permission)
}

/** Lista de um tipo para classificar (só com a permissão do tipo; recursos com Grupo/Subgrupo, só os do escopo). */
export async function listResources(db: Database, actor: Actor, kind: UniverseResourceKind, filter: { status?: "PENDING" | "CLASSIFIED" | "ALL"; search?: string }) {
  const def = UNIVERSE_RESOURCES[kind]
  const scopes = await scopesFor(db, actor, kind)
  if (!scopes.unrestricted && !scopes.allTeams && scopes.teamIds.size === 0 && scopes.subteamIds.size === 0) throw new DomainError("Você não administra este tipo de recurso.", "FORBIDDEN", 403)
  const params: unknown[] = [actor.organizationId]
  const where = [`r.organization_id = $1`]
  if (def.where) where.push(def.where.replace(/\b(kind|deleted_at)\b/g, "r.$1"))
  if (filter.status === "PENDING") where.push(`r.operating_universe is null`)
  if (filter.status === "CLASSIFIED") where.push(`r.operating_universe is not null`)
  if (filter.search) {
    params.push(`%${filter.search}%`)
    where.push(`r.${def.name} ilike $${params.length}`)
  }
  const rows = (await db.query<{ id: string; name: string; operating_universe: string | null } & ScopeColumns>(
    `select r.id, r.${def.name} name, r.operating_universe, ${scopeSelect(kind)} from ${def.read} r where ${where.join(" and ")} order by r.operating_universe nulls first, r.${def.name} limit 500`,
    params,
  )).rows
  return rows.filter((row) => canTouch(scopes, kind, row)).map((row) => ({ kind, id: row.id, name: row.name, operatingUniverse: row.operating_universe }))
}

type ScopeColumns = { scope_type: string | null; team_id: string | null; subteam_id: string | null; scopes: { scopeType: string; teamId: string | null; subteamId: string | null }[] | null }

function scopeSelect(kind: UniverseResourceKind): string {
  if (kind === "WORKFLOW" || kind === "AGENT" || kind === "ORCHESTRATOR" || kind === "ARGUMENT_SCRIPT") return `r.scope_type, r.team_id, r.subteam_id, null::json scopes`
  if (kind === "KNOWLEDGE_DOCUMENT") return `null::text scope_type, null::uuid team_id, null::uuid subteam_id, (select json_agg(json_build_object('scopeType', os.scope_type, 'teamId', os.team_id, 'subteamId', os.subteam_id)) from knowledge_document_org_scopes os where os.knowledge_document_id = r.id) scopes`
  return `null::text scope_type, null::uuid team_id, null::uuid subteam_id, null::json scopes`
}

function canTouch(scopes: ManageableScopes, kind: UniverseResourceKind, row: ScopeColumns): boolean {
  if (scopes.unrestricted || scopes.allTeams) return true
  if (UNIVERSE_RESOURCES[kind].organizationWide) return false
  if (kind === "KNOWLEDGE_DOCUMENT") return (row.scopes ?? []).length > 0 && (row.scopes ?? []).every((scope) => canManageScope(scopes, { scopeType: scope.scopeType as never, teamId: scope.teamId, subteamId: scope.subteamId }))
  return row.scope_type !== null && canManageScope(scopes, { scopeType: row.scope_type as never, teamId: row.team_id, subteamId: row.subteam_id })
}

/**
 * Classifica (ou reclassifica) um recurso. Recusa: sem permissão/escopo (404, não revela), voltar a pendente depois da ativação (422),
 * vínculos que ficariam entre universos (409 com a lista). Workflow já classificado muda só pelo editor (rascunho → Publicar), porque
 * muda quem entra nas próximas execuções; pendente → universo vale na hora (rascunho e publicado), pois só regulariza o legado.
 */
export async function classifyResource(db: Database, actor: Actor, kind: UniverseResourceKind, id: string, universe: OperatingUniverse | null) {
  const def = UNIVERSE_RESOURCES[kind]
  const scopes = await scopesFor(db, actor, kind)
  const row = (await db.query<{ id: string; name: string; operating_universe: string | null } & ScopeColumns>(
    `select r.id, r.${def.name} name, r.operating_universe, ${scopeSelect(kind)} from ${def.read} r where r.id = $1 and r.organization_id = $2${def.where ? ` and ${def.where.replace(/\b(kind|deleted_at)\b/g, "r.$1")}` : ""}`,
    [id, actor.organizationId],
  )).rows[0]
  if (!row || !canTouch(scopes, kind, row)) throw new DomainError(`${def.label} não encontrado.`, "OPERATING_UNIVERSE_RESOURCE_NOT_FOUND", 404)
  if (universe === null && (await isUniverseEnforced(db, actor.organizationId))) throw new DomainError("Com a exigência ativa, todo recurso precisa de universo (B2B, B2C ou B2X).", "OPERATING_UNIVERSE_REQUIRED", 422)
  if (row.operating_universe === universe) return { kind, id, operatingUniverse: universe, changed: false }
  if (kind === "WORKFLOW" && row.operating_universe !== null) throw new DomainError("Para mudar o universo de um Workflow já classificado, edite a Abrangência no editor e publique (muda quem entra nas próximas execuções).", "OPERATING_UNIVERSE_WORKFLOW_USE_EDITOR", 409)
  return inTransaction(db, async (client) => {
    await client.query(`select 1 from ${def.write} where id = $1 for update`, [id])
    const conflicts = await resourceLinkConflicts(client, actor.organizationId, kind, id, universe)
    if (conflicts.length > 0) throw resourceConflictError(kind, conflicts)
    if (kind === "WORKFLOW") await client.query(`update workflows set operating_universe = $3, draft_operating_universe = $3 where id = $1 and organization_id = $2`, [id, actor.organizationId, universe])
    else await client.query(`update ${def.write} set operating_universe = $3 where id = $1 and organization_id = $2`, [id, actor.organizationId, universe])
    await client.query(
      `insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload) values ($1, $2, 'OPERATING_UNIVERSE_CLASSIFIED', $3, $4, $5::jsonb)`,
      [actor.organizationId, actor.personId, kind.toLowerCase(), id, JSON.stringify({ kind, from: row.operating_universe, to: universe, actorAccountId: actor.sub })],
    )
    return { kind, id, operatingUniverse: universe, changed: true }
  })
}

/**
 * Pessoas em lote (regularização do legado): decisão explícita de quem administra pessoas no escopo. Campo que um feed da Central
 * controla não é escrito aqui (a próxima carga sobrescreveria) — volta em `managedBySource` para corrigir na origem.
 */
export async function classifyPeople(db: Database, actor: Actor, personIds: readonly string[], universe: OperatingUniverse) {
  const scopes = await getManageableScopes(db, actor, "people.manage")
  const rows = (await db.query<{ id: string; team_id: string | null; subteam_id: string | null; operating_universe: string | null }>(
    `select id, team_id, subteam_id, operating_universe from people where organization_id = $1 and id = any($2::uuid[])`,
    [actor.organizationId, [...new Set(personIds)]],
  )).rows
  const reachable = rows.filter((row) => row.id !== actor.personId && (scopes.unrestricted || scopes.allTeams || (row.subteam_id !== null && scopes.subteamIds.has(row.subteam_id)) || (row.team_id !== null && scopes.teamIds.has(row.team_id))))
  const control = await loadPersonFieldControl(db, actor.organizationId, reachable.map((row) => row.id))
  const managedBySource = reachable.filter((row) => control.get(row.id)?.operatingUniverse).map((row) => ({ personId: row.id, ...control.get(row.id)!.operatingUniverse! }))
  const writable = reachable.filter((row) => !control.get(row.id)?.operatingUniverse && row.operating_universe !== universe).map((row) => row.id)
  if (writable.length > 0) {
    await inTransaction(db, async (client) => {
      await client.query(`update people set operating_universe = $3 where organization_id = $1 and id = any($2::uuid[])`, [actor.organizationId, writable, universe])
      await client.query(
        `insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload)
         select $1, $2, 'PERSON_OPERATING_UNIVERSE_CHANGED', 'people', p.id, jsonb_build_object('to', $3::text, 'source', 'BULK_REGULARIZATION', 'actorAccountId', $4::text) from unnest($5::uuid[]) p(id)`,
        [actor.organizationId, actor.personId, universe, actor.sub, writable],
      )
    })
  }
  return { updated: writable.length, outOfScope: personIds.length - reachable.length, managedBySource }
}

/** Ativa (ou desativa) a exigência e o filtro. Ativar com pendências exige a confirmação das contagens mostradas (nada é escondido). */
export async function setEnforcement(db: Database, actor: Actor, input: { enforce: boolean; acknowledgedPending?: number | undefined }) {
  if (input.enforce) {
    const readiness = await loadReadiness(db, actor.organizationId)
    const pending = readiness.people.pending + readiness.resources.reduce((sum, item) => sum + item.pending, 0) + readiness.conflicts.length
    if (pending > 0 && input.acknowledgedPending !== pending) {
      throw new DomainError(`Ainda há ${pending} pendência(s) de universo. Confirme a ativação informando esse número, ou classifique antes.`, "OPERATING_UNIVERSE_ACTIVATION_UNCONFIRMED", 409, { pending, impact: readiness.impact })
    }
  }
  await inTransaction(db, async (client) => {
    await client.query(`update organizations set operating_universe_enforced_at = case when $2 then coalesce(operating_universe_enforced_at, now()) else null end, operating_universe_enforced_by = case when $2 then $3::uuid else null end where id = $1`, [actor.organizationId, input.enforce, actor.personId])
    await client.query(
      `insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload) values ($1, $2, $3, 'organization', $1, $4::jsonb)`,
      [actor.organizationId, actor.personId, input.enforce ? "OPERATING_UNIVERSE_ENFORCEMENT_ENABLED" : "OPERATING_UNIVERSE_ENFORCEMENT_DISABLED", JSON.stringify({ acknowledgedPending: input.acknowledgedPending ?? 0, actorAccountId: actor.sub })],
    )
  })
  return { enforced: input.enforce }
}

export const universeValues = OPERATING_UNIVERSES
