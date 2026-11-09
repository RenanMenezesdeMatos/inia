"use client"

import { useCallback, useMemo, useState } from "react"
import dynamic from "next/dynamic"
import { useRouter } from "next/navigation"
import { ArrowLeft, Download, FileWarning, Paperclip } from "lucide-react"
import { toast } from "sonner"

import { KnowledgeArticleContent } from "@/components/admin/knowledge/knowledge-article-content"
import { SourceTypeBadge } from "@/components/admin/knowledge/knowledge-meta"
import { DOCUMENT_HTML_CLASS, formatFileSize } from "@/components/admin/knowledge/knowledge-visuals"
import { KnowledgeReadingView, READING_VIEW_NOTE, ReadingModeSwitch, type ReadingMode } from "@/components/knowledge-reading/knowledge-reading-view"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError } from "@/lib/api/api-client"
import { formatShortDateTime } from "@/lib/format/date"
import { canReadAsContent } from "@/lib/knowledge/document-inserts"
import { knowledgeMaterialImageSrc } from "@/lib/knowledge/knowledge-image-src"
import { sanitizeDocumentHtml } from "@/lib/security/sanitize-document-html"
import { cn } from "@/lib/utils"
import { useKnowledgeMaterialFileQuery, useKnowledgeMaterialPreviewQuery, useKnowledgeMaterialQuery } from "@/queries/knowledge/use-knowledge-material-queries"
import { DOCUMENT_TYPE_LABELS, SOURCE_TYPE_LABELS, isFileSource } from "@/schemas/admin/knowledge.schema"
import type { KnowledgeMaterial } from "@/schemas/knowledge/knowledge-material.schema"
import { fetchKnowledgeMaterialFile } from "@/services/knowledge/knowledge-material-service"
import { startUsageAction } from "@/lib/usage/usage-provider"

/**
 * Página de LEITURA de um material da Base de Conhecimento (`/materiais/:id`) — o destino real do
 * link "Acessar material" de um Feedback. É o MESMO documento que o admin mantém em
 * `/admin/knowledge/:id` (mesmos renderizadores: artigo, PDF, DOCX, texto), só sem ações de
 * edição e com a autorização decidida pelo backend: sem acesso, a API responde 404 e a página
 * mostra o aviso neutro — a referência num Feedback nunca concede acesso.
 */
const KnowledgePdfViewer = dynamic(() => import("@/components/admin/knowledge/knowledge-pdf-viewer").then((module) => module.KnowledgePdfViewer), {
  ssr: false,
  loading: () => <Skeleton className="h-[60vh] w-full rounded-xl" />,
})

function BackButton() {
  const router = useRouter()
  return (
    <Button type="button" variant="ghost" size="sm" className="-ml-2" onClick={() => router.back()}>
      <ArrowLeft /> Voltar
    </Button>
  )
}

function PageSkeleton() {
  return (
    <div className="space-y-4">
      <BackButton />
      <Card>
        <CardContent className="space-y-4 p-6 sm:p-10">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-9 w-3/4" />
          <Skeleton className="mt-8 h-64 w-full" />
        </CardContent>
      </Card>
    </div>
  )
}

function Unavailable({ message }: { message: string }) {
  return (
    <div className="space-y-4">
      <BackButton />
      <Card>
        <CardContent className="flex flex-col items-center p-10 text-center">
          <FileWarning className="size-8 text-muted-foreground/60" aria-hidden />
          <p className="mt-3 text-sm font-medium">{message}</p>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">Ele pode ter sido despublicado, removido ou não estar disponível para o seu grupo.</p>
        </CardContent>
      </Card>
    </div>
  )
}

function Header({ material, children }: { material: KnowledgeMaterial; children?: React.ReactNode }) {
  return (
    <header className="space-y-4 border-b border-border px-5 py-6 sm:px-10 sm:py-8">
      <div className="flex flex-wrap items-center gap-2">
        <SourceTypeBadge sourceType={material.sourceType} />
        <Badge variant="outline">{DOCUMENT_TYPE_LABELS[material.documentType]}</Badge>
        <span className="text-xs text-muted-foreground">versão {material.version}</span>
      </div>
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold leading-tight tracking-tight text-balance sm:text-3xl">{material.title}</h1>
        {children}
      </div>
      <p className="text-xs text-muted-foreground">Atualizado em {formatShortDateTime(material.updatedAt)}</p>
    </header>
  )
}

