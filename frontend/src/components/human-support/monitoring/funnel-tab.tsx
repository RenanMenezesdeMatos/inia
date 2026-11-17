"use client"

import type { ReactNode } from "react"
import { CircleAlert, Clock, Hash, Info, Percent, Star, type LucideIcon } from "lucide-react"

import { Skeleton } from "@/components/ui/skeleton"
import { IconBadge, SURFACE_CARD, toneSurface } from "@/components/ui/surface"
import { formatCivilDate, formatDateTime } from "@/lib/format/date"
import { cn } from "@/lib/utils"
import { useSupportFunnelQuery } from "@/queries/human-support/use-human-support-admin"
import { durationText, percentText, type FunnelResponse, type Measure, type Ratio } from "@/schemas/human-support/monitoring.schema"
import type { WaitEstimate } from "@/schemas/human-support/state.schema"
import type { PanelFilter } from "@/services/human-support/human-support-service"

import type { CardWidth, GridCard, GridSection } from "@/components/ui/customizable-grid/layout"
import { PersistedCustomizableView } from "@/components/view-layouts/persisted-customizable-view"

import { useAbandonmentSection } from "../history/abandonment-block"
import { useDemandSection } from "./demand-section"
import { PanelError } from "./panel-error"
import { civilToday } from "./period-picker"

/**
 * Funil › indicadores do apoio no período, em linguagem de operação. As regras de cálculo e de amostra mínima são as do servidor
 * (toda taxa com numerador e denominador; com menos de 5 no denominador, a porcentagem não é calculada; sem denominador, "sem dados" —
 * nunca 0%). Esta tela só nomeia, explica e formata: os códigos internos (M1–M17) não aparecem; ficam em `data-testid`.
 * As avaliações da RESPOSTA DA INIA e as do ATENDIMENTO DO ANJO ficam em seções separadas e nunca se misturam.
 */
const MIN_SAMPLE = 5

type Kind = "count" | "percent" | "duration" | "stars"
type Copy = { title: string; help: string; kind: Kind; unit: [string, string] }

const COPY: Record<string, Copy> = {
  M1: { title: "Respostas da INIA", help: "Respostas da INIA no chat no período.", kind: "count", unit: ["resposta", "respostas"] },
  M2: { title: "Respostas avaliadas", help: "Quantas respostas receberam curtida ou descurtida.", kind: "percent", unit: ["resposta", "respostas"] },
  M3: { title: "Curtidas entre as avaliadas", help: "Das respostas avaliadas, quantas foram curtidas. Mostra a opinião de quem avaliou, não se a resposta estava certa.", kind: "percent", unit: ["avaliada", "avaliadas"] },
  M4: { title: "Motivos das descurtidas", help: "Por que as respostas da INIA foram descurtidas.", kind: "count", unit: ["descurtida", "descurtidas"] },
  M5: { title: "Descurtidas com pedido de ajuda", help: "Das descurtidas com motivo, quantas disseram que ainda precisavam de ajuda.", kind: "percent", unit: ["descurtida com motivo", "descurtidas com motivo"] },
  M6: { title: "Respostas em que a consulta falhou", help: "A INIA não encontrou, não concluiu ou foi impedida de responder. Registrado pelo sistema.", kind: "percent", unit: ["resposta", "respostas"] },
  M7: { title: "Sugestões de falar com um Anjo", help: "Vezes em que a tela ofereceu o apoio, por origem.", kind: "count", unit: ["sugestão", "sugestões"] },
  M8: { title: "Pedidos de apoio", help: "Pedidos criados no período, por origem.", kind: "count", unit: ["pedido", "pedidos"] },
  M9: { title: "Tentativas sem Anjo em serviço", help: "Alguém tentou pedir ajuda e nenhum Anjo estava em serviço. Conta no máximo 1 por pessoa a cada 10 min.", kind: "count", unit: ["tentativa", "tentativas"] },
  M10: { title: "Como os pedidos terminaram", help: "Pedidos criados no período que já terminaram.", kind: "count", unit: ["pedido encerrado", "pedidos encerrados"] },
  M11: { title: "Espera até receber um Anjo", help: "Do pedido até um Anjo receber.", kind: "duration", unit: ["pedido atribuído", "pedidos atribuídos"] },
  M12: { title: "Primeira resposta do Anjo", help: "Do momento em que o Anjo recebe até a primeira mensagem dele.", kind: "duration", unit: ["atendimento com resposta", "atendimentos com resposta"] },
  M13: { title: "Duração do atendimento", help: "Do momento em que o Anjo recebe até o fim. Interrompidos ficam à parte.", kind: "duration", unit: ["atendimento encerrado", "atendimentos encerrados"] },
  M14: { title: "Por que o operador precisou do Anjo", help: "Classificação feita pelo Anjo ao encerrar.", kind: "count", unit: ["atendimento classificado", "atendimentos classificados"] },
  M15: { title: "Resultado do atendimento", help: "O que o Anjo declarou ao classificar.", kind: "count", unit: ["atendimento classificado", "atendimentos classificados"] },
  M16: { title: "Dúvida resolvida, segundo o operador", help: "Respostas do operador a “Sua dúvida foi resolvida?”.", kind: "percent", unit: ["resposta", "respostas"] },
  M17: { title: "Estrelas do atendimento", help: "Nota do operador para o atendimento do Anjo, de 1 a 5.", kind: "stars", unit: ["nota", "notas"] },
}

