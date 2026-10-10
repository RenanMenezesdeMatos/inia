"use client"

import { useState } from "react"
import { Activity, CalendarClock, ChevronDown, ChevronRight, Hand, ListOrdered } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useAdminListState } from "@/hooks/use-admin-list-state"

import { AdminListView } from "@/components/admin/shared/list/admin-list-view"
import { EntityCard, EntityCardIcon, EntityCardTag } from "@/components/admin/shared/list/entity-card"
import { ListDateRangeFilter, ListMultiSelectFilter, ListSearchInput, ListToolbar, optionsFromLabels } from "@/components/admin/shared/list/list-filters"
import { ListCardGrid } from "@/components/admin/shared/list/list-states"
import { ListViewToggle } from "@/components/admin/shared/list/list-view-toggle"
import { decodeSourcePath } from "./content-sources"
import { useSubmitHumanReviewDecisionMutation, useWorkflowEnrollmentsPageQuery } from "@/queries/admin/use-workflow-queries"
import { useWorkflowVariablesQuery } from "@/queries/admin/use-workflow-variable-queries"
import { ESCALATION_ROLE_LABELS, OUTPUT_SURFACE_LABELS, type EscalationRole, type FlowGraph, type OutputSurface } from "@/schemas/admin/workflow-graph.schema"
import { ENROLLMENT_STATUS_LABELS, type WorkflowEnrollment, type WorkflowEnrollmentEvent } from "@/schemas/admin/workflow.schema"
import { failureFromEventPayload } from "@/schemas/admin/execution-failure.schema"
import { ExecutionFailureDetail } from "./execution-failure"
import type { WorkflowVariable } from "@/schemas/admin/workflow-variable.schema"
import type { HumanReviewDecision, WorkflowEnrollmentListParams } from "@/services/admin/workflow-service"

const DECISION_LABELS: Record<HumanReviewDecision, string> = { approved: "Aprovar", rejected: "Reprovar", escalated: "Escalar" }

const STATUS_VARIANT: Record<WorkflowEnrollment["status"], "default" | "outline" | "destructive" | "secondary"> = {
  active: "default",
  waiting: "secondary",
  completed: "outline",
  failed: "destructive",
  dead: "destructive",
}

const STATUS_TONE: Record<WorkflowEnrollment["status"], string> = {
  active: "bg-primary/10 text-primary",
  waiting: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  completed: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  failed: "bg-red-500/10 text-red-600 dark:text-red-400",
  dead: "bg-muted text-muted-foreground",
}

function HumanReviewDecisionButtons({ workflowId, enrollment }: { workflowId: string; enrollment: WorkflowEnrollment }) {
  const decisionMutation = useSubmitHumanReviewDecisionMutation(workflowId)

  return (
    <div className="flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
      {(Object.entries(DECISION_LABELS) as [HumanReviewDecision, string][]).map(([decision, label]) => (
        <Button
          key={decision}
          size="sm"
          variant={decision === "approved" ? "default" : "outline"}
          disabled={decisionMutation.isPending}
          onClick={() => decisionMutation.mutate({ enrollmentId: enrollment.id, nodeId: enrollment.currentNodeId, decision })}
        >
          {label}
        </Button>
      ))}
    </div>
  )
}

function isPendingHumanReview(enrollment: WorkflowEnrollment, graph: FlowGraph | null) {
  const currentNode = graph?.nodes.find((node) => node.id === enrollment.currentNodeId)
  return enrollment.status === "waiting" && currentNode?.type === "human_review"
}

/** "Valor do gatilho" / rótulo amigável do node / nome da variável de origem — nunca sourcePath
 * cru nem UUID (Parte 28 do pedido de variáveis dinâmicas: auditoria/debug sem expor técnico). */
function describeSetVariableOrigin(sourcePath: string, graph: FlowGraph | null, variables: WorkflowVariable[]): string {
  const decoded = decodeSourcePath(sourcePath)
  if (!decoded) return "origem desconhecida"
  if (decoded.kind === "variable") return variables.find((candidate) => candidate.id === decoded.variableId)?.name ?? "outra variável"
  if (decoded.nodeId === "trigger") return "valor do gatilho"
  return graph?.nodes.find((node) => node.id === decoded.nodeId)?.label ?? "resultado de um nó anterior"
}

