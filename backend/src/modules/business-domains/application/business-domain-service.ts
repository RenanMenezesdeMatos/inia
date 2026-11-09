import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { inTransaction } from "../../../shared/infrastructure/database/transaction.js"
import { canManageScope, type ManageableScopes, type ScopedTarget } from "../../auth/application/manageable-scopes.js"
import { businessDomainInputSchema, businessDomainPatchSchema, type BusinessDomainInput, type BusinessDomainRecord } from "../domain/business-domain.js"

/**
 * Contrato ÚNICO de leitura/criação/edição/ativação/exclusão do catálogo de domínios de negócio —
 * usado pela rota admin e pela prova arquitetural (um domínio novo entra pelo mesmo caminho do
 * produto, nunca por constante TypeScript). Consumidores não consultam `business_domains` por
 * conta própria: quem precisa resolver referências usa `business-domain-lookup.ts`.
 */
type Queryable = { query: Database["query"] }

const DOMAIN_COLUMNS = `d.id, d.code, d.name, d.description, d.active, d.created_at "createdAt", d.updated_at "updatedAt"`

/** Contadores das dependências reais — FK/relação nova OU código legado (agente/orquestrador ainda
 * sem backfill continua contando: é uma referência de verdade). Uma subquery por tabela, nunca N+1. */
const AGENT_COUNT = `(select count(*) from agents a where a.organization_id = d.organization_id and (a.business_domain_id = d.id or (a.business_domain_id is null and a.domain = d.code)))::int`
const ORCHESTRATOR_COUNT = `(select count(*) from assistant_orchestrators o where o.organization_id = d.organization_id and (exists (select 1 from assistant_orchestrator_domains od where od.orchestrator_id = o.id and od.business_domain_id = d.id) or d.code = any(o.routing_domains) or d.code = any(o.policy_domains)))::int`

export type BusinessDomainListItem = BusinessDomainRecord & { agentCount: number; orchestratorCount: number }

export const BUSINESS_DOMAIN_LIST_SELECT = `
  select ${DOMAIN_COLUMNS}, ${AGENT_COUNT} "agentCount", ${ORCHESTRATOR_COUNT} "orchestratorCount"
  from business_domains d
  where d.organization_id = $1
`

type DomainRow = Omit<BusinessDomainRecord, "createdAt" | "updatedAt"> & { createdAt: Date | string; updatedAt: Date | string }

function toRecord<T extends DomainRow>(row: T): T & BusinessDomainRecord {
  return { ...row, createdAt: new Date(row.createdAt).toISOString(), updatedAt: new Date(row.updatedAt).toISOString() }
}

export async function findBusinessDomain(db: Queryable, organizationId: string, id: string): Promise<BusinessDomainListItem | null> {
  const result = await db.query<DomainRow & { agentCount: number; orchestratorCount: number }>(`${BUSINESS_DOMAIN_LIST_SELECT} and d.id = $2`, [organizationId, id])
  return result.rows[0] ? toRecord(result.rows[0]) : null
}

export type BusinessDomainDependencies = {
  agents: { id: string; name: string; active: boolean }[]
  orchestrators: { id: string; name: string; active: boolean }[]
  total: number
}

/** O que a TELA mostra: só os Agents/Orquestradores que quem consulta administra; os outros entram apenas na contagem. */
export type VisibleBusinessDomainDependencies = BusinessDomainDependencies & { agentsOutOfScope: number; orchestratorsOutOfScope: number }

type DependencyRow = { id: string; name: string; active: boolean } & ScopedTarget

async function queryDependencies(db: Queryable, organizationId: string, domain: { id: string; code: string }): Promise<{ agents: DependencyRow[]; orchestrators: DependencyRow[] }> {
  const agents = await db.query<DependencyRow>(
    `select id, name, active, scope_type "scopeType", team_id "teamId", subteam_id "subteamId" from agents where organization_id = $1 and (business_domain_id = $2 or (business_domain_id is null and domain = $3)) order by name`,
    [organizationId, domain.id, domain.code],
  )
  const orchestrators = await db.query<DependencyRow>(
    `select o.id, o.name, o.active, o.scope_type "scopeType", o.team_id "teamId", o.subteam_id "subteamId" from assistant_orchestrators o
      where o.organization_id = $1
        and (exists (select 1 from assistant_orchestrator_domains od where od.orchestrator_id = o.id and od.business_domain_id = $2)
             or $3 = any(o.routing_domains) or $3 = any(o.policy_domains))
      order by o.name`,
    [organizationId, domain.id, domain.code],
  )
  return { agents: agents.rows, orchestrators: orchestrators.rows }
}