/** Os dois tempos de cada medida de duração, com o nome do evento medido (nunca "p50"/"p90" como rótulo). */
const DURATIONS: Record<string, { median?: [string, string]; p90: [string, string] }> = {
  M11: { p90: ["Tempo de espera de 90% dos pedidos", "90% dos pedidos receberam um Anjo em até esse tempo."] },
  M12: {
    median: ["Tempo mediano de primeira resposta", "Metade dos atendimentos teve a primeira resposta do Anjo em até esse tempo."],
    p90: ["Primeira resposta de 90% dos atendimentos", "90% dos atendimentos tiveram a primeira resposta em até esse tempo."],
  },
  M13: {
    median: ["Duração mediana", "Metade dos atendimentos durou até esse tempo."],
    p90: ["Duração de 90% dos atendimentos", "90% dos atendimentos duraram até esse tempo."],
  },
}

const SIDE_LABELS: Record<string, { coverage?: string; conversion?: string; noResponse?: string; breakdown?: string; extra?: string }> = {
  M8: { conversion: "Sugestões que viraram pedido" },
  M10: { extra: "Situação dos pedidos do período" },
  M12: { noResponse: "Encerrados sem nenhuma resposta do Anjo", breakdown: "Sem resposta, por motivo do encerramento" },
  M13: { extra: "À parte" },
  M14: { coverage: "Atendimentos classificados", extra: "Processos e sistemas mais citados" },
  M16: { coverage: "Atendimentos que o operador avaliou" },
  M17: { coverage: "Atendimentos com estrelas" },
}

const KIND_ICON: Record<Kind, { icon: LucideIcon; label: string }> = {
  count: { icon: Hash, label: "Quantidade" },
  percent: { icon: Percent, label: "Porcentagem" },
  duration: { icon: Clock, label: "Tempo" },
  stars: { icon: Star, label: "Média de estrelas" },
}

const ESTIMATE_BASIS = { SUBGROUP: "do Subgrupo", GROUP: "do Grupo", ORGANIZATION: "da organização" } as const
const REPLY = ["M1", "M2", "M3", "M4", "M5", "M6"]
/**
 * Indicadores = o que acontece ANTES do Anjo e o que o operador diz dele: respostas da INIA, demanda e fila, avaliação do operador.
 * O trabalho do Anjo — primeira resposta e duração (M12/M13), motivos de acionamento (M14) e resultado declarado (M15) — fica na aba
 * "Jornada e atendimentos", na visão geral e por Anjo (pedido do responsável em 2026-11-12: nada repetido entre as duas abas).
 */
const REQUESTS = ["M7", "M8", "M9", "M10", "M11"]
const EVALUATION = ["M16", "M17"]
/** Cartões do Anjo que a aba "Jornada e atendimentos" mostra na visão geral. */
export const ANJO_WORK_MEASURES = ["M14", "M15"]

