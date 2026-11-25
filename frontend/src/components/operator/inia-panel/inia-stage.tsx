"use client"

import type { CSSProperties, ReactNode } from "react"
import { createPortal } from "react-dom"
import { Captions, CaptionsOff, ChevronLeft, ChevronRight, Maximize2, MessageSquareText, Mic, Minimize2, PanelRightOpen, PhoneOff, Square, Video, VideoOff, Volume2, VolumeX } from "lucide-react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { AvatarConversationState } from "@/lib/avatar/animation/types"
import { cn } from "@/lib/utils"
import { CallCaption } from "./call-caption"
import { SelfView, SELF_VIEW_SPACE, type SelfViewSize } from "./self-view"
import { useSelfViewHidden } from "./self-view-preference"
import { FLOATING_SHADOW, FloatingWindow } from "./floating-window"
import { PANEL_TRANSITION } from "./motion"
import { LARGE_WINDOW, MINI_WINDOW, type IniaStageState, type StageMode } from "./use-inia-stage"
import type { PanelHeight } from "./use-panel-height"

/** Largura da janela maior a partir da qual cabem os controles grandes. */
const ROOMY_PX = 500
/** Janela pequena: largura a partir da qual o quadro da pessoa cabe ao lado dos controles. */
const MINI_SELF_PX = 290

export type CallControlsProps = {
  inCall: boolean
  state: AvatarConversationState
  micOpen: boolean
  micDisabled: boolean
  micLabel: string
  onMic(): void
  micPulseRef(element: HTMLSpanElement | null): void
  micPulseStyle: React.CSSProperties
  muted: boolean
  onToggleMute(): void
  cameraOn: boolean
  onToggleCamera(): void
  captionsOn: boolean
  onToggleCaptions(): void
  onEnd(): void
}

const STATUS: Record<AvatarConversationState, { label: string; dot: string }> = {
  idle: { label: "Disponível", dot: "bg-emerald-400" },
  listening: { label: "Ouvindo você", dot: "animate-pulse bg-red-500" },
  thinking: { label: "Pensando…", dot: "animate-pulse bg-amber-400" },
  speaking: { label: "Falando", dot: "animate-pulse bg-fuchsia-400" },
}

/** Estado dela, no canto, como a etiqueta de quem está na chamada. No mudo, o alto-falante cortado. */
export function IniaCallStatus({ state, muted, inCall = false, connecting = false, activity = null, withName = false }: { state: AvatarConversationState; muted: boolean; inCall?: boolean; connecting?: boolean; activity?: string | null; withName?: boolean }) {
  const status = connecting
    ? { label: "Entrando na chamada", dot: "animate-pulse bg-amber-400" }
    : state === "speaking" && muted ? { label: "Respondendo em texto", dot: "animate-pulse bg-sky-400" }
      : state === "thinking" && activity ? { ...STATUS.thinking, label: activity }
        : state === "idle" && inCall ? { label: "Sua vez", dot: "bg-emerald-400" } : STATUS[state]
  return (
    <span className="inline-flex max-w-full min-w-0 items-center gap-2 rounded-full bg-black/55 px-3 py-1.5 text-xs text-white backdrop-blur-md" data-testid="inia-call-status">
      <span aria-hidden className={cn("size-2 shrink-0 rounded-full motion-reduce:animate-none", status.dot)} />
      {withName ? <span className="font-semibold">INIA</span> : null}
      <span className="truncate text-white/90">{withName ? "· " : null}{status.label}</span>
      {muted ? <VolumeX aria-label="Voz silenciada" className="size-3 shrink-0 text-white/80" /> : null}
    </span>
  )
}

