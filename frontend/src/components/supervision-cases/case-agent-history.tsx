"use client"

import { useState } from "react"
import { History } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import { Skeleton } from "@/components/ui/skeleton"
import { formatDateTime } from "@/lib/format/date"
import { useCaseAgentRecordsQuery } from "@/queries/supervision-cases/use-case-agent-records-query"
import { describeRunVersion } from "@/schemas/admin/agent.schema"
import { CASE_AGENT_RUN_SOURCE_LABELS, CASE_AGENT_RUN_STATUS_LABELS, type CaseAgentRecord } from "@/schemas/supervision-cases/case-agent-record.schema"

/** Nome do agente sempre em texto: este histórico nunca abre o cadastro do agente (inativo ou não). */
function CaseAgentRecordItem({ record }: { record: CaseAgentRecord }) {
  return (
    <li className="space-y-1 rounded-md border px-2.5 py-2" data-testid="case-agent-record">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-medium">{record.agentName}</span>
        <span className="text-xs text-muted-foreground">
          {describeRunVersion(record)} · {CASE_AGENT_RUN_SOURCE_LABELS[record.source] ?? record.source}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant={record.status === "FAILED" ? "destructive" : "secondary"}>{CASE_AGENT_RUN_STATUS_LABELS[record.status]}</Badge>
        {record.agentActive ? null : <Badge variant="outline">Agente inativo</Badge>}
        <time className="text-xs text-muted-foreground" dateTime={record.createdAt}>
          {formatDateTime(record.createdAt)}
        </time>
      </div>
    </li>
  )
}

/**
 * "Ver histórico deste caso" (PEN-071): a(s) execução(ões) de agente que geraram o caso, com a versão usada e "Agente inativo"
 * quando o agente foi desativado depois — mesma visibilidade do caso, nada além dele.
 */
export function CaseAgentHistory({ caseId }: { caseId: string }) {
  const [open, setOpen] = useState(false)
  const query = useCaseAgentRecordsQuery(caseId, open)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm">
          <History /> Ver histórico deste caso
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)]">
        <PopoverHeader>
          <PopoverTitle>Agentes que geraram este caso</PopoverTitle>
          <PopoverDescription className="text-xs">Cada execução de agente ligada a este caso, com a versão usada.</PopoverDescription>
        </PopoverHeader>
        {query.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : query.isError ? (
          <div className="space-y-2">
            <p className="text-xs text-destructive" role="alert">
              Não foi possível carregar o histórico deste caso.
            </p>
            <Button type="button" variant="outline" size="xs" onClick={() => void query.refetch()}>
              Tentar novamente
            </Button>
          </div>
        ) : query.data.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhuma execução de agente registrada para este caso.</p>
        ) : (
          <ul className="max-h-80 space-y-2 overflow-y-auto">
            {query.data.map((record) => (
              <CaseAgentRecordItem key={record.id} record={record} />
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}
