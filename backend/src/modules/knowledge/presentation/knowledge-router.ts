import { createHash } from "node:crypto"
import { Router } from "express"
import multer from "multer"
import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { booleanParam, dateParam, listParam, orgScopeFilterSchema, respondList, searchParam, SqlFilter } from "../../../shared/presentation/list-query.js"
import { extractTextFromFile, fileContentAccepted, resolveSourceType } from "../infrastructure/text-extractor.js"
import { renderDocxPreviewHtml } from "../infrastructure/docx-preview.js"
import { knowledgeFileContentType, sendKnowledgeFile } from "./knowledge-file-response.js"
import { multerLimits } from "../../../shared/infrastructure/zip-guard.js"
import { canManageScope, getManageableScopes, type ManageableScopes, type ScopedTarget } from "../../auth/application/manageable-scopes.js"
import { createLogger } from "../../../shared/infrastructure/logging/logger.js"
import { syncCheckpointRegistry } from "../../checkpoint-registry/application/checkpoint-registry-service.js"

const registryLog = createLogger("checkpoint-registry")

const upload = multer({ storage: multer.memoryStorage(), limits: multerLimits(15 * 1024 * 1024) })

const orgScopeSchema = z.object({
  scopeType: z.enum(["ALL_TEAMS", "TEAM", "SUBTEAM"]),
  teamId: z.string().uuid().optional(),
  subteamId: z.string().uuid().optional(),
})
const subjectScopeSchema = z.object({
  scopeType: z.enum(["ALL_SUBJECTS", "SUBJECT"]),
  subjectId: z.string().uuid().optional(),
})
const createKnowledgeSchema = z.object({
  title: z.string().trim().min(2),
  documentType: z.enum(["PROCEDURE", "MANUAL", "FAQ", "RULE", "FLOW"]),
  content: z.string().trim().min(10).optional(),
  orgScopes: z.array(orgScopeSchema).default([{ scopeType: "ALL_TEAMS" }]),
  subjectScopes: z.array(subjectScopeSchema).default([{ scopeType: "ALL_SUBJECTS" }]),
})

const knowledgeStatusSchema = z.enum(["DRAFT", "APPROVED", "PUBLISHED", "ARCHIVED"])

const listKnowledgeSchema = orgScopeFilterSchema.extend({
  search: searchParam,
  documentType: listParam(z.enum(["PROCEDURE", "MANUAL", "FAQ", "RULE", "FLOW"])),
  sourceType: listParam(z.enum(["TEXT", "PDF", "DOCX", "TXT", "JSON"])),
  status: listParam(knowledgeStatusSchema),
  subjectScopeType: z.enum(["ALL_SUBJECTS"]).optional(),
  subjectId: z.string().uuid().optional(),
  hasFile: booleanParam,
  createdFrom: dateParam,
  createdTo: dateParam,
})
const updateKnowledgeSchema = z.object({
  title: z.string().trim().min(2).optional(),
  documentType: z.enum(["PROCEDURE", "MANUAL", "FAQ", "RULE", "FLOW"]).optional(),
  content: z.string().trim().min(10).optional(),
  status: knowledgeStatusSchema.optional(),
  orgScopes: z.array(orgScopeSchema).optional(),
  subjectScopes: z.array(subjectScopeSchema).optional(),
})

function parseJsonField(value: unknown) {
  if (typeof value !== "string" || value.length === 0) return undefined
  try {
    return JSON.parse(value)
  } catch {
    throw new DomainError("Escopo inválido.", "INVALID_SCOPE_JSON", 400)
  }
}

// Uma linha por documento, sempre com a versão mais recente (lateral) em vez de agregar todas —
// é dela que saem status e resumo (excerpt, com espaços normalizados). Autor vem de created_by →
// user_accounts → people; fica nulo em registros antigos sem created_by (a UI mostra "não
// informado", não inventa nome).
const EXCERPT_LENGTH = 280

