import { Router, type Request } from "express"
import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { searchParam, unitFilterShape } from "../../../shared/presentation/list-query.js"
import { getManageableScopes } from "../../auth/application/manageable-scopes.js"
import { sessionUser } from "../../auth/presentation/session-user.js"
import { OPERATING_UNIVERSES } from "../../operating-universe/domain/operating-universe.js"
import {
  groupDefaultKnowledgeIds,
  KNOWLEDGE_OPTION_IDS_CAP,
  KNOWLEDGE_OPTIONS_MAX_LIMIT,
  knowledgeOptionFacets,
  knowledgeOptionIds,
  listKnowledgeOptions,
  lookupKnowledgeOptions,
  type KnowledgeOptionsFilter,
} from "../application/agent-knowledge-options.js"
import { decodeKnowledgeOptionsCursor, encodeKnowledgeOptionsCursor } from "../domain/knowledge-options-cursor.js"

/**
 * Seletor de bases do formulário do Agent, montado em `/api/v1/admin/agents/knowledge-options` com `agents.manage` (quem cria o agente
 * escolhe as bases sem precisar de `knowledge.manage`). Leituras por POST porque levam listas de ids (as escolhidas, que a lista de
 * disponíveis exclui) — nada é gravado aqui; o vínculo continua sendo validado no salvar do agente.
 */

const uuid = z.string().uuid()
const agentScopeSchema = z.discriminatedUnion("scopeType", [
  z.object({ scopeType: z.literal("ALL_TEAMS") }),
  // Vários vínculos (249): Grupo inteiro ou um Subgrupo (o Grupo-pai é achado no servidor quando não vem).
  z.object({ scopeType: z.literal("GROUPS"), links: z.array(z.object({ teamId: uuid.nullish(), subteamId: uuid.nullish() }).refine((link) => Boolean(link.teamId || link.subteamId), "Informe o Grupo ou o Subgrupo.")).max(300) }),
  z.object({ scopeType: z.literal("TEAM"), teamId: uuid }),
  z.object({ scopeType: z.literal("SUBTEAM"), subteamId: uuid, teamId: uuid.optional() }),
])
const agentUniverseSchema = z.enum(OPERATING_UNIVERSES).optional()

const filterSchema = z.object({
  search: searchParam,
  agentUniverse: agentUniverseSchema,
  universe: z.enum([...OPERATING_UNIVERSES, "PENDING"]).optional(),
  agentScope: agentScopeSchema.optional(),
  scopeType: z.enum(["ALL_TEAMS"]).optional(),
  ...unitFilterShape,
  productId: uuid.optional(),
  subjectScopeType: z.enum(["ALL_SUBJECTS"]).optional(),
  subjectId: uuid.optional(),
  state: z.enum(["IN_USE", "ARCHIVED", "NO_VERSION"]).optional(),
  excludeIds: z.array(uuid).max(KNOWLEDGE_OPTION_IDS_CAP).optional(),
})
const searchSchema = filterSchema.extend({
  cursor: z.string().max(2000).optional(),
  limit: z.coerce.number().int().min(1).max(KNOWLEDGE_OPTIONS_MAX_LIMIT).default(50),
})
const lookupSchema = z.object({ ids: z.array(uuid).max(KNOWLEDGE_OPTION_IDS_CAP) })
const groupDefaultsSchema = z.object({ agentScope: agentScopeSchema, agentUniverse: agentUniverseSchema })

const filterOf = (input: z.infer<typeof filterSchema>): KnowledgeOptionsFilter => input

export function createAgentKnowledgeOptionsRouter(db: Database) {
  const router = Router()
  const scopesOf = (request: Request) => getManageableScopes(db, sessionUser(request), "agents.manage")

  router.post("/search", async (request, response) => {
    const { cursor: rawCursor, limit, ...filter } = searchSchema.parse(request.body ?? {})
    const cursor = rawCursor ? decodeKnowledgeOptionsCursor(rawCursor) : null
    if (rawCursor && !cursor) throw new DomainError("Posição da lista inválida: recarregue a lista de bases.", "KNOWLEDGE_OPTIONS_CURSOR_INVALID", 400)
    const page = await listKnowledgeOptions(db, sessionUser(request).organizationId, await scopesOf(request), filterOf(filter), { cursor, limit })
    response.json({ data: { items: page.items, nextCursor: page.nextCursor ? encodeKnowledgeOptionsCursor(page.nextCursor) : null, total: page.total } })
  })

  router.post("/ids", async (request, response) => {
    const filter = filterSchema.parse(request.body ?? {})
    response.json({ data: await knowledgeOptionIds(db, sessionUser(request).organizationId, await scopesOf(request), filterOf(filter)) })
  })

  router.post("/group-defaults", async (request, response) => {
    const { agentScope, agentUniverse } = groupDefaultsSchema.parse(request.body ?? {})
    response.json({ data: await groupDefaultKnowledgeIds(db, sessionUser(request).organizationId, await scopesOf(request), agentScope, agentUniverse) })
  })

  router.post("/lookup", async (request, response) => {
    const { ids } = lookupSchema.parse(request.body ?? {})
    response.json({ data: await lookupKnowledgeOptions(db, sessionUser(request).organizationId, await scopesOf(request), [...new Set(ids)]) })
  })

  router.get("/facets", async (request, response) => {
    const agentUniverse = agentUniverseSchema.parse(typeof request.query.agentUniverse === "string" && request.query.agentUniverse ? request.query.agentUniverse : undefined)
    response.json({ data: await knowledgeOptionFacets(db, sessionUser(request).organizationId, await scopesOf(request), agentUniverse) })
  })

  return router
}