const plural = (count: number, [one, many]: [string, string]) => `${count.toLocaleString("pt-BR")} ${count === 1 ? one : many}`
const number = (value: number) => value.toLocaleString("pt-BR")

export function estimateText(estimate: WaitEstimate): string {
  if (estimate.kind === "NO_HISTORY") return "Ainda sem histórico para estimar"
  return `${estimate.kind === "ABOUT" ? "Cerca de" : "Mais de"} ${estimate.minutes} min`
}

/** Texto curto da medida principal (resumos e testes). Sem dados nunca vira zero. */
export function measureMainText(measure: Measure): string {
  const copy = COPY[measure.id]
  const main = measure.main
  if (measure.kind === "AVERAGE") {
    if (main.status === "NO_DATA") return "Sem dados no período"
    if (main.status === "SMALL_SAMPLE" || main.value === null) return `Poucos dados · ${plural(main.denominator ?? 0, ["nota", "notas"])}`
    return `${main.value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} de 5 · ${plural(main.denominator ?? 0, ["nota", "notas"])}`
  }
  if (measure.kind === "PERCENTILE") {
    const count = main.numerator ?? 0
    return count === 0 ? "Sem dados no período" : plural(count, copy?.unit ?? ["medição", "medições"])
  }
  if (measure.kind === "RATE") return rateText(main, copy?.unit ?? ["caso", "casos"])
  if (main.status === "NO_DATA") return "Sem dados no período"
  return plural(main.numerator ?? 0, copy?.unit ?? ["caso", "casos"])
}

function rateText(ratio: Ratio, unit: [string, string]): string {
  if (ratio.status === "NO_DATA") return "Sem dados no período"
  const counts = `${number(ratio.numerator ?? 0)} de ${plural(ratio.denominator ?? 0, unit)}`
  if (ratio.status === "SMALL_SAMPLE" || ratio.value === null) return `Poucos dados · ${counts}`
  return `${percentText(ratio.value)} · ${counts}`
}

/**
 * ABA INDICADORES — visão personalizável (padrão do app, `anjos.indicadores`): Resumo do período, Abandonos no período, Acionamentos do
 * período, Respostas da INIA, Pedidos e atendimentos, Avaliação do atendimento do Anjo. Cada cartão é um card que a pessoa reposiciona,
 * redimensiona em blocos e esconde; fica salvo para ela.
 */
export function FunnelTab({ filter }: { filter: PanelFilter }) {
  const query = useSupportFunnelQuery(filter)
  const abandonment = useAbandonmentSection({
    id: "abandonos",
    filter,
    title: "Abandonos no período",
    description: "Na espera: o operador desistiu antes de um Anjo assumir. No atendimento: alguém saiu ou parou de responder — encerramento normal e queda de rede não contam. O de hoje, ao vivo, está na Monitoria Online.",
  })
  const demand = useDemandSection(filter)
  const byId = new Map((query.data?.measures ?? []).map((measure) => [measure.id, measure]))
  const notes = query.data ? notesFor(query.data) : {}
  const state = (render: () => ReactNode, height = "h-28") =>
    query.isPending ? <Skeleton className={cn(height, "w-full rounded-2xl")} aria-label="Carregando os indicadores" /> : query.isError ? <PanelError error={query.error} onRetry={() => void query.refetch()} /> : render()
  const measureCards = (ids: string[], width: CardWidth): GridCard[] =>
    ids.map((id) => ({ id: id.toLowerCase(), title: COPY[id]?.title ?? id, defaultWidth: width, widths: [3, 4, 6, 8, 12] as const, render: () => state(() => (byId.has(id) ? <MeasureCard measure={byId.get(id)!} note={notes[id]} /> : <p className="text-sm text-muted-foreground">Sem dados no período.</p>), "h-40") }))
  const catalog: GridSection[] = [
    { id: "resumo", title: "Resumo do período", cards: summaryCards(byId).map((card) => ({ ...card, defaultWidth: 3, widths: [3, 4, 6, 12] as const, render: () => state(card.render) })) },
    abandonment,
    demand,
    { id: "respostas-inia", title: "Respostas da INIA", description: "Como as respostas da INIA no chat foram avaliadas. Estas avaliações são da resposta da INIA, não do atendimento do Anjo.", cards: measureCards(REPLY, 4) },
    { id: "pedidos", title: "Pedidos e atendimentos", description: "Do oferecimento do apoio ao fim do atendimento.", cards: measureCards(REQUESTS, 4) },
    { id: "avaliacao", title: "Avaliação do atendimento do Anjo", description: "Avaliação feita pelo operador sobre o atendimento, não sobre a resposta da INIA. Os tempos, os motivos e o resultado declarado pelo Anjo estão em Jornada e atendimentos.", cards: measureCards(EVALUATION, 6) },
  ]
  // Falha da leitura principal (ex.: período longo demais): um aviso só, em vez de um por card.
  if (query.isError) return <PanelError error={query.error} onRetry={() => void query.refetch()} />
  return <PersistedCustomizableView viewKey="anjos.indicadores" label="Indicadores" catalog={catalog} />
}

