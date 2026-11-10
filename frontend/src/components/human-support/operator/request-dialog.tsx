"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { CheckCircle2, CircleOff, Clock, HeartHandshake, Send, type LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ApiError } from "@/lib/api/api-client"
import { formatClockTime } from "@/lib/format/date"
import { HUMAN_SUPPORT_TEXT_LIMITS, SUPPORT_BUTTON_HINT } from "@/schemas/human-support/catalogs.schema"
import { AVAILABILITY_TEXT, waitEstimateText, type Availability, type OperatorRequestView } from "@/schemas/human-support/state.schema"
import { cn } from "@/lib/utils"
import { createSupportRequest, previewSupportRequest } from "@/services/human-support/human-support-service"
import { IconBadge, toneSurface, type Tone } from "@/components/ui/surface"
import { SharedContextCard, sharedContextSummary } from "./shared-context-card"

/**
 * JANELA DE PEDIDO DE APOIO (design_draft.md seções 9 e 14; CUJ 1, 3 e 4): prévia da cópia da troca (exatamente o que o Anjo vai
 * receber), a nota (até 2000 caracteres), a disponibilidade, a espera estimada e o prazo da fila. "Pedir ajuda" fica desabilitado
 * sem Anjo em serviço — a tentativa já foi registrada pela prévia (D4) — e é habilitado se um Anjo entrar em serviço com a janela
 * aberta (a prévia é refeita a cada 15 s). A sugestão nunca cria pedido: só este botão cria.
 */
export type SupportSource = { interactionId?: string | null; ratingId?: string | null }

