"use client"

import { Mic, MicOff, UserRound, X } from "lucide-react"

import { PersonAvatar } from "@/components/profile/person-avatar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { setSelfViewHidden, useSelfViewHidden } from "./self-view-preference"

export type SelfViewSize = "small" | "medium" | "large"
const SIZES = {
  small: { tile: "h-[38px] w-15 rounded-lg", avatar: "size-5.5", initials: "text-[8px]", label: "gap-0.5 px-1 text-[8px] leading-3 [&_svg]:size-2" },
  medium: { tile: "h-[46px] w-18 rounded-[10px]", avatar: "size-7", initials: "text-[10px]", label: "gap-0.5 px-1 text-[9px] leading-3.5 [&_svg]:size-2.5" },
  large: { tile: "h-15 w-24 rounded-xl", avatar: "size-9", initials: "text-xs", label: "gap-1 px-1.5 text-[10px] leading-4 [&_svg]:size-2.5" },
} as const
/** Quanto o quadro ocupa no canto (com a folga), para os controles não ficarem embaixo dele. */
export const SELF_VIEW_SPACE: Record<SelfViewSize, number> = { small: 76, medium: 80, large: 116 }

/**
 * A própria pessoa no canto inferior direito, como numa chamada de vídeo: moldura, foto (ou iniciais), o estado do microfone e o contorno
 * verde enquanto ela fala. Não usa a câmera: é só a foto do perfil. Dá para fechar; fechado, um ícone no mesmo canto traz de volta.
 */
export function SelfView({ person, micOpen, size, className }: { person: { name: string; avatarUrl: string | null }; micOpen: boolean; size: SelfViewSize; className?: string }) {
  const hidden = useSelfViewHidden()
  if (hidden) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" onClick={() => setSelfViewHidden(false)} aria-label="Mostrar você na chamada" className={cn("absolute z-10 flex size-8 items-center justify-center rounded-full bg-black/45 text-white outline-none backdrop-blur-md hover:bg-black/70 focus-visible:ring-2 focus-visible:ring-white pointer-coarse:size-9 [&_svg]:size-3.5", className)}><UserRound aria-hidden /></button>
        </TooltipTrigger>
        <TooltipContent side="left" className="inia-tooltip-genie">Mostrar você na chamada</TooltipContent>
      </Tooltip>
    )
  }
  const { tile, avatar, initials, label } = SIZES[size]
  return (
    <div
      className={cn(
        "group/self absolute z-10 flex items-center justify-center border-[1.5px] bg-[radial-gradient(120%_120%_at_50%_0%,#5a4378_0%,#2c1d42_60%,#1d1230_100%)] shadow-[0_4px_14px_rgba(0,0,0,0.45)] transition-[border-color,box-shadow] duration-200 motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-90 motion-reduce:transition-none",
        micOpen ? "border-[#81d300] shadow-[0_0_0_2px_rgba(129,211,0,0.35),0_4px_14px_rgba(0,0,0,0.45)]" : "border-white/80",
        tile, className,
      )}
      data-testid="inia-self-view" data-speaking={micOpen || undefined}
    >
      {/* Com foto, ela mesma desfocada faz o fundo (como o fundo desfocado de uma chamada). */}
      {person.avatarUrl ? <span aria-hidden className="absolute inset-0 overflow-hidden rounded-[inherit]"><PersonAvatar name={person.name} avatarUrl={person.avatarUrl} alt="" className="absolute inset-0 size-full scale-150 rounded-none opacity-60 blur-[6px] after:hidden [&_[data-slot=avatar-image]]:rounded-none" fallbackClassName="invisible" /></span> : null}
      <PersonAvatar name={person.name} avatarUrl={person.avatarUrl} alt="" className={cn("-mt-1.5 shadow ring-[1.5px] ring-white/80", avatar)} fallbackClassName={cn("bg-white font-bold text-[#660099]", initials)} />
      <span className={cn("absolute bottom-0.5 left-0.5 inline-flex items-center rounded-full bg-black/60 font-medium text-white", label)}>
        {micOpen ? <Mic className="text-[#a7ee3a]" aria-hidden /> : <MicOff className="text-white/75" aria-hidden />}Você
        <span className="sr-only">{micOpen ? "— microfone aberto" : "— microfone fechado"}</span>
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* Discreto: aparece ao apontar ou focar; no toque fica sempre. A área de clique é maior que o desenho. */}
          <button type="button" onClick={() => setSelfViewHidden(true)} aria-label="Fechar o seu quadro" className="absolute -top-2 -right-2 flex size-5 items-center justify-center rounded-full bg-white text-neutral-900 opacity-0 shadow outline-none transition-opacity after:absolute after:-inset-1.5 group-hover/self:opacity-100 hover:bg-neutral-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-[#81d300] pointer-coarse:opacity-100 [&_svg]:size-3"><X aria-hidden /></button>
        </TooltipTrigger>
        <TooltipContent side="left" className="inia-tooltip-genie">Fechar o seu quadro</TooltipContent>
      </Tooltip>
    </div>
  )
}
