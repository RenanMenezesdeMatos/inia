"use client"

import { useEffect, useState } from "react"
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
import { PageHeader } from "@/components/ui/surface"
import { Card, CardContent } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { TABLE_FRAME, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

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
import { formatScopeLabel } from "@/lib/admin/scope-compatibility"
import { useAgentsQuery } from "@/queries/admin/use-agent-queries"
import { useTeamsQuery } from "@/queries/admin/use-org-structure-queries"
import {
  useDeleteOrchestratorMutation,
  useOrchestratorsPageQuery,
  useToggleOrchestratorActiveMutation,
} from "@/queries/admin/use-assistant-queries"
import type { OrchestratorListParams } from "@/services/admin/assistant-service"
import { AGENT_TYPE_COLORS } from "@/schemas/admin/agent.schema"
import { ORCHESTRATOR_INVOCATION_MODE_LABELS, type Orchestrator } from "@/schemas/admin/assistant.schema"
import { describeBusinessDomain } from "@/schemas/admin/business-domain.schema"
import { ORCHESTRATOR_POLICY_KIND_SHORT_LABELS, POLICY_REQUIRED_MESSAGE, resolveRoutingPolicy } from "@/schemas/admin/orchestrator-policy"
import { cn } from "@/lib/utils"
import { RESTORE_NOTE } from "@/lib/admin/logical-delete"

const groupLabel = formatScopeLabel
const NEW_HREF = "/admin/assistant/new"

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
            Operadores no escopo dele voltam a receber a resposta genérica da INIA, sem acionar especialistas. {RESTORE_NOTE}
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
      icon={<EntityCardIcon icon={Waypoints} className={cn(tone.iconBg, tone.icon)} />}
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
    <div className={TABLE_FRAME}>
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
              <TableCell className="font-medium whitespace-normal">
                {/* A linha abre pelo clique; o nome é o link para quem navega pelo teclado (como no card). */}
                <Link href={`/admin/assistant/${orchestrator.id}`} className="hover:underline" onClick={(event) => event.stopPropagation()}>
                  {orchestrator.name}
                </Link>
              </TableCell>
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
  const [autoOpen] = useAutoOpenFromQuery("new")

  const list = useAdminListState({ storageKey: "assistant-orchestrators", defaultFilters: DEFAULT_FILTERS })
  const pageQuery = useOrchestratorsPageQuery(list.params)

  const orchestratorAgentOptions = (agentsQuery.data ?? []).filter((agent) => agent.agentType === "ORCHESTRATOR").map((agent) => ({ value: agent.id, label: agent.name }))
  const specialistAgentOptions = (agentsQuery.data ?? []).filter((agent) => agent.agentType !== "ORCHESTRATOR").map((agent) => ({ value: agent.id, label: agent.name }))

  // Compatibilidade com o atalho antigo "?new" — o cadastro agora tem rota própria, como Agentes e Base de conhecimento.
  useEffect(() => {
    if (autoOpen) router.replace(NEW_HREF)
  }, [autoOpen, router])

  return (
    <section className="space-y-4">
      <PageHeader
        icon={Waypoints}
        title="Orquestrador da INIA"
        description="Quando o operador fala ou digita com a INIA, o agente orquestrador decide sozinho quais especialistas acionar (um ou vários) e sintetiza a resposta final."
        actions={
          <Button asChild>
            <Link href={NEW_HREF}>
              <Plus /> Novo orquestrador
            </Link>
          </Button>
        }
      />
      <Card>
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
                <Button asChild>
                  <Link href={NEW_HREF}>
                    <Plus /> Novo orquestrador
                  </Link>
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

      </Card>
    </section>
  )
}
