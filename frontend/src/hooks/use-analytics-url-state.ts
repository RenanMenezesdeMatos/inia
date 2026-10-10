"use client"

import { usePathname, useSearchParams } from "next/navigation"
import { useCallback, useMemo } from "react"

import type { SubjectRef } from "@/lib/analytics/subject-params"
import { analyticsSubjectKindSchema, groupingDimensionSchema, operationalComparisonSchema, type GroupingDimension, type OperationalComparison } from "@/schemas/analytics/analytics.schema"

/**
 * Estado navegável da área de perfil (aba, competência, estrutura, indicador aberto, agrupamento)
 * preservado na query string — o padrão já usado pelo projeto para abrir itens por URL
 * (`use-auto-open-from-query`). Deep link e botão "voltar" funcionam sem roteamento novo.
 */
export type ProfileTab = "followup" | "indicators" | "people" | "pending" | "structure" | "calendar"

export type AnalyticsUrlState = {
  tab: ProfileTab
  period: string | null
  /** Comparação do acompanhamento operacional (`compare`); null = padrão (últimos 7 dias × 7 anteriores). */
  comparison: OperationalComparison | null
  subject: SubjectRef | null
  indicator: string | null
  groupBy: GroupingDimension | null
  /** Pendências: revisão aberta (`<enrollmentId>:<nodeId>`) e filtro por colaborador. */
  review: string | null
  operator: string | null
  /** Acompanhamento: só itens aguardando ciência (`ack=pending`) e item destacado por deep link. */
  ackPending: boolean
  item: string | null
  /** Estrutura: pessoa focal da navegação progressiva (`structurePersonId`); null = o dono do perfil. */
  structurePersonId: string | null
  /** Calendário da equipe: data âncora do período, colaborador destacado (deep link do sino) e equipe (âncora) escolhida. */
  calendarDate: string | null
  calendarPerson: string | null
  calendarAnchor: string | null
}

export type UrlUpdateOptions = {
  /** `push` cria uma entrada no histórico (Back/Forward do navegador funcionam) — usado pela
   * navegação da Estrutura; o padrão `replace` serve a filtros/competência, que não são "páginas". */
  history?: "push" | "replace"
}

const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function parseTab(value: string | null): ProfileTab {
  return value === "indicators" || value === "people" || value === "pending" || value === "structure" || value === "calendar" ? value : "followup"
}

export function useAnalyticsUrlState() {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const state = useMemo<AnalyticsUrlState>(() => {
    const kind = analyticsSubjectKindSchema.safeParse(searchParams.get("subjectKind"))
    const id = searchParams.get("subjectId")
    const period = searchParams.get("period")
    const groupBy = groupingDimensionSchema.safeParse(searchParams.get("groupBy"))
    const comparison = operationalComparisonSchema.safeParse(searchParams.get("compare"))
    return {
      tab: parseTab(searchParams.get("tab")),
      period: period && PERIOD_PATTERN.test(period) ? period : null,
      comparison: comparison.success ? comparison.data : null,
      subject: kind.success && id ? { kind: kind.data, id } : null,
      indicator: searchParams.get("indicator"),
      groupBy: groupBy.success ? groupBy.data : null,
      review: searchParams.get("review"),
      operator: searchParams.get("operator"),
      ackPending: searchParams.get("ack") === "pending",
      item: searchParams.get("item"),
      structurePersonId: searchParams.get("structurePersonId"),
      calendarDate: DATE_PATTERN.test(searchParams.get("calendarDate") ?? "") ? searchParams.get("calendarDate") : null,
      calendarPerson: searchParams.get("calendarPerson"),
      calendarAnchor: searchParams.get("calendarAnchor"),
    }
  }, [searchParams])

  const update = useCallback(
    (patch: Partial<AnalyticsUrlState>, options: UrlUpdateOptions = {}) => {
      const next = new URLSearchParams(searchParams.toString())
      const set = (key: string, value: string | null | undefined) => {
        if (value === null || value === undefined || value === "") next.delete(key)
        else next.set(key, value)
      }
      if (patch.tab !== undefined) set("tab", patch.tab === "followup" ? null : patch.tab)
      if (patch.period !== undefined) set("period", patch.period)
      if (patch.comparison !== undefined) set("compare", patch.comparison)
      if (patch.subject !== undefined) {
        set("subjectKind", patch.subject?.kind ?? null)
        set("subjectId", patch.subject?.id ?? null)
      }
      if (patch.indicator !== undefined) set("indicator", patch.indicator)
      if (patch.groupBy !== undefined) set("groupBy", patch.groupBy)
      if (patch.review !== undefined) set("review", patch.review)
      if (patch.operator !== undefined) set("operator", patch.operator)
      if (patch.ackPending !== undefined) set("ack", patch.ackPending ? "pending" : null)
      if (patch.item !== undefined) set("item", patch.item)
      if (patch.structurePersonId !== undefined) set("structurePersonId", patch.structurePersonId)
      if (patch.calendarDate !== undefined) set("calendarDate", patch.calendarDate)
      if (patch.calendarPerson !== undefined) set("calendarPerson", patch.calendarPerson)
      if (patch.calendarAnchor !== undefined) set("calendarAnchor", patch.calendarAnchor)
      const query = next.toString()
      // `history.replaceState`/`pushState` são integrados ao App Router (useSearchParams acompanha)
      // e NÃO refazem a renderização do servidor — trocar competência/estrutura não recarrega
      // perfil nem avatar. `push` só para navegação (Estrutura), para o Back do navegador voltar.
      const url = query ? `${pathname}?${query}` : pathname
      if (options.history === "push") window.history.pushState(null, "", url)
      else window.history.replaceState(null, "", url)
    },
    [pathname, searchParams],
  )

  return { state, update }
}
