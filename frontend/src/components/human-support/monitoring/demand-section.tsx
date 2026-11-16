"use client"

import { useState, type ReactNode } from "react"
import { Building2, CircleCheck, CircleHelp, CircleX, Users, UserRound, type LucideIcon } from "lucide-react"

import { Skeleton } from "@/components/ui/skeleton"
import { chartHeightPx, type GridSection } from "@/components/ui/customizable-grid/layout"
import { SURFACE_CARD, toneChip, type Tone } from "@/components/ui/surface"
import { cn } from "@/lib/utils"
import { useSupportDemandQuery } from "@/queries/human-support/use-human-support-admin"
import { durationText, PRODUCTIVITY, PRODUCTIVITY_LABELS, type Demand, type Productivity } from "@/schemas/human-support/monitoring.schema"
import type { PanelFilter } from "@/services/human-support/human-support-service"

import { OperationNoAnjoCard, OperationRequestsCard } from "../history/attendance-block"
import { HourlyChart, WaitByDayChart } from "../history/charts"
import { TermLabel } from "../history/term-hint"
import { PanelError } from "./panel-error"

/**
 * ACIONAMENTOS DO PERÍODO (aba Indicadores) — a visão da DEMANDA, para a operação inteira: produtivos × não produtivos (pertinência
 * marcada pelo Anjo; clicar numa parte filtra o resto desta seção), a curva de acionamentos por horário, a espera dos operadores por
 * dia, quem mais aciona (operador, Grupo, Subgrupo) e o que aconteceu com quem não foi acolhido. Os números de cada Anjo e o tempo
 * online ficam em "Jornada e atendimentos"; os percentis de espera e os motivos continuam nos cartões abaixo — nada se repete.
 */
const PRODUCTIVITY_LOOK: Record<Productivity, { icon: LucideIcon; tone: Tone; help: string }> = {
  PRODUCTIVE: { icon: CircleCheck, tone: "success", help: "O Anjo marcou o acionamento como pertinente." },
  NOT_PRODUCTIVE: { icon: CircleX, tone: "danger", help: "O Anjo marcou como não pertinente: o operador não precisava de um Anjo." },
  NOT_EVALUATED: { icon: CircleHelp, tone: "neutral", help: "Sem acolhimento, sem classificação ou marcado como Não avaliado." },
}

/**
 * ÁREA "ACIONAMENTOS DO PERÍODO" do catálogo de Indicadores (grade personalizável): a escolha produtivos × não produtivos (filtra os
 * outros cards da área), a curva por horário, a espera por dia, quem mais aciona (operador, Grupo, Subgrupo) e os números da fila.
 */
export function useDemandSection(filter: PanelFilter): GridSection {
  const [productivity, setProductivity] = useState<Productivity | null>(null)
  const query = useSupportDemandQuery({ ...filter, productivity })
  const state = (render: (demand: Demand) => ReactNode, height = "h-40") =>
    query.isPending && !query.data ? <Skeleton className={cn(height, "w-full rounded-2xl")} aria-label="Carregando os acionamentos" /> : query.isError ? <PanelError error={query.error} onRetry={() => void query.refetch()} /> : render(query.data!)
  return {
    id: "acionamentos",
    title: "Acionamentos do período",
    description: "Quando os operadores chamam os Anjos, quanto esperam e quem mais aciona.",
    cards: [
      { id: "produtivos", title: "Produtivos e não produtivos", defaultWidth: 12, widths: [6, 8, 12], render: () => state((demand) => <ProductivityPicker demand={demand} selected={productivity} onSelect={setProductivity} />, "h-24") },
      {
        id: "por-horario",
        title: "Acionamentos por horário",
        defaultWidth: 6,
        widths: [4, 6, 8, 12],
        defaultRows: 4,
        render: ({ rows }) =>
          state((demand) => (
            <article className={cn(SURFACE_CARD, "h-full space-y-2 p-4")} aria-label="Acionamentos por horário">
              <h3 className="text-sm font-medium">Acionamentos por horário</h3>
              <HourlyChart byHour={demand.byHour} height={chartHeightPx(rows)} />
            </article>
          )),
      },
      {
        id: "espera-por-dia",
        title: "Espera dos operadores por dia",
        defaultWidth: 6,
        widths: [4, 6, 8, 12],
        defaultRows: 4,
        render: ({ rows }) =>
          state((demand) => (
            <article className={cn(SURFACE_CARD, "h-full space-y-2 p-4")} aria-label="Espera dos operadores">
              <h3 className="text-sm font-medium">
                <TermLabel term="wait">Espera dos operadores por dia</TermLabel>
              </h3>
              <p className="text-xs text-muted-foreground" data-testid="wait-summary">
                {demand.wait.count === 0
                  ? "Nenhum acolhimento no período."
                  : `Média ${durationText(demand.wait.averageSeconds)} · metade em até ${durationText(demand.wait.p50Seconds)} · 90% em até ${durationText(demand.wait.p90Seconds)} · ${demand.wait.count} acolhidos`}
              </p>
              <WaitByDayChart byDay={demand.wait.byDay} height={chartHeightPx(rows, 100)} />
            </article>
          )),
      },
      { id: "top-operadores", title: "Operadores que mais acionam", defaultWidth: 4, widths: [3, 4, 6, 12], render: () => state((demand) => <TopList title="Operadores que mais acionam" icon={UserRound} items={demand.top.operators} testId="top-operators" />) },
      { id: "top-grupos", title: "Grupos que mais acionam", defaultWidth: 4, widths: [3, 4, 6, 12], render: () => state((demand) => <TopList title="Grupos que mais acionam" icon={Building2} items={demand.top.groups} testId="top-groups" />) },
      { id: "top-subgrupos", title: "Subgrupos que mais acionam", defaultWidth: 4, widths: [3, 4, 6, 12], render: () => state((demand) => <TopList title="Subgrupos que mais acionam" icon={Users} items={demand.top.subgroups} testId="top-subgroups" />) },
      { id: "pedidos-no-periodo", title: "Pedidos no período", defaultWidth: 6, widths: [3, 4, 6, 12], render: () => state((demand) => <OperationRequestsCard operation={demand.operation} />, "h-20") },
      { id: "sem-anjo-logado", title: "Encerrados sem Anjo logado", defaultWidth: 6, widths: [3, 4, 6, 12], render: () => state((demand) => <OperationNoAnjoCard operation={demand.operation} />, "h-20") },
    ],
  }
}

