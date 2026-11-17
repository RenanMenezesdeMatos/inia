"use client"

import { Coffee, LogIn, LogOut, type LucideIcon } from "lucide-react"

import { IconBadge, SectionLabel, StatusChip, SURFACE_CARD, toneSurface } from "@/components/ui/surface"
import { cn } from "@/lib/utils"
import type { JourneyDay } from "@/schemas/my-journey/my-journey.schema"

import { JourneyAgenda } from "./journey-agenda"
import { DAY_KIND_STYLE, dayMonth, formatClock, formatDuration, minuteToClock, nextBreak, weekdayLong } from "./journey-format"
import { JourneyTimeline } from "./journey-timeline"

/**
 * Detalhe de UM dia da "Minha jornada": resumo (entrada, próxima pausa, fim da jornada) e a linha do tempo do planejamento, em
 * ordem. Em "hoje", o minuto atual (fuso da escala) marca "Agora" e realça o bloco previsto para este momento — só para localizar
 * a pessoa no plano, nunca como registro do que ela fez.
 */
export function JourneyDayDetail({ day, isToday, nowMinute, pausesAvailable }: { day: JourneyDay; isToday: boolean; nowMinute: number | null; pausesAvailable: boolean }) {
  const title = isToday ? "Hoje" : `${weekdayLong(day.date).charAt(0).toUpperCase()}${weekdayLong(day.date).slice(1)}, ${dayMonth(day.date)}`
  return (
    <section aria-label={`Jornada de ${isToday ? "hoje" : `${weekdayLong(day.date)}, ${dayMonth(day.date)}`}`} className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg font-semibold">{title}{isToday ? <span className="ml-2 text-sm font-normal text-muted-foreground">{weekdayLong(day.date)}, {dayMonth(day.date)}</span> : null}</h3>
      </div>
      <DaySummary day={day} isToday={isToday} nowMinute={isToday ? nowMinute : null} pausesAvailable={pausesAvailable} />
      {day.blocks.some((block) => block.kind !== "NON_WORKING") ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="space-y-2">
            <SectionLabel as="p">Linha do tempo prevista</SectionLabel>
            <JourneyTimeline blocks={day.blocks} nowMinute={isToday ? nowMinute : null} />
          </div>
          <div className="space-y-2">
            <SectionLabel as="p">Horários do dia</SectionLabel>
            <JourneyAgenda blocks={day.blocks} nowMinute={isToday ? nowMinute : null} />
          </div>
        </div>
      ) : null}
    </section>
  )
}

function SummaryTile({ icon, label, value, hint }: { icon: LucideIcon; label: string; value: string; hint?: string | undefined }) {
  return (
    <div className={cn(SURFACE_CARD, "flex items-center gap-3 p-4")}>
      <IconBadge icon={icon} tone="info" />
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="text-xl font-semibold tabular-nums">{value}</p>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
    </div>
  )
}

/** "Próxima pausa": a de agora ou a próxima (hoje), a primeira (outro dia); sem fonte de pausas, diz que o detalhe não chega. */
function breakTile(day: JourneyDay, nowMinute: number | null, pausesAvailable: boolean): { value: string; hint: string } {
  if (!pausesAvailable) return { value: "Sem detalhe", hint: "Pausas ainda não informadas" }
  if (!day.blocks.some((block) => block.kind === "BREAK")) return { value: "Nenhuma", hint: "Sem pausa prevista neste dia" }
  const next = nextBreak(day.blocks, nowMinute)
  if (!next) return { value: "Nenhuma", hint: "Sem mais pausas hoje" }
  const range = `${minuteToClock(next.block.startMinute)} – ${next.block.endMinute === 1440 ? "0h00" : minuteToClock(next.block.endMinute)}`
  if (next.current) return { value: range, hint: `${next.block.label} · retorno às ${minuteToClock(next.block.endMinute)}` }
  const wait = nowMinute === null ? null : next.block.startMinute - nowMinute
  return { value: range, hint: wait === null ? next.block.label : `${next.block.label} · em ${formatDuration(wait)}` }
}

function DaySummary({ day, isToday, nowMinute, pausesAvailable }: { day: JourneyDay; isToday: boolean; nowMinute: number | null; pausesAvailable: boolean }) {
  if (day.kind === "WORK") {
    if (!day.shift) {
      return <Notice day={day} text="A escala diz que é dia de trabalho, mas não informou os horários de entrada e saída." />
    }
    const endsAtMidnight = day.shift.end === "00:00"
    const sourceHint = day.shift.source === "WORK_SHIFT" ? "Pela jornada cadastrada" : day.shift.source === "ACTIVITIES" ? "Pelas atividades da escala" : undefined
    const pause = breakTile(day, nowMinute, pausesAvailable)
    const logged = day.activities.some((activity) => activity.type === "LOGGED_IN")
    return (
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryTile icon={LogIn} label={logged ? "Login" : "Entrada prevista"} value={formatClock(day.shift.start)} hint={sourceHint} />
        <SummaryTile icon={Coffee} label={isToday ? "Próxima pausa" : "Primeira pausa"} value={pause.value} hint={pause.hint} />
        <SummaryTile icon={LogOut} label={logged ? "Logout" : "Fim da jornada"} value={endsAtMidnight ? "0h00" : formatClock(day.shift.end)} hint={day.shift.crossesMidnight ? (endsAtMidnight ? "À meia-noite" : "No dia seguinte") : sourceHint} />
      </div>
    )
  }
  const texts: Record<Exclude<JourneyDay["kind"], "WORK">, string> = {
    DAY_OFF: isToday ? "Hoje é sua folga. Bom descanso!" : "Folga prevista na sua escala.",
    EXCEPTION: `${day.label}: este dia não tem jornada prevista.`,
    HOLIDAY: "Feriado: sem jornada prevista neste dia.",
    EMPLOYMENT_STATUS: `Situação neste dia: ${day.label}. Não há jornada prevista.`,
    NO_SCHEDULE: "A escala deste dia ainda não foi publicada. Quando ela chegar, os horários aparecem aqui.",
    BEFORE_HIRE: "Data anterior à sua admissão.",
  }
  return <Notice day={day} text={texts[day.kind]} />
}

function Notice({ day, text }: { day: JourneyDay; text: string }) {
  const style = DAY_KIND_STYLE[day.kind]
  return (
    <div className={cn(toneSurface(style.tone), "flex items-start gap-3 p-4")}>
      <IconBadge icon={style.icon} tone={style.tone} />
      <div className="min-w-0 space-y-1">
        <p className="font-semibold">{day.label}</p>
        <p className="text-sm text-muted-foreground">{text}</p>
        {day.exceptions.length > 0 ? (
          <ul className="flex flex-wrap gap-2 pt-1" aria-label="Lançamentos do dia">
            {day.exceptions.map((exception) => (
              <li key={exception.id}>
                <StatusChip tone="success">{exception.label} · vigente · {exception.originLabel}</StatusChip>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  )
}
