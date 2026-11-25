import type { AccessScope } from "../domain/access-scope.js"
import type { AccountAccessStatus, CredentialProvider } from "../domain/account-access-status.js"
import type { NetworkAccessIssue } from "../domain/network-access.js"
import type { VisibilityFilter } from "./access-repository.js"

/**
 * PORTA da liberação de acesso: pessoas identificadas (people) × conta de login (user_accounts). Toda escrita é UMA instrução
 * com a auditoria junto, otimista pela versão de sessão lida antes (`expectedSessionVersion`): se outra pessoa mexeu no mesmo
 * acesso no meio do caminho, nada muda e o caso de uso responde conflito. Senha só chega aqui como hash.
 */
export type IdentifiedUserAccount = {
  accountId: string
  email: string
  active: boolean
  lastLoginAt: Date | null
  passwordChangeRequired: boolean
  temporaryPasswordIssuedAt: Date | null
  temporaryPasswordExpiresAt: Date | null
  accessDisabledAt: Date | null
  roleCodes: string[]
  /** Quem gerencia a senha (`credentialProviderOf`): NETWORK = Active Directory, nunca senha temporária da INIA. */
  credentialProvider: CredentialProvider
  /** Por que a conta foi desabilitada, quando a auditoria registra (ex.: a base do cliente desativou a pessoa); null = por alguém. */
  disabledReason: AccessDisabledReason | null
}
export const ACCESS_DISABLED_REASONS = ["PERSON_DEACTIVATED", "PERSON_DEACTIVATED_BY_SOURCE", "LINKED_BY_SOURCE_NEW_PLACEMENT"] as const
export type AccessDisabledReason = (typeof ACCESS_DISABLED_REASONS)[number]
export type IdentifiedUser = {
  personId: string
  name: string
  matricula: string | null
  jobTitle: string | null
  level: string
  personActive: boolean
  team: { id: string; name: string } | null
  subteam: { id: string; name: string } | null
  account: IdentifiedUserAccount | null
  /** Com o login pela rede ligado: o que impede esta pessoa de entrar pela matrícula (null = nada, ou a conta é de emergência). */
  networkIssue: NetworkAccessIssue | null
  /** Login do AD por que a conta já entrou (formatos sem o último dígito); só para a orientação de login. */
  directoryLogin: string | null
  /** Habilitar esta pessoa abre a entrada pela rede (NETWORK, sem senha) ou gera senha temporária (LOCAL). */
  enableCredential: CredentialProvider
}

/** Busca e filtros da lista de Acessos: somam-se (E), sempre dentro da visibilidade de quem pede. */
export type IdentifiedUserFilters = {
  search?: string | undefined
  status?: AccountAccessStatus | undefined
  /** Só quem tem algo no cadastro que impede a entrada pela rede (`networkIssue`). */
  networkIssue?: boolean | undefined
  /** Só quem tem exatamente este login de rede (matrícula normalizada). */
  networkLogin?: string | undefined
  page: number
  pageSize: number
}

export type CredentialTargetRecord = {
  personId: string
  name: string
  personActive: boolean
  matricula: string | null
  /** O login pela rede está ligado na organização da pessoa. */
  networkLoginEnabled: boolean
  /** Outra conta que pode entrar pela rede tem a mesma matrícula. */
  matriculaDuplicated: boolean
  teamId: string | null
  subteamId: string | null
  /**
   * Onde estão (Grupo/Subgrupo) as pessoas ATIVAS que a pessoa lidera, em qualquer profundidade de reports_to. Quem assume a
   * credencial de um líder herda a visão operacional da estrutura dele — por isso a custódia exige alcançar todas elas.
   */
  ledPlacements: { teamId: string | null; subteamId: string | null }[]
  account: { accountId: string; email: string; active: boolean; sessionVersion: number; passwordChangeRequired: boolean; credentialProvider: CredentialProvider; assignments: { roleCode: string; scope: AccessScope }[] } | null
}