/** Detalhe amigável de um evento `action_executed` de "Definir variável" — null pra qualquer
 * outro evento (a lista continua mostrando só nodeId/eventType pra esses, como sempre). */
function describeSetVariableEvent(event: WorkflowEnrollmentEvent, graph: FlowGraph | null, variables: WorkflowVariable[]): string | null {
  if (event.eventType !== "action_executed" || event.payload.actionType !== "SET_VARIABLE") return null
  const nodeOutput = event.payload.nodeOutput as { variableId?: unknown; value?: unknown; source?: unknown; sourcePath?: unknown } | undefined
  if (!nodeOutput || typeof nodeOutput.variableId !== "string") return null
  const variable = variables.find((candidate) => candidate.id === nodeOutput.variableId)
  const valueText = typeof nodeOutput.value === "boolean" ? (nodeOutput.value ? "Verdadeiro" : "Falso") : String(nodeOutput.value)
  const originText = nodeOutput.source === "DYNAMIC" && typeof nodeOutput.sourcePath === "string" ? describeSetVariableOrigin(nodeOutput.sourcePath, graph, variables) : "valor fixo"
  return `${variable?.name ?? "Variável"}: ${valueText} (origem: ${originText})`
}

/** Detalhe amigável de um evento `action_executed` de "Escalonar" (Parte 22 do pedido de
 * Escalonamento: aba Execuções mostra Node/De/Para/Motivo/Superfícies sem id técnico cru como
 * informação principal) — null pra qualquer outro evento. Mesmo padrão de `describeSetVariableEvent`. */
function describeEscalateEvent(event: WorkflowEnrollmentEvent, graph: FlowGraph | null): string | null {
  if (event.eventType !== "action_executed" || event.payload.actionType !== "ESCALATE") return null
  const nodeOutput = event.payload.nodeOutput as
    | {
        target?: { type?: unknown; role?: unknown; previousReviewNodeId?: unknown }
        surfaces?: unknown
        reason?: unknown
        operatorName?: unknown
      }
    | undefined
  if (!nodeOutput) return null
  const target = nodeOutput.target
  const targetLabel =
    target?.type === "SPECIFIC_USER"
      ? "pessoa específica"
      : target?.type === "ROLE_OF_OPERATOR"
        ? `${ESCALATION_ROLE_LABELS[target.role as EscalationRole]} do operador`
        : target?.type === "ROLE_OF_PREVIOUS_REVIEWER"
          ? `${ESCALATION_ROLE_LABELS[target.role as EscalationRole]} de quem decidiu em "${graph?.nodes.find((node) => node.id === target.previousReviewNodeId)?.label ?? "revisão anterior"}"`
          : "destino não identificado"
  const surfaces = Array.isArray(nodeOutput.surfaces)
    ? (nodeOutput.surfaces as string[]).map((surface) => OUTPUT_SURFACE_LABELS[surface as OutputSurface]).join(" + ")
    : ""
  const from = typeof nodeOutput.operatorName === "string" ? nodeOutput.operatorName : "operador"
  const reasonText = typeof nodeOutput.reason === "string" && nodeOutput.reason ? ` — "${nodeOutput.reason}"` : ""
  return `De ${from} → ${targetLabel} · ${surfaces || "sem superfície"}${reasonText}`
}

