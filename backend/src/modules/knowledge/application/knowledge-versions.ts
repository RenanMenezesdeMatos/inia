import { createHash } from "node:crypto"
import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { inTransaction } from "../../../shared/infrastructure/database/transaction.js"
import { createLogger } from "../../../shared/infrastructure/logging/logger.js"
import { syncCheckpointRegistry } from "../../checkpoint-registry/application/checkpoint-registry-service.js"
import { applyProductScopeAssignment, assertProductNodesActive, normalizedProductNodeIds, openProductNodeIds as openScope, sameProductNodeIds } from "../../product-catalog/application/product-scope-assignments.js"
import { chunkKnowledgeDocument } from "../domain/knowledge-chunking.js"
import { PDF_MARKDOWN_VERSION, PDF_OCR_VERSION, type PdfExtraction } from "../domain/pdf-markdown/layout.js"
import { remapExtraction } from "../domain/pdf-markdown/page-map.js"

/**
 * CICLO DE VIDA DAS VERSÕES DA BASE (PEN-008, decisão de 04/11/2026). A base mantém a identidade; as colunas de `knowledge_documents`
 * e as tabelas de alcance são a configuração EM USO. Editar grava um rascunho (`knowledge_versions`, DRAFT) sem tocar no que a IA lê.
 * Publicar leva o rascunho a PROCESSING e a versão só vira PUBLISHED — logo, vigente pela regra de sempre (`live-knowledge-version.ts`,
 * a mesma de todos os leitores da IA) — quando está processada e pronta. A transição é uma única transação com a linha da base travada:
 * muda a situação da versão e aplica a configuração dela. Falha deixa a versão em FAILED e a anterior continua em uso. Conclusão
 * tardia de uma versão mais antiga do que a vigente nunca a substitui (SUPERSEDED). Nada é republicado nos consumidores: agentes,
 * Workflows e orquestradores leem a vigente a cada consulta.
 *
 * PRODUTOS ("Vale para"): fazem parte da configuração da versão. Ficam no rascunho e, na transição, viram a abrangência em vigor
 * (`product_scope_assignments`), que é o registro de data lido pelo motor de feedback: quem lê não muda, e a regra de nunca ser retroativo
 * também não. Mudar produtos exige alcance de organização, em quem salva e também em quem publica, reverte ou tenta de novo.
 */
const log = createLogger("knowledge-versions")

type Queryable = Pick<Database, "query">

export const DECIDED_STATUSES = ["PUBLISHED", "ARCHIVED"] as const
const DRAFT_STATUSES = ["DRAFT", "APPROVED"] as const

export const knowledgeVersionConfigSchema = z.object({
  title: z.string(),
  documentType: z.string(),
  sourceType: z.string(),
  file: z.object({ id: z.string(), filename: z.string().nullable(), mimeType: z.string().nullable(), sizeBytes: z.number().nullable(), checksum: z.string() }).nullable(),
  orgScopes: z.array(z.object({ scopeType: z.string(), teamId: z.string().nullable().optional(), subteamId: z.string().nullable().optional() })),
  subjectScopes: z.array(z.object({ scopeType: z.string(), subjectId: z.string().nullable().optional() })),
  productNodeIds: z.array(z.string()).default([]),
})
export type KnowledgeVersionConfig = z.infer<typeof knowledgeVersionConfigSchema>

