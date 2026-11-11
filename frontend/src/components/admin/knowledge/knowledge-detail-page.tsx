"use client"

import { useCallback, useState } from "react"
import Link from "next/link"

import { BackLink as KitBackLink } from "@/components/ui/back-link"
import { useRouter } from "next/navigation"
import { Download, FileWarning, Paperclip } from "lucide-react"

import { KnowledgeReadingView, READING_VIEW_NOTE, ReadingModeSwitch, type ReadingMode } from "@/components/knowledge-reading/knowledge-reading-view"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { canReadAsContent } from "@/lib/knowledge/document-inserts"
import { knowledgeVersionImageSrc } from "@/lib/knowledge/knowledge-image-src"
import { cn } from "@/lib/utils"
import { useKnowledgeDocumentQuery, useKnowledgeFileQuery, useRefreshKnowledgeWhenProcessingEnds, type KnowledgeFileRef } from "@/queries/admin/use-knowledge-queries"
import { DOCUMENT_TYPE_LABELS, SOURCE_TYPE_LABELS, isFileSource, type KnowledgeDocumentDetail, type KnowledgeSourceType, type PdfExtraction } from "@/schemas/admin/knowledge.schema"

import { KnowledgeAiPreview, KnowledgeCoverageSummary } from "./knowledge-ai-preview"
import { KnowledgeArticleContent } from "./knowledge-article-content"
import { KnowledgeDocumentActionBar } from "./knowledge-document-actions"
import { KnowledgeFilePreview, useDownloadKnowledgeFile } from "./knowledge-file-preview"
import { RestrictedEditableNotice } from "./knowledge-restricted-draft"
import { KnowledgeStatusPanel } from "./knowledge-status-panel"
import { KnowledgeVersionHistory } from "./knowledge-version-history"
import { ProductScopeCard } from "@/components/admin/product-catalog/product-scope-field"

import { AuthorLine, ScopeTags, SourceTypeBadge, UpdatedAtLine } from "./knowledge-meta"
import { formatFileSize, versionLabel } from "./knowledge-visuals"

const LIST_HREF = "/admin/knowledge"

function BackLink() {
  return <KitBackLink href={LIST_HREF} label="Base de conhecimento" />
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

/**
 * O que o detalhe mostra (PEN-008): o conteúdo da versão em uso. Sem versão em uso, o de `editable`, marcado como fora do alcance da IA.
 * O texto do rascunho por cima de uma versão em uso nunca aparece aqui como se fosse o vigente: fica na edição e no histórico.
 * `editable` fora do alcance de quem lê chega sem texto: nada a mostrar, e o aviso de alcance ocupa o lugar.
 */
type DisplayedContent = {
  fileRef: KnowledgeFileRef
  version: number
  content: string
  sourceType: KnowledgeSourceType
  filename: string | null
  fileSizeBytes: number | null
  /** Aviso sobre este conteúdo: em uso pela IA ou por que ele não está disponível para ela. */
  note: string
  availableToAi: boolean
  extraction: PdfExtraction | null
}

function displayedContentOf(document: KnowledgeDocumentDetail): DisplayedContent | null {
  if (document.inUse) {
    return {
      fileRef: { documentId: document.id, versionId: document.inUse.id, inUse: true },
      version: document.inUse.version,
      content: document.inUse.content,
      sourceType: document.sourceType,
      filename: document.originalFilename,
      fileSizeBytes: document.fileSizeBytes,
      note: `Conteúdo da ${versionLabel(document.inUse.version)}, em uso pela IA.`,
      availableToAi: true,
      extraction: document.inUse.extraction ?? null,
    }
  }
  if (!document.editable || document.editable.restricted) return null
  const { editable } = document
  const label = versionLabel(editable.version)
  return {
    fileRef: { documentId: document.id, versionId: editable.versionId, inUse: false },
    version: editable.version,
    content: editable.content,
    sourceType: editable.config?.sourceType ?? document.sourceType,
    filename: editable.config ? (editable.config.file?.filename ?? null) : document.originalFilename,
    fileSizeBytes: editable.config ? (editable.config.file?.sizeBytes ?? null) : document.fileSizeBytes,
    note: document.archived?.id === editable.versionId ? `Conteúdo da ${label}, arquivada: fora de uso pela IA.` : `Conteúdo da ${label}: ainda não disponível para a IA.`,
    availableToAi: false,
    extraction: editable.extraction ?? null,
  }
}

function ContentNote({ displayed }: { displayed: DisplayedContent }) {
  if (displayed.availableToAi) return <p className="text-xs text-muted-foreground">{displayed.note}</p>
  return (
    <p className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50/60 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
      <FileWarning aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      {displayed.note}
    </p>
  )
}

function DetailHeader({ document, children, narrow }: { document: KnowledgeDocumentDetail; children?: React.ReactNode; narrow?: boolean }) {
  const router = useRouter()
  // Editar (e os produtos, que também vão para o rascunho) grava na versão em edição: fora do alcance dela, a API recusa com 403.
  const canEditDraft = !document.editable?.restricted
  return (
    <header className={cn("space-y-4 px-5 py-6 sm:px-10 sm:py-8", narrow && "mx-auto max-w-3xl pb-4 sm:pb-4")}>
      <div className="flex flex-wrap items-center gap-2">
        <SourceTypeBadge sourceType={document.sourceType} />
        <Badge variant="outline">{DOCUMENT_TYPE_LABELS[document.documentType]}</Badge>
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
      <KnowledgeStatusPanel document={document} />
      <ProductScopeCard kind="KNOWLEDGE_DOCUMENT" sourceId={document.id} canEdit={canEditDraft} />
      <KnowledgeDocumentActionBar document={document} canEdit={canEditDraft} onDeleted={() => router.push(LIST_HREF)} />
    </header>
  )
}

function FileLine({ displayed }: { displayed: DisplayedContent }) {
  const size = formatFileSize(displayed.fileSizeBytes)
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <Paperclip className="size-3.5 shrink-0" />
        <span className="truncate">{displayed.filename ?? <span className="italic">Nome do arquivo não informado</span>}</span>
      </span>
      <span aria-hidden>·</span>
      <span>{SOURCE_TYPE_LABELS[displayed.sourceType]}</span>
      {size ? (
        <>
          <span aria-hidden>·</span>
          <span>{size}</span>
        </>
      ) : null}
    </div>
  )
}

