"use client"

import { useState } from "react"
import { FileSearch, FileWarning, RefreshCw, ScanText } from "lucide-react"

import { KnowledgeDocumentImage } from "@/components/knowledge-reading/knowledge-document-image"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { imageInsertAt } from "@/lib/knowledge/document-inserts"
import { knowledgeVersionImageSrc } from "@/lib/knowledge/knowledge-image-src"
import { useKnowledgeAiPreviewQuery, useReprocessKnowledgeMutation } from "@/queries/admin/use-knowledge-queries"
import { hasRestrictedDraft, type KnowledgeAiPreview as KnowledgeAiPreviewData, type KnowledgeDocumentDetail, type PdfExtraction, type PdfPageStatus } from "@/schemas/admin/knowledge.schema"

import { KnowledgeArticleContent } from "./knowledge-article-content"
import { RestrictedEditableNotice } from "./knowledge-restricted-draft"
import { versionLabel } from "./knowledge-visuals"

const pageList = (pages: readonly number[]) => (pages.length === 1 ? `p. ${pages[0]}` : `p. ${pages.slice(0, -1).join(", ")} e ${pages[pages.length - 1]}`)
const pagesWith = (extraction: PdfExtraction, status: PdfPageStatus) => extraction.pages.filter((page) => page.status === status).map((page) => page.page)

/** Só as páginas que precisam de atenção, cada uma levando ao PDF. Página em branco não é perda de nada e fica de fora. */
const COVERAGE_NOTICES: { status: PdfPageStatus; text: (pages: string) => string }[] = [
  { status: "NO_TEXT", text: (pages) => `Sem texto, parecem digitalizadas: ${pages}. A IA não lê o que está nelas.` },
  { status: "UNREADABLE", text: (pages) => `Texto ilegível no arquivo: ${pages}. Essas páginas ficaram de fora.` },
  { status: "PARTIAL", text: (pages) => `Com imagem grande: ${pages}. O texto foi lido, mas não o que está dentro da imagem.` },
]

/** Páginas lidas pelo OCR: o texto delas veio da imagem e precisa ser conferido com o PDF antes de valer para a IA. */
export function ocrNoticeText(ocr: NonNullable<PdfExtraction["ocr"]>): string {
  const pages = pageList(ocr.pages.slice(0, 8)) + (ocr.pages.length > 8 ? ` e outras ${ocr.pages.length - 8}` : "")
  const prints = ocr.prints > 0 ? ` ${ocr.prints} ${ocr.prints === 1 ? "print foi separado" : "prints foram separados"} como imagem, sem o texto de dentro.` : ""
  const skipped = ocr.skippedPages.length > 0 ? ` ${ocr.skippedPages.length} ${ocr.skippedPages.length === 1 ? "página ficou" : "páginas ficaram"} sem leitura pelo limite por documento.` : ""
  return `Lidas por OCR, da imagem da página: ${pages}. O texto dessas páginas pode ter erros de leitura: confira com o PDF, principalmente números, prazos e valores.${prints}${skipped}`
}

function PageButtons({ pages, onOpenPage }: { pages: readonly number[]; onOpenPage: (page: number) => void }) {
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {pages.slice(0, 30).map((page) => (
        <Button key={page} type="button" size="xs" variant="outline" className="h-6 px-1.5 text-xs tabular-nums" onClick={() => onOpenPage(page)} aria-label={`Abrir a página ${page} do PDF`}>
          {page}
        </Button>
      ))}
      {pages.length > 30 ? <span className="self-center text-xs">e mais {pages.length - 30}</span> : null}
    </span>
  )
}