/** Registro da conversão gravado na versão. Inválido ou de outro formato = como se não houvesse: nada depende dele para funcionar. */
export const pdfExtractionSchema = z.object({
  version: z.literal(PDF_MARKDOWN_VERSION),
  pageCount: z.number(),
  pages: z.array(z.object({ page: z.number(), status: z.enum(["TEXT", "PARTIAL", "NO_TEXT", "BLANK", "UNREADABLE"]), chars: z.number(), headings: z.number(), tables: z.number(), offset: z.number().nullable() })),
  headings: z.number(),
  tables: z.number(),
  repeatedLinesRemoved: z.number(),
  taggedPages: z.number(),
  edited: z.boolean(),
  images: z.array(z.object({ id: z.string(), page: z.number(), offset: z.number().nullable(), width: z.number(), height: z.number() })).optional(),
  imagesOmitted: z.number().optional(),
  ocr: z.object({ version: z.literal(PDF_OCR_VERSION), engine: z.string(), printRule: z.string(), pages: z.array(z.number()), failedPages: z.array(z.number()), skippedPages: z.array(z.number()), prints: z.number() }).optional(),
})
export const parseKnowledgeExtraction = (value: unknown): PdfExtraction | null => {
  const parsed = pdfExtractionSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export type KnowledgeActor = { organizationId: string; personId: string | null; name: string | null }

export type VersionRow = {
  id: string
  version: number
  status: string
  text_status: string
  config: unknown
  file_id: string | null
  published_at: Date | null
}

const VERSION_COLUMNS = "id, version, status, text_status, config, file_id, published_at"

const isDraftStatus = (status: string) => (DRAFT_STATUSES as readonly string[]).includes(status)
const isDecidedStatus = (status: string) => (DECIDED_STATUSES as readonly string[]).includes(status)

/** A situação da base a partir das versões (em ordem decrescente): a vigente, o rascunho em edição e as atualizações pendentes. */
export function lifecycleOf<T extends { version: number; status: string }>(rows: readonly T[]) {
  const live = rows.find((row) => isDecidedStatus(row.status)) ?? null
  const latest = rows[0] ?? null
  const draft = latest && isDraftStatus(latest.status) && (!live || latest.version > live.version) ? latest : null
  const updates = rows.filter((row) => (row.status === "PROCESSING" || row.status === "FAILED") && (!live || row.version > live.version))
  return { live, latest, draft, updates }
}

async function loadVersionRows(db: Queryable, documentId: string): Promise<VersionRow[]> {
  return (await db.query<VersionRow>(`select ${VERSION_COLUMNS} from knowledge_versions where document_id = $1 order by version desc`, [documentId])).rows
}

const parseConfig = (value: unknown): KnowledgeVersionConfig | null => {
  const parsed = knowledgeVersionConfigSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

const openProductNodeIds = (db: Queryable, organizationId: string, documentId: string) => openScope(db, organizationId, "KNOWLEDGE_DOCUMENT", documentId)

const productsScopeForbidden = () => new DomainError("Esta versão muda para quais produtos a base vale. Esta configuração vale para a organização inteira: só quem a administra em toda a organização pode publicá-la.", "ORGANIZATION_SCOPE_REQUIRED", 403)

/** Confere, com a base travada, a mudança de produtos que uma publicação traria: quem pode decidir e se os produtos continuam ativos. */
async function assertProductChangeAllowed(client: Queryable, organizationId: string, documentId: string, config: KnowledgeVersionConfig, canChangeProducts: boolean | undefined): Promise<void> {
  if (sameProductNodeIds(config.productNodeIds, await openProductNodeIds(client, organizationId, documentId))) return
  if (!canChangeProducts) throw productsScopeForbidden()
  await assertProductNodesActive(client, organizationId, config.productNodeIds)
}

/** A configuração em uso da base, no formato da versão. null = base inexistente, excluída ou de outra organização. */
export async function loadCurrentConfig(db: Queryable, organizationId: string, documentId: string): Promise<KnowledgeVersionConfig | null> {
  const row = (await db.query<{ title: string; document_type: string; source_type: string; original_filename: string | null; mime_type: string | null; file_size_bytes: number | null; file: { id: string; checksum: string } | null; org_scopes: KnowledgeVersionConfig["orgScopes"]; subject_scopes: KnowledgeVersionConfig["subjectScopes"] }>(
    `select d.title, d.document_type, d.source_type, d.original_filename, d.mime_type, d.file_size_bytes,
            (select json_build_object('id', f.id, 'checksum', f.checksum) from knowledge_files f where f.knowledge_document_id = d.id order by f.created_at desc limit 1) file,
            coalesce((select json_agg(json_build_object('scopeType', os.scope_type, 'teamId', os.team_id, 'subteamId', os.subteam_id)) from knowledge_document_org_scopes os where os.knowledge_document_id = d.id), '[]') org_scopes,
            coalesce((select json_agg(json_build_object('scopeType', ss.scope_type, 'subjectId', ss.subject_id)) from knowledge_document_subject_scopes ss where ss.knowledge_document_id = d.id), '[]') subject_scopes
       from knowledge_documents d where d.id = $1 and d.organization_id = $2 and d.deleted_at is null`,
    [documentId, organizationId],
  )).rows[0]
  if (!row) return null
  return {
    title: row.title,
    documentType: row.document_type,
    sourceType: row.source_type,
    file: row.file ? { id: row.file.id, filename: row.original_filename, mimeType: row.mime_type, sizeBytes: row.file_size_bytes, checksum: row.file.checksum } : null,
    orgScopes: row.org_scopes,
    subjectScopes: row.subject_scopes,
    productNodeIds: await openProductNodeIds(db, organizationId, documentId),
  }
}

/** Aplica a configuração de uma versão à base (o que passa a valer): título, tipo, arquivo e alcance. */
async function applyConfigToDocument(client: Queryable, documentId: string, config: KnowledgeVersionConfig): Promise<void> {
  await client.query(
    `update knowledge_documents set title = $2, document_type = $3, source_type = $4, original_filename = $5, mime_type = $6, file_size_bytes = $7, updated_at = now() where id = $1`,
    [documentId, config.title, config.documentType, config.sourceType, config.file?.filename ?? null, config.file?.mimeType ?? null, config.file?.sizeBytes ?? null],
  )
  await client.query(`delete from knowledge_document_org_scopes where knowledge_document_id = $1`, [documentId])
  for (const scope of config.orgScopes) await client.query(`insert into knowledge_document_org_scopes(knowledge_document_id, scope_type, team_id, subteam_id) values ($1,$2,$3,$4)`, [documentId, scope.scopeType, scope.teamId ?? null, scope.subteamId ?? null])
  await client.query(`delete from knowledge_document_subject_scopes where knowledge_document_id = $1`, [documentId])
  for (const scope of config.subjectScopes) await client.query(`insert into knowledge_document_subject_scopes(knowledge_document_id, scope_type, subject_id) values ($1,$2,$3)`, [documentId, scope.scopeType, scope.subjectId ?? null])
}

async function audit(client: Queryable, actor: { organizationId: string; personId?: string | null; name?: string | null }, action: string, documentId: string, payload: Record<string, unknown>): Promise<void> {
  await client.query(`insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload) values ($1, $2, $3, 'knowledge_document', $4, $5)`, [actor.organizationId, actor.personId ?? null, action, documentId, JSON.stringify({ ...payload, actorName: actor.name ?? null })])
}

const hashOf = (content: string) => createHash("sha256").update(content).digest("hex")

/** Leitura das páginas digitalizadas (OCR) na fila ou em andamento para esta base. A fila é `knowledge_ocr_jobs` (ver knowledge-ocr-jobs.ts). */
export async function knowledgeOcrActive(client: Queryable, documentId: string): Promise<boolean> {
  return ((await client.query(`select 1 from knowledge_ocr_jobs where document_id = $1 and status in ('QUEUED', 'RUNNING') limit 1`, [documentId])).rowCount ?? 0) > 0
}

export const ocrRunningError = () => new DomainError("O PDF ainda está sendo lido (OCR). Espere a leitura terminar e confira o texto antes de editar ou publicar.", "KNOWLEDGE_OCR_RUNNING", 409)

/** Encerra a leitura em andamento: o resultado dela, se chegar, não entra mais no rascunho. */
export async function cancelKnowledgeOcr(client: Queryable, documentId: string, code: string, message: string): Promise<void> {
  await client.query(
    `update knowledge_ocr_jobs set status = 'CANCELLED', lease_until = null, finished_at = now(), updated_at = now(), error_code = $2, error_message = $3 where document_id = $1 and status in ('QUEUED', 'RUNNING')`,
    [documentId, code, message],
  )
}

export type DraftChanges = {
  /** Produtos da versão ("Vale para"): só passam a valer na transição. */
  productNodeIds?: readonly string[] | undefined
  title?: string | undefined
  documentType?: string | undefined
  content?: string | undefined
  orgScopes?: KnowledgeVersionConfig["orgScopes"] | undefined
  subjectScopes?: KnowledgeVersionConfig["subjectScopes"] | undefined
  /** Arquivo trocado no rascunho; `extractedText` nulo = não houve como extrair o texto. */
  file?: { file: NonNullable<KnowledgeVersionConfig["file"]>; sourceType: string; extractedText: string | null; extraction?: PdfExtraction | null | undefined } | undefined
  changeSummary?: string | undefined
}

/**
 * Grava o rascunho da base, com a linha da base já travada pelo chamador. Há um rascunho só por base: existindo, é atualizado; senão nasce
 * uma versão nova a partir do que está sendo editado (a atualização com falha, a vigente ou a mais recente). Nunca altera o que a IA usa:
 * com versão vigente, a configuração fica no rascunho até a transição. Sem nenhuma versão vigente não há consumidor e a configuração
 * também vale para a base, para a lista mostrar o que foi editado; os produtos, não: eles só viram abrangência em vigor na transição.
 */
export async function saveKnowledgeDraft(client: Queryable, organizationId: string, documentId: string, changes: DraftChanges, actor: KnowledgeActor): Promise<{ versionId: string; version: number; changed: boolean } | null> {
  // Arquivo novo (troca ou reprocessamento) substitui a leitura em andamento do anterior; quem chamou pede a leitura do novo, se precisar.
  if (changes.file) await cancelKnowledgeOcr(client, documentId, "KNOWLEDGE_OCR_REPLACED", "O arquivo do rascunho foi trocado ou reprocessado.")
  const rows = await loadVersionRows(client, documentId)
  const { live, latest, draft, updates } = lifecycleOf(rows)
  const failed = updates.find((row) => row.status === "FAILED") ?? null
  const base = draft ?? failed ?? live ?? latest
  const baseRow = base ? (await client.query<{ content: string; extraction: unknown }>(`select content, extraction from knowledge_versions where id = $1`, [base.id])).rows[0] : undefined
  const baseContent = baseRow?.content ?? ""
  const baseExtraction = parseKnowledgeExtraction(baseRow?.extraction)
  const current = await loadCurrentConfig(client, organizationId, documentId)
  if (!current) throw new DomainError("Base de conhecimento não encontrada.", "KNOWLEDGE_NOT_FOUND", 404)
  const parsedBase = base ? parseConfig(base.config) : null
  // O que ainda não está em uso (rascunho, falha, primeira publicação em andamento) guarda a escolha em andamento. A vigente guarda só o retrato
  // de quando foi publicada: um rascunho novo parte do que está valendo agora, senão publicá-lo desfaria uma abrangência que ninguém pediu para mudar.
  const baseConfig: KnowledgeVersionConfig = { ...(parsedBase ?? current), productNodeIds: parsedBase && base !== live ? parsedBase.productNodeIds : current.productNodeIds }
  const config: KnowledgeVersionConfig = {
    ...baseConfig,
    ...(changes.title !== undefined ? { title: changes.title } : {}),
    ...(changes.documentType !== undefined ? { documentType: changes.documentType } : {}),
    ...(changes.orgScopes ? { orgScopes: changes.orgScopes } : {}),
    ...(changes.subjectScopes ? { subjectScopes: changes.subjectScopes } : {}),
    ...(changes.file ? { file: changes.file.file, sourceType: changes.file.sourceType } : {}),
    ...(changes.productNodeIds ? { productNodeIds: normalizedProductNodeIds(changes.productNodeIds) } : {}),
  }
  // A API tira espaços das pontas do texto recebido: isso sozinho não é mudança.
  const content = changes.content !== undefined && changes.content.trim() === baseContent.trim() ? baseContent : (changes.content ?? (changes.file ? (changes.file.extractedText ?? "") : baseContent))
  const textStatus = content.trim().length > 0 ? "AVAILABLE" : "UNAVAILABLE"
  const fileId = changes.file ? changes.file.file.id : (base?.file_id ?? config.file?.id ?? null)
  const sameContent = content === baseContent
  const sameConfig = JSON.stringify(normalizedConfig(config)) === JSON.stringify(normalizedConfig(baseConfig))
  // Arquivo novo traz o próprio registro. Texto editado à mão mantém a origem das páginas, e o registro passa a dizer que foi editado.
  const extraction = changes.file ? (changes.file.extraction ?? null) : sameContent ? baseExtraction : baseExtraction ? remapExtraction(baseExtraction, baseContent, content) : null
  const sameExtraction = JSON.stringify(extraction) === JSON.stringify(baseExtraction)
  // O texto do OCR entra no rascunho só se ele não mudou desde o envio: editar agora faria a leitura ser descartada no fim.
  if (!sameContent && !changes.file && (await knowledgeOcrActive(client, documentId))) throw ocrRunningError()
  if (draft) {
    if (sameContent && sameConfig && sameExtraction && !changes.changeSummary) return { versionId: draft.id, version: draft.version, changed: false }
    await client.query(
      `update knowledge_versions set content = $2, content_hash = $3, config = $4, file_id = $5, text_status = $6, change_summary = coalesce($7, change_summary), updated_at = now(), updated_by_name = $8, extraction = $9 where id = $1`,
      [draft.id, content, hashOf(content), JSON.stringify(config), fileId, textStatus, changes.changeSummary ?? null, actor.name, extraction ? JSON.stringify(extraction) : null],
    )
    if (!live) await applyConfigToDocument(client, documentId, config)
    return { versionId: draft.id, version: draft.version, changed: true }
  }
  // Sem mudança em relação ao que está em uso (salvar sem alterar nada): não nasce versão.
  if (base && sameContent && sameConfig && sameExtraction) return null
  const version = (latest?.version ?? 0) + 1
  const created = (await client.query<{ id: string }>(
    `insert into knowledge_versions (organization_id, document_id, version, content, status, content_hash, config, file_id, text_status, origin, change_summary, created_by_name, updated_at, updated_by_name, extraction)
     values ($1, $2, $3, $4, 'DRAFT', $5, $6, $7, $8, 'EDIT', $9, $10, now(), $10, $11) returning id`,
    [organizationId, documentId, version, content, hashOf(content), JSON.stringify(config), fileId, textStatus, changes.changeSummary ?? null, actor.name, extraction ? JSON.stringify(extraction) : null],
  )).rows[0]!
  if (!live) await applyConfigToDocument(client, documentId, config)
  return { versionId: created.id, version, changed: true }
}

/** Mesma configuração em qualquer ordem de alcance (a comparação "mudou?" não depende da ordem de gravação). */
function normalizedConfig(config: KnowledgeVersionConfig) {
  const key = (value: unknown) => JSON.stringify(value)
  return {
    ...config,
    orgScopes: config.orgScopes.map((scope) => ({ scopeType: scope.scopeType, teamId: scope.teamId ?? null, subteamId: scope.subteamId ?? null })).sort((a, b) => key(a).localeCompare(key(b))),
    subjectScopes: config.subjectScopes.map((scope) => ({ scopeType: scope.scopeType, subjectId: scope.subjectId ?? null })).sort((a, b) => key(a).localeCompare(key(b))),
    productNodeIds: [...config.productNodeIds].sort(),
  }
}

export const archivedError = () => new DomainError("Esta base está arquivada. Publicar faz com que ela volte a valer para a IA: confirme a reativação para continuar.", "KNOWLEDGE_ARCHIVED_REACTIVATION_REQUIRED", 409)

/** `reactivate` = quem pede confirmou que a base arquivada volta a valer. `canChangeProducts` = alcança a organização inteira (RN-027). */
export type PublicationInput = { changeSummary?: string | undefined; reactivate?: boolean | undefined; canChangeProducts?: boolean | undefined }

/**
 * Pede a disponibilização do rascunho (linha da base travada pelo chamador). Daqui até ficar pronta, a versão anterior continua em uso.
 * Em base arquivada, só com a confirmação explícita: publicar nunca reativa em silêncio.
 */
export async function requestKnowledgePublication(client: Queryable, organizationId: string, documentId: string, actor: KnowledgeActor, input: PublicationInput = {}): Promise<{ versionId: string; version: number }> {
  const { live, draft } = lifecycleOf(await loadVersionRows(client, documentId))
  if (!draft) throw new DomainError("Não há rascunho para publicar.", "KNOWLEDGE_NOTHING_TO_PUBLISH", 409)
  if (await knowledgeOcrActive(client, documentId)) throw ocrRunningError()
  const reactivates = live?.status === "ARCHIVED"
  if (reactivates && !input.reactivate) throw archivedError()
  const config = parseConfig(draft.config) ?? (await loadCurrentConfig(client, organizationId, documentId))!
  await assertProductChangeAllowed(client, organizationId, documentId, config, input.canChangeProducts)
  await client.query(
    `update knowledge_versions set status = 'PROCESSING', config = $2, change_summary = coalesce($3, change_summary), publish_requested_at = now(), publish_requested_by_name = $4, publish_requested_by = $5,
            reactivation_confirmed_at = ${reactivates ? "now()" : "null"}, reactivation_confirmed_by_name = ${reactivates ? "$4" : "null"},
            processing_attempts = 0, processing_lease_until = null, processing_finished_at = null, processing_error_code = null, processing_error_message = null where id = $1`,
    [draft.id, JSON.stringify(config), input.changeSummary ?? null, actor.name, actor.personId],
  )
  await audit(client, actor, "KNOWLEDGE_VERSION_PUBLISH_REQUESTED", documentId, { versionId: draft.id, version: draft.version, reactivates })
  return { versionId: draft.id, version: draft.version }
}

/** Falha que não adianta repetir: a versão fica em FAILED na hora, com o motivo. */
export class KnowledgeProcessingError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
  }
}