// Base "texto": experiência de artigo — coluna de leitura confortável e tipografia do KnowledgeArticleContent.
function ArticleContent({ displayed, title }: { displayed: DisplayedContent; title: string }) {
  return (
    <article className="mx-auto max-w-3xl space-y-4 px-5 py-8 sm:px-10 sm:py-10">
      <ContentNote displayed={displayed} />
      {displayed.content.trim() ? (
        <KnowledgeArticleContent text={displayed.content} omitLeadingHeading={title} />
      ) : (
        <p className="text-sm italic text-muted-foreground">Esta versão não tem conteúdo textual.</p>
      )}
    </article>
  )
}

// Base vinda de arquivo. PDF convertido abre como conteúdo, com o original a um clique; os demais, como o documento (PDF renderizado, DOCX convertido em HTML, TXT/JSON como texto).
function DocumentContent({ displayed, title, jump, onOpenPage }: { displayed: DisplayedContent; title: string; jump: { page: number; id: number } | null; onOpenPage: (page: number) => void }) {
  const canRead = displayed.sourceType === "PDF" && canReadAsContent(displayed.content, displayed.extraction)
  const [mode, setMode] = useState<ReadingMode>(canRead && !jump ? "content" : "pdf")
  // Pedir uma página (de um trecho ou de um aviso de cobertura) é pedir o PDF original naquela página.
  const [seenJump, setSeenJump] = useState(jump?.id)
  if (jump?.id !== seenJump) {
    setSeenJump(jump?.id)
    if (jump) setMode("pdf")
  }
  const { documentId, versionId } = displayed.fileRef
  const imageSrc = useCallback((imageId: string) => knowledgeVersionImageSrc(documentId, versionId, imageId), [documentId, versionId])
  // O arquivo só é baixado quando alguém vai ler o PDF: na leitura como conteúdo, ele não faz falta.
  const fileQuery = useKnowledgeFileQuery(displayed.sourceType === "PDF" && mode === "pdf" ? displayed.fileRef : null)
  const { download, pending } = useDownloadKnowledgeFile(displayed.fileRef, displayed.filename ?? title, fileQuery.data)
  const reading = canRead && mode === "content"

  return (
    <div className="space-y-3 px-4 py-5 sm:px-6 sm:py-6">
      <ContentNote displayed={displayed} />
      {displayed.extraction ? <KnowledgeCoverageSummary extraction={displayed.extraction} onOpenPage={onOpenPage} /> : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {canRead ? (
          <ReadingModeSwitch mode={mode} onChange={setMode} />
        ) : (
          <p className="text-xs text-muted-foreground">
            {displayed.sourceType === "PDF" ? "Leitura do arquivo original." : displayed.sourceType === "DOCX" ? "Prévia gerada a partir do arquivo original, que permanece intacto." : "Conteúdo do arquivo."}
          </p>
        )}
        <Button size="sm" variant="outline" disabled={pending} onClick={download}>
          <Download /> {pending ? "Preparando..." : "Baixar original"}
        </Button>
      </div>
      {canRead ? <p className="text-xs text-muted-foreground">{reading ? READING_VIEW_NOTE : "Leitura do arquivo original."}</p> : null}
      {reading ? (
        <KnowledgeReadingView content={displayed.content} extraction={displayed.extraction!} title={title} imageSrc={imageSrc} onOpenPage={onOpenPage} />
      ) : (
        <KnowledgeFilePreview fileRef={displayed.fileRef} sourceType={displayed.sourceType} content={displayed.content} page={jump?.page} jumpId={jump?.id} />
      )}
    </div>
  )
}

export function KnowledgeDetailPage({ documentId }: { documentId: string }) {
  const detailQuery = useKnowledgeDocumentQuery(documentId)
  useRefreshKnowledgeWhenProcessingEnds(detailQuery.data)
  const [tab, setTab] = useState("content")
  const [pdfJump, setPdfJump] = useState<{ page: number; id: number } | null>(null)
  // De um trecho ou de um aviso de cobertura para a página no PDF.
  const openPage = (page: number) => {
    setPdfJump((current) => ({ page, id: (current?.id ?? 0) + 1 }))
    setTab("content")
  }

  if (detailQuery.isLoading) return <DetailSkeleton />
  if (detailQuery.isError) {
    const message = detailQuery.error instanceof Error ? detailQuery.error.message : ""
    return <DetailError message={message || "Não foi possível carregar esta base de conhecimento."} />
  }
  if (!detailQuery.data) return <DetailError message="Base de conhecimento não encontrada." />

  const document = detailQuery.data
  const displayed = displayedContentOf(document)
  const fromFile = displayed !== null && isFileSource(displayed.sourceType)

  return (
    <div className="space-y-4">
      <BackLink />
      <Card>
        <CardContent className="p-0">
          <DetailHeader document={document} narrow={!fromFile}>
            {displayed && fromFile ? <FileLine displayed={displayed} /> : null}
          </DetailHeader>
          <Tabs value={tab} onValueChange={setTab}>
            <div className={cn("border-b border-border px-5 pb-3 sm:px-10", !fromFile && "mx-auto max-w-3xl")}>
              <TabsList>
                <TabsTrigger value="content">Conteúdo</TabsTrigger>
                <TabsTrigger value="ai">O que a IA lê</TabsTrigger>
                <TabsTrigger value="versions">Histórico de versões</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="content">
              {displayed ? (
                fromFile ? (
                  // A chave muda quando o texto passa a poder ser lido como conteúdo (ex.: o OCR terminou com a tela aberta): a leitura abre no conteúdo.
                  <DocumentContent key={`${displayed.fileRef.versionId}:${displayed.sourceType === "PDF" && canReadAsContent(displayed.content, displayed.extraction)}`} displayed={displayed} title={document.title} jump={pdfJump} onOpenPage={openPage} />
                ) : (
                  <ArticleContent displayed={displayed} title={document.title} />
                )
              ) : document.editable?.restricted ? (
                <div className="mx-auto max-w-3xl px-5 py-8 sm:px-10">
                  <RestrictedEditableNotice document={document} />
                </div>
              ) : (
                <p className="px-5 py-8 text-sm italic text-muted-foreground sm:px-10">Esta base ainda não tem nenhuma versão.</p>
              )}
            </TabsContent>
            <TabsContent value="ai" className="px-4 py-5 sm:px-6 sm:py-6">
              <KnowledgeAiPreview document={document} onOpenPage={openPage} />
            </TabsContent>
            <TabsContent value="versions" className="px-4 py-5 sm:px-6 sm:py-6">
              <KnowledgeVersionHistory document={document} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}
