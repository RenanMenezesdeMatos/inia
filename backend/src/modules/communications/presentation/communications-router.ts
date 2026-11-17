import { Router } from "express"
import { z } from "zod"
import { sessionUser } from "../../auth/presentation/session-user.js"
import {
  communicationAudienceOptions,
  editCommunication,
  listCommunicationsForModeration,
  listOwnCommunications,
  moderateRetireCommunication,
  readCommunicationForModeration,
  previewCommunicationAudience,
  publishCommunication,
  readCommunication,
  readOwnCommunication,
  retireCommunication,
  setCommunicationArchived,
  type CommunicationStore,
} from "../application/communication-service.js"
import { EDITORIAL_COMMUNICATIONS_LIMIT, RECEIVED_COMMUNICATIONS_LIMIT } from "../domain/communication.js"

/**
 * Comunicados da liderança (migrations 199, 201 e 220). Organização, autor e público SEMPRE da sessão e do servidor:
 *   POST /                    — cria: rascunho (`mode: "DRAFT"`) ou publicação, agora ou agendada (`publishAt`). Sem `mode` = publica
 *                               agora (o corpo de antes continua valendo). Conteúdo refeito e imagens sem metadados;
 *   GET  /received            — os comunicados NO AR que a pessoa recebeu (lista LEVE: trecho e se há imagens, nunca o conteúdo);
 *   GET  /mine                — área editorial: as publicações do autor (rascunho, agendado, publicado, encerrado, arquivado);
 *   GET  /mine/:id            — uma publicação do autor, inteira, para editar;
 *   GET  /audience-options    — Grupos/Subgrupos, universos e produtos para o público (Grupos só para quem publica para a organização);
 *   POST /audience-preview    — quantas pessoas o público alcançaria agora;
 *   GET  /:id                 — um comunicado NO AR, inteiro, só se a pessoa da sessão o enxerga (a mesma regra do feed); senão 404;
 *   PATCH /:id                — o AUTOR altera (rascunho, agendado ou publicado; versão anterior guardada; público fixo depois que saiu);
 *   POST /:id/archive         — o AUTOR arquiva (sai do feed e do chat); POST /:id/unarchive devolve;
 *   DELETE /:id               — o AUTOR retira (exclusão lógica). De outra pessoa ou já retirado = 404.
 *   GET  /moderation          — moderação (`communications.moderate`, Administrador geral): publicações de todos (sem rascunhos);
 *   GET  /moderation/:id      — uma delas, inteira, para conferir;
 *   POST /:id/moderate-retire — retira a de qualquer autor, com `reason` (exclusão lógica auditada; o texto nunca é alterado).
 * O que a conta pode publicar chega à tela pelas capacidades da sessão (`canPublishTeamCommunications`,
 * `canPublishOrganizationCommunications`, de `access-decision.ts`) — e é conferido de novo aqui, a cada gravação.
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

  router.get("/mine", async (request, response, next) => {
    try {
      response.json({ data: { items: await listOwnCommunications(store, sessionUser(request), EDITORIAL_COMMUNICATIONS_LIMIT) } })
    } catch (error) {
      next(error)
    }
  })

  router.get("/mine/:id", async (request, response, next) => {
    try {
      response.json({ data: await readOwnCommunication(store, sessionUser(request), idParam.parse(request.params.id)) })
    } catch (error) {
      next(error)
    }
  })

  router.get("/moderation", async (request, response, next) => {
    try {
      response.json({ data: { items: await listCommunicationsForModeration(store, sessionUser(request), EDITORIAL_COMMUNICATIONS_LIMIT) } })
    } catch (error) {
      next(error)
    }
  })

  router.get("/moderation/:id", async (request, response, next) => {
    try {
      response.json({ data: await readCommunicationForModeration(store, sessionUser(request), idParam.parse(request.params.id)) })
    } catch (error) {
      next(error)
    }
  })

  router.post("/:id/moderate-retire", async (request, response, next) => {
    try {
      await moderateRetireCommunication(store, sessionUser(request), idParam.parse(request.params.id), request.body)
      response.status(204).end()
    } catch (error) {
      next(error)
    }
  })

  router.get("/audience-options", async (request, response, next) => {
    try {
      response.json({ data: await communicationAudienceOptions(store, sessionUser(request)) })
    } catch (error) {
      next(error)
    }
  })

  router.post("/audience-preview", async (request, response, next) => {
    try {
      response.json({ data: await previewCommunicationAudience(store, sessionUser(request), request.body) })
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

  router.post("/:id/archive", async (request, response, next) => {
    try {
      await setCommunicationArchived(store, sessionUser(request), idParam.parse(request.params.id), true)
      response.status(204).end()
    } catch (error) {
      next(error)
    }
  })

  router.post("/:id/unarchive", async (request, response, next) => {
    try {
      await setCommunicationArchived(store, sessionUser(request), idParam.parse(request.params.id), false)
      response.status(204).end()
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
