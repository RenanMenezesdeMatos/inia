import { createHash } from "node:crypto"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { IsolatedParserError } from "../../../shared/infrastructure/isolated-parser/isolated-parser.js"
import { createLogger } from "../../../shared/infrastructure/logging/logger.js"
import type { UploadSourceType, UploadStageKey } from "../domain/upload-stages.js"
import { ocrEngineFiles } from "../infrastructure/pdf-ocr/ocr-engine.js"
import { extractKnowledgeFile, fileContentAccepted, type ExtractedFile, type ExtractionObserver, type KnowledgeSourceType } from "../infrastructure/text-extractor.js"
import { knowledgeFileContentType } from "../domain/knowledge-file-type.js"
import { saveKnowledgeFileImages } from "./knowledge-file-images.js"
import { enqueueKnowledgeOcr } from "./knowledge-ocr-jobs.js"
import type { UploadTracker } from "./knowledge-upload-runs.js"
import { knowledgeContentHash, saveKnowledgeDraft, type KnowledgeActor, type KnowledgeVersionConfig } from "./knowledge-versions.js"

/**
 * ENVIO DE ARQUIVO DE BASE — criar a base com um arquivo e trocar o arquivo do rascunho, com o acompanhamento etapa a etapa (migration
 * 243). Saiu do router de bases (run-8, ARQ-02) sem mudar comportamento: o router confere permissão e alcance e chama daqui.
 */

const uploadLog = createLogger("knowledge-upload")

type Queryable = Pick<Database, "query">
export type UploadedFile = { buffer: Buffer; originalname: string; size: number }
export type UploadSaved = { documentId: string; versionId: string | null; ocrJobId: string | null }

/**
 * Texto do arquivo lido no processo filho do parser (R-24). Estouro de memória/tempo ou morte do filho = arquivo recusado como conteúdo
 * inaceitável (o mesmo código da pré-varredura); erro do próprio parser = arquivo ilegível; fila cheia = tente de novo.
 */
export async function extractUploadedFile(buffer: Buffer, sourceType: KnowledgeSourceType, observer: ExtractionObserver = {}): Promise<ExtractedFile> {
  try {
    return await extractKnowledgeFile(buffer, sourceType, observer)
  } catch (error) {
    if (!(error instanceof IsolatedParserError)) throw error
    uploadLog.warn({ sourceType, reason: error.reason, detail: error.message }, "knowledge file refused by isolated parser")
    if (error.reason === "BUSY") throw new DomainError("Há muitos arquivos sendo lidos agora. Tente de novo em instantes.", "KNOWLEDGE_EXTRACTION_BUSY", 503)
    if (error.reason === "FAILED") throw new DomainError("Não foi possível extrair texto do arquivo enviado.", "KNOWLEDGE_EXTRACTION_FAILED", 422)
    throw new DomainError("O arquivo foi recusado: a leitura passou do limite de memória ou de tempo. Confira se ele não está corrompido ou envie uma versão menor.", "KNOWLEDGE_FILE_TYPE_MISMATCH", 422)
  }
}

/** Cada etapa da leitura do arquivo vai para o acompanhamento no momento em que começa e termina. */
const stageObserver = (tracker: UploadTracker): ExtractionObserver => ({
  onStage: (key, state, outcome) => (state === "RUNNING" ? tracker.start(key) : tracker.finish(key, state, outcome ?? {})),
})

const FILE_CHECKED: Record<UploadSourceType, string> = {
  PDF: "PDF conferido: tipo e estrutura aceitos.",
  DOCX: "DOCX conferido: tipo e pacote aceitos.",
  TXT: "Arquivo de texto conferido.",
  JSON: "Arquivo JSON conferido.",
}

const pagesWord = (count: number) => `${count} ${count === 1 ? "página digitalizada" : "páginas digitalizadas"}`