/** Observações curtas, só onde mudam a leitura de um indicador (datas em que a coleta começou e períodos com o apoio desligado). */
function notesFor(data: FunnelResponse): Record<string, string> {
  const notes: Record<string, string> = {}
  const startedInPeriod = (iso: string | null) => iso !== null && civilToday(new Date(iso)) > data.period.from
  const dislikes = data.measures.find((measure) => measure.id === "M4")
  const notCollected = dislikes?.breakdown?.find((item) => item.key === "NOT_COLLECTED")?.count ?? 0
  if (data.cutoffs.dislikeDetailsSince && notCollected > 0) notes.M4 = `Descurtidas anteriores a ${formatDateTime(data.cutoffs.dislikeDetailsSince)} não tinham motivo e aparecem como “Motivo não coletado”.`
  if (startedInPeriod(data.cutoffs.dislikeDetailsSince)) notes.M5 = `Conta só a partir de ${formatDateTime(data.cutoffs.dislikeDetailsSince!)}, quando a pergunta passou a ser feita.`
  if (startedInPeriod(data.cutoffs.signalsSince)) notes.M6 = `A INIA passou a registrar esses casos em ${formatDateTime(data.cutoffs.signalsSince!)}; respostas anteriores não entram na conta.`
  if (data.cutoffs.disabledPeriods.length > 0) {
    const ranges = data.cutoffs.disabledPeriods.map((period) => (period.to ? `de ${formatDateTime(period.from)} a ${formatDateTime(period.to)}` : `desde ${formatDateTime(period.from)}`)).join("; ")
    notes.M7 = `O apoio esteve desligado ${ranges}: nesse intervalo não houve sugestões.`
    notes.M8 = `O apoio esteve desligado ${ranges}: nesse intervalo não houve pedidos.`
  }
  return notes
}

