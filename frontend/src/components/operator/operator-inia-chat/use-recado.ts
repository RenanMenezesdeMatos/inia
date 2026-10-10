import { useEffect, useRef, useState } from "react"
import { useQuery, type QueryClient } from "@tanstack/react-query"
import type { AvatarConversationState } from "@/lib/avatar/animation/types"
import type { RecadoAudio } from "@/lib/avatar/recado/recado-audio"
import type { RecadoFailureReason, RecadoHandlers, RecadoPlayback } from "@/lib/avatar/recado/recado-speech"
import type { GeminiRealtimeTransport } from "@/lib/realtime/gemini-realtime-transport"
import { iniaInboxKey } from "@/queries/inia-deliveries/use-inia-inbox"
import type { AvatarDelivery, IniaInbox } from "@/schemas/inia-deliveries/inia-deliveries.schema"
import { fetchRecadoAudio, postAvatarDeliveryEvent } from "@/services/inia-deliveries/inia-deliveries-service"
import type { RecadoPhase } from "../inia-recado-invite"
import { phaseOfStatus, RECADO_FAILURE_TEXT, recadoAudioKey } from "./recado"

type UseRecadoInput = {
  inbox: IniaInbox | undefined
  targetDeliveryId: string | null
  queryClient: QueryClient
  recadoPlaybackRef: React.RefObject<RecadoPlayback | null>
  unmuteToListen: () => void
  callActive: boolean
  setCallActive: React.Dispatch<React.SetStateAction<boolean>>
  cameraOn: boolean
  setCameraOn: React.Dispatch<React.SetStateAction<boolean>>
  transportRef: React.RefObject<GeminiRealtimeTransport | null>
  applyConversationState: (state: AvatarConversationState) => void
  startPreparedVoice: (speech: { cacheKey: readonly unknown[]; text: string; fetchAudio: () => Promise<RecadoAudio> }, handlers: RecadoHandlers) => RecadoPlayback
}

/**
 * Recado de voz entregue por um Workflow (Output → Avatar): convite → aceite → FALA. Nunca fala antes do clique; o clique JÁ é o
 * play. O convite vem do inbox; aqui ficam o estado da fala nesta tela, a oferta registrada uma vez, a voz preparada assim que o
 * convite aparece (preparar ≠ tocar), o foco vindo do sino e as ações (ouvir agora, parar, depois, ouvir de novo).
 * `recadoPlaybackRef` é do componente: desmontar o chat, encerrar o avatar e abrir um feedback também param a fala por ela.
 */
