import { createHash } from "node:crypto"
import { Router } from "express"
import multer from "multer"
import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { inTransaction } from "../../../shared/infrastructure/database/transaction.js"
import { booleanParam, dateParam, listParam, orgScopeFilterSchema, respondList, searchParam, SqlFilter } from "../../../shared/presentation/list-query.js"
import { extractKnowledgeFile, fileContentAccepted, resolveSourceType, type ExtractedFile, type KnowledgeSourceType } from "../infrastructure/text-extractor.js"
import { ocrEngineFiles } from "../infrastructure/pdf-ocr/ocr-engine.js"
import { enqueueKnowledgeOcr, knowledgeOcrStatus } from "../application/knowledge-ocr-jobs.js"
import { chunkKnowledgeDocument } from "../domain/knowledge-chunking.js"
import { chunkDisplayTexts, withChunkPages } from "../domain/pdf-markdown/page-map.js"
import { PDF_MARKDOWN_VERSION } from "../domain/pdf-markdown/layout.js"
import { DocxPreviewTooLargeError, renderDocxPreviewHtml } from "../infrastructure/docx-preview.js"
import { knowledgeFileContentType, sendKnowledgeFile, sendKnowledgeImage } from "./knowledge-file-response.js"
import { loadKnowledgeFileImage, saveKnowledgeFileImages } from "../application/knowledge-file-images.js"
import { multerLimits } from "../../../shared/infrastructure/zip-guard.js"
import { IsolatedParserError } from "../../../shared/infrastructure/isolated-parser/isolated-parser.js"
import { canManageScope, getManageableScopes, normalizeScopedTarget, type ManageableScopes, type ScopedTarget } from "../../auth/application/manageable-scopes.js"
import { createLogger } from "../../../shared/infrastructure/logging/logger.js"
import { sessionUser } from "../../auth/presentation/session-user.js"
import { LIVE_FILE_QUERY, type LiveFileRow } from "../application/live-knowledge-version.js"
import {
  archiveKnowledge,
  auditKnowledge,
  discardKnowledgeDraft,
  archivedError,
  knowledgeContentHash,
  lifecycleOf,
  loadReprocessSource,
  lockKnowledgeDocument,
  parseKnowledgeExtraction,
  parseKnowledgeVersionConfig,
  processKnowledgeVersion,
  reactivateKnowledge,
  requestKnowledgePublication,
  retryKnowledgeVersion,
  revertKnowledgeVersion,
  saveKnowledgeDraft,
  type DraftChanges,
  type KnowledgeActor,
  type KnowledgeVersionConfig,
} from "../application/knowledge-versions.js"
import { canOrganizationWide } from "../../access/domain/access-decision.js"
import { openProductNodeIds } from "../../product-catalog/application/product-scope-assignments.js"
import { compareKnowledgeVersions, listKnowledgeVersions, loadKnowledgeVersion } from "../application/knowledge-version-history.js"

const log = createLogger("knowledge")
const uploadLog = createLogger("knowledge-upload")

/** Mudar para quais produtos a base vale exige alcance de organização (RN-027), em quem grava e também em quem faz a mudança valer. */
const canChangeProductsOf = (request: { access?: Parameters<typeof canOrganizationWide>[0] | undefined }) => Boolean(request.access && canOrganizationWide(request.access, "configuration.manage"))

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
/** No filtro da lista também entram as situações de uma base que ainda não tem versão em uso. */
const knowledgeListStatusSchema = z.enum(["DRAFT", "APPROVED", "PROCESSING", "FAILED", "PUBLISHED", "ARCHIVED"])

const listKnowledgeSchema = orgScopeFilterSchema.extend({
  search: searchParam,
  documentType: listParam(z.enum(["PROCEDURE", "MANUAL", "FAQ", "RULE", "FLOW"])),
  sourceType: listParam(z.enum(["TEXT", "PDF", "DOCX", "TXT", "JSON"])),
  status: listParam(knowledgeListStatusSchema),
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
  /** Com `status: PUBLISHED` em base arquivada: a confirmação explícita de que ela volta a valer. Sem isso, 409. */
  reactivate: z.boolean().optional(),
  orgScopes: z.array(orgScopeSchema).optional(),
  subjectScopes: z.array(subjectScopeSchema).optional(),
  changeSummary: z.string().trim().max(500).optional(),
})
const publishSchema = z.object({ changeSummary: z.string().trim().max(500).optional(), reactivate: z.boolean().optional() })
const revertSchema = publishSchema.extend({ discardDraft: z.boolean().optional() })
const retrySchema = z.object({ reactivate: z.boolean().optional() })
const reprocessSchema = z.object({ overwriteDraft: z.boolean().optional() })
const compareSchema = z.object({ from: z.string().uuid(), to: z.string().uuid() })

/**
 * Texto do arquivo lido no processo filho do parser (R-24). Estouro de memória/tempo ou morte do filho = arquivo recusado como
 * conteúdo inaceitável (o mesmo código da pré-varredura); erro do próprio parser = arquivo ilegível; fila cheia = tente de novo.
 */
async function extractUploadedFile(buffer: Buffer, sourceType: KnowledgeSourceType): Promise<ExtractedFile> {
  try {
    return await extractKnowledgeFile(buffer, sourceType)
  } catch (error) {
    if (!(error instanceof IsolatedParserError)) throw error
    uploadLog.warn({ sourceType, reason: error.reason, detail: error.message }, "knowledge file refused by isolated parser")
    if (error.reason === "BUSY") throw new DomainError("Há muitos arquivos sendo lidos agora. Tente de novo em instantes.", "KNOWLEDGE_EXTRACTION_BUSY", 503)
    if (error.reason === "FAILED") throw new DomainError("Não foi possível extrair texto do arquivo enviado.", "KNOWLEDGE_EXTRACTION_FAILED", 422)
    throw new DomainError(
      "O arquivo foi recusado: a leitura passou do limite de memória ou de tempo. Confira se ele não está corrompido ou envie uma versão menor.",
      "KNOWLEDGE_FILE_TYPE_MISMATCH",
      422,
    )
  }
}

function parseJsonField(value: unknown) {
  if (typeof value !== "string" || value.length === 0) return undefined
  try {
    return JSON.parse(value)
  } catch {
    throw new DomainError("Escopo inválido.", "INVALID_SCOPE_JSON", 400)
  }
}