export type PreparedVersion = { chunkCount: number }
export type ProcessingVersion = { id: string; documentId: string; organizationId: string; version: number; content: string; textStatus: string; config: KnowledgeVersionConfig | null; fileId: string | null }

/** Deixa a versão pronta para consulta: confere o texto, os trechos que a busca vai usar e o arquivo. Puro de efeito no que está em uso. */
export async function prepareKnowledgeVersion(db: Queryable, version: ProcessingVersion): Promise<PreparedVersion> {
  if (version.textStatus === "UNAVAILABLE" || version.content.trim().length === 0) {
    throw new KnowledgeProcessingError("KNOWLEDGE_TEXT_UNAVAILABLE", "Não há texto para a IA consultar: o arquivo não teve texto extraído. Troque o arquivo ou digite o texto no rascunho.")
  }
  const chunks = chunkKnowledgeDocument({ id: version.documentId, title: version.config?.title ?? "", content: version.content })
  if (chunks.length === 0) throw new KnowledgeProcessingError("KNOWLEDGE_NO_CHUNKS", "O conteúdo não gerou nenhum trecho consultável.")
  if (version.fileId) {
    const file = (await db.query(`select 1 from knowledge_files where id = $1 and knowledge_document_id = $2`, [version.fileId, version.documentId])).rows[0]
    if (!file) throw new KnowledgeProcessingError("KNOWLEDGE_FILE_MISSING", "O arquivo desta versão não foi encontrado.")
  }
  return { chunkCount: chunks.length }
}

