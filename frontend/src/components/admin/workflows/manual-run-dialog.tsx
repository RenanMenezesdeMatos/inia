"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, CheckCircle2, CircleDashed, Loader2, Play, RotateCcw, XCircle } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { startUsageAction } from "@/lib/usage/usage-provider"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { AdminApiError } from "@/lib/admin/admin-api"
import { formatCivilDate } from "@/lib/format/date"
import { interventionHref } from "@/lib/interventions/intervention-href"
import { cn } from "@/lib/utils"
import { INTERVENTION_STATUS_LABELS } from "@/schemas/interventions/intervention.schema"
import { adminQueryKeys } from "@/queries/admin/admin-query-keys"
import {
  fetchManualRun,
  fetchManualRunCollaborators,
  fetchManualRunInfo,
  fetchManualRunInteractions,
  fetchManualRunMeasurements,
  requestManualRun,
} from "@/services/admin/workflow-service"
import { describeManualTrigger, type WorkflowDetail } from "@/schemas/admin/workflow.schema"
import {
  describeManualRunDelivery,
  MANUAL_RUN_STAGE_LABELS,
  MANUAL_RUN_WAITING_LABELS,
  type ManualRun,
  type ManualRunCollaborator,
} from "@/schemas/admin/workflow-manual-run.schema"
import { OUTPUT_SURFACE_LABELS } from "@/schemas/admin/workflow-graph.schema"

function formatDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date)
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  return minutes > 0 ? `${minutes} min ${String(seconds % 60).padStart(2, "0")} s` : `${seconds} s`
}

/** Uma chave por INTENÇÃO de disparo: nasce ao abrir o diálogo e ao pedir "Executar de novo". Duplo clique/retry
 * reenviam a MESMA chave (o backend devolve o mesmo disparo); nova execução = nova chave. */
function newIdempotencyKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

const TERMINAL_STAGES = new Set(["COMPLETED", "FAILED"])

const EVENT_LABELS: Record<string, string> = {
  manual_run_requested: "Execução manual solicitada",
  node_advanced: "Etapa concluída",
  action_executed: "Ação executada",
  condition_evaluated: "Condição avaliada",
  intervention_policy_evaluated: "Política de acompanhamento avaliada",
  orchestrator_executed: "Orquestrador executado",
  output_dispatched: "Saída entregue",
  human_review_requested: "Revisão humana solicitada",
  human_review_decided: "Revisão humana decidida",
  reliable_feedback_held_for_qa: "Feedback retido para o QA",
  wait_started: "Espera iniciada",
  wait_elapsed: "Espera encerrada",
  node_failed: "Falha nesta tentativa",
  flow_dead: "Execução encerrada com falha",
  flow_completed: "Execução concluída",
}

/** Superfícies dos Outputs da versão PUBLICADA — o que esta execução pode entregar de verdade. */
function publishedSurfaces(workflow: WorkflowDetail): string[] {
  const surfaces = new Set<string>()
  for (const node of workflow.publishedGraph?.nodes ?? []) {
    if (node.type === "output") for (const surface of node.config.surfaces) surfaces.add(surface)
  }
  return [...surfaces].map((surface) => OUTPUT_SURFACE_LABELS[surface as keyof typeof OUTPUT_SURFACE_LABELS] ?? surface)
}

function StageIcon({ stage }: { stage: ManualRun["execution"]["stage"] }) {
  if (stage === "COMPLETED") return <CheckCircle2 className="h-4 w-4 text-emerald-600" />
  if (stage === "FAILED") return <XCircle className="h-4 w-4 text-destructive" />
  if (stage === "WAITING") return <CircleDashed className="h-4 w-4 text-amber-600" />
  if (stage === "RETRYING") return <AlertTriangle className="h-4 w-4 text-amber-600" />
  return <Loader2 className="h-4 w-4 animate-spin text-primary" />
}