function ArticleView({ material }: { material: KnowledgeMaterial }) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="mx-auto max-w-3xl">
          <Header material={material} />
        </div>
        <article className="mx-auto max-w-3xl px-5 py-8 sm:px-10 sm:py-10">
          {material.content.trim() ? <KnowledgeArticleContent text={material.content} omitLeadingHeading={material.title} /> : <p className="text-sm italic text-muted-foreground">Este material não tem conteúdo textual.</p>}
        </article>
      </CardContent>
    </Card>
  )
}

function ExtractedTextFallback({ material, reason }: { material: KnowledgeMaterial; reason: string }) {
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
        <FileWarning className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p>{reason}</p>
      </div>
      {material.content.trim() ? <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap rounded-xl border border-border bg-muted/40 p-5 font-sans text-[15px] leading-7">{material.content}</pre> : null}
    </div>
  )
}

function DocxPreview({ material }: { material: KnowledgeMaterial }) {
  const previewQuery = useKnowledgeMaterialPreviewQuery(material.id)
  const html = useMemo(() => (previewQuery.data ? sanitizeDocumentHtml(previewQuery.data.html) : ""), [previewQuery.data])
  if (previewQuery.isLoading) return <Skeleton className="h-[60vh] w-full rounded-xl" />
  if (previewQuery.isError || !html.trim()) {
    return <ExtractedTextFallback material={material} reason="Não foi possível gerar a prévia formatada deste documento. Abaixo está o texto extraído; o arquivo original continua disponível para download." />
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

function PlainFilePreview({ material }: { material: KnowledgeMaterial }) {
  const formatted = useMemo(() => {
    if (material.sourceType !== "JSON") return material.content
    try {
      return JSON.stringify(JSON.parse(material.content), null, 2)
    } catch {
      return material.content
    }
  }, [material.content, material.sourceType])
  if (!formatted.trim()) return <ExtractedTextFallback material={material} reason="Este arquivo não tem texto legível para prévia. Use o download para abrir o original." />
  return <pre className={cn("max-h-[70vh] overflow-auto whitespace-pre-wrap rounded-xl border border-border bg-muted/40 p-5 leading-7", material.sourceType === "JSON" ? "font-mono text-[13px]" : "font-sans text-[15px]")}>{formatted}</pre>
}

/** Página citada numa fonte. Outra versão em vigor = o número pode não ser o mesmo, e a tela diz isso em vez de afirmar. */
type Citation = { page: number | undefined; versionId: string | undefined }

/** De onde a página citada veio, e o caminho até ela no PDF original quando a leitura é o conteúdo. */
function CitedPageNote({ material, citation, onOpenPdf }: { material: KnowledgeMaterial; citation: Citation; onOpenPdf?: ((page: number) => void) | undefined }) {
  if (citation.page === undefined) return null
  const page = citation.page
  const otherVersion = citation.versionId !== undefined && material.versionId !== undefined && citation.versionId !== material.versionId
  return (
    <p className="flex flex-wrap items-start gap-2 rounded-lg border border-border bg-muted/40 p-2 text-xs text-muted-foreground" data-testid="material-cited-page">
      <FileWarning className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">{otherVersion ? `A resposta citou a página ${page} de uma versão anterior deste material. Nesta versão, o conteúdo pode estar em outra página.` : `Aberto na página ${page}, citada na resposta.`}</span>
      {onOpenPdf ? (
        <Button type="button" variant="link" size="xs" className="h-auto p-0" onClick={() => onOpenPdf(page)}>
          Ver no PDF
        </Button>
      ) : null}
    </p>
  )
}

function PdfPreview({ material, citation, page, jumpId }: { material: KnowledgeMaterial; citation: Citation; page: number | undefined; jumpId: number }) {
  const fileQuery = useKnowledgeMaterialFileQuery(material.id)
  if (fileQuery.isLoading) return <Skeleton className="h-[60vh] w-full rounded-xl" />
  if (fileQuery.isError || !fileQuery.data) return <ExtractedTextFallback material={material} reason="O arquivo original não está disponível para visualização. Abaixo está o texto extraído no cadastro." />
  return (
    <div className="space-y-2">
      <CitedPageNote material={material} citation={citation} />
      <KnowledgePdfViewer file={fileQuery.data.blob} initialPage={page} jumpId={jumpId} />
    </div>
  )
}

function useDownload(material: KnowledgeMaterial, cached: { blob: Blob; filename: string | null } | undefined) {
  const [pending, setPending] = useState(false)
  async function download() {
    setPending(true)
    const action = startUsageAction("material.download")
    try {
      const file = cached ?? (await fetchKnowledgeMaterialFile(material.id))
      const url = URL.createObjectURL(file.blob)
      const anchor = window.document.createElement("a")
      // O clique programático do download não é navegação do usuário.
      anchor.setAttribute("data-usage-ignore", "")
      anchor.href = url
      anchor.download = file.filename ?? material.originalFilename ?? material.title
      anchor.rel = "noopener"
      window.document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      action.succeed()
    } catch (error) {
      action.fail("DOWNLOAD_FAILED")
      toast.error(error instanceof Error ? error.message : "Não foi possível baixar o arquivo.")
    } finally {
      setPending(false)
    }
  }
  return { download, pending }
}

function DocumentView({ material, citation }: { material: KnowledgeMaterial; citation: Citation }) {
  const isPdf = material.sourceType === "PDF"
  const canRead = isPdf && canReadAsContent(material.content, material.extraction)
  const [mode, setMode] = useState<ReadingMode>(canRead ? "content" : "pdf")
  const [pdfTarget, setPdfTarget] = useState({ page: citation.page, id: 0 })
  const openPdfPage = useCallback((page: number) => {
    setPdfTarget((current) => ({ page, id: current.id + 1 }))
    setMode("pdf")
  }, [])
  const imageSrc = useCallback((imageId: string) => knowledgeMaterialImageSrc(material.id, imageId), [material.id])
  // O arquivo só é baixado quando alguém vai ler o PDF: na leitura como conteúdo, ele não faz falta.
  const fileQuery = useKnowledgeMaterialFileQuery(isPdf && mode === "pdf" ? material.id : null)
  const { download, pending } = useDownload(material, fileQuery.data)
  const size = formatFileSize(material.fileSizeBytes)
  const reading = canRead && mode === "content"
  return (
    <Card>
      <CardContent className="p-0">
        <Header material={material}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <Paperclip className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{material.originalFilename ?? <span className="italic">Nome do arquivo não informado</span>}</span>
            </span>
            <span aria-hidden>·</span>
            <span>{SOURCE_TYPE_LABELS[material.sourceType]}</span>
            {size ? (
              <>
                <span aria-hidden>·</span>
                <span>{size}</span>
              </>
            ) : null}
          </div>
        </Header>
        <div className="space-y-3 px-4 py-5 sm:px-6 sm:py-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {canRead ? <ReadingModeSwitch mode={mode} onChange={setMode} /> : <p className="text-xs text-muted-foreground">{isPdf ? "Leitura do arquivo original." : material.sourceType === "DOCX" ? "Prévia gerada a partir do arquivo original." : "Conteúdo do arquivo."}</p>}
            <Button size="sm" variant="outline" disabled={pending} onClick={download} data-usage-element="material.download">
              <Download /> {pending ? "Preparando..." : "Baixar original"}
            </Button>
          </div>
          {canRead ? <p className="text-xs text-muted-foreground">{reading ? READING_VIEW_NOTE : "Leitura do arquivo original."}</p> : null}
          {reading ? (
            <div className="space-y-3">
              <CitedPageNote material={material} citation={citation} onOpenPdf={openPdfPage} />
              <KnowledgeReadingView content={material.content} extraction={material.extraction!} title={material.title} imageSrc={imageSrc} targetPage={citation.page} onOpenPage={openPdfPage} />
            </div>
          ) : isPdf ? (
            <PdfPreview material={material} citation={citation} page={pdfTarget.page} jumpId={pdfTarget.id} />
          ) : material.sourceType === "DOCX" ? (
            <DocxPreview material={material} />
          ) : (
            <PlainFilePreview material={material} />
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export function KnowledgeMaterialPage({ materialId, citedPage, citedVersionId }: { materialId: string; citedPage?: number | undefined; citedVersionId?: string | undefined }) {
  const query = useKnowledgeMaterialQuery(materialId)
  if (query.isLoading) return <PageSkeleton />
  if (query.isError) {
    const error = query.error
    const notFound = error instanceof ApiError && error.status === 404
    return <Unavailable message={notFound ? "Este material de apoio não está disponível para você." : error instanceof Error && error.message ? error.message : "Não foi possível carregar este material."} />
  }
  if (!query.data) return <Unavailable message="Este material de apoio não está disponível para você." />
  const material = query.data
  return (
    <div className="mx-auto w-full max-w-5xl space-y-4">
      <BackButton />
      {isFileSource(material.sourceType) ? <DocumentView material={material} citation={{ page: citedPage, versionId: citedVersionId }} /> : <ArticleView material={material} />}
    </div>
  )
}
