import { z } from "zod"

/**
 * Andamento do envio de um arquivo de base (migration 243), como o servidor informa: cada etapa com o estado real (aguardando, em andamento,
 * concluída, falhou ou não se aplica), o que achou e o motivo da falha. A etapa de OCR é a da fila de leitura das páginas digitalizadas.
 */
export const UPLOAD_STAGE_KEYS = ["CHECK", "TEXT", "IMAGES", "MARKDOWN", "SAVE", "OCR"] as const
export const uploadStageStateSchema = z.enum(["PENDING", "RUNNING", "DONE", "FAILED", "SKIPPED"])
export type UploadStageState = z.infer<typeof uploadStageStateSchema>

export const knowledgeUploadStageSchema = z.object({
  key: z.enum(UPLOAD_STAGE_KEYS),
  state: uploadStageStateSchema,
  detail: z.string().nullable(),
  warning: z.string().nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  progress: z.object({ done: z.number(), total: z.number() }).nullable(),
})
export type KnowledgeUploadStage = z.infer<typeof knowledgeUploadStageSchema>

export const knowledgeUploadRunSchema = z.object({
  id: z.string(),
  kind: z.enum(["CREATE", "REPLACE_FILE"]),
  documentId: z.string().nullable(),
  title: z.string().nullable(),
  filename: z.string(),
  sourceType: z.enum(["PDF", "DOCX", "TXT", "JSON"]),
  sizeBytes: z.number(),
  status: z.enum(["PROCESSING", "DONE", "FAILED"]),
  /** Tudo terminou, inclusive a leitura por OCR. */
  finished: z.boolean(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.coerce.string(),
  updatedAt: z.coerce.string(),
  finishedAt: z.coerce.string().nullable(),
  stages: z.array(knowledgeUploadStageSchema),
})
export type KnowledgeUploadRun = z.infer<typeof knowledgeUploadRunSchema>

export const UPLOAD_STAGE_LABELS: Record<KnowledgeUploadStage["key"], string> = {
  CHECK: "Conferência do arquivo",
  TEXT: "Extração do texto",
  IMAGES: "Imagens (prints do passo a passo)",
  MARKDOWN: "Conversão para Markdown",
  SAVE: "Gravação do rascunho",
  OCR: "Páginas digitalizadas: desenho e leitura (OCR)",
}

export const UPLOAD_STAGE_STATE_LABELS: Record<UploadStageState, string> = {
  PENDING: "Aguardando",
  RUNNING: "Em andamento",
  DONE: "Concluída",
  FAILED: "Falhou",
  SKIPPED: "Não se aplica",
}
