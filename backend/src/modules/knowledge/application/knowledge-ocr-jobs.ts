import { createHash } from "node:crypto"
import type { Database } from "../../../infrastructure/database/pool.js"
import { inTransaction } from "../../../shared/infrastructure/database/transaction.js"
import { createLogger } from "../../../shared/infrastructure/logging/logger.js"
import { IsolatedParserError } from "../../../shared/infrastructure/isolated-parser/isolated-parser.js"
import { OcrEngineUnavailableError } from "../infrastructure/pdf-ocr/ocr-engine.js"
import type { OcrProgress } from "../infrastructure/pdf-ocr/pdf-ocr-reader.js"
import { extractScannedPdf, type ExtractedFile } from "../infrastructure/text-extractor.js"
import { saveKnowledgeFileImages } from "./knowledge-file-images.js"
import { lockKnowledgeDocument, type KnowledgeActor } from "./knowledge-versions.js"

/**
 * LEITURA DOS PDFs DIGITALIZADOS EM SEGUNDO PLANO (`knowledge_ocr_jobs`, migration 179). A leitura em si roda no processo filho com teto de memória e
 * de tempo das outras leituras do arquivo enviado (R-24, `extractScannedPdf`). O envio do arquivo cria o rascunho com o texto das páginas
 * que já têm texto e pede a leitura das outras; o processamento lê uma página por vez, num documento por vez no conjunto (tarefa periódica exclusiva), e
 * no fim grava o resultado no MESMO rascunho — só se ele continuar com o mesmo arquivo e o mesmo texto de quando a leitura foi pedida. Nada é
 * publicado sozinho: o rascunho fica marcado como lido por OCR para quem enviou conferir com o PDF.
 */
type Queryable = Pick<Database, "query">

const log = createLogger("knowledge-ocr")

/** Posse renovada a cada página: o processo que morre no meio solta o documento depois disto, e outro retoma do começo. */
const LEASE = "10 minutes"
const MAX_ATTEMPTS = 3
/** Documentos por rodada da tarefa periódica: a rodada não fica horas presa, e a próxima continua a fila. */
const DOCUMENTS_PER_ROUND = 3
export const OCR_ACTOR_LABEL = "Leitura do PDF digitalizado (OCR)"

export type KnowledgeOcrStatus = {
  id: string
  status: "QUEUED" | "RUNNING" | "DONE" | "FAILED" | "CANCELLED"
  stage: "READING" | "PRINTS" | null
  pagesDone: number
  pagesTotal: number
  errorCode: string | null
  errorMessage: string | null
  createdAt: Date
  finishedAt: Date | null
  result: { pagesRead: number; failedPages: number[]; skippedPages: number[]; prints: number } | null
}