/** Estado REAL da execução (motor + entregas persistidas) — polling até concluir/falhar. */
function ManualRunStatus({ workflowId, runId, onShowExecutions, onShowResults }: { workflowId: string; runId: string; onShowExecutions: () => void; onShowResults: () => void }) {
  const queryClient = useQueryClient()
  const runQuery = useQuery({
    queryKey: [...adminQueryKeys.workflow(workflowId), "manual-runs", runId],
    queryFn: () => fetchManualRun(workflowId, runId),
    refetchInterval: (query) => {
      const stage = query.state.data?.execution.stage
      if (stage && TERMINAL_STAGES.has(stage)) return false
      return stage === "WAITING" ? 5000 : 2000
    },
  })
  const run = runQuery.data
  const stage = run?.execution.stage
  useEffect(() => {
    if (stage && TERMINAL_STAGES.has(stage)) {
      void queryClient.invalidateQueries({ queryKey: adminQueryKeys.workflowEnrollments(workflowId) })
      void queryClient.invalidateQueries({ queryKey: adminQueryKeys.workflowResults(workflowId) })
    }
  }, [stage, queryClient, workflowId])

  if (!run) return <p className="text-sm text-muted-foreground">Carregando o estado da execução…</p>
  const avatarPending = run.deliveries.some((delivery) => delivery.surface === "AVATAR" && delivery.status !== "DELIVERED")

  return (
    <div className="min-w-0 space-y-3" data-testid="manual-run-status">
      <div className="flex items-start gap-2 rounded-md border p-3">
        <StageIcon stage={run.execution.stage} />
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm font-medium">{MANUAL_RUN_STAGE_LABELS[run.execution.stage]}</p>
          {run.execution.stage === "WAITING" && run.execution.waitingFor ? <p className="text-xs text-muted-foreground">{MANUAL_RUN_WAITING_LABELS[run.execution.waitingFor]}</p> : null}
          {run.execution.currentNodeLabel && run.execution.stage !== "COMPLETED" ? <p className="text-xs text-muted-foreground">Nó atual: {run.execution.currentNodeLabel}</p> : null}
          {run.execution.lastError ? <p className="text-xs text-destructive">{run.execution.lastError}</p> : null}
          {run.execution.nextRetryAt ? <p className="text-xs text-muted-foreground">Nova tentativa às {formatDateTime(run.execution.nextRetryAt)}.</p> : null}
          <p className="text-xs text-muted-foreground">
            Versão {run.versionNumber} · solicitada por {run.requestedBy.name} em {formatDateTime(run.requestedAt)}
          </p>
        </div>
      </div>

      <div className="space-y-1">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Entregas registradas</p>
        {run.deliveries.length === 0 && run.interventions.length > 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma entrega de conteúdo — o resultado foram as intervenções da política (abaixo).</p>
        ) : run.deliveries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {run.execution.stage === "COMPLETED"
              ? "A execução terminou sem nenhuma entrega (o fluxo não chegou a um Output ou nada era entregável)."
              : run.execution.stage === "FAILED"
                ? "Nada foi entregue — a execução falhou antes de chegar a um Output."
                : run.execution.stage === "WAITING"
                  ? "Nada entregue ainda — a execução está parada aguardando uma decisão."
                  : "Nada entregue ainda — só a execução foi iniciada."}
          </p>
        ) : (
          <ul className="space-y-1 text-sm">
            {run.deliveries.map((delivery, index) => (
              <li key={`${delivery.surface}-${index}`}>{describeManualRunDelivery(delivery)}</li>
            ))}
          </ul>
        )}
        {avatarPending ? <p className="text-xs text-muted-foreground">No Avatar, o recado só conta como entregue depois que {run.collaborator.name} aceitar e a fala terminar.</p> : null}
      </div>

      {run.interventions.length > 0 ? (
        <div className="space-y-1" data-testid="manual-run-interventions">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Intervenções da política</p>
          <ul className="space-y-1 text-sm">
            {run.interventions.map((item) => (
              <li key={item.id}>
                <Link href={interventionHref(item.caseId, item.id)} className="underline-offset-2 hover:underline">
                  {item.typeName}
                </Link>{" "}
                <span className="text-muted-foreground">
                  · {INTERVENTION_STATUS_LABELS[item.status] ?? item.status} · responsável {item.responsibleName} · prazo {formatCivilDate(item.dueAt)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <details className="rounded-md border p-2 text-xs">
        <summary className="cursor-pointer text-muted-foreground">Linha do tempo ({run.execution.events.length} evento(s))</summary>
        <ol className="mt-2 space-y-1">
          {run.execution.events.map((event, index) => (
            <li key={`${event.eventType}-${index}`} className="flex gap-2">
              <span className="text-muted-foreground tabular-nums">{formatDateTime(event.createdAt)}</span>
              <span>{EVENT_LABELS[event.eventType] ?? event.eventType}</span>
              {event.nodeLabel ? <span className="text-muted-foreground">· {event.nodeLabel}</span> : null}
            </li>
          ))}
        </ol>
      </details>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onShowExecutions}>
          Ver em Execuções
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onShowResults}>
          Ver em Resultados
        </Button>
      </div>
    </div>
  )
}

export function ManualRunDialog({
  workflow,
  open,
  onOpenChange,
  onShowExecutions,
  onShowResults,
}: {
  workflow: WorkflowDetail
  open: boolean
  onOpenChange: (open: boolean) => void
  onShowExecutions: () => void
  onShowResults: () => void
}) {
  const queryClient = useQueryClient()
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey)
  const [search, setSearch] = useState("")
  const [collaborator, setCollaborator] = useState<ManualRunCollaborator | null>(null)
  const [contextSearch, setContextSearch] = useState("")
  const [interactionId, setInteractionId] = useState<string | null>(null)
  const [measurementId, setMeasurementId] = useState<string | null>(null)
  const [runId, setRunId] = useState<string | null>(null)
  const debouncedSearch = useDebouncedValue(search.trim(), 300)
  const debouncedContextSearch = useDebouncedValue(contextSearch.trim(), 300)

  function reset() {
    setIdempotencyKey(newIdempotencyKey())
    setSearch("")
    setCollaborator(null)
    setContextSearch("")
    setInteractionId(null)
    setMeasurementId(null)
    setRunId(null)
  }

  // Cada abertura do diálogo é uma nova intenção de disparo: quem abre remonta o componente (key), e o estado inicial acima
  // já nasce com uma chave nova.

  const infoQuery = useQuery({ queryKey: [...adminQueryKeys.workflow(workflow.id), "manual-run"], queryFn: () => fetchManualRunInfo(workflow.id), enabled: open })
  const info = infoQuery.data
  const context = info?.context ?? null
  const blocked = (info?.blockers.length ?? 0) > 0
  const collaboratorsQuery = useQuery({
    queryKey: [...adminQueryKeys.workflow(workflow.id), "manual-run", "collaborators", debouncedSearch],
    queryFn: () => fetchManualRunCollaborators(workflow.id, debouncedSearch),
    enabled: open && Boolean(info) && !blocked && !collaborator,
  })
  const interactionsQuery = useQuery({
    queryKey: [...adminQueryKeys.workflow(workflow.id), "manual-run", "interactions", collaborator?.id, debouncedContextSearch],
    queryFn: () => fetchManualRunInteractions(workflow.id, collaborator!.id, debouncedContextSearch),
    enabled: open && context === "INTERACTION" && Boolean(collaborator),
  })
  const measurementsQuery = useQuery({
    queryKey: [...adminQueryKeys.workflow(workflow.id), "manual-run", "measurements", collaborator?.id],
    queryFn: () => fetchManualRunMeasurements(workflow.id, collaborator!.id),
    enabled: open && context === "INDICATOR_MEASUREMENT" && Boolean(collaborator),
  })

  const runMutation = useMutation({
    mutationFn: () =>
      requestManualRun(workflow.id, {
        collaboratorId: collaborator!.id,
        interactionId: context === "INTERACTION" ? interactionId : null,
        indicatorMeasurementId: context === "INDICATOR_MEASUREMENT" ? measurementId : null,
        idempotencyKey,
      }),
    onSuccess: (result) => {
      if (result.run) setRunId(result.run.id)
      void queryClient.invalidateQueries({ queryKey: adminQueryKeys.workflowEnrollments(workflow.id) })
    },
  })

  const contextReady = context === "COLLABORATOR" || (context === "INTERACTION" && Boolean(interactionId)) || (context === "INDICATOR_MEASUREMENT" && Boolean(measurementId))
  const canRun = Boolean(info) && !blocked && Boolean(collaborator) && contextReady && !runMutation.isPending && !runId
  const surfaces = useMemo(() => publishedSurfaces(workflow), [workflow])
  const selectedInteraction = interactionsQuery.data?.find((item) => item.id === interactionId) ?? null
  const selectedMeasurement = measurementsQuery.data?.find((item) => item.id === measurementId) ?? null
  const errorMessage = runMutation.error instanceof AdminApiError || runMutation.error instanceof Error ? runMutation.error.message : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl" data-usage-screen="workflow.manual_run" data-usage-entity-type="WORKFLOW" data-usage-entity-id={workflow.id}>
        <DialogHeader>
          <DialogTitle>Executar agora</DialogTitle>
          <DialogDescription>
            {workflow.name}
            {workflow.trigger.kind === "manual" ? ` · ${describeManualTrigger(workflow.trigger)}` : null}
          </DialogDescription>
        </DialogHeader>

        {infoQuery.isLoading ? <p className="text-sm text-muted-foreground">Carregando…</p> : null}
        {infoQuery.isError ? <p className="text-sm text-destructive">Não foi possível carregar este workflow para execução manual.</p> : null}

        {info && blocked ? (
          <div className="min-w-0 space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3" role="alert" data-testid="manual-run-blockers">
            <p className="text-sm font-medium">Não é possível executar agora:</p>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {info.blockers.map((blocker) => (
                <li key={blocker.code}>{blocker.message}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {runId ? (
          <ManualRunStatus
            workflowId={workflow.id}
            runId={runId}
            onShowExecutions={() => {
              onOpenChange(false)
              onShowExecutions()
            }}
            onShowResults={() => {
              onOpenChange(false)
              onShowResults()
            }}
          />
        ) : info && !blocked ? (
          // min-w-0: o texto truncado do colaborador não pode alargar a coluna do grid do diálogo.
          <div className="min-w-0 space-y-4">
            <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm" data-testid="manual-run-real-effects">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <p>
                <strong>Execução real neste ambiente.</strong> Roda a versão publicada do workflow com os dados reais escolhidos abaixo — pode chamar a IA e entregar
                conteúdo ao colaborador{surfaces.length > 0 ? ` (${surfaces.join(", ")})` : ""}. Não é uma simulação: para testar sem efeitos, use o QA Lab.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="manual-run-collaborator">1. Colaborador</Label>
              {collaborator ? (
                <div className="flex items-center justify-between gap-2 rounded-md border p-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{collaborator.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[collaborator.matricula, collaborator.jobTitle, collaborator.subteamName ?? collaborator.teamName].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setCollaborator(null)
                      setInteractionId(null)
                      setMeasurementId(null)
                    }}
                  >
                    Trocar
                  </Button>
                </div>
              ) : (
                <>
                  <Input id="manual-run-collaborator" placeholder="Buscar por nome ou matrícula" value={search} onChange={(event) => setSearch(event.target.value)} />
                  <div className="max-h-48 overflow-y-auto rounded-md border" role="listbox" aria-label="Colaboradores elegíveis">
                    {collaboratorsQuery.isLoading ? <p className="p-2 text-sm text-muted-foreground">Buscando…</p> : null}
                    {collaboratorsQuery.data?.items.length === 0 ? (
                      <p className="p-2 text-sm text-muted-foreground">Nenhum colaborador elegível encontrado (operador ativo, dentro da Abrangência do workflow e do seu escopo).</p>
                    ) : null}
                    {collaboratorsQuery.data?.items.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        role="option"
                        aria-selected={false}
                        className="flex w-full flex-col items-start px-2 py-1.5 text-left hover:bg-muted"
                        onClick={() => setCollaborator(item)}
                      >
                        <span className="text-sm">{item.name}</span>
                        <span className="text-xs text-muted-foreground">{[item.matricula, item.jobTitle, item.subteamName ?? item.teamName].filter(Boolean).join(" · ")}</span>
                      </button>
                    ))}
                    {collaboratorsQuery.data && collaboratorsQuery.data.total > collaboratorsQuery.data.items.length ? (
                      <p className="p-2 text-xs text-muted-foreground">
                        Mostrando {collaboratorsQuery.data.items.length} de {collaboratorsQuery.data.total} — refine a busca.
                      </p>
                    ) : null}
                  </div>
                </>
              )}
            </div>

            {collaborator && context === "INTERACTION" ? (
              <div className="space-y-1.5">
                <Label htmlFor="manual-run-interaction">2. Interação de {collaborator.name}</Label>
                <Input id="manual-run-interaction" placeholder="Filtrar por assunto ou protocolo" value={contextSearch} onChange={(event) => setContextSearch(event.target.value)} />
                <div className="max-h-56 overflow-y-auto rounded-md border" role="listbox" aria-label="Interações do colaborador">
                  {interactionsQuery.isLoading ? <p className="p-2 text-sm text-muted-foreground">Buscando…</p> : null}
                  {interactionsQuery.data?.length === 0 ? <p className="p-2 text-sm text-muted-foreground">Este colaborador não tem interação com transcrição para analisar.</p> : null}
                  {interactionsQuery.data?.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      role="option"
                      aria-selected={item.id === interactionId}
                      className={cn("flex w-full flex-col items-start px-2 py-1.5 text-left hover:bg-muted", item.id === interactionId && "bg-primary/10")}
                      onClick={() => setInteractionId(item.id)}
                    >
                      <span className="text-sm">
                        {formatDateTime(item.startedAt)} · {item.subject}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {[item.channel, formatDuration(item.durationSeconds), item.externalId, ...item.flags.map((flag) => `${flag.name}: ${flag.value ?? "—"}`)].join(" · ")}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {collaborator && context === "INDICATOR_MEASUREMENT" ? (
              <div className="space-y-1.5">
                <Label>2. Medição de {info.indicator?.name ?? info.indicator?.code ?? "indicador"}</Label>
                <div className="max-h-56 overflow-y-auto rounded-md border" role="listbox" aria-label="Medições do colaborador">
                  {measurementsQuery.isLoading ? <p className="p-2 text-sm text-muted-foreground">Buscando…</p> : null}
                  {measurementsQuery.data?.length === 0 ? <p className="p-2 text-sm text-muted-foreground">Nenhuma medição deste indicador para o colaborador.</p> : null}
                  {measurementsQuery.data?.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      role="option"
                      aria-selected={item.id === measurementId}
                      className={cn("flex w-full items-center justify-between px-2 py-1.5 text-left hover:bg-muted", item.id === measurementId && "bg-primary/10")}
                      onClick={() => setMeasurementId(item.id)}
                    >
                      <span className="text-sm">
                        {formatDateTime(item.periodStart)} → {formatDateTime(item.periodEnd)}
                      </span>
                      <Badge variant="outline">
                        {item.value} {info.indicator?.unit ?? ""}
                      </Badge>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {collaborator ? (
              <div className="rounded-md bg-muted/50 p-3 text-sm" data-testid="manual-run-summary">
                <p>
                  <strong>{workflow.name}</strong> (versão publicada) será executado para <strong>{collaborator.name}</strong>
                  {selectedInteraction ? ` com a interação de ${formatDateTime(selectedInteraction.startedAt)} (${selectedInteraction.subject})` : ""}
                  {selectedMeasurement ? ` com a medição ${formatDateTime(selectedMeasurement.periodStart)} → ${formatDateTime(selectedMeasurement.periodEnd)}` : ""}.
                </p>
              </div>
            ) : null}

            {errorMessage ? (
              <p className="text-sm text-destructive" role="alert">
                {errorMessage}
              </p>
            ) : null}

            {info.recentRuns.length > 0 ? (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground">Últimas execuções manuais ({info.recentRuns.length})</summary>
                <ul className="mt-1 space-y-0.5">
                  {info.recentRuns.map((recent) => (
                    <li key={recent.id} className="text-muted-foreground">
                      {formatDateTime(recent.requestedAt)} · {recent.collaboratorName} · por {recent.requestedByName} · {recent.status ?? "—"}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        ) : null}

        <DialogFooter>
          {runId ? (
            <Button type="button" variant="outline" onClick={reset}>
              <RotateCcw className="h-4 w-4" />
              Executar de novo
            </Button>
          ) : null}
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
          {!runId ? (
            <Button
              type="button"
              disabled={!canRun}
              data-usage-element="workflow.manual_run.submit"
              onClick={() => {
                // Monitoria de usabilidade: o pedido é uma ação com resultado (disparo criado ou recusado pelo servidor).
                const action = startUsageAction("workflow.manual_run")
                runMutation.mutate(undefined, { onSuccess: () => action.succeed(), onError: (error) => action.fail(error instanceof AdminApiError && error.code ? error.code : "MANUAL_RUN_FAILED") })
              }}
            >
              {runMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {runMutation.isPending ? "Iniciando…" : "Executar agora"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