function EventList({ enrollment, graph, workflowId }: { enrollment: WorkflowEnrollment; graph: FlowGraph | null; workflowId: string }) {
  const variablesQuery = useWorkflowVariablesQuery(workflowId)
  const variables = variablesQuery.data ?? []
  return (
    <ul className="space-y-1 py-2 text-sm">
      {enrollment.events.map((event, index) => {
        const setVariableDetail = describeSetVariableEvent(event, graph, variables)
        const escalateDetail = describeEscalateEvent(event, graph)
        // V1.7.1c — falha classificada: categoria, tentativa, campo inválido e decisão de retry (sem conteúdo da resposta).
        const failure = event.eventType === "node_failed" || event.eventType === "flow_dead" ? failureFromEventPayload(event.payload) : null
        return (
          <li key={index} className="text-muted-foreground">
            <div className="flex items-center gap-2">
              <span className="text-xs">{new Date(event.createdAt).toLocaleTimeString("pt-BR")}</span>
              <span className="font-medium text-foreground">{event.nodeId}</span>
              <span>· {event.eventType}</span>
            </div>
            {setVariableDetail ? <p className="pl-[4.75rem] text-xs">{setVariableDetail}</p> : null}
            {escalateDetail ? <p className="pl-[4.75rem] text-xs">{escalateDetail}</p> : null}
            {failure ? <div className="pl-[4.75rem] pt-1"><ExecutionFailureDetail failure={failure} /></div> : null}
          </li>
        )
      })}
      {enrollment.events.length === 0 ? <li className="text-muted-foreground">Nenhum evento registrado ainda.</li> : null}
    </ul>
  )
}

/** Origem MANUAL ("Executar agora"): quem disparou e para quem — mesmo quando a execução carrega interação/medição. */
function ManualOriginNote({ manualRun }: { manualRun: NonNullable<WorkflowEnrollment["manualRun"]> }) {
  return (
    <span className="mt-0.5 flex items-center gap-1 text-xs">
      <Hand className="h-3 w-3" />
      Manual · {manualRun.collaboratorName} · por {manualRun.requestedByName}
    </span>
  )
}

function EnrollmentRow({ workflowId, enrollment, graph }: { workflowId: string; enrollment: WorkflowEnrollment; graph: FlowGraph | null }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <TableRow className="cursor-pointer" onClick={() => setOpen((value) => !value)}>
        <TableCell className="w-8">{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
        <TableCell>
          <Badge variant={STATUS_VARIANT[enrollment.status]}>{ENROLLMENT_STATUS_LABELS[enrollment.status]}</Badge>
        </TableCell>
        <TableCell className="text-sm text-muted-foreground">{enrollment.currentNodeId}</TableCell>
        <TableCell className="text-sm text-muted-foreground">
          {new Date(enrollment.createdAt).toLocaleString("pt-BR")}
          {enrollment.manualRun ? <ManualOriginNote manualRun={enrollment.manualRun} /> : null}
        </TableCell>
        <TableCell className="text-sm text-muted-foreground">
          {isPendingHumanReview(enrollment, graph) ? (
            <HumanReviewDecisionButtons workflowId={workflowId} enrollment={enrollment} />
          ) : (
            new Date(enrollment.nextEvalAt).toLocaleString("pt-BR")
          )}
        </TableCell>
      </TableRow>
      {open ? (
        <TableRow>
          <TableCell colSpan={5} className="bg-muted/40">
            <EventList enrollment={enrollment} graph={graph} workflowId={workflowId} />
          </TableCell>
        </TableRow>
      ) : null}
    </>
  )
}

