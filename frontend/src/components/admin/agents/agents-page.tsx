"use client"

import Link from "next/link"
import { Bot, BookOpen, CalendarClock, Plus, ShieldBan, UserRound, Zap } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { TABLE_FRAME, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useAdminListState } from "@/hooks/use-admin-list-state"
import { cn } from "@/lib/utils"

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
import { useAgentsPageQuery, useToggleAgentActiveMutation } from "@/queries/admin/use-agent-queries"
import { useCurrentUserQuery } from "@/queries/auth/use-current-user"
import { useKnowledgeDocumentsQuery } from "@/queries/admin/use-knowledge-queries"
import { useTeamsQuery } from "@/queries/admin/use-org-structure-queries"
import type { AgentListParams } from "@/services/admin/agent-service"
import { AGENT_TYPE_COLORS, AGENT_TYPE_LABELS, agentPublicationLabel, type Agent } from "@/schemas/admin/agent.schema"

import { AGENT_TYPE_ICONS } from "./agent-visuals"
import { DeleteAgentDialog } from "./agent-lifecycle/delete-agent-dialog"

function groupLabel(agent: Pick<Agent, "scopeType" | "teamName" | "subteamName">) {
  if (agent.scopeType === "ALL_TEAMS") return "Todos os grupos"
  return agent.subteamName ?? agent.teamName ?? "—"
}

function ActiveSwitch({ agent }: { agent: Agent }) {
  const toggleActiveMutation = useToggleAgentActiveMutation()
  return (
    <Switch
      checked={agent.active}
      disabled={toggleActiveMutation.isPending}
      aria-label={agent.active ? "Desativar agente" : "Ativar agente"}
      onCheckedChange={(checked) => toggleActiveMutation.mutate({ id: agent.id, active: checked })}
    />
  )
}

/** Versão em uso, "Não publicado" (só testes — PEN-047) e rascunho pendente (PEN-002). */
function PublicationBadge({ agent }: { agent: Agent }) {
  return (
    <>
      <Badge variant={agent.published ? "outline" : "secondary"}>{agentPublicationLabel(agent)}</Badge>
      {agent.published && agent.hasDraft ? <Badge variant="outline">Rascunho pendente</Badge> : null}
    </>
  )
}

function AgentCard({ agent }: { agent: Agent }) {
  const Icon = AGENT_TYPE_ICONS[agent.agentType]
  const tone = AGENT_TYPE_COLORS[agent.agentType]
  return (
    <EntityCard
      muted={!agent.active}
      icon={<EntityCardIcon icon={Icon} className={cn(tone.iconBg, tone.icon)} />}
      kicker={
        <>
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{AGENT_TYPE_LABELS[agent.agentType]}</span>
          <span aria-hidden>·</span>
          <span>{groupLabel(agent)}</span>
        </>
      }
      title={agent.name}
      href={`/admin/agents/${agent.id}`}
      actions={
        <>
          <ActiveSwitch agent={agent} />
          <DeleteAgentDialog agent={agent} />
        </>
      }
      description={agent.objective}
      descriptionFallback="Sem objetivo descrito."
      tags={
        <>
          <EntityCardTag icon={BookOpen}>
            {agent.knowledgeDocuments.length} {agent.knowledgeDocuments.length === 1 ? "base" : "bases"}
          </EntityCardTag>
          {agent.actionLimitsEnabled ? <EntityCardTag icon={ShieldBan}>Com limites de atuação</EntityCardTag> : null}
          <EntityCardTag icon={Zap}>
            {agent.usageCount} {agent.usageCount === 1 ? "execução" : "execuções"}
          </EntityCardTag>
        </>
      }
      footerStart={
        <>
          <span className="inline-flex items-center gap-1">
            <UserRound className="size-3.5" />
            {agent.createdByName ? <span className="text-foreground/80">{agent.createdByName}</span> : <span className="italic">Autor não informado</span>}
          </span>
          <span className="inline-flex items-center gap-1">
            <CalendarClock className="size-3.5" />
            <time dateTime={agent.createdAt}>{formatDateOnly(agent.createdAt)}</time>
          </span>
        </>
      }
      footerEnd={
        <span className="flex items-center gap-1.5">
          <PublicationBadge agent={agent} />
          <Badge variant={agent.active ? "secondary" : "outline"}>{agent.active ? "Ativo" : "Inativo"}</Badge>
        </span>
      }
    />
  )
}

