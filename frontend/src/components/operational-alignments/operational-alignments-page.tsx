"use client"

import { linksLabel } from "@/lib/scope-links/scope-links"

import { useEffect, useState } from "react"
import { CalendarClock, FileText, MoreHorizontal, Pencil, Plus, Trash2, Users } from "lucide-react"

import { AdminListView } from "@/components/admin/shared/list/admin-list-view"
import { EntityCard, EntityCardIcon, EntityCardTag } from "@/components/admin/shared/list/entity-card"
import { ListBooleanFilter, ListOrgScopeFilter, ListSearchInput, ListSelectFilter, ListToolbar } from "@/components/admin/shared/list/list-filters"
import { ListCardGrid } from "@/components/admin/shared/list/list-states"
import { ListViewToggle } from "@/components/admin/shared/list/list-view-toggle"
import { UniverseBadge } from "@/components/operating-universe/universe-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { PageHeader, StatusChip } from "@/components/ui/surface"
import { TABLE_FRAME, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useAdminListState } from "@/hooks/use-admin-list-state"
import { formatCivilDate } from "@/lib/format/date"
import { useAlignmentScopeOptionsQuery, useAlignmentsPageQuery } from "@/queries/operational-alignments/use-operational-alignment-queries"
import { ALIGNMENT_STATE_LABELS, type AlignmentListItem, type AlignmentState } from "@/schemas/operational-alignments/operational-alignment.schema"
import type { OperatingUniverse } from "@/schemas/operating-universe/operating-universe.schema"

import { AlignmentDetailPanel, AlignmentForm, DeleteConfirm, STATE_TONE } from "./alignment-editor"
import { AlignmentReasonsPanel } from "./alignment-reasons-panel"
import { keepCompatibleScope, teamsForUniverse } from "./scope-hierarchy"

type Filters = { search: string; state?: AlignmentState; operatingUniverse?: OperatingUniverse; hasDraft?: boolean; scopeType?: "ALL_TEAMS"; teamId?: string; subteamId?: string }
const DEFAULT_FILTERS: Filters = { search: "" }
const STATE_OPTIONS = (Object.keys(ALIGNMENT_STATE_LABELS) as AlignmentState[]).map((value) => ({ value, label: ALIGNMENT_STATE_LABELS[value] }))
const UNIVERSE_OPTIONS = (["B2B", "B2C", "B2X"] as const).map((value) => ({ value, label: value }))

const audienceOf = (item: AlignmentListItem) => {
  const scope = item.scopeType === "UNIVERSE" ? "Todo o universo" : linksLabel(item.links)
  return item.productName ? `${scope} · ${item.productName}` : scope
}
const processesOf = (item: AlignmentListItem) => (item.processCount <= item.processTitles.length ? item.processTitles.join(", ") : `${item.processTitles.join(", ")} e mais ${item.processCount - item.processTitles.length}`)
const periodOf = (item: AlignmentListItem) => `${formatCivilDate(item.startsOn)} a ${formatCivilDate(item.endsOn)}`

type RowActions = { onOpen: (item: AlignmentListItem) => void; onEdit: (item: AlignmentListItem) => void; onDelete: (item: AlignmentListItem) => void }

