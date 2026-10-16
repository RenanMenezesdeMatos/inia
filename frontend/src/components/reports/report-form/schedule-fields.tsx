"use client"

import { Plus, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { WEEKDAYS, type ReportSchedule } from "@/schemas/reports/reports.schema"
import { WEEKDAY_LABELS } from "../report-labels"
import { ChipToggleGroup, Field, OptionSelect } from "./form-controls"

/** Quando roda: frequência, dias, horários e o fuso (mostrado; é o da operação). */
export function ScheduleFields({ schedule, onChange, timeZone }: { schedule: ReportSchedule; onChange: (schedule: ReportSchedule) => void; timeZone: string }) {
  const set = (patch: Partial<ReportSchedule>) => onChange({ ...schedule, ...patch })
  const day = schedule.dayOfMonth
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Frequência">
        <OptionSelect
          ariaLabel="Frequência"
          value={schedule.frequency}
          onChange={(frequency) => onChange({ frequency, times: schedule.times, ...(frequency === "WEEKLY" ? { weekdays: schedule.weekdays?.length ? schedule.weekdays : ["MON"] } : {}), ...(frequency === "MONTHLY" ? { dayOfMonth: schedule.dayOfMonth ?? 1, ...(schedule.onMissingDay ? { onMissingDay: schedule.onMissingDay } : {}) } : {}) })}
          options={[{ value: "DAILY", label: "Diária" }, { value: "WEEKLY", label: "Semanal" }, { value: "MONTHLY", label: "Mensal" }]}
        />
      </Field>
      <Field label="Fuso horário" hint="Fuso da operação — os horários valem nele.">
        <p className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm">{timeZone}</p>
      </Field>
      {schedule.frequency === "WEEKLY" ? (
        <Field label="Dias da semana" className="sm:col-span-2">
          <ChipToggleGroup ariaLabel="Dias da semana" options={WEEKDAYS.map((value) => ({ value, label: WEEKDAY_LABELS[value]! }))} selected={schedule.weekdays ?? []} onChange={(weekdays) => set({ weekdays: weekdays as ReportSchedule["weekdays"] })} />
        </Field>
      ) : null}
      {schedule.frequency === "MONTHLY" ? (
        <>
          <Field label="Dia do mês">
            <OptionSelect ariaLabel="Dia do mês" value={String(day ?? 1)} onChange={(value) => set({ dayOfMonth: value === "LAST" ? "LAST" : Number(value) })} options={[...Array.from({ length: 31 }, (_, index) => ({ value: String(index + 1), label: `Dia ${index + 1}` })), { value: "LAST", label: "Último dia do mês" }]} />
          </Field>
          {typeof day === "number" && day > 28 ? (
            <Field label={`Meses sem o dia ${day}`}>
              <RadioGroup value={schedule.onMissingDay ?? ""} onValueChange={(value) => set({ onMissingDay: value as "SKIP" | "LAST_DAY" })} className="gap-1.5">
                <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="LAST_DAY" />Usar o último dia do mês</label>
                <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="SKIP" />Pular aquele mês</label>
              </RadioGroup>
            </Field>
          ) : null}
        </>
      ) : null}
      <Field label="Horários" className="sm:col-span-2">
        <div className="flex flex-wrap items-center gap-2">
          {schedule.times.map((time, index) => (
            <div key={index} className="flex items-center gap-1">
              <Input type="time" value={time} onChange={(event) => set({ times: schedule.times.map((item, position) => (position === index ? event.target.value : item)) })} className="w-28" aria-label={`Horário ${index + 1}`} />
              {schedule.times.length > 1 ? <Button type="button" variant="ghost" size="icon" aria-label={`Remover horário ${index + 1}`} onClick={() => set({ times: schedule.times.filter((_, position) => position !== index) })}><X aria-hidden /></Button> : null}
            </div>
          ))}
          {schedule.times.length < 4 ? <Button type="button" variant="outline" size="sm" onClick={() => set({ times: [...schedule.times, "17:00"] })}><Plus aria-hidden />Horário</Button> : null}
        </div>
      </Field>
    </div>
  )
}
