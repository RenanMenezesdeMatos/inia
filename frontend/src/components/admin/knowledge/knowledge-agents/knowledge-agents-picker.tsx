"use client"

import { useEffect, useRef, useState } from "react"
import { ArrowLeft, Bot, ChevronDown, Link2Off, Loader2, Save, SearchX, Send, Undo2 } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { ListSearchInput, ListSelectFilter, ListToolbar, ListUniverseFilter, optionsFromLabels, universeChoiceOf } from "@/components/admin/shared/list/list-filters"
import { ListOrgScopeFilter } from "@/components/admin/shared/list/org-scope-filter"
import { ListPagination } from "@/components/admin/shared/list/list-pagination"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { EmptyState, InlineError, LoadingState } from "@/components/ui/states"
import { SectionLabel, StatusChip, SURFACE_CARD, toneSurface } from "@/components/ui/surface"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { AdminApiError } from "@/lib/admin/admin-api"
import type { OrgScopeFilter } from "@/lib/admin/list-query"
import type { UniverseFilterValue } from "@/lib/operating-universe/hierarchy"
import { cn } from "@/lib/utils"
import { useAgentKnowledgeLinksPreviewQuery, useAgentKnowledgeLinksQuery, useApplyAgentKnowledgeLinksMutation } from "@/queries/admin/use-agent-queries"
import { adminQueryKeys } from "@/queries/admin/admin-query-keys"
import { useCurrentUserQuery } from "@/queries/auth/use-current-user"
import { AGENT_TYPE_LABELS, type AgentType } from "@/schemas/admin/agent.schema"
import { hasOrgUnits } from "@/lib/admin/unit-selection"
import {
  KNOWLEDGE_LINK_STATE_LABELS,
  knowledgeLinkChangesOf,
  MAX_KNOWLEDGE_LINK_CHANGES,
  toggleKnowledgeLinkChoice,
  type KnowledgeLinkChoice,
  type KnowledgeLinkMode,
  type KnowledgeLinkState,
  type KnowledgeLinkTab,
  type KnowledgeLinksRequest,
} from "@/schemas/admin/agent-knowledge-links.schema"

import { KnowledgeAgentRow } from "./knowledge-agent-row"
import { KnowledgeAgentsPublishPreview, knowledgeLinksSummary } from "./knowledge-agents-publish-preview"

export const KNOWLEDGE_AGENTS_ANCHOR = "agentes-da-base"
/** Evento que abre o cartão (o atalho "Escolher agentes" da lateral do editor). */
export const OPEN_KNOWLEDGE_AGENTS_EVENT = "inia:open-knowledge-agents"
const SUMMARY_SIZE = 5

const failureMessage = (failure: unknown) => (failure instanceof Error && failure.message ? failure.message : "Não foi possível salvar. Tente novamente.")
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

/**
 * AGENTES DA BASE (20/11/2026) — FECHADO ao abrir a base: o cabeçalho mostra só quantos agentes consultam a base e os primeiros deles;
 * abrir mostra a escolha. Nos moldes do seletor de bases do agente, inline no cartão (sem janela solta): abas "Ligados" × "Disponíveis"
 * com busca, filtros (tipo, universo, Grupo, situação) e paginação no servidor. Marcar ou desmarcar só anota a escolha (de qualquer página);
 * a barra de baixo grava: "Salvar no rascunho dos agentes" (não muda o que a IA usa) ou "Salvar e publicar", que mostra aqui mesmo a
 * conferência — quem usa cada agente e o que muda — e só confirma com ela carregada e sem problemas. Tudo numa transação: um agente falha,
 * nenhum muda. Só aparece para quem administra agentes; o servidor confere permissão, alcance e universo de novo.
 */