export const MAX_PROCESSING_ATTEMPTS = 3
const PROCESSING_LEASE = "2 minutes"

export type ProcessOutcome = "PUBLISHED" | "SUPERSEDED" | "FAILED" | "RETRY" | "NOT_CLAIMED" | "IGNORED"
export type ProcessDeps = { prepare?: (version: ProcessingVersion) => Promise<PreparedVersion>; actorPersonId?: string | null }

/**
 * Processa uma versão com publicação pedida. A posse (lease) evita dois processos ao mesmo tempo, e a conclusão confere tudo de novo com
 * a linha da base travada: quem processou mais devagar, ou uma versão arquivada no meio, nunca muda o que está em uso por engano.
 */
export async function processKnowledgeVersion(db: Database, versionId: string, deps: ProcessDeps = {}): Promise<ProcessOutcome> {
  const claimed = (await db.query<{ id: string; document_id: string; organization_id: string; version: number; content: string; text_status: string; config: unknown; file_id: string | null; processing_attempts: number }>(
    `update knowledge_versions set processing_lease_until = now() + interval '${PROCESSING_LEASE}', processing_attempts = processing_attempts + 1
      where id = $1 and status = 'PROCESSING' and (processing_lease_until is null or processing_lease_until < now())
      returning id, document_id, organization_id, version, content, text_status, config, file_id, processing_attempts`,
    [versionId],
  )).rows[0]
  if (!claimed) return "NOT_CLAIMED"
  const version: ProcessingVersion = { id: claimed.id, documentId: claimed.document_id, organizationId: claimed.organization_id, version: claimed.version, content: claimed.content, textStatus: claimed.text_status, config: parseConfig(claimed.config), fileId: claimed.file_id }
  // O processo morreu com a posse nas tentativas anteriores: a versão não fica em processamento para sempre.
  if (claimed.processing_attempts > MAX_PROCESSING_ATTEMPTS) {
    await markVersionFailed(db, version, "KNOWLEDGE_PROCESSING_FAILED", "O processamento falhou. A versão anterior continua em uso; tente novamente.")
    return "FAILED"
  }
  try {
    const prepared = await (deps.prepare ?? ((target) => prepareKnowledgeVersion(db, target)))(version)
    const outcome = await finishKnowledgeVersion(db, version, prepared)
    if (outcome === "PUBLISHED") {
      // Checkpoint Registry: a versão publicada dispara a extração + reconciliação (idempotente por versão). Nunca desfaz a publicação:
      // falha aqui fica no log e o administrador reprocessa em "Checkpoints da operação".
      try {
        await syncCheckpointRegistry(db, { organizationId: version.organizationId, personId: deps.actorPersonId ?? null }, version.documentId)
      } catch (error) {
        log.error({ documentId: version.documentId, error: error instanceof Error ? error.message : String(error) }, "checkpoint registry sync failed")
      }
    }
    return outcome
  } catch (error) {
    const permanent = error instanceof KnowledgeProcessingError
    log.error({ documentId: version.documentId, versionId, attempt: claimed.processing_attempts, error: error instanceof Error ? error.message : String(error) }, "knowledge version processing failed")
    if (!permanent && claimed.processing_attempts < MAX_PROCESSING_ATTEMPTS) {
      // Falha passageira: solta a posse e a varredura tenta de novo. A versão anterior segue em uso.
      await db.query(`update knowledge_versions set processing_lease_until = now() where id = $1 and status = 'PROCESSING'`, [versionId])
      return "RETRY"
    }
    const code = permanent ? error.code : "KNOWLEDGE_PROCESSING_FAILED"
    const message = permanent ? error.message : "O processamento falhou. A versão anterior continua em uso; tente novamente."
    await markVersionFailed(db, version, code, message)
    return "FAILED"
  }
}

