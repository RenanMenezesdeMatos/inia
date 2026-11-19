"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Clock3, Layers, MessageSquareText, UserRound, Users } from "lucide-react"

import { AnalyticsEmptyState, AnalyticsErrorState } from "@/components/analytics/analytics-states"
import { CommunicationEntry } from "@/components/communications/communication-entry"
import { MyAlignmentEntry } from "@/components/operational-alignments/my-alignments/my-alignment-entry"
import { FollowUpEntry } from "@/components/follow-up/follow-up-entry"
import { FollowUpTypeEmpty, FollowUpTypeFilter, STRUCTURE_FOLLOW_UP_TYPES, SUBJECT_FOLLOW_UP_TYPES, type FollowUpType } from "@/components/follow-up/follow-up-type-filter"
import { followUpDayKey, followUpDayLabel, followUpPeriodBounds, type FollowUpPeriod } from "@/components/operator/follow-up-timeline"
import { FollowUpPeriodEmpty } from "@/components/operator/follow-up-period"
import { IniaFeed } from "@/components/operator/inia-feed"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/states"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { SubjectRef } from "@/lib/analytics/subject-params"
import { useFollowUpFeedQuery } from "@/queries/analytics/use-analytics-queries"
import type { FollowUpAudience } from "@/schemas/analytics/analytics.schema"

const PAGE_SIZE = 8

/**
 * Surface Acompanhamento da estrutura sobre objetos JÁ persistidos: feedbacks publicados dos colaboradores + outputs/revisões/
 * escalonamentos endereçados ao gestor + comunicados da liderança que ele publicou ou recebeu (ramo NOTICE, migration 199). Os mesmos objetos da Surface do operador, filtrados pelo sujeito — sem armazenamento
 * paralelo — e a MESMA apresentação: uma timeline só (mais recente primeiro, rótulo do dia), cada item no cartão com o
 * cabeçalho de tipo + motivo + título, conteúdo lido no próprio cartão e "carregar mais" ao chegar ao fim.
 */
export type StructureFollowUpFeedProps = {
  subject: SubjectRef | null
  description: string
  employeeHref?: (personId: string) => string
  /** Filtro "só aguardando ciência do colaborador" (deep link `ack=pending` vindo da Equipe). */
  unacknowledgedOnly?: boolean
  onUnacknowledgedOnlyChange?: (value: boolean) => void
  /** Item a destacar/rolar até (deep link `item=<id>` vindo do sino). */
  highlightItemId?: string | null
  /** Filtro "Para quem" (Tudo · Para mim · Da equipe) — só no Acompanhamento da PRÓPRIA estrutura, onde o feed junta os dois. */
  audienceFilter?: boolean
}