function EnrollmentCard({ workflowId, enrollment, graph }: { workflowId: string; enrollment: WorkflowEnrollment; graph: FlowGraph | null }) {
  const [open, setOpen] = useState(false)
  const lastEvent = enrollment.events[enrollment.events.length - 1]
  const pendingReview = isPendingHumanReview(enrollment, graph)

  return (
    <EntityCard
      icon={<EntityCardIcon icon={Activity} className={STATUS_TONE[enrollment.status]} />}
      kicker={
        <>
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{ENROLLMENT_STATUS_LABELS[enrollment.status]}</span>
          <span aria-hidden>·</span>
          <span>nó {enrollment.currentNodeId}</span>
        </>
      }
      title={`Iniciada em ${new Date(enrollment.createdAt).toLocaleString("pt-BR")}`}
      onOpen={() => setOpen((value) => !value)}
      description={lastEvent ? `Último evento: ${lastEvent.nodeId} · ${lastEvent.eventType}` : null}
      descriptionFallback="Nenhum evento registrado ainda."
      tags={
        <>
          <EntityCardTag icon={ListOrdered}>
            {enrollment.events.length} {enrollment.events.length === 1 ? "evento" : "eventos"}
          </EntityCardTag>
          {!pendingReview ? <EntityCardTag icon={CalendarClock}>Próxima avaliação {new Date(enrollment.nextEvalAt).toLocaleString("pt-BR")}</EntityCardTag> : null}
          {enrollment.manualRun ? <EntityCardTag icon={Hand}>Manual · {enrollment.manualRun.collaboratorName} · por {enrollment.manualRun.requestedByName}</EntityCardTag> : null}
        </>
      }
      footerStart={
        <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setOpen((value) => !value)}>
          {open ? <ChevronDown /> : <ChevronRight />} {open ? "Ocultar eventos" : "Ver eventos"}
        </Button>
      }
      footerEnd={pendingReview ? <HumanReviewDecisionButtons workflowId={workflowId} enrollment={enrollment} /> : <Badge variant={STATUS_VARIANT[enrollment.status]}>{ENROLLMENT_STATUS_LABELS[enrollment.status]}</Badge>}
    >
      {open ? (
        <div className="rounded-md bg-muted/40 px-3">
          <EventList enrollment={enrollment} graph={graph} workflowId={workflowId} />
        </div>
      ) : null}
    </EntityCard>
  )
}

type EnrollmentFilters = Omit<WorkflowEnrollmentListParams, "page" | "pageSize" | "search"> & { search: string }

const DEFAULT_FILTERS: EnrollmentFilters = { search: "", status: [], createdAt: {} }
const STATUS_OPTIONS = optionsFromLabels(ENROLLMENT_STATUS_LABELS)

export function WorkflowEnrollmentsTab({ workflowId, graph }: { workflowId: string; graph: FlowGraph | null }) {
  const list = useAdminListState({ storageKey: "workflow-enrollments", defaultFilters: DEFAULT_FILTERS })
  const enrollmentsQuery = useWorkflowEnrollmentsPageQuery(workflowId, list.params)

  return (
    <div className="space-y-4">
      <ListToolbar
        search={
          <ListSearchInput
            value={list.filters.search}
            onChange={(value) => list.setFilter("search", value)}
            placeholder="Buscar pelo nó atual"
            ariaLabel="Buscar execução"
            pending={list.isSearchPending}
          />
        }
        viewToggle={<ListViewToggle value={list.view} onChange={list.setView} />}
        hasActiveFilters={list.hasActiveFilters}
        onClearFilters={list.resetFilters}
      >
        <ListMultiSelectFilter label="Status" values={list.filters.status} onChange={(values) => list.setFilter("status", values)} options={STATUS_OPTIONS} />
        <ListDateRangeFilter label="Iniciada em" value={list.filters.createdAt} onChange={(value) => list.setFilter("createdAt", value)} />
      </ListToolbar>

      <AdminListView
        state={list}
        query={enrollmentsQuery}
        errorMessage="Não foi possível carregar as execuções."
        empty={{ icon: Activity, title: "Nenhuma interação matriculou neste workflow ainda" }}
        noResultsTitle="Nenhuma execução corresponde à busca ou aos filtros"
        itemLabel={["execução", "execuções"]}
        renderList={(enrollments) => (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead />
                  <TableHead>Status</TableHead>
                  <TableHead>Nó atual</TableHead>
                  <TableHead>Iniciado em</TableHead>
                  <TableHead>Próxima avaliação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {enrollments.map((enrollment) => (
                  <EnrollmentRow key={enrollment.id} workflowId={workflowId} enrollment={enrollment} graph={graph} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        renderCards={(enrollments) => (
          <ListCardGrid>
            {enrollments.map((enrollment) => (
              <EnrollmentCard key={enrollment.id} workflowId={workflowId} enrollment={enrollment} graph={graph} />
            ))}
          </ListCardGrid>
        )}
      />
    </div>
  )
}
