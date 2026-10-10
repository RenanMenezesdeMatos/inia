import { Router, type Request } from "express"
import { z } from "zod"
import type { CaseRepository, CaseVisibility } from "../application/case-repository.js"
import { caseVisibleTo } from "../application/case-visibility.js"

/** Teto da lista (sem paginação): o recorte visível de um gestor cabe folgado; nunca a base inteira numa resposta. */
export const CASE_LIST_LIMIT = 200

const NOT_FOUND = { error: { code: "CASE_NOT_FOUND", message: "Caso não encontrado." } } as const

/**
 * Casos de supervisão — sempre recortados pela visibilidade da SESSÃO (organização + escopo, ver case-visibility.ts). Caso de
 * outra organização, fora do escopo ou id malformado: o mesmo 404 (não revela que o caso existe).
 */
export function createCaseRouter(repository: CaseRepository, loadVisibility: (request: Request) => Promise<CaseVisibility>) {
  const router = Router()
  router.get("/", async (request, response) => response.json({ data: await repository.list(await loadVisibility(request), CASE_LIST_LIMIT) }))
  router.get("/:id", async (request, response) => {
    const id = z.string().uuid().safeParse(request.params.id)
    if (!id.success) return response.status(404).json(NOT_FOUND)
    const visibility = await loadVisibility(request)
    const owner = await repository.ownership(visibility.organizationId, id.data)
    if (!owner || !caseVisibleTo(visibility, owner)) return response.status(404).json(NOT_FOUND)
    const item = await repository.findById(visibility.organizationId, id.data)
    if (!item) return response.status(404).json(NOT_FOUND)
    return response.json({ data: item })
  })
  return router
}
