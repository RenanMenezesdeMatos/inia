"use client"

import { useCallback, useState } from "react"
import { Activity, CalendarClock, ChevronDown, ChevronRight, Hand, ListOrdered, RotateCcw } from "lucide-react"

import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useAdminListState } from "@/hooks/use-admin-list-state"

import { AdminListView } from "@/components/admin/shared/list/admin-list-view"
import { EntityCard, EntityCardIcon, EntityCardTag } from "@/components/admin/shared/list/entity-card"
import { ListDateRangeFilter, ListMultiSelectFilter, ListToolbar, optionsFromLabels } from "@/components/admin/shared/list/list-filters"
import { ListCardGrid } from "@/components/admin/shared/list/list-states"
import { ListViewToggle } from "@/components/admin/shared/list/list-view-toggle"
import { cn } from "@/lib/utils"
import { decodeSourcePath } from "./content-sources"
import { useSubmitHumanReviewDecisionMutation, useWorkflowEnrollmentsPageQuery } from "@/queries/admin/use-workflow-queries"
import { useWorkflowVariablesQuery } from "@/queries/admin/use-workflow-variable-queries"
import { ESCALATION_ROLE_LABELS, OUTPUT_SURFACE_LABELS, type EscalationRole, type FlowGraph, type OutputSurface } from "@/schemas/admin/workflow-graph.schema"
import { ENROLLMENT_STATUS_LABELS, enrollmentStatusLabelOf, type WorkflowEnrollment, type WorkflowEnrollmentEvent, type WorkflowEnrollmentStatus } from "@/schemas/admin/workflow.schema"
import { failureFromEventPayload } from "@/schemas/admin/execution-failure.schema"
import { ExecutionFailureDetail } from "./execution-failure"
import { describeRetryEvent, enrollmentEventLabel, stepNameOf } from "./enrollments/enrollment-format"
import { blockedGuidanceOf, BlockedReason, blockedStepText, ExecutionLinks, RetryLinkNote, retryLinkText } from "./enrollments/execution-links"
import { RetryExecutionButton } from "./enrollments/retry-dialog"
import type { WorkflowVariable } from "@/schemas/admin/workflow-variable.schema"
import type { HumanReviewDecision, WorkflowEnrollmentListParams } from "@/services/admin/workflow-service"

const DECISION_LABELS: Record<HumanReviewDecision, string> = { approved: "Aprovar", rejected: "Reprovar", escalated: "Escalar" }

const DECISION_EFFECTS: Record<HumanReviewDecision, string> = {
  approved: 'O fluxo segue pelo caminho "Aprovado". Isso pode entregar conteúdo ao colaborador.',
  rejected: 'O fluxo segue pelo caminho "Reprovado".',
  escalated: 'O fluxo segue pelo caminho "Escalar", que costuma encaminhar o caso à liderança.',
}

/** Execução terminada não tem "próxima etapa". */
const TERMINAL_STATUSES: readonly WorkflowEnrollmentStatus[] = ["completed", "failed", "dead"]

const STATUS_VARIANT: Record<WorkflowEnrollmentStatus, "default" | "outline" | "destructive" | "secondary"> = {
  active: "default",
  waiting: "secondary",
  completed: "outline",
  failed: "destructive",
  dead: "destructive",
  blocked: "outline",
}

const STATUS_TONE: Record<WorkflowEnrollmentStatus, string> = {
  active: "bg-primary/10 text-primary",
  waiting: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  completed: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  failed: "bg-red-500/10 text-red-600 dark:text-red-400",
  dead: "bg-muted text-muted-foreground",
  blocked: "bg-amber-500/10 text-amber-800 dark:text-amber-300",
}

/** Bloqueada não é falha: pede uma ação de alguém (reativar, substituir ou ajustar o agente e pedir nova tentativa). */
const STATUS_BADGE_CLASS: Partial<Record<WorkflowEnrollmentStatus, string>> = { blocked: "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300" }

/** Status da execução — bloqueada mostra o motivo ("— agente inativo" / "— acesso não autorizado"). */
function StatusBadge({ enrollment }: { enrollment: WorkflowEnrollment }) {
  return (
    <Badge variant={STATUS_VARIANT[enrollment.status]} className={STATUS_BADGE_CLASS[enrollment.status]}>
      {enrollmentStatusLabelOf(enrollment)}
    </Badge>
  )
}

type RetriedHandler = (retryEnrollmentId: string) => void