/** Pede a leitura das páginas digitalizadas do rascunho (dentro da transação de quem gravou o rascunho). */
export async function enqueueKnowledgeOcr(
  client: Queryable,
  input: { organizationId: string; documentId: string; versionId: string; fileId: string; pages: number; content: string; actor: KnowledgeActor },
): Promise<void> {
  await client.query(
    `insert into knowledge_ocr_jobs (organization_id, document_id, version_id, file_id, pages_total, base_content_hash, requested_by, requested_by_name)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [input.organizationId, input.documentId, input.versionId, input.fileId, input.pages, createHash("sha256").update(input.content).digest("hex"), input.actor.personId, input.actor.name],
  )
}

type JobRow = {
  id: string
  status: KnowledgeOcrStatus["status"]
  stage: KnowledgeOcrStatus["stage"]
  pages_done: number
  pages_total: number
  error_code: string | null
  error_message: string | null
  created_at: Date
  finished_at: Date | null
  result: KnowledgeOcrStatus["result"]
}

/** A leitura mais recente do rascunho, para a tela acompanhar. */
export async function knowledgeOcrStatus(db: Queryable, versionId: string): Promise<KnowledgeOcrStatus | null> {
  const row = (await db.query<JobRow>(
    `select id, status, stage, pages_done, pages_total, error_code, error_message, created_at, finished_at, result from knowledge_ocr_jobs where version_id = $1 order by created_at desc limit 1`,
    [versionId],
  )).rows[0]
  if (!row) return null
  return { id: row.id, status: row.status, stage: row.stage, pagesDone: row.pages_done, pagesTotal: row.pages_total, errorCode: row.error_code, errorMessage: row.error_message, createdAt: row.created_at, finishedAt: row.finished_at, result: row.result }
}

type ClaimedJob = { id: string; organization_id: string; document_id: string; version_id: string; file_id: string; base_content_hash: string; attempts: number; requested_by: string | null; requested_by_name: string | null }

class OcrJobCancelled extends Error {}

/**
 * A próxima leitura, revezando as organizações: vai primeiro a da organização atendida há mais tempo (sem leitura começada no último dia, primeiro de
 * todas) e, dentro dela, a mais antiga. Há um leitor só no conjunto: com a fila em ordem de chegada, uma organização com vários PDFs longos segurava
 * as das outras por horas.
 */
async function claimNext(db: Queryable): Promise<ClaimedJob | null> {
  return (await db.query<ClaimedJob>(
    `with served as (
       select organization_id, max(started_at) as last_started from knowledge_ocr_jobs where started_at > now() - interval '1 day' group by organization_id
     ),
     next as (
       select j.id from knowledge_ocr_jobs j left join served on served.organization_id = j.organization_id
        where j.status in ('QUEUED', 'RUNNING') and (j.lease_until is null or j.lease_until < now())
        order by served.last_started nulls first, j.created_at limit 1 for update of j skip locked
     )
     update knowledge_ocr_jobs j set status = 'RUNNING', attempts = j.attempts + 1, lease_until = now() + interval '${LEASE}', started_at = coalesce(j.started_at, now()), updated_at = now()
       from next where j.id = next.id
     returning j.id, j.organization_id, j.document_id, j.version_id, j.file_id, j.base_content_hash, j.attempts, j.requested_by, j.requested_by_name`,
  )).rows[0] ?? null
}

async function finish(db: Queryable, jobId: string, status: "DONE" | "FAILED" | "CANCELLED", details: { code?: string; message?: string; result?: unknown } = {}): Promise<void> {
  await db.query(
    `update knowledge_ocr_jobs set status = $2, lease_until = null, finished_at = now(), updated_at = now(), error_code = $3, error_message = $4, result = coalesce($5::jsonb, result) where id = $1 and status = 'RUNNING'`,
    [jobId, status, details.code ?? null, details.message ?? null, details.result === undefined ? null : JSON.stringify(details.result)],
  )
}

/** Grava o texto lido no rascunho, se ele ainda for o mesmo. Devolve o motivo quando não grava. */
async function apply(db: Database, job: ClaimedJob, extracted: ExtractedFile): Promise<"APPLIED" | "DRAFT_CHANGED" | "CANCELLED"> {
  return inTransaction(db, async (client) => {
    if (!(await lockKnowledgeDocument(client, job.organization_id, job.document_id))) return "DRAFT_CHANGED"
    const current = (await client.query<{ status: string }>(`select status from knowledge_ocr_jobs where id = $1 for update`, [job.id])).rows[0]
    if (current?.status !== "RUNNING") return "CANCELLED"
    const version = (await client.query<{ status: string; file_id: string | null; content_hash: string }>(`select status, file_id, content_hash from knowledge_versions where id = $1`, [job.version_id])).rows[0]
    if (!version || (version.status !== "DRAFT" && version.status !== "APPROVED") || version.file_id !== job.file_id || version.content_hash !== job.base_content_hash) return "DRAFT_CHANGED"
    const content = extracted.text
    await saveKnowledgeFileImages(client, job.file_id, extracted.images)
    await client.query(
      `update knowledge_versions set content = $2, content_hash = $3, text_status = $4, extraction = $5, updated_at = now(), updated_by_name = $6 where id = $1`,
      [job.version_id, content, createHash("sha256").update(content).digest("hex"), content.trim() ? "AVAILABLE" : "UNAVAILABLE", extracted.extraction ? JSON.stringify(extracted.extraction) : null, OCR_ACTOR_LABEL],
    )
    const ocr = extracted.extraction?.ocr
    const summary = { pagesRead: ocr?.pages.length ?? 0, failedPages: ocr?.failedPages ?? [], skippedPages: ocr?.skippedPages ?? [], prints: ocr?.prints ?? 0 }
    await client.query(
      `insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload) values ($1, $2, 'KNOWLEDGE_OCR_COMPLETED', 'knowledge_document', $3, $4)`,
      [job.organization_id, job.requested_by, job.document_id, JSON.stringify({ versionId: job.version_id, jobId: job.id, ...summary, engine: ocr?.engine ?? null, actorName: job.requested_by_name })],
    )
    await client.query(
      `update knowledge_ocr_jobs set status = 'DONE', lease_until = null, finished_at = now(), updated_at = now(), result = $2 where id = $1`,
      [job.id, JSON.stringify(summary)],
    )
    return "APPLIED"
  })
}

export type KnowledgeOcrDeps = {
  /** Só para os testes: outra pasta do motor (ex.: uma que não existe). */
  engineDirectory?: string
  extract?: (buffer: Buffer, onProgress: (progress: OcrProgress) => Promise<void>) => Promise<ExtractedFile>
}

async function runJob(db: Database, job: ClaimedJob, deps: KnowledgeOcrDeps): Promise<void> {
  if (job.attempts > MAX_ATTEMPTS) {
    await finish(db, job.id, "FAILED", { code: "KNOWLEDGE_OCR_FAILED", message: "A leitura do PDF parou antes do fim em várias tentativas. Reprocesse o arquivo para tentar de novo." })
    return
  }
  const file = (await db.query<{ file_data: Buffer }>(`select file_data from knowledge_files where id = $1`, [job.file_id])).rows[0]
  if (!file) {
    await finish(db, job.id, "CANCELLED", { code: "KNOWLEDGE_OCR_FILE_GONE", message: "O arquivo deste rascunho não existe mais." })
    return
  }
  // `pages_done`/`pages_total` são da etapa em curso: em READING, as páginas lidas; em PRINTS, as páginas com print já separadas.
  const onProgress = async (progress: OcrProgress) => {
    const updated = await db.query(
      `update knowledge_ocr_jobs set stage = $2, pages_done = $3, pages_total = $4, lease_until = now() + interval '${LEASE}', updated_at = now() where id = $1 and status = 'RUNNING'`,
      [job.id, progress.stage, progress.done, progress.total],
    )
    // Rascunho trocado ou descartado no meio: para de ler.
    if ((updated.rowCount ?? 0) === 0) throw new OcrJobCancelled()
  }
  try {
    const extracted = await (deps.extract ?? ((buffer, report) => extractScannedPdf(buffer, { onProgress: report, ...(deps.engineDirectory ? { engineDirectory: deps.engineDirectory } : {}) })))(file.file_data, onProgress)
    if (!extracted.text.trim()) {
      await finish(db, job.id, "FAILED", { code: "KNOWLEDGE_OCR_NO_TEXT", message: "O OCR não encontrou texto nas páginas digitalizadas. Confira se o PDF está legível ou digite o conteúdo." })
      return
    }
    const outcome = await apply(db, job, extracted)
    if (outcome === "DRAFT_CHANGED") await finish(db, job.id, "CANCELLED", { code: "KNOWLEDGE_OCR_DRAFT_CHANGED", message: "O rascunho mudou durante a leitura, e o texto lido não foi gravado. Reprocesse o arquivo para ler de novo." })
  } catch (error) {
    if (error instanceof OcrJobCancelled) return
    if (error instanceof OcrEngineUnavailableError) {
      await finish(db, job.id, "FAILED", { code: "KNOWLEDGE_OCR_UNAVAILABLE", message: error.message })
      return
    }
    // Leitores do arquivo ocupados (outra leitura no mesmo processo): volta para a fila sem gastar uma tentativa.
    if (error instanceof IsolatedParserError && error.reason === "BUSY") {
      await db.query(`update knowledge_ocr_jobs set attempts = greatest(attempts - 1, 0), lease_until = now(), updated_at = now() where id = $1 and status = 'RUNNING'`, [job.id])
      return
    }
    // Passou do teto de memória ou de tempo: tentar de novo daria o mesmo resultado.
    if (error instanceof IsolatedParserError && (error.reason === "MEMORY" || error.reason === "TIMEOUT")) {
      await finish(db, job.id, "FAILED", { code: "KNOWLEDGE_OCR_LIMIT", message: "A leitura do PDF passou do limite de memória ou de tempo do servidor. Divida o arquivo em partes menores e envie de novo." })
      return
    }
    log.error({ jobId: job.id, documentId: job.document_id, attempt: job.attempts, error: error instanceof Error ? error.message : String(error) }, "knowledge ocr failed")
    if (job.attempts < MAX_ATTEMPTS) {
      // Falha passageira: solta a posse, e a próxima rodada tenta de novo.
      await db.query(`update knowledge_ocr_jobs set lease_until = now(), updated_at = now() where id = $1 and status = 'RUNNING'`, [job.id])
      return
    }
    await finish(db, job.id, "FAILED", { code: "KNOWLEDGE_OCR_FAILED", message: "Não foi possível ler as páginas digitalizadas deste PDF. Reprocesse o arquivo para tentar de novo ou digite o conteúdo." })
  }
}

/** Uma rodada da fila: até alguns documentos, um de cada vez. Cada leitura abre o próprio processo filho, que leva o motor e devolve a memória no fim. */
export async function processKnowledgeOcrJobs(db: Database, deps: KnowledgeOcrDeps = {}): Promise<number> {
  let processed = 0
  for (; processed < DOCUMENTS_PER_ROUND; processed += 1) {
    const job = await claimNext(db)
    if (!job) break
    await runJob(db, job, deps)
  }
  return processed
}