/** Os quatro cartões do resumo, cada um um card da área "Resumo do período". */
function summaryCards(byId: Map<string, Measure>): { id: string; title: string; render: () => ReactNode }[] {
  const requests = byId.get("M8")
  const wait = byId.get("M11")
  const response = byId.get("M12")
  const resolved = byId.get("M16")
  const yes = resolved?.breakdown?.find((item) => item.key === "YES")
  const resolvedBase = resolved?.main.numerator ?? 0
  return [
    { id: "pedidos-de-apoio", title: "Pedidos de apoio", render: () => <SummaryTile kind="count" title="Pedidos de apoio" value={requests ? number(requests.main.numerator ?? 0) : null} unit={requests && (requests.main.numerator ?? 0) === 1 ? "pedido" : "pedidos"} note={requests?.conversion && requests.conversion.status === "OK" && requests.conversion.value !== null ? `${percentText(requests.conversion.value)} das sugestões viraram pedido` : null} /> },
    { id: "espera-90", title: "Espera de 90% dos pedidos", render: () => <SummaryTile kind="duration" title="Espera de 90% dos pedidos" value={wait && (wait.main.numerator ?? 0) > 0 ? durationText(wait.percentiles?.p90 ?? null) : null} note={wait && (wait.main.numerator ?? 0) > 0 ? "90% receberam um Anjo em até esse tempo." : null} small={wait ? (wait.main.numerator ?? 0) > 0 && (wait.main.numerator ?? 0) < MIN_SAMPLE : false} /> },
    { id: "primeira-resposta", title: "Primeira resposta do Anjo", render: () => <SummaryTile kind="duration" title="Primeira resposta do Anjo" value={response && (response.main.numerator ?? 0) > 0 ? durationText(response.percentiles?.p50 ?? null) : null} note={response && (response.main.numerator ?? 0) > 0 ? "Metade dos atendimentos teve resposta em até esse tempo." : null} small={response ? (response.main.numerator ?? 0) > 0 && (response.main.numerator ?? 0) < MIN_SAMPLE : false} /> },
    {
      id: "duvida-resolvida",
      title: "Dúvida resolvida",
      render: () => (
        <SummaryTile
          kind="percent"
          title="Dúvida resolvida"
          value={resolvedBase >= MIN_SAMPLE && yes?.value !== undefined && yes.value !== null ? percentText(yes.value) : null}
          unit={resolvedBase >= MIN_SAMPLE ? "responderam “Sim”" : undefined}
          note={resolvedBase === 0 ? null : resolvedBase < MIN_SAMPLE ? `Poucos dados: ${plural(resolvedBase, ["resposta", "respostas"])}. A porcentagem aparece com 5 ou mais.` : `Segundo ${plural(resolvedBase, ["operador que respondeu", "operadores que responderam"])}.`}
          emptyText={resolvedBase > 0 && resolvedBase < MIN_SAMPLE ? "Poucos dados" : undefined}
        />
      ),
    },
  ]
}

function SummaryTile({ kind, title, value, unit, note, small = false, emptyText }: { kind: Kind; title: string; value: string | null; unit?: string | undefined; note?: string | null; small?: boolean; emptyText?: string | undefined }) {
  const icon = KIND_ICON[kind]
  return (
    <article className={cn(SURFACE_CARD, "flex h-full flex-col gap-2 p-4")} aria-label={title}>
      <div className="flex items-center gap-2">
        <IconBadge icon={icon.icon} size="sm" tone="info" />
        <h3 className="text-sm font-medium">{title}</h3>
      </div>
      {value === null ? (
        <p className="text-lg font-semibold text-muted-foreground">{emptyText ?? "Sem dados no período"}</p>
      ) : (
        <p className="text-2xl font-semibold tabular-nums text-primary dark:text-chart-4">
          {value}
          {unit ? <span className="ml-1.5 text-sm font-medium text-muted-foreground">{unit}</span> : null}
        </p>
      )}
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
      {small ? <SmallSample text="Poucos dados: com menos de 5 casos, um único caso muda muito o resultado." /> : null}
    </article>
  )
}

export function MeasureCard({ measure, note }: { measure: Measure; note?: string | undefined }) {
  const copy = COPY[measure.id] ?? { title: "Indicador", help: "", kind: "count" as const, unit: ["caso", "casos"] as [string, string] }
  const side = SIDE_LABELS[measure.id] ?? {}
  const icon = KIND_ICON[copy.kind]
  return (
    <article className={cn(SURFACE_CARD, "flex h-full flex-col gap-3 p-4")} aria-label={copy.title} data-testid={`measure-${measure.id}`}>
      <header className="flex items-start gap-3">
        <IconBadge icon={icon.icon} size="sm" tone="neutral" />
        <div className="min-w-0 space-y-0.5">
          <h3 className="text-sm font-semibold leading-snug">{copy.title}</h3>
          <p className="text-xs text-muted-foreground">{copy.help}</p>
        </div>
        <span className="sr-only">Tipo: {icon.label}</span>
      </header>

      <MainValue measure={measure} copy={copy} />

      {measure.coverage || measure.conversion || measure.noResponse ? (
        <dl className="space-y-1 text-sm">
          {measure.coverage ? <RatioLine label={side.coverage ?? "Cobertura"} ratio={measure.coverage} /> : null}
          {measure.conversion ? <RatioLine label={side.conversion ?? "Conversão"} ratio={measure.conversion} /> : null}
          {measure.noResponse ? <RatioLine label={side.noResponse ?? "Sem resposta"} ratio={measure.noResponse} /> : null}
        </dl>
      ) : null}

      {measure.breakdown && measure.breakdown.length > 0 && measure.main.status !== "NO_DATA" ? <Breakdown title={side.breakdown} items={measure.breakdown} hideShares={measure.main.status === "SMALL_SAMPLE"} /> : null}
      {measure.extra && measure.extra.length > 0 ? <Breakdown title={side.extra} items={measure.extra} hideShares /> : null}
      {note ? (
        <p className="flex gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-px size-3.5 shrink-0" aria-hidden />
          {note}
        </p>
      ) : null}
    </article>
  )
}

