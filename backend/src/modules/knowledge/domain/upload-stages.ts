/**
 * ETAPAS DO PROCESSAMENTO DE UM ARQUIVO ENVIADO PARA A BASE (migration 243). Puro: o que cada etapa é, como ela começa e termina, e como a tela
 * recebe o estado. O estado vem sempre de quem fez o trabalho — a requisição do envio grava cada passo, e a leitura por OCR é a da fila
 * (`knowledge_ocr_jobs`) — nunca de um relógio. Uma etapa só fica `DONE` depois que terminou de fato.
 */
export const UPLOAD_STAGE_KEYS = ["CHECK", "TEXT", "IMAGES", "MARKDOWN", "SAVE", "OCR"] as const
export type UploadStageKey = (typeof UPLOAD_STAGE_KEYS)[number]

/** PENDING = aguardando; RUNNING = em andamento; DONE = concluída; FAILED = falhou; SKIPPED = não se aplica a este arquivo ou não foi feita. */
export type UploadStageState = "PENDING" | "RUNNING" | "DONE" | "FAILED" | "SKIPPED"

export type UploadStage = {
  key: UploadStageKey
  state: UploadStageState
  /** O que a etapa achou ou por que não se aplica (ex.: "12 páginas lidas"). */
  detail: string | null
  /** Concluída com ressalva (ex.: imagens que passaram do limite). */
  warning: string | null
  errorCode: string | null
  errorMessage: string | null
  startedAt: string | null
  finishedAt: string | null
}

export type UploadSourceType = "PDF" | "DOCX" | "TXT" | "JSON"
export type UploadRunStatus = "PROCESSING" | "DONE" | "FAILED"

export type StageOutcome = { detail?: string | null; warning?: string | null; errorCode?: string | null; errorMessage?: string | null }

const blank = (key: UploadStageKey): UploadStage => ({ key, state: "PENDING", detail: null, warning: null, errorCode: null, errorMessage: null, startedAt: null, finishedAt: null })
const notApplicable = (key: UploadStageKey, detail: string): UploadStage => ({ ...blank(key), state: "SKIPPED", detail })

/**
 * As etapas do arquivo, todas aguardando, menos as que não existem para o tipo dele. DOCX: o texto sai como está (sem Markdown) e as imagens não
 * são separadas (aparecem na prévia do arquivo); só PDF digitalizado passa por OCR. Assim a tela nunca promete uma etapa que o servidor não faz.
 */
export function initialUploadStages(sourceType: UploadSourceType): UploadStage[] {
  if (sourceType === "PDF") return UPLOAD_STAGE_KEYS.map(blank)
  const images = sourceType === "DOCX" ? "Os prints do DOCX não são separados do arquivo: eles aparecem na prévia do arquivo original." : "Arquivo de texto: não tem imagens."
  const markdown = sourceType === "DOCX" ? "O texto do DOCX entra como está, sem conversão para Markdown." : "O texto entra como está."
  return UPLOAD_STAGE_KEYS.map((key) => {
    if (key === "IMAGES") return notApplicable(key, images)
    if (key === "MARKDOWN") return notApplicable(key, markdown)
    if (key === "OCR") return notApplicable(key, "Só PDF digitalizado passa pela leitura das páginas (OCR).")
    return blank(key)
  })
}

const replace = (stages: readonly UploadStage[], key: UploadStageKey, change: (stage: UploadStage) => UploadStage) => stages.map((stage) => (stage.key === key ? change(stage) : stage))

export function startStage(stages: readonly UploadStage[], key: UploadStageKey, at: Date): UploadStage[] {
  return replace(stages, key, (stage) => ({ ...stage, state: "RUNNING", startedAt: stage.startedAt ?? at.toISOString(), finishedAt: null }))
}

