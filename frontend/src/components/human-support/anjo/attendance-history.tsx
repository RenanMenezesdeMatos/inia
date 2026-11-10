"use client"

import { useEffect, useRef, useState } from "react"

import { CheckCircle2, ChevronRight, ClipboardCheck, MessagesSquare, Wrench } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { describeElapsed, formatShortDateTime } from "@/lib/format/date"
import { cn } from "@/lib/utils"
import { CLASSIFICATION_OUTCOME_LABELS, CLASSIFICATION_REASON_LABELS, CLASSIFICATION_TOOL_REASONS, END_CAUSE_LABELS } from "@/schemas/human-support/catalogs.schema"
import type { AnjoAttendanceHistory } from "@/schemas/human-support/state.schema"
import { fetchAnjoAttendanceHistory } from "@/services/human-support/human-support-service"

import { IconBadge, StatusChip, SURFACE_CARD, SectionLabel } from "@/components/ui/surface"
import { SupportMessageList } from "./support-message-list"
import { useAttendanceMessages } from "./use-attendance-messages"

/**
 * HISTÓRICO DOS PRÓPRIOS ATENDIMENTOS DO ANJO (D5; aba "Seus atendimentos" da área): a lista do servidor, com "Carregar mais" pelo
 * cursor; cada item mostra início e fim, a duração final (congelada: fim − início reais), como terminou e, quando classificado, o motivo
 * do encaminhamento, o resultado e a ferramenta/processo informados. "Ver conversa" abre a conversa SOMENTE PARA LEITURA (sem campo de
 * mensagem) — o servidor só devolve as mensagens até o fim do atendimento deste Anjo, e só enquanto a pessoa tiver o papel.
 * `reloadKey` muda quando um atendimento começa ou termina: a primeira página é lida de novo.
 */
type HistoryItem = AnjoAttendanceHistory["items"][number]

const errorText = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback)

