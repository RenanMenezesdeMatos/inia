import { randomBytes } from "node:crypto"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { generateTemporaryPassword, temporaryPasswordExpiry } from "../../auth/domain/temporary-password.js"
import { canAnywhere, checkCredentialCustody, type AccessContext } from "../domain/access-decision.js"
import { accountAccessStatusOf, temporaryPasswordExpired } from "../domain/account-access-status.js"
import { loginGuideOf, networkAccessIssueOf, networkAccountIdentifier, networkLoginOf, type NetworkAccessIssue } from "../domain/network-access.js"
import type { NetworkAttemptsReader } from "../../auth/application/network-attempts.js"
import type { VisibilityFilter } from "./access-repository.js"
import { systemRoleCatalog, type RoleCatalog } from "../domain/roles.js"
import { resolveAccess, visibilityOf, wouldRemoveLastTenantAdmin, type AccessDeps, type SessionActor } from "./access-service.js"
import type { AccountAccessRepository, CredentialTargetRecord, IdentifiedUser, IdentifiedUserFilters } from "./account-access-repository.js"

/**
 * LIBERAÇÃO DE ACESSO (casos de uso administrativos). Lista as pessoas que a plataforma JÁ identifica (people) com a situação
 * do acesso; habilitar cria a conta de login da pessoa quando ela ainda não existe (nunca um cadastro novo) ou reabilita a
 * desabilitada. Com o login pela rede ligado, habilitar NÃO gera senha (a pessoa entra com a matrícula e a senha de rede, conferidas
 * no AD); sem ele — e nas contas de emergência —, toda habilitação e toda "nova senha temporária" geram uma senha aleatória no
 * servidor, devolvida UMA vez (só o hash fica). Em massa pela rede: network-enable-service.ts. Desabilitar e gerar outra senha revogam as sessões da pessoa. Permissão `access.users.manage` no escopo da pessoa
 * + custódia (só sobre quem você poderia conceder todos os papéis) — validadas aqui, no servidor.
 */
export type AccountAccessDeps = AccessDeps & {
  accounts: AccountAccessRepository
  hashPassword: (plain: string) => Promise<string>
  generatePassword?: () => string
  temporaryPasswordTtlHours: number
  /** Tentativas de login pela rede (trava temporária, última resposta do AD). */
  networkAttempts: NetworkAttemptsReader
  /** O login pela rede está ligado na organização. */
  networkLoginEnabled: (organizationId: string) => Promise<boolean>
  /** Login do AD sem o último dígito da matrícula, nos formatos da instalação (null = não se aplica). */
  shortLoginOf?: (networkLogin: string) => string | null
  /** Domínio do AD da instalação (`AD_DOMAIN`) — identifica a conta sem e-mail. */
  networkDomain: string | null
}

/** O que a CUSTÓDIA precisa (conferir se quem age alcança a credencial da pessoa), sem o que só a habilitação usa. */
export type CredentialCustodyDeps = AccessDeps & Pick<AccountAccessDeps, "accounts">

/** Habilitada pela rede: nenhuma senha foi gerada; a pessoa entra com a matrícula e a senha de rede. */
export type NetworkAccessEnabled = { credential: "NETWORK"; personId: string; accountId: string; name: string; matricula: string }
export type EnabledAccess = NetworkAccessEnabled | ({ credential: "TEMPORARY_PASSWORD" } & IssuedTemporaryPassword)

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

/** A pessoa está no escopo de quem age (organização inteira, Grupo ou Subgrupo). */
export const isReachable = (visibility: VisibilityFilter, target: Pick<CredentialTargetRecord, "teamId" | "subteamId">): boolean =>
  visibility.organizationWide || (target.teamId !== null && visibility.teamIds.includes(target.teamId)) || (target.subteamId !== null && visibility.subteamIds.includes(target.subteamId))

/** Por que quem age não pode mexer na credencial desta pessoa (que já está no escopo dele); null = pode. */
export function credentialDenial(access: AccessContext, visibility: VisibilityFilter, target: CredentialTargetRecord, catalog: RoleCatalog): keyof typeof CUSTODY_MESSAGES | null {
  const custody = checkCredentialCustody(access, { accountId: target.account?.accountId ?? null, collaborator: { personId: target.personId, teamId: target.teamId, subteamId: target.subteamId }, assignments: target.account?.assignments ?? [] }, catalog)
  if (!custody.ok) return custody.reason
  return reachesLedStructure(visibility, target) ? null : "TARGET_LEADS_OUTSIDE_SCOPE"
}

