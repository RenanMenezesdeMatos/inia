import { Router } from "express"
import type { Database } from "../../../infrastructure/database/pool.js"
import { loadKnowledgeVersionImage } from "../application/knowledge-file-images.js"
import { loadAccessibleKnowledgeMaterial, resolveAccessibleMaterialVersion } from "../application/knowledge-material-access.js"
import { LIVE_FILE_QUERY, type LiveFileRow } from "../application/live-knowledge-version.js"
import { DocxPreviewTooLargeError, renderDocxPreviewHtml } from "../infrastructure/docx-preview.js"
import { sendKnowledgeFile, sendKnowledgeImage } from "./knowledge-file-response.js"
import { sessionUser } from "../../auth/presentation/session-user.js"

/**
 * Leitor de material da Base de Conhecimento para QUALQUER usuário autenticado — a página real
 * que o link "Acessar material" de um Feedback abre (`/materiais/:id`). É o MESMO material do
 * admin (`/api/v1/admin/knowledge`): mesma tabela, mesma versão publicada, mesmo arquivo original;
 * a diferença é a autorização, decidida aqui pelo alcance cadastrado da base
 * (knowledge-material-access.ts). Não existe URL pública nem bypass: sem acesso → 404, sem
 * distinguir "não existe" de "não pode" (não vaza a existência do material).
 */
export function createKnowledgeMaterialRouter(db: Database) {
  const router = Router()

  const viewerOf = (request: { user?: { personId: string; organizationId: string } }) => ({
    organizationId: sessionUser(request).organizationId,
    viewer: { personId: sessionUser(request).personId },
  })

  const notFound = (response: { status: (code: number) => { json: (body: unknown) => unknown } }) =>
    response.status(404).json({ error: { code: "KNOWLEDGE_MATERIAL_NOT_FOUND", message: "Material de apoio não encontrado ou não disponível para você." } })

  router.get("/:id", async (request, response) => {
    const material = await loadAccessibleKnowledgeMaterial(db, { ...viewerOf(request), materialId: request.params.id! })
    if (!material) return notFound(response)
    response.json({ data: material })
  })

  // Arquivo original (PDF/DOCX/TXT/JSON) — só depois da mesma checagem de acesso do detalhe.
  router.get("/:id/file", async (request, response) => {
    const material = await loadAccessibleKnowledgeMaterial(db, { ...viewerOf(request), materialId: request.params.id! })
    if (!material) return notFound(response)
    const result = await db.query<LiveFileRow>(LIVE_FILE_QUERY, [material.id, viewerOf(request).organizationId])
    const row = result.rows[0]
    if (!row) return response.status(404).json({ error: { code: "KNOWLEDGE_FILE_NOT_FOUND", message: "Arquivo original não encontrado para este material." } })
    sendKnowledgeFile(response, { sourceType: material.sourceType, filename: material.originalFilename ?? `${material.title}.bin`, data: row.file_data })
  })

  // Imagem do PDF em vigor, para a página de leitura e para as respostas do chat. Mesma checagem de acesso do detalhe. Imagem que só existia numa
  // versão anterior fica indisponível, como o arquivo daquela versão.
  router.get("/:id/images/:imageId", async (request, response) => {
    const versionId = await resolveAccessibleMaterialVersion(db, { ...viewerOf(request), materialId: request.params.id! })
    const image = versionId ? await loadKnowledgeVersionImage(db, versionId, request.params.imageId!) : null
    if (!image) return notFound(response)
    sendKnowledgeImage(request, response, image)
  })

  // Prévia HTML (hoje só DOCX) — mesma conversão do admin, mesmo arquivo intacto.
  router.get("/:id/preview", async (request, response) => {
    const material = await loadAccessibleKnowledgeMaterial(db, { ...viewerOf(request), materialId: request.params.id! })
    if (!material) return notFound(response)
    if (material.sourceType !== "DOCX") {
      return response.status(415).json({ error: { code: "KNOWLEDGE_PREVIEW_UNSUPPORTED", message: "Este formato não tem prévia em HTML." } })
    }
    const result = await db.query<LiveFileRow>(LIVE_FILE_QUERY, [material.id, viewerOf(request).organizationId])
    const row = result.rows[0]
    if (!row) return response.status(404).json({ error: { code: "KNOWLEDGE_FILE_NOT_FOUND", message: "Arquivo original não encontrado para este material." } })
    try {
      const html = await renderDocxPreviewHtml(row.file_data)
      response.json({ data: { format: "html", html } })
    } catch (error) {
      if (error instanceof DocxPreviewTooLargeError) return response.status(422).json({ error: { code: "KNOWLEDGE_PREVIEW_TOO_LARGE", message: error.message } })
      response.status(422).json({ error: { code: "KNOWLEDGE_PREVIEW_FAILED", message: "Não foi possível gerar a prévia deste documento." } })
    }
  })

  return router
}
