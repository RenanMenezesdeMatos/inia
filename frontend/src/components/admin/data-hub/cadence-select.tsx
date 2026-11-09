"use client"

import { useId, useState } from "react"
import { Plus, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { formatShortDateTime } from "@/lib/format/date"
import { useCadencePreviewQuery } from "@/queries/admin/use-data-hub-queries"
import { MAX_CALENDAR_TIMES, MAX_EVERY_N_DAYS, MIN_SYNC_INTERVAL_MINUTES, cadenceLabel, cadenceProblem, cadenceSaveProblem, type Cadence } from "@/schemas/admin/data-hub-cadence.schema"
import { WEEKDAY_LABELS, WEEKDAY_ORDER, WEEKDAY_SHORT_LABELS, type Weekday } from "@/schemas/admin/workflow.schema"

const PRESET_INTERVALS = [
  { minutes: 15, label: "A cada 15 min" },
  { minutes: 60, label: "A cada 1 h" },
  { minutes: 360, label: "A cada 6 h" },
]
const DEFAULT_TIME = "06:00"
const DEFAULT_CUSTOM_INTERVAL_MINUTES = 30
const WORK_WEEK: Weekday[] = ["MON", "TUE", "WED", "THU", "FRI"]

type Mode = "MANUAL" | `INTERVAL:${number}` | "CUSTOM_INTERVAL" | "DAILY" | "EVERY_N_DAYS" | "WEEKLY" | "MONTHLY"
type CalendarCadence = Extract<Cadence, { kind: "CALENDAR" }>
type IntervalUnit = "MINUTES" | "HOURS"

const isPresetInterval = (minutes: number) => PRESET_INTERVALS.some((preset) => preset.minutes === minutes)

function modeOf(cadence: Cadence, customInterval: boolean): Mode {
  switch (cadence.kind) {
    case "MANUAL":
      return "MANUAL"
    case "INTERVAL":
      return customInterval || !isPresetInterval(cadence.minutes) ? "CUSTOM_INTERVAL" : `INTERVAL:${cadence.minutes}`
    case "DAILY":
      return "DAILY"
    case "CALENDAR":
      return cadence.frequency.type
  }
}

function timesOf(cadence: Cadence): string[] {
  if (cadence.kind === "DAILY") return [cadence.time]
  return cadence.kind === "CALENDAR" ? cadence.times : [DEFAULT_TIME]
}

function localToday(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}

/** Diário com um horário é a forma de sempre; com mais de um, vira agenda. Quem volta para um horário volta à forma de sempre. */
function dailyCadence(times: string[]): Cadence {
  return times.length === 1 ? { kind: "DAILY", time: times[0]! } : { kind: "CALENDAR", times, frequency: { type: "DAILY" } }
}

/** Sugere o próximo horário livre: uma hora depois do último, longe o bastante de todos os outros. */
function nextFreeTime(times: string[]): string {
  const taken = times.filter(Boolean).map((time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)))
  const start = taken.length > 0 ? Math.max(...taken) : 6 * 60
  for (let hours = 1; hours <= 24; hours += 1) {
    const candidate = (start + hours * 60) % (24 * 60)
    const free = taken.every((value) => {
      const gap = Math.abs(value - candidate)
      return Math.min(gap, 24 * 60 - gap) >= MIN_SYNC_INTERVAL_MINUTES
    })
    if (free) return `${String(Math.floor(candidate / 60)).padStart(2, "0")}:${String(candidate % 60).padStart(2, "0")}`
  }
  return DEFAULT_TIME
}

