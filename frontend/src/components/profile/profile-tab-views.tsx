"use client"

import dynamic from "next/dynamic"

import { AnalyticsCard, CardsSkeleton, HeroSkeleton, TableSkeleton } from "@/components/analytics/analytics-states"
import { StructureTreeSkeleton } from "@/components/structure/structure-tree-skeleton"

/**
 * Abas do perfil que NÃO são a aba de entrada, com o código carregado sob demanda: Indicadores (gráficos — recharts), Equipe,
 * Calendário e Estrutura (organograma — @xyflow/react). Importadas direto, iam todas no JavaScript inicial de /operator e
 * /supervisor, que abrem no Acompanhamento. Aba aberta pela URL (`?tab=`) continua renderizada no servidor; o `loading` é o
 * mesmo esqueleto que a própria aba mostra enquanto a consulta responde — sem salto de layout ao trocar de aba.
 */
const analyticsLoading = () => (
  <div className="space-y-4">
    <HeroSkeleton />
    <CardsSkeleton />
  </div>
)

export const IndicatorsView = dynamic(() => import("@/components/analytics/indicators-view").then((module) => module.IndicatorsView), { loading: analyticsLoading })

export const TeamView = dynamic(() => import("@/components/team/team-view").then((module) => module.TeamView), { loading: analyticsLoading })

export const TeamCalendarView = dynamic(() => import("@/components/team-calendar/team-calendar-view").then((module) => module.TeamCalendarView), {
  loading: () => (
    <AnalyticsCard>
      <TableSkeleton rows={5} />
    </AnalyticsCard>
  ),
})

export const PersonStructureView = dynamic(() => import("@/components/structure/person-structure-view").then((module) => module.PersonStructureView), {
  loading: () => <StructureTreeSkeleton />,
})
