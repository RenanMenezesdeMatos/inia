import { Router, type Request } from "express"
import type { Database } from "../../../infrastructure/database/pool.js"
import { coversOrganization, getManageableScopes } from "../../auth/application/manageable-scopes.js"
import {
  archiveArgumentScript,
  createArgumentScript,
  deleteArgumentScript,
  discardArgumentScriptDraft,
  getArgumentScript,
  listArgumentScripts,
  publishArgumentScript,
  reactivateArgumentScript,
  updateArgumentScript,
  type ArgumentScriptActor,
} from "../application/argument-script-service.js"

/**
 * /api/v1/admin/argument-scripts — Argumentários (montado com `configuration.manage`, a mesma permissão das antigas Regras de
 * chamada). A restrição de escopo é do SERVIÇO (backend), inclusive para "todos os grupos"; a tela só espelha `canEdit`.
 */
export function createArgumentScriptRouter(db: Database) {
  const router = Router()
  const session = (request: Request) => {
    const user = request.user!
    return { actor: { organizationId: user.organizationId, personId: user.personId ?? null } satisfies ArgumentScriptActor, user }
  }
  const scopesOf = (request: Request) => getManageableScopes(db, request.user!, "configuration.manage")

  /** O que o usuário pode escolher como escopo (a tela mostra "Todos os grupos" só para quem administra a organização). */
  router.get("/scope-options", async (request, response) => {
    const scopes = await scopesOf(request)
    response.json({ data: { allTeams: coversOrganization(scopes), teamIds: scopes.unrestricted ? [] : [...scopes.teamIds], subteamIds: scopes.unrestricted ? [] : [...scopes.subteamIds] } })
  })

  router.get("/", async (request, response) => {
    const { actor } = session(request)
    response.json({ data: await listArgumentScripts(db, actor.organizationId, await scopesOf(request), request.query as Record<string, unknown>) })
  })

  router.get("/:id", async (request, response) => {
    const { actor } = session(request)
    response.json({ data: await getArgumentScript(db, actor.organizationId, await scopesOf(request), request.params.id) })
  })

  router.post("/", async (request, response) => {
    const { actor } = session(request)
    response.status(201).json({ data: await createArgumentScript(db, actor, await scopesOf(request), request.body) })
  })

  router.patch("/:id", async (request, response) => {
    const { actor } = session(request)
    response.json({ data: await updateArgumentScript(db, actor, await scopesOf(request), request.params.id, request.body) })
  })

  router.delete("/:id/draft", async (request, response) => {
    const { actor } = session(request)
    response.json({ data: await discardArgumentScriptDraft(db, actor, await scopesOf(request), request.params.id) })
  })

  router.post("/:id/publish", async (request, response) => {
    const { actor } = session(request)
    response.json({ data: await publishArgumentScript(db, actor, await scopesOf(request), request.params.id, request.body) })
  })

  router.post("/:id/archive", async (request, response) => {
    const { actor } = session(request)
    response.json({ data: await archiveArgumentScript(db, actor, await scopesOf(request), request.params.id) })
  })

  router.post("/:id/reactivate", async (request, response) => {
    const { actor } = session(request)
    response.json({ data: await reactivateArgumentScript(db, actor, await scopesOf(request), request.params.id) })
  })

  router.delete("/:id", async (request, response) => {
    const { actor } = session(request)
    await deleteArgumentScript(db, actor, await scopesOf(request), request.params.id)
    response.status(204).send()
  })

  return router
}
