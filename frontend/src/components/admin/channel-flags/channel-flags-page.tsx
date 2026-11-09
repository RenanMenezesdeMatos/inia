"use client"

import { useState } from "react"
import { CalendarClock, Flag, Pencil, Plus, Radio, ToggleLeft, Trash2 } from "lucide-react"

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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"

import { formatDateOnly } from "@/components/admin/knowledge/knowledge-meta"
import { AdminListView } from "@/components/admin/shared/list/admin-list-view"
import { EntityCard, EntityCardIcon, EntityCardTag } from "@/components/admin/shared/list/entity-card"
import {
  ListBooleanFilter,
  ListDateRangeFilter,
  ListMultiSelectFilter,
  ListSearchInput,
  ListToolbar,
  optionsFromLabels,
} from "@/components/admin/shared/list/list-filters"
import { ListCardGrid } from "@/components/admin/shared/list/list-states"
import { ListViewToggle } from "@/components/admin/shared/list/list-view-toggle"
import {
  useChannelFlagChannelsQuery,
  useChannelFlagsPageQuery,
  useCreateChannelFlagMutation,
  useDeleteChannelFlagMutation,
  useSetChannelFlagActiveMutation,
  useUpdateChannelFlagMutation,
} from "@/queries/admin/use-channel-flag-queries"
import type { ChannelFlagListParams } from "@/services/admin/channel-flag-service"
import { FLAG_VALUE_TYPE_LABELS, type ChannelFlag, type FlagValueType } from "@/schemas/admin/channel-flag.schema"
import { DisplayIconSelect } from "@/components/admin/shared/display-icon-select"
import { CallOutcomeFields, callOutcomeDraftOf, callOutcomeOfDraft } from "./call-outcome-fields"
import { DISPLAY_ICONS, DisplayIcon, flagDefaultIconKey, isDisplayIconKey, type DisplayIconKey } from "@/lib/display-icons"
import { RESTORE_NOTE } from "@/lib/admin/logical-delete"

/** Ícone da flag no Acompanhamento: o configurado, senão o padrão pelo tipo de valor. */
const flagIconKeyOf = (flag: Pick<ChannelFlag, "iconKey" | "valueType">): DisplayIconKey => (isDisplayIconKey(flag.iconKey) ? flag.iconKey : flagDefaultIconKey(flag.valueType))

