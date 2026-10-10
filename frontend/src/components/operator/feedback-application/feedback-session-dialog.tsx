"use client"

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react"
import { ChevronDown, X } from "lucide-react"
import { Dialog as DialogPrimitive } from "radix-ui"

import { Button } from "@/components/ui/button"
import { Dialog, DialogDescription, DialogOverlay, DialogPortal, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { IniaSceneBackdrop } from "@/components/inia-scenes/inia-scene-backdrop"
import { StageSpeechBubble, type FeedbackSessionSpeech } from "./stage-speech-bubble"

export type FeedbackSessionStatus = { label: string; tone: "pending" | "progress" | "done" | "error" }

export type { FeedbackSessionSpeech } from "./stage-speech-bubble"

type Props = {
  open: boolean
  layout: "desktop" | "mobile"
  /** Assunto do feedback (o mesmo título do Acompanhamento). */
  title: string
  /** "Atendimento de … · publicado em …" (o "quando"; nunca dado técnico). */
  meta: string | null
  status: FeedbackSessionStatus
  /** Ações sobre ESTA aplicação (ex.: "Concluir aplicação") — nunca ações genéricas do chat. */
  headerActions?: ReactNode
  /** "Sair por agora" (em andamento) | "Fechar" — fechar nunca conclui. */
  closeLabel: string
  closeDisabled?: boolean
  avatar: ReactNode
  /** O que ela está dizendo agora (balão sobre a cabeça) — ver stage-speech-bubble.tsx. */
  speech: FeedbackSessionSpeech
  /** Estado da voz em texto, para leitor de tela (o balão é decorativo). */
  voiceStatus: string | null
  /** Controles da apresentação (ouvir, parar, repetir) — numa barrinha embaixo dela, fora do balão. */
  voiceControls: ReactNode
  /** A fala terminou de pousar na conversa (o balão pode sumir). */
  onSpeechLanded(key: number): void
  /** O feedback que ela apresenta (narrativa e detalhes recolhidos). */
  content: ReactNode
  /** A conversa sobre este feedback. */
  conversation: ReactNode
  /** Materiais do feedback (null = sem materiais), logo acima do campo. */
  materials: ReactNode
  composer: ReactNode
  /** Cenário que vale hoje (fundo atrás dela, configurado pelo Administrador geral); nulo = o palco roxo de sempre. */
  scene?: { imageUrl: string; blur: number; dim: number } | null
  onClose(): void
  /** Devolve o foco a quem abriu (o botão do feedback no Acompanhamento). */
  onCloseAutoFocus(event: Event): void
  /** Feedback desta sessão, para a monitoria de usabilidade (a sessão é uma tela própria). */
  usageEntity?: { type: "PUBLISHED_FEEDBACK" | "INTERACTION_FEEDBACK_DELIVERY"; id: string } | null
}

const STATUS_TONE: Record<FeedbackSessionStatus["tone"], string> = {
  pending: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  progress: "bg-primary/10 text-primary dark:bg-chart-4/15 dark:text-chart-4",
  done: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  error: "bg-destructive/10 text-destructive",
}

/** Entrada em sequência (a INIA chega, fala, mostra o feedback). Só transform/opacity; sem animação com movimento reduzido. */
const ENTER = "animate-in fade-in-0 fill-mode-both motion-reduce:animate-none"
const ON_STAGE = "rounded-2xl bg-background text-foreground shadow-xl ring-1 ring-black/5 dark:ring-white/10"
/**
 * Vidro (desktop): o cenário do dia aparece de leve, desfocado, atrás dos cards — como os painéis do iPhone. Opaco o bastante para
 * o texto ler bem sobre qualquer imagem; os painéis internos (bg-card) também ficam translúcidos para não virarem blocos brancos.
 */
const GLASS = "bg-white/72 text-foreground ring-1 ring-white/55 backdrop-blur-2xl backdrop-saturate-150 dark:bg-[#1b1426]/70 dark:ring-white/10 [&_.bg-card]:bg-white/55 dark:[&_.bg-card]:bg-white/[0.04]"
const GLASS_SHADOW = "shadow-[0_22px_44px_-22px_rgba(11,6,19,0.6)]"

/**
 * SESSÃO DE FEEDBACK — o momento em que a INIA APLICA o feedback ao operador. Sobre o Acompanhamento (escurecido, sem ser
 * redimensionado), como um palco:
 *
 *   INIA · Aplicação de feedback                                   [Concluir aplicação] [Sair por agora]
 *   (avatar grande, virada para o feedback)  ◀ "Agora vamos falar sobre isso."  (balão dela: estado e controles da voz)
 *                                             [ o feedback que ela apresenta ]
 *                                             [ a conversa sobre ele ]
 *                                             [ materiais · campo de mensagem ]
 *
 * O avatar chega VOANDO do painel (o mesmo Canvas, movido — ver avatar-host.tsx), cresce e se vira para o feedback; o balão
 * aparece logo depois e o feedback por último. O tamanho vem do posicionamento fixo (nunca de `min()/clamp()` com `dvh`, que
 * no Safari deixava o card sem altura) e nada depende de animação para ficar visível. No mobile: tela cheia, uma rolagem
 * (avatar, balão, feedback, conversa) e campo fixo acima do teclado e da área segura.
 *
 * No desktop, a coluna da direita é `StageFeedbackColumn`: cards em vidro sobre o cenário, cabeçalho do feedback fixo no topo
 * (o corpo passa por baixo dele ao rolar a conversa, até sobrar só o cabeçalho) e campo de mensagem fixo embaixo.
 *
 * Só composição visual: a conversa, a voz e o avatar continuam sendo do chat da INIA (uma instância). Fechar (X, Esc ou "Sair
 * por agora") nunca conclui a aplicação; clicar fora não fecha.
 */
export function FeedbackSessionDialog({ open, layout, title, meta, status, headerActions, closeLabel, closeDisabled, avatar, speech, voiceStatus, voiceControls, onSpeechLanded, content, conversation, materials, composer, scene = null, onClose, onCloseAutoFocus, usageEntity = null }: Props) {
  const regionRef = useRef<HTMLDivElement>(null)
  const mobile = layout === "mobile"
  const viewportHeight = useVisualViewportHeight(open && mobile)
  // Desktop: ela fica no CENTRO do espaço entre a borda da tela e os cards (medido; ver `useStageCenter`).
  const [avatarArea, setAvatarArea] = useState<HTMLDivElement | null>(null)
  const center = useStageCenter(open && !mobile ? avatarArea : null, regionRef)

  // O balão é só a FALA dela (desenhado, sobre a cabeça no desktop; abaixo dela no mobile). O estado vai em texto para leitor de
  // tela e os controles numa barrinha à parte.
  const bubble = <StageSpeechBubble speech={speech} tail={mobile ? "up" : "down"} tipAt={mobile ? undefined : center.tipAt} onLanded={onSpeechLanded} className={mobile ? "mx-4" : undefined} />
  const statusLine = <p role="status" aria-live="polite" className="sr-only" data-testid="feedback-voice-status">{voiceStatus}</p>
  const dock = voiceControls ? (
    <div className={cn("flex flex-wrap items-center justify-center gap-2", mobile ? "mx-4" : "absolute bottom-10 left-1/2 z-10 -translate-x-1/2 rounded-full bg-[#0b0613]/45 p-1.5 ring-1 ring-white/15 backdrop-blur-md [&_button[data-variant=ghost]]:text-white [&_button[data-variant=ghost]:hover]:bg-white/15 [&_button[data-variant=outline]]:border-white/25 [&_button[data-variant=outline]]:bg-white/10 [&_button[data-variant=outline]]:text-white [&_button[data-variant=outline]:hover]:bg-white/20")} data-testid="feedback-session-voice-controls">
      {voiceControls}
    </div>
  ) : null
  const heading = (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", STATUS_TONE[status.tone])} data-testid="feedback-session-status">{status.label}</span>
        {meta ? <span className="text-xs text-muted-foreground">{meta}</span> : null}
      </div>
      <h3 className="mt-1.5 text-lg leading-snug font-semibold text-primary dark:text-chart-4">{title}</h3>
    </>
  )
  // Mobile: o feedback é um card comum na rolagem única da tela; o campo é a barra fixa embaixo.
  const mobileFeedbackCard = (
    <article aria-label={`Feedback: ${title}`} className={cn(ON_STAGE, ENTER, "mx-4 slide-in-from-bottom-4 duration-500 delay-500")}>
      <header className="border-b px-5 py-4 sm:px-6">{heading}</header>
      <div className="px-5 py-5 sm:px-6">{content}</div>
    </article>
  )
  const mobileConversationCard = conversation ? <div className={cn(ON_STAGE, ENTER, "mx-4 px-5 py-4 duration-500 delay-700 sm:px-6")} data-testid="feedback-session-conversation-card">{conversation}</div> : null
  const mobileBottom = (
    <div className={cn(ON_STAGE, "overflow-hidden rounded-none shadow-none ring-0")} data-testid="feedback-session-composer-card">
      {materials}
      <div className="border-t first:border-t-0">{composer}</div>
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !closeDisabled) onClose() }}>
      <DialogPortal>
        {/* O Acompanhamento fica ao fundo, escurecido e desfocado: a atenção vai para a INIA. */}
        <DialogOverlay className="bg-[#0b0613]/85 backdrop-blur-xl" />
        <DialogPrimitive.Content
          data-slot="dialog-content"
          data-testid="feedback-session"
          data-usage-screen="feedback.session"
          data-usage-entity-type={usageEntity?.type}
          data-usage-entity-id={usageEntity?.id}
          onPointerDownOutside={(event) => event.preventDefault()}
          onOpenAutoFocus={(event) => {
            // Foco inicial no que ela diz e no feedback (leitura) — nunca numa ação como "Concluir" nem no campo.
            event.preventDefault()
            regionRef.current?.focus({ preventScroll: true })
          }}
          onCloseAutoFocus={onCloseAutoFocus}
          style={mobile && viewportHeight ? { height: viewportHeight, bottom: "auto" } : undefined}
          // Desktop: UMA grade para o palco inteiro — o cabeçalho, ela e o feedback começam e terminam nas mesmas bordas (--stage-pad).
          className={cn("fixed inset-0 z-50 flex flex-col text-sm outline-none", mobile ? "bg-background" : "bg-[#0b0613]/45 [--stage-pad:1.5rem] lg:[--stage-pad:2.5rem]")}
        >
          {/* Luz do palco atrás dela. */}
          <div aria-hidden className={cn("pointer-events-none absolute inset-0", mobile ? "h-80 bg-[radial-gradient(ellipse_at_50%_35%,rgba(140,60,200,0.30),transparent_70%)]" : "bg-[radial-gradient(ellipse_at_24%_48%,rgba(150,70,210,0.42),transparent_52%)]")} />
          {/* Cenário do dia (desktop: o palco inteiro; mobile: atrás dela, no topo). Por cima da luz roxa, que fica enquanto a imagem carrega. */}
          {scene && !mobile ? <IniaSceneBackdrop imageUrl={scene.imageUrl} blur={scene.blur} dim={scene.dim} variant="stage" /> : null}
          <header className={cn("relative flex shrink-0 items-center gap-3 py-3", mobile ? "border-b bg-background px-4" : "mx-auto w-full max-w-[1440px] px-(--stage-pad) text-white")}>
            <div className="min-w-0 flex-1">
              <DialogTitle className={cn("flex min-w-0 items-baseline gap-2 text-lg leading-7 font-semibold", mobile && "text-base")}>
                <span className="shrink-0">INIA</span>
                <span className={cn("truncate text-sm font-medium", mobile ? "text-muted-foreground" : "text-white/70")}>Aplicação de feedback</span>
              </DialogTitle>
              <DialogDescription className="sr-only">{[title, meta, status.label].filter(Boolean).join(" · ")}</DialogDescription>
            </div>
            <div className={cn("flex shrink-0 items-center gap-1.5", !mobile && "[&_button]:border-white/25 [&_button]:bg-white/10 [&_button]:text-white [&_button:hover]:bg-white/20")}>
              {headerActions}
              <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={closeDisabled} className="rounded-full" aria-label={mobile ? closeLabel : undefined} data-usage-element="feedback.session.exit">
                <X aria-hidden />
                <span className={mobile ? "sr-only" : undefined}>{closeLabel}</span>
              </Button>
            </div>
          </header>
          {mobile ? (
            <>
              <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4" data-chat-scroll>
                <div className="relative h-64">{scene ? <IniaSceneBackdrop imageUrl={scene.imageUrl} blur={scene.blur} dim={scene.dim} variant="panel" /> : null}<div className="relative h-full">{avatar}</div></div>
                <div ref={regionRef} tabIndex={-1} role="region" aria-label="A INIA e o feedback" className="relative space-y-4 outline-none">
                  {statusLine}
                  {bubble}
                  {dock}
                  {mobileFeedbackCard}
                  {mobileConversationCard}
                </div>
              </div>
              <div className="relative shrink-0 border-t pb-[env(safe-area-inset-bottom)]">{mobileBottom}</div>
            </>
          ) : (
            <div className="relative mx-auto flex min-h-0 w-full max-w-[1440px] flex-1 gap-6 px-(--stage-pad) pb-6">
              {/* Ela fala (balão acima dela) e apresenta: o quadro dela é meio corpo, com folga à direita para o gesto; o corpo
                  continua até a borda de baixo da tela (sem um corte no meio do palco). */}
              <div className="flex w-[38%] max-w-[560px] min-w-[300px] shrink-0 flex-col pt-2">
                {statusLine}
                {/* O espaço do balão é FIXO: aparecer ou sumir nunca muda o tamanho (nem o enquadramento) dela. */}
                <div className="relative flex h-[232px] shrink-0 flex-col justify-end">{bubble}</div>
                <div ref={setAvatarArea} className="relative -mb-6 min-h-0 flex-1">
                  {/* O quadro dela (e os controles embaixo) desloca até o centro do espaço livre; o tamanho não muda. */}
                  <div className="absolute inset-y-0" style={{ left: center.shift, right: -center.shift }} data-testid="feedback-session-avatar">
                    <div className="absolute inset-0">{avatar}</div>
                    {dock}
                  </div>
                </div>
              </div>
              <StageFeedbackColumn title={title} heading={heading} content={content} conversation={conversation} materials={materials} composer={composer} regionRef={regionRef} />
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  )
}

