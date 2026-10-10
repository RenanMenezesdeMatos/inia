"use client"

import { useEffect, useState, type CSSProperties } from "react"

import { cn } from "@/lib/utils"
import { sceneImageSrc } from "@/services/inia-scenes/inia-scene-service"

/**
 * CENÁRIO atrás da INIA — o MESMO componente no palco da aplicação de feedback, no painel da INIA e na prévia da
 * Administração (quem configura vê exatamente o que o colaborador verá). Decorativo (nunca anunciado ao leitor de tela).
 *
 * Camadas, de baixo para cima, todas ATRÁS da INIA, dos textos, dos cards e dos controles:
 *   1. a imagem, com o DESFOQUE do cenário (`blur`, em px), como a profundidade de campo de uma câmera. Nas telas de verdade
 *      vale o px configurado; só a PRÉVIA da Administração (`miniature`, o palco de 1440 px em tamanho reduzido) encolhe o
 *      desfoque na mesma proporção (unidade `cqw` do próprio fundo);
 *   2. o ESCURECIMENTO do cenário (`dim`, 0–100 %): máscara preta só sobre a imagem (0 = nenhuma, 100 = preto opaco);
 *   3. os gradientes de leitura de sempre (palco: para a direita, atrás dos cards, e no topo, atrás do cabeçalho; painel: uma
 *      sombra embaixo). Eles NÃO somam com a máscara: cada ponto fica com o mais escuro dos dois (a opacidade do gradiente é
 *      descontada da máscara), então 40 % de máscara não vira 70 % atrás dos cards. Com 0 % fica exatamente como antes.
 * Desfoque e escurecimento são independentes. A troca de imagem (dia → noite) espera a nova carregar e entra em fade.
 */

const STAGE_TINT = "11 6 19" // #0b0613
const BLACK = "0 0 0"
/** Opacidade de um ponto do gradiente com a máscara já aplicada embaixo: o resultado é max(máscara, gradiente). */
export function gradientAlphaOver(mask: number, alpha: number): number {
  if (mask >= 1) return 0
  return Math.max(0, (alpha - mask) / (1 - mask))
}
const stop = (rgb: string, mask: number, alpha: number, position?: string) => `rgb(${rgb} / ${gradientAlphaOver(mask, alpha).toFixed(4)})${position ? ` ${position}` : ""}`

function readabilityLayers(variant: "stage" | "panel", mask: number): Array<{ key: string; className: string; style: CSSProperties }> {
  if (variant === "stage") {
    return [
      { key: "right", className: "absolute inset-0", style: { backgroundImage: `linear-gradient(to right in oklab, ${stop(STAGE_TINT, mask, 0.05)}, ${stop(STAGE_TINT, mask, 0.2, "50%")}, ${stop(STAGE_TINT, mask, 0.5)})` } },
      { key: "top", className: "absolute inset-x-0 top-0 h-24", style: { backgroundImage: `linear-gradient(to bottom in oklab, ${stop(STAGE_TINT, mask, 0.6)}, ${stop(STAGE_TINT, mask, 0)})` } },
    ]
  }
  return [{ key: "bottom", className: "absolute inset-0", style: { backgroundImage: `linear-gradient(to top in oklab, ${stop(BLACK, mask, 0.25)}, ${stop(BLACK, mask, 0, "50%")}, ${stop(BLACK, mask, 0)})` } }]
}

type Layer = { url: string; key: number; fade: boolean }
const FADE_MS = 700

/** A imagem nova só entra depois de carregada (sem piscar o fundo vazio) e cobre a anterior em fade; a anterior sai depois. */
function useImageLayers(imageUrl: string): Layer[] {
  const [layers, setLayers] = useState<Layer[]>(() => [{ url: imageUrl, key: 0, fade: false }])
  const shownUrl = layers[layers.length - 1]!.url
  useEffect(() => {
    if (shownUrl === imageUrl) return
    let done = false
    let cleanup: number | undefined
    const show = () => {
      if (done) return
      done = true
      setLayers((current) => [...current.slice(-1), { url: imageUrl, key: current[current.length - 1]!.key + 1, fade: true }])
      cleanup = window.setTimeout(() => setLayers((current) => current.slice(-1)), FADE_MS + 100)
    }
    const image = new Image()
    image.src = sceneImageSrc(imageUrl)
    if (typeof image.decode === "function") image.decode().then(show, show)
    else image.onload = image.onerror = show
    // Rede lenta: não segura a troca para sempre.
    const fallback = window.setTimeout(show, 4_000)
    return () => {
      done = true
      window.clearTimeout(fallback)
      if (cleanup !== undefined) window.clearTimeout(cleanup)
    }
  }, [imageUrl, shownUrl])
  return layers
}

export function IniaSceneBackdrop({ imageUrl, blur, dim = 0, variant, miniature = false, className }: { imageUrl: string; blur: number; dim?: number; variant: "stage" | "panel"; miniature?: boolean; className?: string }) {
  // Miniatura do palco de 1440 px: 14,4 cqw por px do palco real.
  const filter = blur > 0 ? (miniature ? `blur(calc(${blur} * 1cqw / 14.4))` : `blur(${blur}px)`) : undefined
  const mask = Math.min(1, Math.max(0, dim / 100))
  const layers = useImageLayers(imageUrl)
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)} style={miniature ? { containerType: "inline-size" } : undefined} data-inia-scene={variant} data-dim={dim}>
      {layers.map((layer) => (
        // Um pouco maior que o quadro: o desfoque não deixa borda clara nas laterais.
        <div
          key={layer.key}
          className={cn("absolute -inset-3 bg-cover bg-center", layer.fade && "animate-in fade-in duration-700 ease-out motion-reduce:animate-none")}
          style={{ backgroundImage: `url("${sceneImageSrc(layer.url)}")`, filter }}
          data-blur={blur}
          data-scene-image={layer.url}
        />
      ))}
      {mask > 0 ? <div className="absolute inset-0 bg-black" style={{ opacity: mask }} data-dim={dim} data-testid="inia-scene-dim" /> : null}
      {readabilityLayers(variant, mask).map((layer) => <div key={layer.key} className={layer.className} style={layer.style} data-readability={layer.key} />)}
    </div>
  )
}
