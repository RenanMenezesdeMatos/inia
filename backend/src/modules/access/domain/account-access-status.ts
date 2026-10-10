/**
 * SITUAÇÃO DO ACESSO de uma pessoa identificada pela plataforma — derivada, nunca gravada:
 *  - DISABLED: a pessoa não tem conta de login, ou a conta está desabilitada;
 *  - PENDING_PASSWORD_CHANGE: acesso habilitado com senha temporária — falta a pessoa criar a própria senha (a temporária pode
 *    já ter vencido: aí ela não entra mais e o administrador gera outra);
 *  - ACTIVE: conta habilitada com senha definida pela própria pessoa (ou acesso anterior a este fluxo, preservado).
 */
export const ACCOUNT_ACCESS_STATUSES = ["DISABLED", "PENDING_PASSWORD_CHANGE", "ACTIVE"] as const
export type AccountAccessStatus = (typeof ACCOUNT_ACCESS_STATUSES)[number]

export function accountAccessStatusOf(account: { active: boolean; passwordChangeRequired: boolean } | null): AccountAccessStatus {
  if (!account || !account.active) return "DISABLED"
  return account.passwordChangeRequired ? "PENDING_PASSWORD_CHANGE" : "ACTIVE"
}

export function temporaryPasswordExpired(account: { active: boolean; passwordChangeRequired: boolean; temporaryPasswordExpiresAt: Date | null } | null, now: Date): boolean {
  if (accountAccessStatusOf(account) !== "PENDING_PASSWORD_CHANGE") return false
  return !account!.temporaryPasswordExpiresAt || account!.temporaryPasswordExpiresAt.getTime() <= now.getTime()
}