function MainValue({ measure, copy }: { measure: Measure; copy: Copy }) {
  const main = measure.main
  if (measure.kind === "PERCENTILE") {
    const count = main.numerator ?? 0
    const durations = DURATIONS[measure.id]
    const estimate = measure.percentiles?.estimate ?? null
    return (
      <div className="space-y-2">
        {count === 0 ? <Empty /> : null}
        {count > 0 && durations?.median && measure.percentiles?.p50 !== null && measure.percentiles?.p50 !== undefined ? <DurationStat label={durations.median[0]} help={durations.median[1]} seconds={measure.percentiles.p50} /> : null}
        {count > 0 && durations && measure.percentiles?.p90 !== null && measure.percentiles?.p90 !== undefined ? <DurationStat label={durations.p90[0]} help={durations.p90[1]} seconds={measure.percentiles.p90} /> : null}
        {estimate ? <EstimateStat estimate={estimate} /> : null}
        {count > 0 ? <p className="text-xs text-muted-foreground">Com base em {plural(count, copy.unit)} no período.</p> : null}
        {count > 0 && count < MIN_SAMPLE ? <SmallSample text={`Poucos dados: com menos de ${MIN_SAMPLE}, um único caso muda muito o resultado.`} /> : null}
      </div>
    )
  }
  if (main.status === "NO_DATA") return <Empty />
  if (measure.kind === "AVERAGE") {
    if (main.status === "SMALL_SAMPLE" || main.value === null) return <SmallValue headline={plural(main.denominator ?? 0, copy.unit)} text={`A média aparece com ${MIN_SAMPLE} notas ou mais.`} />
    return (
      <p className="text-2xl font-semibold tabular-nums text-primary dark:text-chart-4">
        {main.value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}
        <span className="ml-1.5 text-sm font-medium text-muted-foreground">de 5 · {plural(main.denominator ?? 0, copy.unit)}</span>
      </p>
    )
  }
  if (measure.kind === "RATE") {
    const counts = `${number(main.numerator ?? 0)} de ${plural(main.denominator ?? 0, copy.unit)}`
    if (main.status === "SMALL_SAMPLE" || main.value === null) return <SmallValue headline={counts} text={`Com menos de ${MIN_SAMPLE}, a porcentagem não é calculada.`} />
    return (
      <div>
        <p className="text-2xl font-semibold tabular-nums text-primary dark:text-chart-4">{percentText(main.value)}</p>
        <p className="text-xs text-muted-foreground tabular-nums">{counts}</p>
      </div>
    )
  }
  return (
    <div>
      <p className="text-2xl font-semibold tabular-nums text-primary dark:text-chart-4">
        {number(main.numerator ?? 0)}
        <span className="ml-1.5 text-sm font-medium text-muted-foreground">{(main.numerator ?? 0) === 1 ? copy.unit[0] : copy.unit[1]}</span>
      </p>
      {main.status === "SMALL_SAMPLE" ? <SmallSample text={`Com menos de ${MIN_SAMPLE}, as porcentagens não são calculadas.`} /> : null}
    </div>
  )
}