export function SupportRequestDialog({ source, onOpenChange, onCreated, onOpenRoom }: { source: SupportSource | null; onOpenChange: (open: boolean) => void; onCreated: (request: OperatorRequestView) => void; onOpenRoom: () => void }) {
  return (
    <Dialog open={source !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] gap-5 overflow-y-auto rounded-2xl sm:max-w-lg">
        <DialogHeader className="flex-row items-center gap-3 text-left">
          <IconBadge icon={HeartHandshake} />
          <div className="space-y-0.5">
            <DialogTitle className="text-lg">Falar com um Anjo</DialogTitle>
            <DialogDescription>{SUPPORT_BUTTON_HINT}.</DialogDescription>
          </div>
        </DialogHeader>
        {/* Uma chave por abertura: a prévia, a nota e a chave de idempotência nascem com a janela. */}
        {source ? <RequestForm key={`${source.interactionId ?? "botao"}:${source.ratingId ?? ""}`} source={source} onCreated={onCreated} onOpenRoom={onOpenRoom} onCancel={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function RequestForm({ source, onCreated, onOpenRoom, onCancel }: { source: SupportSource; onCreated: (request: OperatorRequestView) => void; onOpenRoom: () => void; onCancel: () => void }) {
  const [clientRequestId] = useState(() => crypto.randomUUID())
  const [note, setNote] = useState("")
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<{ message: string; alreadyOpen: boolean } | null>(null)
  const preview = useQuery({ queryKey: ["human-support", "preview", source.interactionId ?? null, source.ratingId ?? null], queryFn: () => previewSupportRequest(source), refetchInterval: 15_000, retry: false, gcTime: 0 })
  const availability = preview.data?.availability ?? null
  const canRequest = availability !== null && availability.status !== "DISABLED" && availability.status !== "NONE_IN_SERVICE"
  const queued = availability?.status === "ALL_BUSY" || availability?.status === "NONE_AVAILABLE"
  const estimate = queued ? waitEstimateText(availability?.estimate ?? null) : null

  const submit = async () => {
    if (!canRequest || creating) return
    setCreating(true)
    setError(null)
    try {
      onCreated(await createSupportRequest({ clientRequestId, interactionId: source.interactionId ?? null, ratingId: source.ratingId ?? null, ...(note.trim() ? { note: note.trim() } : {}) }))
    } catch (failure) {
      const alreadyOpen = failure instanceof ApiError && failure.code === "HUMAN_SUPPORT_REQUEST_ALREADY_OPEN"
      setError({ message: failure instanceof Error && failure.message ? failure.message : "Não foi possível pedir ajuda agora.", alreadyOpen })
      void preview.refetch()
    } finally {
      setCreating(false)
    }
  }

  if (preview.isError && !preview.data) {
    return (
      <div className="space-y-3 text-sm">
        <p role="alert" className="text-destructive">{preview.error instanceof Error && preview.error.message ? preview.error.message : "Não foi possível abrir o pedido de apoio agora."}</p>
        <DialogFooter><Button type="button" variant="ghost" onClick={onCancel}>Fechar</Button></DialogFooter>
      </div>
    )
  }
  if (!preview.data) return <p className="text-sm text-muted-foreground" role="status">Preparando o pedido…</p>

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">{sharedContextSummary(preview.data.sharedContext)}</p>
        <SharedContextCard context={preview.data.sharedContext} title="O que será compartilhado com o Anjo" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="support-note" className="text-sm font-medium">Nota para o Anjo <span className="font-normal text-muted-foreground">(opcional)</span></Label>
        <Textarea id="support-note" rows={3} value={note} maxLength={HUMAN_SUPPORT_TEXT_LIMITS.note} className="resize-none rounded-xl bg-card" placeholder="Conte o que você precisa resolver." onChange={(event) => setNote(event.target.value)} />
        <p className="text-right text-xs text-muted-foreground tabular-nums">{note.length}/{HUMAN_SUPPORT_TEXT_LIMITS.note}</p>
      </div>
      {availability ? <AvailabilityNotice availability={availability} estimate={estimate} queued={queued} /> : null}
      {error ? (
        <div role="alert" className="space-y-1 text-sm text-destructive">
          <p>{error.message}</p>
          {error.alreadyOpen ? <Button type="button" variant="link" size="sm" className="h-auto px-0" onClick={onOpenRoom}>Ver meu pedido de apoio</Button> : null}
        </div>
      ) : null}
      <DialogFooter className="gap-2 sm:gap-2">
        <Button type="button" variant="outline" className="h-10 rounded-full px-5" onClick={onCancel}>Cancelar</Button>
        <Button type="submit" className="h-10 rounded-full px-5" disabled={!canRequest || creating}>
          <Send />
          {creating ? "Pedindo…" : "Pedir ajuda"}
        </Button>
      </DialogFooter>
    </form>
  )
}

/** Disponibilidade com o tom do momento: pode receber (verde), vai para a fila (âmbar), ninguém em serviço (neutro). */
const AVAILABILITY_LOOK: Record<Availability["status"], { tone: Tone; icon: LucideIcon; iconClass: string }> = {
  AVAILABLE_NOW: { tone: "success", icon: CheckCircle2, iconClass: "text-emerald-700 dark:text-emerald-300" },
  ALL_BUSY: { tone: "warning", icon: Clock, iconClass: "text-amber-700 dark:text-amber-300" },
  NONE_AVAILABLE: { tone: "warning", icon: Clock, iconClass: "text-amber-700 dark:text-amber-300" },
  NONE_IN_SERVICE: { tone: "neutral", icon: CircleOff, iconClass: "text-muted-foreground" },
  DISABLED: { tone: "neutral", icon: CircleOff, iconClass: "text-muted-foreground" },
}

function AvailabilityNotice({ availability, estimate, queued }: { availability: Availability; estimate: ReturnType<typeof waitEstimateText> | null; queued: boolean }) {
  const look = AVAILABILITY_LOOK[availability.status]
  const Icon = look.icon
  return (
    <div className={cn(toneSurface(look.tone), "flex items-start gap-3 p-3 text-sm")} role="status" aria-live="polite">
      <Icon className={cn("mt-0.5 size-4 shrink-0", look.iconClass)} aria-hidden />
      <div className="min-w-0 space-y-0.5">
        <p className="font-medium">{AVAILABILITY_TEXT[availability.status]}</p>
        {estimate ? <p className="text-muted-foreground">{estimate.headline}{estimate.note ? <span className="block text-xs">{estimate.note}</span> : null}</p> : null}
        {queued && availability.queueDeadline ? <p className="text-muted-foreground">Seu pedido fica na fila até {formatClockTime(availability.queueDeadline)}.</p> : null}
      </div>
    </div>
  )
}