export function AttendanceHistory({ reloadKey }: { reloadKey: string }) {
  const [items, setItems] = useState<HistoryItem[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const requestRef = useRef(0)

  useEffect(() => {
    const request = ++requestRef.current
    fetchAnjoAttendanceHistory()
      .then((page) => {
        if (request !== requestRef.current) return
        setItems(page.items)
        setNextCursor(page.nextCursor)
        setError(null)
      })
      .catch((failure: unknown) => {
        if (request === requestRef.current) setError(errorText(failure, "Não foi possível carregar o histórico."))
      })
      .finally(() => {
        if (request === requestRef.current) setLoaded(true)
      })
  }, [reloadKey, attempt])

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return
    const request = requestRef.current
    setLoadingMore(true)
    try {
      const page = await fetchAnjoAttendanceHistory(nextCursor)
      if (request !== requestRef.current) return
      setItems((current) => [...current, ...page.items.filter((item) => !current.some((known) => known.attendanceId === item.attendanceId))])
      setNextCursor(page.nextCursor)
      setError(null)
    } catch (failure) {
      setError(errorText(failure, "Não foi possível carregar mais atendimentos."))
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <section aria-labelledby="anjo-history-title" className="flex flex-col gap-3">
      <div className="space-y-1">
        <SectionLabel id="anjo-history-title" className="sr-only">
          Seus atendimentos
        </SectionLabel>
        <p className="text-sm text-muted-foreground">Releia as conversas que você atendeu enquanto tiver o papel de Anjo.</p>
      </div>
      {!loaded ? <p className="text-sm text-muted-foreground">Carregando o histórico…</p> : null}
      {loaded && items.length === 0 && !error ? <p className="text-sm text-muted-foreground">Você ainda não fez nenhum atendimento.</p> : null}
      {items.length > 0 ? (
        <ul className={cn(SURFACE_CARD, "divide-y divide-border overflow-hidden")}>
          {items.map((item) => (
            <li key={item.attendanceId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-muted/50">
              <div className="flex min-w-0 items-center gap-3">
                <IconBadge icon={!item.endedAt ? MessagesSquare : item.classified ? CheckCircle2 : ClipboardCheck} tone={!item.endedAt ? "info" : item.classified ? "success" : "warning"} size="sm" />
                <div className="min-w-0 space-y-0.5">
                <p className="text-sm">
                  <span className="font-medium">{item.operatorName}</span> <span className="font-mono text-xs text-muted-foreground">{item.protocol}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatShortDateTime(item.startedAt)}
                  {item.endedAt ? ` – ${formatShortDateTime(item.endedAt)}` : " · em andamento"}
                  {durationText(item.startedAt, item.endedAt)}
                  {item.endCause ? ` · ${END_CAUSE_LABELS[item.endCause] ?? item.endCause}` : ""}
                  {item.firstAnjoMessageAt === null ? " · sem resposta sua" : ""}
                </p>
                {item.classification ? (
                  <p className="text-xs text-muted-foreground">
                    <span className="text-foreground">{CLASSIFICATION_REASON_LABELS[item.classification.reason]}</span>
                    {" · "}
                    {CLASSIFICATION_OUTCOME_LABELS[item.classification.outcome]}
                    {item.classification.referenceTitle ? (
                      <span className="inline-flex items-center gap-1">
                        {" · "}
                        {CLASSIFICATION_TOOL_REASONS.includes(item.classification.reason) ? <Wrench className="size-3" aria-hidden /> : null}
                        {item.classification.referenceTitle}
                      </span>
                    ) : null}
                  </p>
                ) : null}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {item.endedAt ? <StatusChip tone={item.classified ? "success" : "warning"}>{item.classified ? "Classificado" : "Classificação pendente"}</StatusChip> : null}
                <HistoryConversation item={item} />
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
          <span>{error}</span>
          {items.length === 0 ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setAttempt((current) => current + 1)}>
              Tentar de novo
            </Button>
          ) : null}
        </div>
      ) : null}
      {nextCursor ? (
        <Button type="button" variant="outline" size="sm" className="w-fit rounded-full" disabled={loadingMore} onClick={() => void loadMore()}>
          {loadingMore ? "Carregando…" : "Carregar mais"}
        </Button>
      ) : null}
    </section>
  )
}

/** " · durou 12 min 4 s" — só com início e fim reais (duração final, congelada). */
function durationText(startedAt: string, endedAt: string | null): string {
  if (!endedAt) return ""
  const start = new Date(startedAt).getTime()
  const end = new Date(endedAt).getTime()
  if (Number.isNaN(start) || Number.isNaN(end)) return ""
  return ` · durou ${describeElapsed(Math.max(0, end - start))}`
}

function HistoryConversation({ item }: { item: HistoryItem }) {
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-8 rounded-full px-3" aria-label={`Ver a conversa de ${item.protocol}`}>
          Ver conversa
          <ChevronRight data-icon="inline-end" aria-hidden />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {item.operatorName} · <span className="font-mono text-sm">{item.protocol}</span>
          </DialogTitle>
          <DialogDescription>Somente leitura: a conversa até o fim do seu atendimento.</DialogDescription>
        </DialogHeader>
        {open ? <ReadOnlyThread item={item} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function ReadOnlyThread({ item }: { item: HistoryItem }) {
  const thread = useAttendanceMessages(item.requestId, null)
  return (
    <div className="flex flex-col gap-2">
      {thread.hasOlder ? (
        <Button type="button" variant="ghost" size="sm" className="w-fit" disabled={thread.loadingOlder} onClick={thread.loadOlder}>
          {thread.loadingOlder ? "Carregando…" : "Mensagens anteriores"}
        </Button>
      ) : null}
      {thread.loaded ? <SupportMessageList messages={thread.messages} operatorName={item.operatorName} attendanceStartedAt={item.startedAt} className="max-h-[28rem]" /> : <p className="text-sm text-muted-foreground">Carregando a conversa…</p>}
      {thread.error ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
          <span>{thread.error}</span>
          <Button type="button" variant="outline" size="sm" onClick={thread.retry}>
            Tentar de novo
          </Button>
        </div>
      ) : null}
    </div>
  )
}
