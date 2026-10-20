import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

import { readSessionCookie } from "@/lib/auth/session-cookie"
import { passwordChangePendingIn } from "@/lib/auth/session-hint"
import { buildContentSecurityPolicy, createCspNonce, CSP_NONCE_HEADER, originOf } from "@/lib/security/content-security-policy"

const CREATE_PASSWORD_ROUTE = "/auth/create-password"
// Áreas que exigem sessão. As demais páginas (login, wiki, raiz) passam pelo proxy só para receber a CSP.
const AUTHENTICATED_PREFIXES = ["/admin", "/operator", "/supervisor", "/diagnostics", "/perfil", "/qa-lab", "/materiais"]
const IS_DEVELOPMENT = process.env.NODE_ENV !== "production"
const API_ORIGIN = originOf(process.env.NEXT_PUBLIC_INIA_API_URL ?? "http://localhost:3333")

function requiresSession(pathname: string): boolean {
  return AUTHENTICATED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  if (requiresSession(pathname)) {
    const token = readSessionCookie(request.cookies)?.value
    if (!token) return NextResponse.redirect(new URL("/auth/login", request.url))
    // Primeiro acesso: enquanto a pessoa não criar a própria senha, nenhuma página da plataforma abre.
    if (passwordChangePendingIn(token)) return NextResponse.redirect(new URL(CREATE_PASSWORD_ROUTE, request.url))
  }
  // CSP com nonce novo a cada requisição: no cabeçalho da requisição o Next encontra o nonce e o aplica aos próprios scripts;
  // `x-nonce` leva o mesmo valor ao RootLayout (script de tema). Ver lib/security/content-security-policy.ts.
  const nonce = createCspNonce()
  const contentSecurityPolicy = buildContentSecurityPolicy({ nonce, isDevelopment: IS_DEVELOPMENT, apiOrigin: API_ORIGIN })
  const headers = new Headers(request.headers)
  headers.set(CSP_NONCE_HEADER, nonce)
  headers.set("Content-Security-Policy", contentSecurityPolicy)
  // O layout da Administração lê o caminho para restringir quem só tem acesso a "Conversas com a INIA" (layouts não recebem pathname).
  headers.set("x-inia-pathname", pathname)
  const response = NextResponse.next({ request: { headers } })
  response.headers.set("Content-Security-Policy", contentSecurityPolicy)
  return response
}

export const config = {
  // Todas as páginas (inclusive prefetch, que continua passando pela guarda de sessão); arquivos do build e otimização de imagem
  // não são documento e ficam de fora.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
}
