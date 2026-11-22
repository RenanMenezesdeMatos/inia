import type { DirectoryVerdict } from "../domain/network-login.js"

/** Situação de um servidor do AD na conferência da tela de Acessos (só conexão TLS, nunca senha). */
export type DirectoryServerProbe = { url: string; reachable: boolean; trusted: boolean; keyBits: number | null; validUntil: string | null; error: string | null }

/**
 * PORTA do AD: confere a senha de rede de uma matrícula JÁ normalizada. A implementação real é LDAPS
 * (infrastructure/ldap-directory-authenticator.ts); os testes usam uma falsa. Nunca registra a senha.
 */
export interface DirectoryAuthenticator {
  /** Há servidores configurados na instalação (AD_LDAP_URLS + AD_DOMAIN). */
  readonly configured: boolean
  /** Domínio do login (para a tela); null sem configuração. */
  readonly domain: string | null
  verify(networkLogin: string, password: string): Promise<DirectoryVerdict>
  probe(): Promise<DirectoryServerProbe[]>
}

export const unconfiguredDirectory: DirectoryAuthenticator = {
  configured: false,
  domain: null,
  async verify() {
    return { kind: "UNAVAILABLE", reason: "NOT_CONFIGURED" }
  },
  async probe() {
    return []
  },
}
