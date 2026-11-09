"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { ChevronRight, CircleHelp, Footprints, ListTree, Loader2, Network, Search, Settings2 } from "lucide-react"

import { FLOW_TRAVEL_DURATION_MS, usePrefersReducedMotion } from "@/components/flow/flow-travel-signal"
import { AnalyticsErrorState } from "@/components/analytics/analytics-states"
import { PersonAvatar } from "@/components/profile/person-avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { formatCount } from "@/lib/analytics/format"
import { cn } from "@/lib/utils"
import { usePersonStructureQuery } from "@/queries/org-structure/use-person-structure-query"
import type { PersonOrganizationStructure, StructurePerson } from "@/schemas/org-structure/person-structure.schema"

import { OrganizationStructureFlow, resolveViewerPath } from "./organization-structure-flow"
import { StructureTreeSkeleton } from "./structure-tree-skeleton"

export const STRUCTURE_HELP_TEXT = "Um organograma interativo: arraste para navegar, use a roda do mouse, a pinça ou os controles para aproximar ou afastar, clique numa pessoa para abrir o card dela (Dados do colaborador, Dados da estrutura para quem lidera, Reporta-se à), use “Abrir estrutura” para focar a estrutura de quem lidera e clique no gestor acima para subir um nível. Numa estrutura acima da sua, o ramo que leva até você fica sempre destacado — “Ir até mim” percorre a cadeia. Todo mundo explora o organograma da organização; cada papel vê só os dados que está autorizado a ver."

/** Pausa entre os passos de "Ir até mim": a viagem do trecho atual termina antes de a próxima estrutura ser pedida. */
export const GO_TO_ME_STEP_MS = FLOW_TRAVEL_DURATION_MS + 250

/** A partir deste número de subordinados diretos a estrutura ganha busca local (nome, e-mail, cargo). */
export const SEARCH_MIN_REPORTS = 9

export type PersonStructureViewProps = {
  /** Pessoa focal (dono do perfil, ou quem a URL diz — o backend decide se pode). */
  personId: string
  /** Dono do perfil: é a raiz da navegação; `null` na URL volta para ele. */
  rootPersonId: string
  /** Troca a pessoa focal — o chamador reflete na URL com `push` (Back/Forward do navegador). */
  onNavigate: (personId: string | null) => void
  profileHref: (personId: string) => string
  manageHref?: string | null
}

/**
 * Aba "Minha estrutura" / "Estrutura" do perfil: cabeçalho (título, trilha, busca, cadeia
 * completa) + o organograma interativo (`OrganizationStructureFlow`): gestor imediato → pessoa
 * focal → subordinados diretos. Selecionar (clicar num card) expande o próprio card, zero
 * request; "Abrir estrutura" e o clique no gestor trocam a focal via URL (`structurePersonId`,
 * `history: "push"` → Back/Forward/refresh/deep link) e custam UMA request. A estrutura anterior
 * fica na tela enquanto a nova carrega (placeholder), e a seleção volta à focal a cada troca.
 */
