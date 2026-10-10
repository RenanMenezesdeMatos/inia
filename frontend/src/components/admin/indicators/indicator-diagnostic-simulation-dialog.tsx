"use client"

import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { RichContent } from "@/components/rich-content/rich-content"
import { InvestigationReport } from "@/components/diagnostics/investigation-report"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { useSimulateStrategyMutation, useSimulationOptionsQuery } from "@/queries/admin/use-indicator-diagnostic-strategy-queries"
import type { SimulationResult } from "@/schemas/admin/indicator-diagnostic-strategy.schema"

/**
 * "Testar diagnóstico": simula a estratégia pelo MESMO motor que o Workflow usa (investigação do indicador → mensagem ao
 * colaborador), com banco somente-leitura. Nada é enviado, publicado ou gravado. Por padrão a simulação PARA antes da IA (zero
 * tokens): resultado oficial, onde o resultado mudou (por assunto e por dia) e o que ficou sem suporte. Executar a IA — analisar
 * chamadas e compor a mensagem — é uma escolha explícita.
 */
const ABSTAIN_LABELS: Record<string, string> = {
  NOTHING_MATERIAL: "Nada material a comunicar",
  ALREADY_DELIVERED: "Os pontos já tinham sido comunicados",
  NO_ACTIONABLE_DIAGNOSIS: "A investigação não sustentou um diagnóstico acionável",
  NOTHING_TO_INVESTIGATE: "Nada a investigar",
  INVESTIGATION_NOT_FOUND: "Investigação não encontrada",
  NO_BRIEF: "Sem conteúdo para compor",
}
const abstainLabel = (reason: string | null) => (reason ? (ABSTAIN_LABELS[reason.split(":")[0]!] ?? reason) : "Sem mensagem")

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h4 className="text-sm font-semibold">{title}</h4>
      <div className="text-sm">{children}</div>
    </section>
  )
}

