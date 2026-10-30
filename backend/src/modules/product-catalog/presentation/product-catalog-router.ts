import { Router } from "express"
import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import {
  approveIdentificationCriterion,
  archiveIdentificationCriterion,
  createIdentificationCriterion,
  createProductNode,
  deleteIdentificationCriterion,
  deleteProductNode,
  discardIdentificationDraft,
  getIdentificationCriterion,
  listIdentificationCriteria,
  listProductNodes,
  listProductScopeSources,
  productScopeHistory,
  reactivateIdentificationCriterion,
  setProductNodeActive,
  setProductScope,
  SOURCE_KINDS,
  updateIdentificationCriterion,
  updateProductNode,
  type ProductCatalogActor,
} from "../application/product-catalog-service.js"
import { sessionUser } from "../../auth/presentation/session-user.js"

/**
 * Cadastro de produtos — `/api/v1/admin/product-catalog` (montado em app.ts com `configuration.manage`; escrita só com escopo da
 * organização inteira, como os demais catálogos da organização). Toda regra vive no serviço; aqui só HTTP.
 */
const actorOf = (request: { user?: { organizationId: string; personId?: string | null } }): ProductCatalogActor => ({ organizationId: sessionUser(request).organizationId, personId: request.user?.personId ?? null })
const sourceKind = z.enum(SOURCE_KINDS)

export function createProductCatalogRouter(db: Database) {
  const router = Router()

  router.get("/nodes", async (request, response) => {
    response.json({ data: await listProductNodes(db, sessionUser(request).organizationId) })
  })
  router.post("/nodes", async (request, response) => {
    response.status(201).json({ data: await createProductNode(db, actorOf(request), request.body) })
  })
  router.patch("/nodes/:id", async (request, response) => {
    response.json({ data: await updateProductNode(db, actorOf(request), request.params.id!, request.body) })
  })
  router.post("/nodes/:id/activate", async (request, response) => {
    response.json({ data: await setProductNodeActive(db, actorOf(request), request.params.id!, true) })
  })
  router.post("/nodes/:id/deactivate", async (request, response) => {
    response.json({ data: await setProductNodeActive(db, actorOf(request), request.params.id!, false) })
  })
  router.delete("/nodes/:id", async (request, response) => {
    await deleteProductNode(db, actorOf(request), request.params.id!)
    response.status(204).end()
  })

  router.get("/criteria", async (request, response) => {
    response.json({ data: await listIdentificationCriteria(db, sessionUser(request).organizationId) })
  })
  router.get("/criteria/:id", async (request, response) => {
    response.json({ data: await getIdentificationCriterion(db, sessionUser(request).organizationId, request.params.id!) })
  })
  router.post("/criteria", async (request, response) => {
    response.status(201).json({ data: await createIdentificationCriterion(db, actorOf(request), request.body) })
  })
  router.patch("/criteria/:id", async (request, response) => {
    response.json({ data: await updateIdentificationCriterion(db, actorOf(request), request.params.id!, request.body) })
  })
  router.delete("/criteria/:id/draft", async (request, response) => {
    response.json({ data: await discardIdentificationDraft(db, actorOf(request), request.params.id!) })
  })
  router.post("/criteria/:id/approve", async (request, response) => {
    response.json({ data: await approveIdentificationCriterion(db, actorOf(request), request.params.id!, request.body) })
  })
  router.post("/criteria/:id/archive", async (request, response) => {
    response.json({ data: await archiveIdentificationCriterion(db, actorOf(request), request.params.id!) })
  })
  router.post("/criteria/:id/reactivate", async (request, response) => {
    response.json({ data: await reactivateIdentificationCriterion(db, actorOf(request), request.params.id!) })
  })
  router.delete("/criteria/:id", async (request, response) => {
    await deleteIdentificationCriterion(db, actorOf(request), request.params.id!)
    response.status(204).end()
  })

  router.get("/sources", async (request, response) => {
    response.json({ data: await listProductScopeSources(db, sessionUser(request).organizationId) })
  })
  router.get("/sources/:kind/:id/scope", async (request, response) => {
    response.json({ data: await productScopeHistory(db, sessionUser(request).organizationId, sourceKind.parse(request.params.kind), request.params.id!) })
  })
  router.put("/sources/:kind/:id/scope", async (request, response) => {
    response.json({ data: await setProductScope(db, actorOf(request), sourceKind.parse(request.params.kind), request.params.id!, request.body) })
  })

  return router
}
