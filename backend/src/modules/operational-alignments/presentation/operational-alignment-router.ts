import { Router, type Request } from "express"
import type { Database } from "../../../infrastructure/database/pool.js"
import { getManageableScopes } from "../../auth/application/manageable-scopes.js"
import { sessionUser } from "../../auth/presentation/session-user.js"
import {
  affectedAssessments,
  createAlignment,
  createReason,
  createRequestReason,
  listReasons,
  listRequestReasons,
  updateReason,
  deleteAlignment,
  discardDraft,
  endAlignment,
  getAlignment,
  listAlignments,
  listProcessOptions,
  previewPublication,
  scopeOptions,
  publishAlignment,
  responsibleOptions,
  updateAlignment,
  type ProhibitedTopicCheck,
  alignmentUniversesOf,
  type AlignmentScopes,
} from "../application/operational-alignment-service.js"

type SessionUser = { organizationId: string; sub: string; personId?: string | null }

/**
 * /api/v1/admin/operational-alignments — Alinhamentos operacionais (montado com `operational_alignments.manage` — papel Gestor de alinhamentos, também incluída em Administrador geral e Administrador).
 * O escopo (universo inteiro × Grupo/Subgrupo administrado) e o universo são decididos no SERVIÇO; a tela só espelha.
 */
export function createOperationalAlignmentRouter(db: Database, deps: { prohibitedTopicCheck?: ProhibitedTopicCheck } = {}) {
  const router = Router()
  const session = (request: Request) => {
    const user = sessionUser<SessionUser>(request)
    return { organizationId: user.organizationId, personId: user.personId ?? null, accountId: user.sub, sub: user.sub }
  }
  const scopesOf = async (request: Request): Promise<AlignmentScopes> => {
    const user = sessionUser<SessionUser>(request)
    const [scopes, universes] = await Promise.all([getManageableScopes(db, user, "operational_alignments.manage"), alignmentUniversesOf(db, session(request))])
    return { ...scopes, universes }
  }

  /** Grupos e Subgrupos que a pessoa administra, com o universo de cada um (os filtros e o formulário encadeiam por ele). */
  router.get("/scope-options", async (request, response) => {
    response.json({ data: await scopeOptions(db, session(request).organizationId, await scopesOf(request)) })
  })

  /** Responsável pela orientação (221): lideranças ativas da organização, pelo nome, e quem está cadastrando. */
  router.get("/responsible-options", async (request, response) => {
    response.json({ data: { items: await responsibleOptions(db, session(request), request.query as Record<string, unknown>) } })
  })

  router.get("/", async (request, response) => {
    response.json({ data: await listAlignments(db, session(request).organizationId, await scopesOf(request), request.query as Record<string, unknown>) })
  })

  /** Motivos do alinhamento (catálogo da organização) e do pedido do cliente (assuntos canônicos). Escrever: alcance da organização. */
  router.get("/reasons", async (request, response) => {
    response.json({ data: await listReasons(db, session(request).organizationId) })
  })
  router.post("/reasons", async (request, response) => {
    response.status(201).json({ data: await createReason(db, session(request), await scopesOf(request), request.body) })
  })
  router.patch("/reasons/:id", async (request, response) => {
    response.json({ data: await updateReason(db, session(request), await scopesOf(request), request.params.id, request.body) })
  })
  router.get("/request-reasons", async (request, response) => {
    response.json({ data: await listRequestReasons(db, session(request).organizationId) })
  })
  router.post("/request-reasons", async (request, response) => {
    response.status(201).json({ data: await createRequestReason(db, session(request), await scopesOf(request), request.body) })
  })

    /** Processos (bases de procedimento publicadas) para o seletor: busca, tipo e universo no servidor, em páginas. */
  router.get("/process-options", async (request, response) => {
    response.json({ data: await listProcessOptions(db, session(request).organizationId, request.query as Record<string, unknown>, await alignmentUniversesOf(db, session(request))) })
  })

  router.get("/:id", async (request, response) => {
    response.json({ data: await getAlignment(db, session(request).organizationId, await scopesOf(request), request.params.id) })
  })

  router.post("/", async (request, response) => {
    response.status(201).json({ data: await createAlignment(db, session(request), await scopesOf(request), request.body) })
  })

  router.put("/:id/draft", async (request, response) => {
    response.json({ data: await updateAlignment(db, session(request), await scopesOf(request), request.params.id, request.body) })
  })

  router.delete("/:id/draft", async (request, response) => {
    response.json({ data: await discardDraft(db, session(request), await scopesOf(request), request.params.id) })
  })

  router.get("/:id/publication-preview", async (request, response) => {
    response.json({ data: await previewPublication(db, session(request).organizationId, await scopesOf(request), request.params.id) })
  })

  router.post("/:id/publish", async (request, response) => {
    response.json({ data: await publishAlignment(db, session(request), await scopesOf(request), request.params.id, request.body, deps) })
  })

  /** Exclusão lógica (motivo obrigatório): deixa de valer a partir de agora; volta por "Consultar dados › Itens excluídos". */
  router.delete("/:id", async (request, response) => {
    response.json({ data: await deleteAlignment(db, session(request), await scopesOf(request), request.params.id, request.body) })
  })

  router.post("/:id/end", async (request, response) => {
    response.json({ data: await endAlignment(db, session(request), await scopesOf(request), request.params.id, request.body) })
  })

  /** Monitorias já concluídas que podem ter sido avaliadas pelo procedimento oficial durante a vigência (só leitura). */
  router.get("/:id/affected-assessments", async (request, response) => {
    response.json({ data: await affectedAssessments(db, session(request).organizationId, await scopesOf(request), request.params.id) })
  })

  return router
}
