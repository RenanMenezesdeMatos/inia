"use client"

import { useEffect, useRef } from "react"
import { CheckCircle2, Clock, HeartHandshake, MessagesSquare, Star } from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatClockTime } from "@/lib/format/date"
import { useHumanSupportState } from "@/queries/human-support/use-human-support-state"
import { SUPPORT_BUTTON_LABEL } from "@/schemas/human-support/catalogs.schema"
import type { PendingEvaluation } from "@/schemas/human-support/state.schema"
import type { SupportSignal } from "@/schemas/operator/chat-rating.schema"
import { cn } from "@/lib/utils"
import { IconBadge, toneSurface } from "@/components/ui/surface"

/**
 * ENTRADAS DO APOIO no chat da INIA (design_draft.md seção 14): o selo do pedido aberto ("Apoio · Na fila até 14:35" / "Apoio · com
 * Ana" / "Apoio · encerrado — avalie") e a sugestão abaixo de uma mensagem com sinal. NÃO existe botão fixo (decisão do responsável
 * em 10/11/2026): o apoio só é oferecido depois que a pessoa tentou com a INIA — quando a resposta tem sinal (não encontrou, não
 * concluiu, ficou sem resposta) ou na descurtida com "Sim" (`dislike-form.tsx`). Nenhuma entrada cria pedido: o pedido nasce só no
 * "Pedir ajuda" da janela.
 */
/**
 * Avaliação ainda sem nenhuma resposta (nem "Sua dúvida foi resolvida?" nem estrelas). A já respondida continua alterável por 24 h
 * na sala e no histórico, mas não pede mais atenção: o selo "avalie" some.
 */
export const awaitingEvaluation = (evaluation: PendingEvaluation) => evaluation.current.resolved === null && evaluation.current.stars === null

/** `unread` = mensagens do Anjo que o operador ainda não viu (a sala fechada): o selo diz quantas. */
export function supportPillText(operator: ReturnType<typeof useHumanSupportState>["operator"], unread = 0): string | null {
  const open = operator?.openRequest
  if (open?.status === "WAITING") return open.queueExpiresAt ? `Apoio · Na fila até ${formatClockTime(open.queueExpiresAt)}` : "Apoio · Na fila"
  if (open?.status === "IN_PROGRESS") return `Apoio · com ${open.anjo?.name ?? "o Anjo"}${unread > 0 ? ` · ${unread === 1 ? "1 mensagem nova" : `${unread} mensagens novas`}` : ""}`
  if (operator?.pendingEvaluations.some(awaitingEvaluation)) return "Apoio · encerrado — avalie"
  return null
}

/** Selo do apoio na vista da INIA. Avisa (título da aba e um som curto, uma vez) quando um Anjo recebe o pedido com a aba oculta. */
export function SupportStatusPill({ onOpenRoom }: { onOpenRoom: () => void }) {
  const { operator, unreadFromAnjo } = useHumanSupportState()
  useAssignmentNotice(operator?.openRequest ?? null)
  const text = supportPillText(operator, unreadFromAnjo)
  if (!text) return null
  // Tom pelo estado: na fila (âmbar), em atendimento (verde), encerrado aguardando avaliação (primária).
  const status = operator?.openRequest?.status
  const tone = status === "WAITING" ? PILL_TONES.waiting : status === "IN_PROGRESS" ? PILL_TONES.live : PILL_TONES.evaluate
  const Icon = status === "WAITING" ? Clock : status === "IN_PROGRESS" ? MessagesSquare : Star
  return (
    <div className="px-5 pt-2">
      <Button type="button" variant="outline" size="sm" className={cn("h-8 rounded-full border text-xs font-medium shadow-none", tone)} onClick={onOpenRoom} data-testid="support-status-pill">
        <Icon className="size-3.5" />
        {text}
        {unreadFromAnjo > 0 && status === "IN_PROGRESS" ? <span className="size-2 rounded-full bg-primary" aria-hidden data-testid="support-pill-unread" /> : null}
      </Button>
    </div>
  )
}

