"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Activity, CalendarClock, Plus, Trash2, Workflow as WorkflowIcon, Zap } from "lucide-react"

import { useAutoOpenFromQuery } from "@/hooks/use-auto-open-from-query"
import { useAdminListState } from "@/hooks/use-admin-list-state"

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

import { formatDateOnly } from "@/components/admin/knowledge/knowledge-meta"
import { AdminListView } from "@/components/admin/shared/list/admin-list-view"
import { EntityCard, EntityCardIcon, EntityCardTag } from "@/components/admin/shared/list/entity-card"
import {
  ListBooleanFilter,
  ListDateRangeFilter,
  ListMultiSelectFilter,
  ListOrgScopeFilter,
  ListSearchInput,
  ListToolbar,
} from "@/components/admin/shared/list/list-filters"
import { ListCardGrid } from "@/components/admin/shared/list/list-states"
import { ListViewToggle } from "@/components/admin/shared/list/list-view-toggle"
import { OrgScopeSelect, type OrgScopeValue } from "@/components/admin/shared/org-scope-select"
import { formatScopeLabel } from "@/lib/admin/scope-compatibility"
import { isTriggerComplete, TriggerFields } from "@/components/admin/workflows/trigger-fields"
import { useManageableTeamsQuery, useTeamsQuery } from "@/queries/admin/use-org-structure-queries"
import { useCreateWorkflowMutation, useDeleteWorkflowMutation, useUpdateWorkflowMutation, useWorkflowsPageQuery } from "@/queries/admin/use-workflow-queries"
import type { WorkflowListParams, WorkflowTriggerInput } from "@/services/admin/workflow-service"
import { triggerBadgeText, type Workflow, type WorkflowTrigger } from "@/schemas/admin/workflow.schema"

const groupLabel = formatScopeLabel

const EMPTY_TRIGGER: WorkflowTriggerInput = { kind: "channel_flag", channelFlagId: "" }

function CreateWorkflowDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: (id: string) => void }) {
  const manageableTeamsQuery = useManageableTeamsQuery()
  const createMutation = useCreateWorkflowMutation()

  const [name, setName] = useState("")
  const [trigger, setTrigger] = useState<WorkflowTriggerInput>(EMPTY_TRIGGER)
  const [orgScope, setOrgScope] = useState<OrgScopeValue>({ scopeType: "ALL_TEAMS" })

  // Escopo Administrativo (Parte 10/11): um admin restrito nunca deve ficar com "Todos os
  // grupos" pré-selecionado — assim que sabemos que ele é restrito, caímos pra "grupo
  // específico" (sem grupo ainda escolhido, forçando a seleção dentre os dele).
  const [scopeCheckedFor, setScopeCheckedFor] = useState<typeof manageableTeamsQuery.data>(undefined)
  if (scopeCheckedFor !== manageableTeamsQuery.data) {
    setScopeCheckedFor(manageableTeamsQuery.data)
    if (manageableTeamsQuery.data && !manageableTeamsQuery.data.unrestricted && orgScope.scopeType === "ALL_TEAMS") {
      setOrgScope({ scopeType: "TEAM" })
    }
  }

  async function handleCreate() {
    try {
      const workflow = await createMutation.mutateAsync({ name, trigger, orgScope })
      setName("")
      setTrigger(EMPTY_TRIGGER)
      setOrgScope({ scopeType: "ALL_TEAMS" })
      onOpenChange(false)
      onCreated(workflow.id)
    } catch {
      // já sinalizado via createMutation.isError / toast do useAdminMutation
    }
  }

  const canCreate = name.trim().length > 1 && isTriggerComplete(trigger)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo workflow</DialogTitle>
          <DialogDescription>Defina o nome, o gatilho e o grupo — o editor visual abre em seguida.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="workflow-name">Nome</Label>
            <Input id="workflow-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Nota URA baixa — Contas" />
          </div>
          <TriggerFields value={trigger} onChange={setTrigger} scope={orgScope} />
          <div className="space-y-1.5">
            <Label>Grupo</Label>
            {manageableTeamsQuery.data ? (
              <OrgScopeSelect
                teams={manageableTeamsQuery.data.teams}
                value={orgScope}
                onChange={setOrgScope}
                allowAllTeams={manageableTeamsQuery.data.unrestricted}
              />
            ) : (
              <Skeleton className="h-10 w-full" />
            )}
          </div>
          {createMutation.isError ? <p className="text-sm text-destructive">{(createMutation.error as Error).message}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button disabled={!canCreate || createMutation.isPending} onClick={handleCreate}>
            {createMutation.isPending ? "Criando..." : "Criar e abrir editor"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DeleteWorkflowButton({ workflow }: { workflow: Workflow }) {
  const deleteMutation = useDeleteWorkflowMutation()
  const [open, setOpen] = useState(false)

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button size="icon" variant="ghost" aria-label="Excluir workflow" disabled={deleteMutation.isPending} onClick={(event) => event.stopPropagation()}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent onClick={(event) => event.stopPropagation()}>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir {workflow.name}?</AlertDialogTitle>
          <AlertDialogDescription>Essa ação não pode ser desfeita. Execuções em andamento serão interrompidas.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={deleteMutation.isPending}
            onClick={async () => {
              try {
                await deleteMutation.mutateAsync(workflow.id)
                setOpen(false)
              } catch {
                // já sinalizado via toast do useAdminMutation
              }
            }}
          >
            {deleteMutation.isPending ? "Excluindo..." : "Excluir"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function ActiveSwitch({ workflow }: { workflow: Workflow }) {
  const updateMutation = useUpdateWorkflowMutation()
  return (
    <Switch
      checked={workflow.active}
      disabled={updateMutation.isPending}
      aria-label={workflow.active ? "Desativar workflow" : "Ativar workflow"}
      onClick={(event) => event.stopPropagation()}
      onCheckedChange={(checked) => updateMutation.mutate({ id: workflow.id, active: checked })}
    />
  )
}

function PublishedBadge({ workflow }: { workflow: Workflow }) {
  return <Badge variant={workflow.published ? "default" : "outline"}>{workflow.published ? "Publicado" : "Rascunho"}</Badge>
}

const TRIGGER_KIND_LABELS: Record<WorkflowTrigger["kind"], string> = {
  channel_flag: "Flag de canal",
  indicator: "Indicador",
  schedule: "Agenda",
  manual: "Manual",
}

function WorkflowCard({ workflow }: { workflow: Workflow }) {
  return (
    <EntityCard
      muted={!workflow.active}
      icon={<EntityCardIcon icon={WorkflowIcon} className="bg-indigo-100 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-300" />}
      kicker={
        <>
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{TRIGGER_KIND_LABELS[workflow.trigger.kind]}</span>
          <span aria-hidden>·</span>
          <span>{groupLabel(workflow)}</span>
        </>
      }
      title={workflow.name}
      href={`/admin/workflows/${workflow.id}`}
      actions={
        <>
          <ActiveSwitch workflow={workflow} />
          <DeleteWorkflowButton workflow={workflow} />
        </>
      }
      description={workflow.description}
      descriptionFallback="Sem descrição."
      tags={
        <>
          <EntityCardTag icon={Zap}>{triggerBadgeText(workflow.trigger)}</EntityCardTag>
          <EntityCardTag icon={Activity}>
            {workflow.activeEnrollments} em execução
          </EntityCardTag>
        </>
      }
      footerStart={
        <span className="inline-flex items-center gap-1">
          <CalendarClock className="size-3.5" />
          <time dateTime={workflow.createdAt}>{formatDateOnly(workflow.createdAt)}</time>
        </span>
      }
      footerEnd={<PublishedBadge workflow={workflow} />}
    />
  )
}

function WorkflowsTable({ workflows }: { workflows: Workflow[] }) {
  const router = useRouter()
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nome</TableHead>
            <TableHead>Gatilho</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Grupo</TableHead>
            <TableHead>Em execução</TableHead>
            <TableHead>Criado em</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {workflows.map((workflow) => (
            <TableRow key={workflow.id} className="cursor-pointer" onClick={() => router.push(`/admin/workflows/${workflow.id}`)}>
              <TableCell className="font-medium">{workflow.name}</TableCell>
              <TableCell>
                <Badge variant="outline">{triggerBadgeText(workflow.trigger)}</Badge>
              </TableCell>
              <TableCell>
                <PublishedBadge workflow={workflow} />
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">{groupLabel(workflow)}</TableCell>
              <TableCell className="text-sm text-muted-foreground">{workflow.activeEnrollments}</TableCell>
              <TableCell className="text-sm text-muted-foreground">
                <time dateTime={workflow.createdAt}>{formatDateOnly(workflow.createdAt)}</time>
              </TableCell>
              <TableCell>
                <div className="flex items-center justify-end gap-2">
                  <ActiveSwitch workflow={workflow} />
                  <DeleteWorkflowButton workflow={workflow} />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

type WorkflowFilters = Omit<WorkflowListParams, "page" | "pageSize" | "search"> & { search: string }

const DEFAULT_FILTERS: WorkflowFilters = { search: "", triggerKind: [], createdAt: {} }
const TRIGGER_KIND_OPTIONS = (Object.entries(TRIGGER_KIND_LABELS) as [WorkflowTrigger["kind"], string][]).map(([value, label]) => ({ value, label }))

export function WorkflowsPage() {
  const router = useRouter()
  const teamsQuery = useTeamsQuery()
  const [autoOpen, setAutoOpen] = useAutoOpenFromQuery("new")
  const [createOpen, setCreateOpen] = useState(false)

  const list = useAdminListState({ storageKey: "workflows", defaultFilters: DEFAULT_FILTERS })
  const pageQuery = useWorkflowsPageQuery(list.params)

  // `?new` na URL abre o diálogo (ajuste na renderização, sem render extra) e consome o pedido: cada nova navegação com
  // `?new` abre de novo.
  if (autoOpen) {
    setAutoOpen(false)
    setCreateOpen(true)
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Workflows</CardTitle>
            <CardDescription>
              Fluxos visuais: quando uma flag chega, o grafo decide o que acontece — esperar, checar uma condição, chamar um agente ou definir uma
              configuração.
            </CardDescription>
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus /> Novo workflow
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <ListToolbar
          search={
            <ListSearchInput
              value={list.filters.search}
              onChange={(value) => list.setFilter("search", value)}
              placeholder="Buscar por nome ou descrição"
              ariaLabel="Buscar workflow"
              pending={list.isSearchPending}
            />
          }
          viewToggle={<ListViewToggle value={list.view} onChange={list.setView} />}
          hasActiveFilters={list.hasActiveFilters}
          onClearFilters={list.resetFilters}
        >
          <ListMultiSelectFilter label="Gatilho" values={list.filters.triggerKind} onChange={(values) => list.setFilter("triggerKind", values)} options={TRIGGER_KIND_OPTIONS} />
          <ListBooleanFilter value={list.filters.published} onChange={(value) => list.setFilter("published", value)} allLabel="Publicados e rascunhos" trueLabel="Publicados" falseLabel="Rascunhos" ariaLabel="Filtrar por publicação" />
          <ListBooleanFilter value={list.filters.active} onChange={(value) => list.setFilter("active", value)} allLabel="Qualquer status" trueLabel="Ativos" falseLabel="Inativos" ariaLabel="Filtrar por status" />
          <ListBooleanFilter value={list.filters.hasActiveEnrollments} onChange={(value) => list.setFilter("hasActiveEnrollments", value)} allLabel="Com ou sem execuções" trueLabel="Com execuções em andamento" falseLabel="Sem execuções em andamento" ariaLabel="Filtrar por execuções em andamento" />
          <ListOrgScopeFilter
            teams={teamsQuery.data}
            value={{ scopeType: list.filters.scopeType, teamId: list.filters.teamId, subteamId: list.filters.subteamId }}
            onChange={(scope) => list.patchFilters({ scopeType: scope.scopeType, teamId: scope.teamId, subteamId: scope.subteamId })}
          />
          <ListDateRangeFilter label="Criado em" value={list.filters.createdAt} onChange={(value) => list.setFilter("createdAt", value)} />
        </ListToolbar>

        <AdminListView
          state={list}
          query={pageQuery}
          errorMessage="Não foi possível carregar os workflows."
          empty={{
            icon: WorkflowIcon,
            title: "Nenhum workflow criado ainda",
            description: "Crie um fluxo para reagir a flags, indicadores ou horários agendados.",
            action: (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus /> Novo workflow
              </Button>
            ),
          }}
          noResultsTitle="Nenhum workflow corresponde à busca ou aos filtros"
          itemLabel={["workflow", "workflows"]}
          renderList={(workflows) => <WorkflowsTable workflows={workflows} />}
          renderCards={(workflows) => (
            <ListCardGrid>
              {workflows.map((workflow) => (
                <WorkflowCard key={workflow.id} workflow={workflow} />
              ))}
            </ListCardGrid>
          )}
        />
      </CardContent>

      <CreateWorkflowDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={(id) => router.push(`/admin/workflows/${id}`)} />
    </Card>
  )
}
