"use client"

import { useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { AI_CALL_ROLE_LABELS, type QaAiCall } from "@/schemas/admin/qa-lab.schema"
import { formatDuration, formatNumber } from "../qa-lab-format"
import { KnowledgeTracePanel } from "../knowledge-trace"

export function AiCallCard({ call }: { call: QaAiCall }) {
  const [open, setOpen] = useState(false)
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border border-border">
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {call.sequence}. {AI_CALL_ROLE_LABELS[call.role]}
            {call.agentName ? ` — ${call.agentName}` : ""}
          </p>
          <p className="text-xs text-muted-foreground">
            {call.model} · entrada {formatNumber(call.promptTokens)} · saída {formatNumber(call.outputTokens)} · total {formatNumber(call.totalTokens)} tokens · {formatDuration(call.durationMs)}
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
          {open ? "Ocultar" : "Ver contexto/prompt enviado"}
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 border-t border-border px-3 py-2">
        <p className="text-xs text-muted-foreground">Contexto/prompt enviado ao modelo — visível somente ao administrador global; segredos técnicos são redigidos antes de persistir.</p>
        {call.knowledge ? <KnowledgeTracePanel trace={call.knowledge} /> : null}
        <div>
          <p className="text-xs font-medium text-muted-foreground">Prompt final (system)</p>
          <pre className="mt-1 max-h-60 overflow-auto rounded-md bg-muted p-2 font-mono text-[11px] whitespace-pre-wrap">{call.systemPrompt}</pre>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">Entrada</p>
          <pre className="mt-1 max-h-40 overflow-auto rounded-md bg-muted p-2 font-mono text-[11px] whitespace-pre-wrap">{call.input}</pre>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">Resposta</p>
          <pre className="mt-1 max-h-60 overflow-auto rounded-md bg-muted p-2 font-mono text-[11px] whitespace-pre-wrap">{call.outputText ?? "—"}</pre>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