function DurationStat({ label, help, seconds }: { label: string; help: string; seconds: number }) {
  return (
    <div className="space-y-0.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="text-lg font-semibold tabular-nums text-primary dark:text-chart-4">{durationText(seconds)}</span>
      </div>
      <p className="text-xs text-muted-foreground">{help}</p>
    </div>
  )
}

function EstimateStat({ estimate }: { estimate: WaitEstimate }) {
  return (
    <div className="space-y-0.5 rounded-xl bg-muted/50 px-3 py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <span className="text-sm text-muted-foreground">Espera estimada agora</span>
        <span className="text-sm font-semibold tabular-nums">{estimateText(estimate)}</span>
      </div>
      <p className="text-xs text-muted-foreground">
        {estimate.kind === "NO_HISTORY" ? "Aparece quando houver pelo menos 10 pedidos atribuídos nos últimos 14 dias." : `É o que o operador vê ao pedir ajuda: metade dos pedidos dos últimos 14 dias ${ESTIMATE_BASIS[estimate.basis]} recebeu um Anjo em até esse tempo.`}
      </p>
    </div>
  )
}

function Empty() {
  return <p className="text-lg font-semibold text-muted-foreground">Sem dados no período</p>
}

function SmallValue({ headline, text }: { headline: string; text: string }) {
  return (
    <div className="space-y-1">
      <p className="text-lg font-semibold text-muted-foreground">Poucos dados</p>
      <p className="text-xs text-muted-foreground tabular-nums">{headline}</p>
      <SmallSample text={text} />
    </div>
  )
}

function SmallSample({ text }: { text: string }) {
  return (
    <p className={cn(toneSurface("warning"), "flex gap-1.5 rounded-lg px-2 py-1 text-xs")}>
      <CircleAlert className="mt-px size-3.5 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden />
      {text}
    </p>
  )
}

function RatioLine({ label, ratio }: { label: string; ratio: Ratio }) {
  const value = ratio.status === "NO_DATA" ? "Sem dados" : ratio.status === "SMALL_SAMPLE" || ratio.value === null ? `${number(ratio.numerator ?? 0)} de ${number(ratio.denominator ?? 0)} · poucos dados` : `${number(ratio.numerator ?? 0)} de ${number(ratio.denominator ?? 0)} · ${percentText(ratio.value)}`
  return (
    <div className="flex flex-wrap justify-between gap-x-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  )
}

type BreakdownEntry = { key: string; label: string; count: number; value?: number | null | undefined }

/** Itens do detalhamento sempre do maior para o menor; empate mantém a ordem do catálogo (ordenação estável). */
export const byCountDesc = <T extends { count: number }>(items: readonly T[]): T[] => [...items].sort((a, b) => b.count - a.count)

function Breakdown({ title, items, hideShares = false }: { title?: string | undefined; items: BreakdownEntry[]; hideShares?: boolean }) {
  return (
    <div className="space-y-1.5 border-t pt-2.5">
      {title ? <p className="text-xs font-medium text-muted-foreground">{title}</p> : null}
      <ul className="space-y-1.5 text-sm">
        {byCountDesc(items).map((item) => (
          <BreakdownItem key={item.key} label={item.label} count={item.count} share={hideShares ? null : (item.value ?? null)} />
        ))}
      </ul>
    </div>
  )
}

function BreakdownItem({ label, count, share }: { label: string; count: number; share: number | null }): ReactNode {
  return (
    <li className={cn("space-y-1", count === 0 && "text-muted-foreground")}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0">{label}</span>
        <span className="shrink-0 tabular-nums">
          {number(count)}
          {share !== null ? <span className="ml-1.5 text-muted-foreground">{percentText(share)}</span> : null}
        </span>
      </div>
      {share !== null ? (
        <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.max(0, Math.min(100, share * 100))}%` }} />
        </div>
      ) : null}
    </li>
  )
}

/** Usado pelo resumo da coordenação em outros pontos: período civil "AAAA-MM-DD" em "dd/MM/aaaa". */
export const periodText = (period: { from: string; to: string }) => `${formatCivilDate(period.from)} a ${formatCivilDate(period.to)}`
