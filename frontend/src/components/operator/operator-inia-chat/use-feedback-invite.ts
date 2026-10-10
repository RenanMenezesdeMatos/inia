import { useEffect, useRef, useState } from "react"
import type { FeedbackWorkspace } from "../feedback-application/feedback-workspace-context"
import type { useFeedbackInviteQuery } from "@/queries/feedback-applications/use-feedback-applications"
import { postFeedbackInviteEvent } from "@/services/feedback-applications/feedback-applications-service"
import { feedbackSourceKey, type FeedbackInvite } from "@/schemas/feedback-applications/feedback-application.schema"

type UseFeedbackInviteInput = {
  workspace: FeedbackWorkspace | null
  refreshFeedbackQueries: () => void
  feedbackEnabled: boolean
  inviteQuery: ReturnType<typeof useFeedbackInviteQuery>
  conversationBusy: boolean
}

/**
 * Convite proativo para ouvir um feedback (um por vez): só no Acompanhamento do próprio colaborador e nunca durante uma
 * conversa em andamento (`conversationBusy`). Registra a oferta uma vez e guarda a decisão (ouvir, ler ou depois).
 */
export function useFeedbackInvite({ workspace, refreshFeedbackQueries, feedbackEnabled, inviteQuery, conversationBusy }: UseFeedbackInviteInput) {
  const [inviteBusy, setInviteBusy] = useState(false)
  const [dismissedInvites, setDismissedInvites] = useState<string[]>([])
  // Depois de agir num convite, nenhum outro aparece nesta sessão da tela: um clique duplo nunca resolve o PRÓXIMO convite, e
  // o colaborador não recebe uma fila de chamados em sequência (o próximo, se houver, aparece numa próxima visita).
  const [inviteActed, setInviteActed] = useState(false)
  const offeredInvitesRef = useRef(new Set<string>())

  /** Convite: "Ouvir agora" = o MESMO fluxo do botão do feed (dentro do clique). */
  function acceptInvite(invite: FeedbackInvite) {
    setInviteActed(true)
    void postFeedbackInviteEvent(invite.source, "ACCEPT").catch(() => undefined)
    setDismissedInvites((list) => [...list, feedbackSourceKey(invite.source)])
    workspace?.openFeedback({ source: invite.source, mode: "listen", title: invite.subject, periodLabel: invite.periodLabel, origin: "invite" })
  }

  /** Convite: "Ler feedback" = leva ao item no Acompanhamento e o abre, sem áudio (a aplicação não começa). */
  function readInvite(invite: FeedbackInvite) {
    setInviteActed(true)
    setDismissedInvites((list) => [...list, feedbackSourceKey(invite.source)])
    void postFeedbackInviteEvent(invite.source, "READ").catch(() => undefined).then(refreshFeedbackQueries)
    workspace?.readFeedback(invite.source)
  }

  /** Convite: "Depois" fica guardado no backend — o feedback continua no Acompanhamento e o convite não volta. */
  function snoozeInvite(invite: FeedbackInvite) {
    setInviteActed(true)
    setInviteBusy(true)
    setDismissedInvites((list) => [...list, feedbackSourceKey(invite.source)])
    void postFeedbackInviteEvent(invite.source, "SNOOZE").catch(() => undefined).then(() => { setInviteBusy(false); refreshFeedbackQueries() })
  }

  const invite = feedbackEnabled && !inviteActed && inviteQuery.data && !dismissedInvites.includes(feedbackSourceKey(inviteQuery.data.source)) ? inviteQuery.data : null
  const inviteVisible = invite !== null && !conversationBusy
  const inviteKey = invite ? feedbackSourceKey(invite.source) : null
  // Primeira exibição → OFFER (idempotente no backend; nunca áudio, nunca foco).
  useEffect(() => {
    if (!inviteVisible || !invite || !inviteKey || invite.offeredAt || offeredInvitesRef.current.has(inviteKey)) return
    offeredInvitesRef.current.add(inviteKey)
    void postFeedbackInviteEvent(invite.source, "OFFER").catch(() => offeredInvitesRef.current.delete(inviteKey))
  }, [inviteVisible, invite, inviteKey])

  return {
    inviteBusy, acceptInvite, readInvite, snoozeInvite, invite, inviteVisible,
  }
}