function Control({ label, onClick, disabled, pressed, off = false, danger = false, small, usageElement, children }: { label: string; onClick(): void; disabled?: boolean; pressed?: boolean; /** Desligado de propósito: invertido, como nas chamadas. */ off?: boolean; danger?: boolean; small: boolean; usageElement?: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" onClick={onClick} disabled={disabled} aria-label={label} aria-pressed={pressed} data-usage-element={usageElement} className={cn("relative flex shrink-0 items-center justify-center rounded-full outline-none transition-colors focus-visible:ring-3 focus-visible:ring-white disabled:opacity-40", small ? "size-8 pointer-coarse:size-9 [&_svg]:size-3.5" : "size-9 pointer-coarse:size-10 [&_svg]:size-4", danger ? "bg-red-600 text-white hover:bg-red-500" : off ? "bg-white text-neutral-900 hover:bg-white/90" : "bg-white/15 text-white hover:bg-white/30")}>
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="inia-tooltip-genie">{label}</TooltipContent>
    </Tooltip>
  )
}

/** Controles da chamada (vidro escuro, legível sobre qualquer cenário): flutuam sobre a parte de baixo da imagem, nunca sobre o rosto. Fora
 * da chamada, só o convite para falar, a voz e a imagem dela. */
export function IniaCallControls({ small, tight = false, micPulseRef, ...call }: CallControlsProps & { small: boolean; /** INIA reduzida: só o essencial (sem câmera nem legenda). */ tight?: boolean }) {
  const mute = <Control small={small || !call.inCall} label={call.muted ? "Ativar a voz da INIA" : "Silenciar a INIA"} onClick={call.onToggleMute} pressed={call.muted} off={call.muted} usageElement="chat.mute">{call.muted ? <VolumeX /> : <Volume2 />}</Control>
  const camera = tight ? null : <Control small={small || !call.inCall} label={call.cameraOn ? "Desligar câmera" : "Ligar câmera"} onClick={call.onToggleCamera} pressed={!call.cameraOn} off={!call.cameraOn} usageElement="chat.camera">{call.cameraOn ? <Video /> : <VideoOff />}</Control>
  if (!call.inCall) {
    return (
      <div role="group" aria-label="Controles da chamada com a INIA" className="flex items-center gap-1 rounded-full bg-black/45 p-1 ring-1 ring-white/10 backdrop-blur-md">
        {mute}
        <button type="button" onClick={call.onMic} disabled={call.micDisabled} aria-label={call.micLabel} data-usage-element="chat.mic" className="flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-full bg-[#81d300] whitespace-nowrap px-3 text-xs font-medium text-[#102200] outline-none hover:bg-[#93e412] focus-visible:ring-3 focus-visible:ring-white disabled:opacity-50 pointer-coarse:h-9 [&_svg]:size-3"><Mic aria-hidden />{tight && !call.micOpen ? "Falar" : call.micLabel}</button>
        {camera}
      </div>
    )
  }
  const speaking = call.state === "speaking"
  return (
    <div role="group" aria-label="Controles da chamada com a INIA" className={cn("flex items-center rounded-full bg-black/45 ring-1 ring-white/10 backdrop-blur-md", small ? "gap-1 p-1" : "gap-1.5 p-1.5")}>
      {mute}
      {camera}
      <button type="button" onClick={call.onMic} disabled={call.micDisabled} aria-label={call.micLabel} data-usage-element="chat.mic" className={cn("relative isolate flex shrink-0 items-center justify-center gap-1.5 rounded-full text-[13px] font-medium outline-none focus-visible:ring-3 focus-visible:ring-white disabled:opacity-50 [&_svg]:size-4", small ? "size-9 pointer-coarse:size-10" : "h-9 px-4 pointer-coarse:h-10", call.micOpen ? "bg-red-500 text-white" : "bg-[#81d300] text-[#102200] hover:bg-[#93e412]")}>
        {call.micOpen ? <span ref={micPulseRef} aria-hidden className="absolute inset-0 -z-10 rounded-full bg-red-500/50" style={call.micPulseStyle} /> : null}
        {call.micOpen ? <Square className="fill-current" /> : <Mic />}
        {small ? null : <span>{call.micOpen ? "Terminei" : speaking ? "Interromper" : "Falar"}</span>}
      </button>
      {!tight ? <Control small={small} label={call.captionsOn ? "Ocultar legendas" : "Mostrar legendas"} onClick={call.onToggleCaptions} pressed={call.captionsOn} off={call.captionsOn}>{call.captionsOn ? <Captions /> : <CaptionsOff />}</Control> : null}
      <Control small={small} label="Encerrar chamada" onClick={call.onEnd} danger usageElement="chat.end_call"><PhoneOff /></Control>
    </div>
  )
}

