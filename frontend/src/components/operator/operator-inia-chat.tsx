"use client"

import dynamic from "next/dynamic"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useRouter, useSearchParams } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import { History, MessageCircle, PanelRightClose, Play, RotateCcw, SquarePen, Square } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ConfirmReadingControl } from "@/components/feedbacks/confirm-reading/confirm-reading-control"
import type { ReadConfirmationResult } from "@/schemas/feedback-read-confirmations/feedback-read-confirmation.schema"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { AvatarConversationState } from "@/lib/avatar/animation/types"
import type { FarewellSpeech } from "@/lib/avatar/avatar-driver"
import { fetchEphemeralSession, fetchVoiceReading, GeminiRealtimeTransport, recordVoiceTurn, type RealtimeCallState, type VoiceConversationResult } from "@/lib/realtime/gemini-realtime-transport"
import { ApiError } from "@/lib/api/api-client"
import { startUsageAction, trackUsage } from "@/lib/usage/usage-provider"
import { ConversationClosedError, FeedbackConversationChangedError, fetchConversationMessages, fetchCurrentConversation, fetchTextReply, saveMessageRating, startNewConversation, type ConversationSummary } from "@/lib/realtime/gemini-text-client"
import { newClientKey } from "@/lib/realtime/conversation-format"
import { IniaConversationHistorySheet } from "./inia-conversation-history-sheet"
import { IniaRecadoInvite } from "./inia-recado-invite"
import { speakRecado, type RecadoHandlers, type RecadoPlayback } from "@/lib/avatar/recado/recado-speech"
import { setVoiceMuted, useVoiceMuted } from "@/lib/avatar/voice-preference"
import { playRecadoAudio, type RecadoAudio } from "@/lib/avatar/recado/recado-audio"
import { iniaInboxKey, useIniaInboxQuery } from "@/queries/inia-deliveries/use-inia-inbox"
import { markWorkflowConversationSeen } from "@/services/inia-deliveries/inia-deliveries-service"
import type { OperatorIndicatorsData, OperatorProfile } from "@/schemas/operator"
import { registeredFirstNameOf } from "@/schemas/profile/my-profile.schema"
import { createIniaVoiceEngine, useFeedbackWorkspace, type FeedbackOpenRequest } from "./feedback-application/feedback-workspace-context"
import { AvatarHostManager, AvatarSlot } from "./feedback-application/avatar-host"
import { FeedbackSessionContent, FeedbackSessionMaterials } from "./feedback-application/feedback-session-content"
import { FeedbackSessionDialog } from "./feedback-application/feedback-session-dialog"
import { IniaSceneBackdrop } from "@/components/inia-scenes/inia-scene-backdrop"
import { IniaCallControls, IniaCallPlaceholder, IniaCallStatus, IniaCallTile } from "./inia-call-tile"
import { useCurrentIniaScene } from "@/queries/inia-scenes/use-inia-scenes"
import { FeedbackInviteCard } from "./feedback-application/feedback-invite-card"
import { feedbackApplicationsKey, feedbackInviteKey, useFeedbackInviteQuery } from "@/queries/feedback-applications/use-feedback-applications"
import { fetchFeedbackApplications, fetchFeedbackPresentationAudio, markFeedbackApplicationOpened, pauseFeedbackApplication, postFeedbackPresentationEvent, startOrResumeFeedbackApplication } from "@/services/feedback-applications/feedback-applications-service"
import { feedbackSourceKey, type FeedbackApplicationDetail } from "@/schemas/feedback-applications/feedback-application.schema"
import { asFollowUp, newTurnId, nextMessageId, nowTime, PAGE_LIMIT, presentationMessageOf, toChatMessage, type ChatMessage } from "./operator-inia-chat/chat-message"
import { FAREWELL_TEXT, TEXT_REPLY_FALLBACK_TEXT } from "./operator-inia-chat/voice-context"
import { ENTRY_OF_MODE, FEEDBACK_PRESENTATION_CUE, LIVE_PRESENTATION_START_TIMEOUT_MS, PRESENT_GESTURE_DELAY_MS, presentationAudioKey, type FeedbackReturn, type FeedbackSession, type LivePresentationHooks, type PresentationPhase, type SessionEntry } from "./operator-inia-chat/feedback-session-model"
import { createReadingClock, READ_HOLD_MS, READ_WORD_MS, wordsIn } from "./operator-inia-chat/stage-speech"
import { plainTextOf } from "@/lib/format/plain-text"
import { MIC_PULSE_REST_STYLE, micGlow, normalizedMicLevel, WAVEFORM_BAR_COUNT } from "./operator-inia-chat/mic-level"
import { useStageSpeech } from "./operator-inia-chat/use-stage-speech"
import { useFeedbackInvite } from "./operator-inia-chat/use-feedback-invite"
import { useRecado } from "./operator-inia-chat/use-recado"
import { describeFeedbackSession } from "./operator-inia-chat/feedback-session-speech"
import { ChatMessageList } from "./operator-inia-chat/chat-message-list"
import { withoutLiveSourceMarkers, type ClarificationAnswer } from "@/schemas/knowledge-clarification/clarification.schema"
import { PanelConversationBanners } from "./operator-inia-chat/panel-conversation-banners"
import { MicConsentDialog } from "./operator-inia-chat/mic-consent-dialog"
import { ChatComposer } from "./operator-inia-chat/chat-composer"
import { useLeadershipHomeQuery } from "@/queries/leadership/use-leadership-home"
import { publicAsset } from "@/lib/assets/public-asset"
import { useBrowserIdle } from "@/lib/browser/use-browser-idle"

// Mesma altura do palco do avatar em todos os estados (carregando, câmera desligada, avatar
// desativado): trocar um pelo outro nunca empurra a conversa para baixo.
const AVATAR_STAGE_HEIGHT = "h-64"
const avatarStagePlaceholder = <div aria-hidden className={`${AVATAR_STAGE_HEIGHT} rounded-2xl bg-muted/40`}/>
const IniaHumanoidAvatar3D = dynamic(() => import("./inia-humanoid-avatar-3d").then((module) => module.IniaHumanoidAvatar3D), {
  ssr: false,
  loading: () => avatarStagePlaceholder,
})
// INIA Mentora (pipeline em tools/avatar/inia-mentora). O GLB original do asset base continua em
// /models/inia-avatar-poc.glb como cópia recuperável — basta apontar a variável para ele. Com a versão do conteúdo no endereço
// (cache imutável: o navegador baixa os 6,6 MB uma vez por versão).
const avatarModelUrl = process.env.NEXT_PUBLIC_INIA_AVATAR_MODEL_URL ?? publicAsset("/models/inia-mentora.glb")

