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

/**
 * QUEM GERENCIA A SENHA da conta — a mesma regra do login (`credentialModeOf` em auth/infrastructure/postgres-network-login-
 * repository.ts): com o login pela rede ligado na organização, a conta entra pela matrícula e pela senha de REDE, conferidas
 * no Active Directory (NETWORK), salvo a conta de emergência (`emergency_local_access`), que continua com senha da INIA
 * (LOCAL). Depende da CONTA, nunca de como a tela de login é mostrada: uma senha temporária para uma conta NETWORK não serve
 * para entrar (o login por e-mail recusa com `NETWORK_LOGIN_REQUIRED`) e daria a impressão de que a INIA trocou a senha de rede.
 */
export const CREDENTIAL_PROVIDERS = ["LOCAL", "NETWORK"] as const
export type CredentialProvider = (typeof CREDENTIAL_PROVIDERS)[number]

export function credentialProviderOf(input: { networkLoginEnabled: boolean; emergencyLocalAccess: boolean }): CredentialProvider {
  return input.networkLoginEnabled && !input.emergencyLocalAccess ? "NETWORK" : "LOCAL"
}