type StageFeedbackColumnProps = {
  title: string
  /** Status, data e título do feedback (o cabeçalho que fica fixo). */
  heading: ReactNode
  content: ReactNode
  conversation: ReactNode
  materials: ReactNode
  composer: ReactNode
  regionRef: RefObject<HTMLDivElement | null>
}

/**
 * Desktop — o feedback, a conversa e o campo de mensagem numa rolagem só, em VIDRO sobre o cenário:
 *
 *   [ status · data · TÍTULO                 ⌄ ]   ← fixo no topo
 *   [ o feedback ]                                 ← ao rolar a conversa, passa por baixo do cabeçalho: o card "encolhe" de
 *   [ a conversa … ]                                  baixo para cima até sobrar só o cabeçalho, com o botão que o abre de novo
 *   [ materiais · campo de mensagem ]              ← fixo embaixo (a conversa passa por baixo dele)
 *
 * Abrir de novo leva ao topo (o feedback no tamanho normal); rolar a conversa recolhe outra vez. Mensagem nova (rolagem até o
 * fim) recolhe sozinha quando a conversa já ocupa a tela. Nada aqui muda de altura conforme o estado — só cantos, sombra e o
 * botão —, então a rolagem nunca "pula". A rolagem avança até a borda da tela e desconta a barra (`--scrollbar`): com barra fixa
 * (Safari/mouse) ou sobreposta, os cards ficam com as mesmas bordas dos botões do cabeçalho do palco.
 */
