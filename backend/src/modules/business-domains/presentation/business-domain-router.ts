import { Router } from "express"
import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { booleanParam, respondList, searchParam, SqlFilter } from "../../../shared/presentation/list-query.js"
import { getManageableScopes } from "../../auth/application/manageable-scopes.js"
import {
  BUSINESS_DOMAIN_LIST_SELECT,
  createBusinessDomain,
  deleteBusinessDomain,
  findBusinessDomain,
  loadVisibleBusinessDomainDependencies,
  setBusinessDomainActive,
  updateBusinessDomain,
  type BusinessDomainActor,
} from "../application/business-domain-service.js"

/**
 * Catálogo de Domínios de negócio — `/api/v1/admin/business-domains` (só ADMIN, montado em app.ts).
 * Toda regra vive no service (business-domain-service.ts); aqui só HTTP. A lista devolve os
 * contadores de Agents/Orchestrators já calculados (uma subquery por tabela — nunca N+1).
 *
 * Seletores novos (Agent/Orquestrador) chamam a lista SEM parâmetros e recebem só os ATIVOS;
 * a tela de catálogo passa `includeInactive=true` (ou `active=false`) para auditar/reativar.
 */

const NOT_FOUND = { error: { code: "BUSINESS_DOMAIN_NOT_FOUND", message: "Domínio de negócio não encontrado." } }

const listSchema = z.object({
  search: searchParam,
  active: booleanParam,
  includeInactive: booleanParam,
})

function actorOf(request: { user?: { organizationId: string; personId?: string | null } }): BusinessDomainActor {
  return { organizationId: request.user!.organizationId, actorId: request.user?.personId ?? null }
}

export function createBusinessDomainRouter(db: Database) {
  const router = Router()

  router.get("/", async (request, response) => {
    const organizationId = request.user!.organizationId
    const input = listSchema.parse(request.query)
    const filter = new SqlFilter([organizationId]).search(input.search, ["q.name", "q.code"])
    if (input.active !== undefined) filter.equals("q.active", input.active)
    else if (!input.includeInactive) filter.equals("q.active", true)
    const data = await respondList(db, request.query, { select: BUSINESS_DOMAIN_LIST_SELECT, filter, orderBy: "q.name, q.code" })
    response.json({ data })
  })

  router.get("/:id", async (request, response) => {
    const organizationId = request.user!.organizationId
    const domain = await findBusinessDomain(db, organizationId, request.params.id!)
    if (!domain) return response.status(404).json(NOT_FOUND)
    response.json({ data: domain })
  })

  router.get("/:id/dependencies", async (request, response) => {
    const organizationId = request.user!.organizationId
    const domain = await findBusinessDomain(db, organizationId, request.params.id!)
    if (!domain) return response.status(404).json(NOT_FOUND)
    const scopes = await getManageableScopes(db, request.user!, "agents.manage")
    response.json({ data: await loadVisibleBusinessDomainDependencies(db, organizationId, domain, scopes) })
  })

  router.post("/", async (request, response) => {
    const created = await createBusinessDomain(db, actorOf(request), request.body)
    response.status(201).json({ data: created })
  })

  router.patch("/:id", async (request, response) => {
    const updated = await updateBusinessDomain(db, actorOf(request), request.params.id!, request.body)
    response.json({ data: updated })
  })

  router.post("/:id/activate", async (request, response) => {
    response.json({ data: await setBusinessDomainActive(db, actorOf(request), request.params.id!, true) })
  })

  router.post("/:id/deactivate", async (request, response) => {
    response.json({ data: await setBusinessDomainActive(db, actorOf(request), request.params.id!, false) })
  })

  router.delete("/:id", async (request, response) => {
    const deleted = await deleteBusinessDomain(db, actorOf(request), request.params.id!)
    if (!deleted) return response.status(404).json(NOT_FOUND)
    response.status(204).send()
  })

  return router
}
