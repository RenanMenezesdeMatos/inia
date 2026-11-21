import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { createLogger } from "../../../shared/infrastructure/logging/logger.js"
import {
  describeStage,
  failUploadStages,
  finishStage,
  initialUploadStages,
  parseUploadStages,
  startStage,
  uploadRunView,
  type StageOutcome,
  type UploadOcrJob,
  type UploadRunStatus,
  type UploadRunView,
  type UploadSourceType,
  type UploadStage,
  type UploadStageKey,
  type UploadStageState,
} from "../domain/upload-stages.js"

/**
 * ACOMPANHAMENTO DO ENVIO DE UM ARQUIVO DE BASE (`knowledge_upload_runs`, migration 243). A requisição do envio grava cada etapa no momento em que
 * ela começa e termina; a tela consulta pelo id que ela mesma gerou antes de enviar. Gravar o andamento nunca derruba o envio: falha aqui só vai
 * para o log, e o arquivo segue. As escritas saem em ordem (uma fila por envio), e a última é esperada antes de a requisição responder.
 */
type Queryable = Pick<Database, "query">

const log = createLogger("knowledge-upload-runs")

/** Registro de acompanhamento, não histórico da base: o envio de mais de 30 dias sai quando a mesma conta envia de novo. */
const RETENTION = "30 days"
/** "Envios recentes": o último dia. */
const RECENT = "1 day"
const RECENT_LIMIT = 10

export type UploadRunKind = "CREATE" | "REPLACE_FILE"

export type UploadTracker = {
  start(key: UploadStageKey): void
  finish(key: UploadStageKey, state: Exclude<UploadStageState, "PENDING" | "RUNNING">, outcome?: StageOutcome): void
  describe(key: UploadStageKey, state: UploadStageState, detail: string): void
  /** O rascunho foi gravado. O OCR, se pedido, continua na fila e é lido de lá. */
  complete(result: { documentId: string; versionId: string | null; ocrJobId: string | null }): Promise<void>
  /** O arquivo não entrou: grava o motivo na etapa (a indicada ou a que estava em andamento) e devolve o próprio erro para relançar. */
  fail<E>(error: E, key?: UploadStageKey): Promise<E>
}

const NOOP_TRACKER: UploadTracker = {
  start: () => undefined,
  finish: () => undefined,
  describe: () => undefined,
  complete: async () => undefined,
  fail: async (error) => error,
}

const UNEXPECTED = { code: "KNOWLEDGE_UPLOAD_FAILED", message: "Erro inesperado ao processar o arquivo. Tente de novo; se repetir, avise quem administra a INIA." }

export function uploadErrorOf(error: unknown): { code: string; message: string } {
  if (error instanceof DomainError) return { code: error.code, message: error.message }
  return UNEXPECTED
}

/**
 * Abre o acompanhamento do envio. Sem id (tela antiga, importador de configuração) ou com um id que já existe, devolve um acompanhamento que não
 * grava nada: o envio funciona igual, só não é acompanhado.
 */
export async function startKnowledgeUploadRun(
  db: Queryable,
  input: { id: string | null | undefined; organizationId: string; accountId: string; kind: UploadRunKind; documentId: string | null; title: string | null; filename: string; sourceType: UploadSourceType; sizeBytes: number },
  clock: () => Date = () => new Date(),
): Promise<UploadTracker> {
  if (!input.id) return NOOP_TRACKER
  let stages: UploadStage[] = initialUploadStages(input.sourceType)
  try {
    // Registros vencidos de QUALQUER conta saem aqui (run-8, SB-06): antes só os da conta que enviava, e a conta que parou de enviar guardava
    // nome de arquivo e título para sempre.
    await db.query(`delete from knowledge_upload_runs where created_at < now() - interval '${RETENTION}'`)
    const inserted = await db.query<{ id: string }>(
      `insert into knowledge_upload_runs (id, organization_id, account_id, kind, document_id, title, filename, source_type, size_bytes, stages)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb) on conflict (id) do nothing returning id`,
      [input.id, input.organizationId, input.accountId, input.kind, input.documentId, input.title, input.filename, input.sourceType, input.sizeBytes, JSON.stringify(stages)],
    )
    if (!inserted.rows[0]) return NOOP_TRACKER
  } catch (error) {
    log.warn({ error: error instanceof Error ? error.message : String(error) }, "could not open upload tracking; the upload continues untracked")
    return NOOP_TRACKER
  }
  const id = input.id
  let writes: Promise<void> = Promise.resolve()
  const write = (sql: string, params: unknown[]) => {
    writes = writes.then(async () => {
      try {
        await db.query(sql, params)
      } catch (error) {
        log.warn({ uploadId: id, error: error instanceof Error ? error.message : String(error) }, "upload tracking write failed")
      }
    })
    return writes
  }
  const saveStages = () => write(`update knowledge_upload_runs set stages = $2::jsonb, updated_at = now() where id = $1 and status = 'PROCESSING'`, [id, JSON.stringify(stages)])
  return {
    start(key) {
      stages = startStage(stages, key, clock())
      void saveStages()
    },
    finish(key, state, outcome = {}) {
      stages = finishStage(stages, key, state, outcome, clock())
      void saveStages()
    },
    describe(key, state, detail) {
      stages = describeStage(stages, key, state, detail)
      void saveStages()
    },
    async complete(result) {
      stages = finishStage(stages, "SAVE", "DONE", { detail: "Rascunho gravado: confira o texto e publique quando estiver certo." }, clock())
      await write(
        `update knowledge_upload_runs set status = 'DONE', stages = $2::jsonb, document_id = $3, version_id = $4, ocr_job_id = $5, updated_at = now(), finished_at = now() where id = $1 and status = 'PROCESSING'`,
        [id, JSON.stringify(stages), result.documentId, result.versionId, result.ocrJobId],
      )
    },
    async fail(error, key) {
      const failure = uploadErrorOf(error)
      stages = failUploadStages(stages, key ?? null, failure, clock())
      await write(
        `update knowledge_upload_runs set status = 'FAILED', stages = $2::jsonb, error_code = $3, error_message = $4, updated_at = now(), finished_at = now() where id = $1 and status = 'PROCESSING'`,
        [id, JSON.stringify(stages), failure.code, failure.message],
      )
      return error
    },
  }
}