async function markVersionFailed(db: Database, version: ProcessingVersion, code: string, message: string): Promise<void> {
  await inTransaction(db, async (client) => {
    const updated = await client.query(
      `update knowledge_versions set status = 'FAILED', processing_lease_until = null, processing_finished_at = now(), processing_error_code = $2, processing_error_message = $3 where id = $1 and status = 'PROCESSING' returning id`,
      [version.id, code, message],
    )
    if (updated.rows[0]) await audit(client, { organizationId: version.organizationId }, "KNOWLEDGE_VERSION_FAILED", version.documentId, { versionId: version.id, version: version.version, code })
  })
}

/** A transição: com a base travada, ou a versão passa a valer (e a configuração dela junto), ou fica registrado que não entrou em uso. */
async function finishKnowledgeVersion(db: Database, version: ProcessingVersion, prepared: PreparedVersion): Promise<ProcessOutcome> {
  return inTransaction(db, async (client) => {
    const document = (await client.query<{ deleted_at: Date | null }>(`select deleted_at from knowledge_documents where id = $1 for update`, [version.documentId])).rows[0]
    const current = (await client.query<{ status: string; publish_requested_by_name: string | null; publish_requested_by: string | null; reactivation_confirmed_at: Date | null }>(`select status, publish_requested_by_name, publish_requested_by, reactivation_confirmed_at from knowledge_versions where id = $1 for update`, [version.id])).rows[0]
    // Arquivada no meio, ou outro processo já concluiu: nada a fazer.
    if (!document || !current || current.status !== "PROCESSING") return "IGNORED" as const
    if (document.deleted_at) {
      await client.query(`update knowledge_versions set status = 'SUPERSEDED', superseded_reason = 'ARCHIVED', processing_lease_until = null, processing_finished_at = now() where id = $1`, [version.id])
      return "SUPERSEDED" as const
    }
    const newest = (await client.query<{ version: number; status: string }>(`select version, status from knowledge_versions where document_id = $1 and status = any($2::text[]) order by version desc limit 1`, [version.documentId, DECIDED_STATUSES])).rows[0]
    if (newest && newest.version > version.version) {
      await client.query(`update knowledge_versions set status = 'SUPERSEDED', superseded_reason = 'NEWER_VERSION', chunk_count = $2, processing_lease_until = null, processing_finished_at = now() where id = $1`, [version.id, prepared.chunkCount])
      await audit(client, { organizationId: version.organizationId }, "KNOWLEDGE_VERSION_SUPERSEDED", version.documentId, { versionId: version.id, version: version.version, newerVersion: newest.version })
      return "SUPERSEDED" as const
    }
    // Última barreira: base arquivada só volta a valer com a confirmação registrada em quem pediu. Sem ela, a versão não entra em uso.
    const reactivates = newest?.status === "ARCHIVED"
    if (reactivates && !current.reactivation_confirmed_at) {
      await client.query(`update knowledge_versions set status = 'SUPERSEDED', superseded_reason = 'ARCHIVED', chunk_count = $2, processing_lease_until = null, processing_finished_at = now() where id = $1`, [version.id, prepared.chunkCount])
      await audit(client, { organizationId: version.organizationId }, "KNOWLEDGE_VERSION_SUPERSEDED", version.documentId, { versionId: version.id, version: version.version, reason: "ARCHIVED_WITHOUT_CONFIRMATION" })
      return "SUPERSEDED" as const
    }
    // Produtos: a abrangência em vigor muda aqui, junto com a versão. Produto desativado depois do pedido falha sem mudar nada do que está em uso.
    const at = (await client.query<{ at: Date }>(`select now() as at`)).rows[0]!.at
    let productScope: Awaited<ReturnType<typeof applyProductScopeAssignment>> = { changed: false }
    if (version.config) {
      if (!sameProductNodeIds(version.config.productNodeIds, await openProductNodeIds(client, version.organizationId, version.documentId))) {
        await assertProductNodesActive(client, version.organizationId, version.config.productNodeIds).catch(() => {
          throw new KnowledgeProcessingError("KNOWLEDGE_PRODUCT_INVALID", "Um dos produtos desta versão não está mais ativo. Ajuste o \"Vale para\" no rascunho e publique de novo. A versão anterior continua em uso.")
        })
      }
      productScope = await applyProductScopeAssignment(client, { organizationId: version.organizationId, kind: "KNOWLEDGE_DOCUMENT", sourceId: version.documentId, nodeIds: version.config.productNodeIds, actorPersonId: current.publish_requested_by, at })
    }
    await client.query(
      `update knowledge_versions set status = 'PUBLISHED', published_at = now(), published_by_name = publish_requested_by_name, effective_from = now(), chunk_count = $2, processing_lease_until = null, processing_finished_at = now() where id = $1`,
      [version.id, prepared.chunkCount],
    )
    if (version.config) await applyConfigToDocument(client, version.documentId, version.config)
    else await client.query(`update knowledge_documents set updated_at = now() where id = $1`, [version.documentId])
    await audit(client, { organizationId: version.organizationId, name: current.publish_requested_by_name }, "KNOWLEDGE_VERSION_PUBLISHED", version.documentId, { versionId: version.id, version: version.version, chunkCount: prepared.chunkCount, reactivated: reactivates, ...(productScope.changed ? { products: { before: productScope.before, after: productScope.after } } : {}) })
    return "PUBLISHED" as const
  })
}

