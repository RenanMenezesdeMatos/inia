import type { PlatformRole } from "../infrastructure/jwt.js"
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
  /** Falhas de credencial do identificador desde `since` e depois do último login bem-sucedido dele, fora a própria reserva. */
  recentFailures(identifierHash: string, since: Date, excludeAttemptId?: string | null): Promise<Date[]>
  /** Resultado da tentativa reservada (ou uma tentativa nova, sem reserva). */
  resolveAttempt(input: { attemptId: string | null; identifierHash: string; accountId: string | null; outcome: LoginAttemptOutcome; at: Date }): Promise<void>
  markLoggedIn(input: { accountId: string; identifierHash: string; at: Date }): Promise<void>
  passwordState(organizationId: string, accountId: string): Promise<PasswordState | null>
  /**
   * Grava a senha criada pela pessoa, encerra a troca obrigatória, apaga a senha temporária e revoga as outras sessões — numa
   * instrução só, com a auditoria. Otimista: só aplica se a versão de sessão ainda for `expectedSessionVersion` (outra senha
   * temporária gerada no meio do caminho = nada muda). Devolve a nova versão (para a sessão atual seguir valendo).
   */
  completePasswordChange(input: { organizationId: string; accountId: string; actorPersonId: string; expectedSessionVersion: number; passwordHash: string; at: Date }): Promise<{ sessionVersion: number } | null>
}
