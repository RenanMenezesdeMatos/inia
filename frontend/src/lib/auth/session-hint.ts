/**
 * A sessão carrega a DICA `pc` (troca de senha pendente no login). Aqui ela só serve para redirecionar antes de renderizar
 * qualquer página — quem bloqueia de verdade é o backend, que confere a conta no banco a cada request (o token não é
 * verificado aqui; um token adulterado só mudaria para onde a pessoa é levada, nunca o que ela consegue acessar).
 */
export function passwordChangePendingIn(token: string): boolean {
  const segment = token.split(".")[1]
  if (!segment) return false
  try {
    const base64 = segment.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(segment.length / 4) * 4, "=")
    const json = new TextDecoder().decode(Uint8Array.from(atob(base64), (character) => character.charCodeAt(0)))
    return (JSON.parse(json) as { pc?: unknown }).pc === true
  } catch {
    return false
  }
}
