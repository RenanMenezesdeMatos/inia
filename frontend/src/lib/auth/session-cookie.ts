/**
 * Cookie de sessão. Quem escolhe o nome é o backend: `__Host-inia_session` quando o cookie é Secure (HTTPS — o prefixo impede
 * que um subdomínio ou uma página em HTTP plante ou sobrescreva a sessão) e `inia_session` em HTTP de rede interna. A interface
 * só lê o que existir e repassa ao backend com o MESMO nome nas chamadas feitas no servidor.
 */
export const SESSION_COOKIE_NAMES = ["__Host-inia_session", "inia_session"] as const

type CookieReader = { get(name: string): { value: string } | undefined }

export type SessionCookie = { value: string; header: string }

export function readSessionCookie(store: CookieReader): SessionCookie | null {
  for (const name of SESSION_COOKIE_NAMES) {
    const value = store.get(name)?.value
    if (value) return { value, header: `${name}=${value}` }
  }
  return null
}

/** Cabeçalho `cookie` para repassar a sessão ao backend (vazio sem sessão). */
export function sessionCookieHeader(session: SessionCookie | null): string {
  return session?.header ?? ""
}