/** A primeira decisão vale e não pode ser desfeita, por isso nunca sai de um clique só. */
function HumanReviewDecisionButtons({ workflowId, enrollment, graph }: { workflowId: string; enrollment: WorkflowEnrollment; graph: FlowGraph | null }) {
  const decisionMutation = useSubmitHumanReviewDecisionMutation(workflowId)
  const [pending, setPending] = useState<HumanReviewDecision | null>(null)

  return (
    <div className="flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
      {(Object.entries(DECISION_LABELS) as [HumanReviewDecision, string][]).map(([decision, label]) => (
        <Button key={decision} size="sm" variant={decision === "approved" ? "default" : "outline"} disabled={decisionMutation.isPending} onClick={() => setPending(decision)}>
          {label}
        </Button>
      ))}
      <AlertDialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent onClick={(event) => event.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>{pending ? `${DECISION_LABELS[pending]} a etapa "${stepNameOf(graph, enrollment.currentNodeId)}"?` : ""}</AlertDialogTitle>
            <AlertDialogDescription>{pending ? DECISION_EFFECTS[pending] : ""} Esta decisão não pode ser desfeita. Quem foi designado como revisor costuma decidir em Pendências, onde vê o conteúdo.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={decisionMutation.isPending}>Voltar</AlertDialogCancel>
            <Button
              disabled={decisionMutation.isPending || pending === null}
              onClick={() => {
                if (!pending) return
                decisionMutation.mutate({ enrollmentId: enrollment.id, nodeId: enrollment.currentNodeId, decision: pending }, { onSettled: () => setPending(null) })
              }}
            >
              {pending ? DECISION_LABELS[pending] : ""}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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

const POLICY_OUTCOME_LABELS: Record<string, string> = { CREATED: "intervenção criada", PENDING_APPROVAL: "aprovação pendente", RECOMMENDED: "intervenção recomendada", EXISTING: "intervenção já existente", NO_MATCH: "nenhuma regra atendida", INCONCLUSIVE: "avaliação inconclusiva", CONFLICT: "conflito entre intervenções", SUPPRESSED: "suprimida pela carência", NOT_APPLICABLE: "política não aplicável" }
const POLICY_DECISION_LABELS: Record<string, string> = { CREATED: "aberta", PENDING_APPROVAL: "aguardando aprovação", RECOMMENDED: "recomendada", EXISTING: "já existia", SUPPRESSED: "carência", CONFLICT: "conflito" }

/** "Avaliar política de acompanhamento": resultado geral + decisão POR AÇÃO e a versão usada — sem ids técnicos. */
function describePolicyEvent(event: WorkflowEnrollmentEvent): string | null {
  if (event.eventType !== "intervention_policy_evaluated") return null
  const payload = event.payload as { outcome?: unknown; policyVersion?: unknown; mode?: unknown; decisions?: unknown }
  const decisions = Array.isArray(payload.decisions) ? (payload.decisions as { typeKey?: unknown; status?: unknown }[]).map((decision) => `${String(decision.typeKey)}: ${POLICY_DECISION_LABELS[String(decision.status)] ?? String(decision.status)}`) : []
  return `Política v${String(payload.policyVersion ?? "?")} (${payload.mode === "APPLY_POLICY" ? "abre conforme a política" : "somente recomenda"}) — ${POLICY_OUTCOME_LABELS[String(payload.outcome)] ?? String(payload.outcome)}${decisions.length > 0 ? ` · ${decisions.join(" · ")}` : ""}`
}

function EventList({ enrollment, graph, workflowId }: { enrollment: WorkflowEnrollment; graph: FlowGraph | null; workflowId: string }) {
  const variablesQuery = useWorkflowVariablesQuery(workflowId)
  const variables = variablesQuery.data ?? []
  return (
    <ul className="space-y-1 py-2 text-sm">
      {enrollment.events.map((event, index) => {
        const setVariableDetail = describeSetVariableEvent(event, graph, variables)
        const escalateDetail = describeEscalateEvent(event, graph)
        const policyDetail = describePolicyEvent(event)
        const retryDetail = describeRetryEvent(event)
        // V1.7.1c — falha classificada: categoria, tentativa, campo inválido e decisão de retry (sem conteúdo da resposta).
        const failure = event.eventType === "node_failed" || event.eventType === "flow_dead" ? failureFromEventPayload(event.payload) : null
        return (
          <li key={index} className="text-muted-foreground">
            <div className="flex items-center gap-2">
              <span className="text-xs">{new Date(event.createdAt).toLocaleTimeString("pt-BR")}</span>
              <span className="font-medium text-foreground">{stepNameOf(graph, event.nodeId)}</span>
              <span>· {enrollmentEventLabel(event.eventType)}</span>
            </div>
            {setVariableDetail ? <p className="pl-[4.75rem] text-xs">{setVariableDetail}</p> : null}
            {escalateDetail ? <p className="pl-[4.75rem] text-xs">{escalateDetail}</p> : null}
            {policyDetail ? <p className="pl-[4.75rem] text-xs">{policyDetail}</p> : null}
            {retryDetail ? <p className="pl-[4.75rem] text-xs">{retryDetail}</p> : null}
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

type EnrollmentItemProps = { workflowId: string; enrollment: WorkflowEnrollment; graph: FlowGraph | null; highlighted: boolean; onRetried: RetriedHandler }

/** Detalhe aberto: vínculos/versões/agentes da execução + a linha do tempo de eventos (etapas concluídas mantêm os resultados). */
function EnrollmentDetails({ workflowId, enrollment, graph }: { workflowId: string; enrollment: WorkflowEnrollment; graph: FlowGraph | null }) {
  return (
    <>
      <ExecutionLinks workflowId={workflowId} enrollment={enrollment} graph={graph} />
      <EventList enrollment={enrollment} graph={graph} workflowId={workflowId} />
    </>
  )
}

function EnrollmentRow({ workflowId, enrollment, graph, highlighted, onRetried }: EnrollmentItemProps) {
  const [open, setOpen] = useState(false)
  const blocked = enrollment.status === "blocked"

  return (
    <>
      <TableRow className={cn("cursor-pointer", highlighted && "bg-primary/5")} data-highlighted={highlighted || undefined} onClick={() => setOpen((value) => !value)}>
        <TableCell className="w-8">
          {/* A linha expande pelo clique; este botão é o mesmo acesso pelo teclado e diz o estado ao leitor de tela. */}
          <button type="button" aria-expanded={open} aria-label={open ? "Ocultar eventos da execução" : "Mostrar eventos da execução"} onClick={(event) => { event.stopPropagation(); setOpen((value) => !value) }}>
            {open ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
          </button>
        </TableCell>
        <TableCell>
          <StatusBadge enrollment={enrollment} />
        </TableCell>
        <TableCell className="max-w-sm text-sm text-muted-foreground">
          {stepNameOf(graph, enrollment.currentNodeId)}
          {blocked ? <BlockedReason enrollment={enrollment} graph={graph} /> : null}
        </TableCell>
        <TableCell className="text-sm text-muted-foreground">
          {new Date(enrollment.createdAt).toLocaleString("pt-BR")}
          {enrollment.manualRun ? <ManualOriginNote manualRun={enrollment.manualRun} /> : null}
          <RetryLinkNote enrollment={enrollment} />
        </TableCell>
        <TableCell className="text-sm text-muted-foreground">
          {isPendingHumanReview(enrollment, graph) ? (
            <HumanReviewDecisionButtons workflowId={workflowId} enrollment={enrollment} graph={graph} />
          ) : blocked ? (
            <RetryExecutionButton workflowId={workflowId} enrollmentId={enrollment.id} blockedReason={enrollment.blockedReason} onRetried={onRetried} />
          ) : TERMINAL_STATUSES.includes(enrollment.status) ? (
            "—"
          ) : (
            new Date(enrollment.nextEvalAt).toLocaleString("pt-BR")
          )}
        </TableCell>
      </TableRow>
      {open ? (
        <TableRow>
          <TableCell colSpan={5} className="bg-muted/40 whitespace-normal">
            <EnrollmentDetails enrollment={enrollment} graph={graph} workflowId={workflowId} />
          </TableCell>
        </TableRow>
      ) : null}
    </>
  )
}

function EnrollmentCard({ workflowId, enrollment, graph, highlighted, onRetried }: EnrollmentItemProps) {
  const [open, setOpen] = useState(false)
  const lastEvent = enrollment.events[enrollment.events.length - 1]
  const pendingReview = isPendingHumanReview(enrollment, graph)
  const blocked = enrollment.status === "blocked"
  const retryLink = retryLinkText(enrollment)

  return (
    <EntityCard
      className={cn(highlighted && "ring-2 ring-primary/40")}
      icon={<EntityCardIcon icon={Activity} className={STATUS_TONE[enrollment.status]} />}
      kicker={
        <>
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{enrollmentStatusLabelOf(enrollment)}</span>
          <span aria-hidden>·</span>
          <span>{stepNameOf(graph, enrollment.currentNodeId)}</span>
        </>
      }
      title={`Iniciada em ${new Date(enrollment.createdAt).toLocaleString("pt-BR")}`}
      onOpen={() => setOpen((value) => !value)}
      description={blocked ? `${blockedStepText(enrollment, graph)} ${blockedGuidanceOf(enrollment)}` : lastEvent ? `Último evento: ${stepNameOf(graph, lastEvent.nodeId)} · ${enrollmentEventLabel(lastEvent.eventType)}` : null}
      descriptionFallback="Nenhum evento registrado ainda."
      tags={
        <>
          <EntityCardTag icon={ListOrdered}>
            {enrollment.events.length} {enrollment.events.length === 1 ? "evento" : "eventos"}
          </EntityCardTag>
          {!pendingReview && !blocked && !TERMINAL_STATUSES.includes(enrollment.status) ? <EntityCardTag icon={CalendarClock}>Próxima etapa em {new Date(enrollment.nextEvalAt).toLocaleString("pt-BR")}</EntityCardTag> : null}
          {enrollment.manualRun ? <EntityCardTag icon={Hand}>Manual · {enrollment.manualRun.collaboratorName} · por {enrollment.manualRun.requestedByName}</EntityCardTag> : null}
          {retryLink ? <EntityCardTag icon={RotateCcw}>{retryLink}</EntityCardTag> : null}
        </>
      }
      footerStart={
        <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setOpen((value) => !value)}>
          {open ? <ChevronDown /> : <ChevronRight />} {open ? "Ocultar eventos" : "Ver eventos"}
        </Button>
      }
      footerEnd={
        pendingReview ? (
          <HumanReviewDecisionButtons workflowId={workflowId} enrollment={enrollment} graph={graph} />
        ) : blocked ? (
          <RetryExecutionButton workflowId={workflowId} enrollmentId={enrollment.id} blockedReason={enrollment.blockedReason} onRetried={onRetried} />
        ) : (
          <StatusBadge enrollment={enrollment} />
        )
      }
    >
      {open ? (
        <div className="rounded-md bg-muted/40 px-3">
          <EnrollmentDetails enrollment={enrollment} graph={graph} workflowId={workflowId} />
        </div>
      ) : null}
    </EntityCard>
  )
}

type EnrollmentFilters = Omit<WorkflowEnrollmentListParams, "page" | "pageSize" | "search"> & { search: string }

const DEFAULT_FILTERS: EnrollmentFilters = { search: "", status: [], createdAt: {} }
const STATUS_OPTIONS = optionsFromLabels(ENROLLMENT_STATUS_LABELS)

/** O próximo passo depende do estado do workflow: "nenhuma execução" sem publicação não é o mesmo que no ar e sem disparos. */
function emptyExecutionsText(workflow: { published: boolean; active: boolean } | undefined): { title: string; description?: string } {
  if (!workflow) return { title: "Nenhuma execução ainda" }
  if (!workflow.published) return { title: "Nenhuma execução ainda", description: "Só depois de publicar o workflow começa a rodar." }
  if (!workflow.active) return { title: "Nenhuma execução ainda", description: "Este workflow está desativado: ative-o na lista de workflows para ele voltar a rodar." }
  return { title: "Nenhuma execução ainda", description: "As execuções aparecem aqui assim que o gatilho disparar." }
}

export function WorkflowEnrollmentsTab({ workflowId, graph, workflow }: { workflowId: string; graph: FlowGraph | null; workflow?: { published: boolean; active: boolean } }) {
  const list = useAdminListState({ storageKey: "workflow-enrollments", defaultFilters: DEFAULT_FILTERS })
  const enrollmentsQuery = useWorkflowEnrollmentsPageQuery(workflowId, list.params)
  // Nova tentativa criada: volta à primeira página sem filtros (as execuções vêm da mais recente) e destaca a tentativa.
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  const { resetFilters } = list
  const handleRetried = useCallback(
    (retryEnrollmentId: string) => {
      resetFilters()
      setHighlightedId(retryEnrollmentId)
    },
    [resetFilters],
  )

  return (
    <div className="space-y-4">
      <ListToolbar
        // O servidor só busca pelo id técnico da etapa: um campo de busca aqui nunca encontraria o que a pessoa digita (proposta P5).
        search={null}
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
        empty={{ icon: Activity, ...emptyExecutionsText(workflow) }}
        noResultsTitle="Nenhuma execução corresponde à busca ou aos filtros"
        itemLabel={["execução", "execuções"]}
        renderList={(enrollments) => (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead />
                  <TableHead>Status</TableHead>
                  <TableHead>Etapa atual</TableHead>
                  <TableHead>Iniciado em</TableHead>
                  <TableHead>Próxima etapa em</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {enrollments.map((enrollment) => (
                  <EnrollmentRow key={enrollment.id} workflowId={workflowId} enrollment={enrollment} graph={graph} highlighted={enrollment.id === highlightedId} onRetried={handleRetried} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        renderCards={(enrollments) => (
          <ListCardGrid>
            {enrollments.map((enrollment) => (
              <EnrollmentCard key={enrollment.id} workflowId={workflowId} enrollment={enrollment} graph={graph} highlighted={enrollment.id === highlightedId} onRetried={handleRetried} />
            ))}
          </ListCardGrid>
        )}
      />
    </div>
  )
}
