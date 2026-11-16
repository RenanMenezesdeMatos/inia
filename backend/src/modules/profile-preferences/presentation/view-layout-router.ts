import { Router } from "express"
import type { Database } from "../../../infrastructure/database/pool.js"
import type { VerifiedAuthToken } from "../../auth/infrastructure/jwt.js"
import { sessionUser } from "../../auth/presentation/session-user.js"
import { loadViewLayout, resetViewLayout, saveViewLayout } from "../application/view-layout-service.js"
import { viewLayoutKeySchema, viewLayoutSchema } from "../domain/view-layout.js"

/**
 * `/api/v1/me/view-layouts/:viewKey` — a disposição personalizada da PRÓPRIA pessoa da sessão numa tela (migration 192): ler, salvar
 * ("Concluir") e restaurar o padrão. Não há parâmetro de pessoa; visão desconhecida ou forma inválida = 400.
 */
export function createMyViewLayoutRouter(db: Database) {
  const router = Router()
  const me = (request: { user?: VerifiedAuthToken | undefined }) => {
    const user = sessionUser(request)
    return { organizationId: user.organizationId, personId: user.personId }
  }
  router.get("/:viewKey", async (request, response) => {
    response.json({ data: await loadViewLayout(db, me(request), viewLayoutKeySchema.parse(request.params.viewKey)) })
  })
  router.put("/:viewKey", async (request, response) => {
    response.json({ data: await saveViewLayout(db, me(request), viewLayoutKeySchema.parse(request.params.viewKey), viewLayoutSchema.parse(request.body)) })
  })
  router.delete("/:viewKey", async (request, response) => {
    await resetViewLayout(db, me(request), viewLayoutKeySchema.parse(request.params.viewKey))
    response.status(204).end()
  })
  return router
}
