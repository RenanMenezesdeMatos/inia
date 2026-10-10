import type { NextFunction, Request, Response } from "express"

/**
 * PROTEÇÃO CONTRA CSRF das escritas autenticadas por COOKIE. O cookie de sessão é SameSite=Lax — o navegador já não o manda
 * em POST vindo de outro SITE —, mas "mesmo site" inclui qualquer subdomínio irmão (outro sistema em *.empresa.local) e
 * navegadores antigos. Por isso toda escrita (POST/PUT/PATCH/DELETE) que chega COM o cookie precisa vir de uma origem
 * autorizada (CORS_ORIGIN), conferida pelos cabeçalhos que o próprio navegador preenche e o JavaScript não consegue forjar:
 *
 *  - `Origin` presente → precisa estar na lista (navegadores modernos o mandam em toda escrita, inclusive fetch same-origin);
 *  - sem `Origin`, `Sec-Fetch-Site` presente → só `same-origin` / `none` (digitado na barra) passam;
 *  - sem nenhum dos dois → cliente fora do navegador (scripts, testes, chamadas servidor→servidor do Next): passa — ele não
 *    carrega o cookie de ninguém sem ter a credencial.
 *
 * Requests sem o cookie de sessão (login, API Push com token próprio) não são afetados: não há sessão a ser abusada.
 */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

export function createOriginGuard(options: { allowedOrigins: readonly string[]; sessionCookieName: string }) {
  const allowed = new Set(options.allowedOrigins.map((origin) => origin.toLowerCase()))
  return function originGuard(request: Request, response: Response, next: NextFunction) {
    if (SAFE_METHODS.has(request.method)) return next()
    if (!request.cookies?.[options.sessionCookieName]) return next()
    const origin = request.get("origin")
    if (origin !== undefined) {
      if (allowed.has(origin.trim().toLowerCase())) return next()
      return reject(response)
    }
    const fetchSite = request.get("sec-fetch-site")
    if (fetchSite !== undefined && fetchSite !== "same-origin" && fetchSite !== "none") return reject(response)
    return next()
  }
}

function reject(response: Response) {
  return response.status(403).json({ error: { code: "CROSS_SITE_REQUEST_BLOCKED", message: "Requisição bloqueada: origem não autorizada." } })
}