// Uma linha por documento. O status é o da versão EM USO (PEN-008): sem versão decidida, o da mais recente. O resumo sai de quem define o
// status, com espaços normalizados. A edição em andamento e as atualizações aparecem à parte. Autor vem de created_by → user_accounts →
// people; fica nulo em registros antigos sem created_by (a UI mostra "não informado", não inventa nome).
const EXCERPT_LENGTH = 280

const KNOWLEDGE_SELECT = `
  select
    d.id, d.title, d.document_type "documentType", d.source_type "sourceType",
    d.original_filename "originalFilename", d.mime_type "mimeType", d.file_size_bytes "fileSizeBytes",
    d.created_at "createdAt", d.updated_at "updatedAt",
    p.name "authorName",
    coalesce(live.status, lv.status, 'DRAFT') status,
    left(regexp_replace(coalesce(live.content, lv.content), '\\s+', ' ', 'g'), ${EXCERPT_LENGTH}) excerpt,
    case when live.status = 'PUBLISHED' then live.version end "inUseVersion",
    case when lv.status in ('DRAFT', 'APPROVED') and lv.version > coalesce(live.version, 0) then lv.version end "draftVersion",
    upd.version "updateVersion", upd.status "updateStatus",
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
    select v.status, v.content, v.version from knowledge_versions v where v.document_id = d.id order by v.version desc limit 1
  ) lv on true
  left join lateral (
    select v.status, v.content, v.version from knowledge_versions v where v.document_id = d.id and v.status in ('PUBLISHED', 'ARCHIVED') order by v.version desc limit 1
  ) live on true
  left join lateral (
    select v.status, v.version from knowledge_versions v where v.document_id = d.id and v.status in ('PROCESSING', 'FAILED') and v.version > coalesce(live.version, 0) order by v.version desc limit 1
  ) upd on true
  left join user_accounts ua on ua.id = d.created_by
  left join people p on p.id = ua.person_id
  where d.organization_id = $1 and d.deleted_at is null
`

type DetailVersionRow = {
  id: string
  version: number
  status: string
  reactivation_confirmed_at: Date | null
  reactivation_confirmed_by_name: string | null
  text_status: string
  config: unknown
  file_id: string | null
  change_summary: string | null
  created_at: Date
  created_by_name: string | null
  updated_at: Date | null
  updated_by_name: string | null
  publish_requested_at: Date | null
  publish_requested_by_name: string | null
  published_at: Date | null
  published_by_name: string | null
  processing_error_code: string | null
  processing_error_message: string | null
}

/**
 * Detalhe da base: a versão EM USO pela IA é o destaque; o rascunho e as atualizações em processamento ou com falha vêm à parte
 * (PEN-008). `editable` é o que o formulário abre: o rascunho, a atualização com falha, a versão em uso ou a mais recente.
 * `canReadVersion` = se quem pede alcança a configuração de uma versão: a mesma regra de `readableVersion` e do histórico. Rascunho, última versão ou versão editável fora desse alcance saem só com número e situação (`restricted`), sem texto,
 * extração nem configuração — antes o detalhe trazia o texto que a rota da versão recusava com KNOWLEDGE_VERSION_RESTRICTED.
 */