const PILL_TONES = {
  waiting: "border-amber-700/20 bg-amber-50 text-amber-900 hover:bg-amber-100 hover:text-amber-950 dark:border-amber-400/25 dark:bg-amber-500/15 dark:text-amber-200 dark:hover:bg-amber-500/25",
  live: "border-emerald-700/20 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 hover:text-emerald-900 dark:border-emerald-400/25 dark:bg-emerald-500/15 dark:text-emerald-200 dark:hover:bg-emerald-500/25",
  evaluate: "border-primary/25 bg-primary/8 text-primary hover:bg-primary/15 hover:text-primary",
} as const

function useAssignmentNotice(open: { id: string; status: string; anjo: { name: string } | null } | null) {
  const previous = useRef<{ id: string; status: string } | null>(null)
  useEffect(() => {
    const before = previous.current
    previous.current = open ? { id: open.id, status: open.status } : null
    if (!open || !before || before.id !== open.id || before.status !== "WAITING" || open.status !== "IN_PROGRESS") return
    if (typeof document === "undefined" || !document.hidden) return
    const original = document.title
    document.title = `• ${open.anjo?.name ?? "Um Anjo"} recebeu seu pedido — INIA`
    playShortTone()
    const restore = () => {
      if (document.hidden) return
      document.title = original
      document.removeEventListener("visibilitychange", restore)
    }
    document.addEventListener("visibilitychange", restore)
    return () => document.removeEventListener("visibilitychange", restore)
  }, [open])
}

/** Som curto (Web Audio, sem arquivo). Navegador que bloqueia o som: fica só o título. */
function playShortTone() {
  try {
    const AudioContextClass = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextClass) return
    const context = new AudioContextClass()
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.frequency.value = 880
    gain.gain.setValueAtTime(0.08, context.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.35)
    oscillator.connect(gain).connect(context.destination)
    oscillator.start()
    oscillator.stop(context.currentTime + 0.35)
    oscillator.onended = () => void context.close()
  } catch {
    // Sem som: o título da aba já avisou.
  }
}

const SIGNAL_TEXT: Record<SupportSignal, string> = {
  KNOWLEDGE_NOT_FOUND: "A INIA não encontrou essa informação nas bases.",
  KNOWLEDGE_INSUFFICIENT: "A INIA não encontrou essa informação nas bases.",
  CONSULTATION_FAILED: "A INIA não conseguiu concluir a consulta.",
  SPECIALIST_BLOCKED: "A INIA não conseguiu concluir a consulta.",
  NO_REPLY: "A INIA não conseguiu responder.",
}

const SIGNAL_HINT = "Uma pessoa da equipe de apoio pode ajudar com essa dúvida."

/**
 * Sugestão abaixo de uma mensagem com sinal (calculado pelo servidor): um aviso com a ação principal "Falar com um Anjo" — um botão
 * que abre a janela do pedido (nada é criado no clique). Com pedido aberto: "Você já tem um pedido de apoio" e "Ver pedido".
 */
export function SupportSuggestion({ signals, onRequest, onOpenRoom }: { signals: readonly SupportSignal[]; onRequest: () => void; onOpenRoom: () => void }) {
  const { operator } = useHumanSupportState()
  if (!operator?.enabled || signals.length === 0) return null
  const open = Boolean(operator.openRequest)
  return (
    <div className={cn(toneSurface(open ? "neutral" : "info"), "ml-10 mr-1 flex flex-col gap-2.5 p-3")} data-testid="support-suggestion">
      <div className="flex min-w-0 items-start gap-3">
        <IconBadge icon={open ? CheckCircle2 : HeartHandshake} tone={open ? "neutral" : "info"} size="sm" />
        <div className="min-w-0 text-sm">
          <p className="font-medium text-foreground">{open ? "Você já tem um pedido de apoio." : SIGNAL_TEXT[signals[0]!]}</p>
          <p className="text-xs text-muted-foreground">{open ? "Acompanhe a conversa com o Anjo." : SIGNAL_HINT}</p>
        </div>
      </div>
      {open ? (
        <Button type="button" variant="outline" size="sm" className="ml-11 h-9 self-start rounded-full px-4" onClick={onOpenRoom}>
          <MessagesSquare />
          Ver pedido
        </Button>
      ) : (
        <Button type="button" size="sm" className="ml-11 h-9 self-start rounded-full px-4" aria-haspopup="dialog" onClick={onRequest}>
          <HeartHandshake />
          {SUPPORT_BUTTON_LABEL}
        </Button>
      )}
    </div>
  )
}
