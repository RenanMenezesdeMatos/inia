"use client"

import { useState } from "react"
import { AlertTriangle, Archive, CircleCheck, CircleSlash, Loader2, Lock, RotateCcw, Send, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"
import { useRetryKnowledgeVersionMutation } from "@/queries/admin/use-knowledge-queries"
import { isOcrReading, KNOWLEDGE_UPDATE_STATUS_LABELS, knowledgeStatusLabel, type KnowledgeDocumentDetail, type KnowledgeDocumentUpdate, type KnowledgeOcrStatus } from "@/schemas/admin/knowledge.schema"

import { DiscardKnowledgeDraftDialog, PublishKnowledgeDialog, RetryArchivedKnowledgeDialog } from "./knowledge-lifecycle-dialogs"
import { RESTRICTED_DRAFT_NOTE } from "./knowledge-restricted-draft"
import { byLine, versionLabel } from "./knowledge-visuals"

function Row({ icon, failed = false, title, children, actions }: { icon: React.ReactNode; failed?: boolean; title: string; children?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className={cn("flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg border p-3", failed && "border-destructive/40 bg-destructive/5")}>
      <span aria-hidden className="mt-0.5 shrink-0 text-muted-foreground [&_svg]:size-4">
        {icon}
      </span>
      <div className="min-w-0 flex-1 basis-56 space-y-0.5">
        <p className="text-sm font-medium">{title}</p>
        {children ? <div className="space-y-0.5 text-xs text-muted-foreground">{children}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}

function Highlight({ icon, className, title, children }: { icon: React.ReactNode; className: string; title: string; children: React.ReactNode }) {
  return (
    <div className={cn("flex items-start gap-3 rounded-lg border p-3", className)} data-testid="knowledge-in-use">
      <span aria-hidden className="mt-0.5 shrink-0 [&_svg]:size-5">
        {icon}
      </span>
      <div className="min-w-0 space-y-0.5">
        <p className="text-base font-semibold">{title}</p>
        <div className="space-y-0.5 text-xs text-muted-foreground">{children}</div>
      </div>
    </div>
  )
}

/** O destaque da tela: o que a IA consulta de verdade. Salvar ou pedir publicação nunca muda esta linha. */
function InUseRow({ document }: { document: KnowledgeDocumentDetail }) {
  if (document.inUse) {
    return (
      <Highlight icon={<CircleCheck className="text-primary" />} className="border-primary/30 bg-primary/5" title={`Em uso pela IA: ${versionLabel(document.inUse.version)} · ${knowledgeStatusLabel(document.inUse.status)}`}>
        <p>{byLine("Publicada", document.inUse.publishedByName, document.inUse.publishedAt)}</p>
        {document.inUse.changeSummary ? <p>Resumo: {document.inUse.changeSummary}</p> : null}
      </Highlight>
    )
  }
  if (document.archived) {
    return (
      <Highlight icon={<Archive className="text-muted-foreground" />} className="border-border bg-muted/50" title="Base arquivada: fora de uso pela IA">
        <p>{`Versão arquivada: ${versionLabel(document.archived.version)}. Agentes, Workflows e orquestradores não consultam esta base até ela ser reativada.`}</p>
      </Highlight>
    )
  }
  return (
    <Highlight icon={<CircleSlash className="text-amber-700 dark:text-amber-300" />} className="border-amber-300 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/40" title="Em uso pela IA: nenhuma versão pronta">
      <p>Agentes, Workflows e orquestradores não consultam esta base até uma versão ficar pronta.</p>
    </Highlight>
  )
}

const pagesLabel = (count: number) => `${count} ${count === 1 ? "página" : "páginas"}`

/** A leitura das páginas digitalizadas do rascunho: andamento enquanto lê e o motivo quando não terminou. Pronta, o aviso fica na cobertura do texto. */
function OcrProgress({ ocr }: { ocr: KnowledgeOcrStatus }) {
  if (ocr.status === "QUEUED" || ocr.status === "RUNNING") {
    const label =
      ocr.status === "QUEUED"
        ? `Leitura de ${pagesLabel(ocr.pagesTotal)} digitalizada${ocr.pagesTotal === 1 ? "" : "s"} na fila (OCR).`
        : ocr.stage === "PRINTS"
          ? `Separando os prints: ${ocr.pagesDone} de ${pagesLabel(ocr.pagesTotal)}.`
          : `Lendo as páginas digitalizadas (OCR): ${ocr.pagesDone} de ${ocr.pagesTotal}.`
    return (
      <div className="space-y-1.5 pt-1" data-testid="knowledge-ocr-progress">
        <p className="flex items-center gap-1.5 font-medium text-foreground">
          <Loader2 aria-hidden className="size-3.5 animate-spin" />
          {label}
        </p>
        {ocr.status === "RUNNING" && ocr.pagesTotal > 0 ? <Progress value={(ocr.pagesDone / ocr.pagesTotal) * 100} aria-label="Andamento da leitura" className="max-w-xs" /> : null}
        <p>O texto entra neste rascunho quando a leitura terminar, para você conferir antes de publicar. Esta tela se atualiza sozinha.</p>
      </div>
    )
  }
  if (ocr.status === "FAILED" || ocr.status === "CANCELLED") return <p className="text-destructive">{ocr.errorMessage ?? "A leitura das páginas digitalizadas não terminou."}</p>
  return null
}

function DraftRow({ document, draft }: { document: KnowledgeDocumentDetail; draft: NonNullable<KnowledgeDocumentDetail["draft"]> }) {
  const [dialog, setDialog] = useState<"publish" | "discard" | null>(null)
  const reading = isOcrReading(draft.ocr)
  // A primeira versão é o único registro da base: não há o que manter, então se retira excluindo a base (a API recusa o descarte).
  const onlyDraft = draft.version === 1
  const draftProducts = draft.config?.productNodeIds ?? document.inUseProductNodeIds
  const productsChanged = draftProducts.length !== document.inUseProductNodeIds.length || draftProducts.some((id) => !document.inUseProductNodeIds.includes(id))
  return (
    <Row
      icon={<Send />}
      title={`Rascunho: ${versionLabel(draft.version)}`}
      actions={
        <>
          <Button size="sm" disabled={reading} title={reading ? "Espere a leitura do PDF terminar e confira o texto" : undefined} onClick={() => setDialog("publish")}>
            <Send /> Publicar
          </Button>
          {onlyDraft ? null : (
            <Button size="sm" variant="ghost" onClick={() => setDialog("discard")}>
              <Trash2 /> Descartar
            </Button>
          )}
          <PublishKnowledgeDialog
            document={{ id: document.id, draftVersion: draft.version, inUseVersion: document.inUse?.version ?? null, archived: document.archived !== null, changeSummary: draft.changeSummary, productsChanged }}
            open={dialog === "publish"}
            onOpenChange={(open) => setDialog(open ? "publish" : null)}
          />
          <DiscardKnowledgeDraftDialog document={{ id: document.id, draftVersion: draft.version }} open={dialog === "discard"} onOpenChange={(open) => setDialog(open ? "discard" : null)} />
        </>
      }
    >
      <p>{byLine("Salvo", draft.updatedByName, draft.updatedAt)}</p>
      {draft.changeSummary ? <p>Resumo: {draft.changeSummary}</p> : null}
      {draft.ocr ? <OcrProgress ocr={draft.ocr} /> : null}
      {draft.textAvailable || reading ? null : <p className="font-medium text-amber-800 dark:text-amber-200">Sem texto: publicar assim falha no processamento. Edite o rascunho para digitar o texto ou trocar o arquivo.</p>}
      {draft.extraction?.ocr?.pages.length && !reading ? <p className="font-medium text-amber-800 dark:text-amber-200">Parte do texto veio do OCR: confira com o PDF antes de publicar, principalmente números, prazos e valores.</p> : null}
      {onlyDraft ? <p>Esta base só tem o rascunho: para retirá-la, use Excluir.</p> : null}
    </Row>
  )
}

/** Rascunho fora do alcance de quem lê: a API não manda o texto e recusa publicar ou descartar, então a linha só diz que ele existe e de quem é. */
function RestrictedDraftRow({ draft }: { draft: NonNullable<KnowledgeDocumentDetail["draft"]> }) {
  return (
    <Row icon={<Lock />} title={`Rascunho: ${versionLabel(draft.version)}`}>
      <div className="space-y-0.5" data-testid="knowledge-restricted-draft">
        <p>{RESTRICTED_DRAFT_NOTE}</p>
        <p>{byLine("Salvo", draft.updatedByName, draft.updatedAt)}</p>
      </div>
    </Row>
  )
}

function UpdateRow({ document, update }: { document: KnowledgeDocumentDetail; update: KnowledgeDocumentUpdate }) {
  const retryMutation = useRetryKnowledgeVersionMutation()
  const [confirming, setConfirming] = useState(false)
  const title = `Atualização: ${versionLabel(update.version)} · ${KNOWLEDGE_UPDATE_STATUS_LABELS[update.status]}`
  const previous = document.inUse
    ? `A ${versionLabel(document.inUse.version)} continua em uso.`
    : document.archived
      ? "A base continua arquivada e fora de uso pela IA."
      : "A base continua sem versão disponível para a IA."

  if (update.status === "PROCESSING") {
    return (
      <Row icon={<Loader2 className="animate-spin" />} title={title}>
        <p>{byLine("Publicação pedida", update.requestedByName, update.requestedAt)}</p>
        <p>{`${previous} Esta tela se atualiza sozinha.`}</p>
        {update.reactivationConfirmedByName ? <p>{`${update.reactivationConfirmedByName} confirmou que a base volta a valer quando esta versão ficar pronta. Se falhar, ela continua arquivada.`}</p> : null}
      </Row>
    )
  }
  return (
    <Row
      icon={<AlertTriangle />}
      failed
      title={title}
      actions={
        <>
          <Button size="sm" variant="outline" disabled={retryMutation.isPending} onClick={() => (document.archived ? setConfirming(true) : retryMutation.mutate({ id: document.id, versionId: update.id }))}>
            <RotateCcw /> {retryMutation.isPending ? "Tentando..." : "Tentar novamente"}
          </Button>
          <RetryArchivedKnowledgeDialog document={{ id: document.id, versionId: update.id, version: update.version }} open={confirming} onOpenChange={setConfirming} />
        </>
      }
    >
      <p className="text-destructive">{update.errorMessage ?? "Motivo não registrado."}</p>
      <p>{previous}</p>
    </Row>
  )
}

/**
 * Situação da base (PEN-008): a versão efetivamente em uso em destaque e, à parte, sem misturar, o rascunho e as atualizações. Nenhuma
 * versão aparece como em uso só porque foi salva ou teve a publicação pedida.
 */
export function KnowledgeStatusPanel({ document }: { document: KnowledgeDocumentDetail }) {
  return (
    <section aria-label="Situação da base" className="space-y-2">
      <InUseRow document={document} />
      {document.draft?.restricted ? <RestrictedDraftRow draft={document.draft} /> : document.draft ? <DraftRow document={document} draft={document.draft} /> : null}
      {document.updates.map((update) => (
        <UpdateRow key={update.id} document={document} update={update} />
      ))}
    </section>
  )
}
