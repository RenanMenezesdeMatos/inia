"use client"

import { useState } from "react"
import { Play } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { useAgentsQuery } from "@/queries/admin/use-agent-queries"
import { useRunAgentSimulationMutation } from "@/queries/admin/use-qa-lab-queries"
import { AGENT_TYPE_LABELS } from "@/schemas/admin/agent.schema"
import type { QaRun } from "@/schemas/admin/qa-lab.schema"

import { AiControls, type AiControlsValue } from "./ai-controls"
import { LiveRun } from "./live-run"
import { RunResult } from "./run-result"
import { PersonPicker } from "./test-data-pickers"

/** Teste isolado de Agent (Parte 11/12): só o agente — sem Orchestrator, sem Workflow, sem
 * efeitos, sem registro em agent_runs. */
export function AgentLab() {
  const agentsQuery = useAgentsQuery()
  const [agentId, setAgentId] = useState("")
  const [input, setInput] = useState("")
  const [withOperator, setWithOperator] = useState(false)
  const [operatorId, setOperatorId] = useState<string | null>(null)
  const [ai, setAi] = useState<AiControlsValue>({ aiPolicy: "REAL", maxAiCalls: null })
  const [result, setResult] = useState<QaRun | null>(null)
  const runMutation = useRunAgentSimulationMutation()

  const agent = agentsQuery.data?.find((candidate) => candidate.id === agentId) ?? null
  const canRun = Boolean(agentId && input.trim().length > 0 && !runMutation.isPending && (!withOperator || operatorId))

  async function handleRun() {
    const run = await runMutation.mutateAsync({ agentId, input: input.trim(), operatorId: withOperator ? operatorId : null, aiPolicy: ai.aiPolicy, maxAiCalls: ai.aiPolicy === "REAL" ? ai.maxAiCalls : null })
    setResult(run)
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="qa-agent-select">Agent</Label>
          {agentsQuery.isLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <Select value={agentId} onValueChange={setAgentId}>
              <SelectTrigger id="qa-agent-select" className="w-full">
                <SelectValue placeholder="Selecione o agente" />
              </SelectTrigger>
              <SelectContent>
                {(agentsQuery.data ?? []).map((candidate) => (
                  <SelectItem key={candidate.id} value={candidate.id}>
                    {candidate.name} · {AGENT_TYPE_LABELS[candidate.agentType]}
                    {!candidate.active ? " · inativo" : ""}
                    {/* PEN-047: não publicado não entra em produção, mas continua disponível para testes (o QA Lab usa o rascunho). */}
                    {!candidate.published ? " · não publicado (testa o rascunho)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {agent ? (
            <div className="flex flex-wrap gap-2 pt-1 text-xs">
              <Badge variant="secondary">{AGENT_TYPE_LABELS[agent.agentType]}</Badge>
              <Badge variant="outline">{agent.knowledgeDocuments.length} base(s) de conhecimento</Badge>
              {!agent.active ? <Badge variant="destructive">Inativo</Badge> : null}
            </div>
          ) : null}
          {agent ? <p className="text-xs text-muted-foreground">{agent.objective}</p> : null}
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="qa-agent-with-operator">Contexto de colaborador</Label>
            <Switch id="qa-agent-with-operator" checked={withOperator} onCheckedChange={setWithOperator} />
          </div>
          <p className="text-xs text-muted-foreground">
            Quando ligado, o agente recebe o mesmo contexto que um especialista recebe em produção (identidade, indicadores recentes, histórico de feedbacks do colaborador).
          </p>
          {withOperator ? <PersonPicker value={operatorId} onChange={(person) => setOperatorId(person?.id ?? null)} /> : null}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="qa-agent-input">Entrada</Label>
        <Textarea
          id="qa-agent-input"
          rows={7}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Transcrição, pergunta ou contexto que o agente deve analisar…"
        />
      </div>

      <AiControls value={ai} onChange={setAi} idPrefix="qa-agent" />

      <div className="flex justify-end">
        <Button disabled={!canRun} onClick={handleRun} className="gap-1">
          <Play className="h-4 w-4" />
          {runMutation.isPending ? "Executando…" : "Executar Agent"}
        </Button>
      </div>

      {result ? <LiveRun id={result.id} fallback={result}>{(current) => <RunResult run={current} />}</LiveRun> : null}
    </div>
  )
}
