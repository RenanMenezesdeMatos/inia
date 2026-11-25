"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react"

import { Skeleton } from "@/components/ui/skeleton"
import { usePrefersReducedMotion } from "@/components/flow/flow-travel-signal"
import { useFeedbackInviteQuery } from "@/queries/feedback-applications/use-feedback-applications"
import { useHumanSupportState } from "@/queries/human-support/use-human-support-state"
import { feedbackSourceKey, type FeedbackSourceRef } from "@/schemas/feedback-applications/feedback-application.schema"
import { cn } from "@/lib/utils"
import { createIniaVoiceEngine, FeedbackWorkspaceContext, type FeedbackOpenRequest, type FeedbackWorkspace } from "../feedback-application/feedback-workspace-context"
import { FLOATING_SHADOW } from "./floating-window"
import { IniaPanelContext, type IniaPanel } from "./inia-panel-context"
import { PANEL_TRANSITION } from "./motion"

const WIDTH = { min: 340, initial: 400, max: 520 }
/** Em % da janela (vw): a largura padrão e o teto da escolhida (a página nunca fica estreita demais ao lado). */
const WIDTH_SHARE = { initial: 28, max: 38 }
/** 860 px: a página ainda tem ~480 px ao lado do painel (inclui zoom de 150% em 1440). As classes `min-[53.75rem]:` seguem este número, em rem:
 * em px o Tailwind as põe antes das do `sm:` e elas perdem. */
const WIDE_QUERY = "(min-width: 53.75rem)"
/** A sessão de feedback (palco) em duas colunas. */
const DESKTOP_QUERY = "(min-width: 1024px)"

function useMediaQuery(query: string, server: boolean): boolean {
  return useSyncExternalStore(
    (notify) => {
      if (typeof window.matchMedia !== "function") return () => {}
      const media = window.matchMedia(query)
      media.addEventListener("change", notify)
      return () => media.removeEventListener("change", notify)
    },
    () => typeof window.matchMedia !== "function" || window.matchMedia(query).matches,
    () => server,
  )
}
const noSubscription = () => () => {}
/** O chat (voz, avatar) só existe no navegador: no servidor e na hidratação, o lugar dele. */
const useMounted = () => useSyncExternalStore(noSubscription, () => true, () => false)

function subscribeToResize(notify: () => void) {
  window.addEventListener("resize", notify)
  return () => window.removeEventListener("resize", notify)
}

/** Elemento visível (o feed pode existir fora da vista). */
const isVisible = (element: HTMLElement) => element.getClientRects().length > 0
/** O botão do feedback no Acompanhamento. */
const feedbackTrigger = (key: string) => Array.from(document.querySelectorAll<HTMLElement>(`[data-feedback-action="${CSS.escape(key)}"]`)).find(isVisible)

type IniaPanelShellProps = {
  children: ReactNode
  /** O chat da INIA. Ausente = esta pessoa não tem o painel: só a página, na mesma coluna. */
  renderChat?: (props: { hidden: boolean }) => ReactNode
  /** Perfil do PRÓPRIO colaborador: convites de feedback (aviso na aba com o painel recolhido). */
  feedbackInvites?: boolean
  /** Janela estreita (o painel cobre a página): a pessoa veio ver outra coisa (um item, outra aba), então ele começa recolhido. */
  startClosedOnNarrow?: boolean
  /** O que a página mostra (aba + item da URL). Mudou com a tela aberta, na janela estreita, para algo que se vê na página: o painel sai da frente. */
  destination?: string
  /** O Acompanhamento está à vista (senão, "Ler feedback" o abre por `onShowFeed`). */
  feedVisible: boolean
  onShowFeed(): void
}

/**
 * Perfil + painel da INIA (operador e liderança). O painel flutua ao lado da página, na MESMA coluna da barra do app (1440 px, 24 px de recuo:
 * barra, página e painel começam e terminam no mesmo lugar, aberto ou recolhido), por cima da barra só por 6 px. Recolher desliza para a
 * direita e deixa uma aba na borda. Vive acima das abas: trocar de aba não desmonta o chat — a conversa, o rascunho e a chamada continuam.
 * Na janela estreita ele cobre a página.
 *
 * Começa SEMPRE aberto (na estreita, só quando a pessoa veio para o Acompanhamento): nada é gravado; a escolha vale durante a visita.
 */