export function useRecado({ inbox, targetDeliveryId, queryClient, recadoPlaybackRef, unmuteToListen, callActive, setCallActive, cameraOn, setCameraOn, transportRef, applyConversationState, startPreparedVoice }: UseRecadoInput) {
  // Recado em reprodução NESTA tela (o que o backend sabe chega pelo inbox). `null` = convite vindo do inbox.
  const [recado, setRecado] = useState<{ delivery: AvatarDelivery; phase: RecadoPhase; error: string | null } | null>(null)
  const offeredRecadosRef = useRef(new Set<string>())
  const recadoButtonRef = useRef<HTMLButtonElement>(null)
  // Entregue nesta tela: some do convite na hora (o inbox só confirma no próximo ciclo).
  const [deliveredLocally, setDeliveredLocally] = useState<string[]>([])
  const openDeliveries = (inbox?.avatarDeliveries ?? []).filter((delivery) => !deliveredLocally.includes(delivery.id))
  const inboxDelivery = openDeliveries.find((delivery) => delivery.id === targetDeliveryId) ?? openDeliveries.find((delivery) => delivery.status !== "SNOOZED") ?? openDeliveries[0] ?? null
  const shownRecado = recado ?? (inboxDelivery ? { delivery: inboxDelivery, phase: phaseOfStatus(inboxDelivery.status), error: null } : null)
  const recadoLive = recado?.phase === "starting" || recado?.phase === "playing"

  const refreshInbox = () => {
    void queryClient.invalidateQueries({ queryKey: iniaInboxKey })
  }

  /**
   * "Ouvir agora": tudo SÍNCRONO dentro do clique — o avatar é ativado e a fala entra na fila de voz do navegador aqui mesmo
   * (o gesto libera o áudio; nada espera a rede). Os eventos (aceite, início, fim/falha/interrupção) vão ao backend em
   * série, na ordem em que aconteceram. Aceite recusado pelo backend (já entregue em outra aba, sem rede) cala a fala.
   */
  /**
   * Fala o recado com a voz do Gemini (áudio do TTS no MESMO pipeline de reprodução + lip-sync do Live). SÍNCRONO no clique:
   * o AudioContext é liberado aqui; se o áudio já foi preparado a fala começa na hora, senão assim que ele chegar. Sem voz do
   * Gemini (TTS indisponível, rede) a voz do sistema assume — o avatar sempre fala depois do aceite.
   */
  const startRecadoVoice = (delivery: AvatarDelivery, handlers: RecadoHandlers): RecadoPlayback => {
    return startPreparedVoice({ cacheKey: recadoAudioKey(delivery.id), text: delivery.speechText, fetchAudio: () => fetchRecadoAudio(delivery.id) }, handlers)
  }

  const acceptRecado = (delivery: AvatarDelivery) => {
    unmuteToListen()
    recadoPlaybackRef.current?.stop()
    if (!callActive) setCallActive(true)
    if (!cameraOn) setCameraOn(true)
    // Resposta de voz da conversa em andamento dá lugar ao recado (a pessoa escolheu ouvir agora).
    transportRef.current?.interruptResponse()
    let acceptFailed = false
    let chain: Promise<unknown> = postAvatarDeliveryEvent(delivery.id, "ACCEPT")
    chain.catch(() => {
      acceptFailed = true
      recadoPlaybackRef.current?.stop()
      recadoPlaybackRef.current = null
      applyConversationState("idle")
      setRecado({ delivery, phase: "failed", error: "Não consegui registrar o recado agora. Tente de novo em instantes." })
      refreshInbox()
    })
    const report = (event: Parameters<typeof postAvatarDeliveryEvent>[1], reason?: RecadoFailureReason) => {
      chain = chain.then(() => postAvatarDeliveryEvent(delivery.id, event, reason)).catch(() => undefined)
      return chain
    }
    setRecado({ delivery, phase: "starting", error: null })
    recadoPlaybackRef.current = startRecadoVoice(delivery, {
      onStarted: () => {
        if (acceptFailed) return
        applyConversationState("speaking")
        setRecado({ delivery, phase: "playing", error: null })
        void report("PLAYBACK_STARTED")
      },
      onCompleted: () => {
        recadoPlaybackRef.current = null
        applyConversationState("idle")
        setRecado({ delivery, phase: "done", error: null })
        setDeliveredLocally((ids) => [...ids, delivery.id])
        void report("PLAYBACK_COMPLETED").then(refreshInbox)
      },
      onFailed: (reason) => {
        recadoPlaybackRef.current = null
        applyConversationState("idle")
        if (acceptFailed) return
        setRecado({ delivery, phase: "failed", error: RECADO_FAILURE_TEXT[reason] })
        void report("PLAYBACK_FAILED", reason).then(refreshInbox)
      },
      onInterrupted: () => {
        recadoPlaybackRef.current = null
        applyConversationState("idle")
        if (acceptFailed) return
        setRecado({ delivery, phase: "interrupted", error: null })
        void report("PLAYBACK_INTERRUPTED").then(refreshInbox)
      },
    })
  }

  const stopRecado = () => {
    recadoPlaybackRef.current?.stop()
  }

  const snoozeRecado = (delivery: AvatarDelivery) => {
    setRecado(null)
    void postAvatarDeliveryEvent(delivery.id, "SNOOZE").catch(() => undefined).then(refreshInbox)
  }

  /** Já entregue: ouvir de novo é só local (a entrega não muda). */
  const replayRecado = (delivery: AvatarDelivery) => {
    unmuteToListen()
    recadoPlaybackRef.current?.stop()
    setRecado({ delivery, phase: "starting", error: null })
    recadoPlaybackRef.current = startRecadoVoice(delivery, {
      onStarted: () => { applyConversationState("speaking"); setRecado({ delivery, phase: "playing", error: null }) },
      onCompleted: () => { recadoPlaybackRef.current = null; applyConversationState("idle"); setRecado({ delivery, phase: "done", error: null }) },
      onFailed: (reason) => { recadoPlaybackRef.current = null; applyConversationState("idle"); setRecado({ delivery, phase: "done", error: RECADO_FAILURE_TEXT[reason] }) },
      onInterrupted: () => { recadoPlaybackRef.current = null; applyConversationState("idle"); setRecado({ delivery, phase: "done", error: null }) },
    })
  }

  // Convite exibido pela primeira vez → OFFERED (idempotente no backend). Nenhum áudio.
  const invitedId = shownRecado?.delivery.id ?? null
  const invitedStatus = shownRecado?.delivery.status ?? null
  useEffect(() => {
    if (!invitedId || invitedStatus !== "PENDING" || offeredRecadosRef.current.has(invitedId)) return
    offeredRecadosRef.current.add(invitedId)
    void postAvatarDeliveryEvent(invitedId, "OFFER").catch(() => offeredRecadosRef.current.delete(invitedId))
  }, [invitedId, invitedStatus])
  // A voz do Gemini é preparada assim que o convite aparece (o TTS roda uma vez no backend): no clique, a fala começa na hora.
  // Preparar ≠ tocar — nada soa antes do aceite.
  useQuery({ queryKey: recadoAudioKey(invitedId ?? "none"), queryFn: () => fetchRecadoAudio(invitedId!), enabled: Boolean(invitedId), staleTime: Infinity, gcTime: 30 * 60_000, retry: false })
  // Veio do sino para este recado: leva o foco ao "Ouvir agora" (foco não toca nada — só o clique).
  useEffect(() => {
    if (targetDeliveryId && invitedId === targetDeliveryId) recadoButtonRef.current?.focus()
  }, [targetDeliveryId, invitedId])

  return {
    setRecado, recadoButtonRef, shownRecado, recadoLive, acceptRecado, stopRecado, snoozeRecado, replayRecado,
  }
}
