"use client"

import type { ReactNode, Ref } from "react"
import { Maximize2, Mic, Minimize2, Phone, PhoneOff, Square, Video, VideoOff, Volume2, VolumeX } from "lucide-react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { AvatarConversationState } from "@/lib/avatar/animation/types"
import { cn } from "@/lib/utils"

/**
 * A INIA no PAINEL como uma chamada de vídeo (Teams/Meet): um "tile" com cantos do padrão dos cards, nome e estado dela no
 * canto, contorno aceso enquanto ela fala e a barra de controles de chamada embaixo (microfone, silenciar a INIA, câmera,
 * sair). O fundo (cenário/desfoque) e o avatar são de quem usa o tile — aqui é só a moldura e os controles.
 */
export function IniaCallTile({ speaking, className, children }: { speaking: boolean; className?: string; children: ReactNode }) {
  return (
    // A sombra fica fora do recorte (a máscara cortaria qualquer coisa fora da borda).
    <div className="h-full rounded-xl shadow-sm">
      {/* `mask-image`: o Safari não recorta pelos cantos arredondados um canvas WebGL composto em GPU sem uma máscara. */}
      <div className={cn("relative isolate overflow-hidden rounded-xl bg-[#1b1426] [mask-image:radial-gradient(white,black)]", className)} data-testid="inia-call-tile" data-speaking={speaking || undefined}>
        {children}
        {/* Como numa chamada: quem está falando ganha o contorno. Por dentro (fora seria recortado). */}
        <span aria-hidden className={cn("pointer-events-none absolute inset-0 z-20 rounded-xl ring-1 ring-black/10 ring-inset transition-shadow duration-300 dark:ring-white/10", speaking && "ring-[3px] ring-primary dark:ring-chart-4")} />
      </div>
    </div>
  )
}

const STATUS: Record<AvatarConversationState, { label: string; dot: string }> = {
  idle: { label: "Disponível", dot: "bg-emerald-400" },
  listening: { label: "Ouvindo você", dot: "animate-pulse bg-red-500" },
  thinking: { label: "Pensando…", dot: "animate-pulse bg-amber-400" },
  speaking: { label: "Falando", dot: "animate-pulse bg-primary dark:bg-chart-4" },
}

/** Nome e estado dela, no canto (como a etiqueta de quem está na chamada). No mudo, o ícone de alto-falante cortado. `inline`: no fluxo do tile compacto. */
export function IniaCallStatus({ state, muted, activity, inline = false }: { state: AvatarConversationState; muted: boolean; activity?: string | null; inline?: boolean }) {
  const status = state === "speaking" && muted ? { label: "Respondendo em texto", dot: "animate-pulse bg-primary dark:bg-chart-4" } : state === "thinking" && activity ? { ...STATUS.thinking, label: activity } : STATUS[state]
  return (
    <span className={cn("z-10 flex items-center gap-1.5 rounded-full bg-black/45 px-2.5 py-1 text-[11px] text-white shadow-sm ring-1 ring-white/15 backdrop-blur-md", inline ? "min-w-0" : "absolute top-2.5 left-2.5 max-w-[60%]")} data-testid="inia-call-status">
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full motion-reduce:animate-none", status.dot)} />
      <span className="font-semibold">INIA</span>
      <span className="truncate text-white/80">· {status.label}</span>
      {muted ? <VolumeX aria-label="Voz silenciada" className="size-3 shrink-0 text-white/80" /> : null}
    </span>
  )
}

/** Ampliar ou compactar a INIA no painel: pedido explícito de quem vai falar com ela por voz ou vídeo (nunca muda sozinho). */
export function IniaCallExpandToggle({ expanded, onToggle }: { expanded: boolean; onToggle(): void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon" onClick={onToggle} aria-label={expanded ? "Compactar a INIA" : "Ampliar a INIA"} aria-expanded={expanded} className="size-7 shrink-0 rounded-full bg-black/45 text-white ring-1 ring-white/15 backdrop-blur-md hover:bg-black/60 hover:text-white focus-visible:ring-2 focus-visible:ring-white [&_svg]:size-3.5" data-testid="inia-avatar-toggle">
          {expanded ? <Minimize2 /> : <Maximize2 />}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="inia-tooltip-genie">{expanded ? "Compactar a INIA" : "Ampliar a INIA para falar por voz ou vídeo"}</TooltipContent>
    </Tooltip>
  )
}

/** Chamada encerrada no tile compacto: a foto fica no lugar dela; aqui, o aviso e o convite para chamar de novo. */
export function IniaCallEndedCompact({ onCall, toggle }: { onCall(): void; toggle?: ReactNode }) {
  return (
    <>
      <div className="flex items-start justify-between gap-1.5">
        <p className="min-w-0 text-xs leading-4 font-semibold text-white">Chamada com a INIA encerrada</p>
        {toggle}
      </div>
      <Button type="button" size="xs" onClick={onCall} data-usage-element="chat.start_call" className="w-fit rounded-full bg-emerald-600 text-white hover:bg-emerald-500"><Phone />Chamar a INIA</Button>
    </>
  )
}

const CONTROL = "size-9 rounded-full bg-white/15 text-white hover:bg-white/25 hover:text-white focus-visible:ring-white/80 disabled:opacity-40 [&_svg]:size-4"
/** Desligado de propósito (INIA no mudo, câmera desligada): invertido, como nas chamadas. */
const CONTROL_OFF = "bg-white text-neutral-900 hover:bg-white/90 hover:text-neutral-900"

