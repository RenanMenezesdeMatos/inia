import { Router, type NextFunction, type Request, type Response } from "express"
import type { Database } from "../../../infrastructure/database/pool.js"
import { sessionUser } from "../../auth/presentation/session-user.js"
import { canOrganizationWide, type AccessContext } from "../../access/domain/access-decision.js"
import { recordExplorerDenied } from "../application/explorer-audit.js"
import { listDeletedItems, previewRestoration, restoreDeletedItem } from "../application/deleted-items-service.js"
import { executeCancellation, executeReactivation, listCancellations, previewCancellation, previewReactivation } from "../application/record-cancellation-service.js"
import { describeDataset, listExplorerDatasets, runExplorerCount, runExplorerExport, runExplorerQuery, type ExplorerActor, type ExplorerExportSink } from "../application/explorer-service.js"
import { explorerErrors, ExportInterrupted } from "../domain/explorer-errors.js"
import type { ExplorerLimits } from "../domain/explorer-limits.js"

/**
 * CONSULTA DE DADOS — `/api/v1/admin/data-explorer`. A permissão vem do `app.ts` (`data_hub.explore` com escopo de organização), na frente do router
 * inteiro. Organização e conta saem só da sessão. POST em consulta, contagem e exportação é porque filtros não cabem em URL (e URL aparece em log de
 * proxy): essas rotas não gravam dado de negócio, só `audit_logs`.
 * As exceções são `/cancellations`, com permissão própria (`data_hub.cancel_records`) e fora da sessão somente leitura, e a confirmação de `/deleted-items`: cada tipo exige a permissão de quem gerencia aquele objeto, conferida no serviço.
 */
function actorOf(request: Request): ExplorerActor {
  const user = sessionUser(request)
  // O guard da rota preenche `request.access`; sem ele, nada é consultado.
  if (!request.access) throw explorerErrors.failed()
  return { organizationId: user.organizationId, accountId: user.sub, personId: user.personId ?? null, access: request.access as AccessContext }
}

/** Escrita com contrapressão: um navegador lento segura a leitura do banco, em vez de encher a memória. Quem para de baixar é desconectado. */
function createResponseSink(response: Response, stallTimeoutMs: number): ExplorerExportSink {
  let closed = false
  response.once("close", () => {
    closed = !response.writableFinished
  })
  return {
    begin(filename) {
      response.status(200)
      response.setHeader("content-type", "text/csv; charset=utf-8")
      response.setHeader("content-disposition", `attachment; filename="${filename}"`)
      // `no-transform` deixa a resposta fora da compressão: o teto de bytes conta o que sai, e a contrapressão é a da própria conexão.
      response.setHeader("cache-control", "no-store, no-transform")
      response.setHeader("x-accel-buffering", "no")
    },
    write(chunk) {
      if (closed) return Promise.reject(new ExportInterrupted("CLIENT_DISCONNECTED"))
      if (response.write(chunk, "utf8")) return Promise.resolve()
      return new Promise<void>((resolve, reject) => {
        const settle = (action: () => void) => {
          clearTimeout(timer)
          response.off("drain", onDrain)
          response.off("close", onClose)
          action()
        }
        const onDrain = () => settle(resolve)
        const onClose = () => settle(() => reject(new ExportInterrupted("CLIENT_DISCONNECTED")))
        const timer = setTimeout(() => settle(() => reject(new ExportInterrupted("CLIENT_STALLED"))), stallTimeoutMs)
        response.on("drain", onDrain)
        response.on("close", onClose)
      })
    },
    abort() {
      response.destroy()
    },
    finish() {
      response.end()
    },
  }
}

export function createDataExplorerRouter(database: Database, limits: ExplorerLimits): Router {
  const router = Router()
  const deps = { db: database, limits }

  /** Ter a consulta não basta. O guard do `app.ts` já resolveu o acesso da conta neste pedido. */
  const requireCancelPermission = async (request: Request, response: Response, next: NextFunction) => {
    if (request.access && canOrganizationWide(request.access, "data_hub.cancel_records")) return next()
    const user = sessionUser(request)
    await recordExplorerDenied(database, { organizationId: user.organizationId, personId: user.personId ?? null, accountId: user.sub }).catch(() => undefined)
    return response.status(403).json({ error: { code: "FORBIDDEN", message: "Você não tem permissão para este recurso." } })
  }

  router.get("/datasets", (request, response) => {
    response.json({ data: listExplorerDatasets(deps, actorOf(request).access) })
  })

  router.get("/datasets/:code", (request, response) => {
    response.json({ data: describeDataset(String(request.params.code), actorOf(request).access) })
  })

  router.post("/query", async (request, response) => {
    response.json({ data: await runExplorerQuery(deps, actorOf(request), request.body) })
  })

  router.post("/count", async (request, response) => {
    response.json({ data: await runExplorerCount(deps, actorOf(request), request.body) })
  })

  router.post("/export", async (request, response) => {
    // Abaixo do limite de transação ociosa do banco: o aviso de "parou de baixar" chega antes de o banco derrubar a conexão.
    await runExplorerExport(deps, actorOf(request), request.body, createResponseSink(response, Math.max(1_000, limits.exportIdleTimeoutMs - 5_000)))
  })

  router.get("/cancellations", requireCancelPermission, async (request, response) => {
    const dataset = typeof request.query.dataset === "string" ? request.query.dataset : ""
    response.json({ data: await listCancellations(deps, actorOf(request), dataset) })
  })

  router.post("/cancellations/preview", requireCancelPermission, async (request, response) => {
    response.json({ data: await previewCancellation(deps, actorOf(request), request.body) })
  })

  router.post("/cancellations", requireCancelPermission, async (request, response) => {
    response.status(201).json({ data: await executeCancellation(deps, actorOf(request), request.body) })
  })

  router.get("/cancellations/:id/reactivation", requireCancelPermission, async (request, response) => {
    response.json({ data: await previewReactivation(deps, actorOf(request), String(request.params.id)) })
  })

  router.post("/cancellations/:id/reactivation", requireCancelPermission, async (request, response) => {
    response.json({ data: await executeReactivation(deps, actorOf(request), String(request.params.id), request.body) })
  })

  router.get("/deleted-items", async (request, response) => {
    response.json({ data: await listDeletedItems(deps, actorOf(request), { ...(typeof request.query.type === "string" ? { type: request.query.type } : {}), ...(typeof request.query.search === "string" ? { search: request.query.search } : {}) }) })
  })

  router.get("/deleted-items/:type/:id/restoration", async (request, response) => {
    response.json({ data: await previewRestoration(deps, actorOf(request), String(request.params.type), String(request.params.id)) })
  })

  router.post("/deleted-items/:type/:id/restoration", async (request, response) => {
    response.json({ data: await restoreDeletedItem(deps, actorOf(request), String(request.params.type), String(request.params.id)) })
  })

  return router
}
