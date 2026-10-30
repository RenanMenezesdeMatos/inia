"use client"

import { useId } from "react"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { CALENDAR_UNIT_LABELS, describeCalendarPeriod, OFFICIAL_AGGREGATIONS, allowedAggregationsFor, type OperationalAggregationKind, type CalendarPhase, type CalendarUnit, type HistoricalAggregation, type HistoricalPeriod, type HistoricalSource } from "@/schemas/admin/workflow-graph.schema"

const CALENDAR_UNITS = ["DAY", "WEEK", "MONTH", "TWO_MONTHS", "QUARTER", "FOUR_MONTHS", "SEMESTER"] as const

/** Select de período compartilhado por Histórico do indicador (Parte 10/18) — "Últimos X dias" é
 * uma janela móvel terminando agora; as opções de calendário cobrem tanto o período civil ANTERIOR
 * completo (padrão, ausente = "PREVIOUS") quanto o CORRENTE/parcial ("Este mês", "Hoje" — Parte 18),
 * selecionável pela Fase ao lado. A 3ª opção (só quando `allowClosures`) tem nomenclatura e
 * semântica DIFERENTES por origem — nunca a mesma para os dois conceitos (correção pontual de
 * PERÍODO pra Valor do indicador): pra Valor bruto (`closuresSource: "MEASUREMENT"`) é "Últimos
 * meses fechados" — N MESES DE CALENDÁRIO civis completos e consecutivos, mês corrente nunca
 * entra, competência ausente nunca é substituída por outra mais antiga; pra Atingimento/PRV
 * (`closuresSource: "ACHIEVEMENT"`) continua "Últimos fechamentos mensais" — fechamentos/
 * reference_period reais persistidos pela fonte, comportamento inalterado por esta correção. */
export function HistoricalPeriodPicker({
  period,
  allowClosures,
  closuresSource,
  operationalEnabled,
  onChange,
}: {
  period: HistoricalPeriod
  allowClosures: boolean
  closuresSource: "MEASUREMENT" | "ACHIEVEMENT"
  /** Capacidade do indicador (catálogo): sem medição operacional não há janela de dias/semana. Ausente = permitido. */
  operationalEnabled?: boolean
  onChange: (next: HistoricalPeriod) => void
}) {
  const uiKind = period.kind === "ROLLING_DAYS" ? "ROLLING_DAYS" : period.kind === "CLOSURES" ? "CLOSURES" : period.unit
  const phase: CalendarPhase = period.kind === "CALENDAR" ? (period.phase ?? "PREVIOUS") : "PREVIOUS"
  const closuresLabel = closuresSource === "MEASUREMENT" ? "Últimos meses fechados" : "Últimos fechamentos mensais"
  // Fonte oficial só existe por fechamento mensal: "Hoje", "Ontem", "Últimos X dias" e semana
  // civil não têm significado pra Atingimento/PRV — só períodos mensais ou fechamentos. O mesmo
  // vale pra um indicador SEM medição operacional (capacidade do catálogo, nunca lista de códigos).
  const operationalWindows = closuresSource === "MEASUREMENT" && operationalEnabled !== false
  const calendarUnits = operationalWindows ? CALENDAR_UNITS : CALENDAR_UNITS.filter((unit) => unit !== "DAY" && unit !== "WEEK")
  const fieldId = useId()
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${fieldId}-kind`}>Período</Label>
          <Select
            value={uiKind}
            onValueChange={(value) => {
              if (value === "ROLLING_DAYS") onChange({ kind: "ROLLING_DAYS", days: 7 })
              else if (value === "CLOSURES") onChange({ kind: "CLOSURES", unit: "MONTH", count: 3 })
              else onChange({ kind: "CALENDAR", unit: value as CalendarUnit, phase })
            }}
          >
            <SelectTrigger id={`${fieldId}-kind`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {operationalWindows ? <SelectItem value="ROLLING_DAYS">Últimos X dias</SelectItem> : null}
              {calendarUnits.map((unit) => (
                <SelectItem key={unit} value={unit}>
                  {CALENDAR_UNIT_LABELS[unit]}
                </SelectItem>
              ))}
              {allowClosures ? <SelectItem value="CLOSURES">{closuresLabel}</SelectItem> : null}
            </SelectContent>
          </Select>
        </div>
        {period.kind === "ROLLING_DAYS" ? (
          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-days`}>Quantidade de dias</Label>
            <Input
              id={`${fieldId}-days`}
              type="number"
              min={1}
              max={186}
              value={period.days}
              onChange={(event) => onChange({ kind: "ROLLING_DAYS", days: Math.min(186, Math.max(1, Number(event.target.value) || 1)) })}
            />
          </div>
        ) : period.kind === "CLOSURES" ? (
          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-count`}>Quantidade</Label>
            <Input
              id={`${fieldId}-count`}
              type="number"
              min={2}
              max={24}
              value={period.count}
              onChange={(event) => onChange({ kind: "CLOSURES", unit: "MONTH", count: Math.min(24, Math.max(2, Number(event.target.value) || 2)) })}
            />
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-phase`}>Fase</Label>
            <Select value={phase} onValueChange={(value) => onChange({ kind: "CALENDAR", unit: period.unit, phase: value as CalendarPhase })}>
              <SelectTrigger id={`${fieldId}-phase`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PREVIOUS">Anterior (completo)</SelectItem>
                <SelectItem value="CURRENT">Corrente (parcial, até agora)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      {period.kind === "CALENDAR" ? <p className="text-xs text-muted-foreground">{describeCalendarPeriod(period.unit, phase)}</p> : null}
      {period.kind === "ROLLING_DAYS" && operationalWindows ? (
        <p className="text-xs text-muted-foreground">
          Os {period.days} dias de calendário terminando hoje (hoje entra parcial, até agora). A comparação com &quot;período anterior&quot; usa os {period.days} dias imediatamente anteriores.
        </p>
      ) : null}
      {period.kind === "CLOSURES" && closuresSource === "MEASUREMENT" ? (
        <p className="text-xs text-muted-foreground">
          Considera os últimos {period.count} MESES DE CALENDÁRIO já fechados (completos) imediatamente anteriores ao mês corrente — o mês
          corrente nunca entra, mesmo parcial. Os meses são sempre consecutivos: se um deles não tiver medição suficiente, o resultado é
          Sem Dados — nunca busca um mês mais antigo pra completar a quantidade pedida.
        </p>
      ) : null}
      {period.kind === "CLOSURES" && closuresSource === "ACHIEVEMENT" ? (
        <p className="text-xs text-muted-foreground">
          Conta os últimos {period.count} fechamentos mensais REALMENTE persistidos — nunca uma aproximação por dias. Menos fechamentos
          do que isso no histórico vira Sem Dados.
        </p>
      ) : null}
    </div>
  )
}

