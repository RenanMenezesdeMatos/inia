"use client"

import { useInfiniteQuery } from "@tanstack/react-query"
import { Mic, MessageSquare } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { SupportHistorySection } from "@/components/human-support/operator/support-history-section"
import { Skeleton } from "@/components/ui/skeleton"
import { conversationLabel, conversationStatusLabel, lastActivityLabel } from "@/lib/realtime/conversation-format"
import { fetchOwnConversations, type ConversationSummary } from "@/lib/realtime/gemini-text-client"

const PAGE_SIZE = 20

/**
 * Conversas anteriores do PRÓPRIO colaborador (o backend só devolve as dele). Carrega ao abrir, pagina com "Carregar mais"
 * sem perder o que já está na lista, e distingue erro de lista vazia.
 */
export function IniaConversationHistorySheet({ open, onOpenChange, currentConversationId, onSelect }: { open: boolean; onOpenChange: (open: boolean) => void; currentConversationId: string | null; onSelect: (conversation: ConversationSummary) => void }) {
  // Sempre fresca ao abrir (a conversa atual acabou de mudar); nada fica em cache entre aberturas.
  const query = useInfiniteQuery({
    queryKey: ["inia-own-conversations"],
    queryFn: ({ pageParam }) => fetchOwnConversations(pageParam, PAGE_SIZE),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
    enabled: open,
    staleTime: 0,
    gcTime: 0,
  })
  const items = (query.data?.pages ?? []).flatMap((page) => page.items).filter((item, index, list) => list.findIndex((other) => other.id === item.id) === index)
  const state = query.isPending ? "loading" : query.isError && !query.data ? "error" : "ready"

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 data-[side=right]:sm:max-w-md" data-usage-screen="followup.conversation_history">
        <SheetHeader className="border-b">
          <SheetTitle>Conversas com a INIA</SheetTitle>
          <SheetDescription>Suas conversas ficam guardadas aqui. As encerradas podem ser consultadas a qualquer momento.</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {state === "loading" ? (
            <div className="space-y-3" aria-label="Carregando conversas">{Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-16 w-full rounded-xl" />)}</div>
          ) : state === "error" ? (
            <div className="space-y-3 p-4 text-center" role="alert">
              <p className="text-sm text-destructive">Não foi possível carregar suas conversas.</p>
              <Button variant="outline" size="sm" onClick={() => void query.refetch()}>Tentar novamente</Button>
            </div>
          ) : items.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">Você ainda não tem conversas com a INIA.</p>
          ) : (
            <ul className="space-y-1" aria-label="Conversas anteriores">
              {items.map((item) => {
                const current = item.id === currentConversationId
                return (
                  <li key={item.id}>
                    <button type="button" onClick={() => onSelect(item)} className="w-full rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none" aria-current={current ? "true" : undefined}>
                      <div className="flex items-center gap-2">
                        <p className="min-w-0 flex-1 truncate text-sm font-medium">{conversationLabel(item)}</p>
                        <span className="shrink-0 text-xs text-muted-foreground">{lastActivityLabel(item.lastActivityAt)}</span>
                      </div>
                      <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
                        {item.lastMessage ? (item.lastMessage.channel === "voice" ? <Mic className="size-3 shrink-0" aria-label="Por voz" /> : <MessageSquare className="size-3 shrink-0" aria-hidden />) : null}
                        <span className="truncate">{item.lastMessage ? `${item.lastMessage.role === "assistant" ? "INIA: " : "Você: "}${item.lastMessage.preview}` : "Sem mensagens"}</span>
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        <Badge variant={item.status === "ACTIVE" ? "default" : "outline"} className="text-[10px]">{current ? (item.origin === "WORKFLOW" ? "Aberta agora" : "Conversa atual") : conversationStatusLabel(item)}</Badge>
                        {item.unread ? <Badge variant="secondary" className="text-[10px]">Nova</Badge> : null}
                        <span className="text-[11px] text-muted-foreground">{item.messageCount} {item.messageCount === 1 ? "mensagem" : "mensagens"}</span>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          {state === "ready" && query.hasNextPage ? (
            <div className="p-3 text-center">
              <Button variant="ghost" size="sm" onClick={() => void query.fetchNextPage()} disabled={query.isFetchingNextPage}>{query.isFetchingNextPage ? "Carregando…" : "Carregar mais conversas"}</Button>
              {query.isFetchNextPageError ? <p className="mt-1 text-xs text-destructive" role="alert">Não foi possível carregar mais conversas.</p> : null}
            </div>
          ) : null}
          {/* Apoio com Anjo: os pedidos da própria pessoa (somente leitura), separados das conversas com a INIA. */}
          <div className="mt-4 border-t pt-3"><SupportHistorySection /></div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
