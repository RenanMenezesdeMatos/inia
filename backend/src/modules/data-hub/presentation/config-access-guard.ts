import type { Request, RequestHandler, Response, NextFunction, Router } from "express"
import { sessionUser } from "../../auth/presentation/session-user.js"
import { assertConfigUnlocked, type ConfigSession } from "../application/config-unlock-service.js"
import type { DataHubContext } from "../application/data-hub-context.js"
import { requireSource } from "../application/records.js"

/**
 * GUARDA DAS ROTAS DE CONFIGURAÇÃO. Toda rota da Central é classificada: ou leva esta guarda, ou está em `DATA_HUB_FREE_ROUTES`. Uma
 * rota sem classificação responde 403 para todo mundo (`sealUnclassifiedRoutes`), então uma rota nova nasce bloqueada.
 */
export const sessionOf = (request: Request): ConfigSession => {
  const user = sessionUser(request)
  return { personId: user.personId ?? null, sessionId: user.jti ?? null }
}

/** Rotas sem liberação: leitura da própria INIA, teste, exclusão, operação de carga, arquivo, tokens e a própria liberação. */
export const DATA_HUB_FREE_ROUTES: readonly string[] = [
  "POST /database/test",
  // Só calcula as próximas execuções de uma periodicidade: não usa a fonte (branch da periodicidade personalizada).
  "POST /cadence/preview",
  "GET /overview",
  "GET /quality",
  "GET /contracts",
  "GET /contracts/:key",
  "GET /lineage",
  "GET /audit-events",
  "GET /sources",
  "POST /sources",
  "GET /sources/:id",
  "DELETE /sources/:id",
  "POST /sources/:id/test-connection",
  "POST /sources/:id/unlock-configuration",
  // Troca de credencial: conferida pelo teste real da credencial nova, com limite de tentativas (`verifyNewCredential`).
  "POST /sources/:id/secrets",
  "GET /sources/:id/openapi.json",
  "GET /sources/:id/tokens",
  "POST /sources/:id/tokens",
  "POST /sources/:id/tokens/:tokenId/revoke",
  "POST /sources/:id/tokens/:tokenId/rotate",
  "POST /uploads",
  "GET /sources/:id/feeds",
  "GET /feeds/:id",
  "DELETE /feeds/:id",
  "POST /feeds/:id/sync",
  "POST /feeds/:id/import",
  "GET /runs",
  "GET /runs/:id",
  "GET /runs/:id/rejections",
  "GET /runs/:id/rejections.csv",
  "POST /runs/:id/reprocess",
  "POST /runs/:id/cancel",
]

const GUARDED = Symbol("data-hub.config-guard")
type MarkedHandler = RequestHandler & { [GUARDED]?: true }

/** `unless`: a mesma rota faz uma ação livre e outra protegida (pausar × ativar). Qualquer valor diferente do esperado é protegido. */
export function configGuard(ctx: DataHubContext, sourceIdOf: (request: Request) => string | Promise<string>, options: { unless?: (request: Request) => boolean } = {}): RequestHandler {
  const guard: MarkedHandler = async (request: Request, _response: Response, next: NextFunction) => {
    if (options.unless?.(request)) return next()
    const organizationId = sessionUser(request).organizationId
    const source = await requireSource(ctx.db, organizationId, await sourceIdOf(request))
    await assertConfigUnlocked(ctx, source, sessionOf(request), `${request.method} ${String(request.route?.path ?? "")}`)
    return next()
  }
  guard[GUARDED] = true
  return guard
}

type RouteLayer = { route?: { path: unknown; methods: Record<string, boolean>; stack: { handle: RequestHandler }[] } }

const routeLayers = (router: Router): NonNullable<RouteLayer["route"]>[] => (router.stack as unknown as RouteLayer[]).flatMap((layer) => (layer.route ? [layer.route] : []))
const routeKeys = (route: NonNullable<RouteLayer["route"]>): string[] => Object.keys(route.methods).filter((method) => route.methods[method]).map((method) => `${method.toUpperCase()} ${String(route.path)}`)
const isGuarded = (route: NonNullable<RouteLayer["route"]>) => route.stack.some((layer) => (layer.handle as MarkedHandler)[GUARDED] === true)

export function classifiedRoutes(router: Router, freeRoutes: readonly string[] = DATA_HUB_FREE_ROUTES): { key: string; classification: "FREE" | "PROTECTED" | "UNCLASSIFIED" | "BOTH" }[] {
  return routeLayers(router).flatMap((route) =>
    routeKeys(route).map((key) => {
      const free = freeRoutes.includes(key)
      const guarded = isGuarded(route)
      return { key, classification: free && guarded ? ("BOTH" as const) : free ? ("FREE" as const) : guarded ? ("PROTECTED" as const) : ("UNCLASSIFIED" as const) }
    }),
  )
}

const lockedUnclassified: RequestHandler = (_request, response) => {
  response.status(403).json({ error: { code: "DATA_SOURCE_CONFIG_LOCKED", message: "Esta rota da Central de Dados ainda não foi classificada: fica bloqueada até decidir se exige a senha da fonte." } })
}

/** Rota sem classificação não executa: todos os passos dela viram o bloqueio. A prova `router.stack` falha nesse caso. */
export function sealUnclassifiedRoutes(router: Router, freeRoutes: readonly string[] = DATA_HUB_FREE_ROUTES): void {
  for (const route of routeLayers(router)) {
    if (isGuarded(route) || routeKeys(route).every((key) => freeRoutes.includes(key))) continue
    for (const layer of route.stack) layer.handle = lockedUnclassified
  }
}