/** Quantas páginas foram lidas e o que falta, em poucas linhas. Sem páginas de fora, um aviso a menos. */
export function KnowledgeCoverageSummary({ extraction, onOpenPage }: { extraction: PdfExtraction; onOpenPage: (page: number) => void }) {
  const notices = COVERAGE_NOTICES.map((notice) => ({ ...notice, pages: pagesWith(extraction, notice.status) })).filter((notice) => notice.pages.length > 0)
  const blank = pagesWith(extraction, "BLANK").length
  const read = extraction.pageCount - pagesWith(extraction, "NO_TEXT").length - pagesWith(extraction, "UNREADABLE").length - blank
  return (
    <div className="space-y-2" data-testid="knowledge-coverage">
      <p className="text-sm">
        <span className="font-medium">{`${read} de ${extraction.pageCount - blank} ${extraction.pageCount - blank === 1 ? "página lida" : "páginas lidas"}`}</span>
        <span className="text-muted-foreground">{` · ${extraction.headings} ${extraction.headings === 1 ? "título" : "títulos"} · ${extraction.tables} ${extraction.tables === 1 ? "tabela" : "tabelas"}${extraction.images?.length ? ` · ${extraction.images.length} ${extraction.images.length === 1 ? "imagem" : "imagens"}` : ""}${extraction.repeatedLinesRemoved > 0 ? ` · ${extraction.repeatedLinesRemoved} linhas repetidas de cabeçalho e rodapé fora do texto` : ""}`}</span>
      </p>
      {extraction.edited ? <p className="text-xs text-muted-foreground">O texto foi editado depois da conversão: as páginas de cada trecho são as mais próximas do que foi mantido.</p> : null}
      {extraction.images === undefined ? <p className="text-xs text-muted-foreground">As imagens deste PDF não foram extraídas nesta versão: elas aparecem só no arquivo original. Reprocesse o arquivo para trazê-las para o texto.</p> : null}
      {extraction.imagesOmitted ? <p className="text-xs text-muted-foreground">{`${extraction.imagesOmitted} ${extraction.imagesOmitted === 1 ? "imagem ficou" : "imagens ficaram"} de fora pelo limite por documento: ${extraction.imagesOmitted === 1 ? "ela aparece" : "elas aparecem"} só no arquivo original.`}</p> : null}
      {extraction.ocr && extraction.ocr.pages.length > 0 ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50/60 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100" data-testid="knowledge-ocr-notice">
          <ScanText aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <div className="min-w-0">
            <p>{ocrNoticeText(extraction.ocr)}</p>
            <PageButtons pages={extraction.ocr.pages} onOpenPage={onOpenPage} />
          </div>
        </div>
      ) : null}
      {notices.map((notice) => (
        <div key={notice.status} className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50/60 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          <FileWarning aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <div className="min-w-0">
            <p>{notice.text(pageList(notice.pages.slice(0, 8)) + (notice.pages.length > 8 ? ` e outras ${notice.pages.length - 8}` : ""))}</p>
            <PageButtons pages={notice.pages} onOpenPage={onOpenPage} />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Reprocessar nunca muda o que está em uso: o resultado vira rascunho. Por cima de um rascunho com outro texto, pede confirmação. */
function ReprocessButton({ document }: { document: KnowledgeDocumentDetail }) {
  const mutation = useReprocessKnowledgeMutation()
  const [confirming, setConfirming] = useState(false)
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={mutation.isPending}
        onClick={() => (document.draft ? setConfirming(true) : mutation.mutate({ id: document.id }))}
      >
        <RefreshCw className={mutation.isPending ? "animate-spin" : undefined} /> {mutation.isPending ? "Reprocessando..." : "Reprocessar arquivo original"}
      </Button>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Substituir o texto do rascunho?</AlertDialogTitle>
            <AlertDialogDescription>O texto do rascunho será trocado pela nova conversão do arquivo, e o que foi digitado nele se perde. A versão em uso não muda.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <Button
              disabled={mutation.isPending}
              onClick={async () => {
                try {
                  await mutation.mutateAsync({ id: document.id, overwriteDraft: true })
                  setConfirming(false)
                } catch {
                  // erro já sinalizado pelo toast da mutação
                }
              }}
            >
              Substituir
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

const pagesLabel = (pages: { from: number; to: number }) => (pages.from === pages.to ? `p. ${pages.from}` : `p. ${pages.from}–${pages.to}`)

function ChunkRow({ chunk, onOpenPage, imageSrc }: { chunk: KnowledgeAiPreviewData["chunks"][number]; onOpenPage: ((page: number) => void) | undefined; imageSrc: (imageId: string) => string }) {
  const shownText = chunk.displayText ?? chunk.text
  const inserts = (chunk.images ?? []).map((image, index) => ({
    at: imageInsertAt(shownText, image.at),
    key: `${image.id}-${index}`,
    node: <KnowledgeDocumentImage src={imageSrc(image.id)} page={image.page} width={image.width} height={image.height} caption={`Imagem da página ${image.page}. A IA não lê imagens: ela recebe só o texto deste trecho.`} />,
  }))
  return (
    <AccordionItem value={String(chunk.index)} className="group/chunk overflow-hidden rounded-lg border border-border">
      <div className="flex items-center gap-1 bg-muted pr-2 transition-colors hover:bg-muted/70 group-data-[state=open]/chunk:border-b group-data-[state=open]/chunk:border-border">
        <div className="min-w-0 flex-1">
          <AccordionTrigger headingLevel={4} className="min-w-0 items-center gap-3 rounded-none border-0 px-3 py-2.5 hover:no-underline focus-visible:ring-inset">
            <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-foreground">{chunk.heading || `Trecho ${chunk.index + 1}, sem título`}</span>
            <span className="hidden shrink-0 text-xs font-normal tabular-nums text-muted-foreground sm:inline">{chunk.chars} caracteres</span>
          </AccordionTrigger>
        </div>
        {chunk.pages && onOpenPage ? (
          <Button type="button" size="xs" variant="ghost" className="h-6 px-1.5 text-xs" onClick={() => onOpenPage(chunk.pages!.from)} aria-label={`Abrir o PDF na página ${chunk.pages.from}`}>
            {pagesLabel(chunk.pages)}
          </Button>
        ) : chunk.pages ? (
          <span className="px-1.5 text-xs text-muted-foreground">{pagesLabel(chunk.pages)}</span>
        ) : null}
      </div>
      {/* h-auto: a altura medida pelo Radix serve só à animação; depois disso o texto acompanha a largura da tela sem ser cortado. */}
      <AccordionContent className="h-auto px-3 py-3">
        <KnowledgeArticleContent text={shownText} className="text-sm leading-6 sm:text-sm" inserts={inserts} />
      </AccordionContent>
    </AccordionItem>
  )
}

type PreviewVersion = { id: string; version: number; label: string }

/**
 * "O que a IA lê": os trechos reais que a busca e a IA recebem (a mesma divisão do que é usado nas respostas), a cobertura do arquivo e o
 * reprocessamento. Antes, para saber o que a IA recebia de um PDF, só abrindo a edição do texto, e nada dizia que uma página tinha ficado de fora.
 */
export function KnowledgeAiPreview({ document, onOpenPage }: { document: KnowledgeDocumentDetail; onOpenPage?: (page: number) => void }) {
  // Versão fora do alcance de quem lê fica de fora: a prévia dela é recusada (KNOWLEDGE_VERSION_RESTRICTED), e reprocessar mexe no rascunho (403).
  const draftRestricted = hasRestrictedDraft(document)
  const versions: PreviewVersion[] = [
    ...(document.draft && !draftRestricted ? [{ id: document.draft.id, version: document.draft.version, label: `Rascunho: ${versionLabel(document.draft.version)}` }] : []),
    ...(document.inUse ? [{ id: document.inUse.id, version: document.inUse.version, label: `Em uso: ${versionLabel(document.inUse.version)}` }] : []),
    ...(!document.draft && !document.inUse && document.editable && !document.editable.restricted ? [{ id: document.editable.versionId, version: document.editable.version, label: versionLabel(document.editable.version) }] : []),
  ]
  const [selected, setSelected] = useState<string | null>(null)
  const current = versions.find((version) => version.id === selected) ?? versions[0] ?? null
  const preview = useKnowledgeAiPreviewQuery(document.id, current?.id ?? null)
  const isPdf = (document.editable?.config?.sourceType ?? document.sourceType) === "PDF"
  // A página só abre o PDF quando este trecho é da versão mostrada na aba do documento.
  const shownVersionId = document.inUse?.id ?? document.editable?.versionId ?? null
  const canOpen = current?.id === shownVersionId && onOpenPage ? onOpenPage : undefined

  return (
    <div className="space-y-4" data-testid="knowledge-ai-preview">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {versions.length > 1
            ? versions.map((version) => (
                <Button key={version.id} type="button" size="sm" variant={version.id === current?.id ? "secondary" : "ghost"} aria-pressed={version.id === current?.id} onClick={() => setSelected(version.id)}>
                  {version.label}
                </Button>
              ))
            : current ? <p className="text-sm text-muted-foreground">{current.label}</p> : null}
        </div>
        {isPdf && !draftRestricted && (document.editable?.config?.file ?? document.originalFilename) ? <ReprocessButton document={document} /> : null}
      </div>
      {!current && document.editable?.restricted ? <RestrictedEditableNotice document={document} /> : null}
      {preview.isLoading ? <Skeleton className="h-48 w-full" /> : null}
      {preview.isError ? <p className="text-sm text-destructive">{preview.error instanceof Error && preview.error.message ? preview.error.message : "Não foi possível carregar a prévia."}</p> : null}
      {preview.data ? (
        <>
          {preview.data.extraction ? (
            <KnowledgeCoverageSummary extraction={preview.data.extraction} onOpenPage={(page) => (canOpen ?? (() => undefined))(page)} />
          ) : isPdf ? (
            <p className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
              <FileWarning aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              Esta versão usa a leitura anterior do PDF: texto corrido, sem títulos, sem tabelas e sem a página de cada trecho. Reprocesse o arquivo original para gerar um rascunho com a nova conversão.
            </p>
          ) : null}
          <div className="flex items-center gap-2">
            <FileSearch aria-hidden className="size-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">{`${preview.data.chunks.length} ${preview.data.chunks.length === 1 ? "trecho" : "trechos"} para a busca e a IA`}</h3>
            <Badge variant="outline">{`${preview.data.chunks.reduce((sum, chunk) => sum + chunk.chars, 0)} caracteres`}</Badge>
          </div>
          {preview.data.chunks.some((chunk) => chunk.displayText) ? <p className="text-xs text-muted-foreground">Na tela, as linhas seguem o documento. A IA recebe as mesmas palavras, na mesma ordem.</p> : null}
          {preview.data.chunks.length > 0 ? (
            <Accordion type="multiple" className="gap-1.5">
              {preview.data.chunks.map((chunk) => (
                <ChunkRow key={chunk.index} chunk={chunk} onOpenPage={canOpen} imageSrc={(imageId) => knowledgeVersionImageSrc(document.id, preview.data.versionId, imageId)} />
              ))}
            </Accordion>
          ) : (
            <p className="text-sm italic text-muted-foreground">Esta versão não tem texto para a IA consultar.</p>
          )}
        </>
      ) : null}
    </div>
  )
}