export function StructureFollowUpFeed({ subject, description, employeeHref, unacknowledgedOnly = false, onUnacknowledgedOnlyChange, highlightItemId = null, audienceFilter = false }: StructureFollowUpFeedProps) {
  // Calendário do cabeçalho: vazio = visão inicial (tudo). O recorte vai ao servidor no MESMO instante que rotula o dia do item.
  const [period, setPeriod] = useState<FollowUpPeriod>({})
  const bounds = followUpPeriodBounds(period)
  const serverPeriod = useMemo(() => {
    const range = followUpPeriodBounds(period)
    return range ? { since: new Date(range.since).toISOString(), until: new Date(range.until).toISOString() } : null
  }, [period])
  // Filtro "Tipo" (um ou vários): vai ao servidor junto com o período (o feed é paginado lá); null = tudo.
  const [types, setTypes] = useState<FollowUpType[] | null>(null)
  // Própria estrutura = sem sujeito (ou com o filtro "Para quem", que só existe nela). Fora dela o filtro só oferece os feedbacks.
  const ownStructure = subject === null || audienceFilter
  // Filtro "Para quem": null = tudo; vai ao servidor (o feed é paginado lá). "Aguardando ciência" é dos feedbacks da equipe, então
  // não convive com "Para mim": escolher "Para mim" desliga a ciência, e ligar a ciência volta para "Tudo".
  const [audience, setAudience] = useState<FollowUpAudience | null>(null)
  const chooseAudience = (value: FollowUpAudience | null) => {
    setAudience(value)
    if (value === "MINE" && unacknowledgedOnly) onUnacknowledgedOnlyChange?.(false)
  }
  const toggleUnacknowledged = (value: boolean) => {
    if (value && audience === "MINE") setAudience(null)
    onUnacknowledgedOnlyChange?.(value)
  }
  const query = useFollowUpFeedQuery(subject, PAGE_SIZE, unacknowledgedOnly, serverPeriod, types, audienceFilter ? audience : null)
  const clearPeriod = () => setPeriod({})
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = query
  const items = query.data?.pages.flatMap((page) => page.items) ?? []
  const loaderRef = useRef<HTMLDivElement>(null)
  // Na ficha de um colaborador o feed já é dele: "para Fulano" em cada item seria ruído.
  const showRecipient = subject?.kind !== "EMPLOYEE"
  const emptyDescription = unacknowledgedOnly ? "Nenhum feedback publicado aguardando ciência do colaborador." : "Feedbacks publicados, resultados de workflow e revisões pendentes da estrutura aparecem aqui."

  useEffect(() => {
    const target = loaderRef.current
    if (!target || !hasNextPage || isFetchNextPageError) return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting && !isFetchingNextPage) void fetchNextPage()
    }, { threshold: 0.8 })
    observer.observe(target)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage])

  return (
    <IniaFeed title="Acompanhamento" description={description} period={period} onPeriodChange={setPeriod} filter={<FollowUpTypeFilter value={types} onChange={setTypes} types={ownStructure ? STRUCTURE_FOLLOW_UP_TYPES : SUBJECT_FOLLOW_UP_TYPES} />}>
      {audienceFilter || onUnacknowledgedOnlyChange ? (
        <div className="flex flex-wrap items-center gap-2 pt-2 pb-1">
          {audienceFilter ? (
            <ToggleGroup type="single" value={audience ?? "ALL"} onValueChange={(value) => value && chooseAudience(value === "ALL" ? null : (value as FollowUpAudience))} aria-label="Filtrar o Acompanhamento por destinatário" className="gap-1.5 bg-transparent p-0" data-testid="follow-up-audience-filter">
              {AUDIENCE_OPTIONS.map(({ value, label, hint, icon: Icon }) => (
                <ToggleGroupItem key={value} value={value} title={hint} className={AUDIENCE_PILL}>
                  <Icon aria-hidden />
                  {label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          ) : null}
          {onUnacknowledgedOnlyChange ? (
            <>
              <Button type="button" size="sm" variant={unacknowledgedOnly ? "default" : "outline"} aria-pressed={unacknowledgedOnly} onClick={() => toggleUnacknowledged(!unacknowledgedOnly)}>
                <Clock3 aria-hidden />
                Só aguardando ciência
              </Button>
              <span className="text-xs text-muted-foreground">Feedbacks publicados que o colaborador ainda não confirmou ter lido.</span>
            </>
          ) : null}
        </div>
      ) : null}

      {query.isPending ? <FeedSkeleton /> : null}
      {query.isError ? (
        <div className="py-4">
          <AnalyticsErrorState error={query.error} onRetry={() => void query.refetch()} />
        </div>
      ) : null}
      {query.isSuccess && items.length === 0 && audienceFilter && audience ? (
        <div className="py-6">
          <EmptyState
            icon={Users}
            title={audience === "MINE" ? "Nada endereçado a você" : "Nada da equipe"}
            description={audience === "MINE" ? "Avisos, revisões, reports e comunicados para você aparecem aqui." : "Feedbacks publicados para a sua equipe aparecem aqui."}
            action={<Button type="button" variant="outline" size="sm" onClick={() => chooseAudience(null)}>Ver tudo</Button>}
          />
        </div>
      ) : query.isSuccess && items.length === 0 && types ? (
        <FollowUpTypeEmpty onClear={() => setTypes(null)} />
      ) : query.isSuccess && items.length === 0 && bounds ? (
        <FollowUpPeriodEmpty onClear={clearPeriod} />
      ) : query.isSuccess && items.length === 0 ? (
        <div className="py-6">
          <AnalyticsEmptyState icon={MessageSquareText} title="Nenhum acompanhamento encontrado" description={emptyDescription} />
        </div>
      ) : null}
      {items.map((item, index) => {
        const at = instantOf(item.createdAt)
        const label = followUpDayLabel(at)
        const newDay = index === 0 || dayOf(at) !== dayOf(instantOf(items[index - 1]!.createdAt))
        return (
          <div key={item.id} data-testid="follow-up-entry" data-kind={item.kind}>
            {newDay ? <DayLabel>{label}</DayLabel> : <Separator />}
            {item.kind === "ALIGNMENT" && item.alignment ? <MyAlignmentEntry alignment={item.alignment} highlighted={highlightItemId === item.id} /> : item.kind === "NOTICE" && item.notice ? <CommunicationEntry notice={item.notice} /> : <FollowUpEntry item={item} showRecipient={showRecipient} employeeHref={employeeHref} highlighted={highlightItemId === item.id} />}
          </div>
        )
      })}

      {hasNextPage ? (
        isFetchNextPageError ? (
          <p role="alert" className="py-5 text-center text-xs text-muted-foreground">
            Não foi possível carregar mais itens.{" "}
            <button type="button" className="underline" onClick={() => void fetchNextPage()}>
              Tentar novamente
            </button>
          </p>
        ) : (
          <div ref={loaderRef} className="space-y-3 py-5" aria-live="polite">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="size-2 animate-pulse rounded-full bg-primary" />
              Carregando feedbacks...
            </div>
            <div className="flex gap-3">
              <Skeleton className="size-9 shrink-0 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            </div>
          </div>
        )
      ) : items.length > 0 ? (
        <p className="py-5 text-center text-xs text-muted-foreground">{bounds ? "Fim das ações deste período." : "Fim dos feedbacks."}</p>
      ) : null}
    </IniaFeed>
  )
}

/** Pílulas do filtro "Para quem": no tom do app (contorno leve, ícone; selecionada tingida na cor da marca), sem o bloco cinza. */
const AUDIENCE_OPTIONS = [
  { value: "ALL", label: "Tudo", hint: "Tudo o que aparece no seu Acompanhamento", icon: Layers },
  { value: "MINE", label: "Para mim", hint: "Avisos, revisões, escalonamentos, reports e comunicados endereçados a você", icon: UserRound },
  { value: "TEAM", label: "Da equipe", hint: "Feedbacks publicados para a sua equipe, alinhamentos que valem para ela e comunicados que você publicou", icon: Users },
] as const
const AUDIENCE_PILL =
  "h-8 rounded-full border border-border bg-card px-3.5 text-muted-foreground shadow-xs hover:border-primary/40 hover:bg-primary/5 hover:text-primary data-[state=on]:border-primary/40 data-[state=on]:bg-primary/10 data-[state=on]:text-primary data-[state=on]:shadow-none dark:data-[state=on]:text-chart-4"

const instantOf = (value: string) => {
  const at = Date.parse(value)
  return Number.isNaN(at) ? Number.NEGATIVE_INFINITY : at
}
const dayOf = (at: number) => (Number.isFinite(at) ? followUpDayKey(new Date(at)) : "")

/** O mesmo rótulo do dia do Acompanhamento do colaborador ("Hoje", "Ontem", "Segunda-feira, 28/09"). */
function DayLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="pt-4 pb-1 text-xs font-medium text-muted-foreground" data-testid="follow-up-day">
      {children}
    </p>
  )
}

function FeedSkeleton() {
  return (
    <div className="space-y-4 py-5" aria-hidden>
      {[0, 1, 2].map((index) => (
        <div key={index} className="flex gap-3">
          <Skeleton className="size-9 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-20 w-full rounded-2xl" />
          </div>
        </div>
      ))}
    </div>
  )
}
