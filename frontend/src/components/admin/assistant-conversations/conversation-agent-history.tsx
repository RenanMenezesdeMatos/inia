"use client"

import { useState } from "react"
import { History } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import { Skeleton } from "@/components/ui/skeleton"
import { formatShortDateTime } from "@/lib/format/date"
import { useConversationAgentRecordsQuery } from "@/queries/admin/use-assistant-conversation-queries"
import { CONVERSATION_AGENT_OUTCOME_LABELS, CONVERSATION_AGENT_ROLE_LABELS, type ConversationAgentRecord } from "@/schemas/admin/assistant-conversation-agent-record.schema"

type InteractionGroup = { interactionId: string; occurredAt: string; orchestratorName: string | null; orchestratorVersionNumber: number | null; records: ConversationAgentRecord[] }

/** Uma resposta da INIA por grupo (na ordem da conversa), com o agente orquestrador antes dos especialistas. */
function groupByInteraction(records: ConversationAgentRecord[]): InteractionGroup[] {
  const groups = new Map<string, InteractionGroup>()
  for (const record of records) {
    const group = groups.get(record.interactionId) ?? { interactionId: record.interactionId, occurredAt: record.occurredAt, orchestratorName: null, orchestratorVersionNumber: null, records: [] }
    group.orchestratorName ??= record.orchestratorName
    group.orchestratorVersionNumber ??= record.orchestratorVersionNumber
    group.records.push(record)
    groups.set(record.interactionId, group)
  }
  for (const group of groups.values()) group.records.sort((a, b) => Number(b.role === "ORCHESTRATOR_AGENT") - Number(a.role === "ORCHESTRATOR_AGENT"))
  return [...groups.values()]
}

/** Nome do agente sempre em texto: este histórico nunca abre o cadastro do agente (inativo ou não). */
function AgentRecordItem({ record }: { record: ConversationAgentRecord }) {
  const outcomeVariant = record.outcome === "EXECUTED" ? "secondary" : "destructive"
  return (
    <li className="space-y-1" data-testid="conversation-agent-record" data-outcome={record.outcome}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-medium">{record.agentName}</span>
        <span className="text-xs text-muted-foreground">
          {CONVERSATION_AGENT_ROLE_LABELS[record.role]} · {record.agentVersionNumber ? `Versão ${record.agentVersionNumber}` : "versão não registrada"}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant={outcomeVariant}>{CONVERSATION_AGENT_OUTCOME_LABELS[record.outcome]}</Badge>
        {record.agentActive ? null : <Badge variant="outline">Agente inativo</Badge>}
      </div>
      {record.guidance ? <p className="text-xs text-muted-foreground">{record.guidance}</p> : null}
    </li>
  )
}

/**
 * "Ver histórico desta conversa" (PEN-071): os agentes que atuaram em cada resposta desta conversa, com a versão usada e, quando
 * a chamada foi impedida (agente inativo ou acesso não autorizado no contexto), o motivo e a orientação vindos do backend. Só na
 * leitura da gestão — o chat da própria pessoa nunca mostra este motivo.
 */
export function ConversationAgentHistory({ conversationId }: { conversationId: string }) {
  const [open, setOpen] = useState(false)
  const query = useConversationAgentRecordsQuery(conversationId, open)
  const groups = query.data ? groupByInteraction(query.data) : []

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="xs">
          <History /> Ver histórico desta conversa
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 max-w-[calc(100vw-2rem)]">
        <PopoverHeader>
          <PopoverTitle>Agentes nesta conversa</PopoverTitle>
          <PopoverDescription className="text-xs">Quem atuou em cada resposta da INIA e em qual versão. O motivo de uma chamada impedida aparece só aqui.</PopoverDescription>
        </PopoverHeader>
        {query.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : query.isError ? (
          <div className="space-y-2">
            <p className="text-xs text-destructive" role="alert">
              Não foi possível carregar o histórico desta conversa.
            </p>
            <Button type="button" variant="outline" size="xs" onClick={() => void query.refetch()}>
              Tentar novamente
            </Button>
          </div>
        ) : groups.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhum agente registrado nesta conversa.</p>
        ) : (
          <ol className="max-h-96 space-y-3 overflow-y-auto">
            {groups.map((group) => (
              <li key={group.interactionId} className="space-y-2 rounded-md border px-2.5 py-2">
                <p className="text-xs text-muted-foreground">
                  <time dateTime={group.occurredAt}>{formatShortDateTime(group.occurredAt)}</time>
                  {group.orchestratorName ? ` · ${group.orchestratorName}${group.orchestratorVersionNumber ? ` (Versão ${group.orchestratorVersionNumber})` : ""}` : ""}
                </p>
                <ul className="space-y-2">
                  {group.records.map((record) => (
                    <AgentRecordItem key={`${record.agentId}-${record.role}`} record={record} />
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </PopoverContent>
    </Popover>
  )
}
