"use client"

import { useState } from "react"
import { ChevronDown, UploadCloud } from "lucide-react"

import { Button } from "@/components/ui/button"
import { SectionLabel, StatusChip } from "@/components/ui/surface"
import { useRecentKnowledgeUploadsQuery } from "@/queries/admin/use-knowledge-queries"
import type { KnowledgeUploadRun } from "@/schemas/admin/knowledge-upload.schema"

import { KnowledgeUploadProgress, uploadHeadline } from "./knowledge-upload-progress"

/** Concluído sem nada a observar: cabe numa linha, com as etapas a um clique. Em andamento, com falha ou ressalva: aberto. */
const needsAttention = (run: KnowledgeUploadRun) => !run.finished || run.status === "FAILED" || run.stages.some((stage) => stage.state === "FAILED" || stage.warning)

function RecentUpload({ run, showDocumentLink }: { run: KnowledgeUploadRun; showDocumentLink: boolean }) {
  // Visto em andamento, continua aberto ao terminar: o painel não some de baixo dos olhos de quem acompanhava.
  const [open, setOpen] = useState(() => needsAttention(run))
  if (needsAttention(run) || open) {
    return <KnowledgeUploadProgress filename={run.filename} sizeBytes={run.sizeBytes} transfer={null} waiting={false} run={run} requestError={null} showDocumentLink={showDocumentLink} />
  }
  const headline = uploadHeadline({ transfer: null, waiting: false, run, requestError: null })
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card px-4 py-2.5" data-testid="knowledge-upload-summary">
      <span className="min-w-0 truncate text-sm">
        <span className="font-medium">{run.filename}</span>
        {run.title ? <span className="text-muted-foreground">{` · ${run.title}`}</span> : null}
      </span>
      <span className="flex items-center gap-2">
        <StatusChip tone={headline.tone}>{headline.label}</StatusChip>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)}>
          <ChevronDown /> Ver etapas
        </Button>
      </span>
    </div>
  )
}

/**
 * "ÚLTIMO ENVIO DE ARQUIVO" da base, com o estado que o servidor gravou: é por aqui que a pessoa volta depois de sair da tela durante o
 * processamento. Sem envio no último dia, não aparece. (A lista de vários envios no topo das bases saiu a pedido: atrapalhava a lista.)
 */
export function KnowledgeRecentUploads({ documentId }: { documentId: string }) {
  const query = useRecentKnowledgeUploadsQuery(documentId)
  const latest = query.data?.[0]
  if (!latest) return null
  return (
    <section className="space-y-2" aria-label="Último envio de arquivo" data-testid="knowledge-recent-uploads">
      <SectionLabel className="flex items-center gap-1.5">
        <UploadCloud aria-hidden className="size-3.5" />
        Último envio de arquivo
      </SectionLabel>
      <RecentUpload key={latest.id} run={latest} showDocumentLink={false} />
    </section>
  )
}