export function IniaPanelShell({ children, renderChat, feedbackInvites = false, startClosedOnNarrow = false, destination = String(startClosedOnNarrow), feedVisible, onShowFeed }: IniaPanelShellProps) {
  const wide = useMediaQuery(WIDE_QUERY, true)
  const layout = useMediaQuery(DESKTOP_QUERY, true) ? "desktop" : "mobile"
  const mounted = useMounted()
  const hasPanel = renderChat !== undefined
  const [openChoice, setOpenChoice] = useState<boolean | null>(null)
  // Vale o que a página mostrava quando o painel passou a existir (o contexto da pessoa pode chegar depois da primeira pintura).
  const [startsClosed, setStartsClosed] = useState(hasPanel ? startClosedOnNarrow : null)
  if (startsClosed === null && hasPanel) setStartsClosed(startClosedOnNarrow)
  const open = openChoice ?? (wide || !startsClosed)
  const [width, setWidth] = useState<number | null>(null)
  /** Janela estreita: o painel aberto cobre a página (que fica fora do Tab e do leitor de tela; a barra do app e os diálogos não estão nela). */
  const pageCovered = hasPanel && mounted && !wide && open
  const panelRef = useRef<HTMLElement>(null)
  const pageRef = useRef<HTMLDivElement>(null)
  const reducedMotion = usePrefersReducedMotion()

  // O motor de voz vive aqui (não no chat): o clique no feed libera o áudio dentro do gesto.
  const [voice] = useState(createIniaVoiceEngine)
  // O AudioContext nasce no clique (`prime()`) e só a desconexão da voz ao vivo o fechava: recado ou apresentação de feedback sem conversa por
  // voz deixavam um contexto aberto a cada visita. Fechar não é terminal (um novo `prime()` cria outro), então o StrictMode continua seguro.
  useEffect(() => () => void voice.playback.close(), [voice])

  const [pendingRequest, setPendingRequest] = useState<FeedbackOpenRequest | null>(null)
  const [activeSourceKey, setActiveSourceKey] = useState<string | null>(null)
  const [readTarget, setReadTarget] = useState<{ key: string; nonce: number } | null>(null)
  const chatHandlerRef = useRef<((request: FeedbackOpenRequest) => void) | null>(null)
  const questionHandlerRef = useRef<((question: string) => void) | null>(null)
  const requestSeqRef = useRef(0)
  const actionsRef = useRef<{ expand(): void; collapse(): void } | null>(null)

  // Sair do Acompanhamento encerra o "Ler feedback" pendente: voltar à aba não reabre o item.
  const wasFeedVisible = useRef(feedVisible)
  useEffect(() => {
    if (wasFeedVisible.current && !feedVisible) queueMicrotask(() => setReadTarget(null))
    wasFeedVisible.current = feedVisible
  }, [feedVisible])

  // Aviso na aba recolhida: mensagem nova do Anjo (o Apoio) ou convite de feedback (o chat, oculto, não pode mostrá-los).
  const invitePending = Boolean(useFeedbackInviteQuery(feedbackInvites).data)
  const { roomOpenRequest, unreadFromAnjo } = useHumanSupportState()
  const notice = unreadFromAnjo > 0 ? (unreadFromAnjo === 1 ? "o Apoio respondeu" : `o Apoio mandou ${unreadFromAnjo} mensagens`) : invitePending ? "há um feedback para conversar" : null
  // "Abrir conversa" do aviso do Apoio: abre o painel, e o chat abre a sala.
  const handledRoomRequestRef = useRef(roomOpenRequest)
  useEffect(() => {
    if (roomOpenRequest === handledRoomRequestRef.current) return
    handledRoomRequestRef.current = roomOpenRequest
    // Reage a um clique em outro lugar: depois desta renderização, não dentro dela.
    if (!open) queueMicrotask(() => actionsRef.current?.expand())
  }, [roomOpenRequest, open])

  // O painel sai da frente porque a pessoa vai ver algo na página: o foco não vai para a aba da borda.
  const quietCollapseRef = useRef<{ focusWasInPanel: boolean; feedbackKey: string | null } | null>(null)
  const collapseQuietly = useCallback((feedbackKey: string | null = null) => {
    quietCollapseRef.current = { focusWasInPanel: panelRef.current?.contains(document.activeElement) ?? false, feedbackKey }
    if (actionsRef.current) actionsRef.current.collapse()
    else setOpenChoice(false)
  }, [])

  // Na estreita, o destino que chega com a tela aberta (sino, cartão da INIA, atalho) abriria ATRÁS do painel. Só quando ele muda de verdade:
  // quem reabriu o painel fica com ele, e a primeira carga é do começo acima.
  const seenDestination = useRef<string | null>(null)
  useEffect(() => {
    if (!hasPanel) return
    const before = seenDestination.current
    seenDestination.current = destination
    if (before === null || before === destination || !startClosedOnNarrow || wide || !open) return
    collapseQuietly()
  }, [hasPanel, destination, startClosedOnNarrow, wide, open, collapseQuietly])

  // Recolher e reabrir (pela pessoa, nunca no começo) mudam o botão de lugar: o foco acompanha.
  const lastChoice = useRef(openChoice)
  useEffect(() => {
    if (lastChoice.current === openChoice) return
    lastChoice.current = openChoice
    const quiet = quietCollapseRef.current
    quietCollapseRef.current = null
    if (openChoice) panelRef.current?.querySelector<HTMLElement>("[data-chat-collapse]")?.focus({ preventScroll: true })
    else if (!quiet) document.querySelector<HTMLElement>("[data-inia-edge-tab]")?.focus({ preventScroll: true })
    // Estava dentro do painel (que ficou inerte): segue para o feedback pedido ou para a aba do perfil que se abriu.
    else if (quiet.focusWasInPanel) ((quiet.feedbackKey ? feedbackTrigger(quiet.feedbackKey) : undefined) ?? pageRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]'))?.focus({ preventScroll: true })
  }, [openChoice])

  const panel = useMemo<IniaPanel>(() => ({
    open,
    setOpen: setOpenChoice,
    wide,
    notice,
    panelElement: () => panelRef.current,
    registerActions(actions) {
      actionsRef.current = actions
    },
  }), [open, wide, notice])

  const workspace = useMemo<FeedbackWorkspace>(() => {
    const reveal = () => {
      if (!open) actionsRef.current?.expand()
    }
    return {
      voice,
      layout,
      activeSourceKey,
      setActiveSourceKey,
      openFeedback(input) {
        requestSeqRef.current += 1
        const request: FeedbackOpenRequest = { ...input, id: requestSeqRef.current }
        setActiveSourceKey(feedbackSourceKey(input.source))
        const handler = chatHandlerRef.current
        if (handler) handler(request)
        else {
          // Chat ainda não montado (primeiro render do cliente): o áudio é liberado AQUI, dentro do clique; o chat pega o pedido ao montar.
          if (input.mode === "listen") voice.playback.prime()
          setPendingRequest(request)
        }
      },
      pendingRequest,
      takePendingRequest() {
        const request = pendingRequest
        if (request) setPendingRequest(null)
        return request
      },
      registerChat(handler) {
        chatHandlerRef.current = handler
      },
      readFeedback(source: FeedbackSourceRef) {
        const key = feedbackSourceKey(source)
        setReadTarget({ key, nonce: Date.now() })
        if (!feedVisible) onShowFeed()
        if (!wide && open) collapseQuietly(key)
      },
      readTarget,
      focusFeedbackTrigger(key) {
        // Com a página coberta, o botão não recebe foco: quem fechou a sessão fica no painel.
        const target = pageCovered ? panelRef.current?.querySelector<HTMLElement>("[data-chat-collapse]") : feedbackTrigger(key)
        target?.focus({ preventScroll: true })
        return Boolean(target)
      },
      revealChat: reveal,
      chatHidden: !open,
      askInia(question) {
        reveal()
        questionHandlerRef.current?.(question)
      },
      registerQuestionHandler(handler) {
        questionHandlerRef.current = handler
      },
    }
  }, [voice, layout, activeSourceKey, pendingRequest, readTarget, open, wide, pageCovered, feedVisible, onShowFeed, collapseQuietly])

  const variables = {
    "--inia-margin": "max(24px, calc((100% - 90rem) / 2 + 24px))",
    "--inia-panel-wide": width === null ? `clamp(${WIDTH.min}px, ${WIDTH_SHARE.initial}vw, ${WIDTH.initial}px)` : `min(${width}px, max(${WIDTH.min}px, ${WIDTH_SHARE.max}vw))`,
    // Recolhido em tela justa, o conteúdo termina antes da aba da borda (ela nunca o cobre).
    "--inia-page-end": !hasPanel ? "var(--inia-margin)" : open ? "calc(var(--inia-panel-wide) + var(--inia-margin) + 16px)" : "max(68px, var(--inia-margin))",
    ...(reducedMotion ? {} : PANEL_TRANSITION),
  } as CSSProperties

  return (
    <FeedbackWorkspaceContext.Provider value={workspace}>
      <IniaPanelContext.Provider value={panel}>
        {/* Em %, não em vw: no Windows a barra de rolagem ocupa largura e o vw a conta. */}
        <div ref={pageRef} inert={pageCovered} className="flex w-full flex-col px-4 py-4 transition-[padding] sm:px-6 sm:py-5 min-[53.75rem]:pr-(--inia-page-end) min-[53.75rem]:pl-(--inia-margin)" style={variables} data-inia-page={hasPanel ? (open ? "panel-open" : "panel-collapsed") : "no-panel"}>
          {children}
        </div>
        {hasPanel ? (
          // Desliza para a direita ao recolher; continua montado (a conversa, o rascunho e a chamada ficam).
          <aside
            ref={panelRef} aria-label="INIA" inert={!open} data-state={open ? "open" : "collapsed"}
            className={cn(
              "fixed inset-x-2 top-[3.125rem] bottom-2 z-30 flex min-h-0 flex-col rounded-xl bg-card transition-transform [--inia-panel:calc(100vw-16px)] motion-reduce:transition-none",
              "min-[53.75rem]:right-(--inia-margin) min-[53.75rem]:bottom-3 min-[53.75rem]:left-auto min-[53.75rem]:w-(--inia-panel) min-[53.75rem]:[--inia-panel:var(--inia-panel-wide)]",
              FLOATING_SHADOW,
              // Na estreita, até o navegador saber se começa aberto, o painel não cobre a página.
              !mounted && "max-[53.75rem]:hidden",
            )}
            style={{ ...variables, transform: open ? "none" : "translateX(calc(100% + max(24px, (100vw - 90rem) / 2 + 24px) + 48px))" }}
          >
            {wide ? <WidthHandle width={width} onWidth={setWidth} /> : null}
            <div className="min-h-0 flex-1">
              {mounted ? renderChat({ hidden: !open }) : <div className="space-y-3 p-5" aria-hidden><Skeleton className="h-56 w-full rounded-xl" /><Skeleton className="h-10 w-3/4 rounded-2xl" /></div>}
            </div>
          </aside>
        ) : null}
      </IniaPanelContext.Provider>
    </FeedbackWorkspaceContext.Provider>
  )
}