async function fetchDocumentDetail(db: Database, organizationId: string, id: string, canReadVersion: (config: KnowledgeVersionConfig) => Promise<boolean>) {
  const document = await db.query(`${KNOWLEDGE_SELECT} and d.id = $2`, [organizationId, id])
  if (!document.rows[0]) return null
  const rows = (await db.query<DetailVersionRow>(
    `select id, version, status, text_status, config, file_id, change_summary, created_at, created_by_name, updated_at, updated_by_name, publish_requested_at, publish_requested_by_name, reactivation_confirmed_at, reactivation_confirmed_by_name, published_at, published_by_name, processing_error_code, processing_error_message
       from knowledge_versions where document_id = $1 order by version desc`,
    [id],
  )).rows
  const { live, latest, draft, updates } = lifecycleOf(rows)
  const editableRow = draft ?? updates.find((row) => row.status === "FAILED") ?? live ?? latest
  const restricted = new Set<string>()
  for (const row of new Set([latest, draft, editableRow])) {
    const config = row ? parseKnowledgeVersionConfig(row.config) : null
    if (row && config && !(await canReadVersion(config))) restricted.add(row.id)
  }
  const wanted = [...new Set([live, latest, draft, editableRow].flatMap((row) => (row && !restricted.has(row.id) ? [row.id] : [])))]
  const contents = new Map(wanted.length === 0 ? [] : (await db.query<{ id: string; content: string; extraction: unknown }>(`select id, content, extraction from knowledge_versions where id = any($1::uuid[])`, [wanted])).rows.map((row) => [row.id, row]))
  const contentOf = (row: { id: string } | null) => (row ? (contents.get(row.id)?.content ?? "") : "")
  const extractionOf = (row: { id: string } | null) => (row ? parseKnowledgeExtraction(contents.get(row.id)?.extraction) : null)
  const configOf = (row: { id: string; config: unknown } | null) => (row && restricted.has(row.id) ? null : parseKnowledgeVersionConfig(row?.config))
  const isRestricted = (row: { id: string }) => restricted.has(row.id)
  return {
    ...document.rows[0],
    // Os produtos que valem agora; os do rascunho estão na configuração dele e só valem quando a versão entrar em uso.
    inUseProductNodeIds: await openProductNodeIds(db, organizationId, "KNOWLEDGE_DOCUMENT", id),
    latestVersion: latest ? { version: latest.version, content: contentOf(latest), status: latest.status, createdAt: latest.created_at, restricted: isRestricted(latest) } : null,
    inUse: live?.status === "PUBLISHED"
      ? { id: live.id, version: live.version, status: live.status, content: contentOf(live), extraction: extractionOf(live), publishedAt: live.published_at, publishedByName: live.published_by_name, changeSummary: live.change_summary }
      : null,
    archived: live?.status === "ARCHIVED" ? { id: live.id, version: live.version } : null,
    draft: draft
      ? isRestricted(draft)
        ? { id: draft.id, version: draft.version, status: draft.status, content: "", extraction: null, config: null, textAvailable: false, changeSummary: null, updatedAt: draft.updated_at ?? draft.created_at, updatedByName: draft.updated_by_name ?? draft.created_by_name, ocr: null, restricted: true }
        : { id: draft.id, version: draft.version, status: draft.status, content: contentOf(draft), extraction: extractionOf(draft), config: configOf(draft), textAvailable: draft.text_status === "AVAILABLE", changeSummary: draft.change_summary, updatedAt: draft.updated_at ?? draft.created_at, updatedByName: draft.updated_by_name ?? draft.created_by_name, ocr: await knowledgeOcrStatus(db, draft.id), restricted: false }
      : null,
    updates: updates.map((row) => ({ id: row.id, version: row.version, status: row.status, requestedAt: row.publish_requested_at, requestedByName: row.publish_requested_by_name, errorCode: row.processing_error_code, errorMessage: row.processing_error_message , reactivationConfirmedAt: row.reactivation_confirmed_at, reactivationConfirmedByName: row.reactivation_confirmed_by_name })),
    editable: editableRow ? { versionId: editableRow.id, version: editableRow.version, status: editableRow.status, content: contentOf(editableRow), extraction: extractionOf(editableRow), config: configOf(editableRow), textAvailable: !isRestricted(editableRow) && editableRow.text_status === "AVAILABLE", restricted: isRestricted(editableRow) } : null,
  }
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
const WRITE_SCOPE_FORBIDDEN = () => new DomainError("Esta base vale para Grupos fora do seu escopo: só quem administra todos eles pode alterá-la.", "KNOWLEDGE_SCOPE_FORBIDDEN", 403)
const SCOPE_FORBIDDEN = () => new DomainError("Você só pode cadastrar bases nos Grupos do seu escopo (base para todos os Grupos exige escopo de organização).", "KNOWLEDGE_SCOPE_FORBIDDEN", 403)

const toDocumentScopes = (config: KnowledgeVersionConfig): DocumentScope[] =>
  config.orgScopes.map((scope) => ({ scopeType: scope.scopeType, teamId: scope.teamId ?? null, subteamId: scope.subteamId ?? null }))

const toTargets = (scopes: readonly { scopeType: string; teamId?: string | null | undefined; subteamId?: string | null | undefined }[]): ScopedTarget[] =>
  scopes.map((scope) => ({ scopeType: scope.scopeType, teamId: scope.teamId ?? null, subteamId: scope.subteamId ?? null }))

/** Alcances novos com o Grupo-pai REAL de cada Subgrupo (normalizeScopedTarget) — `teamId` de outro Grupo é recusado. */
async function normalizeOrgScopes(db: Pick<Database, "query">, organizationId: string, orgScopes: z.infer<typeof orgScopeSchema>[]): Promise<z.infer<typeof orgScopeSchema>[]> {
  const normalized: z.infer<typeof orgScopeSchema>[] = []
  for (const scope of toTargets(orgScopes)) {
    const target = await normalizeScopedTarget(db, organizationId, scope)
    if (!target) throw new DomainError("O Subgrupo informado não existe neste Grupo.", "KNOWLEDGE_SCOPE_INVALID", 422)
    normalized.push({ scopeType: target.scopeType as z.infer<typeof orgScopeSchema>["scopeType"], ...(target.teamId ? { teamId: target.teamId } : {}), ...(target.subteamId ? { subteamId: target.subteamId } : {}) })
  }
  return normalized
}

/** `inlineProcessing: false` deixa o processamento só para a varredura (as provas controlam quando cada versão fica pronta). */
export function createKnowledgeRouter(db: Database, options: { inlineProcessing?: boolean } = {}) {
  const router = Router()
  const actorOf = async (request: { user?: { organizationId: string; personId?: string; sub: string } }): Promise<KnowledgeActor> => {
    const organizationId = sessionUser(request).organizationId
    const personId = request.user?.personId ?? null
    const name = personId ? ((await db.query<{ name: string }>(`select name from people where id = $1 and organization_id = $2`, [personId, organizationId])).rows[0]?.name ?? null) : null
    return { organizationId, personId, name }
  }
  /** Processa na hora; qualquer problema fica na própria versão ou com a varredura, nunca na resposta de quem pediu. */
  const processNow = async (versionId: string, actorPersonId: string | null) => {
    if (options.inlineProcessing === false) return
    await processKnowledgeVersion(db, versionId, { actorPersonId }).catch((error: unknown) => log.error({ versionId, error: error instanceof Error ? error.message : String(error) }, "knowledge version processing failed"))
  }
  const scopesOf = (request: { user?: { organizationId: string; sub: string } }) => getManageableScopes(db, sessionUser(request), "knowledge.manage")
  /** Se quem pede alcança a configuração de uma versão: a regra do histórico e de `readableVersion`, também no detalhe. */
  const versionReaderOf = async (request: { user?: { organizationId: string; sub: string } }) => {
    const scopes = await scopesOf(request)
    return (config: KnowledgeVersionConfig) => canReadDocument(db, scopes, toDocumentScopes(config))
  }
  /** Documento legível pelo administrador da sessão (null = 404). */
  const readable = async (request: { user?: { organizationId: string; sub: string } }, id: string) => {
    const documentScopes = await loadDocumentScopes(db, sessionUser(request).organizationId, id)
    if (!documentScopes) return null
    return (await canReadDocument(db, await scopesOf(request), documentScopes)) ? documentScopes : null
  }

  router.get("/", async (request, response) => {
    const organizationId = sessionUser(request).organizationId
    const input = listKnowledgeSchema.parse(request.query)
    const filter = new SqlFilter([organizationId])
      .search(input.search, ["q.title", 'q."originalFilename"'])
      .in('q."documentType"', input.documentType)
      .in('q."sourceType"', input.sourceType)
      .dateRange('q."createdAt"', input.createdFrom, input.createdTo)
    // O filtro acha a base pela versão em uso e também pelo que está por cima dela: rascunho em edição ou atualização em processamento ou com falha.
    if (input.status?.length) {
      const statuses = filter.param(input.status)
      filter.add(`(q.status = any(${statuses}::text[]) or q."updateStatus" = any(${statuses}::text[]) or (q."draftVersion" is not null and 'DRAFT' = any(${statuses}::text[])))`)
    }
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
    const detail = await fetchDocumentDetail(db, sessionUser(request).organizationId, request.params.id, await versionReaderOf(request))
    if (!detail) return response.status(404).json(NOT_FOUND)
    response.json({ data: detail })
  })

  // Arquivo original (PDF/DOCX/TXT/JSON) exatamente como foi enviado — usado pela prévia e pelo
  // download. Passa pelo mesmo requireAdmin do router; não existe URL pública para o binário.
  router.get("/:id/file", async (request, response) => {
    if (!(await readable(request, request.params.id))) return response.status(404).json(NOT_FOUND)
    const organizationId = sessionUser(request).organizationId
    const row = (await db.query<LiveFileRow>(LIVE_FILE_QUERY, [request.params.id, organizationId])).rows[0]
    if (!row) {
      return response.status(404).json({ error: { code: "KNOWLEDGE_FILE_NOT_FOUND", message: "Arquivo original não encontrado para esta base." } })
    }
    sendKnowledgeFile(response, { sourceType: row.source_type, filename: row.original_filename ?? `${row.title}.bin`, data: row.file_data })
  })

  // Prévia em HTML gerada do arquivo original (hoje só DOCX, via mammoth — mesma lib já usada na
  // extração de texto). O arquivo original nunca é alterado; a conversão acontece a cada leitura.
  router.get("/:id/preview", async (request, response) => {
    if (!(await readable(request, request.params.id))) return response.status(404).json(NOT_FOUND)
    const organizationId = sessionUser(request).organizationId
    const row = (await db.query<LiveFileRow>(LIVE_FILE_QUERY, [request.params.id, organizationId])).rows[0]
    if (!row) {
      return response.status(404).json({ error: { code: "KNOWLEDGE_FILE_NOT_FOUND", message: "Arquivo original não encontrado para esta base." } })
    }
    if (row.source_type !== "DOCX") {
      return response.status(415).json({ error: { code: "KNOWLEDGE_PREVIEW_UNSUPPORTED", message: "Este formato não tem prévia em HTML." } })
    }
    try {
      const html = await renderDocxPreviewHtml(row.file_data)
      response.json({ data: { format: "html", html } })
    } catch (error) {
      if (error instanceof DocxPreviewTooLargeError) return response.status(422).json({ error: { code: "KNOWLEDGE_PREVIEW_TOO_LARGE", message: error.message } })
      response.status(422).json({ error: { code: "KNOWLEDGE_PREVIEW_FAILED", message: "Não foi possível gerar a prévia deste documento." } })
    }
  })

  router.post("/", upload.single("file"), async (request, response) => {
    const organizationId = sessionUser(request).organizationId
    // Sem corpo multipart/JSON o Express deixa `request.body` indefinido: vira erro de validação (400), não TypeError (500).
    const body = (request.body ?? {}) as Record<string, unknown>
    const input = createKnowledgeSchema.parse({
      title: body.title,
      documentType: body.documentType,
      content: body.content,
      orgScopes: parseJsonField(body.orgScopes),
      subjectScopes: parseJsonField(body.subjectScopes),
    })

    const file = request.file
    if (!file && !input.content) {
      throw new DomainError("Informe um texto ou envie um arquivo.", "KNOWLEDGE_SOURCE_REQUIRED", 400)
    }
    input.orgScopes = await normalizeOrgScopes(db, organizationId, input.orgScopes)
    if (!canWriteDocument(await scopesOf(request), toTargets(input.orgScopes))) throw SCOPE_FORBIDDEN()

    const sourceType = file ? resolveSourceType(file.mimetype, file.originalname) : "TEXT"
    if (file && !(await fileContentAccepted(file.buffer, sourceType))) {
      throw new DomainError("O conteúdo do arquivo não corresponde ao tipo informado (aceitos: PDF, DOCX, TXT e JSON).", "KNOWLEDGE_FILE_TYPE_MISMATCH", 422)
    }
    const extracted = file ? await extractUploadedFile(file.buffer, sourceType) : { text: input.content!, extraction: null, images: [], scannedPages: [] }
    const extractedContent = extracted.text
    // Páginas digitalizadas: o texto delas chega depois, pela leitura em segundo plano (OCR). Sem essa leitura possível, o PDF sem texto é recusado.
    const scannedPages = ocrEngineFiles() ? extracted.scannedPages : []
    if (!extractedContent && scannedPages.length === 0) {
      throw new DomainError(sourceType === "PDF" ? "Este PDF não tem texto para a IA ler: as páginas parecem ser imagens digitalizadas. Envie um PDF com texto selecionável ou digite o conteúdo." : "Não foi possível extrair texto do arquivo enviado.", "KNOWLEDGE_EXTRACTION_FAILED", 422)
    }

    const actor = await actorOf(request)
    const documentId = await inTransaction(db, async (client) => {
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

      const checksum = file ? createHash("sha256").update(file.buffer).digest("hex") : null
      const fileId = file
        ? (await client.query<{ id: string }>(`insert into knowledge_files(knowledge_document_id, file_data, checksum) values ($1,$2,$3) returning id`, [documentId, file.buffer, checksum])).rows[0]!.id
        : null
      if (fileId) await saveKnowledgeFileImages(client, fileId, extracted.images)
      const config: KnowledgeVersionConfig = {
        title: input.title,
        documentType: input.documentType,
        sourceType,
        file: file && fileId ? { id: fileId, filename: file.originalname, mimeType: knowledgeFileContentType(sourceType), sizeBytes: file.size, checksum: checksum! } : null,
        orgScopes: input.orgScopes.map((scope) => ({ scopeType: scope.scopeType, teamId: scope.teamId ?? null, subteamId: scope.subteamId ?? null })),
        subjectScopes: input.subjectScopes.map((scope) => ({ scopeType: scope.scopeType, subjectId: scope.subjectId ?? null })),
        productNodeIds: [],
      }
      const versionId = (await client.query<{ id: string }>(
        `insert into knowledge_versions(organization_id, document_id, version, content, status, content_hash, config, file_id, origin, created_by_name, extraction, text_status)
         values ($1,$2,1,$3,'DRAFT',$4,$5,$6,'CREATE',$7,$8,$9) returning id`,
        [organizationId, documentId, extractedContent, knowledgeContentHash(extractedContent), JSON.stringify(config), fileId, actor.name, extracted.extraction ? JSON.stringify(extracted.extraction) : null, extractedContent.trim() ? "AVAILABLE" : "UNAVAILABLE"],
      )).rows[0]!.id
      if (fileId && scannedPages.length > 0) await enqueueKnowledgeOcr(client, { organizationId, documentId, versionId, fileId, pages: scannedPages.length, content: extractedContent, actor })

      await replaceScopes(client, documentId, input.orgScopes, input.subjectScopes)
      return documentId
    })
    response.status(201).json({ data: { id: documentId, title: input.title, documentType: input.documentType, sourceType, ocr: scannedPages.length > 0 ? { status: "QUEUED", pages: scannedPages.length } : null } })
  })

  router.patch("/:id", async (request, response) => {
    const organizationId = sessionUser(request).organizationId
    const input = updateKnowledgeSchema.parse(request.body)
    const documentId = request.params.id
    const currentScopes = await loadDocumentScopes(db, organizationId, documentId)
    if (!currentScopes) return response.status(404).json(NOT_FOUND)
    const scopes = await scopesOf(request)
    // Editar, aprovar ou publicar mexe no rascunho: o alcance dele entra na conta, como em POST /:id/publish. Antes, `status: PUBLISHED`
    // por aqui publicava um rascunho de alcance maior (preparado por quem administra a organização) conferindo só o alcance em uso.
    const touchesDraft = input.status !== "ARCHIVED" || [input.title, input.documentType, input.content, input.orgScopes, input.subjectScopes, input.changeSummary].some((value) => value !== undefined)
    if (!canWriteDocument(scopes, [...toTargets(currentScopes), ...(touchesDraft ? await draftTargets(documentId) : [])])) {
      return (await canReadDocument(db, scopes, currentScopes)) ? response.status(403).json({ error: { code: "KNOWLEDGE_SCOPE_FORBIDDEN", message: "Esta base vale para Grupos fora do seu escopo: só quem administra todos eles pode alterá-la." } }) : response.status(404).json(NOT_FOUND)
    }
    if (input.orgScopes) input.orgScopes = await normalizeOrgScopes(db, organizationId, input.orgScopes)
    if (input.orgScopes && !canWriteDocument(scopes, toTargets(input.orgScopes))) throw SCOPE_FORBIDDEN()

    const actor = await actorOf(request)
    const outcome = await inTransaction(db, async (client) => {
      if (!(await lockKnowledgeDocument(client, organizationId, documentId))) return null
      await assertWritableLocked(client, request, documentId, touchesDraft)
      // Editar grava o rascunho e não muda o que a IA usa (PEN-008). `status` continua aceito por quem já chama a API: publicar vira um
      // pedido de publicação; arquivar e reativar valem como as ações próprias; "Aprovado" é só uma marca do rascunho (PEN-009). Em base
      // arquivada, `status: PUBLISHED` nunca reativa sozinho: exige `reactivate: true`, como a ação própria.
      const changes: DraftChanges = {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.documentType !== undefined ? { documentType: input.documentType } : {}),
        ...(input.content !== undefined ? { content: input.content } : {}),
        ...(input.orgScopes ? { orgScopes: input.orgScopes.map((scope) => ({ scopeType: scope.scopeType, teamId: scope.teamId ?? null, subteamId: scope.subteamId ?? null })) } : {}),
        ...(input.subjectScopes ? { subjectScopes: input.subjectScopes.map((scope) => ({ scopeType: scope.scopeType, subjectId: scope.subjectId ?? null })) } : {}),
        ...(input.changeSummary !== undefined ? { changeSummary: input.changeSummary } : {}),
      }
      if (Object.keys(changes).length > 0) await saveKnowledgeDraft(client, organizationId, documentId, changes, actor)
      const { live, draft } = lifecycleOf((await client.query<{ id: string; version: number; status: string }>(`select id, version, status from knowledge_versions where document_id = $1 order by version desc`, [documentId])).rows)
      if (input.status === "ARCHIVED") await archiveKnowledge(client, documentId, actor)
      if (input.status === "PUBLISHED") {
        if (draft) return { processing: (await requestKnowledgePublication(client, organizationId, documentId, actor, { reactivate: input.reactivate, canChangeProducts: canChangeProductsOf(request) })).versionId }
        if (live?.status === "ARCHIVED") {
          if (!input.reactivate) throw archivedError()
          return { processing: (await reactivateKnowledge(client, documentId, actor)).processingVersionId }
        }
      }
      if ((input.status === "DRAFT" || input.status === "APPROVED") && draft) await client.query(`update knowledge_versions set status = $2 where id = $1`, [draft.id, input.status])
      return { processing: null }
    })
    if (!outcome) return response.status(404).json({ error: { code: "KNOWLEDGE_NOT_FOUND", message: "Base de conhecimento não encontrada." } })
    if (outcome.processing) await processNow(outcome.processing, request.user?.personId ?? null)

    const detail = await fetchDocumentDetail(db, organizationId, documentId, await versionReaderOf(request))
    response.json({ data: detail })
  })

  /** Quem altera precisa alcançar a base toda; a versão em questão entra nessa conta. Sem resposta = já respondeu (404 ou 403). */
  const writable = async (request: Parameters<typeof scopesOf>[0], response: { status: (code: number) => { json: (body: unknown) => unknown } }, documentId: string, extra: readonly ScopedTarget[] = []): Promise<boolean> => {
    const currentScopes = await loadDocumentScopes(db, sessionUser(request).organizationId, documentId)
    if (!currentScopes) {
      response.status(404).json(NOT_FOUND)
      return false
    }
    const scopes = await scopesOf(request)
    if (!canWriteDocument(scopes, [...toTargets(currentScopes), ...extra])) {
      if (await canReadDocument(db, scopes, currentScopes)) response.status(403).json({ error: { code: "KNOWLEDGE_SCOPE_FORBIDDEN", message: "Esta base vale para Grupos fora do seu escopo: só quem administra todos eles pode alterá-la." } })
      else response.status(404).json(NOT_FOUND)
      return false
    }
    return true
  }

  /**
   * Alcances do que a escrita no rascunho parte (a mesma escolha de `saveKnowledgeDraft`): o rascunho em edição; sem ele, a atualização
   * que falhou (editar cria um rascunho com o texto e o alcance dela); sem versão em uso, a mais recente. Publicar, editar, descartar e
   * reverter descartando exigem alcançar também isso. A versão em uso já entra pelo alcance atual da base.
   */
  const draftTargets = async (documentId: string, queryable: Pick<Database, "query"> = db): Promise<ScopedTarget[]> => {
    const rows = (await queryable.query<{ version: number; status: string; config: unknown }>(`select version, status, config from knowledge_versions where document_id = $1 order by version desc`, [documentId])).rows
    const { live, latest, draft, updates } = lifecycleOf(rows)
    const base = draft ?? updates.find((row) => row.status === "FAILED") ?? (live ? null : latest)
    return toTargets(parseKnowledgeVersionConfig(base?.config)?.orgScopes ?? [])
  }
  /**
   * Com a base já travada (`lockKnowledgeDocument`): o alcance em uso e o do rascunho relidos na mesma transação da escrita. A conferência
   * de antes da transação responde 403/404 cedo, mas quem administra a organização pode ampliar o rascunho entre ela e a escrita.
   */
  const assertWritableLocked = async (client: Pick<Database, "query">, request: Parameters<typeof scopesOf>[0], documentId: string, withDraft: boolean) => {
    const current = await loadDocumentScopes(client, sessionUser(request).organizationId, documentId)
    if (!current) throw new DomainError("Base de conhecimento não encontrada.", "KNOWLEDGE_NOT_FOUND", 404)
    if (!canWriteDocument(await scopesOf(request), [...toTargets(current), ...(withDraft ? await draftTargets(documentId, client) : [])])) throw WRITE_SCOPE_FORBIDDEN()
  }

  const respondDetail = async (request: Parameters<typeof scopesOf>[0], response: { json: (body: unknown) => unknown }, documentId: string) => {
    response.json({ data: await fetchDocumentDetail(db, sessionUser(request).organizationId, documentId, await versionReaderOf(request)) })
  }

  // Trocar o arquivo: entra no rascunho, com o texto extraído. Se não houver como extrair, o arquivo fica no rascunho sem texto: dá para
  // digitar o texto, e publicar sem ele falha no processamento, sem tirar do ar a versão em uso.
  router.post("/:id/draft/file", upload.single("file"), async (request, response) => {
    const documentId = String(request.params.id)
    if (!(await writable(request, response, documentId, await draftTargets(documentId)))) return
    const organizationId = sessionUser(request).organizationId
    const file = request.file
    if (!file) throw new DomainError("Envie um arquivo.", "KNOWLEDGE_SOURCE_REQUIRED", 400)
    const sourceType = resolveSourceType(file.mimetype, file.originalname)
    if (!(await fileContentAccepted(file.buffer, sourceType))) throw new DomainError("O conteúdo do arquivo não corresponde ao tipo informado (aceitos: PDF, DOCX, TXT e JSON).", "KNOWLEDGE_FILE_TYPE_MISMATCH", 422)
    const extracted = await extractUploadedFile(file.buffer, sourceType).catch((error: unknown) => {
      // Recusado pelo teto de memória ou de tempo, ou leitores ocupados: o arquivo não entra. Erro do próprio parser mantém o arquivo, sem texto novo.
      if (error instanceof DomainError && error.code !== "KNOWLEDGE_EXTRACTION_FAILED") throw error
      return null
    })
    const scannedPages = extracted && ocrEngineFiles() ? extracted.scannedPages : []
    const actor = await actorOf(request)
    await inTransaction(db, async (client) => {
      if (!(await lockKnowledgeDocument(client, organizationId, documentId))) throw new DomainError("Base de conhecimento não encontrada.", "KNOWLEDGE_NOT_FOUND", 404)
      await assertWritableLocked(client, request, documentId, true)
      const checksum = createHash("sha256").update(file.buffer).digest("hex")
      const fileId = (await client.query<{ id: string }>(`insert into knowledge_files(knowledge_document_id, file_data, checksum) values ($1,$2,$3) returning id`, [documentId, file.buffer, checksum])).rows[0]!.id
      await saveKnowledgeFileImages(client, fileId, extracted?.images ?? [])
      const draft = await saveKnowledgeDraft(client, organizationId, documentId, { file: { file: { id: fileId, filename: file.originalname, mimeType: knowledgeFileContentType(sourceType), sizeBytes: file.size, checksum }, sourceType, extractedText: extracted?.text || null, extraction: extracted?.extraction ?? null } }, actor)
      if (draft && scannedPages.length > 0) await enqueueKnowledgeOcr(client, { organizationId, documentId, versionId: draft.versionId, fileId, pages: scannedPages.length, content: extracted?.text ?? "", actor })
    })
    await respondDetail(request, response, documentId)
  })

  // Reprocessar o arquivo original com a conversão atual. Nada vale sozinho: o resultado entra num rascunho, para conferir e publicar. Versões
  // antigas e o arquivo não mudam. Por cima de um rascunho com outro texto, só com a confirmação de que ele será substituído.
  router.post("/:id/reprocess", async (request, response) => {
    const documentId = String(request.params.id)
    if (!(await writable(request, response, documentId, await draftTargets(documentId)))) return
    const input = reprocessSchema.parse(request.body ?? {})
    const organizationId = sessionUser(request).organizationId
    const source = await loadReprocessSource(db, organizationId, documentId)
    if (!source) throw new DomainError("Esta base não tem arquivo original para reprocessar.", "KNOWLEDGE_REPROCESS_NO_FILE", 409)
    if (source.config.sourceType !== "PDF") throw new DomainError("O reprocessamento vale para bases em PDF.", "KNOWLEDGE_REPROCESS_UNSUPPORTED", 409)
    if (!(await fileContentAccepted(source.data, "PDF"))) throw new DomainError("O arquivo original não passou na conferência de segurança.", "KNOWLEDGE_FILE_TYPE_MISMATCH", 422)
    const extracted = await extractUploadedFile(source.data, "PDF")
    const scannedPages = ocrEngineFiles() ? extracted.scannedPages : []
    if (!extracted.text && scannedPages.length === 0) throw new DomainError("Nenhuma página deste PDF tem texto para a IA ler. Nada foi alterado.", "KNOWLEDGE_EXTRACTION_FAILED", 422)
    if (source.hasDraft && source.draftContent !== extracted.text && !input.overwriteDraft) throw new DomainError("Há um rascunho em edição. Reprocessar substitui o texto dele: confirme para continuar.", "KNOWLEDGE_DRAFT_PENDING", 409)
    const actor = await actorOf(request)
    const saved = await inTransaction(db, async (client) => {
      if (!(await lockKnowledgeDocument(client, organizationId, documentId))) throw new DomainError("Base de conhecimento não encontrada.", "KNOWLEDGE_NOT_FOUND", 404)
      await assertWritableLocked(client, request, documentId, true)
      // Algo mudou enquanto o arquivo era lido: quem pediu vê a situação nova antes de decidir de novo.
      const latest = (await client.query<{ version: number }>(`select version from knowledge_versions where document_id = $1 order by version desc limit 1`, [documentId])).rows[0]
      if (latest?.version !== source.latestVersion) throw new DomainError("A base mudou enquanto o arquivo era reprocessado. Confira e tente de novo.", "KNOWLEDGE_REPROCESS_STALE", 409)
      await saveKnowledgeFileImages(client, source.fileRef.id, extracted.images)
      const draft = await saveKnowledgeDraft(client, organizationId, documentId, { file: { file: source.fileRef, sourceType: "PDF", extractedText: extracted.text, extraction: extracted.extraction }, changeSummary: `Reprocessamento do arquivo original (${extracted.extraction?.version ?? "texto corrido"}).` }, actor)
      // As páginas digitalizadas são lidas de novo do começo, num rascunho que já existe (o reprocessamento sempre cria ou atualiza um).
      const draftId = draft?.versionId ?? (await client.query<{ id: string }>(`select id from knowledge_versions where document_id = $1 and status in ('DRAFT', 'APPROVED') order by version desc limit 1`, [documentId])).rows[0]?.id
      if (draftId && scannedPages.length > 0) await enqueueKnowledgeOcr(client, { organizationId, documentId, versionId: draftId, fileId: source.fileRef.id, pages: scannedPages.length, content: extracted.text, actor })
      await auditKnowledge(client, actor, "KNOWLEDGE_VERSION_REPROCESSED", documentId, { versionId: draft?.versionId ?? null, version: draft?.version ?? null, converter: extracted.extraction?.version ?? null, changed: Boolean(draft?.changed), ocrPages: scannedPages.length })
      return draft
    })
    const detail = await fetchDocumentDetail(db, organizationId, documentId, await versionReaderOf(request))
    response.json({ data: { ...detail, reprocessed: { changed: Boolean(saved?.changed), converter: extracted.extraction?.version ?? PDF_MARKDOWN_VERSION, ocrPages: scannedPages.length } } })
  })

  // Pede a disponibilização do rascunho para todos os consumidores, sem republicá-los. A API processa na hora; a varredura do processamento é a garantia.
  router.post("/:id/publish", async (request, response) => {
    const documentId = request.params.id!
    const input = publishSchema.parse(request.body ?? {})
    if (!(await writable(request, response, documentId, await draftTargets(documentId)))) return
    const organizationId = sessionUser(request).organizationId
    const actor = await actorOf(request)
    const requested = await inTransaction(db, async (client) => {
      if (!(await lockKnowledgeDocument(client, organizationId, documentId))) throw new DomainError("Base de conhecimento não encontrada.", "KNOWLEDGE_NOT_FOUND", 404)
      await assertWritableLocked(client, request, documentId, true)
      return requestKnowledgePublication(client, organizationId, documentId, actor, { ...input, canChangeProducts: canChangeProductsOf(request) })
    })
    await processNow(requested.versionId, request.user?.personId ?? null)
    await respondDetail(request, response, documentId)
  })

  router.post("/:id/archive", async (request, response) => {
    const documentId = request.params.id!
    if (!(await writable(request, response, documentId))) return
    const organizationId = sessionUser(request).organizationId
    const actor = await actorOf(request)
    await inTransaction(db, async (client) => {
      if (!(await lockKnowledgeDocument(client, organizationId, documentId))) throw new DomainError("Base de conhecimento não encontrada.", "KNOWLEDGE_NOT_FOUND", 404)
      await archiveKnowledge(client, documentId, actor)
    })
    await respondDetail(request, response, documentId)
  })

  router.post("/:id/reactivate", async (request, response) => {
    const documentId = request.params.id!
    if (!(await writable(request, response, documentId))) return
    const organizationId = sessionUser(request).organizationId
    const actor = await actorOf(request)
    const { processingVersionId } = await inTransaction(db, async (client) => {
      if (!(await lockKnowledgeDocument(client, organizationId, documentId))) throw new DomainError("Base de conhecimento não encontrada.", "KNOWLEDGE_NOT_FOUND", 404)
      return reactivateKnowledge(client, documentId, actor)
    })
    if (processingVersionId) await processNow(processingVersionId, request.user?.personId ?? null)
    await respondDetail(request, response, documentId)
  })

  router.post("/:id/draft/discard", async (request, response) => {
    const documentId = request.params.id!
    if (!(await writable(request, response, documentId, await draftTargets(documentId)))) return
    const organizationId = sessionUser(request).organizationId
    const actor = await actorOf(request)
    await inTransaction(db, async (client) => {
      if (!(await lockKnowledgeDocument(client, organizationId, documentId))) throw new DomainError("Base de conhecimento não encontrada.", "KNOWLEDGE_NOT_FOUND", 404)
      await assertWritableLocked(client, request, documentId, true)
      await discardKnowledgeDraft(client, documentId, actor)
    })
    await respondDetail(request, response, documentId)
  })

  /** A versão da base, se a pessoa pode ler a base agora e também o alcance que a versão tinha. Responde 404 ou 403 e devolve null. */
  const readableVersion = async (request: Parameters<typeof scopesOf>[0], response: { status: (code: number) => { json: (body: unknown) => unknown } }, documentId: string, versionId: string) => {
    if (!(await readable(request, documentId))) {
      response.status(404).json(NOT_FOUND)
      return null
    }
    const version = z.string().uuid().safeParse(versionId).success ? await loadKnowledgeVersion(db, sessionUser(request).organizationId, documentId, versionId) : null
    if (!version) {
      response.status(404).json({ error: { code: "KNOWLEDGE_VERSION_NOT_FOUND", message: "Versão não encontrada." } })
      return null
    }
    if (version.config && !(await canReadDocument(db, await scopesOf(request), toDocumentScopes(version.config)))) {
      response.status(403).json({ error: { code: "KNOWLEDGE_VERSION_RESTRICTED", message: "Esta versão valia para Grupos fora do seu escopo." } })
      return null
    }
    return version
  }

  router.get("/:id/versions", async (request, response) => {
    const documentId = request.params.id!
    if (!(await readable(request, documentId))) return response.status(404).json(NOT_FOUND)
    const scopes = await scopesOf(request)
    response.json({ data: await listKnowledgeVersions(db, documentId, async (config) => !config || canReadDocument(db, scopes, toDocumentScopes(config))) })
  })

  // Antes de "/:id/versions/:versionId", para "compare" não virar um id.
  router.get("/:id/versions/compare", async (request, response) => {
    const documentId = request.params.id!
    const input = compareSchema.parse(request.query)
    const from = await readableVersion(request, response, documentId, input.from)
    if (!from) return
    const to = await readableVersion(request, response, documentId, input.to)
    if (!to) return
    response.json({ data: await compareKnowledgeVersions(db, sessionUser(request).organizationId, from, to) })
  })

  router.get("/:id/versions/:versionId", async (request, response) => {
    const version = await readableVersion(request, response, request.params.id!, request.params.versionId!)
    if (version) response.json({ data: version })
  })

  // O que a IA recebe desta versão: os mesmos trechos da busca, com a seção e a página de cada um, mais a cobertura do arquivo.
  router.get("/:id/versions/:versionId/ai-preview", async (request, response) => {
    const version = await readableVersion(request, response, request.params.id!, request.params.versionId!)
    if (!version) return
    const chunks = withChunkPages(chunkKnowledgeDocument({ id: request.params.id!, title: version.config?.title ?? "", content: version.content }), version.content, version.extraction)
    const written = chunkDisplayTexts(chunks, version.content)
    response.json({ data: { versionId: version.id, version: version.number, extraction: version.extraction, chunks: chunks.map((chunk, position) => ({ index: chunk.index, heading: chunk.heading, pages: chunk.pages ?? null, chars: chunk.text.length, text: chunk.text, displayText: written[position] ?? null, images: chunk.images ?? [] })) } })
  })

  /** O arquivo da versão, com o formato e o nome da versão; versão sem configuração registrada usa os da base. */
  const versionFile = async (documentId: string, version: { fileId: string | null; config: KnowledgeVersionConfig | null }) => {
    if (!version.fileId) return null
    const row = (await db.query<{ file_data: Buffer; title: string; source_type: string; original_filename: string | null }>(
      `select f.file_data, d.title, d.source_type, d.original_filename from knowledge_files f join knowledge_documents d on d.id = f.knowledge_document_id where f.id = $1 and f.knowledge_document_id = $2`,
      [version.fileId, documentId],
    )).rows[0]
    if (!row) return null
    return { data: row.file_data, sourceType: version.config?.sourceType ?? row.source_type, filename: version.config?.file?.filename ?? row.original_filename ?? `${version.config?.title ?? row.title}.bin` }
  }
  const FILE_NOT_FOUND = { error: { code: "KNOWLEDGE_FILE_NOT_FOUND", message: "Esta versão não tem arquivo original." } } as const

  // Imagem do arquivo de uma versão: a mesma permissão do conteúdo dela; não existe link público.
  router.get("/:id/versions/:versionId/images/:imageId", async (request, response) => {
    const version = await readableVersion(request, response, request.params.id!, request.params.versionId!)
    if (!version) return
    const image = version.fileId ? await loadKnowledgeFileImage(db, version.fileId, request.params.imageId!) : null
    if (!image) return response.status(404).json({ error: { code: "KNOWLEDGE_IMAGE_NOT_FOUND", message: "Esta imagem não faz parte desta versão." } })
    sendKnowledgeImage(request, response, image)
  })

  // Arquivo e prévia de uma versão antiga: a mesma permissão do conteúdo dela; não existe link público.
  router.get("/:id/versions/:versionId/file", async (request, response) => {
    const version = await readableVersion(request, response, request.params.id!, request.params.versionId!)
    if (!version) return
    const file = await versionFile(request.params.id!, version)
    if (!file) return response.status(404).json(FILE_NOT_FOUND)
    sendKnowledgeFile(response, file)
  })

  router.get("/:id/versions/:versionId/preview", async (request, response) => {
    const version = await readableVersion(request, response, request.params.id!, request.params.versionId!)
    if (!version) return
    const file = await versionFile(request.params.id!, version)
    if (!file) return response.status(404).json(FILE_NOT_FOUND)
    if (file.sourceType !== "DOCX") return response.status(415).json({ error: { code: "KNOWLEDGE_PREVIEW_UNSUPPORTED", message: "Este formato não tem prévia em HTML." } })
    try {
      response.json({ data: { format: "html", html: await renderDocxPreviewHtml(file.data) } })
    } catch (error) {
      if (error instanceof DocxPreviewTooLargeError) return response.status(422).json({ error: { code: "KNOWLEDGE_PREVIEW_TOO_LARGE", message: error.message } })
      response.status(422).json({ error: { code: "KNOWLEDGE_PREVIEW_FAILED", message: "Não foi possível gerar a prévia deste documento." } })
    }
  })

  router.post("/:id/versions/:versionId/retry", async (request, response) => {
    const documentId = request.params.id!
    const versionId = request.params.versionId!
    const version = await readableVersion(request, response, documentId, versionId)
    if (!version) return
    if (!(await writable(request, response, documentId, toTargets(version.config?.orgScopes ?? [])))) return
    const input = retrySchema.parse(request.body ?? {})
    const organizationId = sessionUser(request).organizationId
    const actor = await actorOf(request)
    await inTransaction(db, async (client) => {
      if (!(await lockKnowledgeDocument(client, organizationId, documentId))) throw new DomainError("Base de conhecimento não encontrada.", "KNOWLEDGE_NOT_FOUND", 404)
      await retryKnowledgeVersion(client, organizationId, documentId, versionId, actor, { ...input, canChangeProducts: canChangeProductsOf(request) })
    })
    await processNow(versionId, request.user?.personId ?? null)
    await respondDetail(request, response, documentId)
  })

  // Reverter: versão nova com o conteúdo de uma anterior, processada como qualquer publicação. Exige alcançar também o que a versão antiga valia.
  router.post("/:id/versions/:versionId/revert", async (request, response) => {
    const documentId = request.params.id!
    const input = revertSchema.parse(request.body ?? {})
    const version = await readableVersion(request, response, documentId, request.params.versionId!)
    if (!version) return
    if (!(await writable(request, response, documentId, [...toTargets(version.config?.orgScopes ?? []), ...(await draftTargets(documentId))]))) return
    const organizationId = sessionUser(request).organizationId
    const actor = await actorOf(request)
    const reverted = await inTransaction(db, async (client) => {
      if (!(await lockKnowledgeDocument(client, organizationId, documentId))) throw new DomainError("Base de conhecimento não encontrada.", "KNOWLEDGE_NOT_FOUND", 404)
      // Reverter descarta o rascunho em edição: o alcance dele conta, relido com a base travada.
      await assertWritableLocked(client, request, documentId, true)
      return revertKnowledgeVersion(client, organizationId, documentId, version.id, actor, { ...input, canChangeProducts: canChangeProductsOf(request) })
    })
    await processNow(reverted.versionId, request.user?.personId ?? null)
    await respondDetail(request, response, documentId)
  })

  router.delete("/:id", async (request, response) => {
    const organizationId = sessionUser(request).organizationId
    const currentScopes = await loadDocumentScopes(db, organizationId, request.params.id)
    if (!currentScopes || !canWriteDocument(await scopesOf(request), toTargets(currentScopes))) return response.status(404).json(NOT_FOUND)
    const result = await db.query(
      `update knowledge_documents set deleted_at = now(), deleted_by_person_id = $3 where id = $1 and organization_id = $2 and deleted_at is null returning id`,
      [request.params.id, organizationId, sessionUser(request).personId ?? null],
    )
    if (!result.rows[0]) return response.status(404).json({ error: { code: "KNOWLEDGE_NOT_FOUND", message: "Base de conhecimento não encontrada." } })
    response.status(204).send()
  })

  return router
}
