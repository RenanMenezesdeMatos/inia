import { DomainError } from "../../../shared/domain/domain-error.js"
import { generateTemporaryPassword, temporaryPasswordExpiry } from "../../auth/domain/temporary-password.js"
import { canAnywhere, checkCredentialCustody, type AccessContext } from "../domain/access-decision.js"
import { accountAccessStatusOf, temporaryPasswordExpired, type AccountAccessStatus } from "../domain/account-access-status.js"
import { systemRoleCatalog, type RoleCatalog } from "../domain/roles.js"
import { resolveAccess, visibilityOf, wouldRemoveLastTenantAdmin, type AccessDeps, type SessionActor } from "./access-service.js"
import type { AccountAccessRepository, CredentialTargetRecord } from "./account-access-repository.js"

/**
 * LIBERAÇÃO DE ACESSO (casos de uso administrativos). Lista as pessoas que a plataforma JÁ identifica (people) com a situação
 * do acesso; habilitar cria a conta de login da pessoa quando ela ainda não existe (nunca um cadastro novo) ou reabilita a
 * desabilitada; toda habilitação e toda "nova senha temporária" geram uma senha aleatória no servidor, devolvida UMA vez (só o
 * hash fica). Desabilitar e gerar outra senha revogam as sessões da pessoa. Permissão `access.users.manage` no escopo da pessoa
 * + custódia (só sobre quem você poderia conceder todos os papéis) — validadas aqui, no servidor.
 */
export type AccountAccessDeps = AccessDeps & {
  accounts: AccountAccessRepository
  hashPassword: (plain: string) => Promise<string>
  generatePassword?: () => string
  temporaryPasswordTtlHours: number
}

export type IssuedTemporaryPassword = { personId: string; accountId: string; name: string; email: string; temporaryPassword: string; expiresAt: string }

const notFound = () => new DomainError("Pessoa não encontrada.", "ACCESS_PERSON_NOT_FOUND", 404)
const CUSTODY_MESSAGES = {
  SELF_CREDENTIAL: "Você não pode alterar o seu próprio acesso por aqui — outra pessoa autorizada precisa fazer isso.",
  TARGET_MORE_PRIVILEGED: "Esta pessoa tem papéis que você não pode conceder; só quem administra esses papéis pode alterar o acesso dela.",
  TARGET_LEADS_OUTSIDE_SCOPE: "Esta pessoa lidera colaboradores fora do seu escopo; só quem administra o acesso de toda a estrutura dela pode alterar a credencial.",
} as const

/**
 * Quem conhece a credencial de um LÍDER enxerga a estrutura dele (regra operacional de reports_to, independente de papel).
 * A custódia exige então que o escopo de quem age alcance TODAS as pessoas ativas lideradas (achado U-F4) — senão um
 * administrador de Grupo assumiria a conta de um gestor cuja estrutura atravessa outros Grupos.
 */
export function reachesLedStructure(visibility: { organizationWide: boolean; teamIds: readonly string[]; subteamIds: readonly string[] }, target: Pick<CredentialTargetRecord, "ledPlacements">): boolean {
  if (visibility.organizationWide) return true
  return target.ledPlacements.every((placement) => (placement.teamId !== null && visibility.teamIds.includes(placement.teamId)) || (placement.subteamId !== null && visibility.subteamIds.includes(placement.subteamId)))
}

async function authorizedTarget(deps: AccountAccessDeps, actor: SessionActor, target: CredentialTargetRecord | null): Promise<{ access: AccessContext; target: CredentialTargetRecord }> {
  const catalog: RoleCatalog = deps.catalog ?? systemRoleCatalog
  const access = await resolveAccess(deps, actor)
  if (!canAnywhere(access, "access.users.manage", catalog)) throw new DomainError("Você não tem permissão para esta ação.", "FORBIDDEN", 403)
  if (!target) throw notFound()
  const visibility = visibilityOf(access, "access.users.manage", catalog)
  const reachable = visibility.organizationWide || (target.teamId !== null && visibility.teamIds.includes(target.teamId)) || (target.subteamId !== null && visibility.subteamIds.includes(target.subteamId))
  // Fora do escopo = não encontrado (não revela quem existe fora do alcance).
  if (!reachable) throw notFound()
  const custody = checkCredentialCustody(access, { accountId: target.account?.accountId ?? null, collaborator: { personId: target.personId, teamId: target.teamId, subteamId: target.subteamId }, assignments: target.account?.assignments ?? [] }, catalog)
  if (!custody.ok) throw new DomainError(CUSTODY_MESSAGES[custody.reason], `ACCESS_${custody.reason}`, 403)
  if (!reachesLedStructure(visibility, target)) throw new DomainError(CUSTODY_MESSAGES.TARGET_LEADS_OUTSIDE_SCOPE, "ACCESS_TARGET_LEADS_OUTSIDE_SCOPE", 403)
  return { access, target }
}

