"use client"

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { Bot } from "lucide-react"
import { usePanelRef } from "react-resizable-panels"

import { Button } from "@/components/ui/button"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { usePrefersReducedMotion } from "@/components/flow/flow-travel-signal"
import { feedbackSourceKey, type FeedbackSourceRef } from "@/schemas/feedback-applications/feedback-application.schema"
import { useFeedbackInviteQuery } from "@/queries/feedback-applications/use-feedback-applications"
import { useHumanSupportState } from "@/queries/human-support/use-human-support-state"
import { createIniaVoiceEngine, FeedbackWorkspaceContext, type FeedbackOpenRequest, type FeedbackWorkspace } from "./feedback-application/feedback-workspace-context"

type FollowupWorkspaceShellProps = {
  feed: React.ReactNode
  renderChat: (props: { onCollapse?: () => void; hidden?: boolean }) => React.ReactNode
  /** Acompanhamento do PRÓPRIO colaborador: convites de feedback (indicador discreto com o painel recolhido). */
  feedbackInvites?: boolean
}

const DESKTOP_QUERY = "(min-width: 768px)"
function subscribeLayout(callback: () => void) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {}
  const query = window.matchMedia(DESKTOP_QUERY)
  query.addEventListener("change", callback)
  return () => query.removeEventListener("change", callback)
}
const layoutSnapshot = () => (typeof window.matchMedia !== "function" || window.matchMedia(DESKTOP_QUERY).matches ? "desktop" : "mobile")

/**
 * Layout decidido no CLIENTE (desktop × mobile) para montar UM chat só — antes os dois eram montados e escondidos por CSS, cada
 * um com avatar, áudio e conexão próprios. No servidor (e no primeiro render) nenhum chat é montado: o avatar já é só do cliente.
 */
function useWorkspaceLayout(): "desktop" | "mobile" | null {
  return useSyncExternalStore(subscribeLayout, layoutSnapshot, () => null)
}

/** Elemento visível (antes de o layout ser conhecido o feed existe nos dois layouts, um deles escondido por CSS). */
const isVisible = (element: HTMLElement) => element.getClientRects().length > 0

/**
 * Acompanhamento (feed) + painel da INIA. A SESSÃO DE FEEDBACK abre num card central (do próprio chat) sobre a página: o feed
 * nunca é redimensionado nem perde a posição ao abrir ou fechar um feedback. Com o painel recolhido o chat continua montado
 * (oculto) — a sessão abre do mesmo jeito, sem expandir o painel.
 */
