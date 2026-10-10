"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { CalendarClock, MessagesSquare, Plus, ShieldCheck, Trash2, TriangleAlert, Users, Waypoints, Workflow } from "lucide-react"

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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
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
  ListSelectFilter,
  ListToolbar,
  optionsFromLabels,
} from "@/components/admin/shared/list/list-filters"
import { ListCardGrid } from "@/components/admin/shared/list/list-states"
import { ListViewToggle } from "@/components/admin/shared/list/list-view-toggle"
import { AgentPicker } from "@/components/admin/workflows/agent-picker"
import { OrgScopeSelect, type OrgScopeValue } from "@/components/admin/shared/org-scope-select"
import { formatScopeLabel } from "@/lib/admin/scope-compatibility"
import { useAgentsQuery } from "@/queries/admin/use-agent-queries"
import { useManageableTeamsQuery, useTeamsQuery } from "@/queries/admin/use-org-structure-queries"
import {
  useCreateOrchestratorMutation,
  useDeleteOrchestratorMutation,
  useOrchestratorsPageQuery,
  useToggleOrchestratorActiveMutation,
} from "@/queries/admin/use-assistant-queries"
import type { OrchestratorListParams } from "@/services/admin/assistant-service"
import { AGENT_TYPE_COLORS } from "@/schemas/admin/agent.schema"
import { ORCHESTRATOR_INVOCATION_MODE_LABELS, type Orchestrator, type OrchestratorInvocationMode } from "@/schemas/admin/assistant.schema"
import { describeBusinessDomain } from "@/schemas/admin/business-domain.schema"
import { describeRoutingProblem, ORCHESTRATOR_POLICY_KIND_SHORT_LABELS, POLICY_REQUIRED_MESSAGE, resolveRoutingPolicy, routingDomainPayload, type RoutingPolicy } from "@/schemas/admin/orchestrator-policy"
import { useBusinessDomainsQuery } from "@/queries/admin/use-business-domain-queries"
import { OrchestratorPolicyFields } from "./orchestrator-policy-fields"

const groupLabel = formatScopeLabel

/** Rótulo curto da política no card/tabela — "Sem política" é o aviso do legado (migration 054). */
function policyTagLabel(orchestrator: Orchestrator): string {
  const routing = resolveRoutingPolicy(orchestrator)
  switch (routing.kind) {
    case null:
      return "Sem política"
    case "OPEN":
      return "Qualquer assunto"
    case "DOMAINS":
      return routing.domains.length === 1 ? `Domínio: ${describeBusinessDomain(routing.domains[0]!)}` : `${routing.domains.length} domínios`
    case "LEGACY":
      return `Legado: ${routing.legacy.kind ? ORCHESTRATOR_POLICY_KIND_SHORT_LABELS[routing.legacy.kind] : "sem política"}`
  }
}

function CreateOrchestratorDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: (id: string) => void }) {
  const manageableTeamsQuery = useManageableTeamsQuery()
  const agentsQuery = useAgentsQuery()
  const createMutation = useCreateOrchestratorMutation()
  const orchestratorAgents = agentsQuery.data?.filter((agent) => agent.agentType === "ORCHESTRATOR") ?? []

  const [name, setName] = useState("")
  const [orchestratorAgentId, setOrchestratorAgentId] = useState("")
  const [orgScope, setOrgScope] = useState<OrgScopeValue>({ scopeType: "ALL_TEAMS" })
  // Escolhido já na criação (não só no editor): só pode existir UM orquestrador ativo atendendo o
  // chat/voz por escopo — um orquestrador de domínio para Workflows ("Só workflows") precisa
  // nascer com esse acionamento, senão a criação é recusada antes mesmo de abrir o editor.
  const [invocationMode, setInvocationMode] = useState<OrchestratorInvocationMode>("BOTH")
  // O Orquestrador nasce ATIVO — e ativo nunca fica sem política (migration 054): a política é
  // escolhida já aqui, não só no editor.
  const [routing, setRouting] = useState<RoutingPolicy>({ kind: null })
  // Catálogo dinâmico de domínios (só ativos) para "Domínios específicos".
  const businessDomainsQuery = useBusinessDomainsQuery()

  // Escopo Administrativo (Parte 10/11): admin restrito nunca começa em "Todos os grupos".
  const [scopeCheckedFor, setScopeCheckedFor] = useState<typeof manageableTeamsQuery.data>(undefined)
  if (scopeCheckedFor !== manageableTeamsQuery.data) {
    setScopeCheckedFor(manageableTeamsQuery.data)
    if (manageableTeamsQuery.data && !manageableTeamsQuery.data.unrestricted && orgScope.scopeType === "ALL_TEAMS") {
      setOrgScope({ scopeType: "TEAM" })
    }
  }

  async function handleCreate() {
    try {
      const orchestrator = await createMutation.mutateAsync({
        name,
        orgScope,
        orchestratorAgentId,
        specialistAgentIds: [],
        invocationMode,
        routingPolicy: routing.kind === "DOMAINS" || routing.kind === "OPEN" ? routing.kind : null,
        ...routingDomainPayload(routing),
      })
      setName("")
      setOrchestratorAgentId("")
      setOrgScope({ scopeType: "ALL_TEAMS" })
      setInvocationMode("BOTH")
      setRouting({ kind: null })
      onOpenChange(false)
      onCreated(orchestrator.id)
    } catch {
      // já sinalizado via createMutation.isError / toast do useAdminMutation
    }
  }

  const policyProblem = describeRoutingProblem(routing, { active: true, invocationMode })
  const canCreate = name.trim().length > 1 && Boolean(orchestratorAgentId) && policyProblem === null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Novo orquestrador</DialogTitle>
          <DialogDescription>Escolha o agente que atende o operador por chat e voz — os especialistas que ele pode acionar entram na tela seguinte.</DialogDescription>
        </DialogHeader>
        <div className="min-w-0 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="orchestrator-name">Nome</Label>
            <Input id="orchestrator-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: INIA — Time de Contas" />
          </div>
          <div className="space-y-1.5">
            <Label>Agente orquestrador</Label>
            {!agentsQuery.data ? (
              <Skeleton className="h-10 w-full" />
            ) : orchestratorAgents.length === 0 ? (
              <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                Nenhum agente do tipo &quot;Orquestrador&quot; ainda.{" "}
                <Link href="/admin/agents/new" className="underline underline-offset-2">
                  Crie um em Agentes
                </Link>{" "}
                antes de continuar — é ele quem identifica o pedido do operador e decide quais especialistas acionar.
              </p>
            ) : (
              <AgentPicker agents={orchestratorAgents} value={orchestratorAgentId} onChange={setOrchestratorAgentId} />
            )}
          </div>
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
          <div className="space-y-1.5">
            <Label>Onde pode ser acionado</Label>
            <Select value={invocationMode} onValueChange={(value) => setInvocationMode(value as OrchestratorInvocationMode)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(ORCHESTRATOR_INVOCATION_MODE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Orquestrador de domínio usado por Workflows: escolha &quot;Só workflows&quot; — assim ele coexiste com o orquestrador que atende o chat/voz.</p>
          </div>
          <OrchestratorPolicyFields routing={routing} domains={businessDomainsQuery.data ?? []} domainsLoading={businessDomainsQuery.isPending} onChange={setRouting} />
          {policyProblem && routing.kind !== null ? (
            <p className="text-xs text-destructive" role="alert">
              {policyProblem}
            </p>
          ) : null}
          {createMutation.isError ? <p className="text-sm text-destructive">{(createMutation.error as Error).message}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button disabled={!canCreate || createMutation.isPending} onClick={handleCreate}>
            {createMutation.isPending ? "Criando..." : "Criar e abrir"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DeleteOrchestratorButton({ orchestrator }: { orchestrator: Orchestrator }) {
  const deleteMutation = useDeleteOrchestratorMutation()
  const [open, setOpen] = useState(false)

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button size="icon" variant="ghost" aria-label="Excluir orquestrador" disabled={deleteMutation.isPending} onClick={(event) => event.stopPropagation()}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent onClick={(event) => event.stopPropagation()}>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir {orchestrator.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Essa ação não pode ser desfeita. Operadores no escopo dele voltam a receber a resposta genérica da INIA, sem acionar especialistas.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={deleteMutation.isPending}
            onClick={async () => {
              try {
                await deleteMutation.mutateAsync(orchestrator.id)
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

/** Legado desativado pela migration 054 (sem política): não dá pra ativar pela lista — abre o
 * editor, classifica, e só então o switch volta a funcionar. */
function isLegacyWithoutPolicy(orchestrator: Orchestrator): boolean {
  return !orchestrator.active && orchestrator.policyKind === null
}

function ActiveSwitch({ orchestrator }: { orchestrator: Orchestrator }) {
  const toggleActiveMutation = useToggleOrchestratorActiveMutation()
  const legacy = isLegacyWithoutPolicy(orchestrator)
  return (
    <Switch
      checked={orchestrator.active}
      disabled={toggleActiveMutation.isPending || legacy}
      title={legacy ? POLICY_REQUIRED_MESSAGE : undefined}
      aria-label={orchestrator.active ? "Desativar orquestrador" : "Ativar orquestrador"}
      onClick={(event) => event.stopPropagation()}
      onCheckedChange={(checked) => toggleActiveMutation.mutate({ id: orchestrator.id, active: checked })}
    />
  )
}

function OrchestratorCard({ orchestrator }: { orchestrator: Orchestrator }) {
  const tone = AGENT_TYPE_COLORS.ORCHESTRATOR
  const specialists = orchestrator.specialists.length
  return (
    <EntityCard
      muted={!orchestrator.active}
      icon={<EntityCardIcon icon={Waypoints} className={`${tone.iconBg} ${tone.icon}`} />}
      kicker={
        <>
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Orquestrador</span>
          <span aria-hidden>·</span>
          <span>{groupLabel(orchestrator)}</span>
        </>
      }
      title={orchestrator.name}
      href={`/admin/assistant/${orchestrator.id}`}
      actions={
        <>
          <ActiveSwitch orchestrator={orchestrator} />
          <DeleteOrchestratorButton orchestrator={orchestrator} />
        </>
      }
      description={
        specialists === 0
          ? `Agente ${orchestrator.orchestratorAgentName} responde sozinho — nenhum especialista configurado.`
          : `Agente ${orchestrator.orchestratorAgentName} aciona ${orchestrator.specialists.map((specialist) => specialist.agentName).join(", ")}.`
      }
      tags={
        <>
          <EntityCardTag icon={Users}>
            {specialists} {specialists === 1 ? "especialista" : "especialistas"}
          </EntityCardTag>
          <EntityCardTag icon={orchestrator.invocationMode === "WORKFLOW" ? Workflow : MessagesSquare}>{ORCHESTRATOR_INVOCATION_MODE_LABELS[orchestrator.invocationMode]}</EntityCardTag>
          <EntityCardTag icon={orchestrator.policyKind === null ? TriangleAlert : ShieldCheck}>{policyTagLabel(orchestrator)}</EntityCardTag>
        </>
      }
      footerStart={
        <span className="inline-flex items-center gap-1">
          <CalendarClock className="size-3.5" />
          <time dateTime={orchestrator.createdAt}>{formatDateOnly(orchestrator.createdAt)}</time>
        </span>
      }
      footerEnd={<Badge variant={orchestrator.active ? "secondary" : "outline"}>{orchestrator.active ? "Ativo" : "Inativo"}</Badge>}
    />
  )
}

function OrchestratorsTable({ orchestrators }: { orchestrators: Orchestrator[] }) {
  const router = useRouter()
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {/* 8 colunas com whitespace-nowrap estouravam a largura em 1024px (QA visual) — as
             * colunas secundárias só entram a partir de xl, e as de texto longo podem quebrar linha. */}
            <TableHead>Nome</TableHead>
            <TableHead>Agente orquestrador</TableHead>
            <TableHead>Especialistas</TableHead>
            <TableHead>Acionamento</TableHead>
            <TableHead>Política</TableHead>
            <TableHead className="hidden xl:table-cell">Grupo</TableHead>
            <TableHead className="hidden xl:table-cell">Criado em</TableHead>
            <TableHead>Status</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {orchestrators.map((orchestrator) => (
            <TableRow key={orchestrator.id} className="cursor-pointer" onClick={() => router.push(`/admin/assistant/${orchestrator.id}`)}>
              <TableCell className="font-medium whitespace-normal">{orchestrator.name}</TableCell>
              <TableCell className="text-sm whitespace-normal text-muted-foreground">{orchestrator.orchestratorAgentName}</TableCell>
              <TableCell>
                <Badge variant="outline">{orchestrator.specialists.length}</Badge>
              </TableCell>
              <TableCell className="text-sm whitespace-normal text-muted-foreground">{ORCHESTRATOR_INVOCATION_MODE_LABELS[orchestrator.invocationMode]}</TableCell>
              <TableCell className="text-sm whitespace-normal">
                <Badge variant={orchestrator.policyKind === null ? "destructive" : "outline"}>{policyTagLabel(orchestrator)}</Badge>
              </TableCell>
              <TableCell className="hidden text-sm text-muted-foreground xl:table-cell">{groupLabel(orchestrator)}</TableCell>
              <TableCell className="hidden text-sm text-muted-foreground xl:table-cell">
                <time dateTime={orchestrator.createdAt}>{formatDateOnly(orchestrator.createdAt)}</time>
              </TableCell>
              <TableCell>
                <ActiveSwitch orchestrator={orchestrator} />
              </TableCell>
              <TableCell className="text-right">
                <DeleteOrchestratorButton orchestrator={orchestrator} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

type OrchestratorFilters = Omit<OrchestratorListParams, "page" | "pageSize" | "search"> & { search: string }

const DEFAULT_FILTERS: OrchestratorFilters = { search: "", invocationMode: [], createdAt: {} }
const INVOCATION_MODE_OPTIONS = optionsFromLabels(ORCHESTRATOR_INVOCATION_MODE_LABELS)

export function AssistantPage() {
  const router = useRouter()
  const teamsQuery = useTeamsQuery()
  const agentsQuery = useAgentsQuery()
  const [autoOpen, setAutoOpen] = useAutoOpenFromQuery("new")
  const [createOpen, setCreateOpen] = useState(false)

  const list = useAdminListState({ storageKey: "assistant-orchestrators", defaultFilters: DEFAULT_FILTERS })
  const pageQuery = useOrchestratorsPageQuery(list.params)

  const orchestratorAgentOptions = (agentsQuery.data ?? []).filter((agent) => agent.agentType === "ORCHESTRATOR").map((agent) => ({ value: agent.id, label: agent.name }))
  const specialistAgentOptions = (agentsQuery.data ?? []).filter((agent) => agent.agentType !== "ORCHESTRATOR").map((agent) => ({ value: agent.id, label: agent.name }))

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
            <CardTitle>Orquestrador da INIA</CardTitle>
            <CardDescription>
              Quando o operador fala ou digita com a INIA, o agente orquestrador decide sozinho quais especialistas acionar (um ou vários) e sintetiza a
              resposta final.
            </CardDescription>
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus /> Novo orquestrador
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <ListToolbar
          search={
            <ListSearchInput
              value={list.filters.search}
              onChange={(value) => list.setFilter("search", value)}
              placeholder="Buscar por nome ou agente orquestrador"
              ariaLabel="Buscar orquestrador"
              pending={list.isSearchPending}
            />
          }
          viewToggle={<ListViewToggle value={list.view} onChange={list.setView} />}
          hasActiveFilters={list.hasActiveFilters}
          onClearFilters={list.resetFilters}
        >
          <ListBooleanFilter value={list.filters.active} onChange={(value) => list.setFilter("active", value)} allLabel="Qualquer status" trueLabel="Ativos" falseLabel="Inativos" ariaLabel="Filtrar por status" />
          <ListMultiSelectFilter label="Acionamento" values={list.filters.invocationMode} onChange={(values) => list.setFilter("invocationMode", values)} options={INVOCATION_MODE_OPTIONS} />
          <ListOrgScopeFilter
            teams={teamsQuery.data}
            value={{ scopeType: list.filters.scopeType, teamId: list.filters.teamId, subteamId: list.filters.subteamId }}
            onChange={(scope) => list.patchFilters({ scopeType: scope.scopeType, teamId: scope.teamId, subteamId: scope.subteamId })}
          />
          <ListSelectFilter
            value={list.filters.orchestratorAgentId}
            onChange={(value) => list.setFilter("orchestratorAgentId", value)}
            options={orchestratorAgentOptions}
            allLabel="Qualquer agente orquestrador"
            ariaLabel="Filtrar por agente orquestrador"
          />
          <ListSelectFilter
            value={list.filters.specialistAgentId}
            onChange={(value) => list.setFilter("specialistAgentId", value)}
            options={specialistAgentOptions}
            allLabel="Qualquer especialista"
            ariaLabel="Filtrar por especialista"
          />
          <ListDateRangeFilter label="Criado em" value={list.filters.createdAt} onChange={(value) => list.setFilter("createdAt", value)} />
        </ListToolbar>

        <AdminListView
          state={list}
          query={pageQuery}
          errorMessage="Não foi possível carregar os orquestradores."
          empty={{
            icon: Waypoints,
            title: "Nenhum orquestrador configurado ainda",
            description: "Sem orquestrador, a INIA responde com a persona genérica, sem acionar especialistas.",
            action: (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus /> Novo orquestrador
              </Button>
            ),
          }}
          noResultsTitle="Nenhum orquestrador corresponde à busca ou aos filtros"
          itemLabel={["orquestrador", "orquestradores"]}
          renderList={(orchestrators) => <OrchestratorsTable orchestrators={orchestrators} />}
          renderCards={(orchestrators) => (
            <ListCardGrid>
              {orchestrators.map((orchestrator) => (
                <OrchestratorCard key={orchestrator.id} orchestrator={orchestrator} />
              ))}
            </ListCardGrid>
          )}
        />
      </CardContent>

      <CreateOrchestratorDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={(id) => router.push(`/admin/assistant/${id}`)} />
    </Card>
  )
}
