import { Router } from "express"
import { z } from "zod"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { requirePermission } from "../../access/presentation/require-permission.js"
import type { DirectoryAuthenticator } from "../application/directory-authenticator.js"
import { networkLoginStatus, probeNetworkLoginServers, setNetworkLogin, type NetworkLoginSettingsDeps } from "../application/network-login-settings.js"
import { directoryFromEnv, parseLdapUrls } from "../infrastructure/ldap-directory-authenticator.js"
import { createPostgresNetworkLoginRepository } from "../infrastructure/postgres-network-login-repository.js"
import { sessionUser } from "./session-user.js"

const switchSchema = z.object({ enabled: z.boolean() }).strict()

/**
 * LOGIN PELA REDE na tela de Acessos — `/api/v1/admin/network-login`. Só quem administra os acessos da organização INTEIRA
 * (`access.users.manage` com escopo de organização) vê e muda: o interruptor vale para todos. Regras em
 * application/network-login-settings.ts; SQL em infrastructure/postgres-network-login-repository.ts.
 *  - GET: situação (AD configurado na instalação, servidores, interruptor, contas de emergência, matrículas repetidas).
 *  - POST /probe: conecta por TLS a cada servidor (sem senha) e devolve se responde, se a cadeia confere e o tamanho da chave.
 *  - PUT: liga/desliga. Ligar exige o AD configurado, HTTPS em produção, ao menos UMA conta de emergência habilitada e nenhuma
 *    matrícula repetida. Auditado.
 */
export function createNetworkLoginAdminRouter(db: Database, options: { directory?: DirectoryAuthenticator; now?: () => Date; httpsRequired?: boolean; servers?: string[] } = {}) {
  const deps: NetworkLoginSettingsDeps = {
    repository: createPostgresNetworkLoginRepository(db),
    directory: options.directory ?? directoryFromEnv(),
    servers: options.servers ?? parseLdapUrls(env.AD_LDAP_URLS),
    weakKeyAllowed: env.AD_TLS_ALLOW_WEAK_KEY === "true",
    httpsRequired: options.httpsRequired ?? (env.NODE_ENV === "production" && !env.sessionCookieSecure),
    now: options.now ?? (() => new Date()),
  }
  const router = Router()
  router.use(requirePermission(db, "access.users.manage", { organizationWide: true }))

  router.get("/", async (request, response) => {
    response.set("Cache-Control", "no-store")
    response.json({ data: await networkLoginStatus(deps, sessionUser(request).organizationId) })
  })

  router.post("/probe", async (_request, response) => {
    response.set("Cache-Control", "no-store")
    response.json({ data: { servers: await probeNetworkLoginServers(deps) } })
  })

  router.put("/", async (request, response) => {
    response.set("Cache-Control", "no-store")
    const { enabled } = switchSchema.parse(request.body)
    const user = sessionUser(request)
    response.json({ data: await setNetworkLogin(deps, { organizationId: user.organizationId, enabled, actorPersonId: user.personId }) })
  })

  return router
}