async function authorizedTarget(deps: CredentialCustodyDeps, actor: SessionActor, target: CredentialTargetRecord | null): Promise<{ access: AccessContext; target: CredentialTargetRecord }> {
  const catalog: RoleCatalog = deps.catalog ?? systemRoleCatalog
  const access = await resolveAccess(deps, actor)
  if (!canAnywhere(access, "access.users.manage", catalog)) throw new DomainError("Você não tem permissão para esta ação.", "FORBIDDEN", 403)
  if (!target) throw notFound()
  const visibility = visibilityOf(access, "access.users.manage", catalog)
  // Fora do escopo = não encontrado (não revela quem existe fora do alcance).
  if (!isReachable(visibility, target)) throw notFound()
  const denial = credentialDenial(access, visibility, target, catalog)
  if (denial) throw new DomainError(CUSTODY_MESSAGES[denial], `ACCESS_${denial}`, 403)
  return { access, target }
}

/**
 * Custódia para mudanças de credencial feitas FORA da tela de acessos (e-mail de login, inativar a pessoa pelo cadastro): a
 * MESMA régua de "Habilitar / Gerar senha / Desabilitar" (achado U-F3) — permissão `access.users.manage` no escopo da pessoa,
 * nunca o próprio acesso, só sobre quem você poderia conceder todos os papéis, alcançando a estrutura que ela lidera.
 * Pessoa sem conta de login: nada a proteger.
 */
