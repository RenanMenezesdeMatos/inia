import { DomainError } from "../../../shared/domain/domain-error.js"
import { accessCapabilities, canAnywhere, checkDelegation, effectivePermissions, scopesWithPermission, type AccessContext, type DelegationDenial } from "../domain/access-decision.js"
import type { AccessScope } from "../domain/access-scope.js"
import { PERMISSIONS, type Permission } from "../domain/permissions.js"
import { systemRoleCatalog, TENANT_ADMIN_ROLE, type RoleCatalog } from "../domain/roles.js"
import type { AccessRepository, VisibilityFilter } from "./access-repository.js"

/**
 * CASOS DE USO DO MODELO DE ACESSO (V1.5.7). Toda decisão passa pela resolução pura de `access-decision.ts`; nenhum caso de
 * uso olha cargo, nível hierárquico ou `people.role`. O ator vem SEMPRE da sessão (conta + organização).
 */
export type AccessDeps = { repository: AccessRepository; now: () => Date; catalog?: RoleCatalog }
export type SessionActor = { organizationId: string; accountId: string; personId: string }

const forbidden = (message = "Você não tem permissão para esta ação.") => new DomainError(message, "FORBIDDEN", 403)
const DELEGATION_MESSAGES: Record<DelegationDenial, string> = {
  SELF_ASSIGNMENT: "Ninguém pode conceder ou ampliar o próprio acesso — outra pessoa autorizada precisa fazer isso.",
  UNKNOWN_ROLE: "Papel inexistente.",
  SCOPE_NOT_ALLOWED_FOR_ROLE: "Este papel não pode ser atribuído com este escopo.",
  NOT_AUTHORIZED_TO_ASSIGN: "Você não tem permissão para atribuir papéis.",
  ROLE_NOT_DELEGABLE: "Você não pode conceder este papel — ele dá mais autoridade do que você está autorizado a delegar.",
  SCOPE_EXCEEDS_GRANTOR: "O escopo pedido é maior que o seu escopo de administração.",
  RECIPIENT_OUT_OF_SCOPE: "Esta pessoa está fora do seu escopo de administração.",
}
const delegationError = (reason: DelegationDenial) => new DomainError(DELEGATION_MESSAGES[reason], `ACCESS_${reason}`, reason === "UNKNOWN_ROLE" || reason === "SCOPE_NOT_ALLOWED_FOR_ROLE" ? 422 : 403, { reason })

export async function resolveAccess(deps: AccessDeps, actor: SessionActor): Promise<AccessContext> {
  return deps.repository.loadContext(actor.organizationId, actor.accountId)
}

/** Projeção para o frontend: permissões efetivas + capabilities derivadas + papéis (rótulos). Nunca o cargo. */
export async function describeAccess(deps: AccessDeps, actor: SessionActor) {
  const catalog = deps.catalog ?? systemRoleCatalog
  const access = await resolveAccess(deps, actor)
  return {
    permissions: effectivePermissions(access, catalog),
    capabilities: accessCapabilities(access, catalog),
    roles: access.assignments.map((assignment) => ({ roleCode: assignment.roleCode, roleName: catalog.find(assignment.roleCode)?.name ?? assignment.roleCode, scopeType: assignment.scope.type })),
  }
}

/** Visibilidade de quem tem a permissão (para listas): organização inteira, ou os Grupos/Subgrupos das atribuições. */
export function visibilityOf(access: AccessContext, permission: Permission, catalog: RoleCatalog = systemRoleCatalog): VisibilityFilter {
  const scopes = scopesWithPermission(access, permission, catalog)
  return {
    organizationWide: scopes.some((scope) => scope.type === "ORGANIZATION"),
    teamIds: scopes.flatMap((scope) => (scope.type === "GROUP" ? [scope.teamId] : [])),
    subteamIds: scopes.flatMap((scope) => (scope.type === "SUBGROUP" ? [scope.subteamId] : [])),
  }
}

async function requireOn(deps: AccessDeps, access: AccessContext, permission: Permission, personId: string) {
  const collaborator = await deps.repository.collaborator(access.organizationId, personId)
  if (!collaborator) throw new DomainError("Pessoa não encontrada.", "ACCESS_PERSON_NOT_FOUND", 404)
  const visibility = visibilityOf(access, permission, deps.catalog)
  const reachable = visibility.organizationWide || (collaborator.teamId !== null && visibility.teamIds.includes(collaborator.teamId)) || (collaborator.subteamId !== null && visibility.subteamIds.includes(collaborator.subteamId))
  // Fora do escopo = não encontrado (não revela quem existe fora do alcance).
  if (!reachable) throw new DomainError("Pessoa não encontrada.", "ACCESS_PERSON_NOT_FOUND", 404)
  return collaborator
}

