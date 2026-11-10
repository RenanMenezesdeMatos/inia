"use client"

import { useState } from "react"
import { CalendarClock, Eye, Layers, Pencil, PhoneCall, Plus, Trash2, Users } from "lucide-react"

import { useAutoOpenFromQuery } from "@/hooks/use-auto-open-from-query"
import { useAdminListState } from "@/hooks/use-admin-list-state"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { TABLE_FRAME, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

import { AdminListView } from "@/components/admin/shared/list/admin-list-view"
import { EntityCard, EntityCardIcon, EntityCardTag } from "@/components/admin/shared/list/entity-card"
import { ListBooleanFilter, ListOrgScopeFilter, ListSearchInput, ListSelectFilter, ListToolbar } from "@/components/admin/shared/list/list-filters"
import { ListCardGrid } from "@/components/admin/shared/list/list-states"
import { ListViewToggle } from "@/components/admin/shared/list/list-view-toggle"
import { useArgumentScriptsPageQuery } from "@/queries/admin/use-argument-script-queries"
import { useBusinessDomainsQuery } from "@/queries/admin/use-business-domain-queries"
import { useTeamsQuery } from "@/queries/admin/use-org-structure-queries"
import { ARGUMENT_SCRIPT_STATUS_LABELS, LEGACY_CONVERSION_LABEL, READ_ONLY_LABEL, type ArgumentScript, type ArgumentScriptConversion, type ArgumentScriptStatus } from "@/schemas/admin/argument-script.schema"
import type { ArgumentScriptListParams } from "@/services/admin/argument-script-service"

import { ArgumentScriptCreateForm, ArgumentScriptDetailPanel } from "./argument-script-editor"
import { ArgumentScriptLifecycleDialog, type ArgumentScriptLifecycleAction } from "./argument-script-lifecycle"
import { scopeLabel, validityLabel } from "./argument-script-format"

/**
 * Argumentários (substitui as antigas "Regras de chamada"): o que se espera do operador numa SITUAÇÃO da chamada — condição,
 * exceções, o que deve/pode fazer, o que precisa ser dito, o que evitar —, por área responsável e escopo. Rascunho → publicar
 * (com início de vigência, nunca retroativo) → desativar/reativar; versões publicadas não mudam. Publicar é administrar
 * conteúdo, nunca aprovar feedback.
 */

function currentVersionLabel(item: ArgumentScript) {
  if (item.currentVersion === null) return "Nunca publicado"
  const validity = validityLabel(item.currentEffectiveFrom, item.currentEffectiveUntil)
  return validity ? `v${item.currentVersion} · ${validity}` : `v${item.currentVersion}`
}

function ItemBadges({ item }: { item: ArgumentScript }) {
  const badges = [
    item.draftVersion !== null ? <Badge key="draft" variant="outline">Rascunho v{item.draftVersion}</Badge> : null,
    item.conversion === "LEGACY_UNSTRUCTURED" ? <Badge key="legacy" variant="destructive">{LEGACY_CONVERSION_LABEL}</Badge> : null,
    item.canEdit ? null : <Badge key="readonly" variant="outline">{READ_ONLY_LABEL}</Badge>,
  ].filter(Boolean)
  if (badges.length === 0) return null
  return <div className="flex flex-wrap gap-1">{badges}</div>
}

function StatusBadge({ status }: { status: ArgumentScriptStatus }) {
  return <Badge variant={status === "ACTIVE" ? "secondary" : "outline"}>{ARGUMENT_SCRIPT_STATUS_LABELS[status]}</Badge>
}

/**
 * Ações da linha/card: interruptor Ativo/Inativo (só para o que já foi publicado — o rascunho que nunca valeu se exclui), abrir e
 * excluir. O interruptor não muda nada sozinho: abre a mesma confirmação do editor (desativar vale a partir de agora).
 */
function RowActions({ item, onOpen }: { item: ArgumentScript; onOpen: (item: ArgumentScript) => void }) {
  const [action, setAction] = useState<ArgumentScriptLifecycleAction | null>(null)
  const canToggle = item.canEdit && (item.currentVersion !== null || item.status === "ARCHIVED")
  return (
    <>
      {canToggle ? (
        <Switch
          checked={item.status === "ACTIVE"}
          aria-label={`${item.status === "ACTIVE" ? "Desativar" : "Reativar"} ${item.name}`}
          onCheckedChange={(checked) => setAction(checked ? "reactivate" : "archive")}
        />
      ) : null}
      <Button size="icon" variant="ghost" aria-label={`${item.canEdit ? "Editar" : "Ver"} ${item.name}`} onClick={() => onOpen(item)}>
        {item.canEdit ? <Pencil className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </Button>
      {item.canEdit ? (
        <Button size="icon" variant="ghost" aria-label={`Excluir ${item.name}`} onClick={() => setAction("delete")}>
          <Trash2 className="h-4 w-4" />
        </Button>
      ) : null}
      {action ? <ArgumentScriptLifecycleDialog target={{ id: item.id, name: item.name, hasDraft: item.draftVersion !== null }} action={action} onClose={() => setAction(null)} /> : null}
    </>
  )
}

function ArgumentScriptsTable({ items, onOpen }: { items: ArgumentScript[]; onOpen: (item: ArgumentScript) => void }) {
  return (
    <div className={TABLE_FRAME}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Argumentário</TableHead>
            <TableHead>Área</TableHead>
            <TableHead>Escopo</TableHead>
            <TableHead>Versão vigente</TableHead>
            <TableHead>Status</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id} className={item.status === "ACTIVE" ? undefined : "opacity-70"} data-testid={`argument-script-row-${item.id}`}>
              <TableCell className="max-w-sm whitespace-normal">
                <button type="button" className="text-left font-medium underline-offset-2 hover:underline" onClick={() => onOpen(item)}>
                  {item.name}
                </button>
                <div className="mt-1">
                  <ItemBadges item={item} />
                </div>
              </TableCell>
              <TableCell className="text-sm">{item.businessDomainName ?? "—"}</TableCell>
              <TableCell className="text-sm">{scopeLabel(item)}</TableCell>
              <TableCell className="text-sm text-muted-foreground">{currentVersionLabel(item)}</TableCell>
              <TableCell>
                <StatusBadge status={item.status} />
              </TableCell>
              <TableCell>
                <div className="flex items-center justify-end gap-2">
                  <RowActions item={item} onOpen={onOpen} />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function ArgumentScriptCard({ item, onOpen }: { item: ArgumentScript; onOpen: (item: ArgumentScript) => void }) {
  return (
    <EntityCard
      muted={item.status !== "ACTIVE"}
      icon={<EntityCardIcon icon={PhoneCall} className="bg-sky-100 text-sky-600 dark:bg-sky-950 dark:text-sky-300" />}
      kicker={
        <>
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Argumentário</span>
          <span aria-hidden>·</span>
          <span>{item.businessDomainName ?? "Sem área"}</span>
        </>
      }
      title={item.name}
      onOpen={() => onOpen(item)}
      actions={<RowActions item={item} onOpen={onOpen} />}
      description={`Vale para ${scopeLabel(item).toLocaleLowerCase("pt-BR")}. ${currentVersionLabel(item)}.`}
      tags={
        <>
          {item.businessDomainName ? <EntityCardTag icon={Layers}>{item.businessDomainName}</EntityCardTag> : null}
          <EntityCardTag icon={Users}>{scopeLabel(item)}</EntityCardTag>
        </>
      }
      footerStart={
        <span className="inline-flex items-center gap-1">
          <CalendarClock className="size-3.5" />
          {currentVersionLabel(item)}
        </span>
      }
      footerEnd={<StatusBadge status={item.status} />}
    >
      <ItemBadges item={item} />
    </EntityCard>
  )
}

type ArgumentScriptFilters = Omit<ArgumentScriptListParams, "page" | "pageSize" | "search"> & { search: string }

const DEFAULT_FILTERS: ArgumentScriptFilters = { search: "" }

const STATUS_OPTIONS = [
  { value: "ACTIVE" as const, label: "Ativos" },
  { value: "ARCHIVED" as const, label: "Inativos" },
]

const CONVERSION_OPTIONS = [
  { value: "LEGACY_UNSTRUCTURED" as const, label: "Convertidos do cadastro antigo" },
  { value: "NATIVE" as const, label: "Criados como argumentário" },
]

type View = { tab: "list" } | { tab: "form"; selectedId: string | null }

export function ArgumentScriptsPage() {
  const teamsQuery = useTeamsQuery()
  const domainsQuery = useBusinessDomainsQuery({ includeInactive: true })
  const list = useAdminListState({ storageKey: "argument-scripts", defaultFilters: DEFAULT_FILTERS })
  const pageQuery = useArgumentScriptsPageQuery(list.params)

  // `?new=1` (atalho da sidebar) abre o formulário de criação sem efeito: o pedido da URL vale até a primeira navegação.
  const [autoOpen, setAutoOpen] = useAutoOpenFromQuery("new")
  const [state, setState] = useState<View>({ tab: "list" })
  const view: View = autoOpen ? { tab: "form", selectedId: null } : state

  function go(next: View) {
    setAutoOpen(false)
    setState(next)
  }

  const openCreate = () => go({ tab: "form", selectedId: null })
  const openItem = (item: ArgumentScript) => go({ tab: "form", selectedId: item.id })
  const backToList = () => go({ tab: "list" })

  const selectedId = view.tab === "form" ? view.selectedId : null
  const formLabel = view.tab === "form" && selectedId === null ? "Novo argumentário" : "Argumentário"

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Argumentários</CardTitle>
            <CardDescription>
              O que se espera do operador numa situação da chamada: quando vale, o que ele deve ou pode fazer, o que precisa dizer e o que evitar. Cada argumentário tem área responsável, escopo e versões com início de vigência.
            </CardDescription>
          </div>
          {view.tab === "list" ? (
            <Button onClick={openCreate}>
              <Plus /> Novo argumentário
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        <Tabs value={view.tab} onValueChange={(value) => (value === "list" ? backToList() : go({ tab: "form", selectedId }))}>
          <TabsList>
            <TabsTrigger value="list">Lista</TabsTrigger>
            <TabsTrigger value="form">{formLabel}</TabsTrigger>
          </TabsList>

          <TabsContent value="list" className="mt-4 space-y-4">
            <ListToolbar
              search={
                <ListSearchInput
                  value={list.filters.search}
                  onChange={(value) => list.setFilter("search", value)}
                  placeholder="Buscar por nome, área, grupo ou subgrupo"
                  ariaLabel="Buscar argumentário"
                  pending={list.isSearchPending}
                />
              }
              viewToggle={<ListViewToggle value={list.view} onChange={list.setView} />}
              hasActiveFilters={list.hasActiveFilters}
              onClearFilters={list.resetFilters}
            >
              <ListOrgScopeFilter
                teams={teamsQuery.data}
                value={{ scopeType: list.filters.scopeType, teamId: list.filters.teamId, subteamId: list.filters.subteamId }}
                onChange={(scope) => list.patchFilters({ scopeType: scope.scopeType, teamId: scope.teamId, subteamId: scope.subteamId })}
              />
              <ListSelectFilter
                value={list.filters.businessDomainId}
                onChange={(value) => list.setFilter("businessDomainId", value)}
                options={(domainsQuery.data ?? []).map((domain) => ({ value: domain.id, label: domain.name }))}
                allLabel="Qualquer área"
                ariaLabel="Filtrar por área responsável"
              />
              <ListSelectFilter value={list.filters.status} onChange={(value) => list.setFilter("status", value)} options={STATUS_OPTIONS} allLabel="Qualquer status" ariaLabel="Filtrar por status" />
              <ListBooleanFilter value={list.filters.hasDraft} onChange={(value) => list.setFilter("hasDraft", value)} allLabel="Com ou sem rascunho" trueLabel="Com rascunho" falseLabel="Sem rascunho" ariaLabel="Filtrar por rascunho" />
              <ListSelectFilter<ArgumentScriptConversion> value={list.filters.conversion} onChange={(value) => list.setFilter("conversion", value)} options={CONVERSION_OPTIONS} allLabel="Qualquer origem" ariaLabel="Filtrar por origem do cadastro" />
            </ListToolbar>

            <AdminListView
              state={list}
              query={pageQuery}
              errorMessage="Não foi possível carregar os argumentários."
              empty={{
                icon: PhoneCall,
                title: "Nenhum argumentário cadastrado ainda",
                description: "Descreva a situação da chamada e o que se espera do operador nela.",
                action: (
                  <Button onClick={openCreate}>
                    <Plus /> Novo argumentário
                  </Button>
                ),
              }}
              noResultsTitle="Nenhum argumentário corresponde à busca ou aos filtros"
              itemLabel={["argumentário", "argumentários"]}
              renderList={(items) => <ArgumentScriptsTable items={items} onOpen={openItem} />}
              renderCards={(items) => (
                <ListCardGrid>
                  {items.map((item) => (
                    <ArgumentScriptCard key={item.id} item={item} onOpen={openItem} />
                  ))}
                </ListCardGrid>
              )}
            />
          </TabsContent>

          <TabsContent value="form" className="mt-4">
            {view.tab === "form" ? (
              selectedId === null ? (
                <ArgumentScriptCreateForm onCreated={(id) => go({ tab: "form", selectedId: id })} onCancel={backToList} />
              ) : (
                <ArgumentScriptDetailPanel id={selectedId} onBack={backToList} onDeleted={backToList} />
              )
            ) : null}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}