/** Produtivos × não produtivos × não avaliados: clicar numa parte filtra os outros cards da área. */
function ProductivityPicker({ demand, selected, onSelect }: { demand: Demand; selected: Productivity | null; onSelect: (value: Productivity | null) => void }) {
  const all = PRODUCTIVITY.reduce((sum, key) => sum + demand.productivity[key], 0)
  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-3" role="group" aria-label="Produtivos e não produtivos (clique para filtrar)">
        {PRODUCTIVITY.map((key) => {
          const look = PRODUCTIVITY_LOOK[key]
          const pressed = selected === key
          const count = demand.productivity[key]
          return (
            <button
              key={key}
              type="button"
              aria-pressed={pressed}
              title={look.help}
              onClick={() => onSelect(pressed ? null : key)}
              className={cn("flex items-center gap-3 rounded-xl border bg-card px-3 py-2.5 text-left shadow-xs outline-none transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50", pressed ? "border-primary ring-1 ring-primary/40" : "border-border")}
              data-testid={`productivity-${key}`}
            >
              <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full ring-1 ring-inset", toneChip(look.tone))}>
                <look.icon className="size-4" aria-hidden />
              </span>
              <span className="leading-tight">
                <span className="block text-xl font-semibold tabular-nums">{count}</span>
                <span className="text-xs text-muted-foreground">
                  {PRODUCTIVITY_LABELS[key]}
                  {all > 0 ? ` · ${Math.round((count / all) * 1000) / 10}%`.replace(".", ",") : ""}
                </span>
              </span>
            </button>
          )
        })}
      </div>
      {all > 0 ? (
        <div className="flex h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
          <span className="bg-emerald-500" style={{ width: `${(demand.productivity.PRODUCTIVE / all) * 100}%` }} />
          <span className="bg-red-500" style={{ width: `${(demand.productivity.NOT_PRODUCTIVE / all) * 100}%` }} />
          <span className="bg-muted-foreground/30" style={{ width: `${(demand.productivity.NOT_EVALUATED / all) * 100}%` }} />
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground" role="status">
        {selected ? `Mostrando só os ${PRODUCTIVITY_LABELS[selected].toLowerCase()}: ${demand.total} de ${all} acionamentos. Clique de novo para ver todos.` : `${all} acionamentos no período. Clique numa parte para filtrar o restante desta área.`}
      </p>
    </div>
  )
}

function TopList({ title, icon: Icon, items, testId }: { title: string; icon: LucideIcon; items: Demand["top"]["operators"]; testId: string }) {
  return (
    <article className={cn(SURFACE_CARD, "h-full space-y-2 p-4")} aria-label={title} data-testid={testId}>
      <h3 className="flex items-center gap-1.5 text-sm font-medium">
        <Icon className="size-4 text-muted-foreground" aria-hidden />
        {title}
      </h3>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum acionamento.</p>
      ) : (
        <ol className="space-y-1.5">
          {items.map((item, index) => (
            <li key={item.key} className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 text-sm">
              <span className="text-xs tabular-nums text-muted-foreground">{index + 1}.</span>
              <span className="truncate">{item.label}</span>
              <span className="tabular-nums text-muted-foreground">
                {item.count} · {`${Math.round(item.share * 1000) / 10}`.replace(".", ",")}%
              </span>
              <span className="col-span-2 col-start-2 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                <span className="block h-full rounded-full bg-primary/70" style={{ width: `${Math.round(item.share * 100)}%` }} />
              </span>
            </li>
          ))}
        </ol>
      )}
    </article>
  )
}
