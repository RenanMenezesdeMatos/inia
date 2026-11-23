"use client"

import Link from "next/link"
import { AlertTriangle, CheckCircle2, Circle, ExternalLink, FileText, Loader2, MinusCircle, XCircle, type LucideIcon } from "lucide-react"

import { Progress } from "@/components/ui/progress"
import { StatusChip, SURFACE_CARD, type Tone } from "@/components/ui/surface"
import type { UploadTransfer } from "@/lib/admin/admin-api"
import { formatShortDateTime } from "@/lib/format/date"
import { cn } from "@/lib/utils"
import { UPLOAD_STAGE_LABELS, UPLOAD_STAGE_STATE_LABELS, type KnowledgeUploadRun, type KnowledgeUploadStage, type UploadStageState } from "@/schemas/admin/knowledge-upload.schema"

import { knowledgeEditHref } from "../knowledge-editor/knowledge-editor-form"
import { formatFileSize } from "../knowledge-visuals"

const STATE_ICON: Record<UploadStageState, { icon: LucideIcon; className: string }> = {
  PENDING: { icon: Circle, className: "text-muted-foreground" },
  RUNNING: { icon: Loader2, className: "animate-spin text-primary" },
  DONE: { icon: CheckCircle2, className: "text-emerald-600 dark:text-emerald-400" },
  FAILED: { icon: XCircle, className: "text-destructive" },
  SKIPPED: { icon: MinusCircle, className: "text-muted-foreground/70" },
}

const STATE_TEXT: Record<UploadStageState, string> = {
  PENDING: "text-muted-foreground",
  RUNNING: "text-primary",
  DONE: "text-emerald-700 dark:text-emerald-300",
  FAILED: "text-destructive",
  SKIPPED: "text-muted-foreground",
}

/** Situação do envio inteiro, tirada só do que o navegador e o servidor informaram. */
export function uploadHeadline(input: { transfer: UploadTransfer | null; waiting: boolean; run: KnowledgeUploadRun | null | undefined; requestError: string | null }): { tone: Tone; label: string } {
  const { transfer, run, requestError } = input
  if (run) {
    if (run.status === "FAILED") return { tone: "danger", label: "Falhou" }
    if (run.status === "PROCESSING") return { tone: "info", label: "Processando no servidor" }
    if (!run.finished) return { tone: "info", label: "Rascunho gravado · leitura por OCR em andamento" }
    const flagged = run.stages.some((stage) => stage.state === "FAILED" || stage.warning)
    return flagged ? { tone: "warning", label: "Concluído com ressalvas" } : { tone: "success", label: "Concluído" }
  }
  if (requestError) return { tone: "danger", label: "Falhou" }
  if (transfer && (transfer.total === null || transfer.loaded < transfer.total)) return { tone: "info", label: "Enviando o arquivo" }
  if (input.waiting) return { tone: "info", label: "Aguardando o servidor" }
  return { tone: "neutral", label: "Sem acompanhamento" }
}

const percentOf = (transfer: UploadTransfer) => (transfer.total ? Math.min(100, Math.floor((transfer.loaded / transfer.total) * 100)) : null)

/** A barra do ENVIO: bytes que o navegador já mandou. Quando chega ao fim, o servidor tem o arquivo e começa a ler. */
function TransferBar({ transfer, sizeBytes, received }: { transfer: UploadTransfer | null; sizeBytes: number; received: boolean }) {
  // Visto depois (outra tela, outra hora): o servidor já tinha o arquivo inteiro para abrir o registro.
  const total = transfer?.total ?? sizeBytes
  const loaded = received ? total : (transfer?.loaded ?? 0)
  const percent = received ? 100 : transfer ? percentOf(transfer) : 0
  const sent = received || (transfer !== null && transfer.total !== null && transfer.loaded >= transfer.total)
  return (
    <div className="space-y-1.5" data-testid="knowledge-upload-transfer">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">Envio do arquivo</span>
        <span className={cn("text-xs tabular-nums", sent ? STATE_TEXT.DONE : "text-muted-foreground")}>
          {sent ? `Enviado · ${formatFileSize(total) ?? ""}` : `${formatFileSize(loaded) ?? "0 B"} de ${formatFileSize(total) ?? "tamanho desconhecido"}${percent === null ? "" : ` (${percent}%)`}`}
        </span>
      </div>
      <Progress value={percent ?? 0} aria-label="Envio do arquivo" aria-valuetext={percent === null ? "Tamanho desconhecido" : `${percent}%`} />
      {sent && !received ? <p className="text-xs text-muted-foreground">O servidor recebeu o arquivo e vai começar a ler.</p> : null}
    </div>
  )
}