const KNOWLEDGE_SELECT = `
  select
    d.id, d.title, d.document_type "documentType", d.source_type "sourceType",
    d.original_filename "originalFilename", d.mime_type "mimeType", d.file_size_bytes "fileSizeBytes",
    d.created_at "createdAt", d.updated_at "updatedAt",
    p.name "authorName",
    coalesce(lv.status, 'DRAFT') status,
    left(regexp_replace(lv.content, '\\s+', ' ', 'g'), ${EXCERPT_LENGTH}) excerpt,
    coalesce((
      select json_agg(json_build_object('id', os.id, 'scopeType', os.scope_type, 'teamId', os.team_id, 'teamName', t.name, 'subteamId', os.subteam_id, 'subteamName', st.name))
      from knowledge_document_org_scopes os
      left join teams t on t.id = os.team_id
      left join subteams st on st.id = os.subteam_id
      where os.knowledge_document_id = d.id
    ), '[]') "orgScopes",
    coalesce((
      select json_agg(json_build_object('id', ss.id, 'scopeType', ss.scope_type, 'subjectId', ss.subject_id, 'subjectName', sub.name))
      from knowledge_document_subject_scopes ss
      left join subjects sub on sub.id = ss.subject_id
      where ss.knowledge_document_id = d.id
    ), '[]') "subjectScopes"
  from knowledge_documents d
  left join lateral (
    select v.status, v.content from knowledge_versions v where v.document_id = d.id order by v.version desc limit 1
  ) lv on true
  left join user_accounts ua on ua.id = d.created_by
  left join people p on p.id = ua.person_id
  where d.organization_id = $1 and d.deleted_at is null
`

async function fetchDocumentDetail(db: Database, organizationId: string, id: string) {
  const document = await db.query(`${KNOWLEDGE_SELECT} and d.id = $2`, [organizationId, id])
  if (!document.rows[0]) return null
  const version = await db.query(
    `select version, content, status, created_at "createdAt" from knowledge_versions where document_id = $1 order by version desc limit 1`,
    [id],
  )
  return { ...document.rows[0], latestVersion: version.rows[0] ?? null }
}

async function replaceScopes(
  client: { query: Database["query"] },
  documentId: string,
  orgScopes: z.infer<typeof orgScopeSchema>[] | undefined,
  subjectScopes: z.infer<typeof subjectScopeSchema>[] | undefined,
) {
  if (orgScopes) {
    await client.query(`delete from knowledge_document_org_scopes where knowledge_document_id = $1`, [documentId])
    for (const scope of orgScopes) {
      await client.query(
        `insert into knowledge_document_org_scopes(knowledge_document_id, scope_type, team_id, subteam_id) values ($1,$2,$3,$4)`,
        [documentId, scope.scopeType, scope.teamId ?? null, scope.subteamId ?? null],
      )
    }
  }
  if (subjectScopes) {
    await client.query(`delete from knowledge_document_subject_scopes where knowledge_document_id = $1`, [documentId])
    for (const scope of subjectScopes) {
      await client.query(
        `insert into knowledge_document_subject_scopes(knowledge_document_id, scope_type, subject_id) values ($1,$2,$3)`,
        [documentId, scope.scopeType, scope.subjectId ?? null],
      )
    }
  }
}

/**
 * ESCOPO de `knowledge.manage` (achado A-F02 da auditoria de segurança): o guard do router só confere a permissão em ALGUM
 * escopo; o documento concreto é decidido aqui.
 *  - LER (lista, detalhe, arquivo, prévia): base global (ALL_TEAMS) ou com algum alcance no Grupo/Subgrupo do administrador —
 *    a base global serve a todos os Grupos (e é escolhida nos Agents deles); a de outro Grupo não aparece.
 *  - ESCREVER (editar, publicar, mudar alcance, excluir) e CRIAR: TODOS os alcances — os atuais e os novos — precisam estar
 *    no escopo (`canManageScope`): base global só com escopo de organização. Sem alcance nenhum = só a organização inteira.
 * Fora do escopo = 404 (não revela que a base existe).
 */
type DocumentScope = { scopeType: string; teamId: string | null; subteamId: string | null }

