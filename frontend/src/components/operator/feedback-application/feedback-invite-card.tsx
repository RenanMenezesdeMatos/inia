"use client"

import { BookOpenText, Clock, Play, Volume2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { FeedbackInvite } from "@/schemas/feedback-applications/feedback-application.schema"

/**
 * CONVITE PROATIVO da INIA para um feedback novo (um por vez). Chama a atenção sem interromper: nunca toca áudio, nunca abre
 * microfone e nunca move o foco — o destaque do painel só acontece depois de uma ação do colaborador. "Ouvir agora" usa o MESMO
 * fluxo do botão do feed; "Ler feedback" abre o conteúdo sem áudio; "Depois" é guardado no backend (não volta a convidar).
 */
export function FeedbackInviteCard({ invite, busy, onListen, onRead, onLater }: { invite: FeedbackInvite; busy: boolean; onListen(): void; onRead(): void; onLater(): void }) {
  return (
    <section aria-label="Convite da INIA" data-testid="feedback-invite" data-usage-entity-type={invite.source.kind} data-usage-entity-id={invite.source.id} className="mx-4 mt-3 rounded-2xl border border-primary/40 bg-primary/10 p-3 shadow-sm motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground" aria-hidden><Volume2 className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Tenho um feedback sobre {invite.subject}.</p>
          <p className="text-xs text-muted-foreground">Quando puder, posso conversar com você sobre ele.{invite.periodLabel ? ` · ${invite.periodLabel}` : ""}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={onListen} disabled={busy} className="rounded-full" data-usage-element="feedback.invite.listen"><Play aria-hidden />Ouvir agora</Button>
        <Button type="button" size="sm" variant="outline" onClick={onRead} disabled={busy} className="rounded-full" data-usage-element="feedback.invite.read"><BookOpenText aria-hidden />Ler feedback</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onLater} disabled={busy} className="rounded-full" data-usage-element="feedback.invite.later"><Clock aria-hidden />Depois</Button>
      </div>
    </section>
  )
}
