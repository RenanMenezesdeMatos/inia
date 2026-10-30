"use client"

import { useState } from "react"
import { Play } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { useOrchestratorsQuery } from "@/queries/admin/use-assistant-queries"
import { useRunOrchestratorSimulationMutation } from "@/queries/admin/use-qa-lab-queries"
import { ORCHESTRATOR_INVOCATION_MODE_LABELS } from "@/schemas/admin/assistant.schema"
import type { QaRun } from "@/schemas/admin/qa-lab.schema"

import { AiControls, type AiControlsValue } from "./ai-controls"
import { LiveRun } from "./live-run"
import { RunResult } from "./run-result"
import { PersonPicker } from "./test-data-pickers"

/** Teste isolado de Orchestrator (Parte 13/14): mesmo caminho do chat/voz e do node de
 * Workflow, sem gravar interação nem publicar nada. */
export function OrchestratorLab() {
  const orchestratorsQuery = useOrchestratorsQuery()
  const [orchestratorId, setOrchestratorId] = useState("")
  const [operatorId, setOperatorId] = useState<string | null>(null)
  const [instruction, setInstruction] = useState("")
  const [extraContext, setExtraContext] = useState("")
  const [invocationContext, setInvocationContext] = useState<"INTERACTIVE" | "WORKFLOW">("INTERACTIVE")
  const [ai, setAi] = useState<AiControlsValue>({ aiPolicy: "REAL", maxAiCalls: null })
  const [result, setResult] = useState<QaRun | null>(null)
  const runMutation = useRunOrchestratorSimulationMutation()

  const orchestrator = orchestratorsQuery.data?.find((candidate) => candidate.id === orchestratorId) ?? null
  const canRun = Boolean(orchestratorId && operatorId && instruction.trim().length > 0 && !runMutation.isPending)

  async function handleRun() {
    if (!operatorId) return
    const run = await runMutation.mutateAsync({
      orchestratorId,
      operatorId,
      instruction: instruction.trim(),
      extraContext: extraContext.trim() || undefined,
      invocationContext,
      aiPolicy: ai.aiPolicy,
      maxAiCalls: ai.aiPolicy === "REAL" ? ai.maxAiCalls : null,
    })
    setResult(run)
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="qa-orch-select">Orchestrator</Label>
            {orchestratorsQuery.isLoading ? (
              <Skeleton className="h-10 w-full" />
            ) : (
              <Select value={orchestratorId} onValueChange={setOrchestratorId}>
                <SelectTrigger id="qa-orch-select" className="w-full">
                  <SelectValue placeholder="Selecione o orquestrador" />
                </SelectTrigger>
                <SelectContent>
                  {(orchestratorsQuery.data ?? []).map((candidate) => (
                    <SelectItem key={candidate.id} value={candidate.id}>
                      {candidate.name}
                      {!candidate.active ? " · inativo" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          {orchestrator ? (
            <div className="space-y-1 text-xs">
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">{ORCHESTRATOR_INVOCATION_MODE_LABELS[orchestrator.invocationMode]}</Badge>
                <Badge variant="outline">Agent orquestrador: {orchestrator.orchestratorAgentName}</Badge>
                {!orchestrator.active ? <Badge variant="destructive">Inativo</Badge> : null}
              </div>
              <p className="text-muted-foreground">
                Agents disponíveis: {orchestrator.specialists.length > 0 ? orchestrator.specialists.map((specialist) => specialist.agentName).join(", ") : "nenhum especialista"}
              </p>
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="qa-orch-invocation">Contexto de invocação</Label>
            <Select value={invocationContext} onValueChange={(next) => setInvocationContext(next as "INTERACTIVE" | "WORKFLOW")}>
              <SelectTrigger id="qa-orch-invocation" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="INTERACTIVE">Como o chat/voz do operador chamaria</SelectItem>
                <SelectItem value="WORKFLOW">Como um node de Workflow chamaria</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Mesmo gate de produção: um orquestrador restrito a um contexto não roda no outro.</p>
          </div>
        </div>
        <PersonPicker value={operatorId} onChange={(person) => setOperatorId(person?.id ?? null)} label="Colaborador (quem estaria perguntando)" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="qa-orch-instruction">Pergunta / instrução</Label>
          <Textarea id="qa-orch-instruction" rows={5} value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="Ex.: Como está meu PRV este mês?" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="qa-orch-context">Contexto extra (opcional)</Label>
          <Textarea id="qa-orch-context" rows={5} value={extraContext} onChange={(event) => setExtraContext(event.target.value)} placeholder="Transcrição ou texto que um node de Workflow passaria como contexto…" />
        </div>
      </div>

      <AiControls value={ai} onChange={setAi} idPrefix="qa-orchestrator" />

      <div className="flex justify-end">
        <Button disabled={!canRun} onClick={handleRun} className="gap-1">
          <Play className="h-4 w-4" />
          {runMutation.isPending ? "Executando…" : "Executar Orchestrator"}
        </Button>
      </div>

      {result ? <LiveRun id={result.id} fallback={result}>{(current) => <RunResult run={current} />}</LiveRun> : null}
    </div>
  )
}
