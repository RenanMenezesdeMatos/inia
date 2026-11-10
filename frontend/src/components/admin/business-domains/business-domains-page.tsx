"use client"

import Link from "next/link"
import { useState } from "react"
import { Bot, CalendarClock, Layers, Pencil, Plus, Trash2, Waypoints } from "lucide-react"

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
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { TABLE_FRAME, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"

import { formatDateOnly } from "@/components/admin/knowledge/knowledge-meta"
import { AdminListView } from "@/components/admin/shared/list/admin-list-view"
import { EntityCard, EntityCardIcon, EntityCardTag } from "@/components/admin/shared/list/entity-card"
import { ListBooleanFilter, ListSearchInput, ListToolbar } from "@/components/admin/shared/list/list-filters"
import { ListCardGrid } from "@/components/admin/shared/list/list-states"
import { ListViewToggle } from "@/components/admin/shared/list/list-view-toggle"
import {
  useBusinessDomainDependenciesQuery,
  useBusinessDomainsPageQuery,
  useCreateBusinessDomainMutation,
  useDeleteBusinessDomainMutation,
  useSetBusinessDomainActiveMutation,
  useUpdateBusinessDomainMutation,
} from "@/queries/admin/use-business-domain-queries"
import type { BusinessDomainListParams } from "@/services/admin/business-domain-service"
import { BUSINESS_DOMAIN_CODE_PATTERN, normalizeBusinessDomainCode, type BusinessDomain } from "@/schemas/admin/business-domain.schema"
import { RESTORE_NOTE } from "@/lib/admin/logical-delete"

/**
 * Catálogo ADMINISTRÁVEL de Domínios de negócio (migration 060). Um domínio novo (Logística,
 * Cobrança, Backoffice…) é um registro aqui — aparece automaticamente no formulário do Agent
 * ("Especialista de domínio") e no Orquestrador ("Domínios específicos"), sem deploy.
 * Domínio ≠ Grupo, ≠ Base de Conhecimento, ≠ Agent. O backend é a autoridade (422/409); a UI só
 * antecipa: código travado quando há dependências, exclusão só com zero dependências, desativar
 * nunca desliga o que já existe.
 */
function inUse(domain: BusinessDomain): boolean {
  return domain.agentCount + domain.orchestratorCount > 0
}

/** Agents/Orquestradores de Grupos que a pessoa não administra: o backend manda só a contagem, nunca o nome. */
function OutOfScopeNote({ count }: { count: number }) {
  if (count === 0) return null
  return <p className="text-xs text-muted-foreground">+ {count} em outros Grupos (fora do seu escopo)</p>
}

function DependenciesList({ domain }: { domain: BusinessDomain }) {
  const dependenciesQuery = useBusinessDomainDependenciesQuery(domain.id)
  if (dependenciesQuery.isPending) return <Skeleton className="h-16 w-full" />
  if (dependenciesQuery.isError) return <p className="text-sm text-destructive">Não foi possível carregar as dependências.</p>
  const { agents, orchestrators, agentsOutOfScope, orchestratorsOutOfScope } = dependenciesQuery.data
  return (
    <div className="grid gap-4 sm:grid-cols-2" data-testid="domain-dependencies">
      <div className="space-y-1.5">
        <p className="text-sm font-medium">
          Agents <Badge variant="secondary">{agents.length + agentsOutOfScope}</Badge>
        </p>
        {agents.length + agentsOutOfScope === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhum Agent usa este domínio.</p>
        ) : agents.length === 0 ? null : (
          <ul className="space-y-1 text-sm">
            {agents.map((agent) => (
              <li key={agent.id}>
                <Link href={`/admin/agents/${agent.id}`} className="underline-offset-2 hover:underline">
                  {agent.name}
                </Link>
                {agent.active ? null : <span className="ml-1 text-xs text-muted-foreground">(inativo)</span>}
              </li>
            ))}
          </ul>
        )}
        <OutOfScopeNote count={agentsOutOfScope} />
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-medium">
          Orchestrators <Badge variant="secondary">{orchestrators.length + orchestratorsOutOfScope}</Badge>
        </p>
        {orchestrators.length + orchestratorsOutOfScope === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhum Orquestrador restrito a este domínio.</p>
        ) : orchestrators.length === 0 ? null : (
          <ul className="space-y-1 text-sm">
            {orchestrators.map((orchestrator) => (
              <li key={orchestrator.id}>
                <Link href={`/admin/assistant/${orchestrator.id}`} className="underline-offset-2 hover:underline">
                  {orchestrator.name}
                </Link>
                {orchestrator.active ? null : <span className="ml-1 text-xs text-muted-foreground">(inativo)</span>}
              </li>
            ))}
          </ul>
        )}
        <OutOfScopeNote count={orchestratorsOutOfScope} />
      </div>
    </div>
  )
}