export function PersonStructureView({ personId, rootPersonId, onNavigate, profileHref, manageHref = null }: PersonStructureViewProps) {
  const query = usePersonStructureQuery(personId)
  const data = query.data ?? null
  const focalId = data?.subject.personId ?? null
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [focusRequest, setFocusRequest] = useState<{ personId: string; token: number } | null>(null)
  const [travelRequest, setTravelRequest] = useState<{ personId: string; token: number } | null>(null)
  // "Ir até mim": percorre a cadeia real um trecho por vez (cada estrutura carregada mostra o seu
  // trecho persistente animado; a viagem do trecho roda e só então a próxima estrutura é pedida).
  const [goingToMe, setGoingToMe] = useState(false)
  const reducedMotion = usePrefersReducedMotion()

  // Nova focal (navegação, Back/Forward, refresh): selecionada = focal, busca limpa — estado
  // derivado ajustado durante o render, sem efeito.
  const [lastFocalId, setLastFocalId] = useState<string | null>(null)
  if (lastFocalId !== focalId) {
    setLastFocalId(focalId)
    setSelectedId(focalId)
    setSearch("")
    setFocusRequest(null)
  }

  function openStructure(target: string) {
    setGoingToMe(false)
    onNavigate(target === rootPersonId ? null : target)
  }

  // Caminho do viewer nesta estrutura: `nextId` = o subordinado da focal que leva até quem está logado.
  const viewerPath = useMemo(() => (data ? resolveViewerPath(data) : null), [data])
  const viewerId = data ? data.viewerOrganizationPath.at(-1)?.personId ?? null : null
  const canGoToMe = data !== null && viewerId !== null && data.subject.personId !== viewerId && viewerPath?.nextId !== null && !query.isPlaceholderData

  function goToMe() {
    if (!canGoToMe) return
    setGoingToMe(true)
  }

  // Cada estrutura que chega durante "Ir até mim": viaja pelo trecho persistente e pede a próxima —
  // até o viewer virar a focal (ou o caminho acabar). O usuário pode interromper navegando.
  const settled = data !== null && !query.isPlaceholderData
  const nextStep = viewerPath?.nextId ?? null
  const stepFrom = data?.subject.personId ?? null
  useEffect(() => {
    if (!goingToMe || !settled) return
    if (!nextStep) {
      const done = setTimeout(() => setGoingToMe(false), 0)
      return () => clearTimeout(done)
    }
    const token = Date.now()
    const travel = setTimeout(() => setTravelRequest({ personId: nextStep, token }), 0)
    const navigate = setTimeout(() => onNavigate(nextStep === rootPersonId ? null : nextStep), reducedMotion ? 0 : GO_TO_ME_STEP_MS)
    return () => {
      clearTimeout(travel)
      clearTimeout(navigate)
    }
  }, [goingToMe, nextStep, onNavigate, reducedMotion, rootPersonId, settled, stepFrom])

  const searchable = useMemo<StructurePerson[]>(() => (data ? [data.subject, ...(data.managementChain[0] ? [data.managementChain[0]] : []), ...data.directReports] : []), [data])
  const showSearch = (data?.directReports.length ?? 0) >= SEARCH_MIN_REPORTS
  const normalizedSearch = search.trim().toLowerCase()
  const matches = useMemo(() => (normalizedSearch ? searchable.filter((person) => matchesSearch(person, normalizedSearch)) : []), [normalizedSearch, searchable])

  /** Buscar não destrói o organograma: seleciona a primeira pessoa encontrada e pede ao canvas para centralizá-la. */
  function onSearch(value: string) {
    setSearch(value)
    const term = value.trim().toLowerCase()
    const first = term ? searchable.find((person) => matchesSearch(person, term)) : undefined
    if (first) {
      setSelectedId(first.personId)
      setFocusRequest((previous) => ({ personId: first.personId, token: (previous?.token ?? 0) + 1 }))
    }
  }

  return (
    <section className="w-full space-y-4" aria-labelledby="structure-title">
      {query.isPending && !data ? <StructureTreeSkeleton /> : null}
      {query.isError ? <AnalyticsErrorState error={query.error} onRetry={() => void query.refetch()} /> : null}
      {data && !query.isError ? (
        <>
          <TreeHeader data={data} manageHref={manageHref} onOpenStructure={openStructure} transitioning={query.isPlaceholderData} goToMe={canGoToMe ? goToMe : null} goingToMe={goingToMe}>
            {showSearch ? (
              <div className="relative w-full sm:w-56">
                <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input type="search" value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Buscar nesta estrutura…" aria-label="Buscar nesta estrutura" className="h-8 bg-card pl-7 text-xs" />
                {normalizedSearch ? (
                  <p className="mt-1 text-[11px] text-muted-foreground" aria-live="polite">
                    {matches.length === 0 ? `Ninguém nesta estrutura corresponde a “${search.trim()}”.` : `${formatCount(matches.length, "pessoa encontrada", "pessoas encontradas")} · ${matches[0]!.name}`}
                  </p>
                ) : null}
              </div>
            ) : null}
          </TreeHeader>

          <OrganizationStructureFlow
            data={data}
            selectedId={selectedId ?? data.subject.personId}
            onSelect={setSelectedId}
            onOpenStructure={openStructure}
            profileHref={profileHref}
            focusRequest={focusRequest}
            travelRequest={travelRequest}
            transitioning={query.isPlaceholderData}
            className="h-[32rem] sm:h-[36rem] lg:h-[40rem]"
          />

          <footer className="flex flex-col gap-1 px-1 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <p>
              <Network className="mr-1 inline size-3" aria-hidden />
              A mesma estrutura orienta o escopo, a população, os destinatários e as permissões na INIA. Alterações vêm do cadastro corporativo.
            </p>
            {data.sourceMetadata ? (
              <p className="shrink-0">
                Fonte: {data.sourceMetadata.sourceName} · {data.sourceMetadata.feedName}
                {data.sourceMetadata.lastUpdatedAt ? ` · Atualizado em ${formatDateTime(data.sourceMetadata.lastUpdatedAt)}` : ""}
              </p>
            ) : null}
          </footer>
        </>
      ) : null}
    </section>
  )
}