function Control({ label, onClick, disabled, className, children, pressed, usageElement }: { label: string; onClick(): void; disabled?: boolean; className?: string; children: ReactNode; pressed?: boolean; usageElement?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon" onClick={onClick} disabled={disabled} aria-label={label} aria-pressed={pressed} className={cn(CONTROL, className)} data-usage-element={usageElement}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" className="inia-tooltip-genie">{label}</TooltipContent>
    </Tooltip>
  )
}

/** Barra de controles da chamada (vidro escuro, legível sobre qualquer cenário). `compact`: no fluxo do tile compacto, com botões menores. */
export function IniaCallControls({ micOpen, micDisabled, micLabel, onMic, micPulseRef, micPulseStyle, muted, onToggleMute, cameraOn, onToggleCamera, onEnd, compact = false }: {
  micOpen: boolean
  micDisabled: boolean
  micLabel: string
  onMic(): void
  micPulseRef: Ref<HTMLSpanElement>
  micPulseStyle: React.CSSProperties
  muted: boolean
  onToggleMute(): void
  cameraOn: boolean
  onToggleCamera(): void
  onEnd(): void
  compact?: boolean
}) {
  const size = compact && "size-8"
  return (
    <div className={compact ? "flex min-w-0" : "absolute inset-x-0 bottom-3 z-10 flex justify-center"}>
      <div className={cn("flex items-center rounded-full bg-black/45 shadow-lg ring-1 ring-white/15 backdrop-blur-md", compact ? "gap-1 p-1" : "gap-1.5 p-1.5")} role="group" aria-label="Controles da chamada com a INIA">
        <Control label={micLabel} onClick={onMic} disabled={micDisabled} usageElement="chat.mic" className={cn("relative", size, micOpen && "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground")}>
          {micOpen ? <span ref={micPulseRef} aria-hidden className="absolute inset-0 -z-10 rounded-full bg-primary/50" style={micPulseStyle} /> : null}
          {micOpen ? <Square className="fill-current" /> : <Mic />}
        </Control>
        <Control label={muted ? "Ativar a voz da INIA" : "Silenciar a INIA"} onClick={onToggleMute} pressed={muted} usageElement="chat.mute" className={cn(size, muted && CONTROL_OFF)}>
          {muted ? <VolumeX /> : <Volume2 />}
        </Control>
        <Control label={cameraOn ? "Desligar câmera" : "Ligar câmera"} onClick={onToggleCamera} usageElement="chat.camera" className={cn(size, !cameraOn && CONTROL_OFF)}>
          {cameraOn ? <Video /> : <VideoOff />}
        </Control>
        <Control label="Encerrar avatar" onClick={onEnd} usageElement="chat.end_call" className={cn(size, compact ? "w-10" : "w-12", "bg-red-600 hover:bg-red-500")}>
          <PhoneOff />
        </Control>
      </div>
    </div>
  )
}

/** Câmera desligada ou chamada encerrada: a foto dela no centro, como numa chamada sem vídeo. `compact`: só a foto (o texto fica ao lado, no tile). */
export function IniaCallPlaceholder({ image, variant, onCall, rounded, compact = false }: { image: string; variant: "camera-off" | "ended"; onCall?(): void; rounded: boolean; compact?: boolean }) {
  if (compact) {
    return (
      <div className="flex h-full items-center justify-center rounded-xl bg-[radial-gradient(circle_at_50%_38%,#3d2a5c,#1b1426_72%)]">
        <Avatar className={cn("size-12 ring-2 ring-white/20 sm:size-14", variant === "ended" && "opacity-70 grayscale")}>
          <AvatarImage src={image} alt="" />
          <AvatarFallback className="bg-primary text-primary-foreground">IA</AvatarFallback>
        </Avatar>
        {variant === "camera-off" ? <span className="sr-only">Câmera desligada — você continua falando com ela.</span> : null}
      </div>
    )
  }
  return (
    <div className={cn("flex h-full flex-col items-center justify-center gap-2.5 bg-[radial-gradient(circle_at_50%_38%,#3d2a5c,#1b1426_72%)] p-4 text-center text-white", rounded ? "rounded-xl" : "rounded-none")}>
      <Avatar className={cn("size-16 ring-2 ring-white/20", variant === "ended" && "opacity-70 grayscale")}>
        <AvatarImage src={image} alt="" />
        <AvatarFallback className="bg-primary text-primary-foreground">IA</AvatarFallback>
      </Avatar>
      {variant === "camera-off" ? (
        <div>
          <p className="text-sm font-semibold">INIA</p>
          <p className="mt-0.5 text-xs text-white/70">Câmera desligada — você continua falando com ela.</p>
        </div>
      ) : (
        <>
          <div>
            <p className="text-sm font-semibold">Chamada com a INIA encerrada</p>
            <p className="mt-0.5 max-w-64 text-xs text-white/70">Você pode continuar por texto ou chamar a INIA de novo.</p>
          </div>
          {onCall ? <Button type="button" size="sm" onClick={onCall} data-usage-element="chat.start_call" className="rounded-full bg-emerald-600 text-white hover:bg-emerald-500"><Phone />Chamar a INIA</Button> : null}
        </>
      )}
    </div>
  )
}