function SimulationReport({ result }: { result: SimulationResult }) {
  return (
    <div className="space-y-4" data-testid="simulation-report">
      <p className="text-xs text-muted-foreground">Estratégia v{result.strategy.version} ({result.strategy.status === "DRAFT" ? "rascunho" : "publicada"}) · nada foi enviado nem gravado.</p>
      <Block title="Resultado oficial">
        {result.officialResult.indicatorName} no período {result.officialResult.period}: {result.officialResult.value}
        {result.officialResult.target ? ` · meta ${result.officialResult.target}` : " · sem meta vigente"}
        {result.officialResult.comparison ? ` · ${result.officialResult.comparison}` : ""}
      </Block>
      {result.aiStoppedReason ? <p className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">{result.aiStoppedReason}</p> : null}
      {result.error ? <p className="text-sm text-destructive" role="alert">{result.error}</p> : null}
      {result.investigation ? (
        <Block title="Investigação">
          <div className="space-y-4 rounded-md border p-3"><InvestigationReport investigation={result.investigation} /></div>
        </Block>
      ) : null}
      {result.feedback ? (
        <Block title="O que o colaborador receberia">
          {result.feedback.disposition === "READY" && result.feedback.text ? <div className="rounded-md border p-3"><RichContent text={result.feedback.text} /></div> : <p className="text-muted-foreground">Nenhuma mensagem — {abstainLabel(result.feedback.reason)}.</p>}
          {result.feedback.supportMaterials.length > 0 ? <p className="mt-1 text-xs">Material de apoio: {result.feedback.supportMaterials.map((material) => material.title).join(" · ")}</p> : null}
        </Block>
      ) : null}
      <Block title="Uso de IA">
        {result.usage.requests === 0 ? "Nenhuma chamada de modelo." : `${result.usage.requests} chamada(s) · ${result.usage.totalTokens ?? "N/D"} tokens (${result.usage.promptTokens ?? "N/D"} de entrada, ${result.usage.outputTokens ?? "N/D"} de saída) · ${result.usage.models.join(", ")}`}
      </Block>
    </div>
  )
}

/** O período mostra quantos atendimentos o plano encontraria — sem atendimento, o teste só pode dizer "Nenhum atendimento". */
export function periodOptionLabel(entry: { periodLabel: string; interactions?: number }) {
  if (entry.interactions === undefined) return entry.periodLabel
  if (entry.interactions === 0) return `${entry.periodLabel} · sem atendimento`
  return `${entry.periodLabel} · ${entry.interactions} atendimento${entry.interactions === 1 ? "" : "s"}`
}

export function IndicatorDiagnosticSimulationDialog({ indicatorId, hasDraft, hasPublished, onClose }: { indicatorId: string; hasDraft: boolean; hasPublished: boolean; onClose: () => void }) {
  const [search, setSearch] = useState("")
  const debouncedSearch = useDebouncedValue(search.trim(), 300)
  const optionsQuery = useSimulationOptionsQuery(indicatorId, true, debouncedSearch)
  const simulate = useSimulateStrategyMutation()
  const [source, setSource] = useState<"DRAFT" | "PUBLISHED">(hasDraft ? "DRAFT" : "PUBLISHED")
  const [collaboratorId, setCollaboratorId] = useState("")
  const [measurementId, setMeasurementId] = useState("")
  const [agentId, setAgentId] = useState("")
  const [runAi, setRunAi] = useState(false)
  const [selectedCollaborator, setSelectedCollaborator] = useState<{ id: string; name: string; measurements: { id: string; periodLabel: string; interactions?: number }[] } | null>(null)
  const collaborators = useMemo(() => {
    const list = optionsQuery.data?.collaborators ?? []
    // A escolha feita continua no seletor mesmo quando uma nova busca não a traz.
    return selectedCollaborator && !list.some((entry) => entry.id === selectedCollaborator.id) ? [selectedCollaborator, ...list] : list
  }, [optionsQuery.data, selectedCollaborator])
  const measurements = selectedCollaborator?.measurements ?? []
  const ready = collaboratorId && measurementId && agentId

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Testar diagnóstico</DialogTitle>
          <DialogDescription>Simula a estratégia com dados reais, sem enviar feedback, sem Output e sem gravar nada.</DialogDescription>
        </DialogHeader>
        {optionsQuery.isPending ? <Skeleton className="h-32 w-full" /> : (
          <div className="grid gap-3 sm:grid-cols-2">
            {hasDraft && hasPublished ? (
              <div className="space-y-1 sm:col-span-2">
                <Label>Versão</Label>
                <Select value={source} onValueChange={(value) => setSource(value as "DRAFT" | "PUBLISHED")}>
                  <SelectTrigger className="w-full" aria-label="Versão"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DRAFT">Rascunho</SelectItem>
                    <SelectItem value="PUBLISHED">Publicada</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor={`simulation-search-${indicatorId}`}>Buscar colaborador</Label>
              <Input id={`simulation-search-${indicatorId}`} type="search" placeholder="Nome do colaborador" value={search} onChange={(event) => setSearch(event.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Colaborador</Label>
              <Select
                value={collaboratorId}
                onValueChange={(value) => {
                  setCollaboratorId(value)
                  setSelectedCollaborator(collaborators.find((entry) => entry.id === value) ?? null)
                  setMeasurementId("")
                }}
              >
                <SelectTrigger className="w-full" aria-label="Colaborador"><SelectValue placeholder="Escolha" /></SelectTrigger>
                <SelectContent>{collaborators.map((entry) => <SelectItem key={entry.id} value={entry.id}>{entry.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Período</Label>
              <Select value={measurementId} onValueChange={setMeasurementId} disabled={!collaboratorId}>
                <SelectTrigger className="w-full" aria-label="Período"><SelectValue placeholder="Escolha" /></SelectTrigger>
                <SelectContent>{measurements.map((entry) => <SelectItem key={entry.id} value={entry.id}>{periodOptionLabel(entry)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label>Agent que avalia os atendimentos</Label>
              <Select value={agentId} onValueChange={setAgentId}>
                <SelectTrigger className="w-full" aria-label="Agent"><SelectValue placeholder="Escolha" /></SelectTrigger>
                <SelectContent>{(optionsQuery.data?.agents ?? []).map((entry) => <SelectItem key={entry.id} value={entry.id}>{entry.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <label className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm sm:col-span-2">
              <span>
                Executar a IA
                <span className="block text-xs text-muted-foreground">Desligado: calcula resultado, motivo e amostra sem chamar modelo. Ligado: roda o Agent e o redator (consome tokens do provedor).</span>
              </span>
              <Switch checked={runAi} onCheckedChange={setRunAi} aria-label="Executar a IA" />
            </label>
            {collaborators.length === 0 ? <p className="text-xs text-muted-foreground sm:col-span-2">{debouncedSearch ? "Nenhum colaborador do seu escopo com esse nome tem medição deste indicador." : "Nenhum colaborador do seu escopo tem medição deste indicador."}</p> : null}
            <div className="flex justify-end sm:col-span-2">
              <Button disabled={!ready || simulate.isPending} onClick={() => simulate.mutate({ indicatorId, source, collaboratorId, measurementId, agentId, aiPolicy: runAi ? "REAL" : "STOP_BEFORE_AI" })}>
                {simulate.isPending ? "Testando..." : runAi ? "Executar teste com IA (consome tokens)" : "Executar teste sem IA"}
              </Button>
            </div>
          </div>
        )}
        {simulate.isError ? <p className="text-sm text-destructive" role="alert">{(simulate.error as Error).message}</p> : null}
        {simulate.data ? <SimulationReport result={simulate.data} /> : null}
      </DialogContent>
    </Dialog>
  )
}
