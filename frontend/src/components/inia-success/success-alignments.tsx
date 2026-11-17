"use client"

import type { UseQueryResult } from "@tanstack/react-query"

import { ApiError } from "@/lib/api/api-client"
import { formatCivilDate } from "@/lib/format/date"
import type { AlignmentsData } from "@/schemas/inia-success/inia-success.schema"

import { formatCount, plural } from "./success-format"
import { BarList, BlockState, Panel, StatRow } from "./success-ui"

const DEFINITION = {
  title: "Alinhamentos operacionais",
  what: "Orientações temporárias de processo publicadas pela gestão antes de a base oficial ser atualizada.",
  formula: "Vigentes no período = alinhamentos cuja versão publicada valeu em algum momento do período (um por alinhamento). Participação = alinhamentos com o item ÷ vigentes no período (um alinhamento pode ter vários processos e vários pedidos do cliente relacionados).",
  base: "Alinhamentos dos Grupos/Subgrupos que você administra (universo inteiro só com alcance da organização), filtrados pelo público.",
  excludes: "Excluídos e rascunhos nunca publicados. \"Quem mais faz\" conta os criados no período, pelo Grupo de quem criou.",
  reference: "Vigência do alinhamento; criação para \"quem mais faz\"; o mais antigo ativo é o que vale hoje há mais tempo.",
}

const items = (list: AlignmentsData["byArea"]) => list.map((entry) => ({ key: entry.key, label: entry.label, count: entry.count, share: entry.share }))

/**
 * 7. Alinhamentos operacionais — com a permissão e o alcance da tela de Alinhamentos (fora dela, o bloco diz isso). Por área (público),
 * quem mais faz (Grupo de quem criou), o mais antigo ativo, as bases mais associadas, o motivo do alinhamento e os pedidos do cliente relacionados.
 */
export function SuccessAlignments({ allowed, query }: { allowed: boolean; query: UseQueryResult<AlignmentsData, Error> }) {
  if (!allowed) return <BlockState kind="denied" message="Este bloco usa a permissão de Alinhamentos operacionais (Gestor de alinhamentos ou Administrador)." />
  if (query.isPending) return <BlockState kind="loading" lines={4} />
  if (query.isError) return <BlockState kind="error" message={query.error instanceof ApiError && query.error.status === 422 ? query.error.message : "Tente de novo em instantes. Os outros blocos continuam valendo."} onRetry={() => void query.refetch()} />
  const data = query.data
  const unit = ["alinhamento", "alinhamentos"] as const
  return (
    <div className="grid gap-6">
      <Panel title={DEFINITION.title} definition={DEFINITION} description="Quantos, onde, por quê e sobre quais processos e pedidos do cliente.">
        <dl className="grid gap-x-8 divide-y divide-border sm:grid-cols-2 sm:divide-y-0">
          <StatRow label="Vigentes no período" value={formatCount(data.inPeriod)} hint={`${plural(data.createdInPeriod, ["criado", "criados"])} no período`} />
          <StatRow label="Ativos hoje" value={formatCount(data.activeNow)} />
          <StatRow
            label="Mais antigo ativo"
            value={data.oldestActive ? plural(data.oldestActive.daysActive, ["dia", "dias"]) : "Nenhum ativo hoje"}
            hint={data.oldestActive ? `${data.oldestActive.reference} · "${data.oldestActive.title}" · ${data.oldestActive.audience} · de ${formatCivilDate(data.oldestActive.startsOn)} a ${formatCivilDate(data.oldestActive.endsOn)}` : undefined}
          />
          <StatRow label="Sem pedido do cliente relacionado" value={formatCount(data.withoutRequestReason)} hint={data.withoutReason > 0 ? `${plural(data.withoutReason, ["sem motivo do alinhamento", "sem motivo do alinhamento"])} (anteriores ao campo)` : undefined} />
        </dl>
      </Panel>
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Alinhamentos por área" description="Grupo do público de cada alinhamento.">
          <BarList items={items(data.byArea)} series="support" unit={unit} emptyText="Nenhum alinhamento vigente no período." />
        </Panel>
        <Panel title="Áreas que mais fazem alinhamento" description="Grupo de quem criou, entre os criados no período.">
          <BarList items={items(data.byAuthorArea)} series="support" unit={unit} emptyText="Nenhum alinhamento criado no período." />
        </Panel>
        <Panel title="Motivo do alinhamento" description="Por que a operação mudou antes da base oficial.">
          <BarList items={items(data.byReason)} series="consultation" unit={unit} emptyText="Nenhum alinhamento vigente no período." />
        </Panel>
        <Panel title="Pedidos do cliente relacionados" description="Assuntos dos atendimentos a que os alinhamentos se relacionam (um alinhamento pode ter vários).">
          <BarList items={items(data.byRequestReason)} series="consultation" unit={unit} emptyText="Nenhum pedido do cliente relacionado no período." />
        </Panel>
        <Panel title="Bases mais associadas" description="Processos (PR, IT…) com mais alinhamentos vigentes no período." className="lg:col-span-2">
          <BarList items={items(data.topProcesses)} series="replies" unit={unit} emptyText="Nenhum alinhamento vigente no período." />
        </Panel>
      </div>
    </div>
  )
}