function StageFeedbackColumn({ title, heading, content, conversation, materials, composer, regionRef }: StageFeedbackColumnProps) {
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null)
  const headRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const footRef = useRef<HTMLDivElement>(null)
  const { collapsed, canCollapse, collapseAt } = useCollapsingFeedback(scroller, headRef, bodyRef, footRef)
  const bodyId = useId()

  function toggle() {
    if (!scroller) return
    const behavior: ScrollBehavior = prefersReducedMotion() ? "auto" : "smooth"
    scroller.scrollTo({ top: collapsed ? 0 : collapseAt.current, behavior })
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div
        ref={setScroller}
        className="-mr-(--stage-pad) min-h-0 flex-1 overflow-y-auto overscroll-contain pr-[calc(var(--stage-pad)-var(--scrollbar,0px))] pl-3 [scroll-padding-bottom:var(--stage-foot,0px)] [scroll-padding-top:var(--stage-head,0px)]"
        data-chat-scroll
      >
        <div ref={regionRef} tabIndex={-1} role="region" aria-label="O feedback e a conversa" className="ml-auto flex min-h-full max-w-3xl flex-col pt-2 outline-none">
          <div
            ref={headRef}
            className={cn(GLASS, ENTER, "sticky top-0 z-20 rounded-2xl rounded-b-none px-5 py-4 slide-in-from-bottom-4 duration-500 delay-500 sm:px-6", collapsed && cn("rounded-b-2xl", GLASS_SHADOW))}
            data-testid="feedback-session-heading"
            data-collapsed={collapsed || undefined}
          >
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">{heading}</div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={toggle}
                aria-expanded={!collapsed}
                aria-controls={bodyId}
                aria-label={collapsed ? `Ver o feedback completo: ${title}` : "Recolher o feedback"}
                // Recolher só aparece quando a conversa tem como ocupar o lugar; abrir, sempre que estiver recolhido.
                className={cn("-mt-1 -mr-2 size-8 shrink-0 rounded-full", !collapsed && !canCollapse && "invisible")}
              >
                <ChevronDown aria-hidden className={cn("transition-transform duration-200 motion-reduce:transition-none", !collapsed && "rotate-180")} />
              </Button>
            </div>
          </div>
          <div ref={bodyRef} id={bodyId} className={cn(GLASS, GLASS_SHADOW, ENTER, "rounded-2xl rounded-t-none px-5 py-5 slide-in-from-bottom-4 duration-500 delay-500 sm:px-6")} data-testid="feedback-session-body" data-usage-scroll="feedback.session.content">
            {content}
          </div>
          {conversation ? (
            <div className={cn(GLASS, ENTER, "mt-4 flex-1 rounded-2xl rounded-b-none px-5 py-4 duration-500 delay-700 sm:px-6")} data-testid="feedback-session-conversation-card">{conversation}</div>
          ) : null}
          {/* O campo de mensagem fica fixo embaixo, e a conversa passa por baixo dele (vidro sobre vidro). */}
          <div ref={footRef} className={cn(GLASS, GLASS_SHADOW, ENTER, "sticky bottom-0 z-20 overflow-hidden rounded-2xl duration-500 delay-700", conversation ? "rounded-t-none" : "mt-4")} data-testid="feedback-session-composer-card">
            {materials}
            <div className="border-t border-black/5 first:border-t-0 dark:border-white/10">{composer}</div>
          </div>
        </div>
      </div>
    </div>
  )
}