const itemOf = ({ id, name, active }: DependencyRow) => ({ id, name, active })

/** Todas as dependências — trava de código e exclusão (escritas que já exigem a organização inteira). */
export async function loadBusinessDomainDependencies(db: Queryable, organizationId: string, domain: { id: string; code: string }): Promise<BusinessDomainDependencies> {
  const { agents, orchestrators } = await queryDependencies(db, organizationId, domain)
  return { agents: agents.map(itemOf), orchestrators: orchestrators.map(itemOf), total: agents.length + orchestrators.length }
}

/**
 * Dependências para quem CONSULTA o catálogo (lote 2 da 4ª auditoria): administrador de Grupo/Subgrupo vê pelo nome só o
 * que abriria na lista de Agents/Orquestradores (`agents.manage` no escopo do item); o resto vira contagem, para saber que
 * o domínio está em uso sem conhecer a configuração dos outros Grupos. Quem administra a organização inteira vê tudo.
 */
export async function loadVisibleBusinessDomainDependencies(db: Queryable, organizationId: string, domain: { id: string; code: string }, scopes: ManageableScopes): Promise<VisibleBusinessDomainDependencies> {
  const { agents, orchestrators } = await queryDependencies(db, organizationId, domain)
  const visibleAgents = agents.filter((row) => canManageScope(scopes, row))
  const visibleOrchestrators = orchestrators.filter((row) => canManageScope(scopes, row))
  return {
    agents: visibleAgents.map(itemOf),
    orchestrators: visibleOrchestrators.map(itemOf),
    total: agents.length + orchestrators.length,
    agentsOutOfScope: agents.length - visibleAgents.length,
    orchestratorsOutOfScope: orchestrators.length - visibleOrchestrators.length,
  }
}

export const BUSINESS_DOMAIN_IN_USE_MESSAGE = "Este código já é utilizado por Agents ou Orchestrators."

/** Audit trail das ações do catálogo — reaproveita `audit_logs`, sem payload além do necessário. */
async function recordDomainAudit(db: Queryable, input: { organizationId: string; actorId: string | null; action: string; domainId: string; payload?: Record<string, unknown> }): Promise<void> {
  await db.query(`insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload) values ($1, $2, $3, 'business_domain', $4, $5)`, [
    input.organizationId,
    input.actorId,
    input.action,
    input.domainId,
    JSON.stringify(input.payload ?? {}),
  ])
}

function rethrowUniqueViolation(error: unknown): never {
  if ((error as { code?: string }).code === "23505") throw new DomainError("Já existe um domínio de negócio com esse código.", "BUSINESS_DOMAIN_CODE_TAKEN", 409)
  throw error
}

export type BusinessDomainActor = { organizationId: string; actorId: string | null }

export async function createBusinessDomain(db: Queryable, actor: BusinessDomainActor, rawInput: unknown): Promise<BusinessDomainListItem> {
  const input: BusinessDomainInput = businessDomainInputSchema.parse(rawInput)
  try {
    const created = await db.query<{ id: string }>(
      `insert into business_domains (organization_id, code, name, description, active) values ($1, $2, $3, $4, $5) returning id`,
      [actor.organizationId, input.code, input.name, input.description, input.active],
    )
    const id = created.rows[0]!.id
    await recordDomainAudit(db, { ...actor, action: "BUSINESS_DOMAIN_CREATED", domainId: id, payload: { code: input.code, name: input.name, active: input.active } })
    return (await findBusinessDomain(db, actor.organizationId, id))!
  } catch (error) {
    rethrowUniqueViolation(error)
  }
}

/**
 * PATCH parcial. Nome, descrição e status são sempre editáveis. Código é protegido quando há
 * dependências (Agents/Orchestrators que o referenciam) — a alteração é BLOQUEADA (409
 * BUSINESS_DOMAIN_CODE_LOCKED) em vez de propagada silenciosamente para as colunas legadas.
 */