type StageProps = {
  stage: IniaStageState
  panelHeight: PanelHeight
  /** Cenário atrás dela (ou o fundo de sempre). */
  backdrop: ReactNode
  /** O lugar do avatar (um Canvas só, movido para cá). */
  avatar: ReactNode
  /** Cobre a imagem (sessão de feedback aberta). */
  overlay?: ReactNode
  status: { connecting: boolean; activity: string | null }
  call: CallControlsProps
  speaking: boolean
  /** Fala dela em andamento, com o texto: a legenda. */
  caption: { text: string; heardWords(): number } | null
  person: { name: string; avatarUrl: string | null }
  /** Sala de apoio aberta: a INIA sai de cena (só por CSS; o Canvas continua montado). */
  hidden?: boolean
  assistantImage: string
  /** Há conversa em andamento com o painel recolhido. */
  unread: boolean
}

/**
 * A INIA como uma chamada de vídeo, numa forma só para todos os lugares: no painel, na janela pequena ou na maior, sempre na horizontal, com os
 * controles flutuando sobre a parte de baixo da imagem (o uniforme). Nunca sobre o rosto e nunca numa coluna vertical (rejeitada pelo
 * responsável em 24/11/2026). Muda o tamanho e o que cabe; o elemento, e o 3D dentro dele, é sempre o mesmo.
 */
export function IniaStage(props: StageProps) {
  const { stage, panelHeight, hidden = false, call } = props
  const { mode, inPanel, node, open, drag, setSlot, setLayer } = stage
  const height = mode === "reduced" ? "96px" : `calc((var(--inia-panel, 400px) - 24px) * ${panelHeight === "medium" && stage.wide ? 0.5625 : 0.62})`
  return (
    <>
      <div ref={setSlot} className={cn("relative z-10 mx-3 shrink-0 transition-[height] motion-reduce:transition-none", !inPanel && "overflow-hidden", hidden && "hidden")} style={{ ...PANEL_TRANSITION, height: inPanel ? height : 0 }} data-testid="inia-avatar-stage" data-stage-mode={mode} inert={!inPanel} />
      {mode === "large" && !hidden ? (
        <button
          type="button" onClick={stage.shrink}
          className={cn("mx-3 mb-1 flex shrink-0 items-center justify-between gap-3 rounded-xl border px-4 text-sm outline-none transition-[height,background-color,border-color] focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none", drag === "over" ? "border-transparent bg-primary/[0.07] text-foreground" : drag === "far" ? "border-transparent bg-muted text-muted-foreground" : "border-border text-muted-foreground hover:bg-muted/60 hover:text-foreground")}
          style={{ ...PANEL_TRANSITION, height: drag === "none" ? 48 : 168 }}
        >
          <span className={cn("transition-opacity", drag === "over" && "opacity-0")}>{drag !== "none" ? "Arraste a INIA até aqui" : "A INIA está na janela maior"}</span>
          {drag === "none" ? <span className="font-semibold text-primary dark:text-chart-4">Trazer para cá</span> : <PanelRightOpen className={cn("size-5 transition-opacity", drag === "over" ? "opacity-0" : "opacity-60")} aria-hidden />}
        </button>
      ) : null}
      {stage.panel ? createPortal(<EdgeTab {...props} />, document.body) : null}
      {mode === "mini" || mode === "large" ? createPortal(
        <FloatingWindow name="INIA" hidden={hidden} place={stage.place} onPlace={stage.setPlace} notice={drag === "over" ? "Solte para encaixar" : null} onDrag={stage.onDrag} onDrop={stage.onDrop} {...(mode === "large" ? LARGE_WINDOW : MINI_WINDOW)}>
          <div ref={setLayer} className="relative size-full" />
        </FloatingWindow>, document.body) : null}
      {node ? createPortal(
        <StageImage
          {...props} mode={mode === "stowed" ? "docked" : mode} concealed={hidden}
          onEnlarge={mode === "large" || mode === "stowed" || (!stage.wide && open) ? undefined : stage.enlarge}
          onBack={mode === "large" ? stage.shrink : mode === "mini" ? stage.expand : undefined}
          // Na chamada, os controles precisam ficar à mão: só se guarda fora dela.
          onStow={mode === "mini" && !call.inCall ? stage.stow : undefined}
        />, node) : null}
    </>
  )
}