export function OperatorIniaChat({ indicators, operator, onCollapse, context = "operator", hidden = false }: { indicators: OperatorIndicatorsData; operator: OperatorProfile; onCollapse?: () => void; context?: "operator" | "team"; hidden?: boolean }) {
  // Espaço de trabalho do Acompanhamento: o motor de voz é UM só (acima do chat) — o clique no feed libera o áudio no gesto.
  const workspace = useFeedbackWorkspace()
  // Navegação pedida pelo backend (aceite da oferta de report) — por ref: os callbacks da voz nascem uma vez por sessão.
  const router = useRouter()
  const routerRef = useRef(router)
  useEffect(() => {
    routerRef.current = router
  }, [router])
  const feedbackEnabled = context === "operator" && workspace !== null
  const [question, setQuestion] = useState("")
  const [callActive, setCallActive] = useState(true)
  const [cameraOn, setCameraOn] = useState(true)
  const [conversationState, setConversationState] = useState<AvatarConversationState>("idle")
  // Motor de voz desta instância do chat (o shell monta um chat no desktop e outro no mobile, cada
  // um com o seu): reprodução + lip-sync + o driver que o avatar lê a cada quadro. Estáveis pela
  // vida do componente — o `<Canvas>` recebe sempre o MESMO driver e nunca re-renderiza por fala,
  // boca ou gesto (nada disso passa por estado do React). Construir não toca em Web Audio: o
  // AudioContext só nasce no clique (`primeAudioPlayback`).
  const [voice] = useState(() => workspace?.voice ?? createIniaVoiceEngine())
  const [farewellActive, setFarewellActive] = useState(false)
  const [voiceError, setVoiceError] = useState("")
  const [micConsentGranted, setMicConsentGranted] = useState(false)
  const [showMicConsent, setShowMicConsent] = useState(false)
  const [sessionConnected, setSessionConnected] = useState(false)
  const [liveAssistantText, setLiveAssistantText] = useState<string | null>(null)
  const [textReplyPending, setTextReplyPending] = useState(false)
  // Kept fully separate from `liveAssistantText` (voice) even though the
  // typewriter behavior is identical — typed messages must never touch
  // avatar/voice state, so the two paths stay independent all the way down.
  const [liveTextReply, setLiveTextReply] = useState<string | null>(null)
  // A resposta em fluxo é a do esclarecimento pelas bases (traz marcadores de fonte, que saem do que a pessoa lê).
  const [liveTextCitations, setLiveTextCitations] = useState(false)
  // Progresso verdadeiro da resposta por escrito enquanto o texto não começa ("Consultando as bases de conhecimento…").
  const [textReplyStatus, setTextReplyStatus] = useState<string | null>(null)
  const {
    stageUtterance, stageUtteranceRef, stageTranscriptRef, stageHiddenIds, presentationLandRef, stageGreeting, setStageGreeting,
    setStage, hideOnStage, revealOnStage, beginStageUtterance, appendStageText, endStageUtterance, attachStageMessage,
    landSpecialistOnStage, takeSpecialistLanding, handleSpeechLanded, clearStage,
  } = useStageSpeech(voice)
  // Mudo (preferência do navegador): ela responde só em texto. Lido também pelos eventos da voz (criados uma vez) → ref.
  const voiceMuted = useVoiceMuted()
  const voiceMutedRef = useRef(voiceMuted)
  /** O turno de voz aberto respondeu a uma pergunta DIGITADA (o histórico guarda a pergunta como digitada). */
  const typedVoiceTurnRef = useRef(false)
  // Mensagens da conversa EXIBIDA (a atual ou uma encerrada aberta para consulta). A saudação não é mensagem: aparece só
  // no estado vazio e nunca entra no contexto do modelo nem no histórico.
  const [messages, setMessages] = useState<ChatMessage[]>([])
  // Nome de tratamento resolvido pelo backend (o que a pessoa escolheu, inteiro; senão o primeiro nome do cadastro). O cumprimento
  // do painel usa só o PRIMEIRO nome — a mesma regra da saudação dos feedbacks (decisão de produto de 05/10/2026).
  const addressName = operator.addressName ?? registeredFirstNameOf(operator.name)
  const greetingName = registeredFirstNameOf(addressName)
  const greeting = context === "team" ? `Olá, ${greetingName}. Posso mostrar onde atuar hoje, consultar os indicadores e as pessoas da sua estrutura ou explicar um processo.` : `Olá, ${greetingName}. Vi seus feedbacks de hoje. Quer conversar sobre algum deles?`
  // Liderança: perguntas para começar derivadas das prioridades do dia (a mesma leitura do cartão "Onde atuar hoje").
  const leadershipHome = useLeadershipHomeQuery(context === "team")
  const starterSuggestions = context === "team" && leadershipHome.data?.enabled ? leadershipHome.data.suggestions : []
  // Conversa persistida (backend). `null` = conversa nova ainda não iniciada: a primeira mensagem a cria.
  const [conversationId, setConversationId] = useState<string | null>(null)
  const conversationIdRef = useRef<string | null>(null)
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading")
  // Conversa encerrada aberta para consulta (somente leitura). `null` = exibindo a conversa atual.
  const [readOnlyConversation, setReadOnlyConversation] = useState<ConversationSummary | null>(null)
  const [olderCursor, setOlderCursor] = useState<string | null>(null)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [olderError, setOlderError] = useState(false)
  const [conversationNotice, setConversationNotice] = useState("")
  const [historyOpen, setHistoryOpen] = useState(false)
  const [startingNew, setStartingNew] = useState(false)
  // Toda troca de conversa incrementa a geração: resposta, transcrição ou página que chegar depois para a conversa
  // anterior é descartada da tela (já está salva na conversa certa pelo backend) — nunca aparece no lugar errado.
  const viewGenerationRef = useRef(0)
  // Resposta por escrito em andamento: trocar de conversa (ou fechar o chat) cancela o pedido — o servidor para de gerar e a vaga de
  // IA volta para os outros, em vez de terminar uma resposta que ninguém vai ver.
  const textReplyAbortRef = useRef<AbortController | null>(null)
  const advanceView = () => {
    textReplyAbortRef.current?.abort()
    textReplyAbortRef.current = null
    return ++viewGenerationRef.current
  }
  useEffect(() => () => textReplyAbortRef.current?.abort(), [])
  const inactivityMsRef = useRef(24 * 3_600_000)
  const lastActivityRef = useRef<number | null>(null)
  const messagesContentRef = useRef<HTMLDivElement>(null)
  const scrollAnchorRef = useRef<{ height: number; top: number } | null>(null)
  const focus = [...indicators.current].sort((a, b) => a.priority - b.priority)[0]
  // Workflow Outputs V1 — entregas da INIA: conversas criadas por um fluxo (Chat) e recados de voz (Avatar). Deep link do sino:
  // `iniaConversation` abre a conversa; `iniaDelivery` destaca o convite (nunca toca sozinho).
  const searchParams = useSearchParams()
  const targetConversationId = searchParams?.get("iniaConversation") ?? null
  const targetDeliveryId = searchParams?.get("iniaDelivery") ?? null
  const queryClient = useQueryClient()
  const inboxQuery = useIniaInboxQuery()
  const inbox = inboxQuery.data
  // Conversa de Workflow aberta agora (respondível; não é a conversa "atual" do usuário, que continua a mesma no backend).
  const [workflowConversation, setWorkflowConversation] = useState<{ id: string; title: string } | null>(null)
  const workflowConversationRef = useRef<string | null>(null)
  const recadoPlaybackRef = useRef<RecadoPlayback | null>(null)
  const handledTargetConversationRef = useRef<string | null>(null)
  const unreadWorkflowConversations = (inbox?.unreadConversations ?? []).filter((conversation) => conversation.id !== conversationId)

  // -------------------------------------------------------------------------------------------
  // Aplicação de feedback (uma por feedback, retomável até concluída). Estado da APLICAÇÃO (backend) ≠ reprodução da
  // apresentação (`presentationPhase`, local) ≠ ciência (nunca tocada aqui).
  // -------------------------------------------------------------------------------------------
  const [feedbackSession, setFeedbackSession] = useState<FeedbackSession | null>(null)
  const feedbackSessionRef = useRef<FeedbackSession | null>(null)
  const [feedbackOpening, setFeedbackOpening] = useState<{ title: string; periodLabel: string | null; entry: SessionEntry } | null>(null)
  const [feedbackError, setFeedbackError] = useState<{ message: string; request: FeedbackOpenRequest } | null>(null)
  const [presentationPhase, setPresentationPhase] = useState<PresentationPhase>("idle")
  /** Por onde a apresentação está saindo: ao vivo (sessão de voz, começa em ~2 s) ou voz preparada (fallback, gerada antes). */
  const [presentationVoice, setPresentationVoice] = useState<"live" | "prepared">("live")
  const presentationRef = useRef<RecadoPlayback | null>(null)
  /** Apresentação ao vivo em curso: a sessão de voz avisa quando ela começa a soar, termina, é cortada ou cai. */
  const livePresentationRef = useRef<LivePresentationHooks | null>(null)
  /** O turno de voz aberto é o da apresentação: a fala dela não vira legenda, mensagem nova nem registro (já é a 1ª mensagem). */
  const presentationTurnRef = useRef(false)
  /** Fonte cuja aplicação está abrindo agora (clique repetido durante a abertura = o mesmo pedido). */
  const openingKeyRef = useRef<string | null>(null)
  /** Retomada: a última mensagem que já existia ("Você parou aqui" aparece depois dela). */
  const [resumeMarkerId, setResumeMarkerId] = useState<number | null>(null)
  /** Retomada de um feedback em que a pessoa já conversou: a mensagem onde a sessão abre (a última pergunta dela). */
  const resumeScrollToRef = useRef<number | null>(null)
  const [feedbackReturn, setFeedbackReturn] = useState<FeedbackReturn | null>(null)
  /** Sessão de feedback na tela (card central): abrindo, aberta ou com erro ao abrir. */
  const feedbackMode = feedbackSession !== null || feedbackOpening !== null || feedbackError !== null
  const feedbackCompleted = feedbackSession?.completed ?? false
  /** Fonte da sessão aberta (para devolver o foco ao botão do feedback ao fechar). */
  const sessionKeyRef = useRef<string | null>(null)
  /** Conversa cujas mensagens ANTERIORES estão no topo da lista (na sessão concluída: a conversa original, não a complementar). */
  const olderConversationIdRef = useRef<string | null>(null)
  // UM avatar (um Canvas): renderizado por portal num nó estável, movido entre o painel e a sessão — nunca remontado.
  const [avatarHost] = useState(() => (typeof document === "undefined" ? null : new AvatarHostManager()))
  // Convite proativo (um por vez): só no Acompanhamento do PRÓPRIO colaborador, nunca durante uma conversa em andamento.
  const inviteQuery = useFeedbackInviteQuery(feedbackEnabled)
  // Cenário de agora (Administrador geral configura; a imagem segue o horário e troca sozinha com a tela aberta): atrás dela
  // no palco e no painel; sem cenário, o fundo de sempre.
  const scene = useCurrentIniaScene()

  // Derived, not its own state: the mic can close either from a click or
  // from the transport's own silence detection, and both paths already
  // report through `onStateChange` — a separately-tracked `micOpen` state
  // only updated by the click handler used to go stale when silence closed
  // it instead, leaving the button showing "recording" forever.
  const micOpen = conversationState === "listening"
  // Enquanto a INIA FALA, o microfone vira "Interromper e falar" (barge-in: ela se cala na hora, o
  // que ainda chegar da resposta antiga é descartado e o microfone abre). Enquanto ela PENSA, não:
  // um activityStart cairia no meio da geração sem nada audível para interromper. Na despedida
  // também não — a sessão de voz já foi encerrada. Os dois botões de microfone usam o mesmo
  // transporte, então a regra vale para ambos.
  const canBargeIn = conversationState === "speaking" && !farewellActive
  // Conversa encerrada aberta para consulta é somente leitura: sem voz e sem texto até voltar à atual (ou abrir uma nova).
  // Feedback CONCLUÍDO não é somente leitura: as dúvidas vão para a conversa complementar (o registro original continua encerrado).
  const composerLocked = readOnlyConversation !== null || loadState !== "ready"
  const micLabel = micOpen ? "Fechar microfone e enviar" : canBargeIn || presentationPhase === "playing" ? "Interromper e falar" : "Falar com a INIA"
  const waveformBarRefs = useRef<(HTMLSpanElement | null)[]>([])
  // Pulso dos dois botões de microfone (0 = sobre o avatar, 1 = composer) e o brilho do composer:
  // pintados direto no DOM a ~19 Hz, como a waveform — o chat inteiro não re-renderiza por nível.
  const micPulseRefs = useRef<(HTMLSpanElement | null)[]>([])
  const composerRef = useRef<HTMLDivElement>(null)
  const conversationStateRef = useRef<AvatarConversationState>("idle")
  const farewellRef = useRef<{ utterance: SpeechSynthesisUtterance; speech: FarewellSpeech | null } | null>(null)
  const waveformHistoryRef = useRef<number[]>(Array<number>(WAVEFORM_BAR_COUNT).fill(0))
  const transportRef = useRef<GeminiRealtimeTransport | null>(null)
  const pendingUserTranscriptRef = useRef("")
  const pendingAssistantTranscriptRef = useRef("")
  // Verdadeiro quando um especialista já respondeu neste turno de voz: o balão dele é a resposta
  // completa e fiel, então a transcrição da fala (a mesma resposta em voz) não vira segundo balão.
  const specialistAnsweredThisTurnRef = useRef(false)
  const userTranscriptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // A bolha do usuário é consolidada 400 ms depois de o microfone fechar, bem antes da resposta
  // terminar: guarda a pergunta para o `recordVoiceTurn` do turno (senão o banco só recebia a resposta).
  const lastUserTurnTextRef = useRef("")
  /** Escolha feita no formulário do esclarecimento com a voz aberta: vai, estruturada, na próxima consulta da voz DESTE turno (o
   * backend a aplica exatamente como no chat de texto). Turno encerrado sem consulta = segue pelo caminho de texto (nunca se perde). */
  const voiceClarificationRef = useRef<{ answer: ClarificationAnswer; turnId: string; text: string; bubbleId: number } | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // Turno de voz: chave idempotente das mensagens do turno, instante em que a fala do usuário terminou e as bolhas
  // locais do turno (marcadas se o salvamento falhar).
  const turnIdRef = useRef(newTurnId())
  const userSpokenAtRef = useRef<string | null>(null)
  const turnMessageIdsRef = useRef<number[]>([])

  // ---------------------------------------------------------------------------------------------
  // Conversas persistidas
  // ---------------------------------------------------------------------------------------------

  /** Última atividade da conversa exibida (regra de inatividade vista pelo cliente). Sempre chamada fora do render. */
  const markConversationActivity = () => {
    lastActivityRef.current = Date.now()
  }

  const adoptConversation = (id: string) => {
    conversationIdRef.current = id
    setConversationId(id)
    markConversationActivity()
  }

  /** Área que rola as mensagens: a do painel/sessão (ScrollArea) ou, no mobile, a rolagem única da sessão. */
  const viewportElement = (): HTMLElement | null => {
    return messagesContentRef.current?.closest<HTMLElement>('[data-slot="scroll-area-viewport"], [data-chat-scroll]') ?? null
  }

  const scrollToLatest = () => {
    requestAnimationFrame(() => {
      const viewport = viewportElement()
      if (viewport) viewport.scrollTop = viewport.scrollHeight
    })
  }

  /** Carrega a página mais recente de uma conversa na tela (descartada se outra troca aconteceu nesse meio-tempo). */
  const showConversation = async (id: string, generation: number) => {
    const page = await fetchConversationMessages(id, { limit: PAGE_LIMIT })
    if (generation !== viewGenerationRef.current) return false
    setMessages(page.messages.map(toChatMessage))
    setOlderCursor(page.hasMore ? (page.messages[0]?.cursor ?? null) : null)
    setOlderError(false)
    lastActivityRef.current = new Date(page.conversation.lastActivityAt).getTime()
    scrollToLatest()
    return true
  }

  /** Abrir o chat / recarregar / voltar à conversa atual: a conversa ATIVA do backend, ou um chat limpo. */
  const loadCurrentConversation = async () => {
    const generation = advanceView()
    clearFeedbackView()
    olderConversationIdRef.current = null
    setLoadState("loading")
    setReadOnlyConversation(null)
    workflowConversationRef.current = null
    setWorkflowConversation(null)
    try {
      const current = await fetchCurrentConversation()
      if (generation !== viewGenerationRef.current) return
      inactivityMsRef.current = current.inactivityHours * 3_600_000
      if (current.conversation) {
        conversationIdRef.current = current.conversation.id
        setConversationId(current.conversation.id)
        await showConversation(current.conversation.id, generation)
      } else {
        conversationIdRef.current = null
        setConversationId(null)
        setMessages([])
        setOlderCursor(null)
        lastActivityRef.current = null
      }
      if (generation === viewGenerationRef.current) setLoadState("ready")
    } catch {
      // Falha ao carregar ≠ conversa vazia: estado de erro com nova tentativa.
      if (generation === viewGenerationRef.current) setLoadState("error")
    }
  }

  /** A sessão de voz carrega o diálogo dela: trocar de conversa sempre fecha a sessão (sem despedida — o avatar continua). */
  // -------------------------------------------------------------------------------------------
  // Fala no PALCO: o balão sobre a cabeça dela e o pouso na conversa. Chamado também pelos eventos da sessão de voz (criados uma
  // vez), então só lê refs e setters.
  // -------------------------------------------------------------------------------------------

  const stageOpen = () => feedbackEnabled && feedbackModeRef.current

  const closeVoiceSessionForSwitch = () => {
    presentationRef.current?.stop()
    const transport = transportRef.current
    transport?.interruptResponse()
    transport?.disconnect()
    setSessionConnected(false)
    setLiveAssistantText(null)
    pendingAssistantTranscriptRef.current = ""
    pendingUserTranscriptRef.current = ""
    lastUserTurnTextRef.current = ""
    specialistAnsweredThisTurnRef.current = false
    presentationTurnRef.current = false
    clearStage()
    if (userTranscriptTimerRef.current) { clearTimeout(userTranscriptTimerRef.current); userTranscriptTimerRef.current = null }
    turnIdRef.current = newTurnId()
    turnMessageIdsRef.current = []
    userSpokenAtRef.current = null
    resetWaveform()
    paintMicLevel(0)
    applyConversationState("idle")
  }

  /** Chat limpo (conversa nova ainda não criada). Resposta pendente da conversa anterior é descartada da tela. */
  const resetToFreshConversation = () => {
    advanceView()
    clearFeedbackView()
    setFeedbackReturn(null)
    conversationIdRef.current = null
    setConversationId(null)
    setReadOnlyConversation(null)
    workflowConversationRef.current = null
    setWorkflowConversation(null)
    setMessages([])
    setOlderCursor(null)
    setOlderError(false)
    setTextReplyPending(false)
    setLiveTextReply(null)
    lastActivityRef.current = null
    setLoadState("ready")
  }

  const newConversation = async () => {
    setConversationNotice("")
    setStartingNew(true)
    try {
      // Encerra no backend a conversa atual (se existir). Nada é criado até a próxima mensagem.
      if (conversationIdRef.current || readOnlyConversation) await startNewConversation()
    } catch {
      setConversationNotice("Não foi possível iniciar uma nova conversa. Tente de novo.")
      setStartingNew(false)
      return
    }
    closeVoiceSessionForSwitch()
    resetToFreshConversation()
    setStartingNew(false)
    textareaRef.current?.focus()
  }

  const openPastConversation = async (summary: ConversationSummary) => {
    setHistoryOpen(false)
    setConversationNotice("")
    // Conversa de uma aplicação de feedback: abre a APLICAÇÃO (retomar ou consultar), nunca como conversa solta.
    if (summary.origin === "FEEDBACK") {
      await openFeedbackConversationFromHistory(summary)
      return
    }
    setFeedbackReturn(null)
    if (summary.status === "ACTIVE" && summary.origin === "WORKFLOW") {
      if (summary.id === conversationIdRef.current) return
      await openWorkflowConversation(summary.id)
      return
    }
    if (summary.status === "ACTIVE") {
      if (summary.id === conversationIdRef.current && !readOnlyConversation && !workflowConversationRef.current) return
      closeVoiceSessionForSwitch()
      await loadCurrentConversation()
      return
    }
    closeVoiceSessionForSwitch()
    const generation = advanceView()
    clearFeedbackView()
    setReadOnlyConversation(summary)
    setTextReplyPending(false)
    setLiveTextReply(null)
    setLoadState("loading")
    setMessages([])
    try {
      if (await showConversation(summary.id, generation)) setLoadState("ready")
    } catch {
      if (generation === viewGenerationRef.current) setLoadState("error")
    }
  }

  /**
   * Abre uma conversa criada por um Workflow (Output → Chat) como a conversa em exibição — respondível, sem mexer na
   * conversa atual do usuário. Primeira abertura = deixa de ser "nova" (e o aviso do sino fica lido).
   */
  const openWorkflowConversation = async (id: string) => {
    setHistoryOpen(false)
    setConversationNotice("")
    closeVoiceSessionForSwitch()
    const generation = advanceView()
    clearFeedbackView()
    setFeedbackReturn(null)
    setReadOnlyConversation(null)
    setTextReplyPending(false)
    setLiveTextReply(null)
    setLoadState("loading")
    setMessages([])
    conversationIdRef.current = id
    setConversationId(id)
    workflowConversationRef.current = id
    setWorkflowConversation({ id, title: inbox?.unreadConversations.find((conversation) => conversation.id === id)?.title ?? "Recado da INIA" })
    try {
      const page = await fetchConversationMessages(id, { limit: PAGE_LIMIT })
      if (generation !== viewGenerationRef.current) return
      if (page.conversation.origin !== "WORKFLOW") {
        // Não é um recado de fluxo (link antigo/errado): volta ao comportamento de sempre.
        workflowConversationRef.current = null
        setWorkflowConversation(null)
        await loadCurrentConversation()
        return
      }
      setWorkflowConversation({ id, title: page.conversation.title ?? "Recado da INIA" })
      setMessages(page.messages.map(toChatMessage))
      setOlderCursor(page.hasMore ? (page.messages[0]?.cursor ?? null) : null)
      setOlderError(false)
      lastActivityRef.current = new Date(page.conversation.lastActivityAt).getTime()
      setLoadState("ready")
      scrollToLatest()
      if (page.conversation.unread) void markWorkflowConversationSeen(id).then(() => queryClient.invalidateQueries({ queryKey: iniaInboxKey })).catch(() => {})
    } catch {
      if (generation === viewGenerationRef.current) setLoadState("error")
    }
  }

  /**
   * Fala PRONTA (recado ou apresentação de feedback) com a voz do Gemini, pelo MESMO pipeline de reprodução + lip-sync do Live.
   * O AudioContext é liberado aqui (chame dentro do clique quando possível); se o áudio já foi preparado a fala começa na hora,
   * senão assim que ele chegar. Sem voz do Gemini, a voz do sistema assume. Cada fala termina UMA vez (concluída, falhou ou
   * interrompida) — parar depois disso não gera outro evento.
   */
  const startPreparedVoice = (speech: { cacheKey: readonly unknown[]; text: string; fetchAudio: () => Promise<RecadoAudio> }, handlers: RecadoHandlers): RecadoPlayback => {
    let primed = true
    try {
      voice.playback.prime()
    } catch {
      primed = false
    }
    let inner: RecadoPlayback | null = null
    let cancelled = false
    let finished = false
    const guarded: RecadoHandlers = {
      onStarted: () => { if (!finished) handlers.onStarted() },
      onCompleted: () => { if (finished) return; finished = true; handlers.onCompleted() },
      onFailed: (reason) => { if (finished) return; finished = true; handlers.onFailed(reason) },
      onInterrupted: () => { if (finished) return; finished = true; handlers.onInterrupted() },
    }
    const fallback = () => { if (!cancelled) inner = speakRecado(speech.text, voice.driver, guarded) }
    const play = (audio: RecadoAudio) => { if (!cancelled) inner = playRecadoAudio({ playback: voice.playback, lipsync: voice.lipsync }, speech.text, audio, guarded) }
    const cached = queryClient.getQueryData<RecadoAudio>(speech.cacheKey)
    if (!primed) fallback()
    else if (cached) play(cached)
    else void queryClient.fetchQuery({ queryKey: speech.cacheKey, queryFn: speech.fetchAudio, staleTime: Infinity }).then(play, fallback)
    return {
      stop() {
        if (finished) return
        if (inner) return inner.stop()
        cancelled = true
        guarded.onInterrupted()
      },
    }
  }

  // -------------------------------------------------------------------------------------------
  // Aplicação de feedback no painel: abrir (feed, convite, histórico), apresentar, sair por agora, concluir, mudar de assunto.
  // -------------------------------------------------------------------------------------------

  const setFeedbackSessionState = (next: FeedbackSession | null) => {
    feedbackSessionRef.current = next
    setFeedbackSession(next)
  }

  /** Sai do modo feedback NA TELA (a aplicação continua exatamente como está no backend). */
  const clearFeedbackView = () => {
    presentationRef.current?.stop()
    clearStage()
    setStageGreeting(true)
    setFeedbackSessionState(null)
    setFeedbackOpening(null)
    setFeedbackError(null)
    setPresentationPhase("idle")
    setResumeMarkerId(null)
    resumeScrollToRef.current = null
    olderConversationIdRef.current = null
    workspace?.setActiveSourceKey(null)
  }

  const refreshFeedbackQueries = () => {
    void queryClient.invalidateQueries({ queryKey: feedbackApplicationsKey })
    void queryClient.invalidateQueries({ queryKey: feedbackInviteKey })
  }

  /**
   * Pedido do feed/convite/histórico — SÍNCRONO dentro do clique: encerra a sessão de voz da conversa anterior (ela fecha a
   * reprodução) e libera o áudio de novo no próprio gesto, para a apresentação começar quando estiver pronta, sem segundo clique.
   * Clique repetido na mesma aplicação (aberta ou abrindo) não faz nada: é a MESMA aplicação.
   */
  const handleFeedbackRequest = (request: FeedbackOpenRequest) => {
    const key = feedbackSourceKey(request.source)
    const current = feedbackSessionRef.current
    if (openingKeyRef.current === key || (current && feedbackSourceKey(current.application.source) === key)) return
    presentationRef.current?.stop()
    recadoPlaybackRef.current?.stop()
    closeVoiceSessionForSwitch()
    if (request.mode === "listen") {
      unmuteToListen()
      voice.playback.prime()
    }
    setFeedbackReturn(null)
    void openFeedbackApplication(request)
  }

  const openFeedbackApplication = async (request: FeedbackOpenRequest) => {
    const key = feedbackSourceKey(request.source)
    openingKeyRef.current = key
    sessionKeyRef.current = key
    const generation = advanceView()
    clearFeedbackView()
    workspace?.setActiveSourceKey(key)
    setConversationNotice("")
    setReadOnlyConversation(null)
    workflowConversationRef.current = null
    setWorkflowConversation(null)
    setTextReplyPending(false)
    setLiveTextReply(null)
    // Rascunho de outra conversa nunca vai parar na conversa do feedback.
    setQuestion("")
    setFeedbackOpening({ title: request.title, periodLabel: request.periodLabel, entry: ENTRY_OF_MODE[request.mode] })
    // A INIA chega e aponta para o feedback (gesto pedido pela tela; não fala sozinha por isso).
    window.setTimeout(() => voice.driver.pushCue({ type: "gesture", id: "explainLeft" }), PRESENT_GESTURE_DELAY_MS)
    setLoadState("loading")
    setMessages([])
    setOlderCursor(null)
    try {
      // O backend resolve e autoriza a fonte e devolve SEMPRE a mesma aplicação (iniciada agora, em andamento ou concluída).
      const { application, created } = await startOrResumeFeedbackApplication(request.source)
      if (generation !== viewGenerationRef.current) return
      const completed = application.status === "COMPLETED"
      // Concluída: o registro original (encerrado) + a conversa complementar, se já existir. Abrir não cria conversa nenhuma.
      const [original, followUp] = await Promise.all([
        fetchConversationMessages(application.conversationId!, { limit: completed ? 100 : PAGE_LIMIT }),
        completed && application.followUpConversationId ? fetchConversationMessages(application.followUpConversationId, { limit: 100 }) : Promise.resolve(null),
      ])
      if (generation !== viewGenerationRef.current) return
      const loaded = [...original.messages.map(toChatMessage), ...(followUp?.messages.map((message) => asFollowUp(toChatMessage(message))) ?? [])]
      // Onde a próxima mensagem é gravada: em andamento, a conversa da aplicação; concluída, a complementar (null = nasce na 1ª dúvida).
      const writeTo = completed ? application.followUpConversationId : application.conversationId
      conversationIdRef.current = writeTo
      setConversationId(writeTo)
      olderConversationIdRef.current = application.conversationId
      setMessages(loaded)
      setOlderCursor(original.hasMore ? (original.messages[0]?.cursor ?? null) : null)
      setOlderError(false)
      lastActivityRef.current = new Date((followUp ?? original).conversation.lastActivityAt).getTime()
      setFeedbackSessionState({ application, completed, entry: completed ? "review" : created ? "first" : "resume" })
      setFeedbackOpening(null)
      setLoadState("ready")
      // Retomada: marca onde parou — a apresentação NÃO toca de novo sozinha (há um controle explícito para isso).
      if (!created && !completed) {
        setResumeMarkerId(loaded.at(-1)?.id ?? null)
        // Já houve conversa: a sessão abre na ÚLTIMA troca (a última pergunta da pessoa no topo da rolagem, logo abaixo do
        // cabeçalho do feedback), não no começo do feedback. Só a apresentação, sem pergunta: abre no topo, como sempre.
        resumeScrollToRef.current = [...loaded].reverse().find((message) => message.sender === "user")?.id ?? null
      }
      refreshFeedbackQueries()
      if (!completed) void markFeedbackApplicationOpened(application.id).catch(() => undefined)
      // A sessão abre no topo: o feedback primeiro, a conversa logo abaixo (mensagens novas levam ao fim da conversa).
      // Só a PRIMEIRA aplicação ("Ouvir com a INIA") apresenta sozinha; retomar e consultar nunca reproduzem desde o início.
      if (created && request.mode === "listen" && !completed) presentFeedback(application, { landOn: presentationMessageOf(loaded), hide: true })
    } catch (error) {
      if (generation !== viewGenerationRef.current) return
      setFeedbackOpening(null)
      // Sem o contexto do feedback a INIA não abre uma conversa genérica fingindo conhecê-lo: o problema é dito e há nova tentativa.
      setFeedbackError({ request, message: error instanceof ApiError && error.status === 404 ? "Este feedback não está disponível para você." : "Não foi possível abrir este feedback agora. Nada foi alterado — tente de novo." })
      setLoadState("error")
    } finally {
      if (openingKeyRef.current === key) openingKeyRef.current = null
    }
  }

  /**
   * A tela ficou desatualizada (a aplicação foi concluída em outra aba, ou a conversa mudou): recarrega a MESMA aplicação no
   * estado real, sem reproduzir nada, e devolve o texto não enviado ao campo.
   */
  const reloadFeedbackSession = (notice: string, draft?: string) => {
    const session = feedbackSessionRef.current
    if (!session) return
    closeVoiceSessionForSwitch()
    const { application } = session
    void openFeedbackApplication({ id: -1, source: application.source, mode: "view", title: application.title ?? "Feedback", periodLabel: application.periodLabel, origin: "history" }).then(() => {
      setConversationNotice(notice)
      if (draft) setQuestion(draft)
    })
  }

  /** Cancelar enquanto o feedback abre: volta à conversa atual (o que chegar depois é descartado pela geração). */
  const cancelFeedbackOpening = () => {
    openingKeyRef.current = null
    clearFeedbackView()
    void loadCurrentConversation()
  }

  /**
   * Apresentação AO VIVO: a mesma sessão de voz da conversa (a instrução da aplicação vem do backend com o texto aprovado da
   * apresentação) recebe o sinal da tela e a INIA começa a falar em ~2 s — sem esperar a voz preparada, que leva ~50 s para ser
   * gerada. A sessão continua conectada depois: o colaborador toca no microfone e a resposta é imediata. Se a fala ao vivo não
   * começar (sessão indisponível, rede, demora), a apresentação segue pela voz preparada. Nunca muda o estado da aplicação.
   * `historyConversationId` = a conversa recapitulada pelo backend quando a sessão ainda não existe (nenhuma na abertura: o que está
   * na tela é de outra conversa).
   * No palco, a fala aparece no balão e POUSA na mensagem da apresentação (`landOn`); na primeira vez ela fica fora da conversa
   * até o pouso (`hide`), como se o balão virasse a mensagem.
   */
  const presentFeedback = (application: FeedbackApplicationDetail, options: { landOn: number | null; hide?: boolean; historyConversationId?: string | null }) => {
    if (!application.script || feedbackSessionRef.current?.completed) return
    presentationRef.current?.stop()
    presentationLandRef.current = options.landOn
    if (options.hide && options.landOn !== null) hideOnStage(options.landOn)
    if (voiceMutedRef.current) {
      presentAsText(application.script.speechText, options.landOn)
      return
    }
    try {
      voice.playback.prime()
    } catch {
      // Sem áudio liberado a voz ao vivo não soaria: a voz preparada decide (ela cai na voz do sistema).
      playPresentation(application)
      return
    }
    if (!callActive) setCallActive(true)
    if (!cameraOn) setCameraOn(true)
    setPresentationVoice("live")
    setPresentationPhase("preparing")
    const report = (event: Parameters<typeof postFeedbackPresentationEvent>[1]) => void postFeedbackPresentationEvent(application.id, event).catch(() => undefined)
    const transport = ensureTransport()
    let stage: "connecting" | "waiting" | "playing" | "done" = "connecting"
    const handle: RecadoPlayback = {
      stop() {
        if (stage === "done") return
        finish("INTERRUPTED")
        transport.interruptResponse()
      },
    }
    const hooks: LivePresentationHooks = {
      speaking: () => {
        if (stage !== "waiting") return
        stage = "playing"
        window.clearTimeout(timer)
        setPresentationPhase("playing")
        report("STARTED")
      },
      // "idle" só chega quando o áudio TERMINOU de soar (ver RealtimeTransportEvents.onStateChange).
      idle: () => { if (stage === "playing") finish("COMPLETED") },
      interrupted: () => { if (stage === "waiting" || stage === "playing") finish("INTERRUPTED") },
      dropped: () => {
        if (stage === "playing") finish("FAILED")
        else if (stage === "connecting" || stage === "waiting") switchToPreparedVoice()
      },
    }
    function release() {
      window.clearTimeout(timer)
      if (livePresentationRef.current === hooks) livePresentationRef.current = null
      if (presentationRef.current === handle) presentationRef.current = null
    }
    function finish(outcome: "COMPLETED" | "FAILED" | "INTERRUPTED") {
      if (stage === "done") return
      const started = stage === "playing"
      stage = "done"
      release()
      // Cortada antes de soar: a apresentação volta à conversa na hora (com fala, ela pousa quando a fala termina).
      if (!started && options.landOn !== null) revealOnStage(options.landOn)
      setPresentationPhase(outcome === "COMPLETED" ? "done" : outcome === "FAILED" ? "failed" : "idle")
      if (outcome !== "INTERRUPTED" || started) report(outcome)
    }
    function switchToPreparedVoice() {
      if (stage === "done") return
      stage = "done"
      release()
      // Cala o que ainda chegar da tentativa ao vivo (a geração cortada é descartada até o fechamento dela).
      transport.interruptResponse()
      playPresentation(application)
    }
    const timer = window.setTimeout(() => { if (stage === "connecting" || stage === "waiting") switchToPreparedVoice() }, LIVE_PRESENTATION_START_TIMEOUT_MS)
    livePresentationRef.current = hooks
    presentationRef.current = handle
    // Resposta de voz em andamento dá lugar à apresentação (a pessoa escolheu ouvir).
    transport.interruptResponse()
    void transport.connect({ conversationId: options.historyConversationId ?? null }).then(
      () => {
        if (stage !== "connecting") return
        stage = "waiting"
        presentationTurnRef.current = true
        transport.sendText(FEEDBACK_PRESENTATION_CUE)
      },
      () => { if (stage === "connecting") switchToPreparedVoice() },
    )
  }

  /**
   * INIA no MUDO: a apresentação aparece no balão em ritmo de leitura, sem voz e sem ela mexer a boca, e pousa na conversa como a
   * falada. Sem áudio, nada é registrado como reprodução (os eventos de apresentação são do áudio).
   */
  const presentAsText = (text: string, landOn: number | null) => {
    if (!callActive) setCallActive(true)
    if (!cameraOn) setCameraOn(true)
    transportRef.current?.interruptResponse()
    const words = wordsIn(text)
    const clock = createReadingClock(() => words)
    const key = beginStageUtterance(text, landOn, { heard: clock.heard })
    setPresentationVoice("live")
    setPresentationPhase("playing")
    let done = false
    const settle = (phase: PresentationPhase) => {
      if (done) return
      done = true
      window.clearTimeout(timer)
      if (presentationRef.current === handle) presentationRef.current = null
      endStageUtterance(undefined, key)
      if (landOn !== null && stageUtteranceRef.current?.key !== key) revealOnStage(landOn)
      setPresentationPhase(phase)
    }
    const handle: RecadoPlayback = { stop: () => settle("idle") }
    const timer = window.setTimeout(() => settle("done"), words * READ_WORD_MS + READ_HOLD_MS)
    presentationRef.current = handle
  }

  /** Apresentação com a voz verificada (gerada uma vez no backend; sem ela, a voz do sistema). Nunca muda o estado da aplicação. */
  const playPresentation = (application: FeedbackApplicationDetail) => {
    const script = application.script
    if (!script || feedbackSessionRef.current?.completed) return
    presentationRef.current?.stop()
    // Resposta de voz em andamento dá lugar à apresentação (a pessoa escolheu ouvir).
    transportRef.current?.interruptResponse()
    if (!callActive) setCallActive(true)
    if (!cameraOn) setCameraOn(true)
    setPresentationVoice("prepared")
    setPresentationPhase("preparing")
    let started = false
    const report = (event: Parameters<typeof postFeedbackPresentationEvent>[1]) => void postFeedbackPresentationEvent(application.id, event).catch(() => undefined)
    const landOn = presentationLandRef.current
    // Sem fala, a apresentação (se estava no balão) volta à conversa; com fala, ela pousa no fim.
    const settle = () => {
      if (started) endStageUtterance()
      else if (landOn !== null) revealOnStage(landOn)
    }
    presentationRef.current = startPreparedVoice({ cacheKey: presentationAudioKey(application.id), text: script.speechText, fetchAudio: () => fetchFeedbackPresentationAudio(application.id) }, {
      onStarted: () => {
        started = true
        if (stageOpen()) beginStageUtterance(script.speechText, landOn)
        applyConversationState("speaking")
        setPresentationPhase("playing")
        report("STARTED")
      },
      onCompleted: () => {
        presentationRef.current = null
        settle()
        applyConversationState("idle")
        setPresentationPhase("done")
        report("COMPLETED")
      },
      onFailed: (reason) => {
        presentationRef.current = null
        settle()
        applyConversationState("idle")
        setPresentationPhase(reason === "AUDIO_BLOCKED" ? "blocked" : "failed")
        report("FAILED")
      },
      onInterrupted: () => {
        presentationRef.current = null
        settle()
        applyConversationState("idle")
        setPresentationPhase("idle")
        if (started) report("INTERRUPTED")
      },
    })
  }

  /** Controle explícito (dentro do clique): ouvir, repetir ou tentar de novo a apresentação. */
  const replayPresentation = () => {
    const session = feedbackSessionRef.current
    if (!session || session.completed) return
    unmuteToListen()
    voice.playback.prime()
    presentFeedback(session.application, { landOn: presentationMessageOf(messages), historyConversationId: sessionConnected ? null : conversationIdRef.current })
  }

  /**
   * Fechar a sessão (X, Esc, "Sair por agora"): interrompe áudio, captura e conexão; a aplicação continua EM ANDAMENTO (retomável
   * por "Continuar feedback"). Concluída: só fecha (a conversa complementar continua disponível). Nunca conclui, nunca confirma
   * ciência. O painel volta à conversa atual.
   */
  const exitFeedbackForNow = () => {
    const session = feedbackSessionRef.current
    openingKeyRef.current = null
    presentationRef.current?.stop()
    closeVoiceSessionForSwitch()
    if (session && !session.completed) void pauseFeedbackApplication(session.application.id).catch(() => undefined).then(refreshFeedbackQueries)
    clearFeedbackView()
    setFeedbackReturn(null)
    void loadCurrentConversation()
  }

  /**
   * "Confirmar ciência" dentro da sessão — o MESMO controle do Acompanhamento (login e senha da própria conta). Antes de enviar as
   * credenciais, a fala e a voz param (a conversa da aplicação vai ser encerrada). Confirmada, a aplicação fica concluída: dúvidas
   * seguintes vão para a conversa complementar. Não encerra caso.
   */
  const prepareFeedbackConfirmation = () => {
    presentationRef.current?.stop()
    closeVoiceSessionForSwitch()
  }

  const handleFeedbackConfirmed = (result: ReadConfirmationResult) => {
    const session = feedbackSessionRef.current
    const view = result.application
    if (!session || !view || session.application.id !== view.id) {
      refreshFeedbackQueries()
      return
    }
    const completed = view.status === "COMPLETED"
    setFeedbackSessionState({ application: { ...session.application, ...view }, completed, entry: completed ? "review" : session.entry })
    if (completed) {
      // A conversa da aplicação fechou: a próxima dúvida nasce na conversa complementar (o backend a cria).
      conversationIdRef.current = view.followUpConversationId
      setConversationId(view.followUpConversationId)
      setResumeMarkerId(null)
      setConversationNotice("Ciência confirmada. Se surgir uma dúvida, pode perguntar aqui — ela fica registrada à parte e não muda a confirmação.")
      scrollToLatest()
    }
    refreshFeedbackQueries()
  }

  /**
   * Mudar de assunto: resultados ATUAIS acontecem na conversa geral (no painel), com origem e período identificados — nunca
   * misturados à explicação do feedback antigo. O feedback e a sua conversa ficam como estão (em andamento continua retomável).
   */
  const switchToGeneralConversation = (reason: FeedbackReturn["reason"]) => {
    const session = feedbackSessionRef.current
    if (!session) return
    presentationRef.current?.stop()
    closeVoiceSessionForSwitch()
    if (!session.completed) void pauseFeedbackApplication(session.application.id).catch(() => undefined).then(refreshFeedbackQueries)
    const heading = session.application.content?.view?.heading
    const back: FeedbackReturn = { source: session.application.source, title: heading?.title ?? session.application.title ?? "este feedback", periodLabel: heading?.subtitle ?? session.application.periodLabel, reason }
    clearFeedbackView()
    workspace?.revealChat()
    void loadCurrentConversation().then(() => {
      setFeedbackReturn(back)
      setQuestion("Como estão meus resultados atuais?")
      textareaRef.current?.focus({ preventScroll: true })
    })
  }

  /** Reabrir pelo próprio painel (histórico, "Voltar ao feedback"): o mesmo caminho do feed — destaca o painel e o item. */
  const reopenFeedback = (input: Omit<FeedbackOpenRequest, "id">) => {
    if (workspace) workspace.openFeedback(input)
    else handleFeedbackRequest({ ...input, id: -1 })
  }

  /** Abre pelo histórico de conversas a aplicação dona de uma conversa de feedback (retomar ou consultar — nunca reaplicar). */
  const openFeedbackConversationFromHistory = async (summary: ConversationSummary) => {
    try {
      const applications = await queryClient.fetchQuery({ queryKey: feedbackApplicationsKey, queryFn: fetchFeedbackApplications, staleTime: 0 })
      const application = applications.find((item) => item.conversationId === summary.id || item.followUpConversationId === summary.id)
      if (!application) throw new Error("not found")
      reopenFeedback({ source: application.source, mode: application.status === "COMPLETED" ? "view" : "continue", title: application.title ?? "Feedback", periodLabel: application.periodLabel, origin: "history" })
    } catch {
      setConversationNotice("Não foi possível abrir este feedback agora. Tente de novo.")
    }
  }

  const loadOlderMessages = async () => {
    const id = olderConversationIdRef.current ?? readOnlyConversation?.id ?? conversationIdRef.current
    if (!id || !olderCursor) return
    const generation = viewGenerationRef.current
    setLoadingOlder(true)
    setOlderError(false)
    try {
      const page = await fetchConversationMessages(id, { before: olderCursor, limit: PAGE_LIMIT })
      if (generation !== viewGenerationRef.current) return
      const viewport = viewportElement()
      if (viewport) scrollAnchorRef.current = { height: viewport.scrollHeight, top: viewport.scrollTop }
      setMessages((current) => [...page.messages.map(toChatMessage), ...current])
      setOlderCursor(page.hasMore ? (page.messages[0]?.cursor ?? null) : null)
    } catch {
      if (generation === viewGenerationRef.current) setOlderError(true)
    } finally {
      if (generation === viewGenerationRef.current) setLoadingOlder(false)
    }
  }

  /** Regra de inatividade vista pelo cliente (o backend é a autoridade): conversa parada além da janela não recebe mais voz. */
  const currentConversationIsStale = () => {
    // Conversa de Workflow continua a do recado — nunca vira outra por inatividade. O mesmo para a de uma aplicação de feedback.
    if (workflowConversationRef.current || feedbackSessionRef.current) return false
    return conversationIdRef.current !== null && lastActivityRef.current !== null && Date.now() - lastActivityRef.current >= inactivityMsRef.current
  }

  /** Resultado de um turno de voz gravado: adota a conversa criada; conversa encerrada no meio → avisa e fecha a sessão. */
  const applyVoiceConversationResult = (result: VoiceConversationResult | null, generation: number, localIds: number[]) => {
    if (generation !== viewGenerationRef.current) return
    if (!result) {
      if (localIds.length > 0) setMessages((current) => current.map((message) => (localIds.includes(message.id) ? { ...message, saveState: "failed" } : message)))
      return
    }
    if (!conversationIdRef.current || result.created) adoptConversation(result.conversationId)
    else markConversationActivity()
    if (result.closed) {
      const session = feedbackSessionRef.current
      if (session) {
        // Aplicação concluída (outra aba): a resposta em processamento ficou na conversa da aplicação; a sessão recarrega no
        // estado real (concluída) e as próximas dúvidas vão para a conversa complementar.
        reloadFeedbackSession("Esta aplicação foi concluída em outra janela. Se tiver mais dúvidas, pode perguntar aqui.")
        return
      }
      setConversationNotice("Esta conversa foi encerrada em outra janela. A próxima mensagem começa na conversa atual.")
      closeVoiceSessionForSwitch()
      void loadCurrentConversation()
    }
  }

  // Fires exactly once per turn, from the "thinking" transition (mic just
  // closed) — not reset on every incoming transcript fragment the way an
  // earlier version worked. That per-fragment debounce meant an ordinary
  // mid-sentence pause longer than its own timeout (very easy to hit —
  // people pause to think) flushed a partial message early, then kept
  // accumulating the rest into a second one: one utterance, two bubbles.
  // A single one-shot timer started only when the turn truly ends can't
  // fire early like that, no matter how many pauses happened while still
  // listening — it only ever runs once the mic is actually closed, with a
  // short grace window for the last transcript fragments to land.
  const scheduleUserTranscriptFlush = () => {
    if (userTranscriptTimerRef.current) clearTimeout(userTranscriptTimerRef.current)
    userTranscriptTimerRef.current = setTimeout(() => {
      userTranscriptTimerRef.current = null
      flushUserTranscript()
    }, 400)
  }

  const flushUserTranscript = (): string => {
    if (userTranscriptTimerRef.current) { clearTimeout(userTranscriptTimerRef.current); userTranscriptTimerRef.current = null }
    const userText = pendingUserTranscriptRef.current.trim()
    pendingUserTranscriptRef.current = ""
    if (!userText) return ""
    lastUserTurnTextRef.current = lastUserTurnTextRef.current ? `${lastUserTurnTextRef.current} ${userText}` : userText
    const id = nextMessageId()
    turnMessageIdsRef.current.push(id)
    setMessages((current) => [...current, { id, sender: "user", text: userText, time: nowTime(), occurredAt: userSpokenAtRef.current ?? new Date().toISOString(), channel: "voice", ...currentSegment() }])
    return userText
  }

  // The assistant's reply is shown live as fragments stream in (see
  // `liveAssistantText`, updated straight from `onOutputTranscript`) so text
  // keeps pace with the audio instead of only appearing once the whole turn
  // finishes. This just commits that already-visible text to real history
  // and clears the transient state. Also flushes any user transcript still
  // pending as a safety net (e.g. a very short turn where turnComplete beats
  // the debounce).
  const flushAssistantTranscript = () => {
    if (presentationTurnRef.current) {
      // Turno da apresentação ao vivo: nada a gravar (o texto aprovado já é a 1ª mensagem; o sinal da tela não é fala de ninguém).
      presentationTurnRef.current = false
      pendingAssistantTranscriptRef.current = ""
      stageTranscriptRef.current = ""
      setLiveAssistantText(null)
      turnIdRef.current = newTurnId()
      return
    }
    stageTranscriptRef.current = ""
    flushUserTranscript()
    const userText = lastUserTurnTextRef.current
    lastUserTurnTextRef.current = ""
    const assistantText = pendingAssistantTranscriptRef.current.trim()
    pendingAssistantTranscriptRef.current = ""
    setLiveAssistantText(null)
    const specialistAnswered = specialistAnsweredThisTurnRef.current
    specialistAnsweredThisTurnRef.current = false
    // Turno terminou sem uma fala para a resposta do especialista pousar: ela aparece na conversa agora.
    const unlanded = takeSpecialistLanding()
    if (unlanded !== null) revealOnStage(unlanded)
    const turnId = turnIdRef.current
    const userSpokenAt = userSpokenAtRef.current ?? undefined
    // Escolha do formulário clicada com a voz aberta que nenhuma consulta da voz levou neste turno (o modelo não acionou a
    // ferramenta): segue pelo caminho de TEXTO, estruturada, e a resposta que chegar é LIDA em voz alta (`speak`) — com a voz ligada
    // ela fala toda resposta. A mensagem da pessoa é gravada por lá, com a escolha (não aqui, para não duplicar).
    const pendingChoice = voiceClarificationRef.current?.turnId === turnId ? voiceClarificationRef.current : null
    voiceClarificationRef.current = null
    const localIds = turnMessageIdsRef.current.filter((id) => id !== pendingChoice?.bubbleId)
    turnIdRef.current = newTurnId()
    turnMessageIdsRef.current = []
    userSpokenAtRef.current = null
    // Com especialista no turno, o balão e o registro da resposta já existem (o backend grava no /tool-call): só a
    // PERGUNTA falada vai para o backend. Sem especialista, pergunta + resposta falada.
    const replyText = assistantText && !specialistAnswered ? assistantText : undefined
    let replyBubbleId: number | null = null
    if (replyText) {
      const id = nextMessageId()
      replyBubbleId = id
      localIds.push(id)
      setMessages((current) => [...current, { id, sender: "assistant", text: replyText, time: nowTime(), occurredAt: new Date().toISOString(), channel: "voice", ...currentSegment() }])
      // No palco a resposta está no balão: a mensagem só aparece quando a fala pousa nela.
      if (stageOpen()) attachStageMessage(id)
    }
    const userChannel = typedVoiceTurnRef.current ? "chat" : "voice"
    typedVoiceTurnRef.current = false
    // Depois de fechar este turno (o que a INIA falou é gravado antes da resposta escrita), pela versão ATUAL do envio.
    if (pendingChoice) setTimeout(() => void sendForTextReplyRef.current?.(pendingChoice.text, { existingBubbleId: pendingChoice.bubbleId, clarification: pendingChoice.answer, speak: true }), 0)
    const recordedUserText = pendingChoice ? "" : userText
    if (!recordedUserText && !replyText) return
    const generation = viewGenerationRef.current
    // Turno sobre uma aplicação: o backend decide a conversa (a da aplicação ou a complementar) — nunca a conversa geral.
    void recordVoiceTurn({ conversationId: conversationIdRef.current, turnId, userText: recordedUserText || undefined, userChannel, userSpokenAt, assistantText: replyText, feedbackApplicationId: feedbackSessionRef.current?.application.id ?? null }).then((result) => {
      applyVoiceConversationResult(result, generation, localIds)
      // A resposta falada gravada: o curtir/descurtir do balão passa a ser gravado nela.
      const interactionId = result?.assistantInteractionId
      if (interactionId && replyBubbleId !== null) setMessages((current) => current.map((message) => (message.id === replyBubbleId ? { ...message, interactionId } : message)))
    })
  }

  /** Mensagem nova numa sessão de feedback concluída = dúvida da conversa complementar (separador próprio). */
  const currentSegment = (): Pick<ChatMessage, "segment"> => {
    return feedbackSessionRef.current?.completed ? { segment: "followup" } : {}
  }

  // Direct DOM writes, deliberately outside React — see VoiceWaveform's doc
  // comment for why.
  const resetWaveform = () => {
    waveformHistoryRef.current = Array<number>(WAVEFORM_BAR_COUNT).fill(0)
    for (const bar of waveformBarRefs.current) {
      if (bar) bar.style.height = "4px"
    }
  }

  // Mesmo princípio da waveform: o nível do microfone chega ~19×/s e, passando por estado, fazia o
  // chat inteiro re-renderizar nesse ritmo. O pulso dos botões e o brilho do composer são escritos
  // direto; o CSS (`transition`) suaviza.
  const paintMicLevel = (level: number) => {
    const normalized = normalizedMicLevel(level)
    for (const pulse of micPulseRefs.current) {
      if (!pulse) continue
      pulse.style.transform = `scale(${1.2 + normalized * 1.3})`
      pulse.style.opacity = String(0.25 + normalized * 0.55)
    }
    if (composerRef.current && conversationStateRef.current === "listening") composerRef.current.style.boxShadow = micGlow(normalized)
  }

  // Estado da conversa em dois lugares de propósito: no React (muda poucas vezes por turno — rótulo,
  // botões, bolha "pensando") e no driver, que o avatar lê a cada quadro.
  const applyConversationState = (state: AvatarConversationState) => {
    const previous = conversationStateRef.current
    conversationStateRef.current = state
    voice.driver.setState(state)
    setConversationState(state)
    // "Turno" para o avatar = a fala da INIA (gesto de abertura, assentar no fim).
    if (state === "speaking" && previous !== "speaking") voice.driver.pushCue({ type: "turn-started" })
    if (previous === "speaking" && state !== "speaking") voice.driver.pushCue({ type: "turn-ended" })
  }

  const ensureTransport = (): GeminiRealtimeTransport => {
    if (!transportRef.current) {
      transportRef.current = new GeminiRealtimeTransport({
        onConnectionChange: (connected) => {
          setSessionConnected(connected)
          if (!connected) livePresentationRef.current?.dropped()
          if (!connected) {
            // Queda com o microfone aberto: a fala parcial vira bolha agora, nunca o começo da
            // próxima conversa.
            flushUserTranscript()
            lastUserTurnTextRef.current = ""
          }
        },
        onStateChange: (state: RealtimeCallState) => {
          applyConversationState(state)
          // Palco: o áudio começou = a fala entra no balão; terminou de soar (ou ela foi interrompida) = pousa na conversa.
          if (stageOpen()) {
            const active = stageUtteranceRef.current && !stageUtteranceRef.current.ended
            if (state === "speaking" && !active) beginStageUtterance(stageTranscriptRef.current, presentationTurnRef.current ? presentationLandRef.current : takeSpecialistLanding())
            else if (state === "idle" || state === "listening") endStageUtterance()
            if (state === "listening") setStageGreeting(false)
          }
          const live = livePresentationRef.current
          if (live) {
            if (state === "speaking") live.speaking()
            else if (state === "idle") live.idle()
            // Microfone aberto por cima da apresentação = a pessoa interrompeu para falar.
            else if (state === "listening") live.interrupted()
          }
          if (state === "thinking") {
            // A fala do usuário terminou agora: é o instante que ordena a pergunta antes da resposta no histórico.
            if (!userSpokenAtRef.current) userSpokenAtRef.current = new Date().toISOString()
            scheduleUserTranscriptFlush()
          }
          if (state === "idle") {
            paintMicLevel(0)
            resetWaveform()
          }
        },
        onTurnComplete: flushAssistantTranscript,
        // Resposta cortada: o histórico (e o banco) registram só o que a INIA chegou a dizer.
        onResponseInterrupted: (heardText) => {
          // A fala cortada pousa só com o que soou.
          if (stageOpen()) endStageUtterance(heardText)
          livePresentationRef.current?.interrupted()
          if (presentationTurnRef.current || heardText === null) return
          pendingAssistantTranscriptRef.current = heardText
          if (!specialistAnsweredThisTurnRef.current) setLiveAssistantText(heardText || null)
        },
        onInputTranscript: (text) => { specialistAnsweredThisTurnRef.current = false; pendingUserTranscriptRef.current += text },
        onOutputTranscript: (text) => {
          // No palco a fala vai para o balão (no ritmo da voz), nunca para a legenda na conversa.
          const onStage = stageOpen()
          if (onStage) {
            stageTranscriptRef.current += text
            appendStageText(text)
          }
          // A apresentação já está escrita na conversa: a fala dela só move o avatar (sem legenda nem segunda mensagem).
          if (presentationTurnRef.current || onStage) {
            voice.driver.pushCue({ type: "assistant-text", text })
            if (presentationTurnRef.current) return
            pendingAssistantTranscriptRef.current += text
            return
          }
          pendingAssistantTranscriptRef.current += text
          // Com especialista no turno, o balão dele já é a resposta: a fala não ganha legenda paralela.
          if (!specialistAnsweredThisTurnRef.current) setLiveAssistantText((current) => (current ?? "") + text)
          // Dica para sorriso/gestos: cada fragmento como chegou (o avatar acumula; nunca por quadro).
          voice.driver.pushCue({ type: "assistant-text", text })
        },
        onAudioLevel: (level) => {
          paintMicLevel(level)
          voice.driver.pushCue({ type: "user-level", level: normalizedMicLevel(level) })
          const history = waveformHistoryRef.current
          history.shift()
          history.push(normalizedMicLevel(level))
          waveformBarRefs.current.forEach((bar, index) => {
            if (bar) bar.style.height = `${4 + history[index] * 26}px`
          })
        },
        // A resposta falada da INIA é só um resumo verbal disso — áudio não
        // "fala" uma tabela markdown — então esse é o único jeito de o
        // operador ver a resposta completa do especialista (tabelas,
        // listas) quando fala por voz, em vez de só ouvir o resumo.
        onSpecialistResult: (text, supportMaterials, conversation, analytics = [], extras = {}) => {
          flushUserTranscript()
          specialistAnsweredThisTurnRef.current = true
          // Algo falado antes da tool ("vou verificar…") some: a resposta é o balão do especialista.
          setLiveAssistantText(null)
          const id = nextMessageId()
          setMessages((current) => [...current, { id, sender: "assistant", text, time: nowTime(), occurredAt: new Date().toISOString(), channel: "voice", ...currentSegment(), ...(supportMaterials.length > 0 ? { supportMaterials } : {}), ...(analytics.length > 0 ? { analytics } : {}), ...(extras.reportOffer ? { reportOffer: extras.reportOffer } : {}), ...(extras.clarification ? { clarification: extras.clarification } : {}), ...(extras.interactionId ? { interactionId: extras.interactionId } : {}) }])
          if (extras.navigate) routerRef.current.push(extras.navigate.href)
          if (stageOpen()) landSpecialistOnStage(id)
          applyVoiceConversationResult(conversation, viewGenerationRef.current, [])
        },
        // A sessão de voz não é a conversa: cada tool-call diz em qual conversa (e turno) a resposta deve ser gravada — numa sessão de
        // feedback, também de qual aplicação (o backend decide a conversa e emoldura a consulta com o registro do feedback).
        getToolCallContext: () => {
          const pending = voiceClarificationRef.current
          voiceClarificationRef.current = null
          // As palavras da pessoa neste turno (digitadas ou faladas, inclusive o trecho ainda não fechado em balão).
          const utterance = `${lastUserTurnTextRef.current} ${pendingUserTranscriptRef.current}`.trim().slice(0, 4000)
          return { conversationId: conversationIdRef.current, turnId: turnIdRef.current, feedbackApplicationId: feedbackSessionRef.current?.application.id ?? null, ...(utterance ? { utterance } : {}), ...(pending && pending.turnId === turnIdRef.current ? { clarification: pending.answer } : {}) }
        },
        onError: (message) => setVoiceError(message),
      }, {
        playback: voice.playback,
        lipsync: voice.lipsync,
        // Sessão de voz de uma aplicação de feedback: o backend monta a instrução com o registro do feedback (em andamento: a
        // aplicação; concluída: dúvidas, com o MESMO registro) e entrega os especialistas do Orquestrador para o que o registro não
        // responde (processos, resultados atuais) — sem nova análise de chamada.
        fetchSession: (request = {}) => fetchEphemeralSession({ ...request, feedbackApplicationId: feedbackSessionRef.current?.application.id ?? null }),
      })
    }
    return transportRef.current
  }

  // Push-to-talk: the mic button opens/closes a turn, it never hangs up the
  // session. Closing the mic (`endTurn`) is what tells the model the user
  // is done talking — never inferred purely from a state change here, since
  // `endTurn` itself can be triggered either by this click or by the
  // transport's own silence detection. See GeminiRealtimeTransport's doc
  // comment. While INIA is speaking the same button interrupts her and opens
  // the mic in one go (barge-in).
  const toggleMic = async () => {
    const transport = ensureTransport()
    if (micOpen) {
      transport.endTurn()
      return
    }
    if (micDisabled || readOnlyConversation || loadState !== "ready") return
    setVoiceError("")
    // Conversa parada além da janela de inatividade: a voz começa uma conversa nova (sem o diálogo antigo no contexto).
    const startFresh = !sessionConnected && currentConversationIsStale()
    if (startFresh) resetToFreshConversation()
    if (canBargeIn) {
      await transport.bargeIn()
      return
    }
    if (!sessionConnected) {
      try {
        await transport.connect({ conversationId: startFresh ? null : conversationIdRef.current })
      } catch {
        return
      }
    }
    await transport.startTurn()
  }

  const handleMicClick = () => {
    // A apresentação do feedback tocando dá lugar à fala do colaborador (como interromper a INIA para falar).
    if (presentationRef.current) presentationRef.current.stop()
    // Must happen synchronously, inside the click itself — see
    // GeminiRealtimeTransport.primeAudioPlayback's doc comment.
    ensureTransport().primeAudioPlayback()
    if (!micConsentGranted) { setShowMicConsent(true); return }
    void toggleMic()
  }

  const confirmMicConsent = () => {
    ensureTransport().primeAudioPlayback()
    setMicConsentGranted(true)
    setShowMicConsent(false)
    void toggleMic()
  }

  // Text input is deliberately silent — typing a question gets a typed
  // answer, never voiced. Only the real-time mic path (GeminiRealtimeTransport)
  // talks back; this never touches conversationState/viseme, so it can't
  // fight whatever the avatar happens to be doing. A real Gemini call, not
  // the indicator-based mock this used to return — same INIA persona as
  // voice, with the operator's current top indicator folded in as light
  // context so the reply stays grounded in what's actually on screen.
  const send = async (override?: string) => {
    const text = (override ?? question).trim()
    if (!text || readOnlyConversation || loadState !== "ready") return
    setStageGreeting(false)
    // A apresentação em curso dá lugar à pergunta (como falar por cima dela).
    presentationRef.current?.stop()
    // Padrão: ela RESPONDE FALANDO, também ao que é digitado. No mudo (ou com o avatar encerrado), por escrito.
    if (callActive && !voiceMuted && sendTypedByVoice(text, override === undefined)) return
    await sendForTextReply(text, { fromComposer: override === undefined })
  }

  /**
   * Pergunta DIGITADA respondida por VOZ: vai para a mesma sessão de voz da conversa (a mesma instrução, inclusive a de uma
   * aplicação de feedback) como um turno de texto; a resposta é falada, aparece como a de uma pergunta falada (no palco, pelo
   * balão) e é gravada com a pergunta marcada como digitada. Síncrono até liberar o áudio (dentro do clique/Enter). Se a voz não
   * conectar, a mesma pergunta segue por escrito — a bolha dela já está na conversa, nada se perde.
   */
  const sendTypedByVoice = (text: string, fromComposer: boolean, clarification?: ClarificationAnswer): boolean => {
    let transport: GeminiRealtimeTransport
    try {
      transport = ensureTransport()
      transport.primeAudioPlayback()
    } catch {
      return false
    }
    setVoiceError("")
    setConversationNotice("")
    const startFresh = !sessionConnected && currentConversationIsStale()
    if (startFresh) resetToFreshConversation()
    // A conversa que a sessão continua (o backend recapitula o que está gravado nela); conversa parada = sessão sem histórico.
    const historyConversationId = startFresh ? null : conversationIdRef.current
    // Uma resposta ainda em curso é cortada AGORA (o turno dela é fechado antes de esta pergunta abrir o próximo).
    transport.interruptResponse()
    flushUserTranscript()
    const id = nextMessageId()
    setMessages((current) => [...current, { id, sender: "user", text, time: nowTime(), occurredAt: new Date().toISOString(), channel: "chat", ...currentSegment() }])
    if (fromComposer) setQuestion("")
    if (textareaRef.current) textareaRef.current.style.height = "auto"
    scrollToLatest()
    lastUserTurnTextRef.current = text
    typedVoiceTurnRef.current = true
    specialistAnsweredThisTurnRef.current = false
    userSpokenAtRef.current = new Date().toISOString()
    turnMessageIdsRef.current.push(id)
    // Escolha do formulário: vai na consulta que a voz fizer neste turno (ou, sem consulta, pelo texto no fim do turno).
    voiceClarificationRef.current = clarification ? { answer: clarification, turnId: turnIdRef.current, text, bubbleId: id } : null
    const generation = viewGenerationRef.current
    void transport.connect({ conversationId: historyConversationId }).then(
      () => {
        if (generation === viewGenerationRef.current) transport.sendText(text)
      },
      () => {
        if (generation !== viewGenerationRef.current) return
        lastUserTurnTextRef.current = ""
        typedVoiceTurnRef.current = false
        turnMessageIdsRef.current = turnMessageIdsRef.current.filter((item) => item !== id)
        const choice = voiceClarificationRef.current?.bubbleId === id ? voiceClarificationRef.current : null
        if (choice) voiceClarificationRef.current = null
        void sendForTextReply(text, { existingBubbleId: id, ...(choice ? { clarification: choice.answer } : {}) })
      },
    )
    return true
  }

  /**
   * Escolha (ou correção) de uma etapa do esclarecimento pelas bases. Na VOZ (chamada ativa, voz ligada) a escolha clicada — também
   * a correção pelo "Alterar" — vira a resposta da pessoa na sessão, como se tivesse falado, e a INIA continua a conversa falando; a
   * escolha ESTRUTURADA vai junto da consulta que a voz faz em seguida (`getToolCallContext`) e o backend a aplica exatamente, a
   * correção inclusive (nunca pela reescrita do modelo de voz); se a voz não fizer a consulta, a escolha segue pelo texto no fim do
   * turno. Sem voz (mudo ou avatar encerrado) vai pelo caminho de TEXTO com a escolha estruturada; a forma legível vira a mensagem de
   * quem pergunta.
   */
  const answerClarification = (answer: ClarificationAnswer, displayText: string) => {
    if (readOnlyConversation || loadState !== "ready" || textReplyPending) return
    setStageGreeting(false)
    presentationRef.current?.stop()
    if (callActive && !voiceMuted && sendTypedByVoice(displayText, false, answer)) return
    void sendForTextReply(displayText, { clarification: answer })
  }

  /**
   * Com a voz ligada ela FALA toda resposta: a resposta gravada pelo caminho de texto é lida em voz alta pela sessão de voz — o
   * backend devolve o conteúdo com a mesma instrução de fala da ferramenta (`fetchVoiceReading`) e o transporte não deixa a leitura
   * consultar nada de novo (`readAloud`). Nada é gravado de novo: a mensagem já está na conversa, a fala não ganha legenda paralela
   * e, no palco, pousa nela. Não lê se a pessoa já seguiu adiante (outro turno, microfone aberto, apresentação ou recado tocando), se
   * a voz foi para o mudo ou caiu, ou se a leitura não vier.
   */
  const speakReply = async (messageId: number, interactionId: string, conversationId: string, since: { generation: number; turnId: string }) => {
    const { generation, turnId } = since
    const stillDue = () =>
      generation === viewGenerationRef.current && turnId === turnIdRef.current && turnMessageIdsRef.current.length === 0 &&
      conversationStateRef.current !== "listening" && !voiceMutedRef.current && !presentationRef.current && !recadoPlaybackRef.current &&
      Boolean(transportRef.current?.isConnected)
    if (!stillDue()) return
    let text: string
    try {
      text = await fetchVoiceReading({ conversationId, interactionId, feedbackApplicationId: feedbackSessionRef.current?.application.id ?? null })
    } catch (error) {
      console.warn("[realtime] voice reading unavailable", error)
      return
    }
    const transport = transportRef.current
    if (!stillDue() || !transport) return
    // A mensagem já é a resposta deste turno: a fala não ganha legenda paralela nem é gravada de novo.
    specialistAnsweredThisTurnRef.current = true
    if (stageOpen()) landSpecialistOnStage(messageId)
    transport.readAloud(text)
  }

  /**
   * Resposta POR ESCRITO (INIA no mudo, avatar encerrado ou voz indisponível) — o caminho de texto de sempre. `speak`: a escolha do
   * formulário que a voz não levou (ver `flushAssistantTranscript`): a resposta também é LIDA em voz alta (`speakReply`).
   */
  const sendForTextReply = async (text: string, options: { fromComposer?: boolean; existingBubbleId?: number; clarification?: ClarificationAnswer; speak?: boolean } = {}) => {
    const feedbackApplicationId = feedbackSessionRef.current?.application.id ?? null
    const inFeedback = feedbackApplicationId !== null
    const generation = viewGenerationRef.current
    // Leitura em voz alta só se, quando a resposta chegar, ninguém tiver seguido adiante desde AGORA (ver `speakReply`).
    const speakSince = { generation, turnId: turnIdRef.current }
    const requestedConversationId = conversationIdRef.current
    const userBubbleId = options.existingBubbleId ?? nextMessageId()
    setConversationNotice("")
    const segment = currentSegment()
    if (options.existingBubbleId === undefined) {
      setMessages((current) => [...current, { id: userBubbleId, sender: "user", text, time: nowTime(), occurredAt: new Date().toISOString(), channel: "chat", ...segment }])
      if (options.fromComposer) setQuestion("")
      if (textareaRef.current) textareaRef.current.style.height = "auto"
    }
    setTextReplyPending(true)
    setLiveTextReply(null)
    setLiveTextCitations(false)
    setTextReplyStatus(null)
    scrollToLatest()
    textReplyAbortRef.current?.abort()
    const abort = new AbortController()
    textReplyAbortRef.current = abort
    // Na conversa de um feedback o indicador ATUAL nunca entra (o backend também ignora esta instrução nesse caso).
    const contextHint = inFeedback ? "" : focus
      ? focus.recommendation
        ? ` Contexto atual: o indicador prioritário do momento é "${focus.title}", com a recomendação: "${focus.recommendation}". Use isso só se for relevante para a pergunta.`
        : ` Contexto atual: o indicador prioritário do momento é "${focus.title}". Use isso só se for relevante para a pergunta.`
      : ""
    const current = () => generation === viewGenerationRef.current
    let userSaved = false
    // Monitoria de usabilidade: envio = ação com resultado (gravada pelo servidor ou não) + tempo até o primeiro texto da INIA.
    const usageAction = startUsageAction("chat.send_message")
    const usageStartedAt = performance.now()
    let firstTextAt: number | null = null
    const recordFirstText = (outcome: "OK" | "FAILED") => {
      if (firstTextAt !== null) return
      firstTextAt = performance.now()
      trackUsage("latency.measured", { metric: "CHAT_FIRST_TEXT", ms: outcome === "OK" ? Math.round(firstTextAt - usageStartedAt) : null, outcome }, { correlationId: usageAction.correlationId })
    }
    // No palco a resposta escrita também passa pelo balão (sem voz: ritmo de leitura, sem ela mexer a boca) e pousa na conversa —
    // menos a que vai ser LIDA: essa entra no balão pela voz.
    const onStage = stageOpen() && !options.speak
    let stageKey: number | null = null
    let reading: ReturnType<typeof createReadingClock> | null = null
    const stageWords = () => {
      const utterance = stageUtteranceRef.current
      return utterance && utterance.key === stageKey ? wordsIn(plainTextOf(utterance.text)) : 0
    }
    try {
      // O backend monta o contexto do modelo a partir da conversa gravada — nenhum histórico sai daqui.
      const reply = await fetchTextReply(
        // Sobre uma aplicação: o backend decide a conversa (a da aplicação ou a complementar, criada nesta primeira dúvida).
        { conversationId: requestedConversationId, text, clientMessageId: newClientKey(), contextHint: contextHint.trim().slice(0, 1_000) || undefined, feedbackApplicationId, ...(options.clarification ? { clarification: options.clarification } : {}) },
        (chunk, meta) => {
          recordFirstText("OK")
          if (!current()) return
          if (meta?.citations) setLiveTextCitations(true)
          setLiveTextReply((value) => (value ?? "") + chunk)
          if (!onStage) return
          if (stageKey === null) {
            reading = createReadingClock(stageWords)
            stageKey = beginStageUtterance(chunk, null, { heard: reading.heard })
          } else appendStageText(chunk)
        },
        (conversation) => {
          userSaved = true
          if (!current()) return
          // Inatividade: esta mensagem abriu outra conversa — a tela mostra só a conversa nova (a antiga fica no histórico).
          if (conversation.rotatedFrom && conversation.rotatedFrom === requestedConversationId) {
            setMessages((list) => list.filter((message) => message.id === userBubbleId))
            setOlderCursor(null)
            setConversationNotice("A conversa anterior ficou parada por muito tempo e foi guardada. Esta é uma nova conversa.")
          }
          adoptConversation(conversation.conversationId)
        },
        {
          signal: abort.signal,
          onStatus: (status) => {
            if (current()) setTextReplyStatus(status.label)
          },
          // O texto mostrado deixou de ser a resposta: some da tela (e do palco) e os próximos pedaços recomeçam.
          onRetract: () => {
            if (!current()) return
            setLiveTextReply(null)
            setLiveTextCitations(false)
            if (stageKey !== null && stageUtteranceRef.current?.key === stageKey) setStage(null)
            stageKey = null
            reading = null
          },
        },
      )
      recordFirstText("OK")
      if (reply.persisted) usageAction.succeed()
      else usageAction.fail("REPLY_NOT_PERSISTED")
      if (!current()) return
      const replyId = nextMessageId()
      setMessages((list) => [...list, { id: replyId, sender: "assistant", time: nowTime(), occurredAt: new Date().toISOString(), channel: "chat", text: reply.text, ...(reply.persisted && reply.interactionId ? { interactionId: reply.interactionId } : {}), ...segment, ...(reply.supportMaterials.length > 0 ? { supportMaterials: reply.supportMaterials } : {}), ...(reply.analytics && reply.analytics.length > 0 ? { analytics: reply.analytics } : {}), ...(reply.reportOffer ? { reportOffer: reply.reportOffer } : {}), ...(reply.clarification ? { clarification: reply.clarification } : {}), ...(reply.persisted ? {} : { saveState: "failed" as const }) }])
      // "Sim" à oferta de report: abre a configuração já preenchida (o backend decidiu o destino).
      if (reply.navigate) routerRef.current.push(reply.navigate.href)
      if (options.speak && reply.persisted && reply.interactionId) void speakReply(replyId, reply.interactionId, reply.conversationId, speakSince)
      const shownIn = reading as ReturnType<typeof createReadingClock> | null
      if (stageKey !== null && shownIn) {
        // A resposta fica no balão até terminar de aparecer; depois pousa nela.
        const key = stageKey
        attachStageMessage(replyId, key)
        window.setTimeout(() => endStageUtterance(undefined, key), shownIn.finish(stageWords()))
      }
    } catch (error) {
      recordFirstText("FAILED")
      if (error instanceof ConversationClosedError || error instanceof FeedbackConversationChangedError) usageAction.cancel()
      else usageAction.fail(error instanceof ApiError && error.code ? error.code : "SEND_FAILED")
      if (!current()) return
      if (stageKey !== null && stageUtteranceRef.current?.key === stageKey) setStage(null)
      if ((error instanceof ConversationClosedError || error instanceof FeedbackConversationChangedError) && inFeedback && feedbackSessionRef.current) {
        // A aplicação foi concluída em outra aba (ou a conversa mudou): nada foi gravado. A sessão recarrega no estado real e o
        // texto volta ao campo — enviar de novo vira uma dúvida na conversa complementar, nunca uma escrita silenciosa.
        setMessages((list) => list.filter((message) => message.id !== userBubbleId))
        reloadFeedbackSession("Esta aplicação foi concluída em outra janela. Sua mensagem não foi enviada — você pode enviá-la como dúvida.", text)
        return
      }
      if (error instanceof ConversationClosedError) {
        // Outra aba encerrou esta conversa: nada foi gravado. A tela troca para a conversa atual e o texto volta ao campo.
        setMessages((list) => list.filter((message) => message.id !== userBubbleId))
        setQuestion(text)
        setConversationNotice("Esta conversa foi encerrada em outra janela. Abrimos a conversa atual — sua mensagem não foi enviada.")
        closeVoiceSessionForSwitch()
        await loadCurrentConversation()
        return
      }
      if (!userSaved) setMessages((list) => list.map((message) => (message.id === userBubbleId ? { ...message, saveState: "failed" } : message)))
      setMessages((list) => [...list, { id: nextMessageId(), sender: "assistant", time: nowTime(), occurredAt: new Date().toISOString(), text: TEXT_REPLY_FALLBACK_TEXT, localError: true }])
    } finally {
      if (textReplyAbortRef.current === abort) textReplyAbortRef.current = null
      if (current()) {
        setTextReplyPending(false)
        setLiveTextReply(null)
        setTextReplyStatus(null)
      }
    }
  }

  // Os callbacks da voz nascem uma vez por sessão: o fim do turno envia pela versão atual (estado de agora), nunca a da criação.
  const sendForTextReplyRef = useRef<typeof sendForTextReply | null>(null)
  useEffect(() => {
    sendForTextReplyRef.current = sendForTextReply
  })

  const endCall = () => {
    // Recado ou apresentação tocando: "Encerrar avatar" é uma interrupção (registrada como tal), antes da despedida.
    recadoPlaybackRef.current?.stop()
    presentationRef.current?.stop()
    const transport = transportRef.current
    // Corta a resposta em andamento (o que já foi transcrito vai para o histórico, como num
    // barge-in) e só então encerra a sessão.
    transport?.interruptResponse()
    transport?.disconnect()
    setSessionConnected(false)
    setLiveAssistantText(null)
    pendingAssistantTranscriptRef.current = ""
    // Fala parcial do usuário (microfone aberto ao encerrar) não vaza para a próxima conversa.
    if (userTranscriptTimerRef.current) { clearTimeout(userTranscriptTimerRef.current); userTranscriptTimerRef.current = null }
    pendingUserTranscriptRef.current = ""
    lastUserTurnTextRef.current = ""
    resetWaveform()
    paintMicLevel(0)
    // No mudo ela se despede em silêncio (a voz do sistema não passa pelo volume da INIA).
    if (voiceMutedRef.current || !("speechSynthesis" in window)) { setCallActive(false); applyConversationState("idle"); return }
    window.speechSynthesis.cancel()
    // A despedida é falada pelo navegador, que não expõe o áudio: a boca segue o texto + os
    // eventos de fronteira de palavra (lip-sync temporizado no driver), não o motor por áudio.
    const utterance = new SpeechSynthesisUtterance(FAREWELL_TEXT)
    utterance.lang = "pt-BR"
    utterance.rate = .98
    const farewell: { utterance: SpeechSynthesisUtterance; speech: FarewellSpeech | null } = { utterance, speech: null }
    const finish = () => {
      if (farewellRef.current !== farewell) return
      farewellRef.current = null
      farewell.speech?.end()
      setFarewellActive(false)
      setCallActive(false)
      applyConversationState("idle")
    }
    utterance.onstart = () => {
      if (farewellRef.current !== farewell) return
      farewell.speech = voice.driver.startFarewell(FAREWELL_TEXT)
      applyConversationState("speaking")
    }
    utterance.onboundary = (event) => {
      if (event.name && event.name !== "word") return
      farewell.speech?.boundary(event.charIndex)
    }
    utterance.onend = finish
    utterance.onerror = finish
    farewellRef.current = farewell
    setFarewellActive(true)
    window.speechSynthesis.speak(utterance)
  }

  /**
   * Botão que diz "OUVIR" (feedback, convite, apresentação, recado) é um pedido explícito de voz: tira o mudo — o pedido de agora
   * vale mais que uma preferência antiga. A troca fica SALVA (senão a resposta à próxima pergunta voltaria em texto) e o botão de
   * mudo mostra o novo estado: um toque silencia de novo. Dentro do clique: quem decide voz × texto lê `voiceMutedRef` na hora.
   * Fora desses botões (pergunta digitada, retomar, abrir para ler) o mudo continua valendo.
   */
  const unmuteToListen = () => {
    if (!voiceMutedRef.current) return
    voiceMutedRef.current = false
    voice.playback.setMuted(false)
    voice.driver.setMuted(false)
    setVoiceMuted(false)
  }

  /** Botão de mudo: ela para de falar na hora (a fala em curso segue sem som, com o texto) e passa a responder por escrito. */
  const toggleVoiceMuted = () => {
    const next = !voiceMutedRef.current
    // Voltar a ouvir é um clique: libera o áudio aqui (política de autoplay).
    if (!next) voice.playback.prime()
    setVoiceMuted(next)
  }

  const startCall = () => {
    setCallActive(true)
    setCameraOn(true)
    applyConversationState("idle")
  }

  /** Pergunta sugerida (escolhida pelo colaborador; nada é enviado sozinho). */
  const askSuggestion = (event: React.MouseEvent<HTMLButtonElement>) => {
    const suggestion = event.currentTarget.dataset.suggestion
    if (suggestion) void send(suggestion)
  }

  /** Pergunta de um cartão da liderança (ex.: "Perguntar à INIA" numa prioridade): enviada só pelo clique da pessoa. */
  const askQuestion = (question: string) => void send(question)

  const rate = (id: number, rating: "up" | "down") => {
    const target = messages.find((message) => message.id === id)
    setMessages((current) => current.map((message) => message.id === id ? { ...message, rating: message.rating === rating ? undefined : rating } : message))
    // Gravado por trás: a tela não espera nem avisa. Resposta sem id no servidor (não entrou no histórico) fica só na tela.
    const conversationId = conversationIdRef.current
    if (!target?.interactionId || !conversationId) return
    void saveMessageRating(conversationId, target.interactionId, target.rating === rating ? undefined : rating).catch((error: unknown) => console.warn("[INIA] avaliação da resposta não gravada", error))
  }

  // -------------------------------------------------------------------------------------------
  // Efeitos da montagem e do convite de recado. Ficam DEPOIS das funções de propósito: o lint do React Compiler só analisa o
  // componente se nenhum efeito usa uma função declarada mais abaixo — e as funções acima são `const` porque ele não aceita
  // referência antecipada a `function` (há ciclos entre elas). A ordem entre os efeitos é a mesma de quando ficavam no topo.
  // -------------------------------------------------------------------------------------------
  useEffect(() => {
    // Abrir o chat pelo sino direto numa conversa de Workflow não carrega antes a conversa atual.
    if (targetConversationId) return
    // Painel aberto por "Ouvir com a INIA" com o chat recolhido: o pedido pendente abre o feedback (sem passar pela conversa atual).
    if (workspace?.pendingRequest) return
    void loadCurrentConversation()
    // Só na montagem: trocas de conversa chamam as funções diretamente.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (!targetConversationId || handledTargetConversationRef.current === targetConversationId) return
    handledTargetConversationRef.current = targetConversationId
    void openWorkflowConversation(targetConversationId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetConversationId])
  // Recado de voz (Workflow Output → Avatar): o convite, a fala nesta tela e as ações. Chamado no lugar dos efeitos dele.
  const {
    setRecado, recadoButtonRef, shownRecado, recadoLive, acceptRecado, stopRecado, snoozeRecado, replayRecado,
  } = useRecado({
    inbox, targetDeliveryId, queryClient, recadoPlaybackRef, unmuteToListen, callActive, setCallActive, cameraOn, setCameraOn, transportRef, applyConversationState, startPreparedVoice,
  })
  const micDisabled = conversationState === "thinking" || farewellActive || composerLocked || recadoLive || presentationPhase === "preparing"
  // Carregar mensagens anteriores não pode tirar o leitor do lugar: mantém a distância até o fim do conteúdo.
  useLayoutEffect(() => {
    const anchor = scrollAnchorRef.current
    if (!anchor) return
    scrollAnchorRef.current = null
    const viewport = messagesContentRef.current?.closest<HTMLElement>('[data-slot="scroll-area-viewport"], [data-chat-scroll]')
    if (viewport) viewport.scrollTop = viewport.scrollHeight - anchor.height + anchor.top
  }, [messages])

  useEffect(() => {
    const transportHolder = transportRef
    const farewellHolder = farewellRef
    const timerHolder = userTranscriptTimerRef
    const recadoHolder = recadoPlaybackRef
    const presentationHolder = presentationRef
    return () => {
      transportHolder.current?.disconnect()
      if (timerHolder.current) clearTimeout(timerHolder.current)
      // Despedida em curso: a fala do navegador não pode continuar (nem chamar setState) depois de
      // o chat sair da tela. `speechSynthesis.cancel()` é global, então só é chamado quando é ESTE
      // chat que está falando — desmontar o outro (desktop/mobile) nunca corta esta despedida.
      const farewell = farewellHolder.current
      if (farewell) {
        farewellHolder.current = null
        farewell.utterance.onstart = null
        farewell.utterance.onboundary = null
        farewell.utterance.onend = null
        farewell.utterance.onerror = null
        window.speechSynthesis.cancel()
      }
      // Recado tocando ao sair da tela: registra a interrupção (nunca "ouvido"). O mesmo para a apresentação de um feedback —
      // recolher o painel nunca deixa áudio tocando sem controles.
      recadoHolder.current?.stop()
      presentationHolder.current?.stop()
      // Não é terminal: no StrictMode o efeito remonta com o mesmo driver.
      voice.driver.dispose()
    }
  }, [voice])

  // Pedidos do feed/convite chegam por aqui, SÍNCRONOS dentro do clique (a função mais recente, sem recriar o registro).
  const feedbackRequestHandlerRef = useRef<(request: FeedbackOpenRequest) => void>(() => {})
  useLayoutEffect(() => {
    feedbackRequestHandlerRef.current = handleFeedbackRequest
  })
  const registerChat = workspace?.registerChat
  useEffect(() => {
    if (!registerChat || context !== "operator") return
    registerChat((request) => feedbackRequestHandlerRef.current(request))
    return () => registerChat(null)
  }, [registerChat, context])
  // Perguntas vindas do Acompanhamento ("Perguntar à INIA" no cartão "Onde atuar hoje"): a função mais recente, sem recriar o registro.
  const askQuestionRef = useRef<(question: string) => void>(() => {})
  useLayoutEffect(() => {
    askQuestionRef.current = askQuestion
  })
  const registerQuestionHandler = workspace?.registerQuestionHandler
  useEffect(() => {
    if (!registerQuestionHandler || context !== "team") return
    registerQuestionHandler((question) => askQuestionRef.current(question))
    return () => registerQuestionHandler(null)
  }, [registerQuestionHandler, context])
  // Pedido feito antes de o chat montar: o áudio já foi liberado no clique; aqui o chat (recém-montado) abre o feedback.
  const pendingRequestId = workspace?.pendingRequest?.id ?? null
  useEffect(() => {
    if (pendingRequestId === null || context !== "operator") return
    const request = workspace?.takePendingRequest()
    if (request?.mode === "listen") unmuteToListen()
    if (request) void openFeedbackApplication(request)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRequestId])
  // Painel oculto (desktop recolhido): nada fala nem escuta no painel. A sessão de feedback (card central) não depende dele.
  const feedbackModeRef = useRef(false)
  useLayoutEffect(() => {
    feedbackModeRef.current = feedbackMode
    voiceMutedRef.current = voiceMuted
  })
  // Mudo vale na hora, inclusive no meio de uma fala: o som sai (rampa curta) e a boca para; o texto continua no ritmo dela.
  useEffect(() => {
    voice.playback.setMuted(voiceMuted)
    voice.driver.setMuted(voiceMuted)
  }, [voice, voiceMuted])
  useEffect(() => {
    if (!hidden || feedbackModeRef.current) return
    recadoPlaybackRef.current?.stop()
    closeVoiceSessionForSwitch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hidden])
  // Convite da vez: só sem conversa em andamento (voz conectada, resposta pendente, digitando, feedback aberto ou recado tocando).
  const conversationBusy = sessionConnected || textReplyPending || conversationState !== "idle" || question.trim().length > 0 || feedbackMode || recadoLive
  const {
    inviteBusy, acceptInvite, readInvite, snoozeInvite, invite, inviteVisible,
  } = useFeedbackInvite({
    workspace, refreshFeedbackQueries, feedbackEnabled, inviteQuery, conversationBusy,
  })
  // UM convite por vez: o recado de voz tocando tem prioridade; senão, o mais recente entre recado e feedback.
  const recadoNewer = shownRecado !== null && invite !== null && Date.parse(shownRecado.delivery.createdAt) > Date.parse(invite.publishedAt)
  const showFeedbackInvite = inviteVisible && !(shownRecado && (recadoLive || recadoNewer))
  const showRecado = shownRecado !== null && !feedbackMode && !showFeedbackInvite

  // -------------------------------------------------------------------------------------------
  // Composição visual. A conversa, a voz e o avatar são UM só (esta instância): o painel mostra a conversa geral; a SESSÃO DE
  // FEEDBACK (card central) mostra a aplicação aberta. Mensagens e campo de texto aparecem em um lugar por vez; o avatar é
  // movido entre os dois sem remontar o Canvas.
  // -------------------------------------------------------------------------------------------
  const sessionOpen = feedbackEnabled && feedbackMode
  // Avatar 3D (three.js ~1 MB + modelo de 6,6 MB): monta depois que a página carregou e o navegador ficou ocioso — a tela abre e
  // responde sem esperar o 3D, e a INIA aparece sozinha logo em seguida, como antes. Sessão de feedback aberta ou conversa em
  // andamento antes disso = monta na hora. Uma vez liberado, nunca volta atrás: o Canvas monta UMA vez e esta condição nunca o
  // desmonta (regra do Canvas do R3F no CLAUDE.md).
  const avatarAllowed = useBrowserIdle({ now: sessionOpen || conversationState !== "idle" })
  const sessionLayout: "desktop" | "mobile" = workspace?.layout === "mobile" ? "mobile" : "desktop"
  // Retomada com conversa: abre na última troca (depois que as mensagens estão na tela). `scrollIntoView` respeita o
  // `scroll-padding` da rolagem do palco — a pergunta fica logo abaixo do cabeçalho fixo do feedback, que recolhe sozinho.
  useEffect(() => {
    const id = resumeScrollToRef.current
    if (id === null || !sessionOpen || loadState !== "ready") return
    const target = document.querySelector(`[data-testid="feedback-session"] [data-message-id="${id}"]`)
    if (!target) return
    resumeScrollToRef.current = null
    target.scrollIntoView({ block: "start" })
  }, [messages, loadState, sessionOpen])

  const sessionApplication = feedbackSession?.application ?? null


  // No PAINEL a INIA é uma chamada de vídeo: nome e estado no canto, controles de chamada embaixo (microfone, silenciar a INIA,
  // câmera, sair). Na sessão, os controles ficam abaixo dela.
  const panelAvatarControls = avatarModelUrl && callActive ? <>
    <IniaCallStatus state={conversationState} muted={voiceMuted}/>
    <IniaCallControls
      micOpen={micOpen}
      micDisabled={micDisabled}
      micLabel={micLabel}
      onMic={handleMicClick}
      micPulseRef={(element) => { micPulseRefs.current[0] = element }}
      micPulseStyle={MIC_PULSE_REST_STYLE}
      muted={voiceMuted}
      onToggleMute={toggleVoiceMuted}
      cameraOn={cameraOn}
      onToggleCamera={() => setCameraOn((value) => !value)}
      onEnd={endCall}
    />
  </> : null


  // Mensagens da conversa exibida (geral no painel; a da aplicação — e a complementar — na sessão).
  const messageItems = <ChatMessageList
    sessionApplication={sessionApplication}
    messages={messages}
    messagesContentRef={messagesContentRef}
    sessionOpen={sessionOpen}
    loadState={loadState}
    readOnlyConversation={readOnlyConversation}
    openPastConversation={openPastConversation}
    loadCurrentConversation={loadCurrentConversation}
    olderCursor={olderCursor}
    loadOlderMessages={loadOlderMessages}
    loadingOlder={loadingOlder}
    olderError={olderError}
    operator={operator}
    greeting={greeting}
    stageHiddenIds={stageHiddenIds}
    feedbackCompleted={feedbackCompleted}
    workflowConversation={workflowConversation}
    rate={rate}
    resumeMarkerId={resumeMarkerId}
    conversationState={conversationState}
    liveAssistantText={liveAssistantText}
    textReplyPending={textReplyPending}
    textReplyStatus={textReplyStatus}
    liveTextReply={liveTextReply !== null && liveTextCitations ? withoutLiveSourceMarkers(liveTextReply) : liveTextReply}
    askSuggestion={askSuggestion}
    switchToGeneralConversation={switchToGeneralConversation}
    starterSuggestions={starterSuggestions}
    askQuestion={askQuestion}
    answerClarification={answerClarification}
  />

  // Campo de mensagem: no painel ou, com a sessão aberta, no card central (um lugar por vez).
  const composer = <ChatComposer
    sessionOpen={sessionOpen}
    readOnlyConversation={readOnlyConversation}
    feedbackCompleted={feedbackCompleted}
    composerRef={composerRef}
    micOpen={micOpen}
    waveformBarRefs={waveformBarRefs}
    textareaRef={textareaRef}
    question={question}
    setQuestion={setQuestion}
    textReplyPending={textReplyPending}
    conversationState={conversationState}
    send={send}
    composerLocked={composerLocked}
    callActive={callActive}
    toggleVoiceMuted={toggleVoiceMuted}
    voiceMuted={voiceMuted}
    handleMicClick={handleMicClick}
    micDisabled={micDisabled}
    micLabel={micLabel}
    micPulseRef={(element) => { micPulseRefs.current[1] = element }}
    voiceError={voiceError}
  />

  // --- Sessão de feedback (card central) -----------------------------------------------------
  const {
    sessionTitle, sessionMeta, sessionStatus, heard, speechDetail, sessionSpeech,
  } = describeFeedbackSession({
    sessionApplication, feedbackOpening, feedbackError, feedbackCompleted, presentationPhase, feedbackSession, presentationVoice,
    conversationState, stageUtterance, micOpen, textReplyPending, liveTextReply, stageGreeting,
  })
  const speechControls = feedbackOpening ? (
    <Button type="button" size="sm" variant="ghost" className="rounded-full" onClick={cancelFeedbackOpening}>Cancelar</Button>
  ) : feedbackError ? (
    <>
      <Button type="button" size="sm" variant="outline" className="rounded-full" onClick={() => { const request = feedbackError.request; setFeedbackError(null); handleFeedbackRequest(request) }}>Tentar novamente</Button>
      <Button type="button" size="sm" variant="ghost" className="rounded-full" onClick={exitFeedbackForNow}>Fechar</Button>
    </>
  ) : sessionApplication && !feedbackCompleted && sessionApplication.script ? (
    presentationPhase === "preparing" ? (
      <Button type="button" size="sm" variant="ghost" className="rounded-full" onClick={() => presentationRef.current?.stop()}>Cancelar</Button>
    ) : presentationPhase === "playing" ? (
      <Button type="button" size="sm" variant="outline" className="rounded-full" onClick={() => presentationRef.current?.stop()}><Square className="fill-current" aria-hidden/>Parar</Button>
    ) : (
      <Button type="button" size="sm" variant={heard ? "outline" : "default"} className="rounded-full" onClick={replayPresentation} disabled={micOpen} data-usage-element="feedback.session.replay">
        {presentationPhase === "blocked" || presentationPhase === "failed" || heard ? <RotateCcw aria-hidden/> : <Play aria-hidden/>}
        {presentationPhase === "blocked" || presentationPhase === "failed" ? "Tentar novamente" : heard ? "Repetir apresentação" : "Ouvir apresentação"}
      </Button>
    )
  ) : null
  // O avatar (um Canvas), renderizado por portal no nó estável do `AvatarHostManager`: no card central, meio corpo; no painel, busto.
  const avatarVisual = !avatarModelUrl ? (
    <div className="flex h-full flex-col items-center justify-center gap-3 rounded-2xl bg-muted/50 text-center">
      <Skeleton className="size-16 rounded-full"/>
      <div><p className="text-sm font-medium">Avatar 3D não configurado</p><p className="mt-1 max-w-64 text-xs text-muted-foreground">Adicione um modelo VRM local preparado para visualizar a INIA.</p></div>
    </div>
  ) : !callActive ? (
    <IniaCallPlaceholder image={operator.assistantImage} variant="ended" onCall={startCall} rounded={!sessionOpen}/>
  ) : cameraOn && !avatarAllowed ? (
    avatarStagePlaceholder
  ) : cameraOn ? (
    <IniaHumanoidAvatar3D
      modelUrl={avatarModelUrl}
      state={conversationState}
      driver={voice.driver}
      // No palco, meio corpo e sem fundo próprio; no painel, de frente (busto).
      view={sessionOpen && sessionLayout === "desktop" ? "presenting" : "chat"}
      // No palco ela fica virada para o feedback enquanto o MOSTRA (a chegada, a espera pela voz, os avisos sobre ele) e se vira
      // de frente para a pessoa quando FALA com ela, a ouve, pensa ou espera a pergunta — olhos, cabeça e depois o corpo.
      facing={sessionOpen && sessionSpeech.kind !== "say" ? "viewer" : "forward"}
      statusLabel={null}
      backdrop={sessionOpen || scene ? "none" : "studio"}
      // No painel o nome e o estado dela vêm do tile da chamada (e o crédito do modelo sobe: embaixo ficam os controles).
      showStatus={false}
      attributionPlacement={sessionOpen ? "bottom" : "top"}
      className={sessionOpen ? "h-full rounded-none" : "h-full rounded-xl"}
    />
  ) : (
    <IniaCallPlaceholder image={operator.assistantImage} variant="camera-off" rounded={!sessionOpen}/>
  )

  // Sem o registro, o feedback não é exibido (o balão dela diz o que houve, com nova tentativa).
  const sessionContent = feedbackError ? <p className="text-sm text-muted-foreground" role="alert">O feedback não foi carregado. Nada foi alterado.</p> : <FeedbackSessionContent application={sessionApplication} hideMaterials/>
  // A conversa vem logo depois do feedback, na mesma coluna (uma rolagem só).
  const sessionConversation = sessionOpen ? <section aria-label="Conversa sobre este feedback" data-testid="feedback-session-conversation">
    <div className="flex items-center gap-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase"><MessageCircle className="size-3.5 text-primary dark:text-chart-4" aria-hidden/>Conversa com a INIA<span className="h-px flex-1 bg-border" aria-hidden/></div>
    {conversationNotice ? <p className="mt-3 rounded-xl bg-primary/5 px-3 py-2 text-xs text-foreground" role="status">{conversationNotice}</p> : null}
    {messageItems}
  </section> : null
  const sessionDialog = feedbackEnabled ? (
    <FeedbackSessionDialog
      open={sessionOpen}
      usageEntity={sessionApplication ? { type: sessionApplication.source.kind, id: sessionApplication.source.id } : null}
      layout={sessionLayout}
      title={sessionTitle}
      meta={sessionMeta}
      status={sessionStatus}
      headerActions={sessionApplication && !feedbackCompleted ? (
        <ConfirmReadingControl
          source={sessionApplication.source}
          entryPoint="FEEDBACK_SESSION"
          title={sessionTitle}
          acknowledgedAt={sessionApplication.acknowledgedAt}
          applicationInProgress
          disabled={textReplyPending}
          compact={sessionLayout === "mobile"}
          className="rounded-full"
          confirmedClassName={sessionLayout === "mobile" ? undefined : "text-emerald-200"}
          onBeforeConfirm={prepareFeedbackConfirmation}
          onConfirmed={handleFeedbackConfirmed}
        />
      ) : null}
      closeLabel={sessionApplication && !feedbackCompleted ? "Sair por agora" : "Fechar"}
      avatar={<AvatarSlot manager={avatarHost} priority={2} className="h-full" flyIn/>}
      speech={sessionSpeech}
      voiceStatus={speechDetail}
      voiceControls={speechControls}
      onSpeechLanded={handleSpeechLanded}
      content={sessionContent}
      conversation={sessionConversation}
      materials={sessionOpen ? <FeedbackSessionMaterials application={sessionApplication}/> : null}
      composer={sessionOpen ? composer : null}
      scene={scene}
      onClose={exitFeedbackForNow}
      onCloseAutoFocus={(event) => {
        // Volta ao botão do feedback no Acompanhamento (a página não rola); sem ele na tela, o padrão do diálogo.
        const key = sessionKeyRef.current
        if (key && workspace?.focusFeedbackTrigger(key)) event.preventDefault()
      }}
    />
  ) : null

  return <>
  <section className="flex h-full min-h-0 flex-col bg-card" data-usage-screen={hidden ? undefined : "followup.chat_panel"}>
    <header className="flex items-center gap-2 px-5 py-4">
      <h2 className="min-w-0 flex-1 truncate text-lg font-semibold">INIA</h2>
      <Button type="button" variant="outline" size="sm" onClick={() => void newConversation()} disabled={startingNew || sessionOpen} className="rounded-full" data-usage-element="chat.new_conversation"><SquarePen/>Nova conversa</Button>
      <Tooltip><TooltipTrigger asChild><Button type="button" variant="ghost" size="icon" onClick={() => setHistoryOpen(true)} aria-label="Conversas anteriores" disabled={sessionOpen} data-usage-element="chat.history.open"><History/></Button></TooltipTrigger><TooltipContent side="bottom" className="inia-tooltip-genie">Conversas anteriores</TooltipContent></Tooltip>
      {onCollapse ? <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" onClick={onCollapse} aria-label="Recolher chat"><PanelRightClose/></Button></TooltipTrigger><TooltipContent side="left" className="inia-tooltip-genie">Recolher chat</TooltipContent></Tooltip> : null}
    </header>
    <Separator/>
    <div className="px-4 pt-4">
      <IniaCallTile speaking={!sessionOpen && callActive && conversationState === "speaking" && !voiceMuted} className={AVATAR_STAGE_HEIGHT}>
        {scene && !sessionOpen ? <IniaSceneBackdrop imageUrl={scene.imageUrl} blur={scene.blur} dim={scene.dim} variant="panel"/> : null}
        <AvatarSlot manager={avatarHost} priority={1} className="h-full"/>
        {sessionOpen ? <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-muted/60 px-6 text-center text-xs text-muted-foreground">A INIA está na sessão de feedback.</div> : panelAvatarControls}
      </IniaCallTile>
    </div>
    {sessionOpen ? (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 p-6 text-center text-sm text-muted-foreground" role="status">
        <p className="font-medium text-foreground">Sessão de feedback aberta</p>
        <p className="max-w-72">{sessionTitle}</p>
      </div>
    ) : <>
      {showFeedbackInvite && invite ? (
        <FeedbackInviteCard invite={invite} busy={inviteBusy} onListen={() => acceptInvite(invite)} onRead={() => readInvite(invite)} onLater={() => snoozeInvite(invite)}/>
      ) : null}
      {showRecado && shownRecado ? (
        <IniaRecadoInvite
          ref={recadoButtonRef}
          delivery={shownRecado.delivery}
          phase={shownRecado.phase}
          error={shownRecado.error}
          highlighted={shownRecado.delivery.id === targetDeliveryId}
          onAccept={() => acceptRecado(shownRecado.delivery)}
          onSnooze={() => snoozeRecado(shownRecado.delivery)}
          onStop={stopRecado}
          onReplay={() => replayRecado(shownRecado.delivery)}
          onDismiss={() => setRecado(null)}
          muted={voiceMuted}
        />
      ) : null}
      <PanelConversationBanners
        feedbackReturn={feedbackReturn}
        reopenFeedback={reopenFeedback}
        unreadWorkflowConversations={unreadWorkflowConversations}
        openWorkflowConversation={openWorkflowConversation}
        workflowConversation={workflowConversation}
        setConversationNotice={setConversationNotice}
        loadCurrentConversation={loadCurrentConversation}
        readOnlyConversation={readOnlyConversation}
        conversationNotice={conversationNotice}
      />
      <ScrollArea className="min-h-0 flex-1">{messageItems}</ScrollArea>
      <Separator/>
      {composer}
    </>}
    <IniaConversationHistorySheet open={historyOpen} onOpenChange={setHistoryOpen} currentConversationId={readOnlyConversation ? null : conversationId} onSelect={(summary) => void openPastConversation(summary)} />
  </section>
  {sessionDialog}
  <MicConsentDialog
    showMicConsent={showMicConsent}
    setShowMicConsent={setShowMicConsent}
    confirmMicConsent={confirmMicConsent}
  />
  {/* O avatar (um Canvas) por último: o lugar dele já está montado quando ele monta. */}
  {avatarHost ? createPortal(avatarVisual, avatarHost.host) : null}
  </>
}
