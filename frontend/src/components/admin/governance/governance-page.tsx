"use client"

import { useId, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { BookA, Pencil, Plus, ShieldBan, Trash2 } from "lucide-react"

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
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { useAdminListState } from "@/hooks/use-admin-list-state"

import { AdminListView } from "@/components/admin/shared/list/admin-list-view"
import { EntityCard, EntityCardIcon } from "@/components/admin/shared/list/entity-card"
import { ListBooleanFilter, ListSearchInput, ListToolbar } from "@/components/admin/shared/list/list-filters"
import { ListCardGrid } from "@/components/admin/shared/list/list-states"
import { ListViewToggle } from "@/components/admin/shared/list/list-view-toggle"
import {
  useCreateGlossaryTermMutation,
  useCreateProhibitedTopicMutation,
  useDeleteGlossaryTermMutation,
  useDeleteProhibitedTopicMutation,
  useGlossaryTermsPageQuery,
  useProhibitedTopicsPageQuery,
  useSetGlossaryTermActiveMutation,
  useSetProhibitedTopicActiveMutation,
  useUpdateGlossaryTermMutation,
  useUpdateProhibitedTopicMutation,
} from "@/queries/admin/use-governance-queries"
import type { GovernanceListParams } from "@/services/admin/governance-service"
import type { GlossaryTerm, ProhibitedTopic } from "@/schemas/admin/governance.schema"

type GovernanceFilters = Omit<GovernanceListParams, "page" | "pageSize" | "search"> & { search: string }

const DEFAULT_FILTERS: GovernanceFilters = { search: "" }

function StatusFilter({ value, onChange }: { value: boolean | undefined; onChange: (value: boolean | undefined) => void }) {
  return <ListBooleanFilter value={value} onChange={onChange} allLabel="Qualquer status" trueLabel="Ativos" falseLabel="Inativos" ariaLabel="Filtrar por status" />
}

function ActiveBadge({ active }: { active: boolean }) {
  return <Badge variant={active ? "secondary" : "outline"}>{active ? "Ativo" : "Inativo"}</Badge>
}

type ActiveMutation = ReturnType<typeof useSetProhibitedTopicActiveMutation>
type DeleteMutation = ReturnType<typeof useDeleteProhibitedTopicMutation>

/** Inativo = guardado, mas fora do que a IA recebe; ativa de novo sem redigitar. */
function ActiveSwitch({ id, active, label, mutation }: { id: string; active: boolean; label: string; mutation: ActiveMutation }) {
  return (
    <Switch
      checked={active}
      disabled={mutation.isPending}
      aria-label={`${active ? "Desativar" : "Ativar"} ${label}`}
      onCheckedChange={(checked) => mutation.mutate({ id, active: checked })}
    />
  )
}

/** Exclusão definitiva, com confirmação; o texto apagado fica no registro de auditoria. */
function DeleteButton({ id, title, description, ariaLabel, mutation }: { id: string; title: string; description: string; ariaLabel: string; mutation: DeleteMutation }) {
  const [open, setOpen] = useState(false)
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (next) mutation.reset()
        setOpen(next)
      }}
    >
      <AlertDialogTrigger asChild>
        <Button size="icon" variant="ghost" aria-label={ariaLabel} disabled={mutation.isPending}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {mutation.isError ? <p className="text-sm text-destructive">{(mutation.error as Error).message}</p> : null}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={mutation.isPending}
            onClick={async () => {
              try {
                await mutation.mutateAsync(id)
                setOpen(false)
              } catch {
                // o erro aparece no próprio diálogo (mutation.isError)
              }
            }}
          >
            {mutation.isPending ? "Excluindo..." : "Excluir"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function ProhibitedTopicsPanel() {
  const createMutation = useCreateProhibitedTopicMutation()
  const updateMutation = useUpdateProhibitedTopicMutation()
  const activeMutation = useSetProhibitedTopicActiveMutation()
  const deleteMutation = useDeleteProhibitedTopicMutation()
  const list = useAdminListState({ storageKey: "governance-prohibited-topics", defaultFilters: DEFAULT_FILTERS })
  const topicsQuery = useProhibitedTopicsPageQuery(list.params)

  const [tab, setTab] = useState<"list" | "form">("list")
  const [editing, setEditing] = useState<ProhibitedTopic | null>(null)
  const [name, setName] = useState("")
  const [requiredBehavior, setRequiredBehavior] = useState("")
  const fieldId = useId()

  function openCreateForm() {
    setEditing(null)
    setName("")
    setRequiredBehavior("")
    createMutation.reset()
    setTab("form")
  }

  function openEditForm(topic: ProhibitedTopic) {
    setEditing(topic)
    setName(topic.name)
    setRequiredBehavior(topic.requiredBehavior)
    updateMutation.reset()
    setTab("form")
  }

  async function handleSubmit() {
    if (editing) {
      await updateMutation.mutateAsync({ id: editing.id, name, requiredBehavior })
    } else {
      await createMutation.mutateAsync({ name, requiredBehavior })
    }
    setTab("list")
  }

  const isPending = editing ? updateMutation.isPending : createMutation.isPending
  const error = (editing ? updateMutation.error : createMutation.error) as Error | null

  const topicActions = (topic: ProhibitedTopic) => (
    <>
      <ActiveSwitch id={topic.id} active={topic.active} label="assunto" mutation={activeMutation} />
      <Button size="icon" variant="ghost" aria-label="Editar assunto" onClick={() => openEditForm(topic)}>
        <Pencil className="h-4 w-4" />
      </Button>
      <DeleteButton
        id={topic.id}
        title={`Excluir "${topic.name}"?`}
        description="A IA deixa de receber esta restrição em todos os Agents e conversas, e o assunto some da lista. Para suspender sem perder o texto, desative-o."
        ariaLabel="Excluir assunto"
        mutation={deleteMutation}
      />
    </>
  )

  return (
    <Tabs value={tab} onValueChange={(value) => setTab(value as "list" | "form")}>
      <div className="flex items-center justify-between gap-3">
        <TabsList>
          <TabsTrigger value="list">Lista</TabsTrigger>
          <TabsTrigger value="form">{editing ? "Editar assunto" : "Adicionar assunto"}</TabsTrigger>
        </TabsList>
        {tab === "list" ? (
          <Button size="sm" onClick={openCreateForm}>
            <Plus /> Adicionar assunto
          </Button>
        ) : null}
      </div>

      <TabsContent value="list" className="mt-4 space-y-4">
        <ListToolbar
          search={
            <ListSearchInput
              value={list.filters.search}
              onChange={(value) => list.setFilter("search", value)}
              placeholder="Buscar por assunto ou comportamento esperado"
              ariaLabel="Buscar assunto proibido"
              pending={list.isSearchPending}
            />
          }
          viewToggle={<ListViewToggle value={list.view} onChange={list.setView} />}
          hasActiveFilters={list.hasActiveFilters}
          onClearFilters={list.resetFilters}
        >
          <StatusFilter value={list.filters.active} onChange={(value) => list.setFilter("active", value)} />
        </ListToolbar>

        <AdminListView
          state={list}
          query={topicsQuery}
          errorMessage="Não foi possível carregar os assuntos proibidos."
          empty={{
            icon: ShieldBan,
            title: "Nenhum assunto proibido cadastrado ainda",
            description: "Liste os temas que a IA nunca deve abordar e como ela deve reagir quando surgirem.",
            action: (
              <Button size="sm" onClick={openCreateForm}>
                <Plus /> Adicionar assunto
              </Button>
            ),
          }}
          noResultsTitle="Nenhum assunto corresponde à busca ou aos filtros"
          itemLabel={["assunto", "assuntos"]}
          renderList={(topics) => (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Assunto</TableHead>
                    <TableHead>Resposta obrigatória</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topics.map((topic) => (
                    <TableRow key={topic.id} className={topic.active ? undefined : "opacity-60"}>
                      <TableCell className="font-medium">{topic.name}</TableCell>
                      <TableCell className="max-w-lg whitespace-normal text-sm text-muted-foreground">{topic.requiredBehavior}</TableCell>
                      <TableCell>
                        <ActiveBadge active={topic.active} />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-2">{topicActions(topic)}</div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          renderCards={(topics) => (
            <ListCardGrid>
              {topics.map((topic) => (
                <EntityCard
                  key={topic.id}
                  muted={!topic.active}
                  icon={<EntityCardIcon icon={ShieldBan} className="bg-red-500/10 text-red-600 dark:text-red-400" />}
                  kicker={<span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Assunto proibido</span>}
                  title={topic.name}
                  onOpen={() => openEditForm(topic)}
                  actions={topicActions(topic)}
                  description={topic.requiredBehavior}
                  descriptionFallback="Sem comportamento esperado descrito."
                  footerStart={<span>Resposta obrigatória da IA</span>}
                  footerEnd={<ActiveBadge active={topic.active} />}
                />
              ))}
            </ListCardGrid>
          )}
        />
      </TabsContent>

      <TabsContent value="form" className="mt-4 max-w-xl space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor={`${fieldId}-name`}>Assunto</Label>
          <Input id={`${fieldId}-name`} value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${fieldId}-behavior`}>Comportamento esperado</Label>
          <Textarea id={`${fieldId}-behavior`} value={requiredBehavior} onChange={(event) => setRequiredBehavior(event.target.value)} rows={3} />
        </div>
        {error ? <p className="text-sm text-destructive">{error.message}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setTab("list")}>
            Cancelar
          </Button>
          <Button disabled={!name.trim() || !requiredBehavior.trim() || isPending} onClick={handleSubmit}>
            {isPending ? "Salvando..." : "Salvar"}
          </Button>
        </div>
      </TabsContent>
    </Tabs>
  )
}

function GlossaryPanel() {
  const createMutation = useCreateGlossaryTermMutation()
  const updateMutation = useUpdateGlossaryTermMutation()
  const activeMutation = useSetGlossaryTermActiveMutation()
  const deleteMutation = useDeleteGlossaryTermMutation()
  const list = useAdminListState({ storageKey: "governance-glossary", defaultFilters: DEFAULT_FILTERS })
  const glossaryQuery = useGlossaryTermsPageQuery(list.params)

  const [tab, setTab] = useState<"list" | "form">("list")
  const [editing, setEditing] = useState<GlossaryTerm | null>(null)
  const [term, setTerm] = useState("")
  const [definition, setDefinition] = useState("")
  const fieldId = useId()

  function openCreateForm() {
    setEditing(null)
    setTerm("")
    setDefinition("")
    createMutation.reset()
    setTab("form")
  }

  function openEditForm(item: GlossaryTerm) {
    setEditing(item)
    setTerm(item.term)
    setDefinition(item.definition)
    updateMutation.reset()
    setTab("form")
  }

  async function handleSubmit() {
    if (editing) {
      await updateMutation.mutateAsync({ id: editing.id, term, definition, feedbackApplication: definition })
    } else {
      await createMutation.mutateAsync({ term, definition, feedbackApplication: definition })
    }
    setTab("list")
  }

  const isPending = editing ? updateMutation.isPending : createMutation.isPending
  const error = (editing ? updateMutation.error : createMutation.error) as Error | null

  const termActions = (item: GlossaryTerm) => (
    <>
      <ActiveSwitch id={item.id} active={item.active} label="termo" mutation={activeMutation} />
      <Button size="icon" variant="ghost" aria-label="Editar termo" onClick={() => openEditForm(item)}>
        <Pencil className="h-4 w-4" />
      </Button>
      <DeleteButton
        id={item.id}
        title={`Excluir "${item.term}"?`}
        description="A IA deixa de usar este termo e ele some da lista. Para suspender sem perder a definição, desative-o."
        ariaLabel="Excluir termo"
        mutation={deleteMutation}
      />
    </>
  )

  return (
    <Tabs value={tab} onValueChange={(value) => setTab(value as "list" | "form")}>
      <div className="flex items-center justify-between gap-3">
        <TabsList>
          <TabsTrigger value="list">Lista</TabsTrigger>
          <TabsTrigger value="form">{editing ? "Editar termo" : "Adicionar termo"}</TabsTrigger>
        </TabsList>
        {tab === "list" ? (
          <Button size="sm" onClick={openCreateForm}>
            <Plus /> Adicionar termo
          </Button>
        ) : null}
      </div>

      <TabsContent value="list" className="mt-4 space-y-4">
        <ListToolbar
          search={
            <ListSearchInput
              value={list.filters.search}
              onChange={(value) => list.setFilter("search", value)}
              placeholder="Buscar por termo, definição ou aplicação"
              ariaLabel="Buscar termo do glossário"
              pending={list.isSearchPending}
            />
          }
          viewToggle={<ListViewToggle value={list.view} onChange={list.setView} />}
          hasActiveFilters={list.hasActiveFilters}
          onClearFilters={list.resetFilters}
        >
          <StatusFilter value={list.filters.active} onChange={(value) => list.setFilter("active", value)} />
        </ListToolbar>

        <AdminListView
          state={list}
          query={glossaryQuery}
          errorMessage="Não foi possível carregar o glossário."
          empty={{
            icon: BookA,
            title: "Nenhum termo cadastrado ainda",
            description: "Defina os termos gerais da operação e como a IA deve aplicá-los no feedback.",
            action: (
              <Button size="sm" onClick={openCreateForm}>
                <Plus /> Adicionar termo
              </Button>
            ),
          }}
          noResultsTitle="Nenhum termo corresponde à busca ou aos filtros"
          itemLabel={["termo", "termos"]}
          renderList={(items) => (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Termo</TableHead>
                    <TableHead>Definição</TableHead>
                    <TableHead>Aplicação no feedback</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.id} className={item.active ? undefined : "opacity-60"}>
                      <TableCell>
                        <Badge>{item.term}</Badge>
                      </TableCell>
                      <TableCell className="max-w-md whitespace-normal text-sm text-muted-foreground">{item.definition}</TableCell>
                      <TableCell className="max-w-md whitespace-normal text-sm text-muted-foreground">{item.feedbackApplication}</TableCell>
                      <TableCell>
                        <ActiveBadge active={item.active} />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-2">{termActions(item)}</div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          renderCards={(items) => (
            <ListCardGrid>
              {items.map((item) => (
                <EntityCard
                  key={item.id}
                  muted={!item.active}
                  icon={<EntityCardIcon icon={BookA} />}
                  kicker={<span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Termo do glossário</span>}
                  title={item.term}
                  onOpen={() => openEditForm(item)}
                  actions={termActions(item)}
                  description={item.definition}
                  descriptionFallback="Sem definição cadastrada."
                  footerStart={<span className="line-clamp-1">{item.feedbackApplication}</span>}
                  footerEnd={<ActiveBadge active={item.active} />}
                />
              ))}
            </ListCardGrid>
          )}
        />
      </TabsContent>

      <TabsContent value="form" className="mt-4 max-w-xl space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor={`${fieldId}-term`}>Termo</Label>
          <Input id={`${fieldId}-term`} value={term} onChange={(event) => setTerm(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${fieldId}-definition`}>Definição e aplicação no feedback</Label>
          <Textarea id={`${fieldId}-definition`} value={definition} onChange={(event) => setDefinition(event.target.value)} rows={3} />
        </div>
        {error ? <p className="text-sm text-destructive">{error.message}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setTab("list")}>
            Cancelar
          </Button>
          <Button disabled={!term.trim() || !definition.trim() || isPending} onClick={handleSubmit}>
            {isPending ? "Salvando..." : "Salvar"}
          </Button>
        </div>
      </TabsContent>
    </Tabs>
  )
}

export function GovernancePage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const urlTab = searchParams.get("tab") === "glossary" ? "glossary" : "prohibited"
  const [tab, setTab] = useState(urlTab)
  // A aba acompanha a URL quando ela muda (ajuste na renderização, sem render extra); a troca pela tela grava a URL.
  const [syncedUrlTab, setSyncedUrlTab] = useState(urlTab)
  if (syncedUrlTab !== urlTab) {
    setSyncedUrlTab(urlTab)
    setTab(urlTab)
  }

  function handleTabChange(value: string) {
    setTab(value)
    router.replace(`${pathname}?tab=${value}`, { scroll: false })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Governança</CardTitle>
        <CardDescription>Guardrails e termos gerais que orientam a IA, independentemente de grupo ou assunto.</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs value={tab} onValueChange={handleTabChange}>
          <TabsList>
            <TabsTrigger value="prohibited">Assuntos proibidos</TabsTrigger>
            <TabsTrigger value="glossary">Glossário geral</TabsTrigger>
          </TabsList>

          <TabsContent value="prohibited" className="mt-4">
            <ProhibitedTopicsPanel />
          </TabsContent>

          <TabsContent value="glossary" className="mt-4">
            <GlossaryPanel />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}
