"use client"

import { useEffect, useState } from "react"
import { CalendarClock, Clock, LogOut, Timer, Users } from "lucide-react"

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { usePageSeen } from "@/hooks/use-page-seen"
import { ApiError } from "@/lib/api/api-client"
import { describeElapsed, formatElapsed, formatShortDateTime } from "@/lib/format/date"
import { cn } from "@/lib/utils"
import { SUPPORT_ROOM_NOTICE } from "@/schemas/human-support/catalogs.schema"
import type { AnjoAttendanceView, AnjoView, MessageView } from "@/schemas/human-support/state.schema"
import { acknowledgeOnce, useReadAcknowledgement } from "@/queries/human-support/receipt-acks"
import { useTypingSignal } from "@/queries/human-support/use-typing-signal"
import { closeSupportRequestAsAnjo } from "@/services/human-support/human-support-service"

import { StatusChip } from "@/components/ui/surface"
import { PeerTyping } from "../conversation/peer-typing"
import { lastSeqOf } from "../conversation/receipts"
import { AnjoComposer } from "./anjo-composer"
import { SharedContextCard } from "./shared-context-card"
import { SupportMessageList } from "./support-message-list"
import { useAttendanceMessages } from "./use-attendance-messages"
import { minutesSince, useElapsed } from "./use-clock"

/**
 * UM ATENDIMENTO EM ANDAMENTO NA ÁREA DO ANJO (design_draft.md seções 7, 10 e 14), na ordem em que o Anjo precisa ler:
 *  - cabeçalho: operador, protocolo, Grupo/Subgrupo e início; à direita, o "Tempo de atendimento" (desde `startedAt`, o início real
 *    deste atendimento gravado pelo servidor, contado pelo relógio do servidor — não é espera na fila, nem tempo de disponibilidade ou
 *    de pausa; cada atendimento tem o seu e atualizar a página não o reinicia) e "Sem resposta há N min" até a primeira mensagem;
 *  - em telas grandes, duas colunas: à esquerda o que o operador compartilhou (recolhível: recolhido, vira uma linha e o chat ocupa a
 *    largura toda), à direita a conversa, o campo de mensagem e os encerramentos. Em telas menores, uma coluna: o contexto começa
 *    recolhido para o campo de mensagem ficar à vista;
 *  - os dois encerramentos — "Encerrar: operador sem a INIA aberta" só depois de 5 min sem a INIA do operador chamar o servidor (o
 *    servidor confere de novo e responde 409 `HUMAN_SUPPORT_OPERATOR_PRESENT`). Depois de encerrar, a classificação (motivo e
 *    resultado) fica pendente na mesma aba.
 * Conversa como num aplicativo de mensagens (migration 184): "Fulano está digitando…", tiques de entregue e lido nas mensagens do
 * Anjo, e as mensagens do operador confirmadas como entregues ao chegar e como lidas quando este atendimento está na tela (`active`:
 * a aba dele E a aba "Atendimento" da área), com a janela em foco. Mensagens novas do operador que o Anjo ainda não viu na tela são
 * contadas (`onUnreadChange`) para a área sinalizar nas abas.
 */
export const OPERATOR_ABSENT_CLOSE_AFTER_MS = 5 * 60_000
const WIDE_SCREEN = "(min-width: 1024px)"

export type AttendancePaneProps = {
  attendance: AnjoAttendanceView
  now: number
  /** Diferença entre o relógio do servidor e o desta tela (ms): o tempo de atendimento conta pelo servidor. */
  clockOffsetMs?: number
  /** Este atendimento é o que está na tela (as outras abas ficam montadas, escondidas): só ele marca mensagens como lidas. */
  active?: boolean
  onApplyAnjo: (anjo: AnjoView) => void
  onRefresh: () => void
  /** Quantas mensagens do operador chegaram e ainda não estiveram na tela. */
  onUnreadChange?: (attendanceId: string, unread: number) => void
  /** O Anjo encerrou este atendimento (o servidor confirmou): a área leva o foco à classificação pendente. */
  onClosed?: (attendanceId: string) => void
}