function matchesSearch(person: StructurePerson, term: string): boolean {
  return [person.name, person.email ?? "", person.jobTitle ?? ""].some((value) => value.toLowerCase().includes(term))
}

type HeaderProps = { data: PersonOrganizationStructure; manageHref: string | null; onOpenStructure: (personId: string) => void; transitioning: boolean; goToMe: (() => void) | null; goingToMe: boolean; children?: React.ReactNode }

function TreeHeader({ data, manageHref, onOpenStructure, transitioning, goToMe, goingToMe, children }: HeaderProps) {
  const { subject, breadcrumb, managementChain } = data
  const viewerId = subject.isViewer ? subject.personId : (breadcrumb.find((entry) => entry.isViewer)?.personId ?? null)
  const title = subject.isViewer ? "Minha estrutura" : `Estrutura de ${subject.name}`
  return (
    <header className="flex flex-col gap-3 px-1 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h2 id="structure-title" className="font-heading text-2xl font-semibold tracking-tight">
            {title}
          </h2>
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" className="text-muted-foreground transition-colors hover:text-foreground" aria-label="Sobre esta visão">
                <CircleHelp className="size-4" aria-hidden />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">{STRUCTURE_HELP_TEXT}</TooltipContent>
          </Tooltip>
          {transitioning ? <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Carregando estrutura" /> : null}
        </div>
        <p className="text-sm text-muted-foreground">Explore sua posição na organização e navegue pelo organograma de toda a empresa.</p>
        {breadcrumb.length > 1 ? <StructureBreadcrumb entries={breadcrumb} onNavigate={onOpenStructure} /> : null}
      </div>
      <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-start">
        {children}
        <div className="flex flex-wrap items-center gap-2">
          {goToMe ? (
            <Button type="button" variant="outline" size="sm" className="gap-1 text-xs" onClick={goToMe} disabled={goingToMe} aria-label="Ir até mim — percorrer a cadeia até a sua estrutura">
              {goingToMe ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Footprints className="size-3.5" aria-hidden />} Ir até mim
            </Button>
          ) : null}
          {managementChain.length > 0 ? <LeadershipChainPopover chain={managementChain} subject={subject} viewerId={viewerId} onOpenStructure={onOpenStructure} /> : null}
          {manageHref ? (
            <Button variant="outline" size="sm" asChild>
              <Link href={manageHref}>
                <Settings2 aria-hidden /> Gerenciar estrutura
              </Link>
            </Button>
          ) : null}
        </div>
      </div>
    </header>
  )
}

/** Trilha real da navegação (vem do backend, da ancestralidade — nunca do state): cada nível anterior é clicável; subindo pelo gestor a trilha acumula os níveis. */
function StructureBreadcrumb({ entries, onNavigate }: { entries: PersonOrganizationStructure["breadcrumb"]; onNavigate: (personId: string) => void }) {
  return (
    <nav aria-label="Trilha da estrutura" className="mt-2">
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-sm">
        {entries.map((entry, index) => {
          const isLast = index === entries.length - 1
          const label = entry.isViewer ? "Minha estrutura" : entry.name
          return (
            <li key={entry.personId} className="flex items-center gap-1">
              {index > 0 ? <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden /> : null}
              {isLast ? (
                <span className="font-medium" aria-current="page">
                  {label}
                </span>
              ) : (
                <button type="button" onClick={() => onNavigate(entry.personId)} className="rounded text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                  {label}
                </button>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

type ChainProps = { chain: PersonOrganizationStructure["managementChain"]; subject: PersonOrganizationStructure["subject"]; viewerId: string | null; onOpenStructure: (personId: string) => void }

/** Cadeia completa como contexto SECUNDÁRIO: popover com todos os níveis, do topo à focal — nunca ocupa o organograma (que mostra só o gestor imediato). */
function LeadershipChainPopover({ chain, subject, viewerId, onOpenStructure }: ChainProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="gap-1 text-xs text-muted-foreground">
          <ListTree className="size-3.5" aria-hidden /> Ver cadeia de liderança
          <span className="text-muted-foreground/70">({formatCount(chain.length, "nível acima", "níveis acima")})</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-3">
        <LeadershipChainList chain={chain} subject={subject} viewerId={viewerId} onOpenStructure={onOpenStructure} />
      </PopoverContent>
    </Popover>
  )
}

/**
 * Conteúdo da cadeia completa, do topo à focal — separado do Popover para ser testável sem o Radix
 * (abrir popover no jsdom leva segundos). Cada nível oferece "Abrir estrutura" SÓ quando o backend
 * disse hasReports E canViewStructure (ancestrais reais do viewer são navegáveis; outros, não).
 */
export function LeadershipChainList({ chain, subject, viewerId, onOpenStructure }: ChainProps) {
  const topDown = [...chain].reverse()
  return (
    <>
      <p className="mb-2 text-xs font-medium text-muted-foreground">Cadeia de liderança até {subject.isViewer ? "você" : subject.name.split(" ")[0]}</p>
      <ol className="space-y-0.5" aria-label="Cadeia de liderança completa">
        {[...topDown, subject].map((entry, index) => {
          const isSubject = entry.personId === subject.personId
          const canOpen = !isSubject && entry.capabilities.hasReports && entry.capabilities.canViewStructure
          return (
            <li key={entry.personId} className={cn("flex items-center gap-2 rounded-md px-1.5 py-1", isSubject && "bg-muted/60")} style={{ marginLeft: `${Math.min(index, 4) * 0.5}rem` }}>
              <PersonAvatar name={entry.name} avatarUrl={entry.avatarUrl} className="size-7 shrink-0" fallbackClassName="text-[10px]" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1 text-xs font-medium">
                  <span className="truncate">{entry.name}</span>
                  {entry.personId === viewerId ? <span className="shrink-0 rounded-full bg-primary/15 px-1 text-[9px] text-primary">Você</span> : null}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">{entry.jobTitle ?? entry.roleLabel}</span>
              </span>
              {canOpen ? (
                <Button type="button" variant="ghost" size="sm" className="h-6 shrink-0 px-1.5 text-[11px]" onClick={() => onOpenStructure(entry.personId)} aria-label={`Abrir estrutura de ${entry.name}`}>
                  Abrir <ChevronRight className="size-3" aria-hidden />
                </Button>
              ) : null}
            </li>
          )
        })}
      </ol>
    </>
  )
}

function formatDateTime(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
}