function canWriteDocument(scopes: ManageableScopes, documentScopes: readonly ScopedTarget[]): boolean {
  if (scopes.unrestricted || scopes.allTeams) return true
  return documentScopes.length > 0 && documentScopes.every((scope) => canManageScope(scopes, scope))
}

async function parentTeamsOf(db: Database, subteamIds: readonly string[]): Promise<Set<string>> {
  if (subteamIds.length === 0) return new Set()
  const result = await db.query<{ team_id: string }>(`select team_id from subteams where id = any($1::uuid[])`, [[...subteamIds]])
  return new Set(result.rows.map((row) => row.team_id))
}

async function canReadDocument(db: Database, scopes: ManageableScopes, documentScopes: readonly DocumentScope[]): Promise<boolean> {
  if (scopes.unrestricted || scopes.allTeams) return true
  if (documentScopes.some((scope) => scope.scopeType === "ALL_TEAMS")) return true
  const parentTeams = await parentTeamsOf(db, [...scopes.subteamIds])
  return documentScopes.some((scope) =>
    (scope.teamId !== null && (scopes.teamIds.has(scope.teamId) || (scope.scopeType === "TEAM" && parentTeams.has(scope.teamId)))) ||
    (scope.subteamId !== null && scopes.subteamIds.has(scope.subteamId)))
}

/** Alcances atuais do documento NA organização (null = não existe nela ou foi excluído). */
async function loadDocumentScopes(db: Pick<Database, "query">, organizationId: string, id: string): Promise<DocumentScope[] | null> {
  if (!z.string().uuid().safeParse(id).success) return null
  const result = await db.query<{ found: boolean; scopes: DocumentScope[] }>(
    `select true found, coalesce((select json_agg(json_build_object('scopeType', os.scope_type, 'teamId', os.team_id, 'subteamId', os.subteam_id))
       from knowledge_document_org_scopes os where os.knowledge_document_id = d.id), '[]') scopes
     from knowledge_documents d where d.id = $1 and d.organization_id = $2 and d.deleted_at is null`,
    [id, organizationId],
  )
  return result.rows[0] ? result.rows[0].scopes : null
}

const NOT_FOUND = { error: { code: "KNOWLEDGE_NOT_FOUND", message: "Base de conhecimento não encontrada." } } as const
const SCOPE_FORBIDDEN = () => new DomainError("Você só pode cadastrar bases nos Grupos do seu escopo (base para todos os Grupos exige escopo de organização).", "KNOWLEDGE_SCOPE_FORBIDDEN", 403)

const toTargets = (scopes: readonly { scopeType: string; teamId?: string | null | undefined; subteamId?: string | null | undefined }[]): ScopedTarget[] =>
  scopes.map((scope) => ({ scopeType: scope.scopeType, teamId: scope.teamId ?? null, subteamId: scope.subteamId ?? null }))