/** Termina a etapa (concluída, com falha que não impede o resto, ou não feita) com o que ela achou. */
export function finishStage(stages: readonly UploadStage[], key: UploadStageKey, state: Exclude<UploadStageState, "PENDING" | "RUNNING">, outcome: StageOutcome, at: Date): UploadStage[] {
  return replace(stages, key, (stage) => ({
    ...stage,
    state,
    detail: outcome.detail === undefined ? stage.detail : outcome.detail,
    warning: outcome.warning ?? null,
    errorCode: state === "FAILED" ? (outcome.errorCode ?? null) : null,
    errorMessage: state === "FAILED" ? (outcome.errorMessage ?? null) : null,
    startedAt: stage.startedAt ?? at.toISOString(),
    finishedAt: at.toISOString(),
  }))
}

/** Muda o que a etapa diz sem mudar o estado (ex.: OCR na fila depois da gravação). */
export function describeStage(stages: readonly UploadStage[], key: UploadStageKey, state: UploadStageState, detail: string): UploadStage[] {
  return replace(stages, key, (stage) => ({ ...stage, state, detail }))
}

const NOT_RUN_AFTER_FAILURE = "Não executada: o processamento parou numa etapa anterior."

/**
 * O arquivo não entrou: a etapa que falhou fica com o motivo, e as que ainda esperavam ficam como não feitas — nunca "aguardando" algo que não vai
 * acontecer. Sem etapa indicada, falha a que estava em andamento; sem nenhuma, a primeira que ainda esperava.
 */
export function failUploadStages(stages: readonly UploadStage[], key: UploadStageKey | null, error: { code: string; message: string }, at: Date): UploadStage[] {
  const target = key ?? stages.find((stage) => stage.state === "RUNNING")?.key ?? stages.find((stage) => stage.state === "PENDING")?.key ?? null
  return stages.map((stage) => {
    if (stage.key === target) return { ...stage, state: "FAILED", errorCode: error.code, errorMessage: error.message, startedAt: stage.startedAt ?? at.toISOString(), finishedAt: at.toISOString() }
    if (stage.state === "PENDING" || stage.state === "RUNNING") return { ...stage, state: "SKIPPED", detail: NOT_RUN_AFTER_FAILURE, finishedAt: stage.state === "RUNNING" ? at.toISOString() : null }
    return stage
  })
}

/**
 * Sem notícia da requisição por este tempo, ela não está mais lendo (a API reiniciou ou caiu no meio). O maior caminho medido é a fila de leitores
 * (até 4 na espera) com o layout e as imagens de cada um no teto de 90 s: cerca de 15 min. Com folga, 30.
 */
export const UPLOAD_RUN_STALE_MS = 30 * 60_000
export const UPLOAD_RUN_INTERRUPTED = {
  code: "KNOWLEDGE_UPLOAD_INTERRUPTED",
  message: "O processamento parou sem terminar (o servidor reiniciou ou a conexão caiu). O arquivo não entrou: envie de novo.",
} as const

/** Estado da leitura por OCR, como `knowledge_ocr_jobs` informa. */
export type UploadOcrJob = {
  status: "QUEUED" | "RUNNING" | "DONE" | "FAILED" | "CANCELLED"
  stage: "READING" | "PRINTS" | null
  pagesDone: number
  pagesTotal: number
  errorCode: string | null
  errorMessage: string | null
  result: { pagesRead: number; failedPages: number[]; skippedPages: number[]; prints: number } | null
}

export type UploadRunRecord = {
  status: UploadRunStatus
  stages: readonly UploadStage[]
  errorCode: string | null
  errorMessage: string | null
  updatedAt: Date
}

export type UploadStageView = UploadStage & { progress: { done: number; total: number } | null }
export type UploadRunView = {
  status: UploadRunStatus
  /** Tudo terminou, inclusive o OCR: a tela para de consultar. */
  finished: boolean
  errorCode: string | null
  errorMessage: string | null
  stages: UploadStageView[]
}

const pages = (count: number) => `${count} ${count === 1 ? "página" : "páginas"}`