export async function listAccounts(deps: AccessDeps, actor: SessionActor, filters: { search?: string | undefined; page: number; pageSize: number }) {
  const catalog = deps.catalog ?? systemRoleCatalog
  const access = await resolveAccess(deps, actor)
  if (!canAnywhere(access, "access.users.view", catalog)) throw forbidden()
  const page = await deps.repository.listAccounts(actor.organizationId, visibilityOf(access, "access.users.view", catalog), filters)
  const assignments = await Promise.all(page.items.map((item) => deps.repository.listAssignments(actor.organizationId, item.accountId)))
  return { ...page, items: page.items.map((item, index) => ({ ...item, roles: assignments[index]!.map((assignment) => ({ ...assignment, roleName: catalog.find(assignment.roleCode)?.name ?? assignment.roleCode })) })) }
}

export async function getAccount(deps: AccessDeps, actor: SessionActor, accountId: string) {
  const catalog = deps.catalog ?? systemRoleCatalog
  const access = await resolveAccess(deps, actor)
  if (!canAnywhere(access, "access.users.view", catalog)) throw forbidden()
  const account = await deps.repository.getAccount(actor.organizationId, accountId)
  if (!account) throw new DomainError("Conta não encontrada.", "ACCESS_ACCOUNT_NOT_FOUND", 404)
  await requireOn(deps, access, "access.users.view", account.collaborator.personId).catch(() => { throw new DomainError("Conta não encontrada.", "ACCESS_ACCOUNT_NOT_FOUND", 404) })
  const roles = await deps.repository.listAssignments(actor.organizationId, accountId)
  return { ...account, roles: roles.map((assignment) => ({ ...assignment, roleName: catalog.find(assignment.roleCode)?.name ?? assignment.roleCode })) }
}

/** Catálogo de papéis com permissões (rótulos) e quais o ator pode conceder. */
export async function listRoles(deps: AccessDeps, actor: SessionActor) {
  const catalog = deps.catalog ?? systemRoleCatalog
  const access = await resolveAccess(deps, actor)
  if (!canAnywhere(access, "access.roles.view", catalog)) throw forbidden()
  const assigners = access.assignments.filter((assignment) => catalog.find(assignment.roleCode)?.permissions.includes("access.roles.assign"))
  return catalog.all().map((role) => ({
    code: role.code, name: role.name, description: role.description, system: role.system, allowedScopes: role.allowedScopes,
    permissions: role.permissions.map((permission) => ({ code: permission, label: PERMISSIONS[permission] })),
    assignableByYou: assigners.some((assignment) => catalog.find(assignment.roleCode)!.delegates.includes(role.code)),
  }))
}

export async function scopeOptions(deps: AccessDeps, actor: SessionActor) {
  const access = await resolveAccess(deps, actor)
  if (!canAnywhere(access, "access.roles.assign", deps.catalog)) throw forbidden()
  const visibility = visibilityOf(access, "access.roles.assign", deps.catalog)
  return { organizationWide: visibility.organizationWide, ...(await deps.repository.scopeOptions(actor.organizationId, visibility)) }
}

export async function assignRole(deps: AccessDeps, actor: SessionActor, input: { accountId: string; roleCode: string; scope: { type: AccessScope["type"]; teamId?: string | null | undefined; subteamId?: string | null | undefined } }) {
  const catalog = deps.catalog ?? systemRoleCatalog
  const access = await resolveAccess(deps, actor)
  if (!canAnywhere(access, "access.roles.assign", catalog)) throw delegationError("NOT_AUTHORIZED_TO_ASSIGN")
  const recipient = await deps.repository.account(actor.organizationId, input.accountId)
  if (!recipient) throw new DomainError("Conta não encontrada.", "ACCESS_ACCOUNT_NOT_FOUND", 404)
  const collaborator = await deps.repository.collaborator(actor.organizationId, recipient.personId)
  const scope = await deps.repository.resolveScope(actor.organizationId, input.scope)
  if (!collaborator || !scope) throw new DomainError("Escopo inválido para esta organização.", "ACCESS_SCOPE_INVALID", 422)
  const verdict = checkDelegation(access, { roleCode: input.roleCode, scope, recipientAccountId: recipient.accountId, recipient: collaborator }, {}, catalog)
  if (!verdict.ok) throw delegationError(verdict.reason)
  const role = catalog.find(input.roleCode)!
  const created = await deps.repository.createAssignment({ organizationId: actor.organizationId, accountId: recipient.accountId, roleCode: role.code, scope, grantedByAccountId: actor.accountId, actorPersonId: actor.personId, permissions: role.permissions, at: deps.now() })
  if (!created.ok) throw new DomainError("Esta conta já tem este papel com o mesmo escopo.", "ACCESS_ROLE_ALREADY_ASSIGNED", 409)
  return { id: created.id }
}

