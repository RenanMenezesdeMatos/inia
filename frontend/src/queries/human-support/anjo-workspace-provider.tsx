"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react"

import { blinkTabTitle, createChime, newMessageTitle, pageIsSeen, primeChimeOnFirstGesture, type Chime } from "@/lib/attention/attention-alert"
import type { AnjoView } from "@/schemas/human-support/state.schema"
import { fetchHumanSupportState } from "@/services/human-support/human-support-service"

import { acknowledgeOnce } from "./receipt-acks"
import { useAnjoWorkspaceState, type AnjoWorkspaceState } from "./use-anjo-workspace-state"

/**
 * CONEXÃO DO ANJO NO APP INTEIRO. A área do Anjo é uma aba do perfil, mas a conexão (a chamada longa `workspace=anjo` que renova o
 * `lease_until`) não pode depender da aba: trocar para "Acompanhamento" ou abrir a Administração derrubaria a conexão e, depois da
 * carência de 3 min, os atendimentos voltariam para a fila. Por isso ela vive aqui, no shell, e continua enquanto esta aba do
 * navegador estiver no app.
 *
 * Só começa depois de a pessoa abrir a área do Anjo NESTA aba do navegador (`arm`), e isso fica guardado na sessão da aba (sobrevive a
 * recarregar a página): outra aba do INIA aberta por acaso não toma a trava de aba única. Antes disso, o ESTADO do Anjo é só lido
 * (`workspace=anjo-status`, que não conecta) ao entrar, ao voltar para a aba do navegador e a cada minuto — é o que a aba "Apoio"
 * mostra. Se a leitura mostra o Anjo em serviço (Disponível ou Em pausa) ou com atendimento aberto, a conexão liga sozinha: quem já
 * estava atendendo não perde os atendimentos por não ter aberto a aba de novo. Daqui saem também os avisos que valem em
 * qualquer tela — som e título piscando com atendimento novo ou mensagem nova do operador — e os números do indicador (aba "Apoio" do
 * perfil e o atalho no cabeçalho). As mensagens novas vêm do SERVIDOR (`unreadCount`, pelo "lida" do lado do Anjo), não da tela.
 */
export type AnjoAttention = {
  /** Atendimentos em andamento. */
  attendances: number
  /** Mensagens do operador ainda não vistas, somando os atendimentos. */
  unread: number
  /** Algum atendimento ainda sem a primeira resposta do Anjo. */
  awaitingResponse: boolean
}

export type AnjoWorkspaceContextValue = AnjoWorkspaceState & {
  /** A pessoa tem o papel Anjo (capability do /auth/me). */
  available: boolean
  /** Esta aba do navegador mantém a conexão do Anjo. */
  armed: boolean
  /** Abrir a área do Anjo nesta aba do navegador liga a conexão (e a mantém nas outras telas). */
  arm: () => void
  /** A área do Anjo está na tela (o atalho do cabeçalho some). */
  areaVisible: boolean
  setAreaVisible: (visible: boolean) => void
  /** Estado do Anjo para o indicador da aba (da conexão, quando ligada; senão, da leitura que não conecta). null = ainda sem leitura. */
  presence: AnjoView["presence"] | null
  /** Atendimento novo que acabou de chegar (a área seleciona a aba dele); `nonce` muda a cada chegada. */
  arrival: { attendanceId: string; nonce: number } | null
  attention: AnjoAttention
  primeAudio: () => void
}

/** Título da aba do navegador com atendimento novo (o mesmo de antes, quando a área tinha página própria). */
export const NEW_ATTENDANCE_TITLE = "• Novo atendimento — INIA"
const NO_ATTENTION: AnjoAttention = { attendances: 0, unread: 0, awaitingResponse: false }
const ARMED_KEY = "inia:anjo-workspace-armed"
/** Leitura do estado sem conexão: a cada minuto (e ao voltar para a aba do navegador). */
const PEEK_INTERVAL_MS = 60_000

const DISABLED: AnjoWorkspaceContextValue = {
  anjo: null,
  blocked: false,
  reconnecting: false,
  sessionEnded: false,
  refresh: () => {},
  applyAnjo: () => {},
  clockOffsetMs: 0,
  available: false,
  armed: false,
  arm: () => {},
  areaVisible: false,
  setAreaVisible: () => {},
  presence: null,
  arrival: null,
  attention: NO_ATTENTION,
  primeAudio: () => {},
}

const AnjoWorkspaceContext = createContext<AnjoWorkspaceContextValue>(DISABLED)

export const useAnjoWorkspace = () => useContext(AnjoWorkspaceContext)

const noSubscription = () => () => {}

function readArmed(): boolean {
  try {
    return window.sessionStorage.getItem(ARMED_KEY) === "1"
  } catch {
    return false
  }
}

/** O que pede atenção, a partir da visão do servidor. */
export function attentionOf(anjo: AnjoView | null): AnjoAttention {
  if (!anjo) return NO_ATTENTION
  return {
    attendances: anjo.attendances.length,
    unread: anjo.attendances.reduce((total, attendance) => total + attendance.unreadCount, 0),
    awaitingResponse: anjo.attendances.some((attendance) => attendance.firstAnjoMessageAt === null),
  }
}

