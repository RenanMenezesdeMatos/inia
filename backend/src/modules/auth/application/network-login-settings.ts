import { DomainError } from "../../../shared/domain/domain-error.js"
import type { DirectoryAuthenticator } from "./directory-authenticator.js"
import { NETWORK_LOGIN_MAX_FAILURES } from "../domain/network-login.js"

/** Conta local de emergência como a tela de Acessos a mostra. */
export type EmergencyAccount = { accountId: string; name: string; email: string; active: boolean; lastLoginAt: string | null }

/** Matrícula que aparece em mais de uma conta da organização com grafias diferentes (maiúscula/espaço): ninguém entra por ela. */
export type AmbiguousMatricula = { matricula: string; accounts: number }

/**
 * PORTA do interruptor do login pela rede (organizations + contas). SQL em infrastructure/postgres-network-login-repository.ts.
 */
export interface NetworkLoginRepository {
  /** Alguma organização da instalação está com o login pela rede ligado (tela de login). */
  anyOrganizationEnabled(): Promise<boolean>
  /** A conta confirma a ciência com a credencial de rede (login pela rede ligado e conta comum) ou com a local. */
  credentialModeOf(accountId: string): Promise<"NETWORK" | "LOCAL">
  organizationSwitch(organizationId: string): Promise<{ enabled: boolean; changedAt: Date | null; changedBy: string | null } | null>
  emergencyAccounts(organizationId: string): Promise<EmergencyAccount[]>
  /** Matrículas repetidas pela comparação do login (`upper(btrim(matricula))`) entre as contas da organização. */
  ambiguousMatriculas(organizationId: string): Promise<AmbiguousMatricula[]>
  /** Liga/desliga; auditado (ACCESS_NETWORK_LOGIN_CHANGED) só quando muda. */
  setEnabled(input: { organizationId: string; enabled: boolean; at: Date; actorPersonId: string }): Promise<void>
}

export type NetworkLoginSettingsDeps = {
  repository: NetworkLoginRepository
  directory: DirectoryAuthenticator
  /** Servidores configurados (só para mostrar). */
  servers: string[]
  weakKeyAllowed: boolean
  /** Formatos de matrícula com o login sem o último dígito (`AD_LOGIN_WITHOUT_LAST_DIGIT`, só para mostrar). */
  shortLoginFormats?: readonly string[]
  /** Produção sem cookie seguro: a senha de rede passaria sem criptografia. */
  httpsRequired: boolean
  now: () => Date
}

export type NetworkLoginStatus = {
  configured: boolean
  domain: string | null
  servers: string[]
  weakKeyAllowed: boolean
  shortLoginFormats: readonly string[]
  httpsRequiredButMissing: boolean
  maxFailures: number
  enabled: boolean
  changedAt: string | null
  changedBy: string | null
  emergencyAccounts: EmergencyAccount[]
  ambiguousMatriculas: AmbiguousMatricula[]
}

export async function networkLoginStatus(deps: NetworkLoginSettingsDeps, organizationId: string): Promise<NetworkLoginStatus> {
  const [org, emergencyAccounts, ambiguousMatriculas] = await Promise.all([
    deps.repository.organizationSwitch(organizationId),
    deps.repository.emergencyAccounts(organizationId),
    deps.repository.ambiguousMatriculas(organizationId),
  ])
  return {
    configured: deps.directory.configured,
    domain: deps.directory.domain,
    servers: deps.servers,
    weakKeyAllowed: deps.weakKeyAllowed,
    shortLoginFormats: deps.shortLoginFormats ?? [],
    httpsRequiredButMissing: deps.httpsRequired,
    maxFailures: NETWORK_LOGIN_MAX_FAILURES,
    enabled: org?.enabled === true,
    changedAt: org?.changedAt ? org.changedAt.toISOString() : null,
    changedBy: org?.changedBy ?? null,
    emergencyAccounts,
    ambiguousMatriculas,
  }
}

const notConfigured = () => new DomainError("O login pela rede não está configurado nesta instalação (AD_LDAP_URLS e AD_DOMAIN).", "NETWORK_LOGIN_NOT_CONFIGURED", 409)

/** "Conferir servidores": só TLS, sem senha. */
export async function probeNetworkLoginServers(deps: Pick<NetworkLoginSettingsDeps, "directory">) {
  if (!deps.directory.configured) throw notConfigured()
  return deps.directory.probe()
}

/**
 * Liga/desliga o login pela rede. Ligar exige: AD configurado, HTTPS em produção, ao menos UMA conta de emergência habilitada
 * (sem ela, o AD fora do ar deixaria todo mundo de fora) e nenhuma matrícula repetida por maiúscula/espaço (achado SLR-06: a
 * pessoa ficaria de fora do login com a mesma resposta de senha errada). Desligar nunca é bloqueado.
 */
export async function setNetworkLogin(deps: NetworkLoginSettingsDeps, input: { organizationId: string; enabled: boolean; actorPersonId: string }): Promise<NetworkLoginStatus> {
  if (input.enabled) {
    if (!deps.directory.configured) throw notConfigured()
    if (deps.httpsRequired) throw new DomainError("Ligue o HTTPS antes: a senha de rede não pode passar por uma conexão sem criptografia.", "NETWORK_LOGIN_HTTPS_REQUIRED", 409)
    if (!(await deps.repository.emergencyAccounts(input.organizationId)).some((account) => account.active)) {
      throw new DomainError("Antes de ligar, é preciso ao menos uma conta de emergência habilitada (crie com npm run admin:create).", "NETWORK_LOGIN_EMERGENCY_ACCOUNT_REQUIRED", 409)
    }
    const ambiguous = await deps.repository.ambiguousMatriculas(input.organizationId)
    if (ambiguous.length > 0) {
      throw new DomainError(
        "Há matrículas repetidas com grafias diferentes (maiúscula ou espaço). Corrija o cadastro dessas pessoas antes de ligar: com a matrícula repetida, ninguém consegue entrar por ela.",
        "NETWORK_LOGIN_AMBIGUOUS_MATRICULA",
        409,
        { matriculas: ambiguous.map((item) => item.matricula) },
      )
    }
  }
  await deps.repository.setEnabled({ organizationId: input.organizationId, enabled: input.enabled, at: deps.now(), actorPersonId: input.actorPersonId })
  return networkLoginStatus(deps, input.organizationId)
}