function AgentsTable({ agents }: { agents: Agent[] }) {
  return (
    <div className={TABLE_FRAME}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Agente</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead>Grupo</TableHead>
            <TableHead>Bases</TableHead>
            <TableHead>Execuções</TableHead>
            <TableHead>Versão</TableHead>
            <TableHead>Criado em</TableHead>
            <TableHead>Status</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {agents.map((agent) => {
            const Icon = AGENT_TYPE_ICONS[agent.agentType]
            const tone = AGENT_TYPE_COLORS[agent.agentType]
            return (
              <TableRow key={agent.id} className={agent.active ? undefined : "opacity-60"}>
                <TableCell>
                  <div className="flex items-center gap-2.5">
                    <EntityCardIcon icon={Icon} className={cn("size-8", tone.iconBg, tone.icon)} />
                    <div className="min-w-0">
                      {/* Célula sem quebra de linha (kit): `truncate` corta com reticências; o texto inteiro fica no title. */}
                      <Link href={`/admin/agents/${agent.id}`} className="block max-w-md truncate font-medium hover:underline" title={agent.name}>
                        {agent.name}
                      </Link>
                      <p className="max-w-md truncate text-xs text-muted-foreground" title={agent.objective}>{agent.objective}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{AGENT_TYPE_LABELS[agent.agentType]}</Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{groupLabel(agent)}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{agent.knowledgeDocuments.length}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{agent.usageCount}</TableCell>
                <TableCell>
                  <span className="flex flex-wrap gap-1">
                    <PublicationBadge agent={agent} />
                  </span>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  <time dateTime={agent.createdAt}>{formatDateOnly(agent.createdAt)}</time>
                </TableCell>
                <TableCell>
                  <ActiveSwitch agent={agent} />
                </TableCell>
                <TableCell className="text-right">
                  <DeleteAgentDialog agent={agent} />
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

type AgentFilters = Omit<AgentListParams, "page" | "pageSize" | "search"> & { search: string }

// A listagem principal mostra só agentes ativos (PEN-001); inativos, só para administradores, pelo filtro de status.
const DEFAULT_FILTERS: AgentFilters = { search: "", agentType: [], createdAt: {}, active: true }
const AGENT_TYPE_OPTIONS = optionsFromLabels(AGENT_TYPE_LABELS)

export function AgentsPage() {
  const teamsQuery = useTeamsQuery()
  const knowledgeQuery = useKnowledgeDocumentsQuery()
  const list = useAdminListState({ storageKey: "agents", defaultFilters: DEFAULT_FILTERS })
  const pageQuery = useAgentsPageQuery(list.params)
  const canManageInactive = useCurrentUserQuery().data?.access.capabilities.canManageInactiveAgents ?? false

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Agentes</CardTitle>
            <CardDescription>Configure nome, objetivo, contexto e quais bases de conhecimento cada agente consulta.</CardDescription>
          </div>
          <Button asChild>
            <Link href="/admin/agents/new">
              <Plus /> Novo agente
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <ListToolbar
          search={
            <ListSearchInput
              value={list.filters.search}
              onChange={(value) => list.setFilter("search", value)}
              placeholder="Buscar por nome, objetivo ou descrição"
              ariaLabel="Buscar agente"
              pending={list.isSearchPending}
            />
          }
          viewToggle={<ListViewToggle value={list.view} onChange={list.setView} />}
          hasActiveFilters={list.hasActiveFilters}
          onClearFilters={list.resetFilters}
        >
          <ListMultiSelectFilter label="Tipo" values={list.filters.agentType} onChange={(values) => list.setFilter("agentType", values)} options={AGENT_TYPE_OPTIONS} />
          {canManageInactive ? (
            <ListBooleanFilter value={list.filters.active} onChange={(value) => list.setFilter("active", value)} allLabel="Qualquer status" trueLabel="Ativos" falseLabel="Inativos" ariaLabel="Filtrar por status" />
          ) : null}
          <ListOrgScopeFilter
            teams={teamsQuery.data}
            value={{ scopeType: list.filters.scopeType, teamId: list.filters.teamId, subteamId: list.filters.subteamId }}
            onChange={(scope) => list.patchFilters({ scopeType: scope.scopeType, teamId: scope.teamId, subteamId: scope.subteamId })}
          />
          <ListSelectFilter
            value={list.filters.knowledgeDocumentId}
            onChange={(value) => list.setFilter("knowledgeDocumentId", value)}
            options={(knowledgeQuery.data ?? []).map((document) => ({ value: document.id, label: document.title }))}
            allLabel="Qualquer base de conhecimento"
            ariaLabel="Filtrar por base de conhecimento"
            className="sm:max-w-64"
          />
          <ListDateRangeFilter label="Criado em" value={list.filters.createdAt} onChange={(value) => list.setFilter("createdAt", value)} />
        </ListToolbar>

        <AdminListView
          state={list}
          query={pageQuery}
          errorMessage="Não foi possível carregar os agentes."
          empty={{
            icon: Bot,
            title: "Nenhum agente cadastrado ainda",
            description: "Crie o primeiro agente para começar a gerar feedbacks e diagnósticos.",
            action: (
              <Button asChild>
                <Link href="/admin/agents/new">
                  <Plus /> Novo agente
                </Link>
              </Button>
            ),
          }}
          noResultsTitle="Nenhum agente corresponde à busca ou aos filtros"
          itemLabel={["agente", "agentes"]}
          renderList={(agents) => <AgentsTable agents={agents} />}
          renderCards={(agents) => (
            <ListCardGrid>
              {agents.map((agent) => (
                <AgentCard key={agent.id} agent={agent} />
              ))}
            </ListCardGrid>
          )}
        />
      </CardContent>
    </Card>
  )
}
