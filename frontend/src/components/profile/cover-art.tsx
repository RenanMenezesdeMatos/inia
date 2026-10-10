import Image from "next/image"

import { cn } from "@/lib/utils"
import { profileImageSrc } from "@/lib/profile/profile-image-src"
import type { CoverPresentation, CoverPreset } from "@/schemas/profile/my-profile.schema"

export const COVER_PRESET_LABELS: Record<CoverPreset, string> = {
  inia: "Roxo INIA",
  aurora: "Aurora",
  nature: "Natureza",
  neutral: "Neutro",
}

const GRADIENTS: Record<Exclude<CoverPreset, "nature">, string> = {
  inia: "bg-[radial-gradient(circle_at_82%_18%,rgba(235,60,125,0.45),transparent_32%),radial-gradient(circle_at_12%_110%,rgba(129,211,0,0.22),transparent_30%),linear-gradient(120deg,#3b0755,#660099_55%,#8d22bc)]",
  aurora: "bg-[radial-gradient(circle_at_70%_20%,rgba(129,211,0,0.34),transparent_27%),linear-gradient(120deg,#4b0870,#9b2472_58%,#eb3c7d)]",
  neutral: "bg-[radial-gradient(circle_at_70%_20%,rgba(255,255,255,0.8),transparent_25%),linear-gradient(120deg,#d9d5df,#f2eef5_55%,#cbc4d3)] dark:bg-[linear-gradient(120deg,#241b2d,#3a3043)]",
}

/** Uma capa predefinida (gradiente da identidade ou a foto "Natureza") — usada no perfil e nas miniaturas do editor. */
export function CoverPresetArt({ preset, className, priority = false }: { preset: CoverPreset; className?: string; priority?: boolean }) {
  if (preset === "nature") return <Image src="/operator-profile-cover.png" alt="" fill priority={priority} sizes="(max-width: 1280px) 100vw, 1280px" className={cn("object-cover object-center", className)} />
  return <div aria-hidden className={cn("absolute inset-0", GRADIENTS[preset], className)} />
}

/**
 * Capa de um perfil a partir da apresentação VINDA DO BACKEND (a da pessoa exibida, nunca a de quem visita). `previewUrl` só
 * existe no editor (prévia local antes de salvar) — nunca é gravada.
 */
export function CoverArt({ cover, previewUrl, priority = false }: { cover: CoverPresentation; previewUrl?: string | null; priority?: boolean }) {
  const customSrc = previewUrl ?? (cover.kind === "CUSTOM" ? profileImageSrc(cover.imageUrl) : undefined)
  if (customSrc) {
    // eslint-disable-next-line @next/next/no-img-element -- imagem da API autenticada por cookie (ou prévia local): fora do otimizador do Next.
    return <img src={customSrc} alt="" className="absolute inset-0 size-full object-cover object-center" />
  }
  return <CoverPresetArt preset={cover.kind === "PRESET" ? cover.preset : "inia"} priority={priority} />
}