/** Quem fez a ação (auditoria). null = o próprio sistema (ex.: instalação criando o primeiro administrador). */
export type CredentialActor = { actorPersonId: string | null; actorAccountId: string | null }
export type TemporaryCredential = { passwordHash: string; issuedAt: Date; expiresAt: Date }
export type CredentialWriteResult<E extends string = never> = { ok: true; accountId: string } | { ok: false; error: "CONFLICT" | E }

/** Habilitação pela rede: sem senha temporária; a senha local guardada é uma que ninguém conhece (`retiredPasswordHash`). */
export type NetworkEnableWrite = CredentialActor & {
  organizationId: string
  at: Date
  retiredPasswordHash: string
  /** Lote (CSV) a que a habilitação pertence, na auditoria; null = uma a uma. */
  batchId: string | null
  create: { personId: string; email: string }[]
  reenable: { personId: string; accountId: string; expectedSessionVersion: number }[]
}

export interface AccountAccessRepository {
  listIdentifiedUsers(organizationId: string, visibility: VisibilityFilter, filters: IdentifiedUserFilters): Promise<{ items: IdentifiedUser[]; total: number }>
  targetByPerson(organizationId: string, personId: string): Promise<CredentialTargetRecord | null>
  targetByAccount(organizationId: string, accountId: string): Promise<CredentialTargetRecord | null>
  /** Cria a conta de login da pessoa (sem cadastro novo) já com senha temporária. */
  createWithTemporaryPassword(input: CredentialActor & TemporaryCredential & { organizationId: string; personId: string; email: string }): Promise<CredentialWriteResult<"ALREADY_LINKED" | "EMAIL_IN_USE">>
  /** Reabilita uma conta desabilitada com senha temporária (e-mail novo opcional). */
  enableWithTemporaryPassword(input: CredentialActor & TemporaryCredential & { organizationId: string; accountId: string; personId: string; expectedSessionVersion: number; email: string | null }): Promise<CredentialWriteResult<"EMAIL_IN_USE">>
  /** Troca a senha por uma temporária nova (a anterior deixa de valer) e revoga as sessões. */
  issueTemporaryPassword(input: CredentialActor & TemporaryCredential & { organizationId: string; accountId: string; personId: string; expectedSessionVersion: number }): Promise<CredentialWriteResult>
  /**
   * Habilita pela rede numa instrução só por tipo, cada conta com a auditoria dela. Só grava o que ainda vale na hora da escrita
   * (login pela rede ligado, pessoa ativa, e-mail livre, conta ainda desabilitada e na versão lida). Devolve quem entrou.
   */
  enableForNetwork(input: NetworkEnableWrite): Promise<Map<string, { accountId: string }>>
  /** Alvos pelas matrículas normalizadas (`upper(btrim(matricula))`), com conta, papéis e estrutura liderada. */
  targetsByNetworkLogin(organizationId: string, networkLogins: readonly string[]): Promise<CredentialTargetRecord[]>
  /** Outra conta que pode entrar pela rede já usa esta matrícula (normalizada), em qualquer organização — a regra do "Habilitar". */
  networkLoginTaken(networkLogin: string): Promise<boolean>
  /** A matrícula (normalizada) é de alguma pessoa de OUTRA organização. */
  matriculaInOtherOrganization(organizationId: string, networkLogin: string): Promise<boolean>
  /** Quais destes e-mails (minúsculas) já são de alguma conta. */
  emailsInUse(emails: readonly string[]): Promise<Set<string>>
  /** Matrículas do alcance com os mesmos números (prefixo ou zeros diferentes), por matrícula procurada. */
  similarMatriculas(organizationId: string, visibility: VisibilityFilter, networkLogins: readonly string[]): Promise<Map<string, string[]>>
  /** Desabilita o acesso, invalida a senha temporária pendente e revoga as sessões. */
  disable(input: CredentialActor & { organizationId: string; accountId: string; personId: string; expectedSessionVersion: number; at: Date }): Promise<CredentialWriteResult>
}
