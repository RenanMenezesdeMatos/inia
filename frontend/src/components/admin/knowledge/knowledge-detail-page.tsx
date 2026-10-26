"use client"

import { useMemo, useState } from "react"
import dynamic from "next/dynamic"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, Download, FileWarning, Paperclip } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { sanitizeDocumentHtml } from "@/lib/security/sanitize-document-html"
import { cn } from "@/lib/utils"
import { useKnowledgeDocumentPreviewQuery, useKnowledgeDocumentQuery, useKnowledgeFileQuery } from "@/queries/admin/use-knowledge-queries"
import { fetchKnowledgeFile } from "@/services/admin/knowledge-service"
import { DOCUMENT_TYPE_LABELS, SOURCE_TYPE_LABELS, isFileSource, type KnowledgeDocumentDetail } from "@/schemas/admin/knowledge.schema"

import { KnowledgeArticleContent } from "./knowledge-article-content"
import { KnowledgeDocumentActionBar } from "./knowledge-document-actions"
import { ProductScopeCard } from "@/components/admin/product-catalog/product-scope-field"

import { AuthorLine, ScopeTags, SourceTypeBadge, StatusBadge, UpdatedAtLine } from "./knowledge-meta"
import { DOCUMENT_HTML_CLASS, formatFileSize } from "./knowledge-visuals"

const LIST_HREF = "/admin/knowledge"

// pdf.js só roda no browser (worker + canvas) — carrega sob demanda e sem SSR.
const KnowledgePdfViewer = dynamic(() => import("./knowledge-pdf-viewer").then((module) => module.KnowledgePdfViewer), {
  ssr: false,
  loading: () => <Skeleton className="h-[60vh] w-full rounded-xl" />,
})


function BackLink() {
  return (
    <Link href={LIST_HREF} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="h-3.5 w-3.5" /> Base de conhecimento
    </Link>
  )
}

function DetailSkeleton() {
  return (
    <div className="space-y-4">
      <BackLink />
      <Card>
        <CardContent className="space-y-4 p-6 sm:p-10">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-9 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="mt-8 h-64 w-full" />
        </CardContent>
      </Card>
    </div>
  )
}

