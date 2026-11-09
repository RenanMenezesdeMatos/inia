"use client"

import Image from "next/image"
import { ZoomIn } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"

import type { DemoShot } from "./demo-types"

function Markers({ shot }: { shot: DemoShot }) {
  return (
    <>
      {shot.markers.map((marker) => (
        <span
          key={marker.n}
          aria-hidden
          className="absolute flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground shadow ring-2 ring-background"
          style={{ left: `${marker.x}%`, top: `${marker.y}%` }}
        >
          {marker.n}
        </span>
      ))}
    </>
  )
}

function Legend({ shot }: { shot: DemoShot }) {
  if (shot.markers.length === 0) return null
  return (
    <ol className="space-y-1 text-xs text-muted-foreground">
      {shot.markers.map((marker) => (
        <li key={marker.n} className="flex gap-2">
          <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">{marker.n}</span>
          <span>{marker.text}</span>
        </li>
      ))}
    </ol>
  )
}

const KIND_LABEL: Record<DemoShot["kind"], string> = { print: "Tela real, com dados fictícios", illustration: "Ilustração da configuração" }

/** Largura da miniatura: telas altas ficam estreitas, e o quadro inteiro cabe sem ocupar a página. A leitura detalhada é na ampliação. */
function thumbnailWidth(shot: DemoShot): number {
  const natural = shot.width / 2
  return Math.max(170, Math.min(natural, 300, Math.round((460 * shot.width) / shot.height)))
}

/** Um print real (ou ilustração, sempre identificada), com marcações numeradas e ampliação em diálogo. */
export function DemoShotFigure({ shot }: { shot: DemoShot }) {
  const landscape = shot.width > shot.height
  return (
    <figure className={landscape ? "space-y-2" : "grid grid-cols-1 gap-3 sm:grid-cols-[auto_minmax(0,1fr)]"} data-slot="demo-shot" data-shot={shot.id}>
      <Dialog>
        <DialogTrigger asChild>
          <button
            type="button"
            aria-label={`Ampliar imagem: ${shot.caption}`}
            style={landscape ? undefined : { width: thumbnailWidth(shot) }}
            className="group relative block max-w-full overflow-hidden rounded-lg border border-border bg-muted/20 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <span className="relative block">
              <Image unoptimized src={shot.src} width={shot.width} height={shot.height} alt={shot.alt} className="h-auto w-full" />
              <Markers shot={shot} />
            </span>
            <span className="absolute right-1.5 bottom-1.5 flex items-center gap-1 rounded-md bg-background/90 px-1.5 py-0.5 text-[11px] font-medium text-foreground shadow-sm ring-1 ring-border">
              <ZoomIn className="size-3" aria-hidden /> Ampliar
            </span>
          </button>
        </DialogTrigger>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{shot.caption}</DialogTitle>
            <DialogDescription>{KIND_LABEL[shot.kind]}.</DialogDescription>
          </DialogHeader>
          <div className="relative mx-auto max-w-full" style={{ width: shot.width / 2 }}>
            <Image unoptimized src={shot.src} width={shot.width} height={shot.height} alt={shot.alt} className="h-auto w-full" />
            <Markers shot={shot} />
          </div>
          <Legend shot={shot} />
        </DialogContent>
      </Dialog>
      <figcaption className="min-w-0 space-y-1.5">
        <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline" className="font-normal">{KIND_LABEL[shot.kind]}</Badge>
          {shot.caption}
        </span>
        <Legend shot={shot} />
      </figcaption>
    </figure>
  )
}
