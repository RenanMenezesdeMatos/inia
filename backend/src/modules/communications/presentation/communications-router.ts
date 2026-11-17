import { Router } from "express"
import { z } from "zod"
import { sessionUser } from "../../auth/presentation/session-user.js"
import { editCommunication, publishCommunication, readCommunication, retireCommunication, type CommunicationStore } from "../application/communication-service.js"
import { RECEIVED_COMMUNICATIONS_LIMIT } from "../domain/communication.js"

/**
 * Comunicados da liderança (migration 199). Organização, autor e público SEMPRE da sessão e do servidor:
 *   POST /          — publica (o público é calculado no servidor; conteúdo refeito e imagens sem metadados);
 *   GET  /received  — os comunicados que a pessoa da sessão recebeu (Acompanhamento do colaborador; os mais recentes), em lista
 *                     LEVE: trecho do texto e se há imagens, nunca o conteúdo (até 2 MB cada — achado U4-02);
 *   GET  /:id       — um comunicado inteiro, só se a pessoa da sessão o enxerga (a mesma regra do feed); senão 404;
 *   PATCH /:id      — o AUTOR edita título, conteúdo e categorias (versão anterior guardada; o público não muda);
 *   DELETE /:id     — o AUTOR retira (exclusão lógica). De outra pessoa ou já retirado = 404.
 * O que a conta pode publicar chega à tela pelas capacidades da sessão (`canPublishTeamCommunications`,
 * `canPublishOrganizationCommunications`, de `access-decision.ts`) — e é conferido de novo aqui, a cada publicação.
 * O que a liderança publicou e recebeu aparece no Acompanhamento da estrutura pelo `GET /analytics/follow-ups` (ramo NOTICE).
 */
export function createCommunicationsRouter(store: CommunicationStore) {
  const router = Router()

  router.post("/", async (request, response, next) => {
    try {
      response.status(201).json({ data: await publishCommunication(store, sessionUser(request), request.body) })
    } catch (error) {
      next(error)
    }
  })

  router.get("/received", async (request, response, next) => {
    try {
      const user = sessionUser(request)
      response.json({ data: { items: await store.listReceived(user.organizationId, user.personId, RECEIVED_COMMUNICATIONS_LIMIT) } })
    } catch (error) {
      next(error)
    }
  })

  router.get("/:id", async (request, response, next) => {
    try {
      response.json({ data: await readCommunication(store, sessionUser(request), idParam.parse(request.params.id)) })
    } catch (error) {
      next(error)
    }
  })

  router.patch("/:id", async (request, response, next) => {
    try {
      response.json({ data: await editCommunication(store, sessionUser(request), idParam.parse(request.params.id), request.body) })
    } catch (error) {
      next(error)
    }
  })

  router.delete("/:id", async (request, response, next) => {
    try {
      await retireCommunication(store, sessionUser(request), idParam.parse(request.params.id))
      response.status(204).end()
    } catch (error) {
      next(error)
    }
  })

  return router
}

const idParam = z.string().uuid()
