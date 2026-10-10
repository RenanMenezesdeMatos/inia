"use client"

import type { ReactNode, Ref } from "react"
import { Mic, Phone, PhoneOff, Square, Video, VideoOff, Volume2, VolumeX } from "lucide-react"

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
    <div className="rounded-xl shadow-sm">
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

/** Nome e estado dela, no canto (como a etiqueta de quem está na chamada). No mudo, o ícone de alto-falante cortado. */
export function IniaCallStatus({ state, muted }: { state: AvatarConversationState; muted: boolean }) {
  const status = state === "speaking" && muted ? { label: "Respondendo em texto", dot: "animate-pulse bg-primary dark:bg-chart-4" } : STATUS[state]
  return (
    <span className="absolute top-2.5 left-2.5 z-10 flex max-w-[60%] items-center gap-1.5 rounded-full bg-black/45 px-2.5 py-1 text-[11px] text-white shadow-sm ring-1 ring-white/15 backdrop-blur-md" data-testid="inia-call-status">
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full motion-reduce:animate-none", status.dot)} />
      <span className="font-semibold">INIA</span>
      <span className="truncate text-white/80">· {status.label}</span>
      {muted ? <VolumeX aria-label="Voz silenciada" className="size-3 shrink-0 text-white/80" /> : null}
    </span>
  )
}

const CONTROL = "size-9 rounded-full bg-white/15 text-white hover:bg-white/25 hover:text-white disabled:opacity-40 [&_svg]:size-4"
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

/** Barra de controles da chamada (vidro escuro, legível sobre qualquer cenário). */
export function IniaCallControls({ micOpen, micDisabled, micLabel, onMic, micPulseRef, micPulseStyle, muted, onToggleMute, cameraOn, onToggleCamera, onEnd }: {
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
}) {
  return (
    <div className="absolute inset-x-0 bottom-3 z-10 flex justify-center">
      <div className="flex items-center gap-1.5 rounded-full bg-black/45 p-1.5 shadow-lg ring-1 ring-white/15 backdrop-blur-md" role="group" aria-label="Controles da chamada com a INIA">
        <Control label={micLabel} onClick={onMic} disabled={micDisabled} usageElement="chat.mic" className={cn("relative", micOpen && "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground")}>
          {micOpen ? <span ref={micPulseRef} aria-hidden className="absolute inset-0 -z-10 rounded-full bg-primary/50" style={micPulseStyle} /> : null}
          {micOpen ? <Square className="fill-current" /> : <Mic />}
        </Control>
        <Control label={muted ? "Ativar a voz da INIA" : "Silenciar a INIA"} onClick={onToggleMute} pressed={muted} usageElement="chat.mute" className={cn(muted && CONTROL_OFF)}>
          {muted ? <VolumeX /> : <Volume2 />}
        </Control>
        <Control label={cameraOn ? "Desligar câmera" : "Ligar câmera"} onClick={onToggleCamera} usageElement="chat.camera" className={cn(!cameraOn && CONTROL_OFF)}>
          {cameraOn ? <Video /> : <VideoOff />}
        </Control>
        <Control label="Encerrar avatar" onClick={onEnd} usageElement="chat.end_call" className="w-12 bg-red-600 hover:bg-red-500">
          <PhoneOff />
        </Control>
      </div>
    </div>
  )
}

/** Câmera desligada ou chamada encerrada: a foto dela no centro, como numa chamada sem vídeo. */
export function IniaCallPlaceholder({ image, variant, onCall, rounded }: { image: string; variant: "camera-off" | "ended"; onCall?(): void; rounded: boolean }) {
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
