"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { formatShortDateTime } from "@/lib/format/date"
import { useHumanSupportState } from "@/queries/human-support/use-human-support-state"
import { REQUEST_STATUS_LABELS } from "@/schemas/human-support/catalogs.schema"
import type { MyRequests } from "@/schemas/human-support/state.schema"
import { fetchMySupportRequests, fetchSupportMessages } from "@/services/human-support/human-support-service"
import { SupportEvaluation } from "./support-evaluation"

/**
 * "Conversas anteriores › Apoio com Anjo" (somente leitura): os pedidos da própria pessoa, cada um com a conversa com o Anjo e, enquanto
 * a janela de 24 h estiver aberta, a avaliação.
 */
export function SupportHistorySection() {
  const { operator } = useHumanSupportState()
  const requests = useQuery({ queryKey: ["human-support", "mine"], queryFn: () => fetchMySupportRequests(null) })
  const [selected, setSelected] = useState<MyRequests["items"][number] | null>(null)
  const items = requests.data?.items ?? []
  if (!operator?.enabled && items.length === 0) return null
  return (
    <section className="space-y-2" aria-label="Apoio com Anjo">
      <p className="px-1 text-xs font-semibold text-muted-foreground">Apoio com Anjo</p>
      {requests.isLoading ? <p className="px-1 text-xs text-muted-foreground">Carregando…</p> : null}
      {!requests.isLoading && items.length === 0 ? <p className="px-1 text-xs text-muted-foreground">Nenhum pedido de apoio ainda.</p> : null}
      {items.map((item) => (
        <button key={item.id} type="button" className="w-full rounded-lg border px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => setSelected(item)}>
          <span className="font-medium">{item.protocol}</span> · {REQUEST_STATUS_LABELS[item.status]}
          <span className="block text-xs text-muted-foreground">{formatShortDateTime(item.createdAt)}{item.anjoName ? ` · ${item.anjoName}` : ""}</span>
        </button>
      ))}
      <Dialog open={selected !== null} onOpenChange={(open) => (open ? undefined : setSelected(null))}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
          <DialogHeader><DialogTitle>Apoio com Anjo · {selected?.protocol}</DialogTitle></DialogHeader>
          {selected ? <HistoryConversation requestId={selected.id} pending={operator?.pendingEvaluations.find((evaluation) => evaluation.requestId === selected.id) ?? null} /> : null}
        </DialogContent>
      </Dialog>
    </section>
  )
}

function HistoryConversation({ requestId, pending }: { requestId: string; pending: NonNullable<ReturnType<typeof useHumanSupportState>["operator"]>["pendingEvaluations"][number] | null }) {
  const messages = useQuery({ queryKey: ["human-support", "history", requestId], queryFn: () => fetchSupportMessages(requestId) })
  return (
    <div className="space-y-2 text-sm">
      {messages.isLoading ? <p className="text-muted-foreground">Carregando a conversa…</p> : null}
      {(messages.data?.messages ?? []).map((message) => (
        <p key={message.id} className={message.authorKind === "SYSTEM" ? "text-center text-xs text-muted-foreground" : "whitespace-pre-wrap"}>
          {message.authorKind === "SYSTEM" ? message.body : <><span className="font-medium">{message.authorName ?? (message.authorKind === "ANJO" ? "Anjo" : "Você")}: </span>{message.body}</>}
        </p>
      ))}
      {pending ? <SupportEvaluation pending={pending} /> : null}
    </div>
  )
}
