/**
 * ESTADO DA SESSÃO — decisão pura tomada a cada request autenticado, a partir do que o banco diz da conta AGORA (nunca só do
 * JWT): conta desabilitada, versão de sessão diferente (sessões revogadas) ou senha temporária vencida derrubam a sessão; troca
 * de senha pendente só deixa passar as rotas que a pessoa precisa para criar a senha (e sair).
 */
export type SessionAccountState = {
  active: boolean
  sessionVersion: number
  passwordChangeRequired: boolean
  temporaryPasswordExpiresAt: Date | null
}

export type SessionDecision =
  | { ok: true; passwordChangeRequired: boolean; temporaryPasswordExpiresAt: Date | null }
  | { ok: false; status: 401 | 403; code: "SESSION_REVOKED" | "TEMPORARY_PASSWORD_EXPIRED" | "PASSWORD_CHANGE_REQUIRED"; message: string }

export function decideSession(account: SessionAccountState | null, tokenVersion: number, now: Date, options: { allowPendingPasswordChange?: boolean } = {}): SessionDecision {
  if (!account || !account.active || account.sessionVersion !== tokenVersion) {
    return { ok: false, status: 401, code: "SESSION_REVOKED", message: "Sua sessão foi encerrada. Entre novamente." }
  }
  if (!account.passwordChangeRequired) return { ok: true, passwordChangeRequired: false, temporaryPasswordExpiresAt: null }
  // Pendente sem validade não deveria existir (constraint no banco); tratada como vencida — nunca como sessão livre.
  if (!account.temporaryPasswordExpiresAt || account.temporaryPasswordExpiresAt.getTime() <= now.getTime()) {
    return { ok: false, status: 401, code: "TEMPORARY_PASSWORD_EXPIRED", message: "Sua senha temporária expirou. Peça uma nova ao administrador." }
  }
  if (!options.allowPendingPasswordChange) {
    return { ok: false, status: 403, code: "PASSWORD_CHANGE_REQUIRED", message: "Crie a sua senha para continuar." }
  }
  return { ok: true, passwordChangeRequired: true, temporaryPasswordExpiresAt: account.temporaryPasswordExpiresAt }
}