/** `width`: a escolhida (`null` = a padrão). A medida e o teto são os REAIS desta janela, como no CSS. */
function WidthHandle({ width, onWidth }: { width: number | null; onWidth(value: number): void }) {
  const viewport = useSyncExternalStore(subscribeToResize, () => window.innerWidth, () => 1_440)
  const max = Math.max(WIDTH.min, Math.min(WIDTH.max, Math.floor((viewport * WIDTH_SHARE.max) / 100)))
  const clamp = (value: number) => Math.round(Math.max(WIDTH.min, Math.min(max, value)))
  const real = clamp(width ?? Math.min(WIDTH.initial, (viewport * WIDTH_SHARE.initial) / 100))
  return (
    <div
      role="separator" aria-orientation="vertical" aria-label="Largura do painel da INIA" aria-valuenow={real} aria-valuemin={WIDTH.min} aria-valuemax={max} tabIndex={0}
      className="group absolute inset-y-8 -left-2 z-20 flex w-4 cursor-col-resize touch-none items-center justify-center rounded outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onKeyDown={(event) => {
        const next = { ArrowLeft: real + 24, ArrowRight: real - 24, Home: WIDTH.min, End: max }[event.key]
        if (next === undefined) return
        event.preventDefault()
        onWidth(clamp(next))
      }}
      onPointerDown={(event) => {
        event.preventDefault()
        const start = event.clientX
        const base = event.currentTarget.parentElement?.offsetWidth ?? real
        const move = (e: PointerEvent) => onWidth(clamp(base + start - e.clientX))
        const release = () => {
          window.removeEventListener("pointermove", move)
          window.removeEventListener("pointerup", release)
          window.removeEventListener("pointercancel", release)
        }
        window.addEventListener("pointermove", move)
        window.addEventListener("pointerup", release)
        window.addEventListener("pointercancel", release)
      }}
    ><span className="h-12 w-1.5 rounded-full bg-transparent transition-colors group-hover:bg-primary/50 group-focus-visible:bg-primary" /></div>
  )
}