/** Varredura do processamento em segundo plano: pega o que ficou sem dono (API reiniciada, falha passageira). */
export async function processPendingKnowledgeVersions(db: Database, limit = 10): Promise<void> {
  const pending = (await db.query<{ id: string }>(`select id from knowledge_versions where status = 'PROCESSING' and (processing_lease_until is null or processing_lease_until < now()) order by publish_requested_at limit $1`, [limit])).rows
  for (const row of pending) await processKnowledgeVersion(db, row.id)
}

/** Tenta de novo uma atualização com falha, com o mesmo conteúdo (linha da base travada pelo chamador). */
export async function retryKnowledgeVersion(client: Queryable, organizationId: string, documentId: string, versionId: string, actor: KnowledgeActor, input: Pick<PublicationInput, "reactivate" | "canChangeProducts"> = {}): Promise<void> {
  const rows = await loadVersionRows(client, documentId)
  const row = rows.find((candidate) => candidate.id === versionId)
  if (!row) throw new DomainError("Versão não encontrada.", "KNOWLEDGE_VERSION_NOT_FOUND", 404)
  if (row.status !== "FAILED") throw new DomainError("Só uma atualização com falha pode ser processada de novo.", "KNOWLEDGE_VERSION_NOT_FAILED", 409)
  // A falha pode ser de antes do arquivamento: tentar de novo também não reativa sem a confirmação.
  const reactivates = lifecycleOf(rows).live?.status === "ARCHIVED"
  if (reactivates && !input.reactivate) throw archivedError()
  const config = parseConfig(row.config)
  if (config) await assertProductChangeAllowed(client, organizationId, documentId, config, input.canChangeProducts)
  await client.query(
    `update knowledge_versions set status = 'PROCESSING', publish_requested_at = now(), publish_requested_by_name = $2, publish_requested_by = $3,
            reactivation_confirmed_at = ${reactivates ? "now()" : "null"}, reactivation_confirmed_by_name = ${reactivates ? "$2" : "null"},
            processing_attempts = 0, processing_lease_until = null, processing_finished_at = null, processing_error_code = null, processing_error_message = null where id = $1`,
    [versionId, actor.name, actor.personId],
  )
  await audit(client, actor, "KNOWLEDGE_VERSION_RETRY_REQUESTED", documentId, { versionId, version: row.version, reactivates })
}

