import { Router, type Request } from "express"
import type { Database } from "../../../infrastructure/database/pool.js"
import type { Viewer } from "../application/request-service.js"
import { getSettings, listAnjos, listScopes, updateAnjoCapacity, updateScopeState, updateSettings } from "../application/settings-service.js"
import { anjosQuerySchema, capacitySchema, idParamSchema, scopeParamsSchema, scopeStateSchema, settingsSchema } from "./schemas.js"

/**
 * CONFIGURAÇÃO (`/api/v1/admin/human-support`, montada com `human_support.manage` na organização inteira — só o Administrador
 * geral): chave geral e capacidade padrão, estado dos Grupos/Subgrupos e capacidade de cada Anjo. Conceder os papéis usa as rotas de
 * acesso que já existem.
 */
const viewerOf = (request: Request): Viewer => ({ organizationId: request.user!.organizationId, personId: request.user!.personId })

export function createHumanSupportAdminRouter(db: Database) {
  const router = Router()
  router.get("/settings", async (request, response) => {
    response.json({ data: await getSettings(db, viewerOf(request).organizationId) })
  })
  router.put("/settings", async (request, response) => {
    response.json({ data: await updateSettings(db, viewerOf(request), settingsSchema.parse(request.body)) })
  })
  router.get("/scopes", async (request, response) => {
    response.json({ data: { items: await listScopes(db, viewerOf(request).organizationId) } })
  })
  router.put("/scopes/:scopeType/:id", async (request, response) => {
    const params = scopeParamsSchema.parse(request.params)
    const node = await updateScopeState(db, viewerOf(request), { scopeType: params.scopeType === "group" ? "GROUP" : "SUBGROUP", id: params.id, state: scopeStateSchema.parse(request.body).state })
    response.json({ data: { node } })
  })
  router.get("/anjos", async (request, response) => {
    response.json({ data: { items: await listAnjos(db, viewerOf(request).organizationId, anjosQuerySchema.parse(request.query)) } })
  })
  router.put("/anjos/:personId/capacity", async (request, response) => {
    response.json({ data: { row: await updateAnjoCapacity(db, viewerOf(request), idParamSchema.parse(request.params.personId), capacitySchema.parse(request.body).maxConcurrent) } })
  })
  return router
}
