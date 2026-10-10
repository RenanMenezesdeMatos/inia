"use client"

import { useCallback, useEffect, useRef } from "react"
import { Minus, Plus } from "lucide-react"

import { Slider } from "@/components/ui/slider"

export type CropState = { zoom: number; x: number; y: number }
export type LoadedImage = { element: HTMLImageElement; width: number; height: number }

export const CROP_VIEWPORT = 224
const MIN_ZOOM = 1
const MAX_ZOOM = 3
const KEY_STEP = 12

const baseScale = (image: LoadedImage) => Math.max(CROP_VIEWPORT / image.width, CROP_VIEWPORT / image.height)

/** Mantém a imagem cobrindo todo o círculo: nunca aparece área vazia no recorte. */
export function clampCrop(image: LoadedImage, crop: CropState): CropState {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, crop.zoom))
  const scale = baseScale(image) * zoom
  const maxX = Math.max(0, (image.width * scale - CROP_VIEWPORT) / 2)
  const maxY = Math.max(0, (image.height * scale - CROP_VIEWPORT) / 2)
  return { zoom, x: Math.min(maxX, Math.max(-maxX, crop.x)), y: Math.min(maxY, Math.max(-maxY, crop.y)) }
}

async function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  const encode = (type: string, quality?: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality))
  // WebP quando o navegador codifica; senão JPEG (o Safari devolve PNG ao pedir WebP).
  const webp = await encode("image/webp", 0.9)
  if (webp && webp.type === "image/webp") return webp
  const jpeg = await encode("image/jpeg", 0.9)
  if (!jpeg) throw new Error("Não foi possível processar a imagem.")
  return jpeg
}

/**
 * Recorta a área visível do círculo num quadrado de `size` px. Reencodar no canvas também descarta metadados da câmera
 * (EXIF, localização) — só os pixels do recorte saem do navegador.
 */
export async function renderCroppedAvatar(image: LoadedImage, crop: CropState, size = 512): Promise<Blob> {
  const { zoom, x, y } = clampCrop(image, crop)
  const scale = baseScale(image) * zoom
  const sourceSize = CROP_VIEWPORT / scale
  const sourceX = image.width / 2 - x / scale - sourceSize / 2
  const sourceY = image.height / 2 - y / scale - sourceSize / 2
  const canvas = document.createElement("canvas")
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext("2d")
  if (!context) throw new Error("Não foi possível processar a imagem.")
  context.imageSmoothingQuality = "high"
  context.drawImage(image.element, sourceX, sourceY, sourceSize, sourceSize, 0, 0, size, size)
  return canvasToBlob(canvas)
}

/** Reduz uma capa grande (lado maior ≤ `maxSide`) e reencoda — mesmo cuidado com metadados. */
export async function renderCover(image: LoadedImage, maxSide = 2400): Promise<Blob> {
  const ratio = Math.min(1, maxSide / Math.max(image.width, image.height))
  const canvas = document.createElement("canvas")
  canvas.width = Math.round(image.width * ratio)
  canvas.height = Math.round(image.height * ratio)
  const context = canvas.getContext("2d")
  if (!context) throw new Error("Não foi possível processar a imagem.")
  context.imageSmoothingQuality = "high"
  context.drawImage(image.element, 0, 0, canvas.width, canvas.height)
  return canvasToBlob(canvas)
}

export function loadImage(src: string): Promise<LoadedImage> {
  return new Promise((resolve, reject) => {
    const element = new Image()
    element.onload = () => resolve({ element, width: element.naturalWidth, height: element.naturalHeight })
    element.onerror = () => reject(new Error("Não foi possível ler esta imagem."))
    element.src = src
  })
}

/**
 * Enquadramento da foto DENTRO do editor (nenhum modal a mais): arrastar com mouse/toque, setas do teclado para mover,
 * controle deslizante (ou +/-) para aproximar. O círculo mostra exatamente o que vai aparecer no avatar.
 */
export function AvatarCropper({ image, src, crop, onCropChange }: { image: LoadedImage; src: string; crop: CropState; onCropChange: (crop: CropState) => void }) {
  const drag = useRef<{ pointerId: number; startX: number; startY: number; origin: CropState } | null>(null)
  const current = clampCrop(image, crop)
  const scale = baseScale(image) * current.zoom
  const update = useCallback((next: CropState) => onCropChange(clampCrop(image, next)), [image, onCropChange])

  useEffect(() => {
    // Imagem nova: garante um recorte válido desde o início.
    onCropChange(clampCrop(image, crop))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image])

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        role="group"
        tabIndex={0}
        aria-label="Enquadramento da foto. Arraste ou use as setas do teclado para mover; use o controle de zoom para aproximar."
        className="relative cursor-grab touch-none overflow-hidden rounded-2xl bg-muted outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:cursor-grabbing"
        style={{ width: CROP_VIEWPORT, height: CROP_VIEWPORT }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, origin: current }
        }}
        onPointerMove={(event) => {
          const state = drag.current
          if (!state || state.pointerId !== event.pointerId) return
          update({ ...state.origin, x: state.origin.x + event.clientX - state.startX, y: state.origin.y + event.clientY - state.startY })
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onKeyDown={(event) => {
          const moves: Record<string, [number, number]> = { ArrowLeft: [-KEY_STEP, 0], ArrowRight: [KEY_STEP, 0], ArrowUp: [0, -KEY_STEP], ArrowDown: [0, KEY_STEP] }
          const move = moves[event.key]
          if (move) {
            event.preventDefault()
            update({ ...current, x: current.x + move[0], y: current.y + move[1] })
          } else if (event.key === "+" || event.key === "=") {
            event.preventDefault()
            update({ ...current, zoom: current.zoom + 0.1 })
          } else if (event.key === "-") {
            event.preventDefault()
            update({ ...current, zoom: current.zoom - 0.1 })
          }
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- prévia local (objeto do navegador), nunca enviada como URL. */}
        <img
          src={src}
          alt=""
          draggable={false}
          className="pointer-events-none absolute left-1/2 top-1/2 max-w-none"
          style={{ width: image.width * scale, height: image.height * scale, transform: `translate(calc(-50% + ${current.x}px), calc(-50% + ${current.y}px))` }}
        />
        {/* Máscara: escurece fora do círculo que vira o avatar. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_999px_rgba(12,6,20,0.55)] ring-2 ring-white/90" />
      </div>
      <div className="flex w-full max-w-[15rem] items-center gap-2">
        <button type="button" className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Afastar" onClick={() => update({ ...current, zoom: current.zoom - 0.2 })}>
          <Minus className="size-4" aria-hidden />
        </button>
        <Slider aria-label="Zoom da foto" min={MIN_ZOOM} max={MAX_ZOOM} step={0.05} value={[current.zoom]} onValueChange={([value]) => update({ ...current, zoom: value ?? current.zoom })} />
        <button type="button" className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Aproximar" onClick={() => update({ ...current, zoom: current.zoom + 0.2 })}>
          <Plus className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  )
}