export async function assertCredentialChangeAllowed(deps: CredentialCustodyDeps, actor: SessionActor, personId: string): Promise<void> {
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
export async function assertAccountRelinkAllowed(deps: CredentialCustodyDeps, actor: SessionActor, fromPersonId: string, toPersonId: string): Promise<void> {
  const [from, to] = await Promise.all([deps.accounts.targetByPerson(actor.organizationId, fromPersonId), deps.accounts.targetByPerson(actor.organizationId, toPersonId)])
  await authorizedTarget(deps, actor, from)
  await authorizedTarget(deps, actor, to ? { ...to, account: from?.account ?? to.account } : null)
}

const conflict = () => new DomainError("Outra pessoa alterou este acesso agora há pouco. Atualize a lista e tente de novo.", "ACCESS_CONCURRENT_CHANGE", 409)
/** Conta que entra pela rede: a senha é a do Active Directory; a INIA não gera nem troca (a API recusa, a tela não oferece). */
const passwordManagedByNetwork = () => new DomainError("A senha desta conta é gerenciada pelo Active Directory: a pessoa entra com a matrícula e a senha de rede. Para trocar ou desbloquear, procure o suporte da rede.", "ACCESS_PASSWORD_MANAGED_BY_NETWORK", 409)
const emailInUse = () => new DomainError("Já existe uma conta com este e-mail.", "EMAIL_ALREADY_IN_USE", 409)

async function newTemporaryCredential(deps: AccountAccessDeps) {
  const temporaryPassword = (deps.generatePassword ?? generateTemporaryPassword)()
  const issuedAt = deps.now()
  return { temporaryPassword, passwordHash: await deps.hashPassword(temporaryPassword), issuedAt, expiresAt: temporaryPasswordExpiry(issuedAt, deps.temporaryPasswordTtlHours) }
}

/** Senha local que ninguém conhece, para a conta que entra pelo AD (um hash por operação; o segredo é descartado aqui mesmo). */
export const retiredPasswordHash = (deps: Pick<AccountAccessDeps, "hashPassword">) => deps.hashPassword(randomBytes(32).toString("base64url"))

export async function listIdentifiedUsers(deps: AccountAccessDeps, actor: SessionActor, filters: IdentifiedUserFilters) {
  const catalog = deps.catalog ?? systemRoleCatalog
  const access = await resolveAccess(deps, actor)
  if (!canAnywhere(access, "access.users.view", catalog)) throw new DomainError("Você não tem permissão para esta ação.", "FORBIDDEN", 403)
  const page = await deps.accounts.listIdentifiedUsers(actor.organizationId, visibilityOf(access, "access.users.view", catalog), filters)
  const now = deps.now()
  // Situação do login pela rede (trava temporária, última resposta do AD): só para quem GERENCIA acessos, e só das pessoas do escopo dele.
  const managed = canAnywhere(access, "access.users.manage", catalog) ? visibilityOf(access, "access.users.manage", catalog) : null
  const loginOf = (user: IdentifiedUser) => (managed && user.enableCredential === "NETWORK" && isReachable(managed, { teamId: user.team?.id ?? null, subteamId: user.subteam?.id ?? null }) ? networkLoginOf(user.matricula) : null)
  const attempts = await deps.networkAttempts.summaries(page.items.flatMap((user) => loginOf(user) ?? []), now)
  return {
    ...page,
    networkLoginEnabled: await deps.networkLoginEnabled(actor.organizationId),
    items: page.items.map(({ directoryLogin, ...user }) => {
      const login = loginOf({ ...user, directoryLogin })
      return {
        ...user,
        loginGuide: loginGuideOf({
          byNetwork: user.enableCredential === "NETWORK", matricula: user.matricula, email: user.account?.email ?? null, issue: user.networkIssue, directoryLogin,
          shortLogin: deps.shortLoginOf?.(networkLoginOf(user.matricula) ?? "") ?? null,
          // O login do AD só para quem gerencia acessos no escopo da pessoa (como a situação do login).
          showDirectory: login !== null,
        }),
        self: user.personId === actor.personId,
        accessStatus: accountAccessStatusOf(user.account),
        temporaryPasswordExpired: temporaryPasswordExpired(user.account, now),
        // Ação "Nova senha temporária" só para conta com senha da INIA; a tela explica quando a senha é do AD.
        canIssueTemporaryPassword: user.account?.active === true && user.account.credentialProvider === "LOCAL",
        account: user.account ? { ...user.account, roles: user.account.roleCodes.map((code) => ({ code, name: catalog.find(code)?.name ?? code })) } : null,
        networkAttempts: (login && attempts.get(login)) || null,
      }
    }),
  }
}

const NETWORK_ISSUE_ERRORS: Record<NetworkAccessIssue, { code: string; message: string; status: 409 | 422 }> = {
  PERSON_INACTIVE: { status: 409, code: "ACCESS_PERSON_INACTIVE", message: "Esta pessoa está inativa no cadastro — reative-a antes de habilitar o acesso." },
  MATRICULA_MISSING: { status: 422, code: "ACCESS_MATRICULA_REQUIRED", message: "Esta pessoa não tem matrícula no cadastro. Com o login pela rede ligado, é pela matrícula que ela entra — informe a matrícula antes de habilitar." },
  MATRICULA_INVALID: { status: 422, code: "ACCESS_MATRICULA_INVALID", message: "A matrícula do cadastro tem espaço ou símbolo que não existe num login de rede. Corrija a matrícula na base antes de habilitar." },
  MATRICULA_DUPLICATED: { status: 409, code: "ACCESS_MATRICULA_DUPLICATED", message: "Outra conta habilitada tem a mesma matrícula. Desabilite a conta repetida ou corrija a matrícula antes: com duas, ninguém entra por ela." },
}

/** O mesmo impedimento recusa igual em "Habilitar" e em "Novo usuário". */
export const networkIssueError = (issue: NetworkAccessIssue) => new DomainError(NETWORK_ISSUE_ERRORS[issue].message, NETWORK_ISSUE_ERRORS[issue].code, NETWORK_ISSUE_ERRORS[issue].status)

/**
 * Habilita o acesso: cria a conta de login ou reabilita a desabilitada. Login pela rede ligado = sem senha (ver `enableByNetwork`);
 * senão, senha temporária (conta nova pede o e-mail de login).
 */
export async function enableAccess(deps: AccountAccessDeps, actor: SessionActor, input: { personId: string; email?: string | undefined }): Promise<EnabledAccess> {
  const { target } = await authorizedTarget(deps, actor, await deps.accounts.targetByPerson(actor.organizationId, input.personId))
  if (!target.personActive) throw new DomainError("Esta pessoa está inativa no cadastro — reative-a antes de habilitar o acesso.", "ACCESS_PERSON_INACTIVE", 409)
  const email = input.email?.trim().toLowerCase() || null
  // A conta de emergência continua com senha da INIA mesmo com o login pela rede ligado.
  const byNetwork = target.account ? target.account.credentialProvider === "NETWORK" : target.networkLoginEnabled
  if (target.account?.active) throw new DomainError(byNetwork ? "O acesso desta pessoa já está habilitado: ela entra com a matrícula e a senha de rede." : "O acesso desta pessoa já está habilitado. Para uma nova senha, use “Gerar nova senha temporária”.", "ACCESS_ALREADY_ENABLED", 409)
  if (byNetwork) return enableByNetwork(deps, actor, target, email)
  const actorIds = { actorPersonId: actor.personId, actorAccountId: actor.accountId }

  if (!target.account) {
    if (!email) throw new DomainError("Informe o e-mail que a pessoa vai usar para entrar.", "ACCESS_EMAIL_REQUIRED", 422)
    const credential = await newTemporaryCredential(deps)
    const created = await deps.accounts.createWithTemporaryPassword({ ...actorIds, organizationId: actor.organizationId, personId: target.personId, email, passwordHash: credential.passwordHash, issuedAt: credential.issuedAt, expiresAt: credential.expiresAt })
    // ALREADY_LINKED = outra pessoa criou a conta no meio do caminho.
    if (!created.ok) throw created.error === "EMAIL_IN_USE" ? emailInUse() : conflict()
    return { credential: "TEMPORARY_PASSWORD", personId: target.personId, accountId: created.accountId, name: target.name, email, temporaryPassword: credential.temporaryPassword, expiresAt: credential.expiresAt.toISOString() }
  }

  const credential = await newTemporaryCredential(deps)
  const enabled = await deps.accounts.enableWithTemporaryPassword({ ...actorIds, organizationId: actor.organizationId, accountId: target.account.accountId, personId: target.personId, expectedSessionVersion: target.account.sessionVersion, email, passwordHash: credential.passwordHash, issuedAt: credential.issuedAt, expiresAt: credential.expiresAt })
  if (!enabled.ok) throw enabled.error === "EMAIL_IN_USE" ? emailInUse() : conflict()
  return { credential: "TEMPORARY_PASSWORD", personId: target.personId, accountId: enabled.accountId, name: target.name, email: email ?? target.account.email, temporaryPassword: credential.temporaryPassword, expiresAt: credential.expiresAt.toISOString() }
}

/**
 * Habilitar pela REDE: abre a porta da INIA para a matrícula; a senha é a do AD e a INIA não gera, mostra nem guarda nenhuma. Recusa
 * o que faria a pessoa continuar sem entrar (sem matrícula, matrícula inválida ou repetida). O e-mail é opcional numa conta nova (sem
 * ele, a conta é identificada por `matricula@dominio`) e nunca muda numa conta que já existe. A trava temporária das tentativas feitas
 * enquanto a pessoa não tinha conta é liberada.
 */
async function enableByNetwork(deps: AccountAccessDeps, actor: SessionActor, target: CredentialTargetRecord, email: string | null): Promise<NetworkAccessEnabled> {
  const issue = networkAccessIssueOf({ personActive: target.personActive, matricula: target.matricula, duplicated: target.matriculaDuplicated })
  if (issue) throw networkIssueError(issue)
  const networkLogin = networkLoginOf(target.matricula)!
  const identifier = target.account ? null : email ?? networkAccountIdentifier(networkLogin, deps.networkDomain)
  if (!target.account && !identifier) throw new DomainError("Informe um e-mail para identificar a conta desta pessoa.", "ACCESS_EMAIL_REQUIRED", 422)
  if (identifier && (await deps.accounts.emailsInUse([identifier])).has(identifier)) throw emailInUse()
  const enabled = await deps.accounts.enableForNetwork({
    organizationId: actor.organizationId, actorPersonId: actor.personId, actorAccountId: actor.accountId, at: deps.now(), batchId: null,
    retiredPasswordHash: await retiredPasswordHash(deps),
    create: identifier ? [{ personId: target.personId, email: identifier }] : [],
    reenable: target.account ? [{ personId: target.personId, accountId: target.account.accountId, expectedSessionVersion: target.account.sessionVersion }] : [],
  })
  const account = enabled.get(target.personId)
  if (!account) throw conflict()
  await deps.networkAttempts.releaseUnreached([networkLogin], deps.now())
  return { credential: "NETWORK", personId: target.personId, accountId: account.accountId, name: target.name, matricula: networkLogin }
}

/** Nova senha temporária: a anterior (temporária ou definitiva) deixa de valer, a troca volta a ser obrigatória e as sessões caem. */
export async function issueTemporaryPassword(deps: AccountAccessDeps, actor: SessionActor, input: { accountId: string }): Promise<IssuedTemporaryPassword> {
  const { target } = await authorizedTarget(deps, actor, await deps.accounts.targetByAccount(actor.organizationId, input.accountId))
  const account = target.account!
  if (!account.active) throw new DomainError("O acesso desta pessoa está desabilitado — use “Habilitar acesso”.", "ACCESS_NOT_ENABLED", 409)
  if (!target.personActive) throw new DomainError("Esta pessoa está inativa no cadastro — reative-a antes de gerar uma senha.", "ACCESS_PERSON_INACTIVE", 409)
  if (account.credentialProvider === "NETWORK") throw passwordManagedByNetwork()
  const credential = await newTemporaryCredential(deps)
  const issued = await deps.accounts.issueTemporaryPassword({ actorPersonId: actor.personId, actorAccountId: actor.accountId, organizationId: actor.organizationId, accountId: account.accountId, personId: target.personId, expectedSessionVersion: account.sessionVersion, passwordHash: credential.passwordHash, issuedAt: credential.issuedAt, expiresAt: credential.expiresAt })
  if (!issued.ok) {
    // O login pela rede pode ter sido ligado entre a leitura e a escrita (a escrita confere de novo): responde a causa real.
    const current = await deps.accounts.targetByAccount(actor.organizationId, account.accountId)
    throw current?.account?.credentialProvider === "NETWORK" ? passwordManagedByNetwork() : conflict()
  }
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
