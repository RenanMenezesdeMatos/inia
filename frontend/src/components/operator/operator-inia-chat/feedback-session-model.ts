import type { FeedbackOpenRequest } from "../feedback-application/feedback-workspace-context"
import type { FeedbackApplicationDetail, FeedbackSourceRef } from "@/schemas/feedback-applications/feedback-application.schema"

/** Áudio da apresentação de uma aplicação de feedback (mesma voz verificada, gerada uma vez no backend). */
export const presentationAudioKey = (applicationId: string) => ["feedback-applications", "presentation-audio", applicationId] as const

/** Assunto + período sem repetir quando o registro só tem o "quando" ("Atendimento de 29/09/2026"). */
export const feedbackLabel = (title: string, period: string | null) => (period && period !== title ? `${title} · ${period}` : title)

/** Reprodução da APRESENTAÇÃO (estado local do player) — nunca confundido com o estado da aplicação nem com a ciência. */
export type PresentationPhase = "idle" | "preparing" | "playing" | "blocked" | "failed" | "done"

/**
 * Aplicação de feedback aberta na SESSÃO (card central). `completed` = concluída: o registro original fica só para consulta e
 * novas dúvidas vão para a conversa COMPLEMENTAR (o backend decide e cria na primeira dúvida) — sem apresentação formal.
 */
export type FeedbackSession = { application: FeedbackApplicationDetail; completed: boolean; entry: SessionEntry }

/** Como a sessão começou — muda o que a INIA diz ao chegar: primeira aplicação, retomada ou revisão de uma concluída. */
export type SessionEntry = "first" | "resume" | "review"

export const ENTRY_OF_MODE: Record<FeedbackOpenRequest["mode"], SessionEntry> = { listen: "first", continue: "resume", view: "review" }

/** A chamada de atenção da INIA ao chegar (frase fixa do sistema — nunca fato do feedback). */
export const ENTRY_HEADLINE: Record<SessionEntry, string> = { first: "Agora vamos falar sobre isso.", resume: "Vamos continuar de onde paramos.", review: "Vamos rever este feedback." }

/** "do atendimento de 29/09/2026" · "de agosto de 2026" · "de 29/09/2026" — o período no meio de uma frase da INIA. */
export function periodPhrase(label: string): string {
  const lower = /^\d/.test(label) ? label : label.charAt(0).toLocaleLowerCase("pt-BR") + label.slice(1)
  return /^(atendimento|fechamento|resultado)\b/i.test(label) ? `do ${lower}` : `de ${lower}`
}

/** Ao chegar ela aponta para o feedback (o gesto da mão que fica do lado dele). */
export const PRESENT_GESTURE_DELAY_MS = 650

/**
 * Sinal da tela para a INIA abrir a aplicação AO VIVO — o MESMO literal do backend (`FEEDBACK_PRESENTATION_CUE`, em
 * feedback-application/domain/application-presentation.ts): na sessão de voz da aplicação, ela responde a ele falando o texto já
 * aprovado da apresentação. Nunca aparece na conversa nem é gravado.
 */
export const FEEDBACK_PRESENTATION_CUE = "[INICIAR_APRESENTACAO]"

/** Sem a fala ao vivo começar nesse tempo (rede, sessão), a apresentação segue pela voz preparada. */
export const LIVE_PRESENTATION_START_TIMEOUT_MS = 10_000

/** Eventos da sessão de voz que a apresentação ao vivo acompanha (a sessão é a mesma da conversa). */
export type LivePresentationHooks = { speaking: () => void; idle: () => void; interrupted: () => void; dropped: () => void }

/** Volta da conversa geral para o feedback (a aplicação nunca é concluída ao mudar de assunto). */
export type FeedbackReturn = { source: FeedbackSourceRef; title: string; periodLabel: string | null; reason: "CURRENT_RESULTS" }