// A Origem (Valor bruto/Atingimento do indicador/Atingimento do PRV) é decidida pela escolha "O
// que deseja analisar?" de IndicatorConditionForm — nunca mais reperguntada aqui dentro. COUNT só
// existe pra Valor bruto (source MEASUREMENT); Atingimento nunca conta ocorrências, só agrega
// (ver runHistoricalAggregation no backend, que ignora `source` no modo COUNT).
/** Agregações oferecidas: pra Valor do indicador dependem da semântica operacional DO indicador
 * (`operationalAggregation` do catálogo — média ponderada pra TMA/taxas, último valor pra
 * backlog…, ver allowedAggregationsFor); pra Atingimento/PRV, só entre fechamentos. */
export function aggregationsFor(source: HistoricalSource | undefined, indicatorKind: OperationalAggregationKind | undefined): HistoricalAggregation[] {
  if (source === "MEASUREMENT" || source === undefined) return ["COUNT", ...allowedAggregationsFor(indicatorKind).filter((item) => item !== "COUNT")]
  return OFFICIAL_AGGREGATIONS
}

/**
 * Cobertura mínima (Parte 20–31 do hardening): dias com medição ÷ dias úteis elegíveis na
 * janela (admissão no meio da janela reduz os elegíveis). Guardada como fração (0.7), editada
 * como percentual (70). Abaixo do mínimo = "Sem dados" — nunca 0, nunca Q4.
 */
export function MinimumCoverageField({ value, onChange }: { value: number | undefined; onChange: (next: number | undefined) => void }) {
  const inputId = useId()
  return (
    <div className="space-y-1.5">
      <Label htmlFor={inputId} className="text-xs text-muted-foreground">Cobertura mínima de dias (%, opcional)</Label>
      <Input
        id={inputId}
        type="number"
        min={1}
        max={100}
        value={value === undefined ? "" : Math.round(value * 100)}
        placeholder="ex.: 70"
        onChange={(event) => {
          const raw = event.target.value.trim()
          if (!raw) return onChange(undefined)
          const percent = Math.min(100, Math.max(1, Math.round(Number(raw) || 1)))
          onChange(percent / 100)
        }}
      />
      <p className="text-xs text-muted-foreground">
        Dias com medição ÷ dias úteis elegíveis na janela (admissão no meio da janela conta só os dias a partir dela). Abaixo disso o resultado é &quot;Sem dados&quot; — nunca 0, nunca Q4.
      </p>
    </div>
  )
}