function TimesField({ id, times, onChange, disabled }: { id: string; times: string[]; onChange: (next: string[]) => void; disabled?: boolean }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={`${id}-0`}>{times.length > 1 ? "Horários" : "Horário"} (fuso da operação)</Label>
      <div className="flex flex-wrap items-center gap-2">
        {times.map((time, index) => (
          <div key={index} className="flex items-center gap-0.5">
            <Input
              id={`${id}-${index}`}
              type="time"
              aria-label={`Horário ${index + 1}`}
              value={time}
              className="w-28"
              disabled={disabled}
              onChange={(event) => onChange(times.map((current, position) => (position === index ? event.target.value : current)))}
            />
            {times.length > 1 ? (
              <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={`Remover horário ${index + 1}`} disabled={disabled} onClick={() => onChange(times.filter((_, position) => position !== index))}>
                <X className="size-3.5" />
              </Button>
            ) : null}
          </div>
        ))}
        {times.length < MAX_CALENDAR_TIMES ? (
          <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => onChange([...times, nextFreeTime(times)])}>
            <Plus className="size-3.5" /> Adicionar horário
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function IntervalField({ id, minutes, onChange, disabled }: { id: string; minutes: number; onChange: (next: number) => void; disabled?: boolean }) {
  const [unit, setUnit] = useState<IntervalUnit>(minutes > 0 && minutes % 60 === 0 ? "HOURS" : "MINUTES")
  const size = unit === "HOURS" ? 60 : 1
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-amount`}>A cada</Label>
        <Input
          id={`${id}-amount`}
          type="number"
          min={unit === "HOURS" ? 1 : MIN_SYNC_INTERVAL_MINUTES}
          max={unit === "HOURS" ? 24 : 1440}
          step={1}
          value={minutes > 0 ? minutes / size : ""}
          className="w-24"
          disabled={disabled}
          onChange={(event) => onChange(event.target.value === "" ? 0 : Number(event.target.value) * size)}
        />
      </div>
      <Select
        value={unit}
        disabled={disabled}
        onValueChange={(next) => {
          const nextUnit = next as IntervalUnit
          setUnit(nextUnit)
          // Em horas o número é inteiro: 90 minutos viram 2 horas, nunca 1,5.
          if (nextUnit === "HOURS" && minutes > 0) onChange(Math.max(1, Math.round(minutes / 60)) * 60)
        }}
      >
        <SelectTrigger aria-label="Unidade do intervalo" className="w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="MINUTES">minutos</SelectItem>
          <SelectItem value="HOURS">horas</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}

function EveryNDaysFields({ id, cadence, onChange, disabled }: { id: string; cadence: CalendarCadence; onChange: (next: Cadence) => void; disabled?: boolean }) {
  if (cadence.frequency.type !== "EVERY_N_DAYS") return null
  const { frequency } = cadence
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-days`}>A cada quantos dias</Label>
        <Input
          id={`${id}-days`}
          type="number"
          min={1}
          max={MAX_EVERY_N_DAYS}
          step={1}
          value={frequency.days > 0 ? frequency.days : ""}
          className="w-24"
          disabled={disabled}
          onChange={(event) => onChange({ ...cadence, frequency: { ...frequency, days: event.target.value === "" ? 0 : Number(event.target.value) } })}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-start`}>A partir de</Label>
        <Input id={`${id}-start`} type="date" value={frequency.startDate} className="w-40" disabled={disabled} onChange={(event) => onChange({ ...cadence, frequency: { ...frequency, startDate: event.target.value } })} />
      </div>
    </div>
  )
}

function WeekdaysField({ id, cadence, onChange, disabled }: { id: string; cadence: CalendarCadence; onChange: (next: Cadence) => void; disabled?: boolean }) {
  if (cadence.frequency.type !== "WEEKLY") return null
  return (
    <div className="space-y-1.5">
      <Label id={`${id}-weekdays`}>Dias da semana</Label>
      <ToggleGroup
        type="multiple"
        aria-labelledby={`${id}-weekdays`}
        value={cadence.frequency.weekdays}
        disabled={disabled}
        onValueChange={(weekdays) => onChange({ ...cadence, frequency: { type: "WEEKLY", weekdays: WEEKDAY_ORDER.filter((day) => weekdays.includes(day)) } })}
        className="flex-wrap justify-start"
      >
        {WEEKDAY_ORDER.map((day) => (
          <ToggleGroupItem key={day} value={day} aria-label={WEEKDAY_LABELS[day]} className="text-xs">
            {WEEKDAY_SHORT_LABELS[day]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}

function MonthlyFields({ id, cadence, onChange, disabled }: { id: string; cadence: CalendarCadence; onChange: (next: Cadence) => void; disabled?: boolean }) {
  if (cadence.frequency.type !== "MONTHLY") return null
  const { frequency } = cadence
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-monthly`}>Quando</Label>
          <Select
            value={frequency.mode}
            disabled={disabled}
            onValueChange={(mode) => onChange({ ...cadence, frequency: mode === "LAST_DAY" ? { type: "MONTHLY", mode: "LAST_DAY" } : { type: "MONTHLY", mode: "DAY_OF_MONTH", day: frequency.day ?? 1 } })}
          >
            <SelectTrigger id={`${id}-monthly`} className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="DAY_OF_MONTH">Dia escolhido</SelectItem>
              <SelectItem value="LAST_DAY">Último dia do mês</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {frequency.mode === "DAY_OF_MONTH" ? (
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-day`}>Dia</Label>
            <Input
              id={`${id}-day`}
              type="number"
              min={1}
              max={31}
              step={1}
              value={frequency.day ?? ""}
              className="w-20"
              disabled={disabled}
              onChange={(event) => onChange({ ...cadence, frequency: event.target.value === "" ? { type: "MONTHLY", mode: "DAY_OF_MONTH" } : { type: "MONTHLY", mode: "DAY_OF_MONTH", day: Number(event.target.value) } })}
            />
          </div>
        ) : null}
      </div>
      {frequency.mode === "DAY_OF_MONTH" && (frequency.day ?? 0) > 28 ? <p className="text-xs text-muted-foreground">Nos meses sem o dia {frequency.day} não há carga. Para rodar todo mês, use o último dia do mês.</p> : null}
    </div>
  )
}

function CadenceSummary({ cadence, problem }: { cadence: Cadence; problem: string | null }) {
  const debounced = useDebouncedValue(cadence, 300)
  const preview = useCadencePreviewQuery(debounced, (debounced.kind === "DAILY" || debounced.kind === "CALENDAR") && cadenceProblem(debounced) === null && problem === null)
  if (problem) {
    return (
      <p role="alert" className="text-xs text-destructive">
        {problem}
      </p>
    )
  }
  if (cadence.kind === "MANUAL") return null
  if (cadence.kind === "INTERVAL") {
    return (
      <p className="text-xs text-muted-foreground" data-testid="cadence-summary">
        {cadenceLabel(cadence)}. A contagem recomeça quando cada carga termina, então o horário do dia varia. Para evitar um horário, escolha dias e horários.
      </p>
    )
  }
  const data = preview.data
  return (
    <div className="rounded-md bg-muted/60 px-3 py-2 text-xs" data-testid="cadence-summary">
      <p className="font-medium text-foreground">{cadenceLabel(cadence)}</p>
      {data && data.nextRuns.length > 0 ? (
        <p className="mt-0.5 text-muted-foreground" data-testid="cadence-next-runs">
          Próximas: {data.nextRuns.map((run) => formatShortDateTime(run, { timeZone: data.timeZone, withWeekday: true })).join(" · ")} ({data.timeZone})
        </p>
      ) : null}
    </div>
  )
}

/**
 * Periodicidade de um conjunto de dados: as opções prontas de sempre mais as personalizadas (minutos ou horas, a cada N dias, dias
 * da semana, dia do mês), sempre em frases, nunca em cron. `savedValue` é o que já está gravado: continua valendo mesmo fora das
 * regras atuais (feed antigo com intervalo abaixo do mínimo). Quem controla o estado confere `cadenceSaveProblem` antes de salvar.
 */
export function CadenceSelect({ value, onChange, disabled, savedValue }: { value: Cadence; onChange: (next: Cadence) => void; disabled?: boolean; savedValue?: Cadence }) {
  const id = useId()
  const [customInterval, setCustomInterval] = useState(value.kind === "INTERVAL" && !isPresetInterval(value.minutes))
  const mode = modeOf(value, customInterval)
  const times = timesOf(value)

  function selectMode(next: Mode) {
    setCustomInterval(next === "CUSTOM_INTERVAL")
    if (next === "MANUAL") onChange({ kind: "MANUAL" })
    else if (next === "CUSTOM_INTERVAL") onChange({ kind: "INTERVAL", minutes: value.kind === "INTERVAL" ? value.minutes : DEFAULT_CUSTOM_INTERVAL_MINUTES })
    else if (next === "DAILY") onChange(dailyCadence(times))
    else if (next === "EVERY_N_DAYS") onChange({ kind: "CALENDAR", times, frequency: { type: "EVERY_N_DAYS", days: 2, startDate: localToday() } })
    else if (next === "WEEKLY") onChange({ kind: "CALENDAR", times, frequency: { type: "WEEKLY", weekdays: WORK_WEEK } })
    else if (next === "MONTHLY") onChange({ kind: "CALENDAR", times, frequency: { type: "MONTHLY", mode: "DAY_OF_MONTH", day: 1 } })
    else onChange({ kind: "INTERVAL", minutes: Number(next.split(":")[1]) })
  }

  function setTimes(next: string[]) {
    if (mode === "DAILY") onChange(dailyCadence(next))
    else if (value.kind === "CALENDAR") onChange({ ...value, times: next })
  }

  return (
    <div className="space-y-3" data-testid="cadence-field">
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-mode`}>Frequência</Label>
        <Select value={mode} disabled={disabled} onValueChange={(next) => selectMode(next as Mode)}>
          <SelectTrigger id={`${id}-mode`} className="w-full sm:max-w-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="MANUAL">Manual (só quando eu pedir)</SelectItem>
            {PRESET_INTERVALS.map((preset) => (
              <SelectItem key={preset.minutes} value={`INTERVAL:${preset.minutes}`}>
                {preset.label}
              </SelectItem>
            ))}
            <SelectItem value="DAILY">Diário, em um ou mais horários</SelectItem>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel>Personalizada</SelectLabel>
              <SelectItem value="CUSTOM_INTERVAL">A cada N minutos ou horas</SelectItem>
              <SelectItem value="EVERY_N_DAYS">A cada N dias</SelectItem>
              <SelectItem value="WEEKLY">Em dias da semana</SelectItem>
              <SelectItem value="MONTHLY">Em um dia do mês</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      {mode === "CUSTOM_INTERVAL" && value.kind === "INTERVAL" ? <IntervalField id={id} minutes={value.minutes} onChange={(minutes) => onChange({ kind: "INTERVAL", minutes })} disabled={disabled} /> : null}
      {value.kind === "CALENDAR" ? (
        <>
          <EveryNDaysFields id={id} cadence={value} onChange={onChange} disabled={disabled} />
          <WeekdaysField id={id} cadence={value} onChange={onChange} disabled={disabled} />
          <MonthlyFields id={id} cadence={value} onChange={onChange} disabled={disabled} />
        </>
      ) : null}
      {value.kind === "DAILY" || value.kind === "CALENDAR" ? <TimesField id={`${id}-time`} times={times} onChange={setTimes} disabled={disabled} /> : null}

      <CadenceSummary cadence={value} problem={cadenceSaveProblem(value, savedValue)} />
    </div>
  )
}