export function AttendancePane({ attendance, now, clockOffsetMs = 0, active = true, onApplyAnjo, onRefresh, onUnreadChange, onClosed }: AttendancePaneProps) {
  const thread = useAttendanceMessages(attendance.requestId, attendance.lastSeq)
  const [contextOpen, setContextOpen] = useState(() => typeof window === "undefined" || typeof window.matchMedia !== "function" || window.matchMedia(WIDE_SCREEN).matches)
  const typing = useTypingSignal(attendance.requestId)
  const loadedSeq = lastSeqOf(thread.messages)
  // Entregue: as mensagens chegaram a esta tela (mesmo com a aba do atendimento escondida). Lida: só com ela na tela e em foco.
  useEffect(() => {
    if (loadedSeq > 0) acknowledgeOnce(attendance.requestId, { deliveredSeq: loadedSeq })
  }, [attendance.requestId, loadedSeq])
  useReadAcknowledgement(attendance.requestId, loadedSeq, active)
  const unread = useUnreadCount(thread.loaded, thread.messages, active)
  useEffect(() => {
    onUnreadChange?.(attendance.id, unread)
  }, [attendance.id, unread, onUnreadChange])
  useEffect(() => () => onUnreadChange?.(attendance.id, 0), [attendance.id, onUnreadChange])

  const typingShown = attendance.peerTypingMs !== null
  const startedAt = new Date(attendance.startedAt).getTime()
  const answeredHere = thread.messages.some((message) => message.authorKind === "ANJO" && new Date(message.occurredAt).getTime() >= startedAt)
  const awaitingFirstResponse = attendance.firstAnjoMessageAt === null && !answeredHere
  const waitingMinutes = minutesSince(attendance.startedAt, now)
  const absentSince = attendance.operatorAbsentSince ? new Date(attendance.operatorAbsentSince).getTime() : null
  const canCloseForAbsence = absentSince !== null && !Number.isNaN(absentSince) && now - absentSince > OPERATOR_ABSENT_CLOSE_AFTER_MS
  const closed = () => onClosed?.(attendance.id)

  return (
    <article aria-label={`Atendimento ${attendance.protocol}`} data-context={contextOpen ? "open" : "collapsed"} className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-lg font-semibold">{attendance.operatorName}</h2>
            <StatusChip tone="neutral" className="font-mono">
              {attendance.protocol}
            </StatusChip>
          </div>
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Users className="size-3.5" aria-hidden />
              Grupo: {attendance.teamName ?? "—"} · Subgrupo: {attendance.subteamName ?? "—"}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CalendarClock className="size-3.5" aria-hidden />
              Começou {formatShortDateTime(attendance.startedAt) || "—"}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {awaitingFirstResponse ? (
            <StatusChip tone="warning" icon={Clock} role="status">
              {waitingMinutes < 1 ? "Sem resposta há menos de 1 min" : `Sem resposta há ${waitingMinutes} min`}
            </StatusChip>
          ) : null}
          <AttendanceDuration startedAt={attendance.startedAt} clockOffsetMs={clockOffsetMs} />
        </div>
      </header>

      <div className={cn("grid gap-4", contextOpen && "lg:grid-cols-[minmax(17rem,22rem)_minmax(0,1fr)] xl:grid-cols-[minmax(18rem,26rem)_minmax(0,1fr)]")}>
        {/* Aberto em tela grande: o painel não define a altura da linha (fica absoluto dentro da coluna) e rola por dentro. */}
        <div className={cn("min-w-0", contextOpen && "lg:relative")}>
          <SharedContextCard context={attendance.sharedContext} open={contextOpen} onOpenChange={setContextOpen} className={cn(contextOpen && "lg:absolute lg:inset-0")} />
        </div>

        <section aria-label={`Conversa com ${attendance.operatorName}`} className="flex min-w-0 flex-col gap-3">
          {thread.hasOlder ? (
            <Button type="button" variant="ghost" size="sm" className="w-fit" disabled={thread.loadingOlder} onClick={thread.loadOlder}>
              {thread.loadingOlder ? "Carregando…" : "Mensagens anteriores"}
            </Button>
          ) : null}
          {thread.loaded ? (
            <SupportMessageList
              messages={thread.messages}
              operatorName={attendance.operatorName}
              attendanceStartedAt={attendance.startedAt}
              peerReceipts={attendance.peerReceipts}
              className="h-[min(30rem,56dvh)] lg:h-[clamp(24rem,calc(100dvh-25rem),40rem)]"
              scrollKey={typingShown ? attendance : null}
              after={<PeerTyping name={attendance.operatorName} typingMs={attendance.peerTypingMs} stamp={attendance} />}
            />
          ) : (
            <p className="flex h-[min(30rem,56dvh)] items-center justify-center rounded-2xl border border-border bg-muted/40 text-sm text-muted-foreground lg:h-[clamp(24rem,calc(100dvh-25rem),40rem)]">Carregando as mensagens…</p>
          )}
          {thread.error ? (
            <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
              <span>{thread.error}</span>
              <Button type="button" variant="outline" size="sm" onClick={thread.retry}>
                Tentar de novo
              </Button>
            </div>
          ) : null}

          <AnjoComposer
            requestId={attendance.requestId}
            onInput={typing.onInput}
            onSent={(message) => {
              typing.onSent()
              thread.addLocal(message)
            }}
            onStale={onRefresh}
          />

          <footer className="flex flex-col gap-2.5 border-t border-border pt-3">
            <div className="flex flex-wrap gap-2">
              <CloseAttendanceAction
                requestId={attendance.requestId}
                label="Encerrar atendimento"
                title="Encerrar este atendimento?"
                description={`O atendimento ${attendance.protocol} termina para você e para ${attendance.operatorName}. Em seguida, registre o motivo e o resultado na classificação.`}
                onApplyAnjo={onApplyAnjo}
                onRefresh={onRefresh}
                onClosed={closed}
              />
              <CloseAttendanceAction
                requestId={attendance.requestId}
                cause="OPERATOR_ABSENT"
                label="Encerrar: operador sem a INIA aberta"
                title="Encerrar por ausência do operador?"
                description={`${attendance.operatorName} está sem a INIA aberta há mais de 5 minutos. O atendimento ${attendance.protocol} termina e fica registrado que o operador não estava presente.`}
                disabled={!canCloseForAbsence}
                onApplyAnjo={onApplyAnjo}
                onRefresh={onRefresh}
                onClosed={closed}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {absentSince === null || Number.isNaN(absentSince)
                ? "“Encerrar: operador sem a INIA aberta” fica disponível quando o operador passa 5 min sem a INIA aberta."
                : canCloseForAbsence
                  ? `O operador está sem a INIA aberta desde ${formatShortDateTime(attendance.operatorAbsentSince!)}.`
                  : `O operador está sem a INIA aberta desde ${formatShortDateTime(attendance.operatorAbsentSince!)}. Você poderá encerrar por ausência a partir de ${formatShortDateTime(new Date(absentSince + OPERATOR_ABSENT_CLOSE_AFTER_MS).toISOString())}.`}
            </p>
            <p className="text-xs text-muted-foreground">{SUPPORT_ROOM_NOTICE}</p>
          </footer>
        </section>
      </div>
    </article>
  )
}