export function createKnowledgeRouter(db: Database) {
  const router = Router()
  const scopesOf = (request: { user?: { organizationId: string; sub: string } }) => getManageableScopes(db, request.user!, "knowledge.manage")
  /** Documento legível pelo administrador da sessão (null = 404). */
  const readable = async (request: { user?: { organizationId: string; sub: string } }, id: string) => {
    const documentScopes = await loadDocumentScopes(db, request.user!.organizationId, id)
    if (!documentScopes) return null
    return (await canReadDocument(db, await scopesOf(request), documentScopes)) ? documentScopes : null
  }

  router.get("/", async (request, response) => {
    const organizationId = request.user!.organizationId
    const input = listKnowledgeSchema.parse(request.query)
    const filter = new SqlFilter([organizationId])
      .search(input.search, ["q.title", 'q."originalFilename"'])
      .in('q."documentType"', input.documentType)
      .in('q."sourceType"', input.sourceType)
      .in("q.status", input.status)
      .dateRange('q."createdAt"', input.createdFrom, input.createdTo)
    if (input.hasFile !== undefined) filter.add(`q."sourceType" ${input.hasFile ? "<>" : "="} 'TEXT'`)
    // Alcances ficam em tabelas próprias (n:1), então o filtro é um EXISTS e não uma coluna.
    if (input.subteamId) {
      filter.add(`exists (select 1 from knowledge_document_org_scopes os where os.knowledge_document_id = q.id and os.subteam_id = ${filter.param(input.subteamId)}::uuid)`)
    } else if (input.teamId) {
      filter.add(`exists (select 1 from knowledge_document_org_scopes os where os.knowledge_document_id = q.id and os.team_id = ${filter.param(input.teamId)}::uuid)`)
    } else if (input.scopeType === "ALL_TEAMS") {
      filter.add(`exists (select 1 from knowledge_document_org_scopes os where os.knowledge_document_id = q.id and os.scope_type = 'ALL_TEAMS')`)
    }
    const scopes = await scopesOf(request)
    if (!scopes.unrestricted && !scopes.allTeams) {
      const teamIds = filter.param([...scopes.teamIds])
      const subteamIds = filter.param([...scopes.subteamIds])
      filter.add(`exists (select 1 from knowledge_document_org_scopes os where os.knowledge_document_id = q.id and (os.scope_type = 'ALL_TEAMS' or os.team_id = any(${teamIds}::uuid[]) or os.subteam_id = any(${subteamIds}::uuid[]) or (os.scope_type = 'TEAM' and os.team_id in (select st.team_id from subteams st where st.id = any(${subteamIds}::uuid[])))))`)
    }
    if (input.subjectId) {
      filter.add(`exists (select 1 from knowledge_document_subject_scopes ss where ss.knowledge_document_id = q.id and ss.subject_id = ${filter.param(input.subjectId)}::uuid)`)
    } else if (input.subjectScopeType === "ALL_SUBJECTS") {
      filter.add(`exists (select 1 from knowledge_document_subject_scopes ss where ss.knowledge_document_id = q.id and ss.scope_type = 'ALL_SUBJECTS')`)
    }
    const data = await respondList(db, request.query, { select: KNOWLEDGE_SELECT, filter, orderBy: 'q."createdAt" desc, q.id' })
    response.json({ data })
  })

  router.get("/:id", async (request, response) => {
    if (!(await readable(request, request.params.id))) return response.status(404).json(NOT_FOUND)
    const detail = await fetchDocumentDetail(db, request.user!.organizationId, request.params.id)
    if (!detail) return response.status(404).json(NOT_FOUND)
    response.json({ data: detail })
  })

  // Arquivo original (PDF/DOCX/TXT/JSON) exatamente como foi enviado — usado pela prévia e pelo
  // download. Passa pelo mesmo requireAdmin do router; não existe URL pública para o binário.
  router.get("/:id/file", async (request, response) => {
    if (!(await readable(request, request.params.id))) return response.status(404).json(NOT_FOUND)
    const organizationId = request.user!.organizationId
    const result = await db.query<{ title: string; original_filename: string | null; source_type: string | null; file_data: Buffer }>(
      `select d.title, d.original_filename, d.source_type, f.file_data
       from knowledge_documents d
       join knowledge_files f on f.knowledge_document_id = d.id
       where d.id = $1 and d.organization_id = $2 and d.deleted_at is null
       order by f.created_at desc limit 1`,
      [request.params.id, organizationId],
    )
    const row = result.rows[0]
    if (!row) {
      return response.status(404).json({ error: { code: "KNOWLEDGE_FILE_NOT_FOUND", message: "Arquivo original não encontrado para esta base." } })
    }
    sendKnowledgeFile(response, { sourceType: row.source_type, filename: row.original_filename ?? `${row.title}.bin`, data: row.file_data })
  })

  // Prévia em HTML gerada do arquivo original (hoje só DOCX, via mammoth — mesma lib já usada na
  // extração de texto). O arquivo original nunca é alterado; a conversão acontece a cada leitura.
  router.get("/:id/preview", async (request, response) => {
    if (!(await readable(request, request.params.id))) return response.status(404).json(NOT_FOUND)
    const organizationId = request.user!.organizationId
    const result = await db.query<{ source_type: string; file_data: Buffer }>(
      `select d.source_type, f.file_data
       from knowledge_documents d
       join knowledge_files f on f.knowledge_document_id = d.id
       where d.id = $1 and d.organization_id = $2 and d.deleted_at is null
       order by f.created_at desc limit 1`,
      [request.params.id, organizationId],
    )
    const row = result.rows[0]
    if (!row) {
      return response.status(404).json({ error: { code: "KNOWLEDGE_FILE_NOT_FOUND", message: "Arquivo original não encontrado para esta base." } })
    }
    if (row.source_type !== "DOCX") {
      return response.status(415).json({ error: { code: "KNOWLEDGE_PREVIEW_UNSUPPORTED", message: "Este formato não tem prévia em HTML." } })
    }
    try {
      const html = await renderDocxPreviewHtml(row.file_data)
      response.json({ data: { format: "html", html } })
    } catch {
      response.status(422).json({ error: { code: "KNOWLEDGE_PREVIEW_FAILED", message: "Não foi possível gerar a prévia deste documento." } })
    }
  })

  router.post("/", upload.single("file"), async (request, response) => {
    const organizationId = request.user!.organizationId
    const input = createKnowledgeSchema.parse({
      title: request.body.title,
      documentType: request.body.documentType,
      content: request.body.content,
      orgScopes: parseJsonField(request.body.orgScopes),
      subjectScopes: parseJsonField(request.body.subjectScopes),
    })

    const file = request.file
    if (!file && !input.content) {
      throw new DomainError("Informe um texto ou envie um arquivo.", "KNOWLEDGE_SOURCE_REQUIRED", 400)
    }
    if (!canWriteDocument(await scopesOf(request), toTargets(input.orgScopes))) throw SCOPE_FORBIDDEN()

    const sourceType = file ? resolveSourceType(file.mimetype, file.originalname) : "TEXT"
    if (file && !(await fileContentAccepted(file.buffer, sourceType))) {
      throw new DomainError("O conteúdo do arquivo não corresponde ao tipo informado (aceitos: PDF, DOCX, TXT e JSON).", "KNOWLEDGE_FILE_TYPE_MISMATCH", 422)
    }
    const extractedContent = file ? await extractTextFromFile(file.buffer, sourceType) : input.content!
    if (!extractedContent) {
      throw new DomainError("Não foi possível extrair texto do arquivo enviado.", "KNOWLEDGE_EXTRACTION_FAILED", 422)
    }

    const client = await db.connect()
    try {
      await client.query("begin")
      const documentResult = await client.query<{ id: string }>(
        `insert into knowledge_documents(organization_id, title, document_type, source_type, original_filename, mime_type, file_size_bytes, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
        [
          organizationId,
          input.title,
          input.documentType,
          sourceType,
          file?.originalname ?? null,
          file ? knowledgeFileContentType(sourceType) : null,
          file?.size ?? null,
          request.user?.sub ?? null,
        ],
      )
      const documentId = documentResult.rows[0]!.id

      await client.query(
        `insert into knowledge_versions(organization_id, document_id, version, content, status, content_hash)
         values ($1,$2,1,$3,'DRAFT', $4)`,
        [organizationId, documentId, extractedContent, createHash("sha256").update(extractedContent).digest("hex")],
      )

      if (file) {
        await client.query(
          `insert into knowledge_files(knowledge_document_id, file_data, checksum) values ($1,$2,$3)`,
          [documentId, file.buffer, createHash("sha256").update(file.buffer).digest("hex")],
        )
      }

      await replaceScopes(client, documentId, input.orgScopes, input.subjectScopes)

      await client.query("commit")
      response.status(201).json({ data: { id: documentId, title: input.title, documentType: input.documentType, sourceType } })
    } catch (error) {
      await client.query("rollback")
      throw error
    } finally {
      client.release()
    }
  })

  router.patch("/:id", async (request, response) => {
    const organizationId = request.user!.organizationId
    const input = updateKnowledgeSchema.parse(request.body)
    const documentId = request.params.id
    const currentScopes = await loadDocumentScopes(db, organizationId, documentId)
    if (!currentScopes) return response.status(404).json(NOT_FOUND)
    const scopes = await scopesOf(request)
    if (!canWriteDocument(scopes, toTargets(currentScopes))) {
      return (await canReadDocument(db, scopes, currentScopes)) ? response.status(403).json({ error: { code: "KNOWLEDGE_SCOPE_FORBIDDEN", message: "Esta base vale para Grupos fora do seu escopo: só quem administra todos eles pode alterá-la." } }) : response.status(404).json(NOT_FOUND)
    }
    if (input.orgScopes && !canWriteDocument(scopes, toTargets(input.orgScopes))) throw SCOPE_FORBIDDEN()

    const client = await db.connect()
    try {
      await client.query("begin")

      const existing = await client.query(`select id from knowledge_documents where id = $1 and organization_id = $2 and deleted_at is null`, [documentId, organizationId])
      if (!existing.rows[0]) {
        await client.query("rollback")
        return response.status(404).json({ error: { code: "KNOWLEDGE_NOT_FOUND", message: "Base de conhecimento não encontrada." } })
      }

      // Qualquer alteração (título, tipo, conteúdo, status ou alcance) conta como atualização.
      await client.query(
        `update knowledge_documents set title = coalesce($1, title), document_type = coalesce($2, document_type), updated_at = now() where id = $3`,
        [input.title ?? null, input.documentType ?? null, documentId],
      )

      if (input.content) {
        const nextVersion = await client.query<{ next: number }>(
          `select coalesce(max(version), 0) + 1 next from knowledge_versions where document_id = $1`,
          [documentId],
        )
        await client.query(
          `insert into knowledge_versions(organization_id, document_id, version, content, status, content_hash)
           values ($1,$2,$3,$4,$5,$6)`,
          [
            organizationId,
            documentId,
            nextVersion.rows[0]!.next,
            input.content,
            input.status ?? "DRAFT",
            createHash("sha256").update(input.content).digest("hex"),
          ],
        )
      } else if (input.status) {
        await client.query(
          `update knowledge_versions set status = $1
           where document_id = $2 and version = (select max(version) from knowledge_versions where document_id = $2)`,
          [input.status, documentId],
        )
      }

      await replaceScopes(client, documentId, input.orgScopes, input.subjectScopes)

      await client.query("commit")
    } catch (error) {
      await client.query("rollback")
      throw error
    } finally {
      client.release()
    }

    // Checkpoint Registry: a publicação de uma versão dispara a extração + reconciliação (idempotente por versão). Nunca desfaz a
    // publicação: falha aqui fica no log e o administrador reprocessa em "Checkpoints da operação".
    if (input.status === "PUBLISHED") {
      try {
        await syncCheckpointRegistry(db, { organizationId, personId: request.user?.personId ?? null }, documentId)
      } catch (error) {
        registryLog.error({ documentId, error: error instanceof Error ? error.message : String(error) }, "checkpoint registry sync failed")
      }
    }

    const detail = await fetchDocumentDetail(db, organizationId, documentId)
    response.json({ data: detail })
  })

  router.delete("/:id", async (request, response) => {
    const organizationId = request.user!.organizationId
    const currentScopes = await loadDocumentScopes(db, organizationId, request.params.id)
    if (!currentScopes || !canWriteDocument(await scopesOf(request), toTargets(currentScopes))) return response.status(404).json(NOT_FOUND)
    const result = await db.query(
      `update knowledge_documents set deleted_at = now() where id = $1 and organization_id = $2 and deleted_at is null returning id`,
      [request.params.id, organizationId],
    )
    if (!result.rows[0]) return response.status(404).json({ error: { code: "KNOWLEDGE_NOT_FOUND", message: "Base de conhecimento não encontrada." } })
    response.status(204).send()
  })

  return router
}