/** A etapa de OCR depois da leitura: na fila depois da gravação, sem leitor neste servidor, ou não se aplica. */
function reportOcrPlan(tracker: UploadTracker, sourceType: KnowledgeSourceType, scannedFound: number, willRead: boolean): void {
  if (sourceType !== "PDF") return
  if (scannedFound === 0) return tracker.finish("OCR", "SKIPPED", { detail: "Nenhuma página digitalizada: todas têm texto selecionável." })
  if (willRead) return tracker.describe("OCR", "PENDING", `${pagesWord(scannedFound)}: a leitura entra na fila quando o rascunho for gravado.`)
  tracker.finish("OCR", "FAILED", { errorCode: "KNOWLEDGE_OCR_UNAVAILABLE", errorMessage: `${pagesWord(scannedFound)} ficaram sem texto: a leitura por OCR não está disponível neste servidor.` })
}

/** Erro de uma etapa conhecida: `trackUpload` grava o motivo nela, e não na que estava em andamento. */
class UploadStageFailure extends Error {
  constructor(readonly stage: UploadStageKey, readonly original: unknown) {
    super("upload stage failure")
  }
}

/**
 * Roda o envio com acompanhamento: `complete` depois da gravação (o rascunho existe de fato só depois do commit) e, em erro, o motivo
 * na etapa que falhou. O erro original é relançado.
 */
export async function trackUpload<T extends UploadSaved>(tracker: UploadTracker | null, work: () => Promise<T>): Promise<T> {
  try {
    const saved = await work()
    await tracker?.complete(saved)
    return saved
  } catch (error) {
    const original = error instanceof UploadStageFailure ? error.original : error
    throw tracker ? await tracker.fail(original, error instanceof UploadStageFailure ? error.stage : undefined) : original
  }
}

/**
 * O que fazer quando o parser não consegue ler o arquivo: na criação, a base não nasce (`REJECT`, e PDF sem texto nem OCR possível
 * também é recusado); na troca de arquivo, o arquivo entra no rascunho sem texto (`KEEP_WITHOUT_TEXT`) — dá para digitar o texto, e
 * publicar sem ele falha no processamento sem tirar do ar a versão em uso.
 */
export type UnreadableFilePolicy = "REJECT" | "KEEP_WITHOUT_TEXT"
export type UploadReading = { extracted: ExtractedFile | null; scannedPages: number[] }

/** Confere o tipo, extrai o texto e prepara o OCR, com cada etapa no acompanhamento; termina abrindo a etapa de gravação. */
export async function readUploadedFile(file: UploadedFile, sourceType: KnowledgeSourceType, tracker: UploadTracker | null, policy: UnreadableFilePolicy): Promise<UploadReading> {
  tracker?.start("CHECK")
  if (!(await fileContentAccepted(file.buffer, sourceType))) throw new DomainError("O conteúdo do arquivo não corresponde ao tipo informado (aceitos: PDF, DOCX, TXT e JSON).", "KNOWLEDGE_FILE_TYPE_MISMATCH", 422)
  if (tracker && sourceType !== "TEXT") tracker.finish("CHECK", "DONE", { detail: FILE_CHECKED[sourceType] })
  const observer = tracker ? stageObserver(tracker) : {}
  const extracted = policy === "REJECT"
    ? await extractUploadedFile(file.buffer, sourceType, observer)
    : await extractUploadedFile(file.buffer, sourceType, observer).catch((error: unknown) => {
        // Recusado pelo teto de memória ou de tempo, ou leitores ocupados: o arquivo não entra. Erro do próprio parser mantém o arquivo, sem texto novo.
        if (error instanceof DomainError && error.code !== "KNOWLEDGE_EXTRACTION_FAILED") throw error
        tracker?.finish("TEXT", "FAILED", { errorCode: "KNOWLEDGE_EXTRACTION_FAILED", errorMessage: "Não foi possível extrair texto do arquivo. Ele entra no rascunho sem texto: digite o texto ou troque o arquivo." })
        return null
      })
  // Páginas digitalizadas: o texto delas chega depois, pela leitura em segundo plano (OCR). Sem essa leitura possível, PDF sem texto não nasce base.
  const scannedPages = extracted && ocrEngineFiles() ? extracted.scannedPages : []
  if (policy === "REJECT" && !extracted?.text && scannedPages.length === 0) {
    const message = sourceType === "PDF" ? "Este PDF não tem texto para a IA ler: as páginas parecem ser imagens digitalizadas. Envie um PDF com texto selecionável ou digite o conteúdo." : "Não foi possível extrair texto do arquivo enviado."
    throw new UploadStageFailure("TEXT", new DomainError(message, "KNOWLEDGE_EXTRACTION_FAILED", 422))
  }
  if (tracker) {
    if (extracted) reportOcrPlan(tracker, sourceType, extracted.scannedPages.length, scannedPages.length > 0)
    // Sem texto, o PDF não chega ao OCR (as imagens e a conversão já foram informadas pela leitura).
    else if (sourceType === "PDF") tracker.finish("OCR", "SKIPPED", { detail: "Não feita: o texto do arquivo não pôde ser extraído." })
    tracker.start("SAVE")
  }
  return { extracted, scannedPages }
}

