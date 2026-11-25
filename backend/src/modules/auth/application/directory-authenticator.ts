import type { DirectoryVerdict, IdentityCheck } from "../domain/network-login.js"

export type { IdentityCheck } from "../domain/network-login.js"

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
  /**
   * Com `identity`, depois da senha certa lê a ID funcional da PRÓPRIA conta, na mesma conexão e com a permissão dela (nenhuma credencial de
   * serviço); quem decide é `identityVerdict` (domain/network-login.ts).
   */
  verify(networkLogin: string, password: string, identity?: IdentityCheck): Promise<DirectoryVerdict>
  /** Login sem o último dígito desta matrícula, quando o formato dela é um dos da instalação; ausente/null = não se aplica. */
  shortLoginOf?(networkLogin: string): string | null
  /** Matrículas inteiras que, sem o último dígito, dariam este login; ausente/vazio = não se aplica. */
  fullLoginsBehind?(networkLogin: string): string[]
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
