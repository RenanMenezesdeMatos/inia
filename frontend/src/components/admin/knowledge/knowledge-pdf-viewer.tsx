"use client"

import { useEffect, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, Maximize2, ZoomIn, ZoomOut } from "lucide-react"
import { Document, Page, pdfjs } from "react-pdf"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"

// O worker do pdf.js precisa ser configurado no mesmo módulo que usa <Document>/<Page> (ver
// README do react-pdf) e este módulo só pode rodar no browser — quem importa usa next/dynamic
// com ssr: false.
pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString()

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3]

function nextZoom(current: number, direction: 1 | -1) {
  if (direction === 1) return ZOOM_STEPS.find((step) => step > current + 0.001) ?? current
  return [...ZOOM_STEPS].reverse().find((step) => step < current - 0.001) ?? current
}

// Leitor de PDF dentro da página: uma página por vez, com navegação, zoom em degraus e
// "ajustar à largura" (zoom 100% = largura do contêiner, então fica legível no celular sem
// precisar arrastar).
// `initialPage`: abre na página citada (fonte de uma resposta, trecho da prévia). Fora do documento, vale a última página.
// `jumpId` muda a cada pedido de ir até a página, com o leitor já aberto: pedir a mesma página de novo também leva até ela.
export function KnowledgePdfViewer({ file, initialPage, jumpId }: { file: Blob; initialPage?: number | undefined; jumpId?: number | undefined }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState<number | null>(null)
  const [numPages, setNumPages] = useState<number | null>(null)
  const [pageNumber, setPageNumber] = useState(initialPage ?? 1)
  const [pageInput, setPageInput] = useState(String(initialPage ?? 1))
  const [zoom, setZoom] = useState(1)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      if (width) setContainerWidth(width)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const [seenJump, setSeenJump] = useState(jumpId)
  if (jumpId !== seenJump) {
    setSeenJump(jumpId)
    if (initialPage !== undefined) {
      const next = numPages ? Math.min(Math.max(initialPage, 1), numPages) : initialPage
      setPageNumber(next)
      setPageInput(String(next))
    }
  }

  function goTo(page: number) {
    if (!numPages) return
    const next = Math.min(Math.max(page, 1), numPages)
    setPageNumber(next)
    setPageInput(String(next))
  }

  function commitPageInput() {
    const parsed = Number.parseInt(pageInput, 10)
    if (Number.isNaN(parsed)) setPageInput(String(pageNumber))
    else goTo(parsed)
  }

  const pageWidth = containerWidth ? Math.max(Math.floor((containerWidth - 32) * zoom), 120) : undefined

  if (failed) {
    return (
      <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        Não foi possível renderizar este PDF no navegador. Use o download para abrir o arquivo original.
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-muted/40">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card px-2 py-1.5">
        <div className="flex items-center gap-1">
          <Button size="icon-sm" variant="ghost" aria-label="Página anterior" disabled={!numPages || pageNumber <= 1} onClick={() => goTo(pageNumber - 1)}>
            <ChevronLeft />
          </Button>
          <div className="flex items-center gap-1 text-sm">
            <Input
              value={pageInput}
              inputMode="numeric"
              aria-label="Número da página"
              className="h-7 w-12 px-1 text-center text-sm"
              onChange={(event) => setPageInput(event.target.value)}
              onBlur={commitPageInput}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitPageInput()
              }}
            />
            <span className="whitespace-nowrap text-muted-foreground">de {numPages ?? "…"}</span>
          </div>
          <Button size="icon-sm" variant="ghost" aria-label="Próxima página" disabled={!numPages || pageNumber >= numPages} onClick={() => goTo(pageNumber + 1)}>
            <ChevronRight />
          </Button>
        </div>
        <div className="flex items-center gap-1">
          <Button size="icon-sm" variant="ghost" aria-label="Diminuir zoom" disabled={zoom <= ZOOM_STEPS[0]!} onClick={() => setZoom((current) => nextZoom(current, -1))}>
            <ZoomOut />
          </Button>
          <span className="w-12 text-center text-sm tabular-nums text-muted-foreground">{Math.round(zoom * 100)}%</span>
          <Button size="icon-sm" variant="ghost" aria-label="Aumentar zoom" disabled={zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]!} onClick={() => setZoom((current) => nextZoom(current, 1))}>
            <ZoomIn />
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label="Ajustar à largura" disabled={zoom === 1} onClick={() => setZoom(1)}>
            <Maximize2 />
          </Button>
        </div>
      </div>

      <div ref={containerRef} className="max-h-[75vh] overflow-auto p-4">
        <Document
          file={file}
          onLoadSuccess={(pdf) => {
            setNumPages(pdf.numPages)
            const first = Math.min(Math.max(initialPage ?? 1, 1), pdf.numPages)
            setPageNumber(first)
            setPageInput(String(first))
          }}
          onLoadError={() => setFailed(true)}
          onSourceError={() => setFailed(true)}
          loading={<Skeleton className="mx-auto aspect-[1/1.4] w-full max-w-2xl" />}
          error={<p className="text-center text-sm text-destructive">Não foi possível carregar o PDF.</p>}
        >
          {pageWidth ? (
            <Page
              pageNumber={pageNumber}
              width={pageWidth}
              renderTextLayer={false}
              renderAnnotationLayer={false}
              className="mx-auto w-fit shadow-md"
              loading={<Skeleton className="mx-auto aspect-[1/1.4]" style={{ width: pageWidth }} />}
            />
          ) : null}
        </Document>
      </div>
    </div>
  )
}
