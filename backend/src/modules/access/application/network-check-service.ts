import { DomainError } from "../../../shared/domain/domain-error.js"
import type { NetworkAttemptSummary } from "../../auth/application/network-attempts.js"
import { normalizeNetworkLogin } from "../../auth/domain/network-login.js"
import { canAnywhere } from "../domain/access-decision.js"
import { systemRoleCatalog } from "../domain/roles.js"
import { resolveAccess, visibilityOf, type SessionActor } from "./access-service.js"
import { listIdentifiedUsers, type AccountAccessDeps } from "./account-access-service.js"

type CheckedUser = Awaited<ReturnType<typeof listIdentifiedUsers>>["items"][number]
export type NetworkLoginCheck = {
  /** Login de rede que o servidor usaria para o que foi digitado; null = não é um login de rede. */
  networkLogin: string | null
  networkLoginEnabled: boolean
  /** Pessoas do alcance com exatamente esta matrícula (mais de uma = repetida). */
  people: CheckedUser[]
  /** Ninguém com ela: matrículas do alcance com os mesmos números (prefixo ou zeros diferentes). */
  similar: string[]
  /**
   * Tentativas com uma matrícula que não está no cadastro — só para quem administra a organização inteira. Os contadores são da instalação:
   * matrícula de pessoa de OUTRA organização não devolve nada.
   */
  attempts: NetworkAttemptSummary | null
}

/**
 * CONFERIR MATRÍCULA — responde "por que esta pessoa não consegue entrar?" a partir do que a pessoa digita, SEM senha e SEM consultar
 * o AD (nenhuma chamada: não soma no contador da conta de rede nem serve para descobrir contas). Usa o mesmo tratamento do login
 * (maiúsculas, `DOMINIO\\`, `@dominio`, caracteres invisíveis) e o que a INIA registrou. Exige gerenciar acessos; fora do escopo,
 * a pessoa simplesmente não aparece.
 */
export async function checkNetworkLogin(deps: AccountAccessDeps, actor: SessionActor, typed: string): Promise<NetworkLoginCheck> {
  const catalog = deps.catalog ?? systemRoleCatalog
  const access = await resolveAccess(deps, actor)
  if (!canAnywhere(access, "access.users.manage", catalog)) throw new DomainError("Você não tem permissão para esta ação.", "FORBIDDEN", 403)
  const networkLogin = normalizeNetworkLogin(typed)
  const networkLoginEnabled = await deps.networkLoginEnabled(actor.organizationId)
  if (!networkLogin) return { networkLogin: null, networkLoginEnabled, people: [], similar: [], attempts: null }
  const people = (await listIdentifiedUsers(deps, actor, { networkLogin, page: 1, pageSize: 10 })).items
  if (people.length > 0) return { networkLogin, networkLoginEnabled, people, similar: [], attempts: null }
  const visibility = visibilityOf(access, "access.users.manage", catalog)
  const [similar, attempts] = await Promise.all([
    deps.accounts.similarMatriculas(actor.organizationId, visibility, [networkLogin]),
    visibility.organizationWide && !(await deps.accounts.matriculaInOtherOrganization(actor.organizationId, networkLogin)) ? deps.networkAttempts.summaries([networkLogin], deps.now()) : new Map<string, NetworkAttemptSummary>(),
  ])
  return { networkLogin, networkLoginEnabled, people: [], similar: similar.get(networkLogin) ?? [], attempts: attempts.get(networkLogin) ?? null }
}