/**
 * Custódia para mudanças de credencial feitas FORA da tela de acessos (e-mail de login, inativar a pessoa pelo cadastro): a
 * MESMA régua de "Habilitar / Gerar senha / Desabilitar" (achado U-F3) — permissão `access.users.manage` no escopo da pessoa,
 * nunca o próprio acesso, só sobre quem você poderia conceder todos os papéis, alcançando a estrutura que ela lidera.
 * Pessoa sem conta de login: nada a proteger.
 */
export async function assertCredentialChangeAllowed(deps: AccountAccessDeps, actor: SessionActor, personId: string): Promise<void> {
  const target = await deps.accounts.targetByPerson(actor.organizationId, personId)
  if (!target?.account) return
  await authorizedTarget(deps, actor, target)
}

/**
 * Custódia para MOVER a conta de login de uma pessoa para outra (vínculo do cadastro manual à pessoa da base): a mesma régua de
 * credencial sobre a origem e sobre o destino já com a conta e os papéis dela — quem age precisa alcançar as duas pessoas (e a
 * estrutura que o destino lidera, que a conta passa a enxergar) e poderia conceder todos os papéis da conta no lugar novo.
 * Nunca a própria conta.
 */
export async function assertAccountRelinkAllowed(deps: AccountAccessDeps, actor: SessionActor, fromPersonId: string, toPersonId: string): Promise<void> {
  const [from, to] = await Promise.all([deps.accounts.targetByPerson(actor.organizationId, fromPersonId), deps.accounts.targetByPerson(actor.organizationId, toPersonId)])
  await authorizedTarget(deps, actor, from)
  await authorizedTarget(deps, actor, to ? { ...to, account: from?.account ?? to.account } : null)
}

const conflict = () => new DomainError("Outra pessoa alterou este acesso agora há pouco. Atualize a lista e tente de novo.", "ACCESS_CONCURRENT_CHANGE", 409)
const emailInUse = () => new DomainError("Já existe uma conta com este e-mail.", "EMAIL_ALREADY_IN_USE", 409)

async function newTemporaryCredential(deps: AccountAccessDeps) {
  const temporaryPassword = (deps.generatePassword ?? generateTemporaryPassword)()
  const issuedAt = deps.now()
  return { temporaryPassword, passwordHash: await deps.hashPassword(temporaryPassword), issuedAt, expiresAt: temporaryPasswordExpiry(issuedAt, deps.temporaryPasswordTtlHours) }
}

export async function listIdentifiedUsers(deps: AccountAccessDeps, actor: SessionActor, filters: { search?: string | undefined; status?: AccountAccessStatus | undefined; page: number; pageSize: number }) {
  const catalog = deps.catalog ?? systemRoleCatalog
  const access = await resolveAccess(deps, actor)
  if (!canAnywhere(access, "access.users.view", catalog)) throw new DomainError("Você não tem permissão para esta ação.", "FORBIDDEN", 403)
  const page = await deps.accounts.listIdentifiedUsers(actor.organizationId, visibilityOf(access, "access.users.view", catalog), filters)
  const now = deps.now()
  return {
    ...page,
    items: page.items.map((user) => ({
      ...user,
      self: user.personId === actor.personId,
      accessStatus: accountAccessStatusOf(user.account),
      temporaryPasswordExpired: temporaryPasswordExpired(user.account, now),
      account: user.account ? { ...user.account, roles: user.account.roleCodes.map((code) => ({ code, name: catalog.find(code)?.name ?? code })) } : null,
    })),
  }
}