export function KnowledgeAgentsPicker({ documentId, title, baseInUse, className }: { documentId: string; title: string; baseInUse: boolean; className?: string }) {
  const canManageAgents = (useCurrentUserQuery().data?.access.permissions ?? []).includes("agents.manage")
  const [tab, setTab] = useState<KnowledgeLinkTab>("LINKED")
  const [search, setSearch] = useState("")
  const [agentType, setAgentType] = useState<AgentType | undefined>(undefined)
  const [universe, setUniverse] = useState<UniverseFilterValue | undefined>(undefined)
  const [orgScope, setOrgScope] = useState<OrgScopeFilter>({})
  const [state, setState] = useState<KnowledgeLinkState | undefined>(undefined)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [choices, setChoices] = useState<Map<string, KnowledgeLinkChoice>>(() => new Map())
  const [publishRequest, setPublishRequest] = useState<KnowledgeLinksRequest | null>(null)
  const [error, setError] = useState("")
  const [open, setOpen] = useState(false)
  const debouncedSearch = useDebouncedValue(search.trim(), 300)
  const apply = useApplyAgentKnowledgeLinksMutation()
  const queryClient = useQueryClient()
  const previewQuery = useAgentKnowledgeLinksPreviewQuery(publishRequest)
  const sectionRef = useRef<HTMLElement>(null)
  // Lista ⇄ conferência muda a altura do cartão: o início dele volta à vista, senão a conferência abre abaixo da dobra.
  const showStep = (request: KnowledgeLinksRequest | null) => {
    setPublishRequest(request)
    sectionRef.current?.scrollIntoView({ block: "start", behavior: "smooth" })
  }

  const filters = {
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
    ...(agentType ? { agentType } : {}),
    ...(universe ? { universe } : {}),
    ...(hasOrgUnits(orgScope) ? { teamId: orgScope.teamId, subteamId: orgScope.subteamId } : orgScope.scopeType ? { scopeType: "ALL_TEAMS" as const } : {}),
    ...(state ? { state } : {}),
  }
  // Filtro ou aba novos: volta à primeira página (ajuste na renderização, sem render extra).
  const filterKey = JSON.stringify([tab, filters])
  const [lastFilterKey, setLastFilterKey] = useState(filterKey)
  if (lastFilterKey !== filterKey) {
    setLastFilterKey(filterKey)
    setPage(1)
  }
  // Resumo do cabeçalho (sempre, sem filtros; mesma consulta do resumo da lateral) e a lista (só com o cartão aberto).
  const summaryQuery = useAgentKnowledgeLinksQuery(canManageAgents ? { knowledgeDocumentId: documentId, tab: "LINKED", page: 1, pageSize: SUMMARY_SIZE } : null)
  const query = useAgentKnowledgeLinksQuery(canManageAgents && open ? { knowledgeDocumentId: documentId, tab, ...filters, page, pageSize } : null)
  // Aberto pelo atalho da lateral, ou chegando à página com o endereço apontando para o cartão.
  useEffect(() => {
    const openCard = () => setOpen(true)
    if (window.location.hash === `#${KNOWLEDGE_AGENTS_ANCHOR}`) openCard()
    window.addEventListener(OPEN_KNOWLEDGE_AGENTS_EVENT, openCard)
    return () => window.removeEventListener(OPEN_KNOWLEDGE_AGENTS_EVENT, openCard)
  }, [])
  if (!canManageAgents) return null

  const data = query.data
  const items = data?.items ?? []
  const pendingPublish = data?.pendingPublish ?? []
  const draftChanges = knowledgeLinkChangesOf(choices, pendingPublish, "DRAFT")
  const publishChanges = knowledgeLinkChangesOf(choices, pendingPublish, "PUBLISH")
  const hasFilters = Boolean(debouncedSearch || agentType || universe || hasOrgUnits(orgScope) || orgScope.scopeType || state)
  const clearFilters = () => {
    setSearch("")
    setAgentType(undefined)
    setUniverse(undefined)
    setOrgScope({})
    setState(undefined)
  }

  async function submit(mode: KnowledgeLinkMode, changes = mode === "DRAFT" ? draftChanges : publishChanges) {
    setError("")
    try {
      const result = await apply.mutateAsync({ knowledgeDocumentId: documentId, mode, changes })
      toast.success(knowledgeLinksSummary(result))
      setChoices(new Map())
      if (publishRequest) showStep(null)
    } catch (failure) {
      if (failure instanceof AdminApiError && failure.code === "AGENT_DRAFT_CONFLICT") {
        showStep(null)
        setChoices(new Map())
        // A lista é relida de fato (run-8, QA-01): a mutação só invalida no sucesso, e a próxima tentativa saía com a revisão antiga.
        void queryClient.invalidateQueries({ queryKey: adminQueryKeys.agents() })
        setError("Outra pessoa alterou um destes agentes enquanto você escolhia. A lista foi atualizada: confira e escolha de novo.")
        return
      }
      setError(failureMessage(failure))
    }
  }

  const preview = previewQuery.data ?? null
  const previewBlocked = !preview || preview.agents.some((agent) => agent.problem !== null)
  const pendingOnly = publishChanges.length - draftChanges.length
  const tooMany = (changes: readonly unknown[]) => changes.length > MAX_KNOWLEDGE_LINK_CHANGES
  const summary = summaryQuery.data
  const linkedCount = summary?.counts.linked ?? null
  const summaryNames = summary?.items.map((agent) => agent.name) ?? []

  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
    <section ref={sectionRef} id={KNOWLEDGE_AGENTS_ANCHOR} aria-label="Agentes que consultam esta base" className={cn(SURFACE_CARD, "scroll-mt-4 px-4 py-4 sm:px-6", className)} data-testid="knowledge-agents-picker">
      <CollapsibleTrigger asChild>
        <button type="button" className="flex w-full items-start justify-between gap-3 text-left" aria-controls="knowledge-agents-body">
          <span className="min-w-0 space-y-1">
            <SectionLabel as="h2" className="flex items-center gap-1.5"><Bot className="size-3.5" aria-hidden />Agentes que consultam esta base</SectionLabel>
            <span className="block text-sm text-foreground" data-testid="knowledge-agents-summary">
              {summaryQuery.isError
                ? "Não foi possível carregar os agentes."
                : linkedCount === null
                  ? "Carregando…"
                  : linkedCount === 0
                    ? "Nenhum agente consulta esta base."
                    : `${plural(linkedCount, "agente", "agentes")}: ${summaryNames.join(", ")}${linkedCount > summaryNames.length ? ` e mais ${linkedCount - summaryNames.length}` : ""}.`}
            </span>
            {choices.size > 0 && !open ? <StatusChip tone="warning" className="mt-1">{plural(choices.size, "alteração não gravada", "alterações não gravadas")}</StatusChip> : null}
          </span>
          <span className="flex shrink-0 items-center gap-1.5 pt-0.5 text-sm font-medium text-primary">
            <span className="sr-only sm:not-sr-only">{open ? "Fechar" : "Associar ou desassociar"}</span>
            <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} aria-hidden />
          </span>
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent id="knowledge-agents-body" className="mt-4 space-y-4">
      <p className="text-sm text-muted-foreground">
        Marque ou desmarque os agentes e grave embaixo: no rascunho de cada agente (a IA continua na versão em uso) ou publicando a versão nova dele.
        {baseInUse ? "" : " A base ainda não tem versão em uso: os agentes só a consultam depois que ela for publicada e ficar pronta."}
      </p>

      {publishRequest === null ? (
        <>
          <Tabs value={tab} onValueChange={(value) => setTab(value as KnowledgeLinkTab)}>
            <TabsList>
              <TabsTrigger value="LINKED">
                Ligados<Badge variant="secondary" className="ml-1.5 tabular-nums" data-testid="knowledge-agents-linked-count">{data?.counts.linked ?? "…"}</Badge>
              </TabsTrigger>
              <TabsTrigger value="AVAILABLE">
                Disponíveis<Badge variant="secondary" className="ml-1.5 tabular-nums">{data?.counts.available ?? "…"}</Badge>
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <ListToolbar
            search={<ListSearchInput value={search} onChange={setSearch} placeholder="Buscar agente pelo nome" ariaLabel="Buscar agente" pending={query.isFetching} />}
            hasActiveFilters={hasFilters}
            onClearFilters={clearFilters}
          >
            <ListSelectFilter<AgentType> value={agentType} onChange={setAgentType} options={optionsFromLabels(AGENT_TYPE_LABELS)} allLabel="Qualquer tipo" ariaLabel="Filtrar por tipo de agente" />
            <ListUniverseFilter value={universe} onChange={(next) => { setUniverse(next); setOrgScope({}) }} />
            <ListOrgScopeFilter value={orgScope} onChange={setOrgScope} permission="agents.manage" universe={universeChoiceOf(universe)} globalLabel="Só de todos os grupos" />
            <ListSelectFilter<KnowledgeLinkState> value={state} onChange={setState} options={optionsFromLabels(KNOWLEDGE_LINK_STATE_LABELS)} allLabel="Qualquer situação" ariaLabel="Filtrar por situação do agente" />
          </ListToolbar>

          {error ? <p role="alert" className={cn(toneSurface("danger"), "px-3 py-2 text-sm")}>{error}</p> : null}

          {query.isError ? (
            <InlineError message="Não foi possível carregar os agentes." onRetry={() => void query.refetch()} />
          ) : query.isPending ? (
            <LoadingState label="Carregando agentes…" />
          ) : items.length === 0 ? (
            <EmptyState
              icon={tab === "LINKED" && !hasFilters ? Link2Off : SearchX}
              title={hasFilters ? "Nenhum agente neste filtro" : tab === "LINKED" ? "Nenhum agente consulta esta base" : "Nenhum agente disponível"}
              description={hasFilters ? "Mude a busca ou limpe os filtros." : tab === "LINKED" ? "Abra “Disponíveis” para escolher os agentes que devem consultá-la." : "Todos os agentes que você administra já consultam esta base."}
            />
          ) : (
            <ul className={cn("space-y-1.5", query.isPlaceholderData && "opacity-60")} aria-label={tab === "LINKED" ? "Agentes ligados" : "Agentes disponíveis"}>
              {items.map((agent) => {
                const choice = choices.get(agent.id)
                return (
                  <KnowledgeAgentRow
                    key={agent.id}
                    agent={agent}
                    checked={choice ? choice.linked : agent.linkedInDraft}
                    changed={choice !== undefined}
                    onToggle={(linked) => setChoices((current) => toggleKnowledgeLinkChoice(current, agent, linked))}
                  />
                )
              })}
            </ul>
          )}
          <ListPagination
            page={data?.page ?? page}
            pageSize={pageSize}
            total={data?.total ?? 0}
            onPageChange={setPage}
            onPageSizeChange={(size) => { setPageSize(size); setPage(1) }}
            itemLabel={["agente", "agentes"]}
            isFetching={query.isFetching}
          />

          {draftChanges.length > 0 || publishChanges.length > 0 ? (
            <div className={cn(toneSurface("warning"), "flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:justify-between")} data-testid="knowledge-agents-pending">
              <p className="text-sm" aria-live="polite">
                {draftChanges.length > 0 ? <><strong className="font-semibold">{plural(draftChanges.length, "agente alterado", "agentes alterados")}</strong>, ainda não gravado{draftChanges.length === 1 ? "" : "s"}.</> : null}
                {tooMany(publishChanges) ? <span className="block text-xs text-destructive">No máximo {MAX_KNOWLEDGE_LINK_CHANGES} agentes por vez: grave uma parte e depois o resto.</span> : null}
                {pendingOnly > 0 ? <span className="block text-xs text-muted-foreground">{plural(pendingOnly, "agente já tem", "agentes já têm")} a mudança desta base só no rascunho: “Salvar e publicar” inclui também {pendingOnly === 1 ? "ele" : "eles"}.</span> : null}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {choices.size > 0 ? <Button type="button" variant="ghost" size="sm" disabled={apply.isPending} onClick={() => { setChoices(new Map()); setError("") }}><Undo2 data-icon="inline-start" />Desfazer</Button> : null}
                <Button type="button" variant="outline" size="sm" disabled={apply.isPending || draftChanges.length === 0 || tooMany(draftChanges)} onClick={() => void submit("DRAFT")}>
                  {apply.isPending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Save data-icon="inline-start" />}Salvar no rascunho dos agentes
                </Button>
                <Button type="button" size="sm" disabled={apply.isPending || publishChanges.length === 0 || tooMany(publishChanges)} onClick={() => { setError(""); showStep({ knowledgeDocumentId: documentId, mode: "PUBLISH", changes: publishChanges }) }}>
                  <Send data-icon="inline-start" />Salvar e publicar
                </Button>
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <div className="space-y-3" data-testid="knowledge-agents-confirm">
          <div className="space-y-1">
            <p className="text-sm font-semibold">Publicar {publishRequest.changes.length === 1 ? "o agente" : `${publishRequest.changes.length} agentes`} com a mudança em “{title}”?</p>
            <p className="text-sm text-muted-foreground">Cada versão nova passa a valer nas próximas execuções do chat, da voz, dos Workflows e dos orquestradores que usam o agente, sem republicá-los. Publicar não reativa agente inativo.</p>
          </div>
          {error ? <p role="alert" className={cn(toneSurface("danger"), "px-3 py-2 text-sm")}>{error}</p> : null}
          {preview ? (
            <KnowledgeAgentsPublishPreview preview={preview} />
          ) : previewQuery.isError ? (
            <InlineError message={`Não foi possível conferir quem usa os agentes e o que muda (${failureMessage(previewQuery.error)}). Sem essa conferência, a publicação fica indisponível.`} onRetry={() => void previewQuery.refetch()} />
          ) : (
            <LoadingState label="Conferindo quem usa os agentes e o que muda…" rows={2} />
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" disabled={apply.isPending} onClick={() => { setError(""); showStep(null) }}><ArrowLeft data-icon="inline-start" />Voltar à lista</Button>
            <Button type="button" disabled={apply.isPending || previewBlocked} onClick={() => void submit("PUBLISH", publishRequest.changes)}>
              {apply.isPending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Send data-icon="inline-start" />}Confirmar e publicar
            </Button>
          </div>
        </div>
      )}
      </CollapsibleContent>
    </section>
    </Collapsible>
  )
}