const prefersReducedMotion = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches

/**
 * Mede a rolagem do palco: o feedback está RECOLHIDO quando o corpo dele já passou inteiro por baixo do cabeçalho, e PODE
 * recolher quando há conversa suficiente para isso. Publica no elemento a largura da barra de rolagem (`--scrollbar`) e as
 * alturas do cabeçalho e do campo (`--stage-head`/`--stage-foot`, viram `scroll-padding`: o que rola até uma mensagem nunca a
 * deixa escondida embaixo deles). O estado só muda quando o resultado muda — rolar não re-renderiza a sessão a cada quadro.
 */
function useCollapsingFeedback(element: HTMLDivElement | null, headRef: RefObject<HTMLDivElement | null>, bodyRef: RefObject<HTMLDivElement | null>, footRef: RefObject<HTMLDivElement | null>) {
  const [state, setState] = useState({ collapsed: false, canCollapse: false })
  /** Posição da rolagem em que o corpo do feedback acabou de passar por baixo do cabeçalho (o ponto do "Recolher"). */
  const collapseAt = useRef(0)
  useEffect(() => {
    if (!element) return
    let frame = 0
    const setVar = (name: string, value: string) => {
      if (element.style.getPropertyValue(name) !== value) element.style.setProperty(name, value)
    }
    const measure = () => {
      frame = 0
      const head = headRef.current
      const body = bodyRef.current
      if (head && body) {
        // Em coordenadas do CONTEÚDO: o fim do corpo menos a altura do cabeçalho preso no topo = onde o corpo some por baixo
        // dele. Sem layout ainda (corpo sem altura), nada está recolhido.
        const bodyRect = body.getBoundingClientRect()
        const bodyBottom = bodyRect.bottom - element.getBoundingClientRect().top + element.scrollTop
        collapseAt.current = Math.max(0, Math.ceil(bodyBottom - head.offsetHeight))
        const collapsed = bodyRect.height > 0 && element.scrollTop >= collapseAt.current - 1
        const canCollapse = !collapsed && element.scrollHeight - element.clientHeight >= collapseAt.current - 1
        setState((current) => (current.collapsed === collapsed && current.canCollapse === canCollapse ? current : { collapsed, canCollapse }))
        setVar("--stage-head", `${head.offsetHeight + 8}px`)
      }
      if (footRef.current) setVar("--stage-foot", `${footRef.current.offsetHeight + 8}px`)
      // Só quando muda: mudar o recuo mexe no layout, e fora do callback do ResizeObserver (quadro seguinte) não gera laço.
      setVar("--scrollbar", `${Math.max(0, element.offsetWidth - element.clientWidth)}px`)
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure) }
    measure()
    element.addEventListener("scroll", schedule, { passive: true })
    // O conteúdo cresce (mensagens, detalhes abertos, o campo com várias linhas) e a barra pode aparecer.
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule)
    observer?.observe(element)
    if (element.firstElementChild) observer?.observe(element.firstElementChild)
    if (footRef.current) observer?.observe(footRef.current)
    return () => {
      element.removeEventListener("scroll", schedule)
      observer?.disconnect()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [element, headRef, bodyRef, footRef])
  return { ...state, collapseAt }
}

