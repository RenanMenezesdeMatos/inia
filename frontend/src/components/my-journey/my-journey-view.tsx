"use client"

import { useEffect, useState } from "react"
import { CalendarX2, ChevronLeft, ChevronRight, Info } from "lucide-react"

import { AnalyticsErrorState } from "@/components/analytics/analytics-states"
import { Button } from "@/components/ui/button"
import { EmptyState, LoadingState } from "@/components/ui/states"
import { SectionLabel, StatusChip, SURFACE_CARD, toneSurface } from "@/components/ui/surface"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"
import { useMyJourneyQuery } from "@/queries/my-journey/use-my-journey"
import type { JourneyDay, MyJourneyView as MyJourneyData } from "@/schemas/my-journey/my-journey.schema"

import { JourneyDayDetail } from "./journey-day-detail"
import { breaksCountLabel, DAY_KIND_STYLE, dayHeadline, dayMonth, nowInTimeZone, weekdayLong, weekdayShort, weekRangeLabel } from "./journey-format"

type Mode = "today" | "week"

/** Relógio no fuso da escala, atualizado a cada 30 s (o "Agora" anda sem recarregar a tela). */
function useNowIn(timeZone: string | null) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  return timeZone ? nowInTimeZone(now, timeZone) : null
}

/**
 * MINHA JORNADA — aba do operador para consultar a PRÓPRIA escala (só leitura): "Hoje" (entrada, próxima pausa, fim da jornada e
 * a linha do tempo prevista) e "Semana" (sete dias, navegação entre semanas e o detalhe do dia escolhido). Tudo vem do backend
 * (`GET /api/v1/my-journey`), que resolve a pessoa pela sessão.
 */
export function MyJourneyView() {
  const [mode, setMode] = useState<Mode>("today")
  const [week, setWeek] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const query = useMyJourneyQuery(week)
  const data = query.data ?? null
  const clock = useNowIn(data?.timeZone ?? null)
  const today = clock?.date ?? data?.today ?? null

  // Virou o dia (no fuso da escala) com a semana atual aberta: relê para "Hoje" seguir o calendário.
  const { refetch } = query
  useEffect(() => {
    if (data && today && today !== data.today && week === null) void refetch()
  }, [data, today, week, refetch])

  if (query.isPending && !data) return <LoadingState label="Carregando sua jornada…" rows={4} />
  if (query.isError && !data) return <AnalyticsErrorState error={query.error} onRetry={() => void query.refetch()} />
  if (!data) return null

  const goToWeek = (target: string | null) => {
    setWeek(target)
    setSelected(null)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <SectionLabel>Minha jornada</SectionLabel>
          <p className="text-sm text-muted-foreground">O planejamento da sua escala. O horário atual só mostra onde você está na jornada prevista.</p>
        </div>
        <ToggleGroup type="single" value={mode} onValueChange={(value) => value && setMode(value as Mode)} aria-label="Visão da jornada">
          <ToggleGroupItem value="today" className="px-4">Hoje</ToggleGroupItem>
          <ToggleGroupItem value="week" className="px-4">Semana</ToggleGroupItem>
        </ToggleGroup>
      </div>

      {!data.pauses.available ? (
        <div className={cn(toneSurface("neutral"), "flex items-start gap-2 px-4 py-3 text-sm text-muted-foreground")} role="note">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>{data.pauses.message}</p>
        </div>
      ) : null}

      {mode === "today" ? <TodayPanel data={data} today={today} nowMinute={clock?.minute ?? null} onOpenWeek={() => setMode("week")} refreshing={query.isFetching && week !== null} /> : null}
      {mode === "week" ? <WeekPanel data={data} today={today} selected={selected} onSelect={setSelected} onWeek={goToWeek} nowMinute={clock?.minute ?? null} loading={query.isFetching && query.isPlaceholderData} /> : null}
    </div>
  )
}

function TodayPanel({ data, today, nowMinute, onOpenWeek, refreshing }: { data: MyJourneyData; today: string | null; nowMinute: number | null; onOpenWeek: () => void; refreshing: boolean }) {
  // "Hoje" sempre lê a semana atual: se outra semana estiver carregada, a consulta da semana atual roda à parte.
  const current = useMyJourneyQuery(null)
  const source = data.week.containsToday ? data : current.data ?? null
  if (!source) return current.isError ? <AnalyticsErrorState error={current.error} onRetry={() => void current.refetch()} /> : <LoadingState label="Carregando o dia de hoje…" rows={3} />
  const day = source.days.find((item) => item.date === (today ?? source.today)) ?? source.days.find((item) => item.date === source.today)
  if (!day) return <EmptyState icon={CalendarX2} title="Sem dados para hoje" description="Não encontramos a sua escala para hoje." action={<Button variant="outline" size="sm" onClick={onOpenWeek}>Ver a semana</Button>} />
  return (
    <div aria-busy={refreshing || undefined}>
      <JourneyDayDetail day={day} isToday nowMinute={nowMinute} pausesAvailable={source.pauses.available} />
    </div>
  )
}

