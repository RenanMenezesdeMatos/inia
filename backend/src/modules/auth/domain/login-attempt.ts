/**
 * MOTIVO DE UMA TENTATIVA DE LOGIN PELA REDE — o que o administrador precisa para responder "por que esta pessoa não entra?".
 * Gravado em `auth_login_attempts.reason` (migration 254), nunca devolvido a quem tenta entrar.
 *
 *  - NO_ACCOUNT: a matrícula não achou uma conta utilizável na INIA; o AD NÃO foi chamado (nada somou na conta de rede);
 *  - BAD_FORMAT: o que foi digitado não é um login de rede; o AD não foi chamado;
 *  - NETWORK_*: resposta do AD (ou a falta dela) à senha;
 *  - NETWORK_IDENTITY_*: no login sem o último dígito, a ID funcional da conta do AD é de outra matrícula (MISMATCH) ou não pôde ser
 *    lida (UNREADABLE) — nos dois casos a pessoa não entra;
 *  - INIA_ACCESS_DISABLED / PERSON_INACTIVE: o AD confirmou a senha, mas a INIA não deixa entrar;
 *  - THROTTLED: a trava temporária da INIA barrou antes do AD.
 */
export const LOGIN_ATTEMPT_REASONS = ["NO_ACCOUNT", "BAD_FORMAT", "NETWORK_INVALID", "NETWORK_PASSWORD_EXPIRED", "NETWORK_ACCOUNT_LOCKED", "NETWORK_ACCOUNT_DISABLED", "NETWORK_UNAVAILABLE", "NETWORK_NO_ANSWER", "NETWORK_IDENTITY_MISMATCH", "NETWORK_IDENTITY_UNREADABLE", "INIA_ACCESS_DISABLED", "PERSON_INACTIVE", "THROTTLED"] as const
export type LoginAttemptReason = (typeof LOGIN_ATTEMPT_REASONS)[number]

export const isLoginAttemptReason = (value: unknown): value is LoginAttemptReason => (LOGIN_ATTEMPT_REASONS as readonly unknown[]).includes(value)

/** Falhas que NUNCA chegaram ao AD: não somam no contador da conta de rede e saem da trava quando o acesso é habilitado. */
export const UNREACHED_DIRECTORY_REASONS: readonly LoginAttemptReason[] = ["NO_ACCOUNT"]