/**
 * Onde ela fica no palco (desktop): no CENTRO do espaço livre entre a borda esquerda da tela e os cards — não no centro da
 * coluna dela, que tem o recuo do palco de um lado e o espaço até os cards do outro (e, em telas largas, os cards encostam na
 * borda direita da grade). Devolve quanto o quadro dela anda na horizontal (`shift`, px) e onde fica a cabeça dela na largura
 * da coluna (`tipAt`, para o rabicho do balão apontar para ela). Medido ao abrir (antes de pintar) e quando algo muda de tamanho.
 */
function useStageCenter(area: HTMLDivElement | null, cardsRef: RefObject<HTMLDivElement | null>): { shift: number; tipAt: number | undefined } {
  const [center, setCenter] = useState<{ shift: number; tipAt: number | undefined }>({ shift: 0, tipAt: undefined })
  useLayoutEffect(() => {
    if (!area) return
    let frame = 0
    const measure = () => {
      frame = 0
      const cards = cardsRef.current?.getBoundingClientRect()
      const box = area.getBoundingClientRect()
      if (!cards || cards.width === 0 || box.width === 0) return
      const screenLeft = area.closest("[data-slot=dialog-content]")?.getBoundingClientRect().left ?? 0
      const target = screenLeft + (cards.left - screenLeft) / 2
      // Nunca invade os cards (nem a borda da tela): no máximo até o espaço que existe de cada lado.
      const shift = Math.round(Math.max(screenLeft - box.left, Math.min(cards.left - box.right, target - (box.left + box.width / 2))))
      const tipAt = Math.min(0.8, Math.max(0.2, (box.width / 2 + shift) / box.width))
      setCenter((current) => (current.shift === shift && current.tipAt === tipAt ? current : { shift, tipAt }))
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure) }
    measure()
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule)
    observer?.observe(area)
    if (cardsRef.current) observer?.observe(cardsRef.current)
    window.addEventListener("resize", schedule)
    return () => {
      observer?.disconnect()
      window.removeEventListener("resize", schedule)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [area, cardsRef])
  return area ? center : { shift: 0, tipAt: undefined }
}

/** Mobile: a altura visível real (o teclado virtual reduz a área) — o campo de mensagem nunca fica escondido atrás dele. */
function useVisualViewportHeight(enabled: boolean): number | null {
  const [height, setHeight] = useState<number | null>(null)
  useEffect(() => {
    const viewport = typeof window === "undefined" ? undefined : window.visualViewport
    if (!enabled || !viewport) return
    const update = () => setHeight(Math.round(viewport.height))
    update()
    viewport.addEventListener("resize", update)
    return () => viewport.removeEventListener("resize", update)
  }, [enabled])
  return enabled ? height : null
}