function DeleteChannelFlagButton({ flag }: { flag: ChannelFlag }) {
  const deleteMutation = useDeleteChannelFlagMutation()
  const [open, setOpen] = useState(false)

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button size="icon" variant="ghost" aria-label="Excluir flag" disabled={deleteMutation.isPending}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir {flag.flagName}?</AlertDialogTitle>
          <AlertDialogDescription>
            As interações já recebidas continuam guardadas, mas a carga passa a recusar esta flag. {RESTORE_NOTE} Se algum Workflow ou política de acompanhamento usa esta flag, a exclusão é barrada.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {deleteMutation.isError ? <p className="text-sm text-destructive">{(deleteMutation.error as Error).message}</p> : null}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={deleteMutation.isPending}
            onClick={async () => {
              try {
                await deleteMutation.mutateAsync(flag.id)
                setOpen(false)
              } catch {
                // error is surfaced via deleteMutation.isError above
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

function ChannelFlagForm({ flag, onDone }: { flag?: ChannelFlag; onDone: () => void }) {
  const createMutation = useCreateChannelFlagMutation()
  const updateMutation = useUpdateChannelFlagMutation()
  const mutation = flag ? updateMutation : createMutation

  const [channel, setChannel] = useState(flag?.channel ?? "VOICE")
  const [flagName, setFlagName] = useState(flag?.flagName ?? "")
  const [valueType, setValueType] = useState<FlagValueType>(flag?.valueType ?? "BOOLEAN")
  const [description, setDescription] = useState(flag?.description ?? "")
  const [label, setLabel] = useState(flag?.label ?? "")
  const [iconKey, setIconKey] = useState<DisplayIconKey | null>(isDisplayIconKey(flag?.iconKey) ? flag.iconKey : null)
  const [outcomeDraft, setOutcomeDraft] = useState(callOutcomeDraftOf(flag?.callOutcome))
  const [relatedIndicatorId, setRelatedIndicatorId] = useState<string | null>(flag?.relatedIndicatorId ?? null)
  const defaultIconKey = flagDefaultIconKey(valueType)
  const callOutcome = callOutcomeOfDraft(outcomeDraft, valueType)

  async function handleSubmit() {
    if (callOutcome === undefined) return
    const display = { label: label.trim() || null, iconKey, callOutcome, relatedIndicatorId }
    if (flag) {
      await updateMutation.mutateAsync({ id: flag.id, channel, flagName, description: description || undefined, ...display })
    } else {
      await createMutation.mutateAsync({ channel, flagName, valueType, description: description || undefined, ...display })
      setOutcomeDraft(callOutcomeDraftOf(null))
      setRelatedIndicatorId(null)
      setChannel("VOICE")
      setFlagName("")
      setValueType("BOOLEAN")
      setDescription("")
      setLabel("")
      setIconKey(null)
    }
    mutation.reset()
    onDone()
  }

  const canSubmit = channel.trim().length > 1 && flagName.trim().length > 1 && callOutcome !== undefined

  return (
    <div className="max-w-xl space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="flag-channel">Canal</Label>
          <Input id="flag-channel" value={channel} onChange={(event) => setChannel(event.target.value.toUpperCase())} placeholder="Ex.: VOICE" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="flag-name">Nome da flag</Label>
          <Input id="flag-name" value={flagName} onChange={(event) => setFlagName(event.target.value.toLowerCase())} placeholder="Ex.: rechamada" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="flag-value-type">Tipo de valor</Label>
        <Select value={valueType} onValueChange={(value) => setValueType(value as FlagValueType)} disabled={Boolean(flag)}>
          <SelectTrigger id="flag-value-type" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(FLAG_VALUE_TYPE_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {flag ? <p className="text-xs text-muted-foreground">O tipo de valor não pode ser alterado após a criação.</p> : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="flag-label">Nome para o colaborador</Label>
          <Input id="flag-label" value={label} maxLength={60} onChange={(event) => setLabel(event.target.value)} placeholder="Ex.: Rechamada" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="flag-icon">Ícone</Label>
          <DisplayIconSelect id="flag-icon" value={iconKey} onChange={setIconKey} defaultIcon={DISPLAY_ICONS[defaultIconKey].icon} defaultLabel={`Padrão (${DISPLAY_ICONS[defaultIconKey].label.toLowerCase()})`} ariaLabel="Ícone da flag" />
        </div>
        <p className="text-xs text-muted-foreground sm:col-span-2">
          Aparecem no Acompanhamento do colaborador como o motivo da monitoria (ex.: “Monitoria · {label.trim() || "Rechamada"}”). Sem nome, vale o nome técnico da flag.
        </p>
      </div>
      <CallOutcomeFields valueType={valueType} draft={outcomeDraft} onDraftChange={setOutcomeDraft} relatedIndicatorId={relatedIndicatorId} onRelatedIndicatorChange={setRelatedIndicatorId} />
      <div className="space-y-1.5">
        <Label htmlFor="flag-description">Descrição (opcional)</Label>
        <Textarea id="flag-description" value={description} onChange={(event) => setDescription(event.target.value)} rows={2} placeholder="O que essa flag representa" />
      </div>
      {mutation.isError ? <p className="text-sm text-destructive">{(mutation.error as Error).message}</p> : null}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onDone}>
          Cancelar
        </Button>
        <Button disabled={!canSubmit || mutation.isPending} onClick={handleSubmit}>
          {mutation.isPending ? "Salvando..." : "Salvar flag"}
        </Button>
      </div>
    </div>
  )
}

function ActiveSwitch({ flag }: { flag: ChannelFlag }) {
  const setActiveMutation = useSetChannelFlagActiveMutation()
  return (
    <Switch
      checked={flag.active}
      disabled={setActiveMutation.isPending}
      aria-label={flag.active ? "Desativar flag" : "Ativar flag"}
      onCheckedChange={(checked) => setActiveMutation.mutate({ id: flag.id, active: checked })}
    />
  )
}

function ChannelFlagCard({ flag, onEdit }: { flag: ChannelFlag; onEdit: (flag: ChannelFlag) => void }) {
  return (
    <EntityCard
      muted={!flag.active}
      icon={<EntityCardIcon icon={DISPLAY_ICONS[flagIconKeyOf(flag)].icon} className="bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-300" />}
      kicker={
        <>
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{flag.channel}</span>
          <span aria-hidden>·</span>
          <span>{FLAG_VALUE_TYPE_LABELS[flag.valueType]}</span>
        </>
      }
      title={flag.label ? `${flag.label} · ${flag.flagName}` : flag.flagName}
      onOpen={() => onEdit(flag)}
      actions={
        <>
          <ActiveSwitch flag={flag} />
          <Button size="icon" variant="ghost" aria-label="Editar flag" onClick={() => onEdit(flag)}>
            <Pencil className="h-4 w-4" />
          </Button>
          <DeleteChannelFlagButton flag={flag} />
        </>
      }
      description={flag.description}
      tags={
        <>
          <EntityCardTag icon={Radio}>{flag.channel}</EntityCardTag>
          <EntityCardTag icon={ToggleLeft}>{FLAG_VALUE_TYPE_LABELS[flag.valueType]}</EntityCardTag>
        </>
      }
      footerStart={
        <span className="inline-flex items-center gap-1">
          <CalendarClock className="size-3.5" />
          <time dateTime={flag.createdAt}>{formatDateOnly(flag.createdAt)}</time>
        </span>
      }
      footerEnd={<Badge variant={flag.active ? "secondary" : "outline"}>{flag.active ? "Ativa" : "Inativa"}</Badge>}
    />
  )
}

function FlagNameCell({ flag }: { flag: ChannelFlag }) {
  return (
    <span className="inline-flex items-center gap-2">
      <DisplayIcon iconKey={flagIconKeyOf(flag)} className="size-4 shrink-0 text-amber-600 dark:text-amber-300" />
      <span className="flex flex-col">
        <span>{flag.label ?? flag.flagName}</span>
        {flag.label ? <span className="text-xs font-normal text-muted-foreground">{flag.flagName}</span> : null}
      </span>
    </span>
  )
}

function ChannelFlagsTable({ flags, onEdit }: { flags: ChannelFlag[]; onEdit: (flag: ChannelFlag) => void }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Canal</TableHead>
            <TableHead>Flag</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead>Descrição</TableHead>
            <TableHead>Criada em</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {flags.map((flag) => (
            <TableRow key={flag.id} className={flag.active ? undefined : "opacity-60"}>
              <TableCell>
                <Badge variant="outline">{flag.channel}</Badge>
              </TableCell>
              <TableCell className="font-medium">
                <FlagNameCell flag={flag} />
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">{FLAG_VALUE_TYPE_LABELS[flag.valueType]}</TableCell>
              <TableCell className="max-w-md whitespace-normal text-sm text-muted-foreground">{flag.description ?? "—"}</TableCell>
              <TableCell className="text-sm text-muted-foreground">
                <time dateTime={flag.createdAt}>{formatDateOnly(flag.createdAt)}</time>
              </TableCell>
              <TableCell>
                <div className="flex items-center justify-end gap-2">
                  <ActiveSwitch flag={flag} />
                  <Button size="icon" variant="ghost" aria-label="Editar flag" onClick={() => onEdit(flag)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <DeleteChannelFlagButton flag={flag} />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

type ChannelFlagFilters = Omit<ChannelFlagListParams, "page" | "pageSize" | "search"> & { search: string }

const DEFAULT_FILTERS: ChannelFlagFilters = { search: "", channel: [], valueType: [], createdAt: {} }
const VALUE_TYPE_OPTIONS = optionsFromLabels(FLAG_VALUE_TYPE_LABELS)

export function ChannelFlagsPage() {
  const channelsQuery = useChannelFlagChannelsQuery()
  const [autoOpen, setAutoOpen] = useAutoOpenFromQuery("new")
  const [tab, setTab] = useState<"list" | "form">("list")
  const [editingFlag, setEditingFlag] = useState<ChannelFlag | null>(null)

  // `?new` na URL abre o formulário de criação (ajuste na renderização, sem render extra) e consome o pedido: cada nova
  // navegação com `?new` abre de novo.
  if (autoOpen) {
    setAutoOpen(false)
    openCreateForm()
  }

  function openCreateForm() {
    setEditingFlag(null)
    setTab("form")
  }

  function openEditForm(flag: ChannelFlag) {
    setEditingFlag(flag)
    setTab("form")
  }

  const list = useAdminListState({ storageKey: "channel-flags", defaultFilters: DEFAULT_FILTERS })
  const pageQuery = useChannelFlagsPageQuery(list.params)
  const channelOptions = (channelsQuery.data ?? []).map((channel) => ({ value: channel, label: channel }))

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Flags de canal</CardTitle>
            <CardDescription>
              Catálogo de sinais que já chegam calculados junto com cada interação (ex.: rechamada, nota da URA). Base para os gatilhos que acionam os agentes de monitoria.
            </CardDescription>
          </div>
          {tab === "list" ? (
            <Button onClick={openCreateForm}>
              <Plus /> Nova flag
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        <Tabs value={tab} onValueChange={(value) => setTab(value as "list" | "form")}>
          <TabsList>
            <TabsTrigger value="list">Lista</TabsTrigger>
            <TabsTrigger value="form">{editingFlag ? "Editar flag" : "Nova flag"}</TabsTrigger>
          </TabsList>

          <TabsContent value="list" className="mt-4 space-y-4">
            <ListToolbar
              search={
                <ListSearchInput
                  value={list.filters.search}
                  onChange={(value) => list.setFilter("search", value)}
                  placeholder="Buscar por nome da flag ou descrição"
                  ariaLabel="Buscar flag de canal"
                  pending={list.isSearchPending}
                />
              }
              viewToggle={<ListViewToggle value={list.view} onChange={list.setView} />}
              hasActiveFilters={list.hasActiveFilters}
              onClearFilters={list.resetFilters}
            >
              <ListMultiSelectFilter label="Canal" values={list.filters.channel} onChange={(values) => list.setFilter("channel", values)} options={channelOptions} />
              <ListMultiSelectFilter label="Tipo de valor" values={list.filters.valueType} onChange={(values) => list.setFilter("valueType", values)} options={VALUE_TYPE_OPTIONS} />
              <ListBooleanFilter value={list.filters.active} onChange={(value) => list.setFilter("active", value)} allLabel="Qualquer status" trueLabel="Ativas" falseLabel="Inativas" ariaLabel="Filtrar por status" />
              <ListDateRangeFilter label="Criada em" value={list.filters.createdAt} onChange={(value) => list.setFilter("createdAt", value)} />
            </ListToolbar>

            <AdminListView
              state={list}
              query={pageQuery}
              errorMessage="Não foi possível carregar as flags."
              empty={{
                icon: Flag,
                title: "Nenhuma flag cadastrada ainda",
                description: "Cadastre os sinais que chegam junto com as interações para que os workflows possam reagir a eles.",
                action: (
                  <Button onClick={openCreateForm}>
                    <Plus /> Nova flag
                  </Button>
                ),
              }}
              noResultsTitle="Nenhuma flag corresponde à busca ou aos filtros"
              itemLabel={["flag", "flags"]}
              renderList={(flags) => <ChannelFlagsTable flags={flags} onEdit={openEditForm} />}
              renderCards={(flags) => (
                <ListCardGrid>
                  {flags.map((flag) => (
                    <ChannelFlagCard key={flag.id} flag={flag} onEdit={openEditForm} />
                  ))}
                </ListCardGrid>
              )}
            />
          </TabsContent>

          <TabsContent value="form" className="mt-4">
            <ChannelFlagForm flag={editingFlag ?? undefined} onDone={() => setTab("list")} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}
