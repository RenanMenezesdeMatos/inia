"use client"

import { forwardRef } from "react"
import { AlertCircle, CheckCircle2, Clock, Play, RotateCcw, Square, Volume2, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { RichContent } from "@/components/rich-content/rich-content"
import { cn } from "@/lib/utils"
import type { AvatarDelivery } from "@/schemas/inia-deliveries/inia-deliveries.schema"

/**
 * CONVITE DO RECADO (Workflow Output → Avatar). Chama a atenção sem bloquear: nenhum áudio antes do aceite. "Ouvir agora"
 * JÁ É o play — o clique inicia a fala do avatar (não existe segundo botão). O recado por escrito fica sempre disponível
 * ("Ler o recado"), para quem não pode ou não quer ouvir.
 */
export type RecadoPhase = "offer" | "starting" | "playing" | "done" | "failed" | "interrupted" | "snoozed"

const STATUS_TEXT: Record<RecadoPhase, string> = {
  offer: "Quando puder falar comigo, clique em Ouvir agora.",
  starting: "Preparando a voz da INIA…",
  playing: "A INIA está falando o recado.",
  done: "Recado entregue.",
  failed: "Não consegui reproduzir a voz agora.",
  interrupted: "Você parou o recado antes do fim — ele continua disponível.",
  snoozed: "Recado guardado para depois.",
}

type Props = {
  delivery: AvatarDelivery
  phase: RecadoPhase
  error: string | null
  highlighted?: boolean
  onAccept(): void
  onSnooze(): void
  onStop(): void
  onReplay(): void
  onDismiss(): void
  /** INIA no mudo: o recado "toca" sem som — o texto fica aberto para ler enquanto isso. */
  muted?: boolean
}

export const IniaRecadoInvite = forwardRef<HTMLButtonElement, Props>(function IniaRecadoInvite({ delivery, phase, error, highlighted = false, onAccept, onSnooze, onStop, onReplay, onDismiss, muted = false }, primaryRef) {
  const live = phase === "starting" || phase === "playing"
  if (phase === "snoozed") {
    return (
      <section aria-label="Recado da INIA" className="mx-4 mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2" data-testid="inia-recado">
        <Clock className="size-4 shrink-0 text-primary" aria-hidden />
        <p className="min-w-0 flex-1 text-xs"><span className="font-medium">Recado guardado:</span> {delivery.title}</p>
        <Button ref={primaryRef} type="button" size="sm" onClick={onAccept} className="rounded-full"><Play />Ouvir agora</Button>
      </section>
    )
  }
  return (
    <section
      aria-label="Recado da INIA"
      data-testid="inia-recado"
      className={cn("mx-4 mt-3 rounded-2xl border border-primary/40 bg-primary/10 p-3 shadow-sm transition-shadow", highlighted && "ring-2 ring-primary/60")}
    >
      <div className="flex items-start gap-3">
        <span className={cn("grid size-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground", live && "animate-pulse")} aria-hidden>
          {phase === "done" ? <CheckCircle2 className="size-5" /> : phase === "failed" ? <AlertCircle className="size-5" /> : <Volume2 className="size-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{phase === "done" ? "Recado entregue" : "Tenho um recado para você"}</p>
          <p className="truncate text-xs text-muted-foreground">{delivery.title}</p>
          <p className="mt-1 text-xs" role="status" aria-live="polite">{STATUS_TEXT[phase]}{error ? ` ${error}` : ""}</p>
        </div>
        {phase === "done" ? (
          <Button type="button" variant="ghost" size="icon-sm" onClick={onDismiss} aria-label="Fechar recado"><X /></Button>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {phase === "offer" ? (
          <>
            <Button ref={primaryRef} type="button" size="sm" onClick={onAccept} className="rounded-full"><Play />Ouvir agora</Button>
            <Button type="button" size="sm" variant="ghost" onClick={onSnooze} className="rounded-full">Depois</Button>
          </>
        ) : live ? (
          <Button type="button" size="sm" variant="outline" onClick={onStop} className="rounded-full"><Square className="fill-current" />Parar</Button>
        ) : phase === "done" ? (
          <Button type="button" size="sm" variant="outline" onClick={onReplay} className="rounded-full"><RotateCcw />Ouvir de novo</Button>
        ) : (
          <>
            <Button ref={primaryRef} type="button" size="sm" onClick={onAccept} className="rounded-full"><Play />{phase === "failed" ? "Tentar de novo" : "Ouvir de novo"}</Button>
            <Button type="button" size="sm" variant="ghost" onClick={onSnooze} className="rounded-full">Depois</Button>
          </>
        )}
      </div>
      {delivery.displayText ? (
        <details className="mt-2 text-sm" open={phase === "failed" || (muted && live) || undefined}>
          <summary className="cursor-pointer text-xs font-medium text-primary">Ler o recado</summary>
          <div className="mt-2 max-h-48 overflow-y-auto rounded-xl bg-card px-3 py-2"><RichContent text={delivery.displayText} /></div>
        </details>
      ) : null}
    </section>
  )
})