/** Habilita o acesso: cria a conta de login (e-mail obrigatório) ou reabilita a desabilitada (e-mail novo opcional). */
export async function enableAccess(deps: AccountAccessDeps, actor: SessionActor, input: { personId: string; email?: string | undefined }): Promise<IssuedTemporaryPassword> {
  const { target } = await authorizedTarget(deps, actor, await deps.accounts.targetByPerson(actor.organizationId, input.personId))
  if (!target.personActive) throw new DomainError("Esta pessoa está inativa no cadastro — reative-a antes de habilitar o acesso.", "ACCESS_PERSON_INACTIVE", 409)
  const email = input.email?.trim().toLowerCase() || null
  const actorIds = { actorPersonId: actor.personId, actorAccountId: actor.accountId }

  if (!target.account) {
    if (!email) throw new DomainError("Informe o e-mail que a pessoa vai usar para entrar.", "ACCESS_EMAIL_REQUIRED", 422)
    const credential = await newTemporaryCredential(deps)
    const created = await deps.accounts.createWithTemporaryPassword({ ...actorIds, organizationId: actor.organizationId, personId: target.personId, email, passwordHash: credential.passwordHash, issuedAt: credential.issuedAt, expiresAt: credential.expiresAt })
    // ALREADY_LINKED = outra pessoa criou a conta no meio do caminho.
    if (!created.ok) throw created.error === "EMAIL_IN_USE" ? emailInUse() : conflict()
    return { personId: target.personId, accountId: created.accountId, name: target.name, email, temporaryPassword: credential.temporaryPassword, expiresAt: credential.expiresAt.toISOString() }
  }

  if (target.account.active) throw new DomainError("O acesso desta pessoa já está habilitado. Para uma nova senha, use “Gerar nova senha temporária”.", "ACCESS_ALREADY_ENABLED", 409)
  const credential = await newTemporaryCredential(deps)
  const enabled = await deps.accounts.enableWithTemporaryPassword({ ...actorIds, organizationId: actor.organizationId, accountId: target.account.accountId, personId: target.personId, expectedSessionVersion: target.account.sessionVersion, email, passwordHash: credential.passwordHash, issuedAt: credential.issuedAt, expiresAt: credential.expiresAt })
  if (!enabled.ok) throw enabled.error === "EMAIL_IN_USE" ? emailInUse() : conflict()
  return { personId: target.personId, accountId: enabled.accountId, name: target.name, email: email ?? target.account.email, temporaryPassword: credential.temporaryPassword, expiresAt: credential.expiresAt.toISOString() }
}

/** Nova senha temporária: a anterior (temporária ou definitiva) deixa de valer, a troca volta a ser obrigatória e as sessões caem. */
export async function issueTemporaryPassword(deps: AccountAccessDeps, actor: SessionActor, input: { accountId: string }): Promise<IssuedTemporaryPassword> {
  const { target } = await authorizedTarget(deps, actor, await deps.accounts.targetByAccount(actor.organizationId, input.accountId))
  const account = target.account!
  if (!account.active) throw new DomainError("O acesso desta pessoa está desabilitado — use “Habilitar acesso”.", "ACCESS_NOT_ENABLED", 409)
  if (!target.personActive) throw new DomainError("Esta pessoa está inativa no cadastro — reative-a antes de gerar uma senha.", "ACCESS_PERSON_INACTIVE", 409)
  const credential = await newTemporaryCredential(deps)
  const issued = await deps.accounts.issueTemporaryPassword({ actorPersonId: actor.personId, actorAccountId: actor.accountId, organizationId: actor.organizationId, accountId: account.accountId, personId: target.personId, expectedSessionVersion: account.sessionVersion, passwordHash: credential.passwordHash, issuedAt: credential.issuedAt, expiresAt: credential.expiresAt })
  if (!issued.ok) throw conflict()
  return { personId: target.personId, accountId: account.accountId, name: target.name, email: account.email, temporaryPassword: credential.temporaryPassword, expiresAt: credential.expiresAt.toISOString() }
}

/** Desabilita o acesso: ninguém entra mais com nenhuma senha e as sessões abertas caem. Papéis ficam registrados. */
export async function disableAccess(deps: AccountAccessDeps, actor: SessionActor, input: { accountId: string }) {
  const { target } = await authorizedTarget(deps, actor, await deps.accounts.targetByAccount(actor.organizationId, input.accountId))
  const account = target.account!
  if (!account.active) throw new DomainError("O acesso desta pessoa já está desabilitado.", "ACCESS_ALREADY_DISABLED", 409)
  if (await wouldRemoveLastTenantAdmin(deps.repository, actor.organizationId, account.accountId)) {
    throw new DomainError("Esta pessoa é o último Administrador geral ativo — conceda o papel a outra pessoa antes de desabilitar o acesso.", "ACCESS_LAST_TENANT_ADMIN", 409)
  }
  const disabled = await deps.accounts.disable({ actorPersonId: actor.personId, actorAccountId: actor.accountId, organizationId: actor.organizationId, accountId: account.accountId, personId: target.personId, expectedSessionVersion: account.sessionVersion, at: deps.now() })
  if (!disabled.ok) throw conflict()
  return { personId: target.personId, accountId: account.accountId }
}
