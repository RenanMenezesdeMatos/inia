"use client"

import { useMemo, useState } from "react"
import { FilterX, Gauge } from "lucide-react"

import { ListSelectFilter } from "@/components/admin/shared/list/list-filters"
import { ASSISTANT_CONVERSATIONS_PATH } from "@/components/admin/assistant-conversations/assistant-conversations-route"
import { FEEDBACK_CONTESTATIONS_PATH } from "@/components/admin/feedback-contestations/feedback-contestations-route"
import { HUMAN_SUPPORT_MONITORING_PATH } from "@/components/human-support/monitoring/human-support-monitoring-route"
import { defaultPanelPeriod, PeriodPicker, type PanelPeriod } from "@/components/human-support/monitoring/period-picker"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/ui/surface"
import { useComplianceQuery, useFeedbackQuery, useRepliesQuery, useResponseTimeQuery, useRoutesQuery, useSuccessContextQuery, useSupportQuery } from "@/queries/inia-success/use-inia-success-queries"
import type { SuccessContext, SuccessFilter } from "@/schemas/inia-success/inia-success.schema"

import type { SuccessBlocks } from "./success-blocks"
import { SuccessCoverage } from "./success-coverage"
import { SuccessEvolution } from "./success-evolution"
import { SuccessFeedback } from "./success-feedback"
import { SuccessQuality } from "./success-quality"
import { SuccessRoutes } from "./success-routes"
import { SuccessSummary } from "./success-summary"
import { BlockState, SuccessSection } from "./success-ui"

/**
 * Administração › Monitoramento › Indicadores de sucesso da INIA — em um lugar só: quanto tempo a INIA leva para responder, como as
 * respostas e os feedbacks estão sendo avaliados, onde ela falha e por quais assuntos as pessoas a procuram. Médias e taxas sempre com a
 * base; nenhum índice geral, nenhuma meta inventada. Os MESMOS filtros (período e Grupo/Subgrupo) valem para todos os blocos; cada bloco
 * aparece no alcance da permissão da tela de onde os dados vêm (decidido pelo servidor). Inventário: docs/dev/indicadores-de-sucesso-da-inia.md.
 */
export function IniaSuccessPage() {
  const context = useSuccessContextQuery()
  const [period, setPeriod] = useState<PanelPeriod>(() => defaultPanelPeriod())
  const [teamId, setTeamId] = useState<string | undefined>(undefined)
  const [subteamId, setSubteamId] = useState<string | undefined>(undefined)

  const filter: SuccessFilter = {
    from: period.from,
    to: period.to,
    teamId: teamId ?? null,
    subteamId: subteamId ?? null,
  }
  const sections = context.data?.sections
  const blocks: SuccessBlocks = {
    responseTime: {
      allowed: Boolean(sections?.responseTime),
      query: useResponseTimeQuery(filter, Boolean(sections?.responseTime)),
    },
    routes: {
      allowed: Boolean(sections?.routes),
      query: useRoutesQuery(filter, Boolean(sections?.routes)),
    },
    replies: {
      allowed: Boolean(sections?.replies),
      query: useRepliesQuery(filter, Boolean(sections?.replies)),
    },
    support: {
      allowed: Boolean(sections?.support),
      query: useSupportQuery(filter, Boolean(sections?.support)),
    },
    feedback: {
      allowed: Boolean(sections?.feedback),
      query: useFeedbackQuery(filter, Boolean(sections?.feedback)),
    },
    compliance: {
      allowed: Boolean(sections?.compliance),
      query: useComplianceQuery(filter, Boolean(sections?.compliance)),
    },
  }
  const granularity =
    Object.values(blocks)
      .map((block) => (block.query.data as { period?: { granularity: "DAY" | "WEEK" } } | undefined)?.period?.granularity)
      .find(Boolean) ?? null

  const initial = defaultPanelPeriod()
  const active = Boolean(teamId || subteamId) || period.from !== initial.from || period.to !== initial.to
  const clear = () => {
    setPeriod(defaultPanelPeriod())
    setTeamId(undefined)
    setSubteamId(undefined)
  }

  return (
    <section className="space-y-8">
      <PageHeader
        icon={Gauge}
        title="Indicadores de sucesso da INIA"
        description="Tempo de resposta, avaliação das respostas e dos feedbacks, falhas registradas e assuntos da procura — com a base de cada número. Somente leitura."
      />

      {context.isPending ? (
        <BlockState kind="loading" lines={2} />
      ) : context.isError ? (
        <BlockState kind="error" message="Não foi possível saber quais blocos você pode ver." onRetry={() => void context.refetch()} />
      ) : (
        <>
          <Filters
            context={context.data}
            period={period}
            onPeriod={setPeriod}
            teamId={teamId}
            onTeam={(next) => {
              setTeamId(next)
              setSubteamId(undefined)
            }}
            subteamId={subteamId}
            onSubteam={setSubteamId}
            active={active}
            onClear={clear}
          />

          <SuccessSection
            id="resumo"
            label="1 · Resumo"
            title="Os números principais do período"
            description="Cada número vem com a base que o sustenta. Sem base, a tela diz “Sem base para cálculo” — nunca 0%. Com menos de 5 itens, mostra a contagem em vez da porcentagem."
          >
            <SuccessSummary blocks={blocks} />
          </SuccessSection>

          <SuccessSection
            id="evolucao"
            label="2 · Evolução"
            title="Como os números mudaram no período"
            description="Um gráfico por indicador, com o mesmo eixo de 0 a 100% para as taxas. Passe o mouse (ou o foco) num ponto para ver o valor, a quantidade e o denominador."
          >
            <SuccessEvolution blocks={blocks} granularity={granularity} />
          </SuccessSection>

          <SuccessSection
            id="qualidade"
            label="3 · Qualidade das respostas"
            title="Como as respostas estão sendo avaliadas e onde a INIA falha"
            description="Quatro fontes que não se misturam: a opinião de quem avaliou, o que o sistema registrou na consulta, o que o Anjo registrou ao atender e a conferência automática contra as regras."
          >
            <SuccessQuality blocks={blocks} />
          </SuccessSection>

          <SuccessSection
            id="motivos"
            label="4 · Motivos de procura"
            title="Por quais assuntos as pessoas procuram a INIA"
            description="Pela rota que a INIA acionou para responder. Não é o motivo da chamada do cliente nem o motivo de uma avaliação negativa."
          >
            <SuccessRoutes blocks={blocks} />
          </SuccessSection>

          <SuccessSection
            id="feedbacks"
            label="5 · Feedbacks e contestações"
            title="Como os colaboradores recebem os feedbacks da INIA"
            description="Coorte = feedbacks disponibilizados no período a pessoas do seu alcance (menos os seus). Ciência, utilidade, contestação e revisão são coisas diferentes."
          >
            <SuccessFeedback blocks={blocks} />
          </SuccessSection>

          <SuccessSection
            id="cobertura"
            label="6 · Cobertura dos dados"
            title="O que está medido, o que ficou de fora e por quê"
            description="Base de cada indicador, itens sem medida e limitações conhecidas. Grupo e Subgrupo são os atuais de cada pessoa; no Apoio com Anjo, os gravados no pedido."
          >
            <SuccessCoverage blocks={blocks} links={sourceLinks(context.data)} />
          </SuccessSection>
        </>
      )}
    </section>
  )
}

