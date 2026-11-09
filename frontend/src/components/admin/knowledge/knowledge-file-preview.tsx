"use client"

import { useMemo, useState } from "react"
import dynamic from "next/dynamic"
import { FileWarning } from "lucide-react"
import { toast } from "sonner"

import { Skeleton } from "@/components/ui/skeleton"
import { sanitizeDocumentHtml } from "@/lib/security/sanitize-document-html"
import { cn } from "@/lib/utils"
import { useKnowledgeDocumentPreviewQuery, useKnowledgeFileQuery, type KnowledgeFileRef } from "@/queries/admin/use-knowledge-queries"
import { fetchKnowledgeFile, fetchKnowledgeVersionFile, type KnowledgeFile } from "@/services/admin/knowledge-service"
import type { KnowledgeSourceType } from "@/schemas/admin/knowledge.schema"

import { DOCUMENT_HTML_CLASS } from "./knowledge-visuals"

// pdf.js só roda no browser (worker + canvas) — carrega sob demanda e sem SSR.
const KnowledgePdfViewer = dynamic(() => import("./knowledge-pdf-viewer").then((module) => module.KnowledgePdfViewer), {
  ssr: false,
  loading: () => <Skeleton className="h-[60vh] w-full rounded-xl" />,
})

/**
 * Download pelo mesmo fetch autenticado da prévia (nada de <a href> direto para a API — o cookie de sessão e o CORS já são tratados no
 * adminGetBlob, e um erro vira toast em vez de tela em branco). Reaproveita o blob em cache quando a prévia já baixou o arquivo.
 */
export function useDownloadKnowledgeFile(ref: KnowledgeFileRef, fallbackName: string, cached?: KnowledgeFile) {
  const [pending, setPending] = useState(false)

  async function download() {
    setPending(true)
    try {
      const file = cached ?? (ref.inUse ? await fetchKnowledgeFile(ref.documentId) : await fetchKnowledgeVersionFile(ref.documentId, ref.versionId))
      const url = URL.createObjectURL(file.blob)
      const anchor = window.document.createElement("a")
      // O clique programático do download não é navegação do usuário.
      anchor.setAttribute("data-usage-ignore", "")
      anchor.href = url
      anchor.download = file.filename ?? fallbackName
      anchor.rel = "noopener"
      window.document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível baixar o arquivo.")
    } finally {
      setPending(false)
    }
  }

  return { download, pending }
}

function ExtractedTextFallback({ content, reason }: { content: string; reason: string }) {
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
        <FileWarning className="mt-0.5 size-4 shrink-0" />
        <p>{reason}</p>
      </div>
      {content.trim() ? (
        <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap rounded-xl border border-border bg-muted/40 p-5 font-sans text-[15px] leading-7">{content}</pre>
      ) : null}
    </div>
  )
}

function DocxPreview({ fileRef, content }: { fileRef: KnowledgeFileRef; content: string }) {
  const previewQuery = useKnowledgeDocumentPreviewQuery(fileRef)
  const html = useMemo(() => (previewQuery.data ? sanitizeDocumentHtml(previewQuery.data.html) : ""), [previewQuery.data])

  if (previewQuery.isLoading) return <Skeleton className="h-[60vh] w-full rounded-xl" />
  if (previewQuery.isError || !html.trim()) {
    return <ExtractedTextFallback content={content} reason="Não foi possível gerar a prévia formatada deste documento. Abaixo está o texto extraído; o arquivo original continua disponível para download." />
  }
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="mx-auto max-w-3xl px-5 py-8 sm:px-10 sm:py-10">
        {/* HTML já passou pelo sanitizeDocumentHtml (allowlist) antes de chegar aqui. */}
        <div className={DOCUMENT_HTML_CLASS} dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  )
}

function PlainFilePreview({ sourceType, content }: { sourceType: KnowledgeSourceType; content: string }) {
  const formatted = useMemo(() => {
    if (sourceType !== "JSON") return content
    try {
      return JSON.stringify(JSON.parse(content), null, 2)
    } catch {
      return content
    }
  }, [content, sourceType])

  if (!formatted.trim()) {
    return <ExtractedTextFallback content={content} reason="Este arquivo não tem texto legível para prévia. Use o download para abrir o original." />
  }
  return <pre className={cn("max-h-[70vh] overflow-auto whitespace-pre-wrap rounded-xl border border-border bg-muted/40 p-5 leading-7", sourceType === "JSON" ? "font-mono text-[13px]" : "font-sans text-[15px]")}>{formatted}</pre>
}

function PdfPreview({ fileRef, content, page, jumpId }: { fileRef: KnowledgeFileRef; content: string; page?: number | undefined; jumpId?: number | undefined }) {
  const fileQuery = useKnowledgeFileQuery(fileRef)
  if (fileQuery.isLoading) return <Skeleton className="h-[60vh] w-full rounded-xl" />
  if (fileQuery.isError || !fileQuery.data) {
    return (
      <ExtractedTextFallback
        content={content}
        reason={`O arquivo original não está disponível para visualização${fileQuery.error instanceof Error ? ` (${fileQuery.error.message})` : ""}. Abaixo está o texto extraído no cadastro.`}
      />
    )
  }
  return <KnowledgePdfViewer file={fileQuery.data.blob} initialPage={page} jumpId={jumpId} />
}

/** O documento de uma versão: PDF renderizado, DOCX convertido em HTML, TXT/JSON como texto. */
export function KnowledgeFilePreview({ fileRef, sourceType, content, page, jumpId }: { fileRef: KnowledgeFileRef; sourceType: KnowledgeSourceType; content: string; page?: number | undefined; jumpId?: number | undefined }) {
  if (sourceType === "PDF") return <PdfPreview fileRef={fileRef} content={content} page={page} jumpId={jumpId} />
  if (sourceType === "DOCX") return <DocxPreview fileRef={fileRef} content={content} />
  return <PlainFilePreview sourceType={sourceType} content={content} />
}