function StageImage({ stage, mode, concealed, backdrop, avatar, overlay, status, call, speaking, caption, person, onEnlarge, onBack, onStow }: StageProps & { mode: Exclude<StageMode, "stowed">; concealed: boolean; onEnlarge?: () => void; onBack?: () => void; onStow?: () => void }) {
  const roomy = mode === "large" && stage.place.w >= ROOMY_PX
  // O quadro da pessoa, na chamada: em todo lugar onde cabe ao lado dos controles.
  const selfHidden = useSelfViewHidden()
  const selfSize: SelfViewSize | null = !call.inCall || mode === "reduced" ? null : roomy ? "large" : mode === "mini" ? (stage.place.w >= MINI_SELF_PX ? "small" : null) : "medium"
  // No painel de 320 px, com os botões do toque (208 px), o quadro não cabe: medido pela própria imagem (208 + 80 dele + 16 de margem).
  const selfTight = mode === "docked" && selfSize !== null && !selfHidden
  const statusTag = <IniaCallStatus state={call.state} muted={call.muted} inCall={call.inCall} connecting={status.connecting} activity={status.activity} withName={mode === "large"} />
  const action = (label: string, icon: ReactNode, onClick: () => void, place?: "back" | "enlarge") => (
    <Tooltip>
      {/* O foco que chega aqui com a mudança de lugar só abre a dica para quem está no teclado. */}
      <TooltipTrigger asChild onFocus={(event) => { if (!event.currentTarget.matches(":focus-visible")) event.preventDefault() }}><button type="button" onClick={onClick} aria-label={label} data-inia-action={place} className="flex size-8 shrink-0 items-center justify-center rounded-full bg-black/45 text-white outline-none backdrop-blur-md hover:bg-black/70 focus-visible:ring-2 focus-visible:ring-white pointer-coarse:size-9 [&_svg]:size-3.5">{icon}</button></TooltipTrigger>
      <TooltipContent side="bottom" className="inia-tooltip-genie">{label}</TooltipContent>
    </Tooltip>
  )
  const frame = <span aria-hidden className="pointer-events-none absolute inset-0 z-20 rounded-[inherit] ring-1 ring-black/10 ring-inset dark:ring-white/10" />
  if (mode === "reduced") {
    return (
      <div className="flex h-full items-center gap-3 rounded-xl bg-[#160c26] p-2" data-testid="inia-call-tile" data-speaking={speaking || undefined}>
        <div data-inia-image className="relative isolate aspect-video h-20 shrink-0 overflow-hidden rounded-lg [mask-image:radial-gradient(white,black)] [&_canvas]:size-full!">{backdrop}<div className="absolute inset-0">{avatar}</div>{overlay}{frame}</div>
        {overlay ? null : <div className="flex min-w-0 flex-1 flex-col items-start gap-1.5">{statusTag}<IniaCallControls {...call} small tight /></div>}
      </div>
    )
  }
  return (
    // `mask-image`: o Safari não recorta pelos cantos arredondados um canvas WebGL composto em GPU sem uma máscara.
    <div data-inia-image data-testid="inia-call-tile" data-speaking={speaking || undefined} className={cn("relative isolate h-full overflow-hidden rounded-xl bg-[#160c26] [container-type:inline-size] [mask-image:radial-gradient(white,black)] [&_canvas]:size-full!", concealed && "invisible")}>
      {backdrop}
      <div className="absolute inset-0">{avatar}</div>
      {overlay ?? <>
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-linear-to-t from-black/50 to-transparent" />
        <div className={cn("pointer-events-none absolute inset-x-2.5 z-10 flex items-start justify-between gap-2 *:pointer-events-auto", mode === "docked" ? "top-2.5" : "top-5")}>
          {statusTag}
          <div className="flex gap-1.5">{onBack ? action(mode === "large" ? "Diminuir a INIA" : "Encaixar no painel", mode === "large" ? <Minimize2 /> : <PanelRightOpen />, onBack, "back") : null}{onEnlarge ? action("INIA maior, flutuando", <Maximize2 />, onEnlarge, "enlarge") : null}{onStow ? action("Guardar na aba lateral", <ChevronRight />, onStow) : null}</div>
        </div>
        {caption && call.captionsOn ? <CallCaption text={caption.text} heardWords={caption.heardWords} bottom={roomy ? 78 : 56} /> : null}
        {/* O mesmo lugar dentro e fora da chamada: entrar e sair não empurra nada. Os controles ficam no centro e só cedem para a esquerda
            quando não cabem ao lado do quadro da pessoa. */}
        <div className={cn("pointer-events-none absolute inset-x-2 z-10 grid items-center *:pointer-events-auto", roomy ? "bottom-3.5 h-12" : "bottom-2 h-11 pointer-coarse:h-12", selfTight && "pointer-coarse:@max-[304px]:[--self-view:0px]!")} style={{ "--self-view": `${selfSize ? (selfHidden ? 40 : SELF_VIEW_SPACE[selfSize]) : 0}px`, gridTemplateColumns: "minmax(0, 1fr) auto minmax(var(--self-view), 1fr)" } as CSSProperties}><div className="col-start-2"><IniaCallControls {...call} small={!roomy} /></div></div>
        {selfSize ? <SelfView person={person} micOpen={call.micOpen} size={selfSize} className={cn(mode === "docked" ? "right-2 bottom-2" : "right-3.5 bottom-3.5", mode === "mini" && "pointer-coarse:hidden", selfTight && "pointer-coarse:@max-[304px]:hidden")} /> : null}
      </>}
      {frame}
    </div>
  )
}