type RunRow = {
  id: string
  kind: UploadRunKind
  document_id: string | null
  document_title: string | null
  document_exists: boolean
  title: string | null
  filename: string
  source_type: UploadSourceType
  size_bytes: string
  status: UploadRunStatus
  stages: unknown
  error_code: string | null
  error_message: string | null
  created_at: Date
  updated_at: Date
  finished_at: Date | null
  ocr_status: UploadOcrJob["status"] | null
  ocr_stage: UploadOcrJob["stage"]
  ocr_pages_done: number | null
  ocr_pages_total: number | null
  ocr_error_code: string | null
  ocr_error_message: string | null
  ocr_result: UploadOcrJob["result"]
}

export type KnowledgeUploadRun = UploadRunView & {
  id: string
  kind: UploadRunKind
  /** A base que recebeu o arquivo, se ela ainda existe. */
  documentId: string | null
  title: string | null
  filename: string
  sourceType: UploadSourceType
  sizeBytes: number
  createdAt: Date
  updatedAt: Date
  finishedAt: Date | null
}

const RUN_SELECT = `
  select r.id, r.kind, r.document_id, d.title document_title, (d.id is not null and d.deleted_at is null) document_exists, r.title, r.filename, r.source_type,
         r.size_bytes, r.status, r.stages, r.error_code, r.error_message, r.created_at, r.updated_at, r.finished_at,
         j.status ocr_status, j.stage ocr_stage, j.pages_done ocr_pages_done, j.pages_total ocr_pages_total, j.error_code ocr_error_code, j.error_message ocr_error_message, j.result ocr_result
    from knowledge_upload_runs r
    left join knowledge_documents d on d.id = r.document_id
    left join knowledge_ocr_jobs j on j.id = r.ocr_job_id
`

function toRun(row: RunRow, now: Date): KnowledgeUploadRun {
  const ocr: UploadOcrJob | null = row.ocr_status
    ? { status: row.ocr_status, stage: row.ocr_stage, pagesDone: row.ocr_pages_done ?? 0, pagesTotal: row.ocr_pages_total ?? 0, errorCode: row.ocr_error_code, errorMessage: row.ocr_error_message, result: row.ocr_result }
    : null
  const view = uploadRunView({ status: row.status, stages: parseUploadStages(row.stages), errorCode: row.error_code, errorMessage: row.error_message, updatedAt: row.updated_at }, ocr, now)
  return {
    id: row.id,
    kind: row.kind,
    documentId: row.document_exists ? row.document_id : null,
    title: row.document_exists ? (row.document_title ?? row.title) : row.title,
    filename: row.filename,
    sourceType: row.source_type,
    sizeBytes: Number(row.size_bytes),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
    ...view,
  }
}

/** O envio, só para a conta que enviou (de outra conta ou organização = não existe). */
export async function findKnowledgeUploadRun(db: Queryable, input: { organizationId: string; accountId: string; id: string }, now = new Date()): Promise<KnowledgeUploadRun | null> {
  const row = (await db.query<RunRow>(`${RUN_SELECT} where r.id = $1 and r.organization_id = $2 and r.account_id = $3`, [input.id, input.organizationId, input.accountId])).rows[0]
  return row ? toRun(row, now) : null
}

/** Os envios do último dia da conta (no máximo 10), o mais novo primeiro. Com `documentId`, só os daquela base. */
export async function listRecentKnowledgeUploadRuns(db: Queryable, input: { organizationId: string; accountId: string; documentId?: string | null }, now = new Date()): Promise<KnowledgeUploadRun[]> {
  const rows = (await db.query<RunRow>(
    `${RUN_SELECT} where r.organization_id = $1 and r.account_id = $2 and r.created_at > now() - interval '${RECENT}' and ($3::uuid is null or r.document_id = $3::uuid)
      order by r.created_at desc limit ${RECENT_LIMIT}`,
    [input.organizationId, input.accountId, input.documentId ?? null],
  )).rows
  return rows.map((row) => toRun(row, now))
}