function DeleteBusinessDomainButton({ domain }: { domain: BusinessDomain }) {
  const deleteMutation = useDeleteBusinessDomainMutation()
  const [open, setOpen] = useState(false)
  const blocked = inUse(domain)

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button size="icon" variant="ghost" aria-label={`Excluir ${domain.name}`} disabled={deleteMutation.isPending}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir {domain.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            {blocked
              ? `Este domínio é utilizado por ${domain.agentCount} Agent(s) e ${domain.orchestratorCount} Orchestrator(s). A exclusão é bloqueada enquanto houver dependências — desative-o em vez de excluir.`
              : `Nenhum Agent ou Orchestrator usa este domínio. ${RESTORE_NOTE}`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {deleteMutation.isError ? <p className="text-sm text-destructive">{(deleteMutation.error as Error).message}</p> : null}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={deleteMutation.isPending || blocked}
            onClick={async () => {
              try {
                await deleteMutation.mutateAsync(domain.id)
                setOpen(false)
              } catch {
                // erro exibido acima (409 BUSINESS_DOMAIN_IN_USE vem do backend, que é a autoridade)
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

function ActiveSwitch({ domain }: { domain: BusinessDomain }) {
  const setActiveMutation = useSetBusinessDomainActiveMutation()
  return (
    <Switch
      checked={domain.active}
      disabled={setActiveMutation.isPending}
      aria-label={domain.active ? `Desativar ${domain.name}` : `Ativar ${domain.name}`}
      onCheckedChange={(checked) => setActiveMutation.mutate({ id: domain.id, active: checked })}
    />
  )
}

function BusinessDomainForm({ domain, onDone }: { domain?: BusinessDomain; onDone: () => void }) {
  const createMutation = useCreateBusinessDomainMutation()
  const updateMutation = useUpdateBusinessDomainMutation()
  const mutation = domain ? updateMutation : createMutation

  const [name, setName] = useState(domain?.name ?? "")
  const [code, setCode] = useState(domain?.code ?? "")
  const [codeTouched, setCodeTouched] = useState(Boolean(domain))
  const [description, setDescription] = useState(domain?.description ?? "")
  const [active, setActive] = useState(domain?.active ?? true)
  const codeLocked = Boolean(domain && inUse(domain))

  // Código sugerido a partir do nome enquanto o admin não o editar à mão (mesma normalização do backend).
  function handleNameChange(value: string) {
    setName(value)
    if (!codeTouched) setCode(normalizeBusinessDomainCode(value))
  }

  async function handleSubmit() {
    if (domain) {
      await updateMutation.mutateAsync({ id: domain.id, name, ...(codeLocked ? {} : { code }), description: description.trim() ? description.trim() : null, active })
    } else {
      await createMutation.mutateAsync({ name, code, description: description.trim() ? description.trim() : null, active })
      setName("")
      setCode("")
      setCodeTouched(false)
      setDescription("")
      setActive(true)
    }
    mutation.reset()
    onDone()
  }

  const codeValid = BUSINESS_DOMAIN_CODE_PATTERN.test(code)
  const canSubmit = name.trim().length >= 2 && codeValid

  return (
    <div className="max-w-xl space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="domain-name">Nome *</Label>
          <Input id="domain-name" value={name} onChange={(event) => handleNameChange(event.target.value)} placeholder="Ex.: Logística e Entregas" maxLength={120} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="domain-code">Código *</Label>
          <Input
            id="domain-code"
            value={code}
            disabled={codeLocked}
            onChange={(event) => {
              setCodeTouched(true)
              setCode(normalizeBusinessDomainCode(event.target.value))
            }}
            placeholder="Ex.: LOGISTICA"
            maxLength={40}
          />
          <p className="text-xs text-muted-foreground">
            {codeLocked
              ? "Este código já é utilizado por Agents ou Orchestrators e não pode ser alterado."
              : "Letras maiúsculas, números e _ (2 a 40 caracteres). Estável: é o que Agents e Orchestrators referenciam."}
          </p>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="domain-description">Descrição</Label>
        <Textarea id="domain-description" value={description} onChange={(event) => setDescription(event.target.value)} rows={2} maxLength={500} placeholder="Ex.: Processos relacionados a logística, rastreamento e entrega." />
      </div>
      <div className="flex items-center gap-2">
        <Switch id="domain-active" checked={active} onCheckedChange={setActive} aria-label="Status" />
        <Label htmlFor="domain-active">{active ? "Ativo — pode ser escolhido em novos Agents e Orchestrators" : "Inativo — não entra em novas configurações; o que já existe continua válido"}</Label>
      </div>
      {mutation.isError ? <p className="text-sm text-destructive">{(mutation.error as Error).message}</p> : null}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onDone}>
          Cancelar
        </Button>
        <Button disabled={!canSubmit || mutation.isPending} onClick={handleSubmit}>
          {mutation.isPending ? "Salvando..." : "Salvar domínio"}
        </Button>
      </div>
      {domain ? (
        <div className="space-y-2 border-t pt-4">
          <p className="text-sm font-medium">Utilizado por</p>
          <DependenciesList domain={domain} />
        </div>
      ) : null}
    </div>
  )
}

function BusinessDomainCard({ domain, onEdit }: { domain: BusinessDomain; onEdit: (domain: BusinessDomain) => void }) {
  return (
    <EntityCard
      muted={!domain.active}
      icon={<EntityCardIcon icon={Layers} className="bg-indigo-100 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-300" />}
      kicker={<span className="font-mono text-xs text-muted-foreground">{domain.code}</span>}
      title={domain.name}
      onOpen={() => onEdit(domain)}
      actions={
        <>
          <ActiveSwitch domain={domain} />
          <Button size="icon" variant="ghost" aria-label={`Editar ${domain.name}`} onClick={() => onEdit(domain)}>
            <Pencil className="h-4 w-4" />
          </Button>
          <DeleteBusinessDomainButton domain={domain} />
        </>
      }
      description={domain.description}
      tags={
        <>
          <EntityCardTag icon={Bot}>{domain.agentCount} Agent(s)</EntityCardTag>
          <EntityCardTag icon={Waypoints}>{domain.orchestratorCount} Orchestrator(s)</EntityCardTag>
        </>
      }
      footerStart={
        <span className="inline-flex items-center gap-1">
          <CalendarClock className="size-3.5" />
          <time dateTime={domain.createdAt}>{formatDateOnly(domain.createdAt)}</time>
        </span>
      }
      footerEnd={<Badge variant={domain.active ? "secondary" : "outline"}>{domain.active ? "Ativo" : "Inativo"}</Badge>}
    />
  )
}

function BusinessDomainsTable({ domains, onEdit }: { domains: BusinessDomain[]; onEdit: (domain: BusinessDomain) => void }) {
  return (
    <div className={TABLE_FRAME}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Domínio</TableHead>
            <TableHead>Código</TableHead>
            <TableHead>Agents</TableHead>
            <TableHead>Orchestrators</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {domains.map((domain) => (
            <TableRow key={domain.id} className={domain.active ? undefined : "opacity-60"} data-testid={`domain-row-${domain.code}`}>
              <TableCell>
                <button type="button" className="text-left font-medium underline-offset-2 hover:underline" onClick={() => onEdit(domain)}>
                  {domain.name}
                </button>
                {domain.description ? <p className="max-w-md whitespace-normal text-xs text-muted-foreground">{domain.description}</p> : null}
              </TableCell>
              <TableCell>
                <Badge variant="outline" className="font-mono">
                  {domain.code}
                </Badge>
              </TableCell>
              <TableCell className="text-sm">{domain.agentCount}</TableCell>
              <TableCell className="text-sm">{domain.orchestratorCount}</TableCell>
              <TableCell>
                <Badge variant={domain.active ? "secondary" : "outline"}>{domain.active ? "Ativo" : "Inativo"}</Badge>
              </TableCell>
              <TableCell>
                <div className="flex items-center justify-end gap-2">
                  <ActiveSwitch domain={domain} />
                  <Button size="icon" variant="ghost" aria-label={`Editar ${domain.name}`} onClick={() => onEdit(domain)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <DeleteBusinessDomainButton domain={domain} />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

type BusinessDomainFilters = Omit<BusinessDomainListParams, "page" | "pageSize" | "search"> & { search: string }

const DEFAULT_FILTERS: BusinessDomainFilters = { search: "" }

export function BusinessDomainsPage() {
  const [autoOpen, setAutoOpen] = useAutoOpenFromQuery("new")
  const [tab, setTab] = useState<"list" | "form">("list")
  const [editing, setEditing] = useState<BusinessDomain | null>(null)

  // `?new` na URL abre o formulário de criação (ajuste na renderização, sem render extra) e consome o pedido: cada nova
  // navegação com `?new` abre de novo.
  if (autoOpen) {
    setAutoOpen(false)
    openCreateForm()
  }

  function openCreateForm() {
    setEditing(null)
    setTab("form")
  }

  function openEditForm(domain: BusinessDomain) {
    setEditing(domain)
    setTab("form")
  }

  const list = useAdminListState({ storageKey: "business-domains", defaultFilters: DEFAULT_FILTERS })
  const pageQuery = useBusinessDomainsPageQuery(list.params)

  // Mantém o registro em edição sincronizado com a lista (contadores, status) depois de mutações.
  const editingFresh = editing ? (pageQuery.data?.items.find((domain) => domain.id === editing.id) ?? editing) : null

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Domínios de negócio</CardTitle>
            <CardDescription>Organize as áreas de conhecimento utilizadas pelos Agents e pelos Orchestrators.</CardDescription>
          </div>
          {tab === "list" ? (
            <Button onClick={openCreateForm}>
              <Plus /> Novo domínio
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        <Tabs value={tab} onValueChange={(value) => setTab(value as "list" | "form")}>
          <TabsList>
            <TabsTrigger value="list">Lista</TabsTrigger>
            <TabsTrigger value="form">{editingFresh ? "Editar domínio" : "Novo domínio"}</TabsTrigger>
          </TabsList>

          <TabsContent value="list" className="mt-4 space-y-4">
            <ListToolbar
              search={<ListSearchInput value={list.filters.search} onChange={(value) => list.setFilter("search", value)} placeholder="Buscar por nome ou código" ariaLabel="Buscar domínio de negócio" pending={list.isSearchPending} />}
              viewToggle={<ListViewToggle value={list.view} onChange={list.setView} />}
              hasActiveFilters={list.hasActiveFilters}
              onClearFilters={list.resetFilters}
            >
              <ListBooleanFilter value={list.filters.active} onChange={(value) => list.setFilter("active", value)} allLabel="Todos" trueLabel="Ativos" falseLabel="Inativos" ariaLabel="Filtrar por status" />
            </ListToolbar>

            <AdminListView
              state={list}
              query={pageQuery}
              errorMessage="Não foi possível carregar os domínios de negócio."
              empty={{
                icon: Layers,
                title: "Nenhum domínio de negócio cadastrado",
                description: "Cadastre as áreas de conhecimento (ex.: Faturamento, Logística) para classificar Agents especialistas e restringir Orchestrators.",
                action: (
                  <Button onClick={openCreateForm}>
                    <Plus /> Novo domínio
                  </Button>
                ),
              }}
              noResultsTitle="Nenhum domínio corresponde à busca ou aos filtros"
              itemLabel={["domínio", "domínios"]}
              renderList={(domains) => <BusinessDomainsTable domains={domains} onEdit={openEditForm} />}
              renderCards={(domains) => (
                <ListCardGrid>
                  {domains.map((domain) => (
                    <BusinessDomainCard key={domain.id} domain={domain} onEdit={openEditForm} />
                  ))}
                </ListCardGrid>
              )}
            />
          </TabsContent>

          <TabsContent value="form" className="mt-4">
            <BusinessDomainForm key={editingFresh?.id ?? "new"} domain={editingFresh ?? undefined} onDone={() => setTab("list")} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}
