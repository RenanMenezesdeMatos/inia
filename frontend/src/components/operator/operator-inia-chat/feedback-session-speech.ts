import type { AvatarConversationState } from "@/lib/avatar/animation/types"
import type { FeedbackOpenRequest } from "../feedback-application/feedback-workspace-context"
import type { FeedbackSessionSpeech, FeedbackSessionStatus } from "../feedback-application/feedback-session-dialog"
import { formatDateTime } from "@/lib/format/date"
import { plainTextOf } from "@/lib/format/plain-text"
import type { FeedbackApplicationDetail } from "@/schemas/feedback-applications/feedback-application.schema"
import { ENTRY_HEADLINE, periodPhrase, type FeedbackSession, type PresentationPhase, type SessionEntry } from "./feedback-session-model"
import type { StageUtterance } from "./stage-speech"

type DescribeFeedbackSessionInput = {
  sessionApplication: FeedbackApplicationDetail | null
  feedbackOpening: { title: string; periodLabel: string | null; entry: SessionEntry } | null
  feedbackError: { message: string; request: FeedbackOpenRequest } | null
  feedbackCompleted: boolean
  presentationPhase: PresentationPhase
  feedbackSession: FeedbackSession | null
  presentationVoice: "live" | "prepared"
  conversationState: AvatarConversationState
  stageUtterance: StageUtterance | null
  micOpen: boolean
  textReplyPending: boolean
  liveTextReply: string | null
  stageGreeting: boolean
}

/**
 * O que a sessão de feedback mostra sobre si mesma — cabeçalho (assunto, "quando", publicação), estado da aplicação e o que a
 * INIA diz no balão — derivado só do estado do chat (nenhum efeito).
 */
export function describeFeedbackSession({ sessionApplication, feedbackOpening, feedbackError, feedbackCompleted, presentationPhase, feedbackSession, presentationVoice, conversationState, stageUtterance, micOpen, textReplyPending, liveTextReply, stageGreeting }: DescribeFeedbackSessionInput) {
  // Cabeçalho = o do feedback publicado (assunto + "quando"), o mesmo do Acompanhamento; sem ele, o registro da aplicação.
  const publishedHeading = sessionApplication?.content?.view?.heading ?? null
  const sessionTitle = publishedHeading?.title ?? sessionApplication?.title ?? feedbackOpening?.title ?? feedbackError?.request.title ?? "Feedback"
  const sessionPeriod = sessionApplication ? publishedHeading?.subtitle ?? sessionApplication.periodLabel : feedbackOpening?.periodLabel ?? feedbackError?.request.periodLabel ?? null
  const sessionMeta = [sessionPeriod && sessionPeriod !== sessionTitle ? sessionPeriod : null, sessionApplication?.publishedDay ? `publicado em ${sessionApplication.publishedDay}` : null].filter(Boolean).join(" · ") || null
  const sessionStatus: FeedbackSessionStatus = feedbackError
    ? { label: "Não foi possível abrir", tone: "error" }
    : !sessionApplication
      ? { label: "Abrindo…", tone: "pending" }
      : feedbackCompleted
        ? sessionApplication.acknowledgedAt
          ? { label: `Ciência confirmada em ${formatDateTime(sessionApplication.acknowledgedAt)}`, tone: "done" }
          : { label: `Aplicação concluída${sessionApplication.completedAt ? ` em ${formatDateTime(sessionApplication.completedAt)}` : ""}`, tone: "done" }
        : { label: "Em andamento", tone: "progress" }
  const heard = sessionApplication?.presentation.completedAt != null || presentationPhase === "done"
  // O que a INIA diz no balão ao lado dela: a chamada de atenção (como a sessão começou) e, embaixo, o momento da conversa.
  const sessionEntry: SessionEntry = feedbackSession?.entry ?? feedbackOpening?.entry ?? "first"
  const sessionWhen = sessionPeriod && sessionPeriod !== sessionTitle ? periodPhrase(sessionPeriod) : null
  const speechDetail = feedbackOpening
    ? "Estou abrindo o feedback…"
    : feedbackError
      ? feedbackError.message
      // A apresentação vem antes dos estados da conversa: ao vivo, ela também passa por "pensando" antes de soar.
      : presentationPhase === "preparing" ? (presentationVoice === "live" ? `Já vou te apresentar o feedback${sessionWhen ? ` ${sessionWhen}` : ""}. Ele está aqui ao lado.` : `Vou te apresentar o feedback${sessionWhen ? ` ${sessionWhen}` : ""}. Só um instante enquanto preparo a voz — ele já está aqui ao lado.`)
        : presentationPhase === "playing" ? `Estou apresentando o feedback${sessionWhen ? ` ${sessionWhen}` : ""}. Acompanhe ao lado.`
          : conversationState === "listening" ? "Estou ouvindo você…"
            : conversationState === "thinking" ? "Deixa eu pensar na resposta…"
              : conversationState === "speaking" ? "Respondendo…"
                : presentationPhase === "blocked" ? "O navegador não liberou o áudio. Leia comigo aqui ao lado ou tente de novo."
                  : presentationPhase === "failed" ? "Não consegui usar a voz agora. O feedback está escrito aqui ao lado."
                    : feedbackCompleted ? "Você já concluiu este feedback. Se ficou alguma dúvida, é só me perguntar — por texto ou voz."
                      : presentationPhase === "done" ? "Ficou alguma dúvida? Pode me perguntar por texto ou voz."
                        : sessionEntry === "resume" ? "O feedback está aqui ao lado. Pode me perguntar ou ouvir a apresentação de novo."
                          : "Leia comigo aqui ao lado. Quando quiser, eu apresento por voz."
  // O balão é o que ela está DIZENDO: a fala em andamento (no ritmo da voz, até pousar na conversa); a chegada, um aviso ou a
  // espera pela voz; ela ouvindo; ela pensando. Fora disso, sem balão — o estado continua em texto para leitor de tela.
  // A fala vai em texto corrido: a transcrição da voz ao vivo e a resposta escrita podem trazer Markdown (`**negrito**`, links),
  // que só a conversa renderiza.
  const say: FeedbackSessionSpeech = { kind: "say", headline: feedbackError ? "Não consegui abrir este feedback agora." : ENTRY_HEADLINE[sessionEntry], detail: speechDetail }
  const sessionSpeech: FeedbackSessionSpeech = stageUtterance
    ? { kind: "stream", key: stageUtterance.key, text: plainTextOf(stageUtterance.text), heardWords: stageUtterance.heard, ended: stageUtterance.ended, landOn: stageUtterance.landOn }
    : feedbackOpening || feedbackError || presentationPhase === "preparing" || presentationPhase === "blocked" || presentationPhase === "failed"
      ? say
      : micOpen
        ? { kind: "listening" }
        : conversationState === "thinking" || (textReplyPending && liveTextReply === null)
          ? { kind: "thinking" }
          : stageGreeting && conversationState === "idle" && presentationPhase === "idle" && liveTextReply === null
            ? say
            : { kind: "none" }

  return {
    sessionTitle, sessionMeta, sessionStatus, heard, speechDetail, sessionSpeech,
  }
}