/**
 * Arquivar tira a base de uso. Cancela as atualizações em andamento (sem isso, uma conclusão depois do arquivamento reativaria a base)
 * e nunca arquiva um rascunho que está por cima da versão em uso: o rascunho continua lá.
 */
export async function archiveKnowledge(client: Queryable, documentId: string, actor: KnowledgeActor): Promise<void> {
  const { live, latest } = lifecycleOf(await loadVersionRows(client, documentId))
  await client.query(`update knowledge_versions set status = 'SUPERSEDED', superseded_reason = 'ARCHIVED', processing_lease_until = null, processing_finished_at = now() where document_id = $1 and status = 'PROCESSING'`, [documentId])
  if (live?.status === "ARCHIVED") return
  const target = live ?? latest
  if (!target) return
  await client.query(`update knowledge_versions set status = 'ARCHIVED' where id = $1`, [target.id])
  await client.query(`update knowledge_documents set updated_at = now() where id = $1`, [documentId])
  await audit(client, actor, "KNOWLEDGE_ARCHIVED", documentId, { versionId: target.id, version: target.version })
}

/**
 * Reativa uma base arquivada, com o mesmo conteúdo. Versão que já foi publicada volta a valer na hora: já estava pronta. Versão arquivada
 * sem nunca ter sido publicada passa pelo processamento como qualquer publicação.
 */
export async function reactivateKnowledge(client: Queryable, documentId: string, actor: KnowledgeActor): Promise<{ processingVersionId: string | null }> {
  const { live } = lifecycleOf(await loadVersionRows(client, documentId))
  if (live?.status !== "ARCHIVED") throw new DomainError("Esta base não está arquivada.", "KNOWLEDGE_NOT_ARCHIVED", 409)
  await audit(client, actor, "KNOWLEDGE_REACTIVATED", documentId, { versionId: live.id, version: live.version })
  if (!live.published_at) {
    await client.query(`update knowledge_versions set status = 'PROCESSING', publish_requested_at = now(), publish_requested_by_name = $2, publish_requested_by = $3, reactivation_confirmed_at = now(), reactivation_confirmed_by_name = $2, processing_attempts = 0, processing_lease_until = null where id = $1`, [live.id, actor.name, actor.personId])
    return { processingVersionId: live.id }
  }
  await client.query(`update knowledge_versions set status = 'PUBLISHED', effective_from = now() where id = $1`, [live.id])
  await client.query(`update knowledge_documents set updated_at = now() where id = $1`, [documentId])
  return { processingVersionId: null }
}

/** Descarta o rascunho em edição. O que está em uso e as versões publicadas não mudam. Base que só tem o rascunho se exclui, não se descarta. */
export async function discardKnowledgeDraft(client: Queryable, documentId: string, actor: KnowledgeActor): Promise<void> {
  const rows = await loadVersionRows(client, documentId)
  const { draft } = lifecycleOf(rows)
  if (!draft) throw new DomainError("Não há rascunho para descartar.", "KNOWLEDGE_NO_DRAFT", 409)
  if (rows.length === 1) throw new DomainError("Esta base só tem o rascunho: para retirá-la, exclua a base.", "KNOWLEDGE_DRAFT_ONLY", 409)
  await client.query(`delete from knowledge_versions where id = $1 and status = any($2::text[])`, [draft.id, DRAFT_STATUSES])
  // Arquivo enviado só para este rascunho sai junto; o que outra versão usa fica.
  if (draft.file_id) await client.query(`delete from knowledge_files f where f.id = $1 and not exists (select 1 from knowledge_versions v where v.file_id = f.id)`, [draft.file_id])
  await audit(client, actor, "KNOWLEDGE_DRAFT_DISCARDED", documentId, { versionId: draft.id, version: draft.version })
}