function WeekPanel({ data, today, selected, onSelect, onWeek, nowMinute, loading }: { data: MyJourneyData; today: string | null; selected: string | null; onSelect: (date: string) => void; onWeek: (week: string | null) => void; nowMinute: number | null; loading: boolean }) {
  const selectedDay = data.days.find((day) => day.date === selected) ?? data.days.find((day) => day.date === today) ?? data.days[0] ?? null
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-semibold" aria-live="polite">Semana de {weekRangeLabel(data.week.from, data.week.to)}</h3>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={() => onWeek(data.week.previous)} aria-label="Semana anterior">
            <ChevronLeft className="size-4" aria-hidden />
            <span className="hidden sm:inline">Anterior</span>
          </Button>
          <Button variant="outline" size="sm" onClick={() => onWeek(null)} disabled={data.week.containsToday}>Esta semana</Button>
          <Button variant="outline" size="sm" onClick={() => onWeek(data.week.next)} aria-label="Próxima semana">
            <span className="hidden sm:inline">Próxima</span>
            <ChevronRight className="size-4" aria-hidden />
          </Button>
        </div>
      </div>
      {data.days.length === 0 ? (
        <EmptyState icon={CalendarX2} title="Sem dados nesta semana" description="Não encontramos a sua escala para estes dias." />
      ) : (
        <ul className={cn("grid gap-2 sm:grid-cols-7", loading && "opacity-60")} aria-label="Dias da semana" aria-busy={loading || undefined}>
          {data.days.map((day) => (
            <li key={day.date}>
              <WeekDayCard day={day} isToday={day.date === today} selected={selectedDay?.date === day.date} onSelect={() => onSelect(day.date)} />
            </li>
          ))}
        </ul>
      )}
      {selectedDay ? <JourneyDayDetail day={selectedDay} isToday={selectedDay.date === today} nowMinute={nowMinute} pausesAvailable={data.pauses.available} /> : null}
    </div>
  )
}

function WeekDayCard({ day, isToday, selected, onSelect }: { day: JourneyDay; isToday: boolean; selected: boolean; onSelect: () => void }) {
  const style = DAY_KIND_STYLE[day.kind]
  const Icon = style.icon
  const breaks = breaksCountLabel(day)
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${weekdayLong(day.date)}, ${dayMonth(day.date)}${isToday ? " (hoje)" : ""}: ${dayHeadline(day)}${breaks ? `, ${breaks}` : ""}`}
      className={cn(
        SURFACE_CARD,
        "flex h-full w-full items-center gap-3 p-3 text-left transition-colors hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none sm:flex-col sm:items-start sm:gap-2",
        selected && "border-primary ring-1 ring-primary/40",
        isToday && !selected && "border-primary/50",
      )}
    >
      <div className="flex w-16 shrink-0 flex-col sm:w-full sm:flex-row sm:items-center sm:justify-between">
        <span className="text-sm font-semibold">{weekdayShort(day.date)}</span>
        <span className="text-xs text-muted-foreground tabular-nums">{dayMonth(day.date)}</span>
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:flex-col sm:items-start sm:gap-1">
        <Icon className={cn("size-4 shrink-0", day.kind === "WORK" ? "text-primary" : day.kind === "NO_SCHEDULE" ? "text-amber-600 dark:text-amber-400" : style.tone === "success" ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")} aria-hidden />
        <span className="flex min-w-0 flex-col">
          <span className={cn("text-sm", day.kind === "WORK" ? "font-semibold tabular-nums" : "text-muted-foreground")}>{dayHeadline(day)}</span>
          {breaks ? <span className="text-xs text-muted-foreground">{breaks}</span> : null}
        </span>
      </div>
      {isToday ? <StatusChip tone="info" className="shrink-0 px-2 py-0.5">Hoje</StatusChip> : null}
      {day.exceptions.length > 0 && day.kind !== "EXCEPTION" ? <span className="sr-only">Lançamentos: {day.exceptions.map((exception) => exception.label).join(", ")}</span> : null}
    </button>
  )
}