export type OrgScopeInput = { scopeType: string; teamId?: string | undefined; subteamId?: string | undefined }
export type SubjectScopeInput = { scopeType: string; subjectId?: string | undefined }

export type NewKnowledgeDocument = {
  organizationId: string
  title: string
  documentType: string
  operatingUniverse: string | null
  createdBy: string | null
  sourceType: KnowledgeSourceType
  orgScopes: OrgScopeInput[]
  subjectScopes: SubjectScopeInput[]
  /** Arquivo enviado com a leitura dele; sem arquivo, o texto digitado. */
  source: { file: UploadedFile; reading: UploadReading } | { text: string }
}

async function insertKnowledgeFile(client: Queryable, documentId: string, file: UploadedFile, images: ExtractedFile["images"]): Promise<{ id: string; checksum: string }> {
  const checksum = createHash("sha256").update(file.buffer).digest("hex")
  const id = (await client.query<{ id: string }>(`insert into knowledge_files(knowledge_document_id, file_data, checksum) values ($1,$2,$3) returning id`, [documentId, file.buffer, checksum])).rows[0]!.id
  await saveKnowledgeFileImages(client, id, images)
  return { id, checksum }
}

/** Cria a base com a versão 1 em RASCUNHO, o arquivo, os vínculos de Grupo e assunto e, quando há páginas digitalizadas, o OCR na fila. */
export async function createKnowledgeDocument(client: Queryable, input: NewKnowledgeDocument, actor: KnowledgeActor): Promise<UploadSaved> {
  const upload = "file" in input.source ? input.source : null
  const content = upload ? (upload.reading.extracted?.text ?? "") : (input.source as { text: string }).text
  const documentId = (await client.query<{ id: string }>(
    `insert into knowledge_documents(organization_id, title, document_type, source_type, original_filename, mime_type, file_size_bytes, created_by, operating_universe)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
    [input.organizationId, input.title, input.documentType, input.sourceType, upload?.file.originalname ?? null, upload ? knowledgeFileContentType(input.sourceType) : null, upload?.file.size ?? null, input.createdBy, input.operatingUniverse],
  )).rows[0]!.id
  const stored = upload ? await insertKnowledgeFile(client, documentId, upload.file, upload.reading.extracted?.images ?? []) : null
  const config: KnowledgeVersionConfig = {
    title: input.title,
    documentType: input.documentType as KnowledgeVersionConfig["documentType"],
    sourceType: input.sourceType,
    file: upload && stored ? { id: stored.id, filename: upload.file.originalname, mimeType: knowledgeFileContentType(input.sourceType), sizeBytes: upload.file.size, checksum: stored.checksum } : null,
    orgScopes: input.orgScopes.map((scope) => ({ scopeType: scope.scopeType, teamId: scope.teamId ?? null, subteamId: scope.subteamId ?? null })),
    subjectScopes: input.subjectScopes.map((scope) => ({ scopeType: scope.scopeType, subjectId: scope.subjectId ?? null })),
    productNodeIds: [],
  }
  const extraction = upload?.reading.extracted?.extraction ?? null
  const versionId = (await client.query<{ id: string }>(
    `insert into knowledge_versions(organization_id, document_id, version, content, status, content_hash, config, file_id, origin, created_by_name, extraction, text_status)
     values ($1,$2,1,$3,'DRAFT',$4,$5,$6,'CREATE',$7,$8,$9) returning id`,
    [input.organizationId, documentId, content, knowledgeContentHash(content), JSON.stringify(config), stored?.id ?? null, actor.name, extraction ? JSON.stringify(extraction) : null, content.trim() ? "AVAILABLE" : "UNAVAILABLE"],
  )).rows[0]!.id
  const scanned = upload?.reading.scannedPages.length ?? 0
  const ocrJobId = stored && scanned > 0 ? await enqueueKnowledgeOcr(client, { organizationId: input.organizationId, documentId, versionId, fileId: stored.id, pages: scanned, content, actor }) : null
  await replaceDocumentScopes(client, documentId, input.orgScopes, input.subjectScopes)
  return { documentId, versionId, ocrJobId }
}

/** Troca o arquivo do rascunho (com o texto extraído, se houve) e, quando há páginas digitalizadas, põe o OCR na fila. Base já travada por quem chama. */
export async function replaceDraftFile(client: Queryable, input: { organizationId: string; documentId: string; file: UploadedFile; sourceType: KnowledgeSourceType; reading: UploadReading }, actor: KnowledgeActor): Promise<UploadSaved> {
  const { organizationId, documentId, file, sourceType, reading } = input
  const stored = await insertKnowledgeFile(client, documentId, file, reading.extracted?.images ?? [])
  const draft = await saveKnowledgeDraft(client, organizationId, documentId, { file: { file: { id: stored.id, filename: file.originalname, mimeType: knowledgeFileContentType(sourceType), sizeBytes: file.size, checksum: stored.checksum }, sourceType, extractedText: reading.extracted?.text || null, extraction: reading.extracted?.extraction ?? null } }, actor)
  const ocrJobId = draft && reading.scannedPages.length > 0 ? await enqueueKnowledgeOcr(client, { organizationId, documentId, versionId: draft.versionId, fileId: stored.id, pages: reading.scannedPages.length, content: reading.extracted?.text ?? "", actor }) : null
  return { documentId, versionId: draft?.versionId ?? null, ocrJobId }
}

/** Vínculos de Grupo e de assunto da base, trocados inteiros (ausente = não mexe). */
export async function replaceDocumentScopes(client: Queryable, documentId: string, orgScopes: readonly OrgScopeInput[] | undefined, subjectScopes: readonly SubjectScopeInput[] | undefined): Promise<void> {
  if (orgScopes) {
    await client.query(`delete from knowledge_document_org_scopes where knowledge_document_id = $1`, [documentId])
    for (const scope of orgScopes) {
      await client.query(`insert into knowledge_document_org_scopes(knowledge_document_id, scope_type, team_id, subteam_id) values ($1,$2,$3,$4)`, [documentId, scope.scopeType, scope.teamId ?? null, scope.subteamId ?? null])
    }
  }
  if (subjectScopes) {
    await client.query(`delete from knowledge_document_subject_scopes where knowledge_document_id = $1`, [documentId])
    for (const scope of subjectScopes) {
      await client.query(`insert into knowledge_document_subject_scopes(knowledge_document_id, scope_type, subject_id) values ($1,$2,$3)`, [documentId, scope.scopeType, scope.subjectId ?? null])
    }
  }
}
