"use client"

import { createContext, useContext } from "react"

import type { SpeechPlayback } from "@/lib/avatar/audio/types"
import { createSpeechPlayback } from "@/lib/avatar/audio/speech-playback"
import { createAvatarSpeechDriver, type AvatarSpeechDriver } from "@/lib/avatar/avatar-driver"
import { createSpeechLipsyncEngine } from "@/lib/avatar/lipsync/speech-lipsync-engine"
import type { SpeechLipsyncEngine } from "@/lib/avatar/lipsync/types"
import type { FeedbackApplicationAction, FeedbackSourceRef } from "@/schemas/feedback-applications/feedback-application.schema"

/**
 * ESPAÇO DE TRABALHO do Acompanhamento (feed + painel da INIA). Uma única sessão de conversa e de reprodução para o painel e
 * para a SESSÃO DE FEEDBACK (o card central):
 *   - UM motor de voz (reprodução + lip-sync + o driver que o avatar lê) — vive aqui, acima do chat, para o clique no feed
 *     poder liberar o áudio DENTRO do gesto;
 *   - UM chat montado (o shell decide desktop × mobile — nunca os dois; com o painel recolhido ele continua montado, oculto,
 *     para a sessão de feedback abrir sem redimensionar o feed);
 *   - pedidos de abertura de uma aplicação de feedback (feed e convite) entregues ao chat de forma síncrona quando ele está
 *     montado, ou guardados até ele montar.
 */
export type IniaVoiceEngine = { playback: SpeechPlayback; lipsync: SpeechLipsyncEngine; driver: AvatarSpeechDriver }

/** Construir não toca em Web Audio: o AudioContext só nasce no clique (`playback.prime()`). */
export function createIniaVoiceEngine(): IniaVoiceEngine {
  const playback = createSpeechPlayback()
  const lipsync = createSpeechLipsyncEngine()
  return { playback, lipsync, driver: createAvatarSpeechDriver({ playback, lipsync }) }
}

export type FeedbackOpenRequest = {
  /** Sequencial: dois cliques = dois pedidos (o chat recupera a MESMA aplicação nos dois). */
  id: number
  source: FeedbackSourceRef
  mode: FeedbackApplicationAction
  title: string
  periodLabel: string | null
  origin: "feed" | "invite" | "history"
}

export type FeedbackWorkspace = {
  voice: IniaVoiceEngine
  layout: "desktop" | "mobile" | null
  /** Feedback cuja aplicação está aberta na sessão (destaque no feed). */
  activeSourceKey: string | null
  setActiveSourceKey(key: string | null): void
  /** Chamado DENTRO do clique: libera o áudio e entrega o pedido ao chat (que abre a sessão de feedback). */
  openFeedback(input: Omit<FeedbackOpenRequest, "id">): void
  /** Pedido feito com o chat desmontado (painel recolhido): o chat o pega ao montar. */
  pendingRequest: FeedbackOpenRequest | null
  takePendingRequest(): FeedbackOpenRequest | null
  registerChat(handler: ((request: FeedbackOpenRequest) => void) | null): void
  /** "Ler feedback": leva ao item no Acompanhamento e o abre, sem áudio. */
  readFeedback(source: FeedbackSourceRef): void
  readTarget: { key: string; nonce: number } | null
  /** Devolve o foco ao botão VISÍVEL do feedback no Acompanhamento (sem rolar a página). `false` = não está na tela. */
  focusFeedbackTrigger(key: string): boolean
  /** Leva à conversa geral da INIA (painel recolhido abre; mobile rola até ela) — pedido explícito do colaborador. */
  revealChat(): void
  /** Painel da INIA oculto (desktop recolhido): o chat continua montado, sem sessão de voz ativa no painel. */
  chatHidden: boolean
}

export const FeedbackWorkspaceContext = createContext<FeedbackWorkspace | null>(null)

/** `null` fora do Acompanhamento (o chat continua funcionando com o seu próprio motor de voz). */
export function useFeedbackWorkspace(): FeedbackWorkspace | null {
  return useContext(FeedbackWorkspaceContext)
}
