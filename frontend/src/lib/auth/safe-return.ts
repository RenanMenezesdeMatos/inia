/**
 * Retorno SEGURO depois do login (`/auth/login?voltar=…`): só um caminho interno desta INIA — começa com uma barra, nunca `//`
 * nem `\` (outro site), nunca as telas de autenticação (evita laço login → login) e sem esquema. Qualquer outra coisa é ignorada e
 * a pessoa vai para a tela inicial dela.
 */
export function safeReturnPath(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) return null
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null
  if (/[\u0000-\u001f]/.test(value)) return null
  let parsed: URL
  try {
    parsed = new URL(value, "http://inia.local")
  } catch {
    return null
  }
  if (parsed.origin !== "http://inia.local") return null
  if (parsed.pathname === "/" || parsed.pathname.startsWith("/auth")) return null
  return `${parsed.pathname}${parsed.search}`
}

export function loginWithReturn(currentPath: string): string {
  const back = safeReturnPath(currentPath)
  return back ? `/auth/login?voltar=${encodeURIComponent(back)}` : "/auth/login"
}
