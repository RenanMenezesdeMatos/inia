import type { AccessScope } from "../domain/access-scope.js"
import type { AccountAccessStatus } from "../domain/account-access-status.js"
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
}
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
}

export type CredentialTargetRecord = {
  personId: string
  name: string
  personActive: boolean
  teamId: string | null
  subteamId: string | null
  /**
   * Onde estão (Grupo/Subgrupo) as pessoas ATIVAS que a pessoa lidera, em qualquer profundidade de reports_to. Quem assume a
   * credencial de um líder herda a visão operacional da estrutura dele — por isso a custódia exige alcançar todas elas.
   */
  ledPlacements: { teamId: string | null; subteamId: string | null }[]
  account: { accountId: string; email: string; active: boolean; sessionVersion: number; passwordChangeRequired: boolean; assignments: { roleCode: string; scope: AccessScope }[] } | null
}

/** Quem fez a ação (auditoria). null = o próprio sistema (ex.: instalação criando o primeiro administrador). */
export type CredentialActor = { actorPersonId: string | null; actorAccountId: string | null }
export type TemporaryCredential = { passwordHash: string; issuedAt: Date; expiresAt: Date }
export type CredentialWriteResult<E extends string = never> = { ok: true; accountId: string } | { ok: false; error: "CONFLICT" | E }

export interface AccountAccessRepository {
  listIdentifiedUsers(organizationId: string, visibility: VisibilityFilter, filters: { search?: string | undefined; status?: AccountAccessStatus | undefined; page: number; pageSize: number }): Promise<{ items: IdentifiedUser[]; total: number }>
  targetByPerson(organizationId: string, personId: string): Promise<CredentialTargetRecord | null>
  targetByAccount(organizationId: string, accountId: string): Promise<CredentialTargetRecord | null>
  /** Cria a conta de login da pessoa (sem cadastro novo) já com senha temporária. */
  createWithTemporaryPassword(input: CredentialActor & TemporaryCredential & { organizationId: string; personId: string; email: string }): Promise<CredentialWriteResult<"ALREADY_LINKED" | "EMAIL_IN_USE">>
  /** Reabilita uma conta desabilitada com senha temporária (e-mail novo opcional). */
  enableWithTemporaryPassword(input: CredentialActor & TemporaryCredential & { organizationId: string; accountId: string; personId: string; expectedSessionVersion: number; email: string | null }): Promise<CredentialWriteResult<"EMAIL_IN_USE">>
  /** Troca a senha por uma temporária nova (a anterior deixa de valer) e revoga as sessões. */
  issueTemporaryPassword(input: CredentialActor & TemporaryCredential & { organizationId: string; accountId: string; personId: string; expectedSessionVersion: number }): Promise<CredentialWriteResult>
  /** Desabilita o acesso, invalida a senha temporária pendente e revoga as sessões. */
  disable(input: CredentialActor & { organizationId: string; accountId: string; personId: string; expectedSessionVersion: number; at: Date }): Promise<CredentialWriteResult>
}
