import type { PlatformRole } from "../infrastructure/jwt.js"
import type { LoginAttemptReason } from "../domain/login-attempt.js"
import type { SessionAccountState } from "../domain/session-state.js"

/** Conta como o login a enxerga (identidade do token + estado da credencial). */
export type LoginAccount = SessionAccountState & {
  id: string
  organizationId: string
  personId: string
  name: string
  role: PlatformRole
  email: string
  passwordHash: string
  avatarUrl: string | null
  jobTitle: string | null
  teamId: string | null
  teamName: string | null
  /** A conta não entra porque a PESSOA está inativa no cadastro (a conta em si pode estar habilitada). */
  personInactive?: boolean
  /** Matrícula da pessoa (login de rede quando o login pela rede está ligado). */
  matricula: string | null
  /** O login pela rede está ligado na organização da conta. */
  networkLoginEnabled: boolean
  /** Conta local de emergência: aceita e-mail e senha mesmo com o login pela rede ligado (migration 247). */
  emergencyLocalAccess: boolean
}

export type LoginAttemptOutcome = "SUCCEEDED" | "INVALID_CREDENTIALS" | "ACCESS_DISABLED" | "TEMPORARY_PASSWORD_EXPIRED" | "LOCKED"

/** Estado da credencial para a troca de senha do primeiro acesso. */
export type PasswordState = SessionAccountState & { email: string; passwordHash: string }

/**
 * PORTA da credencial de login (user_accounts + tentativas). Login é global (o e-mail é único em todas as organizações);
 * as demais operações são sempre escopadas pela organização da sessão.
 */
export interface CredentialStore {
  findByLogin(login: string): Promise<LoginAccount | null>
  /**
   * Conta pela matrícula de rede JÁ normalizada, só em organização com o login pela rede ligado. A mesma matrícula em mais de um
   * cadastro: vale a ÚNICA que pode entrar (conta habilitada e pessoa ativa); duas que podem = ambígua = null.
   */
  findByNetworkLogin(networkLogin: string): Promise<LoginAccount | null>
  /**
   * Login pela rede bem-sucedido: marca o login e, se a conta ainda esperava a troca da senha temporária (e não é de
   * emergência), aposenta a senha temporária no lugar (`retiredPasswordHash`, uma senha que ninguém conhece).
   */
  completeNetworkLogin(input: { accountId: string; identifierHash: string; at: Date; retiredPasswordHash: string }): Promise<void>
  /** Entrada pela conta de emergência com o login pela rede ligado: auditoria + aviso a quem administra os acessos. */
  recordEmergencyLocalLogin(input: { organizationId: string; accountId: string; personId: string; at: Date }): Promise<void>
  /** Estado da conta para o guard de sessão; com `sessionId` (jti), uma sessão revogada no logout volta como `active: false`. */
  sessionState(organizationId: string, accountId: string, sessionId?: string | null): Promise<(SessionAccountState & { role?: PlatformRole }) | null>
  /** Logout: revoga só ESTA sessão (jti) até o token vencer; limpa revogações vencidas. */
  revokeSession(input: { organizationId: string; accountId: string; sessionId: string; expiresAt: Date; at: Date }): Promise<void>
  /** Atividade desta sessão (jti) agora — o encerramento por inatividade mede a partir daqui. Cria a linha se não existir. */
  recordSessionActivity(input: { accountId: string; sessionId: string; expiresAt: Date; at: Date }): Promise<void>
  /**
   * "Sair de todos os aparelhos": a própria pessoa encerra TODAS as suas sessões (versão de sessão + 1), com auditoria.
   * false = conta não encontrada na organização.
   */
  endAllSessions(input: { organizationId: string; accountId: string; actorPersonId: string; at: Date }): Promise<boolean>
  /**
   * Reserva a tentativa ANTES de conferir a senha: gravada já como falha de credencial, ela conta para a trava de toda tentativa
   * simultânea que conferir depois (achado AUTH-1: verificar → bcrypt → gravar deixava N tentativas paralelas passarem pela
   * trava de 5). Devolve o id para `resolveAttempt` gravar o resultado; null = a loja não devolveu id (cai no insert).
   */
  reserveAttempt(input: { identifierHash: string; at: Date }): Promise<string | null>
  /**
   * Falhas de credencial do identificador desde `since` e depois do último login bem-sucedido dele, fora a própria reserva, em
   * ordem cronológica. `limit` = só as N mais recentes (a trava da matrícula lê 24 h).
   */
  recentFailures(identifierHash: string, since: Date, excludeAttemptId?: string | null, options?: { limit?: number }): Promise<Date[]>
  /**
   * Resultado da tentativa reservada (ou uma tentativa nova, sem reserva). `redatedTo`: a falha passa a valer a partir deste instante (o AD
   * só viu a senha depois da reserva).
   */
  resolveAttempt(input: { attemptId: string | null; identifierHash: string; accountId: string | null; outcome: LoginAttemptOutcome; at: Date; reason?: LoginAttemptReason | null; directoryCode?: string | null; redatedTo?: Date | null }): Promise<void>
  /** Login do AD por que esta conta já entrou (formatos sem o último dígito); null = ainda não se sabe. */
  directoryLoginOf(accountId: string): Promise<string | null>
  rememberDirectoryLogin(accountId: string, login: string): Promise<void>
  /** Destas matrículas (normalizadas), quais são de pessoas ATIVAS do cadastro. */
  registeredMatriculas(normalized: readonly string[]): Promise<string[]>
  markLoggedIn(input: { accountId: string; identifierHash: string; at: Date }): Promise<void>
  passwordState(organizationId: string, accountId: string): Promise<PasswordState | null>
  /**
   * Grava a senha criada pela pessoa, encerra a troca obrigatória, apaga a senha temporária e revoga as outras sessões — numa
   * instrução só, com a auditoria. Otimista: só aplica se a versão de sessão ainda for `expectedSessionVersion` (outra senha
   * temporária gerada no meio do caminho = nada muda). Devolve a nova versão (para a sessão atual seguir valendo).
   */
  completePasswordChange(input: { organizationId: string; accountId: string; actorPersonId: string; expectedSessionVersion: number; passwordHash: string; at: Date }): Promise<{ sessionVersion: number } | null>
}