/**
 * Reverter publica de novo o conteúdo e a configuração de uma versão anterior, inclusive os produtos, como versão NOVA, e passa pelo
 * processamento: nenhuma versão é apagada nem alterada. Versão sem configuração registrada (anterior ao histórico) volta só com o conteúdo,
 * sobre a configuração em uso.
 */
export async function revertKnowledgeVersion(client: Queryable, organizationId: string, documentId: string, sourceVersionId: string, actor: KnowledgeActor, input: PublicationInput & { discardDraft?: boolean | undefined } = {}): Promise<{ versionId: string; version: number }> {
  const rows = await loadVersionRows(client, documentId)
  const { live, latest, draft } = lifecycleOf(rows)
  const source = rows.find((row) => row.id === sourceVersionId)
  if (!source) throw new DomainError("Versão não encontrada.", "KNOWLEDGE_VERSION_NOT_FOUND", 404)
  if (source.status === "DRAFT" || source.status === "APPROVED" || source.status === "PROCESSING" || source.status === "FAILED") throw new DomainError("Só é possível reverter para uma versão que já ficou pronta.", "KNOWLEDGE_VERSION_NOT_REVERTIBLE", 409)
  if (live?.id === source.id && live.status === "PUBLISHED") throw new DomainError("Esta já é a versão em uso.", "KNOWLEDGE_VERSION_ALREADY_CURRENT", 409)
  const reactivates = live?.status === "ARCHIVED"
  if (reactivates && !input.reactivate) throw archivedError()
  if (draft && !input.discardDraft) throw new DomainError("Há um rascunho em edição. Reverter descarta esse rascunho: confirme para continuar.", "KNOWLEDGE_DRAFT_PENDING", 409)
  const config = parseConfig(source.config) ?? (await loadCurrentConfig(client, organizationId, documentId))!
  await assertProductChangeAllowed(client, organizationId, documentId, config, input.canChangeProducts)
  if (draft) await discardKnowledgeDraft(client, documentId, actor)
  const sourceContent = (await client.query<{ content: string; content_hash: string; extraction: unknown }>(`select content, content_hash, extraction from knowledge_versions where id = $1`, [source.id])).rows[0]!
  const version = (draft && latest?.id === draft.id ? (rows[1]?.version ?? 0) : (latest?.version ?? 0)) + 1
  const created = (await client.query<{ id: string }>(
    `insert into knowledge_versions (organization_id, document_id, version, content, status, content_hash, config, file_id, text_status, origin, reverted_from_version_id, change_summary, created_by_name, publish_requested_at, publish_requested_by_name, publish_requested_by, reactivation_confirmed_at, reactivation_confirmed_by_name, extraction)
     values ($1, $2, $3, $4, 'PROCESSING', $5, $6, $7, $8, 'REVERT', $9, $10, $11, now(), $11, $12, ${reactivates ? "now(), $11" : "null, null"}, $13) returning id`,
    [organizationId, documentId, version, sourceContent.content, sourceContent.content_hash, JSON.stringify(config), source.file_id, source.text_status, source.id, input.changeSummary ?? `Reversão para a versão ${source.version}`, actor.name, actor.personId, sourceContent.extraction === null || sourceContent.extraction === undefined ? null : JSON.stringify(sourceContent.extraction)],
  )).rows[0]!
  await audit(client, actor, "KNOWLEDGE_VERSION_REVERT_REQUESTED", documentId, { versionId: created.id, version, revertedFrom: source.version })
  return { versionId: created.id, version }
}

/** O arquivo de onde o reprocessamento parte: o que está sendo editado ou, sem edição, o da versão em uso. */
export async function loadReprocessSource(db: Queryable, organizationId: string, documentId: string): Promise<{ data: Buffer; config: KnowledgeVersionConfig; fileRef: NonNullable<KnowledgeVersionConfig["file"]>; latestVersion: number; hasDraft: boolean; draftContent: string | null } | null> {
  const rows = await loadVersionRows(db, documentId)
  const { live, latest, draft, updates } = lifecycleOf(rows)
  const source = draft ?? updates.find((row) => row.status === "FAILED") ?? live ?? latest
  const config = (source ? parseConfig(source.config) : null) ?? (await loadCurrentConfig(db, organizationId, documentId))
  if (!source || !config || !latest) return null
  const fileId = source.file_id ?? config.file?.id ?? null
  if (!fileId) return null
  const file = (await db.query<{ id: string; file_data: Buffer; checksum: string }>(`select id, file_data, checksum from knowledge_files where id = $1 and knowledge_document_id = $2`, [fileId, documentId])).rows[0]
  if (!file) return null
  const fileRef = config.file?.id === file.id ? config.file : { id: file.id, filename: config.file?.filename ?? null, mimeType: config.file?.mimeType ?? null, sizeBytes: file.file_data.length, checksum: file.checksum }
  const draftContent = draft ? ((await db.query<{ content: string }>(`select content from knowledge_versions where id = $1`, [draft.id])).rows[0]?.content ?? null) : null
  return { data: file.file_data, config, fileRef, latestVersion: latest.version, hasDraft: Boolean(draft), draftContent }
}

/** Trava a linha da base para uma alteração no ciclo de vida. */
export async function lockKnowledgeDocument(client: Queryable, organizationId: string, documentId: string): Promise<boolean> {
  return Boolean((await client.query(`select id from knowledge_documents where id = $1 and organization_id = $2 and deleted_at is null for update`, [documentId, organizationId])).rows[0])
}

export { audit as auditKnowledge, parseConfig as parseKnowledgeVersionConfig, hashOf as knowledgeContentHash }
