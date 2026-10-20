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
  /** Última atividade DESTA sessão (jti); null = sessão sem registro (emitida antes do controle) — nunca derrubada por isso. */
  lastActivityAt?: Date | null
}

export type SessionDecision =
  | { ok: true; passwordChangeRequired: boolean; temporaryPasswordExpiresAt: Date | null }
  | { ok: false; status: 401 | 403; code: "SESSION_REVOKED" | "SESSION_IDLE" | "TEMPORARY_PASSWORD_EXPIRED" | "PASSWORD_CHANGE_REQUIRED"; message: string }

export function decideSession(account: SessionAccountState | null, tokenVersion: number, now: Date, options: { allowPendingPasswordChange?: boolean; idleTimeoutMs?: number } = {}): SessionDecision {
  if (!account || !account.active || account.sessionVersion !== tokenVersion) {
    return { ok: false, status: 401, code: "SESSION_REVOKED", message: "Sua sessão foi encerrada. Entre novamente." }
  }
  // Parada além do limite = encerrada, mesmo com o JWT ainda válido. Sem registro de atividade, nada a medir.
  const idleTimeoutMs = options.idleTimeoutMs ?? 0
  if (idleTimeoutMs > 0 && account.lastActivityAt && now.getTime() - account.lastActivityAt.getTime() > idleTimeoutMs) {
    return { ok: false, status: 401, code: "SESSION_IDLE", message: "Sua sessão foi encerrada por inatividade. Entre novamente." }
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
