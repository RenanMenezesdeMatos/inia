"use client"

import { useState } from "react"
import Link from "next/link"
import { History } from "lucide-react"

import { RichContent } from "@/components/rich-content/rich-content"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import { formatDateTime } from "@/lib/format/date"
import { useWorkflowExecutionAgentRecordsQuery } from "@/queries/admin/use-workflow-queries"
import type { FlowGraph } from "@/schemas/admin/workflow-graph.schema"
import { AGENT_RECORD_STATUS_LABELS, type WorkflowExecutionAgentRecord } from "@/schemas/admin/workflow-retry.schema"

import { agentVersionText, nodeLabelOf } from "./enrollment-format"

function AgentRecord({ record, graph }: { record: WorkflowExecutionAgentRecord; graph: FlowGraph | null }) {
  const step = nodeLabelOf(graph, record.nodeId)
  return (
    <li className="space-y-1 rounded-md border px-2 py-1.5" data-testid="execution-agent-record">
      <div className="flex flex-wrap items-center gap-1.5">
        {/* Agente inativo: identificado, mas sem caminho para o cadastro (PEN-071) — o histórico é só o deste contexto. */}
        {record.agentActive ? (
          <Link href={`/admin/agents/${record.agentId}`} className="font-medium underline-offset-2 hover:underline">
            {record.agentName}
          </Link>
        ) : (
          <>
            <span className="font-medium">{record.agentName}</span>
            <Badge variant="outline" className="border-amber-500/40 text-amber-800 dark:text-amber-300">
              Agente inativo
            </Badge>
          </>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {[agentVersionText(record.agentVersionNumber), AGENT_RECORD_STATUS_LABELS[record.status] ?? record.status, formatDateTime(record.createdAt), step ? `etapa “${step}”` : null]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {record.errorMessage ? <p className="text-xs text-destructive">{record.errorMessage}</p> : null}
      {record.outputText ? (
        <div className="max-h-40 overflow-y-auto rounded bg-muted/40 px-2 py-1">
          <RichContent text={record.outputText} />
        </div>
      ) : null}
    </li>
  )
}

/**
 * "Ver histórico desta execução" (PEN-071): as execuções de agente DESTA execução do Workflow — agente identificado mesmo
 * inativo e a versão usada. Nunca outras execuções do agente, o cadastro de um inativo nem as alterações dele.
 */
export function ExecutionHistoryPopover({ workflowId, enrollmentId, graph }: { workflowId: string; enrollmentId: string; graph: FlowGraph | null }) {
  const [open, setOpen] = useState(false)
  const recordsQuery = useWorkflowExecutionAgentRecordsQuery(workflowId, enrollmentId, open)
  const records = recordsQuery.data ?? []

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs">
          <History /> Ver histórico desta execução
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[26rem] max-w-[calc(100vw-2rem)]">
        <PopoverHeader>
          <PopoverTitle>Histórico desta execução</PopoverTitle>
          <PopoverDescription>Só as execuções de agente desta execução do Workflow, com a versão usada.</PopoverDescription>
        </PopoverHeader>
        {recordsQuery.isPending ? (
          <p className="text-xs text-muted-foreground">Carregando…</p>
        ) : recordsQuery.isError ? (
          <p className="text-xs text-destructive">Não foi possível carregar o histórico desta execução.</p>
        ) : records.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhum agente foi executado nesta execução.</p>
        ) : (
          <ul className="max-h-80 space-y-2 overflow-y-auto" data-testid="execution-agent-records">
            {records.map((record) => (
              <AgentRecord key={record.id} record={record} graph={graph} />
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}