export async function updateBusinessDomain(db: Queryable, actor: BusinessDomainActor, id: string, rawPatch: unknown): Promise<BusinessDomainListItem> {
  const current = await findBusinessDomain(db, actor.organizationId, id)
  if (!current) throw new DomainError("Domínio de negócio não encontrado.", "BUSINESS_DOMAIN_NOT_FOUND", 404)
  const patch = businessDomainPatchSchema.parse(rawPatch)
  const next: BusinessDomainInput = {
    code: patch.code ?? current.code,
    name: patch.name ?? current.name,
    description: patch.description === undefined ? current.description : patch.description || null,
    active: patch.active ?? current.active,
  }
  if (next.code !== current.code) {
    const dependencies = await loadBusinessDomainDependencies(db, actor.organizationId, current)
    if (dependencies.total > 0) {
      throw new DomainError(`${BUSINESS_DOMAIN_IN_USE_MESSAGE} Crie um novo domínio com o código desejado e migre as referências.`, "BUSINESS_DOMAIN_CODE_LOCKED", 409, { dependencies })
    }
  }
  try {
    await db.query(
      `update business_domains set code = $1, name = $2, description = $3, active = $4, updated_at = now() where id = $5 and organization_id = $6`,
      [next.code, next.name, next.description, next.active, id, actor.organizationId],
    )
  } catch (error) {
    rethrowUniqueViolation(error)
  }
  const changes: Record<string, { from: unknown; to: unknown }> = {}
  for (const field of ["code", "name", "description", "active"] as const) {
    if (current[field] !== next[field]) changes[field] = { from: current[field], to: next[field] }
  }
  if (Object.keys(changes).length > 0) {
    const statusOnly = Object.keys(changes).length === 1 && changes.active !== undefined
    const action = statusOnly ? (next.active ? "BUSINESS_DOMAIN_ACTIVATED" : "BUSINESS_DOMAIN_DEACTIVATED") : "BUSINESS_DOMAIN_UPDATED"
    await recordDomainAudit(db, { ...actor, action, domainId: id, payload: { changes } })
  }
  return (await findBusinessDomain(db, actor.organizationId, id))!
}

/** Desativar NÃO desliga nada em produção: significa "não usar em novas configurações". Agents e
 * Orchestrators existentes continuam válidos e abrindo — a UI só mostra "(desativado)". */
export async function setBusinessDomainActive(db: Queryable, actor: BusinessDomainActor, id: string, active: boolean): Promise<BusinessDomainListItem> {
  return updateBusinessDomain(db, actor, id, { active })
}

/** Exclusão lógica (migration 177), só com ZERO dependências: um Argumentário ou checkpoint apontando para domínio escondido perderia a área. Com dependências o caminho é desativar. */
export async function deleteBusinessDomain(database: Database, actor: BusinessDomainActor, id: string): Promise<boolean> {
  // A linha fica travada durante a conferência: sem apagar, a chave estrangeira não barra mais um Agent restaurado neste domínio ao mesmo tempo.
  return inTransaction(database, async (db) => {
    await db.query(`select 1 from business_domains where id = $1 and organization_id = $2 for update`, [id, actor.organizationId])
    const current = await findBusinessDomain(db, actor.organizationId, id)
    if (!current) return false
    const dependencies = await loadBusinessDomainDependencies(db, actor.organizationId, current)
    if (dependencies.total > 0) {
      throw new DomainError(`"${current.name}" ainda é utilizado por Agents ou Orchestrators e não pode ser excluído. Desative-o em vez de excluir.`, "BUSINESS_DOMAIN_IN_USE", 409, { dependencies })
    }
    const others = (await db.query<{ argumentScripts: number; checkpoints: number }>(
      `select (select count(*)::int from argument_scripts where organization_id = $1 and business_domain_id = $2) "argumentScripts",
              (select count(distinct definition_id)::int from checkpoint_scopes where organization_id = $1 and business_domain_id = $2) "checkpoints"`,
      [actor.organizationId, id],
    )).rows[0]
    if ((others?.argumentScripts ?? 0) + (others?.checkpoints ?? 0) > 0) {
      throw new DomainError(`"${current.name}" ainda é utilizado por Argumentários ou checkpoints e não pode ser excluído. Desative-o em vez de excluir.`, "BUSINESS_DOMAIN_IN_USE", 409, { dependencies: { ...dependencies, ...others } })
    }
    await db.query(`update business_domains_all set active = false, deleted_at = now(), deleted_by_person_id = $3, updated_at = now() where id = $1 and organization_id = $2`, [id, actor.organizationId, actor.actorId])
    await recordDomainAudit(db, { ...actor, action: "BUSINESS_DOMAIN_DELETED", domainId: id, payload: { code: current.code, name: current.name } })
    return true
  })
}
