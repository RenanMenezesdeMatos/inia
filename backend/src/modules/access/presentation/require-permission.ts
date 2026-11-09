import type { NextFunction, Request, Response } from "express"
import type { Database } from "../../../infrastructure/database/pool.js"
import { createRequireAuth } from "../../auth/presentation/require-auth.js"
import { sessionUser } from "../../auth/presentation/session-user.js"
import { canAnywhere, canOrganizationWide, type AccessContext } from "../domain/access-decision.js"
import type { Permission } from "../domain/permissions.js"
import { createPostgresAccessRepository } from "../infrastructure/postgres-access-repository.js"

declare module "express-serve-static-core" {
  interface Request {
    /** Contexto de acesso da conta da sessão (resolvido a cada request, nunca do JWT). */
    access?: AccessContext
  }
}

/**
 * GUARD ÚNICO de autorização por PERMISSÃO (V1.5.7): sessão + atribuições da conta lidas do banco a cada request (uma
 * concessão/revogação vale na hora, sem novo login). `organizationWide` = a permissão precisa estar num papel com escopo
 * de organização (recursos do tenant: QA Lab, configuração de IA). Deny by default; 403 no formato de sempre. O recurso
 * concreto (escopo de Grupo/Subgrupo) continua sendo checado dentro do módulo.
 */
export function requirePermission(db: Pick<Database, "query">, permission: Permission, options: { organizationWide?: boolean; onDenied?: (request: Request) => Promise<void> } = {}) {
  const repository = createPostgresAccessRepository(db)
  const requireAuth = createRequireAuth(db)
  const guard = async (request: Request, response: Response, next: NextFunction) => {
    try {
      const access = await repository.loadContext(sessionUser(request).organizationId, sessionUser(request).sub)
      const allowed = options.organizationWide ? canOrganizationWide(access, permission) : canAnywhere(access, permission)
      if (!allowed) {
        // Registro da tentativa: quem registra decide o que guardar, e uma falha ali nunca troca o 403 por outra resposta.
        await options.onDenied?.(request).catch((error: unknown) => console.error(JSON.stringify({ event: "permission_denied_audit_failed", permission, message: error instanceof Error ? error.message : String(error) })))
        return response.status(403).json({ error: { code: "FORBIDDEN", message: "Você não tem permissão para este recurso." } })
      }
      request.access = access
      return next()
    } catch (error) {
      return next(error)
    }
  }
  return [requireAuth, guard]
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

/**
 * Leitura com a permissão em qualquer escopo; ESCRITA só com a permissão na organização inteira — para catálogos que valem
 * para todos os Grupos (domínios de negócio, flags de canal, calendário operacional, governança, definições de indicador).
 * Um administrador de Grupo/Subgrupo consulta, mas não muda o que afeta os outros Grupos (achados A-F04 e U-F7). Montar
 * DEPOIS do `requirePermission` (usa o `request.access` que ele resolveu).
 */
export function writesRequireOrganization(permission: Permission) {
  return (request: Request, response: Response, next: NextFunction) => {
    if (SAFE_METHODS.has(request.method)) return next()
    if (request.access && canOrganizationWide(request.access, permission)) return next()
    return response.status(403).json({ error: { code: "ORGANIZATION_SCOPE_REQUIRED", message: "Esta configuração vale para a organização inteira: só quem a administra em toda a organização pode alterá-la." } })
  }
}
