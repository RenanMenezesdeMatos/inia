import { Router, type Request } from "express"
import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { requirePermission } from "../../access/presentation/require-permission.js"
import { createRequireAuth } from "../../auth/presentation/require-auth.js"
import { sessionUser } from "../../auth/presentation/session-user.js"
import { operatingUniverseSchema } from "../domain/operating-universe.js"
import { classifyPeople, classifyResource, listResources, loadReadiness, setEnforcement } from "../application/universe-administration.js"
import { UNIVERSE_RESOURCE_KINDS } from "../application/resource-universe.js"

/**
 * `/api/v1/admin/operating-universe` — prontidão, classificação do legado e ativação do universo de atuação. Cada rota confere a SUA
 * permissão no servidor: prontidão e ativação = `configuration.manage` na organização inteira; classificar um recurso = a permissão de
 * quem administra aquele tipo (no escopo dele); pessoas em lote = `people.manage` no escopo.
 */
const kindSchema = z.enum(UNIVERSE_RESOURCE_KINDS)
const listSchema = z.object({ status: z.enum(["PENDING", "CLASSIFIED", "ALL"]).default("ALL"), search: z.string().trim().max(120).optional() })
const classifySchema = z.object({ operatingUniverse: operatingUniverseSchema.nullable() }).strict()
/** Pessoas por id, ou todas as PENDENTES ativas de um Grupo (`teamId: null` = sem Grupo) — sempre dentro do escopo de quem pede. */
const peopleSchema = z.union([
  z.object({ personIds: z.array(z.string().uuid()).min(1).max(1000), operatingUniverse: operatingUniverseSchema }).strict(),
  z.object({ pendingInTeamId: z.string().uuid().nullable(), operatingUniverse: operatingUniverseSchema }).strict(),
])
const enforcementSchema = z.object({ enforce: z.boolean(), acknowledgedPending: z.number().int().min(0).optional() }).strict()

export function createOperatingUniverseRouter(db: Database) {
  const router = Router()
  const organizationConfig = requirePermission(db, "configuration.manage", { organizationWide: true })
  const authenticated = createRequireAuth(db)
  const actorOf = (request: Request) => ({ organizationId: sessionUser(request).organizationId, sub: sessionUser(request).sub, personId: sessionUser(request).personId })

  router.get("/readiness", ...organizationConfig, async (request, response) => {
    response.json({ data: await loadReadiness(db, sessionUser(request).organizationId) })
  })
  router.put("/enforcement", ...organizationConfig, async (request, response) => {
    response.json({ data: await setEnforcement(db, actorOf(request), enforcementSchema.parse(request.body)) })
  })
  router.get("/resources/:kind", authenticated, async (request, response) => {
    const filter = listSchema.parse(request.query)
    response.json({ data: await listResources(db, actorOf(request), kindSchema.parse(request.params.kind), { status: filter.status, ...(filter.search ? { search: filter.search } : {}) }) })
  })
  router.put("/resources/:kind/:id", authenticated, async (request, response) => {
    const { operatingUniverse } = classifySchema.parse(request.body)
    response.json({ data: await classifyResource(db, actorOf(request), kindSchema.parse(request.params.kind), z.string().uuid().parse(request.params.id), operatingUniverse) })
  })
  router.post("/people/classify", authenticated, async (request, response) => {
    const input = peopleSchema.parse(request.body)
    const organizationId = sessionUser(request).organizationId
    const personIds = "personIds" in input
      ? input.personIds
      : (await db.query<{ id: string }>(`select id from people where organization_id = $1 and active and operating_universe is null and team_id is not distinct from $2::uuid`, [organizationId, input.pendingInTeamId])).rows.map((row) => row.id)
    response.json({ data: await classifyPeople(db, actorOf(request), personIds, input.operatingUniverse) })
  })
  return router
}