/** Telas de origem que a conta alcança (a permissão de cada bloco é a da própria tela). */
function sourceLinks(context: SuccessContext) {
  return [
    context.sections.responseTime ? { href: ASSISTANT_CONVERSATIONS_PATH, label: "Conversas com a INIA" } : null,
    context.sections.support ? { href: HUMAN_SUPPORT_MONITORING_PATH, label: "Apoio com Anjo" } : null,
    context.sections.feedback ? { href: FEEDBACK_CONTESTATIONS_PATH, label: "Contestações de feedback" } : null,
    context.sections.compliance
      ? {
          href: "/admin/governance?tab=response-checks",
          label: "Conferência das respostas",
        }
      : null,
  ].filter((link): link is { href: string; label: string } => link !== null)
}

function Filters({
  context,
  period,
  onPeriod,
  teamId,
  onTeam,
  subteamId,
  onSubteam,
  active,
  onClear,
}: {
  context: SuccessContext
  period: PanelPeriod
  onPeriod: (period: PanelPeriod) => void
  teamId: string | undefined
  onTeam: (teamId: string | undefined) => void
  subteamId: string | undefined
  onSubteam: (subteamId: string | undefined) => void
  active: boolean
  onClear: () => void
}) {
  const subteams = useMemo(() => context.subteams.filter((subteam) => !teamId || subteam.teamId === teamId), [context.subteams, teamId])
  return (
    <div role="group" aria-label="Filtros dos indicadores" className="flex flex-wrap items-center gap-2" data-usage-element="list.filter">
      <PeriodPicker value={period} onChange={onPeriod} />
      {context.teams.length > 0 ? (
        <ListSelectFilter
          value={teamId}
          onChange={onTeam}
          options={context.teams.map((team) => ({
            value: team.id,
            label: team.name,
          }))}
          allLabel="Todos os Grupos"
          ariaLabel="Filtrar por Grupo"
        />
      ) : null}
      {subteams.length > 0 ? (
        <ListSelectFilter
          value={subteamId}
          onChange={onSubteam}
          options={subteams.map((subteam) => ({
            value: subteam.id,
            label: subteam.name,
          }))}
          allLabel="Todos os Subgrupos"
          ariaLabel="Filtrar por Subgrupo"
        />
      ) : null}
      {active ? (
        <Button type="button" variant="ghost" size="sm" onClick={onClear}>
          <FilterX data-icon="inline-start" /> Limpar filtros
        </Button>
      ) : null}
      <p className="w-full text-xs text-muted-foreground sm:ml-auto sm:w-auto">Período de até 92 dias, em datas da organização. Os filtros valem para todos os blocos.</p>
    </div>
  )
}
