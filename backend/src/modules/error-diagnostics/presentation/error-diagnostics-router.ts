import { Router } from "express"
import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { explainCode, searchCodes, ERROR_CATALOG_VERSION } from "../../../shared/domain/errors/error-lookup.js"
import { sessionUser } from "../../auth/presentation/session-user.js"
import { REFERENCE_PATTERN } from "../domain/error-occurrence.js"
import { findOccurrencesByReference, recentOccurrencesByCode } from "../infrastructure/pg-error-occurrence-store.js"

/**
 * Administração › Plataforma › Diagnóstico de erros — somente leitura, montada atrás de
 * `support.diagnostics.view` com escopo de ORGANIZAÇÃO (app.ts). Ocorrências: só da organização da sessão e as sem organização
 * (antes do login, jobs, processo). Nada aqui expõe pessoa: as ocorrências não guardam conta nem pessoa.
 */
export function createErrorDiagnosticsRouter(db: Pick<Database, "query">) {
  const router = Router()
  const query = z.object({ q: z.string().trim().max(80).optional() })

  router.get("/codes", (request, response) => {
    const { q } = query.parse(request.query)
    response.json({ data: { catalogVersion: ERROR_CATALOG_VERSION, results: searchCodes(q ?? "") } })
  })

  router.get("/codes/:code", async (request, response) => {
    const code = z.string().trim().min(2).max(80).regex(/^[A-Za-z0-9_-]+$/).parse(request.params.code)
    const explanation = explainCode(code)
    if (!explanation) throw new DomainError("Código não encontrado no catálogo.", "ERROR_CODE_NOT_IN_CATALOG", 404)
    const canonical = explanation.kind === "ENTRY" ? explanation.entry.code : explanation.domain.code
    const occurrences = await recentOccurrencesByCode(db, canonical, sessionUser(request).organizationId)
    response.json({ data: { explanation, occurrences } })
  })

  router.get("/occurrences/:reference", async (request, response) => {
    const reference = String(request.params.reference ?? "").trim()
    if (!REFERENCE_PATTERN.test(reference)) throw new DomainError("Referência em formato inválido.", "ERROR_REFERENCE_INVALID", 400)
    const occurrences = await findOccurrencesByReference(db, reference, sessionUser(request).organizationId)
    const explanations = Object.fromEntries([...new Set(occurrences.map((occurrence) => occurrence.code))].map((code) => [code, explainCode(code)]))
    response.json({ data: { reference, occurrences, explanations } })
  })

  return router
}
