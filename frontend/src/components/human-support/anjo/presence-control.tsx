"use client"

import { useState, type ReactNode } from "react"
import { CalendarClock, ChevronDown, CircleStop, Pause, Play, Timer, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { describeElapsed, formatElapsed, formatShortDateTime } from "@/lib/format/date"
import { PAUSE_REASON_LABELS, PAUSE_REASONS, PRESENCE_STATUS_LABELS, type PauseReason } from "@/schemas/human-support/catalogs.schema"
import type { AnjoView } from "@/schemas/human-support/state.schema"
import { cancelScheduledAnjoPresence, changeAnjoPresence, type PresenceChange } from "@/services/human-support/human-support-service"
import { IconBadge, toneSurface } from "@/components/ui/surface"
import { cn } from "@/lib/utils"

import { PAUSE_REASON_ICONS, presenceIcon, STATUS_TONE } from "./presence-icons"
import { useElapsed } from "./use-clock"

/**
 * ESTADO DECLARADO DO ANJO (design_draft.md seção 6), em duas partes que não se confundem:
 *  - o ESTADO ATUAL, só leitura: ícone tingido, "Seu estado" e o nome do estado (em pausa, com o motivo e o ícone dele) e, quando faz
 *    sentido (Disponível ou Em pausa), o cronômetro de há quanto tempo o Anjo está nele, contado de `presence.since` — a última troca
 *    REAL de estado ou de motivo gravada no servidor, pelo relógio do servidor; atualizar a página ou trocar de aba não o reinicia.
 *    Indisponível não tem cronômetro nem "desde" (nem o espaço deles);
 *  - as AÇÕES, num grupo "Mudar estado": Indisponível → "Ficar disponível"; Disponível → "Pausa" ▸ motivo ou "Ficar indisponível"; Em
 *    pausa → "Voltar", "Trocar pausa" ▸ motivo ou "Ficar indisponível". "Ficar indisponível" é vermelho, com o ícone de parada.
 * O menu de pausas abre para baixo (o do kit, em portal: nunca é cortado pelo cartão; com pouco espaço, o Radix o reposiciona e ele
 * rola por dentro), com ícone e nome de cada motivo real do catálogo e a opção atual marcada; teclado, foco, Escape e clique fora são
 * do Radix, e a animação do kit respeita a redução de movimento. Cada ação grava no servidor e a tela passa a mostrar a área que ele
 * devolve; as recusas (atendimento em andamento, sem escopo ligado…) chegam já em texto legível — nenhuma confirmação a mais. O motivo
 * da pausa nunca chega ao operador.
 *
 * MUDANÇA PROGRAMADA (migration 188): com atendimento em andamento, pausa (estando Disponível) e "Ficar indisponível" não mudam o
 * estado — o servidor PROGRAMA a mudança, o Anjo deixa de receber chamados na hora e ela entra ao terminar o último atendimento. Os
 * botões dizem "Programar…", a faixa "Programado" mostra o que vai entrar, com "Cancelar programação"; escolher outro motivo ou
 * Indisponível altera a programação. O estado e o cronômetro continuam os atuais até a mudança entrar (contam da transição real).
 */
export type PresenceControlProps = {
  presence: AnjoView["presence"]
  onApplyAnjo: (anjo: AnjoView) => void
  /** Chamado no clique em "Ficar disponível"/"Voltar" (gesto da pessoa): prepara o som do atendimento novo. */
  onPrimeAudio?: () => void
  /** Diferença entre o relógio do servidor e o desta tela (ms): o cronômetro conta pelo servidor. */
  clockOffsetMs?: number
  /** Ao lado do estado (ex.: "Atendimentos agora"). */
  aside?: ReactNode
  /** Atendimentos em andamento: com algum, pausa e indisponibilidade são programadas. */
  activeAttendances?: number
}

export function PresenceControl({ presence, onApplyAnjo, onPrimeAudio, clockOffsetMs = 0, aside, activeAttendances = 0 }: PresenceControlProps) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (action: () => Promise<AnjoView>) => {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      onApplyAnjo(await action())
    } catch (failure) {
      setError(failure instanceof Error && failure.message ? failure.message : "Não foi possível mudar seu estado. Tente de novo.")
    } finally {
      setPending(false)
    }
  }
  const change = (next: PresenceChange) => run(() => changeAnjoPresence(next))
  const cancelScheduled = () => run(cancelScheduledAnjoPresence)
  const becomeAvailable = () => {
    onPrimeAudio?.()
    void change({ status: "AVAILABLE" })
  }
  const currentPause = presence.status === "PAUSED" ? presence.pauseReason : null
  const statusText = currentPause ? `${PRESENCE_STATUS_LABELS.PAUSED} · ${PAUSE_REASON_LABELS[currentPause]}` : PRESENCE_STATUS_LABELS[presence.status]
  const timed = presence.status !== "OFFLINE"
  const scheduled = presence.scheduled
  // Com atendimento em andamento: pausa (a partir de Disponível) e Indisponível ficam programadas.
  const schedulesPause = presence.status === "AVAILABLE" && activeAttendances > 0
  const schedulesOffline = presence.status !== "OFFLINE" && activeAttendances > 0
  const pauseLabel = presence.status === "PAUSED" ? "Trocar pausa" : schedulesPause ? (scheduled?.status === "PAUSED" ? "Alterar pausa programada" : "Programar pausa") : "Pausa"
  const scheduledText = scheduled ? (scheduled.status === "PAUSED" && scheduled.pauseReason ? `${PRESENCE_STATUS_LABELS.PAUSED} · ${PAUSE_REASON_LABELS[scheduled.pauseReason]}` : PRESENCE_STATUS_LABELS.OFFLINE) : null

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex min-w-0 items-center gap-3">
            <IconBadge icon={presenceIcon(presence.status, currentPause)} tone={STATUS_TONE[presence.status]} />
            <p className="min-w-0 leading-tight">
              <span className="block text-xs font-medium text-muted-foreground">Seu estado</span>
              <span role="status" aria-label={`Seu estado: ${statusText}`} className="block text-lg font-semibold" data-testid="presence-status">
                {statusText}
              </span>
            </p>
          </div>
          {timed ? <StatusTimer since={presence.since} clockOffsetMs={clockOffsetMs} /> : null}
        </div>
        {aside}
      </div>

      <div role="group" aria-label="Mudar estado" className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <span className="mr-1 text-xs font-medium text-muted-foreground" aria-hidden>
          Mudar estado
        </span>
        {presence.status === "OFFLINE" ? (
          <Button type="button" size="lg" disabled={pending} onClick={becomeAvailable}>
            <Play aria-hidden />
            Ficar disponível
          </Button>
        ) : null}
        {presence.status === "PAUSED" ? (
          <Button type="button" size="lg" disabled={pending} onClick={becomeAvailable}>
            <Play aria-hidden />
            Voltar
          </Button>
        ) : null}
        {presence.status !== "OFFLINE" ? (
          <PauseMenu
            label={pauseLabel}
            current={schedulesPause && scheduled?.status === "PAUSED" ? scheduled.pauseReason : currentPause}
            currentHint={schedulesPause && scheduled?.status === "PAUSED" ? "pausa programada" : "pausa atual"}
            disabled={pending}
            onPick={(reason) => void change({ status: "PAUSED", pauseReason: reason })}
          />
        ) : null}
        {presence.status !== "OFFLINE" && scheduled?.status !== "OFFLINE" ? (
          <Button type="button" variant="destructive" size="lg" className="border-destructive/40 font-semibold" disabled={pending} onClick={() => void change({ status: "OFFLINE" })}>
            <CircleStop aria-hidden />
            {schedulesOffline ? "Programar indisponível" : "Ficar indisponível"}
          </Button>
        ) : null}
      </div>
      {scheduled && scheduledText ? (
        <div role="status" aria-label={`Mudança programada: ${scheduledText}`} data-testid="presence-scheduled" className={cn(toneSurface("warning"), "-mt-1 flex flex-col gap-3 rounded-xl p-3 sm:flex-row sm:items-center sm:justify-between")}>
          <div className="flex min-w-0 items-start gap-3">
            <IconBadge icon={CalendarClock} tone="warning" size="sm" />
            <p className="min-w-0 text-sm leading-snug">
              <span className="block font-semibold">Programado: {scheduledText}</span>
              <span className="block text-muted-foreground">
                {activeAttendances > 1
                  ? `Entra quando terminar o último dos ${activeAttendances} atendimentos em andamento.`
                  : activeAttendances === 1
                    ? "Entra quando terminar o atendimento em andamento."
                    : "Entra em instantes."}{" "}
                Você não recebe novos atendimentos.
              </span>
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => void cancelScheduled()}>
            <X aria-hidden />
            Cancelar programação
          </Button>
        </div>
      ) : null}
      {!scheduled && schedulesOffline ? (
        <p className="-mt-2 text-xs text-muted-foreground">Com atendimento em andamento, {schedulesPause ? "a pausa e a indisponibilidade ficam programadas" : "a indisponibilidade fica programada"}: entram quando terminar o último, e você para de receber novos atendimentos na hora.</p>
      ) : null}
      {presence.status === "PAUSED" && !scheduled ? <p className="-mt-2 text-xs text-muted-foreground">Em pausa você não recebe novos atendimentos; os que estão abertos continuam.</p> : null}
      {error ? (
        <p role="alert" className="-mt-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}

type PauseMenuProps = { label: string; current: PauseReason | null; currentHint: string; disabled: boolean; onPick: (reason: PauseReason) => void }

/** Motivos de pausa: abre para baixo, ícone e nome de cada motivo, a pausa atual marcada (escolher a mesma não grava nada). */
function PauseMenu({ label, current, currentHint, disabled, onPick }: PauseMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="lg" disabled={disabled}>
          <Pause aria-hidden />
          {label}
          <ChevronDown data-icon="inline-end" aria-hidden className="transition-transform duration-200 group-aria-expanded/button:rotate-180 motion-reduce:transition-none" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="start" sideOffset={6} collisionPadding={16} className="w-auto min-w-64 p-1.5">
        <DropdownMenuLabel className="px-2 pt-1 pb-2 text-xs font-medium text-muted-foreground">Motivo da pausa</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={current ?? ""}
          onValueChange={(value) => {
            if (value !== current) onPick(value as PauseReason)
          }}
        >
          {PAUSE_REASONS.map((reason) => (
            <DropdownMenuRadioItem key={reason} value={reason} className="gap-3 rounded-lg py-1.5 pr-9 pl-1.5 data-[state=checked]:bg-primary/5 data-[state=checked]:font-semibold">
              <IconBadge icon={PAUSE_REASON_ICONS[reason]} tone={reason === current ? "warning" : "neutral"} size="sm" />
              <span className="flex-1">{PAUSE_REASON_LABELS[reason]}</span>
              {reason === current ? <span className="sr-only">({currentHint})</span> : null}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Cronômetro do estado atual (só ele redesenha a cada segundo), com o horário em que o estado começou. */
function StatusTimer({ since, clockOffsetMs }: { since: string; clockOffsetMs: number }) {
  const elapsed = useElapsed(since, clockOffsetMs)
  if (elapsed === null) return null
  const startedAt = formatShortDateTime(since)
  return (
    <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
      <span role="timer" aria-label={`Neste estado há ${describeElapsed(elapsed)}`} className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-sm font-semibold tabular-nums text-foreground" data-testid="presence-timer">
        <Timer className="size-3.5 text-muted-foreground" aria-hidden />
        {formatElapsed(elapsed)}
      </span>
      {startedAt ? <span>desde {startedAt}</span> : null}
    </span>
  )
}
