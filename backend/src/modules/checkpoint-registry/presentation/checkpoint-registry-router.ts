import { Router, type Request } from "express"
import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { coversOrganization, getManageableScopes } from "../../auth/application/manageable-scopes.js"
import { acknowledgeRemovedCheckpoint, approveCheckpointVersion, approveProposedInChangeSet, linkAmbiguousCheckpoint, rejectCheckpointVersion, setCheckpointScopes, setDocumentGovernance, syncCheckpointRegistry, updateCheckpointDefinition, type RegistryActor } from "../application/checkpoint-registry-service.js"
import { listRegistryDocuments, loadCheckpointDefinition, loadDocumentRegistry, loadScopeOptions } from "../application/checkpoint-registry-queries.js"
import { sessionUser } from "../../auth/presentation/session-user.js"

/**
 * /api/v1/admin/checkpoints — "Checkpoints da operação" (montado com `knowledge.manage` NA ORGANIZAÇÃO INTEIRA: checkpoint é
 * representação operacional da Base de Conhecimento e carrega o literal dela, que a rota de Bases só mostra a quem alcança o Grupo
 * da base). Organização SEMPRE da sessão. Ler e GOVERNAR (extrair, aprovar, rejeitar, vincular, configurar, escopo, governança do
 * documento) exigem a permissão na organização inteira. Nenhuma rota edita a regra oficial — ela é da base.
 */
const noteSchema = z.object({ note: z.string().trim().max(1000).nullable().optional() }).strict()
const rejectSchema = z.object({ note: z.string().trim().min(3).max(1000) }).strict()
const linkSchema = z.object({ definitionId: z.string().uuid() }).strict()
const governanceSchema = z.object({ enabled: z.boolean() }).strict()

export function createCheckpointRegistryRouter(db: Database) {
  const router = Router()
  const session = (request: Request): RegistryActor => ({ organizationId: sessionUser(request).organizationId, personId: sessionUser(request).personId ?? null })
  const requireOrganizationWide = async (request: Request) => {
    if (!coversOrganization(await getManageableScopes(db, sessionUser(request), "knowledge.manage"))) throw new DomainError("Governar checkpoints exige a administração das Bases de Conhecimento na organização inteira.", "FORBIDDEN", 403)
  }

  router.get("/documents", async (request, response) => {
    response.json({ data: await listRegistryDocuments(db, session(request).organizationId) })
  })
  router.get("/documents/:documentId", async (request, response) => {
    response.json({ data: await loadDocumentRegistry(db, session(request).organizationId, request.params.documentId!) })
  })
  router.get("/definitions/:definitionId", async (request, response) => {
    response.json({ data: await loadCheckpointDefinition(db, session(request).organizationId, request.params.definitionId!) })
  })
  router.get("/scope-options", async (request, response) => {
    response.json({ data: await loadScopeOptions(db, session(request).organizationId) })
  })

  router.post("/documents/:documentId/extract", async (request, response) => {
    await requireOrganizationWide(request)
    response.json({ data: await syncCheckpointRegistry(db, session(request), request.params.documentId!) })
  })
  router.post("/documents/:documentId/governance", async (request, response) => {
    await requireOrganizationWide(request)
    await setDocumentGovernance(db, session(request), request.params.documentId!, governanceSchema.parse(request.body ?? {}).enabled)
    response.status(204).end()
  })
  router.post("/change-sets/:changeSetId/approve-proposed", async (request, response) => {
    await requireOrganizationWide(request)
    response.json({ data: await approveProposedInChangeSet(db, session(request), request.params.changeSetId!) })
  })
  router.post("/versions/:versionId/approve", async (request, response) => {
    await requireOrganizationWide(request)
    await approveCheckpointVersion(db, session(request), request.params.versionId!, noteSchema.parse(request.body ?? {}).note ?? null)
    response.status(204).end()
  })
  router.post("/versions/:versionId/reject", async (request, response) => {
    await requireOrganizationWide(request)
    await rejectCheckpointVersion(db, session(request), request.params.versionId!, rejectSchema.parse(request.body ?? {}).note)
    response.status(204).end()
  })
  router.post("/versions/:versionId/link", async (request, response) => {
    await requireOrganizationWide(request)
    await linkAmbiguousCheckpoint(db, session(request), request.params.versionId!, linkSchema.parse(request.body ?? {}).definitionId)
    response.status(204).end()
  })
  router.post("/versions/:versionId/acknowledge-removal", async (request, response) => {
    await requireOrganizationWide(request)
    await acknowledgeRemovedCheckpoint(db, session(request), request.params.versionId!)
    response.status(204).end()
  })
  router.patch("/definitions/:definitionId", async (request, response) => {
    await requireOrganizationWide(request)
    await updateCheckpointDefinition(db, session(request), request.params.definitionId!, request.body ?? {})
    response.status(204).end()
  })
  router.put("/definitions/:definitionId/scopes", async (request, response) => {
    await requireOrganizationWide(request)
    await setCheckpointScopes(db, session(request), request.params.definitionId!, request.body ?? {})
    response.status(204).end()
  })
  return router
}