/**
 * "Conceder aos gestores": atribui um papel com escopo "Minha estrutura" a CADA conta ativa de quem lidera alguém (tem
 * subordinado direto ativo por reports_to) dentro do alcance de quem concede. Não é concessão por cargo: é uma ação
 * explícita do administrador, que cria uma atribuição auditada por pessoa pela MESMA regra de delegação da atribuição
 * individual (papel delegável, escopo coberto, pessoa alcançada, nunca a si mesmo). Idempotente: quem já tem o papel
 * com esse escopo é contado e ignorado.
 */
export async function assignRoleToLeaders(deps: AccessDeps, actor: SessionActor, input: { roleCode: string }) {
  const catalog = deps.catalog ?? systemRoleCatalog
  const access = await resolveAccess(deps, actor)
  if (!canAnywhere(access, "access.roles.assign", catalog)) throw delegationError("NOT_AUTHORIZED_TO_ASSIGN")
  const role = catalog.find(input.roleCode)
  if (!role) throw delegationError("UNKNOWN_ROLE")
  if (!role.allowedScopes.includes("MY_STRUCTURE")) throw delegationError("SCOPE_NOT_ALLOWED_FOR_ROLE")
  const scope: AccessScope = { type: "MY_STRUCTURE" }
  const leaders = await deps.repository.listLeaderAccounts(actor.organizationId, visibilityOf(access, "access.roles.assign", catalog))
  let granted = 0
  let alreadyAssigned = 0
  let skipped = 0
  for (const leader of leaders) {
    const verdict = checkDelegation(access, { roleCode: role.code, scope, recipientAccountId: leader.accountId, recipient: { personId: leader.personId, teamId: leader.teamId, subteamId: leader.subteamId } }, {}, catalog)
    if (!verdict.ok) {
      skipped += 1
      continue
    }
    const created = await deps.repository.createAssignment({ organizationId: actor.organizationId, accountId: leader.accountId, roleCode: role.code, scope, grantedByAccountId: actor.accountId, actorPersonId: actor.personId, permissions: role.permissions, at: deps.now() })
    if (created.ok) granted += 1
    else alreadyAssigned += 1
  }
  return { leaders: leaders.length, granted, alreadyAssigned, skipped }
}

/**
 * Revoga (nunca apaga). Quem revoga precisa poder conceder aquele papel naquele escopo (a mesma regra de delegação; revogar
 * o próprio papel é permitido). Proteção mínima contra lockout: não se revoga o ÚLTIMO Administrador geral ativo do tenant.
 */
export async function revokeRole(deps: AccessDeps, actor: SessionActor, input: { accountId: string; assignmentId: string; reason?: string | null }) {
  const catalog = deps.catalog ?? systemRoleCatalog
  const access = await resolveAccess(deps, actor)
  const assignment = await deps.repository.findAssignment(actor.organizationId, input.assignmentId)
  if (!assignment || assignment.revoked || assignment.accountId !== input.accountId) throw new DomainError("Atribuição não encontrada.", "ACCESS_ASSIGNMENT_NOT_FOUND", 404)
  const recipient = await deps.repository.account(actor.organizationId, assignment.accountId)
  const collaborator = recipient ? await deps.repository.collaborator(actor.organizationId, recipient.personId) : null
  if (!recipient || !collaborator) throw new DomainError("Atribuição não encontrada.", "ACCESS_ASSIGNMENT_NOT_FOUND", 404)
  const verdict = checkDelegation(access, { roleCode: assignment.roleCode, scope: assignment.scope, recipientAccountId: recipient.accountId, recipient: collaborator }, { allowSelf: true }, catalog)
  if (!verdict.ok) throw delegationError(verdict.reason)
  if (assignment.roleCode === TENANT_ADMIN_ROLE && (await deps.repository.countActiveHolders(actor.organizationId, TENANT_ADMIN_ROLE, { excludingAssignmentId: assignment.id })) === 0) {
    throw new DomainError("Este é o último Administrador geral ativo — conceda o papel a outra pessoa antes de revogar.", "ACCESS_LAST_TENANT_ADMIN", 409)
  }
  if (!(await deps.repository.revokeAssignment({ organizationId: actor.organizationId, assignmentId: assignment.id, revokedByAccountId: actor.accountId, actorPersonId: actor.personId, reason: input.reason?.trim() || null, at: deps.now() }))) {
    throw new DomainError("Atribuição não encontrada.", "ACCESS_ASSIGNMENT_NOT_FOUND", 404)
  }
}

/** Proteção de lockout para quem DESATIVA uma pessoa/conta fora deste módulo (ex.: cadastro de pessoas). */
export async function wouldRemoveLastTenantAdmin(repository: AccessRepository, organizationId: string, accountId: string): Promise<boolean> {
  const context = await repository.loadContext(organizationId, accountId)
  if (!context.assignments.some((assignment) => assignment.roleCode === TENANT_ADMIN_ROLE)) return false
  return (await repository.countActiveHolders(organizationId, TENANT_ADMIN_ROLE, { excludingAccountId: accountId })) === 0
}