/** A aba: o painel recolhido continua à vista na borda, com o rosto dela e o que está acontecendo. */
function EdgeTab({ stage, call, unread, assistantImage }: StageProps) {
  const { panel, open, drag, wide, setEdgeTab } = stage
  const notice = panel?.notice ?? (unread ? "há uma conversa em andamento" : null)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          ref={setEdgeTab} type="button" onClick={stage.expand} inert={open} data-inia-edge-tab
          aria-label={panel?.notice ? `Abrir o painel da INIA — ${panel.notice}` : "Abrir o painel da INIA"}
          className={cn("group fixed right-0 z-30 flex w-14 flex-col items-center gap-2 rounded-l-xl bg-card py-4 outline-none transition-[transform,opacity,width] hover:w-16 focus-visible:ring-3 focus-visible:ring-ring max-sm:w-11 max-sm:py-3 motion-reduce:transition-none", FLOATING_SHADOW, !open && drag === "over" && "w-18")}
          style={{ ...PANEL_TRANSITION, top: wide ? "38%" : "30%", opacity: open ? 0 : 1, transform: open ? "translateX(110%)" : "none", transitionDelay: open ? "0ms" : "160ms" }}
        >
          <ChevronLeft className="size-5 text-primary transition-transform group-hover:-translate-x-0.5 dark:text-chart-4" aria-hidden />
          <span className="relative">
            <Avatar className="size-9 ring-2 ring-primary/30"><AvatarImage src={assistantImage} alt="" /><AvatarFallback className="bg-primary text-primary-foreground">IA</AvatarFallback></Avatar>
            <span aria-hidden className={cn("absolute -right-0.5 -bottom-0.5 size-3 rounded-full ring-2 ring-card motion-reduce:animate-none", STATUS[call.state].dot)} />
          </span>
          <span className="text-[11px] font-semibold [writing-mode:vertical-rl]">INIA</span>
          {panel?.notice ? <span aria-hidden className="size-2 rounded-full bg-primary" /> : unread ? <MessageSquareText aria-hidden className="size-3.5 text-muted-foreground" /> : null}
        </button>
      </TooltipTrigger>
      <TooltipContent side="left" className="inia-tooltip-genie">{notice ? notice.charAt(0).toUpperCase() + notice.slice(1) : "Abrir o painel da INIA"}</TooltipContent>
    </Tooltip>
  )
}