export function FollowupWorkspaceShell({ feed, renderChat, feedbackInvites = false }: FollowupWorkspaceShellProps) {
  const chatRef = usePanelRef()
  const [collapsed, setCollapsed] = useState(false)
  const layout = useWorkspaceLayout()
  const reducedMotion = usePrefersReducedMotion()
  // O motor de voz vive aqui (não no chat): o clique no feed libera o áudio dentro do gesto.
  const [voice] = useState(createIniaVoiceEngine)
  // O AudioContext nasce no clique (`prime()`) e só a desconexão da voz ao vivo o fechava: recado ou apresentação de feedback
  // sem conversa por voz deixavam um contexto aberto a cada visita ao Acompanhamento. Fechar não é terminal — um novo
  // `prime()` cria outro contexto —, então o StrictMode (desmonta e monta de novo) continua seguro.
  useEffect(() => () => void voice.playback.close(), [voice])
  const [pendingRequest, setPendingRequest] = useState<FeedbackOpenRequest | null>(null)
  const [activeSourceKey, setActiveSourceKey] = useState<string | null>(null)
  const [readTarget, setReadTarget] = useState<{ key: string; nonce: number } | null>(null)
  // Convite em aberto: o painel recolhido mostra um indicador discreto (o chat, oculto, não pode mostrá-lo).
  const invitePending = Boolean(useFeedbackInviteQuery(feedbackInvites).data)
  const chatHandlerRef = useRef<((request: FeedbackOpenRequest) => void) | null>(null)
  const questionHandlerRef = useRef<((question: string) => void) | null>(null)
  const requestSeqRef = useRef(0)
  const mobileChatRef = useRef<HTMLDivElement>(null)
  const mobileFeedRef = useRef<HTMLDivElement>(null)
  // Apoio com Anjo: mensagem nova do Anjo com o painel recolhido aparece no painel; o "Abrir conversa" do aviso abre o painel (no
  // celular, rola até o chat) e o chat abre a sala.
  const { roomOpenRequest, unreadFromAnjo } = useHumanSupportState()
  const railNotice = unreadFromAnjo > 0 ? (unreadFromAnjo === 1 ? "o Anjo respondeu no apoio" : `o Anjo mandou ${unreadFromAnjo} mensagens no apoio`) : invitePending ? "há um feedback para conversar" : null
  const handledRoomRequestRef = useRef(roomOpenRequest)
  useEffect(() => {
    if (roomOpenRequest === handledRoomRequestRef.current) return
    handledRoomRequestRef.current = roomOpenRequest
    if (layout === "desktop") {
      if (collapsed) chatRef.current?.expand()
    } else mobileChatRef.current?.scrollIntoView?.({ block: "start", behavior: reducedMotion ? "auto" : "smooth" })
    // Só a cada pedido novo (nunca pela mudança do recolhido: ver `toggleChat`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomOpenRequest])

  // `onResize` is the single source of truth for `collapsed` (it reflects the
  // panel's real size). Calling collapse/expand only from this click handler
  // — never from an effect keyed on `collapsed` — avoids a feedback loop:
  // collapse() -> onResize fires -> setCollapsed(true) -> an effect watching
  // `collapsed` would fire expand() again, and so on indefinitely.
  function toggleChat() {
    if (collapsed) chatRef.current?.expand()
    else chatRef.current?.collapse()
  }

  const workspace = useMemo<FeedbackWorkspace>(() => ({
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
      setReadTarget({ key: feedbackSourceKey(source), nonce: Date.now() })
      if (layout === "mobile") mobileFeedRef.current?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" })
    },
    readTarget,
    focusFeedbackTrigger(key) {
      const candidates = Array.from(document.querySelectorAll<HTMLElement>(`[data-feedback-action="${CSS.escape(key)}"]`))
      const target = candidates.find(isVisible)
      target?.focus({ preventScroll: true })
      return Boolean(target)
    },
    revealChat() {
      if (layout === "mobile") mobileChatRef.current?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" })
      else if (chatRef.current?.isCollapsed()) chatRef.current.expand()
    },
    chatHidden: layout === "desktop" && collapsed,
    askInia(question) {
      if (layout === "mobile") mobileChatRef.current?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" })
      else if (chatRef.current?.isCollapsed()) chatRef.current.expand()
      questionHandlerRef.current?.(question)
    },
    registerQuestionHandler(handler) {
      questionHandlerRef.current = handler
    },
  }), [voice, layout, activeSourceKey, pendingRequest, readTarget, reducedMotion, collapsed, chatRef])

  return <FeedbackWorkspaceContext.Provider value={workspace}>
    <div className="w-full">
      <div className="sticky top-[7.5rem] hidden h-[calc(100dvh-8.5rem)] overflow-hidden rounded-xl bg-card md:block">
        <ResizablePanelGroup orientation="horizontal">
          {/* O feed segue o chat: com o layout conhecido só a cópia visível existe (antes eram duas árvores completas, uma
              escondida por CSS). Sem layout (servidor e hidratação) as duas continuam, como sempre; a que fica não remonta. */}
          <ResizablePanel defaultSize="58%" minSize="38%">{layout === "mobile" ? null : feed}</ResizablePanel>
          <ResizableHandle withHandle/>
          <ResizablePanel panelRef={chatRef} defaultSize="42%" minSize="300px" collapsedSize="64px" collapsible onResize={(size) => setCollapsed(size.inPixels < 120)}>
            {collapsed
              ? <div className="flex h-full justify-center pt-4"><Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" onClick={toggleChat} aria-label={railNotice ? `Abrir chat da INIA — ${railNotice}` : "Abrir chat da INIA"} className="relative"><Bot className="size-5 text-primary"/>{railNotice ? <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-primary ring-2 ring-card" aria-hidden/> : null}</Button></TooltipTrigger><TooltipContent side="left" className="inia-tooltip-genie">{railNotice ? railNotice.charAt(0).toUpperCase() + railNotice.slice(1) : "Abrir chat da INIA"}</TooltipContent></Tooltip></div>
              : null}
            {/* O chat continua montado com o painel recolhido (oculto): a sessão de feedback (card central) abre sem expandir o painel. */}
            <div className={collapsed ? "hidden" : "h-full"}>
              {/* `renderChat` is a render-prop function call, not a JSX element, so
                  the linter can't see that `onCollapse` only ever ends up wired to
                  an onClick inside OperatorIniaChat — it's never read mid-render. */}
              {/* eslint-disable-next-line react-hooks/refs */}
              {layout === "desktop" ? renderChat({ onCollapse: toggleChat, hidden: collapsed }) : null}
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
      <div className="space-y-4 md:hidden">
        <div ref={mobileFeedRef} className="h-[65dvh] scroll-mt-28 overflow-hidden rounded-xl bg-card">{layout === "desktop" ? null : feed}</div>
        <div ref={mobileChatRef} className="h-[80dvh] scroll-mt-28 overflow-hidden rounded-xl bg-card">
          {layout === "mobile" ? renderChat({}) : <div className="space-y-3 p-5" aria-hidden><Skeleton className="h-64 w-full rounded-2xl"/><Skeleton className="h-10 w-3/4 rounded-2xl"/></div>}
        </div>
      </div>
    </div>
  </FeedbackWorkspaceContext.Provider>
}