function StageRow({ stage, runFailed }: { stage: KnowledgeUploadStage; runFailed: boolean }) {
  const { icon: Icon, className } = STATE_ICON[stage.state]
  // Num envio que falhou, o que não foi feito não é "não se aplica": parou antes.
  const stateLabel = runFailed && stage.state === "SKIPPED" ? "Não executada" : UPLOAD_STAGE_STATE_LABELS[stage.state]
  return (
    <li className="flex gap-3 py-2.5" data-testid={`knowledge-upload-stage-${stage.key}`} data-state={stage.state}>
      <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", className)} />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <span className={cn("text-sm font-medium", stage.state === "SKIPPED" && "text-muted-foreground")}>{UPLOAD_STAGE_LABELS[stage.key]}</span>
          <span className={cn("text-xs font-medium", STATE_TEXT[stage.state])}>{stateLabel}</span>
        </div>
        {stage.detail ? <p className="text-xs text-muted-foreground">{stage.detail}</p> : null}
        {stage.progress && stage.progress.total > 0 ? (
          <Progress value={(stage.progress.done / stage.progress.total) * 100} aria-label={`Andamento: ${UPLOAD_STAGE_LABELS[stage.key]}`} className="max-w-xs" />
        ) : null}
        {stage.warning ? (
          <p className="flex items-start gap-1.5 text-xs text-amber-800 dark:text-amber-200">
            <AlertTriangle aria-hidden className="mt-px size-3.5 shrink-0" />
            {stage.warning}
          </p>
        ) : null}
        {stage.state === "FAILED" ? (
          <p className="text-xs text-destructive" role="alert">
            {stage.errorMessage ?? "A etapa falhou."}
            {stage.errorCode ? <span className="ml-1 font-mono text-[10px] opacity-70">({stage.errorCode})</span> : null}
          </p>
        ) : null}
      </div>
    </li>
  )
}

export function UploadStageList({ stages, runFailed = false }: { stages: readonly KnowledgeUploadStage[]; runFailed?: boolean }) {
  return (
    <ol className="divide-y divide-border rounded-xl border border-border bg-card px-3" aria-label="Etapas do processamento">
      {stages.map((stage) => (
        <StageRow key={stage.key} stage={stage} runFailed={runFailed} />
      ))}
    </ol>
  )
}

export type KnowledgeUploadProgressProps = {
  filename: string
  sizeBytes: number
  /** Bytes enviados pelo navegador; nulo quando o envio é visto depois (outra tela ou outra hora). */
  transfer: UploadTransfer | null
  /** A requisição do envio ainda não respondeu. */
  waiting: boolean
  run: KnowledgeUploadRun | null | undefined
  /** Erro devolvido pela própria requisição (antes de o servidor abrir o registro, ou sem acompanhamento). */
  requestError: string | null
  /** Link para a base quando ela existe e a pessoa não está nela. */
  showDocumentLink?: boolean
  className?: string
}

/**
 * ANDAMENTO DO ENVIO DE UM ARQUIVO DE BASE: a barra do envio dos bytes e, depois, cada etapa do processamento com o estado que o servidor
 * informa (migration 243). Nada aqui conta tempo nem adianta estado: uma etapa só aparece concluída quando o servidor diz que terminou.
 */
export function KnowledgeUploadProgress({ filename, sizeBytes, transfer, waiting, run, requestError, showDocumentLink = false, className }: KnowledgeUploadProgressProps) {
  const headline = uploadHeadline({ transfer, waiting, run, requestError })
  const received = Boolean(run)
  const transferDone = received || (transfer !== null && transfer.total !== null && transfer.loaded >= transfer.total)
  return (
    <section className={cn(SURFACE_CARD, "space-y-4 p-4", className)} aria-label={`Envio de ${filename}`} data-testid="knowledge-upload-progress">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <FileText aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold" title={filename}>{filename}</p>
            <p className="text-xs text-muted-foreground">
              {[run?.sourceType, formatFileSize(sizeBytes), run ? `enviado em ${formatShortDateTime(run.createdAt)}` : null].filter(Boolean).join(" · ")}
            </p>
          </div>
        </div>
        <StatusChip tone={headline.tone} aria-live="polite">{headline.label}</StatusChip>
      </div>

      <TransferBar transfer={transfer} sizeBytes={sizeBytes} received={received} />

      <div className="space-y-2">
        <p className="text-sm font-medium">Processamento no servidor</p>
        {run ? (
          <UploadStageList stages={run.stages} runFailed={run.status === "FAILED"} />
        ) : requestError ? null : transferDone && waiting ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 aria-hidden className="size-3.5 animate-spin" />
            Aguardando o servidor informar a primeira etapa.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">Começa quando o arquivo terminar de chegar ao servidor.</p>
        )}
        {run?.status === "FAILED" && run.errorMessage ? (
          <p className="rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
            {`O arquivo não entrou na base. ${run.errorMessage}`}
          </p>
        ) : null}
        {!run && requestError ? (
          <p className="rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">{requestError}</p>
        ) : null}
        {run && !run.finished ? <p className="text-xs text-muted-foreground">Pode sair desta tela: o processamento continua no servidor, e o estado fica em “Último envio de arquivo”, dentro da base.</p> : null}
      </div>

      {showDocumentLink && run?.documentId ? (
        <Link href={knowledgeEditHref(run.documentId)} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
          <ExternalLink aria-hidden className="size-3.5" /> Abrir {run.title ? `“${run.title}”` : "a base"}
        </Link>
      ) : null}
    </section>
  )
}