function ocrStage(stage: UploadStage, job: UploadOcrJob | null): UploadStageView {
  if (!job) return { ...stage, progress: null }
  if (job.status === "QUEUED") return { ...stage, state: "PENDING", detail: `${pages(job.pagesTotal)} digitalizada${job.pagesTotal === 1 ? "" : "s"} na fila de leitura.`, progress: null }
  if (job.status === "RUNNING") {
    const detail = job.stage === "PRINTS" ? `Recortando os prints e lendo de novo as páginas com print: ${job.pagesDone} de ${job.pagesTotal}.` : `Desenhando e lendo as páginas: ${job.pagesDone} de ${job.pagesTotal}.`
    return { ...stage, state: "RUNNING", detail, progress: job.pagesTotal > 0 ? { done: job.pagesDone, total: job.pagesTotal } : null }
  }
  if (job.status === "DONE") {
    const result = job.result
    const unread = (result?.failedPages.length ?? 0) + (result?.skippedPages.length ?? 0)
    const detail = result ? `${pages(result.pagesRead)} lida${result.pagesRead === 1 ? "" : "s"}${result.prints > 0 ? `, ${result.prints} print${result.prints === 1 ? "" : "s"} recortado${result.prints === 1 ? "" : "s"}` : ""}. Confira o texto com o PDF antes de publicar.` : "Leitura concluída. Confira o texto com o PDF antes de publicar."
    return { ...stage, state: "DONE", detail, warning: unread > 0 ? `${pages(unread)} ${unread === 1 ? "ficou" : "ficaram"} sem leitura.` : null, progress: null }
  }
  return {
    ...stage,
    state: "FAILED",
    errorCode: job.errorCode ?? "KNOWLEDGE_OCR_FAILED",
    errorMessage: job.errorMessage ?? (job.status === "CANCELLED" ? "A leitura das páginas digitalizadas foi cancelada." : "A leitura das páginas digitalizadas não terminou."),
    progress: null,
  }
}

/**
 * O que a tela recebe: as etapas gravadas pela requisição e, na de OCR, o estado da fila. Requisição sem notícia há mais de `UPLOAD_RUN_STALE_MS`
 * aparece como interrompida (sem gravar nada: quem lê não muda o registro).
 */
export function uploadRunView(run: UploadRunRecord, ocrJob: UploadOcrJob | null, now: Date): UploadRunView {
  const stale = run.status === "PROCESSING" && now.getTime() - run.updatedAt.getTime() > UPLOAD_RUN_STALE_MS
  const stages = stale ? failUploadStages(run.stages, null, UPLOAD_RUN_INTERRUPTED, run.updatedAt) : run.stages
  const status: UploadRunStatus = stale ? "FAILED" : run.status
  const view = stages.map((stage) => (stage.key === "OCR" && status === "DONE" ? ocrStage(stage, ocrJob) : { ...stage, progress: null }))
  const ocrOpen = view.some((stage) => stage.key === "OCR" && (stage.state === "PENDING" || stage.state === "RUNNING"))
  return {
    status,
    finished: status === "FAILED" || (status === "DONE" && !ocrOpen),
    errorCode: stale ? UPLOAD_RUN_INTERRUPTED.code : run.errorCode,
    errorMessage: stale ? UPLOAD_RUN_INTERRUPTED.message : run.errorMessage,
    stages: view,
  }
}

/** Lê a lista gravada; o que não for uma etapa conhecida é ignorado (registro de outra versão). */
export function parseUploadStages(value: unknown): UploadStage[] {
  if (!Array.isArray(value)) return []
  const states = new Set<UploadStageState>(["PENDING", "RUNNING", "DONE", "FAILED", "SKIPPED"])
  const keys = new Set<string>(UPLOAD_STAGE_KEYS)
  const text = (input: unknown) => (typeof input === "string" ? input : null)
  return value.flatMap((item): UploadStage[] => {
    if (!item || typeof item !== "object") return []
    const raw = item as Record<string, unknown>
    if (typeof raw.key !== "string" || !keys.has(raw.key) || typeof raw.state !== "string" || !states.has(raw.state as UploadStageState)) return []
    return [{ key: raw.key as UploadStageKey, state: raw.state as UploadStageState, detail: text(raw.detail), warning: text(raw.warning), errorCode: text(raw.errorCode), errorMessage: text(raw.errorMessage), startedAt: text(raw.startedAt), finishedAt: text(raw.finishedAt) }]
  })
}