export function AnjoWorkspaceProvider({ available, children }: { available: boolean; children: ReactNode }) {
  const [armedNow, setArmedNow] = useState(false)
  // A marca da sessão da aba só existe no cliente (no servidor e na hidratação, desligada).
  const armedBefore = useSyncExternalStore(noSubscription, readArmed, () => false)
  const armed = available && (armedNow || armedBefore)
  const arm = useCallback(() => {
    setArmedNow(true)
    try {
      window.sessionStorage.setItem(ARMED_KEY, "1")
    } catch {
      // Sem armazenamento da aba: liga só até recarregar.
    }
  }, [])

  const chimeRef = useRef<Chime | null>(null)
  const stopBlinkRef = useRef<(() => void) | null>(null)
  const [arrival, setArrival] = useState<AnjoWorkspaceContextValue["arrival"]>(null)
  const [areaVisible, setAreaVisible] = useState(false)

  useEffect(() => {
    if (!available || !armed) return
    const chime = createChime()
    chimeRef.current = chime
    // O navegador só deixa tocar depois de um gesto: o primeiro clique ou tecla em qualquer tela prepara o som.
    const stopPriming = primeChimeOnFirstGesture(chime)
    return () => {
      stopPriming()
      stopBlinkRef.current?.()
      stopBlinkRef.current = null
      chime.dispose()
      chimeRef.current = null
    }
  }, [available, armed])

  const onNewAttendance = useCallback((attendanceIds: string[]) => {
    chimeRef.current?.play()
    stopBlinkRef.current?.()
    stopBlinkRef.current = blinkTabTitle(NEW_ATTENDANCE_TITLE)
    if (attendanceIds[0]) setArrival({ attendanceId: attendanceIds[0], nonce: Date.now() })
  }, [])

  const state = useAnjoWorkspaceState({ enabled: available && armed, onNewAttendance })

  // Sem a conexão ligada (ou com ela em outra aba do navegador): lê o estado, sem conectar, para o indicador; em serviço, liga a conexão.
  const [peek, setPeek] = useState<AnjoView | null>(null)
  const connectedHere = armed && !state.blocked
  useEffect(() => {
    if (!available || connectedHere) return
    let cancelled = false
    const read = () => {
      void fetchHumanSupportState({ wait: 0, workspace: "anjo-status" })
        .then((response) => {
          if (cancelled || !response.anjo) return
          setPeek(response.anjo)
          if (!armed && (response.anjo.presence.status !== "OFFLINE" || response.anjo.attendances.length > 0)) arm()
        })
        .catch(() => undefined)
    }
    read()
    const timer = setInterval(read, PEEK_INTERVAL_MS)
    const onVisible = () => {
      if (document.visibilityState === "visible") read()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      cancelled = true
      clearInterval(timer)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [available, armed, connectedHere, arm])

  // ENTREGUE do lado do Anjo: a conexão desta aba recebeu o estado com as mensagens novas (o contador e o som já avisam o Anjo) — vale
  // em qualquer tela, sem depender da área estar aberta. Lida continua sendo da área, com a conversa na tela.
  useEffect(() => {
    for (const attendance of state.anjo?.attendances ?? []) if (attendance.lastSeq > 0) acknowledgeOnce(attendance.requestId, { deliveredSeq: attendance.lastSeq })
  }, [state.anjo])

  // Mensagem nova do operador (o contador do servidor subiu) em qualquer tela: TODA mensagem toca o som, também com o atendimento na
  // tela (pedido do responsável em 11/11/2026); fora da vista, o título também pisca. O primeiro estado é só referência (recarregar não
  // toca nada).
  const previousUnreadRef = useRef<Map<string, number> | null>(null)
  useEffect(() => {
    const anjo = state.anjo
    if (!anjo) return
    const previous = previousUnreadRef.current
    const current = new Map(anjo.attendances.map((attendance) => [attendance.id, attendance.unreadCount]))
    previousUnreadRef.current = current
    if (!previous) return
    const grew = anjo.attendances.find((attendance) => attendance.unreadCount > (previous.get(attendance.id) ?? 0) && previous.has(attendance.id))
    if (!grew) return
    chimeRef.current?.play()
    if (pageIsSeen()) return
    stopBlinkRef.current?.()
    stopBlinkRef.current = blinkTabTitle(newMessageTitle(grew.operatorName))
  }, [state.anjo])

  const primeAudio = useCallback(() => chimeRef.current?.prime(), [])

  const value = useMemo<AnjoWorkspaceContextValue>(
    () => (available ? { ...state, available, armed, arm, areaVisible, setAreaVisible, presence: (connectedHere ? (state.anjo ?? peek) : peek)?.presence ?? null, arrival, attention: attentionOf(connectedHere ? state.anjo : peek), primeAudio } : DISABLED),
    [available, armed, connectedHere, arm, areaVisible, arrival, primeAudio, state, peek],
  )
  return <AnjoWorkspaceContext.Provider value={value}>{children}</AnjoWorkspaceContext.Provider>
}
