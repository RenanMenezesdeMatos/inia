"use client"

import { useState } from "react"
import { Filter, HeartHandshake, Inbox, UserX } from "lucide-react"

import { ScopeFilter, type ScopeFilterValue } from "@/components/human-support/admin/scope-filter"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useSupportScopesQuery } from "@/queries/human-support/use-human-support-admin"
import type { PanelFilter } from "@/services/human-support/human-support-service"

import { PageHeader } from "@/components/ui/surface"
import { AnjosActivityTab } from "./anjos-activity-tab"
import { FunnelTab } from "./funnel-tab"
import { defaultPanelPeriod, PeriodPicker, type PanelPeriod } from "./period-picker"
import { RequestsTab } from "./requests-tab"
import { UnavailableAttemptsTab } from "./unavailable-attempts-tab"

/**
 * Administração › Monitoramento › Apoio com Anjo — o painel do apoio (Coordenador de Anjos e Administrador geral; D7). Indicadores ·
 * Pedidos · Sem Anjo em serviço · Anjos (situação agora + atividade no período). Tudo no alcance de quem lê, decidido pelo servidor; o período vale para as quatro abas.
 *
 * Filtro por Grupo/Subgrupo: só para quem configura o apoio (`canFilterByScope`), com a árvore da configuração. O Coordenador de Anjos
 * não tem rota que liste a estrutura, e a tela nunca chama por ele uma rota que só o Administrador geral pode chamar.
 */
export function HumanSupportMonitoringPage({ canFilterByScope = false }: { canFilterByScope?: boolean }) {
  const [period, setPeriod] = useState<PanelPeriod>(() => defaultPanelPeriod())
  const [scope, setScope] = useState<ScopeFilterValue>({})
  const filter: PanelFilter = { from: period.from, to: period.to, teamId: scope.teamId ?? null, subteamId: scope.subteamId ?? null }

  return (
    <section className="space-y-6">
      <PageHeader icon={HeartHandshake} title="Apoio com Anjo" description="Como está o apoio aos operadores: pedidos, esperas, atendimentos, avaliações e a situação de cada Anjo." />

      <div className="space-y-2 rounded-2xl border border-border bg-card p-4 shadow-xs" role="group" aria-label="Filtros do painel">
        <div className="flex flex-wrap items-end gap-3">
          <PeriodPicker value={period} onChange={setPeriod} />
          {canFilterByScope ? <AdminScopeFilter value={scope} onChange={setScope} /> : null}
        </div>
        <p className="text-xs text-muted-foreground">O período vale para os indicadores, os pedidos, as tentativas e a atividade dos Anjos. A situação de cada Anjo agora não depende dele.</p>
      </div>

      <Tabs defaultValue="funnel" className="space-y-5">
        <TabsList>
          <TabsTrigger value="funnel" className="gap-1"><Filter className="size-4" aria-hidden />Indicadores</TabsTrigger>
          <TabsTrigger value="requests" className="gap-1"><Inbox className="size-4" aria-hidden />Pedidos</TabsTrigger>
          <TabsTrigger value="attempts" className="gap-1"><UserX className="size-4" aria-hidden />Sem Anjo em serviço</TabsTrigger>
          <TabsTrigger value="anjos" className="gap-1"><HeartHandshake className="size-4" aria-hidden />Anjos</TabsTrigger>
        </TabsList>
        <TabsContent value="funnel"><FunnelTab filter={filter} /></TabsContent>
        <TabsContent value="requests"><RequestsTab filter={filter} /></TabsContent>
        <TabsContent value="attempts"><UnavailableAttemptsTab filter={filter} /></TabsContent>
        <TabsContent value="anjos"><AnjosActivityTab filter={filter} /></TabsContent>
      </Tabs>
    </section>
  )
}

/** Só montado para quem configura o apoio: a árvore dos escopos vem da rota do Administrador geral. */
function AdminScopeFilter({ value, onChange }: { value: ScopeFilterValue; onChange: (value: ScopeFilterValue) => void }) {
  const scopes = useSupportScopesQuery()
  if (!scopes.data || scopes.data.length === 0) return null
  return (
    <div className="flex items-center gap-1 pb-0.5">
      <ScopeFilter nodes={scopes.data} value={value} onChange={onChange} />
      {value.teamId || value.subteamId ? (
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange({})}>
          Limpar
        </Button>
      ) : null}
    </div>
  )
}