function RowMenu({ item, onEdit, onDelete }: { item: AlignmentListItem } & Pick<RowActions, "onEdit" | "onDelete">) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8" aria-label={`Ações de ${item.title}`}><MoreHorizontal className="size-4" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => onEdit(item)}><Pencil className="size-4" />Editar</DropdownMenuItem>
        <DropdownMenuItem className="text-destructive" onSelect={() => onDelete(item)}><Trash2 className="size-4" />Excluir</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function AlignmentsTable({ items, onOpen, onEdit, onDelete }: { items: AlignmentListItem[] } & RowActions) {
  return (
    <div className={TABLE_FRAME}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Alinhamento</TableHead>
            <TableHead>Processos</TableHead>
            <TableHead>Público</TableHead>
            <TableHead>Vigência</TableHead>
            <TableHead>Situação</TableHead>
            <TableHead className="w-12"><span className="sr-only">Ações</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id}>
              <TableCell>
                <button type="button" className="text-left font-medium hover:underline" onClick={() => onOpen(item)}>{item.title}</button>
                <div className="text-xs text-muted-foreground">{item.reference}{item.reasonName ? ` · ${item.reasonName}` : ""}{item.hasDraft && item.state !== "DRAFT" ? " · rascunho de nova versão" : ""}</div>
              </TableCell>
              <TableCell className="max-w-72"><div className="line-clamp-2 text-sm">{processesOf(item)}</div></TableCell>
              <TableCell><div className="flex items-center gap-2"><UniverseBadge universe={item.operatingUniverse} /><span>{audienceOf(item)}</span></div></TableCell>
              <TableCell className="whitespace-nowrap">{periodOf(item)}</TableCell>
              <TableCell><StatusChip tone={STATE_TONE[item.state]}>{ALIGNMENT_STATE_LABELS[item.state]}</StatusChip></TableCell>
              <TableCell><RowMenu item={item} onEdit={onEdit} onDelete={onDelete} /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function AlignmentCard({ item, onOpen, onEdit, onDelete }: { item: AlignmentListItem } & RowActions) {
  return (
    <EntityCard
      icon={<EntityCardIcon icon={CalendarClock} />}
      kicker={item.reference}
      title={item.title}
      description={processesOf(item)}
      tags={<><EntityCardTag icon={Users}>{audienceOf(item)}</EntityCardTag><EntityCardTag icon={FileText}>{item.processCount} processo(s)</EntityCardTag></>}
      footerStart={periodOf(item)}
      footerEnd={<StatusChip tone={STATE_TONE[item.state]}>{ALIGNMENT_STATE_LABELS[item.state]}</StatusChip>}
      onOpen={() => onOpen(item)}
      actions={<RowMenu item={item} onEdit={onEdit} onDelete={onDelete} />}
    />
  )
}

type View = { tab: "list" } | { tab: "reasons" } | { tab: "form"; selectedId: string | null; editing?: boolean }

/**
 * ALINHAMENTOS OPERACIONAIS — Lista e Motivos num card com abas; o formulário (novo, editar) abre fora dele, no formato do editor de
 * comunicado (voltar, barra de estado, texto à esquerda e configurações na lateral direita):
 * orientações temporárias de um ou mais processos para um público e um período. A mesma regra vale no chat (data da consulta) e na
 * monitoria (data do atendimento); a base oficial nunca muda.
 */
/**
 * `embedded`: dentro de Administração › Publicações (aba "Alinhamentos operacionais"), sem o cabeçalho próprio — o título é o da
 * área editorial; o botão de novo alinhamento continua aqui. `startWithNew`: abre direto no formulário (Nova publicação › Alinhamento).
 */
export function OperationalAlignmentsPage({ embedded = false, startWithNew = false, onEditorOpenChange }: { embedded?: boolean; startWithNew?: boolean; onEditorOpenChange?: (open: boolean) => void } = {}) {
  const scopeOptions = useAlignmentScopeOptionsQuery()
  const list = useAdminListState({ storageKey: "operational-alignments", defaultFilters: DEFAULT_FILTERS })
  // Filtros encadeados: universo → Grupo → Subgrupo (o Grupo/Subgrupo de outro universo some; trocar o universo limpa o que não cabe).
  const scopeTeams = scopeOptions.data?.teams ?? []
  const filterTeams = teamsForUniverse(scopeTeams, list.filters.operatingUniverse).map((team) => ({ id: team.id, name: team.name, operationId: "", subteams: team.subteams.map((subteam) => ({ id: subteam.id, teamId: team.id, name: subteam.name })) }))
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const pageQuery = useAlignmentsPageQuery(list.params)
  const [view, setView] = useState<View>(startWithNew ? { tab: "form", selectedId: null } : { tab: "list" })
  const openCreate = () => setView({ tab: "form", selectedId: null })
  const openItem = (item: AlignmentListItem) => setView({ tab: "form", selectedId: item.id })
  const editItem = (item: AlignmentListItem) => setView({ tab: "form", selectedId: item.id, editing: true })
  const actions = { onOpen: openItem, onEdit: editItem, onDelete: (item: AlignmentListItem) => setDeletingId(item.id) }
  const backToList = () => setView({ tab: "list" })
  const selectedId = view.tab === "form" ? view.selectedId : null
  // Formulário aberto (novo ou existente): sai do card com abas, como o editor de comunicado; quem embute pode esconder o cabeçalho.
  const editorOpen = view.tab === "form"
  useEffect(() => { onEditorOpenChange?.(editorOpen) }, [editorOpen, onEditorOpenChange])
  const backLabel = embedded ? "Publicações" : "Alinhamentos operacionais"

  return (
    <section className="space-y-4">
{editorOpen ? null : embedded ? (
        view.tab === "list" ? <div className="flex justify-end"><Button onClick={openCreate}><Plus /> Novo alinhamento</Button></div> : null
      ) : (
      <PageHeader
        icon={CalendarClock}
        title="Alinhamentos operacionais"
        description="Orientações temporárias de um ou mais processos (PR, IT e demais bases) para um público e um período — informação nova ou mudança de um trecho — no chat e na monitoria. A base oficial não muda."
        actions={view.tab === "list" ? <Button onClick={openCreate}><Plus /> Novo alinhamento</Button> : null}
      />
      )}
      {view.tab === "form" ? (
        selectedId === null ? (
          <AlignmentForm editing={null} backLabel={backLabel} onSaved={(detail) => setView({ tab: "form", selectedId: detail.id })} onCancel={backToList} />
        ) : (
          <AlignmentDetailPanel key={`${selectedId}-${view.editing ? "edit" : "view"}`} id={selectedId} startEditing={Boolean(view.editing)} onBack={backToList} onDiscarded={backToList} />
        )
      ) : (
      <Card>
        <CardContent>
          <Tabs value={view.tab} onValueChange={(value) => (value === "list" ? backToList() : setView({ tab: "reasons" }))}>
            <TabsList>
              <TabsTrigger value="list">Lista</TabsTrigger>
              <TabsTrigger value="reasons">Motivos</TabsTrigger>
            </TabsList>

            <TabsContent value="list" className="mt-4 space-y-4">
              <ListToolbar
                search={<ListSearchInput value={list.filters.search} onChange={(value) => list.setFilter("search", value)} placeholder="Buscar por título, processo, grupo ou produto" ariaLabel="Buscar alinhamento" pending={list.isSearchPending} />}
                viewToggle={<ListViewToggle value={list.view} onChange={list.setView} />}
                hasActiveFilters={list.hasActiveFilters}
                onClearFilters={list.resetFilters}
              >
                <ListSelectFilter
                  value={list.filters.operatingUniverse}
                  onChange={(value) => {
                    const kept = keepCompatibleScope(scopeTeams, value, list.filters.teamId, list.filters.subteamId)
                    list.patchFilters({ operatingUniverse: value, teamId: kept.teamId ?? undefined, subteamId: kept.subteamId ?? undefined })
                  }}
                  options={UNIVERSE_OPTIONS}
                  allLabel="Qualquer universo"
                  ariaLabel="Filtrar por universo"
                />
                <ListOrgScopeFilter teams={filterTeams} globalLabel="Todo o universo" value={{ scopeType: list.filters.scopeType, teamId: list.filters.teamId, subteamId: list.filters.subteamId }} onChange={(scope) => list.patchFilters({ scopeType: scope.scopeType, teamId: scope.teamId, subteamId: scope.subteamId })} />
                <ListSelectFilter value={list.filters.state} onChange={(value) => list.setFilter("state", value)} options={STATE_OPTIONS} allLabel="Qualquer situação" ariaLabel="Filtrar por situação" />
                <ListBooleanFilter value={list.filters.hasDraft} onChange={(value) => list.setFilter("hasDraft", value)} allLabel="Com ou sem rascunho" trueLabel="Com rascunho" falseLabel="Sem rascunho" ariaLabel="Filtrar por rascunho" />
              </ListToolbar>
              <AdminListView
                state={list}
                query={pageQuery}
                errorMessage="Não foi possível carregar os alinhamentos."
                empty={{ icon: CalendarClock, title: "Nenhum alinhamento cadastrado ainda", description: "Quando a operação mudar antes da base oficial, registre aqui a orientação temporária.", action: <Button onClick={openCreate}><Plus /> Novo alinhamento</Button> }}
                noResultsTitle="Nenhum alinhamento corresponde à busca ou aos filtros"
                itemLabel={["alinhamento", "alinhamentos"]}
                renderList={(items) => <AlignmentsTable items={items} {...actions} />}
                renderCards={(items) => <ListCardGrid>{items.map((item) => <AlignmentCard key={item.id} item={item} {...actions} />)}</ListCardGrid>}
              />
            </TabsContent>

            <TabsContent value="reasons" className="mt-4">
              {view.tab === "reasons" ? <AlignmentReasonsPanel /> : null}
            </TabsContent>

          </Tabs>
        </CardContent>
      </Card>
      )}
      {deletingId ? <DeleteConfirm id={deletingId} onClose={() => setDeletingId(null)} onDeleted={() => setDeletingId(null)} /> : null}
    </section>
  )
}