function DetailError({ message }: { message: string }) {
  return (
    <div className="space-y-4">
      <BackLink />
      <Card>
        <CardContent className="flex flex-col items-center p-10 text-center">
          <FileWarning className="size-8 text-muted-foreground/60" />
          <p className="mt-3 text-sm font-medium">{message}</p>
          <Button variant="outline" size="sm" className="mt-4" asChild>
            <Link href={LIST_HREF}>Voltar para a biblioteca</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

// Download pelo mesmo fetch autenticado da prévia (nada de <a href> direto para a API — o cookie
// de sessão e o CORS já são tratados no adminGetBlob, e um erro vira toast em vez de tela em
// branco). Reaproveita o blob em cache quando a prévia já baixou o arquivo.
function useDownloadKnowledgeFile(document: KnowledgeDocumentDetail, cached: { blob: Blob; filename: string | null } | undefined) {
  const [pending, setPending] = useState(false)

  async function download() {
    setPending(true)
    try {
      const file = cached ?? (await fetchKnowledgeFile(document.id))
      const url = URL.createObjectURL(file.blob)
      const anchor = window.document.createElement("a")
      anchor.href = url
      anchor.download = file.filename ?? document.originalFilename ?? document.title
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

function DetailHeader({ document, children, narrow }: { document: KnowledgeDocumentDetail; children?: React.ReactNode; narrow?: boolean }) {
  const router = useRouter()
  return (
    <header className={cn("space-y-4 border-b border-border px-5 py-6 sm:px-10 sm:py-8", narrow && "mx-auto max-w-3xl border-b-0 pb-0 sm:pb-0")}>
      <div className="flex flex-wrap items-center gap-2">
        <SourceTypeBadge sourceType={document.sourceType} />
        <Badge variant="outline">{DOCUMENT_TYPE_LABELS[document.documentType]}</Badge>
        <StatusBadge status={document.status} />
        {document.latestVersion ? <span className="text-xs text-muted-foreground">versão {document.latestVersion.version}</span> : null}
      </div>
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold leading-tight tracking-tight text-balance sm:text-3xl">{document.title}</h1>
        {children}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <AuthorLine document={document} withTime />
        <UpdatedAtLine document={document} />
      </div>
      <ScopeTags document={document} />
      <ProductScopeCard kind="KNOWLEDGE_DOCUMENT" sourceId={document.id} canEdit />
      <KnowledgeDocumentActionBar document={document} onDeleted={() => router.push(LIST_HREF)} />
    </header>
  )
}

// Base "texto": experiência de artigo — coluna de leitura confortável e tipografia do
// KnowledgeArticleContent.
function ArticleView({ document }: { document: KnowledgeDocumentDetail }) {
  const content = document.latestVersion?.content ?? ""
  return (
    <Card>
      <CardContent className="p-0">
        <DetailHeader document={document} narrow />
        <article className="mx-auto max-w-3xl px-5 py-8 sm:px-10 sm:py-10">
          {content.trim() ? (
            <KnowledgeArticleContent text={content} omitLeadingHeading={document.title} />
          ) : (
            <p className="text-sm italic text-muted-foreground">Esta base não tem conteúdo textual.</p>
          )}
        </article>
      </CardContent>
    </Card>
  )
}

function ExtractedTextFallback({ document, reason }: { document: KnowledgeDocumentDetail; reason: string }) {
  const content = document.latestVersion?.content ?? ""
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

function DocxPreview({ document }: { document: KnowledgeDocumentDetail }) {
  const previewQuery = useKnowledgeDocumentPreviewQuery(document.id)
  const html = useMemo(() => (previewQuery.data ? sanitizeDocumentHtml(previewQuery.data.html) : ""), [previewQuery.data])

  if (previewQuery.isLoading) return <Skeleton className="h-[60vh] w-full rounded-xl" />
  if (previewQuery.isError || !html.trim()) {
    return (
      <ExtractedTextFallback
        document={document}
        reason="Não foi possível gerar a prévia formatada deste documento. Abaixo está o texto extraído; o arquivo original continua disponível para download."
      />
    )
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

function PlainFilePreview({ document }: { document: KnowledgeDocumentDetail }) {
  const content = document.latestVersion?.content ?? ""
  const formatted = useMemo(() => {
    if (document.sourceType !== "JSON") return content
    try {
      return JSON.stringify(JSON.parse(content), null, 2)
    } catch {
      return content
    }
  }, [content, document.sourceType])

  if (!formatted.trim()) {
    return <ExtractedTextFallback document={document} reason="Este arquivo não tem texto legível para prévia. Use o download para abrir o original." />
  }
  return (
    <pre
      className={cn(
        "max-h-[70vh] overflow-auto whitespace-pre-wrap rounded-xl border border-border bg-muted/40 p-5 leading-7",
        document.sourceType === "JSON" ? "font-mono text-[13px]" : "font-sans text-[15px]",
      )}
    >
      {formatted}
    </pre>
  )
}

function PdfPreview({ document }: { document: KnowledgeDocumentDetail }) {
  const fileQuery = useKnowledgeFileQuery(document.id)
  if (fileQuery.isLoading) return <Skeleton className="h-[60vh] w-full rounded-xl" />
  if (fileQuery.isError || !fileQuery.data) {
    return (
      <ExtractedTextFallback
        document={document}
        reason={`O arquivo original não está disponível para visualização${fileQuery.error instanceof Error ? ` (${fileQuery.error.message})` : ""}. Abaixo está o texto extraído no cadastro.`}
      />
    )
  }
  return <KnowledgePdfViewer file={fileQuery.data.blob} />
}

// Base vinda de arquivo: cabeçalho com nome/formato/tamanho e o documento como elemento
// principal (PDF renderizado, DOCX convertido em HTML, TXT/JSON como texto).
function DocumentView({ document }: { document: KnowledgeDocumentDetail }) {
  const fileQuery = useKnowledgeFileQuery(document.sourceType === "PDF" ? document.id : null)
  const { download, pending } = useDownloadKnowledgeFile(document, fileQuery.data)
  const size = formatFileSize(document.fileSizeBytes)

  return (
    <Card>
      <CardContent className="p-0">
        <DetailHeader document={document}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <Paperclip className="size-3.5 shrink-0" />
              <span className="truncate">{document.originalFilename ?? <span className="italic">Nome do arquivo não informado</span>}</span>
            </span>
            <span aria-hidden>·</span>
            <span>{SOURCE_TYPE_LABELS[document.sourceType]}</span>
            {size ? (
              <>
                <span aria-hidden>·</span>
                <span>{size}</span>
              </>
            ) : null}
          </div>
        </DetailHeader>
        <div className="space-y-3 px-4 py-5 sm:px-6 sm:py-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {document.sourceType === "PDF"
                ? "Leitura do arquivo original."
                : document.sourceType === "DOCX"
                  ? "Prévia gerada a partir do arquivo original, que permanece intacto."
                  : "Conteúdo do arquivo."}
            </p>
            <Button size="sm" variant="outline" disabled={pending} onClick={download}>
              <Download /> {pending ? "Preparando..." : "Baixar original"}
            </Button>
          </div>
          {document.sourceType === "PDF" ? (
            <PdfPreview document={document} />
          ) : document.sourceType === "DOCX" ? (
            <DocxPreview document={document} />
          ) : (
            <PlainFilePreview document={document} />
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export function KnowledgeDetailPage({ documentId }: { documentId: string }) {
  const detailQuery = useKnowledgeDocumentQuery(documentId)

  if (detailQuery.isLoading) return <DetailSkeleton />
  if (detailQuery.isError) {
    const message = detailQuery.error instanceof Error ? detailQuery.error.message : ""
    return <DetailError message={message || "Não foi possível carregar esta base de conhecimento."} />
  }
  if (!detailQuery.data) return <DetailError message="Base de conhecimento não encontrada." />

  const document = detailQuery.data
  return (
    <div className="space-y-4">
      <BackLink />
      {isFileSource(document.sourceType) ? <DocumentView document={document} /> : <ArticleView document={document} />}
    </div>
  )
}
