import type { AvatarConversationState } from "@/lib/avatar/animation/types"

/**
 * O que a INIA está fazendo numa resposta pela VOZ, só com o que a sessão informa de verdade: a pergunta saiu, uma consulta começou, a consulta
 * terminou. A etapa interna da consulta não chega até aqui (`/tool-call` responde de uma vez), por isso o rótulo dela é genérico.
 */
export const THINKING_LABEL = "Pensando…"
export const VOICE_CONSULTING_LABEL = "Consultando as informações…"
export const VOICE_PREPARING_LABEL = "Preparando resposta…"

export type VoiceActivity = {
  label: string | null
  toolsInFlight: number
  /** A resposta da consulta já está na conversa: o indicador acabou, mesmo com a fala ainda por começar. */
  answerShown: boolean
  /** Pergunta digitada esperando a sessão conectar: o "ocioso" da conexão não encerra o indicador. */
  connecting: boolean
}

export type VoiceActivityEvent =
  | { type: "TURN_SENT" }
  | { type: "STATE"; state: AvatarConversationState }
  | { type: "TOOL_STARTED" }
  | { type: "TOOL_FINISHED" }
  | { type: "ANSWER_SHOWN" }
  | { type: "RESET" }

export const NO_VOICE_ACTIVITY: VoiceActivity = { label: null, toolsInFlight: 0, answerShown: false, connecting: false }

export function nextVoiceActivity(current: VoiceActivity, event: VoiceActivityEvent): VoiceActivity {
  switch (event.type) {
    case "TURN_SENT":
      return { ...NO_VOICE_ACTIVITY, label: THINKING_LABEL, connecting: true }
    case "RESET":
      return NO_VOICE_ACTIVITY
    case "TOOL_STARTED":
      return { ...current, label: VOICE_CONSULTING_LABEL, toolsInFlight: current.toolsInFlight + 1, answerShown: false, connecting: false }
    case "TOOL_FINISHED": {
      const toolsInFlight = Math.max(0, current.toolsInFlight - 1)
      if (toolsInFlight > 0) return { ...current, toolsInFlight }
      return { ...current, toolsInFlight, label: current.answerShown ? null : VOICE_PREPARING_LABEL }
    }
    case "ANSWER_SHOWN":
      return { ...current, label: null, answerShown: true }
    case "STATE":
      if (event.state === "listening") return NO_VOICE_ACTIVITY
      if (event.state === "idle") return current.connecting ? current : NO_VOICE_ACTIVITY
      if (event.state === "speaking") return { ...current, connecting: false, label: current.toolsInFlight > 0 ? current.label : null }
      return { ...current, connecting: false }
  }
}

/**
 * O rótulo a mostrar agora, ou null. `fallback`: em "pensando" sem evento específico, o genérico honesto. Na sessão de feedback ele fica de fora,
 * porque o balão ao lado dela já mostra que está pensando.
 */
export function voiceActivityLabel(activity: VoiceActivity, state: AvatarConversationState, options: { fallback: boolean }): string | null {
  if (state === "speaking" || state === "listening") return null
  if (activity.answerShown && activity.toolsInFlight === 0) return null
  return activity.label ?? (state === "thinking" && options.fallback ? THINKING_LABEL : null)
}