/**
 * "Tempo de atendimento" ao vivo, desde o início real do atendimento (relógio do servidor). Sem início confiável, diz isso em vez de
 * mostrar uma duração. Só este componente redesenha a cada segundo.
 */
export function AttendanceDuration({ startedAt, clockOffsetMs = 0 }: { startedAt: string; clockOffsetMs?: number }) {
  const elapsed = useElapsed(startedAt, clockOffsetMs)
  return (
    <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-3 py-1.5">
      <Timer className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <p className="leading-tight">
        <span className="block text-[0.7rem] font-medium text-muted-foreground">Tempo de atendimento</span>
        {elapsed === null ? (
          <span className="text-sm text-muted-foreground">Início não informado</span>
        ) : (
          <span role="timer" aria-label={`Tempo de atendimento: ${describeElapsed(elapsed)}`} className="text-base font-semibold tabular-nums" data-testid="attendance-timer">
            {formatElapsed(elapsed)}
          </span>
        )}
      </p>
    </div>
  )
}

/**
 * Mensagens do operador que chegaram e ainda não estiveram na tela. Base: o que já estava na conversa ao abrir a área (depois de
 * recarregar a página nada aparece como novo); a partir daí, tudo o que chega enquanto este atendimento não está na tela, com a janela
 * em foco, conta até ele voltar à tela.
 */
function useUnreadCount(loaded: boolean, messages: MessageView[], active: boolean): number {
  const seen = usePageSeen()
  const lastSeq = lastSeqOf(messages)
  const [seenSeq, setSeenSeq] = useState<number | null>(null)
  if (loaded && seenSeq === null) setSeenSeq(lastSeq)
  else if (loaded && seenSeq !== null && active && seen && lastSeq > seenSeq) setSeenSeq(lastSeq)
  if (seenSeq === null) return 0
  return messages.filter((message) => message.authorKind === "OPERATOR" && message.seq > seenSeq).length
}

type CloseAttendanceActionProps = {
  requestId: string
  cause?: "OPERATOR_ABSENT"
  label: string
  title: string
  description: string
  disabled?: boolean
  onApplyAnjo: (anjo: AnjoView) => void
  onRefresh: () => void
  onClosed?: () => void
}

/** Encerrar com confirmação. A janela só fecha quando o servidor confirma; a recusa (ex.: operador voltou) aparece nela. */
function CloseAttendanceAction({ requestId, cause, label, title, description, disabled, onApplyAnjo, onRefresh, onClosed }: CloseAttendanceActionProps) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirm = async () => {
    setPending(true)
    setError(null)
    try {
      const anjo = await closeSupportRequestAsAnjo(requestId, cause)
      setOpen(false)
      onApplyAnjo(anjo)
      onClosed?.()
    } catch (failure) {
      setError(failure instanceof Error && failure.message ? failure.message : "Não foi possível encerrar. Tente de novo.")
      if (failure instanceof ApiError && failure.status === 409) onRefresh()
    } finally {
      setPending(false)
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return
        setOpen(next)
        if (!next) setError(null)
      }}
    >
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" size="lg" disabled={disabled}>
          {cause ? null : <LogOut aria-hidden />}
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Voltar</AlertDialogCancel>
          <Button type="button" disabled={pending} onClick={() => void confirm()}>
            {pending ? "Encerrando…" : "Encerrar"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
